"""TXT 文本提取"""


def parse_txt(file_path: str) -> str:
    """提取 TXT 文件的纯文本内容，自动检测编码"""
    encodings = ['utf-8', 'gbk', 'gb2312', 'latin-1']
    for enc in encodings:
        try:
            with open(file_path, 'r', encoding=enc) as f:
                content = f.read().strip()
            if not content:
                raise ValueError("TXT 文件内容为空")
            return content
        except UnicodeDecodeError:
            continue
    raise ValueError("无法识别文件编码，仅支持 UTF-8/GBK/GB2312")
