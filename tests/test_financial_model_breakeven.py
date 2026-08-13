"""Transliteration of frontend/src/lib/model/breakeven.test.ts.

Both implementations must agree with the hand-computed worksheet (spec Sec 5.11,
docs/financial-model/test-cases.md), not merely with each other.
"""
import math

from app.financial_model.breakeven import (
    DeveloperBreakevenTerms,
    SeniorBreakevenTerms,
    solve_developer_breakeven,
    solve_senior_breakeven,
)
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
        # Python integers are arbitrary precision, and TS's midpoint (`Math.floor((lo+hi)/2)`)
        # has no 32-bit ceiling either -- so in both languages, reaching the 200-iteration
        # cap requires a genuinely astronomic fee_floor: 10**80 needs ~266 bisection steps
        # (log2(10**80) =~ 265.75), which the 200-iteration cap correctly refuses to
        # exceed, returning None rather than a partially bisected (wrong) number. Mirrors
        # the TS regression at the same magnitude.
        p = solve_senior_breakeven(terms(selling_legal_fee_pence=10**80, selling_agent_fee_pct=50))
        assert p is None

    def test_converges_to_the_exact_integer_for_a_large_deal_regression(self):
        # Regression (see docs/financial-model/test-cases.md): TS's midpoint used to be
        # `(lo + hi) >> 1`, which coerces to a 32-bit signed integer in JS and, for a
        # redemption balance at or above 2**31 pence (~GBP21.47m), corrupted `mid` and
        # exhausted the 200-iteration cap -- returning null for a genuinely solvable
        # deal. TS's midpoint is now `Math.floor((lo+hi)/2)`, which (like Python's `//2`,
        # which never had this issue) converges to the exact same integer. Both
        # languages must agree exactly -- see breakeven.test.ts's matching regression
        # test. Closed-form worksheet: fee_floor = 5,000,000,000 + 100,000 + 400,000 =
        # 5,000,500,000; guess = 5,000,500,000 / 0.985 = 5,076,649,746.19...;
        # hand-checked boundary -- at P=5,076,649,745, round(1.5% x P) = 76,149,746,
        # RHS = 5,076,649,746, P < RHS (infeasible); at P=5,076,649,746,
        # round(1.5% x P) = 76,149,746, RHS = 5,076,649,746, P >= RHS (feasible,
        # equality) -- minimum feasible P = 5,076,649,746.
        p = solve_senior_breakeven(terms(
            redemption_balance_pence=5_000_000_000, exit_fee_pence=100_000,
            selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        ))
        assert p == 5_076_649_746
        fee_floor = 5_000_000_000 + 100_000 + 400_000
        assert fee_floor + money_round((5_076_649_745 * 1.5) / 100) == 5_076_649_746
        assert 5_076_649_745 < 5_076_649_746

    def test_converges_for_realistic_large_deals(self):
        p = solve_senior_breakeven(terms(
            redemption_balance_pence=500_000_000, exit_fee_pence=100_000,
            selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        ))
        assert p is not None
        disposal_cost = money_round((p * 1.5) / 100)
        assert p >= 500_000_000 + 100_000 + disposal_cost + 400_000


def dev_terms(**partial) -> DeveloperBreakevenTerms:
    base = dict(tdc_ex_selling_pence=0, selling_agent_fee_pct=0, selling_legal_fee_pence=0)
    base.update(partial)
    return DeveloperBreakevenTerms(**base)


class TestSolveDeveloperBreakeven:
    def test_fixture_g_worksheet(self):
        p = solve_developer_breakeven(dev_terms(
            tdc_ex_selling_pence=94_264_953, selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        ))
        assert p == 96_106_551
        # Hand-checked boundary (docs/financial-model/test-cases.md): 96,106,550 is
        # infeasible because round(0.015 x 96,106,550) = 1,441,598 leaves the fee-sum at
        # 96,106,551, one penny above the candidate itself.
        fee_floor = 94_264_953 + 400_000
        assert fee_floor + money_round((96_106_550 * 1.5) / 100) == 96_106_551
        assert 96_106_550 < 96_106_551

    def test_fixture_a_worksheet(self):
        p = solve_developer_breakeven(dev_terms(
            tdc_ex_selling_pence=89_188_400, selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        ))
        assert p == 90_952_690
        fee_floor = 89_188_400 + 400_000
        assert fee_floor + money_round((90_952_689 * 1.5) / 100) == 90_952_690
        assert 90_952_689 < 90_952_690

    def test_zero_agent_pct_is_exact_sum(self):
        p = solve_developer_breakeven(dev_terms(
            tdc_ex_selling_pence=10_000_000, selling_agent_fee_pct=0, selling_legal_fee_pence=400_000,
        ))
        assert p == 10_000_000 + 400_000

    def test_agent_fee_at_or_above_100_pct_is_unsolvable(self):
        assert solve_developer_breakeven(
            dev_terms(tdc_ex_selling_pence=1_000_000, selling_agent_fee_pct=100)
        ) is None
        assert solve_developer_breakeven(
            dev_terms(tdc_ex_selling_pence=1_000_000, selling_agent_fee_pct=150)
        ) is None

    def test_rounds_the_agent_fee_half_up_not_down(self):
        # fee_floor = 1, pct = 50%. At P=1: 0.5 rounds half-up to 1 -> 1 >= 1+1=2 is false
        # (infeasible). At P=2: 1.0 rounds to 1 -> 2 >= 1+1=2 is true (feasible).
        p = solve_developer_breakeven(dev_terms(selling_legal_fee_pence=1, selling_agent_fee_pct=50))
        assert p == 2

    def test_converges_for_realistic_large_deals(self):
        # Shares the same bisection helper as solve_senior_breakeven, whose own suite
        # already proves convergence at astronomic scale (10**80) and at the historical
        # 32-bit-midpoint regression scale (5,076,649,746) -- both cases exercise the
        # identical shared helper, so this test only needs to prove this call site wires
        # into it correctly, not re-prove the helper itself.
        p = solve_developer_breakeven(dev_terms(
            tdc_ex_selling_pence=500_000_000, selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        ))
        assert p is not None
        disposal_cost = money_round((p * 1.5) / 100)
        assert p >= 500_000_000 + disposal_cost + 400_000
