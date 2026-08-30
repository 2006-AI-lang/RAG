"""用户认证 API 路由：注册 / 登录 / 登出 / 当前用户。

匿名用户仍可使用问答；登录后解锁历史、多轮会话与知识管理等功能。
"""

import hashlib
import secrets
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from models import RegisterRequest, LoginRequest, AuthResponse, UserInfo
from database import (
    create_user,
    get_user_by_username,
    create_auth_token,
    get_user_by_token,
    delete_auth_token,
)

router = APIRouter()

PBKDF2_ITERATIONS = 100_000


def _hash_password(password: str, salt: str = None) -> tuple:
    """返回 (salt, hash)，均以十六进制字符串存储。"""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()
    return salt, hashed


def _verify_password(password: str, salt: str, expected_hash: str) -> bool:
    _, hashed = _hash_password(password, salt)
    return hashed == expected_hash


def get_optional_user(request: Request) -> Optional[dict]:
    """从 Authorization: Bearer <token> 解析当前用户，未登录返回 None。"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return get_user_by_token(auth[7:])
    return None


def require_user(request: Request) -> dict:
    """需要登录的依赖，未登录抛 401。"""
    user = get_optional_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


def _validate_username(username: str) -> str:
    username = username.strip()
    if len(username) < 2 or len(username) > 50:
        raise HTTPException(status_code=400, detail="用户名长度需为 2~50 个字符")
    if not all(c.isalnum() or c in "_" for c in username):
        raise HTTPException(status_code=400, detail="用户名只能包含字母、数字、下划线")
    return username


@router.post("/auth/register", response_model=AuthResponse)
async def register(request: Request, body: RegisterRequest):
    """自助注册。"""
    username = _validate_username(body.username)
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码长度至少 6 位")

    salt, hashed = _hash_password(body.password)
    user_id = create_user(username, f"{salt}${hashed}")
    if user_id is None:
        raise HTTPException(status_code=400, detail="用户名已存在")

    token = create_auth_token(user_id)
    return AuthResponse(token=token, user_id=user_id, username=username)


@router.post("/auth/login", response_model=AuthResponse)
async def login(request: Request, body: LoginRequest):
    """登录。"""
    username = body.username.strip()
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=400, detail="用户名或密码错误")

    salt, hashed = (user["password_hash"].split("$", 1) if "$" in user["password_hash"] else (user["password_hash"], ""))
    if not _verify_password(body.password, salt, hashed):
        raise HTTPException(status_code=400, detail="用户名或密码错误")

    token = create_auth_token(user["id"])
    return AuthResponse(token=token, user_id=user["id"], username=user["username"])


@router.post("/auth/logout")
async def logout(request: Request):
    """退出登录（删除令牌）。"""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        delete_auth_token(auth[7:])
    return {"status": "ok", "message": "已退出登录"}


@router.get("/auth/me", response_model=UserInfo)
async def me(request: Request):
    """获取当前登录用户，未登录返回 401。"""
    user = get_optional_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    return UserInfo(id=user["id"], username=user["username"])
