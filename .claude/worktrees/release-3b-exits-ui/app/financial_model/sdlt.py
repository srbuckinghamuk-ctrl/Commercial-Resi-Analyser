"""Port of frontend/src/lib/commercial-sdlt.ts -- band-for-band, slice basis.

Port rule #5 (task-11-brief.md): bands are 0% to 15_000_000p, 2% to 25_000_000p,
5% above.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .engine import money_round


@dataclass
class SdltBand:
    threshold_pence: float
    rate_pct: float
    tax_pence: int


@dataclass
class SdltResult:
    total_pence: int
    effective_rate_pct: float
    bands: list[SdltBand]


BANDS: list[dict] = [
    {"up_to_pence": 15_000_000, "rate_pct": 0},
    {"up_to_pence": 25_000_000, "rate_pct": 2},
    {"up_to_pence": math.inf, "rate_pct": 5},
]


def calculate_commercial_sdlt(price_pence: int) -> SdltResult:
    if price_pence <= 0:
        return SdltResult(
            total_pence=0,
            effective_rate_pct=0,
            bands=[
                SdltBand(threshold_pence=b["up_to_pence"], rate_pct=b["rate_pct"], tax_pence=0)
                for b in BANDS
            ],
        )

    remaining = price_pence
    prev_threshold = 0
    total_tax = 0
    band_results: list[SdltBand] = []

    for band in BANDS:
        band_width = band["up_to_pence"] - prev_threshold
        taxable = min(remaining, band_width)
        tax = money_round((taxable * band["rate_pct"]) / 100)
        band_results.append(
            SdltBand(threshold_pence=band["up_to_pence"], rate_pct=band["rate_pct"], tax_pence=tax)
        )
        total_tax += tax
        remaining -= taxable
        prev_threshold = band["up_to_pence"]
        if remaining <= 0:
            break

    while len(band_results) < len(BANDS):
        idx = len(band_results)
        band_results.append(
            SdltBand(
                threshold_pence=BANDS[idx]["up_to_pence"],
                rate_pct=BANDS[idx]["rate_pct"],
                tax_pence=0,
            )
        )

    return SdltResult(
        total_pence=total_tax,
        effective_rate_pct=(total_tax / price_pence) * 100 if price_pence > 0 else 0,
        bands=band_results,
    )
