"""混合检索器：BM25 + 向量检索 + RRF 融合。

HybridRetriever 在应用启动时创建并缓存为全局单例。
"""

from typing import List, Dict, Optional

from .bm25_retriever import BM25Retriever
from .vector_retriever import VectorRetriever


def rrf_fusion(
    bm25_results: List[Dict],
    vector_results: List[Dict],
    k: int = 60,
    top_k: int = 5
) -> List[Dict]:
    """
    RRF (Reciprocal Rank Fusion) 倒排融合算法。

    对两路检索结果按排名取倒数加权求和，重排后取 top_k。

    Args:
        bm25_results: BM25 检索结果（已按 score 降序）。
        vector_results: 向量检索结果（已按 score 降序）。
        k: RRF 平滑参数。
        top_k: 最终返回数量。

    Returns:
        融合后的结果列表，每个元素新增 rrf_score。
    """
    rrf_scores: Dict[str, Dict] = {}  # id -> {merged_item, rrf_score}

    # BM25 贡献
    for rank, item in enumerate(bm25_results):
        item_id = item["id"]
        rrf = 1.0 / (k + rank + 1)
        if item_id not in rrf_scores:
            rrf_scores[item_id] = dict(item)
            rrf_scores[item_id]["rrf_score"] = rrf
            rrf_scores[item_id]["bm25_score"] = item["score"]
            rrf_scores[item_id]["vector_score"] = None
        else:
            rrf_scores[item_id]["rrf_score"] += rrf
            rrf_scores[item_id]["bm25_score"] = item["score"]

    # 向量贡献
    for rank, item in enumerate(vector_results):
        item_id = item["id"]
        rrf = 1.0 / (k + rank + 1)
        if item_id not in rrf_scores:
            rrf_scores[item_id] = dict(item)
            rrf_scores[item_id]["rrf_score"] = rrf
            rrf_scores[item_id]["bm25_score"] = None
        else:
            rrf_scores[item_id]["rrf_score"] += rrf
            rrf_scores[item_id]["vector_score"] = item["score"]

    # 按 rrf_score 降序
    sorted_items = sorted(rrf_scores.values(), key=lambda x: x["rrf_score"], reverse=True)

    # 用 rrf_score 替换 score 字段
    results = []
    for item in sorted_items[:top_k]:
        results.append({
            "id": item["id"],
            "title": item["title"],
            "category": item["category"],
            "content": item["content"],
            "score": round(item["rrf_score"], 4),
            "snippet": item.get("snippet", item["content"][:200]),
            "url": item.get("url", ""),
        })

    return results


class HybridRetriever:
    """
    混合检索器。

    依 mode 参数分发到：
    - "bm25"：纯 BM25
    - "vector"：纯向量（不可用时报错）
    - "hybrid"：RRF 融合两路
    """

    def __init__(self, bm25: BM25Retriever, vector: VectorRetriever):
        self.bm25 = bm25
        self.vector = vector

    @property
    def vector_available(self) -> bool:
        return self.vector.available

    def search(self, query: str, mode: str = "hybrid", top_k: int = 5) -> tuple:
        """
        执行检索。

        Returns:
            (results, actual_mode): results 为 List[Dict], actual_mode 为实际使用的模式。
        """
        if mode == "bm25":
            return self.bm25.search(query, top_k), "bm25"

        if mode == "vector":
            if not self.vector.available:
                # 向量不可用，降级为 BM25
                return self.bm25.search(query, top_k), "bm25"
            return self.vector.search(query, top_k), "vector"

        # hybrid 模式
        bm25_results = self.bm25.search(query, top_k=top_k * 2)
        actual_mode = "hybrid"

        if self.vector.available:
            vector_results = self.vector.search(query, top_k=top_k * 2)
            if vector_results:
                return rrf_fusion(bm25_results, vector_results, top_k=top_k), "hybrid"
            else:
                actual_mode = "bm25"
        else:
            actual_mode = "bm25"

        return bm25_results[:top_k], actual_mode

    def rebuild_all(self):
        """重建所有索引。"""
        self.bm25.rebuild_index()
        if self.vector.available:
            self.vector.rebuild_index()
        print("[Hybrid] All indexes rebuilt")
