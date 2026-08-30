"""Application settings loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://postgres:password@localhost:5432/commercial_resi"

    # API
    # Signs every bearer token (app/auth/tokens.py). Rotating it invalidates
    # them all; the placeholder refuses to start when environment=production.
    api_secret_key: str = "change-me-in-production"
    api_prefix: str = "/api/v1"
    # 'development' | 'production' -- only the production check depends on it.
    environment: str = "development"

    # Authentication (R17, spec Sec 10.1)
    auth_token_ttl_seconds: int = 43200  # 12 h
    # Both set + an empty users table at startup => the first administrator.
    admin_bootstrap_email: str = ""
    admin_bootstrap_password: str = ""
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"]

    # External APIs
    # base64("email:token") used directly in the EPC register's
    # Basic auth header — see README.
    epc_api_key: str = ""

    # Logging
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
