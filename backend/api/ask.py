"""问答 API 路由：POST /ask。"""

import hashlib
import json
import re
import time
import logging
from collections import OrderedDict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from models import AskRequest, AskResponse, AskStreamRequest, SourceItem
from llm.client import LLMClient, resolve_llm_config
from api.auth import get_optional_user
from config import settings
from database import (
    save_history,
    get_chat_session,
    list_chat_messages,
    add_chat_message,
    update_chat_session_title,
    record_unanswered_question,
    list_exercise_records,
    get_user_retrieval_config,
)

logger = logging.getLogger("fitqa.ask")

router = APIRouter()

# 回答缓存（LRU，内存）
_answer_cache: OrderedDict = OrderedDict()


def _get_cache_key(question: str, mode: str, top_k: int) -> str:
    """生成缓存键。"""
    raw = f"{question}|{mode}|{top_k}"
    return hashlib.md5(raw.encode()).hexdigest()


def _get_from_cache(cache_key: str) -> tuple | None:
    """从缓存获取回答（检查过期）。"""
    if cache_key in _answer_cache:
        entry = _answer_cache[cache_key]
        if time.time() - entry["ts"] < settings.ANSWER_CACHE_TTL_SECONDS:
            _answer_cache.move_to_end(cache_key)
            return entry["data"]
        del _answer_cache[cache_key]
    return None


def _set_cache(cache_key: str, data: tuple):
    """写入缓存。"""
    if cache_key in _answer_cache:
        del _answer_cache[cache_key]
    _answer_cache[cache_key] = {"data": data, "ts": time.time()}
    if len(_answer_cache) > settings.ANSWER_CACHE_SIZE:
        _answer_cache.popitem(last=False)


def clear_answer_cache():
    """清空回答缓存（索引重建后调用，避免引用编号错位）。"""
    global _answer_cache
    _answer_cache.clear()
    logger.info("[Cache] Answer cache cleared due to index rebuild")


def get_retriever(request: Request):
    """从 app.state 获取混合检索器。"""
    return request.app.state.hybrid_retriever


def get_llm_client(request: Request) -> LLMClient:
    """从 app.state 获取 LLM 客户端。"""
    return request.app.state.llm_client


@router.post("/ask", response_model=AskResponse)
async def ask(request: Request, body: AskRequest):
    """
    健身知识问答接口。

    - question: 用户问题
    - mode: 检索模式（bm25 / vector / hybrid）
    - session_id: 多轮会话 ID（登录用户，可选）
    - history: 最近对话历史（可选，用于多轮上下文）
    """
    retriever = get_retriever(request)
    llm = get_llm_client(request)

    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    # 登录用户 + session_id 时，从数据库加载会话历史用于多轮上下文
    user = get_optional_user(request)
    session = None
    history = []

    # 应用用户检索偏好
    mode = body.mode or "hybrid"
    top_k = body.top_k or 5
    if user:
        prefs = get_user_retrieval_config(user["id"])
        if prefs and body.mode is None:
            mode = prefs["default_mode"]
        if prefs and body.top_k is None:
            top_k = prefs["default_top_k"]

    if body.session_id:
        if not user:
            raise HTTPException(status_code=401, detail="请先登录后再使用多轮会话")
        session = get_chat_session(user["id"], body.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in list_chat_messages(body.session_id)
        ][-6:]
    elif body.history:
        history = [
            {"role": t.role if t.role in ("user", "assistant") else "user", "content": t.content}
            for t in body.history[-6:]
        ]

    # 检查缓存（skip_cache=True 时跳过，用于重新回答）
    cache_key = _get_cache_key(question, mode, top_k)
    cached = None
    if not body.skip_cache:
        cached = _get_from_cache(cache_key)
    if cached:
        return AskResponse(answer=cached[0], sources=cached[1], mode=cached[2], cached=True)

    # 获取用户近期运动记录（自动带入上下文，供 LLM 分析）
    exercise_records = []
    if user:
        try:
            exercise_records = list_exercise_records(user["id"], limit=5)
        except Exception:
            pass

    # 1. 检索（top_k 默认 5；检索对比模式由前端传 20，与正常问答 hybrid 的 BM25 召回量 top_k*4 对齐）
    results, actual_mode = retriever.search(
        query=question,
        mode=mode,
        top_k=top_k,
    )

    # 当场景为知识库分类（cat:xxx）时，过滤结果仅保留该分类的条目
    if body.scene and body.scene.startswith("cat:"):
        category_name = body.scene[4:]
        if category_name:
            results = [r for r in results if r.get("category", "").strip() == category_name]
            actual_mode = actual_mode + "_filtered"

    # 2. 无检索结果：记录无法回答的问题，供后续改进知识库
    if not results:
        try:
            record_unanswered_question(question=question, mode=actual_mode, reason="无检索结果")
        except Exception as e:
            logger.warning(f"Failed to record unanswered question: {e}")

    # 3. 调用 LLM 生成回答（携带历史上下文 + 运动记录；登录用户用其个人 LLM 配置）
    answer = await llm.ask(
        question=question,
        sources=results,
        history=history,
        config=resolve_llm_config(user["id"] if user else None),
        exercise_records=exercise_records,
        scene=body.scene,
    )

    # 3.1 检索到结果但 LLM 判定无法回答：同样记录未答问题
    is_unanswerable = "无法确定" in answer or "无法回答" in answer
    if results and is_unanswerable:
        try:
            record_unanswered_question(question=question, mode=actual_mode, reason="LLM判定无法回答")
        except Exception as e:
            logger.warning(f"Failed to record unanswered question: {e}")

    # 3.2 二次校验：检查回答是否引用了知识库资料编号，未引用则附加提示
    if results and answer:
        is_fallback = answer.startswith("【离线模式") or answer.startswith("【模型未返回") or answer.startswith("[LLM")
        if not is_fallback:
            has_ref = bool(re.search(r"\[([A-Z]?\d+)\]", answer))
            if not has_ref:
                answer = "⚠️ 本次回答未引用知识库资料，仅供参考\n\n" + answer

    # 4. 构造来源列表（过滤：无法回答时清空；有引用时仅保留被引用的来源）
    if is_unanswerable:
        filtered_results = []
    else:
        # 优先匹配 entry_id 引用（如 [E001]），不匹配时回退到顺序索引匹配（如 [1]）
        cited_ids = set()
        cited_nums = set()
        matches = re.findall(r"\[([A-Z]?\d+)\]", answer)
        for m in matches:
            if re.match(r"^[A-Z]+\d+$", m):  # 如 E001
                cited_ids.add(m)
            else:
                try:
                    n = int(m)
                    if 1 <= n <= len(results):
                        cited_nums.add(n)
                except ValueError:
                    pass
        if cited_ids:
            filtered_results = [r for r in results if r.get("id") in cited_ids]
        elif cited_nums:
            filtered_results = [results[i - 1] for i in sorted(cited_nums)]
        else:
            filtered_results = results

    sources = [
        SourceItem(
            id=src["id"],
            title=src["title"],
            score=src["score"],
            snippet=src["snippet"],
            category=src.get("category", ""),
            url=src.get("url", ""),
        )
        for src in filtered_results
    ]

    # 5. 写入缓存（降级/错误回答不缓存，避免返回错误结果）
    is_degraded = answer.startswith("【离线模式") or answer.startswith("【模型未返回") or answer.startswith("[LLM调用失败") or answer.startswith("[LLM调用异常")
    if not is_degraded:
        _set_cache(cache_key, (answer, sources, actual_mode))

    # 6. 保存问答历史（仅登录用户）
    try:
        save_history(
            question=question,
            answer=answer,
            mode=actual_mode,
            sources=json.dumps([s.model_dump() for s in sources], ensure_ascii=False),
            user_id=user["id"] if user else None,
        )
    except Exception as e:
        logger.warning(f"Failed to save history: {e}")

    # 6. 保存到多轮会话（登录用户）
    if session:
        try:
            add_chat_message(session["id"], "user", question)
            add_chat_message(
                session["id"],
                "assistant",
                answer,
                json.dumps([s.model_dump() for s in sources], ensure_ascii=False),
            )
            if session["title"] == "新对话":
                update_chat_session_title(
                    session["id"],
                    question if len(question) <= 100 else question[:100] + "...",
                )
        except Exception as e:
            logger.warning(f"Failed to save session messages: {e}")

    return AskResponse(
        answer=answer,
        sources=sources,
        mode=actual_mode,
    )


@router.post("/ask/stream")
async def ask_stream(request: Request, body: AskStreamRequest):
    """
    流式问答接口（SSE）。

    - question: 用户问题
    - mode: 检索模式
    - scene: 场景（auto/general/muscle_gain/fat_loss/injury/nutrition）
    """
    retriever = get_retriever(request)
    llm = get_llm_client(request)

    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")

    user = get_optional_user(request)

    mode = body.mode or "hybrid"
    top_k = body.top_k or 5
    if user:
        prefs = get_user_retrieval_config(user["id"])
        if prefs and body.mode is None:
            mode = prefs["default_mode"]
        if prefs and body.top_k is None:
            top_k = prefs["default_top_k"]

    history = []
    if body.session_id:
        if not user:
            raise HTTPException(status_code=401, detail="请先登录后再使用多轮会话")
        session = get_chat_session(user["id"], body.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="会话不存在")
        history = [
            {"role": m["role"], "content": m["content"]}
            for m in list_chat_messages(body.session_id)
        ][-6:]
    elif body.history:
        history = [
            {"role": t.role if t.role in ("user", "assistant") else "user", "content": t.content}
            for t in body.history[-6:]
        ]

    exercise_records = []
    if user:
        try:
            exercise_records = list_exercise_records(user["id"], limit=5)
        except Exception:
            pass

    # 检查缓存（skip_cache=True 时跳过）
    cache_key = _get_cache_key(question, mode, top_k)
    cached = None
    if not body.skip_cache:
        cached = _get_from_cache(cache_key)
    if cached:
        async def generate_cached():
            yield f"data: {json.dumps({'chunk': cached[0], 'sources': [s.model_dump() for s in cached[1]], 'mode': cached[2], 'cached': True, 'done': True}, ensure_ascii=False)}\n\n"
        return StreamingResponse(generate_cached(), media_type="text/event-stream")

    # 检索
    results, actual_mode = retriever.search(query=question, mode=mode, top_k=top_k)

    # 当场景为知识库分类（cat:xxx）时，过滤结果仅保留该分类的条目
    if body.scene and body.scene.startswith("cat:"):
        category_name = body.scene[4:]
        if category_name:
            results = [r for r in results if r.get("category", "").strip() == category_name]
            actual_mode = actual_mode + "_filtered"

    async def generate():
        """SSE 生成器。"""
        full_answer = ""
        try:
            async for chunk in llm.ask_stream(
                question=question,
                sources=results,
                history=history,
                config=resolve_llm_config(user["id"] if user else None),
                exercise_records=exercise_records,
                scene=body.scene,
            ):
                full_answer += chunk
                yield f"data: {json.dumps({'chunk': chunk, 'sources': [], 'mode': actual_mode, 'cached': False}, ensure_ascii=False)}\n\n"

            # 过滤来源：无法回答时清空，否则仅保留被引用的来源
            is_unanswerable = "无法确定" in full_answer or "无法回答" in full_answer
            if is_unanswerable:
                filtered_results = []
            else:
                # 优先匹配 entry_id 引用（如 [E001]），不匹配时回退到顺序索引匹配（如 [1]）
                cited_ids = set()
                cited_nums = set()
                matches = re.findall(r"\[([A-Z]?\d+)\]", full_answer)
                for m in matches:
                    if re.match(r"^[A-Z]+\d+$", m):
                        cited_ids.add(m)
                    else:
                        try:
                            n = int(m)
                            if 1 <= n <= len(results):
                                cited_nums.add(n)
                        except ValueError:
                            pass
                if cited_ids:
                    filtered_results = [r for r in results if r.get("id") in cited_ids]
                elif cited_nums:
                    filtered_results = [results[i - 1] for i in sorted(cited_nums)]
                else:
                    filtered_results = results

            sources = [
                SourceItem(
                    id=src["id"], title=src["title"], score=src["score"],
                    snippet=src["snippet"], category=src.get("category", ""), url=src.get("url", ""),
                )
                for src in filtered_results
            ]

            yield f"data: {json.dumps({'chunk': '', 'sources': [s.model_dump() for s in sources], 'mode': actual_mode, 'cached': False, 'done': True}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"[Stream] Error: {e}")
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

        # 记录未回答问题
        if not results:
            try:
                record_unanswered_question(question=question, mode=actual_mode, reason="无检索结果")
            except Exception:
                pass
        elif full_answer and ("无法确定" in full_answer or "无法回答" in full_answer):
            try:
                record_unanswered_question(question=question, mode=actual_mode, reason="LLM判定无法回答")
            except Exception:
                pass

        # 写入缓存（降级/错误回答不缓存）
        if full_answer:
            is_degraded = full_answer.startswith("【离线模式") or full_answer.startswith("【模型未返回") or full_answer.startswith("[LLM调用失败") or full_answer.startswith("[LLM调用异常")
            if not is_degraded:
                _set_cache(cache_key, (full_answer, sources, actual_mode))

        # 保存历史（仅登录用户）
        try:
            save_history(
                question=question, answer=full_answer, mode=actual_mode,
                sources=json.dumps([s.model_dump() for s in sources], ensure_ascii=False),
                user_id=user["id"] if user else None,
            )
        except Exception:
            pass

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/scenes")
async def list_scenes():
    """获取所有可用场景列表。"""
    from llm.prompts import list_scenes as _list_scenes
    return {"scenes": _list_scenes()}