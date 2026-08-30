"""问答历史 API 路由（用户隔离）。"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from models import HistoryRecord
from api.auth import require_user
from database import get_history, clear_history, delete_history, delete_history_batch

router = APIRouter()


class BatchDeleteRequest(BaseModel):
    """批量删除历史请求。"""
    ids: List[int]


@router.get("/history", response_model=list[HistoryRecord])
async def history_list(request: Request):
    """获取当前用户的问答历史（需登录）。"""
    user = require_user(request)
    records = get_history(user_id=user["id"], limit=50)
    return [
        HistoryRecord(
            id=r["id"],
            question=r["question"],
            answer=r["answer"],
            mode=r["mode"],
            created_at=r["created_at"],
            sources=r["sources"],
        )
        for r in records
    ]


@router.delete("/history/{history_id}")
async def history_delete(history_id: int, request: Request):
    """删除当前用户的单条问答历史（需登录）。"""
    user = require_user(request)
    success = delete_history(history_id, user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="历史记录不存在或无权删除")
    return {"status": "ok", "message": "历史记录已删除"}


@router.delete("/history")
async def history_clear(request: Request, body: Optional[BatchDeleteRequest] = None):
    """
    清空当前用户的问答历史；若传入 ids 则批量删除指定记录（需登录）。
    """
    user = require_user(request)
    if body and body.ids:
        deleted = delete_history_batch(body.ids, user["id"])
        return {"status": "ok", "message": f"已删除 {deleted} 条历史记录", "deleted": deleted}
    clear_history(user["id"])
    return {"status": "ok", "message": "历史记录已清空"}
