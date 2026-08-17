"""Port of frontend/src/lib/tax/acquisition-tax.ts -- band for band, slice basis.

Replaces sdlt.py. Spec Sec 14. The normative record of every band set is
fixtures/tax/acquisition-tax-tables.json; test_acquisition_tax.py asserts this
module against it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

from .engine import money_round

Jurisdiction = Literal["england_ni", "scotland", "wales"]
Regime = Literal["SDLT", "LBTT", "LTT"]
TaxBasis = Literal["non_residential", "residential_higher"]
DateBasis = Literal["transaction_date", "assumed_current"]

TAX_TABLE_VERSION = "1.0.0"

GOV_UK_NONRES = "https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates"
GOV_UK_RES = "https://www.gov.uk/stamp-duty-land-tax/residential-property-rates"
GOV_SCOT = "https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/"
GOV_WALES = "https://www.gov.wales/land-transaction-tax-rates-and-bands"


@dataclass(frozen=True)
class TaxBand:
    up_to_pence: float
    rate_pct: float


@dataclass(frozen=True)
class BandSet:
    regime: Regime
    jurisdiction: Jurisdiction
    basis: TaxBasis
    effective_from: str
    effective_to: str | None
    bands: list[TaxBand]
    surcharge_pct: float | None
    source_url: str
    source_note: str


TAX_TABLES: list[BandSet] = [
    BandSet(
        regime="SDLT", jurisdiction="england_ni", basis="non_residential",
        effective_from="2016-03-17", effective_to=None,
        bands=[TaxBand(15_000_000, 0), TaxBand(25_000_000, 2), TaxBand(math.inf, 5)],
        surcharge_pct=None, source_url=GOV_UK_NONRES,
        source_note="Non-residential and mixed freehold rates, unchanged since 17 March 2016.",
    ),
    BandSet(
        regime="LBTT", jurisdiction="scotland", basis="non_residential",
        effective_from="2019-01-25", effective_to=None,
        bands=[TaxBand(15_000_000, 0), TaxBand(25_000_000, 1), TaxBand(math.inf, 5)],
        surcharge_pct=None, source_url=GOV_SCOT,
        source_note=(
            "Non-residential conveyance rates from 25 January 2019; held at current "
            "levels by Scottish Budget 2026-27."
        ),
    ),
    BandSet(
        regime="LTT", jurisdiction="wales", basis="non_residential",
        effective_from="2020-12-22", effective_to=None,
        bands=[
            TaxBand(22_500_000, 0), TaxBand(25_000_000, 1),
            TaxBand(100_000_000, 5), TaxBand(math.inf, 6),
        ],
        surcharge_pct=None, source_url=GOV_WALES,
        source_note="Non-residential rates from 22 December 2020.",
    ),
    BandSet(
        regime="SDLT", jurisdiction="england_ni", basis="residential_higher",
        effective_from="2025-04-01", effective_to=None,
        bands=[
            TaxBand(12_500_000, 0), TaxBand(25_000_000, 2), TaxBand(92_500_000, 5),
            TaxBand(150_000_000, 10), TaxBand(math.inf, 12),
        ],
        surcharge_pct=5, source_url=GOV_UK_RES,
        source_note=(
            "Residential bands from 1 April 2025 with the 5% higher-rates supplement "
            "in force from 31 October 2024."
        ),
    ),
    BandSet(
        regime="LBTT", jurisdiction="scotland", basis="residential_higher",
        effective_from="2024-12-05", effective_to=None,
        bands=[
            TaxBand(14_500_000, 0), TaxBand(25_000_000, 2), TaxBand(32_500_000, 5),
            TaxBand(75_000_000, 10), TaxBand(math.inf, 12),
        ],
        surcharge_pct=8, source_url=GOV_SCOT,
        source_note=(
            "Residential conveyance bands with the 8% Additional Dwelling Supplement "
            "in force from 5 December 2024."
        ),
    ),
    BandSet(
        regime="LTT", jurisdiction="wales", basis="residential_higher",
        effective_from="2024-12-11", effective_to=None,
        bands=[
            TaxBand(18_000_000, 5), TaxBand(25_000_000, 8.5), TaxBand(40_000_000, 10),
            TaxBand(75_000_000, 12.5), TaxBand(150_000_000, 15), TaxBand(math.inf, 17),
        ],
        # Wales carries no separate supplement: the uplift is inside these bands.
        surcharge_pct=None, source_url=GOV_WALES,
        source_note=(
            "Higher residential rates from 11 December 2024. The uplift is embedded "
            "in the bands, not charged as a supplement."
        ),
    ),
]

_REGIME_BY_JURISDICTION: dict[str, Regime] = {
    "england_ni": "SDLT", "scotland": "LBTT", "wales": "LTT",
}


def regime_for(jurisdiction: Jurisdiction) -> Regime:
    return _REGIME_BY_JURISDICTION[jurisdiction]


def select_band_set(
    jurisdiction: Jurisdiction, basis: TaxBasis, date: str | None,
) -> tuple[BandSet, DateBasis]:
    """The band set in force on `date`. See the TS docstring for why a null date
    is tolerated (and flagged) while an uncovered date is an error."""
    group = [s for s in TAX_TABLES if s.jurisdiction == jurisdiction and s.basis == basis]
    if not group:
        raise ValueError(f"No band sets for {jurisdiction}/{basis}")
    current = next((s for s in group if s.effective_to is None), None)
    if current is None:
        raise ValueError(f"No open-ended band set for {jurisdiction}/{basis}")
    if date is None:
        return current, "assumed_current"

    for s in group:
        if date >= s.effective_from and (s.effective_to is None or date < s.effective_to):
            return s, "transaction_date"

    earliest = min(s.effective_from for s in group)
    raise ValueError(
        f"No {regime_for(jurisdiction)} band set covers {date} for {jurisdiction}/{basis}; "
        f"the earliest covered date is {earliest}."
    )


def resolve_acquisition_date(
    jurisdiction: Jurisdiction, basis: TaxBasis, date: str | None,
) -> str | None:
    """R8 Fix round 1. Port of resolveAcquisitionDate (acquisition-tax.ts).

    run_appraisal computes the acquisition cost stack -- both derive_metrics and
    calculate_total_acquisition_cost -- *before* validate_inputs runs, so a date
    select_band_set cannot place (malformed, or not covered by any band set) must
    not raise and crash the whole appraisal here; it must degrade. None is
    already defined as "use the currently open-ended set" and reports
    date_basis="assumed_current", so degrading to it is self-describing rather
    than a silent substitute value. validate_inputs independently re-derives the
    exact same unusable-date condition as a hard acquisition.acquisition_date
    ValidationIssue, so the failure is never silent -- just never fatal. Same
    pattern as the compute_lender_gdv catch in metrics.py.

    Both tax call sites (derive_metrics and calculate_total_acquisition_cost)
    call this instead of passing their raw date straight to
    calculate_acquisition_tax, so they can never drift apart on how a bad date
    degrades -- see the _tax_inside_acquisition_cost drift guard in
    test_financial_model_metrics.py.

    Deliberately narrow: this only ever catches select_band_set's own raise
    (nothing else in the try block can raise). Any other failure must keep
    propagating.
    """
    if date is None:
        return None
    try:
        select_band_set(jurisdiction, basis, date)
        return date
    except ValueError:
        return None


@dataclass
class AcquisitionTaxBandResult:
    threshold_pence: float
    rate_pct: float
    tax_pence: int


@dataclass
class AcquisitionTaxResult:
    total_pence: int
    effective_rate_pct: float
    bands: list[AcquisitionTaxBandResult] = field(default_factory=list)
    surcharge_pence: int = 0
    regime: Regime = "SDLT"
    jurisdiction: Jurisdiction = "england_ni"
    basis: TaxBasis = "non_residential"
    band_set_effective_from: str = ""
    table_version: str = TAX_TABLE_VERSION
    source_url: str = ""
    date_basis: DateBasis = "transaction_date"
    is_override: bool = False
    override_reason: str | None = None
    computed_total_pence: int | None = None


def calculate_acquisition_tax(
    *,
    consideration_pence: int,
    jurisdiction: Jurisdiction,
    basis: TaxBasis,
    date: str | None,
    override_pence: int | None = None,
    override_reason: str | None = None,
) -> AcquisitionTaxResult:
    band_set, date_basis = select_band_set(jurisdiction, basis, date)

    band_results: list[AcquisitionTaxBandResult] = []
    band_tax = 0
    surcharge = 0

    if consideration_pence > 0:
        remaining = consideration_pence
        prev_threshold: float = 0
        for band in band_set.bands:
            width = band.up_to_pence - prev_threshold
            taxable = min(remaining, width)
            tax = money_round((taxable * band.rate_pct) / 100) if taxable > 0 else 0
            band_results.append(
                AcquisitionTaxBandResult(band.up_to_pence, band.rate_pct, tax)
            )
            band_tax += tax
            remaining -= taxable
            prev_threshold = band.up_to_pence
            if remaining <= 0:
                break
        if band_set.surcharge_pct is not None:
            surcharge = money_round((consideration_pence * band_set.surcharge_pct) / 100)

    while len(band_results) < len(band_set.bands):
        b = band_set.bands[len(band_results)]
        band_results.append(AcquisitionTaxBandResult(b.up_to_pence, b.rate_pct, 0))

    computed = band_tax + surcharge
    total = computed if override_pence is None else override_pence

    return AcquisitionTaxResult(
        total_pence=total,
        effective_rate_pct=(total / consideration_pence) * 100 if consideration_pence > 0 else 0,
        bands=band_results,
        surcharge_pence=surcharge,
        regime=band_set.regime,
        jurisdiction=jurisdiction,
        basis=basis,
        band_set_effective_from=band_set.effective_from,
        table_version=TAX_TABLE_VERSION,
        source_url=band_set.source_url,
        date_basis=date_basis,
        is_override=override_pence is not None,
        override_reason=None if override_pence is None else override_reason,
        computed_total_pence=None if override_pence is None else computed,
    )


_COUNTRY_TO_JURISDICTION: dict[str, Jurisdiction] = {
    "england": "england_ni",
    "northern ireland": "england_ni",
    "scotland": "scotland",
    "wales": "wales",
}


def derive_jurisdiction(country: str | None) -> Jurisdiction | None:
    if country is None:
        return None
    return _COUNTRY_TO_JURISDICTION.get(country.strip().lower())
