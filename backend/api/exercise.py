"""运动记录 API 路由（需登录）。"""

from datetime import date

from fastapi import APIRouter, HTTPException, Request

from models import ExerciseRecordItem, CreateExerciseRequest
from api.auth import require_user
from database import add_exercise_record, list_exercise_records, delete_exercise_record

router = APIRouter()


@router.get("/exercise/records", response_model=list[ExerciseRecordItem])
async def get_records(request: Request):
    """获取当前用户最近的运动记录。"""
    user = require_user(request)
    return list_exercise_records(user["id"])


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
    return records[0] if records else ExerciseRecordItem(id=rid, exercise_type=body.exercise_type, duration=body.duration, intensity=body.intensity, notes=body.notes, record_date=record_date)


@router.delete("/exercise/records/{record_id}")
async def delete_record(record_id: int, request: Request):
    """删除一条运动记录。"""
    user = require_user(request)
    if not delete_exercise_record(user["id"], record_id):
        raise HTTPException(status_code=404, detail="记录不存在")
    return {"status": "ok", "message": "记录已删除"}
