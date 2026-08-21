"""Mirror of frontend/src/lib/model/vat.ts (R11, spec Sec 17).

VAT: treatment by charge category, an optional per-line override, the HMRC
return cycle, and the engine that turns them into cash. The pydantic INPUT
models live in types.py (VatTreatment, VatOverride, PurchaseVatInputs,
VatInputs -- same split as areas.py / cost_plan.py). This module re-exports
DEFAULT_VAT, default_vat_treatments and VAT_CHARGE_CATEGORIES so callers have
one import site, and holds `resolve_vat_treatment` -- the ONLY function
anywhere that may read `vat.treatments` or a `vat_override`, mirroring
resolveVatTreatment in vat.ts. See Sec 17.2 and the single-accessor guard in
eslint.config.js / tests/test_accessor_guard.py.
"""
from __future__ import annotations

from dataclasses import dataclass

from .types import (
    DEFAULT_VAT,
    VAT_CHARGE_CATEGORIES,
    EvidenceStatus,
    PurchaseVatInputs,
    RecoveryBasis,
    VatChargeCategory,
    VatInputs,
    VatOverride,
    default_vat_treatments,
)

__all__ = [
    "DEFAULT_VAT",
    "VAT_CHARGE_CATEGORIES",
    "default_vat_treatments",
    "resolve_vat_treatment",
    "is_purchase_vat_chargeable",
    "ResolvedVatTreatment",
    "VatReturnPeriod",
    "vat_return_periods",
]


@dataclass
class ResolvedVatTreatment:
    rate_pct: float
    recoverable_pct: float
    recovery_basis: RecoveryBasis
    evidence_status: EvidenceStatus
    source: str  # 'category' | 'override'


_INERT = ResolvedVatTreatment(
    rate_pct=0, recoverable_pct=0, recovery_basis="unconfirmed",
    evidence_status="unconfirmed", source="category",
)


def resolve_vat_treatment(
    vat: VatInputs,
    category: VatChargeCategory,
    override: VatOverride | None,
) -> ResolvedVatTreatment:
    """THE single read site for `vat.treatments` and for any `vat_override`.
    Adding a second one is a lint failure, not a review comment."""
    if not vat.registered:
        return _INERT
    row = next((t for t in vat.treatments if t.category == category), None)
    if row is None:
        return _INERT
    if override is None:
        return ResolvedVatTreatment(
            rate_pct=row.rate_pct,
            recoverable_pct=row.recoverable_pct,
            recovery_basis=row.recovery_basis,
            evidence_status=row.evidence_status,
            source="category",
        )
    return ResolvedVatTreatment(
        rate_pct=override.rate_pct,
        recoverable_pct=override.recoverable_pct,
        recovery_basis=override.recovery_basis,
        # Evidence stays a category fact. An override that could silently
        # claim 'confirmed' would blind the Sec 17.10 draft gate.
        evidence_status=row.evidence_status,
        source="override",
    )


@dataclass(frozen=True)
class VatReturnPeriod:
    index: int
    first_month: int
    last_month: int
    # None where the reclaim falls outside the modelled term. Never clamped
    # into the final month -- that would manufacture a receipt (Sec 17.4).
    reclaim_month: int | None


def vat_return_periods(vat: VatInputs, term_months: int) -> list[VatReturnPeriod]:
    """Sec 17.4. The first return period covers months 0..first_period_end_month
    inclusive; subsequent periods are one month (monthly) or three months
    (quarterly). VAT incurred anywhere in a period is reclaimed in a single
    amount at period_end + repayment_lag_months. A reclaim falling after the
    final modelled month is reported as None, never clamped into the final
    month -- that would manufacture a receipt the borrower has not had."""
    if not vat.registered:
        return []
    term = max(1, int(term_months))
    length = 3 if vat.return_frequency == "quarterly" else 1
    lag = max(0, int(vat.repayment_lag_months))
    periods: list[VatReturnPeriod] = []
    first = 0
    end = max(0, int(vat.first_period_end_month))
    index = 0
    while first <= term - 1:
        last = min(end, term - 1)
        reclaim = last + lag
        periods.append(VatReturnPeriod(
            index=index,
            first_month=first,
            last_month=last,
            reclaim_month=reclaim if reclaim <= term - 1 else None,
        ))
        first = last + 1
        end = last + length
        index += 1
    return periods


def is_purchase_vat_chargeable(purchase: PurchaseVatInputs) -> bool:
    """Sec 17.7, stated as one biconditional rather than three branches so
    that 'unconfirmed' needs no separate clause: an unconfirmed TOGC is
    charged, which is the prudent case. Where TOGC applies, VAT is nil
    regardless of the option to tax -- that is the whole effect of a TOGC
    (Sec 17.3)."""
    return purchase.vendor_opted_to_tax and purchase.togc_treatment != "applies"
