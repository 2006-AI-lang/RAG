"""配置管理 API 路由。"""

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
from llm.client import LLMClient
from database import get_all_models, add_model, set_active_model, delete_model, get_active_model, update_model, get_model_by_id

router = APIRouter()


@router.get("/config", response_model=LLMConfigResponse)
async def get_config():
    """获取当前 LLM 配置（API Key 脱敏）。"""
    return LLMConfigResponse(
        base_url=settings.OPENAI_BASE_URL,
        api_key_masked=settings.get_masked_api_key(),
        model_name=settings.MODEL_NAME,
        mode=settings.LLM_MODE,
        is_mock=settings.is_mock_mode,
    )


@router.put("/config")
async def update_config(body: LLMConfigRequest, request: Request):
    """更新 LLM 配置。"""
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL 必须以 http:// 或 https:// 开头")

    if len(body.api_key) < 8:
        raise HTTPException(status_code=400, detail="API Key 长度不足")

    if not body.model_name.strip():
        raise HTTPException(status_code=400, detail="模型名称不能为空")

    api_key = body.api_key.strip()

    settings.update_llm_config(
        base_url=body.base_url.rstrip("/"),
        api_key=api_key,
        model_name=body.model_name.strip(),
    )

    # 持久化到激活模型记录，保证重启后不丢失
    active = get_active_model()
    if active:
        try:
            update_model(
                model_id=active["id"],
                name=active["name"],
                base_url=body.base_url.rstrip("/"),
                api_key_encrypted=settings.encrypt_api_key(api_key),
                model_name=body.model_name.strip(),
            )
        except Exception as e:
            print(f"[Config] Failed to persist config to active model: {e}")

    llm: LLMClient = request.app.state.llm_client
    llm.refresh()

    return {"status": "ok", "message": "配置已更新"}


@router.put("/config/mode")
async def update_mode(body: LLMModeRequest, request: Request):
    """切换 LLM 模式（mock/real）。"""
    if body.mode not in ("mock", "real"):
        raise HTTPException(status_code=400, detail="模式必须是 mock 或 real")

    if body.mode == "real":
        # 切换到真实模式时，必须应用激活模型的配置
        active = get_active_model()
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


# ==================== 多模型管理 ====================

@router.get("/config/models", response_model=ModelListResponse)
async def list_models():
    """获取所有已保存的模型列表。"""
    models = get_all_models()
    active = get_active_model()
    return ModelListResponse(
        models=[LLMModelItem(**m) for m in models],
        active_model_id=active["id"] if active else None,
    )


@router.post("/config/models")
async def create_model(body: AddModelRequest, request: Request):
    """添加新模型。"""
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL 必须以 http:// 或 https:// 开头")

    encrypted_key = settings.encrypt_api_key(body.api_key.strip())

    try:
        model_id = add_model(
            name=body.name.strip(),
            base_url=body.base_url.rstrip("/"),
            api_key_encrypted=encrypted_key,
            model_name=body.model_name.strip(),
        )
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="模型名称已存在")
        raise HTTPException(status_code=500, detail=f"保存失败: {e}")

    active = get_active_model()
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
    success = set_active_model(model_id)
    if not success:
        raise HTTPException(status_code=404, detail="模型不存在")

    active = get_active_model()
    if active:
        settings.update_llm_config(
            base_url=active["base_url"],
            api_key=settings.decrypt_api_key(active["api_key_encrypted"]),
            model_name=active["model_name"],
        )
        settings.update_mode("real")
        llm: LLMClient = request.app.state.llm_client
        llm.refresh()

    return {"status": "ok", "message": f"已切换到模型 {active['name']}"}


@router.put("/config/models/{model_id}")
async def edit_model(model_id: int, body: AddModelRequest, request: Request):
    """编辑模型（含重新保存 API Key）。"""
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL 必须以 http:// 或 https:// 开头")

    if body.api_key.strip():
        encrypted_key = settings.encrypt_api_key(body.api_key.strip())
    else:
        existing = get_model_by_id(model_id)
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
        )
    except Exception as e:
        if "UNIQUE" in str(e):
            raise HTTPException(status_code=400, detail="模型名称已存在")
        raise HTTPException(status_code=500, detail=f"保存失败: {e}")

    if not success:
        raise HTTPException(status_code=404, detail="模型不存在")

    active = get_active_model()
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
    success = delete_model(model_id)
    if not success:
        raise HTTPException(status_code=404, detail="模型不存在")

    active = get_active_model()
    if active:
        settings.update_llm_config(
            base_url=active["base_url"],
            api_key=settings.decrypt_api_key(active["api_key_encrypted"]),
            model_name=active["model_name"],
        )
        llm: LLMClient = request.app.state.llm_client
        llm.refresh()
    else:
        # 删除的是激活模型：若仍有剩余模型，自动激活第一个
        remaining = get_all_models()
        if remaining:
            set_active_model(remaining[0]["id"])
            new_active = get_active_model()
            if new_active:
                settings.update_llm_config(
                    base_url=new_active["base_url"],
                    api_key=settings.decrypt_api_key(new_active["api_key_encrypted"]),
                    model_name=new_active["model_name"],
                )
                settings.update_mode("real")
                llm: LLMClient = request.app.state.llm_client
                llm.refresh()
                return {"status": "ok", "message": "模型已删除，已自动切换到剩余模型"}
        settings.update_mode("mock")
        llm: LLMClient = request.app.state.llm_client
        llm.refresh()

    return {"status": "ok", "message": "模型已删除"}
