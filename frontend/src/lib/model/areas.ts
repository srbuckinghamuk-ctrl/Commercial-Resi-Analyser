import type { AnyCalculatorInputs } from './finance-types';
import type { ProposedUnit } from '../conversion-types';
import { pct } from './pct';

/** Which number is the construction cost area (spec §15.3).
 *  `bridge_derived` — the reconciled `developed_gia_sqm` below.
 *  `manual` — `conversion_costs.total_construction_sqm`, the pre-R9 field. */
export type AreaBasis = 'bridge_derived' | 'manual';

/** Spec §15.1. Every field here is ENTERED. Nothing derived is stored. */
export interface AreaBridgeInputs {
  basis: AreaBasis;
  existing_gia_sqm: number;
  demolished_gia_sqm: number;
  extension_gia_sqm: number;
  retained_commercial_gia_sqm: number;
  untouched_gia_sqm: number;
  circulation_common_sqm: number;
  plant_riser_sqm: number;
  store_bin_cycle_sqm: number;
  amenity_sqm: number;
  /** External amenity and landscape. NOT gross internal area — carried through
   *  the result for display but never deducted from the reconciliation. */
  external_amenity_sqm: number;
}

export const DEFAULT_AREA_BRIDGE: AreaBridgeInputs = {
  basis: 'manual',
  existing_gia_sqm: 0,
  demolished_gia_sqm: 0,
  extension_gia_sqm: 0,
  retained_commercial_gia_sqm: 0,
  untouched_gia_sqm: 0,
  circulation_common_sqm: 0,
  plant_riser_sqm: 0,
  store_bin_cycle_sqm: 0,
  amenity_sqm: 0,
  external_amenity_sqm: 0,
};

/** Spec §15.1/§15.2 — every entered line, every derived line, every ratio.
 *  This is the ONLY shape the UI and the report may read areas from. */
export interface AreaBridgeResult {
  basis: AreaBasis;
  existing_gia_sqm: number;
  demolished_gia_sqm: number;
  extension_gia_sqm: number;
  proposed_gia_sqm: number;
  retained_commercial_gia_sqm: number;
  untouched_gia_sqm: number;
  developed_gia_sqm: number;
  circulation_common_sqm: number;
  plant_riser_sqm: number;
  store_bin_cycle_sqm: number;
  amenity_sqm: number;
  available_for_units_sqm: number;
  unit_nia_sqm: number;
  unallocated_sqm: number;
  external_amenity_sqm: number;
  ancillary_balcony_terrace_sqm: number;
  ancillary_parking_spaces: number;
  /** The cost area actually in force, whichever basis produced it. */
  developed_area_sqm: number;
  /** The raw manual input (`conversion_costs.total_construction_sqm`), carried
   *  verbatim so consumers never read the field directly. Only the "manual
   *  basis differs from the bridge by more than 5%" warning in validation.ts
   *  needs both the manual figure and the derived one side by side — every
   *  other consumer wants `developed_area_sqm` instead. */
  manual_area_sqm: number;
  nia_to_gia_pct: number | null;
  nia_to_proposed_gia_pct: number | null;
  saleable_to_developed_pct: number | null;
}

/** Σ internal net internal area. Ancillary (balcony, terrace, parking) is
 *  deliberately excluded — spec §15.5 keeps it outside NIA. */
export function unitNiaSqm(units: readonly ProposedUnit[]): number {
  return units.reduce((s, u) => s + u.floor_area_sqm, 0);
}

/** A v2–v5 document has no `areas` block at all. Reading it structurally (the
 *  codebase's version-dispatch idiom — see `'lender_valuation' in inputs` in
 *  metrics.ts) resolves it to the manual basis with a zeroed bridge, which is
 *  exactly what migration writes. Legacy and migrated documents therefore
 *  behave identically, and no caller needs a version check. */
function bridgeInputsOf(inputs: AnyCalculatorInputs): AreaBridgeInputs {
  if (!('areas' in inputs) || inputs.areas == null) return DEFAULT_AREA_BRIDGE;
  return { ...DEFAULT_AREA_BRIDGE, ...(inputs.areas as Partial<AreaBridgeInputs>) };
}

/**
 * Spec §15 — the whole reconciliation, in one place.
 *
 * The arithmetic order below is normative and is mirrored operation-for-operation
 * in `app/financial_model/areas.py`, so both engines produce bit-identical
 * IEEE-754 results and the fixture parity assertions can be exact rather than
 * tolerant.
 */
export function areaBridge(inputs: AnyCalculatorInputs): AreaBridgeResult {
  const a = bridgeInputsOf(inputs);
  const units = inputs.unit_mix.units;

  const proposed = a.existing_gia_sqm - a.demolished_gia_sqm + a.extension_gia_sqm;
  const developed = proposed - a.retained_commercial_gia_sqm - a.untouched_gia_sqm;
  const available = developed
    - a.circulation_common_sqm
    - a.plant_riser_sqm
    - a.store_bin_cycle_sqm
    - a.amenity_sqm;

  const unitNia = unitNiaSqm(units);
  const unallocated = available - unitNia;

  // Saleable area is exit-coupled by design (spec §15.2): it answers "what
  // proportion of the area being funded is being sold?", so a retain-all
  // scheme correctly reports 0%.
  const retainedIds = new Set(inputs.exit_strategy.retained_units.map((r) => r.unit_id));
  const route = inputs.exit_strategy.route;
  const soldUnits =
    route === 'retain_all' ? [] :
    route === 'sell_all' ? units :
    units.filter((u) => !retainedIds.has(u.id));
  const saleableNia = unitNiaSqm(soldUnits);

  const ancillary = units.reduce(
    (acc, u) => {
      const anc = 'ancillary' in u ? (u as { ancillary?: { balcony_terrace_sqm?: number; parking_spaces?: number } }).ancillary : undefined;
      acc.balcony += anc?.balcony_terrace_sqm ?? 0;
      acc.spaces += anc?.parking_spaces ?? 0;
      return acc;
    },
    { balcony: 0, spaces: 0 },
  );

  const costArea = a.basis === 'bridge_derived'
    ? developed
    : inputs.conversion_costs.total_construction_sqm;

  return {
    basis: a.basis,
    existing_gia_sqm: a.existing_gia_sqm,
    demolished_gia_sqm: a.demolished_gia_sqm,
    extension_gia_sqm: a.extension_gia_sqm,
    proposed_gia_sqm: proposed,
    retained_commercial_gia_sqm: a.retained_commercial_gia_sqm,
    untouched_gia_sqm: a.untouched_gia_sqm,
    developed_gia_sqm: developed,
    circulation_common_sqm: a.circulation_common_sqm,
    plant_riser_sqm: a.plant_riser_sqm,
    store_bin_cycle_sqm: a.store_bin_cycle_sqm,
    amenity_sqm: a.amenity_sqm,
    available_for_units_sqm: available,
    unit_nia_sqm: unitNia,
    unallocated_sqm: unallocated,
    external_amenity_sqm: a.external_amenity_sqm,
    ancillary_balcony_terrace_sqm: ancillary.balcony,
    ancillary_parking_spaces: ancillary.spaces,
    developed_area_sqm: costArea,
    manual_area_sqm: inputs.conversion_costs.total_construction_sqm,
    nia_to_gia_pct: pct(unitNia, developed),
    nia_to_proposed_gia_pct: pct(unitNia, proposed),
    saleable_to_developed_pct: pct(saleableNia, developed),
  };
}

/**
 * **The** construction cost area. Spec §15.3/§15.4.
 *
 * Every consumer — the cost stack, validation, the deal spider, the UI, the
 * memo — calls this and nothing else. `conversion_costs.total_construction_sqm`
 * is off-limits outside this module, enforced by the eslint rule added in
 * Task 5 and by `tests/test_accessor_guard.py` on the Python side.
 *
 * That enforcement exists because R8 proved convention alone is not enough: the
 * same "moved the computation, missed a consumer" defect recurred three times
 * in one release (`calculateTotalAcquisitionCost`, `deal-spider.ts`,
 * `AcquisitionPage.tsx`), each site individually self-consistent and therefore
 * invisible to a green test suite.
 */
export function developedAreaSqm(inputs: AnyCalculatorInputs): number {
  return areaBridge(inputs).developed_area_sqm;
}
