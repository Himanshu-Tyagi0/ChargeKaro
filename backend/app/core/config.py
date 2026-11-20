"""Application configuration via environment variables."""

from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed application settings loaded from environment variables."""

    app_name: str = "ChargeKaro API"
    api_v1_prefix: str = "/api/v1"
    environment: str = "development"

    # Database: SQLite for demo; swap to postgresql+psycopg2://... for Postgres
    database_url: str = f"sqlite:///{(Path(__file__).resolve().parents[2] / 'chargekaro.db').as_posix()}"

    # Security secrets (override via env in production)
    jwt_secret: str = "demo-dev-jwt-secret-change-in-production-32bytes"
    qr_secret: str = "demo-dev-qr-secret-change-in-production-32bytes"
    csrf_secret: str = "demo-dev-csrf-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # CORS
    frontend_origin: str = "http://localhost:3000"
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173"

    # LLM Providers (swappable: "gemini" | "groq" | "rule")
    llm_provider: str = "gemini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-4-hydrogen"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Simulator settings
    enable_simulator: bool = True
    simulator_interval_min_sec: int = 5
    simulator_interval_max_sec: int = 9

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        origins = [o.strip() for o in self.allowed_origins.split(",") if o.strip()]
        if self.frontend_origin and self.frontend_origin not in origins:
            origins.append(self.frontend_origin)
        return origins


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
