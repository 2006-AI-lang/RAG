"""问答 API 路由：POST /ask。"""

from fastapi import APIRouter, HTTPException, Request

from models import AskRequest, AskResponse, SourceItem
from llm.client import LLMClient

router = APIRouter()


def get_retriever(request: Request):
    """从 app.state 获取混合检索器。"""
    return request.app.state.hybrid_retriever


def get_llm_client(request: Request) -> LLMClient:
    """从 app.state 获取 LLM 客户端。"""
    return request.app.state.llm_client


@router.post("/ask", response_model=AskResponse)
async def ask(request: Request, body: AskRequest):
    """
    健身知识问答接口。

    - question: 用户问题
    - mode: 检索模式（bm25 / vector / hybrid）
    """
    retriever = get_retriever(request)
    llm = get_llm_client(request)

    # 1. 检索
    results, actual_mode = retriever.search(
        query=body.question,
        mode=body.mode or "hybrid",
        top_k=5
    )

    # 2. 调用 LLM 生成回答
    answer = await llm.ask(
        question=body.question,
        sources=results,
    )

    # 3. 构造来源列表
    sources = [
        SourceItem(
            id=src["id"],
            title=src["title"],
            score=src["score"],
            snippet=src["snippet"],
            category=src.get("category", ""),
            url=src.get("url", ""),
        )
        for src in results
    ]

    # 4. 保存历史
    import json
    from database import save_history
    try:
        save_history(
            question=body.question,
            answer=answer,
            mode=actual_mode,
            sources=json.dumps([s.model_dump() for s in sources], ensure_ascii=False)
        )
    except Exception as e:
        print(f"[ask] Failed to save history: {e}")

    return AskResponse(
        answer=answer,
        sources=sources,
        mode=actual_mode,
    )
