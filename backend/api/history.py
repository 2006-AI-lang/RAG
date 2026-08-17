"""问答历史 API 路由。"""

from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models import HistoryRecord
from database import get_history, clear_history, delete_history, delete_history_batch

router = APIRouter()


class BatchDeleteRequest(BaseModel):
    """批量删除历史请求。"""
    ids: List[int]


@router.get("/history", response_model=list[HistoryRecord])
async def history_list():
    """获取近 50 条问答历史。"""
    records = get_history(limit=50)
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
async def history_delete(history_id: int):
    """删除单条问答历史。"""
    success = delete_history(history_id)
    if not success:
        raise HTTPException(status_code=404, detail="历史记录不存在")
    return {"status": "ok", "message": "历史记录已删除"}


@router.delete("/history")
async def history_clear(ids: List[int] = None):
    """
    清空所有问答历史；若传入 ids 则批量删除指定记录。
    """
    if ids:
        deleted = delete_history_batch(ids)
        return {"status": "ok", "message": f"已删除 {deleted} 条历史记录", "deleted": deleted}
    clear_history()
    return {"status": "ok", "message": "历史记录已清空"}
