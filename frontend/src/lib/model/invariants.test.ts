import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import { pct } from './metrics';
import { exitFeeAmount } from './monthly-engine';
import { migrateInputsToV4 } from './migrate';
import { spreadByCurve } from './curves';
import type {
  AnyCalculatorInputs, CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV4,
  ProgrammeInputs, SpendCurve,
} from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as {
    name: string; kind: string; inputs: CalculatorInputsV3;
  })
  // Release 4a: the corpus now contains an inputs-less fixture. Fixture K
  // (kind 'sensitivity', spec §12) names a `base_fixture` rather than carrying its own
  // document — see model-governance.md §2.1 — so there is nothing here to run through
  // the ledger. Its own contract is asserted in golden-fixtures.test.ts.
  .filter((fx) => fx.kind !== 'sensitivity');

// Release 3a Task 9: a generic programme fitted to any term_months, sitting well
// inside the spec §6 window bound (finish by term-2) — every package starts at
// month 0, so it stays valid even for a short term rather than assuming term=12.
function programmeForTerm(termMonths: number): ProgrammeInputs {
  const term = Math.max(1, Math.floor(termMonths));
  const cap = Math.max(1, term - 2);
  return {
    anchor_month: null,
    packages: {
      construction: { start_offset: 0, duration_months: Math.min(6, cap), curve: { kind: 's_curve' } },
      professional: { start_offset: 0, duration_months: Math.min(3, cap), curve: { kind: 'straight_line' } },
      statutory: { start_offset: 0, duration_months: Math.min(2, cap), curve: { kind: 'back_loaded' } },
    },
  };
}

// Variants derived from each fixture to widen coverage without new hand calcs.
function variants(
  inputs: CalculatorInputsV2 | CalculatorInputsV3,
): Array<{ label: string; inputs: AnyCalculatorInputs }> {
  const clone = () => JSON.parse(JSON.stringify(inputs)) as CalculatorInputsV2 | CalculatorInputsV3;
  const retained = clone();
  retained.exit_strategy.route = 'retain_all';
  const serviced = clone();
  serviced.finance.interest_type = 'serviced';
  const shortTerm = clone();
  shortTerm.finance.term_months = 1;
  // Release 3a Task 9: a programme variant so every existing ledger invariant in this
  // file's top describe block also exercises the dated-programme path (spec §6.1),
  // not just fixture H's hand-authored one.
  const programmed = migrateInputsToV4(clone() as unknown as Record<string, unknown>);
  programmed.programme = programmeForTerm(programmed.finance.term_months);
  return [
    { label: 'base', inputs },
    { label: 'retain_all', inputs: retained },
    { label: 'serviced', inputs: serviced },
    { label: 'term=1', inputs: shortTerm },
    { label: 'programme', inputs: programmed },
  ];
}

describe('model invariants hold for every fixture and variant', () => {
  for (const fx of fixtures) {
    for (const v of variants(fx.inputs)) {
      describe(`${fx.name} [${v.label}]`, () => {
        const run = runAppraisal(v.inputs);

        it('debt roll-forward reconciles and closing balance is never negative', () => {
          for (const m of run.model.months) {
            expect(m.closing_balance_pence).toBe(
              m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
              + m.interest_capitalised_pence - m.repayment_pence);
            expect(m.closing_balance_pence).toBeGreaterThanOrEqual(0);
          }
        });

        // Release 3a Task 9: sources = uses is an unconditional accounting identity
        // (validation.ts reconcile()), not just true "when fully realised" — this closes
        // the gap where only the fullyRealised profit-identity test below exercised it,
        // and is exactly what surfaces a programme mis-wiring in buildSchedule.
        it('sources equal uses unconditionally (spec §7)', () => {
          expect(run.reconciliation.sources_equal_uses).toBe(true);
        });

        it('peak debt equals the maximum monthly pre-repayment balance', () => {
          const maxBalance = Math.max(0, ...run.model.months.map((m) =>
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence + m.interest_capitalised_pence));
          expect(run.model.peak_debt_pence).toBe(maxBalance);
        });

        it('cash funding produces zero debt cost', () => {
          if (v.inputs.finance.funding_source === 'cash') {
            expect(run.metrics.finance_costs_pence).toBe(0);
            expect(run.model.totals.draws_pence).toBe(0);
          }
        });

        it('retained exits receive no sale proceeds', () => {
          if (v.inputs.exit_strategy.route === 'retain_all') {
            expect(run.model.months.every((m) => m.gross_receipts_pence === 0)).toBe(true);
            expect(run.metrics.selling_costs_pence).toBe(0);
          }
        });

        it('monthly schedule spreads sum exactly to cost totals', () => {
          const sum = (f: (m: typeof run.schedule.uses[number]) => number) =>
            run.schedule.uses.reduce((a, m) => a + f(m), 0);
          expect(sum((m) => m.construction_pence)).toBe(run.schedule.totals.construction_pence);
          expect(sum((m) => m.professional_pence)).toBe(run.schedule.totals.professional_pence);
          expect(sum((m) => m.statutory_pence)).toBe(run.schedule.totals.statutory_pence);
        });

        it('when debt fully repaid and nothing retained, profit equals Σ equity flows and sources equal uses', () => {
          const fullyRealised = run.model.senior_outstanding_at_maturity_pence === 0
            && run.schedule.totals.retained_value_pence === 0
            && run.model.totals.funding_gap_pence === 0;
          if (fullyRealised) {
            expect(run.metrics.profit_pence)
              .toBe(run.model.equity_cashflows_pence.reduce((a, b) => a + b, 0));
            expect(run.reconciliation.sources_equal_uses).toBe(true);
          }
        });

        // Task 6 correction (spec §7): monthly uses_total_pence includes month-0 ancillary
        // fees but NOT the capitalised arrangement fee, while TDC (from metrics) does
        // include it — so the identity needs an explicit + capitalised_fees_pence term.
        it('TDC equals the sum of all monthly uses plus rolled interest, capitalised fees and exit fee', () => {
          const monthlyUses = run.model.months.reduce((a, m) => a + m.uses_total_pence, 0);
          const rolled = run.model.months.reduce((a, m) => a + m.interest_capitalised_pence, 0);
          const serviced2 = run.model.months.reduce((a, m) => a + m.interest_serviced_pence, 0);
          expect(run.metrics.total_development_cost_pence).toBe(
            monthlyUses + rolled + serviced2 + run.metrics.selling_costs_pence
            + run.model.totals.exit_fee_pence + run.model.totals.capitalised_fees_pence);
        });
      });
    }
  }
});

// Release 3b Task 10 (spec §4.4.1/§4.5, calc 2.3.0): phased-sale / refinance sweep
// invariants over fixture I (phased sell_all) and J (phased + blended refinance) —shaped
// inputs, plus two "awkward pence" derivatives per fixture (odd gross totals; a 3-tranche
// 33.4/33.3/33.3 split) — 2 fixtures × 3 variants = 6 runs. Both fixtures, and every
// derivative built here, keep finance.interest_type = 'rolled_up' and a non-negative
// refinance net proceeds figure (never touched by these variants) — that is what makes
// invariant 2 below an *exact* equality rather than a bound: with rolled_up interest,
// monthly-engine.ts's interest-serviced branch (the other source that can add to
// additional_equity_pence, lines ~166-172) never fires, so every pence of
// additional_equity_pence(m) in these runs is attributable to the refinance-shortfall
// branches alone (lines ~211-238) — see the identity derivation in the test body.
function toV4Clone(inputs: AnyCalculatorInputs): CalculatorInputsV4 {
  if (inputs.inputs_version !== 4) throw new Error('sweep-invariant fixture must be inputs_version 4');
  return JSON.parse(JSON.stringify(inputs)) as CalculatorInputsV4;
}

function oddGrossSweepVariant(inputs: AnyCalculatorInputs): CalculatorInputsV4 {
  const v = toV4Clone(inputs);
  // Nudge each unit's value by a distinct odd pence amount so gross sale totals,
  // tranche splits and agent-fee rounding all land on awkward (non-round) pence.
  v.unit_mix.units.forEach((u, i) => { u.estimated_value_pence += 2 * i + 1; });
  return v;
}

function threeTrancheSweepVariant(inputs: AnyCalculatorInputs): CalculatorInputsV4 {
  const v = toV4Clone(inputs);
  const last = Math.max(0, Math.floor(v.finance.term_months) - 1);
  v.sales_phasing = {
    tranches: [
      { month_offset: Math.max(0, last - 2), pct_of_gross_receipts: 33.4 },
      { month_offset: Math.max(0, last - 1), pct_of_gross_receipts: 33.3 },
      { month_offset: last, pct_of_gross_receipts: 33.3 },
    ],
  };
  return v;
}

function sweepVariants(
  inputs: AnyCalculatorInputs,
): Array<{ label: string; inputs: CalculatorInputsV4 }> {
  return [
    { label: 'base', inputs: toV4Clone(inputs) },
    { label: 'odd-gross', inputs: oddGrossSweepVariant(inputs) },
    { label: 'three-tranche', inputs: threeTrancheSweepVariant(inputs) },
  ];
}

const sweepFixtures = fixtures.filter((f) => f.name.startsWith('I —') || f.name.startsWith('J —'));
if (sweepFixtures.length !== 2) {
  throw new Error('expected exactly fixtures I and J in the shared corpus for the sweep-invariant matrix');
}

describe('phased-sale / refinance sweep invariants (spec §4.4.1/§4.5, calc 2.3.0)', () => {
  for (const fx of sweepFixtures) {
    for (const v of sweepVariants(fx.inputs)) {
      describe(`${fx.name} [${v.label}]`, () => {
        const run = runAppraisal(v.inputs);
        const monthlyRate = v.inputs.finance.annual_interest_rate_pct / 100 / 12;

        it('tranche conservation: Σ gross/agent/legal receipts reconcile exactly to totals', () => {
          const sumGross = run.schedule.receipts.reduce((a, r) => a + r.gross_sale_pence, 0);
          const sumAgent = run.schedule.receipts.reduce((a, r) => a + r.agent_fee_pence, 0);
          const sumLegal = run.schedule.receipts.reduce((a, r) => a + r.selling_legal_pence, 0);
          expect(sumGross).toBe(run.schedule.totals.gross_sales_pence);
          expect(sumAgent).toBe(Math.round(
            (run.schedule.totals.gross_sales_pence * v.inputs.exit_strategy.selling_agent_fee_pct) / 100));
          expect(sumLegal).toBe(
            run.schedule.totals.gross_sales_pence > 0 ? v.inputs.exit_strategy.selling_legal_fee_pence : 0);
        });

        // Pinned identity, derived from monthly-engine.ts's sweep block (repayment/exit_fee/
        // distribution split netReceipts exactly: `distribution = netReceipts - repayment -
        // exitFee`) composed with its refinance block (which either (a) tops up distribution
        // by `refiNet - required` when refiNet >= balance+fee, or (b) adds `required - refiNet`
        // to additional_equity when it doesn't, or (c) — balance already 0 — adds the whole
        // refiNet to distribution): in every case the four fields below net to exactly zero.
        // Holds every month, not just disposal/refinance months (both sides are 0 otherwise).
        it('sweep conservation: distribution + repayment + exit fee == net receipts + refinance proceeds + additional equity, every month', () => {
          for (const m of run.model.months) {
            expect(m.distribution_pence + m.repayment_pence + m.exit_fee_pence).toBe(
              m.net_receipts_pence + m.refinance_proceeds_pence + m.additional_equity_pence);
          }
        });

        it('interest never accrues on repaid principal: interest_accrued[m+1] == round((closing[m] + draw[m+1] + capFees[m+1]) × monthlyRate)', () => {
          const months = run.model.months;
          for (let i = 0; i < months.length - 1; i++) {
            const expected = Math.round(
              (months[i].closing_balance_pence + months[i + 1].draw_pence
                + months[i + 1].capitalised_fees_pence) * monthlyRate);
            expect(months[i + 1].interest_accrued_pence).toBe(expected);
          }
        });

        it('redemption schedule: balances non-increasing, months strictly increasing, scalar equals last entry', () => {
          const sched = run.model.redemption_schedule;
          for (let i = 1; i < sched.length; i++) {
            expect(sched[i].month).toBeGreaterThan(sched[i - 1].month);
            expect(sched[i].balance_pence).toBeLessThanOrEqual(sched[i - 1].balance_pence);
          }
          if (sched.length > 0) {
            expect(run.model.redemption_balance_at_disposal_pence).toBe(sched[sched.length - 1].balance_pence);
          }
        });
      });
    }
  }
});

// Release 3a Task 9 (spec §6.1, calc 2.2.0): every spend-curve kind, exercised across a
// small matrix of (total, D) pairs chosen to be awkward for integer rounding — prime
// month-counts, a prime total, and a total smaller than the month-count — must still
// satisfy the two properties every curve promises regardless of kind (exact-sum, length),
// with the two ramp kinds (s_curve, back_loaded) additionally promising a non-decreasing
// cumulative spend (spec §6.1's "no month gives back money" invariant).
function curveForKind(kind: SpendCurve['kind'], months: number): SpendCurve {
  if (kind === 'user_defined') {
    return { kind, weights: Array.from({ length: months }, (_, i) => i + 1) };
  }
  return { kind };
}

const CURVE_KINDS: Array<SpendCurve['kind']> = ['straight_line', 's_curve', 'back_loaded', 'user_defined'];
const CURVE_MATRIX_CASES: Array<{ total: number; months: number }> = [
  { total: 999_999, months: 7 },      // prime D, non-divisible total
  { total: 1, months: 13 },           // prime D, total smaller than D
  { total: 100_000_007, months: 11 }, // prime total, prime D
  { total: 1_234_567, months: 17 },   // prime D
  { total: 7, months: 3 },            // small awkward total
];

describe('spend-curve matrix — exact-sum, length, monotonic cumulative (spec §6.1, calc 2.2.0)', () => {
  for (const kind of CURVE_KINDS) {
    for (const { total, months } of CURVE_MATRIX_CASES) {
      const label = `${kind} total=${total} D=${months}`;

      it(`${label}: sums exactly to total and has length D`, () => {
        const out = spreadByCurve(total, months, curveForKind(kind, months));
        expect(out).toHaveLength(months);
        expect(out.reduce((a, b) => a + b, 0)).toBe(total);
      });

      if (kind === 's_curve' || kind === 'back_loaded') {
        it(`${label}: cumulative spend is non-decreasing`, () => {
          const out = spreadByCurve(total, months, curveForKind(kind, months));
          let cumulative = 0;
          for (const monthPence of out) {
            const next = cumulative + monthPence;
            expect(next).toBeGreaterThanOrEqual(cumulative);
            cumulative = next;
          }
        });
      }
    }
  }
});

// Release 2b Task 3 (spec §3.2): lender-basis metrics must never default to
// developer GDV — null is the only representation of "unknown", exactly when
// the block itself is absent, on every fixture (not a variant subset).
describe('lender-underwritten GDV — never defaults to developer GDV (spec §3.2)', () => {
  for (const fx of fixtures) {
    it(`${fx.name}: lender_gdv_pence is null iff lender_valuation is absent`, () => {
      const run = runAppraisal(fx.inputs);
      const blockPresent = fx.inputs.lender_valuation != null;
      expect(run.metrics.lender_gdv_pence === null).toBe(!blockPresent);
      if (blockPresent) {
        // Recomputed here (not just re-asserted against the pinned fixture value)
        // so this catches a regression where ltgdv_lender_pct is wired to
        // developer GDV instead of lender GDV.
        expect(run.metrics.ltgdv_lender_pct).toBe(
          pct(run.model.peak_debt_pence, run.metrics.lender_gdv_pence as number));
      }
    });
  }
});

// Release 2b Task 4 (spec §5.11): senior repayment break-even.
describe('senior repayment break-even (spec §5.11)', () => {
  for (const fx of fixtures) {
    it(`${fx.name}: senior_breakeven_pence is null iff redemption_balance_at_disposal_pence is null`, () => {
      const run = runAppraisal(fx.inputs);
      expect(run.metrics.senior_breakeven_pence === null)
        .toBe(run.model.redemption_balance_at_disposal_pence === null);
    });

    it(`${fx.name}: when non-null, senior_breakeven_pence >= redemption + exit fee`, () => {
      const run = runAppraisal(fx.inputs);
      const redemption = run.model.redemption_balance_at_disposal_pence;
      if (redemption != null && run.metrics.senior_breakeven_pence != null) {
        const exitFee = exitFeeAmount(
          fx.inputs.finance, run.model.committed_gross_facility_pence, run.model.peak_debt_pence, redemption,
        );
        expect(run.metrics.senior_breakeven_pence).toBeGreaterThanOrEqual(redemption + exitFee);
      }
    });

    it(`${fx.name}: the two percentage forms are null unless lender GDV is present, and sum to 100.00 when present`, () => {
      const run = runAppraisal(fx.inputs);
      const lenderGdvPresent = run.metrics.lender_gdv_pence != null;
      if (run.metrics.senior_breakeven_pence == null || !lenderGdvPresent) {
        expect(run.metrics.senior_breakeven_pct_of_lender_gdv).toBeNull();
        expect(run.metrics.senior_breakeven_fall_from_lender_gdv_pct).toBeNull();
      } else {
        expect(run.metrics.senior_breakeven_pct_of_lender_gdv).not.toBeNull();
        expect(run.metrics.senior_breakeven_fall_from_lender_gdv_pct).not.toBeNull();
        const sum = (run.metrics.senior_breakeven_pct_of_lender_gdv as number)
          + (run.metrics.senior_breakeven_fall_from_lender_gdv_pct as number);
        expect(sum).toBeCloseTo(100, 2);
      }
    });
  }

  it('cash fixture A: all three senior break-even fields are null', () => {
    const fx = fixtures.find((f) => f.name.startsWith('A —'));
    expect(fx).toBeDefined();
    const run = runAppraisal(fx!.inputs);
    expect(run.model.redemption_balance_at_disposal_pence).toBeNull();
    expect(run.metrics.senior_breakeven_pence).toBeNull();
    expect(run.metrics.senior_breakeven_pct_of_lender_gdv).toBeNull();
    expect(run.metrics.senior_breakeven_fall_from_lender_gdv_pct).toBeNull();
  });
});

// Release 2b Task 5 (spec §5.12): developer profit break-even. Lender-independent AND
// debt-independent — computed whenever the schedule recorded any disposal at all (gross
// sales > 0), a strictly wider condition than §5.11's redemption-balance guard.
describe('developer profit break-even (spec §5.12)', () => {
  for (const fx of fixtures) {
    it(`${fx.name}: developer_breakeven_pence is null iff gross_sales_pence is 0`, () => {
      const run = runAppraisal(fx.inputs);
      expect(run.metrics.developer_breakeven_pence === null)
        .toBe(run.schedule.totals.gross_sales_pence === 0);
    });

    it(`${fx.name}: when non-null, developer_breakeven_pence >= tdc_ex_selling + selling legal fee`, () => {
      const run = runAppraisal(fx.inputs);
      if (run.metrics.developer_breakeven_pence != null) {
        const tdcExSelling = run.metrics.total_development_cost_pence - run.metrics.selling_costs_pence;
        expect(run.metrics.developer_breakeven_pence)
          .toBeGreaterThanOrEqual(tdcExSelling + fx.inputs.exit_strategy.selling_legal_fee_pence);
      }
    });
  }

  it('cash fixture A: developer_breakeven_pence is non-null (unlike senior_breakeven_pence)', () => {
    const fx = fixtures.find((f) => f.name.startsWith('A —'));
    expect(fx).toBeDefined();
    const run = runAppraisal(fx!.inputs);
    expect(run.model.redemption_balance_at_disposal_pence).toBeNull();
    expect(run.metrics.senior_breakeven_pence).toBeNull();
    expect(run.metrics.developer_breakeven_pence).not.toBeNull();
  });
});
