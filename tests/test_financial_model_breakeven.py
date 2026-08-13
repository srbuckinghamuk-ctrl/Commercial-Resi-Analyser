"""Transliteration of frontend/src/lib/model/breakeven.test.ts.

Both implementations must agree with the hand-computed worksheet (spec Sec 5.11,
docs/financial-model/test-cases.md), not merely with each other.
"""
import math

from app.financial_model.breakeven import SeniorBreakevenTerms, solve_senior_breakeven
from app.financial_model.engine import money_round


def terms(**partial) -> SeniorBreakevenTerms:
    base = dict(
        redemption_balance_pence=0, exit_fee_pence=0, selling_agent_fee_pct=0,
        selling_legal_fee_pence=0, enforcement_cost_assumption_pence=0,
    )
    base.update(partial)
    return SeniorBreakevenTerms(**base)


class TestSolveSeniorBreakeven:
    def test_fixture_g_worksheet(self):
        p = solve_senior_breakeven(terms(
            redemption_balance_pence=58_604_953, exit_fee_pence=660_000,
            selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
            enforcement_cost_assumption_pence=0,
        ))
        assert p == 60_573_556
        # Hand-checked boundary (docs/financial-model/test-cases.md): 60,573,555 is
        # infeasible because round(0.015 x 60,573,555) = 908,603 leaves the fee-sum
        # unchanged at 60,573,556, one penny above the candidate itself.
        fee_floor = 58_604_953 + 660_000 + 400_000
        assert fee_floor + money_round((60_573_555 * 1.5) / 100) == 60_573_556
        assert 60_573_555 < 60_573_556

    def test_zero_agent_pct_is_exact_sum(self):
        p = solve_senior_breakeven(terms(
            redemption_balance_pence=10_000_000, exit_fee_pence=100_000,
            selling_agent_fee_pct=0, selling_legal_fee_pence=400_000,
            enforcement_cost_assumption_pence=50_000,
        ))
        assert p == 10_000_000 + 100_000 + 400_000 + 50_000

    def test_agent_fee_at_or_above_100_pct_is_unsolvable(self):
        assert solve_senior_breakeven(
            terms(redemption_balance_pence=1_000_000, selling_agent_fee_pct=100)
        ) is None
        assert solve_senior_breakeven(
            terms(redemption_balance_pence=1_000_000, selling_agent_fee_pct=150)
        ) is None

    def test_zero_redemption_balance_still_solves_to_the_fixed_cost_sum(self):
        p = solve_senior_breakeven(terms(selling_legal_fee_pence=400_000, selling_agent_fee_pct=1.5))
        assert p is not None
        assert p >= 400_000
        disposal_cost = money_round((p * 1.5) / 100)
        assert p >= 400_000 + disposal_cost

    def test_rounds_the_agent_fee_half_up_not_down(self):
        # fee_floor = 1, pct = 50%. At P=1: 0.5 rounds half-up to 1 -> 1 >= 1+1=2 is
        # false (infeasible). At P=2: 1.0 rounds to 1 -> 2 >= 1+1=2 is true (feasible).
        p = solve_senior_breakeven(terms(selling_legal_fee_pence=1, selling_agent_fee_pct=50))
        assert p == 2

    def test_iteration_cap_guard_genuinely_reachable_at_extreme_magnitude(self):
        # Python integers are arbitrary precision (no 32-bit truncation the way JS's
        # `(lo+hi) >> 1` has -- see the TS test for that divergence), so reaching the
        # 200-iteration cap here requires a genuinely astronomic fee_floor: 10**80
        # needs ~266 bisection steps (log2(10**80) =~ 265.75), which the 200-iteration
        # cap correctly refuses to exceed, returning None rather than a partially
        # bisected (wrong) number.
        p = solve_senior_breakeven(terms(selling_legal_fee_pence=10**80, selling_agent_fee_pct=50))
        assert p is None

    def test_converges_correctly_for_realistic_large_deals_where_ts_cannot(self):
        # Cross-language divergence (see task-4-report.md): the same
        # redemption_balance_pence=5,000,000,000 (~GBP50m senior balance -- a
        # realistic scale for a large commercial deal) that forces JS's
        # `solveSeniorBreakeven` to hit its 200-iteration cap and return null (because
        # `(lo+hi) >> 1` truncates to a 32-bit signed integer once hi exceeds 2**31)
        # converges cleanly in Python, which has no such bit-width limitation.
        p = solve_senior_breakeven(terms(
            redemption_balance_pence=5_000_000_000, exit_fee_pence=100_000,
            selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        ))
        assert p is not None
        disposal_cost = money_round((p * 1.5) / 100)
        assert p >= 5_000_000_000 + 100_000 + disposal_cost + 400_000

    def test_converges_for_realistic_large_deals_just_under_the_32_bit_safe_boundary(self):
        p = solve_senior_breakeven(terms(
            redemption_balance_pence=500_000_000, exit_fee_pence=100_000,
            selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        ))
        assert p is not None
        disposal_cost = money_round((p * 1.5) / 100)
        assert p >= 500_000_000 + 100_000 + disposal_cost + 400_000
