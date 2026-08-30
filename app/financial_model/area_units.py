"""Port of frontend/src/lib/area-units.ts (R17, spec §27.2).

The exact m² ⇄ ft² conversion. Exact twin of the TS module: the numeric
functions are mirrored here; the string formatters (``formatAreaValue`` and
friends) are display code and stay in the frontend, with only the unit labels
ported. ``tests/test_area_units.py`` pins ``SQFT_PER_SQM`` equal across the
two by reading the TS source text.

The canonical basis is metric and never changes: a document stores m² and
pence per m² only. Imperial is a display unit — every conversion here is
applied to the canonical figure at render time and its result is never
written back, so N toggles produce the same stored value as zero toggles. The
only entry-time conversions are ``entry_area_to_sqm`` (a typed ft² area,
stored to 4 dp of m² — the stated entry precision) and
``entry_rate_to_pence_per_sqm`` (a typed £/ft² rate, stored unrounded). Money
is rounded once, at the amount boundary, and never here.

NOT the lender-valuation constant. ``lender_valuation.py`` carries its own
``SQFT_PER_SQM = 10.7639``: that is the ``global_per_sqft`` basis' *stored
calculation convention* — a calculation input that moves ``lender_gdv_pence``
on fixture G if touched — and it is deliberately left as it is (spec §27.9
limitation 6). Do not "fix" either one to match the other.

Imports nothing but the stdlib and ``.engine`` (for ``money_round``);
``engine.py`` does not import this module, so there is no cycle.
"""
from __future__ import annotations

from typing import Literal

from .engine import money_round

#: Square feet per square metre, exact to the digits given (spec §27.2).
SQFT_PER_SQM = 10.7639104167097

AreaUnit = Literal["metric", "imperial"]

AREA_UNITS: tuple[AreaUnit, ...] = ("metric", "imperial")


# --- the four conversions: float, unrounded --------------------------------


def sqm_to_sqft(sqm: float) -> float:
    return sqm * SQFT_PER_SQM


def sqft_to_sqm(sqft: float) -> float:
    return sqft / SQFT_PER_SQM


def rate_per_sqm_to_per_sqft(rate_per_sqm: float) -> float:
    """A rate per m² (any numerator: pence, pounds) to the same numerator per ft²."""
    return rate_per_sqm / SQFT_PER_SQM


def rate_per_sqft_to_per_sqm(rate_per_sqft: float) -> float:
    """A rate per ft² (any numerator) to the same numerator per m²."""
    return rate_per_sqft * SQFT_PER_SQM


# --- labels -----------------------------------------------------------------


def area_unit_label(unit: AreaUnit) -> str:
    return "ft²" if unit == "imperial" else "m²"


def rate_unit_label(unit: AreaUnit) -> str:
    return "£/ft²" if unit == "imperial" else "£/m²"


# --- display (render-time; the canonical m² figure is the argument) --------


def display_area(sqm: float, unit: AreaUnit) -> float:
    """The canonical m² figure in the display unit, unrounded."""
    return sqm_to_sqft(sqm) if unit == "imperial" else sqm


# --- entry (the only conversions whose result is stored) -------------------


def entry_area_to_sqm(value: float, unit: AreaUnit) -> float:
    """A typed area in the entry unit to canonical m².

    Metric passes through untouched; imperial converts with ``sqft_to_sqm``
    and rounds to 4 dp of m² — the entry precision the UI states (spec
    §27.2). ``money_round`` on ``x * 1e4`` is half-up toward +inf, the same
    rule as the TS twin's ``Math.round``.
    """
    if unit == "metric":
        return value
    return money_round(sqft_to_sqm(value) * 1e4) / 1e4


def entry_rate_to_pence_per_sqm(pence: float, unit: AreaUnit) -> float:
    """A typed rate in pence per entry unit to canonical pence per m²,
    unrounded for imperial (spec §27.2: rounding happens only at the amount
    boundary)."""
    return pence if unit == "metric" else rate_per_sqft_to_per_sqm(pence)
