"""SQLite 数据库初始化与管理。"""

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional
from config import settings


DB_PATH = Path(settings.DATABASE_URL.replace("sqlite:///", ""))
if not DB_PATH.is_absolute():
    DB_PATH = Path(__file__).parent / DB_PATH


def get_connection() -> sqlite3.Connection:
    """获取 SQLite 连接。"""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """初始化数据库表。"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS qa_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'hybrid',
            sources TEXT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS llm_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            base_url TEXT NOT NULL,
            api_key_encrypted TEXT NOT NULL,
            model_name TEXT NOT NULL,
            is_active INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS knowledge_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '未分类',
            content TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT '',
            url TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            import_mode TEXT DEFAULT 'direct',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    conn.close()


def save_history(question: str, answer: str, mode: str, sources: str = None):
    """保存问答历史。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO qa_history (question, answer, mode, sources) VALUES (?, ?, ?, ?)",
        (question, answer, mode, sources)
    )
    conn.commit()
    conn.close()


def get_history(limit: int = 50):
    """获取最近的问答历史。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, question, answer, mode, sources, created_at FROM qa_history ORDER BY id DESC LIMIT ?",
        (limit,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": row["id"],
            "question": row["question"],
            "answer": row["answer"],
            "mode": row["mode"],
            "sources": row["sources"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def clear_history():
    """清空历史。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM qa_history")
    conn.commit()
    conn.close()


def delete_history(history_id: int) -> bool:
    """删除单条问答历史。成功返回 True。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM qa_history WHERE id = ?", (history_id,))
    if not cursor.fetchone():
        conn.close()
        return False
    cursor.execute("DELETE FROM qa_history WHERE id = ?", (history_id,))
    conn.commit()
    conn.close()
    return True


def delete_history_batch(ids: List[int]) -> int:
    """批量删除问答历史，返回实际删除条数。"""
    if not ids:
        return 0
    conn = get_connection()
    cursor = conn.cursor()
    placeholders = ",".join("?" * len(ids))
    cursor.execute(f"DELETE FROM qa_history WHERE id IN ({placeholders})", ids)
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted


# ==================== LLM 模型管理 ====================

def get_all_models() -> List[Dict]:
    """获取所有已保存的 LLM 模型（API Key 脱敏）。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, base_url, api_key_encrypted, model_name, is_active FROM llm_models ORDER BY id")
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "base_url": row["base_url"],
            "api_key_masked": _mask_key(row["api_key_encrypted"]),
            "model_name": row["model_name"],
            "is_active": bool(row["is_active"]),
        }
        for row in rows
    ]


def get_active_model() -> Optional[Dict]:
    """获取当前激活的模型（含加密 key）。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, base_url, api_key_encrypted, model_name, is_active FROM llm_models WHERE is_active = 1 LIMIT 1")
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            "id": row["id"],
            "name": row["name"],
            "base_url": row["base_url"],
            "api_key_encrypted": row["api_key_encrypted"],
            "model_name": row["model_name"],
            "is_active": bool(row["is_active"]),
        }
    return None


def get_model_by_id(model_id: int) -> Optional[Dict]:
    """根据 ID 获取模型（含加密 key）。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, base_url, api_key_encrypted, model_name, is_active FROM llm_models WHERE id = ?", (model_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {
            "id": row["id"],
            "name": row["name"],
            "base_url": row["base_url"],
            "api_key_encrypted": row["api_key_encrypted"],
            "model_name": row["model_name"],
            "is_active": bool(row["is_active"]),
        }
    return None


def add_model(name: str, base_url: str, api_key_encrypted: str, model_name: str) -> int:
    """添加新模型，自动设为激活。返回新模型 ID。"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("UPDATE llm_models SET is_active = 0")

    cursor.execute(
        "INSERT INTO llm_models (name, base_url, api_key_encrypted, model_name, is_active) VALUES (?, ?, ?, ?, 1)",
        (name, base_url, api_key_encrypted, model_name)
    )
    model_id = cursor.lastrowid

    conn.commit()
    conn.close()
    return model_id


def set_active_model(model_id: int) -> bool:
    """切换激活模型。成功返回 True。"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM llm_models WHERE id = ?", (model_id,))
    if not cursor.fetchone():
        conn.close()
        return False

    cursor.execute("UPDATE llm_models SET is_active = 0")
    cursor.execute("UPDATE llm_models SET is_active = 1 WHERE id = ?", (model_id,))
    conn.commit()
    conn.close()
    return True


def delete_model(model_id: int) -> bool:
    """删除模型。成功返回 True。"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM llm_models WHERE id = ?", (model_id,))
    if not cursor.fetchone():
        conn.close()
        return False

    cursor.execute("DELETE FROM llm_models WHERE id = ?", (model_id,))
    conn.commit()
    conn.close()
    return True


def update_model(model_id: int, name: str, base_url: str, api_key_encrypted: str, model_name: str) -> bool:
    """更新模型信息。成功返回 True。"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM llm_models WHERE id = ?", (model_id,))
    if not cursor.fetchone():
        conn.close()
        return False

    cursor.execute(
        "UPDATE llm_models SET name = ?, base_url = ?, api_key_encrypted = ?, model_name = ? WHERE id = ?",
        (name, base_url, api_key_encrypted, model_name, model_id)
    )
    conn.commit()
    conn.close()
    return True


def _mask_key(encrypted_key: str) -> str:
    """对加密后的 key 做脱敏处理（解密后脱敏）。"""
    try:
        decrypted = settings.decrypt_api_key(encrypted_key)
        if len(decrypted) <= 8:
            return "****"
        return f"****{decrypted[-4:]}"
    except Exception:
        return "****"


# ==================== 动态知识条目管理 ====================

def add_knowledge_entries(entries: List[Dict]) -> int:
    """批量插入知识条目，跳过已存在的 entry_id。返回新增数量。"""
    conn = get_connection()
    cursor = conn.cursor()
    added = 0
    for entry in entries:
        try:
            cursor.execute(
                """INSERT INTO knowledge_entries (entry_id, title, category, content, source, url, tags, import_mode, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    entry["entry_id"],
                    entry["title"],
                    entry.get("category", "未分类"),
                    entry["content"],
                    entry.get("source", ""),
                    entry.get("url", ""),
                    entry.get("tags", "[]"),
                    entry.get("import_mode", "direct"),
                    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                )
            )
            added += 1
        except sqlite3.IntegrityError:
            continue
    conn.commit()
    conn.close()
    return added


def get_dynamic_entries() -> List[Dict]:
    """获取所有动态导入的知识条目。"""
    import json
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT entry_id, title, category, content, source, url, tags, created_at FROM knowledge_entries ORDER BY id")
    rows = cursor.fetchall()
    conn.close()
    result = []
    for row in rows:
        tags_raw = row["tags"] or "[]"
        try:
            tags = json.loads(tags_raw) if isinstance(tags_raw, str) else tags_raw
        except Exception:
            tags = []
        result.append({
            "id": row["entry_id"],
            "domain": row["category"],
            "title": row["title"],
            "category": row["category"],
            "content": row["content"],
            "source": row["source"],
            "url": row["url"] or "",
            "tags": tags,
            "chunk_id": row["entry_id"],
            "created_at": row["created_at"] or "",
        })
    return result


def get_dynamic_entries_list() -> List[Dict]:
    """获取动态条目列表（含元数据）。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT entry_id, title, category, content, source, import_mode, created_at FROM knowledge_entries ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [
        {
            "entry_id": row["entry_id"],
            "title": row["title"],
            "category": row["category"],
            "content": row["content"][:200] + ("..." if len(row["content"]) > 200 else ""),
            "source": row["source"],
            "import_mode": row["import_mode"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def delete_entry(entry_id: str) -> bool:
    """删除单条动态知识。成功返回 True。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM knowledge_entries WHERE entry_id = ?", (entry_id,))
    if not cursor.fetchone():
        conn.close()
        return False
    cursor.execute("DELETE FROM knowledge_entries WHERE entry_id = ?", (entry_id,))
    conn.commit()
    conn.close()
    return True


def is_source_imported(source: str) -> bool:
    """检查该来源文件是否已导入。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM knowledge_entries WHERE source = ?", (source,))
    count = cursor.fetchone()[0]
    conn.close()
    return count > 0


def add_single_entry(title: str, category: str, content: str, source: str = "", url: str = "", tags: str = "[]") -> str:
    """手动新增单条知识条目，返回新 entry_id。"""
    import json
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(CAST(SUBSTR(entry_id, 3) AS INTEGER)) FROM knowledge_entries WHERE entry_id LIKE 'E%'")
    row = cursor.fetchone()
    next_num = (row[0] or 0) + 1
    entry_id = f"E{next_num:03d}"

    cursor.execute(
        """INSERT INTO knowledge_entries (entry_id, title, category, content, source, url, tags, import_mode, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (entry_id, title, category, content, source, url, tags, "manual", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    )
    conn.commit()
    conn.close()
    return entry_id


def update_entry(entry_id: str, title: str, category: str, content: str, source: str = "", url: str = "", tags: str = "[]") -> bool:
    """编辑知识条目。成功返回 True。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM knowledge_entries WHERE entry_id = ?", (entry_id,))
    if not cursor.fetchone():
        conn.close()
        return False

    cursor.execute(
        """UPDATE knowledge_entries SET title=?, category=?, content=?, source=?, url=?, tags=? WHERE entry_id=?""",
        (title, category, content, source, url, tags, entry_id)
    )
    conn.commit()
    conn.close()
    return True


def get_entry_by_id(entry_id: str) -> Optional[Dict]:
    """根据 entry_id 获取单条知识。"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM knowledge_entries WHERE entry_id = ?", (entry_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return dict(row)


def update_entries_batch(entry_ids: List[str], fields: Dict) -> int:
    """
    批量更新知识条目的公共字段（仅动态条目）。

    fields 支持: category / source / url / tags（tags 为 JSON 字符串）。
    只更新 fields 中出现的字段，返回实际更新条数。
    """
    if not entry_ids or not fields:
        return 0

    allowed = {"category", "source", "url", "tags"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return 0

    set_clause = ", ".join(f"{k}=?" for k in updates)
    placeholders = ",".join("?" * len(entry_ids))
    sql = f"UPDATE knowledge_entries SET {set_clause} WHERE entry_id IN ({placeholders})"

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(sql, list(updates.values()) + entry_ids)
    updated = cursor.rowcount
    conn.commit()
    conn.close()
    return updated


def find_similar_entries(title: str, content: str, threshold: float = 0.85) -> List[Dict]:
    """
    查找与给定标题/内容高度相似（重复）的已有条目。

    使用 difflib 计算标题与内容文本的相似度，超过阈值视为重复。
    返回相似条目的列表（含 entry_id、title、similarity）。
    """
    import difflib
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT entry_id, title, content FROM knowledge_entries")
    rows = cursor.fetchall()
    conn.close()

    new_text = f"{title}\n{content}"
    similar = []
    for row in rows:
        existing_text = f"{row['title']}\n{row['content']}"
        # 标题精确匹配视为重复
        if row["title"] and title and row["title"].strip() == title.strip():
            similar.append({
                "entry_id": row["entry_id"],
                "title": row["title"],
                "similarity": 1.0,
            })
            continue
        ratio = difflib.SequenceMatcher(None, new_text, existing_text).ratio()
        if ratio >= threshold:
            similar.append({
                "entry_id": row["entry_id"],
                "title": row["title"],
                "similarity": round(ratio, 4),
            })
    return similar
