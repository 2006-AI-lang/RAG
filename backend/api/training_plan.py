"""训练计划 API 路由（需登录）。"""

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import Response

from models import (
    TrainingPlanItem,
    CreateTrainingPlanRequest,
    UpdateTrainingPlanRequest,
    BatchDeleteTrainingPlanRequest,
    BatchUpdateTrainingPlanRequest,
)
from api.auth import require_user
from database import (
    add_training_plan,
    update_training_plan,
    delete_training_plan,
    batch_delete_training_plans,
    batch_update_training_plans,
    list_training_plans,
    get_training_plan,
    get_training_plan_categories,
)

import json
import csv
import io
from datetime import datetime

router = APIRouter()


@router.get("/training-plans", response_model=list[TrainingPlanItem])
async def get_plans(
    request: Request,
    category: str = "",
    goal: str = "",
    level: str = "",
    days_per_week: int = Query(0, ge=0, le=7, description="每周训练天数"),
    date_from: str = "",
    date_to: str = "",
    keyword: str = "",
    limit: int = 100,
    offset: int = 0,
):
    """获取当前用户的训练计划列表。"""
    user = require_user(request)
    return list_training_plans(
        user_id=user["id"],
        category=category,
        goal=goal,
        level=level,
        days_per_week=days_per_week,
        date_from=date_from,
        date_to=date_to,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@router.get("/training-plans/categories")
async def get_categories(request: Request):
    """获取用户训练计划的所有分类。"""
    user = require_user(request)
    return {"categories": get_training_plan_categories(user["id"])}


@router.get("/training-plans/{plan_id}", response_model=TrainingPlanItem)
async def get_plan(plan_id: int, request: Request):
    """获取单个训练计划详情。"""
    user = require_user(request)
    plan = get_training_plan(plan_id, user["id"])
    if not plan:
        raise HTTPException(status_code=404, detail="训练计划不存在")
    return plan


@router.post("/training-plans", response_model=TrainingPlanItem)
async def create_plan(body: CreateTrainingPlanRequest, request: Request):
    """创建训练计划。"""
    user = require_user(request)
    title = body.title.strip() or f"{body.goal or '训练'}计划"
    rid = add_training_plan(
        user_id=user["id"],
        title=title,
        goal=body.goal.strip(),
        level=body.level.strip(),
        days_per_week=body.days_per_week,
        content=body.content.strip(),
        category=body.category.strip(),
    )
    plan = get_training_plan(rid, user["id"])
    if not plan:
        raise HTTPException(status_code=500, detail="创建失败")
    return plan


@router.put("/training-plans/{plan_id}", response_model=TrainingPlanItem)
async def update_plan(plan_id: int, body: UpdateTrainingPlanRequest, request: Request):
    """更新训练计划。"""
    user = require_user(request)
    title = body.title.strip() or f"{body.goal or '训练'}计划"
    ok = update_training_plan(
        plan_id=plan_id,
        user_id=user["id"],
        title=title,
        goal=body.goal.strip(),
        level=body.level.strip(),
        days_per_week=body.days_per_week,
        content=body.content.strip(),
        category=body.category.strip(),
    )
    if not ok:
        raise HTTPException(status_code=404, detail="训练计划不存在")
    plan = get_training_plan(plan_id, user["id"])
    if not plan:
        raise HTTPException(status_code=404, detail="训练计划不存在")
    return plan


@router.delete("/training-plans/{plan_id}")
async def delete_plan(plan_id: int, request: Request):
    """删除单个训练计划。"""
    user = require_user(request)
    if not delete_training_plan(plan_id, user["id"]):
        raise HTTPException(status_code=404, detail="训练计划不存在")
    return {"status": "ok", "message": "训练计划已删除"}


@router.post("/training-plans/batch-delete")
async def batch_delete_plans(body: BatchDeleteTrainingPlanRequest, request: Request):
    """批量删除训练计划。"""
    user = require_user(request)
    deleted = batch_delete_training_plans(body.ids, user["id"])
    return {"status": "ok", "message": f"已删除 {deleted} 个训练计划", "deleted": deleted}


@router.post("/training-plans/batch-update")
async def batch_update_plans(body: BatchUpdateTrainingPlanRequest, request: Request):
    """批量更新训练计划。"""
    user = require_user(request)
    updated = batch_update_training_plans(
        plan_ids=body.ids,
        user_id=user["id"],
        goal=body.goal.strip(),
        level=body.level.strip(),
        days_per_week=body.days_per_week,
        category=body.category.strip(),
    )
    if updated == 0 and not body.goal and not body.level and not body.days_per_week and not body.category:
        raise HTTPException(status_code=400, detail="请至少填写一项要修改的字段")
    return {"status": "ok", "message": f"已更新 {updated} 个训练计划", "updated": updated}


@router.post("/training-plans/export")
async def export_plans(request: Request, format: str = Query("json", description="导出格式: json | csv | markdown | txt")):
    """导出训练计划。"""
    user = require_user(request)
    plans = list_training_plans(user_id=user["id"], limit=10000)

    if format == "json":
        data = json.dumps(plans, ensure_ascii=False, indent=2, default=str)
        return Response(content=data, media_type="application/json",
                        headers={"Content-Disposition": f"attachment; filename=training_plans_{datetime.now().strftime('%Y%m%d')}.json"})
    elif format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "标题", "目标", "水平", "每周天数", "分类", "内容", "创建时间", "更新时间"])
        for p in plans:
            writer.writerow([p["id"], p["title"], p["goal"], p["level"], p["days_per_week"],
                             p["category"], p["content"], p["created_at"], p["updated_at"]])
        return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename=training_plans_{datetime.now().strftime('%Y%m%d')}.csv"})
    elif format == "markdown":
        lines = [f"# 训练计划导出\n\n导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n---\n"]
        for p in plans:
            lines.append(f"## {p['title'] or '训练计划'}")
            lines.append(f"- **目标**：{p['goal']}")
            lines.append(f"- **水平**：{p['level']}")
            lines.append(f"- **每周天数**：{p['days_per_week']}")
            lines.append(f"- **分类**：{p['category']}")
            lines.append(f"- **创建时间**：{p['created_at']}")
            lines.append(f"\n### 内容\n\n{p['content']}\n")
            lines.append("---\n")
        return Response(content="\n".join(lines), media_type="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename=training_plans_{datetime.now().strftime('%Y%m%d')}.md"})
    else:  # txt
        lines = [f"训练计划导出\n导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n{'='*50}\n"]
        for p in plans:
            lines.append(f"标题：{p['title'] or '训练计划'}")
            lines.append(f"目标：{p['goal']} | 水平：{p['level']} | 每周：{p['days_per_week']}天 | 分类：{p['category']}")
            lines.append(f"内容：\n{p['content']}\n")
            lines.append("-" * 30 + "\n")
        return Response(content="\n".join(lines), media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": f"attachment; filename=training_plans_{datetime.now().strftime('%Y%m%d')}.txt"})