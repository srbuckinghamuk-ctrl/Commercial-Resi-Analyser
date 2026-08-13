"""Python mirror of frontend/src/lib/model/*.ts, pinned to the TS engine by
shared golden fixtures (fixtures/financial-model/*.json). This is a disciplined
transliteration, not a redesign -- see docs/financial-model/calculation-specification.md
for the normative spec both implementations must satisfy.
"""
from __future__ import annotations

from dataclasses import dataclass

from .engine import MonthlyModel, run_ledger
from .metrics import AppraisalResultV2, derive_metrics
from .migrate import migrate_inputs
from .schedule import Schedule, build_schedule
from .types import CalculatorInputsV2
from .validation import ReconciliationStatus, ValidationIssue, reconcile, validate_inputs

CALC_VERSION = "2.0.0"


@dataclass
class AppraisalRun:
    inputs: CalculatorInputsV2
    schedule: Schedule
    model: MonthlyModel
    metrics: AppraisalResultV2
    validation: list[ValidationIssue]
    reconciliation: ReconciliationStatus


def run_appraisal(inputs: CalculatorInputsV2) -> AppraisalRun:
    """The only entry point report/backend-parity code may use."""
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
    "AppraisalRun",
    "CALC_VERSION",
    "run_appraisal",
    "run_ledger",
    "derive_metrics",
    "migrate_inputs",
    "build_schedule",
    "reconcile",
    "validate_inputs",
]
