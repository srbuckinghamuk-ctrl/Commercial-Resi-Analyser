import { describe, it, expect } from 'vitest';
import {
  solveSeniorBreakeven, solveDeveloperBreakeven, solveSeniorBreakevenPhased, phasedReplayRedeems,
} from './breakeven';
import type { SeniorBreakevenTerms, DeveloperBreakevenTerms, PhasedSeniorBreakevenTerms } from './breakeven';
import { DEFAULT_FACILITY_TERMS } from '../conversion-defaults';
import type { FacilityTerms } from './finance-types';

// Fee-free facility terms (exit_fee_pct 0) — the phased solver's `finance` basis, kept
// zeroed in every phased test below so it isolates the replay recurrence itself.
const TERMS_FEE_FREE: FacilityTerms = { ...DEFAULT_FACILITY_TERMS, exit_fee_pct: 0 };

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

  it('regression: converges to the exact integer for a large deal that a 32-bit `>>1` midpoint ' +
    'used to break (fixed — see docs/financial-model/test-cases.md)', () => {
    // Historical bug (fixed in the same change that added this regression test): the
    // midpoint used to be computed as `(lo + hi) >> 1`, which coerces to a 32-bit signed
    // integer in JS. For a redemption balance at or above 2^31 pence (~£21.47m — a
    // realistic scale for a large commercial deal), the closed-form `hi` exceeded the safe
    // 32-bit range and the bit-shift corrupted `mid`, exhausting the 200-iteration cap and
    // returning null for a genuinely solvable deal. `mid` is now `Math.floor((lo+hi)/2)`,
    // which has no such ceiling. Closed-form worksheet: fee_floor = 5,000,000,000 +
    // 100,000 + 400,000 = 5,000,500,000; guess = 5,000,500,000 / 0.985 =
    // 5,076,649,746.19…; hand-checked boundary — at P=5,076,649,745,
    // round(1.5% × P) = 76,149,746, RHS = 5,076,649,746, P < RHS (infeasible); at
    // P=5,076,649,746, round(1.5% × P) = 76,149,746, RHS = 5,076,649,746, P >= RHS
    // (feasible, equality) — minimum feasible P = 5,076,649,746. Python's `//2` midpoint
    // (which never had the 32-bit issue) converges to the identical integer — see
    // tests/test_financial_model_breakeven.py's matching regression test; both languages
    // must agree exactly.
    const p = solveSeniorBreakeven(terms({
      redemption_balance_pence: 5_000_000_000,
      exit_fee_pence: 100_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).toBe(5_076_649_746);
    const feeFloor = 5_000_000_000 + 100_000 + 400_000;
    expect(feeFloor + Math.round((5_076_649_745 * 1.5) / 100)).toBe(5_076_649_746);
    expect(5_076_649_745).toBeLessThan(5_076_649_746);
  });

  it('converges correctly for realistic large deals', () => {
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

  it('iteration-cap guard: returns null rather than a wrong number when the search genuinely ' +
    'cannot converge within 200 steps', () => {
    // `Math.floor((lo+hi)/2)` has no 32-bit ceiling, but unlike Python's arbitrary-precision
    // integers, JS numbers are IEEE-754 doubles with only ~52 bits of mantissa. At an
    // astronomic fee floor (10^80 — far beyond any real financial figure), the range
    // [lo, hi] only supports ~52 *real* halvings before lo/hi/mid collapse onto adjacent
    // representable doubles (the gap between neighbouring doubles near 10^80 is itself
    // ~10^64) — `mid` then equals `lo` or `hi` every iteration and the search stalls,
    // making no further numeric progress. The loop keeps spinning through the remaining
    // iterations without converging until it hits the 200-iteration cap and correctly
    // returns null (never a partially-bisected, wrong number) rather than looping forever
    // or silently returning early. This is a *different* mechanism from the Python
    // regression at the same 10^80 magnitude
    // (test_iteration_cap_guard_genuinely_reachable_at_extreme_magnitude): Python's ints
    // are arbitrary precision, so its bisection keeps making real progress for the full
    // ~266 steps (log2(10^80) ≈ 265.75) before hitting its own 200-iteration cap — both
    // languages reach the same cap-triggered null result, for two distinct reasons.
    const p = solveSeniorBreakeven(terms({ selling_legal_fee_pence: 1e80, selling_agent_fee_pct: 50 }));
    expect(p).toBeNull();
  });
});

function devTerms(partial: Partial<DeveloperBreakevenTerms>): DeveloperBreakevenTerms {
  return {
    tdc_ex_selling_pence: 0,
    selling_agent_fee_pct: 0,
    selling_legal_fee_pence: 0,
    ...partial,
  };
}

describe('solveDeveloperBreakeven (spec §5.12)', () => {
  it('fixture G worksheet: TDC-ex-selling 94,264,953 + 1.5% agent + £4,000 legal → 96,106,551', () => {
    const p = solveDeveloperBreakeven(devTerms({
      tdc_ex_selling_pence: 94_264_953,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).toBe(96_106_551);
    // Hand-checked boundary (docs/financial-model/test-cases.md): 96,106,550 is infeasible
    // because round(0.015 × 96,106,550) = 1,441,598 leaves the fee-sum at 96,106,551, one
    // penny above the candidate itself.
    const feeFloor = 94_264_953 + 400_000;
    expect(feeFloor + Math.round((96_106_550 * 1.5) / 100)).toBe(96_106_551);
    expect(96_106_550).toBeLessThan(96_106_551);
  });

  it('fixture A worksheet: TDC-ex-selling 89,188,400 + 1.5% agent + £4,000 legal → 90,952,690', () => {
    const p = solveDeveloperBreakeven(devTerms({
      tdc_ex_selling_pence: 89_188_400,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).toBe(90_952_690);
    const feeFloor = 89_188_400 + 400_000;
    expect(feeFloor + Math.round((90_952_689 * 1.5) / 100)).toBe(90_952_690);
    expect(90_952_689).toBeLessThan(90_952_690);
  });

  it('zero agent pct → exact sum of TDC-ex-selling and legal fee', () => {
    const p = solveDeveloperBreakeven(devTerms({
      tdc_ex_selling_pence: 10_000_000,
      selling_agent_fee_pct: 0,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).toBe(10_000_000 + 400_000);
  });

  it('agent fee ≥ 100% is unsolvable — returns null', () => {
    expect(solveDeveloperBreakeven(devTerms({ tdc_ex_selling_pence: 1_000_000, selling_agent_fee_pct: 100 }))).toBeNull();
    expect(solveDeveloperBreakeven(devTerms({ tdc_ex_selling_pence: 1_000_000, selling_agent_fee_pct: 150 }))).toBeNull();
  });

  it('rounds the agent fee half-up, not down — off-by-one boundary case', () => {
    // feeFloor = 1, pct = 50%. At P=1: 0.5 rounds half-up to 1 -> 1 >= 1+1=2 is false
    // (infeasible). At P=2: 1.0 rounds to 1 -> 2 >= 1+1=2 is true (feasible).
    const p = solveDeveloperBreakeven(devTerms({ selling_legal_fee_pence: 1, selling_agent_fee_pct: 50 }));
    expect(p).toBe(2);
  });

  it('converges correctly for realistic large deals (shares the same bisection helper as ' +
    'solveSeniorBreakeven, proven at scale by that suite)', () => {
    const p = solveDeveloperBreakeven(devTerms({
      tdc_ex_selling_pence: 500_000_000,
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 400_000,
    }));
    expect(p).not.toBeNull();
    const disposalCost = Math.round((p! * 1.5) / 100);
    expect(p!).toBeGreaterThanOrEqual(500_000_000 + disposalCost + 400_000);
  });
});

describe('solveSeniorBreakevenPhased (spec §5.11 phased regime)', () => {
  // 4 months; 10,000,000 drawn month 0; 2%/mo rolled up; fee 0 (isolates the recurrence);
  // two tranches 50/50 in months 2 and 3; no agent fee/legal/enforcement; 100% sweep.
  const base = (): PhasedSeniorBreakevenTerms => ({
    draws_and_fees_pence: [10_000_000, 0, 0, 0],
    vat_reclaims_pence: [0, 0, 0, 0],   // R24: no VAT in this shape — the reclaim tests are below
    monthly_rate: 0.02,
    rolled_up: true,
    sales_sweep_pct: 100,
    tranches: [
      { month_offset: 2, pct_of_gross_receipts: 50 },
      { month_offset: 3, pct_of_gross_receipts: 50 },
    ],
    selling_agent_fee_pct: 0,
    selling_legal_fee_pence: 0,
    enforcement_cost_assumption_pence: 0,
    finance: { ...TERMS_FEE_FREE },            // reuse/extend the file's terms helper; exit_fee_pct 0
    committed_gross_facility_pence: 0,
  });

  it('matches the hand-derived minimum and is tight (G−1 infeasible)', () => {
    // Hand derivation: balance m0 = 10,000,000×1.02 = 10,200,000 (fee cap round: 10,000,000
    // + round(10,000,000×.02)); m1 ×1.02 → 10,404,000; m2 accrue → 10,612,080, sweep G/2 (round
    // half-up, first tranche); remaining balance carries as 10,612,080 − G/2; m3 accrues that at
    // ×1.02, and the second (residual) tranche G − G/2 = G/2 must clear it fully:
    //   G/2 ≥ (10,612,080 − G/2)×1.02
    //   (G/2)×(1 + 1.02) ≥ 10,612,080×1.02
    //   (G/2)×2.02 ≥ 10,824,321.6  →  G/2 ≥ 5,358,575.05…  →  G ≥ 10,717,150.1…
    // Deviation from brief: the brief's own worksheet comment stated G ≥ 10,715,163.5 and an
    // expected value of 10,715,164, but that arithmetic doesn't satisfy its own stated
    // inequality (10,715,164/2 × 2.02 = 10,822,315.7 ≠ 10,824,321.6 — a genuine slip, not a
    // rounding-tolerance question). Root-caused by: (a) re-deriving the closed form above
    // independently and confirming it needs the /2.02 divisor, not /2; (b) exhaustively
    // replaying phasedReplayRedeems for every integer G in [10,715,160, 10,717,200] — the
    // first feasible G is 10,717,150, exactly matching the corrected closed form; (c)
    // cross-checking against the *next* test's independently-derivable expected value
    // (10,612,080 + round(10,612,080×0.02) = 10,824,322), which the code reproduces exactly —
    // proving phasedReplayRedeems/solveSeniorBreakevenPhased themselves are correct and the
    // fault was isolated to the first worksheet's constant. Corrected here to the
    // engine-verified value; the code in breakeven.ts is unchanged from the brief.
    const g = solveSeniorBreakevenPhased(base());
    expect(g).not.toBeNull();
    const exact = g as number;
    expect(Math.abs(exact - 10_717_150)).toBeLessThanOrEqual(2);  // rounding-step tolerance on the derivation
    // Tightness: the replay predicate itself flips exactly at g (export it for this test).
    expect(phasedReplayRedeems(base(), exact)).toBe(true);
    expect(phasedReplayRedeems(base(), exact - 1)).toBe(false);
  });

  it('single tranche at the final month degenerates towards the static solver world', () => {
    const t = { ...base(), tranches: [{ month_offset: 3, pct_of_gross_receipts: 100 }] };
    const g = solveSeniorBreakevenPhased(t);
    // balance at m3 = 10,000,000×1.02³ (rounded per month); fee 0 → G = that balance.
    expect(g).toBe(10_612_080 + Math.round(10_612_080 * 0.02));
  });

  it('returns null when draws continue after the final tranche or sweep is 0%', () => {
    expect(solveSeniorBreakevenPhased({
      ...base(), draws_and_fees_pence: [10_000_000, 0, 0, 5_000_000],
      tranches: [{ month_offset: 2, pct_of_gross_receipts: 100 }],
    })).toBeNull();
    expect(solveSeniorBreakevenPhased({ ...base(), sales_sweep_pct: 0 })).toBeNull();
  });

  // Fix (post-review): the review found feasibility is not monotone in G when the ledger's
  // own partial-arm clamp is mirrored literally — right where an intermediate tranche's
  // sweep first reaches the balance, the residual jumps UP by the (non-zero) exit fee
  // (below the crossing: residual = balance − sweep → 0⁺; at/after it: repayment becomes
  // sweep − fee, residual = fee), so feasible(G) can go true → false → true and the shared
  // bisection can wrongly return null even though larger G values are feasible. §5.11's
  // fee-reserve modelling assumption (spec §5.11 phased regime, breakeven.ts's
  // phasedReplayRedeems doc comment) fixes this by reserving the fee out of every tranche's
  // sweep before repaying principal, making the residual continuous and monotone in G. This
  // shape — two tranches skewed 90–95%/rest, with a non-zero FIXED exit fee (the codebase's
  // default exit_fee_basis shape) — is exactly the one the reviewer found broken; it is a
  // monotonicity spot-check the old (unreserved) implementation would have failed at the
  // g+50,000 / g+500,000 assertions below (those G values sit past the point where the
  // ledger-mirroring clamp would have reintroduced a fee-sized residual).
  function nonZeroFeeBase(exitFeeBasis: FacilityTerms['exit_fee_basis']): PhasedSeniorBreakevenTerms {
    return {
      draws_and_fees_pence: [1_000_000, 0, 0, 0],
      vat_reclaims_pence: [0, 0, 0, 0],   // R24: no VAT in this shape
      monthly_rate: 0.01,
      rolled_up: true,
      sales_sweep_pct: 100,
      tranches: [
        { month_offset: 2, pct_of_gross_receipts: 95 },
        { month_offset: 3, pct_of_gross_receipts: 5 },
      ],
      selling_agent_fee_pct: 0,
      selling_legal_fee_pence: 0,
      enforcement_cost_assumption_pence: 0,
      finance: { ...TERMS_FEE_FREE, exit_fee_pct: 5, exit_fee_basis: exitFeeBasis },
      committed_gross_facility_pence: 1_000_000,   // fixed basis → fee = 50,000 regardless of balance
    };
  }

  it('monotonicity: a non-zero fixed exit fee stays feasible well past the solved boundary ' +
    '(committed_gross_facility basis)', () => {
    const t = nonZeroFeeBase('committed_gross_facility');
    const g = solveSeniorBreakevenPhased(t);
    expect(g).not.toBeNull();
    const exact = g as number;
    expect(phasedReplayRedeems(t, exact)).toBe(true);
    expect(phasedReplayRedeems(t, exact - 1)).toBe(false);
    // The old (unreserved) implementation could flip back to infeasible above the boundary —
    // this is exactly the spot-check that would have caught it.
    expect(phasedReplayRedeems(t, exact + 1)).toBe(true);
    expect(phasedReplayRedeems(t, exact + 50_000)).toBe(true);
    expect(phasedReplayRedeems(t, exact + 500_000)).toBe(true);
  });

  it('monotonicity: same shape holds for the peak_debt exit-fee basis', () => {
    const t = nonZeroFeeBase('peak_debt');
    const g = solveSeniorBreakevenPhased(t);
    expect(g).not.toBeNull();
    const exact = g as number;
    expect(phasedReplayRedeems(t, exact)).toBe(true);
    expect(phasedReplayRedeems(t, exact - 1)).toBe(false);
  });
});

describe('ruling R24 — the phased replay applies the VAT reclaim (spec §17.6)', () => {
  /** Four months, 10,000,000 drawn at month 0 at 2%/mo rolled up, two 50/50
   *  tranches in months 2 and 3, no fees. Identical to the file's `base()`
   *  except for the reclaim under test, so the comparison below isolates it. */
  const reclaimBase = (reclaims: number[]): PhasedSeniorBreakevenTerms => ({
    draws_and_fees_pence: [10_000_000, 0, 0, 0],
    vat_reclaims_pence: reclaims,
    monthly_rate: 0.02,
    rolled_up: true,
    sales_sweep_pct: 100,
    tranches: [
      { month_offset: 2, pct_of_gross_receipts: 50 },
      { month_offset: 3, pct_of_gross_receipts: 50 },
    ],
    selling_agent_fee_pct: 0,
    selling_legal_fee_pence: 0,
    enforcement_cost_assumption_pence: 0,
    finance: { ...TERMS_FEE_FREE },
    committed_gross_facility_pence: 0,
  });

  it('solves a strictly lower break-even when a reclaim repays part of the balance', () => {
    // A comparison, not an absolute: an absolute literal would pin whatever the
    // solver happens to produce rather than the rule under test. The ledger
    // repays from the reclaim, so a replay that ignores it solves for a sale
    // price the deal does not actually need.
    const without = solveSeniorBreakevenPhased(reclaimBase([0, 0, 0, 0]));
    const withReclaim = solveSeniorBreakevenPhased(reclaimBase([0, 2_000_000, 0, 0]));
    expect(without).not.toBeNull();
    expect(withReclaim).not.toBeNull();
    expect(withReclaim as number).toBeLessThan(without as number);
  });

  it('applies the reclaim BEFORE the tranche sweep, in the reclaim’s own month', () => {
    // Order is falsifiable here: a reclaim landing in the same month as a
    // tranche must shrink the balance that tranche has to clear. Applying it
    // after the sweep would leave the month-2 tranche facing the full balance,
    // pushing the solved G back up towards the reclaim-free answer.
    const sameMonth = solveSeniorBreakevenPhased(reclaimBase([0, 0, 2_000_000, 0]));
    const monthLater = solveSeniorBreakevenPhased(reclaimBase([0, 0, 0, 2_000_000]));
    expect(sameMonth).not.toBeNull();
    expect(monthLater).not.toBeNull();
    // Earlier is cheaper: the month-2 reclaim also saves a month of interest on
    // what it repays, so it must solve strictly lower than the month-3 one.
    expect(sameMonth as number).toBeLessThan(monthLater as number);
    // …and both must beat the reclaim-free trajectory.
    expect(monthLater as number)
      .toBeLessThan(solveSeniorBreakevenPhased(reclaimBase([0, 0, 0, 0])) as number);
  });

  it('a reclaim that clears the balance outright needs no sale price at all', () => {
    // §17.6: a full reclaim redeems on the same terms as any other full
    // redemption. Once redeemed, no tranche receipt is needed to redeem again.
    const g = solveSeniorBreakevenPhased(reclaimBase([0, 20_000_000, 0, 0]));
    expect(g).toBe(0);
    expect(phasedReplayRedeems(reclaimBase([0, 20_000_000, 0, 0]), 0)).toBe(true);
  });

  it('does not sweep the reclaim through sales_sweep_pct', () => {
    // §17.6: the reclaim returns a specific advance rather than realising an
    // asset, so it is applied WHOLE. Halving the sweep must leave a
    // reclaim-only trajectory's redemption untouched.
    const full = { ...reclaimBase([0, 20_000_000, 0, 0]), sales_sweep_pct: 100 };
    const halved = { ...reclaimBase([0, 20_000_000, 0, 0]), sales_sweep_pct: 50 };
    expect(phasedReplayRedeems(full, 0)).toBe(true);
    expect(phasedReplayRedeems(halved, 0)).toBe(true);
  });

  it('monotonicity survives a reclaim landing between two tranches (the fee reserve, watched failing)', () => {
    // The reclaim does not move with G, but the BALANCE it meets does the moment
    // a tranche precedes it — so the ledger's own clamp reintroduces exactly the
    // discontinuity §5.11's fee reserve exists to remove, one month earlier.
    // This shape has been WATCHED FAILING: swap the reclaim arm in breakeven.ts
    // for the ledger's clamp (`applied = min(reclaim, balance)`, falling back to
    // `reclaim − fee` only when that would exactly clear the balance) and the
    // solver returns 10,015,752 while G values in [10,064,448, 10,064,789] do
    // NOT redeem — the scan below fails at d = 49,000. A guard nobody has
    // watched fail is not a guard.
    const t: PhasedSeniorBreakevenTerms = {
      ...reclaimBase([0, 0, 500_000, 0]),
      tranches: [
        { month_offset: 1, pct_of_gross_receipts: 99 },
        { month_offset: 3, pct_of_gross_receipts: 1 },
      ],
      finance: { ...TERMS_FEE_FREE, exit_fee_pct: 5, exit_fee_basis: 'committed_gross_facility' },
      committed_gross_facility_pence: 1_000_000,   // fixed basis → fee = 50,000 regardless
    };
    const g = solveSeniorBreakevenPhased(t);
    expect(g).not.toBeNull();
    const exact = g as number;
    expect(phasedReplayRedeems(t, exact)).toBe(true);
    expect(phasedReplayRedeems(t, exact - 1)).toBe(false);
    // Feasibility must never go true → false as G grows: the bisection's
    // correctness depends on it, and a hole above the solved boundary means the
    // reported break-even is UNDERSTATED — a price that does not redeem.
    for (let d = 0; d <= 200_000; d += 500) {
      expect(phasedReplayRedeems(t, exact + d)).toBe(true);
    }
  });
});
