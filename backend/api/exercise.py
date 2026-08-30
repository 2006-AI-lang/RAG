"""运动记录 API 路由（需登录）。"""

from datetime import date

from fastapi import APIRouter, HTTPException, Request, Query

from models import ExerciseRecordItem, CreateExerciseRequest, UpdateExerciseRequest, BatchDeleteRequest
from api.auth import require_user
from database import (
    add_exercise_record,
    list_exercise_records,
    update_exercise_record,
    delete_exercise_record,
    batch_delete_exercise_records,
)

router = APIRouter()


@router.get("/exercise/records", response_model=list[ExerciseRecordItem])
async def get_records(
    request: Request,
    exercise_type: str = "",
    duration_min: int = Query(0, ge=0, description="最小时长（分钟）"),
    duration_max: int = Query(0, ge=0, description="最大时长（分钟）"),
    intensity: str = "",
    date_from: str = "",
    date_to: str = "",
    keyword: str = "",
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """获取当前用户运动记录，支持筛选。"""
    user = require_user(request)
    return list_exercise_records(
        user["id"],
        exercise_type=exercise_type,
        duration_min=duration_min,
        duration_max=duration_max,
        intensity=intensity,
        date_from=date_from,
        date_to=date_to,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@router.post("/exercise/records", response_model=ExerciseRecordItem)
async def create_record(body: CreateExerciseRequest, request: Request):
    """添加一条运动记录。"""
    user = require_user(request)
    record_date = body.record_date.strip() or date.today().isoformat()
    rid = add_exercise_record(
        user_id=user["id"],
        exercise_type=body.exercise_type.strip(),
        duration=body.duration,
        intensity=body.intensity.strip() or "中等",
        notes=body.notes.strip(),
        record_date=record_date,
    )
    records = list_exercise_records(user["id"], limit=1)
    return records[0] if records else ExerciseRecordItem(
        id=rid, exercise_type=body.exercise_type, duration=body.duration,
        intensity=body.intensity, notes=body.notes, record_date=record_date,
    )


@router.put("/exercise/records/{record_id}", response_model=ExerciseRecordItem)
async def update_record(record_id: int, body: UpdateExerciseRequest, request: Request):
    """更新一条运动记录。"""
    user = require_user(request)
    ok = update_exercise_record(
        user_id=user["id"],
        record_id=record_id,
        exercise_type=body.exercise_type.strip(),
        duration=body.duration,
        intensity=body.intensity.strip(),
        notes=body.notes.strip(),
        record_date=body.record_date.strip(),
    )
    if not ok:
        raise HTTPException(status_code=404, detail="记录不存在")
    records = list_exercise_records(user["id"], limit=1)
    return records[0] if records else ExerciseRecordItem(
        id=record_id, exercise_type=body.exercise_type, duration=body.duration,
        intensity=body.intensity, notes=body.notes, record_date=body.record_date,
    )


@router.delete("/exercise/records/{record_id}")
async def delete_record(record_id: int, request: Request):
    """删除一条运动记录。"""
    user = require_user(request)
    if not delete_exercise_record(user["id"], record_id):
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"status": "ok", "message": "记录已删除"}


@router.post("/exercise/records/batch-delete")
async def batch_delete_records(body: BatchDeleteRequest, request: Request):
    """批量删除运动记录。"""
    user = require_user(request)
    deleted = batch_delete_exercise_records(body.ids, user["id"])
    return {"status": "ok", "message": f"已删除 {deleted} 条记录", "deleted": deleted}