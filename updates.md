# 更新日志

## 2026-08-05

### 1. 高级设置弹窗重构


**UI 改进：**
- 弹窗默认关闭，点击齿轮图标打开
- 模式切换按钮样式优化（激活状态为绿色背景）
- 表单元素间距和边框优化

---

### 2. 多模型管理功能

**新增功能：**
- 支持添加多个 LLM 模型配置
- 模型列表展示（名称、API 地址、模型名、脱敏 Key）
- 点击切换激活模型
- 删除已添加模型
- API Key 使用 Fernet 对称加密存储

**新增文件：**
- `backend/api/config.py` - 模型管理 API 端点

**修改文件：**
- `backend/config.py` - 新增加密/解密方法
- `backend/database.py` - 新增 `llm_models` 表
- `backend/models.py` - 新增模型管理相关 Pydantic 模型
- `backend/main.py` - 启动时初始化加密密钥
- `frontend/index.html` - 重写设置弹窗
- `frontend/js/app.js` - 新增模型管理逻辑
- `frontend/css/style.css` - 新增模型列表样式

**新增 API 端点：**
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/config/models` | 获取所有模型（脱敏） |
| POST | `/config/models` | 添加新模型 |
| PUT | `/config/models/{id}/activate` | 切换激活模型 |
| DELETE | `/config/models/{id}` | 删除模型 |

---

### 3. 知识库文档导入功能

**新增功能：**
- 支持上传 PDF、Word、TXT 文档导入知识库
- 两种导入模式：
  - **直接导入**：按标题/段落自动拆分
  - **LLM 智能拆分**：调用大模型分析整理（可选）
- 文件大小限制：10MB
- 重复导入自动跳过
- 导入后自动重建检索索引

**新增文件：**
- `backend/parsers/__init__.py` - 文档解析统一入口
- `backend/parsers/pdf_parser.py` - PDF 文本提取
- `backend/parsers/docx_parser.py` - Word 文本提取
- `backend/parsers/txt_parser.py` - TXT 文本提取
- `backend/parsers/splitter.py` - 知识拆分模块

**修改文件：**
- `backend/requirements.txt` - 新增 PyPDF2、python-docx、python-multipart
- `backend/database.py` - 新增 `knowledge_entries` 表
- `backend/data/knowledge_base.py` - 合并静态+动态知识条目
- `backend/retrievers/bm25_retriever.py` - 新增 `rebuild_index()`
- `backend/retrievers/vector_retriever.py` - 新增 `rebuild_index()`
- `backend/retrievers/hybrid.py` - 新增 `rebuild_all()`
- `backend/api/knowledge.py` - 新增导入/列表/删除/重建索引端点
- `frontend/index.html` - 新增导入按钮和弹窗
- `frontend/js/app.js` - 新增导入逻辑
- `frontend/css/style.css` - 新增导入相关样式

**新增 API 端点：**
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/knowledge/import` | 上传文件并导入知识库 |
| GET | `/knowledge/entries` | 获取动态导入的知识条目 |
| DELETE | `/knowledge/entries/{entry_id}` | 删除单条动态知识 |
| POST | `/knowledge/rebuild-index` | 手动重建检索索引 |

---

### 4. 其他修复

- 修复静态文件路径硬编码为 Windows 路径的问题（自动检测项目目录）
- 新增 `.env.example` 的 `ENCRYPTION_KEY` 配置项
- 更新 `AGENTS.md` 项目文档

---

## 2026-08-06

### 1. 文件导入知识自动分类功能

**问题描述：**
- 从文件导入知识后，所有条目的分类都是"未分类"，需要手动逐条修改

**解决方案：**
- 基于关键词的自动分类 + 用户指定默认分类（组合方案）
- 分类优先级：关键词匹配 > 用户指定默认分类 > "未分类"

**修改文件：**
- `backend/parsers/splitter.py` - 新增关键词分类函数，修改拆分函数
- `backend/api/knowledge.py` - 导入 API 新增 `default_category` 参数

**技术细节：**
- 新增 `CATEGORY_KEYWORDS` 关键词映射表，覆盖 8 个分类：力量训练、增肌、减脂、损伤预防、营养、有氧运动、核心训练、柔韧与恢复
- 新增 `classify_by_keywords()` 函数，根据内容关键词自动推断分类
- `split_by_title()` 和 `split_by_paragraph()` 函数新增 `default_category` 参数
- 当关键词匹配失败时，使用用户指定的默认分类

**API 变更：**
| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/knowledge/import` | 新增 `default_category` 参数（可选，默认"未分类"） |

**使用示例：**
```bash
# 指定默认分类
curl -X POST "http://localhost:8000/knowledge/import" \
  -F "file=@fitness.txt" \
  -F "default_category=力量训练"

# 使用自动分类（失败时为"未分类"）
curl -X POST "http://localhost:8000/knowledge/import" \
  -F "file=@nutrition.txt"
```

---

### 2. 知识库卡片操作按钮修复

**问题描述：**
- 知识库卡片的修改和删除按钮无法点击
- 鼠标移动到按钮上时没有交互动画，按钮无法按到

**原因分析：**
- 按钮使用 `position: absolute` 定位，可能超出了卡片边界
- 当鼠标从卡片移动到按钮时，会先离开卡片区域，导致 `:hover` 状态失效，按钮消失

**解决方案：**
- 给 `.knowledge-card` 添加 `overflow: visible` 确保按钮不被裁剪
- 给 `.knowledge-card-actions` 添加 `padding: 8px` 和 `margin: -8px`，扩大 hover 感应区域
- 调整按钮定位（top/right 从 12px 改为 8px）

**修改文件：**
- `frontend/css/style.css` - 修改 `.knowledge-card` 和 `.knowledge-card-actions` 样式

---

## 2026-08-30

### 1. 用户数据隔离

**新增功能：**
- 所有用户数据实现完全隔离，每位用户只能访问自己的数据

**隔离范围：**

| 数据类型 | 隔离方式 |
|----------|----------|
| 问答历史 | `user_id` 绑定，匿名用户不保存 |
| 训练计划 | `user_id` 绑定 |
| 运动记录 | `user_id` 绑定 |
| 多轮会话 | `user_id` 绑定 |
| LLM 模型配置 | `user_id` 绑定 |
| 动态知识库 | `user_id` 绑定，每用户独立 |
| 静态知识库 | 全局共享（36条） |

**修改文件：**
- `backend/database.py` - `qa_history`、`knowledge_entries` 表添加 `user_id` 列，所有相关函数增加 user_id 参数
- `backend/api/ask.py` - 保存历史时传入 user_id，匿名用户不保存
- `backend/api/history.py` - 查询/删除时绑定 user_id
- `backend/api/knowledge.py` - 导入/编辑/删除动态知识时绑定 user_id
- `backend/data/knowledge_base.py` - `get_all_knowledge()` 支持按 user_id 过滤动态条目

---

### 2. LLM 模型操作加固

**安全改进：**
- `delete_model()` 和 `update_model()` 的 SQL 语句添加 `AND user_id = ?` 条件
- 防止并发场景下的竞态条件

**修改文件：**
- `backend/database.py` - 修改 `delete_model()` 和 `update_model()` 函数

---

### 3. API 速率限制

**新增功能：**
- 自定义速率限制中间件，默认 100 次/分钟
- 注册接口限制 5 次/分钟
- 登录接口限制 10 次/分钟
- 问答接口限制 30 次/分钟

**修改文件：**
- `backend/main.py` - 新增 `RateLimitMiddleware` 类

---

### 4. 前端优化

**改进：**
- 运动记录卡片添加编辑/删除按钮
- 训练计划标题支持完整显示（移除 CSS line-clamp）
- 运动记录弹窗改为纯表单模式（不显示其他卡片）
- 问答历史批量操作时禁止点击卡片查看详情
- 导出按钮位置优化（向下展开避免超出屏幕）
- 运动类型筛选动态匹配用户实际记录

**修改文件：**
- `frontend/js/app.js` - 修改运动记录、训练计划、问答历史相关逻辑
- `frontend/css/style.css` - 新增运动记录卡片样式、调整导出下拉菜单位置

---

### 5. 文件清理

**删除文件：**
- `backend/fitqa_backup_20260817.db` - 旧数据库备份
- `backend/error.log` - 空日志文件
- `backend/uploads/test_fitness.txt` - 测试数据
- `backend/uploads/test_doc.txt` - 测试数据
- `backend/uploads/832+数据结构与模式识别+考试大纲.pdf` - 无关文件

**移除依赖：**
- `backend/requirements.txt` - 移除未使用的 `aiosqlite`

---

### 6. 文档更新

**修改文件：**
- `readme.md` - 更新项目结构、用户数据隔离说明、API 接口文档
- `AGENTS.md` - 更新项目概览、用户隔离说明、依赖列表
