"""Port of frontend/src/lib/model/sensitivity.ts.

The fixed-facility sensitivity suite of spec Sec 12. Every cell and every tornado
endpoint is one ordinary appraisal of the base document with levers applied per
Sec 12.1; the committed facility and equity sources are never adjusted (Sec 12.2), so
a cell that would need more debt raises facility_exceeded/funding_gap rather than
receiving it.

This module imports run_appraisal from the package root. app/financial_model/__init__.py
must therefore never import this module -- consumers import
app.financial_model.sensitivity directly.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from typing import Literal

from .apply_scenario import apply_scenario
from .types import AnyCalculatorInputs, ScenarioOverrides
from .validation import ValidationIssue

SensitivityLever = Literal["gdv", "construction_cost", "timeline", "interest_rate"]

# Spec Sec 12.4 tie-break order, making the tornado sort total and so deterministic (Sec 1.4).
LEVER_ORDER: tuple[SensitivityLever, ...] = ("gdv", "construction_cost", "timeline", "interest_rate")

# Spec Sec 12.6: an axis is capped at nine steps, bounding the suite at 81 cells.
MAX_AXIS_STEPS = 9


@dataclass
class SensitivityAxis:
    lever: SensitivityLever
    # In the lever's own unit: percent for gdv/construction_cost, months for timeline,
    # percentage points for interest_rate.
    steps: list[float]


@dataclass
class TornadoRange:
    lever: SensitivityLever
    low: float
    high: float


@dataclass
class SensitivityConfig:
    rows: SensitivityAxis
    cols: SensitivityAxis
    tornado: list[TornadoRange]


@dataclass
class SensitivityMetrics:
    profit_pence: int
    profit_on_cost_pct: float | None
    profit_on_gdv_pct: float | None
    irr_annual_pct: float | None
    ltgdv_developer_pct: float | None
    peak_debt_pence: int
    flags: list[str]


@dataclass
class SensitivityCell(SensitivityMetrics):
    row_step: float = 0
    col_step: float = 0


@dataclass
class TornadoBar:
    lever: SensitivityLever
    low_step: float
    high_step: float
    low: SensitivityMetrics
    high: SensitivityMetrics
    span_pence: int  # |profit(high) - profit(low)|, spec Sec 12.4


@dataclass
class SensitivityResult:
    base: SensitivityMetrics
    matrix: list[list[SensitivityCell]]
    tornado: list[TornadoBar]
    config: SensitivityConfig


def _default_config() -> SensitivityConfig:
    """Spec Sec 12.3 and Sec 12.4. Built by a factory rather than held as a module-level
    mutable so a caller cannot adjust the defaults for the whole process."""
    return SensitivityConfig(
        rows=SensitivityAxis(lever="construction_cost", steps=[-5, 0, 5, 10, 15]),
        cols=SensitivityAxis(lever="gdv", steps=[-15, -10, -5, 0, 5]),
        tornado=[
            TornadoRange(lever="gdv", low=-10, high=10),
            TornadoRange(lever="construction_cost", low=-10, high=10),
            TornadoRange(lever="timeline", low=-3, high=3),
            TornadoRange(lever="interest_rate", low=-1, high=1),
        ],
    )


DEFAULT_SENSITIVITY_CONFIG = _default_config()


def validate_sensitivity_config(config: SensitivityConfig) -> list[ValidationIssue]:
    """Spec Sec 12.6. Returns error-severity issues; an empty list means usable."""
    issues: list[ValidationIssue] = []

    for name, axis in (("rows", config.rows), ("cols", config.cols)):
        field_name = f"sensitivity.{name}.steps"
        if len(axis.steps) == 0:
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message="An axis needs at least one step."))
        if len(axis.steps) > MAX_AXIS_STEPS:
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message=f"An axis takes at most {MAX_AXIS_STEPS} steps."))
        if any(not isfinite(s) for s in axis.steps):
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message="Every step must be a finite number."))
        # Spec Sec 12.6: the engine is month-indexed (Sec 1.3), so a fractional term has
        # no meaning in the ledger. This rule is also what makes apply_scenario.py's
        # int() narrowing of timeline_adjustment_months safe.
        if axis.lever == "timeline" and any(
            not isfinite(s) or not float(s).is_integer() for s in axis.steps
        ):
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message="Timeline steps must be whole months."))

    if config.rows.lever == config.cols.lever:
        issues.append(ValidationIssue(severity="error", field="sensitivity.cols.lever",
                                      message="The row and column axes must use different levers."))

    seen: set[str] = set()
    for rng in config.tornado:
        if rng.lever in seen:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f"Lever {rng.lever} appears more than once in the tornado."))
        seen.add(rng.lever)
        if not isfinite(rng.low) or not isfinite(rng.high) or rng.low >= rng.high:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f"Tornado range for {rng.lever} needs finite low < high."))
        # Spec Sec 12.6, same whole-month rule as the axes above.
        if rng.lever == "timeline" and not (
            float(rng.low).is_integer() and float(rng.high).is_integer()
        ):
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message="Timeline bounds must be whole months."))

    return issues


def _overrides_for(levers: dict[str, float]) -> ScenarioOverrides:
    """Levers not named sit at zero, which Sec 12.1 guarantees is a no-op because the
    four levers write to disjoint fields."""
    return ScenarioOverrides(
        label="",
        gdv_adjustment_pct=levers.get("gdv", 0),
        construction_cost_adjustment_pct=levers.get("construction_cost", 0),
        timeline_adjustment_months=levers.get("timeline", 0),
        interest_rate_adjustment_pct=levers.get("interest_rate", 0),
    )


def _measure(inputs: AnyCalculatorInputs, levers: dict[str, float]) -> SensitivityMetrics:
    """One measurement: an ordinary appraisal of the levered document, reduced to the
    compact record. The only place the suite calls the engine."""
    from app.financial_model import run_appraisal  # local import: see module docstring

    m = run_appraisal(apply_scenario(inputs, _overrides_for(levers))).metrics
    return SensitivityMetrics(
        profit_pence=m.profit_pence,
        profit_on_cost_pct=m.profit_on_cost_pct,
        profit_on_gdv_pct=m.profit_on_gdv_pct,
        irr_annual_pct=m.irr_annual_pct,
        ltgdv_developer_pct=m.ltgdv_developer_pct,
        peak_debt_pence=m.peak_debt_pence,
        flags=[f.code for f in m.flags],
    )


def run_sensitivity(
    inputs: AnyCalculatorInputs,
    config: SensitivityConfig | None = None,
) -> SensitivityResult:
    """The fixed-facility sensitivity suite (spec Sec 12). Runs rows x cols matrix
    appraisals, two per tornado range, and one base -- 34 with the default config.

    Raises ValueError on an invalid config (Sec 12.6): a partially-valid grid is a
    misleading grid. Callers wanting to display the reason call
    validate_sensitivity_config first.
    """
    if config is None:
        config = _default_config()

    issues = validate_sensitivity_config(config)
    if issues:
        raise ValueError("Invalid sensitivity config: " + " ".join(i.message for i in issues))

    base = _measure(inputs, {})

    matrix: list[list[SensitivityCell]] = []
    for row_step in config.rows.steps:
        row: list[SensitivityCell] = []
        for col_step in config.cols.steps:
            m = _measure(inputs, {config.rows.lever: row_step, config.cols.lever: col_step})
            row.append(SensitivityCell(
                profit_pence=m.profit_pence,
                profit_on_cost_pct=m.profit_on_cost_pct,
                profit_on_gdv_pct=m.profit_on_gdv_pct,
                irr_annual_pct=m.irr_annual_pct,
                ltgdv_developer_pct=m.ltgdv_developer_pct,
                peak_debt_pence=m.peak_debt_pence,
                flags=m.flags,
                row_step=row_step,
                col_step=col_step,
            ))
        matrix.append(row)

    bars = []
    for rng in config.tornado:
        low = _measure(inputs, {rng.lever: rng.low})
        high = _measure(inputs, {rng.lever: rng.high})
        bars.append(TornadoBar(
            lever=rng.lever,
            low_step=rng.low,
            high_step=rng.high,
            low=low,
            high=high,
            span_pence=abs(high.profit_pence - low.profit_pence),
        ))
    bars.sort(key=lambda b: (-b.span_pence, LEVER_ORDER.index(b.lever)))

    return SensitivityResult(base=base, matrix=matrix, tornado=bars, config=config)
