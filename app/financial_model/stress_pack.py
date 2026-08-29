"""Port of frontend/src/lib/model/stress-pack.ts.

The standard lender stress pack of spec Sec 25: nine named stresses, each
one Sec 12.5 cell of the base document, run through sensitivity._measure.
Like sensitivity.py this module imports run_appraisal-adjacent helpers
lazily; app/financial_model/__init__.py must never import it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .engine import money_round
from .sensitivity import (
    InvalidBaseDocumentError, SensitivityLever, SensitivityMetrics, _LeverSetting, _measure,
)
from .types import AnyCalculatorInputs, ProgrammeNetwork

StressKey = Literal[
    "unit_loss", "area_reduction", "abnormal_cost", "slower_absorption", "delayed_start",
    "yield_expansion", "lower_refi_ltv", "opex_vacancy", "risks_crystallise",
]


@dataclass(frozen=True)
class StressDefinition:
    key: StressKey
    label: str
    # (lever, value); a None value is DERIVED from the document (Sec 25.3).
    settings: tuple[tuple[SensitivityLever, float | None], ...]


# Sec 25.2. Closed, normative order, normative magnitudes.
STRESS_PACK: tuple[StressDefinition, ...] = (
    StressDefinition("unit_loss", "One unit lost", (("saleable_area", None),)),
    StressDefinition("area_reduction", "Saleable area -5%", (("saleable_area", -5.0),)),
    StressDefinition("abnormal_cost", "Abnormal cost +10%", (("abnormal_cost", 10.0),)),
    StressDefinition("slower_absorption", "Sales six months slower", (("sales_slip", 6.0),)),
    StressDefinition("delayed_start", "Start / PC six months late", (("programme_slip", 6.0),)),
    StressDefinition("yield_expansion", "Exit yield +100 bp", (("exit_yield", 1.0),)),
    StressDefinition("lower_refi_ltv", "Refinance LTV -10 pp", (("refi_ltv", 10.0),)),
    StressDefinition("opex_vacancy", "Opex +10%, vacancy +5 pp", (("operating_cost", 10.0), ("vacancy", 5.0))),
    StressDefinition("risks_crystallise", "Recorded risks crystallise",
                     (("construction_cost", None), ("programme_slip", None))),
)


def _round12(x: float) -> float:
    """Sec 25.3: the same 12-dp rule package_timing.py uses for the midpoint."""
    return money_round(x * 1e12) / 1e12


@dataclass
class StressSetting:
    lever: SensitivityLever
    value: float
    phase_id: str | None = None  # always None: no pack lever carries a target


@dataclass
class StressDerivation:
    cost_impact_pence: int
    base_build_pence: int
    cost_pct: float | None          # Sec 25.3 p, or None when the cost half is inapplicable
    programme_impact_months: int     # the SUM
    programme_impact_max_months: int | None
    stated_item_count: int           # assessed items with a non-null cost impact


@dataclass
class ResolvedStress:
    key: StressKey
    label: str
    settings: list[StressSetting]
    derivation: StressDerivation | None
    applicable: bool
    note: str | None


@dataclass
class StressResult(ResolvedStress):
    metrics: SensitivityMetrics = field(default=None)  # type: ignore[assignment]
    delta_profit_pence: int | None = None


@dataclass
class StressPackResult:
    base: SensitivityMetrics
    stresses: list[StressResult]


# The notes, ASCII only, byte-identical in stress-pack.ts.
NOTE_NO_UNITS = "The unit mix is empty, so there is no saleable area to reduce."
NOTE_NO_COST_PLAN = "This document has no cost plan, so there is no abnormal contingency class to stress."
NOTE_NO_ABNORMAL_PACKAGE = "No package carries the abnormal contingency class, so the stress has nothing to attach to."
NOTE_NO_LEDGER = "No unit-sales ledger is modelled, so there is no completion date to slip."
NOTE_NO_NETWORK = "The programme is not a precedence network, so there is no phase to slip."
NOTE_NO_INVESTMENT_CASE = "No investment case is modelled, so there is no take-out to stress."
NOTE_NO_COST_IMPACT = "No assessed due-diligence item states a cost impact."
NOTE_NO_BASE_BUILD = "The base build is zero, so a cost impact has no base to scale."
NOTE_NO_PROGRAMME_IMPACT = "No assessed due-diligence item states a programme impact."
NOTE_NO_NETWORK_FOR_IMPACT = "The programme is not a precedence network, so the programme impact has no phase to slip."


def _facts(inputs: AnyCalculatorInputs) -> dict:
    from app.financial_model import compute_cost_plan, developed_area_sqm  # lazy: see module docstring
    cost_plan = getattr(inputs, "cost_plan", None)
    programme = getattr(inputs, "programme", None)
    network = programme if isinstance(programme, ProgrammeNetwork) and programme.phases else None
    unit_sales = getattr(inputs, "unit_sales", None)
    dd = getattr(inputs, "due_diligence", None)
    assessed = [i for i in (dd.items if dd is not None else []) if i.status in ("red", "amber")]
    costed = [i for i in assessed if i.cost_impact_pence is not None]
    months = [i.programme_impact_months for i in assessed if i.programme_impact_months is not None]
    result = compute_cost_plan(inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units))
    return {
        "n_units": len(inputs.unit_mix.units),
        "cost_plan": cost_plan,
        "has_abnormal_base": cost_plan is not None and any(c.name == "abnormal" for c in cost_plan.contingency) and (
            cost_plan.mode == "headline" or any(p.contingency_class == "abnormal" for p in cost_plan.packages)
        ),
        "has_ledger": unit_sales is not None and len(unit_sales.units) > 0,
        "network": network,
        "has_investment_case": getattr(inputs, "investment_case", None) is not None,
        "sum_cost": sum(i.cost_impact_pence for i in costed),
        "stated_item_count": len(costed),
        "sum_months": sum(months),
        "max_months": max(months) if months else None,
        "base_build": result.base_build_pence,
    }


def resolve_stress(inputs: AnyCalculatorInputs, definition: StressDefinition) -> ResolvedStress:
    """Sec 25.3 derivations and Sec 25.4 applicability, from the base document
    alone. An inapplicable stress keeps its fixed settings (no-ops by
    construction on this document) and resolves its derived ones to 0, so it
    is still measured and equals the base -- design decision 10/11."""
    f = _facts(inputs)
    key = definition.key
    settings: list[StressSetting] = []
    derivation: StressDerivation | None = None
    notes: list[str] = []
    applicable = True

    if key in ("unit_loss", "area_reduction"):
        if f["n_units"] == 0:
            applicable, notes = False, [NOTE_NO_UNITS]
        value = definition.settings[0][1]
        if value is None:
            value = _round12(-100 / f["n_units"]) if f["n_units"] > 0 else 0.0
        settings = [StressSetting("saleable_area", value)]
    elif key == "abnormal_cost":
        if f["cost_plan"] is None:
            applicable, notes = False, [NOTE_NO_COST_PLAN]
        elif not f["has_abnormal_base"]:
            applicable, notes = False, [NOTE_NO_ABNORMAL_PACKAGE]
        settings = [StressSetting("abnormal_cost", 10.0)]
    elif key == "slower_absorption":
        if not f["has_ledger"]:
            applicable, notes = False, [NOTE_NO_LEDGER]
        settings = [StressSetting("sales_slip", 6.0)]
    elif key == "delayed_start":
        if f["network"] is None:
            applicable, notes = False, [NOTE_NO_NETWORK]
        settings = [StressSetting("programme_slip", 6.0)]
    elif key in ("yield_expansion", "lower_refi_ltv", "opex_vacancy"):
        if not f["has_investment_case"]:
            applicable, notes = False, [NOTE_NO_INVESTMENT_CASE]
        settings = [StressSetting(lever, value) for lever, value in definition.settings]  # type: ignore[arg-type]
    else:  # risks_crystallise
        cost_ok = f["sum_cost"] > 0 and f["base_build"] > 0
        if f["sum_cost"] <= 0:
            notes.append(NOTE_NO_COST_IMPACT)
        elif f["base_build"] <= 0:
            notes.append(NOTE_NO_BASE_BUILD)
        months_ok = f["sum_months"] > 0 and f["network"] is not None
        if f["sum_months"] <= 0:
            notes.append(NOTE_NO_PROGRAMME_IMPACT)
        elif f["network"] is None:
            notes.append(NOTE_NO_NETWORK_FOR_IMPACT)
        cost_pct = _round12(f["sum_cost"] / f["base_build"] * 100) if cost_ok else None
        applicable = cost_ok or months_ok
        derivation = StressDerivation(
            cost_impact_pence=f["sum_cost"], base_build_pence=f["base_build"], cost_pct=cost_pct,
            programme_impact_months=f["sum_months"], programme_impact_max_months=f["max_months"],
            stated_item_count=f["stated_item_count"],
        )
        settings = [
            StressSetting("construction_cost", cost_pct if cost_ok else 0.0),
            StressSetting("programme_slip", float(f["sum_months"]) if months_ok else 0.0),
        ]

    return ResolvedStress(
        key=key, label=definition.label, settings=settings, derivation=derivation,
        applicable=applicable, note=" ".join(notes) if notes else None,
    )


def run_stress_pack(inputs: AnyCalculatorInputs) -> StressPackResult:
    """Sec 25.2: nine cells plus the base. Raises InvalidBaseDocumentError on a
    base that fails validation, exactly as run_sensitivity does."""
    base = _measure(inputs, [])
    if base.validation_errors:
        messages = dict.fromkeys(e.message for e in base.validation_errors)
        raise InvalidBaseDocumentError("Invalid base document: " + " ".join(messages))
    stresses: list[StressResult] = []
    for definition in STRESS_PACK:
        resolved = resolve_stress(inputs, definition)
        m = _measure(inputs, [
            _LeverSetting(lever=s.lever, phase_id=None, value=s.value) for s in resolved.settings
        ])
        delta = None if m.profit_pence is None or base.profit_pence is None else m.profit_pence - base.profit_pence
        stresses.append(StressResult(
            **resolved.__dict__, metrics=m, delta_profit_pence=delta,
        ))
    return StressPackResult(base=base, stresses=stresses)
