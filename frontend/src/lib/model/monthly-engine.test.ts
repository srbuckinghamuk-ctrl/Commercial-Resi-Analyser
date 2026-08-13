import { describe, it, expect } from 'vitest';
import { runLedger } from './monthly-engine';
import { DEFAULT_FACILITY_TERMS } from '../conversion-defaults';
import type { EquitySource, FacilityTerms, MonthReceipts, MonthUses, Schedule } from './finance-types';

function uses(partial: Partial<MonthUses>): MonthUses {
  return {
    acquisition_pence: 0, construction_pence: 0, professional_pence: 0,
    statutory_pence: 0, lender_ancillary_fees_pence: 0, ...partial,
  };
}
function receipts(partial: Partial<MonthReceipts>): MonthReceipts {
  return { gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0, ...partial };
}
function mkSchedule(u: MonthUses[], r: MonthReceipts[]): Schedule {
  const sum = (f: (x: MonthUses) => number) => u.reduce((a, x) => a + f(x), 0);
  const grossSales = r.reduce((a, x) => a + x.gross_sale_pence, 0);
  const selling = r.reduce((a, x) => a + x.agent_fee_pence + x.selling_legal_pence, 0);
  return {
    term_months: u.length, uses: u, receipts: r,
    totals: {
      acquisition_pence: sum((x) => x.acquisition_pence),
      construction_pence: sum((x) => x.construction_pence),
      professional_pence: sum((x) => x.professional_pence),
      statutory_pence: sum((x) => x.statutory_pence),
      selling_costs_pence: selling, gross_sales_pence: grossSales,
      gdv_pence: grossSales, retained_value_pence: 0,
      cost_before_finance_ex_selling_pence:
        sum((x) => x.acquisition_pence + x.construction_pence + x.professional_pence + x.statutory_pence),
    },
  };
}

const TERMS: FacilityTerms = {
  ...DEFAULT_FACILITY_TERMS,
  funding_source: 'development_finance',
  day_one_advance_pence: 30_000_000,
  committed_net_facility_pence: 50_000_000,
  committed_gross_facility_pence: 55_000_000,
  annual_interest_rate_pct: 12,
  interest_type: 'rolled_up',
  arrangement_fee_pct: 2, arrangement_fee_basis: 'committed_net_facility',
  exit_fee_pct: 1, exit_fee_basis: 'committed_gross_facility',
  term_months: 4, equity_draw_rule: 'equity_first', sales_sweep_pct: 100,
};

function equity(amount: number): EquitySource[] {
  return [{
    id: 'e1', classification: 'cash', amount_pence: amount, timing_month: 0,
    repayment_priority: 1, evidence_status: 'confirmed', notes: '',
  }];
}

const USES = [
  uses({ acquisition_pence: 40_000_000 }),
  uses({ construction_pence: 15_000_000 }),
  uses({ construction_pence: 10_000_000 }),
  uses({}),
];
const SALE = [
  receipts({}), receipts({}), receipts({}),
  receipts({ gross_sale_pence: 80_000_000, agent_fee_pence: 1_600_000 }),
];
const NO_SALE = [receipts({}), receipts({}), receipts({}), receipts({})];

describe('Fixture B — rolled-up interest (spec §8)', () => {
  const model = () => runLedger(mkSchedule(USES, SALE), TERMS, equity(30_000_000));

  it('reproduces the hand-computed ledger to the penny', () => {
    const m = model();
    expect(m.months[0].draw_pence).toBe(30_000_000);
    expect(m.months[0].capitalised_fees_pence).toBe(1_000_000);
    expect(m.months[0].interest_accrued_pence).toBe(310_000);
    expect(m.months[0].closing_balance_pence).toBe(31_310_000);
    expect(m.months[0].equity_contribution_pence).toBe(10_000_000);
    expect(m.months[1].interest_accrued_pence).toBe(313_100);
    expect(m.months[1].closing_balance_pence).toBe(31_623_100);
    expect(m.months[2].draw_pence).toBe(5_000_000);
    expect(m.months[2].equity_contribution_pence).toBe(5_000_000);
    expect(m.months[2].interest_accrued_pence).toBe(366_231);
    expect(m.months[2].closing_balance_pence).toBe(36_989_331);
    expect(m.months[3].interest_accrued_pence).toBe(369_893);
    expect(m.months[3].exit_fee_pence).toBe(550_000);
    expect(m.months[3].repayment_pence).toBe(37_359_224);
    expect(m.months[3].closing_balance_pence).toBe(0);
    expect(m.months[3].distribution_pence).toBe(40_490_776);
  });

  it('reports peak debt, totals and equity flows correctly', () => {
    const m = model();
    expect(m.peak_debt_pence).toBe(37_359_224);
    expect(m.peak_debt_month).toBe(3);
    expect(m.day_one_advance_pence).toBe(30_000_000);
    expect(m.totals.interest_pence).toBe(1_359_224);
    expect(m.totals.finance_costs_pence).toBe(1_359_224 + 1_000_000 + 550_000);
    expect(m.equity_cashflows_pence).toEqual([-10_000_000, -15_000_000, -5_000_000, 40_490_776]);
    expect(m.senior_outstanding_at_maturity_pence).toBe(0);
  });

  it('debt roll-forward reconciles every month', () => {
    for (const mo of model().months) {
      expect(mo.closing_balance_pence).toBe(
        mo.opening_balance_pence + mo.draw_pence + mo.capitalised_fees_pence
        + mo.interest_capitalised_pence - mo.repayment_pence,
      );
      expect(mo.closing_balance_pence).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Fixture C — serviced interest differs from rolled-up', () => {
  const terms: FacilityTerms = { ...TERMS, interest_type: 'serviced' };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(32_000_000));

  it('keeps the balance flat and funds interest from equity', () => {
    const m = model();
    expect(m.months[0].interest_serviced_pence).toBe(310_000);
    expect(m.months[0].interest_capitalised_pence).toBe(0);
    expect(m.months[0].closing_balance_pence).toBe(31_000_000);
    expect(m.months[0].equity_contribution_pence).toBe(10_310_000);
    expect(m.months[1].closing_balance_pence).toBe(31_000_000);
    // m2: committed equity remaining 6,380,000 → costs part-funded, draw 3,620,000
    expect(m.months[2].equity_contribution_pence).toBe(6_380_000);
    expect(m.months[2].draw_pence).toBe(3_620_000);
    expect(m.months[2].interest_serviced_pence).toBe(346_200);
    expect(m.months[2].additional_equity_pence).toBe(346_200);
    expect(m.months[3].additional_equity_pence).toBe(346_200);
  });

  it('produces materially different peak debt and interest from rolled-up', () => {
    const m = model();
    expect(m.peak_debt_pence).toBe(34_620_000);
    expect(m.totals.interest_pence).toBe(1_312_400);
    expect(m.totals.additional_equity_pence).toBe(692_400);
    expect(m.flags.some((f) => f.code === 'additional_equity_required')).toBe(true);
    expect(m.months[3].distribution_pence).toBe(43_230_000);
    // profit identity: Σ equity flows = 80,000,000 − TDC(69,462,400) = 10,537,600
    expect(m.equity_cashflows_pence.reduce((a, b) => a + b, 0)).toBe(10_537_600);
  });
});

describe('Fixture D — retain_all books no receipts and flags outstanding debt', () => {
  const model = () => runLedger(mkSchedule(USES, NO_SALE), TERMS, equity(30_000_000));

  it('leaves the senior balance outstanding at maturity with no distributions', () => {
    const m = model();
    expect(m.months[3].repayment_pence).toBe(0);
    expect(m.months[3].closing_balance_pence).toBe(37_359_224);
    expect(m.senior_outstanding_at_maturity_pence).toBe(37_359_224);
    expect(m.totals.exit_fee_pence).toBe(0);
    expect(m.totals.distributions_pence).toBe(0);
    expect(m.flags.some((f) => f.code === 'senior_outstanding_at_maturity' && f.severity === 'red')).toBe(true);
    expect(m.equity_cashflows_pence).toEqual([-10_000_000, -15_000_000, -5_000_000, 0]);
  });
});

describe('Fixture E — funding gap: overruns never create facility', () => {
  const terms: FacilityTerms = { ...TERMS, committed_net_facility_pence: 35_000_000 };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(25_000_000));

  it('caps the draw at undrawn net facility and records the gap', () => {
    const m = model();
    // Arrangement fee recomputes from its basis: 2% × committed net facility (£350,000) = £7,000.
    expect(m.months[0].capitalised_fees_pence).toBe(700_000);
    expect(m.months[2].draw_pence).toBe(4_300_000);
    expect(m.months[2].funding_gap_pence).toBe(5_700_000);
    expect(m.totals.funding_gap_pence).toBe(5_700_000);
    const gap = m.flags.find((f) => f.code === 'funding_gap');
    expect(gap?.severity).toBe('red');
    expect(gap?.month).toBe(2);
    expect(m.months[2].closing_balance_pence).toBe(35_973_241);
    expect(m.months[3].repayment_pence).toBe(36_332_973);
    expect(m.months[3].distribution_pence).toBe(41_517_027);
  });
});

describe('Fixture F — draws are capped by gross facility headroom after projected interest (spec §4.2c)', () => {
  const terms: FacilityTerms = { ...TERMS, committed_gross_facility_pence: 36_500_000 };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(30_000_000));

  it('caps the month-2 draw so the closing balance cannot exceed committed gross facility', () => {
    const m = model();
    // Months 0-1 identical to Fixture B: gross headroom does not bind while balances are low.
    expect(m.months[1].closing_balance_pence).toBe(31_623_100);
    // m2: needed draw 5,000,000, but grossHeadroomCap = floor(36,500,000/1.01) − 31,623,100
    // = 36,138,613 − 31,623,100 = 4,515,513.
    expect(m.months[2].draw_pence).toBe(4_515_513);
    expect(m.months[2].equity_contribution_pence).toBe(5_000_000);
    expect(m.months[2].funding_gap_pence).toBe(484_487);
    expect(m.months[2].interest_accrued_pence).toBe(361_386);
    expect(m.months[2].closing_balance_pence).toBe(36_499_999);
    const gap = m.flags.find((f) => f.code === 'funding_gap');
    expect(gap).toBeDefined();
    for (const mo of m.months) {
      expect(mo.closing_balance_pence).toBeLessThanOrEqual(36_500_000);
    }
  });
});

describe('Cash funding produces exactly zero debt cost', () => {
  it('has no draws, interest, or fees under cash', () => {
    const terms: FacilityTerms = { ...TERMS, funding_source: 'cash' };
    const m = runLedger(mkSchedule(USES, SALE), terms, equity(65_000_000));
    expect(m.totals.draws_pence).toBe(0);
    expect(m.totals.finance_costs_pence).toBe(0);
    expect(m.peak_debt_pence).toBe(0);
    expect(m.months.every((mo) => mo.closing_balance_pence === 0)).toBe(true);
    expect(m.totals.equity_contributed_pence).toBe(65_000_000);
  });
});
