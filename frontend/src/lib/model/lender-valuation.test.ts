import { describe, it, expect } from 'vitest';
import { computeLenderGdv, SQFT_PER_SQM } from './lender-valuation';
import { migrateV2toV3, migrateInputsToV6 } from './migrate';
import { runAppraisal } from './index';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import type { CalculatorInputsV3, CalculatorInputsV6, LenderValuation } from './finance-types';

function baseInputs(lenderValuation: LenderValuation | null): CalculatorInputsV3 {
  const v3 = migrateV2toV3(defaultCalculatorInputsV2());
  v3.unit_mix.units = [
    { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 10_000_000, comparable_notes: '' },
    { id: 'u2', type: '2bed', floor_area_sqm: 70, estimated_value_pence: 15_000_000, comparable_notes: '' },
  ];
  v3.lender_valuation = lenderValuation;
  return v3;
}

const PROVENANCE = { reason: 'Test haircut', author: 'test-author', date: '2026-08-13' };

describe('computeLenderGdv — spec §3.2', () => {
  it('returns null when lender_valuation is absent', () => {
    expect(computeLenderGdv(baseInputs(null))).toBeNull();
  });

  it('SQFT_PER_SQM matches the codebase-wide sq m -> sq ft conversion literal', () => {
    expect(SQFT_PER_SQM).toBe(10.7639);
  });

  it('global_pct: applies a uniform % adjustment to every unit developer value', () => {
    const inputs = baseInputs({ basis: 'global_pct', global_value: -10, per_key_values: null, ...PROVENANCE });
    const result = computeLenderGdv(inputs);
    // round(10,000,000 * 0.90) + round(15,000,000 * 0.90)
    expect(result).toEqual({ lender_gdv_pence: 9_000_000 + 13_500_000, unit_values_pence: [9_000_000, 13_500_000] });
  });

  it('global_per_sqft: replaces every unit value with pence-per-sqft * area', () => {
    const inputs = baseInputs({ basis: 'global_per_sqft', global_value: 200_000, per_key_values: null, ...PROVENANCE });
    const result = computeLenderGdv(inputs);
    // round(200,000 * 50 * 10.7639) + round(200,000 * 70 * 10.7639)
    expect(result).toEqual({ lender_gdv_pence: 107_639_000 + 150_694_600, unit_values_pence: [107_639_000, 150_694_600] });
  });

  it('unit_type: applies a per-type % adjustment; a type absent from the map keeps its developer value', () => {
    const inputs = baseInputs({
      basis: 'unit_type', global_value: null, per_key_values: { '1bed': 5, '2bed': -5 }, ...PROVENANCE,
    });
    inputs.unit_mix.units.push({ id: 'u3', type: 'studio', floor_area_sqm: 30, estimated_value_pence: 5_000_000, comparable_notes: '' });
    const result = computeLenderGdv(inputs);
    // u1: round(10,000,000*1.05)=10,500,000; u2: round(15,000,000*0.95)=14,250,000; u3 (no 'studio' entry): unchanged 5,000,000
    expect(result).toEqual({
      lender_gdv_pence: 10_500_000 + 14_250_000 + 5_000_000,
      unit_values_pence: [10_500_000, 14_250_000, 5_000_000],
    });
  });

  it('per_unit: uses the absolute pence value recorded for each unit id', () => {
    const inputs = baseInputs({
      basis: 'per_unit', global_value: null, per_key_values: { u1: 9_500_000, u2: 14_000_000 }, ...PROVENANCE,
    });
    const result = computeLenderGdv(inputs);
    expect(result).toEqual({ lender_gdv_pence: 23_500_000, unit_values_pence: [9_500_000, 14_000_000] });
  });

  it('per_unit: throws when a unit id has no recorded value (partial per-unit valuation is ambiguous)', () => {
    const inputs = baseInputs({
      basis: 'per_unit', global_value: null, per_key_values: { u1: 9_500_000 }, ...PROVENANCE,
    });
    expect(() => computeLenderGdv(inputs)).toThrow('Lender valuation (per_unit basis) is missing a value for unit "u2".');
  });

  it('fixed_amount: uses global_value directly as the total lender GDV, with no per-unit breakdown', () => {
    const inputs = baseInputs({ basis: 'fixed_amount', global_value: 50_000_000, per_key_values: null, ...PROVENANCE });
    const result = computeLenderGdv(inputs);
    expect(result).toEqual({ lender_gdv_pence: 50_000_000, unit_values_pence: [] });
  });

  it('fixed_amount: throws when global_value is null', () => {
    const inputs = baseInputs({ basis: 'fixed_amount', global_value: null, per_key_values: null, ...PROVENANCE });
    expect(() => computeLenderGdv(inputs)).toThrow('Lender valuation basis "fixed_amount" requires a global_value.');
  });

  it('global_pct: throws when global_value is null', () => {
    const inputs = baseInputs({ basis: 'global_pct', global_value: null, per_key_values: null, ...PROVENANCE });
    expect(() => computeLenderGdv(inputs)).toThrow('Lender valuation basis "global_pct" requires a global_value.');
  });

  it('throws when a computed unit value is not positive (a -100% haircut zeroes a unit)', () => {
    const inputs = baseInputs({ basis: 'global_pct', global_value: -100, per_key_values: null, ...PROVENANCE });
    expect(() => computeLenderGdv(inputs)).toThrow('Lender-adjusted value for unit "u1" must be positive.');
  });

  it('throws when the fixed_amount total is not positive', () => {
    const inputs = baseInputs({ basis: 'fixed_amount', global_value: 0, per_key_values: null, ...PROVENANCE });
    expect(() => computeLenderGdv(inputs)).toThrow('Lender GDV must be a positive value.');
  });
});

// Task-3-review CRITICAL fix: an invalid-but-present lender_valuation block must
// never crash the pipeline. computeLenderGdv throws for these three cases (see
// above); runAppraisal must contain that throw, not propagate it, and validation
// must independently flag the same condition as a hard error.
describe('runAppraisal — an invalid lender_valuation degrades to null metrics + a hard error, never a crash', () => {
  const cases: Array<{ label: string; lv: LenderValuation; messageIncludes: string }> = [
    {
      label: 'missing global_value on a basis that requires it',
      lv: { basis: 'fixed_amount', global_value: null, per_key_values: null, ...PROVENANCE },
      messageIncludes: 'requires a global_value',
    },
    {
      label: 'missing per_unit id',
      lv: { basis: 'per_unit', global_value: null, per_key_values: { u1: 9_500_000 }, ...PROVENANCE },
      messageIncludes: 'missing a value for unit "u2"',
    },
    {
      label: 'non-positive computed unit value',
      lv: { basis: 'global_pct', global_value: -100, per_key_values: null, ...PROVENANCE },
      messageIncludes: 'must be positive',
    },
  ];

  for (const { label, lv, messageIncludes } of cases) {
    it(`${label}: does not throw, lender metrics are null, and a hard ValidationIssue is present`, () => {
      const inputs = baseInputs(lv);
      let run: ReturnType<typeof runAppraisal> | undefined;
      expect(() => { run = runAppraisal(inputs); }).not.toThrow();
      expect(run).toBeDefined();
      expect(run!.metrics.lender_gdv_pence).toBeNull();
      expect(run!.metrics.lender_gdv_variance_pence).toBeNull();
      expect(run!.metrics.lender_gdv_variance_pct).toBeNull();
      expect(run!.metrics.ltgdv_lender_pct).toBeNull();
      expect(run!.validation.some((i) => i.severity === 'error' && i.field === 'lender_valuation'
        && i.message.includes(messageIncludes))).toBe(true);
    });
  }
});

// R9 (Task 7 — Defect 1): a v6 unit now carries an internal area
// (`floor_area_sqm`) AND a separate balcony/terrace area (`ancillary.balcony_terrace_sqm`).
// Spec §3.2's "pence per sq ft applied to every unit's area" is ambiguous once a
// unit has two areas, and the ambiguity silently moves lender GDV. This pins the
// basis to internal NIA only, so a future change that folds balcony area into the
// per-sq-ft calculation is caught here rather than discovered in a live valuation.
describe('R9 — global_per_sqft is bound to internal NIA', () => {
  function v6InputsWithBalcony(balconyTerraceSqm: number): CalculatorInputsV6 {
    const inputs = migrateInputsToV6({}, { id: 'p', price_pence: 0, floor_area_sqm: 0 });
    inputs.lender_valuation = {
      basis: 'global_per_sqft', global_value: 40_000, per_key_values: null,
      reason: 'r', author: 'a', date: '2026-08-18',
    };
    inputs.unit_mix = {
      units: [{
        id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 10_000_000, comparable_notes: '',
        ancillary: {
          balcony_terrace_sqm: balconyTerraceSqm, balcony_terrace_value_pence: 0,
          parking_spaces: 0, parking_value_pence: 0,
        },
      }],
    };
    return inputs;
  }

  it('ignores balcony and terrace area when applying a per-sq-ft lender rate', () => {
    const withBalcony = computeLenderGdv(v6InputsWithBalcony(20));
    const withoutBalcony = computeLenderGdv(v6InputsWithBalcony(0));
    expect(withBalcony!.lender_gdv_pence).toBe(withoutBalcony!.lender_gdv_pence);
    // 40,000p/sq ft x 50 m² x 10.7639
    expect(withBalcony!.lender_gdv_pence).toBe(21_527_800);
  });
});
