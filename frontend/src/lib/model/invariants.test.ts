import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import { pct } from './metrics';
import type { CalculatorInputsV2, CalculatorInputsV3 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as { name: string; inputs: CalculatorInputsV3 });

// Variants derived from each fixture to widen coverage without new hand calcs.
function variants(
  inputs: CalculatorInputsV2 | CalculatorInputsV3,
): Array<{ label: string; inputs: CalculatorInputsV2 | CalculatorInputsV3 }> {
  const clone = () => JSON.parse(JSON.stringify(inputs)) as CalculatorInputsV2 | CalculatorInputsV3;
  const retained = clone();
  retained.exit_strategy.route = 'retain_all';
  const serviced = clone();
  serviced.finance.interest_type = 'serviced';
  const shortTerm = clone();
  shortTerm.finance.term_months = 1;
  return [
    { label: 'base', inputs },
    { label: 'retain_all', inputs: retained },
    { label: 'serviced', inputs: serviced },
    { label: 'term=1', inputs: shortTerm },
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
