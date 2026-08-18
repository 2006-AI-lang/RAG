"""Pydantic 数据模型和 SQLite 表定义。"""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ==================== API 请求/响应模型 ====================

class ChatTurn(BaseModel):
    """多轮对话中的一轮（历史消息）。"""
    role: str = Field(..., description="user 或 assistant")
    content: str


class AskRequest(BaseModel):
    """问答请求。"""
    question: str = Field(..., min_length=1, max_length=500, description="用户问题")
    mode: str = Field(default="hybrid", description="检索模式: bm25 | vector | hybrid")
    top_k: Optional[int] = Field(default=None, ge=1, le=50, description="检索返回条数（默认 5；检索对比模式传 20 以对齐正常问答 hybrid 的 BM25 召回量）")
    session_id: Optional[int] = Field(default=None, description="多轮会话 ID（登录用户）")
    history: List[ChatTurn] = Field(default=[], description="最近对话历史（用于多轮上下文）")


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
    mode: str = Field(default="mock", description="模式: mock | real（每用户配置时生效）")


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
    is_personal: bool = False


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
    api_key: str = Field(default="", description="API Key（编辑时留空表示保持不变）")
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


# ==================== 用户认证 ====================

class RegisterRequest(BaseModel):
    """注册请求。"""
    username: str = Field(..., min_length=2, max_length=50, description="用户名")
    password: str = Field(..., min_length=6, max_length=128, description="密码")


class LoginRequest(BaseModel):
    """登录请求。"""
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")


class AuthResponse(BaseModel):
    """登录/注册响应。"""
    token: str
    user_id: int
    username: str


class UserInfo(BaseModel):
    """用户信息。"""
    id: int
    username: str


# ==================== 多轮会话 ====================

class ChatSessionItem(BaseModel):
    """会话摘要。"""
    id: int
    title: str
    created_at: str = ""
    updated_at: str = ""
    message_count: int = 0


class ChatMessageItem(BaseModel):
    """会话消息。"""
    id: int
    role: str
    content: str
    sources: List = []
    created_at: str = ""


class CreateSessionRequest(BaseModel):
    """创建会话请求。"""
    title: str = Field(default="新对话", max_length=100)


class UnansweredItem(BaseModel):
    """无法回答问题记录。"""
    id: int
    question: str
    mode: str = ""
    reason: str = ""
    created_at: str = ""


# ==================== 运动记录 ====================

class ExerciseRecordItem(BaseModel):
    """运动记录条目。"""
    id: int
    exercise_type: str
    duration: int = 0
    intensity: str = "中等"
    notes: str = ""
    record_date: str = ""
    created_at: str = ""


class CreateExerciseRequest(BaseModel):
    """添加运动记录请求。"""
    exercise_type: str = Field(..., min_length=1, max_length=50, description="运动类型")
    duration: int = Field(default=0, ge=0, description="时长（分钟）")
    intensity: str = Field(default="中等", description="强度：高强度/中等/低强度")
    notes: str = Field(default="", max_length=200, description="备注")
    record_date: str = Field(default="", description="日期 YYYY-MM-DD")
