"""问答 API 路由：POST /ask。"""

import json
import re
import logging

from fastapi import APIRouter, HTTPException, Request

from models import AskRequest, AskResponse, SourceItem
from llm.client import LLMClient, resolve_llm_config
from api.auth import get_optional_user
from database import (
    save_history,
    get_chat_session,
    list_chat_messages,
    add_chat_message,
    update_chat_session_title,
    record_unanswered_question,
    list_exercise_records,
)

logger = logging.getLogger("fitqa.ask")

router = APIRouter()


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
        mode=body.mode or "hybrid",
        top_k=body.top_k or 5,
    )

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
    )

    # 3.1 检索到结果但 LLM 判定无法回答：同样记录未答问题
    if results and ("无法确定" in answer or "无法回答" in answer):
        try:
            record_unanswered_question(question=question, mode=actual_mode, reason="LLM判定无法回答")
        except Exception as e:
            logger.warning(f"Failed to record unanswered question: {e}")

    # 3.2 二次校验：检查回答是否引用了知识库资料编号，未引用则附加提示
    if results and answer:
        is_fallback = answer.startswith("【离线模式") or answer.startswith("【模型未返回") or answer.startswith("[LLM")
        if not is_fallback:
            has_ref = bool(re.search(r"\[[\d]+\]", answer))
            if not has_ref:
                answer = "⚠️ 本次回答未引用知识库资料，仅供参考\n\n" + answer

    # 4. 构造来源列表
    sources = [
        SourceItem(
            id=src["id"],
            title=src["title"],
            score=src["score"],
            snippet=src["snippet"],
            category=src.get("category", ""),
            url=src.get("url", ""),
        )
        for src in results
    ]

    # 5. 保存全局问答历史
    try:
        save_history(
            question=question,
            answer=answer,
            mode=actual_mode,
            sources=json.dumps([s.model_dump() for s in sources], ensure_ascii=False),
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
                    question if len(question) <= 20 else question[:20] + "...",
                )
        except Exception as e:
            logger.warning(f"Failed to save session messages: {e}")

    return AskResponse(
        answer=answer,
        sources=sources,
        mode=actual_mode,
    )
