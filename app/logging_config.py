"""Structured logging setup using structlog."""
import logging
import sys

import structlog
from config.settings import get_settings

_configured = False


def configure_logging() -> None:
    # Idempotent: called both from main.py and at import time in
    # app.api.app (docker runs uvicorn against app.api.app:app directly,
    # bypassing main.py).
    global _configured
    if _configured:
        return
    _configured = True

    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
    )

    # Silence noisy libraries
    for lib in ("asyncio", "sqlalchemy.engine", "httpx"):
        logging.getLogger(lib).setLevel(logging.WARNING)
