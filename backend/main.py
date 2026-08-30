"""
FitQA - 运动健身知识问答系统后端入口。

启动方式：
    uvicorn main:app --host 0.0.0.0 --port 8000
    或双击 start.bat
"""

import os
import uuid
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
# 使用 HuggingFace 国内镜像，解决模型下载超时问题
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time
from collections import defaultdict

from config import settings
from database import init_db
from data.knowledge_base import get_all_knowledge
from retrievers.bm25_retriever import BM25Retriever
from retrievers.vector_retriever import VectorRetriever
from retrievers.hybrid import HybridRetriever
from llm.client import LLMClient
from api.ask import router as ask_router
from api.knowledge import router as knowledge_router
from api.history import router as history_router
from api.config import router as config_router
from api.auth import router as auth_router
from api.sessions import router as sessions_router
from api.exercise import router as exercise_router
from api.training_plan import router as training_plan_router

logger = logging.getLogger("fitqa")

LOGS_DIR = Path(__file__).parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)


# ==================== 速率限制中间件 ====================
class RateLimitMiddleware:
    """基于 IP 的速率限制中间件。"""

    def __init__(self, app, default_limit: int = 100, window_seconds: int = 60):
        self.app = app
        self.default_limit = default_limit
        self.window = window_seconds
        self._requests: dict = defaultdict(list)
        # 特定路由的限制 (path_prefix, limit)
        self._route_limits = {
            "/auth/register": 5,
            "/auth/login": 10,
            "/ask": 30,
            "/ask/stream": 30,
        }

    def _get_client_ip(self, request: Request) -> str:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _get_limit(self, path: str) -> int:
        for prefix, limit in self._route_limits.items():
            if path.startswith(prefix):
                return limit
        return self.default_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        request = Request(scope, receive)
        client_ip = self._get_client_ip(request)
        path = request.url.path
        limit = self._get_limit(path)
        now = time.time()

        key = f"{client_ip}:{path}"
        self._requests[key] = [t for t in self._requests[key] if now - t < self.window]

        if len(self._requests[key]) >= limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试", "retry_after": self.window},
            )

        self._requests[key].append(now)
        return await self.app(scope, receive, send)


def setup_logging():
    """配置控制台 + 文件日志（backend/logs/fitqa.log）。"""
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    ch = logging.StreamHandler()
    ch.setFormatter(fmt)
    root.addHandler(ch)

    fh = RotatingFileHandler(
        LOGS_DIR / "fitqa.log",
        maxBytes=2 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)

    # 避免 httpx 每次请求都写日志
    logging.getLogger("httpx").setLevel(logging.WARNING)


setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时构建索引，关闭时清理资源。"""
    logger.info("=" * 50)
    logger.info("FitQA Backend Starting...")
    logger.info("=" * 50)

    # 0. 初始化加密密钥
    settings.get_or_create_encryption_key()
    logger.info("[Startup] Encryption key ready.")

    # 1. 初始化数据库
    init_db()
    logger.info("[Startup] Database initialized.")

    # 1.1 清理过期 Token
    try:
        from database import cleanup_expired_tokens
        deleted = cleanup_expired_tokens()
        if deleted:
            logger.info(f"[Startup] Cleaned up {deleted} expired tokens.")
    except Exception as e:
        logger.warning(f"[Startup] Token cleanup failed: {e}")

    # 1.5 应用数据库中的激活模型配置（覆盖 .env，保证重启后生效）
    try:
        from database import get_active_model
        active = get_active_model()
        if active:
            api_key = settings.decrypt_api_key(active["api_key_encrypted"])
            settings.update_llm_config(
                base_url=active["base_url"],
                api_key=api_key,
                model_name=active["model_name"],
            )
            settings.update_mode("real")
            logger.info(f"[Startup] Applied active model: {active['name']} ({active['model_name']})")
        else:
            logger.info("[Startup] No active model in DB, using .env config.")
    except Exception as e:
        logger.warning(f"[Startup] Failed to apply active model (key may be invalid): {e}")
        logger.info("[Startup] Falling back to .env config.")

    # 2. 构建 BM25 索引
    logger.info("[Startup] Building BM25 index...")
    bm25 = BM25Retriever()
    logger.info(f"[Startup] BM25 index ready ({len(bm25.texts)} documents).")

    # 3. 构建向量索引（失败自动降级）
    logger.info("[Startup] Building Vector (FAISS) index...")
    vector = VectorRetriever()

    # 4. 创建混合检索器
    hybrid = HybridRetriever(bm25, vector)
    app.state.hybrid_retriever = hybrid

    # 5. 创建 LLM 客户端
    llm = LLMClient()
    app.state.llm_client = llm

    knowledge_count = len(get_all_knowledge())
    logger.info(f"[Startup] Knowledge base: {knowledge_count} items")
    logger.info(f"[Startup] Mock mode: {settings.is_mock_mode}")
    logger.info(f"[Startup] Vector available: {hybrid.vector_available}")
    logger.info(f"[Startup] Rerank available: {hybrid.rerank_available}")
    logger.info("=" * 50)
    logger.info("FitQA Backend Ready!")
    logger.info("=" * 50)

    yield

    logger.info("[Shutdown] FitQA Backend shutting down.")


app = FastAPI(
    title="FitQA - 运动健身知识问答系统",
    description="基于 BM25 + 向量检索的健身知识智能问答 API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 跨域配置（必须最先添加，否则预检请求会失败）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 添加速率限制中间件
app.add_middleware(RateLimitMiddleware, default_limit=100, window_seconds=60)

# 注册路由
app.include_router(ask_router, tags=["问答"])
app.include_router(knowledge_router, tags=["知识库"])
app.include_router(history_router, tags=["历史"])
app.include_router(config_router, tags=["配置"])
app.include_router(auth_router, tags=["用户"])
app.include_router(sessions_router, tags=["会话"])
app.include_router(exercise_router, tags=["运动记录"])
app.include_router(training_plan_router, tags=["训练计划"])


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """为每个请求添加唯一 ID，便于追踪。"""
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health", tags=["系统"])
async def health():
    """健康检查。"""
    hybrid = app.state.hybrid_retriever
    active_model = None
    try:
        from database import get_active_model
        active = get_active_model()
        if active:
            active_model = {"name": active["name"], "model_name": active["model_name"]}
    except Exception:
        pass
    return {
        "status": "ok",
        "version": "1.0.0",
        "mock_mode": settings.is_mock_mode,
        "vector_available": hybrid.vector_available,
        "rerank_available": hybrid.rerank_available,
        "knowledge_count": len(get_all_knowledge()),
        "active_model": active_model,
    }


# 托管前端静态文件（供 ngrok 单隧道对外服务）
# 必须放在所有 API 路由之后，否则静态文件会拦截 API 请求
from fastapi.staticfiles import StaticFiles
_frontend_path = Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(_frontend_path), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
    )