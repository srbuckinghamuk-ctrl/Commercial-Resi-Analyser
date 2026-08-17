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

from pydantic import BaseModel

from .schedule import (
    calculate_total_acquisition_cost,
    calculate_total_construction_cost,
    calculate_total_professional_fees,
)
from .types import (
    AcquisitionInputs,
    CalculatorInputsV2,
    CalculatorInputsV4,
    CalculatorInputsV5,
    ConversionCostInputs,
)

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
    "enforcement_cost_assumption_pence": 0,
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


def is_v3(snapshot: dict[str, Any]) -> bool:
    """A v3 document has the same finance shape as v2, discriminated by
    inputs_version == 3."""
    finance = snapshot.get("finance")
    return (
        snapshot.get("inputs_version") == 3
        and isinstance(finance, dict)
        and "committed_net_facility_pence" in finance
    )


def is_v4(snapshot: dict[str, Any]) -> bool:
    """A v4 document has the same finance shape as v2/v3, discriminated by
    inputs_version == 4."""
    finance = snapshot.get("finance")
    return (
        snapshot.get("inputs_version") == 4
        and isinstance(finance, dict)
        and "committed_net_facility_pence" in finance
    )


def is_v5(snapshot: dict[str, Any]) -> bool:
    """A v5 document has the same finance shape as v2-v4, discriminated by
    inputs_version == 5."""
    finance = snapshot.get("finance")
    return (
        snapshot.get("inputs_version") == 5
        and isinstance(finance, dict)
        and "committed_net_facility_pence" in finance
    )


def is_v2_or_later(snapshot: dict[str, Any]) -> bool:
    return is_v2(snapshot) or is_v3(snapshot) or is_v4(snapshot) or is_v5(snapshot)


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
        "enforcement_cost_assumption_pence": 0,
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


def migrate_v2_to_v3(doc: dict[str, Any]) -> dict[str, Any]:
    """Upgrades a v2 document to v3 by stamping inputs_version 3 and adding
    the (nullable) lender_valuation block. Every other field is carried
    across unchanged -- this migration is purely additive (spec calc 2.1.0,
    design Sec B1: outputs are unchanged while the block is absent).

    Precondition: `doc` must not already be a v3 document -- this guards
    against double-migration (idempotence). Callers that don't know a
    document's version should check with `is_v2`/`is_v3` (or the server's
    `is_v2_or_later`) first.

    If `doc` illegally already carries a `lender_valuation` key (e.g. a
    hand-edited or partially-migrated row), it is passed through unchanged
    rather than clobbered -- the type layer (or the caller) is responsible
    for validating its shape.
    """
    if is_v3(doc):
        raise ValueError("migrate_v2_to_v3: input is already a v3 document")
    rest = {k: v for k, v in doc.items() if k != "inputs_version"}
    return {
        **rest,
        "inputs_version": 3,
        "lender_valuation": doc.get("lender_valuation"),
    }


def migrate_v3_to_v4(doc: dict[str, Any]) -> dict[str, Any]:
    """Upgrades a v3 document to v4 by stamping inputs_version 4 and adding the
    three (nullable) programme / sales_phasing / refinance blocks. Every other
    field is carried across unchanged -- this migration is purely additive
    (spec Sec 6.1 / design Sec 2.4: outputs are unchanged while all three are
    None).

    Precondition: `doc` must not already be a v4 document -- this guards
    against double-migration (idempotence), same as migrate_v2_to_v3.

    If `doc` illegally already carries `programme` / `sales_phasing` /
    `refinance` keys (e.g. a hand-edited or partially-migrated row), they are
    passed through unchanged rather than clobbered -- the type layer (or the
    caller) is responsible for validating their shape.
    """
    if is_v4(doc):
        raise ValueError("migrate_v3_to_v4: input is already a v4 document")
    rest = {k: v for k, v in doc.items() if k != "inputs_version"}
    return {
        **rest,
        "inputs_version": 4,
        "programme": doc.get("programme"),
        "sales_phasing": doc.get("sales_phasing"),
        "refinance": doc.get("refinance"),
    }


def _merge_saved_onto_defaults(
    defaults: dict[str, Any], saved: dict[str, Any],
) -> dict[str, Any]:
    """The nine field-by-field merge groups shared by migrateInputsToV3's isV3
    branch (migrate.ts:159-186) and migrateInputsToV4's isV4 branch. The two are
    byte-identical in TS apart from the version stamp and the extra v4 blocks, so
    they are one helper here rather than two copies that could drift apart.

    Semantics mirrored exactly: dict-valued groups spread saved OVER defaults (so a
    field added to the schema after the row was saved is default-filled instead of
    missing); list/opaque groups use `??`, i.e. `_coalesce`, so a genuinely empty
    saved list survives instead of being replaced by the default one. Callers stamp
    `inputs_version` themselves.
    """
    return {
        **defaults,
        **saved,
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
            key: {
                **defaults["scenarios"][key],
                **((saved.get("scenarios") or {}).get(key) or {}),
            }
            for key in ("base", "upside", "downside", "severe")
        },
        "deal_spider": {
            **defaults["deal_spider"],
            **(saved.get("deal_spider") or {}),
            "weights": {
                **defaults["deal_spider"]["weights"],
                **((saved.get("deal_spider") or {}).get("weights") or {}),
            },
        },
        "lender_valuation": saved.get("lender_valuation"),
    }


def migrate_inputs_to_v3(
    snapshot: dict[str, Any], project: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalises a v1, v2 or v3 snapshot to v3. Port of migrateInputsToV3.

    v1/v2 snapshots route through the existing migrate_inputs() +
    migrate_v2_to_v3() chain unchanged. A v3 snapshot is merged onto v3 defaults
    field-by-field (mirroring migrate_inputs' own v2-merge branch) so fields added
    to the schema after the snapshot was saved get sane defaults instead of being
    absent, rather than being routed through the v1 fallback path (which would
    misread a v3 `finance` object as v1-shaped and silently produce garbage
    facility terms).

    Without this merge a v3 row saved before a field existed would either fail
    validation at the boundary (a missing `scenarios` key) or under-fill silently
    (an absent `deal_spider.weights` collapsing to `{}`) -- neither of which the
    TS engine does.

    A v4 document is refused (R3b): see the `is_v4` guard below.
    """
    if is_v4(snapshot):
        # R3b: v4 documents carry programme/sales_phasing/refinance the UI can
        # author. Downgrading would silently discard them -- hydrate with
        # migrate_inputs_to_v4.
        raise ValueError("migrate_inputs_to_v3: input is a v4 document - use migrate_inputs_to_v4")
    if is_v3(snapshot):
        defaults = migrate_v2_to_v3(default_calculator_inputs_v2(project))
        return {**_merge_saved_onto_defaults(defaults, snapshot), "inputs_version": 3}
    return migrate_v2_to_v3(migrate_inputs(snapshot, project).model_dump(mode="json"))


def migrate_inputs_to_v4(
    snapshot: dict[str, Any], project: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalises any stored snapshot (v1, v2, v3 or v4) to v4 -- the shape
    every Release 3a consumer needs. Port of migrateInputsToV4.

    A v4 snapshot is merged onto v4 defaults field-by-field (mirroring
    migrate_inputs' own v2-merge branch) so fields added to the schema after
    the snapshot was saved get sane defaults instead of being absent, rather
    than being routed through the v1 fallback path.

    Every pre-v4 snapshot (v1, v2 AND v3) goes through migrate_inputs_to_v3
    first, exactly as migrateInputsToV4 does. In particular a v3 snapshot is
    NOT stamped straight to v4: it gets the same merge-onto-defaults treatment
    a v4 one does, so a v3 row missing a field the schema has since gained is
    default-filled rather than 422-ing or under-filling at the boundary.

    Returns a plain dict, like migrate_v2_to_v3 and unlike migrate_inputs:
    Pydantic validation of the result belongs at the boundary (app.py), which
    is where the 422 is raised.

    A v5 document is refused (R8): see the `is_v5` guard below. Without it, a
    v5 snapshot fails every is_v2/is_v3/is_v4 check in the chain below and
    falls through all the way to migrate_inputs' v1 fallback path, which
    reads the R8 acquisition/jurisdiction fields as noise, rebuilds `finance`
    and `equity_sources` from scratch via the v1 LTV-based heuristic, and
    silently destroys the document -- no exception, no flag. Reachable live
    from app.py's `calculate_authoritative`.
    """
    if is_v5(snapshot):
        raise ValueError("migrate_inputs_to_v4: input is a v5 document - use migrate_inputs_to_v5")
    if is_v4(snapshot):
        defaults = migrate_v3_to_v4(migrate_v2_to_v3(default_calculator_inputs_v2(project)))
        return {
            **_merge_saved_onto_defaults(defaults, snapshot),
            "inputs_version": 4,
            "programme": snapshot.get("programme"),
            "sales_phasing": snapshot.get("sales_phasing"),
            "refinance": snapshot.get("refinance"),
        }
    return migrate_v3_to_v4(migrate_inputs_to_v3(snapshot, project))


# --- Release 8 (calc 2.6.0+): jurisdiction, acquisition date, tax override ---


def migrate_v4_to_v5(v4: dict[str, Any] | CalculatorInputsV4) -> CalculatorInputsV5:
    """Upgrades a v4 document to v5 by stamping ``inputs_version: 5`` and
    adding the acquisition block's six R8 fields. Port of migrateV4toV5.

    Purely additive, and deliberately so: ``england_ni`` with unchanged bands
    means no existing appraisal's computed values move (spec Sec 14). The
    jurisdiction is stamped ``migrated_default``/``unconfirmed`` -- a legacy
    document never told us where the property is, and saying otherwise would
    be a claim the record does not support. ``acquisition_date`` is left
    ``None`` rather than stamped to today: inventing a date the transaction
    did not have would be inventing evidence; a null date is handled
    explicitly downstream (``date_basis: 'assumed_current'``).

    Unlike migrate_v2_to_v3/migrate_v3_to_v4 (which take and return plain
    dicts, this module's working convention -- see the module docstring),
    this returns a validated ``CalculatorInputsV5`` model, mirroring
    migrateV4toV5's typed TS return and matching migrate_inputs_to_v5 below.
    The input is accepted as either shape: a plain v4 snapshot dict (what
    migrate_inputs_to_v4 returns) or an already-validated Pydantic model
    instance (any of CalculatorInputsV2/V3/V4/V5) -- both appear across call
    sites and the test suite. Any Pydantic model is normalised via
    ``model_dump`` rather than special-cased to CalculatorInputsV4 alone, so
    an older/unexpected model shape produces a clear validation error from
    ``CalculatorInputsV5.model_validate`` below instead of an opaque
    ``AttributeError`` from treating it as a dict.

    Precondition: `v4` must not already be a v5 document -- this guards
    against double-migration (idempotence), same as migrate_v3_to_v4.
    """
    if isinstance(v4, CalculatorInputsV5):
        raise ValueError("migrate_v4_to_v5: input is already a v5 document")
    if isinstance(v4, BaseModel):
        doc = v4.model_dump(mode="json")
    else:
        if is_v5(v4):
            raise ValueError("migrate_v4_to_v5: input is already a v5 document")
        doc = dict(v4)

    acq = dict(doc.get("acquisition") or {})
    acq.setdefault("jurisdiction", "england_ni")
    acq.setdefault("jurisdiction_source", "migrated_default")
    acq.setdefault("jurisdiction_evidence_status", "unconfirmed")
    acq.setdefault("acquisition_date", None)
    acq.setdefault("acquisition_tax_override_pence", None)
    acq.setdefault("acquisition_tax_override_reason", "")
    doc["acquisition"] = acq
    doc["inputs_version"] = 5
    return CalculatorInputsV5.model_validate(doc)


def migrate_inputs_to_v5(
    snapshot: dict[str, Any], project: dict[str, Any] | None = None,
) -> CalculatorInputsV5:
    """Normalises any stored snapshot (v1-v5) to v5 -- the shape every R8
    consumer needs. Port of migrateInputsToV5 (migrate.ts:355-391).

    A v5 snapshot is merged onto v5 defaults field-by-field (mirroring
    migrate_inputs_to_v4's own v4-merge branch above, migrate.py:582-590, and
    ultimately migrate_inputs' v2-merge branch the whole chain descends
    from), so a field added to the schema after the row was saved is
    default-filled instead of raising a Pydantic ``ValidationError`` at this
    boundary (e.g. a v5 row saved before ``scenarios.upside`` existed) or
    silently under-filling (``deal_spider.weights`` collapsing to ``{}``
    instead of the full nine-axis default) -- neither of which the TS engine
    does. Bare ``CalculatorInputsV5.model_validate(snapshot)`` would do
    exactly that wrong thing for any snapshot not already carrying every
    current field, so it is not used here.

    Every pre-v5 snapshot (v1 through v4) routes through
    migrate_v4_to_v5(migrate_inputs_to_v4(...)) unchanged, exactly as
    migrateInputsToV5 does.
    """
    if is_v5(snapshot):
        defaults = migrate_v4_to_v5(
            migrate_v3_to_v4(migrate_v2_to_v3(default_calculator_inputs_v2(project))),
        ).model_dump(mode="json")
        return CalculatorInputsV5.model_validate({
            **_merge_saved_onto_defaults(defaults, snapshot),
            "inputs_version": 5,
        })
    return migrate_v4_to_v5(migrate_inputs_to_v4(snapshot, project))
