import { describe, it, expect } from 'vitest';
import { validateInputs, reconcile } from './validation';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { migrateV2toV3, migrateInputsToV4 } from './migrate';
import type { CalculatorInputsV3, CalculatorInputsV4, ProgrammePackage, RefinanceInputs } from './finance-types';

function errorsFor(mutate: (i: ReturnType<typeof defaultCalculatorInputsV2>) => void) {
  const inputs = defaultCalculatorInputsV2();
  inputs.unit_mix.units = [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' }];
  inputs.acquisition.purchase_price_pence = 10_000_000;
  mutate(inputs);
  return validateInputs(inputs);
}

function errorsForV3(mutate: (i: CalculatorInputsV3) => void) {
  const inputs = migrateV2toV3(defaultCalculatorInputsV2());
  inputs.unit_mix.units = [
    { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
    { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' },
  ];
  inputs.acquisition.purchase_price_pence = 10_000_000;
  mutate(inputs);
  return validateInputs(inputs);
}

describe('validateInputs — hard errors', () => {
  it('rejects negative money values (the York Part L −£1 case)', () => {
    const issues = errorsFor((i) => { i.conversion_costs.part_l_compliance_pence = -1; });
    expect(issues.some((x) => x.severity === 'error' && x.field.includes('part_l'))).toBe(true);
  });

  it('rejects zero-value units (zero GDV where units exist)', () => {
    const issues = errorsFor((i) => { i.unit_mix.units[0].estimated_value_pence = 0; });
    expect(issues.some((x) => x.severity === 'error' && x.field.includes('unit'))).toBe(true);
  });

  it('rejects cash funding with a non-zero committed facility', () => {
    const issues = errorsFor((i) => {
      i.finance.funding_source = 'cash';
      i.finance.committed_net_facility_pence = 1_000_000;
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.committed_net_facility_pence')).toBe(true);
  });

  it('rejects day-one advance above the net facility', () => {
    const issues = errorsFor((i) => {
      i.finance.committed_net_facility_pence = 10_000_000;
      i.finance.day_one_advance_pence = 20_000_000;
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.day_one_advance_pence')).toBe(true);
  });

  it('rejects gross facility below net facility', () => {
    const issues = errorsFor((i) => {
      i.finance.committed_net_facility_pence = 10_000_000;
      i.finance.committed_gross_facility_pence = 5_000_000;
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.committed_gross_facility_pence')).toBe(true);
  });

  it('rejects pari_passu as not yet supported', () => {
    const issues = errorsFor((i) => { i.finance.equity_draw_rule = 'pari_passu'; });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.equity_draw_rule')).toBe(true);
  });

  it('rejects term_months < 1 and invalid share percentages', () => {
    expect(errorsFor((i) => { i.finance.term_months = 0; })
      .some((x) => x.severity === 'error' && x.field === 'finance.term_months')).toBe(true);
    expect(errorsFor((i) => { i.finance.sales_sweep_pct = 130; })
      .some((x) => x.severity === 'error' && x.field === 'finance.sales_sweep_pct')).toBe(true);
  });

  it('warns (not errors) on unreconciled construction area vs unit areas', () => {
    const issues = errorsFor((i) => {
      i.conversion_costs.total_construction_sqm = 500; // units total 50 sqm
    });
    const area = issues.find((x) => x.field === 'conversion_costs.total_construction_sqm');
    expect(area?.severity).toBe('warning');
  });

  it('warns on blended exit with no retained units', () => {
    const issues = errorsFor((i) => { i.exit_strategy.route = 'blended'; i.exit_strategy.retained_units = []; });
    expect(issues.some((x) => x.severity === 'warning' && x.field === 'exit_strategy.retained_units')).toBe(true);
  });

  it('rejects a deal_spider target_profit_on_cost_pct of -100% or below (non-finite RLV)', () => {
    const issues = errorsFor((i) => { i.deal_spider.target_profit_on_cost_pct = -100; });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'deal_spider.target_profit_on_cost_pct')).toBe(true);
    const issuesBelow = errorsFor((i) => { i.deal_spider.target_profit_on_cost_pct = -150; });
    expect(issuesBelow.some((x) => x.severity === 'error' && x.field === 'deal_spider.target_profit_on_cost_pct')).toBe(true);
  });

  // C1 (spec §2): non-cash equity is recorded but does not fund the waterfall —
  // the review's exploit was an unconfirmed planning_uplift source masquerading
  // as committed equity.
  it('warns when a non-cash equity source with a positive amount is present', () => {
    const issues = errorsFor((i) => {
      i.equity_sources = [{
        id: 'e1', classification: 'land', amount_pence: 10_000_000, timing_month: 0,
        repayment_priority: 1, evidence_status: 'confirmed', notes: '',
      }];
    });
    expect(issues.some((x) => x.severity === 'warning'
      && x.field === 'equity_sources[0]'
      && x.message.includes('Non-cash equity')
      && x.message.includes('not yet modelled as funding'))).toBe(true);
  });

  it('does not warn for a zero-amount non-cash source or a cash source', () => {
    const issues = errorsFor((i) => {
      i.equity_sources = [
        { id: 'e1', classification: 'vendor_finance', amount_pence: 0, timing_month: 0, repayment_priority: 1, evidence_status: 'confirmed', notes: '' },
        { id: 'e2', classification: 'cash', amount_pence: 10_000_000, timing_month: 0, repayment_priority: 1, evidence_status: 'confirmed', notes: '' },
      ];
    });
    expect(issues.some((x) => x.message.includes('Non-cash equity'))).toBe(false);
  });
});

// Release 2b Task 3 (spec §3.2): lender_valuation hard errors, mirrored in
// validation.py with the same messages.
describe('validateInputs — lender_valuation hard errors', () => {
  const PROVENANCE = { reason: 'Test haircut', author: 'test-author', date: '2026-08-13' };

  it('accepts no issues for a well-formed global_pct block', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = { basis: 'global_pct', global_value: -10, per_key_values: null, ...PROVENANCE };
    });
    expect(issues.filter((x) => x.field.startsWith('lender_valuation'))).toEqual([]);
  });

  it('rejects an empty reason/author/date', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = { basis: 'global_pct', global_value: -10, per_key_values: null, reason: '', author: '', date: '' };
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation.reason')).toBe(true);
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation.author')).toBe(true);
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation.date')).toBe(true);
  });

  it('rejects a missing global_value for a basis that requires it', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = { basis: 'fixed_amount', global_value: null, per_key_values: null, ...PROVENANCE };
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation'
      && x.message === 'Lender valuation basis "fixed_amount" requires a global_value.')).toBe(true);
  });

  it('rejects a missing per_unit id', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = { basis: 'per_unit', global_value: null, per_key_values: { u1: 25_000_000 }, ...PROVENANCE };
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation'
      && x.message.includes('missing a value for unit "u2"'))).toBe(true);
  });

  it('rejects a non-positive computed lender unit value', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = { basis: 'global_pct', global_value: -100, per_key_values: null, ...PROVENANCE };
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation'
      && x.message.includes('must be positive'))).toBe(true);
  });

  it('rejects fractional pence for global_per_sqft (Task-1-review addition)', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = { basis: 'global_per_sqft', global_value: 200_000.5, per_key_values: null, ...PROVENANCE };
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation.global_value'
      && x.message.includes('whole number of pence'))).toBe(true);
  });

  it('rejects fractional pence for a per_unit value (Task-1-review addition)', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = {
        basis: 'per_unit', global_value: null,
        per_key_values: { u1: 25_000_000.5, u2: 25_000_000 }, ...PROVENANCE,
      };
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'lender_valuation.per_key_values[u1]'
      && x.message.includes('whole number of pence'))).toBe(true);
  });

  it('allows a fractional global_pct percentage adjustment', () => {
    const issues = errorsForV3((i) => {
      i.lender_valuation = { basis: 'global_pct', global_value: -7.5, per_key_values: null, ...PROVENANCE };
    });
    expect(issues.filter((x) => x.field.startsWith('lender_valuation'))).toEqual([]);
  });
});

describe('reconcile', () => {
  it('reports a fully reconciled clean case as report_safe', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.unit_mix.units = [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    }));
    inputs.conversion_costs.total_construction_sqm = 200;
    inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000;
    inputs.finance.committed_net_facility_pence = 50_000_000;
    inputs.finance.day_one_advance_pence = 30_000_000;
    inputs.equity_sources[0].amount_pence = 40_000_000;
    const schedule = buildSchedule(inputs);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const rec = reconcile(inputs, schedule, model);
    expect(rec.sources_equal_uses).toBe(true);
    expect(rec.debt_rollforward_ok).toBe(true);
    expect(rec.closing_never_negative).toBe(true);
    expect(rec.facility_within_limit).toBe(true);
    expect(rec.senior_repaid).toBe(true);
    expect(rec.funding_complete).toBe(true);
    expect(rec.report_safe).toBe(true);
  });

  // C1 pinning test (spec §2, round-2 review exploit): an unconfirmed
  // planning_uplift source large enough to cover every cost must not be
  // treated as committed equity — it produces a real funding gap.
  it('fails report_safe when the only equity is an unconfirmed planning uplift source', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.unit_mix.units = [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    }));
    inputs.conversion_costs.total_construction_sqm = 200;
    inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000;
    inputs.finance.funding_source = 'cash';
    inputs.equity_sources = [{
      id: 'e1', classification: 'planning_uplift', amount_pence: 200_000_000,
      timing_month: 0, repayment_priority: 1, evidence_status: 'unconfirmed', notes: '',
    }];
    const schedule = buildSchedule(inputs);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    expect(model.totals.funding_gap_pence).toBeGreaterThan(0);
    const rec = reconcile(inputs, schedule, model);
    expect(rec.funding_complete).toBe(false);
    expect(rec.report_safe).toBe(false);
  });

  it('fails report_safe when a funding gap exists', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.unit_mix.units = [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 120_000_000, comparable_notes: '' }];
    inputs.conversion_costs.total_construction_sqm = 400;
    inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000;
    inputs.finance.committed_net_facility_pence = 10_000_000;
    inputs.equity_sources[0].amount_pence = 10_000_000;
    const schedule = buildSchedule(inputs);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const rec = reconcile(inputs, schedule, model);
    expect(rec.funding_complete).toBe(false);
    expect(rec.report_safe).toBe(false);
  });

  // Coordinator fix (spec §4.5/§7, fixture J invariant-matrix defect): a refinance whose
  // net proceeds fall short of the outstanding balance + exit fee injects additional
  // equity to fund the facility's full redemption — a financing-side flow, like
  // sale-proceeds repayments, that spec §7's sources-and-uses identity deliberately
  // excludes. Before the fix, reconcile() counted that equity as an uncategorised source
  // with no matching use, breaking sources_equal_uses even though nothing is actually
  // unfunded.
  it('a refinance shortfall does not break sources=uses reconciliation (spec §4.5/§7)', () => {
    const inputs = migrateInputsToV4({});
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.unit_mix.units = [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    }));
    inputs.conversion_costs.total_construction_sqm = 200;
    inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000;
    inputs.finance.committed_net_facility_pence = 50_000_000;
    inputs.finance.committed_gross_facility_pence = 55_000_000;
    inputs.finance.day_one_advance_pence = 30_000_000;
    inputs.finance.term_months = 12;
    inputs.equity_sources[0].amount_pence = 40_000_000;
    inputs.exit_strategy.route = 'retain_all';
    // Net proceeds = round(1,000,000 × 50 / 100) - 0 - 0 = 500,000 — a small fraction of
    // the outstanding senior balance, guaranteeing the shortfall branch fires.
    inputs.refinance = {
      month_offset: 11, investment_value_pence: 1_000_000, ltv_pct: 50,
      arrangement_fee_pence: 0, legal_costs_pence: 0,
    };
    const schedule = buildSchedule(inputs);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    expect(model.totals.refinance_shortfall_equity_pence).toBeGreaterThan(0);
    const rec = reconcile(inputs, schedule, model);
    expect(rec.sources_equal_uses).toBe(true);
    expect(model.flags.some((f) => f.code === 'additional_equity_required')).toBe(true);
  });
});

describe('v4 programme validation', () => {
  const withProgramme = (pkg: Partial<ProgrammePackage>) => {
    const v4 = migrateInputsToV4({});
    v4.finance.term_months = 12;
    const ok: ProgrammePackage = { start_offset: 1, duration_months: 6, curve: { kind: 'straight_line' } };
    v4.programme = { anchor_month: null, packages: {
      construction: { ...ok, ...pkg }, professional: ok, statutory: ok,
    } };
    return v4;
  };
  const errorsOn = (field: string, v4: CalculatorInputsV4) =>
    validateInputs(v4).some((i) => i.severity === 'error' && i.field.startsWith(field));

  it('accepts a well-formed programme', () => {
    expect(validateInputs(withProgramme({})).filter((i) => i.field.startsWith('programme'))).toEqual([]);
  });
  it('rejects duration < 1', () => {
    expect(errorsOn('programme.packages.construction', withProgramme({ duration_months: 0 }))).toBe(true);
  });
  it('rejects negative start_offset', () => {
    expect(errorsOn('programme.packages.construction', withProgramme({ start_offset: -1 }))).toBe(true);
  });
  // CRITICAL 1b: the schedule's programme arm floors both fields but never
  // rejects a fractional value itself — a typed "2.5" duration or start_offset
  // must be caught here, not left to reach buildSchedule un-floored.
  it('rejects a fractional duration_months', () => {
    const issues = validateInputs(withProgramme({ duration_months: 2.5 }));
    expect(issues.some((i) => i.field === 'programme.packages.construction'
      && i.severity === 'error'
      && i.message === 'Package duration must be a whole number of months.')).toBe(true);
  });
  it('rejects a fractional start_offset', () => {
    const issues = validateInputs(withProgramme({ start_offset: 1.5 }));
    expect(issues.some((i) => i.field === 'programme.packages.construction'
      && i.severity === 'error'
      && i.message === 'Package start month must be a whole month.')).toBe(true);
  });
  it('rejects a window breaching the 2-month sale tail (start+duration−1 > term−2)', () => {
    // start 6 + duration 6 − 1 = 11 > term − 2 = 10 (start 5 would be the legal boundary: 10 ≤ 10)
    expect(errorsOn('programme.packages.construction', withProgramme({ start_offset: 6, duration_months: 6 }))).toBe(true);
    expect(errorsOn('programme.packages.construction', withProgramme({ start_offset: 5, duration_months: 6 }))).toBe(false);
  });
  it('rejects user_defined weights of the wrong length, negative, or all-zero', () => {
    for (const weights of [[1, 2], [1, -1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0]]) {
      expect(errorsOn('programme.packages.construction',
        withProgramme({ curve: { kind: 'user_defined', weights } }))).toBe(true);
    }
  });
  it('rejects non-finite user_defined weights (NaN, ±Infinity)', () => {
    // I3 (final R3a review): NaN slips past every other weight rule — NaN < 0 is
    // false, and a sum containing NaN is never <= 0 — and then poisons the spread,
    // which the Python side surfaces as a 500 ("cannot convert float NaN to
    // integer"). Python's json.loads accepts literal NaN/Infinity, so this is
    // reachable from the wire, not just from code.
    for (const weights of [
      [1, NaN, 1, 1, 1, 1],
      [1, Infinity, 1, 1, 1, 1],
      [1, -Infinity, 1, 1, 1, 1],
    ]) {
      const issues = validateInputs(withProgramme({ curve: { kind: 'user_defined', weights } }));
      expect(issues.some((i) => i.field === 'programme.packages.construction'
        && i.severity === 'error'
        && i.message === 'user_defined weights must be finite numbers.'), String(weights)).toBe(true);
    }
  });
  describe('v4 sales_phasing validation (calc 2.3.0)', () => {
    const withTranches = (tranches: Array<{ month_offset: number; pct_of_gross_receipts: number }>,
      route: 'sell_all' | 'retain_all' | 'blended' = 'sell_all') => {
      const v4 = migrateInputsToV4({});
      v4.finance.term_months = 12;
      v4.exit_strategy.route = route;
      v4.sales_phasing = { tranches };
      return v4;
    };
    const errorsOn = (field: string, inputs: CalculatorInputsV4) =>
      validateInputs(inputs).some((i) => i.severity === 'error' && i.field.startsWith(field));

    it('accepts a well-formed tranche set', () => {
      expect(errorsOn('sales_phasing', withTranches([
        { month_offset: 9, pct_of_gross_receipts: 40 },
        { month_offset: 10, pct_of_gross_receipts: 35 },
        { month_offset: 11, pct_of_gross_receipts: 25 },
      ]))).toBe(false);
    });
    it('rejects the block on retain_all', () => {
      expect(errorsOn('sales_phasing',
        withTranches([{ month_offset: 11, pct_of_gross_receipts: 100 }], 'retain_all'))).toBe(true);
    });
    it('rejects an empty tranche list', () => {
      expect(errorsOn('sales_phasing', withTranches([]))).toBe(true);
    });
    it('rejects out-of-range, fractional, non-increasing months and non-positive or non-finite pcts', () => {
      for (const tranches of [
        [{ month_offset: 12, pct_of_gross_receipts: 100 }],
        [{ month_offset: -1, pct_of_gross_receipts: 100 }],
        [{ month_offset: 5.5, pct_of_gross_receipts: 100 }],
        [{ month_offset: 10, pct_of_gross_receipts: 50 }, { month_offset: 10, pct_of_gross_receipts: 50 }],
        [{ month_offset: 10, pct_of_gross_receipts: 50 }, { month_offset: 9, pct_of_gross_receipts: 50 }],
        [{ month_offset: 11, pct_of_gross_receipts: 0 }],
        [{ month_offset: 11, pct_of_gross_receipts: Number.NaN }],
      ]) expect(errorsOn('sales_phasing', withTranches(tranches))).toBe(true);
    });
    it('rejects percentages not summing to 100 (beyond 1e-9)', () => {
      expect(errorsOn('sales_phasing', withTranches([
        { month_offset: 10, pct_of_gross_receipts: 60 },
        { month_offset: 11, pct_of_gross_receipts: 39.9 },
      ]))).toBe(true);
    });
  });

  describe('v4 refinance validation (calc 2.3.0)', () => {
    const withRefi = (refi: Partial<RefinanceInputs>,
      route: 'sell_all' | 'retain_all' | 'blended' = 'retain_all') => {
      const v4 = migrateInputsToV4({});
      v4.finance.term_months = 12;
      v4.exit_strategy.route = route;
      v4.refinance = {
        month_offset: 11, investment_value_pence: 30_000_000, ltv_pct: 65,
        arrangement_fee_pence: 0, legal_costs_pence: 0, ...refi,
      };
      return v4;
    };
    const errorsOn = (inputs: CalculatorInputsV4) =>
      validateInputs(inputs).some((i) => i.severity === 'error' && i.field.startsWith('refinance'));

    it('accepts a well-formed block on retain_all and blended', () => {
      expect(errorsOn(withRefi({}))).toBe(false);
      expect(errorsOn(withRefi({}, 'blended'))).toBe(false);
    });
    it('rejects the block on sell_all', () => {
      expect(errorsOn(withRefi({}, 'sell_all'))).toBe(true);
    });
    it('rejects bad months, values, fees, and LTV', () => {
      for (const bad of [
        { month_offset: 12 }, { month_offset: -1 }, { month_offset: 3.5 },
        { investment_value_pence: -1 }, { investment_value_pence: Number.NaN },
        { ltv_pct: 0 }, { ltv_pct: 101 }, { ltv_pct: Number.NaN },
        { arrangement_fee_pence: -1 }, { legal_costs_pence: -1 },
      ]) expect(errorsOn(withRefi(bad))).toBe(true);
    });
  });
});
