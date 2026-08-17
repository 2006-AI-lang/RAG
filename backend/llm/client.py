"""
LLM 客户端：通过 OpenAI 兼容接口调用大模型，支持 stream 和非 stream 两种模式。
Mock 模式下直接拼接检索片段作为回答。
"""

from typing import List, Dict, Optional, AsyncGenerator

import httpx

from config import settings


SYSTEM_PROMPT = (
    "你是专业的智能健身教练。只能根据给定的(系统资料)回答."
    "如果资料中没有提到相关信息，必须回答：根据当前知识库无法确定相关健身建议。"
    "不允许脱离资料凭空捏造。"
    "涉及运动损伤/疾病时必须在文末输出风险提示。"
)


def _build_user_prompt(question: str, sources: List[Dict]) -> str:
    """构建包含检索片段的用户提示词。"""
    fragments = []
    for i, src in enumerate(sources, 1):
        fragments.append(f"[{i}] {src['title']}\n{src['content']}")

    context = "\n\n".join(fragments)
    return (
        f"【系统资料】\n{context}\n\n"
        f"【用户问题】\n{question}\n\n"
        f"请给出简洁准确分点回答并标注参考资料编号。"
    )


def _build_mock_answer(question: str, sources: List[Dict]) -> str:
    """Mock 模式：直接拼接检索片段作为回答。"""
    if not sources:
        return "根据当前知识库无法确定相关健身建议。"

    parts = [f"【离线模式 - 基于检索片段回答】\n\n问题：{question}\n"]
    for i, src in enumerate(sources, 1):
        parts.append(f"参考资料[{i}]《{src['title']}》({src['category']})：\n{src['content']}\n")
    return "\n".join(parts)


class LLMClient:
    """OpenAI 兼容 LLM 客户端。"""

    def __init__(self):
        self.is_mock = settings.is_mock_mode
        if self.is_mock:
            print("[LLMClient] Running in MOCK mode - LLM calls will be bypassed.")
        else:
            print(f"[LLMClient] Using model: {settings.MODEL_NAME} via {settings.OPENAI_BASE_URL}")

    def refresh(self):
        """根据最新配置刷新客户端状态。"""
        self.is_mock = settings.is_mock_mode
        if self.is_mock:
            print("[LLMClient] Refreshed: MOCK mode")
        else:
            print(f"[LLMClient] Refreshed: model={settings.MODEL_NAME}, url={settings.OPENAI_BASE_URL}")

    @staticmethod
    async def test_connection(base_url: str, api_key: str, model_name: str) -> dict:
        """
        测试 LLM 连接。

        Returns:
            {"success": bool, "message": str, "latency_ms": float}
        """
        import time

        url = f"{base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model_name,
            "messages": [{"role": "user", "content": "Hello"}],
            "max_tokens": 5,
        }

        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                latency = (time.time() - start) * 1000

                if resp.status_code == 200:
                    return {
                        "success": True,
                        "message": f"连接成功，模型 {model_name} 可用",
                        "latency_ms": round(latency, 1),
                    }
                elif resp.status_code == 401:
                    return {
                        "success": False,
                        "message": "API Key 无效或已过期",
                        "latency_ms": round(latency, 1),
                    }
                elif resp.status_code == 404:
                    return {
                        "success": False,
                        "message": f"模型 {model_name} 不存在或无权访问",
                        "latency_ms": round(latency, 1),
                    }
                else:
                    return {
                        "success": False,
                        "message": f"请求失败: HTTP {resp.status_code}",
                        "latency_ms": round(latency, 1),
                    }
        except httpx.ConnectError:
            return {"success": False, "message": "无法连接到服务器，请检查 URL", "latency_ms": 0}
        except httpx.TimeoutException:
            return {"success": False, "message": "连接超时（15秒）", "latency_ms": 0}
        except Exception as e:
            return {"success": False, "message": f"测试失败: {str(e)}", "latency_ms": 0}

    async def ask(
        self,
        question: str,
        sources: List[Dict],
        stream: bool = False
    ) -> str:
        """
        调用 LLM 生成回答。

        Args:
            question: 用户原始问题。
            sources: 检索结果列表。
            stream: 是否流式输出（当前非 stream 统一处理）。
        """
        if self.is_mock:
            return _build_mock_answer(question, sources)

        if not sources:
            return "根据当前知识库无法确定相关健身建议。"

        user_prompt = _build_user_prompt(question, sources)
        url = f"{settings.OPENAI_BASE_URL}/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": settings.MODEL_NAME,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 1024,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
        except httpx.HTTPError as e:
            print(f"[LLMClient] HTTP error: {e}")
            # 降级为 mock 模式拼接
            return (
                f"[LLM调用失败，已降级展示检索结果]\n\n"
                f"{_build_mock_answer(question, sources)}"
            )
        except Exception as e:
            print(f"[LLMClient] Unexpected error: {e}")
            return (
                f"[LLM调用异常，已降级展示检索结果]\n\n"
                f"{_build_mock_answer(question, sources)}"
            )

    async def ask_stream(
        self,
        question: str,
        sources: List[Dict],
    ) -> AsyncGenerator[str, None]:
        """
        流式调用 LLM，逐块返回回答文本。

        Args:
            question: 用户原始问题。
            sources: 检索结果列表。

        Yields:
            str: 每次 yield 一段文本（可能是单个 token 或累积内容）。
        """
        if self.is_mock:
            answer = _build_mock_answer(question, sources)
            yield answer
            return

        if not sources:
            yield "根据当前知识库无法确定相关健身建议。"
            return

        user_prompt = _build_user_prompt(question, sources)
        url = f"{settings.OPENAI_BASE_URL}/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": settings.MODEL_NAME,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 1024,
            "stream": True,
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                break
                            import json
                            try:
                                chunk = json.loads(data_str)
                                delta = chunk["choices"][0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield content
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            print(f"[LLMClient] Stream error: {e}")
            yield (
                f"\n\n[LLM流式调用失败，已降级展示检索结果]\n\n"
                f"{_build_mock_answer(question, sources)}"
            )
