from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    app_name: str = "バイナリーオプション シミュレーター"
    debug: bool = False
    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR}/data/simulator.db"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173"]
    default_bar_limit: int = 2000
    max_bar_limit: int = 5000

    class Config:
        env_file = ".env"


settings = Settings()
