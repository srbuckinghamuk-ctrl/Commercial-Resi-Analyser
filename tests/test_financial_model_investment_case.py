"""R13 spec Sec 19.2-19.4. Mirrors frontend/src/lib/model/investment-case.test.ts
test-for-test; a divergence between the two files is a port defect."""
import pytest

from app.financial_model.investment_case import (
    OPEX_CODES,
    annual_debt_service_factor,
    gross_potential_monthly_pence,
    investment_value_pence,
    noi_series,
    occupancy_pct_at,
    operating_cost_at,
    size_takeout,
    stabilised_annual_noi_pence,
)

LINES = [
    {"id": "l1", "code": "management", "label": "Management",
     "basis": "pct_of_gross_rent", "value": 10.0},
    {"id": "l2", "code": "insurance", "label": "Insurance",
     "basis": "fixed_pence_per_month", "value": 25_000},
]

IO = {
    "ltv_cap_pct": 65.0, "dscr_floor": 1.3, "icr_floor": 1.3,
    "annual_rate_pct": 6.0, "amortisation_years": None, "term_years": 5.0,
}


def test_occupancy_zero_before_stabilisation():
    assert occupancy_pct_at(2, 3, 3, 96.0) == 0


def test_occupancy_reaches_stabilised_in_the_final_ramp_month():
    assert occupancy_pct_at(3, 3, 3, 96.0) == pytest.approx(32.0)
    assert occupancy_pct_at(4, 3, 3, 96.0) == pytest.approx(64.0)
    assert occupancy_pct_at(5, 3, 3, 96.0) == pytest.approx(96.0)
    assert occupancy_pct_at(6, 3, 3, 96.0) == pytest.approx(96.0)


def test_occupancy_zero_ramp_is_stabilised_immediately():
    assert occupancy_pct_at(3, 3, 0, 96.0) == pytest.approx(96.0)
    assert occupancy_pct_at(2, 3, 0, 96.0) == 0


def test_percentage_line_charges_on_effective_gross_rent():
    assert operating_cost_at(LINES, 500_000) == 75_000
    assert operating_cost_at(LINES, 250_000) == 50_000
    assert operating_cost_at([], 500_000) == 0


def test_gross_potential_sums_the_retained_rent_roll():
    assert gross_potential_monthly_pence(
        [{"monthly_rent_pence": 140_000}, {"monthly_rent_pence": 155_000}],
    ) == 295_000
    # Task 3's own TS twin (investment-case.test.ts) also asserts the empty
    # case; the Python mirror had no counterpart until Task 7 closed the gap.
    assert gross_potential_monthly_pence([]) == 0


def test_noi_series_books_nothing_before_stabilisation():
    s = noi_series(8, 3, 2, 100.0, 400_000, LINES)
    assert len(s) == 8
    assert s[2]["noi_pence"] == 0
    assert s[2]["operating_cost_pence"] == 0
    assert s[3]["effective_gross_rent_pence"] == 200_000
    assert s[3]["operating_cost_pence"] == 45_000
    assert s[3]["noi_pence"] == 155_000
    assert s[4]["noi_pence"] == 335_000
    assert s[7]["noi_pence"] == 335_000


def test_noi_is_signed_when_opex_exceeds_rent():
    s = noi_series(8, 3, 0, 100.0, 20_000, LINES)
    assert s[3]["noi_pence"] == -7_000


def test_stabilised_is_twelve_times_the_stabilised_month_not_the_ramp():
    stabilised = stabilised_annual_noi_pence(100.0, 400_000, LINES)
    assert stabilised == 12 * 335_000
    first_twelve = sum(m["noi_pence"] for m in noi_series(24, 3, 6, 100.0, 400_000, LINES)[:12])
    assert first_twelve < stabilised


def test_opex_codes_are_the_ten_spec_codes():
    assert OPEX_CODES == (
        "management", "letting_and_re_letting", "insurance",
        "repairs_and_maintenance", "service_charge_shortfall", "ground_rent",
        "utilities_on_voids", "compliance_and_safety", "bad_debt", "other",
    )


def test_debt_service_factor_is_the_bare_rate_interest_only():
    assert annual_debt_service_factor(IO) == pytest.approx(0.06)


def test_debt_service_factor_exceeds_the_rate_when_amortising():
    a = annual_debt_service_factor({**IO, "amortisation_years": 25.0})
    assert a > 0.06
    assert a == pytest.approx(0.0773, abs=1e-4)


def test_debt_service_factor_zero_rate_amortising_is_straight_line():
    a = annual_debt_service_factor({**IO, "annual_rate_pct": 0.0, "amortisation_years": 10.0})
    assert a == pytest.approx(12 / 120)


def test_investment_value_one_rounding():
    # 402_000_000 / 5.5 = 73_090_909.0909; / 1.0675 = 68_469_235.68 -> 68_469_236.
    assert investment_value_pence(4_020_000, 5.5, 6.75) == 68_469_236
    assert investment_value_pence(0, 5.5, 6.75) == 0
    assert investment_value_pence(-1_000, 5.5, 6.75) == 0


def test_ltv_binds_and_all_three_caps_are_published():
    s = size_takeout(2_000_000, 20_000_000, IO)
    assert s["ltv_cap_pence"] == 13_000_000
    assert s["dscr_cap_pence"] == 25_641_025
    assert s["icr_cap_pence"] == 25_641_025
    assert s["quantum_pence"] == 13_000_000
    assert s["binding_constraint"] == "ltv"


def test_dscr_binds_when_coverage_is_tightest():
    s = size_takeout(500_000, 20_000_000, IO)
    assert s["quantum_pence"] == 6_410_256
    assert s["binding_constraint"] == "dscr"
    assert s["quantum_pence"] < s["ltv_cap_pence"]


def test_dscr_and_icr_separate_exactly_when_amortising():
    io = size_takeout(500_000, 20_000_000, IO)
    assert io["dscr_cap_pence"] == io["icr_cap_pence"]
    am = size_takeout(500_000, 20_000_000, {**IO, "amortisation_years": 25.0})
    assert am["dscr_cap_pence"] < am["icr_cap_pence"]
    assert am["binding_constraint"] == "dscr"


def test_caps_floor_never_round_up():
    # The numerator is chosen so the fractional part EXCEEDS 0.5 -- the only way
    # this test can tell flooring from rounding:
    #   1_000_006 / (1 x 0.06) = 16_666_766.67
    #   floor -> 16_666_766      round-half-up -> 16_666_767
    s = size_takeout(1_000_006, 999_999_999_999,
                     {**IO, "dscr_floor": 1.0, "icr_floor": 1.0, "ltv_cap_pct": 100.0})
    assert s["dscr_cap_pence"] == 16_666_766


def test_zero_rate_drops_the_coverage_caps_out_of_the_minimum():
    s = size_takeout(500_000, 20_000_000, {**IO, "annual_rate_pct": 0.0})
    assert s["dscr_cap_pence"] is None
    assert s["icr_cap_pence"] is None
    assert s["binding_constraint"] == "ltv"
    assert s["quantum_pence"] == 13_000_000


def test_achieved_ratio_is_at_least_its_floor():
    s = size_takeout(500_000, 20_000_000, IO)
    assert s["achieved_dscr"] >= IO["dscr_floor"]
    assert s["achieved_dscr"] < 500_000 / (s["quantum_pence"] * 0.06) + 1e-6


def test_non_positive_noi_sizes_to_nothing_and_names_no_constraint():
    s = size_takeout(0, 0, IO)
    assert s["quantum_pence"] == 0
    assert s["binding_constraint"] is None
    assert s["achieved_ltv_pct"] is None


def test_cross_engine_pinned_triple():
    """The identical assertion lives in investment-case.test.ts. If you change
    one of these numbers, change both files or the engines have diverged.

    NOTE: the LTV cap here (30_539_731) was hand-derived independently of the
    task brief's draft figure. floor(46_984_203 * 65 / 100) = floor(30_539_731.95)
    = 30_539_731 -- the brief's draft (30_540_036) did not reconcile by hand and
    has been corrected in both engines' tests."""
    # egr = 295_000 x 96% = 283_200; opex = 28_320 (10%) + 25_000 = 53_320;
    # monthly NOI 229_880; x12 = 2_758_560. Exact integer arithmetic.
    noi = stabilised_annual_noi_pence(96.0, 295_000, LINES)
    assert noi == 2_758_560
    # 2_758_560 x 100 / 5.5 = 50_155_636.36; / 1.0675 = 46_984_202.68 -> 46_984_203.
    value = investment_value_pence(noi, 5.5, 6.75)
    assert value == 46_984_203
    s = size_takeout(noi, value, {**IO, "amortisation_years": 25.0})
    # LTV cap floor(46_984_203 x 0.65) = 30_539_731; ICR cap
    # floor(2_758_560 / (1.3 x 0.06)) = 35_366_153; DSCR cap ~27_449_000 binds.
    assert s["ltv_cap_pence"] == 30_539_731
    assert s["icr_cap_pence"] == 35_366_153
    assert s["binding_constraint"] == "dscr"
    # <hand-derive> the DSCR cap to the pence from a = 12 x i/(1-(1+i)^-300),
    # i = 0.005, then floor(noi / (1.3 x a)). It sits near 27_449_000; a result
    # outside 27_400_000..27_500_000 means the annuity factor is wrong, not that
    # this bound needs widening.
    assert 27_400_000 <= s["dscr_cap_pence"] <= 27_500_000
    assert s["quantum_pence"] == s["dscr_cap_pence"]
