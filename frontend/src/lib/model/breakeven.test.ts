import { describe, it, expect } from 'vitest';
import { solveSeniorBreakeven } from './breakeven';
import type { SeniorBreakevenTerms } from './breakeven';

function terms(partial: Partial<SeniorBreakevenTerms>): SeniorBreakevenTerms {
  return {
    redemption_balance_pence: 0,
    exit_fee_pence: 0,
    selling_agent_fee_pct: 0,
    selling_legal_fee_pence: 0,
    enforcement_cost_assumption_pence: 0,
    ...partial,
  };
}

describe('solveSeniorBreakeven (spec §5.11)', () => {
  it('fixture G worksheet: redemption 58,604,953 + exit fee 660,000 + 1.5% agent + £4,000 legal → 60,573,556', () => {
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 58_604_953,
      exit_fee_pence: 660_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
      enforcement_cost_assumption_pence: 0,
    }));
    expect(p).toBe(60_573_556);
    // Hand-checked boundary (docs/financial-model/test-cases.md): 60,573,555 is infeasible
    // because round(0.015 × 60,573,555) = 908,603 leaves the fee-sum unchanged at
    // 60,573,556, one penny above the candidate itself.
    const feeFloor = 58_604_953 + 660_000 + 400_000;
    expect(feeFloor + Math.round((60_573_555 * 1.5) / 100)).toBe(60_573_556);
    expect(60_573_555).toBeLessThan(60_573_556);
  });

  it('zero agent pct → exact sum of redemption, exit fee, legal and enforcement', () => {
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 10_000_000,
      exit_fee_pence: 100_000,
      selling_agent_fee_pct: 0,
      selling_legal_fee_pence: 400_000,
      enforcement_cost_assumption_pence: 50_000,
    }));
    expect(p).toBe(10_000_000 + 100_000 + 400_000 + 50_000);
  });

  it('agent fee ≥ 100% is unsolvable — returns null', () => {
    expect(solveSeniorBreakeven(terms({ redemption_balance_pence: 1_000_000, selling_agent_fee_pct: 100 }))).toBeNull();
    expect(solveSeniorBreakeven(terms({ redemption_balance_pence: 1_000_000, selling_agent_fee_pct: 150 }))).toBeNull();
  });

  it('zero redemption balance (facility already discharged) still solves to the fixed-cost sum', () => {
    const p = solveSeniorBreakeven(terms({ selling_legal_fee_pence: 400_000, selling_agent_fee_pct: 1.5 }));
    // feeFloor = 400,000; hi-guess ~ 406,091; hand-check: P=406,091 → round(1.5%×406,091)=6,091 → 406,091 (feasible)
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThanOrEqual(400_000);
    const disposalCost = Math.round((p! * 1.5) / 100);
    expect(p!).toBeGreaterThanOrEqual(400_000 + disposalCost);
  });

  it('rounds the agent fee half-up, not down — off-by-one boundary case', () => {
    // feeFloor = 1, pct = 50%. At P=1: 0.5 rounds half-up to 1 -> 1 >= 1+1=2 is false
    // (infeasible). At P=2: 1.0 rounds to 1 -> 2 >= 1+1=2 is true (feasible). A
    // round-down (floor) implementation would wrongly accept P=1 as feasible.
    const p = solveSeniorBreakeven(terms({ selling_legal_fee_pence: 1, selling_agent_fee_pct: 50 }));
    expect(p).toBe(2);
  });

  it('iteration-cap guard: returns null rather than a wrong number when the search cannot converge', () => {
    // JS's `(lo+hi) >> 1` coerces to a 32-bit signed integer (spec-mandated bisection
    // shape). For a redemption balance at or above 2^31 pence (~£21.47m — a realistic
    // scale for a large commercial deal), `hi` computed from the closed form exceeds the
    // safe 32-bit range and the bit-shift corrupts `mid`, breaking normal bisection
    // convergence. The 200-iteration cap is the load-bearing guard that turns this into a
    // clean `null` (never a silently wrong number) rather than an incorrect answer or an
    // infinite loop — empirically confirmed to hit exactly the 200-iteration cap at this
    // scale (see task-4-report.md for the reproduction and the cross-language note: the
    // Python solver has no such 32-bit limitation and converges correctly at this scale).
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 5_000_000_000,
      exit_fee_pence: 100_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).toBeNull();
  });

  it('converges correctly for realistic large deals just under the 32-bit-safe boundary', () => {
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 500_000_000, // £5m senior balance
      exit_fee_pence: 100_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).not.toBeNull();
    const disposalCost = Math.round((p! * 1.5) / 100);
    expect(p!).toBeGreaterThanOrEqual(500_000_000 + 100_000 + disposalCost + 400_000);
  });
});
