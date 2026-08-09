from __future__ import annotations

from urllib.parse import urlparse

from app.adapters.base import BaseAdapter


_REGISTRY: dict[str, type[BaseAdapter]] = {}

_URL_TO_SOURCE: dict[str, str] = {}


def register_adapter(
    source_id: str,
    adapter_cls: type[BaseAdapter],
    hostnames: list[str],
) -> None:
    _REGISTRY[source_id] = adapter_cls
    for hostname in hostnames:
        _URL_TO_SOURCE[hostname] = source_id


def get_adapter(source_id: str) -> type[BaseAdapter] | None:
    return _REGISTRY.get(source_id)


def source_id_from_url(url: str) -> str | None:
    hostname = urlparse(url).hostname or ""
    hostname = hostname.removeprefix("www.")
    return _URL_TO_SOURCE.get(hostname)


def _auto_register() -> None:
    import app.adapters.rightmove_commercial  # noqa: F401


_auto_register()
