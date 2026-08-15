"""Transliteration of frontend/src/lib/model/breakeven.test.ts.

Both implementations must agree with the hand-computed worksheet (spec Sec 5.11,
docs/financial-model/test-cases.md), not merely with each other.
"""
import math
from dataclasses import replace as dc_replace

from app.financial_model.breakeven import (
    DeveloperBreakevenTerms,
    PhasedSeniorBreakevenTerms,
    SeniorBreakevenTerms,
    phased_replay_redeems,
    solve_developer_breakeven,
    solve_senior_breakeven,
    solve_senior_breakeven_phased,
)
from app.financial_model.engine import money_round
from app.financial_model.migrate import DEFAULT_FACILITY_TERMS as DEFAULT_FACILITY_TERMS_DICT
from app.financial_model.types import FacilityTerms, SalesPhasingTranche

# Fee-free facility terms (exit_fee_pct 0) -- the phased solver's `finance` basis,
# kept zeroed in every phased test below so it isolates the replay recurrence itself.
TERMS_FEE_FREE = FacilityTerms(**{**DEFAULT_FACILITY_TERMS_DICT, "exit_fee_pct": 0})


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
        # Python integers are arbitrary precision, so at an astronomic fee_floor (10**80)
        # bisection keeps making real progress for the full ~266 steps needed
        # (log2(10**80) =~ 265.75) before the 200-iteration cap correctly refuses to
        # exceed it, returning None rather than a partially bisected (wrong) number.
        # TS's regression at the same 10**80 magnitude hits the same cap for a *different*
        # reason: JS numbers are IEEE-754 doubles (not arbitrary precision), so bisection
        # only makes ~52 real halvings (the mantissa's bit-precision) before lo/hi/mid
        # collapse onto adjacent representable doubles and the search stalls, spinning
        # through the remaining iterations with no further progress until the same
        # 200-iteration cap -- see breakeven.test.ts's matching regression comment.
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


def _phased_base() -> PhasedSeniorBreakevenTerms:
    # 4 months; 10,000,000 drawn month 0; 2%/mo rolled up; fee 0 (isolates the recurrence);
    # two tranches 50/50 in months 2 and 3; no agent fee/legal/enforcement; 100% sweep.
    return PhasedSeniorBreakevenTerms(
        draws_and_fees_pence=[10_000_000, 0, 0, 0],
        monthly_rate=0.02,
        rolled_up=True,
        sales_sweep_pct=100,
        tranches=[
            SalesPhasingTranche(month_offset=2, pct_of_gross_receipts=50),
            SalesPhasingTranche(month_offset=3, pct_of_gross_receipts=50),
        ],
        selling_agent_fee_pct=0,
        selling_legal_fee_pence=0,
        enforcement_cost_assumption_pence=0,
        finance=TERMS_FEE_FREE,  # exit_fee_pct 0
        committed_gross_facility_pence=0,
    )


class TestSolveSeniorBreakevenPhased:
    """Transliteration of breakeven.test.ts's `solveSeniorBreakevenPhased (spec
    Sec 5.11 phased regime)` describe block (Release 3b Task 6)."""

    def test_matches_the_hand_derived_minimum_and_is_tight_g_minus_1_infeasible(self):
        # Hand derivation: balance m0 = 10,000,000x1.02 = 10,200,000 (fee cap round:
        # 10,000,000 + round(10,000,000x.02)); m1 x1.02 -> 10,404,000; m2 accrue ->
        # 10,612,080, sweep G/2 (round half-up, first tranche); remaining balance carries
        # as 10,612,080 - G/2; m3 accrues that at x1.02, and the second (residual) tranche
        # G - G/2 = G/2 must clear it fully:
        #   G/2 >= (10,612,080 - G/2)x1.02
        #   (G/2)x(1 + 1.02) >= 10,612,080x1.02
        #   (G/2)x2.02 >= 10,824,321.6  ->  G/2 >= 5,358,575.05...  ->  G >= 10,717,150.1...
        # Engine-verified value 10,717,150 (see breakeven.test.ts's matching comment for the
        # brief-vs-engine reconciliation history); the code here is a direct port.
        g = solve_senior_breakeven_phased(_phased_base())
        assert g is not None
        exact = g
        assert abs(exact - 10_717_150) <= 2  # rounding-step tolerance on the derivation
        # Tightness: the replay predicate itself flips exactly at g.
        assert phased_replay_redeems(_phased_base(), exact) is True
        assert phased_replay_redeems(_phased_base(), exact - 1) is False

    def test_single_tranche_at_the_final_month_degenerates_towards_the_static_solver_world(self):
        t = dc_replace(
            _phased_base(),
            tranches=[SalesPhasingTranche(month_offset=3, pct_of_gross_receipts=100)],
        )
        g = solve_senior_breakeven_phased(t)
        # balance at m3 = 10,000,000x1.02^3 (rounded per month); fee 0 -> G = that balance.
        assert g == 10_612_080 + money_round(10_612_080 * 0.02)

    def test_returns_none_when_draws_continue_after_the_final_tranche_or_sweep_is_0_pct(self):
        t1 = dc_replace(
            _phased_base(),
            draws_and_fees_pence=[10_000_000, 0, 0, 5_000_000],
            tranches=[SalesPhasingTranche(month_offset=2, pct_of_gross_receipts=100)],
        )
        assert solve_senior_breakeven_phased(t1) is None
        t2 = dc_replace(_phased_base(), sales_sweep_pct=0)
        assert solve_senior_breakeven_phased(t2) is None

    # Fix (post-review): the review found feasibility is not monotone in G when the
    # ledger's own partial-arm clamp is mirrored literally -- right where an intermediate
    # tranche's sweep first reaches the balance, the residual jumps UP by the (non-zero)
    # exit fee (below the crossing: residual = balance - sweep -> 0+; at/after it:
    # repayment becomes sweep - fee, residual = fee), so feasible(G) can go
    # true -> false -> true and the shared bisection can wrongly return None even though
    # larger G values are feasible. Spec Sec 5.11's fee-reserve modelling assumption
    # (phased_replay_redeems's doc comment) fixes this by reserving the fee out of every
    # tranche's sweep before repaying principal, making the residual continuous and
    # monotone in G. This shape -- two tranches skewed 90-95%/rest, with a non-zero FIXED
    # exit fee (the codebase's default exit_fee_basis shape) -- is exactly the one the
    # reviewer found broken.
    @staticmethod
    def _non_zero_fee_base(exit_fee_basis: str) -> PhasedSeniorBreakevenTerms:
        return PhasedSeniorBreakevenTerms(
            draws_and_fees_pence=[1_000_000, 0, 0, 0],
            monthly_rate=0.01,
            rolled_up=True,
            sales_sweep_pct=100,
            tranches=[
                SalesPhasingTranche(month_offset=2, pct_of_gross_receipts=95),
                SalesPhasingTranche(month_offset=3, pct_of_gross_receipts=5),
            ],
            selling_agent_fee_pct=0,
            selling_legal_fee_pence=0,
            enforcement_cost_assumption_pence=0,
            finance=TERMS_FEE_FREE.model_copy(
                update={"exit_fee_pct": 5, "exit_fee_basis": exit_fee_basis},
            ),
            committed_gross_facility_pence=1_000_000,  # fixed basis -> fee = 50,000 regardless of balance
        )

    def test_monotonicity_fixed_exit_fee_stays_feasible_well_past_the_solved_boundary(self):
        t = self._non_zero_fee_base("committed_gross_facility")
        g = solve_senior_breakeven_phased(t)
        assert g is not None
        exact = g
        assert phased_replay_redeems(t, exact) is True
        assert phased_replay_redeems(t, exact - 1) is False
        # The old (unreserved) implementation could flip back to infeasible above the
        # boundary -- this is exactly the spot-check that would have caught it.
        assert phased_replay_redeems(t, exact + 1) is True
        assert phased_replay_redeems(t, exact + 50_000) is True
        assert phased_replay_redeems(t, exact + 500_000) is True

    def test_monotonicity_same_shape_holds_for_the_peak_debt_exit_fee_basis(self):
        t = self._non_zero_fee_base("peak_debt")
        g = solve_senior_breakeven_phased(t)
        assert g is not None
        exact = g
        assert phased_replay_redeems(t, exact) is True
        assert phased_replay_redeems(t, exact - 1) is False
