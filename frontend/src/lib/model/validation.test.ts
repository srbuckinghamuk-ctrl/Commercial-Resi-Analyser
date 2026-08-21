import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { validateInputs, reconcile } from './validation';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { migrateV2toV3, migrateInputsToV4, migrateInputsToV5, migrateInputsToV6, migrateV6toV7 } from './migrate';
import { runAppraisal } from './index';
import { DEFAULT_AREA_BRIDGE } from './areas';
import { DEFAULT_UNIT_ANCILLARY } from '../conversion-types';
import type { ProposedUnitV6 } from '../conversion-types';
import type {
  CalculatorInputsV3, CalculatorInputsV4, CalculatorInputsV6, CalculatorInputsV7, CalculatorInputsV8,
  ProgrammePackage, RefinanceInputs,
} from './finance-types';
import type { CostPackage, FeeLine } from './cost-plan';
import { DEFAULT_VAT, VAT_CHARGE_CATEGORIES, defaultVatTreatments } from './vat';
import type { VatChargeCategory, VatOverride, VatTreatment } from './vat';

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
      vat_override: null, ...overrides,
    };
  }

  function feeLine(overrides: Partial<FeeLine> = {}): FeeLine {
    return {
      id: 'fee-x', code: 'other', category: 'professional', label: 'X',
      basis: 'fixed', amount_pence: 1000, pct: 0, per_dwelling: false,
      vat_override: null, ...overrides,
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
      vat_override: override,
    };
  }

  function feeLineWithOverride(override: VatOverride | null): FeeLine {
    return {
      id: 'fee-1', code: 'other', category: 'professional', label: 'X',
      basis: 'fixed', amount_pence: 1000, pct: 0, per_dwelling: false,
      vat_override: override,
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

      const valid = validateInputs(makeV8Inputs({ cost_plan: { mode: 'headline', packages: [] } }));
      expect(valid.some((i) => i.field === 'cost_plan.packages[0].vat_override')).toBe(false);
    });

    it('hard-errors on a fee-line vat_override', () => {
      const invalid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'headline', fee_lines: [feeLineWithOverride(vatOverride())] },
      }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'cost_plan.fee_lines[0].vat_override')).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        cost_plan: { mode: 'headline', fee_lines: [feeLineWithOverride(null)] },
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

  describe('first_period_end_month out of range', () => {
    it('hard-errors when negative', () => {
      const invalid = validateInputs(makeV8Inputs({ vat: { first_period_end_month: -1 } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.first_period_end_month')).toBe(true);

      const valid = validateInputs(makeV8Inputs({ vat: { first_period_end_month: 0 } }));
      expect(valid.some((i) => i.field === 'vat.first_period_end_month')).toBe(false);
    });

    it('hard-errors when >= term_months', () => {
      const invalid = validateInputs(makeV8Inputs({
        finance: { term_months: 3 }, vat: { first_period_end_month: 3 },
      }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.first_period_end_month')).toBe(true);

      const valid = validateInputs(makeV8Inputs({
        finance: { term_months: 3 }, vat: { first_period_end_month: 2 },
      }));
      expect(valid.some((i) => i.field === 'vat.first_period_end_month')).toBe(false);
    });
  });

  describe('repayment_lag_months out of range', () => {
    it('hard-errors when negative', () => {
      const invalid = validateInputs(makeV8Inputs({ vat: { repayment_lag_months: -1 } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.repayment_lag_months')).toBe(true);

      const valid = validateInputs(makeV8Inputs({ vat: { repayment_lag_months: 0 } }));
      expect(valid.some((i) => i.field === 'vat.repayment_lag_months')).toBe(false);
    });

    it('hard-errors when greater than 6', () => {
      const invalid = validateInputs(makeV8Inputs({ vat: { repayment_lag_months: 7 } }));
      expect(invalid.some((i) => i.severity === 'error' && i.field === 'vat.repayment_lag_months')).toBe(true);

      const valid = validateInputs(makeV8Inputs({ vat: { repayment_lag_months: 6 } }));
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
      const issues = validateInputs(inputs);
      expect(issues.some(
        (i) => i.severity === 'warning' && i.field === `vat.treatments[${idx}].recovery_basis`,
      )).toBe(true);
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
