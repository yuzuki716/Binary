from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    app_name: str = "バイナリーオプション シミュレーター"
    debug: bool = False
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR}/data/simulator.db"
    cors_origins: list[str] = ["*"]
    default_bar_limit: int = 2000
    max_bar_limit: int = 5000
    discord_webhook_url: str = ""
    twelve_data_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
