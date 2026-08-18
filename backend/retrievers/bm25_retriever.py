"""BM25 字面检索器（jieba 分词 + rank-bm25）。"""

from typing import List, Dict
import pickle
import logging
from pathlib import Path

import jieba
from rank_bm25 import BM25Okapi

from data.knowledge_base import get_knowledge_texts

logger = logging.getLogger("fitqa.bm25")


class BM25Retriever:
    """基于 jieba 分词的 BM25 字面检索器。"""

    def __init__(self):
        from data.knowledge_base import get_all_knowledge
        self.items = get_all_knowledge()
        self.texts = get_knowledge_texts()
        tokenized = [list(jieba.cut(text)) for text in self.texts]
        self.bm25 = BM25Okapi(tokenized)

    def rebuild_index(self):
        """重建 BM25 索引（知识库更新后调用）。"""
        from data.knowledge_base import get_all_knowledge, get_knowledge_texts
        self.items = get_all_knowledge()
        self.texts = get_knowledge_texts()
        tokenized = [list(jieba.cut(text)) for text in self.texts]
        self.bm25 = BM25Okapi(tokenized)
        logger.info(f"[BM25] Index rebuilt: {len(self.items)} documents")

    def search(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        检索与 query 最相关的 top_k 条知识。

        Returns:
            [{"id", "title", "category", "content", "score", "snippet"}, ...]
        """
        tokenized_query = list(jieba.cut(query))
        scores = self.bm25.get_scores(tokenized_query)

        # 按分数降序取 top_k
        indexed_scores = list(enumerate(scores))
        indexed_scores.sort(key=lambda x: x[1], reverse=True)
        top_indices = indexed_scores[:top_k]

        results = []
        for idx, score in top_indices:
            if score <= 0:
                continue
            item = self.items[idx]
            content = item["content"]
            snippet = content[:200] + ("..." if len(content) > 200 else "")
            results.append({
                "id": item["id"],
                "title": item["title"],
                "category": item["category"],
                "content": item["content"],
                "score": round(float(score), 2),
                "snippet": snippet,
                "url": item.get("url", ""),
            })

        return results
