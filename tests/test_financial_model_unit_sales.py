"""R13b spec Sec 22.2-22.4. Twin of unit-sales.test.ts. Every literal is from
the plan's hand-derivation table; if one does not reconcile, report it."""
import pytest

from app.financial_model.unit_sales import compute_unit_sales
from .fixtures_unit_sales import (
    anchor_resolver, held_twin_doc, no_programme_doc, pc_early_doc, residue_doc, sold_gross, unit_sales_doc,
)


def _run(doc):
    return compute_unit_sales(doc, 24, anchor_resolver(doc), sold_gross(doc))


def _row(result, unit_id):
    return next(r for r in result["units"] if r["unit_id"] == unit_id)


def test_returns_none_exactly_when_the_input_block_is_none():
    doc = unit_sales_doc({"unit_sales": None})
    assert compute_unit_sales(doc, 24, anchor_resolver(doc), sold_gross(doc)) is None
    assert _run(unit_sales_doc()) is not None


def test_per_unit_figures_match_the_hand_derivation():
    r = _run(unit_sales_doc())
    assert [(x["unit_id"], x["gross_pence"], x["deposit_pence"], x["agent_fee_pence"], x["legal_fee_pence"], x["net_pence"])
            for x in r["units"]] == [
        ("u1", 26_000_000, 2_600_000, 390_000, 201_550, 25_408_450),
        ("u2", 30_000_000, 3_000_000, 450_000, 150_000, 29_400_000),
        ("u3", 17_500_000, 0, 350_000, 135_659, 17_014_341),
        ("u4", 21_000_000, 1_050_000, 315_000, 162_791, 20_522_209),
    ]
    assert r["totals"] == {
        "gross_pence": 94_500_000, "deposits_pence": 6_650_000, "deposits_released_pence": 6_650_000,
        "agent_fees_pence": 1_505_000, "legal_fees_pence": 650_000, "net_pence": 92_345_000,
    }


def test_resolved_months_and_released_deposits():
    r = _run(unit_sales_doc())
    assert [(x["exchange_month"], x["completion_month"], x["deposit_released_pence"]) for x in r["units"]] == [
        (8, 12, 2_600_000), (10, 13, 3_000_000), (None, 13, 0), (11, 20, 1_050_000),
    ]


def test_held_twin_releases_nothing_but_still_reports_the_deposits():
    r = _run(held_twin_doc())
    assert [x["deposit_released_pence"] for x in r["units"]] == [0, 0, 0, 0]
    assert [x["deposit_pence"] for x in r["units"]] == [2_600_000, 3_000_000, 0, 1_050_000]
    assert r["totals"]["deposits_pence"] == 6_650_000
    assert r["totals"]["deposits_released_pence"] == 0
    assert all(m["deposits_received_pence"] == 0 for m in r["months"])


def test_monthly_series_are_cumulative_and_deposits_land_in_exchange_months():
    r = _run(unit_sales_doc())
    m = {x["month"]: x for x in r["months"]}
    assert len(r["months"]) == 24
    assert (m[7]["exchanged_value_pence"], m[8]["exchanged_value_pence"], m[10]["exchanged_value_pence"],
            m[11]["exchanged_value_pence"], m[12]["exchanged_value_pence"], m[13]["exchanged_value_pence"]) == (
        0, 26_000_000, 56_000_000, 77_000_000, 77_000_000, 94_500_000)
    assert (m[11]["completed_value_pence"], m[12]["completed_value_pence"], m[13]["completed_value_pence"],
            m[19]["completed_value_pence"], m[20]["completed_value_pence"], m[23]["completed_value_pence"]) == (
        0, 26_000_000, 73_500_000, 73_500_000, 94_500_000, 94_500_000)
    assert {k: v["deposits_received_pence"] for k, v in m.items() if v["deposits_received_pence"]} == {
        8: 2_600_000, 10: 3_000_000, 11: 1_050_000}


def test_pre_sold_uses_the_earliest_practical_completion_start():
    r = _run(unit_sales_doc())
    assert r["pre_sold"] == {
        "reference_month": 12, "basis": "practical_completion",
        "exchanged_value_pence": 77_000_000, "pct": 81.48,
    }


def test_pre_sold_basis_switches_and_the_reference_month_moves():
    # Same rows, no network: basis changes, reference month is the first completion.
    assert _run(no_programme_doc())["pre_sold"] == {
        "reference_month": 12, "basis": "first_completion",
        "exchanged_value_pence": 77_000_000, "pct": 81.48,
    }
    # Same rows, PC at month 9: only u1 has exchanged by then.
    assert _run(pc_early_doc())["pre_sold"] == {
        "reference_month": 9, "basis": "practical_completion",
        "exchanged_value_pence": 26_000_000, "pct": 27.51,
    }


def test_null_legal_residue_is_absorbed_by_the_last_null_legal_row():
    r = _run(residue_doc())
    assert [x["legal_fee_pence"] for x in r["units"]] == [33, 33, 34]
    assert r["totals"]["legal_fees_pence"] == 100


def test_all_legal_overrides_set_leaves_the_scheme_fee_unused():
    rows = [
        {"unit_id": u, "exchange": None, "completion": {"month_offset": 12, "anchor": None},
         "deposit_pct": 0, "agent_fee_pct": None, "legal_fee_pence": 1_000}
        for u in ("u1", "u2", "u3", "u4")
    ]
    r = _run(unit_sales_doc({"rows": rows}))
    assert r["totals"]["legal_fees_pence"] == 4_000  # not 500,000


def test_deposit_and_agent_scale_with_the_unit_gross():
    # u3's 2.0% override on 17,500,000 = 350,000; u1's scheme 1.5% on 26,000,000
    # (parking included) = 390,000 -- the ancillary is inside the base.
    r = _run(unit_sales_doc())
    assert _row(r, "u3")["agent_fee_pence"] == 350_000
    assert _row(r, "u1")["agent_fee_pence"] == 390_000


def test_completion_month_is_clamped_into_the_term():
    rows = [{"unit_id": "u1", "exchange": None, "completion": {"month_offset": 40, "anchor": None},
             "deposit_pct": 0, "agent_fee_pct": None, "legal_fee_pence": None}]
    doc = unit_sales_doc({"rows": rows})
    r = compute_unit_sales(doc, 24, anchor_resolver(doc), [("u1", 26_000_000)])
    assert r["units"][0]["completion_month"] == 23  # validation owns the real rule
