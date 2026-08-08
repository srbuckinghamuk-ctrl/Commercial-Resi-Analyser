"""
Registry mapping source IDs to adapter classes.
All sources are major UK residential property auction houses.
"""
from __future__ import annotations

from app.adapters.base import BaseAdapter
from app.adapters.allsop_auction import AllsopAuctionAdapter
from app.adapters.sdl_auctions import SDLAuctionsAdapter
from app.adapters.savills_auctions import SavillsAuctionsAdapter
from app.adapters.bidx1 import BidX1Adapter
from app.adapters.iamsold import IamsoldAdapter
from app.adapters.auction_house_uk import AuctionHouseUKAdapter
from app.adapters.clive_emson import CliveEmsonAdapter
from app.adapters.barnard_marcus import BarnardMarcusAdapter
from app.adapters.strettons import StretchonsAdapter
from app.adapters.bond_wolfe import BondWolfeAdapter
from app.adapters.barnett_ross import BarnettRossAdapter
from app.adapters.mchugh_and_co import McHughAndCoAdapter
from app.models import SourceConfig

_REGISTRY: dict[str, type[BaseAdapter]] = {
    "allsop_auction":   AllsopAuctionAdapter,
    "sdl_auctions":     SDLAuctionsAdapter,
    "savills_auctions": SavillsAuctionsAdapter,
    "bidx1":            BidX1Adapter,
    "iamsold":          IamsoldAdapter,
    "auction_house_uk": AuctionHouseUKAdapter,
    "clive_emson":      CliveEmsonAdapter,
    "barnard_marcus":   BarnardMarcusAdapter,
    "strettons":        StretchonsAdapter,
    "bond_wolfe":       BondWolfeAdapter,
    "barnett_ross":     BarnettRossAdapter,
    "mchugh_and_co":    McHughAndCoAdapter,
}


def get_adapter(config: SourceConfig) -> BaseAdapter:
    cls = _REGISTRY.get(config.id)
    if cls is None:
        raise ValueError(f"No adapter registered for source '{config.id}'")
    return cls(config)


# ---------------------------------------------------------------------------
# URL-to-source routing (for single-URL on-demand scraping)
# ---------------------------------------------------------------------------

_URL_TO_SOURCE: dict[str, str] = {
    "allsop.co.uk":                 "allsop_auction",
    "sdlauctions.co.uk":            "sdl_auctions",
    "auctions.savills.co.uk":       "savills_auctions",
    "savills.co.uk":                "savills_auctions",
    "bidx1.com":                    "bidx1",
    "iamsold.co.uk":                "iamsold",
    "auctionhouse.co.uk":           "auction_house_uk",
    "cliveemson.co.uk":             "clive_emson",
    "barnardmarcusauctions.co.uk":  "barnard_marcus",
    "strettons.co.uk":              "strettons",
    "bondwolfe.com":                "bond_wolfe",
    "barnettross.co.uk":            "barnett_ross",
    "mchughandco.com":              "mchugh_and_co",
}


def source_id_from_url(url: str) -> str | None:
    """Return the registered source_id for a given auction URL, or None if unrecognised."""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        host = host.removeprefix("www.")
        return _URL_TO_SOURCE.get(host)
    except Exception:
        return None


def _make_lightweight_config(source_id: str) -> SourceConfig:
    """Create a minimal SourceConfig for single-URL scraping (no database needed)."""
    # Source display names for adapter config
    _NAMES: dict[str, str] = {
        "allsop_auction": "Allsop",
        "sdl_auctions": "SDL Auctions",
        "savills_auctions": "Savills",
        "bidx1": "BidX1",
        "iamsold": "iamsold",
        "auction_house_uk": "Auction House",
        "clive_emson": "Clive Emson",
        "barnard_marcus": "Barnard Marcus",
        "strettons": "Strettons",
        "bond_wolfe": "Bond Wolfe",
        "barnett_ross": "Barnett Ross",
        "mchugh_and_co": "McHugh & Co",
    }
    return SourceConfig(
        id=source_id,
        name=_NAMES.get(source_id, source_id),
        source_type="auction",
        base_url="",
        rate_limit_rpm=10,
        scrape_delay_min=1.0,
        scrape_delay_max=3.0,
    )


async def scrape_single_url(url: str, source_id: str) -> "RawListing | None":
    """Scrape a single URL using the registered adapter. Returns a RawListing or None.

    Uses httpx (not Playwright) so no browser subprocess is needed.
    """
    config = _make_lightweight_config(source_id)
    adapter = get_adapter(config)
    return await adapter.scrape_single_url(url)
