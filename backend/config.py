"""应用配置管理，通过 pydantic-settings 加载 .env 文件。"""

import os
from pathlib import Path
from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """从 .env 文件和环境变量加载配置。"""

    # OpenAI 兼容 API
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    MODEL_NAME: str = "gpt-4o-mini"

    # LLM 模式：mock 或 real
    LLM_MODE: str = "mock"

    # 服务器
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # 数据库
    DATABASE_URL: str = "sqlite:///./fitqa.db"

    # 加密密钥
    ENCRYPTION_KEY: str = ""

    @property
    def is_mock_mode(self) -> bool:
        """是否进入 mock 模式：LLM_MODE=mock 或未配置 API Key。"""
        if self.LLM_MODE == "mock":
            return True
        if not self.OPENAI_API_KEY:
            return True
        return False

    def update_llm_config(self, base_url: str, api_key: str, model_name: str):
        """运行时更新 LLM 配置。"""
        self.OPENAI_BASE_URL = base_url
        self.OPENAI_API_KEY = api_key
        self.MODEL_NAME = model_name

    def update_mode(self, mode: str):
        """运行时切换 LLM 模式。"""
        self.LLM_MODE = mode

    def get_masked_api_key(self) -> str:
        """返回脱敏的 API Key。"""
        if not self.OPENAI_API_KEY:
            return ""
        if len(self.OPENAI_API_KEY) <= 8:
            return "****"
        return f"****{self.OPENAI_API_KEY[-4:]}"

    def get_or_create_encryption_key(self) -> str:
        """获取或自动生成加密密钥。"""
        if self.ENCRYPTION_KEY:
            return self.ENCRYPTION_KEY

        key = Fernet.generate_key().decode()
        self.ENCRYPTION_KEY = key

        env_path = Path(__file__).parent / ".env"
        if env_path.exists():
            content = env_path.read_text(encoding="utf-8")
            if "ENCRYPTION_KEY=" in content:
                lines = content.split("\n")
                new_lines = []
                for line in lines:
                    if line.startswith("ENCRYPTION_KEY="):
                        new_lines.append(f"ENCRYPTION_KEY={key}")
                    else:
                        new_lines.append(line)
                content = "\n".join(new_lines)
            else:
                content += f"\nENCRYPTION_KEY={key}\n"
            env_path.write_text(content, encoding="utf-8")
        else:
            env_path.write_text(f"ENCRYPTION_KEY={key}\n", encoding="utf-8")

        print(f"[Config] Generated new encryption key")
        return key

    def encrypt_api_key(self, api_key: str) -> str:
        """加密 API Key。"""
        key = self.get_or_create_encryption_key()
        f = Fernet(key.encode() if isinstance(key, str) else key)
        return f.encrypt(api_key.encode()).decode()

    def decrypt_api_key(self, encrypted: str) -> str:
        """解密 API Key。"""
        key = self.get_or_create_encryption_key()
        f = Fernet(key.encode() if isinstance(key, str) else key)
        return f.decrypt(encrypted.encode()).decode()

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
