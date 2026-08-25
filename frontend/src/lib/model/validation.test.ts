import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { validateInputs, reconcile } from './validation';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import {
  migrateV2toV3, migrateInputsToV4, migrateInputsToV5, migrateInputsToV6, migrateV6toV7,
  migrateInputsToV8, migrateInputsToV9, migrateV8toV9, migrateInputsToV10, PROGRAMME_FIELD_ALIASES,
} from './migrate';
import { runAppraisal } from './index';
import { DEFAULT_AREA_BRIDGE } from './areas';
import { DEFAULT_UNIT_ANCILLARY } from '../conversion-types';
import type { ProposedUnitV6 } from '../conversion-types';
import type {
  CalculatorInputsV3, CalculatorInputsV4, CalculatorInputsV6, CalculatorInputsV7, CalculatorInputsV8,
  CalculatorInputsV9, ProgrammePackage, RefinanceInputs,
} from './finance-types';
import type { CostPackage, CostPlanInputs, FeeLine } from './cost-plan';
import type { Phase, ProgrammeNetwork } from './programme';
import { DEFAULT_VAT, VAT_CHARGE_CATEGORIES, defaultVatTreatments } from './vat';
import type { VatChargeCategory, VatOverride, VatTreatment } from './vat';
import { icDoc } from './__fixtures__/investment-case-docs';
import { MONITORING_CATEGORIES } from './finance-types';
import type {
  CalculatorInputsV10, CalculatorInputsV11, MonitoringCategory, MonitoringInputs, MonitoringLineInputs,
} from './finance-types';
import { unitSalesDoc, noProgrammeDoc } from './__fixtures__/unit-sales-docs';
import type { CalculatorInputsV12, CalculatorInputsV13 } from './finance-types';
import { migrateInputsToV12, migrateInputsToV13 } from './migrate';
import { QS, ddDoc, rawYAsV12 } from './__fixtures__/due-diligence-docs';
import type { PriceBasis, QsStage, QsStatus } from './cost-plan';

type MinimalUnit = Pick<ProposedUnitV6, 'id' | 'floor_area_sqm' | 'estimated_value_pence'>
  & Partial<ProposedUnitV6>;

/** R9 (Task 8). A v6 document built from the migration chain's own defaults —
 *  the only way to get a structurally-valid v6 document without hand-rolling
 *  every unrelated block. `units`/`conversion_costs`/`areas` are the only
 *  overrides the area-bridge suite needs, so that is all this accepts; each is
 *  merged onto the defaults rather than replacing them wholesale, so a partial
 *  override (e.g. `{ total_construction_sqm: 500 }`) does not blank out
 *  required sibling fields the schedule/metrics arms still read. */
function makeV6Inputs(overrides: {
  areas?: Partial<typeof DEFAULT_AREA_BRIDGE>;
  units?: MinimalUnit[];
  conversion_costs?: Partial<CalculatorInputsV6['conversion_costs']>;
  /** R9 Task 12: the calendar-date suite needs to set `acquisition_date`. */
  acquisition?: Partial<CalculatorInputsV6['acquisition']>;
} = {}): CalculatorInputsV6 {
  const base = migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 });
  return {
    ...base,
    acquisition: { ...base.acquisition, ...(overrides.acquisition ?? {}) },
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

/** R10 (Task 10). A v7 document built from the migration chain's own
 *  defaults, exactly like makeV6Inputs above — migrateV6toV7 derives its
 *  cost_plan via costPlanFromLegacyCosts, so the baseline is a structurally
 *  valid headline-mode plan with eight fixed-basis fee lines and three
 *  contingency classes, without hand-rolling any of it. */
function makeV7Inputs(overrides: {
  cost_plan?: Partial<CalculatorInputsV7['cost_plan']>;
  conversion_costs?: Partial<CalculatorInputsV6['conversion_costs']>;
} = {}): CalculatorInputsV7 {
  const v6 = migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 });
  const v7 = migrateV6toV7(v6);
  return {
    ...v7,
    conversion_costs: { ...v7.conversion_costs, ...(overrides.conversion_costs ?? {}) },
    cost_plan: { ...v7.cost_plan, ...(overrides.cost_plan ?? {}) },
  };
}

/** R11 (Task 9, spec §17.9). A v8 document built on makeV7Inputs — there is no
 *  migrateV7toV8 yet (Task 10 lands it), so the `vat` block is added directly
 *  from DEFAULT_VAT here, exactly as buildWorkedVatCase does in vat.test.ts.
 *  `purchase` is merged one level deeper than the rest so a partial override
 *  (e.g. `{ togc_treatment: 'applies' }`) does not blank out `vendor_opted_to_tax`. */
function makeV8Inputs(overrides: {
  cost_plan?: Partial<CalculatorInputsV7['cost_plan']>;
  conversion_costs?: Partial<CalculatorInputsV6['conversion_costs']>;
  finance?: Partial<CalculatorInputsV7['finance']>;
  exit_strategy?: Partial<CalculatorInputsV7['exit_strategy']>;
  vat?: Partial<Omit<CalculatorInputsV8['vat'], 'purchase'>> & {
    purchase?: Partial<CalculatorInputsV8['vat']['purchase']>;
  };
} = {}): CalculatorInputsV8 {
  const v7 = makeV7Inputs({ cost_plan: overrides.cost_plan, conversion_costs: overrides.conversion_costs });
  const vatOverrides = overrides.vat ?? {};
  return {
    ...v7,
    inputs_version: 8,
    finance: { ...v7.finance, ...(overrides.finance ?? {}) },
    exit_strategy: { ...v7.exit_strategy, ...(overrides.exit_strategy ?? {}) },
    vat: {
      ...DEFAULT_VAT,
      ...vatOverrides,
      purchase: { ...DEFAULT_VAT.purchase, ...(vatOverrides.purchase ?? {}) },
    },
  };
}

/** Builds the six-row `treatments` array from the production default, applying
 *  a partial patch to the named category's row only — every other row (and the
 *  order) stays exactly as `defaultVatTreatments()` produces it. */
function vatTreatments(
  overrides: Partial<Record<VatChargeCategory, Partial<VatTreatment>>> = {},
): VatTreatment[] {
  return defaultVatTreatments().map((t) => ({ ...t, ...(overrides[t.category] ?? {}) }));
}

function vatOverride(overrides: Partial<VatOverride> = {}): VatOverride {
  return { rate_pct: 0, recoverable_pct: 0, recovery_basis: 'unconfirmed', ...overrides };
}

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

  // R9 retires the ±25% unit-NIA vs construction-area warning that used to
  // live here (see the 'R9 — the ±25% warning is retired' describe block
  // below) — a v2 document has no `areas` block, so the replacement area-
  // bridge rules are inert for it too, and no issue is raised at all now.
  it('raises no area issue for a v2 document regardless of the area mismatch', () => {
    const issues = errorsFor((i) => {
      i.conversion_costs.total_construction_sqm = 500; // units total 50 sqm
    });
    expect(issues.some((x) => x.field === 'conversion_costs.total_construction_sqm')).toBe(false);
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

  describe('acquisition tax validation (R8)', () => {
    const v5 = () => migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);

    it('rejects an override with no reason', () => {
      const inputs = v5();
      inputs.acquisition.acquisition_tax_override_pence = 500_000;
      inputs.acquisition.acquisition_tax_override_reason = '   ';
      const issues = validateInputs(inputs);
      const issue = issues.find((i) => i.field === 'acquisition.acquisition_tax_override_reason');
      expect(issue?.severity).toBe('error');
    });

    it('accepts an override with a reason', () => {
      const inputs = v5();
      inputs.acquisition.acquisition_tax_override_pence = 500_000;
      inputs.acquisition.acquisition_tax_override_reason = 'Group relief claimed.';
      expect(validateInputs(inputs).some(
        (i) => i.field === 'acquisition.acquisition_tax_override_reason',
      )).toBe(false);
    });

    it('rejects an acquisition date no band set covers', () => {
      const inputs = v5();
      inputs.acquisition.jurisdiction = 'wales';
      inputs.acquisition.acquisition_date = '1990-01-01';
      const issue = validateInputs(inputs).find((i) => i.field === 'acquisition.acquisition_date');
      expect(issue?.severity).toBe('error');
      expect(issue?.message).toContain('2020-12-22');
    });

    it('rejects a malformed acquisition date', () => {
      const inputs = v5();
      inputs.acquisition.acquisition_date = '17/08/2026';
      const issue = validateInputs(inputs).find((i) => i.field === 'acquisition.acquisition_date');
      expect(issue?.severity).toBe('error');
    });

    // R9 Task 12 — the R8 carry-forward. The shape-only regex that stood here until this
    // release accepted any four-two-two digit string, so `2026-02-31` validated and was
    // then reported as `date_basis: 'transaction_date'`. Both halves are asserted: the
    // impossible date is rejected, and a real leap day is still accepted — a check that
    // rejected every February date would satisfy the first alone.
    it('rejects a date that matches the pattern but does not exist', () => {
      const issues = validateInputs(makeV6Inputs({ acquisition: { acquisition_date: '2026-02-31' } }));
      expect(issues.some(
        (i) => i.severity === 'error' && i.field === 'acquisition.acquisition_date',
      )).toBe(true);
    });

    it('accepts 29 February in a leap year', () => {
      const issues = validateInputs(makeV6Inputs({ acquisition: { acquisition_date: '2028-02-29' } }));
      expect(issues.filter((i) => i.field === 'acquisition.acquisition_date')).toEqual([]);
    });

    it.each([
      ['a 13th month', '2026-13-01'],
      ['a zero month', '2026-00-15'],
      ['a zero day', '2026-01-00'],
      ['a 31st of April', '2026-04-31'],
      ['29 February in a common year', '2027-02-29'],
    ])('rejects %s', (_label, badDate) => {
      const issues = validateInputs(makeV6Inputs({ acquisition: { acquisition_date: badDate } }));
      expect(issues.some(
        (i) => i.severity === 'error' && i.field === 'acquisition.acquisition_date',
      )).toBe(true);
    });

    it('warns — but does not error — on an unconfirmed jurisdiction', () => {
      const inputs = v5();
      const issue = validateInputs(inputs).find(
        (i) => i.field === 'acquisition.jurisdiction_evidence_status',
      );
      expect(issue?.severity).toBe('warning');
      expect(validateInputs(inputs).some((i) => i.severity === 'error')).toBe(false);
    });

    // Fix round 1. Before this fix, runAppraisal computed the acquisition cost
    // stack (buildSchedule/deriveMetrics) *before* validateInputs ran, and both
    // reached selectBandSet unwrapped — a bad date crashed the whole appraisal
    // with an uncaught exception instead of surfacing the field-level error
    // above. This proves the full pipeline now degrades instead of throwing,
    // while the hard error (and report_safe: false) still fire.
    it.each([
      ['an uncovered date', '1990-01-01'],
      ['a malformed date', '17/08/2026'],
    ])('completes the full pipeline on %s instead of throwing', (_label, badDate) => {
      const inputs = v5();
      inputs.acquisition.acquisition_date = badDate;

      const run = runAppraisal(inputs); // must not throw

      expect(run.metrics.acquisition_tax.date_basis).toBe('assumed_current');
      const issue = run.validation.find((i) => i.field === 'acquisition.acquisition_date');
      expect(issue?.severity).toBe('error');
      expect(run.reconciliation.report_safe).toBe(false);
    });
  });
});

// R9 (Task 8, spec §15.6). New area-bridge rules, and the retirement of the
// ±25% unit-NIA vs construction-area warning they replace.
describe('R9 — area bridge validation', () => {
  const AREA_FIELDS = [
    'existing_gia_sqm', 'demolished_gia_sqm', 'extension_gia_sqm',
    'retained_commercial_gia_sqm', 'untouched_gia_sqm', 'circulation_common_sqm',
    'plant_riser_sqm', 'store_bin_cycle_sqm', 'amenity_sqm', 'external_amenity_sqm',
  ] as const;

  it('hard-errors on a negative entered area, for every bridge field', () => {
    for (const field of AREA_FIELDS) {
      const issues = validateInputs(makeV6Inputs({
        areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual', [field]: -1 },
      }));
      expect(issues.some((i) => i.severity === 'error' && i.field === `areas.${field}`), field).toBe(true);
    }
  });

  it('does not hard-error on an all-zero bridge (the migrated default)', () => {
    const issues = validateInputs(makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' } }));
    expect(issues.filter((i) => i.field.startsWith('areas.'))).toEqual([]);
  });

  // Review fix round 1 (Important 1): the case above passes no units, so it
  // never exercises `bridge.developed_gia_sqm > 0` — the guard that keeps the
  // units-over-fill hard error inert for a zeroed bridge. A zeroed bridge WITH
  // a real unit schedule is exactly the state every migrated legacy document
  // is in, and is the single highest-value scenario for that guard. Confirmed
  // by hand: removing `bridge.developed_gia_sqm > 0 &&` from validation.ts's
  // `unit_mix.units` check makes this test fail (available_for_units_sqm is 0,
  // unitNia is 300, unallocated is -300 < 0).
  it('does not hard-error on an all-zero bridge with a real unit schedule (migrated legacy document)', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' },
      units: [
        { id: 'u1', floor_area_sqm: 100, estimated_value_pence: 1 },
        { id: 'u2', floor_area_sqm: 100, estimated_value_pence: 1 },
        { id: 'u3', floor_area_sqm: 100, estimated_value_pence: 1 },
      ],
    }));
    expect(issues.filter((i) => i.field.startsWith('areas.'))).toEqual([]);
    expect(issues.some((i) => i.severity === 'error' && i.field === 'unit_mix.units')).toBe(false);
  });

  it('hard-errors when the bridge basis is selected with no bridge', () => {
    const issues = validateInputs(makeV6Inputs({ areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived' } }));
    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'error', field: 'areas.existing_gia_sqm',
    }));
  });

  it('does not hard-error the bridge-basis-no-bridge rule once the bridge produces area', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1 },
    }));
    expect(issues.some((i) => i.field === 'areas.existing_gia_sqm')).toBe(false);
  });

  it('hard-errors when demolition exceeds the existing building', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 100, demolished_gia_sqm: 150 },
    }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'areas.demolished_gia_sqm')).toBe(true);
  });

  it('does not hard-error when demolition exactly consumes the existing building', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 100, demolished_gia_sqm: 100 },
    }));
    expect(issues.some((i) => i.field === 'areas.demolished_gia_sqm')).toBe(false);
  });

  it('hard-errors when retained and untouched area exceed proposed GIA', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: {
        ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived',
        existing_gia_sqm: 500, retained_commercial_gia_sqm: 400, untouched_gia_sqm: 200,
      },
    }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'areas.retained_commercial_gia_sqm')).toBe(true);
  });

  it('does not hard-error that rule when retained and untouched exactly consume proposed GIA', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: {
        ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived',
        existing_gia_sqm: 500, retained_commercial_gia_sqm: 300, untouched_gia_sqm: 200,
      },
    }));
    expect(issues.some((i) => i.field === 'areas.retained_commercial_gia_sqm')).toBe(false);
  });

  it('hard-errors when non-saleable deductions exceed developed GIA', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 100, circulation_common_sqm: 200 },
    }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'areas.circulation_common_sqm')).toBe(true);
  });

  it('does not hard-error that rule when deductions exactly consume developed GIA', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 100, circulation_common_sqm: 100 },
    }));
    expect(issues.some((i) => i.field === 'areas.circulation_common_sqm')).toBe(false);
  });

  it('hard-errors when the units over-fill the space available for them', () => {
    // Over-allocating the building is impossible, not questionable.
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 200 },
      units: [{ id: 'u1', floor_area_sqm: 300, estimated_value_pence: 1 }],
    }));
    expect(issues.some((i) => i.severity === 'error' && i.field === 'unit_mix.units')).toBe(true);
  });

  it('does not hard-error that rule when the schedule exactly fills the space available', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 200 },
      units: [{ id: 'u1', floor_area_sqm: 200, estimated_value_pence: 1 }],
    }));
    expect(issues.some((i) => i.field === 'unit_mix.units')).toBe(false);
  });

  it('warns when more than 10% of the developed area is unallocated', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
      units: [{ id: 'u1', floor_area_sqm: 100, estimated_value_pence: 1 }],
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.unallocated_sqm')).toBe(true);
  });

  it('does not warn at exactly the 10% unallocated boundary', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
      units: [{ id: 'u1', floor_area_sqm: 900, estimated_value_pence: 1 }], // unallocated = 100 = exactly 10%
    }));
    expect(issues.some((i) => i.field === 'areas.unallocated_sqm')).toBe(false);
  });

  it('warns just past the 10% unallocated boundary', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
      units: [{ id: 'u1', floor_area_sqm: 899, estimated_value_pence: 1 }], // unallocated = 101 > 10%
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.unallocated_sqm')).toBe(true);
  });

  it('warns when net-to-gross efficiency falls outside 65-90%', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
      units: [{ id: 'u1', floor_area_sqm: 100, estimated_value_pence: 1 }],
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.nia_to_gia_pct')).toBe(true);
  });

  it('does not warn at exactly the 65% and 90% net-to-gross boundaries', () => {
    for (const floorArea of [650, 900]) { // pct(650,1000)=65.00, pct(900,1000)=90.00
      const issues = validateInputs(makeV6Inputs({
        areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
        units: [{ id: 'u1', floor_area_sqm: floorArea, estimated_value_pence: 1 }],
      }));
      expect(issues.some((i) => i.field === 'areas.nia_to_gia_pct'), String(floorArea)).toBe(false);
    }
  });

  it('warns just past the 65% and 90% net-to-gross boundaries', () => {
    for (const floorArea of [649, 901]) {
      const issues = validateInputs(makeV6Inputs({
        areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 1000 },
        units: [{ id: 'u1', floor_area_sqm: floorArea, estimated_value_pence: 1 }],
      }));
      expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.nia_to_gia_pct'), String(floorArea)).toBe(true);
    }
  });

  it('warns when the manual basis disagrees with a populated bridge by over 5%', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual', existing_gia_sqm: 1000 },
      conversion_costs: { total_construction_sqm: 500 },
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.basis')).toBe(true);
  });

  it('does not warn at exactly the 5% manual-vs-bridge boundary', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual', existing_gia_sqm: 1000 },
      conversion_costs: { total_construction_sqm: 950 }, // diff = 50 = exactly 5%
    }));
    expect(issues.some((i) => i.field === 'areas.basis')).toBe(false);
  });

  it('warns just past the 5% manual-vs-bridge boundary', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual', existing_gia_sqm: 1000 },
      conversion_costs: { total_construction_sqm: 949 }, // diff = 51 > 5%
    }));
    expect(issues.some((i) => i.severity === 'warning' && i.field === 'areas.basis')).toBe(true);
  });

  it('does not warn the manual-vs-bridge rule when the bridge itself is zeroed', () => {
    // Every migrated pre-v6 fixture lands here: basis manual, bridge all zero.
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' },
      conversion_costs: { total_construction_sqm: 500 },
    }));
    expect(issues.some((i) => i.field === 'areas.basis')).toBe(false);
  });

  it('gates the negative-construction-area error on the manual basis, not the bridge-derived one', () => {
    // Binding correction to the brief: developed_area_sqm is DERIVED under the
    // bridge basis, so a negative value there must not be blamed on the manual
    // field the bridge-basis user cannot see — the three derived-negative
    // rules above already cover it (here: retained_commercial_gia_sqm, since
    // 500 existing − 400 retained − 200 untouched < 0).
    const bridgeNegative = validateInputs(makeV6Inputs({
      areas: {
        ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived',
        existing_gia_sqm: 500, retained_commercial_gia_sqm: 400, untouched_gia_sqm: 200,
      },
    }));
    expect(bridgeNegative.some((i) => i.field === 'conversion_costs.total_construction_sqm')).toBe(false);
    expect(bridgeNegative.some((i) => i.severity === 'error' && i.field === 'areas.retained_commercial_gia_sqm')).toBe(true);

    const manualNegative = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' },
      conversion_costs: { total_construction_sqm: -1 },
    }));
    expect(manualNegative.some((i) => i.severity === 'error'
      && i.field === 'conversion_costs.total_construction_sqm')).toBe(true);
  });

  it('still hard-errors a negative construction area on a pre-v6 document (no areas block at all)', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.conversion_costs.total_construction_sqm = -1;
    expect(validateInputs(inputs).some((i) => i.severity === 'error'
      && i.field === 'conversion_costs.total_construction_sqm')).toBe(true);
  });

  it('stays silent on a bridge that ties within policy', () => {
    const issues = validateInputs(makeV6Inputs({
      areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 500, circulation_common_sqm: 50 },
      units: [{ id: 'u1', floor_area_sqm: 450, estimated_value_pence: 1 }],
    }));
    expect(issues.filter((i) => i.field.startsWith('areas.'))).toEqual([]);
  });
});

describe('R9 — the ±25% warning is retired, not softened', () => {
  const RETIRED_25PCT = 'differ by more than 25%';

  it('is emitted by no input at all', () => {
    // R8 lesson: a positive `toContain` sails straight past an old sentence
    // being re-added ALONGSIDE the true one. Zero-counts on retired strings are
    // load-bearing. `memo-release-gate.test.ts` spent a release asserting the
    // memo CONTAINED a false statement.
    for (const inputs of [
      makeV6Inputs({
        areas: { ...DEFAULT_AREA_BRIDGE, basis: 'manual' },
        conversion_costs: { total_construction_sqm: 500 },
        units: [{ id: 'u1', floor_area_sqm: 252, estimated_value_pence: 1 }],
      }),
      makeV6Inputs({
        areas: { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived', existing_gia_sqm: 500 },
        units: [{ id: 'u1', floor_area_sqm: 252, estimated_value_pence: 1 }],
      }),
    ]) {
      expect(validateInputs(inputs).filter((i) => i.message.includes(RETIRED_25PCT))).toEqual([]);
    }
  });

  it('is absent from the source of both engines', () => {
    const ts = readFileSync(resolve(__dirname, './validation.ts'), 'utf-8');
    const py = readFileSync(resolve(__dirname, '../../../../app/financial_model/validation.py'), 'utf-8');
    expect(ts).not.toContain(RETIRED_25PCT);
    expect(py).not.toContain(RETIRED_25PCT);
  });
});

describe('R10 — cost plan validation', () => {
  function pkg(overrides: Partial<CostPackage> = {}): CostPackage {
    return {
      id: 'pkg-1', code: 'structure', label: 'Structure', amount_pence: 1_000_000,
      contingency_class: 'general', lender_eligible: true, notes: '',
      vat_override: null, ...overrides, phase_id: overrides.phase_id ?? null,
      price_basis: overrides.price_basis ?? null,
    };
  }

  function feeLine(overrides: Partial<FeeLine> = {}): FeeLine {
    return {
      id: 'fee-x', code: 'other', category: 'professional', label: 'X',
      basis: 'fixed', amount_pence: 1000, pct: 0, per_dwelling: false,
      vat_override: null, ...overrides, phase_id: overrides.phase_id ?? null,
    };
  }

  it('does not gain errors on a pre-v7 document (no cost_plan block)', () => {
    const issues = validateInputs(makeV6Inputs({}));
    expect(issues.filter((i) => i.field.startsWith('cost_plan.'))).toEqual([]);
  });

  it('hard-errors when headline mode carries packages', () => {
    const invalid = validateInputs(makeV7Inputs({ cost_plan: { mode: 'headline', packages: [pkg()] } }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.mode')).toBe(true);

    const valid = validateInputs(makeV7Inputs());
    expect(valid.some((i) => i.field === 'cost_plan.mode')).toBe(false);
  });

  it('hard-errors when detailed mode has no packages', () => {
    const invalid = validateInputs(makeV7Inputs({ cost_plan: { mode: 'detailed', packages: [] } }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.packages')).toBe(true);

    const valid = validateInputs(makeV7Inputs({ cost_plan: { mode: 'detailed', packages: [pkg()] } }));
    expect(valid.some((i) => i.field === 'cost_plan.packages')).toBe(false);
  });

  it('hard-errors when detailed mode packages sum to zero', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        mode: 'detailed',
        packages: [pkg({ amount_pence: 0 }), pkg({ id: 'pkg-2', amount_pence: 0 })],
      },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.packages')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg({ amount_pence: 1000 })] },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.packages')).toBe(false);
  });

  it('hard-errors on a negative package amount', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg({ amount_pence: -1 })] },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.packages[0].amount_pence')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg({ amount_pence: 1000 })] },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.packages[0].amount_pence')).toBe(false);
  });

  it('hard-errors on a negative contingency percentage', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'existing_building', pct: -5 },
          { name: 'abnormal', pct: 0 },
        ],
      },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.contingency[1].pct')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: {
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'existing_building', pct: 5 },
          { name: 'abnormal', pct: 0 },
        ],
      },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.contingency[1].pct')).toBe(false);
  });

  it('hard-errors on a negative fee line amount or percentage', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        fee_lines: [
          feeLine({ id: 'fee-a', basis: 'fixed', amount_pence: -1000, pct: 0 }),
          feeLine({ id: 'fee-b', basis: 'pct_of_base_build', amount_pence: 0, pct: -5 }),
        ],
      },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[0].amount_pence')).toBe(true);
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[1].pct')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: {
        fee_lines: [
          feeLine({ id: 'fee-a', basis: 'fixed', amount_pence: 1000, pct: 0 }),
          feeLine({ id: 'fee-b', basis: 'pct_of_base_build', amount_pence: 0, pct: 5 }),
        ],
      },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.fee_lines[0].amount_pence')).toBe(false);
    expect(valid.some((i) => i.field === 'cost_plan.fee_lines[1].pct')).toBe(false);
  });

  it('hard-errors on a duplicate package id', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        mode: 'detailed',
        packages: [pkg({ id: 'dup' }), pkg({ id: 'dup', amount_pence: 2000 })],
      },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.packages'
      && i.message.includes('unique'))).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: {
        mode: 'detailed',
        packages: [pkg({ id: 'a' }), pkg({ id: 'b', amount_pence: 2000 })],
      },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.packages' && i.message.includes('unique'))).toBe(false);
  });

  it('hard-errors on a duplicate fee-line id', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ id: 'dup' }), feeLine({ id: 'dup', label: 'Y' })] },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines'
      && i.message.includes('unique'))).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ id: 'a' }), feeLine({ id: 'b' })] },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.fee_lines' && i.message.includes('unique'))).toBe(false);
  });

  it('hard-errors when there are not exactly three contingency classes', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'existing_building', pct: 0 },
        ],
      },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.contingency')).toBe(true);

    const valid = validateInputs(makeV7Inputs());
    expect(valid.some((i) => i.field === 'cost_plan.contingency')).toBe(false);
  });

  it('hard-errors when a contingency class name repeats', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'general', pct: 0 },
          { name: 'abnormal', pct: 0 },
        ],
      },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.contingency')).toBe(true);

    const valid = validateInputs(makeV7Inputs());
    expect(valid.some((i) => i.field === 'cost_plan.contingency')).toBe(false);
  });

  it('hard-errors when detailed mode carries a non-zero flat fire-safety figure (spec §3.2.1)', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg()] },
      conversion_costs: { fire_safety_pence: 100 },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'conversion_costs.fire_safety_pence')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg()] },
      conversion_costs: { fire_safety_pence: 0 },
    }));
    expect(valid.some((i) => i.field === 'conversion_costs.fire_safety_pence')).toBe(false);
  });

  it('hard-errors when detailed mode carries a non-zero flat sound-insulation figure (spec §3.2.1)', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg()] },
      conversion_costs: { sound_insulation_pence: 100 },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'conversion_costs.sound_insulation_pence')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg()] },
      conversion_costs: { sound_insulation_pence: 0 },
    }));
    expect(valid.some((i) => i.field === 'conversion_costs.sound_insulation_pence')).toBe(false);
  });

  it('hard-errors when detailed mode carries a non-zero flat Part L compliance figure (spec §3.2.1)', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg()] },
      conversion_costs: { part_l_compliance_pence: 100 },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'conversion_costs.part_l_compliance_pence')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { mode: 'detailed', packages: [pkg()] },
      conversion_costs: { part_l_compliance_pence: 0 },
    }));
    expect(valid.some((i) => i.field === 'conversion_costs.part_l_compliance_pence')).toBe(false);
  });

  it('hard-errors when a fixed-basis fee line carries a non-zero percentage', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ basis: 'fixed', pct: 5 })] },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[0].pct')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ basis: 'fixed', pct: 0 })] },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.fee_lines[0].pct')).toBe(false);
  });

  it('hard-errors when a percentage-basis fee line carries a non-zero fixed amount', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ basis: 'pct_of_base_build', amount_pence: 500, pct: 5 })] },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[0].amount_pence')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ basis: 'pct_of_base_build', amount_pence: 0, pct: 5 })] },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.fee_lines[0].amount_pence')).toBe(false);
  });

  it('hard-errors when a percentage-basis fee line is marked per_dwelling', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        fee_lines: [feeLine({ basis: 'pct_of_base_build', amount_pence: 0, pct: 5, per_dwelling: true })],
      },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[0].per_dwelling')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: {
        fee_lines: [feeLine({ basis: 'pct_of_base_build', amount_pence: 0, pct: 5, per_dwelling: false })],
      },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.fee_lines[0].per_dwelling')).toBe(false);
  });

  it('hard-errors when a fee-line category contradicts its code (building_control is statutory)', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ code: 'building_control', category: 'professional' })] },
    }));
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[0].category')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ code: 'building_control', category: 'statutory' })] },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.fee_lines[0].category')).toBe(false);
  });

  it('warns when contingency exceeds 50% of the base build cost', () => {
    const invalid = validateInputs(makeV7Inputs({
      conversion_costs: { total_construction_sqm: 100 },
      cost_plan: {
        mode: 'headline',
        contingency: [
          { name: 'general', pct: 60 },
          { name: 'existing_building', pct: 0 },
          { name: 'abnormal', pct: 0 },
        ],
      },
    }));
    expect(invalid.some((i) => i.severity === 'warning' && i.field === 'cost_plan.contingency')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      conversion_costs: { total_construction_sqm: 100 },
      cost_plan: {
        mode: 'headline',
        contingency: [
          { name: 'general', pct: 10 },
          { name: 'existing_building', pct: 0 },
          { name: 'abnormal', pct: 0 },
        ],
      },
    }));
    expect(valid.some((i) => i.severity === 'warning' && i.field === 'cost_plan.contingency')).toBe(false);
  });

  it('warns (not errors) when a detailed-mode non-general contingency class has a '
    + 'non-zero percentage but no package carries its tag (R46)', () => {
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: {
        mode: 'detailed',
        packages: [pkg({ contingency_class: 'general' })],
        contingency: [
          { name: 'general', pct: 5 },
          { name: 'existing_building', pct: 0 },
          { name: 'abnormal', pct: 8 },
        ],
      },
    }));
    expect(invalid.some((i) => i.severity === 'warning' && i.field === 'cost_plan.contingency[2].pct')).toBe(true);
    // R46 is a deliberate warning, not a hard error -- see the ruling: an error
    // would repeat R38's defect by turning a migrated document's state into a
    // hard error that silently downgrades a report to DRAFT.
    expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.contingency[2].pct')).toBe(false);

    const valid = validateInputs(makeV7Inputs({
      cost_plan: {
        mode: 'detailed',
        packages: [pkg({ contingency_class: 'abnormal' })],
        contingency: [
          { name: 'general', pct: 5 },
          { name: 'existing_building', pct: 0 },
          { name: 'abnormal', pct: 8 },
        ],
      },
    }));
    expect(valid.some((i) => i.field === 'cost_plan.contingency[2].pct')).toBe(false);
  });

  it('does not warn on the R46 rule in headline mode, where all classes resolve against '
    + 'the whole base build', () => {
    const issues = validateInputs(makeV7Inputs({
      conversion_costs: { total_construction_sqm: 100 },
      cost_plan: {
        mode: 'headline',
        contingency: [
          { name: 'general', pct: 5 },
          { name: 'existing_building', pct: 0 },
          { name: 'abnormal', pct: 8 },
        ],
      },
    }));
    expect(issues.some((i) => i.field.startsWith('cost_plan.contingency[2]'))).toBe(false);
  });

  it('warns when a percentage-basis fee line resolves against a zero base', () => {
    // makeV7Inputs defaults total_construction_sqm to 0, so headline-mode base_build is 0.
    const invalid = validateInputs(makeV7Inputs({
      cost_plan: { fee_lines: [feeLine({ basis: 'pct_of_base_build', amount_pence: 0, pct: 5 })] },
    }));
    expect(invalid.some((i) => i.severity === 'warning' && i.field === 'cost_plan.fee_lines[0].basis')).toBe(true);

    const valid = validateInputs(makeV7Inputs({
      conversion_costs: { total_construction_sqm: 100 },
      cost_plan: { fee_lines: [feeLine({ basis: 'pct_of_base_build', amount_pence: 0, pct: 5 })] },
    }));
    expect(valid.some((i) => i.severity === 'warning' && i.field === 'cost_plan.fee_lines[0].basis')).toBe(false);
  });
});

describe('R11 — VAT validation (spec §17.9)', () => {
  function pkgWithOverride(override: VatOverride | null): CostPackage {
    return {
      id: 'pkg-1', code: 'structure', label: 'Structure', amount_pence: 1_000_000,
      contingency_class: 'general', lender_eligible: true, notes: '',
      vat_override: override, phase_id: null, price_basis: null,
    };
  }

  function feeLineWithOverride(override: VatOverride | null): FeeLine {
    return {
      id: 'fee-1', code: 'other', category: 'professional', label: 'X',
      basis: 'fixed', amount_pence: 1000, pct: 0, per_dwelling: false,
      vat_override: override, phase_id: null,
    };
  }

  it('does not gain a VAT issue on a pre-v8 document (no vat block)', () => {
    const issues = validateInputs(makeV7Inputs({}));
    expect(issues.filter((i) => i.field.startsWith('vat.') || i.field.includes('vat_override'))).toEqual([]);
  });

  it('produces no VAT issue on the all-defaults v8 document', () => {
    const issues = validateInputs(makeV8Inputs());
    expect(issues.filter((i) => i.field.startsWith('vat.') || i.field.includes('vat_override'))).toEqual([]);
  });

  describe('override in headline mode', () => {
    it('hard-errors on a package vat_override', () => {
      const invalid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'headline', packages: [pkgWithOverride(vatOverride())] },
      }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.packages[0].vat_override')).toBe(true);

      // Fix round 1 (minor 3): the near-miss of the actual precondition is
      // the SAME override present in DETAILED mode, not the override removed
      // entirely — that changes only the one field the rule actually gates on.
      const valid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride())] },
      }));
      expect(valid.some((i) => i.field === 'cost_plan.packages[0].vat_override')).toBe(false);
    });

    it('hard-errors on a fee-line vat_override', () => {
      const invalid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'headline', fee_lines: [feeLineWithOverride(vatOverride())] },
      }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[0].vat_override')).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', fee_lines: [feeLineWithOverride(vatOverride())] },
      }));
      expect(valid.some((i) => i.field === 'cost_plan.fee_lines[0].vat_override')).toBe(false);
    });
  });

  describe('rate_pct out of 0..100', () => {
    const idx = VAT_CHARGE_CATEGORIES.indexOf('construction');

    it('hard-errors when a treatment row rate_pct is negative', () => {
      const invalid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { rate_pct: -1 } }) },
      }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === `vat.treatments[${idx}].rate_pct`)).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { rate_pct: 20 } }) },
      }));
      expect(valid.some((i) => i.field === `vat.treatments[${idx}].rate_pct`)).toBe(false);
    });

    it('hard-errors when a treatment row rate_pct exceeds 100', () => {
      const invalid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { rate_pct: 101 } }) },
      }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === `vat.treatments[${idx}].rate_pct`)).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { rate_pct: 100 } }) },
      }));
      expect(valid.some((i) => i.field === `vat.treatments[${idx}].rate_pct`)).toBe(false);
    });

    it('hard-errors when a package vat_override rate_pct is negative', () => {
      const invalid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ rate_pct: -1 }))] },
      }));
      expect(invalid.some(
        (i) => i.severity === 'error' && i.field === 'cost_plan.packages[0].vat_override.rate_pct',
      )).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ rate_pct: 20 }))] },
      }));
      expect(valid.some((i) => i.field === 'cost_plan.packages[0].vat_override.rate_pct')).toBe(false);
    });

    it('hard-errors when a package vat_override rate_pct exceeds 100', () => {
      const invalid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ rate_pct: 101 }))] },
      }));
      expect(invalid.some(
        (i) => i.severity === 'error' && i.field === 'cost_plan.packages[0].vat_override.rate_pct',
      )).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ rate_pct: 100 }))] },
      }));
      expect(valid.some((i) => i.field === 'cost_plan.packages[0].vat_override.rate_pct')).toBe(false);
    });
  });

  describe('recoverable_pct out of 0..100', () => {
    const idx = VAT_CHARGE_CATEGORIES.indexOf('construction');

    it('hard-errors when a treatment row recoverable_pct is negative', () => {
      const invalid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { recoverable_pct: -1 } }) },
      }));
      expect(invalid.some(
        (i) => i.severity === 'error' && i.field === `vat.treatments[${idx}].recoverable_pct`,
      )).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { recoverable_pct: 50 } }) },
      }));
      expect(valid.some((i) => i.field === `vat.treatments[${idx}].recoverable_pct`)).toBe(false);
    });

    it('hard-errors when a treatment row recoverable_pct exceeds 100', () => {
      const invalid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { recoverable_pct: 101 } }) },
      }));
      expect(invalid.some(
        (i) => i.severity === 'error' && i.field === `vat.treatments[${idx}].recoverable_pct`,
      )).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        vat: { treatments: vatTreatments({ construction: { recoverable_pct: 100 } }) },
      }));
      expect(valid.some((i) => i.field === `vat.treatments[${idx}].recoverable_pct`)).toBe(false);
    });

    it('hard-errors when a package vat_override recoverable_pct is negative', () => {
      const invalid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ recoverable_pct: -1 }))] },
      }));
      expect(invalid.some(
        (i) => i.severity === 'error' && i.field === 'cost_plan.packages[0].vat_override.recoverable_pct',
      )).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ recoverable_pct: 50 }))] },
      }));
      expect(valid.some((i) => i.field === 'cost_plan.packages[0].vat_override.recoverable_pct')).toBe(false);
    });

    it('hard-errors when a package vat_override recoverable_pct exceeds 100', () => {
      const invalid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ recoverable_pct: 101 }))] },
      }));
      expect(invalid.some(
        (i) => i.severity === 'error' && i.field === 'cost_plan.packages[0].vat_override.recoverable_pct',
      )).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'detailed', packages: [pkgWithOverride(vatOverride({ recoverable_pct: 100 }))] },
      }));
      expect(valid.some((i) => i.field === 'cost_plan.packages[0].vat_override.recoverable_pct')).toBe(false);
    });
  });

  describe('treatments array shape', () => {
    it('hard-errors when a category is missing', () => {
      const missing = defaultVatTreatments().filter((t) => t.category !== 'lender_ancillary');
      const invalid = validateInputs(makeV8Inputs({ vat: { treatments: missing } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.treatments')).toBe(true);

      const valid = validateInputs(makeV8Inputs());
      expect(valid.some((i) => i.field === 'vat.treatments')).toBe(false);
    });

    it('hard-errors when a category is duplicated (and another therefore missing)', () => {
      const duplicated = defaultVatTreatments().map(
        (t, i) => (i === 5 ? { ...t, category: 'acquisition' as const } : t),
      );
      const invalid = validateInputs(makeV8Inputs({ vat: { treatments: duplicated } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.treatments')).toBe(true);

      const valid = validateInputs(makeV8Inputs());
      expect(valid.some((i) => i.field === 'vat.treatments')).toBe(false);
    });

    it('hard-errors when the six categories are present but out of the declared order', () => {
      const wrongOrder = [...defaultVatTreatments()].reverse();
      const invalid = validateInputs(makeV8Inputs({ vat: { treatments: wrongOrder } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.treatments')).toBe(true);

      const valid = validateInputs(makeV8Inputs());
      expect(valid.some((i) => i.field === 'vat.treatments')).toBe(false);
    });
  });

  // --- The two RETURN-CYCLE bounds (ruling R38, spec §17.11).
  //
  // These cases were originally written on `makeV8Inputs()` unmodified, i.e. on
  // `registered: false` documents. That was asserting the wrong thing: a rule
  // about a LIVE return cycle has to be tested on a document whose cycle is
  // live. Written that way they also pinned the defect R38 exists to fix — the
  // migration writes `first_period_end_month: 2` onto EVERY document, so an
  // ungated rule made every stored appraisal with `term_months <= 2` a hard
  // error, and a hard error marks the report DRAFT.
  describe('first_period_end_month out of range', () => {
    it('hard-errors when negative', () => {
      const invalid = validateInputs(makeV8Inputs({ vat: { registered: true, first_period_end_month: -1 } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.first_period_end_month')).toBe(true);

      const valid = validateInputs(makeV8Inputs({ vat: { registered: true, first_period_end_month: 0 } }));
      expect(valid.some((i) => i.field === 'vat.first_period_end_month')).toBe(false);
    });

    it('hard-errors when >= term_months', () => {
      const invalid = validateInputs(makeV8Inputs({
        finance: { term_months: 3 }, vat: { registered: true, first_period_end_month: 3 },
      }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.first_period_end_month')).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        finance: { term_months: 3 }, vat: { registered: true, first_period_end_month: 2 },
      }));
      expect(valid.some((i) => i.field === 'vat.first_period_end_month')).toBe(false);
    });

    // R38. The migration's own write — `first_period_end_month: 2` on a 1-month
    // term — must produce NO issue while `registered` is false. Ungated this was
    // a hard error, which makes `report_safe` false and marks the report DRAFT:
    // an "inert" migration would have silently downgraded every short-term
    // appraisal in the database.
    it('is not validated at all while the engine is dormant, and is the moment it registers', () => {
      const dormant = makeV8Inputs({ finance: { term_months: 1 } });
      expect(dormant.vat.registered).toBe(false);
      expect(dormant.vat.first_period_end_month).toBe(2);
      expect(validateInputs(dormant).some((i) => i.field === 'vat.first_period_end_month')).toBe(false);

      // The gate DEFERS the rule, it does not delete it.
      const live = makeV8Inputs({ finance: { term_months: 1 }, vat: { registered: true } });
      expect(validateInputs(live).some(
        (i) => i.severity === 'error' && i.field === 'vat.first_period_end_month',
      )).toBe(true);
    });
  });

  describe('repayment_lag_months out of range', () => {
    it('hard-errors when negative', () => {
      const invalid = validateInputs(makeV8Inputs({ vat: { registered: true, repayment_lag_months: -1 } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.repayment_lag_months')).toBe(true);

      const valid = validateInputs(makeV8Inputs({ vat: { registered: true, repayment_lag_months: 0 } }));
      expect(valid.some((i) => i.field === 'vat.repayment_lag_months')).toBe(false);
    });

    // R38's second gated field. Tested with a value that is nonsense in any
    // state (7 > the 6-month cap) so this cannot pass merely because the
    // default happens to be in range.
    it('is not validated at all while the engine is dormant, and is the moment it registers', () => {
      const dormant = makeV8Inputs({ vat: { repayment_lag_months: 7 } });
      expect(dormant.vat.registered).toBe(false);
      expect(validateInputs(dormant).some((i) => i.field === 'vat.repayment_lag_months')).toBe(false);

      const live = makeV8Inputs({ vat: { registered: true, repayment_lag_months: 7 } });
      expect(validateInputs(live).some(
        (i) => i.severity === 'error' && i.field === 'vat.repayment_lag_months',
      )).toBe(true);
    });

    it('hard-errors when greater than 6', () => {
      const invalid = validateInputs(makeV8Inputs({ vat: { registered: true, repayment_lag_months: 7 } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.repayment_lag_months')).toBe(true);

      // `registered: true` on the valid half too — under the R38 gate an
      // unregistered document passes this rule VACUOUSLY, which would make the
      // in-range assertion prove nothing about the bound.
      const valid = validateInputs(makeV8Inputs({ vat: { registered: true, repayment_lag_months: 6 } }));
      expect(valid.some((i) => i.field === 'vat.repayment_lag_months')).toBe(false);
    });
  });

  it("hard-errors when togc_treatment is 'applies' with a non-zero acquisition rate", () => {
    const acqIdx = VAT_CHARGE_CATEGORIES.indexOf('acquisition');
    const invalid = validateInputs(makeV8Inputs({
      vat: {
        treatments: vatTreatments({ acquisition: { rate_pct: 20 } }),
        purchase: { togc_treatment: 'applies', vendor_opted_to_tax: true },
      },
    }));
    expect(invalid.some(
      (i) => i.severity === 'error' && i.field === `vat.treatments[${acqIdx}].rate_pct`,
    )).toBe(true);

    const valid = validateInputs(makeV8Inputs({
      vat: {
        treatments: vatTreatments({ acquisition: { rate_pct: 0 } }),
        purchase: { togc_treatment: 'applies', vendor_opted_to_tax: true },
      },
    }));
    expect(valid.some((i) => i.field === `vat.treatments[${acqIdx}].rate_pct`)).toBe(false);
  });
});

describe('R11 — VAT warnings (spec §17.9)', () => {
  /** Every case here must appear on `validateInputs`/`run.validation` and NOT
   *  on `reconcile().issues`, which carries only errors bar one `'model'`
   *  warning (see the module comment at the top of validation.ts). */
  function assertWarningChannel(inputs: CalculatorInputsV8, field: string) {
    const issues = validateInputs(inputs);
    expect(issues.some((i) => i.severity === 'warning' && i.field === field)).toBe(true);

    const schedule = buildSchedule(inputs);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const recIssues = reconcile(inputs, schedule, model).issues;
    expect(recIssues.some((i) => i.field === field)).toBe(false);
  }

  // Local, minimal duplicates of the hard-error describe's helpers above —
  // that describe scopes them to its own callback, and this is a separate
  // top-level describe (same convention the R10 cost-plan block already uses
  // for its own `pkg()`/`feeLine()`).
  function pkgWithOverride(override: VatOverride | null): CostPackage {
    return {
      id: 'pkg-1', code: 'structure', label: 'Structure', amount_pence: 1_000_000,
      contingency_class: 'general', lender_eligible: true, notes: '',
      vat_override: override, phase_id: null, price_basis: null,
    };
  }

  function feeLineWithOverride(override: VatOverride | null): FeeLine {
    return {
      id: 'fee-1', code: 'other', category: 'professional', label: 'X',
      basis: 'fixed', amount_pence: 1000, pct: 0, per_dwelling: false,
      vat_override: override, phase_id: null,
    };
  }

  describe("recovery_basis 'zero_rated_sale' while exit_strategy retains a unit", () => {
    const idx = VAT_CHARGE_CATEGORIES.indexOf('selling');

    it('warns on a retain_all exit', () => {
      const inputs = makeV8Inputs({
        vat: {
          registered: true,
          treatments: vatTreatments({
            selling: { rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' },
          }),
        },
        exit_strategy: { route: 'retain_all' },
      });
      assertWarningChannel(inputs, `vat.treatments[${idx}].recovery_basis`);
    });

    it('warns on a blended exit with one retained unit', () => {
      const inputs = makeV8Inputs({
        vat: {
          registered: true,
          treatments: vatTreatments({
            selling: { rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' },
          }),
        },
        exit_strategy: { route: 'blended', retained_units: [{ unit_id: 'u1', monthly_rent_pence: 1000 }] },
      });
      assertWarningChannel(inputs, `vat.treatments[${idx}].recovery_basis`);
    });

    it('does not warn on a sell_all exit — no unit is retained', () => {
      const inputs = makeV8Inputs({
        vat: {
          registered: true,
          treatments: vatTreatments({
            selling: { rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' },
          }),
        },
        exit_strategy: { route: 'sell_all' },
      });
      expect(validateInputs(inputs).some(
        (i) => i.field === `vat.treatments[${idx}].recovery_basis`,
      )).toBe(false);
    });

    // Fix round 1 (Ruling R35). A VatOverride carries its OWN recovery_basis —
    // exactly the same unsafe assumption is expressible on a package or fee
    // line, and a scan of vat.treatments alone never sees it. Two more cases,
    // making this rule's total four, not two.
    it('warns on a package override recovered as zero_rated_sale', () => {
      const inputs = makeV8Inputs({
        vat: { registered: true },
        cost_plan: {
          mode: 'detailed',
          packages: [pkgWithOverride(vatOverride({
            rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale',
          }))],
        },
        exit_strategy: { route: 'retain_all' },
      });
      assertWarningChannel(inputs, 'cost_plan.packages[0].vat_override.recovery_basis');
    });

    it('warns on a fee-line override recovered as zero_rated_sale', () => {
      const inputs = makeV8Inputs({
        vat: { registered: true },
        cost_plan: {
          mode: 'detailed',
          fee_lines: [feeLineWithOverride(vatOverride({
            rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale',
          }))],
        },
        exit_strategy: { route: 'retain_all' },
      });
      assertWarningChannel(inputs, 'cost_plan.fee_lines[0].vat_override.recovery_basis');
    });

    it('does not warn on a package override recovered as zero_rated_sale when no unit is retained', () => {
      const inputs = makeV8Inputs({
        vat: { registered: true },
        cost_plan: {
          mode: 'detailed',
          packages: [pkgWithOverride(vatOverride({
            rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale',
          }))],
        },
        exit_strategy: { route: 'sell_all' },
      });
      expect(validateInputs(inputs).some(
        (i) => i.field === 'cost_plan.packages[0].vat_override.recovery_basis',
      )).toBe(false);
    });
  });

  it("warns when togc_treatment is 'applies' but the vendor has not opted to tax", () => {
    const inputs = makeV8Inputs({
      vat: { purchase: { togc_treatment: 'applies', vendor_opted_to_tax: false } },
    });
    assertWarningChannel(inputs, 'vat.purchase.togc_treatment');

    const valid = makeV8Inputs({
      vat: { purchase: { togc_treatment: 'does_not_apply', vendor_opted_to_tax: false } },
    });
    expect(validateInputs(valid).some(
      (i) => i.field === 'vat.purchase.togc_treatment' && i.severity === 'warning',
    )).toBe(false);
  });

  it('warns when registered is false but construction cost is non-zero', () => {
    const inputs = makeV8Inputs({
      conversion_costs: { construction_cost_per_sqm_pence: 100_000, total_construction_sqm: 100 },
    });
    assertWarningChannel(inputs, 'vat.registered');

    const valid = makeV8Inputs();
    expect(validateInputs(valid).some(
      (i) => i.field === 'vat.registered' && i.severity === 'warning',
    )).toBe(false);
  });

  it('warns when the final VAT return period reclaim falls outside the modelled term', () => {
    // Ruling R4: derived from vatReturnPeriods(vat, term_months), gated on a
    // non-zero resolved rate — never from the result field
    // vat.receivable_at_maturity_pence, which validateInputs cannot see.
    const inputs = makeV8Inputs({
      finance: { term_months: 3 },
      vat: { registered: true, treatments: vatTreatments({ construction: { rate_pct: 20 } }) },
    });
    assertWarningChannel(inputs, 'vat.repayment_lag_months');
  });

  it('does not warn where the resolved rate is zero, even though the final period is structurally out of term', () => {
    // Same term/lag/frequency as the case above -- the final period's reclaim
    // is still null -- but every treatment rate is 0 (the default), so there is
    // nothing to reclaim and the gate must hold.
    const inputs = makeV8Inputs({
      finance: { term_months: 3 },
      vat: { registered: true },
    });
    expect(validateInputs(inputs).some(
      (i) => i.field === 'vat.repayment_lag_months' && i.severity === 'warning',
    )).toBe(false);
  });
});

// --- R12 §18.8 — v9 programme network validation ---------------------------

/** A fresh v9 document from the migration chain's own defaults — `programme`,
 *  `sales_phasing` and `refinance` all null, exactly like a brand-new
 *  document, so it carries no error of its own before a test adds a network. */
function v9Document(): CalculatorInputsV9 {
  return migrateInputsToV9({});
}

/** A fresh v8 document, for the migration-identity control below. */
function v8Document(): CalculatorInputsV8 {
  return migrateInputsToV8({});
}

/** Mirrors programme.test.ts's own `phase()` helper exactly — a phase with no
 *  overrides is predecessor-free, at `start_offset` 0, with no slip. */
function phase(
  id: string, code: string, duration: number,
  preds: Phase['predecessors'] = [], extra: Partial<Phase> = {},
): Phase {
  return {
    id, code: code as Phase['code'], label: id,
    duration_months: duration, slip_months: 0, start_offset: 0,
    curve: { kind: 'straight_line' }, predecessors: preds, ...extra,
  };
}

/** A v9 document carrying the given phases as its programme network.
 *  `category_phase_ids` defaults every category onto `phases[0]` — the tests
 *  below that care about `category_phase_ids` override it explicitly. */
function docWith(
  phases: Phase[], term = 24, extra: Partial<ProgrammeNetwork> = {},
): CalculatorInputsV9 {
  return {
    ...v9Document(),
    finance: { ...v9Document().finance, term_months: term },
    programme: {
      anchor_month: null,
      phases,
      category_phase_ids: {
        construction: phases[0]?.id ?? 'x', professional: phases[0]?.id ?? 'x', statutory: phases[0]?.id ?? 'x',
      },
      ...extra,
    },
  };
}

/** A minimal, structurally-valid detailed cost plan — one package, no fee
 *  lines — for the tests that tag a cost line onto a phase. */
function detailedCostPlan(): CostPlanInputs {
  return {
    mode: 'detailed',
    packages: [{
      id: 'pkg-1', code: 'structure', label: 'Structure', amount_pence: 1_000_000,
      contingency_class: 'general', lender_eligible: true, notes: '',
      vat_override: null, phase_id: null, price_basis: null,
    }],
    contingency: [
      { name: 'general', pct: 5 }, { name: 'existing_building', pct: 0 }, { name: 'abnormal', pct: 0 },
    ],
    fee_lines: [],
    qs: null,
  };
}

const errs = (d: unknown) => validateInputs(d as never).filter((i) => i.severity === 'error');

describe('programme network validation — spec §18.8', () => {
  it('rejects a duplicate phase id', () => {
    const e = errs(docWith([phase('a', 'planning', 2), phase('a', 'design', 2)]));
    expect(e.some((i) => i.field === 'programme.phases.a' && /Duplicate phase id/.test(i.message))).toBe(true);
  });

  it('rejects a dependency naming an absent phase', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [{ phase_id: 'ghost', type: 'FS', lag_months: 0 }])]));
    expect(e.some((i) => /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects a self-reference', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }])]));
    expect(e.some((i) => /cannot depend on itself/.test(i.message))).toBe(true);
  });

  it('names the cycle in order', () => {
    const e = errs(docWith([
      phase('a', 'planning', 2, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
      phase('b', 'conditions', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
    ]));
    expect(e.some((i) => i.field === 'programme.phases' && /→/.test(i.message))).toBe(true);
  });

  // Task 16 falsifiability audit. Single-line change that kills this guard —
  // the exact "over-eager detector" the guard's own comment names:
  // validation.ts's `if ('cycle' in derivation) {` -> `if (true) {`, which
  // makes every network (cyclic or not) take the cycle-error branch.
  // Verified: the acyclic twin now throws inside validateInputs (its
  // `derivation.cycle` is undefined, so `.join('→')` crashes) rather than
  // passing clean — reverted after confirming the guard, and the rest of
  // this file, pass again clean.
  it('GUARD 3: a cyclic document errors; its acyclic twin, differing by ONE dependency, does not', () => {
    // The twin must CARRY a dependency, not merely lack the cycle -- otherwise
    // an over-eager detector that rejected every predecessor edge still
    // passes. Every other clean-document assertion in this suite uses a
    // dependency-free network, so without this pairing nothing distinguishes
    // "no cycle" from "no dependencies at all".
    const cyclic = docWith([
      phase('a', 'planning', 2, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
      phase('b', 'conditions', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
    ]);
    const acyclic = docWith([
      phase('a', 'planning', 2, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
      phase('b', 'conditions', 2),
    ]);
    expect(errs(cyclic).some((i) => i.field === 'programme.phases' && /→/.test(i.message))).toBe(true);
    expect(errs(acyclic)).toEqual([]);
  });

  it('rejects a negative duration, lag or start_offset but ALLOWS a negative slip', () => {
    // Fix round 1, Finding 6: field + message fragment, not a bare length
    // check that any unrelated error would also satisfy.
    expect(errs(docWith([phase('a', 'planning', -1)]))
      .some((i) => i.field === 'programme.phases.a' && /duration_months cannot be negative/.test(i.message))).toBe(true);
    expect(errs(docWith([phase('a', 'planning', 2, [], { start_offset: -1 })]))
      .some((i) => i.field === 'programme.phases.a' && /start_offset cannot be negative/.test(i.message))).toBe(true);
    expect(errs(docWith([phase('a', 'planning', 2, [{ phase_id: 'a2', type: 'FS', lag_months: -1 }]),
      phase('a2', 'design', 1)]))
      .some((i) => i.field === 'programme.phases.a' && /lag_months cannot be negative/.test(i.message))).toBe(true);
    // signed slip is legal (§18.2) as long as the resolved start stays >= 0
    expect(errs(docWith([phase('a', 'planning', 2, [], { start_offset: 3, slip_months: -1 })]))).toEqual([]);
  });

  it('rejects a fractional slip', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [], { slip_months: 1.5 })]));
    expect(e.some((i) => /whole number of months/.test(i.message))).toBe(true);
  });

  it('rejects over-acceleration below month 0 rather than clamping it', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [], { start_offset: 1, slip_months: -3 })]));
    expect(e.some((i) => i.field === 'programme.phases.a' && /before month 0/.test(i.message))).toBe(true);
  });

  it('rejects category_phase_ids pointing at an absent phase or a milestone', () => {
    const ms = [phase('a', 'construction', 4), phase('pc', 'practical_completion', 0)];
    expect(errs(docWith(ms, 24, { category_phase_ids: { construction: 'ghost', professional: 'a', statutory: 'a' } }))
      .some((i) => i.field === 'programme.category_phase_ids.construction')).toBe(true);
    expect(errs(docWith(ms, 24, { category_phase_ids: { construction: 'pc', professional: 'a', statutory: 'a' } }))
      .some((i) => /milestone/.test(i.message))).toBe(true);
  });

  it('rejects a cost line tagged to a milestone or an absent phase', () => {
    const d = docWith([phase('a', 'construction', 4), phase('pc', 'practical_completion', 0)]);
    d.cost_plan = { ...detailedCostPlan(), packages: [{ ...detailedCostPlan().packages[0], phase_id: 'pc' }] };
    expect(errs(d).some((i) => /milestone/.test(i.message))).toBe(true);
  });

  it('fix round 1, Finding 5: the ABSENT-phase arm of the cost package rule, not only the milestone arm', () => {
    const d = docWith([phase('a', 'construction', 4)]);
    d.cost_plan = { ...detailedCostPlan(), packages: [{ ...detailedCostPlan().packages[0], phase_id: 'ghost' }] };
    expect(errs(d).some((i) => i.field === 'cost_plan.packages[0].phase_id'
      && /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('fix round 1, Finding 5: the fee_lines[].phase_id arm (milestone AND absent phase)', () => {
    const fee = (overrides: Partial<FeeLine> = {}): FeeLine => ({
      id: 'fee-x', code: 'other', category: 'professional', label: 'X',
      basis: 'fixed', amount_pence: 1000, pct: 0, per_dwelling: false,
      vat_override: null, phase_id: null, ...overrides,
    });
    const milestoneDoc = docWith([phase('a', 'construction', 4), phase('pc', 'practical_completion', 0)]);
    milestoneDoc.cost_plan = { ...detailedCostPlan(), fee_lines: [fee({ phase_id: 'pc' })] };
    expect(errs(milestoneDoc).some((i) => i.field === 'cost_plan.fee_lines[0].phase_id'
      && /milestone/.test(i.message))).toBe(true);

    const absentDoc = docWith([phase('a', 'construction', 4)]);
    absentDoc.cost_plan = { ...detailedCostPlan(), fee_lines: [fee({ phase_id: 'ghost' })] };
    expect(errs(absentDoc).some((i) => i.field === 'cost_plan.fee_lines[0].phase_id'
      && /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('fix round 1, Finding 5: rejects a refinance anchor naming an absent phase', () => {
    const d = docWith([phase('a', 'planning', 2)]);
    d.exit_strategy = { ...d.exit_strategy, route: 'retain_all' };
    d.refinance = {
      month_offset: 0, investment_value_pence: 0, ltv_pct: 50,
      arrangement_fee_pence: 0, legal_costs_pence: 0,
      anchor: { phase_id: 'ghost', offset_months: 0 },
    };
    expect(errs(d).some((i) => i.field === 'refinance.anchor'
      && /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects an empty phases array', () => {
    expect(errs(docWith([])).some((i) => i.field === 'programme.phases')).toBe(true);
  });

  // Task 10's carried gap (Task 16): the four §6.1 user_defined rules are
  // evaluated per phase (validation.ts:759-765) but had NO v9 network test in
  // either engine — only the v4 `programme.packages` arm above was covered.
  // The mirror was faithful (Python's gap is identical, closed alongside this
  // one), so the gap was real on both sides, not merely under-ported. Field +
  // exact message, not a bare length check any unrelated error would also
  // satisfy.
  const withWeights = (weights: number[]) =>
    docWith([phase('a', 'planning', 4, [], { curve: { kind: 'user_defined', weights } })]);

  it('rejects user_defined weights whose length != duration', () => {
    expect(errs(withWeights([1, 1])) // duration is 4, only 2 weights supplied
      .some((i) => i.field === 'programme.phases.a'
        && i.message === 'user_defined weights must have one entry per window month.')).toBe(true);
  });

  it('rejects non-finite user_defined weights', () => {
    expect(errs(withWeights([1, NaN, 1, 1]))
      .some((i) => i.field === 'programme.phases.a'
        && i.message === 'user_defined weights must be finite numbers.')).toBe(true);
  });

  it('rejects a negative user_defined weight', () => {
    expect(errs(withWeights([1, -1, 1, 1]))
      .some((i) => i.field === 'programme.phases.a'
        && i.message === 'user_defined weights cannot be negative.')).toBe(true);
  });

  it('rejects user_defined weights that sum to <= 0', () => {
    expect(errs(withWeights([0, 0, 0, 0]))
      .some((i) => i.field === 'programme.phases.a'
        && i.message === 'user_defined weights must sum to more than zero.')).toBe(true);
  });

  it('§18.8 OVERRUN: names the phase and the overrun in months', () => {
    const e = errs(docWith([
      phase('c', 'construction', 9),
      phase('m', 'marketing', 15, [{ phase_id: 'c', type: 'FS', lag_months: 0 }]),
    ], 18));
    const overrun = e.find((i) => /after maturity/.test(i.message));
    expect(overrun).toBeDefined();
    expect(overrun!.message).toContain("Phase 'm'");
    expect(overrun!.message).toContain('6 months'); // finish 24 vs term 18
  });

  it('fix round 1, Finding 1: TWO breaching phases each get their OWN overrun figure', () => {
    // Two independent (non-chained) phases, both past term=18: 'a' finishes
    // 20 (own overrun 2), 'b' finishes 30 (own overrun 12, and 'b' is the
    // phase that sets the programme's global finish). Splicing the GLOBAL
    // overrun into every breaching phase's sentence would give 'a' the same
    // "12 months" as 'b' -- wrong, since 'a' itself is only 2 months late.
    const e = errs(docWith([
      phase('a', 'construction', 20, [], { start_offset: 0 }),
      phase('b', 'marketing', 30, [], { start_offset: 0 }),
    ], 18));
    const aOverrun = e.find((i) => i.field === 'programme.phases.a' && /after maturity/.test(i.message));
    const bOverrun = e.find((i) => i.field === 'programme.phases.b' && /after maturity/.test(i.message));
    expect(aOverrun).toBeDefined();
    expect(bOverrun).toBeDefined();
    expect(aOverrun!.message).toContain('Programme finishes month 30');
    expect(aOverrun!.message).toContain("Phase 'a' ends 2 months after maturity");
    expect(bOverrun!.message).toContain('Programme finishes month 30');
    expect(bOverrun!.message).toContain("Phase 'b' ends 12 months after maturity");
  });

  it('fix round 1, Finding 3: OVERRUN milestone arm — legal at start = term-1, breaches one month later', () => {
    const legal = docWith([
      phase('base', 'construction', 1),
      phase('a', 'unit_completions', 0, [], { start_offset: 23 }),
    ], 24);
    expect(errs(legal).some((i) => /after maturity/.test(i.message))).toBe(false);

    const breach = docWith([
      phase('base', 'construction', 1),
      phase('a', 'unit_completions', 0, [], { start_offset: 24 }),
    ], 24);
    expect(errs(breach).some((i) => i.field === 'programme.phases.a' && /after maturity/.test(i.message))).toBe(true);
  });

  it('fix round 1, Finding 3: TAIL milestone arm — legal at start = term-2, breaches one month later', () => {
    const legal = docWith([
      phase('base', 'construction', 1),
      phase('pc', 'practical_completion', 0, [], { start_offset: 22 }),
    ], 24);
    expect(errs(legal).some((i) => /sale tail/.test(i.message))).toBe(false);

    const breach = docWith([
      phase('base', 'construction', 1),
      phase('pc', 'practical_completion', 0, [], { start_offset: 23 }),
    ], 24);
    expect(errs(breach).some((i) => i.field === 'programme.phases.pc' && /sale tail/.test(i.message))).toBe(true);
  });

  it('§18.8 TAIL: binds pre-completion codes and NOT marketing', () => {
    // construction (finish 24) breaches the tail — the boundary is finish <=
    // term - 1 = 23, so finish 23 (duration 23) is exactly LEGAL; duration 24
    // is the first illegal window, confirmed against the identical formula
    // the migration-identity test below exercises via the legacy rule.
    expect(errs(docWith([phase('c', 'construction', 24)], 24))
      .some((i) => /sale tail/.test(i.message))).toBe(true);
    // ...but marketing finishing there does not
    expect(errs(docWith([phase('m', 'marketing', 23)], 24))
      .some((i) => /sale tail/.test(i.message))).toBe(false);
  });

  it('§18.8 TAIL: `other` gets the weaker overrun rule, not the tail rule', () => {
    expect(errs(docWith([phase('o', 'other', 23)], 24))
      .some((i) => /sale tail/.test(i.message))).toBe(false);
    // Fix round 1, Finding 4: pin what "weaker" MEANS -- 'other' is exempt
    // from the tail rule but not from the overrun rule, which still fires.
    const e = errs(docWith([phase('o', 'other', 25)], 24));
    expect(e.some((i) => i.field === 'programme.phases.o' && /after maturity/.test(i.message))).toBe(true);
  });

  it('a migrated three-phase network produces the SAME tail issue as its v8 twin', () => {
    // This is the property Task 8's alias map depends on. Asserted here too,
    // at the rule, so a scope change to PRE_COMPLETION_CODES fails twice.
    const v8 = {
      ...v8Document(),
      finance: { ...v8Document().finance, term_months: 6 },
      programme: {
        anchor_month: null,
        packages: {
          construction: { start_offset: 0, duration_months: 6, curve: { kind: 'straight_line' as const } },
          professional: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' as const } },
          statutory: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' as const } },
        },
      },
    };
    const beforeFields = validateInputs(v8 as never).map((i) => i.field).sort();
    const afterFields = validateInputs(migrateV8toV9(v8 as never)).map((i) => i.field).sort();
    expect(afterFields).toEqual(beforeFields.map((f) => PROGRAMME_FIELD_ALIASES[f] ?? f).sort());
  });
});

describe('anchors and scenario slip — §18.6/§18.8/§18.9', () => {
  /** Three independent (non-chained) phases so that slipping one does not
   *  cascade a start onto the others through a dependency — the crossing
   *  test below needs a genuine crossing, not one the derivation would have
   *  propagated for it. */
  function networkDoc(term = 24): CalculatorInputsV9 {
    return docWith([
      phase('planning', 'planning', 3),
      phase('unit_completions', 'unit_completions', 0, [], { start_offset: 10 }),
      phase('sales', 'sales', 5, [], { start_offset: 11 }),
    ], term);
  }

  function docWithTranche(tr: { anchor: { phase_id: string; offset_months: number } | null; month_offset: number; pct_of_gross_receipts?: number }): CalculatorInputsV9 {
    const d = networkDoc();
    return { ...d, sales_phasing: { tranches: [{ pct_of_gross_receipts: 100, ...tr }] } };
  }

  function docWithTranches(trs: Array<{ anchor: { phase_id: string; offset_months: number } | null; month_offset: number; pct_of_gross_receipts: number }>): CalculatorInputsV9 {
    const d = networkDoc();
    return { ...d, sales_phasing: { tranches: trs } };
  }

  function withSlip(d: CalculatorInputsV9, phaseId: string, months: number): CalculatorInputsV9 {
    return {
      ...d,
      programme: {
        ...d.programme!,
        phases: d.programme!.phases.map((p) => (
          p.id === phaseId ? { ...p, slip_months: p.slip_months + months } : p
        )),
      },
    };
  }

  it('rejects an anchor naming an absent phase', () => {
    const d = docWithTranche({ anchor: { phase_id: 'ghost', offset_months: 0 }, month_offset: 0 });
    expect(errs(d).some((i) => i.field === 'sales_phasing.tranches[0].anchor'
      && /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects RESOLVED tranche months that are not strictly increasing', () => {
    // Two tranches anchored to DIFFERENT phases can cross when one slips. The
    // rule reads the resolved months, not the entered ones — a document whose
    // entered offsets ascend can still resolve out of order.
    const d = docWithTranches([
      { anchor: { phase_id: 'unit_completions', offset_months: 0 }, month_offset: 0, pct_of_gross_receipts: 40 },
      { anchor: { phase_id: 'sales', offset_months: 0 }, month_offset: 0, pct_of_gross_receipts: 60 },
    ]);
    const crossed = withSlip(d, 'unit_completions', 9); // pushes tranche 0 past tranche 1
    expect(errs(crossed).some((i) => i.field === 'sales_phasing.tranches[1]'
      && /strictly increasing/.test(i.message))).toBe(true);
    // Negative control: unslipped, the same document is clean.
    expect(errs(d)).toEqual([]);
  });

  it('rejects a scenario phase_slip_phase_id naming an absent phase', () => {
    const d = { ...networkDoc() };
    d.scenarios.downside = { ...d.scenarios.downside, phase_slip_phase_id: 'ghost', phase_slip_months: 3 };
    expect(errs(d).some((i) => i.field === 'scenarios.downside.phase_slip_phase_id'
      && /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects a scenario phase_slip_phase_id set while programme is null', () => {
    // A slip with nothing to slip must not be a silent no-op — that is what
    // would make the lever look live while doing nothing (§18.9).
    const d = { ...v9Document(), programme: null };
    d.scenarios.downside = { ...d.scenarios.downside, phase_slip_phase_id: 'planning', phase_slip_months: 3 };
    expect(errs(d).some((i) => i.field === 'scenarios.downside.phase_slip_phase_id'
      && /has no programme network/.test(i.message))).toBe(true);
  });
});

describe('§19.7 investment case validation', () => {
  // `icDoc` builds a valid v11 retain-all document with an investment case
  // (R14 Task 14 moved investment-case-docs.ts's builders on from v10); each
  // test breaks exactly ONE thing, so a rule that fires for the wrong reason
  // is visible.
  const errFields = (d: CalculatorInputsV11) =>
    validateInputs(d).filter((i) => i.severity === 'error').map((i) => i.field);

  it('rule 1: rejects an investment case on a sell_all route', () => {
    expect(errFields(icDoc({ route: 'sell_all' }))).toContain('investment_case');
    expect(errFields(icDoc({}))).not.toContain('investment_case');
  });

  it('rule 2: rejects retain_all with a rent row missing for any unit', () => {
    // The silent-understatement trap: every unit is retained, but only listed
    // units carry a rent, so a short list understates NOI, value and quantum
    // with no error anywhere.
    const short = icDoc({ dropRetainedUnit: 'u2' });
    expect(errFields(short)).toContain('exit_strategy.retained_units');
    expect(errFields(icDoc({}))).not.toContain('exit_strategy.retained_units');
  });

  it('rule 3: rejects a rent row naming a unit that does not exist, accepts its real-unit twin', () => {
    expect(errFields(icDoc({ addRetainedUnitId: 'ghost' })))
      .toContain('exit_strategy.retained_units');
    expect(errFields(icDoc({}))).not.toContain('exit_strategy.retained_units');
  });

  it('rule 4: rejects a zero rent roll, accepts its priced twin', () => {
    expect(errFields(icDoc({ allRentsZero: true })))
      .toContain('exit_strategy.retained_units');
    expect(errFields(icDoc({}))).not.toContain('exit_strategy.retained_units');
  });

  it('rule 2: the missing-unit message agrees in number (lender-facing copy)', () => {
    // dropRetainedUnit removes exactly one of the five retained units, so
    // this is the singular case; the plural form is not separately exercised
    // (the builder only drops one at a time) but the same ternary drives both.
    const issue = validateInputs(icDoc({ dropRetainedUnit: 'u2' }))
      .find((i) => i.field === 'exit_strategy.retained_units');
    expect(issue?.message).toMatch(/1 unit has none\.$/);
    expect(issue?.message).not.toMatch(/unit\(s\)/);
  });

  it('rule 5: rejects a non-null explicit value alongside an investment case', () => {
    expect(errFields(icDoc({ explicitValue: 5_000_000_00 })))
      .toContain('refinance.investment_value_pence');
  });

  it('rule 5 (other arm): rejects a null explicit value with NO investment case', () => {
    expect(errFields(icDoc({ investmentCase: null, explicitValue: null })))
      .toContain('refinance.investment_value_pence');
  });

  it('rule 5 (third arm): a null refinance alongside an investment case is LEGAL', () => {
    // The indicative case of §19.1 — sizing computed and reported, nothing booked.
    expect(errFields(icDoc({ refinance: null }))).toEqual([]);
  });

  it('rule 6: rejects a stabilisation anchor naming an absent phase, accepts its real-phase twin', () => {
    expect(errFields(icDoc({ anchorPhaseId: 'no_such_phase' })))
      .toContain('investment_case.stabilisation.anchor');
    // icDoc()'s own default anchors to 'practical_completion', a real phase.
    expect(errFields(icDoc({}))).not.toContain('investment_case.stabilisation.anchor');
  });

  it('rule 7: rejects a stabilisation month past maturity, accepts its in-term twin', () => {
    expect(errFields(icDoc({ stabilisationMonth: 24, termMonths: 24 })))
      .toContain('investment_case.stabilisation.month_offset');
    expect(errFields(icDoc({ stabilisationMonth: 23, termMonths: 24 })))
      .not.toContain('investment_case.stabilisation.month_offset');
  });

  it('rule 8: rejects an occupancy outside (0, 100] and a fractional ramp', () => {
    expect(errFields(icDoc({ occupancyPct: 0 })))
      .toContain('investment_case.stabilisation.stabilised_occupancy_pct');
    expect(errFields(icDoc({ occupancyPct: 100.1 })))
      .toContain('investment_case.stabilisation.stabilised_occupancy_pct');
    expect(errFields(icDoc({ occupancyPct: 100 })))
      .not.toContain('investment_case.stabilisation.stabilised_occupancy_pct');
    expect(errFields(icDoc({ rampMonths: 2.5 })))
      .toContain('investment_case.stabilisation.ramp_months');
    // Accepting twin: same field, a valid whole-month value.
    expect(errFields(icDoc({ rampMonths: 6 })))
      .not.toContain('investment_case.stabilisation.ramp_months');
  });

  it('rule 9: rejects a non-positive yield, accepts a positive one', () => {
    expect(errFields(icDoc({ capYieldPct: 0 })))
      .toContain('investment_case.valuation.cap_yield_pct');
    expect(errFields(icDoc({ capYieldPct: 5 })))
      .not.toContain('investment_case.valuation.cap_yield_pct');
  });

  it('rule 9: rejects negative purchasers costs, accepts zero', () => {
    expect(errFields(icDoc({ purchasersCostsPct: -1 })))
      .toContain('investment_case.valuation.purchasers_costs_pct');
    expect(errFields(icDoc({ purchasersCostsPct: 0 })))
      .not.toContain('investment_case.valuation.purchasers_costs_pct');
  });

  it('rule 10: rejects each out-of-range take-out term, accepts each in-range twin', () => {
    expect(errFields(icDoc({ ltvCapPct: 0 }))).toContain('investment_case.takeout.ltv_cap_pct');
    expect(errFields(icDoc({ ltvCapPct: 60 }))).not.toContain('investment_case.takeout.ltv_cap_pct');
    expect(errFields(icDoc({ dscrFloor: 0 }))).toContain('investment_case.takeout.dscr_floor');
    expect(errFields(icDoc({ dscrFloor: 1.5 }))).not.toContain('investment_case.takeout.dscr_floor');
    expect(errFields(icDoc({ icrFloor: -1 }))).toContain('investment_case.takeout.icr_floor');
    expect(errFields(icDoc({ icrFloor: 1.5 }))).not.toContain('investment_case.takeout.icr_floor');
    expect(errFields(icDoc({ amortisationYears: 0 })))
      .toContain('investment_case.takeout.amortisation_years');
    expect(errFields(icDoc({ amortisationYears: null })))
      .not.toContain('investment_case.takeout.amortisation_years');
  });

  it('rule 10: rejects a negative take-out rate, accepts zero', () => {
    expect(errFields(icDoc({ annualRatePct: -1 })))
      .toContain('investment_case.takeout.annual_rate_pct');
    expect(errFields(icDoc({ annualRatePct: 0 })))
      .not.toContain('investment_case.takeout.annual_rate_pct');
  });

  it('rule 10: rejects a non-positive take-out term, accepts a positive one', () => {
    expect(errFields(icDoc({ termYears: 0 })))
      .toContain('investment_case.takeout.term_years');
    expect(errFields(icDoc({ termYears: 5 })))
      .not.toContain('investment_case.takeout.term_years');
  });

  it('rule 11: rejects duplicate line ids and an over-100 percentage line, allows an empty schedule', () => {
    expect(errFields(icDoc({ duplicateLineIds: true })))
      .toContain('investment_case.operating_lines');
    expect(errFields(icDoc({ pctLineValue: 101 })))
      .toContain('investment_case.operating_lines.l1.value');
    expect(errFields(icDoc({ lines: [] }))).toEqual([]);
  });

  it('rule 11: rejects a blank line id, accepts its named twin', () => {
    expect(errFields(icDoc({ blankLineId: true })))
      .toContain('investment_case.operating_lines');
    expect(errFields(icDoc({}))).not.toContain('investment_case.operating_lines');
  });

  it('rule 11 (fix-wave Minor 6): two blank-id lines raise "needs an id" twice, not a spurious duplicate-id error', () => {
    // Previously `seen.add(l.id)` ran unconditionally, including on the
    // blank-id branch -- so the FIRST blank id got added to `seen`, and the
    // SECOND blank-id line then also failed `seen.has('')`, raising a
    // spurious `Duplicate operating line id ""` alongside the legitimate
    // "needs an id" message.
    const doc = icDoc({
      lines: [
        { id: '', code: 'management', label: 'Management fee', basis: 'pct_of_gross_rent', value: 10 },
        { id: '', code: 'insurance', label: 'Buildings insurance', basis: 'fixed_pence_per_month', value: 25000 },
      ],
    });
    const messages = errs(doc)
      .filter((i) => i.field === 'investment_case.operating_lines')
      .map((i) => i.message);
    expect(messages.filter((m) => m === 'Every operating line needs an id.')).toHaveLength(2);
    expect(messages.some((m) => m.includes('Duplicate operating line id'))).toBe(false);
  });

  it('rule 11: rejects an unrecognised operating cost code, accepts a real one', () => {
    expect(errFields(icDoc({ invalidLineCode: true })))
      .toContain('investment_case.operating_lines.l1.code');
    expect(errFields(icDoc({}))).not.toContain('investment_case.operating_lines.l1.code');
  });

  it('rule 12: rejects an out-of-range arrangement fee percentage even with NO investment case, accepts an in-range one', () => {
    expect(errFields(icDoc({ investmentCase: null, arrangementFeePct: 101 })))
      .toContain('refinance.arrangement_fee_pct');
    expect(errFields(icDoc({ investmentCase: null })))
      .not.toContain('refinance.arrangement_fee_pct');
  });
});

describe('§20.3 monitoring validation', () => {
  // Built from fixtures/financial-model/l-retain-all.json via migrateInputsToV10
  // (the task brief's instruction), then spread with inputs_version: 11 and a
  // monitoring block — a spread literal, since the v11 migration itself does
  // not exist until Task 6. Cash-funded (committed_net_facility_pence: 0), so
  // it also exercises the debt rule's cash-deal arm (committed net is 0, not
  // whatever the finance block happens to carry).
  function retainAllV10(): CalculatorInputsV10 {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/financial-model/l-retain-all.json'), 'utf-8'),
    ) as { inputs: Record<string, unknown> };
    return migrateInputsToV10(raw.inputs) as CalculatorInputsV10;
  }

  function validLine(category: MonitoringCategory, over: Partial<MonitoringLineInputs> = {}): MonitoringLineInputs {
    return {
      category,
      current_budget_pence: 100_000,
      certified_to_date_pence: 50_000,
      paid_to_date_pence: 40_000,
      committed_to_date_pence: 60_000,
      forecast_to_complete_pence: 20_000,
      ...over,
    };
  }

  function validMonitoring(over: Partial<MonitoringInputs> = {}): MonitoringInputs {
    return {
      reporting_month: 6,
      reporting_date: '2026-06-01',
      lines: MONITORING_CATEGORIES.map((c) => validLine(c)),
      debt_drawn_to_date_pence: 0,
      cash_equity_injected_to_date_pence: 500_000,
      author: 'QS', date: '2026-06-01', note: null,
      ...over,
    };
  }

  // `as never` at the `validateInputs`/`errs` call site: this builds a v11
  // shape by spreading a v10 document via a literal rather than
  // `migrateV10toV11` (which exists now, but did not when this test was
  // written ahead of Task 6's migration landing), which `CalculatorInputsV10`
  // cannot type — exactly the task brief's sanctioned "a spread literal is
  // fine for a validation test".
  function v11Doc(monitoring: MonitoringInputs | null) {
    return { ...retainAllV10(), inputs_version: 11, monitoring };
  }

  const cashEquityTotal = 90_000_000; // l-retain-all.json's single confirmed cash equity source

  it('a null monitoring block adds no issue with a monitoring prefix', () => {
    const d = v11Doc(null);
    expect(validateInputs(d as never).some((i) => i.field.startsWith('monitoring'))).toBe(false);
  });

  it('a valid monitoring block adds no issue', () => {
    const d = v11Doc(validMonitoring());
    expect(validateInputs(d as never).some((i) => i.field.startsWith('monitoring'))).toBe(false);
  });

  it('rejects a reporting_month outside 1..term', () => {
    const d = v11Doc(validMonitoring({ reporting_month: 13 })); // l-retain-all's term is 12
    const issue = validateInputs(d as never).find((i) => i.field === 'monitoring.reporting_month');
    expect(issue).toEqual({
      severity: 'error',
      field: 'monitoring.reporting_month',
      message: 'reporting_month must be between 1 and the term (12)',
    });
  });

  it('rejects a lines block missing a category', () => {
    const lines = MONITORING_CATEGORIES.filter((c) => c !== 'contingency').map((c) => validLine(c));
    const d = v11Doc(validMonitoring({ lines }));
    const issue = validateInputs(d as never).find((i) => i.field === 'monitoring.lines');
    expect(issue).toEqual({
      severity: 'error',
      field: 'monitoring.lines',
      message: 'monitoring must carry exactly one line per category '
        + '(acquisition, construction, professional, statutory, contingency)',
    });
  });

  it('rejects a lines block with a duplicated category', () => {
    const lines = [
      ...MONITORING_CATEGORIES.filter((c) => c !== 'contingency').map((c) => validLine(c)),
      validLine('acquisition'),
    ];
    const d = v11Doc(validMonitoring({ lines }));
    expect(errs(d).some((i) => i.field === 'monitoring.lines')).toBe(true);
  });

  it('rejects a line whose paid exceeds certified', () => {
    const lines = MONITORING_CATEGORIES.map((c, i) => (
      i === 0 ? validLine(c, { certified_to_date_pence: 100, paid_to_date_pence: 101, committed_to_date_pence: 200 }) : validLine(c)
    ));
    const d = v11Doc(validMonitoring({ lines }));
    const issue = validateInputs(d as never).find((i) => i.field === 'monitoring.lines[0].paid_to_date_pence');
    expect(issue).toEqual({
      severity: 'error',
      field: 'monitoring.lines[0].paid_to_date_pence',
      message: 'paid to date cannot exceed certified to date',
    });
  });

  it('rejects a line whose certified exceeds committed', () => {
    const lines = MONITORING_CATEGORIES.map((c, i) => (
      i === 0 ? validLine(c, { certified_to_date_pence: 200, paid_to_date_pence: 100, committed_to_date_pence: 199 }) : validLine(c)
    ));
    const d = v11Doc(validMonitoring({ lines }));
    const issue = validateInputs(d as never).find((i) => i.field === 'monitoring.lines[0].certified_to_date_pence');
    expect(issue).toEqual({
      severity: 'error',
      field: 'monitoring.lines[0].certified_to_date_pence',
      message: 'certified to date cannot exceed committed to date',
    });
  });

  it('rejects debt_drawn_to_date exceeding the committed net facility (0 for a cash deal)', () => {
    const d = v11Doc(validMonitoring({ debt_drawn_to_date_pence: 1 }));
    const issue = validateInputs(d as never).find((i) => i.field === 'monitoring.debt_drawn_to_date_pence');
    expect(issue).toEqual({
      severity: 'error',
      field: 'monitoring.debt_drawn_to_date_pence',
      message: 'debt drawn to date cannot exceed the committed net facility',
    });
  });

  it('warns (not errors) when cash equity injected exceeds committed cash sources', () => {
    const d = v11Doc(validMonitoring({ cash_equity_injected_to_date_pence: cashEquityTotal + 1 }));
    const issues = validateInputs(d as never);
    const issue = issues.find((i) => i.field === 'monitoring.cash_equity_injected_to_date_pence');
    expect(issue).toEqual({
      severity: 'warning',
      field: 'monitoring.cash_equity_injected_to_date_pence',
      message: 'equity injected beyond committed sources',
    });
    // Not an error (spec §20.3): report_safe is unaffected by this alone.
    expect(errs(d).some((i) => i.field === 'monitoring.cash_equity_injected_to_date_pence')).toBe(false);
  });

  it('accepts cash equity injected exactly at the committed total (boundary)', () => {
    const d = v11Doc(validMonitoring({ cash_equity_injected_to_date_pence: cashEquityTotal }));
    expect(validateInputs(d as never).some((i) => i.field === 'monitoring.cash_equity_injected_to_date_pence'))
      .toBe(false);
  });
});

describe('§22.7 unit sales validation', () => {
  const errs = (d: CalculatorInputsV12) => validateInputs(d).filter((i) => i.severity === 'error');
  const errFields = (d: CalculatorInputsV12) => errs(d).map((i) => i.field);

  const row = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
    unit_id: 'u1',
    exchange: { month_offset: 8, anchor: null },
    completion: { month_offset: 12, anchor: null },
    deposit_pct: 10,
    agent_fee_pct: null,
    legal_fee_pence: null,
    ...changes,
  });

  const rowsWith = (changes: Record<string, unknown>): Array<Record<string, unknown>> => {
    const rows = [
      row(),
      row({ unit_id: 'u2', exchange: { month_offset: 10, anchor: null }, completion: { month_offset: 13, anchor: null } }),
      row({ unit_id: 'u3', exchange: null, deposit_pct: 0, completion: { month_offset: 13, anchor: null } }),
      row({
        unit_id: 'u4', exchange: { month_offset: 11, anchor: null }, completion: { month_offset: 20, anchor: null }, deposit_pct: 5,
      }),
    ];
    rows[0] = { ...rows[0], ...changes };
    return rows;
  };

  // Dump, mutate the raw dict in place, re-parse through the migration — the
  // only way to build a shape the builder does not offer.
  const reparse = (doc: CalculatorInputsV12, mutate: (raw: Record<string, unknown>) => void): CalculatorInputsV12 => {
    const raw = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    mutate(raw);
    return migrateInputsToV12(raw);
  };

  it('the four valid builders are clean', () => {
    expect(errFields(unitSalesDoc())).toEqual([]);
    expect(errFields(noProgrammeDoc())).toEqual([]);
  });

  it('rule 1: both blocks set errors on both fields', () => {
    const f = errFields(unitSalesDoc({ salesPhasingToo: true }));
    expect(f).toContain('unit_sales');
    expect(f).toContain('sales_phasing');
  });

  it('rule 2: retain_all rejects the block', () => {
    expect(errFields(unitSalesDoc({ route: 'retain_all' }))).toContain('unit_sales');
  });

  it('rule 3: four distinct messages', () => {
    let e = errs(unitSalesDoc({ dropRow: 'u3' }));
    expect(e.some((i) => i.field === 'unit_sales' && i.message === 'Sold unit "u3" has no sale row.')).toBe(true);
    e = errs(unitSalesDoc({ extraRow: 'u9' }));
    expect(e.some((i) => i.field === 'unit_sales.units[4]' && i.message.includes('does not exist in the unit mix'))).toBe(true);
    e = errs(unitSalesDoc({ extraRow: 'u4' }));
    expect(e.some((i) => i.field === 'unit_sales.units[4]' && i.message.includes('has more than one sale row'))).toBe(true);
    // Retained under blended: u2 retained, so its row names a retained unit.
    const retainU2 = (raw: Record<string, unknown>): void => {
      (raw.exit_strategy as Record<string, unknown>).retained_units = [{ unit_id: 'u2', monthly_rent_pence: 100_000 }];
    };
    e = errs(reparse(unitSalesDoc({ route: 'blended' }), retainU2));
    expect(e.some((i) => i.field === 'unit_sales.units[1]' && i.message.includes('is retained and cannot carry a sale row'))).toBe(true);
  });

  it('rule 4: window, anchor, and resolved month', () => {
    expect(errFields(unitSalesDoc({ rows: rowsWith({ completion: { month_offset: 24, anchor: null } }) })))
      .toContain('unit_sales.units[0].completion');
    expect(errFields(unitSalesDoc({ rows: rowsWith({ exchange: { month_offset: -1, anchor: null } }) })))
      .toContain('unit_sales.units[0].exchange');
    // anchor on a document with no network
    const anchorWithoutNetwork = (raw: Record<string, unknown>): void => {
      (raw.unit_sales as { units: Array<Record<string, unknown>> }).units[0].completion =
        { month_offset: 0, anchor: { phase_id: 'construction', offset_months: 0 } };
    };
    expect(errFields(reparse(noProgrammeDoc(), anchorWithoutNetwork))).toContain('unit_sales.units[0].completion');
    // anchor naming an absent phase
    expect(errFields(unitSalesDoc({
      rows: rowsWith({ completion: { month_offset: 0, anchor: { phase_id: 'ghost', offset_months: 0 } } }),
    }))).toContain('unit_sales.units[0].completion.anchor');
    // resolved past the term: practical_completion (12) + 12 = 24
    const e = errs(unitSalesDoc({
      rows: rowsWith({ completion: { month_offset: 0, anchor: { phase_id: 'practical_completion', offset_months: 12 } } }),
    }));
    expect(e.some((i) => i.field === 'unit_sales.units[0].completion' && i.message.includes('resolves to month 24'))).toBe(true);
    // its twin one month earlier is clean
    expect(errFields(unitSalesDoc({
      rows: rowsWith({ completion: { month_offset: 0, anchor: { phase_id: 'practical_completion', offset_months: 11 } } }),
    }))).toEqual([]);
  });

  it('rule 5: exchange after completion', () => {
    const e = errs(unitSalesDoc({ rows: rowsWith({ exchange: { month_offset: 13, anchor: null } }) }));
    expect(e.some((i) => i.field === 'unit_sales.units[0].exchange' && i.message.includes('(resolved months 13 > 12)'))).toBe(true);
    expect(errFields(unitSalesDoc({ rows: rowsWith({ exchange: { month_offset: 12, anchor: null } }) }))).toEqual([]);
  });

  it('rule 6: deposit range and exchange requirement', () => {
    expect(errFields(unitSalesDoc({ rows: rowsWith({ deposit_pct: 101 }) }))).toContain('unit_sales.units[0].deposit_pct');
    expect(errFields(unitSalesDoc({ rows: rowsWith({ exchange: null, deposit_pct: 10 }) }))).toContain('unit_sales.units[0].deposit_pct');
    expect(errFields(unitSalesDoc({ rows: rowsWith({ exchange: null, deposit_pct: 0 }) }))).toEqual([]);
  });

  it('rule 7: overrides', () => {
    expect(errFields(unitSalesDoc({ rows: rowsWith({ agent_fee_pct: 100 }) }))).toContain('unit_sales.units[0].agent_fee_pct');
    expect(errFields(unitSalesDoc({ rows: rowsWith({ legal_fee_pence: -1 }) }))).toContain('unit_sales.units[0].legal_fee_pence');
  });

  it('rule 9: zero sold value', () => {
    const zeroValues = (raw: Record<string, unknown>): void => {
      const units = (raw.unit_mix as { units: Array<Record<string, unknown>> }).units;
      for (const u of units) {
        u.estimated_value_pence = 0;
        (u.ancillary as Record<string, unknown>).parking_value_pence = 0;
      }
    };
    expect(errFields(reparse(unitSalesDoc(), zeroValues))).toContain('unit_sales');
  });

  it('rejects a fractional sales_slip_months', () => {
    const d = unitSalesDoc();
    const doc = { ...d, scenarios: { ...d.scenarios, downside: { ...d.scenarios.downside, sales_slip_months: 1.5 } } };
    expect(errFields(doc as CalculatorInputsV12)).toContain('scenarios.downside.sales_slip_months');
  });
});


/**
 * R15 spec §23.9. Twin of tests/test_financial_model_validation.py's
 * `TestDueDiligenceValidation`.
 *
 * Every rule gets a negative and an accepting twin. Several of them are LIVE
 * here and structurally unreachable in the Python engine, where Pydantic
 * rejects the value at parse time and the Python test asserts a
 * `ValidationError` instead: rule 0 (`status`), rule 1f (`category`), rule 6's
 * two impacts, and rule 7's/8's/9's numeric and enum arms. A raw JSON payload
 * reaches `validateInputs` uncoerced in this engine, so the ISSUE arm of each
 * of those is asserted here.
 */
describe('§23.9 due diligence validation', () => {
  const errs = (d: CalculatorInputsV13) => validateInputs(d).filter((i) => i.severity === 'error');
  const errFields = (d: CalculatorInputsV13) => errs(d).map((i) => i.field);
  const has = (d: CalculatorInputsV13, field: string, message: string) =>
    errs(d).some((i) => i.field === field && i.message === message);

  /** A complete raw due-diligence item — every field written, never left to a
   *  default, because the engine reads the object as-is and a missing key here
   *  is `undefined`, not the schema default. */
  const item = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'dd-extra',
    code: 'custom',
    category: 'existing_building',
    label: 'Basement drainage',
    status: 'unknown',
    evidence: null,
    expiry_date: null,
    owner: '',
    due_date: null,
    cost_impact_pence: null,
    programme_impact_months: null,
    action: '',
    notes: '',
    ...changes,
  });

  /** Fixture Y's captured listing record, optionally altered. */
  const record = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
    captured_at: '2026-08-25T09:00:00Z',
    source_name: 'rightmove',
    source_url: 'https://example.test/listing/y',
    is_vacant: false,
    tenure: 'freehold',
    lease_years_remaining: null,
    floor_area_sqm: 360,
    use_class: 'office',
    epc_rating: 'D',
    ...changes,
  });

  it('fixture Y raises no error', () => {
    expect(errFields(ddDoc())).toEqual([]);
  });

  it('a migrated document raises no due-diligence issue', () => {
    // The seed writes every entered item `unknown` with no evidence, no action
    // and no notes, `source_record` null, `qs` null and every `price_basis`
    // null — nothing for §23.9 to fire on.
    expect(errFields(migrateInputsToV13(rawYAsV12()))).toEqual([]);
    expect(errFields(ddDoc({ seed: true }))).toEqual([]);
    // A pre-v13 document has no `due_diligence` key at all.
    const v12 = migrateInputsToV12(rawYAsV12());
    expect(validateInputs(v12).filter(
      (i) => i.field.startsWith('due_diligence') || i.field.startsWith('cost_plan.qs'),
    )).toEqual([]);
  });

  // --- rule 1: the catalogue ---------------------------------------------

  it('rule 1a: a missing catalogue item', () => {
    expect(has(ddDoc({ dropItem: 'party_wall' }), 'due_diligence',
      'Due diligence item "party_wall" is missing - every catalogue item must be present.')).toBe(true);
    expect(errFields(ddDoc())).toEqual([]);
  });

  it('rule 1b: a repeated code', () => {
    expect(has(ddDoc({ dupItem: 'insurance' }), 'due_diligence.items[24].code',
      'Due diligence item "insurance" appears more than once.')).toBe(true);
    // Accepting twin: `custom` is the ONE repeatable code — it names no
    // catalogue entry, so a second user-added item is a normal document, not
    // a duplicate.
    expect(errFields(ddDoc({ addItem: item({ id: 'dd-custom-drainage' }) }))).toEqual([]);
  });

  it('rule 1c: a derived code cannot be entered', () => {
    expect(has(
      ddDoc({ addItem: item({ code: 'lender_valuation', category: 'exit' }) }),
      'due_diligence.items[24].code',
      'Due diligence item "lender_valuation" is derived from the model and cannot be entered.',
    )).toBe(true);
    expect(errFields(ddDoc({ addItem: item({ category: 'exit' }) }))).toEqual([]);
  });

  it('rule 1d: a code outside the catalogue', () => {
    expect(has(ddDoc({ addItem: item({ code: 'drainage_survey' }) }), 'due_diligence.items[24].code',
      'Due diligence item code "drainage_survey" is not in the catalogue.')).toBe(true);
    expect(errFields(ddDoc({ addItem: item() }))).toEqual([]);
  });

  it('rule 1e: a custom item needs a label', () => {
    expect(has(ddDoc({ addItem: item({ label: '   ' }) }), 'due_diligence.items[24].label',
      'A custom due diligence item needs a label.')).toBe(true);
    expect(errFields(ddDoc({ addItem: item({ label: 'Drainage survey' }) }))).toEqual([]);
  });

  it('rule 1f: a category outside the enum', () => {
    expect(has(ddDoc({ addItem: item({ category: 'drainage' }) }), 'due_diligence.items[24].category',
      'Due diligence category must be one of planning, title_occupation, existing_building, construction, finance, exit.')).toBe(true);
    expect(errFields(ddDoc({ addItem: item({ category: 'construction' }) }))).toEqual([]);
  });

  it('rule 1g: a duplicate id', () => {
    expect(has(ddDoc({ addItem: item({ id: 'dd-insurance' }) }), 'due_diligence.items[24].id',
      'Due diligence item id "dd-insurance" is not unique.')).toBe(true);
    expect(errFields(ddDoc({ addItem: item({ id: 'dd-extra' }) }))).toEqual([]);
  });

  it('rule 0: a status outside the enum', () => {
    expect(has(ddDoc({ status: { cil_s106: 'purple' } }), 'due_diligence.items[4].status',
      'Due diligence status must be one of red, amber, green, unknown, not_applicable.')).toBe(true);
    expect(errFields(ddDoc({ status: { cil_s106: 'unknown' } }))).toEqual([]);
  });

  // --- rules 2-4: a status and the evidence it owes -----------------------

  it('rule 2: a green status needs evidence', () => {
    const message = 'A green status needs evidence: record the source and the date.';
    const field = 'due_diligence.items[4].evidence';   // cil_s106
    expect(has(ddDoc({ status: { cil_s106: 'green' } }), field, message)).toBe(true);
    expect(has(ddDoc({
      status: { cil_s106: 'green' },
      evidence: { cil_s106: { source: '  ', reference: 'CIL notice', date: '2026-07-01' } },
    }), field, message)).toBe(true);
    expect(has(ddDoc({
      status: { cil_s106: 'green' },
      evidence: { cil_s106: { source: 'City of York Council', reference: 'CIL notice', date: '  ' } },
    }), field, message)).toBe(true);
    expect(errFields(ddDoc({
      status: { cil_s106: 'green' },
      evidence: { cil_s106: { source: 'City of York Council', reference: 'CIL notice', date: '2026-07-01' } },
    }))).toEqual([]);
  });

  it('rule 3: a red or amber status needs an action', () => {
    const message = 'A red or amber status needs an action.';
    const field = 'due_diligence.items[4].action';
    expect(has(ddDoc({ status: { cil_s106: 'amber' } }), field, message)).toBe(true);
    expect(has(ddDoc({ status: { cil_s106: 'red' } }), field, message)).toBe(true);
    expect(has(ddDoc({ status: { cil_s106: 'amber' }, action: { cil_s106: ' ' } }), field, message)).toBe(true);
    expect(errFields(ddDoc({
      status: { cil_s106: 'amber' }, action: { cil_s106: 'Request the CIL liability notice' },
    }))).toEqual([]);
  });

  it('rule 4: a not-applicable status needs a reason', () => {
    const message = 'A not-applicable status needs a reason in notes.';
    const field = 'due_diligence.items[4].notes';
    expect(has(ddDoc({ status: { cil_s106: 'not_applicable' } }), field, message)).toBe(true);
    expect(errFields(ddDoc({
      status: { cil_s106: 'not_applicable' }, notes: { cil_s106: 'Outside the CIL charging area' },
    }))).toEqual([]);
  });

  // --- rule 5: every present date is a real calendar date -----------------

  it('rule 5: the evidence date', () => {
    const bad = { source: 'City of York Council', reference: '26/01234/FUL', date: '2026-02-31' };
    expect(has(ddDoc({ evidence: { planning_route: bad } }), 'due_diligence.items[0].evidence.date',
      'Evidence date must be a real calendar date in yyyy-mm-dd form.')).toBe(true);
    expect(errFields(ddDoc({ evidence: { planning_route: { ...bad, date: '2026-02-28' } } }))).toEqual([]);
  });

  it('rule 5: the expiry date', () => {
    expect(has(ddDoc({ expiry: { planning_route: '2026-13-01' } }), 'due_diligence.items[0].expiry_date',
      'Expiry date must be a real calendar date in yyyy-mm-dd form.')).toBe(true);
    expect(errFields(ddDoc({ expiry: { planning_route: '2026-12-01' } }))).toEqual([]);
    expect(errFields(ddDoc({ expiry: { planning_route: null } }))).toEqual([]);
  });

  it('rule 5: the due date', () => {
    expect(has(ddDoc({ addItem: item({ due_date: '2026-02-30' }) }), 'due_diligence.items[24].due_date',
      'Due date must be a real calendar date in yyyy-mm-dd form.')).toBe(true);
    expect(errFields(ddDoc({ addItem: item({ due_date: '2026-02-28' }) }))).toEqual([]);
  });

  it('rule 5: the QS dates', () => {
    expect(has(ddDoc({ qs: { ...QS, date: '2026-02-31' } }), 'cost_plan.qs.date',
      'QS date must be a real calendar date in yyyy-mm-dd form.')).toBe(true);
    expect(has(ddDoc({ qs: { ...QS, base_date: '01-07-2026' } }), 'cost_plan.qs.base_date',
      'QS base date must be a real calendar date in yyyy-mm-dd form.')).toBe(true);
    expect(errFields(ddDoc({ qs: { ...QS } }))).toEqual([]);
  });

  // --- rule 6: the impacts ------------------------------------------------

  it('rule 6: impacts are whole and non-negative', () => {
    expect(has(ddDoc({ impacts: { cil_s106: [-1, null] } }), 'due_diligence.items[4].cost_impact_pence',
      'Cost impact must be a whole number of pence, zero or more.')).toBe(true);
    expect(has(ddDoc({ impacts: { cil_s106: [1.5, null] } }), 'due_diligence.items[4].cost_impact_pence',
      'Cost impact must be a whole number of pence, zero or more.')).toBe(true);
    expect(has(ddDoc({ impacts: { cil_s106: [null, -1] } }), 'due_diligence.items[4].programme_impact_months',
      'Programme impact must be a whole number of months, zero or more.')).toBe(true);
    expect(has(ddDoc({ impacts: { cil_s106: [null, 0.5] } }), 'due_diligence.items[4].programme_impact_months',
      'Programme impact must be a whole number of months, zero or more.')).toBe(true);
    expect(errFields(ddDoc({ impacts: { cil_s106: [0, 0] } }))).toEqual([]);
  });

  // --- rule 7: the captured listing record --------------------------------

  it('rule 7: captured_at is required', () => {
    expect(has(ddDoc({ sourceRecord: record({ captured_at: '   ' }) }),
      'due_diligence.source_record.captured_at',
      'The captured listing record needs a captured_at timestamp.')).toBe(true);
    expect(errFields(ddDoc({ sourceRecord: record() }))).toEqual([]);
    expect(errFields(ddDoc({ sourceRecord: null }))).toEqual([]);
  });

  it('rule 7: the numeric and enum arms', () => {
    expect(has(ddDoc({ sourceRecord: record({ floor_area_sqm: -1 }) }),
      'due_diligence.source_record.floor_area_sqm',
      'Listing floor area must be zero or more.')).toBe(true);
    expect(has(ddDoc({ sourceRecord: record({ lease_years_remaining: -1 }) }),
      'due_diligence.source_record.lease_years_remaining',
      'Listing lease years remaining must be a whole number, zero or more.')).toBe(true);
    expect(has(ddDoc({ sourceRecord: record({ lease_years_remaining: 12.5 }) }),
      'due_diligence.source_record.lease_years_remaining',
      'Listing lease years remaining must be a whole number, zero or more.')).toBe(true);
    expect(has(ddDoc({ sourceRecord: record({ tenure: 'commonhold' }) }),
      'due_diligence.source_record.tenure',
      'Listing tenure must be freehold, leasehold or unknown.')).toBe(true);
    expect(errFields(ddDoc({
      sourceRecord: record({ floor_area_sqm: 0, lease_years_remaining: 0, tenure: 'leasehold' }),
    }))).toEqual([]);
  });

  // --- rule 8: QS provenance ----------------------------------------------

  it('rule 8: QS provenance is detailed-mode only', () => {
    expect(has(ddDoc({ mode: 'headline' }), 'cost_plan.qs',
      'QS provenance applies to a detailed cost plan only - switch to detailed mode or remove it.')).toBe(true);
    expect(errFields(ddDoc({ mode: 'headline', qs: null }))).toEqual([]);
  });

  it('rule 8: QS provenance needs a source', () => {
    expect(has(ddDoc({ qs: { ...QS, source: '  ' } }), 'cost_plan.qs.source',
      'QS provenance needs a source.')).toBe(true);
    expect(errFields(ddDoc({ qs: { ...QS, source: 'Gleeds' } }))).toEqual([]);
  });

  it('rule 8: the stage and status enums', () => {
    expect(has(ddDoc({ qs: { ...QS, stage: 'riba_9' as QsStage } }), 'cost_plan.qs.stage',
      'QS stage must be one of order_of_cost, riba_2, riba_3, riba_4, tender, contract_sum.')).toBe(true);
    expect(has(ddDoc({ qs: { ...QS, status: 'superseded' as QsStatus } }), 'cost_plan.qs.status',
      'QS status must be one of draft, issued, reviewed.')).toBe(true);
    expect(errFields(ddDoc({ qs: { ...QS, stage: 'tender', status: 'reviewed' } }))).toEqual([]);
  });

  // --- rule 9: the package price basis --------------------------------------

  it('rule 9: the price basis enum', () => {
    expect(has(ddDoc({ priceBasis: { 'pkg-mande': 'guess' as PriceBasis } }),
      'cost_plan.packages[2].price_basis',
      'Package price basis must be fixed_price, provisional_sum, estimate or unset.')).toBe(true);
    expect(errFields(ddDoc({ priceBasis: { 'pkg-mande': 'estimate' } }))).toEqual([]);
    expect(errFields(ddDoc({ priceBasis: { 'pkg-mande': null } }))).toEqual([]);
  });
});
