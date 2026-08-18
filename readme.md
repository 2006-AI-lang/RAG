# FitQA — 运动健身智能问答系统 · 安装部署说明

## 一、项目概述

FitQA 是一个基于 RAG（检索增强生成）架构的中文运动健身知识问答系统。

**技术路线**：用户提问 → jieba 分词 → BM25 字面检索 + sentence-transformers 向量语义检索 → RRF 融合 → bge-reranker 交叉编码器重排序 → 大语言模型生成回答 → 展示答案与来源。

**主要功能**：智能问答（匿名可用）、训练计划生成、多轮对话、问答历史、运动记录分析、知识库管理（增删改/导入/重建索引）、多模型切换、二次校验（回答是否引用资料）、未答问题记录。

---

## 二、环境要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows / macOS / Linux |
| Python | 3.10 及以上 |
| pip | 随 Python 安装 |
| 磁盘空间 | ≥ 1 GB（模型文件 + 依赖） |
| 网络 | 首次运行需联网下载模型（约 100 MB），后续离线可用 |
| 浏览器 | Chrome / Firefox / Edge 最新版 |

---

## 三、安装步骤

### 3.1 获取源码

将项目文件夹放到任意目录，确保结构如下：

```
FitQA/
├── backend/
│   ├── main.py              # 后端入口
│   ├── config.py            # 环境配置（加载 .env）
│   ├── database.py          # SQLite 数据库（自动建表）
│   ├── models.py            # Pydantic 数据模型
│   ├── requirements.txt     # Python 依赖
│   ├── .env                 # 环境变量（不提交 Git）
│   ├── .env.example         # 环境变量模板
│   ├── api/                 # 路由
│   │   ├── ask.py           # 问答接口
│   │   ├── auth.py          # 用户认证
│   │   ├── knowledge.py     # 知识库管理
│   │   ├── history.py       # 问答历史
│   │   ├── sessions.py      # 多轮会话
│   │   ├── exercise.py      # 运动记录
│   │   └── config.py        # 配置管理
│   ├── data/
│   │   └── knowledge_base.py  # 36 条内置健身知识
│   ├── llm/
│   │   └── client.py        # OpenAI 兼容 LLM 客户端
│   ├── retrievers/
│   │   ├── bm25_retriever.py   # BM25 检索
│   │   ├── vector_retriever.py # 向量检索
│   │   ├── hybrid.py           # RRF 融合 + 重排序
│   │   └── reranker.py         # 交叉编码器重排序
│   ├── parsers/             # 文档解析
│   └── uploads/             # 上传文件存储
├── frontend/
│   ├── index.html           # 主页面
│   ├── favicon.svg          # 网站图标
│   ├── css/style.css        # 样式
│   └── js/
│       ├── app.js           # 主逻辑
│       └── knowledge.js     # 离线模式知识库数据
├── readme.md                # 本文件
└── .gitignore               # Git 忽略规则
```

### 3.2 安装依赖

```bash
cd backend
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

> 首次运行会自动下载 `sentence-transformers` 中文向量模型（约 100 MB），后续启动使用缓存。若下载缓慢，可在启动前设置环境变量：
> ```bash
> set HF_ENDPOINT=https://hf-mirror.com   # Windows
> export HF_ENDPOINT=https://hf-mirror.com  # Linux/Mac
> ```

### 3.3 配置环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `.env`：

```env
# ===== LLM 配置（可选） =====
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-chat
LLM_MODE=mock

# ===== 服务器 =====
HOST=0.0.0.0
PORT=8000

# ===== 数据库 =====
DATABASE_URL=sqlite:///./fitqa.db
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | LLM API Key，**留空**自动进入离线模式 | 空 |
| `OPENAI_BASE_URL` | LLM API 地址（OpenAI 兼容格式） | `https://api.openai.com/v1` |
| `MODEL_NAME` | 模型名称 | `gpt-4o-mini` |
| `LLM_MODE` | `mock`（离线拼接）或 `real`（调用 LLM） | `mock` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `PORT` | 监听端口 | `8000` |
| `DATABASE_URL` | SQLite 数据库路径 | `sqlite:///./fitqa.db` |
| `ENCRYPTION_KEY` | API Key 加密密钥（**自动生成，勿手动修改**） | 自动生成 |

> **离线模式**：当 `LLM_MODE=mock` 或 `OPENAI_API_KEY` 为空时，系统自动进入离线模式，直接拼接检索结果作为回答，不调用外部 API。

---

## 四、启动运行

### 4.1 启动后端（推荐方式）

```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

启动成功后访问：

| 地址 | 说明 |
|------|------|
| `http://localhost:8000` | 前端界面（后端已托管） |
| `http://localhost:8000/docs` | API 交互文档（Swagger UI） |
| `http://localhost:8000/health` | 健康检查 |

### 4.2 前端单独启动（离线演示模式）

如需在无后端环境下演示前端界面：

```bash
cd frontend
python -m http.server 8080
```

访问 `http://localhost:8080`，此时系统使用内置知识库数据进行离线问答（拼接检索结果，不调用 LLM）。

### 4.3 公网部署（答辩演示）

**方式一：局域网直接访问**

确保主机与演示设备在同一局域网：

```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

其他设备通过 `http://<主机IP>:8000` 访问。

**方式二：内网穿透（ngrok）**

```bash
# 安装 ngrok 后执行
ngrok http 8000
```

复制 ngrok 给出的公网地址（如 `https://xxxx.ngrok.io`），任何设备均可访问。

**方式三：云服务器**

将项目上传至云服务器，执行 `pip install -r requirements.txt` 后启动即可。建议配置 Nginx 反向代理。

---

## 五、系统使用

### 5.1 匿名使用

打开系统后**无需登录**即可使用核心功能：

- **智能问答**：在聊天界面输入健身问题，支持切换混合检索/BM25/向量检索模式。
- **检索对比**：切换到"检索对比"标签，输入问题查看 BM25 与向量检索的效果差异。
- **训练计划生成**：点击输入框下方"生成训练计划"，选择目标/水平/天数后自动提问（需登录）。

### 5.2 登录注册

点击右上角"登录" → 切换到"注册"标签 → 输入用户名（2~50 字符）+ 密码（≥6 位）→ 注册成功后自动登录。

登录后解锁以下功能：

| 功能 | 说明 |
|------|------|
| 多轮会话 | 左侧会话列表，关闭网页后保留，最近 6 轮上下文 |
| 问答历史 | 问答历史标签查看/删除 |
| 运动记录 | 记录运动类型/时长/强度，问答时自动带入 |
| 知识库管理 | 新增/编辑/删除/导入条目、重建索引、查看未答问题 |
| 个人模型配置 | 高级设置中添加/切换自己的 LLM 模型（各用户独立） |

### 5.3 知识库管理

1. 登录后切换到"知识库"标签。
2. 点击"新增知识"添加条目（支持内容分片）。
3. 点击"导入文档"上传 PDF / Word / TXT（支持自动分类）。
4. 每条知识包含：标题、分类、内容、来源、链接、标签。
5. 导入后点击"重建索引"更新检索模型。
6. 点击"未答问题"查看系统无法回答的问题记录，用于改进知识库。

### 5.4 个人模型配置

登录后点击右上角齿轮图标 → 高级设置：

1. 点击"添加新模型"，填入 API 地址、Key、模型名称。
2. 点击"测试连接"验证配置正确。
3. 点击"保存模型"保存，模型自动激活。
4. 切换"离线模式"或"大模型模式"。

> 各用户的模型列表相互独立。未配置个人模型的用户使用系统全局默认。

---

## 六、技术架构

### 6.1 系统架构

| 组件 | 技术 | 说明 |
|------|------|------|
| 前端 | HTML + CSS + JavaScript | 静态单页应用，无构建步骤 |
| 后端 | FastAPI + Uvicorn | 异步 Python Web 框架 |
| 数据库 | SQLite | 存储用户、知识库、会话、历史、运动记录 |
| 检索 | BM25 + FAISS + bge-reranker | 三阶段检索：召回 → 融合 → 重排序 |
| LLM | OpenAI 兼容 API | 支持 DeepSeek / OpenAI / 本地模型 |
| 认证 | PBKDF2 + Bearer Token | 无状态 Token，每次请求携带验证 |

### 6.2 RAG 检索流程

```
用户提问
  │
  ▼
① jieba 分词
  │
  ├─── BM25 字面检索（top-40）──────┐
  │                                  ├── RRF 融合（top-20）
  └─── FAISS 向量语义检索（top-40）──┘       │
                                     ▼
                            ② bge-reranker 重排序
                                   （top-5）
                                     │
                                     ▼
                         ③ LLM 生成回答（附知识来源）
                                     │
                                     ▼
                            ④ 二次校验（检查引用标记）
                                     │
                                     ▼
                              展示给用户
```

### 6.3 数据流

| 阶段 | 输入 | 处理 | 输出 |
|------|------|------|------|
| 检索 | 用户问题 | 分词 → BM25 + 向量 → 融合 → 重排 | Top-5 相关知识片段 |
| 生成 | 问题 + 知识片段 + 历史 + 运动记录 | 提示词拼接 → LLM 调用 | 自然语言回答 |
| 校验 | 回答 + 知识来源编号 | 正则检测 `[N]` 引用标记 | 正常 / 附加未引用提示 |

---

## 七、知识库说明

### 7.1 内置知识

系统预置 **36 条** 运动健身知识条目，来源包括：

- 国家体育总局《全民健身指南》
- Keep 官方动作库与指南
- 运动科学教材

每条知识包含：`id`、`domain`、`title`、`category`（分类）、`content`（正文）、`source`（来源）、`url`（链接）、`tags`（标签）、`chunk_id`。

### 7.2 用户导入知识

支持格式：PDF（.pdf）、Word（.docx）、TXT（.txt）。

导入方式：
- **直接导入**：按标题 / 段落 / 固定长度拆分，自动分类。
- **智能导入**（需配置 LLM）：由大模型自动拆分、分类、打标签。

每条导入的知识包含：标题、分类、正文、来源、链接、标签、来源文件名。系统自动去重。

---

## 八、配置管理

### 8.1 全局配置（匿名访问时使用）

通过 `.env` 文件或"高级设置"面板配置。

### 8.2 个人配置（登录用户）

登录后在"高级设置"中配置自己的 LLM API，**与全局配置隔离**。未配置个人模型时使用系统全局默认。

---

## 九、日志

后端日志写入 `backend/logs/fitqa.log`（自动滚动，最大 2 MB × 3 个备份）。

日志内容包括：启动信息、模型加载状态、检索耗时、LLM 调用结果、错误追踪。

查看实时日志：`tail -f backend/logs/fitqa.log`

---

## 十、常见问题

### Q: 首次启动很慢，怎么办？

**A：** 首次运行需下载 sentence-transformers 向量模型（约 100 MB）和 bge-reranker 重排序模型（约 400 MB）。设置国内镜像可显著加速：
```bash
set HF_ENDPOINT=https://hf-mirror.com   # Windows
export HF_ENDPOINT=https://hf-mirror.com  # Linux/Mac
```
设置后重启后端即可。后续启动使用缓存，无需再次下载。

---

### Q: 向量检索显示不可用？

**A：** sentence-transformers 模型下载失败时，系统自动降级为纯 BM25 检索，问答功能不受影响。`/health` 接口的 `vector_available` 会显示 `false`。如需恢复向量检索：检查网络 → 确认 `HF_ENDPOINT` 设置正确 → 重建索引。也可直接使用 `hybrid` 模式（会自动降级）。

---

### Q: 重排序模型加载失败？

**A：** bge-reranker 模型下载失败时，系统自动跳过重排序步骤，直接返回融合结果，问答功能不受影响。`/health` 接口的 `rerank_available` 会显示 `false`。检查网络后重启后端即可自动重试。

---

### Q: 回答显示"根据当前知识库无法确定"？

**A：** 以下情况会触发此提示：
1. 知识库中没有与问题相关的资料（BM25 无命中且向量相似度低于 0.30 阈值）。
2. LLM 判定无法基于检索到的资料回答。

**建议：** 换一种提问方式，或在"知识库"中补充相关知识条目后重建索引。

---

### Q: 回答显示"模型未返回内容"？

**A：** 部分推理类模型（如 deepseek-reasoner）将回答放在 `reasoning_content` 字段，`content` 为空。系统已自动处理：优先读取 `content`，为空则回退到 `reasoning_content`，仍为空则降级展示检索结果。若频繁出现，可在"高级设置"中更换模型。

---

### Q: 日志文件在哪里？

**A：** 日志路径：`backend/logs/fitqa.log`，自动滚动，保留最近 3 个备份（单文件最大 2 MB）。
- 实时查看：`tail -f backend/logs/fitqa.log`
- 日志内容：启动信息、模型加载状态、LLM 调用结果、错误追踪。

---

### Q: 登录后操作仍提示"请先登录"？

**A：** 后端重启后数据库重建，旧 Token 失效。请刷新页面（Ctrl+F5）→ 重新注册/登录 → 即可正常使用。

---

### Q: 如何切换不同的大语言模型？

**A：** 登录后点击右上角齿轮 → 高级设置 → 添加新模型（填入 API 地址、Key、模型名）→ 保存模型（自动激活）→ 切换到"大模型模式"。各用户的模型列表相互独立。

---

## 十一、项目提交内容

| 提交项 | 路径 |
|--------|------|
| 项目源代码 | `backend/` + `frontend/` |
| 运行说明 | 本文件（`readme.md`） |
| 知识库原始资料 | `backend/data/knowledge_base.py`（36 条内置知识） |
| 处理后知识库 | 运行时生成的 `backend/fitqa.db` |
| 项目总结报告 | 另行提交 |
| 项目展示 PPT | 另行提交 |

---

*仅供学习和研究使用。*
