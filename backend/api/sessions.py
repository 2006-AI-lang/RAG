"""多轮会话 API 路由（需登录）。

会话与消息均存储在数据库中，跟随用户账号，关闭网页后不会丢失。
"""

from fastapi import APIRouter, HTTPException, Request

from models import ChatSessionItem, ChatMessageItem, CreateSessionRequest
from api.auth import require_user
from database import (
    create_chat_session,
    list_chat_sessions,
    get_chat_session,
    delete_chat_session,
    list_chat_messages,
)

router = APIRouter()


@router.get("/sessions", response_model=list[ChatSessionItem])
async def sessions_list(request: Request):
    """获取当前用户的会话列表。"""
    user = require_user(request)
    return list_chat_sessions(user["id"])


@router.post("/sessions", response_model=ChatSessionItem)
async def sessions_create(request: Request, body: CreateSessionRequest):
    """创建新会话。"""
    user = require_user(request)
    title = (body.title or "新对话").strip() or "新对话"
    sid = create_chat_session(user["id"], title[:100])
    session = get_chat_session(user["id"], sid)
    return ChatSessionItem(id=session["id"], title=session["title"])


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageItem])
async def sessions_messages(session_id: int, request: Request):
    """获取某个会话的全部消息。"""
    user = require_user(request)
    if not get_chat_session(user["id"], session_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return list_chat_messages(session_id)


@router.delete("/sessions/{session_id}")
async def sessions_delete(session_id: int, request: Request):
    """删除会话。"""
    user = require_user(request)
    if not delete_chat_session(user["id"], session_id):
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"status": "ok", "message": "会话已删除"}
