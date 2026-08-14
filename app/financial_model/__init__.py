"""Python mirror of frontend/src/lib/model/*.ts, pinned to the TS engine by
shared golden fixtures (fixtures/financial-model/*.json). This is a disciplined
transliteration, not a redesign -- see docs/financial-model/calculation-specification.md
for the normative spec both implementations must satisfy.
"""
from __future__ import annotations

from dataclasses import dataclass

from .curves import spread_back_loaded, spread_by_curve, spread_s_curve, spread_user_defined
from .engine import MonthlyModel, run_ledger
from .metrics import AppraisalResultV2, breakeven_flags, derive_metrics
from .migrate import is_v4, migrate_inputs, migrate_inputs_to_v4, migrate_v3_to_v4
from .schedule import Schedule, build_schedule
from .types import (
    CALC_VERSION,
    AnyCalculatorInputs,
    CalculatorInputsV2,
    CalculatorInputsV3,
    CalculatorInputsV4,
    parse_calculator_inputs,
)
from .validation import ReconciliationStatus, ValidationIssue, reconcile, validate_inputs


@dataclass
class AppraisalRun:
    # Widened in Release 3a: consumers read the actual document run_appraisal()
    # was given -- v2, v3 or v4 -- with no downcast to a narrower shape.
    inputs: AnyCalculatorInputs
    schedule: Schedule
    model: MonthlyModel
    metrics: AppraisalResultV2
    validation: list[ValidationIssue]
    reconciliation: ReconciliationStatus


def run_appraisal(inputs: AnyCalculatorInputs) -> AppraisalRun:
    """The only entry point report/backend-parity code may use. Accepts v2
    (pre-Release-2b), v3 (adds the optional lender_valuation block, spec
    Sec 3.2) and v4 (adds the optional programme block, spec Sec 6.1)
    documents -- v2 callers get lender-basis metrics as None (spec Sec 2:
    unknown lender-critical inputs are never silently defaulted), exactly as
    they did before the block existed, and a v4 document with
    `programme: None` produces a byte-identical schedule to its v3 source."""
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
    "AnyCalculatorInputs",
    "AppraisalResultV2",
    "AppraisalRun",
    "CALC_VERSION",
    "CalculatorInputsV2",
    "CalculatorInputsV3",
    "CalculatorInputsV4",
    "MonthlyModel",
    "ReconciliationStatus",
    "Schedule",
    "ValidationIssue",
    "breakeven_flags",
    "build_schedule",
    "derive_metrics",
    "is_v4",
    "migrate_inputs",
    "migrate_inputs_to_v4",
    "migrate_v3_to_v4",
    "parse_calculator_inputs",
    "reconcile",
    "run_appraisal",
    "run_ledger",
    "spread_back_loaded",
    "spread_by_curve",
    "spread_s_curve",
    "spread_user_defined",
    "validate_inputs",
]
