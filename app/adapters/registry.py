from app.adapters.base import BaseAdapter
from app.models import CommercialListing

_REGISTRY: dict[str, type[BaseAdapter]] = {}

_URL_TO_SOURCE: dict[str, str] = {}


def get_adapter(source_id: str) -> type[BaseAdapter] | None:
    return _REGISTRY.get(source_id)


def source_id_from_url(url: str) -> str | None:
    from urllib.parse import urlparse
    hostname = urlparse(url).hostname or ""
    hostname = hostname.removeprefix("www.")
    return _URL_TO_SOURCE.get(hostname)
