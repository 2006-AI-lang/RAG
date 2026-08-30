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
    scene: str = Field(default="auto", description="场景: auto | general | muscle_gain | fat_loss | injury | nutrition 或 cat:分类名")
    skip_cache: bool = Field(default=False, description="是否跳过缓存，用于重新回答")


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
    cached: bool = False


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


class UpdateExerciseRequest(BaseModel):
    """更新运动记录请求。"""
    exercise_type: str = Field(default="", max_length=50, description="运动类型")
    duration: int = Field(default=0, ge=0, description="时长（分钟）")
    intensity: str = Field(default="", description="强度：高强度/中等/低强度")
    notes: str = Field(default="", max_length=200, description="备注")
    record_date: str = Field(default="", description="日期 YYYY-MM-DD")


class BatchDeleteRequest(BaseModel):
    """批量删除请求。"""
    ids: List[int] = Field(..., min_length=1, description="要删除的 ID 列表")


# ==================== 训练计划 ====================

class TrainingPlanItem(BaseModel):
    """训练计划条目。"""
    id: int
    title: str
    goal: str
    level: str
    days_per_week: int = 4
    content: str
    category: str
    created_at: str
    updated_at: str


class CreateTrainingPlanRequest(BaseModel):
    """创建训练计划请求。"""
    title: str = Field(default="", max_length=200, description="计划标题")
    goal: str = Field(default="", max_length=100, description="训练目标")
    level: str = Field(default="新手", max_length=50, description="经验水平")
    days_per_week: int = Field(default=4, ge=1, le=7, description="每周训练天数")
    content: str = Field(..., description="计划内容")
    category: str = Field(default="", max_length=50, description="分类标签")


class UpdateTrainingPlanRequest(BaseModel):
    """更新训练计划请求。"""
    title: str = Field(default="", max_length=200, description="计划标题")
    goal: str = Field(default="", max_length=100, description="训练目标")
    level: str = Field(default="新手", max_length=50, description="经验水平")
    days_per_week: int = Field(default=4, ge=1, le=7, description="每周训练天数")
    content: str = Field(..., description="计划内容")
    category: str = Field(default="", max_length=50, description="分类标签")


class BatchDeleteTrainingPlanRequest(BaseModel):
    """批量删除训练计划请求。"""
    ids: List[int] = Field(..., min_length=1, description="要删除的计划 ID 列表")


class BatchUpdateTrainingPlanRequest(BaseModel):
    """批量更新训练计划请求。"""
    ids: List[int] = Field(..., min_length=1, description="要更新的计划 ID 列表")
    goal: str = Field(default="", max_length=100, description="训练目标")
    level: str = Field(default="", max_length=50, description="经验水平")
    days_per_week: int = Field(default=0, ge=0, le=7, description="每周训练天数（0=不修改）")
    category: str = Field(default="", max_length=50, description="分类标签")


# ==================== 检索偏好 ====================

class RetrievalPreferences(BaseModel):
    """用户检索偏好。"""
    default_mode: str = Field(default="hybrid", description="默认检索模式")
    default_top_k: int = Field(default=5, ge=1, le=50, description="默认返回条数")
    min_vector_score: float = Field(default=0.30, ge=0.0, le=1.0, description="向量相似度阈值")


class RetrievalPreferencesResponse(BaseModel):
    """检索偏好响应。"""
    default_mode: str
    default_top_k: int
    min_vector_score: float


# ==================== 场景选择 ====================

class SceneInfo(BaseModel):
    """场景信息。"""
    key: str
    label: str
    icon: str
    description: str


# ==================== 分类管理 ====================

class CategoryKeywordsItem(BaseModel):
    """分类关键词条目。"""
    category: str
    keywords: List[str]


class CategoryKeywordsUpdate(BaseModel):
    """分类关键词更新请求。"""
    categories: List[CategoryKeywordsItem]


# ==================== 知识版本管理 ====================

class KnowledgeVersionItem(BaseModel):
    """知识版本。"""
    id: int
    entry_id: str
    version: int
    title: str
    category: str
    content: str
    source: str = ""
    url: str = ""
    created_at: str = ""


# ==================== 知识导出 ====================

class ExportRequest(BaseModel):
    """导出请求。"""
    format: str = Field(default="json", description="导出格式: json | csv | markdown")


# ==================== 导入预览 ====================

class ImportPreviewItem(BaseModel):
    """导入预览条目。"""
    title: str
    category: str
    content_preview: str
    content_full: str


class ImportPreviewResponse(BaseModel):
    """导入预览响应。"""
    filename: str
    entries: List[ImportPreviewItem]
    total_count: int


# ==================== 流式响应 ====================

class AskStreamRequest(BaseModel):
    """流式问答请求。"""
    question: str = Field(..., min_length=1, max_length=500)
    mode: str = Field(default="hybrid")
    top_k: Optional[int] = Field(default=None, ge=1, le=50)
    session_id: Optional[int] = Field(default=None)
    history: List[ChatTurn] = Field(default=[])
    scene: str = Field(default="auto", description="场景: auto | general | muscle_gain | fat_loss | injury | nutrition")
    skip_cache: bool = Field(default=False, description="是否跳过缓存")