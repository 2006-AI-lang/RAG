"""文档解析器统一入口"""

from pathlib import Path
from .pdf_parser import parse_pdf
from .docx_parser import parse_docx
from .txt_parser import parse_txt


def parse_file(file_path: str) -> str:
    """根据文件扩展名调用对应解析器，返回纯文本"""
    ext = Path(file_path).suffix.lower()
    if ext == '.pdf':
        return parse_pdf(file_path)
    elif ext == '.docx':
        return parse_docx(file_path)
    elif ext == '.txt':
        return parse_txt(file_path)
    else:
        raise ValueError(f"不支持的文件格式: {ext}")
