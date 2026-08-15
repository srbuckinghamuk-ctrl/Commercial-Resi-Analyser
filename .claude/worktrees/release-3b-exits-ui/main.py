"""Commercial-Resi-Analyser - API entrypoint."""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from app.logging_config import configure_logging
configure_logging()

from app.api.app import app  # noqa: F401 - re-export for uvicorn
