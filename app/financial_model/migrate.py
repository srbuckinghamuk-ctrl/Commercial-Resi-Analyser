"""Port of frontend/src/lib/model/migrate.ts, plus the slice of
frontend/src/lib/conversion-defaults.ts it needs (DEFAULT_FACILITY_TERMS and
friends) since migrate.py is the only Python consumer of those defaults.

Port rule: v1 snapshots are untyped dicts (a legacy, pre-spec document shape we
do not want to force through the strict v2 Pydantic model). We therefore work
in plain dicts throughout this module and Pydantic-validate only the final
output of migration.
"""
from __future__ import annotations

import uuid
from typing import Any

from .schedule import (
    calculate_total_acquisition_cost,
    calculate_total_construction_cost,
    calculate_total_professional_fees,
)
from .types import AcquisitionInputs, CalculatorInputsV2, ConversionCostInputs

# --- conversion-defaults.ts (the slice migrate.py needs) -------------------

DEFAULT_ACQUISITION: dict[str, Any] = {
    "purchase_price_pence": 0,
    "legal_fees_pence": 500_000,
    "survey_cost_pence": 300_000,
    "broker_fee_pct": 1.0,
    "other_acquisition_costs_pence": 0,
}

DEFAULT_UNIT_MIX: dict[str, Any] = {"units": []}

DEFAULT_CONVERSION_COSTS: dict[str, Any] = {
    "prior_approval_fee_per_dwelling_pence": 9_600,
    "cil_s106_pence": 0,
    "architect_pence": 1_500_000,
    "structural_engineer_pence": 500_000,
    "mande_pence": 500_000,
    "planning_consultant_pence": 300_000,
    "building_control_pence": 200_000,
    "other_professional_fees_pence": 0,
    "construction_cost_per_sqm_pence": 80_730,
    "total_construction_sqm": 0,
    "contingency_pct": 10.0,
    "fire_safety_pence": 0,
    "sound_insulation_pence": 0,
    "part_l_compliance_pence": 0,
}

DEFAULT_EXIT_STRATEGY: dict[str, Any] = {
    "route": "sell_all",
    "selling_agent_fee_pct": 1.5,
    "selling_legal_fee_pence": 150_000,
    "retained_units": [],
}


def default_risk_register() -> list[dict[str, Any]]:
    template = [
        {
            "description": "Prior approval refusal",
            "likelihood": "medium", "impact": "high",
            "mitigation": "Pre-application consultation with LPA",
        },
        {
            "description": "Article 4 direction introduced mid-project",
            "likelihood": "low", "impact": "high",
            "mitigation": "Monitor LPA consultations and planning policy changes",
        },
        {
            "description": "Construction cost overrun",
            "likelihood": "medium", "impact": "medium",
            "mitigation": "Fixed-price contract with contingency allowance",
        },
        {
            "description": "GDV falls due to market movement",
            "likelihood": "medium", "impact": "high",
            "mitigation": "Conservative comparable evidence, stress test scenarios",
        },
        {
            "description": "Void periods on retained units",
            "likelihood": "medium", "impact": "low",
            "mitigation": "Realistic rental assumptions, marketing budget",
        },
    ]
    return [{"id": str(uuid.uuid4()), **r} for r in template]


DEFAULT_SCENARIOS: dict[str, Any] = {
    "base": {
        "label": "Base Case", "gdv_adjustment_pct": 0, "construction_cost_adjustment_pct": 0,
        "timeline_adjustment_months": 0, "interest_rate_adjustment_pct": 0,
    },
    "upside": {
        "label": "Upside", "gdv_adjustment_pct": 10, "construction_cost_adjustment_pct": -5,
        "timeline_adjustment_months": -2, "interest_rate_adjustment_pct": 0,
    },
    "downside": {
        "label": "Downside", "gdv_adjustment_pct": -10, "construction_cost_adjustment_pct": 15,
        "timeline_adjustment_months": 3, "interest_rate_adjustment_pct": 1,
    },
    "severe": {
        "label": "Severe", "gdv_adjustment_pct": -15, "construction_cost_adjustment_pct": 20,
        "timeline_adjustment_months": 6, "interest_rate_adjustment_pct": 2,
    },
}

# frontend/src/lib/deal-spider.ts CLASS_MA_AXES ids.
_CLASS_MA_AXIS_IDS = [
    "margin_resilience", "prior_approval", "deliverability", "building_safety",
    "tax_advantage", "programme", "sales_velocity", "exit_optionality",
    "acquisition_headroom",
]


def default_spider_weights() -> dict[str, float]:
    return {axis_id: 1 for axis_id in _CLASS_MA_AXIS_IDS}


DEFAULT_DEAL_SPIDER: dict[str, Any] = {
    "storeys": 2,
    "building_height_m": 7,
    "bsa_higher_risk": False,
    "daylight_pass_pct": 100,
    "absorption_months": 9,
    "exit_sell": True,
    "exit_refinance": True,
    "exit_hold": False,
    "exit_part_sale": False,
    "prior_approval_window_months": 2,
    "programme_contingency_months": 1,
    "cil_offset_pence": 0,
    "target_profit_on_cost_pct": 20,
    "weights": default_spider_weights(),
}

DEFAULT_FACILITY_TERMS: dict[str, Any] = {
    "funding_source": "development_finance",
    "day_one_advance_pence": None,
    "day_one_market_value_pence": None,
    "development_cost_advance_pct": 100,
    "committed_net_facility_pence": None,
    "committed_gross_facility_pence": None,
    "annual_interest_rate_pct": 8.0,
    "interest_type": "rolled_up",
    "arrangement_fee_pct": 2.0,
    "arrangement_fee_basis": "committed_net_facility",
    "exit_fee_pct": 1.0,
    "exit_fee_basis": "committed_gross_facility",
    "broker_fee_pence": 0,
    "lender_legal_fee_pence": 0,
    "valuation_fee_pence": 0,
    "monitoring_surveyor_fee_pence": 0,
    "interest_reserve_pence": None,
    "term_months": 12,
    "equity_draw_rule": "equity_first",
    "sales_sweep_pct": 100,
    "legacy_leverage_pct": None,
    "requires_confirmation": False,
}


def default_equity_sources() -> list[dict[str, Any]]:
    return [{
        "id": str(uuid.uuid4()),
        "classification": "cash",
        "amount_pence": 0,
        "timing_month": 0,
        "repayment_priority": 1,
        "evidence_status": "unconfirmed",
        "notes": "",
    }]


def default_calculator_inputs_v2(project: dict[str, Any] | None = None) -> dict[str, Any]:
    # `?? DEFAULT_DEAL_SPIDER.storeys` in TS: only None/absent falls through --
    # floors: 0 (e.g. a single-storey unit) must be preserved, not treated as
    # falsy. Bare `or` would wrongly substitute the default here.
    storeys = _coalesce((project or {}).get("floors"), DEFAULT_DEAL_SPIDER["storeys"])
    return {
        "inputs_version": 2,
        "project_id": (project or {}).get("id"),
        "acquisition": {
            **DEFAULT_ACQUISITION,
            "purchase_price_pence": (project or {}).get("price_pence") or 0,
        },
        "unit_mix": {**DEFAULT_UNIT_MIX},
        "conversion_costs": {
            **DEFAULT_CONVERSION_COSTS,
            "total_construction_sqm": (project or {}).get("floor_area_sqm") or 0,
        },
        "finance": {**DEFAULT_FACILITY_TERMS},
        "equity_sources": default_equity_sources(),
        "exit_strategy": {**DEFAULT_EXIT_STRATEGY},
        "risks": default_risk_register(),
        "scenarios": {
            "base": {**DEFAULT_SCENARIOS["base"]},
            "upside": {**DEFAULT_SCENARIOS["upside"]},
            "downside": {**DEFAULT_SCENARIOS["downside"]},
            "severe": {**DEFAULT_SCENARIOS["severe"]},
        },
        "deal_spider": {
            **DEFAULT_DEAL_SPIDER,
            "storeys": storeys,
            "building_height_m": storeys * 3.5,
            "weights": default_spider_weights(),
        },
    }


# --- migrate.ts --------------------------------------------------------


def _coalesce(value: Any, default: Any) -> Any:
    """Mirrors JS `value ?? default` -- only None/absent falls through, unlike
    Python's truthy `or` (which would also replace an empty-but-present dict/list)."""
    return default if value is None else value


def is_v2(snapshot: dict[str, Any]) -> bool:
    finance = snapshot.get("finance")
    return (
        snapshot.get("inputs_version") == 2
        and isinstance(finance, dict)
        and "committed_net_facility_pence" in finance
    )


def migrate_finance_v1(
    v1: dict[str, Any], cost_before_finance: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    # Import here (not at module scope) to avoid a needless cycle: money_round
    # lives in engine.py, which schedule.py (imported above) already depends on.
    from .engine import money_round

    is_cash = v1["funding_source"] == "cash"
    proposed_facility = 0 if is_cash else money_round((cost_before_finance * v1["ltv_pct"]) / 100)
    finance: dict[str, Any] = {
        "funding_source": v1["funding_source"],
        "day_one_advance_pence": None,
        "day_one_market_value_pence": None,
        "development_cost_advance_pct": 100,
        "committed_net_facility_pence": proposed_facility,
        "committed_gross_facility_pence": None,
        "annual_interest_rate_pct": v1["interest_rate_annual_pct"],
        "interest_type": v1["interest_type"],
        "arrangement_fee_pct": v1["arrangement_fee_pct"],
        "arrangement_fee_basis": "committed_net_facility",
        "exit_fee_pct": v1["exit_fee_pct"],
        "exit_fee_basis": "committed_gross_facility",
        "broker_fee_pence": 0,
        "lender_legal_fee_pence": 0,
        "valuation_fee_pence": 0,
        "monitoring_surveyor_fee_pence": 0,
        "interest_reserve_pence": None,
        "term_months": v1["loan_term_months"],
        "equity_draw_rule": "fund_as_required",
        "sales_sweep_pct": 100,
        "legacy_leverage_pct": v1["ltv_pct"],
        "requires_confirmation": True,
    }
    equity: list[dict[str, Any]] = [{
        "id": "migrated-cash-equity",
        "classification": "cash",
        "amount_pence": cost_before_finance - proposed_facility,
        "timing_month": 0,
        "repayment_priority": 1,
        "evidence_status": "unconfirmed",
        "notes": (
            "Migrated from v1 snapshot: residual of cost before finance less "
            "proposed facility. Confirm before lender use."
        ),
    }]
    return finance, equity


def migrate_inputs(
    snapshot: dict[str, Any], project: dict[str, Any] | None = None,
) -> CalculatorInputsV2:
    """Accepts a v1 or v2 snapshot (or partial) and returns a normalised v2
    document."""
    defaults = default_calculator_inputs_v2(project)

    if is_v2(snapshot):
        saved = snapshot
        merged: dict[str, Any] = {
            **defaults,
            **saved,
            "inputs_version": 2,
            "acquisition": {**defaults["acquisition"], **(saved.get("acquisition") or {})},
            "unit_mix": _coalesce(saved.get("unit_mix"), defaults["unit_mix"]),
            "conversion_costs": {
                **defaults["conversion_costs"], **(saved.get("conversion_costs") or {}),
            },
            "finance": {**defaults["finance"], **(saved.get("finance") or {})},
            "equity_sources": _coalesce(saved.get("equity_sources"), defaults["equity_sources"]),
            "exit_strategy": {**defaults["exit_strategy"], **(saved.get("exit_strategy") or {})},
            "risks": _coalesce(saved.get("risks"), defaults["risks"]),
            "scenarios": {
                "base": {
                    **defaults["scenarios"]["base"],
                    **((saved.get("scenarios") or {}).get("base") or {}),
                },
                "upside": {
                    **defaults["scenarios"]["upside"],
                    **((saved.get("scenarios") or {}).get("upside") or {}),
                },
                "downside": {
                    **defaults["scenarios"]["downside"],
                    **((saved.get("scenarios") or {}).get("downside") or {}),
                },
                "severe": {
                    **defaults["scenarios"]["severe"],
                    **((saved.get("scenarios") or {}).get("severe") or {}),
                },
            },
            "deal_spider": {
                **defaults["deal_spider"],
                **(saved.get("deal_spider") or {}),
                "weights": {
                    **defaults["deal_spider"]["weights"],
                    **((saved.get("deal_spider") or {}).get("weights") or {}),
                },
            },
        }
        return CalculatorInputsV2.model_validate(merged)

    # v1 path: merge onto v1-shaped defaults first, then translate finance.
    v1 = snapshot
    acquisition = {**defaults["acquisition"], **(v1.get("acquisition") or {})}
    conversion_costs = {**defaults["conversion_costs"], **(v1.get("conversion_costs") or {})}
    unit_mix = _coalesce(v1.get("unit_mix"), defaults["unit_mix"])
    v1_finance: dict[str, Any] = {
        "funding_source": "bridging", "ltv_pct": 70, "interest_rate_annual_pct": 8,
        "arrangement_fee_pct": 2, "exit_fee_pct": 1, "loan_term_months": 12,
        "interest_type": "rolled_up",
        **(v1.get("finance") or {}),
    }
    acq_obj = AcquisitionInputs.model_validate(acquisition)
    cc_obj = ConversionCostInputs.model_validate(conversion_costs)
    cost_before_finance = (
        calculate_total_acquisition_cost(acq_obj)
        + calculate_total_construction_cost(cc_obj)
        + calculate_total_professional_fees(cc_obj, len(unit_mix["units"]))
    )
    finance, equity = migrate_finance_v1(v1_finance, cost_before_finance)

    merged = {
        **defaults,
        "inputs_version": 2,
        "project_id": _coalesce(v1.get("project_id"), defaults["project_id"]),
        "acquisition": acquisition,
        "unit_mix": unit_mix,
        "conversion_costs": conversion_costs,
        "finance": finance,
        "equity_sources": equity,
        "exit_strategy": {**defaults["exit_strategy"], **(v1.get("exit_strategy") or {})},
        "risks": _coalesce(v1.get("risks"), defaults["risks"]),
        "scenarios": {
            "base": {
                **defaults["scenarios"]["base"], **((v1.get("scenarios") or {}).get("base") or {}),
            },
            "upside": {
                **defaults["scenarios"]["upside"], **((v1.get("scenarios") or {}).get("upside") or {}),
            },
            "downside": {
                **defaults["scenarios"]["downside"],
                **((v1.get("scenarios") or {}).get("downside") or {}),
            },
            "severe": {
                **defaults["scenarios"]["severe"], **((v1.get("scenarios") or {}).get("severe") or {}),
            },
        },
        "deal_spider": {
            **defaults["deal_spider"],
            **(v1.get("deal_spider") or {}),
            "weights": {
                **defaults["deal_spider"]["weights"],
                **((v1.get("deal_spider") or {}).get("weights") or {}),
            },
        },
    }
    return CalculatorInputsV2.model_validate(merged)
