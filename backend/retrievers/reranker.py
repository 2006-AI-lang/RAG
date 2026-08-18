"""重排序器：基于交叉编码器（CrossEncoder）对召回片段精排。

RAG 流程：召回（BM25/向量）→ 重排序 → 生成。
重排序模型加载失败时自动降级为不重排（直接取前 top_k）。
"""

from typing import List, Dict
import logging

logger = logging.getLogger("fitqa.rerank")

# 中英双语重排序模型（体积适中，中文效果好）；可替换为 BAAI/bge-reranker-base
RERANKER_MODEL = "maidalun1020/bce-reranker-base_v1"


class Reranker:
    """交叉编码器重排序器（惰性加载模型）。"""

    def __init__(self):
        self._model = None
        self.available = False

    def _load(self):
        if self._model is not None:
            return
        import os
        os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "30")
        os.environ.setdefault("REQUESTS_TIMEOUT", "30")
        try:
            from sentence_transformers import CrossEncoder
            logger.info(f"[Reranker] Loading cross-encoder model: {RERANKER_MODEL}")
            self._model = CrossEncoder(RERANKER_MODEL, device="cpu")
            self.available = True
            logger.info("[Reranker] Model loaded.")
        except Exception as e:
            logger.warning(f"[Reranker] Failed to load model: {e}")
            self._model = None
            self.available = False

    def rerank(self, query: str, candidates: List[Dict], top_k: int = 5) -> List[Dict]:
        """对候选片段精排后取 top_k；模型不可用时直接截断返回。"""
        if not candidates:
            return []
        self._load()
        if not self.available or self._model is None:
            return candidates[:top_k]

        pairs = [(query, c.get("content", "")[:512]) for c in candidates]
        try:
            scores = self._model.predict(pairs)
        except Exception as e:
            logger.warning(f"[Reranker] Predict error: {e}")
            return candidates[:top_k]

        scored = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)
        results = []
        for item, score in scored[:top_k]:
            r = dict(item)
            r["score"] = round(float(score), 4)
            results.append(r)
        return results
