"""R13 spec Sec 19. Python twin of
frontend/src/lib/model/__fixtures__/investment-case-docs.test.ts -- exercises
tests/fixtures_investment_case.py's builders (Task 5b).
"""
from __future__ import annotations

from app.financial_model.investment_case import (
    gross_potential_monthly_pence,
    investment_value_pence,
    size_takeout,
    stabilised_annual_noi_pence,
)
from app.financial_model.programme import derive_phases
from app.financial_model.validation import validate_inputs

from .fixtures_investment_case import anchored_slipped_doc, explicit_refinance_doc, ic_doc


def _errors(doc):
    return [i for i in validate_inputs(doc) if i.severity == "error"]


def test_produces_a_document_with_no_validation_errors_by_default() -> None:
    assert _errors(ic_doc()) == []
    assert _errors(explicit_refinance_doc()) == []
    assert _errors(anchored_slipped_doc()) == []


def _binding_constraint(doc) -> str | None:
    """The same substitution investment-case-docs.test.ts makes, and for the
    same reason: `Schedule.investment_case` (Task 8) does not exist yet on
    this branch, so the binding constraint is derived directly from the
    document's own `investment_case` input block via the already-tested Task
    3 engine functions, exactly what `compute_investment_case` (Task 8) will
    also feed them."""
    ic = doc.investment_case
    gross = gross_potential_monthly_pence(doc.exit_strategy.retained_units)
    noi = stabilised_annual_noi_pence(ic.stabilisation.stabilised_occupancy_pct, gross, ic.operating_lines)
    value = investment_value_pence(noi, ic.valuation.cap_yield_pct, ic.valuation.purchasers_costs_pct)
    return size_takeout(noi, value, ic.takeout)["binding_constraint"]


def test_makes_the_default_case_one_where_dscr_binds() -> None:
    assert _binding_constraint(ic_doc()) == "dscr"


def test_makes_the_ltv_binds_override_actually_change_which_constraint_binds() -> None:
    assert _binding_constraint(ic_doc({"ltv_binds": True})) == "ltv"


def test_resolves_the_anchored_tranche_to_month_14_not_its_month_offset_of_12() -> None:
    doc = anchored_slipped_doc()
    assert doc.sales_phasing.tranches[0].month_offset == 12
    derivation = derive_phases(doc.programme)
    assert derivation.cycle is None
    anchor = doc.sales_phasing.tranches[0].anchor
    resolved = derivation.by_id[anchor.phase_id].start_month + anchor.offset_months
    assert resolved == 14
    anchor2 = doc.sales_phasing.tranches[1].anchor
    assert derivation.by_id[anchor2.phase_id].start_month + anchor2.offset_months == 18
    refi_anchor = doc.refinance.anchor
    assert derivation.by_id[refi_anchor.phase_id].start_month + refi_anchor.offset_months == 18


def test_applies_exactly_one_deviation_per_override_key() -> None:
    base = ic_doc()
    one = ic_doc({"occupancy_pct": 80})
    base_dict = base.model_dump()
    one_dict = one.model_dump()
    base_dict["investment_case"] = None
    one_dict["investment_case"] = None
    assert one_dict == base_dict
    assert one.investment_case.stabilisation.stabilised_occupancy_pct == 80
    assert one.investment_case.valuation.model_dump() == base.investment_case.valuation.model_dump()
