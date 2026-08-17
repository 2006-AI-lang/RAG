"""Word 文本提取"""

from docx import Document


def parse_docx(file_path: str) -> str:
    """提取 Word 文件的纯文本内容"""
    doc = Document(file_path)
    paragraphs = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            paragraphs.append(text)
    if not paragraphs:
        raise ValueError("Word 文件无法提取到文本内容")
    return "\n\n".join(paragraphs)
