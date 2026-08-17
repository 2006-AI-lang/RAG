# FitQA - 运动健身智能问答系统

基于 FastAPI + BM25 + FAISS 向量检索的智能健身知识问答全栈项目。

## 项目简介

FitQA 是一个中文健身知识问答系统，采用 RAG（检索增强生成）架构，支持 BM25 字面检索和 FAISS 向量语义检索的混合检索模式。

### 核心功能

- **智能问答**：基于知识库的健身问题回答
- **混合检索**：BM25 + 向量检索 + RRF 融合排序
- **多模型管理**：支持配置多个 LLM API，随时切换
- **知识库导入**：支持 PDF、Word、TXT 文档导入
- **检索对比**：BM25 与向量检索效果对比
- **问答历史**：记录和查看历史问答

### 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | FastAPI + Uvicorn |
| 数据库 | SQLite |
| 检索引擎 | jieba + rank-bm25 (BM25) / sentence-transformers + FAISS (向量) |
| LLM 接口 | OpenAI 兼容 API |
| 前端 | 原生 HTML/CSS/JavaScript |
| 文档解析 | PyPDF2、python-docx |

## 目录结构

```
FitQA/
├── backend/                    # 后端 FastAPI 应用
│   ├── main.py                 # 应用入口
│   ├── config.py               # 配置管理（pydantic-settings + 加密）
│   ├── database.py             # SQLite 数据库操作
│   ├── models.py               # Pydantic 数据模型
│   ├── requirements.txt        # Python 依赖
│   ├── .env                    # 环境配置（不提交 Git）
│   ├── .env.example            # 环境配置模板
│   ├── api/                    # API 路由
│   │   ├── ask.py              # 问答接口
│   │   ├── knowledge.py        # 知识库管理
│   │   ├── history.py          # 历史记录
│   │   └── config.py           # 配置管理
│   ├── data/                   # 静态知识库
│   │   └── knowledge_base.py   # 36 条健身知识
│   ├── llm/                    # LLM 客户端
│   │   └── client.py           # OpenAI 兼容接口
│   ├── parsers/                # 文档解析器
│   │   ├── __init__.py         # 统一入口
│   │   ├── pdf_parser.py       # PDF 解析
│   │   ├── docx_parser.py      # Word 解析
│   │   ├── txt_parser.py       # TXT 解析
│   │   └── splitter.py         # 知识拆分
│   ├── retrievers/             # 检索引擎
│   │   ├── bm25_retriever.py   # BM25 检索
│   │   ├── vector_retriever.py # 向量检索
│   │   └── hybrid.py           # 混合检索
│   └── uploads/                # 上传文件存储
└── frontend/                   # 前端静态页面
    ├── index.html              # 主页面
    ├── css/style.css           # 样式
    └── js/
        ├── app.js              # 主逻辑
        └── knowledge.js        # 知识库数据（离线模式）
```

## 快速开始

### 环境要求

- Python 3.10+
- pip

### 1. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 2. 配置环境变量

复制配置模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置 LLM API（可选）：

```env
# OpenAI 兼容 API 配置
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.deepseek.com/v1
MODEL_NAME=deepseek-chat

# LLM 模式：mock 或 real
LLM_MODE=mock
```

- 留空 `OPENAI_API_KEY` 或设置 `LLM_MODE=mock` 将自动进入离线模式
- `ENCRYPTION_KEY` 会自动生成，无需手动配置

### 3. 启动后端服务

```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

启动成功后：
- API 服务：http://localhost:8000
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/health

### 4. 启动前端

使用任意静态文件服务器：

```bash
# 方式一：Python 内置服务器
cd frontend
python -m http.server 8080

# 方式二：npx serve
npx serve frontend -p 8080
```

打开浏览器访问 http://localhost:8080

## API 接口

### 问答

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ask` | 问答接口，body: `{question, mode}` |

### 知识库

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/knowledge/list` | 获取所有知识条目 |
| GET | `/knowledge/categories` | 获取分类列表及计数 |
| POST | `/knowledge/import` | 导入文档到知识库 |
| GET | `/knowledge/entries` | 获取动态导入的知识条目 |
| DELETE | `/knowledge/entries/{entry_id}` | 删除单条动态知识 |
| POST | `/knowledge/rebuild-index` | 重建检索索引 |

### 配置管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/config` | 获取当前 LLM 配置 |
| PUT | `/config` | 更新 LLM 配置 |
| PUT | `/config/mode` | 切换 mock/real 模式 |
| POST | `/config/test` | 测试 LLM 连接 |
| GET | `/config/models` | 获取所有模型列表 |
| POST | `/config/models` | 添加新模型 |
| PUT | `/config/models/{id}/activate` | 切换激活模型 |
| DELETE | `/config/models/{id}` | 删除模型 |

### 历史记录

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/history` | 获取问答历史 |
| DELETE | `/history` | 清空历史 |

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |

## 知识库导入

### 支持格式

- PDF (.pdf)
- Word (.docx)
- TXT (.txt)

### 导入模式

**直接导入**
- 按标题拆分：识别 Markdown 标题、数字编号等
- 按段落拆分：按空行分段，合并短段落

**LLM 智能拆分**（需配置大模型 API）
- 自动拆分知识条目
- 自动分类和打标签

### 限制

- 单文件最大 10MB
- 重复文件自动跳过

## 检索模式

| 模式 | 说明 |
|------|------|
| `bm25` | 纯 BM25 字面检索（jieba 分词） |
| `vector` | 纯向量语义检索（sentence-transformers + FAISS） |
| `hybrid` | RRF 融合两路结果（推荐） |

## 配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | API Key（留空进入 mock 模式） | 空 |
| `OPENAI_BASE_URL` | API 地址 | `https://api.openai.com/v1` |
| `MODEL_NAME` | 模型名称 | `gpt-4o-mini` |
| `LLM_MODE` | `mock` 或 `real` | `mock` |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务端口 | `8000` |
| `DATABASE_URL` | SQLite 数据库路径 | `sqlite:///./fitqa.db` |
| `ENCRYPTION_KEY` | API Key 加密密钥（自动生成） | 自动生成 |

### Mock 模式

当满足以下任一条件时自动进入 Mock 模式：
- `LLM_MODE=mock`
- `OPENAI_API_KEY` 为空

Mock 模式下直接拼接检索结果作为回答，不调用 LLM API。

## 常见问题

### Q: 向量检索不可用

A: sentence-transformers 模型下载失败。解决方案：
- 检查网络连接
- 设置 `HF_ENDPOINT` 环境变量使用国内镜像
- 使用 BM25 或 hybrid 模式（会自动降级）

### Q: 前端请求报 CORS 错误

A: 后端已配置 `allow_origins=["*"]`，确认后端服务已启动。

### Q: 首次启动很慢

A: 首次运行需要下载 sentence-transformers 模型（约 100MB），后续启动会使用缓存。

## 许可证

仅供学习和研究使用。
