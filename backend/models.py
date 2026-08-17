"""Pydantic 数据模型和 SQLite 表定义。"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ==================== API 请求/响应模型 ====================

class AskRequest(BaseModel):
    """问答请求。"""
    question: str = Field(..., description="用户问题")
    mode: str = Field(default="hybrid", description="检索模式: bm25 | vector | hybrid")


class SourceItem(BaseModel):
    """检索来源条目。"""
    id: str
    title: str
    score: float
    snippet: str
    category: str = ""
    url: str = ""


class AskResponse(BaseModel):
    """问答响应。"""
    answer: str
    sources: List[SourceItem]
    mode: str


class KnowledgeItem(BaseModel):
    """知识条目。"""
    id: str
    domain: str
    title: str
    category: str
    content: str
    source: str
    url: str = ""
    tags: List[str]
    chunk_id: str = ""
    created_at: str = ""


class CategoryInfo(BaseModel):
    """分类信息。"""
    category: str
    count: int


class HistoryRecord(BaseModel):
    """问答历史记录。"""
    id: int
    question: str
    answer: str
    mode: str
    created_at: str
    sources: Optional[str] = None


class HealthResponse(BaseModel):
    """健康检查响应。"""
    status: str
    version: str
    mock_mode: bool
    vector_available: bool
    knowledge_count: int


# ==================== 配置管理模型 ====================

class LLMConfigRequest(BaseModel):
    """LLM 配置更新请求。"""
    base_url: str = Field(..., description="API 基础 URL")
    api_key: str = Field(..., description="API Key")
    model_name: str = Field(..., description="模型名称")


class LLMModeRequest(BaseModel):
    """LLM 模式切换请求。"""
    mode: str = Field(..., description="模式: mock | real")


class LLMConfigResponse(BaseModel):
    """LLM 配置响应（脱敏）。"""
    base_url: str
    api_key_masked: str
    model_name: str
    mode: str
    is_mock: bool


class TestConnectionRequest(BaseModel):
    """测试连接请求。"""
    base_url: str
    api_key: str
    model_name: str


class TestConnectionResponse(BaseModel):
    """测试连接响应。"""
    success: bool
    message: str
    latency_ms: float = 0


# ==================== 多模型管理模型 ====================

class LLMModelItem(BaseModel):
    """单个模型信息（脱敏）。"""
    id: int
    name: str
    base_url: str
    api_key_masked: str
    model_name: str
    is_active: bool


class AddModelRequest(BaseModel):
    """添加模型请求。"""
    name: str = Field(..., min_length=1, max_length=50, description="模型自定义名称")
    base_url: str = Field(..., description="API 基础 URL")
    api_key: str = Field(..., min_length=1, description="API Key")
    model_name: str = Field(..., min_length=1, description="模型名称")


class ModelListResponse(BaseModel):
    """模型列表响应。"""
    models: List[LLMModelItem]
    active_model_id: Optional[int] = None


# ==================== 知识导入模型 ====================

class ImportResponse(BaseModel):
    """导入响应。"""
    success: bool
    message: str
    imported_count: int = 0
    total_entries: int = 0
    skipped: bool = False


class DynamicEntryItem(BaseModel):
    """动态知识条目。"""
    entry_id: str
    title: str
    category: str
    content: str
    source: str
    import_mode: str
    created_at: str


class CreateEntryRequest(BaseModel):
    """手动新增知识条目请求。"""
    title: str = Field(..., min_length=1, max_length=200, description="标题")
    category: str = Field(..., min_length=1, max_length=50, description="分类（必填）")
    content: str = Field(..., min_length=1, description="内容")
    source: str = Field(..., min_length=1, max_length=200, description="来源（必填）")
    url: str = Field(default="", description="来源链接")
    tags: List[str] = Field(default=[], description="标签列表")
    split_enabled: bool = Field(default=False, description="是否分片")
    split_method: str = Field(default="title", description="分片方式: title | paragraph")


class UpdateEntryRequest(BaseModel):
    """编辑知识条目请求。"""
    title: str = Field(..., min_length=1, max_length=200, description="标题")
    category: str = Field(..., min_length=1, max_length=50, description="分类（必填）")
    content: str = Field(..., min_length=1, description="内容")
    source: str = Field(..., min_length=1, max_length=200, description="来源（必填）")
    url: str = Field(default="", description="来源链接")
    tags: List[str] = Field(default=[], description="标签列表")
