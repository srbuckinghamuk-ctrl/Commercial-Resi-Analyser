"""Application settings loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://postgres:password@localhost:5432/deal_sourcing"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Temporal
    temporal_host: str = "localhost:7233"
    temporal_namespace: str = "deal-sourcing"
    temporal_task_queue: str = "deal-sourcing-tasks"

    # API
    api_secret_key: str = "change-me-in-production"
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000"]

    # Scraping controls
    scrape_concurrency: int = 3
    scrape_delay_min_seconds: float = 2.0
    scrape_delay_max_seconds: float = 5.0
    rate_limit_requests_per_minute: int = 20
    max_retries: int = 3
    retry_delay_seconds: int = 60

    # Playwright
    playwright_headless: bool = True
    playwright_timeout_ms: int = 30_000
    playwright_user_agent: str = (
        "Mozilla/5.0 (compatible; DealSourcingBot/1.0; +https://example.com/bot)"
    )

    # Logging
    log_level: str = "INFO"

    # Health monitoring
    source_unhealthy_error_threshold: int = 5
    source_health_check_interval_seconds: int = 3600


@lru_cache
def get_settings() -> Settings:
    return Settings()
