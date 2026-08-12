"""Pytest configuration and shared fixtures."""
import os
import sys

import pytest

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


def pytest_configure(config):
    """Configure pytest with async mode."""
    config.addinivalue_line("markers", "integration: mark test as integration test")
    config.addinivalue_line("markers", "unit: mark test as unit test")


@pytest.fixture(autouse=True)
def _clear_postcode_cache():
    """The postcode lookup caches results in-memory; tests mock different
    responses for the same postcode, so the cache must not leak between tests."""
    from app.integrations import postcodes

    postcodes._cache.clear()
    yield
    postcodes._cache.clear()
