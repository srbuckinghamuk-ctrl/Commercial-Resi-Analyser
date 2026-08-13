import { describe, it, expect } from 'vitest';
import { computeLenderGdv, SQFT_PER_SQM } from './lender-valuation';
import { migrateV2toV3 } from './migrate';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import type { CalculatorInputsV3, LenderValuation } from './finance-types';

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
