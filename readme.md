# FitQA - 运动健身智能问答系统 项目流程说明文档

## 一、项目概述

FitQA 是一个基于 RAG（检索增强生成）架构的中文运动健身知识问答系统。系统能够根据用户问题从知识库中检索相关资料，结合大语言模型生成专业、可追溯的健身知识回答。

**技术路线**：用户提问 → jieba 分词 → BM25 字面检索 + sentence-transformers 向量语义检索 → RRF 融合 → bge-reranker 交叉编码器重排序 → 大语言模型生成回答 → 展示答案与来源

---

## 二、环境准备

### 2.1 环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows / macOS / Linux |
| Python | 3.10 及以上 |
| 磁盘空间 | ≥ 1 GB |
| 网络 | 首次运行需联网下载模型（约 500 MB） |

### 2.2 安装依赖

```bash
cd backend
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

> 首次运行会自动下载 sentence-transformers 中文向量模型和 bge-reranker 重排序模型。若下载缓慢，设置环境变量：
> ```bash
> set HF_ENDPOINT=https://hf-mirror.com   # Windows
> export HF_ENDPOINT=https://hf-mirror.com  # Linux/Mac
> ```

### 2.3 配置环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `.env` 文件配置 LLM API：

```env
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-chat
LLM_MODE=mock
HOST=0.0.0.0
PORT=8000
```

> **离线模式**：当 `LLM_MODE=mock` 或 `OPENAI_API_KEY` 为空时，系统自动进入离线模式，无需 API Key 即可运行演示。

---

## 三、启动运行

### 3.1 启动后端

```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

启动成功后访问：
- 前端界面：`http://localhost:8000`
- API 文档：`http://localhost:8000/docs`
- 健康检查：`http://localhost:8000/health`

### 3.2 前端单独启动（离线演示）

```bash
cd frontend
python -m http.server 8080
```

---

## 四、系统功能

### 4.1 智能问答

在聊天界面输入健身问题，支持三种检索模式：
- **混合检索**：BM25 + 向量检索融合（推荐）
- **BM25**：基于关键词的字面检索
- **向量检索**：基于语义相似度的深度检索

支持多轮对话，会话历史持久化。

### 4.2 检索对比

切换到"检索对比"标签，输入问题可并排对比 BM25 与向量检索的效果差异，包括命中数、得分、检索片段等。

### 4.3 知识库管理

- 浏览/搜索/过滤知识条目
- 导入 PDF/Word/TXT 文档
- 新增/编辑/删除知识条目
- 重建检索索引
- 查看未答问题记录

### 4.4 训练计划

- 生成个性化训练计划
- 编辑/删除训练计划
- 批量操作和导出

### 4.5 运动记录

- 记录运动类型/时长/强度
- 问答时自动带入运动记录上下文
- 支持筛选和导出

### 4.6 用户登录

- 注册/登录/退出
- 各用户数据完全隔离
- 个人模型配置

---

## 五、用户数据隔离

系统实现了完整的用户数据隔离：

| 数据类型 | 隔离方式 |
|----------|----------|
| 问答历史 | `user_id` 绑定，匿名用户不保存 |
| 训练计划 | `user_id` 绑定 |
| 运动记录 | `user_id` 绑定 |
| 多轮会话 | `user_id` 绑定 |
| LLM 模型配置 | `user_id` 绑定 |
| 动态知识库 | `user_id` 绑定 |
| 静态知识库 | 全局共享（36条） |

---

## 六、技术架构

### 6.1 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + JavaScript |
| 后端 | Python 3.10+ / FastAPI |
| 数据库 | SQLite（14张表） |
| 检索 | BM25 + FAISS + bge-reranker |
| LLM | OpenAI 兼容 API |

### 6.2 RAG 检索流程

```
用户提问 → jieba分词 → BM25检索(Top-40) + 向量检索(Top-40)
    → RRF融合(Top-20) → bce-reranker重排(Top-5)
    → LLM生成回答 → 二次校验引用标记 → 展示回答+来源
```

---

## 七、API 接口

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ask` | 问答 |
| POST | `/ask/stream` | 流式问答 |
| GET | `/knowledge/list` | 获取知识列表 |
| GET | `/health` | 健康检查 |

### 需要登录的接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/register` | 注册 |
| POST | `/auth/login` | 登录 |
| GET | `/history` | 获取问答历史 |
| GET | `/training-plans` | 获取训练计划 |
| POST | `/training-plans` | 创建训练计划 |
| GET | `/exercise/records` | 获取运动记录 |
| POST | `/exercise/records` | 创建运动记录 |
| GET | `/knowledge/entries` | 获取动态知识条目 |
| POST | `/knowledge/import` | 导入文档 |

---

## 八、常见问题

### Q: 首次启动很慢？

设置国内镜像加速模型下载：
```bash
set HF_ENDPOINT=https://hf-mirror.com   # Windows
export HF_ENDPOINT=https://hf-mirror.com  # Linux/Mac
```

### Q: 向量检索不可用？

sentence-transformers 模型下载失败时，系统自动降级为纯 BM25 检索。检查网络后重建索引即可。

### Q: 回答显示"根据当前知识库无法确定"？

知识库中没有与问题相关的资料。建议换一种提问方式，或在"知识库"中补充相关知识条目。

---

## 九、项目结构

```
FitQA/
├── backend/
│   ├── main.py              # 后端入口
│   ├── config.py            # 环境配置
│   ├── database.py          # SQLite 数据库
│   ├── models.py            # Pydantic 数据模型
│   ├── api/                 # 路由（8个模块）
│   ├── data/                # 36条内置知识
│   ├── llm/                 # LLM 客户端
│   ├── retrievers/          # 检索器（BM25/向量/混合/重排）
│   └── parsers/             # 文档解析器
├── frontend/
│   ├── index.html           # 主页面
│   ├── css/                 # 样式
│   └── js/                  # 逻辑
└── readme.md                # 本文件
```

---

*仅供学习和研究使用。*
