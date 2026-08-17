"""PDF 文本提取"""

from PyPDF2 import PdfReader


def parse_pdf(file_path: str) -> str:
    """提取 PDF 文件的纯文本内容"""
    reader = PdfReader(file_path)
    pages_text = []
    for page in reader.pages:
        text = page.extract_text()
        if text and text.strip():
            pages_text.append(text.strip())
    if not pages_text:
        raise ValueError("PDF 文件无法提取到文本内容")
    return "\n\n".join(pages_text)
