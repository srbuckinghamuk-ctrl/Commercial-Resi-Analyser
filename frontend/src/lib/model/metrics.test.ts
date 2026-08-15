import { describe, it, expect } from 'vitest';
import { deriveMetrics, pct, breakevenFlags } from './metrics';
import { runLedger } from './monthly-engine';
import { runAppraisal, migrateInputsToV4 } from './index';
import { defaultCalculatorInputsV2, DEFAULT_FACILITY_TERMS } from '../conversion-defaults';
import type { EquitySource, FacilityTerms, MonthReceipts, MonthUses, Schedule } from './finance-types';

// --- helpers copied verbatim from monthly-engine.test.ts (tests must be self-contained) ---

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
    term_months: u.length, uses: u, receipts: r, refinance: null,
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

// --- end copied helpers ---

describe('pct', () => {
  it('rounds to 2 dp and nulls zero denominators', () => {
    expect(pct(1, 3)).toBe(33.33);
    expect(pct(1, 0)).toBeNull();
  });
});

describe('deriveMetrics on Fixture B', () => {
  function fixtureB() {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...TERMS };
    inputs.equity_sources = equity(30_000_000);
    inputs.acquisition.purchase_price_pence = 40_000_000;
    const schedule = mkSchedule(USES, SALE);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    return deriveMetrics(inputs, schedule, model);
  }

  it('reproduces spec §8 headline figures', () => {
    const r = fixtureB();
    expect(r.finance_costs_pence).toBe(2_909_224);
    expect(r.total_development_cost_pence).toBe(69_509_224);
    expect(r.profit_pence).toBe(10_490_776);
    expect(r.profit_is_unrealised).toBe(false);
    expect(r.peak_debt_pence).toBe(37_359_224);
    expect(r.gross_ltc_pct).toBe(53.75);
    expect(r.net_ltc_pct).toBe(55.38);
    expect(r.ltgdv_developer_pct).toBe(46.7);
    expect(r.ltgdv_lender_pct).toBeNull(); // no lender GDV in R1 — never defaults to developer GDV
    expect(r.day_one_advance_pence).toBe(30_000_000);
    expect(r.day_one_ltv_on_price_pct).toBe(75);
    expect(r.day_one_ltv_on_value_pct).toBeNull();
    expect(r.facility_headroom_pence).toBe(55_000_000 - 37_359_224);
  });

  it('profit identity: profit equals the sum of equity cash flows', () => {
    const r = fixtureB();
    expect(r.profit_pence).toBe(-10_000_000 - 15_000_000 - 5_000_000 + 40_490_776);
    expect(r.equity_multiple).toBe(Math.round((40_490_776 / 30_000_000) * 100) / 100);
  });

  it('IRR comes from actual equity flows and annualises correctly', () => {
    const r = fixtureB();
    expect(r.irr_monthly_pct).not.toBeNull();
    const monthly = r.irr_monthly_pct! / 100;
    // Deviation from brief: precision loosened from 1 to 0 decimal digits. deriveMetrics
    // computes irr_annual_pct from the RAW (unrounded) monthly IRR per spec §3.17; this
    // assertion instead recomputes from the 2dp-DISPLAY-rounded monthly figure. Fixture B's
    // monthly rate is ~14.6% (short 4-month term, high leverage), where the compounding
    // derivative (~12·(1+m)^11) amplifies that rounding residual to ~0.18 percentage points
    // — beyond a 0.05 tolerance but well within 0.5, and consistent with correct annualisation.
    expect(r.irr_annual_pct).toBeCloseTo((Math.pow(1 + monthly, 12) - 1) * 100, 0);
  });
});

describe('deriveMetrics on retain_all (Fixture D shape)', () => {
  it('marks profit unrealised, nulls IRR, and books no receipts', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...TERMS };
    inputs.equity_sources = equity(30_000_000);
    const schedule = mkSchedule(USES, NO_SALE);
    schedule.totals.retained_value_pence = 80_000_000;
    schedule.totals.gdv_pence = 80_000_000;
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const r = deriveMetrics(inputs, schedule, model);
    expect(r.profit_is_unrealised).toBe(true);
    expect(r.irr_monthly_pct).toBeNull();
    expect(r.irr_annual_pct).toBeNull();
    // unrealised profit = 80,000,000 − TDC(65,000,000 + 0 selling + 2,359,224 finance)
    expect(r.finance_costs_pence).toBe(2_359_224);
    expect(r.profit_pence).toBe(80_000_000 - 67_359_224);
    // Release 2b Task 5 (spec §5.12): zero gross sales — no sale price to solve for —
    // must null the result, even though the facility is fully drawn.
    expect(schedule.totals.gross_sales_pence).toBe(0);
    expect(r.developer_breakeven_pence).toBeNull();
  });
});

describe('deriveMetrics — senior_breakeven_unsolvable flag (spec §5.11)', () => {
  it('nulls senior_breakeven_pence and raises the flag exactly once when the agent fee is >= 100%', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...TERMS };
    inputs.equity_sources = equity(30_000_000);
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.exit_strategy = { ...inputs.exit_strategy, selling_agent_fee_pct: 100 };
    const schedule = mkSchedule(USES, SALE); // month 3 disposal — non-null redemption balance
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const r = deriveMetrics(inputs, schedule, model);

    expect(model.redemption_balance_at_disposal_pence).not.toBeNull();
    expect(r.senior_breakeven_pence).toBeNull();
    // Deviation from brief (R3a Task 6): deriveMetrics no longer mutates model.flags — the
    // flag now lands on the result's own `flags` array (r.flags), not model.flags. Updated
    // to match the new contract this task establishes; the assertion content is unchanged.
    const flags = r.flags.filter((f) => f.code === 'senior_breakeven_unsolvable');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toEqual({
      code: 'senior_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
      message: 'agent fee ≥ 100% — break-even unsolvable',
    });
  });
});

describe('deriveMetrics under cash funding', () => {
  it('zeroes every debt metric', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...DEFAULT_FACILITY_TERMS, funding_source: 'cash', term_months: 4 };
    inputs.equity_sources = equity(65_000_000);
    // Deviation from brief: purchase_price_pence must be set (spec §1.5 — pct() nulls a
    // zero denominator; leaving price at the default 0 makes day_one_ltv_on_price_pct
    // null-by-definition, not 0). Set to match the schedule's month-0 acquisition line.
    inputs.acquisition.purchase_price_pence = 40_000_000;
    const schedule = mkSchedule(USES, SALE);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const r = deriveMetrics(inputs, schedule, model);
    expect(r.finance_costs_pence).toBe(0);
    expect(r.peak_debt_pence).toBe(0);
    expect(r.gross_ltc_pct).toBe(0);
    expect(r.day_one_ltv_on_price_pct).toBe(0);
    expect(r.facility_headroom_pence).toBeNull();
  });

  it('still computes developer_breakeven_pence — debt-independent, unlike senior_breakeven_pence ' +
    '(spec §5.12, Release 2b Task 5)', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...DEFAULT_FACILITY_TERMS, funding_source: 'cash', term_months: 4 };
    inputs.equity_sources = equity(65_000_000);
    inputs.acquisition.purchase_price_pence = 40_000_000;
    const schedule = mkSchedule(USES, SALE);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const r = deriveMetrics(inputs, schedule, model);
    expect(model.redemption_balance_at_disposal_pence).toBeNull();
    expect(r.senior_breakeven_pence).toBeNull();
    expect(r.developer_breakeven_pence).not.toBeNull();
  });
});

describe('deriveMetrics — developer_breakeven_unsolvable flag (spec §5.12)', () => {
  it('nulls developer_breakeven_pence and raises the flag exactly once when the agent fee is >= 100%', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...TERMS };
    inputs.equity_sources = equity(30_000_000);
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.exit_strategy = { ...inputs.exit_strategy, selling_agent_fee_pct: 100 };
    const schedule = mkSchedule(USES, SALE); // month 3 disposal — gross_sales_pence > 0
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const r = deriveMetrics(inputs, schedule, model);

    expect(schedule.totals.gross_sales_pence).toBeGreaterThan(0);
    expect(r.developer_breakeven_pence).toBeNull();
    // Deviation from brief (R3a Task 6): same rationale as the senior_breakeven_unsolvable
    // test above — the flag now lands on r.flags, not model.flags.
    const flags = r.flags.filter((f) => f.code === 'developer_breakeven_unsolvable');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toEqual({
      code: 'developer_breakeven_unsolvable', severity: 'red', month: null, amount_pence: null,
      message: 'agent fee ≥ 100% — break-even unsolvable',
    });
  });
});

describe('flags on result (R3a refactor)', () => {
  it('deriveMetrics does not mutate model.flags and returns ledger+metric flags', () => {
    const run = runAppraisal(migrateInputsToV4({}));          // any valid inputs
    const before = run.model.flags.length;
    const metrics = deriveMetrics(run.inputs, run.schedule, run.model);
    expect(run.model.flags.length).toBe(before);              // purity
    expect(metrics.flags.slice(0, before)).toEqual(run.model.flags);
  });
  it('agent fee >= 100% raises the unsolvable flags on the result, not the model', () => {
    const v4 = migrateInputsToV4({});
    // Fix (post-review): migrateInputsToV4({}) defaults to an empty unit_mix, so no disposal
    // is ever booked and the developer break-even branch (guarded on gross_sales_pence > 0)
    // never runs regardless of fee. Give the fixture one sellable unit — exit_strategy.route
    // defaults to 'sell_all' — so a solve is actually attempted and can be observed as null.
    v4.unit_mix = { units: [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 30_000_000, comparable_notes: '' }] };
    v4.exit_strategy.selling_agent_fee_pct = 100;
    const run = runAppraisal(v4);
    expect(run.model.flags.some((f) => f.code === 'developer_breakeven_unsolvable')).toBe(false);
    expect(run.metrics.flags.some((f) => f.code === 'developer_breakeven_unsolvable')).toBe(true);
  });
});

describe('breakevenFlags', () => {
  it('fee >= 100 → unsolvable flags; fee < 100 with a null solve → cap_exhausted', () => {
    expect(breakevenFlags(true, false, 100).map((f) => f.code)).toEqual(['senior_breakeven_unsolvable']);
    expect(breakevenFlags(true, false, 2).map((f) => f.code)).toEqual(['breakeven_cap_exhausted']);
    expect(breakevenFlags(false, true, 2).map((f) => f.code)).toEqual(['breakeven_cap_exhausted']);
    expect(breakevenFlags(false, false, 2)).toEqual([]);
  });
});
