"""
Parser layer — UK residential property auction houses only.

All 11 sources share BaseAuctionParser._build_from_standard_payload().
Each adapter emits a common raw_payload schema so new sources need
only a one-line parser subclass.
"""
from __future__ import annotations

import re
from datetime import datetime

from dateutil import parser as dateutil_parser

from app.models import (
    Address, AuctionInfo, LeaseInfo, NormalizedListing,
    PriceInfo, RawListing, SourceType,
)
from app.normalizers.address import (
    build_canonical_address_key, compute_listing_fingerprint, extract_postcode_district,
)
from app.normalizers.property import (
    normalise_property_type, normalise_tenure,
    parse_bedrooms, parse_bathrooms, parse_floor_area,
    parse_lease_expiry_year, parse_lease_years, parse_price_pence,
)
import structlog

log = structlog.get_logger(__name__)


class BaseAuctionParser:
    source_id: str
    auction_house_name: str

    def parse(self, raw: RawListing) -> NormalizedListing | None:
        raise NotImplementedError

    def _build_address(self, raw_address: str, postcode: str | None = None) -> Address:
        canonical = build_canonical_address_key(raw_address, postcode)
        pc_clean = None
        if postcode:
            pc_clean = postcode.strip().upper()
        elif raw_address:
            m = re.search(r"([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})", raw_address, re.IGNORECASE)
            if m:
                pc_clean = m.group(1).upper()
        return Address(
            raw=raw_address,
            postcode=pc_clean,
            postcode_district=extract_postcode_district(pc_clean) if pc_clean else None,
            canonical=canonical,
        )

    def _parse_auction_date(self, raw: str | None) -> datetime | None:
        if not raw:
            return None
        raw_str = str(raw)
        try:
            return datetime.fromisoformat(raw_str)
        except ValueError:
            pass
        try:
            return dateutil_parser.parse(raw_str, dayfirst=True)
        except Exception:
            return None

    def _build_from_standard_payload(self, raw: RawListing) -> NormalizedListing | None:
        p = raw.raw_payload
        if not p:
            return None

        raw_address = p.get("address") or ""
        if not raw_address:
            return None

        address = self._build_address(raw_address, p.get("postcode"))
        guide_pence = parse_price_pence(p.get("guide_price"))
        reserve_pence = parse_price_pence(p.get("reserve_price"))
        description = str(p.get("description") or "")

        property_type = normalise_property_type(p.get("property_type") or description)
        tenure = normalise_tenure(p.get("tenure") or description)
        lease_years = parse_lease_years(p.get("tenure") or description)
        lease_expiry = parse_lease_expiry_year(description)
        lease = LeaseInfo(lease_length_years=lease_years, lease_expiry_year=lease_expiry) \
            if (lease_years or lease_expiry) else None

        bedrooms = p.get("bedrooms") or parse_bedrooms(description)
        bathrooms = p.get("bathrooms") or parse_bathrooms(description)
        sqft, sqm = parse_floor_area(str(p.get("floor_area") or "") or description)

        auction_date = self._parse_auction_date(p.get("auction_date"))
        auction = AuctionInfo(
            auction_house=p.get("auction_house") or self.auction_house_name,
            lot_number=p.get("lot_number"),
            auction_date=auction_date,
            online_bidding=bool(p.get("online_bidding", True)),
        )

        image_urls = [u for u in (p.get("image_urls") or []) if isinstance(u, str) and u]
        floorplan_urls = [u for u in (p.get("floorplan_urls") or []) if isinstance(u, str) and u]
        brochure_url = p.get("brochure_url") or p.get("brochure")
        brochure_urls = [brochure_url] if brochure_url else []

        canonical_key = address.canonical or ""
        fingerprint = compute_listing_fingerprint(self.source_id, canonical_key, raw.external_id)

        return NormalizedListing(
            fingerprint=fingerprint,
            canonical_address_key=canonical_key,
            source_id=self.source_id,
            source_type=SourceType.AUCTION,
            listing_url=raw.source_url,
            external_id=raw.external_id,
            address=address,
            price=PriceInfo(amount=guide_pence, guide_price=guide_pence, reserve_price=reserve_pence),
            property_type=property_type,
            bedrooms=int(bedrooms) if bedrooms else None,
            bathrooms=int(bathrooms) if bathrooms else None,
            floor_area_sqft=sqft,
            floor_area_sqm=sqm,
            tenure=tenure,
            lease=lease,
            description=description[:5000] if description else None,
            image_urls=image_urls,
            floorplan_urls=floorplan_urls,
            brochure_urls=brochure_urls,
            auction=auction,
        )


# ---------------------------------------------------------------------------
# Per-source parsers — each is a one-liner on top of the shared base
# ---------------------------------------------------------------------------

class AllsopAuctionParser(BaseAuctionParser):
    source_id = "allsop_auction"
    auction_house_name = "Allsop"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class SDLAuctionsParser(BaseAuctionParser):
    source_id = "sdl_auctions"
    auction_house_name = "SDL Auctions"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class SavillsAuctionsParser(BaseAuctionParser):
    source_id = "savills_auctions"
    auction_house_name = "Savills"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class BidX1Parser(BaseAuctionParser):
    source_id = "bidx1"
    auction_house_name = "BidX1"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class IamsoldParser(BaseAuctionParser):
    source_id = "iamsold"
    auction_house_name = "iamsold"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class AuctionHouseUKParser(BaseAuctionParser):
    source_id = "auction_house_uk"
    auction_house_name = "Auction House"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class CliveEmsonParser(BaseAuctionParser):
    source_id = "clive_emson"
    auction_house_name = "Clive Emson"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class BarnardMarcusParser(BaseAuctionParser):
    source_id = "barnard_marcus"
    auction_house_name = "Barnard Marcus"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class StretchonsParser(BaseAuctionParser):
    source_id = "strettons"
    auction_house_name = "Strettons"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class BondWolfeParser(BaseAuctionParser):
    source_id = "bond_wolfe"
    auction_house_name = "Bond Wolfe"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class BarnettRossParser(BaseAuctionParser):
    source_id = "barnett_ross"
    auction_house_name = "Barnett Ross"
    def parse(self, raw): return self._build_from_standard_payload(raw)


class McHughAndCoParser(BaseAuctionParser):
    source_id = "mchugh_and_co"
    auction_house_name = "McHugh & Co"
    def parse(self, raw): return self._build_from_standard_payload(raw)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_PARSERS: dict[str, BaseAuctionParser] = {
    "allsop_auction":   AllsopAuctionParser(),
    "sdl_auctions":     SDLAuctionsParser(),
    "savills_auctions": SavillsAuctionsParser(),
    "bidx1":            BidX1Parser(),
    "iamsold":          IamsoldParser(),
    "auction_house_uk": AuctionHouseUKParser(),
    "clive_emson":      CliveEmsonParser(),
    "barnard_marcus":   BarnardMarcusParser(),
    "strettons":        StretchonsParser(),
    "bond_wolfe":       BondWolfeParser(),
    "barnett_ross":     BarnettRossParser(),
    "mchugh_and_co":    McHughAndCoParser(),
}


def get_parser(source_id: str) -> BaseAuctionParser:
    parser = _PARSERS.get(source_id)
    if parser is None:
        raise ValueError(f"No parser registered for source '{source_id}'")
    return parser


def parse_raw_listing(raw: RawListing) -> NormalizedListing | None:
    try:
        parser = get_parser(raw.source_id)
        return parser.parse(raw)
    except Exception as exc:
        log.error("parse failed", source_id=raw.source_id, error=str(exc))
        return None
