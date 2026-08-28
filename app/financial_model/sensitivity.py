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
from .types import AnyCalculatorInputs, ProgrammeNetwork, ScenarioOverrides
from .validation import ValidationIssue, validate_inputs

SensitivityLever = Literal[
    "gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
    "exit_yield", "operating_cost", "vacancy", "sales_slip",
    "saleable_area", "abnormal_cost", "programme_slip", "refi_ltv",
]

# Spec Sec 12.4 tie-break order, making the tornado sort total and so deterministic
# (Sec 1.4). R12 spec Sec 18.9 appended the fifth lever, phase_slip, at the end -- it
# is the newest and lowest-priority tie-break, not a reordering of the four Sec 12.1
# levers. R13 spec Sec 19.8 appends the three investment-case levers the same way.
# R13b spec Sec 22.8 appends the ninth lever, sales_slip, last again -- same rule.
# R16 spec Sec 25.1 appends the four stress-pack levers, last again -- and
# from R16 this order ALSO drives the order _measure applies a cell's
# settings in (Sec 12.1's composition rule for saleable_area -> gdv): _measure
# applies settings in REVERSE of this order, so gdv (index 0 here) is applied
# last -- see _measure's own comment.
LEVER_ORDER: tuple[SensitivityLever, ...] = (
    "gdv", "construction_cost", "timeline", "interest_rate", "phase_slip",
    "exit_yield", "operating_cost", "vacancy", "sales_slip",
    "saleable_area", "abnormal_cost", "programme_slip", "refi_ltv",
)

# Spec Sec 12.6: an axis is capped at nine steps, bounding the suite at 81 cells.
MAX_AXIS_STEPS = 9


@dataclass
class SensitivityAxis:
    lever: SensitivityLever
    # In the lever's own unit: percent for gdv/construction_cost, months for
    # timeline/phase_slip, percentage points for interest_rate.
    steps: list[float]
    # R12 spec Sec 18.9. Required (non-None) exactly when lever == "phase_slip", and
    # required to be None otherwise -- both hard validation errors under Sec 12.6
    # (validate_sensitivity_config). Defaulted to None, mirroring the TS twin's
    # optional `phase_id?`, so every pre-R12 construction site keeps working
    # unmodified.
    phase_id: str | None = None


@dataclass
class TornadoRange:
    lever: SensitivityLever
    low: float
    high: float
    # Same rule as SensitivityAxis.phase_id above.
    phase_id: str | None = None


def _lever_key(a: SensitivityAxis | TornadoRange) -> str:
    """Pair-keys a lever with its target so two phase_slip positions aiming at
    different phases compare as distinct (Sec 18.9) while every other lever --
    whose phase_id is always None -- still compares on the lever name alone."""
    return f"{a.lever}:{a.phase_id or ''}"


@dataclass
class SensitivityConfig:
    rows: SensitivityAxis
    cols: SensitivityAxis
    tornado: list[TornadoRange]


@dataclass
class SensitivityMetrics:
    """The metric reduction of one appraisal (Sec 12.3), or the record of why no appraisal
    was run (Sec 12.7). `validation_errors` is empty exactly when the position was
    measured; it carries error-severity issues only, so a measured document that merely
    raises warnings still reports an empty list.

    Every metric field is nullable. The four percentages already were; R5 widened the two
    money fields so an unmeasured position cannot present a number at all.
    """

    profit_pence: int | None
    profit_on_cost_pct: float | None
    profit_on_gdv_pct: float | None
    irr_annual_pct: float | None
    ltgdv_developer_pct: float | None
    peak_debt_pence: int | None
    flags: list[str]
    validation_errors: list[ValidationIssue]


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
    span_pence: int | None  # |profit(high) - profit(low)|, spec Sec 12.4; null when either endpoint is unmeasured (Sec 12.7)
    # Echoes the configured range's target (Sec 18.9); None for every non-phase_slip lever.
    phase_id: str | None = None


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


def _network_phase_ids(inputs: AnyCalculatorInputs | None) -> set[str]:
    """The set of phase ids the document's programme network carries, or empty when
    programme is None or the legacy {packages} shape -- both cases where a phase_slip
    axis has no field it could possibly write to (Sec 18.9)."""
    if inputs is None:
        return set()
    programme = getattr(inputs, "programme", None)
    if isinstance(programme, ProgrammeNetwork):
        return {p.id for p in programme.phases}
    return set()


def validate_sensitivity_config(
    config: SensitivityConfig,
    inputs: AnyCalculatorInputs | None = None,
) -> list[ValidationIssue]:
    """Spec Sec 12.6, extended by Sec 18.9/18.8 for the phase_slip lever's target.
    Returns error-severity issues; an empty list means usable.

    `inputs` is optional so every pre-R12 caller keeps working exactly as before;
    passing it additionally checks a phase_slip axis or tornado range names a phase
    the document actually carries. run_sensitivity always passes it.
    """
    issues: list[ValidationIssue] = []
    phase_ids = _network_phase_ids(inputs)

    for name, axis in (("rows", config.rows), ("cols", config.cols)):
        # Spec Sec 12.6: an axis lever must be one of the nine Sec 12.1/18.9/19.8/22.8 levers.
        # LEVER_ORDER is the closed set -- this is what stops a bad-cased or
        # misspelled lever from crashing later inside LEVER_ORDER.index() in
        # run_sensitivity (the TS mirror instead silently no-ops that axis, so this
        # check is what keeps the two engines agreeing on the same input error rather
        # than on a wrong answer).
        if axis.lever not in LEVER_ORDER:
            issues.append(ValidationIssue(severity="error", field=f"sensitivity.{name}.lever",
                                          message=f'Unknown lever "{axis.lever}".'))

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
        # int() narrowing of timeline_adjustment_months safe. Sec 18.9 extends the same
        # rule to phase_slip: slip_months is a whole month count too. R13b spec Sec 22.8
        # extends it again to sales_slip.
        if axis.lever in ("timeline", "phase_slip", "sales_slip", "programme_slip") and any(
            not isfinite(s) or not float(s).is_integer() for s in axis.steps
        ):
            # Fix round 1, Finding 5: worded per the actual offending lever, not a
            # fixed "Timeline" -- this surfaces verbatim in a lender-facing UI.
            label = "Timeline steps" if axis.lever == "timeline" else f"{axis.lever} steps"
            issues.append(ValidationIssue(severity="error", field=field_name,
                                          message=f"{label} must be whole months."))

    # Sec 18.8/18.9: phase_id is required exactly when the axis is phase_slip, and
    # forbidden otherwise.
    for name, axis in (("rows", config.rows), ("cols", config.cols)):
        field_name = f"sensitivity.{name}.phase_id"
        if axis.lever == "phase_slip":
            if axis.phase_id is None:
                issues.append(ValidationIssue(
                    severity="error", field=field_name,
                    message="A phase_slip axis needs a phase_id naming the phase it slips."))
            elif inputs is not None and axis.phase_id not in phase_ids:
                issues.append(ValidationIssue(
                    severity="error", field=field_name,
                    message=f'A phase_slip axis references phase "{axis.phase_id}", but '
                            f'there is no phase with id "{axis.phase_id}".'))
        elif axis.phase_id is not None:
            issues.append(ValidationIssue(
                severity="error", field=field_name,
                message=f'phase_id is only meaningful for the phase_slip lever, not "{axis.lever}".'))

    # Sec 18.9: the "rows and cols must differ" rule compares the PAIR (lever,
    # phase_id), not the lever alone -- two phase_slip axes targeting different
    # phases are a legitimate matrix, not a duplicate.
    if _lever_key(config.rows) == _lever_key(config.cols):
        # Fix round 1, Finding 5: two identical-lever axes and two same-phase
        # phase_slip axes are different mistakes, and the message now says so.
        if config.rows.lever == "phase_slip" and config.cols.lever == "phase_slip":
            message = (
                "Two phase_slip axes must target different phases (the row and "
                "column axes must use different levers, or different phase_slip "
                "targets)."
            )
        else:
            message = "The row and column axes must use different levers."
        issues.append(ValidationIssue(severity="error", field="sensitivity.cols.lever",
                                      message=message))

    seen: set[str] = set()
    for rng in config.tornado:
        # Spec Sec 12.6, same closed-set rule as the axes above.
        if rng.lever not in LEVER_ORDER:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f'Unknown lever "{rng.lever}".'))
        # Sec 18.9: the tornado's duplicate-lever check keys the same pair as the axis
        # check above, so a tornado may carry one bar per slipped phase.
        if _lever_key(rng) in seen:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f"Lever {rng.lever} appears more than once in the tornado."))
        seen.add(_lever_key(rng))
        if not isfinite(rng.low) or not isfinite(rng.high) or rng.low >= rng.high:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f"Tornado range for {rng.lever} needs finite low < high."))
        # Spec Sec 12.6, same whole-month rule as the axes above; Sec 18.9 extends it
        # to phase_slip, and R13b spec Sec 22.8 extends it again to sales_slip.
        if rng.lever in ("timeline", "phase_slip", "sales_slip", "programme_slip") and not (
            float(rng.low).is_integer() and float(rng.high).is_integer()
        ):
            # Fix round 1, Finding 5: same rewording as the axis rule above.
            label = "Timeline bounds" if rng.lever == "timeline" else f"{rng.lever} bounds"
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f"{label} must be whole months."))
        # Sec 18.8/18.9, same pairing rule as the axes above.
        if rng.lever == "phase_slip":
            if rng.phase_id is None:
                issues.append(ValidationIssue(
                    severity="error", field="sensitivity.tornado",
                    message="A phase_slip tornado range needs a phase_id naming the phase it slips."))
            elif inputs is not None and rng.phase_id not in phase_ids:
                issues.append(ValidationIssue(
                    severity="error", field="sensitivity.tornado",
                    message=f'A phase_slip tornado range references phase "{rng.phase_id}", '
                            f'but there is no phase with id "{rng.phase_id}".'))
        elif rng.phase_id is not None:
            issues.append(ValidationIssue(
                severity="error", field="sensitivity.tornado",
                message=f'phase_id is only meaningful for the phase_slip lever, not "{rng.lever}".'))

    return issues


@dataclass
class _LeverSetting:
    """One lever's setting for a single measurement: the lever, its magnitude in the
    lever's own unit, and -- for phase_slip only -- the phase it targets. Sec 18.9 is
    why _measure takes a LIST of these rather than the pre-R12 dict[str, float]: a
    matrix whose rows AND cols are both phase_slip (targeting different phases, per
    the pair-keyed duplicate check above) needs to carry TWO simultaneous phase_slip
    settings, and a single "phase_slip" dict key can hold only one."""

    lever: SensitivityLever
    phase_id: str | None
    value: float


def _zero_scenario() -> ScenarioOverrides:
    """A true no-op scenario: every lever at its identity value. Applied once at
    the START of every measurement -- including the base case, whose `settings`
    is [] -- so _measure always routes through apply_scenario at least once (fix
    round 1, Finding 6). Without this, the base case bypassed apply_scenario
    entirely and the Sec 12.5 "base case is the unadjusted appraisal" test
    stopped exercising apply_scenario's own zero-value arithmetic. A factory,
    not a module-level constant, so a caller mutating the returned dataclass
    cannot poison later calls -- mirrors _default_config()'s own reasoning."""
    return ScenarioOverrides(
        label="",
        gdv_adjustment_pct=0,
        construction_cost_adjustment_pct=0,
        timeline_adjustment_months=0,
        interest_rate_adjustment_pct=0,
        phase_slip_phase_id=None,
        phase_slip_months=0,
        exit_yield_adjustment_pct=0,
        operating_cost_adjustment_pct=0,
        vacancy_adjustment_pct=0,
        sales_slip_months=0,
        saleable_area_adjustment_pct=0,
        abnormal_cost_adjustment_pct=0,
        programme_slip_months=0,
        refi_ltv_adjustment_pct=0,
    )


def _overrides_for(setting: _LeverSetting) -> ScenarioOverrides:
    """Builds the single-lever ScenarioOverrides for one setting. Every field the
    setting's own lever does not own is left at its no-op value (Sec 12.1: the five
    levers write to disjoint fields), so applying several settings in sequence via
    apply_scenario composes correctly regardless of order (Sec 18.9 guard 7)."""
    return ScenarioOverrides(
        label="",
        gdv_adjustment_pct=setting.value if setting.lever == "gdv" else 0,
        construction_cost_adjustment_pct=setting.value if setting.lever == "construction_cost" else 0,
        timeline_adjustment_months=setting.value if setting.lever == "timeline" else 0,
        interest_rate_adjustment_pct=setting.value if setting.lever == "interest_rate" else 0,
        phase_slip_phase_id=setting.phase_id if setting.lever == "phase_slip" else None,
        phase_slip_months=int(setting.value) if setting.lever == "phase_slip" else 0,
        exit_yield_adjustment_pct=setting.value if setting.lever == "exit_yield" else 0,
        operating_cost_adjustment_pct=setting.value if setting.lever == "operating_cost" else 0,
        vacancy_adjustment_pct=setting.value if setting.lever == "vacancy" else 0,
        sales_slip_months=int(setting.value) if setting.lever == "sales_slip" else 0,
        saleable_area_adjustment_pct=setting.value if setting.lever == "saleable_area" else 0,
        abnormal_cost_adjustment_pct=setting.value if setting.lever == "abnormal_cost" else 0,
        programme_slip_months=int(setting.value) if setting.lever == "programme_slip" else 0,
        refi_ltv_adjustment_pct=setting.value if setting.lever == "refi_ltv" else 0,
    )


def _unmeasured(errors: list[ValidationIssue]) -> SensitivityMetrics:
    """The record of a position that was not measured (Sec 12.7)."""
    return SensitivityMetrics(
        profit_pence=None,
        profit_on_cost_pct=None,
        profit_on_gdv_pct=None,
        irr_annual_pct=None,
        ltgdv_developer_pct=None,
        peak_debt_pence=None,
        flags=[],
        validation_errors=errors,
    )


def _measure(inputs: AnyCalculatorInputs, settings: list[_LeverSetting]) -> SensitivityMetrics:
    """One position: the levered document is validated first (Sec 12.7), and only a
    document that passes is appraised. An unmeasured position never reaches the ledger.

    `settings` is applied via apply_scenario once per setting, in order, ON TOP OF a
    leading _zero_scenario() pass -- never combined into one ScenarioOverrides --
    precisely because two settings can both be phase_slip (Sec 18.9) and a single
    overrides object cannot carry two simultaneous targets. Every setting's own lever
    is disjoint from every other's field (Sec 12.1), so the sequential application
    composes exactly as one combined call would for the four scalar levers, and
    correctly for two different phase_slip targets besides. The leading zero pass
    means the base case (settings == []) still goes through apply_scenario exactly
    once, the same as every levered position.
    """
    from app.financial_model import run_appraisal  # local import: see module docstring

    levered = apply_scenario(inputs, _zero_scenario())
    # R16 spec Sec 12.1: settings are applied in REVERSE LEVER_ORDER, not
    # caller order -- gdv is index 0 (LEVER_ORDER's highest tie-break
    # priority) and is therefore applied LAST here. saleable_area and gdv
    # share estimated_value_pence and Sec 12.1's stated composition is area
    # first, then gdv (each rounding once, see apply_scenario.py); applying
    # in reverse LEVER_ORDER is what achieves that, since saleable_area (index
    # 9) then sorts ahead of gdv. Sorting (stable) also makes a cell identical
    # whichever axis is the row. For the nine disjoint levers -- every pair
    # other than (gdv, saleable_area) -- the direction changes nothing, since
    # each setting writes its own field: the v15 identity gate asserts exactly
    # that.
    for setting in sorted(settings, key=lambda s: LEVER_ORDER.index(s.lever), reverse=True):
        levered = apply_scenario(levered, _overrides_for(setting))
    errors = [i for i in validate_inputs(levered) if i.severity == "error"]
    if errors:
        return _unmeasured(errors)

    m = run_appraisal(levered).metrics
    return SensitivityMetrics(
        profit_pence=m.profit_pence,
        profit_on_cost_pct=m.profit_on_cost_pct,
        profit_on_gdv_pct=m.profit_on_gdv_pct,
        irr_annual_pct=m.irr_annual_pct,
        ltgdv_developer_pct=m.ltgdv_developer_pct,
        peak_debt_pence=m.peak_debt_pence,
        flags=[f.code for f in m.flags],
        validation_errors=[],
    )


class InvalidSensitivityConfigError(ValueError):
    """Sec 12.6: the axes/tornado config does not describe a runnable grid.

    Mirrors InvalidSensitivityConfigError in frontend/src/lib/model/sensitivity.ts.
    Subclasses ValueError so existing `except ValueError` sites keep working; the
    type is the contract, the message text is not.
    """


class InvalidBaseDocumentError(ValueError):
    """Sec 12.7: the base document itself fails validation, so no position in the
    suite is meaningful (Sec 12.5 makes the base case an identity with the
    unadjusted appraisal).

    Mirrors InvalidBaseDocumentError in frontend/src/lib/model/sensitivity.ts.
    """


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

    # Sec 18.9: passing inputs activates the phase-existence check, so a phase_slip
    # axis naming a phase this document does not carry is rejected here rather than
    # reaching _measure and failing every cell identically.
    issues = validate_sensitivity_config(config, inputs)
    if issues:
        # Deduplicated: e.g. both axes missing a step raises the identical "An axis
        # needs at least one step." issue twice, and repeating it says nothing extra.
        messages = dict.fromkeys(i.message for i in issues)
        raise InvalidSensitivityConfigError(
            "Invalid sensitivity config: " + " ".join(messages)
        )

    base = _measure(inputs, [])
    # Sec 12.5 makes the base case an identity with the unadjusted appraisal, so a suite
    # over an invalid base is meaningless in every position at once -- an input error
    # (Sec 12.6/12.7), not twenty-five unmeasured cells.
    if base.validation_errors:
        # Deduplicated for the same reason as the config message above: validate_inputs
        # emits one issue per offending element (e.g. one per phased-sales tranche) and
        # those issues carry an identical message.
        messages = dict.fromkeys(e.message for e in base.validation_errors)
        raise InvalidBaseDocumentError(
            "Invalid base document: " + " ".join(messages)
        )

    matrix: list[list[SensitivityCell]] = []
    for row_step in config.rows.steps:
        row: list[SensitivityCell] = []
        for col_step in config.cols.steps:
            m = _measure(inputs, [
                _LeverSetting(lever=config.rows.lever, phase_id=config.rows.phase_id, value=row_step),
                _LeverSetting(lever=config.cols.lever, phase_id=config.cols.phase_id, value=col_step),
            ])
            row.append(SensitivityCell(
                profit_pence=m.profit_pence,
                profit_on_cost_pct=m.profit_on_cost_pct,
                profit_on_gdv_pct=m.profit_on_gdv_pct,
                irr_annual_pct=m.irr_annual_pct,
                ltgdv_developer_pct=m.ltgdv_developer_pct,
                peak_debt_pence=m.peak_debt_pence,
                flags=m.flags,
                validation_errors=m.validation_errors,
                row_step=row_step,
                col_step=col_step,
            ))
        matrix.append(row)

    bars = []
    for rng in config.tornado:
        low = _measure(inputs, [_LeverSetting(lever=rng.lever, phase_id=rng.phase_id, value=rng.low)])
        high = _measure(inputs, [_LeverSetting(lever=rng.lever, phase_id=rng.phase_id, value=rng.high)])
        # Sec 12.7: an unmeasured endpoint leaves the bar with no span at all.
        span = (
            None
            if low.profit_pence is None or high.profit_pence is None
            else abs(high.profit_pence - low.profit_pence)
        )
        bars.append(TornadoBar(
            lever=rng.lever,
            phase_id=rng.phase_id,
            low_step=rng.low,
            high_step=rng.high,
            low=low,
            high=high,
            span_pence=span,
        ))
    # Sec 12.4 extended by Sec 12.7: spanless bars sort after every bar with a span; the
    # fixed lever order keeps the sort total within each group (Sec 1.4). Sec 18.9
    # extends the tie-break with the phase target, so two phase_slip bars (same lever,
    # different phase) still sort into a total, caller-order-independent order.
    bars.sort(key=lambda b: (
        b.span_pence is None,
        -b.span_pence if b.span_pence is not None else 0,
        LEVER_ORDER.index(b.lever),
        b.phase_id or "",
    ))

    return SensitivityResult(base=base, matrix=matrix, tornado=bars, config=config)
