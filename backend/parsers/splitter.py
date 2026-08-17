"""知识条目拆分（直接导入模式）"""

import re
import json
from typing import List, Dict
from pathlib import Path


# 分类关键词映射表
CATEGORY_KEYWORDS = {
    "力量训练": ["深蹲", "硬拉", "卧推", "推举", "划船", "引体向上", "哑铃", "杠铃",
                "力量", "肌肉力量", "RM", "最大重复", "复合动作", "孤立动作"],
    "增肌": ["增肌", "肌肉增长", "肌肉体积", "蛋白质摄入", "肌肉合成", "增重",
            "肌肉量", "肌肥大"],
    "减脂": ["减脂", "减肥", "脂肪", "BMI", "体重", "热量", "卡路里", "减重",
            "体脂率", "减脂期"],
    "损伤预防": ["热身", "拉伸", "牵拉", "损伤", "受伤", "恢复", "放松", "泡沫轴",
               "运动损伤", "预防损伤", "安全"],
    "营养": ["营养", "膳食", "饮食", "碳水化合物", "脂肪摄入", "维生素", "矿物质",
            "膳食指南", "食物", "补充"],
    "有氧运动": ["跑步", "游泳", "骑车", "有氧", "心肺", "心率", "耐力", "慢跑",
               "快走", "有氧运动"],
    "核心训练": ["核心", "腹肌", "平板支撑", "卷腹", "腹横肌", "核心稳定",
               "核心力量"],
    "柔韧与恢复": ["柔韧", "拉伸", "瑜伽", "太极", "恢复", "放松", "柔韧性",
                 "活动幅度"],
}


def classify_by_keywords(text: str) -> str:
    """
    基于关键词自动分类

    Args:
        text: 待分类文本（标题+内容）

    Returns:
        分类名称，如果没有匹配返回 "未分类"
    """
    scores = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            scores[category] = score

    if scores:
        return max(scores, key=scores.get)
    return "未分类"


# 全局计数器，用于生成条目 ID
_entry_counter = 0
_counter_initialized = False


def _generate_entry_id() -> str:
    """生成条目 ID: DOC001, DOC002..."""
    global _entry_counter, _counter_initialized
    if not _counter_initialized:
        _init_counter_from_db()
    _entry_counter += 1
    return f"DOC{_entry_counter:03d}"


def _init_counter_from_db():
    """从数据库中获取当前最大 ID，初始化计数器"""
    global _entry_counter, _counter_initialized
    try:
        from database import get_connection
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT entry_id FROM knowledge_entries ORDER BY id DESC LIMIT 1")
        row = cursor.fetchone()
        conn.close()
        if row and row["entry_id"] and row["entry_id"].startswith("DOC"):
            _entry_counter = int(row["entry_id"][3:])
        else:
            _entry_counter = 0
    except Exception:
        _entry_counter = 0
    _counter_initialized = True


def reset_counter():
    """重置计数器（导入新文件时调用）"""
    global _counter_initialized
    _counter_initialized = False


def split_by_title(text: str, source: str, default_category: str = "未分类") -> List[Dict]:
    """
    按标题拆分文档

    识别规则:
    1. Markdown 标题: ## / ### / ####
    2. 数字编号: 1. / 一、/ 第一章 / 第1节
    3. 大写字母编号: A. / (A)
    """
    lines = text.split('\n')
    sections = []
    current_title = ""
    current_content = []

    title_patterns = [
        r'^#{1,4}\s+(.+)$',                    # Markdown 标题
        r'^第[一二三四五六七八九十\d]+[章节部篇]\s*[：:]*\s*(.+)$',  # 第X章
        r'^[一二三四五六七八九十]+[、.．]\s*(.+)$',  # 一、
        r'^\d+[、.．)\s]\s*(.+)$',               # 1. / 1、
        r'^[A-Z][、.．)\s]\s*(.+)$',              # A.
        r'^（[一二三四五六七八九十\d]+）\s*(.+)$',  # （一）
    ]

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped:
            if current_content:
                current_content.append("")
            continue

        is_title = False
        matched_title = ""
        for pattern in title_patterns:
            match = re.match(pattern, line_stripped)
            if match:
                is_title = True
                matched_title = match.group(1).strip() if match.group(1) else line_stripped
                break

        if is_title and matched_title:
            if current_title or current_content:
                content = '\n'.join(current_content).strip()
                if content and len(content) >= 20:
                    sections.append({
                        "title": current_title,
                        "content": content,
                    })
            current_title = matched_title
            current_content = []
        else:
            current_content.append(line_stripped)

    if current_title or current_content:
        content = '\n'.join(current_content).strip()
        if content and len(content) >= 20:
            sections.append({
                "title": current_title,
                "content": content,
            })

    if not sections:
        return split_by_paragraph(text, source)

    entries = []
    for section in sections:
        entry_id = _generate_entry_id()
        title = section["title"]
        if not title:
            title = section["content"][:30] + ("..." if len(section["content"]) > 30 else "")

        # 自动分类：优先使用关键词分类，否则使用默认分类
        combined_text = f"{title} {section['content']}"
        category = classify_by_keywords(combined_text)
        if category == "未分类":
            category = default_category

        entries.append({
            "entry_id": entry_id,
            "title": title,
            "content": section["content"],
            "category": category,
            "source": source,
            "tags": "[]",
            "import_mode": "direct",
        })

    return entries


def split_by_none(text: str, source: str, default_category: str = "未分类") -> List[Dict]:
    """
    不拆分，整篇文档作为一条知识条目

    Args:
        text: 文档全文
        source: 来源文件名
        default_category: 默认分类

    Returns:
        单条知识条目列表
    """
    text = text.strip()
    if not text:
        return []

    entry_id = _generate_entry_id()
    first_line = text.split('\n')[0].strip()
    title = first_line[:30] + ("..." if len(first_line) > 30 else "")
    if not title:
        title = text[:30] + ("..." if len(text) > 30 else "")

    # 自动分类：优先使用关键词分类，否则使用默认分类
    combined_text = f"{title} {text}"
    category = classify_by_keywords(combined_text)
    if category == "未分类":
        category = default_category

    return [{
        "entry_id": entry_id,
        "title": title,
        "content": text,
        "category": category,
        "source": source,
        "tags": "[]",
        "import_mode": "direct",
    }]


def split_by_paragraph(text: str, source: str, default_category: str = "未分类") -> List[Dict]:
    """
    按段落拆分文档

    策略:
    1. 按双换行符分段
    2. 合并过短段落 (< 50 字) 到相邻段落
    3. 每段首句作为标题（截取前 30 字）
    """
    paragraphs = re.split(r'\n\s*\n', text)
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    merged = []
    buffer = ""
    for para in paragraphs:
        if len(para) < 50:
            buffer += ("\n" + para) if buffer else para
        else:
            if buffer:
                if len(buffer) >= 50:
                    merged.append(buffer)
                else:
                    para = buffer + "\n" + para
                buffer = ""
            merged.append(para)
    if buffer and len(buffer) >= 20:
        merged.append(buffer)

    if not merged:
        if text.strip() and len(text.strip()) >= 20:
            merged = [text.strip()]

    entries = []
    for para in merged:
        entry_id = _generate_entry_id()
        first_line = para.split('\n')[0].strip()
        title = first_line[:30] + ("..." if len(first_line) > 30 else "")
        if not title:
            title = para[:30] + ("..." if len(para) > 30 else "")

        # 自动分类：优先使用关键词分类，否则使用默认分类
        combined_text = f"{title} {para}"
        category = classify_by_keywords(combined_text)
        if category == "未分类":
            category = default_category

        entries.append({
            "entry_id": entry_id,
            "title": title,
            "content": para,
            "category": category,
            "source": source,
            "tags": "[]",
            "import_mode": "direct",
        })

    return entries


def split_by_length(text: str, source: str, default_category: str = "未分类", chunk_size: int = 500) -> List[Dict]:
    """
    按固定长度拆分文档

    策略:
    1. 按 chunk_size 字符数切分（优先在句号/换行处断开）
    2. 每段首句作为标题（截取前 30 字）
    """
    if not text or not text.strip():
        return []

    chunks = _split_text_into_chunks(text, chunk_size)
    chunks = [c.strip() for c in chunks if c.strip()]

    entries = []
    for chunk in chunks:
        entry_id = _generate_entry_id()
        first_line = chunk.split('\n')[0].strip()
        title = first_line[:30] + ("..." if len(first_line) > 30 else "")
        if not title:
            title = chunk[:30] + ("..." if len(chunk) > 30 else "")

        # 自动分类：优先使用关键词分类，否则使用默认分类
        combined_text = f"{title} {chunk}"
        category = classify_by_keywords(combined_text)
        if category == "未分类":
            category = default_category

        entries.append({
            "entry_id": entry_id,
            "title": title,
            "content": chunk,
            "category": category,
            "source": source,
            "tags": "[]",
            "import_mode": "direct",
        })

    return entries


async def split_by_llm(text: str, source: str, llm_client, chunk_size: int = 1500) -> List[Dict]:
    """
    调用 LLM 智能拆分文档
    
    Args:
        text: 文档全文
        source: 来源文件名
        llm_client: LLMClient 实例
        chunk_size: 每块字数
    """
    chunks = _split_text_into_chunks(text, chunk_size)
    all_entries = []

    prompt_template = """请将以下文档内容拆分为独立的知识条目。

要求：
1. 每条知识独立完整，可用于问答检索
2. 返回 JSON 数组，每条包含: title, content, category, tags
3. category 从以下选择: 力量训练、增肌、减脂、损伤预防、营养、有氧运动、核心训练、柔韧与恢复
4. content 保持原文，100-500 字
5. tags 是字符串数组，包含 2-4 个关键词

文档内容:
{text}

请只返回 JSON 数组，不要其他内容:"""

    for i, chunk in enumerate(chunks):
        prompt = prompt_template.format(text=chunk)
        try:
            response = await llm_client.ask(
                question=prompt,
                sources=[],
            )
            entries = _parse_llm_response(response, source)
            all_entries.extend(entries)
        except Exception as e:
            print(f"[Splitter] LLM chunk {i+1} failed: {e}")
            fallback = split_by_paragraph(chunk, source)
            all_entries.extend(fallback)

    for entry in all_entries:
        entry["entry_id"] = _generate_entry_id()
        entry["import_mode"] = "llm"

    return all_entries


def _split_text_into_chunks(text: str, chunk_size: int) -> List[str]:
    """将文本分块，每块约 chunk_size 字"""
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    sentences = re.split(r'([。！？\n])', text)
    current_chunk = ""

    for i in range(0, len(sentences), 2):
        sentence = sentences[i]
        separator = sentences[i + 1] if i + 1 < len(sentences) else ""
        piece = sentence + separator

        if len(current_chunk) + len(piece) > chunk_size and current_chunk:
            chunks.append(current_chunk.strip())
            current_chunk = piece
        else:
            current_chunk += piece

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def _parse_llm_response(response: str, source: str) -> List[Dict]:
    """解析 LLM 返回的 JSON"""
    json_match = re.search(r'\[[\s\S]*\]', response)
    if not json_match:
        raise ValueError("LLM 返回中未找到 JSON 数组")

    try:
        items = json.loads(json_match.group())
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}")

    entries = []
    for item in items:
        if not isinstance(item, dict):
            continue
        title = item.get("title", "").strip()
        content = item.get("content", "").strip()
        if not title or not content:
            continue
        entries.append({
            "entry_id": "",
            "title": title,
            "content": content,
            "category": item.get("category", "未分类"),
            "source": source,
            "tags": json.dumps(item.get("tags", []), ensure_ascii=False),
            "import_mode": "llm",
        })

    return entries
