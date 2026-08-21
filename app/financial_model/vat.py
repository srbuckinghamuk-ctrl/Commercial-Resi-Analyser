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


def is_purchase_vat_chargeable(purchase: PurchaseVatInputs) -> bool:
    """Sec 17.7, stated as one biconditional rather than three branches so
    that 'unconfirmed' needs no separate clause: an unconfirmed TOGC is
    charged, which is the prudent case. Where TOGC applies, VAT is nil
    regardless of the option to tax -- that is the whole effect of a TOGC
    (Sec 17.3)."""
    return purchase.vendor_opted_to_tax and purchase.togc_treatment != "applies"
