"""Transliteration of frontend/src/lib/model/curves.test.ts (spec Sec 6.1, calc 2.2.0).

Same-inputs/same-expected cross-language parity: every expected array below is
byte-identical to the TS table, so a float-arithmetic divergence between the two
engines shows up here rather than three layers down in a golden fixture.
"""
import pytest

from app.financial_model.curves import (
    spread_back_loaded,
    spread_by_curve,
    spread_s_curve,
    spread_user_defined,
)
from app.financial_model.types import SimpleSpendCurve, SpendCurve, UserDefinedSpendCurve


class TestSpreadSCurve:
    def test_matches_the_hand_derived_raised_cosine_table_for_60m_over_6_months(self):
        # W(k) = (1 - cos(pi*k/6))/2 -- worksheet in test-cases.md (fixture H)
        assert spread_s_curve(60_000_000, 6) == [
            4_019_238, 10_980_762, 15_000_000, 15_000_000, 10_980_762, 4_019_238,
        ]

    def test_sums_exactly_to_the_total_for_awkward_amounts(self):
        out = spread_s_curve(999_999, 7)
        assert sum(out) == 999_999
        assert len(out) == 7

    def test_degenerates_to_the_whole_total_for_a_1_month_window(self):
        assert spread_s_curve(123_456, 1) == [123_456]

    def test_returns_empty_for_months_le_zero(self):
        assert spread_s_curve(1000, 0) == []


class TestSpreadBackLoaded:
    def test_matches_w_k_equals_2k_over_d_d_plus_1(self):
        assert spread_back_loaded(3_000_000, 2) == [1_000_000, 2_000_000]

    def test_is_non_decreasing_and_sums_exactly(self):
        out = spread_back_loaded(1_000_001, 5)
        assert sum(out) == 1_000_001
        for i in range(1, len(out)):
            assert out[i] >= out[i - 1]


class TestSpreadUserDefined:
    def test_normalises_weights(self):
        assert spread_user_defined(40_000, [1, 3]) == [10_000, 30_000]

    def test_zero_weight_months_get_zero_pence_final_month_absorbs_residue(self):
        assert spread_user_defined(100, [0, 1, 2]) == [0, 33, 67]


class TestSpreadByCurve:
    def test_dispatches_straight_line_to_the_existing_spread_straight_line(self):
        # 100p over 3 months: money_round(100/3)=33 per month, final absorbs -> [33, 33, 34]
        assert spread_by_curve(100, 3, SimpleSpendCurve(kind="straight_line")) == [33, 33, 34]

    def test_dispatches_s_curve_back_loaded_user_defined(self):
        assert spread_by_curve(3_000_000, 2, SimpleSpendCurve(kind="back_loaded")) == [
            1_000_000, 2_000_000,
        ]
        assert spread_by_curve(
            40_000, 2, UserDefinedSpendCurve(kind="user_defined", weights=[1, 3]),
        ) == [10_000, 30_000]
        assert spread_by_curve(60_000_000, 6, SimpleSpendCurve(kind="s_curve"))[2] == 15_000_000


# Release 3a Task 9 (spec Sec 6.1, calc 2.2.0): every spend-curve kind, exercised across a
# small matrix of (total, D) pairs chosen to be awkward for integer rounding -- prime
# month-counts, a prime total, and a total smaller than the month-count -- must still
# satisfy the two properties every curve promises regardless of kind (exact-sum, length),
# with the two ramp kinds (s_curve, back_loaded) additionally promising a non-decreasing
# cumulative spend (spec Sec 6.1's "no month gives back money" invariant). Same cases,
# same order as invariants.test.ts's mirror block, so the parity count grows symmetrically.
def _curve_for_kind(kind: str, months: int) -> SpendCurve:
    if kind == "user_defined":
        return UserDefinedSpendCurve(kind="user_defined", weights=[i + 1 for i in range(months)])
    return SimpleSpendCurve(kind=kind)


_CURVE_KINDS = ["straight_line", "s_curve", "back_loaded", "user_defined"]
_CURVE_MATRIX_CASES = [
    (999_999, 7),       # prime D, non-divisible total
    (1, 13),            # prime D, total smaller than D
    (100_000_007, 11),  # prime total, prime D
    (1_234_567, 17),    # prime D
    (7, 3),             # small awkward total
]


_CASE_IDS = [f"total={t}-D={d}" for t, d in _CURVE_MATRIX_CASES]


@pytest.mark.parametrize("kind", _CURVE_KINDS)
@pytest.mark.parametrize("total,months", _CURVE_MATRIX_CASES, ids=_CASE_IDS)
class TestCurveMatrixExactSumAndLength:
    def test_sums_exactly_to_total_and_has_length_d(self, kind: str, total: int, months: int) -> None:
        out = spread_by_curve(total, months, _curve_for_kind(kind, months))
        assert len(out) == months
        assert sum(out) == total


# Only s_curve/back_loaded promise a non-decreasing cumulative -- straight_line and
# user_defined are not restricted to monotone weights, so (mirroring invariants.test.ts,
# which never generates that it() for those two kinds) no test case exists for them here.
@pytest.mark.parametrize("kind", ["s_curve", "back_loaded"])
@pytest.mark.parametrize("total,months", _CURVE_MATRIX_CASES, ids=_CASE_IDS)
class TestCurveMatrixMonotonicCumulative:
    def test_cumulative_spend_is_non_decreasing(self, kind: str, total: int, months: int) -> None:
        out = spread_by_curve(total, months, _curve_for_kind(kind, months))
        cumulative = 0
        for month_pence in out:
            next_cumulative = cumulative + month_pence
            assert next_cumulative >= cumulative
            cumulative = next_cumulative
