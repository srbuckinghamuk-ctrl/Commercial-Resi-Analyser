import { describe, it, expect } from 'vitest';
import { validateInputs, reconcile } from './validation';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { migrateV2toV3 } from './migrate';
import type { CalculatorInputsV3 } from './finance-types';

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
});
