"""Python mirror of frontend/src/lib/model/*.ts, pinned to the TS engine by
shared golden fixtures (fixtures/financial-model/*.json). This is a disciplined
transliteration, not a redesign -- see docs/financial-model/calculation-specification.md
for the normative spec both implementations must satisfy.
"""
from __future__ import annotations

from dataclasses import dataclass

from .acquisition_tax import (
    TAX_TABLE_VERSION,
    AcquisitionTaxResult,
    calculate_acquisition_tax,
    derive_jurisdiction,
    regime_for,
)
from .areas import (
    AreaBridgeResult,
    area_bridge,
    developed_area_sqm,
    unit_nia_sqm,
)
from .breakeven import PhasedSeniorBreakevenTerms, phased_replay_redeems, solve_senior_breakeven_phased
from .cost_plan import CostPlanResult, compute_cost_plan
from .curves import spread_back_loaded, spread_by_curve, spread_s_curve, spread_user_defined
from .engine import MonthlyModel, run_ledger
from .metrics import AppraisalResultV2, breakeven_flags, derive_metrics
from .migrate import (
    is_v4,
    is_v5,
    is_v6,
    migrate_inputs,
    migrate_inputs_to_v4,
    migrate_inputs_to_v5,
    migrate_inputs_to_v6,
    migrate_v3_to_v4,
    migrate_v4_to_v5,
    migrate_v5_to_v6,
)
from .schedule import Schedule, build_schedule
from .types import (
    CALC_VERSION,
    AcquisitionInputsV5,
    AnyCalculatorInputs,
    AreaBridgeInputs,
    CalculatorInputsV2,
    CalculatorInputsV3,
    CalculatorInputsV4,
    CalculatorInputsV5,
    CalculatorInputsV6,
    CalculatorInputsV7,
    ProposedUnitV6,
    UnitAncillary,
    UnitMixInputsV6,
    parse_calculator_inputs,
)
from .validation import ReconciliationStatus, ValidationIssue, reconcile, validate_inputs


@dataclass
class AppraisalRun:
    # Widened in Release 3a: consumers read the actual document run_appraisal()
    # was given -- v2, v3, v4 or v5 (R8, jurisdiction-aware acquisition tax,
    # spec Sec 14) -- with no downcast to a narrower shape.
    inputs: AnyCalculatorInputs
    schedule: Schedule
    model: MonthlyModel
    metrics: AppraisalResultV2
    validation: list[ValidationIssue]
    reconciliation: ReconciliationStatus


def run_appraisal(inputs: AnyCalculatorInputs) -> AppraisalRun:
    """The only entry point report/backend-parity code may use. Accepts v2
    (pre-Release-2b), v3 (adds the optional lender_valuation block, spec
    Sec 3.2), v4 (adds the optional programme block, spec Sec 6.1) and v5
    (adds jurisdiction, acquisition date and tax override, spec Sec 14, R8)
    documents -- v2 callers get lender-basis metrics as None (spec Sec 2:
    unknown lender-critical inputs are never silently defaulted), exactly as
    they did before the block existed, a v4 document with `programme: None`
    produces a byte-identical schedule to its v3 source, and a document on
    any version before v5 gets acquisition tax computed as England/NI SDLT
    with an unconfirmed basis (spec Sec 14.6), exactly as it did before the
    jurisdiction field existed."""
    schedule = build_schedule(inputs)
    model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
    return AppraisalRun(
        inputs=inputs,
        schedule=schedule,
        model=model,
        metrics=derive_metrics(inputs, schedule, model),
        validation=validate_inputs(inputs),
        reconciliation=reconcile(inputs, schedule, model),
    )


__all__ = [
    "AcquisitionInputsV5",
    "AcquisitionTaxResult",
    "AnyCalculatorInputs",
    "AppraisalResultV2",
    "AppraisalRun",
    "AreaBridgeInputs",
    "AreaBridgeResult",
    "CALC_VERSION",
    "CalculatorInputsV2",
    "CalculatorInputsV3",
    "CalculatorInputsV4",
    "CalculatorInputsV5",
    "CalculatorInputsV6",
    "CalculatorInputsV7",
    "CostPlanResult",
    "MonthlyModel",
    "PhasedSeniorBreakevenTerms",
    "ProposedUnitV6",
    "ReconciliationStatus",
    "Schedule",
    "TAX_TABLE_VERSION",
    "UnitAncillary",
    "UnitMixInputsV6",
    "ValidationIssue",
    "area_bridge",
    "breakeven_flags",
    "build_schedule",
    "calculate_acquisition_tax",
    "compute_cost_plan",
    "derive_jurisdiction",
    "derive_metrics",
    "developed_area_sqm",
    "is_v4",
    "is_v5",
    "is_v6",
    "migrate_inputs",
    "migrate_inputs_to_v4",
    "migrate_inputs_to_v5",
    "migrate_inputs_to_v6",
    "migrate_v3_to_v4",
    "migrate_v4_to_v5",
    "migrate_v5_to_v6",
    "parse_calculator_inputs",
    "phased_replay_redeems",
    "reconcile",
    "regime_for",
    "run_appraisal",
    "run_ledger",
    "solve_senior_breakeven_phased",
    "spread_back_loaded",
    "spread_by_curve",
    "spread_s_curve",
    "spread_user_defined",
    "unit_nia_sqm",
    "validate_inputs",
]
