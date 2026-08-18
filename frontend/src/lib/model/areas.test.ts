import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AREA_BRIDGE, areaBridge, developedAreaSqm, unitNiaSqm,
} from './areas';
import type { AreaBridgeInputs } from './areas';
import type { AnyCalculatorInputs } from './finance-types';

/** Minimal inputs shaped just enough for the areas module. The areas module
 *  reads only `areas`, `conversion_costs.total_construction_sqm`, `unit_mix`
 *  and `exit_strategy`, so nothing else needs to be real. */
function makeInputs(
  areas: Partial<AreaBridgeInputs>,
  units: Array<{ id: string; floor_area_sqm: number }> = [],
  opts: { manualSqm?: number; route?: string; retainedIds?: string[] } = {},
): AnyCalculatorInputs {
  return {
    areas: { ...DEFAULT_AREA_BRIDGE, ...areas },
    conversion_costs: { total_construction_sqm: opts.manualSqm ?? 0 },
    unit_mix: { units: units.map((u) => ({ ...u, type: '1bed', estimated_value_pence: 1, comparable_notes: '' })) },
    exit_strategy: {
      route: opts.route ?? 'sell_all',
      retained_units: (opts.retainedIds ?? []).map((id) => ({ unit_id: id, monthly_rent_pence: 0 })),
    },
  } as unknown as AnyCalculatorInputs;
}

const FULL_BRIDGE: Partial<AreaBridgeInputs> = {
  basis: 'bridge_derived',
  existing_gia_sqm: 600,
  demolished_gia_sqm: 20,
  extension_gia_sqm: 40,
  retained_commercial_gia_sqm: 100,
  untouched_gia_sqm: 0,
  circulation_common_sqm: 62,
  plant_riser_sqm: 18,
  store_bin_cycle_sqm: 14,
  amenity_sqm: 6,
  external_amenity_sqm: 150,
};

describe('areaBridge derivation', () => {
  it('derives proposed GIA as existing minus demolished plus extension', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE));
    expect(b.proposed_gia_sqm).toBe(620);
  });

  it('derives developed GIA by removing retained commercial and untouched area', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE));
    expect(b.developed_gia_sqm).toBe(520);
  });

  it('derives available-for-units by removing non-saleable internal areas', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE));
    // 520 - 62 - 18 - 14 - 6
    expect(b.available_for_units_sqm).toBe(420);
  });

  it('reports the unallocated balance rather than hiding it', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, [
      { id: 'u1', floor_area_sqm: 60 },
      { id: 'u2', floor_area_sqm: 60 },
    ]));
    expect(b.unit_nia_sqm).toBe(120);
    expect(b.unallocated_sqm).toBe(300);
  });

  it('reports a negative unallocated balance when units over-fill the building', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, [{ id: 'u1', floor_area_sqm: 500 }]));
    expect(b.unallocated_sqm).toBe(-80);
  });

  it('keeps external amenity out of the reconciliation entirely', () => {
    const withExternal = areaBridge(makeInputs(FULL_BRIDGE));
    const withoutExternal = areaBridge(makeInputs({ ...FULL_BRIDGE, external_amenity_sqm: 0 }));
    expect(withExternal.developed_gia_sqm).toBe(withoutExternal.developed_gia_sqm);
    expect(withExternal.available_for_units_sqm).toBe(withoutExternal.available_for_units_sqm);
    expect(withExternal.external_amenity_sqm).toBe(150);
  });
});

describe('efficiencies', () => {
  const units = [{ id: 'u1', floor_area_sqm: 200 }, { id: 'u2', floor_area_sqm: 160 }];

  it('computes NIA over developed GIA as the policy ratio', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units));
    // 360 / 520
    expect(b.nia_to_gia_pct).toBe(69.23);
  });

  it('computes NIA over proposed GIA for the whole building', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units));
    // 360 / 620
    expect(b.nia_to_proposed_gia_pct).toBe(58.06);
  });

  it('computes saleable over developed from the units actually being sold', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units, { route: 'blended', retainedIds: ['u2'] }));
    // 200 / 520 — u2 is retained, so only u1 is saleable
    expect(b.saleable_to_developed_pct).toBe(38.46);
  });

  it('reports zero saleable efficiency under retain-all, which is the true answer', () => {
    const b = areaBridge(makeInputs(FULL_BRIDGE, units, { route: 'retain_all' }));
    expect(b.saleable_to_developed_pct).toBe(0);
  });

  it('returns null rather than zero when a denominator is zero', () => {
    const b = areaBridge(makeInputs({ basis: 'bridge_derived' }, units));
    expect(b.developed_gia_sqm).toBe(0);
    expect(b.nia_to_gia_pct).toBeNull();
    expect(b.nia_to_proposed_gia_pct).toBeNull();
    expect(b.saleable_to_developed_pct).toBeNull();
  });
});

describe('developedAreaSqm — the single cost-area accessor', () => {
  it('returns the derived developed GIA under the bridge basis', () => {
    expect(developedAreaSqm(makeInputs(FULL_BRIDGE, [], { manualSqm: 999 }))).toBe(520);
  });

  it('returns the manual field under the manual basis, ignoring a populated bridge', () => {
    const inputs = makeInputs({ ...FULL_BRIDGE, basis: 'manual' }, [], { manualSqm: 480 });
    expect(developedAreaSqm(inputs)).toBe(480);
  });

  it('falls back to the manual field for a pre-v6 document with no areas block', () => {
    const legacy = {
      conversion_costs: { total_construction_sqm: 500 },
      unit_mix: { units: [] },
      exit_strategy: { route: 'sell_all', retained_units: [] },
    } as unknown as AnyCalculatorInputs;
    expect(developedAreaSqm(legacy)).toBe(500);
    expect(areaBridge(legacy).basis).toBe('manual');
  });
});

describe('unitNiaSqm', () => {
  it('sums internal areas only and never ancillary', () => {
    const units = [
      { id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 1, comparable_notes: '',
        ancillary: { balcony_terrace_sqm: 8, balcony_terrace_value_pence: 0, parking_spaces: 1, parking_value_pence: 0 } },
    ];
    expect(unitNiaSqm(units as never)).toBe(50);
  });
});
