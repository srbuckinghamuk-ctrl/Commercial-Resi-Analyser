import { describe, it, expect } from 'vitest';
import { deriveMetrics, pct, breakevenFlags } from './metrics';
import { runLedger } from './monthly-engine';
import { runAppraisal, migrateInputsToV4, migrateInputsToV5, migrateInputsToV6 } from './index';
import { defaultCalculatorInputsV2, defaultCalculatorInputsV7, DEFAULT_FACILITY_TERMS } from '../conversion-defaults';
import { DEFAULT_AREA_BRIDGE } from './areas';
import { DEFAULT_UNIT_ANCILLARY } from '../conversion-types';
import type { ProposedUnitV6 } from '../conversion-types';
import type {
  AcquisitionInputsV5, AnyCalculatorInputs, CalculatorInputsV6, CalculatorInputsV8, EquitySource,
  FacilityTerms, MonthReceipts, MonthUses, Schedule,
} from './finance-types';
import type { VatResult } from './vat';
import { DEFAULT_VAT, defaultVatTreatments } from './vat';

// --- helpers copied verbatim from monthly-engine.test.ts (tests must be self-contained) ---

function uses(partial: Partial<MonthUses>): MonthUses {
  return {
    acquisition_pence: 0, construction_pence: 0, professional_pence: 0,
    statutory_pence: 0, lender_ancillary_fees_pence: 0, vat_pence: 0, ...partial,
  };
}
function receipts(partial: Partial<MonthReceipts>): MonthReceipts {
  return {
    gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0, vat_reclaim_pence: 0, ...partial,
  };
}
// R11: no test in this file exercises VAT — an inert result of the schedule's
// own length, mirroring vat.ts's inertVat() shape exactly.
function emptyVat(termMonths: number): VatResult {
  return {
    registered: false, charges: [], periods: [],
    months: Array.from({ length: termMonths }, (_, month) => (
      { month, incurred_pence: 0, reclaimed_pence: 0, carry_pence: 0 }
    )),
    total_input_vat_pence: 0, total_recoverable_pence: 0, total_irrecoverable_pence: 0,
    total_reclaimed_pence: 0, receivable_at_maturity_pence: 0, peak_carry_pence: 0, peak_carry_month: null,
    purchase_vat_pence: 0,
  };
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
      vat_pence: sum((x) => x.vat_pence),
      vat_reclaim_pence: r.reduce((a, x) => a + x.vat_reclaim_pence, 0),
      irrecoverable_vat_pence: 0,
    },
    vat: emptyVat(u.length),
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

  // ── Realisation basis (spec §3.16.1, calc 2.6.0) ─────────────────────────
  //
  // Expected values below are derived from the definition, not from a run: the
  // discriminator is whether the schedule books a disposal or a refinance, and
  // "no distributions" is deliberately NOT the discriminator — a sale that
  // sweeps entirely to senior debt returns 0.00x, which is a real answer, while
  // a retain-all case has no answer at all.
  describe('distributed-return basis', () => {
    it('reports a multiple of zero when a sale happens but no cash reaches equity', () => {
      // One month of cost, one month of receipts, and a facility large enough
      // that the whole net receipt is swept to the senior balance.
      const schedule = mkSchedule(
        [uses({ acquisition_pence: 50_000_000 }), uses({})],
        [receipts({}), receipts({ gross_sale_pence: 20_000_000 })],
      );
      const equity: EquitySource[] = [{
        id: 'e1', classification: 'cash', amount_pence: 5_000_000, timing_month: 0,
        repayment_priority: 1, evidence_status: 'confirmed', notes: '',
      }];
      const model = runLedger(schedule, TERMS, equity);
      const r = deriveMetrics(defaultCalculatorInputsV2(), schedule, model);

      expect(schedule.totals.gross_sales_pence).toBeGreaterThan(0);
      expect(model.totals.distributions_pence).toBe(0);
      expect(r.has_realisation_event).toBe(true);
      expect(r.equity_multiple).toBe(0);
    });

    it('has no multiple at all when nothing is sold or refinanced', () => {
      const schedule = mkSchedule([uses({ acquisition_pence: 50_000_000 })], [receipts({})]);
      const equity: EquitySource[] = [{
        id: 'e1', classification: 'cash', amount_pence: 50_000_000, timing_month: 0,
        repayment_priority: 1, evidence_status: 'confirmed', notes: '',
      }];
      const model = runLedger(schedule, TERMS, equity);
      const r = deriveMetrics(defaultCalculatorInputsV2(), schedule, model);

      expect(schedule.totals.gross_sales_pence).toBe(0);
      expect(schedule.refinance).toBeNull();
      expect(r.has_realisation_event).toBe(false);
      expect(r.equity_multiple).toBeNull();
      expect(r.return_on_equity_is_unrealised).toBe(true);
    });

    it('counts a refinance as a realisation event even with no sale', () => {
      const schedule = mkSchedule([uses({ acquisition_pence: 50_000_000 })], [receipts({})]);
      schedule.refinance = { month: 1, net_proceeds_pence: 30_000_000 };
      const equity: EquitySource[] = [{
        id: 'e1', classification: 'cash', amount_pence: 50_000_000, timing_month: 0,
        repayment_priority: 1, evidence_status: 'confirmed', notes: '',
      }];
      const model = runLedger(schedule, TERMS, equity);
      const r = deriveMetrics(defaultCalculatorInputsV2(), schedule, model);

      expect(schedule.totals.gross_sales_pence).toBe(0);
      expect(r.has_realisation_event).toBe(true);
      expect(r.equity_multiple).not.toBeNull();
    });

    it('marks return on equity unrealised whenever retained value is in the profit', () => {
      const schedule = mkSchedule(
        [uses({ acquisition_pence: 50_000_000 })],
        [receipts({ gross_sale_pence: 30_000_000 })],
      );
      schedule.totals.retained_value_pence = 40_000_000;
      const equity: EquitySource[] = [{
        id: 'e1', classification: 'cash', amount_pence: 50_000_000, timing_month: 0,
        repayment_priority: 1, evidence_status: 'confirmed', notes: '',
      }];
      const r = deriveMetrics(
        defaultCalculatorInputsV2(), schedule, runLedger(schedule, TERMS, equity),
      );
      expect(r.has_realisation_event).toBe(true);
      expect(r.profit_is_unrealised).toBe(true);
      expect(r.return_on_equity_is_unrealised).toBe(true);
    });
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

// Dev-finance deal with a real committed facility, valued units and a sell_all exit —
// mirrors schedule.test.ts's baseInputs() but on a v4 document (via migrateInputsToV4) and
// with a committed facility set (unlike the migrateInputsToV4({}) default, whose finance
// has committed_net_facility_pence: null — no draws, no balance, redemption_balance_at_
// disposal_pence stays null). Zero committed equity (defaultEquitySources()' amount_pence
// is 0) forces essentially the whole cost stack through the facility, guaranteeing a large
// non-null redemption balance at disposal for the §5.11 phased-regime tests below.
function devFinanceV4() {
  const v4 = migrateInputsToV4({});
  v4.acquisition = {
    purchase_price_pence: 40_000_000, legal_fees_pence: 500_000, survey_cost_pence: 300_000,
    broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
  };
  v4.unit_mix = {
    units: [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    })),
  };
  v4.conversion_costs = {
    ...v4.conversion_costs,
    construction_cost_per_sqm_pence: 100_000, total_construction_sqm: 400, contingency_pct: 10,
  };
  v4.finance = {
    ...DEFAULT_FACILITY_TERMS,
    funding_source: 'development_finance',
    committed_net_facility_pence: 150_000_000,
    committed_gross_facility_pence: 165_000_000,
    annual_interest_rate_pct: 8,
    interest_type: 'rolled_up',
    sales_sweep_pct: 100,
    term_months: 12,
  };
  v4.exit_strategy = {
    route: 'sell_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 400_000, retained_units: [],
  };
  return v4;
}

describe('§5.11 under phasing', () => {
  it('phased inputs produce a senior break-even from the replay solver', () => {
    const v4 = devFinanceV4();
    v4.sales_phasing = { tranches: [
      { month_offset: 10, pct_of_gross_receipts: 60 },
      { month_offset: 11, pct_of_gross_receipts: 40 },
    ] };
    const run = runAppraisal(v4);
    expect(run.model.redemption_balance_at_disposal_pence).not.toBeNull();
    expect(run.metrics.senior_breakeven_pence).not.toBeNull();
    expect(run.metrics.flags.some((f) => f.code === 'breakeven_cap_exhausted')).toBe(false);
  });
  it('structural unsolvability flags senior_breakeven_unsolvable with a reason, not cap-exhausted', () => {
    // sweep 0% with phasing: no price redeems
    const v4 = devFinanceV4();
    v4.finance.sales_sweep_pct = 0;
    v4.sales_phasing = { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] };
    const run = runAppraisal(v4);
    expect(run.metrics.senior_breakeven_pence).toBeNull();
    const f = run.metrics.flags.find((x) => x.code === 'senior_breakeven_unsolvable');
    expect(f?.message).toMatch(/sales sweep/);
    expect(run.metrics.flags.some((x) => x.code === 'breakeven_cap_exhausted')).toBe(false);
  });
});

describe('breakevenFlags with a structural reason', () => {
  it('emits senior_breakeven_unsolvable with the reason; no cap flag for that solver', () => {
    const out = breakevenFlags(false, false, 2, 'no sale price redeems — test reason');
    expect(out.map((f) => f.code)).toEqual(['senior_breakeven_unsolvable']);
    expect(out[0].message).toBe('no sale price redeems — test reason');
  });
});

// ── R8 (spec §14): acquisition tax is jurisdiction-aware ──────────────────────

describe('acquisition tax is jurisdiction-aware (R8)', () => {
  // £753,482. England/NI non-residential: 0% to £150k, 2% on the next £100k
  // (£2,000), 5% on the £503,482 above £250k (£25,174.10) = £27,174.10.
  const PRICE_PENCE = 75_348_200;

  function englishBase() {
    const inputs = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    inputs.acquisition.purchase_price_pence = PRICE_PENCE;
    return inputs;
  }

  it('taxes an English appraisal identically to the pre-R8 engine', () => {
    const m = runAppraisal(englishBase()).metrics;
    expect(m.acquisition_tax_pence).toBe(2_717_410);
    // The deprecated alias must carry the same value until R16 removes it.
    expect(m.sdlt_pence).toBe(m.acquisition_tax_pence);
    expect(m.acquisition_tax.regime).toBe('SDLT');
    expect(m.acquisition_tax.jurisdiction).toBe('england_ni');
    expect(m.acquisition_tax.basis).toBe('non_residential');
  });

  it('taxes a Welsh appraisal on LTT', () => {
    const inputs = englishBase();
    inputs.acquisition.jurisdiction = 'wales';
    inputs.acquisition.acquisition_date = '2026-08-17';
    const m = runAppraisal(inputs).metrics;
    expect(m.acquisition_tax_pence).toBe(2_542_410);
    expect(m.sdlt_pence).toBe(2_542_410);
    expect(m.acquisition_tax.regime).toBe('LTT');
    expect(m.acquisition_tax.date_basis).toBe('transaction_date');
  });

  it('taxes a Scottish appraisal on LBTT', () => {
    const inputs = englishBase();
    inputs.acquisition.jurisdiction = 'scotland';
    inputs.acquisition.acquisition_date = '2026-08-17';
    const m = runAppraisal(inputs).metrics;
    // 0% to £150k; 1% on the next £100k (£1,000); 5% on £503,482 (£25,174.10).
    expect(m.acquisition_tax_pence).toBe(2_617_410);
    expect(m.acquisition_tax.regime).toBe('LBTT');
  });

  it('reports an assumed-current basis when no acquisition date is recorded', () => {
    const m = runAppraisal(englishBase()).metrics;
    expect(m.acquisition_tax.date_basis).toBe('assumed_current');
  });

  // Fix round 1 (R8 Task 5). The brief's original test here asserted that an
  // override *changes* the RLV. That is the opposite of what spec §3.18 defines,
  // and it passed only while this engine computed the acquisition tax twice from
  // two different band sets. §3.18: cost excluding land = TDC − purchase price −
  // acquisition tax. Once both sites (deriveMetrics and calculateTotalAcquisition
  // Cost) use the same figure, the tax cancels out of that expression, so the RLV
  // is invariant to it *by design* — and §3.18's disclosed limitation records
  // exactly this: "finance and SDLT within 'cost excluding land' are those of the
  // appraised structure, not re-solved for the residual price (a fixed-point
  // refinement is R3)". This has always been true for English documents. R8 makes
  // it true for Welsh and Scottish ones too. Do not "fix" this back.
  it('an override moves acquisition cost and TDC but leaves RLV unchanged (§3.18)', () => {
    const base = englishBase();
    const withOverride = migrateInputsToV5(
      JSON.parse(JSON.stringify(base)) as Record<string, unknown>,
    );
    withOverride.acquisition.acquisition_tax_override_pence = 0;
    withOverride.acquisition.acquisition_tax_override_reason = 'Group relief claimed.';

    const before = runAppraisal(base).metrics;
    const after = runAppraisal(withOverride).metrics;

    expect(after.acquisition_tax_pence).toBe(0);
    expect(after.acquisition_tax.is_override).toBe(true);
    expect(after.acquisition_tax.computed_total_pence).toBe(2_717_410);

    // The tax really did leave the cost stack — both figures fall by exactly it.
    expect(before.acquisition_cost_pence - after.acquisition_cost_pence).toBe(2_717_410);
    expect(
      before.total_development_cost_pence - after.total_development_cost_pence,
    ).toBe(2_717_410);
    // …and the RLV does not move, because the tax cancels in cost-excluding-land.
    expect(after.rlv_pence).toBe(before.rlv_pence);
  });

  // The regression guard for fix round 1: acquisition tax is computed in two
  // places — deriveMetrics (reported as acquisition_tax_pence) and
  // calculateTotalAcquisitionCost (folded into acquisition_cost_pence, and from
  // there into TDC, profit and every ratio). Before this fix the second site was
  // hard-wired to England/NI, so a Welsh appraisal reported LTT while charging
  // SDLT. This asserts the two can never drift apart again.
  //
  // COVERAGE LIMIT: this guard varies the jurisdiction and the override, but not
  // the acquisition *date*. A date mismatch between the two sites is currently
  // unobservable, because every (jurisdiction, basis) group in TAX_TABLES holds a
  // single open-ended band set — any date resolves to the same set. **The first
  // time a second dated band set is added to a group, extend this guard with a
  // date case**, or a date read at one site and not the other will pass silently.
  function taxInsideAcquisitionCost(
    inputs: { acquisition: AcquisitionInputsV5 }, m: { acquisition_cost_pence: number },
  ): number {
    const a = inputs.acquisition;
    return m.acquisition_cost_pence
      - a.purchase_price_pence
      - a.legal_fees_pence
      - a.survey_cost_pence
      - Math.round((a.purchase_price_pence * a.broker_fee_pct) / 100)
      - a.other_acquisition_costs_pence;
  }

  it.each([
    ['wales', 'LTT', 2_542_410],
    ['scotland', 'LBTT', 2_617_410],
    ['england_ni', 'SDLT', 2_717_410],
  ] as const)(
    'the tax inside acquisition_cost_pence is the %s figure, not the England/NI one',
    (jurisdiction, regime, expected) => {
      const inputs = englishBase();
      inputs.acquisition.jurisdiction = jurisdiction;
      inputs.acquisition.acquisition_date = '2026-08-17';
      const m = runAppraisal(inputs).metrics;
      expect(m.acquisition_tax.regime).toBe(regime);
      expect(m.acquisition_tax_pence).toBe(expected);
      expect(taxInsideAcquisitionCost(inputs, m)).toBe(expected);
    },
  );

  // Fix round 1: the COVERAGE LIMIT above named an untested axis — a *bad* date
  // (malformed, or not covered by any band set) reaching the two sites. Both now
  // route through resolveAcquisitionDate instead of calling selectBandSet
  // directly, so an unusable date degrades to null (assumed-current) instead of
  // throwing — this extends the drift guard onto that axis. (Verified this has
  // teeth by reverting calculateTotalAcquisitionCost's site alone to the raw,
  // unresolved date: both cases below then fail — the wales/scotland/england_ni
  // block above does not catch it, because it never uses a bad date.)
  it.each([
    ['an uncovered date', '1990-01-01'],
    ['a malformed date', '17/08/2026'],
  ])('%s degrades to the assumed-current band set identically at both sites', (_label, badDate) => {
    const inputs = englishBase();
    inputs.acquisition.acquisition_date = badDate;
    const m = runAppraisal(inputs).metrics;
    expect(m.acquisition_tax.date_basis).toBe('assumed_current');
    expect(m.acquisition_tax_pence).toBe(2_717_410);
    expect(taxInsideAcquisitionCost(inputs, m)).toBe(m.acquisition_tax_pence);
  });

  // Fix round 2. The Python mirror of this test exists because Pydantic's default
  // revalidate_instances='never' lets a CalculatorInputsV4 hold an
  // AcquisitionInputsV5, at which point a gate on the *container* and a gate on
  // the *block* disagree. The TS engine cannot have that bug — both sites read the
  // block structurally — and this pins that: a document declaring inputs_version 4
  // whose acquisition block carries the R8 keys is taxed on those keys at both
  // sites, consistently. Neither engine may report one regime and charge another.
  it('a v4 container carrying a v5 acquisition block agrees at both sites', () => {
    const v5 = englishBase();
    v5.acquisition.jurisdiction = 'wales';
    v5.acquisition.acquisition_date = '2026-08-17';
    const hybrid = { ...JSON.parse(JSON.stringify(v5)), inputs_version: 4 } as
      unknown as AnyCalculatorInputs & { acquisition: AcquisitionInputsV5 };
    expect(hybrid.inputs_version).toBe(4);

    const m = runAppraisal(hybrid).metrics;
    expect(m.acquisition_tax.regime).toBe('LTT');
    expect(m.acquisition_tax_pence).toBe(2_542_410);
    expect(taxInsideAcquisitionCost(hybrid, m)).toBe(m.acquisition_tax_pence);
  });

  // The load-bearing property of R8 Task 5, asserted on a document built here
  // rather than read from `fixtures/financial-model/` — the fixture corpus makes
  // the same statement through its own pinned `expected` blocks, and this test
  // must not depend on those files staying at any particular version.
  //
  // v2–v4 documents carry no jurisdiction at all. Migrating one to v5 is purely
  // additive: it must add `acquisition_tax_pence` and `acquisition_tax` and move
  // nothing else, to the penny — total development cost, profit, every profit
  // ratio, LTC, LTGDV and the RLV all flow through the figure being rerouted.
  it('migration to v5 adds the two new metrics and changes no other figure', () => {
    const v4 = devFinanceV4();
    expect(v4.inputs_version).toBe(4);
    const v5 = migrateInputsToV5(JSON.parse(JSON.stringify(v4)) as Record<string, unknown>);
    expect(v5.inputs_version).toBe(5);

    const before = runAppraisal(v4).metrics;
    const after = runAppraisal(v5).metrics;

    const {
      acquisition_tax: _atAfter, acquisition_tax_pence: _atpAfter, ...restAfter
    } = after;
    const {
      acquisition_tax: _atBefore, acquisition_tax_pence: _atpBefore, ...restBefore
    } = before;
    expect(restAfter).toEqual(restBefore);

    // Negative control: the comparison above is only meaningful if the metrics
    // object it strips down is actually populated with the figures at risk.
    expect(restBefore.total_development_cost_pence).toBeGreaterThan(0);
    expect(restBefore.profit_pence).not.toBe(0);
    expect(restBefore.rlv_pence).not.toBe(0);
    // And the new fields really are new: absent before, present after.
    expect(_atpBefore).toBe(_atpAfter);
    expect(_atBefore.jurisdiction).toBe('england_ni');
    expect(_atAfter.jurisdiction).toBe('england_ni');
    expect(_atAfter.date_basis).toBe('assumed_current');
  });
});

// --- R9 Task 9 — area bridge and GDV split on the appraisal result ---

type MinimalUnit = Pick<ProposedUnitV6, 'id' | 'floor_area_sqm' | 'estimated_value_pence'>
  & Partial<ProposedUnitV6>;

/** R9 (Task 9). A v6 document built from the migration chain's own defaults —
 *  see validation.test.ts's identical helper. `units`/`conversion_costs`/`areas`
 *  are the only overrides this suite needs, each merged onto the defaults so a
 *  partial override does not blank out required sibling fields. */
function makeV6Inputs(overrides: {
  areas?: Partial<typeof DEFAULT_AREA_BRIDGE>;
  units?: MinimalUnit[];
  conversion_costs?: Partial<CalculatorInputsV6['conversion_costs']>;
} = {}): CalculatorInputsV6 {
  const base = migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 });
  return {
    ...base,
    areas: { ...base.areas, ...(overrides.areas ?? {}) },
    conversion_costs: { ...base.conversion_costs, ...(overrides.conversion_costs ?? {}) },
    unit_mix: overrides.units
      ? {
        units: overrides.units.map((u) => ({
          type: '1bed', comparable_notes: '', ancillary: DEFAULT_UNIT_ANCILLARY, ...u,
        })),
      }
      : base.unit_mix,
  };
}

describe('R9 — the appraisal result carries the area bridge', () => {
  it('emits every derived line and ratio', () => {
    const run = runAppraisal(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 520, circulation_common_sqm: 60 },
      units: [{ id: 'u1', floor_area_sqm: 380, estimated_value_pence: 50_000_000 }],
    }));
    expect(run.metrics.area_bridge.developed_gia_sqm).toBe(520);
    expect(run.metrics.area_bridge.available_for_units_sqm).toBe(460);
    expect(run.metrics.area_bridge.unallocated_sqm).toBe(80);
    expect(run.metrics.area_bridge.nia_to_gia_pct).toBe(73.08);
  });

  it('reports the cost area actually used', () => {
    const run = runAppraisal(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' },
      conversion_costs: { total_construction_sqm: 480 },
    }));
    expect(run.metrics.developed_area_sqm).toBe(480);
  });

  it('splits GDV while keeping gdv_pence as the total', () => {
    const run = runAppraisal(makeV6Inputs({
      units: [{
        id: 'u1',
        floor_area_sqm: 50,
        estimated_value_pence: 25_000_000,
        ancillary: {
          balcony_terrace_sqm: 6, balcony_terrace_value_pence: 400_000,
          parking_spaces: 1, parking_value_pence: 1_200_000,
        },
      }],
    }));
    expect(run.metrics.gdv_internal_pence).toBe(25_000_000);
    expect(run.metrics.gdv_ancillary_pence).toBe(1_600_000);
    expect(run.metrics.gdv_pence).toBe(26_600_000);
  });

  it('keeps every GDV-denominated ratio on the total, unamended', () => {
    // profit_on_gdv_pct, ltgdv_developer_pct and the break-even percentages all
    // divide by gdv_pence. Because gdv_pence remains the TOTAL, none of them
    // needed a spec amendment in R9.
    //
    // Fix round 1 (review): the expected denominator below is written as the
    // literal sum of this fixture's own internal (25,000,000) and ancillary
    // (1,600,000) values — NOT read back off `run.metrics.gdv_pence` — and the
    // expected profit is the literal figure this exact fixture produces
    // (pinned once via a probe run, deterministic thereafter: no randomness
    // anywhere in the cost stack or financing defaults). Reading both sides of
    // the assertion off the same result object would be self-consistent by
    // construction — if `gdv_pence` were silently narrowed to internal-only,
    // both operands would narrow together and the assertion would still hold.
    // Hard-coding the denominator independently means a narrowing of
    // `gdv_pence` moves the actual value away from this fixed expectation, so
    // this test — not just the sibling "splits GDV" test above — actually
    // discriminates the total-vs-internal-only regression it claims to guard.
    const run = runAppraisal(makeV6Inputs({
      units: [{
        id: 'u1',
        floor_area_sqm: 50,
        estimated_value_pence: 25_000_000,
        ancillary: {
          balcony_terrace_sqm: 6, balcony_terrace_value_pence: 400_000,
          parking_spaces: 1, parking_value_pence: 1_200_000,
        },
      }],
    }));
    const knownProfitPence = 22_156_972;
    const knownTotalGdvPence = 25_000_000 + 1_600_000; // internal + ancillary, literal
    expect(run.metrics.profit_pence).toBe(knownProfitPence);
    expect(run.metrics.profit_on_gdv_pct)
      .toBe(pct(knownProfitPence, knownTotalGdvPence));
  });

  it('the cost plan on the result agrees with the schedule totals (cross-site)', () => {
    // R10 spec §3.3, applying the acquisition-tax cross-site check's reasoning
    // to cost: the schedule and deriveMetrics each compute the cost plan
    // independently (schedule.ts, metrics.ts), so a defect that moves one and
    // not the other is invisible to any test that only reads one side.
    const base = defaultCalculatorInputsV7();
    const run = runAppraisal({
      ...base,
      conversion_costs: {
        ...base.conversion_costs,
        fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
      },
      cost_plan: {
        mode: 'detailed',
        packages: [
          { id: 'p1', code: 'enabling_strip_out_asbestos', label: 'Strip out',
            amount_pence: 1_000_000, contingency_class: 'existing_building',
            lender_eligible: true, notes: '', vat_override: null },
          { id: 'p2', code: 'structure', label: 'Structure', amount_pence: 3_000_000,
            contingency_class: 'general', lender_eligible: true, notes: '', vat_override: null },
        ],
        contingency: [
          { name: 'general', pct: 5 },
          { name: 'existing_building', pct: 15 },
          { name: 'abnormal', pct: 2.5 },
        ],
        fee_lines: [
          { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
            basis: 'pct_of_construction_total', amount_pence: 0, pct: 6, per_dwelling: false, vat_override: null },
          { id: 'f2', code: 'cil_s106', category: 'statutory', label: 'CIL / S106',
            basis: 'fixed', amount_pence: 700_000, pct: 0, per_dwelling: false, vat_override: null },
        ],
      },
    });
    expect(run.metrics.cost_plan.construction_total_pence).toBe(run.schedule.totals.construction_pence);
    expect(run.metrics.cost_plan.professional_total_pence).toBe(run.schedule.totals.professional_pence);
    expect(run.metrics.cost_plan.statutory_total_pence).toBe(run.schedule.totals.statutory_pence);
  });
});

// ── R11 (spec §17.5, §17.12): VAT in the headline numbers ─────────────────────

/** The release's primary invariant needs a document where the VAT is genuinely
 *  FUNDED, not gapped: §17.6 keeps VAT out of the development-cost advance base,
 *  so from month 1 onwards the facility can never draw against it and any VAT
 *  the equity does not meet becomes a visible `vat_funding_gap` rather than a
 *  carried balance. Two facts make this document gap-free while still charging
 *  real carry interest:
 *
 *  - every cost lands in month 0, where the day-one advance is capped at the
 *    month's whole `cashUses` (VAT included — monthly-engine.ts's eligible-base
 *    cap governs months 1+, not month 0), so the VAT is drawn on the facility
 *    and carries at 12% until the month-3 reclaim clears it;
 *  - a small committed equity source covers the selling VAT that lands in the
 *    disposal month, which has no eligible spend to draw against.
 *
 *  The ledger is asserted flag-free on both sides below, so a later change that
 *  reintroduces a gap fails loudly instead of quietly weakening the invariant. */
function vatInvariantDocument(opts: {
  registered?: boolean; recoverablePct?: number;
} = {}): CalculatorInputsV8 {
  const registered = opts.registered ?? true;
  const recoverablePct = opts.recoverablePct ?? 100;
  const v7 = defaultCalculatorInputsV7();
  return {
    ...v7,
    inputs_version: 8,
    acquisition: { ...v7.acquisition, purchase_price_pence: 20_000_000 },
    equity_sources: [{
      id: 'e1', classification: 'cash', amount_pence: 5_000_000, timing_month: 0,
      repayment_priority: 1, evidence_status: 'confirmed', notes: '',
    }],
    unit_mix: {
      units: [1, 2, 3, 4].map((n) => ({
        id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
        estimated_value_pence: 60_000_000, comparable_notes: '',
        ancillary: { ...DEFAULT_UNIT_ANCILLARY },
      })),
    },
    conversion_costs: {
      ...v7.conversion_costs,
      construction_cost_per_sqm_pence: 100_000,
      total_construction_sqm: 1_000,
      contingency_pct: 0,
    },
    finance: {
      ...v7.finance,
      funding_source: 'development_finance',
      day_one_advance_pence: 400_000_000,
      committed_net_facility_pence: 500_000_000,
      committed_gross_facility_pence: 600_000_000,
      annual_interest_rate_pct: 12,
      interest_type: 'rolled_up',
      arrangement_fee_pct: 0,
      exit_fee_pct: 1,
      exit_fee_basis: 'committed_gross_facility',
      sales_sweep_pct: 100,
      broker_fee_pence: 250_000,
      lender_legal_fee_pence: 150_000,
      valuation_fee_pence: 100_000,
      monitoring_surveyor_fee_pence: 50_000,
      term_months: 7,
    },
    programme: {
      anchor_month: null,
      packages: {
        construction: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' } },
        professional: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' } },
      },
    },
    vat: {
      ...DEFAULT_VAT,
      registered,
      // Every category at 20%, exactly as §17.5's invariant specifies. The
      // acquisition line stays inert because the vendor has not opted to tax
      // (DEFAULT_VAT.purchase), so the chargeable consideration — and with it
      // the acquisition tax and the acquisition cost line — is identical on
      // both sides of the comparison, and the profit difference is the carry
      // and nothing else.
      treatments: defaultVatTreatments().map((t) => ({
        ...t,
        rate_pct: 20,
        recoverable_pct: recoverablePct,
        recovery_basis: 'zero_rated_sale' as const,
      })),
    },
  };
}

describe('§17.5 — the release’s primary invariant', () => {
  it('fully recoverable VAT moves no cost line, and moves profit only by carry interest', () => {
    // §17.5's primary guard. It fails in all three directions: VAT leaking into
    // a cost base, irrecoverable VAT computed off a rounding residue, or a
    // reclaim going missing.
    const on = runAppraisal(vatInvariantDocument({ registered: true, recoverablePct: 100 }));
    const off = runAppraisal(vatInvariantDocument({ registered: false }));

    // The document is gap-free on both sides: a `vat_funding_gap` would mean
    // part of the VAT never reached the ledger, which would weaken every
    // assertion below into a tautology.
    expect(on.model.flags).toEqual([]);
    expect(off.model.flags).toEqual([]);
    expect(on.schedule.vat.total_input_vat_pence).toBeGreaterThan(0);

    expect(on.metrics.construction_cost_pence).toBe(off.metrics.construction_cost_pence);
    expect(on.metrics.professional_fees_pence).toBe(off.metrics.professional_fees_pence);
    expect(on.metrics.statutory_costs_pence).toBe(off.metrics.statutory_costs_pence);
    expect(on.metrics.selling_costs_pence).toBe(off.metrics.selling_costs_pence);
    expect(on.metrics.cost_plan).toEqual(off.metrics.cost_plan);

    expect(on.metrics.irrecoverable_vat_pence).toBe(0);

    const financeDelta = on.metrics.finance_costs_pence - off.metrics.finance_costs_pence;
    expect(financeDelta).toBeGreaterThan(0);              // carrying VAT costs money
    expect(off.metrics.profit_pence - on.metrics.profit_pence).toBe(financeDelta);
  });

  it('defines vat_carry_interest_pence as the counterfactual, not an apportionment', () => {
    const on = runAppraisal(vatInvariantDocument({ registered: true, recoverablePct: 100 }));
    const off = runAppraisal(vatInvariantDocument({ registered: false }));
    // §17.12's definition, stated literally: total interest as given, less total
    // interest with `vat.registered` forced false.
    expect(on.metrics.vat_carry_interest_pence)
      .toBe(on.model.totals.interest_pence - off.model.totals.interest_pence);
    // …and on this document that IS the whole finance-cost movement — the
    // arrangement fee, the ancillary fees and a committed-gross-facility exit
    // fee are all VAT-independent — which is what pins §17.12's definition to
    // §17.5's invariant above. Where the exit fee is charged on PEAK DEBT the
    // two can separate, and the spec's claim that they are "the same quantity"
    // holds only for the VAT-independent fee bases this document uses.
    expect(on.metrics.vat_carry_interest_pence)
      .toBe(on.metrics.finance_costs_pence - off.metrics.finance_costs_pence);
    // A disclosure of a SLICE of finance costs, never an addition to them.
    expect(on.metrics.total_development_cost_pence)
      .toBe(on.metrics.cost_before_finance_pence + on.metrics.finance_costs_pence);
  });

  it('reports zero carry interest for an unregistered document', () => {
    const off = runAppraisal(vatInvariantDocument({ registered: false }));
    expect(off.metrics.vat_carry_interest_pence).toBe(0);
    expect(off.metrics.irrecoverable_vat_pence).toBe(0);
    expect(off.metrics.vat.registered).toBe(false);
  });

  it('charges irrecoverable VAT to cost before finance, on its own line', () => {
    const on = runAppraisal(vatInvariantDocument({ registered: true, recoverablePct: 0 }));
    const off = runAppraisal(vatInvariantDocument({ registered: false }));
    expect(on.metrics.irrecoverable_vat_pence).toBeGreaterThan(0);
    expect(on.metrics.irrecoverable_vat_pence).toBe(on.schedule.vat.total_irrecoverable_pence);
    // §17.5's one-direction rule: NOT folded back into the construction line.
    expect(on.metrics.construction_cost_pence).toBe(off.metrics.construction_cost_pence);
    expect(on.metrics.cost_plan).toEqual(off.metrics.cost_plan);
    expect(on.metrics.cost_before_finance_pence)
      .toBe(off.metrics.cost_before_finance_pence + on.metrics.irrecoverable_vat_pence);
  });

  it('publishes the whole VatResult on the appraisal result', () => {
    const on = runAppraisal(vatInvariantDocument({ registered: true, recoverablePct: 100 }));
    // The result's `vat` is the schedule's, not a second derivation: §17.5 runs
    // the engine once, in one direction.
    expect(on.metrics.vat).toBe(on.schedule.vat);
    expect(on.metrics.vat.registered).toBe(true);
    expect(on.metrics.vat.peak_carry_pence).toBeGreaterThan(0);
  });
});

/** Ruling R24. The same document under phased sales, with the day-one advance
 *  capped BELOW the month's cash uses so the draw schedule is byte-identical
 *  with and without VAT (committed equity absorbs the VAT outflow instead).
 *  That isolates the one thing under test: the reclaim the ledger repays from
 *  and the phased solver, before this task, had no term for. */
function phasedVatDocument(registered: boolean): CalculatorInputsV8 {
  const base = vatInvariantDocument({ registered, recoverablePct: 100 });
  return {
    ...base,
    equity_sources: [{
      id: 'e1', classification: 'cash', amount_pence: 60_000_000, timing_month: 0,
      repayment_priority: 1, evidence_status: 'confirmed', notes: '',
    }],
    finance: { ...base.finance, day_one_advance_pence: 100_000_000 },
    sales_phasing: { tranches: [
      { month_offset: 5, pct_of_gross_receipts: 60 },
      { month_offset: 6, pct_of_gross_receipts: 40 },
    ] },
  };
}

describe('ruling R24 — the phased senior break-even sees the VAT reclaim', () => {
  it('solves a strictly lower break-even when a reclaim repays the facility', () => {
    const withReclaim = runAppraisal(phasedVatDocument(true));
    const without = runAppraisal(phasedVatDocument(false));

    // The comparison is only meaningful if the two runs drew identically — the
    // reclaim must be the ONLY difference the solver sees. Asserted, not assumed.
    expect(withReclaim.model.months.map((m) => m.draw_pence + m.capitalised_fees_pence))
      .toEqual(without.model.months.map((m) => m.draw_pence + m.capitalised_fees_pence));
    expect(withReclaim.model.flags).toEqual([]);
    expect(without.model.flags).toEqual([]);
    expect(withReclaim.model.totals.vat_reclaim_pence).toBeGreaterThan(0);
    expect(without.model.totals.vat_reclaim_pence).toBe(0);

    // A comparison, never an absolute: an absolute literal here would pin
    // whatever the solver happens to produce rather than the rule under test.
    expect(withReclaim.metrics.senior_breakeven_pence).not.toBeNull();
    expect(without.metrics.senior_breakeven_pence).not.toBeNull();
    expect(withReclaim.metrics.senior_breakeven_pence as number)
      .toBeLessThan(without.metrics.senior_breakeven_pence as number);
  });
});
