"""稠密向量语义检索器（sentence-transformers + FAISS）。

模型加载失败时自动降级，设置 self.available = False。
"""

from typing import List, Dict, Tuple, Optional
import logging
import numpy as np

from data.knowledge_base import get_knowledge_texts
from config import settings

logger = logging.getLogger("fitqa.vector")


class VectorRetriever:
    """基于 sentence-transformers + FAISS 的语义检索器。"""

    def __init__(self):
        from data.knowledge_base import get_all_knowledge
        self.items = get_all_knowledge()
        self.texts = get_knowledge_texts()
        self.available = False
        self.model = None
        self.index = None

        self._init_model()

    def _init_model(self):
        """初始化模型和 FAISS 索引。失败时降级。"""
        try:
            import os
            # 减少 huggingface_hub 下载超时和重试次数
            os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "30")
            os.environ.setdefault("REQUESTS_TIMEOUT", "30")

            from sentence_transformers import SentenceTransformer
            import faiss

            logger.info("[VectorRetriever] Loading sentence-transformers model...")
            logger.info("[VectorRetriever] Model download may take a few minutes on first run...")
            # 使用轻量中文模型
            self.model = SentenceTransformer(
                "shibing624/text2vec-base-chinese",
                device="cpu"
            )
            logger.info("[VectorRetriever] Model loaded, building FAISS index...")

            embeddings = self.model.encode(
                self.texts,
                normalize_embeddings=True,
                show_progress_bar=True
            )

            dim = embeddings.shape[1]
            self.index = faiss.IndexFlatIP(dim)  # Inner Product (cosine with normalized)
            self.index.add(embeddings.astype(np.float32))

            self.available = True
            logger.info(f"[VectorRetriever] FAISS index ready with {self.index.ntotal} vectors")
        except Exception as e:
            logger.warning(f"[VectorRetriever] Failed to load model/FAISS: {e}")
            logger.warning("[VectorRetriever] Falling back to BM25-only mode.")
            self.available = False

    def rebuild_index(self):
        """重建向量索引（知识库更新后调用）。"""
        if not self.available or self.model is None:
            return
        from data.knowledge_base import get_all_knowledge, get_knowledge_texts
        import numpy as np
        self.items = get_all_knowledge()
        self.texts = get_knowledge_texts()
        embeddings = self.model.encode(
            self.texts,
            normalize_embeddings=True,
            show_progress_bar=False
        )
        self.index.reset()
        self.index.add(embeddings.astype(np.float32))
        logger.info(f"[Vector] Index rebuilt: {len(self.items)} vectors")

    def search(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        语义检索，返回 top_k 条结果。

        相似度低于 MIN_VECTOR_SCORE 的结果会被过滤（视为无相关内容）。

        Returns:
            [{"id", "title", "category", "content", "score", "snippet"}, ...]
        """
        if not self.available or self.model is None or self.index is None:
            return []

        if not query or not query.strip():
            return []

        query_vec = self.model.encode(
            [query],
            normalize_embeddings=True
        ).astype(np.float32)

        scores, indices = self.index.search(query_vec, top_k * 2)
        results = []

        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or idx >= len(self.items):
                continue
            if float(score) < settings.RETRIEVAL_MIN_VECTOR_SCORE:
                continue
            item = self.items[idx]
            content = item["content"]
            snippet = content[:200] + ("..." if len(content) > 200 else "")
            results.append({
                "id": item["id"],
                "title": item["title"],
                "category": item["category"],
                "content": item["content"],
                "score": round(float(score), 4),
                "snippet": snippet,
                "url": item.get("url", ""),
            })
            if len(results) >= top_k:
                break

        return results