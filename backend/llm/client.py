"""
LLM 客户端：通过 OpenAI 兼容接口调用大模型，支持 stream 和非 stream 两种模式。
Mock 模式下直接拼接检索片段作为回答。
"""

from typing import List, Dict, Optional, AsyncGenerator

import httpx

from config import settings

import logging

logger = logging.getLogger("fitqa.llm")


def mask_api_key(api_key: str) -> str:
    """对任意 API Key 做脱敏。"""
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "****"
    return f"****{api_key[-4:]}"


def resolve_llm_config(user_id: Optional[int] = None) -> dict:
    """
    解析问答时应使用的 LLM 配置。

    - 登录用户且配置了个人模型（激活模型 + 模式）→ 使用个人配置
    - 否则回退到全局配置（settings / .env / 全局激活模型）
    """
    if user_id:
        try:
            from database import get_active_model, get_user_mode
            active = get_active_model(user_id)
            if active and active.get("api_key_encrypted"):
                api_key = settings.decrypt_api_key(active["api_key_encrypted"])
                if api_key:
                    mode = get_user_mode(user_id)
                    return {
                        "is_mock": mode != "real",
                        "base_url": (active["base_url"] or settings.OPENAI_BASE_URL).rstrip("/"),
                        "api_key": api_key,
                        "model_name": active["model_name"] or settings.MODEL_NAME,
                    }
        except Exception as e:
            logger.warning(f"[LLMConfig] Failed to resolve user config: {e}")

    return {
        "is_mock": settings.is_mock_mode,
        "base_url": settings.OPENAI_BASE_URL.rstrip("/"),
        "api_key": settings.OPENAI_API_KEY,
        "model_name": settings.MODEL_NAME,
    }


SYSTEM_PROMPT = (
    "你是专业的智能健身教练。只能根据给定的(系统资料)回答."
    "如果资料中没有提到相关信息，必须回答：根据当前知识库无法确定相关健身建议。"
    "不允许脱离资料凭空捏造。"
    "涉及运动损伤/疾病时必须在文末输出风险提示。"
    "直接输出最终答案，不要输出任何思考过程、推理说明或'我可以/我们来看'等分析语句。"
)


def _build_user_prompt(question: str, sources: List[Dict], history: List[Dict] = None, exercise_records: List[Dict] = None) -> str:
    """构建包含检索片段、历史对话和运动记录的用户提示词。"""
    fragments = []
    for i, src in enumerate(sources, 1):
        fragments.append(f"[{i}] {src['title']}\n{src['content']}")

    context = "\n\n".join(fragments)
    parts = [f"【系统资料】\n{context}\n\n"]

    if history:
        hist_lines = []
        for turn in history[-6:]:
            role = "用户" if turn.get("role") == "user" else "助手"
            hist_lines.append(f"{role}：{turn.get('content', '')}")
        parts.append(f"【历史对话】\n" + "\n".join(hist_lines) + "\n\n")

    if exercise_records:
        rec_lines = []
        for r in exercise_records:
            line = f"{r.get('record_date', '')} {r['exercise_type']} {r.get('duration', 0)}分钟 {r.get('intensity', '')}"
            if r.get("notes"):
                line += f"（{r['notes']}）"
            rec_lines.append(line)
        parts.append(f"【用户近期运动记录】\n" + "\n".join(rec_lines) + "\n\n")

    parts.append(
        f"【用户问题】\n{question}\n\n"
        f"请给出简洁准确分点回答并标注参考资料编号。"
    )
    return "".join(parts)


def _build_mock_answer(question: str, sources: List[Dict]) -> str:
    """Mock/降级模式：基于检索片段结构化整理，避免整篇原文堆砌。"""
    if not sources:
        return "根据当前知识库无法确定相关健身建议。"

    parts = [
        f"【离线模式 - 基于检索片段回答】\n\n问题：{question}\n",
        "根据知识库检索到的资料，整理摘要如下：",
        "",
    ]
    for i, src in enumerate(sources, 1):
        content = src.get("content", "")
        snippet = content[:150] + ("..." if len(content) > 150 else "")
        parts.append(f"**参考资料[{i}]《{src.get('title', '未命名')}》**（{src.get('category', '')}）")
        parts.append(f"> {snippet.replace(chr(10), ' ')}")
        parts.append("")
    parts.append("以上内容来自知识库检索片段，建议结合权威资料进一步核实。")
    return "\n".join(parts)


class LLMClient:
    """OpenAI 兼容 LLM 客户端。"""

    def __init__(self):
        self.is_mock = settings.is_mock_mode
        if self.is_mock:
            logger.info("[LLMClient] Running in MOCK mode - LLM calls will be bypassed.")
        else:
            logger.info(f"[LLMClient] Using model: {settings.MODEL_NAME} via {settings.OPENAI_BASE_URL}")

    def refresh(self):
        """根据最新配置刷新客户端状态。"""
        self.is_mock = settings.is_mock_mode
        if self.is_mock:
            logger.info("[LLMClient] Refreshed: MOCK mode")
        else:
            logger.info(f"[LLMClient] Refreshed: model={settings.MODEL_NAME}, url={settings.OPENAI_BASE_URL}")

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
        stream: bool = False,
        history: List[Dict] = None,
        config: dict = None,
        exercise_records: List[Dict] = None,
    ) -> str:
        """
        调用 LLM 生成回答。

        Args:
            question: 用户原始问题。
            sources: 检索结果列表。
            stream: 是否流式输出（当前非 stream 统一处理）。
            history: 最近对话历史（用于多轮上下文）。
            config: 每用户 LLM 配置（is_mock/base_url/api_key/model_name）；None 时用全局配置。
        """
        c = config or {
            "is_mock": self.is_mock,
            "base_url": settings.OPENAI_BASE_URL,
            "api_key": settings.OPENAI_API_KEY,
            "model_name": settings.MODEL_NAME,
        }

        if c["is_mock"]:
            return _build_mock_answer(question, sources)

        if not sources:
            return "根据当前知识库无法确定相关健身建议。"

        if not c.get("api_key"):
            return "根据当前知识库无法确定相关健身建议。"

        user_prompt = _build_user_prompt(question, sources, history, exercise_records)
        url = f"{c['base_url']}/chat/completions"
        headers = {
            "Authorization": f"Bearer {c['api_key']}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": c["model_name"],
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 2048,
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                message = data["choices"][0]["message"]
                content = (message.get("content") or "").strip()
                # 推理类模型可能把回答放在 reasoning_content，content 为空
                if not content and message.get("reasoning_content"):
                    content = (message.get("reasoning_content") or "").strip()
                if not content:
                    logger.warning("[LLMClient] Model returned empty content, retrying with direct-answer instruction.")
                    retry_payload = dict(payload)
                    retry_payload["messages"] = [
                        {"role": "system", "content": SYSTEM_PROMPT + " 立即给出最终答案正文，不要输出任何思考过程或推理说明。"},
                        {"role": "user", "content": user_prompt + "\n\n请立即直接输出答案正文，不要输出思考过程。"},
                    ]
                    resp = await client.post(url, json=retry_payload, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    content = (data["choices"][0]["message"].get("content") or "").strip()
                if not content:
                    logger.warning("[LLMClient] Model returned empty content (after retry), falling back to retrieval display.")
                    return (
                        f"[模型未返回内容，已展示检索结果]\n\n"
                        f"{_build_mock_answer(question, sources)}"
                    )
                return content
        except httpx.HTTPError as e:
            logger.warning(f"[LLMClient] HTTP error: {e}")
            # 降级为 mock 模式拼接
            return (
                f"[LLM调用失败，已降级展示检索结果]\n\n"
                f"{_build_mock_answer(question, sources)}"
            )
        except Exception as e:
            logger.error(f"[LLMClient] Unexpected error: {e}")
            return (
                f"[LLM调用异常，已降级展示检索结果]\n\n"
                f"{_build_mock_answer(question, sources)}"
            )

    async def ask_stream(
        self,
        question: str,
        sources: List[Dict],
        history: List[Dict] = None,
        config: dict = None,
        exercise_records: List[Dict] = None,
    ) -> AsyncGenerator[str, None]:
        """
        流式调用 LLM，逐块返回回答文本。

        Args:
            question: 用户原始问题。
            sources: 检索结果列表。
            history: 最近对话历史（用于多轮上下文）。
            config: 每用户 LLM 配置；None 时用全局配置。
        """
        c = config or {
            "is_mock": self.is_mock,
            "base_url": settings.OPENAI_BASE_URL,
            "api_key": settings.OPENAI_API_KEY,
            "model_name": settings.MODEL_NAME,
        }

        if c["is_mock"]:
            answer = _build_mock_answer(question, sources)
            yield answer
            return

        if not sources:
            yield "根据当前知识库无法确定相关健身建议。"
            return

        if not c.get("api_key"):
            yield "根据当前知识库无法确定相关健身建议。"
            return

        user_prompt = _build_user_prompt(question, sources, history, exercise_records)
        url = f"{c['base_url']}/chat/completions"
        headers = {
            "Authorization": f"Bearer {c['api_key']}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": c["model_name"],
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 4096,
            "stream": True,
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    resp.raise_for_status()
                    yielded_content = ""
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
                                    yielded_content += content
                                    yield content
                                # 推理模型：仅累积 content；reasoning_content 是思考过程，不作为回答展示
                            except json.JSONDecodeError:
                                continue
                    if not yielded_content.strip():
                        yield f"[模型未返回内容，已展示检索结果]\n\n{_build_mock_answer(question, sources)}"
        except Exception as e:
            logger.error(f"[LLMClient] Stream error: {e}")
            yield (
                f"\n\n[LLM流式调用失败，已降级展示检索结果]\n\n"
                f"{_build_mock_answer(question, sources)}"
            )
