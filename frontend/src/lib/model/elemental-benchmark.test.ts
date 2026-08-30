/**
 * R17 spec §27. The elemental benchmark engine, pinned on fixture AB (TEST
 * FIXTURE — NOT MARKET DATA) and on the spec's worked figures. Every money
 * figure asserted here is derived in test-cases.md §27 before either engine
 * runs; the ledger figures are identity-asserted (the advisory proof).
 */
import { describe, it, expect } from 'vitest';
import { runAppraisal } from './index';
import {
  computeElementalBenchmark, benchmarkFlags, benchmarkContentHash, normalisedSet,
  ELEMENT_CATALOGUE, ELEMENT_CODES, CORE_ELEMENT_COUNT, PROVIDER_LABEL, UNITS_FOR_BASIS,
  QUANTITY_UNIT_FOR_BASIS, DEFAULT_THRESHOLDS, BENCHMARK_LIMITATION_SENTENCE, NO_LOCATION_SENTENCE,
} from './elemental-benchmark';
import type { ElementalBenchmarkResult, ElementalBenchmarkSet, SchemeElementalBenchmark } from './elemental-benchmark';
import { docAB, docABWithoutBenchmark, docABWith, abSet } from './__fixtures__/elemental-benchmark-docs';
import { SQFT_PER_SQM } from '../area-units';

const AB_CONTENT_HASH = '087c57e76aeb98e5814faf68991481d579a28ad4c650c186f4d38acd9e3d6baf';

function resultOf(doc = docAB()): ElementalBenchmarkResult {
  const r = runAppraisal(doc).metrics.elemental_benchmark;
  if (r == null) throw new Error('AB carries a benchmark block');
  return r;
}

describe('R17 — the element catalogue', () => {
  it('has thirty-nine fixed codes in the spec order, four of them percentage', () => {
    expect(ELEMENT_CATALOGUE).toHaveLength(39);
    expect(ELEMENT_CODES[0]).toBe('facilitating_works');
    expect(ELEMENT_CODES[38]).toBe('other_conversion_works');
    expect(new Set(ELEMENT_CODES).size).toBe(39);
    expect(ELEMENT_CATALOGUE.filter((e) => e.default_basis === 'percentage').map((e) => e.code)).toEqual([
      'builders_work_in_connection', 'preliminaries', 'main_contractor_ohp', 'design_development_allowance', 'risk_allowances',
    ]);
    expect(CORE_ELEMENT_COUNT).toBe(34);
  });

  it('pairs every basis with its units and quantity unit', () => {
    expect(UNITS_FOR_BASIS.area).toEqual(['gbp_per_sqm', 'gbp_per_sqft']);
    expect(UNITS_FOR_BASIS.percentage).toEqual(['pct']);
    expect(QUANTITY_UNIT_FOR_BASIS.area).toBe('sqm');
    expect(QUANTITY_UNIT_FOR_BASIS.lump_sum).toBe('each');
  });

  it('labels the three providers without calling public or user data BCIS', () => {
    expect(PROVIDER_LABEL.bcis_licensed).toBe('User-supplied BCIS licensed benchmark');
    expect(PROVIDER_LABEL.public_benchmark).not.toMatch(/BCIS/);
    expect(PROVIDER_LABEL.user_qs).not.toMatch(/BCIS/);
    expect(BENCHMARK_LIMITATION_SENTENCE).toMatch(/not a substitute for project-specific QS advice/);
    expect(NO_LOCATION_SENTENCE).toBe('No evidenced location adjustment applied.');
  });
});

describe('R17 — fixture AB (spec §27.3, test-cases.md §27)', () => {
  it('currentises by the index ratio and the location multiplier', () => {
    const r = resultOf();
    expect(r.currentisation_factor).toBeCloseTo(1.05, 12);
    expect(r.currentisation_method).toBe('index_ratio');
    expect(r.location_multiplier).toBeCloseTo(0.95, 12);
    expect(r.location_evidenced).toBe(true);
    expect(r.provider_label).toBe('User/QS benchmark');
    expect(r.area_sqm).toBe(600);
    expect(r.cost_plan_mode).toBe('detailed');
  });

  it('prices every row with one rounding, the ft² row canonicalised to m² first', () => {
    const r = resultOf();
    const byCode = new Map(r.rows.map((row) => [row.element_code, row]));
    // 8,000 p/m² × 1.05 × 0.95 = 7,980 p/m²; × 600 m² = 4,788,000 p
    expect(byCode.get('strip_out')!.currentised_rate_pence_per_sqm).toBeCloseTo(7980, 9);
    expect(byCode.get('strip_out')!.benchmark_amount_pence).toBe(4_788_000);
    // 2,500 p/ft² × 10.7639104167097 = 26,909.776… p/m²; × 0.9975 = 26,842.5016…; × 600 = 16,105,500.96 → 16,105,501
    const frame = byCode.get('frame_alterations')!;
    expect(frame.original_unit).toBe('gbp_per_sqft');
    expect(frame.canonical_rate_pence_per_sqm).toBeCloseTo(2500 * SQFT_PER_SQM, 9);
    expect(frame.benchmark_amount_pence).toBe(16_105_501);
    // 25,000 × 0.9975 = 24,937.5; −10% = 22,443.75; × 600 = 13,466,250 exactly
    const facade = byCode.get('external_walls_facade')!;
    expect(facade.adjustment_pct).toBe(-10);
    expect(facade.adjusted_rate_pence_per_sqm).toBeCloseTo(22_443.75, 9);
    expect(facade.benchmark_amount_pence).toBe(13_466_250);
    expect(byCode.get('mechanical_services')!.benchmark_amount_pence).toBe(10_773_000);
    // per-unit: 800,000 × 0.9975 = 798,000 × 4 units
    expect(byCode.get('kitchens')!.benchmark_amount_pence).toBe(3_192_000);
    expect(byCode.get('kitchens')!.canonical_rate_pence_per_sqm).toBeNull();
    // lump sum: 5,000,000 × 0.9975
    expect(byCode.get('external_works')!.benchmark_amount_pence).toBe(4_987_500);
    // percentage: 12% of the non-percentage subtotal 53,312,251 = 6,397,470.12 → 6,397,470
    expect(r.totals.elemental_subtotal_pence).toBe(53_312_251);
    expect(byCode.get('preliminaries')!.benchmark_amount_pence).toBe(6_397_470);
    expect(r.totals.benchmark_base_construction_pence).toBe(59_709_721);
  });

  it('compares against the plan without moving it', () => {
    const r = resultOf();
    expect(r.totals.qs_base_construction_pence).toBe(69_192_000);
    expect(r.totals.difference_pence).toBe(-9_482_279);
    expect(r.totals.difference_pct).toBe(-13.7);
    expect(r.totals.benchmark_rate_pence_per_sqm).toBe(99_516);
    expect(r.totals.qs_rate_pence_per_sqm).toBe(115_320);
    expect(r.totals.mapped_qs_amount_pence).toBe(69_192_000);
    expect(r.totals.unmapped_qs_amount_pence).toBe(0);
    expect(r.totals.unpriced_elements).toBe(0);
    expect(r.totals.elements_without_evidence).toBe(2);
    expect(r.totals.elements_outside_range).toBe(1);
    expect(r.totals.coverage_pct).toBe(17.65);
    expect(r.enters_tdc).toBe(false);
  });

  it('reads the forward factor off the mapped package and never adds it to the amount', () => {
    const r = resultOf();
    const kitchens = r.rows.find((row) => row.element_code === 'kitchens')!;
    // pkg-bm-kitchens: base 2026-06-01 → month 0 is 2 months; midpoint 10.5 → 12.5 months; 1.06^(12.5/12)
    expect(kitchens.forward_inflation_factor).toBeCloseTo(1.06 ** (12.5 / 12), 12);
    expect(kitchens.forward_inflated_benchmark_amount_pence).toBe(3_391_745);
    expect(kitchens.benchmark_amount_pence).toBe(3_192_000);
    expect(kitchens.qs_amount_pence).toBe(3_192_000);
    expect(kitchens.variance_pence).toBe(0);
  });

  it('raises exactly the three warnings the fixture is built to raise', () => {
    const r = resultOf();
    expect(r.warnings.map((w) => w.code)).toEqual(['incomplete_coverage', 'material_variance', 'source_unverified']);
    expect(r.warnings.find((w) => w.code === 'material_variance')!.severity).toBe('red');
    expect(r.thresholds.material_variance_pct).toBe(10);
    const flags = benchmarkFlags(r);
    expect(flags.map((f) => f.code)).toEqual(['benchmark_warning', 'benchmark_material_variance', 'benchmark_warning']);
    expect(flags[1].amount_pence).toBe(-9_482_279);
    expect(runAppraisal(docAB()).metrics.flags.filter((f) => f.code === 'benchmark_material_variance')).toHaveLength(1);
  });

  it('the advisory proof: every ledger figure is identical with the block removed', () => {
    const withBlock = runAppraisal(docAB());
    const without = runAppraisal(docABWithoutBenchmark());
    expect(without.metrics.elemental_benchmark).toBeNull();
    const strip = (m: Record<string, unknown>) => { const { elemental_benchmark: _b, flags: _f, ...rest } = m; void _b; void _f; return rest; };
    expect(strip(withBlock.metrics as unknown as Record<string, unknown>)).toEqual(strip(without.metrics as unknown as Record<string, unknown>));
    expect(withBlock.model).toEqual(without.model);
    expect(withBlock.schedule).toEqual(without.schedule);
    expect(withBlock.metrics.cost_plan.construction_total_pence).toBe(69_192_000 + 4_321_187 + 3_459_600);
  });

  it('pins the content hash both engines compute', () => {
    expect(abSet().content_hash).toBe(AB_CONTENT_HASH);
    expect(benchmarkContentHash(abSet())).toBe(AB_CONTENT_HASH);
    const renamed = { ...abSet(), id: 'other', created_at: 'later', imported_by: 'someone else' };
    expect(benchmarkContentHash(renamed)).toBe(AB_CONTENT_HASH);
    const changed = { ...abSet(), rates: abSet().rates.map((r, i) => (i === 0 ? { ...r, original_rate_pence: r.original_rate_pence + 1 } : r)) };
    expect(benchmarkContentHash(changed)).not.toBe(AB_CONTENT_HASH);
    expect(Object.keys(normalisedSet(abSet()))).not.toContain('content_hash');
  });
});

describe('R17 — unit invariance (spec §27.2)', () => {
  function areaDoc(unit: 'gbp_per_sqm' | 'gbp_per_sqft', pence: number) {
    return docABWith((b) => {
      b.set.rates = [{ ...b.set.rates[0], id: 'r1', element_code: 'strip_out', measurement_basis: 'area', original_unit: unit, original_rate_pence: pence, lower_quartile_rate_pence: null, median_rate_pence: null, upper_quartile_rate_pence: null, sample_count: null }];
      b.set.base_index_value = null; b.set.current_index_value = null; b.set.location_factor = null;
      b.selections = [{ ...b.selections[0], element_code: 'strip_out', benchmark_rate_id: 'r1', quantity: 620, quantity_unit: 'sqm', target_cost_package_id: null }];
      b.applications = [];
    });
  }

  it('620 m² × £1,250/m² is £775,000 exactly, and the same rate quoted per ft² prices identically', () => {
    const metric = resultOf(areaDoc('gbp_per_sqm', 125_000));
    expect(metric.rows[0].benchmark_amount_pence).toBe(77_500_000);
    // £116.128… per ft² is NOT a whole-pence figure; the fixture quotes the exact
    // pence-per-ft² that canonicalises back to 125,000 p/m² within an ulp.
    const perSqft = 125_000 / SQFT_PER_SQM;
    const imperial = resultOf(areaDoc('gbp_per_sqft', perSqft));
    expect(imperial.rows[0].canonical_rate_pence_per_sqm).toBeCloseTo(125_000, 6);
    expect(imperial.rows[0].benchmark_amount_pence).toBe(77_500_000);
  });

  it('a percentage row, a per-unit row and a lump sum carry no area and are untouched by the unit', () => {
    const r = resultOf();
    for (const code of ['kitchens', 'external_works', 'preliminaries']) {
      const row = r.rows.find((x) => x.element_code === code)!;
      expect(row.canonical_rate_pence_per_sqm).toBeNull();
      expect(row.currentised_rate_pence_per_sqm).toBeNull();
    }
  });
});

describe('R17 — degrade and warning paths (spec §27.3/§27.5)', () => {
  it('a missing base or current index means no factor, method none, and the rates-not-currentised warning', () => {
    const noBase = resultOf(docABWith((b) => { b.set.base_index_value = null; }));
    expect(noBase.currentisation_factor).toBeNull();
    expect(noBase.currentisation_method).toBe('none');
    expect(noBase.warnings.map((w) => w.code)).toContain('rates_not_currentised');
    // rates compared at the base date: 8,000 × 0.95 × 600 = 4,560,000
    expect(noBase.rows[0].benchmark_amount_pence).toBe(4_560_000);
    const noCurrent = resultOf(docABWith((b) => { b.set.current_index_value = null; }));
    expect(noCurrent.currentisation_method).toBe('none');
  });

  it('a zero, negative or non-finite index degrades to no factor without throwing', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = resultOf(docABWith((b) => { b.set.base_index_value = bad; }));
      expect(r.currentisation_factor).toBeNull();
      expect(r.currentisation_method).toBe('none');
    }
  });

  it('a null location factor multiplies by 1 and says so', () => {
    const r = resultOf(docABWith((b) => { b.set.location_factor = null; }));
    expect(r.location_multiplier).toBe(1);
    expect(r.location_evidenced).toBe(false);
    expect(r.warnings.find((w) => w.code === 'no_location_evidence')!.message).toBe(NO_LOCATION_SENTENCE);
    // 8,000 × 1.05 × 600
    expect(r.rows[0].benchmark_amount_pence).toBe(5_040_000);
  });

  it('a per-rate location factor overrides the set', () => {
    const r = resultOf(docABWith((b) => { b.set.rates[0].location_factor = 110; }));
    // 8,000 × 1.05 × 1.10 × 600 = 5,544,000
    expect(r.rows[0].benchmark_amount_pence).toBe(5_544_000);
    expect(r.location_multiplier).toBeCloseTo(0.95, 12);
  });

  it('staleness is measured against the currentisation date, on the document, and 12 months is not stale', () => {
    expect(resultOf().warnings.map((w) => w.code)).not.toContain('benchmark_stale');
    const stale = resultOf(docABWith((b) => { b.set.base_date = '2025-05-01'; }));
    expect(stale.warnings.find((w) => w.code === 'benchmark_stale')!.message).toMatch(/13 months before 2026-06-01/);
    const unknown = resultOf(docABWith((b) => { b.set.currentisation_date = null; b.set.base_index_value = null; }));
    // acquisition_date 2026-08-01 is the fallback reference: 14 months → stale, not unknown
    expect(unknown.warnings.map((w) => w.code)).toContain('benchmark_stale');
    const ageUnknown = resultOf({ ...docABWith((b) => { b.set.currentisation_date = null; }), acquisition: { ...docAB().acquisition, acquisition_date: null } });
    expect(ageUnknown.warnings.map((w) => w.code)).toContain('benchmark_age_unknown');
  });

  it('project type: new-build data on a conversion raises both warnings; refurbishment one', () => {
    const nb = resultOf(docABWith((b) => { b.set.project_type = 'new_build'; }));
    expect(nb.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['project_type_mismatch', 'new_build_benchmark_on_conversion']));
    const refurb = resultOf(docABWith((b) => { b.set.project_type = 'refurbishment'; }));
    expect(refurb.warnings.map((w) => w.code)).toContain('project_type_mismatch');
    expect(refurb.warnings.map((w) => w.code)).not.toContain('new_build_benchmark_on_conversion');
  });

  it('missing source fires per provider tier', () => {
    const pub = resultOf(docABWith((b) => { b.set.provider_type = 'public_benchmark'; b.set.source_url = null; }));
    expect(pub.warnings.map((w) => w.code)).toContain('missing_source');
    expect(pub.provider_label).toBe('Public benchmark');
    const lic = resultOf(docABWith((b) => { b.set.provider_type = 'bcis_licensed'; b.set.licence_or_permission = ''; }));
    expect(lic.warnings.map((w) => w.code)).toContain('missing_source');
    expect(lic.provider_label).toBe('User-supplied BCIS licensed benchmark');
    expect(resultOf().warnings.map((w) => w.code)).not.toContain('missing_source');
  });

  it('an unpriced selection and a zero quantity are counted and warned', () => {
    const r = resultOf(docABWith((b) => { b.selections[0].benchmark_rate_id = null; b.selections[1].quantity = 0; }));
    expect(r.totals.unpriced_elements).toBe(2);
    expect(r.warnings.map((w) => w.code)).toContain('unpriced_elements');
    expect(r.rows[0].benchmark_amount_pence).toBe(0);
    expect(r.rows[1].benchmark_amount_pence).toBe(0);
  });

  it('the material threshold is the document\'s: at 15% AB\'s −13.7% is not material', () => {
    const r = resultOf(docABWith((b) => { b.thresholds.material_variance_pct = 15; }));
    expect(r.warnings.map((w) => w.code)).not.toContain('material_variance');
    expect(r.totals.difference_pct).toBe(-13.7);
  });

  it('applied-without-currentisation fires when an applied package records method none', () => {
    const doc = docAB();
    const packages = doc.cost_plan.packages.map((p) => (p.id === 'pkg-bm-kitchens' && p.benchmark_origin != null
      ? { ...p, benchmark_origin: { ...p.benchmark_origin, currentisation_method: 'none' as const } } : p));
    const r = resultOf({ ...doc, cost_plan: { ...doc.cost_plan, packages } });
    expect(r.warnings.map((w) => w.code)).toContain('applied_without_currentisation');
    expect(resultOf().warnings.map((w) => w.code)).not.toContain('applied_without_currentisation');
  });

  it('headline mode compares the total only and invents no elemental allocation', () => {
    const doc = docAB();
    const headline = {
      ...doc,
      cost_plan: { ...doc.cost_plan, mode: 'headline' as const, packages: [], qs: null },
      conversion_costs: { ...doc.conversion_costs, construction_cost_per_sqm_pence: 110_000 },
      elemental_benchmark: { ...doc.elemental_benchmark!, selections: doc.elemental_benchmark!.selections.map((s) => ({ ...s, target_cost_package_id: null })), applications: [] },
    };
    const r = resultOf(headline);
    expect(r.cost_plan_mode).toBe('headline');
    expect(r.totals.qs_base_construction_pence).toBe(66_000_000);
    expect(r.rows.every((row) => row.qs_amount_pence === null && row.variance_pence === null)).toBe(true);
    expect(r.totals.mapped_qs_amount_pence).toBe(0);
    expect(r.totals.benchmark_base_construction_pence).toBe(59_709_721);
  });

  it('null block → null result and no flags', () => {
    const doc = docABWithoutBenchmark();
    expect(runAppraisal(doc).metrics.elemental_benchmark).toBeNull();
    expect(benchmarkFlags(null)).toEqual([]);
    expect(computeElementalBenchmark({ elemental_benchmark: null, acquisition: {} }, runAppraisal(doc).metrics.cost_plan, 600)).toBeNull();
  });

  it('the defaults are the spec\'s', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ material_variance_pct: 15, stale_after_months: 12, min_coverage_pct: 60 });
    const set: ElementalBenchmarkSet = abSet();
    const block: SchemeElementalBenchmark = { set, selections: [], thresholds: DEFAULT_THRESHOLDS, applications: [], library_set_id: null };
    const r = computeElementalBenchmark({ elemental_benchmark: block, acquisition: {} }, runAppraisal(docAB()).metrics.cost_plan, 600)!;
    expect(r.rows).toEqual([]);
    expect(r.totals.coverage_pct).toBe(0);
    expect(r.totals.benchmark_base_construction_pence).toBe(0);
  });
});
