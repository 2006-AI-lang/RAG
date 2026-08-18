"""知识库 API 路由。"""

import os
import shutil
import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request, Query

logger = logging.getLogger("fitqa.knowledge")

from models import KnowledgeItem, CategoryInfo, ImportResponse, DynamicEntryItem, CreateEntryRequest, UpdateEntryRequest
from data.knowledge_base import get_all_knowledge, get_categories
from database import (
    add_knowledge_entries,
    get_dynamic_entries_list,
    delete_entry,
    is_source_imported,
    add_single_entry,
    update_entry,
    get_entry_by_id,
    find_similar_entries,
    update_entries_batch,
)
from parsers import parse_file
from parsers.splitter import split_by_title, split_by_paragraph, split_by_length, split_by_llm, split_by_none, reset_counter
from api.auth import require_user

from models import UnansweredItem
from database import list_unanswered_questions, clear_unanswered_questions

router = APIRouter()

UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.txt'}


@router.get("/knowledge/list", response_model=list[KnowledgeItem])
async def knowledge_list():
    """获取所有知识条目。"""
    return get_all_knowledge()


@router.get("/knowledge/categories", response_model=list[CategoryInfo])
async def knowledge_categories():
    """获取分类列表及计数。"""
    return [CategoryInfo(**c) for c in get_categories()]


@router.post("/knowledge/import", response_model=ImportResponse)
async def import_knowledge(
    request: Request,
    files: List[UploadFile] = File(...),
    mode: str = Form("direct"),
    split_method: str = Form("title"),
    default_category: str = Form("未分类"),
    url: str = Form(""),
    source: str = Form(""),
):
    """
    导入文档到知识库（支持多文件，需登录）。

    - files: 上传的文件列表 (PDF/Word/TXT)
    - mode: direct=直接导入, llm=LLM智能拆分
    - split_method: title=按标题拆分, paragraph=按段落拆分, length=按固定长度拆分, llm=智能语义拆分（仅direct模式）
    - default_category: 默认分类（当自动分类失败时使用）
    - url: 来源链接（可选，应用到所有导入条目）
    - source: 自定义来源（可选，默认使用文档名）
    """
    require_user(request)
    total_added = 0
    total_skipped_dup = 0
    skipped_files = []
    messages = []

    for file in files:
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            skipped_files.append(f"{file.filename}(格式不支持)")
            continue

        if is_source_imported(file.filename):
            skipped_files.append(f"{file.filename}(已导入过)")
            continue

        file_path = UPLOAD_DIR / file.filename
        try:
            content = await file.read()
            if len(content) > MAX_FILE_SIZE:
                skipped_files.append(f"{file.filename}(超过10MB)")
                continue
            with open(file_path, "wb") as f:
                f.write(content)
        except Exception as e:
            skipped_files.append(f"{file.filename}(保存失败)")
            continue

        try:
            text = parse_file(str(file_path))
        except Exception as e:
            skipped_files.append(f"{file.filename}(解析失败)")
            continue

        reset_counter()

        if mode == "llm":
            llm_client = request.app.state.llm_client
            if llm_client.is_mock:
                entries = split_by_paragraph(text, file.filename, default_category)
                for entry in entries:
                    entry["import_mode"] = "direct"
            else:
                try:
                    entries = await split_by_llm(text, file.filename, llm_client)
                except Exception as e:
                    entries = split_by_paragraph(text, file.filename, default_category)
                    for entry in entries:
                        entry["import_mode"] = "direct"
        else:
            if split_method == "title":
                entries = split_by_title(text, file.filename, default_category)
            elif split_method == "length":
                entries = split_by_length(text, file.filename, default_category)
            elif split_method == "none":
                entries = split_by_none(text, file.filename, default_category)
            elif split_method == "llm":
                llm_client = request.app.state.llm_client
                if llm_client.is_mock:
                    entries = split_by_paragraph(text, file.filename, default_category)
                else:
                    try:
                        entries = await split_by_llm(text, file.filename, llm_client)
                    except Exception:
                        entries = split_by_paragraph(text, file.filename, default_category)
            else:
                entries = split_by_paragraph(text, file.filename, default_category)

        if not entries:
            skipped_files.append(f"{file.filename}(未提取到内容)")
            continue

        # 应用来源链接（可选）
        if url:
            for entry in entries:
                entry["url"] = url

        # 应用自定义来源（可选，默认使用文档名）
        if source:
            for entry in entries:
                entry["source"] = source

        # 内容查重：跳过与已有条目高度相似的（标题精确匹配或文本相似度 >= 0.85）
        deduped = []
        skipped_duplicates = 0
        for entry in entries:
            similar = find_similar_entries(entry.get("title", ""), entry.get("content", ""))
            if similar:
                skipped_duplicates += 1
                continue
            deduped.append(entry)

        added = add_knowledge_entries(deduped)
        total_added += added
        total_skipped_dup += skipped_duplicates
        messages.append(f"{file.filename}: 导入 {added} 条")

    try:
        hybrid = request.app.state.hybrid_retriever
        hybrid.rebuild_all()
    except Exception as e:
        logger.warning(f"[Import] Index rebuild failed: {e}")

    if not messages and skipped_files:
        return ImportResponse(
            success=False,
            message="所有文件均未导入成功",
            imported_count=0,
        )

    msg = f"成功导入 {total_added} 条知识"
    if total_skipped_dup:
        msg += f"，跳过 {total_skipped_dup} 条重复/高度相似内容"
    if skipped_files:
        msg += f"。跳过文件: {'; '.join(skipped_files)}"

    return ImportResponse(
        success=True,
        message=msg,
        imported_count=total_added,
        total_entries=len(get_all_knowledge()),
    )


@router.get("/knowledge/entries", response_model=List[DynamicEntryItem])
async def list_dynamic_entries():
    """获取动态导入的知识条目列表。"""
    return get_dynamic_entries_list()


@router.delete("/knowledge/entries/{entry_id}")
async def delete_dynamic_entry(entry_id: str, request: Request, rebuild: bool = Query(True)):
    """删除单条动态知识（需登录）。rebuild=False 时跳过索引重建。"""
    require_user(request)
    success = delete_entry(entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="条目不存在")

    if rebuild:
        try:
            hybrid = request.app.state.hybrid_retriever
            hybrid.rebuild_all()
        except Exception as e:
            logger.warning(f"[Delete] Index rebuild failed: {e}")
        return {"status": "ok", "message": "条目已删除，索引已重建"}

    return {"status": "ok", "message": "条目已删除（未重建索引，可稍后手动重建）"}


@router.post("/knowledge/rebuild-index")
async def rebuild_index(request: Request):
    """手动重建检索索引（需登录）。"""
    require_user(request)
    try:
        hybrid = request.app.state.hybrid_retriever
        hybrid.rebuild_all()
        total = len(get_all_knowledge())
        return {"status": "ok", "message": f"索引重建完成，共 {total} 条知识"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"索引重建失败: {e}")


@router.post("/knowledge/entries")
async def create_knowledge_entry(entry: CreateEntryRequest, request: Request):
    """手动新增知识条目（需登录）。split_enabled=True 时按 split_method 拆分内容为多条。"""
    require_user(request)
    import json
    tags_str = json.dumps(entry.tags, ensure_ascii=False) if entry.tags else "[]"

    if entry.split_enabled:
        # 分片新增：按标题/段落/固定长度/LLM 拆分内容为多条
        from parsers.splitter import split_by_title, split_by_paragraph, split_by_length, split_by_llm, reset_counter
        reset_counter()
        if entry.split_method == "paragraph":
            entries = split_by_paragraph(entry.content, entry.source, entry.category)
        elif entry.split_method == "length":
            entries = split_by_length(entry.content, entry.source, entry.category)
        elif entry.split_method == "llm":
            llm_client = request.app.state.llm_client
            if llm_client.is_mock:
                entries = split_by_paragraph(entry.content, entry.source, entry.category)
            else:
                try:
                    entries = await split_by_llm(entry.content, entry.source, llm_client)
                except Exception as e:
                    logger.warning(f"[Create] LLM split failed: {e}")
                    entries = split_by_paragraph(entry.content, entry.source, entry.category)
        else:
            entries = split_by_title(entry.content, entry.source, entry.category)
        for e in entries:
            e["tags"] = tags_str
            e["url"] = entry.url
        added = add_knowledge_entries(entries)
        if added == 0:
            raise HTTPException(status_code=400, detail="未能从内容中拆分出知识条目")
        entry_id = f"分片{added}条"
        message = f"知识已分片添加 {added} 条"
    else:
        entry_id = add_single_entry(
            title=entry.title,
            category=entry.category,
            content=entry.content,
            source=entry.source,
            url=entry.url,
            tags=tags_str,
        )
        message = "知识条目已添加"

    try:
        hybrid = request.app.state.hybrid_retriever
        hybrid.rebuild_all()
    except Exception as e:
        logger.warning(f"[Create] Index rebuild failed: {e}")

    return {"status": "ok", "entry_id": entry_id, "message": message}


@router.put("/knowledge/entries/batch")
async def update_knowledge_entries_batch(request: Request):
    """
    批量更新知识条目的公共字段（分类/来源/链接/标签，需登录）。

    请求体: {"entry_ids": ["DOC001", ...], "category": "...", "source": "...", "url": "...", "tags": [...]}
    仅更新提供的字段；静态内置条目（KB 开头）不可修改。
    """
    require_user(request)
    import json
    body = await request.json()
    entry_ids = body.get("entry_ids") or []
    if not entry_ids:
        raise HTTPException(status_code=400, detail="未指定要更新的条目")

    # 过滤掉静态内置条目（KB 开头），仅允许动态条目
    dynamic_ids = [eid for eid in entry_ids if not str(eid).startswith("KB")]
    if not dynamic_ids:
        raise HTTPException(status_code=400, detail="所选条目均为内置知识，不可修改")

    fields = {}
    if "category" in body and body.get("category"):
        fields["category"] = str(body["category"]).strip()
    if "source" in body and body.get("source"):
        fields["source"] = str(body["source"]).strip()
    if "url" in body:
        fields["url"] = str(body.get("url") or "").strip()
    if "tags" in body and body.get("tags") is not None:
        fields["tags"] = json.dumps(body["tags"], ensure_ascii=False)

    if not fields:
        raise HTTPException(status_code=400, detail="未提供要修改的字段")

    updated = update_entries_batch(dynamic_ids, fields)
    if updated == 0:
        raise HTTPException(status_code=404, detail="未找到可更新的条目")

    try:
        hybrid = request.app.state.hybrid_retriever
        hybrid.rebuild_all()
    except Exception as e:
        logger.warning(f"[BatchUpdate] Index rebuild failed: {e}")

    return {"status": "ok", "message": f"已批量更新 {updated} 条知识", "updated": updated}


@router.put("/knowledge/entries/{entry_id}")
async def update_knowledge_entry(entry_id: str, entry: UpdateEntryRequest, request: Request):
    """编辑知识条目（需登录）。"""
    require_user(request)
    import json
    existing = get_entry_by_id(entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail="条目不存在")

    tags_str = json.dumps(entry.tags, ensure_ascii=False) if entry.tags else "[]"
    success = update_entry(
        entry_id=entry_id,
        title=entry.title,
        category=entry.category,
        content=entry.content,
        source=entry.source,
        url=entry.url,
        tags=tags_str,
    )

    if not success:
        raise HTTPException(status_code=500, detail="更新失败")

    try:
        hybrid = request.app.state.hybrid_retriever
        hybrid.rebuild_all()
    except Exception as e:
        logger.warning(f"[Update] Index rebuild failed: {e}")

    return {"status": "ok", "message": "知识条目已更新"}


@router.get("/knowledge/unanswered", response_model=list[UnansweredItem])
async def get_unanswered_questions(request: Request):
    """获取无法回答的问题记录（需登录）。"""
    require_user(request)
    return list_unanswered_questions()


@router.delete("/knowledge/unanswered")
async def clear_unanswered(request: Request):
    """清空无法回答问题记录（需登录）。"""
    require_user(request)
    cleared = clear_unanswered_questions()
    return {"status": "ok", "message": f"已清空 {cleared} 条记录"}
