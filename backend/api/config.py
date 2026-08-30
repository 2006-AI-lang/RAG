"""配置管理 API 路由。

- 登录用户：模型列表 / 增删改 / 激活 / 模式切换均为该用户私有（llm_models.user_id）。
- 匿名用户：管理全局模型（user_id IS NULL）与全局模式。
"""

import logging

from fastapi import APIRouter, HTTPException, Request

from config import settings
from models import (
    LLMConfigRequest,
    LLMModeRequest,
    LLMConfigResponse,
    TestConnectionRequest,
    TestConnectionResponse,
    AddModelRequest,
    ModelListResponse,
    LLMModelItem,
)
from llm.client import LLMClient, mask_api_key
from api.auth import get_optional_user
from database import (
    get_all_models,
    add_model,
    set_active_model,
    delete_model,
    get_active_model,
    update_model,
    get_model_by_id,
    get_user_mode,
    set_user_mode,
)

logger = logging.getLogger("fitqa.config")

router = APIRouter()


def _scope(request: Request):
    """返回 (user_id, 是否为个人) —— 个人 user_id 为 int，全局为 None。"""
    user = get_optional_user(request)
    return (user["id"] if user else None)


def _validate_llm_input(base_url: str, api_key: str, model_name: str):
    """校验 LLM 配置输入的公共部分。"""
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL 必须以 http:// 或 https:// 开头")
    if len(api_key) < 8:
        raise HTTPException(status_code=400, detail="API Key 长度不足")
    if not model_name.strip():
        raise HTTPException(status_code=400, detail="模型名称不能为空")


@router.get("/config", response_model=LLMConfigResponse)
async def get_config(request: Request):
    """获取 LLM 配置（登录用户返回其个人激活模型 + 模式，否则返回全局配置）。"""
    user = get_optional_user(request)
    if user:
        mode = get_user_mode(user["id"])
        active = get_active_model(user["id"])
        if active and active.get("api_key_encrypted"):
            try:
                api_key = settings.decrypt_api_key(active["api_key_encrypted"])
                return LLMConfigResponse(
                    base_url=active["base_url"] or settings.OPENAI_BASE_URL,
                    api_key_masked=mask_api_key(api_key),
                    model_name=active["model_name"] or settings.MODEL_NAME,
                    mode=mode,
                    is_mock=(mode != "real") or not api_key,
                    is_personal=True,
                )
            except Exception as e:
                logger.warning(f"[Config] Failed to decrypt user active model: {e}")
        # 用户尚无模型：模式用个人模式，其余回退全局
        return LLMConfigResponse(
            base_url=settings.OPENAI_BASE_URL,
            api_key_masked=settings.get_masked_api_key(),
            model_name=settings.MODEL_NAME,
            mode=mode,
            is_mock=(mode != "real") or not settings.OPENAI_API_KEY,
        )

    return LLMConfigResponse(
        base_url=settings.OPENAI_BASE_URL,
        api_key_masked=settings.get_masked_api_key(),
        model_name=settings.MODEL_NAME,
        mode=settings.LLM_MODE,
        is_mock=settings.is_mock_mode,
    )


@router.put("/config")
async def update_config(body: LLMConfigRequest, request: Request):
    """更新当前激活模型的配置（登录用户更新其个人激活模型；匿名更新全局激活模型）。"""
    user_id = _scope(request)
    active = get_active_model(user_id)
    if not active:
        raise HTTPException(status_code=400, detail="尚未添加任何模型，请先在设置中添加一个模型")

    _validate_llm_input(body.base_url, body.api_key, body.model_name)
    api_key = body.api_key.strip()

    success = update_model(
        model_id=active["id"],
        name=active["name"],
        base_url=body.base_url.rstrip("/"),
        api_key_encrypted=settings.encrypt_api_key(api_key),
        model_name=body.model_name.strip(),
        user_id=user_id,
    )
    if not success:
        raise HTTPException(status_code=404, detail="模型不存在")

    if user_id is None:
        settings.update_llm_config(
            base_url=body.base_url.rstrip("/"),
            api_key=api_key,
            model_name=body.model_name.strip(),
        )
        llm: LLMClient = request.app.state.llm_client
        llm.refresh()

    return {"status": "ok", "message": "配置已更新"}


@router.put("/config/mode")
async def update_mode(body: LLMModeRequest, request: Request):
    """切换 LLM 模式（登录用户切换个人模式；匿名切换全局模式）。"""
    if body.mode not in ("mock", "real"):
        raise HTTPException(status_code=400, detail="模式必须是 mock 或 real")

    user_id = _scope(request)
    if user_id is not None:
        if body.mode == "real":
            active = get_active_model(user_id)
            if not active:
                raise HTTPException(status_code=400, detail="尚未添加任何模型，请先添加并激活一个模型")
        set_user_mode(user_id, body.mode)
        return {"status": "ok", "message": f"已切换到 {body.mode} 模式（个人）", "is_mock": body.mode == "mock"}

    # 全局模式（匿名）
    if body.mode == "real":
        active = get_active_model(None)
        if not active:
            raise HTTPException(status_code=400, detail="尚未添加任何模型，请先在设置中添加并激活一个模型")
        try:
            api_key = settings.decrypt_api_key(active["api_key_encrypted"])
        except Exception:
            raise HTTPException(status_code=400, detail="激活模型的 API Key 无法解密，请重新编辑该模型的 API Key")
        settings.update_llm_config(
            base_url=active["base_url"],
            api_key=api_key,
            model_name=active["model_name"],
        )
        settings.update_mode("real")
    else:
        settings.update_mode("mock")

    llm: LLMClient = request.app.state.llm_client
    llm.refresh()

    return {
        "status": "ok",
        "message": f"已切换到 {body.mode} 模式",
        "is_mock": settings.is_mock_mode,
    }


@router.post("/config/test", response_model=TestConnectionResponse)
async def test_connection(body: TestConnectionRequest):
    """测试 LLM 连接。"""
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL 必须以 http:// 或 https:// 开头")

    result = await LLMClient.test_connection(
        base_url=body.base_url.rstrip("/"),
        api_key=body.api_key,
        model_name=body.model_name,
    )

    return TestConnectionResponse(**result)


# ==================== 多模型管理（按用户隔离） ====================

@router.get("/config/models", response_model=ModelListResponse)
async def list_models(request: Request):
    """获取当前范围的模型列表。"""
    user_id = _scope(request)
    models = get_all_models(user_id)
    active = get_active_model(user_id)
    return ModelListResponse(
        models=[LLMModelItem(**m) for m in models],
        active_model_id=active["id"] if active else None,
    )


@router.post("/config/models")
async def create_model(body: AddModelRequest, request: Request):
    """添加新模型（登录用户添加到个人模型）。"""
    user_id = _scope(request)
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL 必须以 http:// 或 https:// 开头")
    if not body.api_key.strip():
        raise HTTPException(status_code=400, detail="请输入 API Key")

    encrypted_key = settings.encrypt_api_key(body.api_key.strip())

    try:
        model_id = add_model(
            name=body.name.strip(),
            base_url=body.base_url.rstrip("/"),
            api_key_encrypted=encrypted_key,
            model_name=body.model_name.strip(),
            user_id=user_id,
        )
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="模型名称已存在")
        raise HTTPException(status_code=500, detail=f"保存失败: {e}")

    # 匿名添加时同步应用到全局配置；个人添加无需改全局
    if user_id is None:
        active = get_active_model(None)
        if active:
            settings.update_llm_config(
                base_url=active["base_url"],
                api_key=settings.decrypt_api_key(active["api_key_encrypted"]),
                model_name=active["model_name"],
            )
            settings.update_mode("real")
            llm: LLMClient = request.app.state.llm_client
            llm.refresh()

    return {"status": "ok", "message": "模型已添加", "id": model_id}


@router.put("/config/models/{model_id}/activate")
async def activate_model(model_id: int, request: Request):
    """切换激活模型。"""
    user_id = _scope(request)
    success = set_active_model(model_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="模型不存在")

    active = get_active_model(user_id)
    if user_id is None and active:
        settings.update_llm_config(
            base_url=active["base_url"],
            api_key=settings.decrypt_api_key(active["api_key_encrypted"]),
            model_name=active["model_name"],
        )
        settings.update_mode("real")
        llm: LLMClient = request.app.state.llm_client
        llm.refresh()

    return {"status": "ok", "message": f"已切换到模型 {active['name']}" if active else "已切换模型"}


@router.put("/config/models/{model_id}")
async def edit_model(model_id: int, body: AddModelRequest, request: Request):
    """编辑模型（含重新保存 API Key）。"""
    user_id = _scope(request)
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL 必须以 http:// 或 https:// 开头")

    if body.api_key.strip():
        encrypted_key = settings.encrypt_api_key(body.api_key.strip())
    else:
        existing = get_model_by_id(model_id, user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="模型不存在")
        encrypted_key = existing["api_key_encrypted"]

    try:
        success = update_model(
            model_id=model_id,
            name=body.name.strip(),
            base_url=body.base_url.rstrip("/"),
            api_key_encrypted=encrypted_key,
            model_name=body.model_name.strip(),
            user_id=user_id,
        )
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="模型名称已存在")
        raise HTTPException(status_code=500, detail=f"保存失败: {e}")

    if not success:
        raise HTTPException(status_code=404, detail="模型不存在")

    if user_id is None:
        active = get_active_model(None)
        if active and active["id"] == model_id:
            settings.update_llm_config(
                base_url=active["base_url"],
                api_key=settings.decrypt_api_key(active["api_key_encrypted"]),
                model_name=active["model_name"],
            )
            settings.update_mode("real")
            llm: LLMClient = request.app.state.llm_client
            llm.refresh()

    return {"status": "ok", "message": "模型已更新"}


@router.delete("/config/models/{model_id}")
async def remove_model(model_id: int, request: Request):
    """删除模型。"""
    user_id = _scope(request)
    success = delete_model(model_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="模型不存在")

    # 若删除的是当前激活模型，自动激活范围内剩余第一个
    active = get_active_model(user_id)
    if not active:
        remaining = get_all_models(user_id)
        if remaining:
            set_active_model(remaining[0]["id"], user_id)
            new_active = get_active_model(user_id)
            if user_id is None and new_active:
                settings.update_llm_config(
                    base_url=new_active["base_url"],
                    api_key=settings.decrypt_api_key(new_active["api_key_encrypted"]),
                    model_name=new_active["model_name"],
                )
                settings.update_mode("real")
                llm: LLMClient = request.app.state.llm_client
                llm.refresh()
            return {"status": "ok", "message": "模型已删除，已自动切换到剩余模型"}
        if user_id is None:
            settings.update_mode("mock")
            llm: LLMClient = request.app.state.llm_client
            llm.refresh()
        else:
            set_user_mode(user_id, "mock")

    return {"status": "ok", "message": "模型已删除"}


# ==================== 检索偏好 ====================

@router.get("/config/retrieval")
async def get_retrieval_prefs(request: Request):
    """获取当前用户的检索偏好（未登录返回默认值）。"""
    from models import RetrievalPreferencesResponse
    from database import get_user_retrieval_config as get_prefs
    user = get_optional_user(request)
    if user:
        prefs = get_prefs(user["id"])
        if prefs:
            return RetrievalPreferencesResponse(**prefs)
    return RetrievalPreferencesResponse(
        default_mode="hybrid",
        default_top_k=5,
        min_vector_score=settings.RETRIEVAL_MIN_VECTOR_SCORE,
    )


@router.put("/config/retrieval")
async def update_retrieval_prefs(request: Request):
    """更新当前用户的检索偏好（需登录）。"""
    from models import RetrievalPreferences
    from database import save_user_retrieval_config
    user = get_optional_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")

    body = await request.json()
    prefs = RetrievalPreferences(**body)
    save_user_retrieval_config(
        user_id=user["id"],
        default_mode=prefs.default_mode,
        default_top_k=prefs.default_top_k,
        min_vector_score=prefs.min_vector_score,
    )
    return {"status": "ok", "message": "检索偏好已保存"}