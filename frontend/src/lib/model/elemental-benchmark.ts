/** R17 spec §27. The elemental cost benchmark layer: a versioned benchmark
 *  set embedded in the document, per-element selections, index-ratio
 *  currentisation with an evidenced location multiplier, and a comparison
 *  against the cost plan that is ADVISORY — nothing computed here enters
 *  `construction_total_pence`, TDC, peak debt or profit (§27.4, `enters_tdc`
 *  is a pinned literal `false`). Mirrored field for field by
 *  `app/financial_model/elemental_benchmark.py`.
 *
 *  Three provider tiers (§27.1): `bcis_licensed` is a user-supplied, licensed
 *  BCIS export the application has not verified; `public_benchmark` names a
 *  real public publisher; `user_qs` is a QS, tender, quote or cost-plan rate
 *  set. No provider's rates ship in the repository (§27.9 limitation 1).
 */

import type { CostPlanResult, CostPackageCode, CostPlanInputs } from './cost-plan';
import type { ModelFlag } from './finance-types';
import { pct } from './pct';
import { SQFT_PER_SQM } from '../area-units';
import { monthsBetween } from './due-diligence';
import { canonicalHash } from '../sha256';

export type ProviderType = 'bcis_licensed' | 'public_benchmark' | 'user_qs';
export const PROVIDER_TYPES: readonly ProviderType[] = ['bcis_licensed', 'public_benchmark', 'user_qs'];

/** §27.4 / §12. The heading word the report may use. Never "BCIS" unless the
 *  provider is the licensed tier — and then always qualified as user-supplied. */
export const PROVIDER_LABEL: Readonly<Record<ProviderType, string>> = {
  bcis_licensed: 'User-supplied BCIS licensed benchmark',
  public_benchmark: 'Public benchmark',
  user_qs: 'User/QS benchmark',
};

export type BenchmarkProjectType = 'new_build' | 'refurbishment' | 'conversion';
export const BENCHMARK_PROJECT_TYPES: readonly BenchmarkProjectType[] = ['new_build', 'refurbishment', 'conversion'];

export type MeasurementBasis = 'area' | 'per_unit' | 'per_item' | 'percentage' | 'lump_sum';
export const MEASUREMENT_BASES: readonly MeasurementBasis[] = ['area', 'per_unit', 'per_item', 'percentage', 'lump_sum'];

export type OriginalUnit = 'gbp_per_sqm' | 'gbp_per_sqft' | 'gbp_per_unit' | 'gbp_per_item' | 'pct' | 'gbp';
export const ORIGINAL_UNITS: readonly OriginalUnit[] = ['gbp_per_sqm', 'gbp_per_sqft', 'gbp_per_unit', 'gbp_per_item', 'pct', 'gbp'];

/** §27.5 rule 3: the units a basis admits. */
export const UNITS_FOR_BASIS: Readonly<Record<MeasurementBasis, readonly OriginalUnit[]>> = {
  area: ['gbp_per_sqm', 'gbp_per_sqft'],
  per_unit: ['gbp_per_unit'],
  per_item: ['gbp_per_item'],
  percentage: ['pct'],
  lump_sum: ['gbp'],
};

export type QuantityUnit = 'sqm' | 'unit' | 'item' | 'each' | 'pct_base';
/** §27.5 rule 9: the quantity unit a basis requires. */
export const QUANTITY_UNIT_FOR_BASIS: Readonly<Record<MeasurementBasis, QuantityUnit>> = {
  area: 'sqm', per_unit: 'unit', per_item: 'item', percentage: 'pct_base', lump_sum: 'each',
};

export type RateEvidenceStatus = 'verified' | 'unverified' | 'draft' | 'estimated';
export const RATE_EVIDENCE_STATUSES: readonly RateEvidenceStatus[] = ['verified', 'unverified', 'draft', 'estimated'];

export type ElementCode =
  | 'facilitating_works' | 'surveys_investigations' | 'strip_out' | 'demolition' | 'asbestos_removal'
  | 'substructure_alterations' | 'frame_alterations' | 'upper_floors_strengthening' | 'roof_works'
  | 'stairs_ramps' | 'external_walls_facade' | 'windows_external_doors' | 'internal_walls_partitions'
  | 'internal_doors' | 'wall_finishes' | 'floor_finishes' | 'ceiling_finishes' | 'ffe' | 'kitchens'
  | 'bathrooms' | 'sanitary_installations' | 'mechanical_services' | 'electrical_services'
  | 'fire_alarm_life_safety' | 'sprinklers' | 'smoke_ventilation' | 'acoustic_upgrades'
  | 'thermal_part_l_upgrades' | 'drainage_alterations' | 'incoming_utility_upgrades' | 'lifts'
  | 'builders_work_in_connection' | 'preliminaries' | 'main_contractor_ohp'
  | 'design_development_allowance' | 'external_works' | 'landscaping' | 'risk_allowances'
  | 'other_conversion_works';

export interface ElementCatalogueEntry {
  code: ElementCode;
  label: string;
  default_basis: MeasurementBasis;
  default_package: CostPackageCode;
}

/** §27.1 (design §4.2). Thirty-nine conversion elements, fixed order. The
 *  default basis is a template suggestion; a rate row's own basis governs. */
export const ELEMENT_CATALOGUE: readonly ElementCatalogueEntry[] = [
  { code: 'facilitating_works', label: 'Facilitating works', default_basis: 'lump_sum', default_package: 'enabling_strip_out_asbestos' },
  { code: 'surveys_investigations', label: 'Surveys and investigations', default_basis: 'lump_sum', default_package: 'enabling_strip_out_asbestos' },
  { code: 'strip_out', label: 'Strip-out', default_basis: 'area', default_package: 'enabling_strip_out_asbestos' },
  { code: 'demolition', label: 'Demolition', default_basis: 'area', default_package: 'enabling_strip_out_asbestos' },
  { code: 'asbestos_removal', label: 'Asbestos removal', default_basis: 'lump_sum', default_package: 'enabling_strip_out_asbestos' },
  { code: 'substructure_alterations', label: 'Substructure alterations', default_basis: 'area', default_package: 'structure' },
  { code: 'frame_alterations', label: 'Structural frame alterations', default_basis: 'area', default_package: 'structure' },
  { code: 'upper_floors_strengthening', label: 'Upper floors and structural strengthening', default_basis: 'area', default_package: 'structure' },
  { code: 'roof_works', label: 'Roof works', default_basis: 'area', default_package: 'roof_windows' },
  { code: 'stairs_ramps', label: 'Stairs and ramps', default_basis: 'per_item', default_package: 'structure' },
  { code: 'external_walls_facade', label: 'External walls and façade', default_basis: 'area', default_package: 'envelope' },
  { code: 'windows_external_doors', label: 'Windows and external doors', default_basis: 'area', default_package: 'roof_windows' },
  { code: 'internal_walls_partitions', label: 'Internal walls and partitions', default_basis: 'area', default_package: 'partitions' },
  { code: 'internal_doors', label: 'Internal doors', default_basis: 'per_item', default_package: 'partitions' },
  { code: 'wall_finishes', label: 'Wall finishes', default_basis: 'area', default_package: 'finishes' },
  { code: 'floor_finishes', label: 'Floor finishes', default_basis: 'area', default_package: 'finishes' },
  { code: 'ceiling_finishes', label: 'Ceiling finishes', default_basis: 'area', default_package: 'finishes' },
  { code: 'ffe', label: 'Fittings, furnishings and equipment', default_basis: 'per_unit', default_package: 'finishes' },
  { code: 'kitchens', label: 'Kitchens', default_basis: 'per_unit', default_package: 'finishes' },
  { code: 'bathrooms', label: 'Bathrooms', default_basis: 'per_unit', default_package: 'finishes' },
  { code: 'sanitary_installations', label: 'Sanitary installations', default_basis: 'per_unit', default_package: 'mech_elec_public_health' },
  { code: 'mechanical_services', label: 'Mechanical services', default_basis: 'area', default_package: 'mech_elec_public_health' },
  { code: 'electrical_services', label: 'Electrical services', default_basis: 'area', default_package: 'mech_elec_public_health' },
  { code: 'fire_alarm_life_safety', label: 'Fire alarm and life-safety systems', default_basis: 'area', default_package: 'fire_acoustic_thermal' },
  { code: 'sprinklers', label: 'Sprinklers', default_basis: 'area', default_package: 'fire_acoustic_thermal' },
  { code: 'smoke_ventilation', label: 'Smoke ventilation', default_basis: 'lump_sum', default_package: 'fire_acoustic_thermal' },
  { code: 'acoustic_upgrades', label: 'Acoustic upgrades', default_basis: 'area', default_package: 'fire_acoustic_thermal' },
  { code: 'thermal_part_l_upgrades', label: 'Thermal and Part L upgrades', default_basis: 'area', default_package: 'fire_acoustic_thermal' },
  { code: 'drainage_alterations', label: 'Drainage alterations', default_basis: 'lump_sum', default_package: 'drainage_utilities' },
  { code: 'incoming_utility_upgrades', label: 'Incoming utility upgrades', default_basis: 'lump_sum', default_package: 'drainage_utilities' },
  { code: 'lifts', label: 'Lifts', default_basis: 'per_item', default_package: 'lift' },
  { code: 'builders_work_in_connection', label: "Builders' work in connection", default_basis: 'percentage', default_package: 'other' },
  { code: 'preliminaries', label: 'Preliminaries', default_basis: 'percentage', default_package: 'other' },
  { code: 'main_contractor_ohp', label: 'Main contractor overhead and profit', default_basis: 'percentage', default_package: 'other' },
  { code: 'design_development_allowance', label: 'Design-development allowance', default_basis: 'percentage', default_package: 'other' },
  { code: 'external_works', label: 'External works', default_basis: 'area', default_package: 'externals' },
  { code: 'landscaping', label: 'Landscaping', default_basis: 'area', default_package: 'externals' },
  { code: 'risk_allowances', label: 'Risk allowances', default_basis: 'percentage', default_package: 'other' },
  { code: 'other_conversion_works', label: 'Other conversion works', default_basis: 'lump_sum', default_package: 'other' },
];

export const ELEMENT_CODES: readonly ElementCode[] = ELEMENT_CATALOGUE.map((e) => e.code);
export const ELEMENT_BY_CODE: ReadonlyMap<ElementCode, ElementCatalogueEntry> =
  new Map(ELEMENT_CATALOGUE.map((e) => [e.code, e]));
/** The coverage denominator (§27.5 `incomplete_coverage`): every non-percentage element. */
export const CORE_ELEMENT_COUNT = ELEMENT_CATALOGUE.filter((e) => e.default_basis !== 'percentage').length;

export interface ElementalBenchmarkRate {
  id: string;
  element_code: ElementCode;
  element_label: string;
  description: string;
  measurement_basis: MeasurementBasis;
  original_unit: OriginalUnit;
  /** Pence for the money units; 0 on a percentage row. */
  original_rate_pence: number;
  /** Percentage rows only; null otherwise. */
  rate_pct: number | null;
  lower_quartile_rate_pence: number | null;
  median_rate_pence: number | null;
  upper_quartile_rate_pence: number | null;
  sample_count: number | null;
  /** Per-rate override of the set's factor; null = inherit. */
  location_factor: number | null;
  evidence_status: RateEvidenceStatus;
  source_reference: string;
  notes: string;
}

export interface ElementalBenchmarkSet {
  id: string;
  name: string;
  provider_type: ProviderType;
  provider_name: string;
  source_title: string;
  source_url: string | null;
  source_publication_date: string | null;
  retrieved_at: string | null;
  licence_or_permission: string;
  dataset_version: string;
  building_function: string;
  project_type: BenchmarkProjectType;
  specification_level: string;
  region: string;
  /** Index, 100 = national base. null = no evidenced adjustment. */
  location_factor: number | null;
  location_factor_source: string | null;
  /** The rates' pricing date. */
  base_date: string;
  base_index_name: string | null;
  base_index_value: number | null;
  current_index_name: string | null;
  current_index_value: number | null;
  index_dataset_version: string | null;
  currentisation_date: string | null;
  currency: 'GBP';
  notes: string;
  imported_by: string;
  created_at: string;
  source_file_sha256: string | null;
  /** §27.6: `canonicalHash` of the normalised set. */
  content_hash: string;
  rates: ElementalBenchmarkRate[];
}

export interface SchemeElementalCostSelection {
  element_code: ElementCode;
  /** null = selected but unpriced. */
  benchmark_rate_id: string | null;
  /** CANONICAL: m² for `area`, count for per_unit/per_item, 1 for lump_sum, 0 (unused) for percentage. */
  quantity: number;
  quantity_unit: QuantityUnit;
  adjustment_pct: number;
  adjustment_reason: string;
  include_in_cost_plan: boolean;
  target_cost_package_id: string | null;
  selected_by: string;
  selected_at: string;
}

export interface BenchmarkThresholds {
  material_variance_pct: number;
  stale_after_months: number;
  min_coverage_pct: number;
}

export const DEFAULT_THRESHOLDS: BenchmarkThresholds = {
  material_variance_pct: 15, stale_after_months: 12, min_coverage_pct: 60,
};

export interface BenchmarkOrigin {
  kind: 'benchmark';
  set_id: string;
  set_content_hash: string;
  benchmark_rate_id: string | null;
  element_code: ElementCode;
  applied_at: string;
  applied_by: string;
  /** §27.5 `applied_without_currentisation`: the set's method at apply time. */
  currentisation_method: 'index_ratio' | 'none';
}

export interface BenchmarkApplication {
  id: string;
  applied_at: string;
  applied_by: string;
  set_id: string;
  set_content_hash: string;
  element_codes: ElementCode[];
  created_package_ids: string[];
  replaced_package_ids: string[];
  previous_cost_plan: CostPlanInputs;
}

export interface SchemeElementalBenchmark {
  set: ElementalBenchmarkSet;
  selections: SchemeElementalCostSelection[];
  thresholds: BenchmarkThresholds;
  applications: BenchmarkApplication[];
  library_set_id: string | null;
}

// ---------------------------------------------------------------------------
// The result block (§27.4)
// ---------------------------------------------------------------------------

export type BenchmarkWarningCode =
  | 'benchmark_stale' | 'benchmark_age_unknown' | 'missing_source' | 'no_location_evidence'
  | 'project_type_mismatch' | 'new_build_benchmark_on_conversion' | 'incomplete_coverage'
  | 'material_variance' | 'rates_not_currentised' | 'source_unverified' | 'unpriced_elements'
  | 'applied_without_currentisation';

export interface BenchmarkWarning {
  code: BenchmarkWarningCode;
  severity: 'red' | 'amber';
  message: string;
}

export interface ElementalBenchmarkRow {
  element_code: ElementCode;
  element_label: string;
  measurement_basis: MeasurementBasis;
  original_unit: OriginalUnit;
  benchmark_rate_id: string | null;
  quantity: number;
  quantity_unit: QuantityUnit;
  original_rate_pence: number;
  rate_pct: number | null;
  canonical_rate_pence_per_sqm: number | null;
  currentised_rate_pence_per_sqm: number | null;
  adjustment_pct: number;
  adjustment_reason: string;
  adjusted_rate_pence_per_sqm: number | null;
  /** For non-area money bases the canonical/currentised/adjusted rate per unit
   *  or item (or the lump sum). Null on percentage rows and area rows. */
  currentised_rate_pence: number | null;
  adjusted_rate_pence: number | null;
  benchmark_amount_pence: number;
  target_cost_package_id: string | null;
  target_package_label: string | null;
  qs_amount_pence: number | null;
  variance_pence: number | null;
  variance_pct: number | null;
  forward_inflation_factor: number | null;
  forward_inflated_benchmark_amount_pence: number | null;
  lower_quartile_currentised_pence: number | null;
  median_currentised_pence: number | null;
  upper_quartile_currentised_pence: number | null;
  sample_count: number | null;
  evidence_status: RateEvidenceStatus;
  outside_range: boolean | null;
  source_reference: string;
}

export interface ElementalBenchmarkTotals {
  benchmark_base_construction_pence: number;
  elemental_subtotal_pence: number;
  qs_base_construction_pence: number;
  difference_pence: number;
  difference_pct: number | null;
  benchmark_rate_pence_per_sqm: number | null;
  qs_rate_pence_per_sqm: number | null;
  mapped_qs_amount_pence: number;
  unmapped_qs_amount_pence: number;
  unpriced_elements: number;
  elements_without_evidence: number;
  elements_outside_range: number;
  coverage_pct: number | null;
}

export interface ElementalBenchmarkResult {
  provider_type: ProviderType;
  provider_label: string;
  set_id: string;
  set_name: string;
  dataset_version: string;
  content_hash: string;
  library_set_id: string | null;
  building_function: string;
  project_type: BenchmarkProjectType;
  specification_level: string;
  region: string;
  base_date: string;
  currentisation_date: string | null;
  base_index_name: string | null;
  base_index_value: number | null;
  current_index_name: string | null;
  current_index_value: number | null;
  index_dataset_version: string | null;
  currentisation_factor: number | null;
  currentisation_method: 'index_ratio' | 'none';
  location_factor: number | null;
  location_multiplier: number;
  location_evidenced: boolean;
  area_sqm: number;
  cost_plan_mode: 'headline' | 'detailed';
  rows: ElementalBenchmarkRow[];
  totals: ElementalBenchmarkTotals;
  warnings: BenchmarkWarning[];
  thresholds: BenchmarkThresholds;
  enters_tdc: false;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Spec §1.1: half-up, the engine's one money rounding. */
function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** §27.3. A finite, positive index value or null. Zero/negative is a
 *  validation error (§27.5 rule 7); the engine degrades to no factor. */
function positiveOrNull(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/** §27.6. The canonical hash of a normalised set: `content_hash`, `id`,
 *  `created_at`, `imported_by` removed; rates sorted by element_code then id;
 *  every number as JSON renders it. Both engines compute this; the server
 *  computes it on import. */
export function benchmarkContentHash(set: ElementalBenchmarkSet): string {
  return canonicalHash(normalisedSet(set));
}

const SET_HASH_KEYS = [
  'name', 'provider_type', 'provider_name', 'source_title', 'source_url', 'source_publication_date',
  'retrieved_at', 'licence_or_permission', 'dataset_version', 'building_function', 'project_type',
  'specification_level', 'region', 'location_factor', 'location_factor_source', 'base_date',
  'base_index_name', 'base_index_value', 'current_index_name', 'current_index_value',
  'index_dataset_version', 'currentisation_date', 'currency', 'notes', 'source_file_sha256',
] as const;
const RATE_HASH_KEYS = [
  'id', 'element_code', 'element_label', 'description', 'measurement_basis', 'original_unit',
  'original_rate_pence', 'rate_pct', 'lower_quartile_rate_pence', 'median_rate_pence',
  'upper_quartile_rate_pence', 'sample_count', 'location_factor', 'evidence_status',
  'source_reference', 'notes',
] as const;

/** ONLY the interface's fields (a whitelist, mirrored by the pydantic model's
 *  field list in Python): a library read-back carrying extra server keys must
 *  hash identically to the import document. `content_hash`, `id`,
 *  `created_at` and `imported_by` are excluded; rates sorted by element_code
 *  then id. */
export function normalisedSet(set: ElementalBenchmarkSet): Record<string, unknown> {
  const pick = <T extends object>(obj: T, keys: readonly (keyof T)[]) =>
    Object.fromEntries(keys.map((k) => [k, obj[k] ?? null]));
  const sortedRates = [...set.rates]
    .map((r) => pick(r, RATE_HASH_KEYS as unknown as (keyof ElementalBenchmarkRate)[]))
    .sort((a, b) => (String(a.element_code) < String(b.element_code) ? -1 : String(a.element_code) > String(b.element_code) ? 1 : String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  return { ...pick(set, SET_HASH_KEYS as unknown as (keyof ElementalBenchmarkSet)[]), rates: sortedRates };
}

/** The user-facing standing sentence (§E of the brief; spec §12). */
export const BENCHMARK_LIMITATION_SENTENCE =
  'Benchmark rates are an initial reasonableness check, not a substitute for project-specific '
  + 'QS advice, surveys, design development, contractor pricing or lender monitoring.';

export const NO_LOCATION_SENTENCE = 'No evidenced location adjustment applied.';

interface EngineInputs {
  elemental_benchmark: SchemeElementalBenchmark | null;
  acquisition: { acquisition_date?: string | null };
}

export function computeElementalBenchmark(
  inputs: EngineInputs,
  costPlan: CostPlanResult,
  areaSqm: number,
): ElementalBenchmarkResult | null {
  const block = inputs.elemental_benchmark;
  if (block == null) return null;
  const set = block.set;
  const thresholds: BenchmarkThresholds = { ...DEFAULT_THRESHOLDS, ...block.thresholds };

  const baseIndex = positiveOrNull(set.base_index_value);
  const currentIndex = positiveOrNull(set.current_index_value);
  const currentisationFactor = baseIndex != null && currentIndex != null ? currentIndex / baseIndex : null;
  const method: 'index_ratio' | 'none' = currentisationFactor != null ? 'index_ratio' : 'none';
  const setLocation = positiveOrNull(set.location_factor);
  const setMultiplier = setLocation != null ? setLocation / 100 : 1;

  const rateById = new Map(set.rates.map((r) => [r.id, r]));
  const packageById = new Map(costPlan.packages.map((p) => [p.id, p]));
  const detailed = costPlan.mode === 'detailed';

  // First pass: every non-percentage row's amount; percentage rows need the subtotal.
  interface Draft { sel: SchemeElementalCostSelection; rate: ElementalBenchmarkRate | null; row: ElementalBenchmarkRow }
  const drafts: Draft[] = [];
  const ordered = [...block.selections].sort(
    (a, b) => ELEMENT_CODES.indexOf(a.element_code) - ELEMENT_CODES.indexOf(b.element_code),
  );
  for (const sel of ordered) {
    const rate = sel.benchmark_rate_id != null ? (rateById.get(sel.benchmark_rate_id) ?? null) : null;
    const entry = ELEMENT_BY_CODE.get(sel.element_code);
    const label = rate?.element_label || entry?.label || sel.element_code;
    const basis: MeasurementBasis = rate?.measurement_basis ?? entry?.default_basis ?? 'lump_sum';
    const unit: OriginalUnit = rate?.original_unit ?? UNITS_FOR_BASIS[basis][0];
    const rateLocation = rate != null ? positiveOrNull(rate.location_factor) : null;
    const multiplier = rateLocation != null ? rateLocation / 100 : setMultiplier;
    const factor = currentisationFactor ?? 1;

    let canonicalPerSqm: number | null = null;
    let currentisedPerSqm: number | null = null;
    let adjustedPerSqm: number | null = null;
    let currentisedRate: number | null = null;
    let adjustedRate: number | null = null;
    let amount = 0;
    const adj = 1 + sel.adjustment_pct / 100;
    if (rate != null && basis === 'area') {
      canonicalPerSqm = unit === 'gbp_per_sqft' ? rate.original_rate_pence * SQFT_PER_SQM : rate.original_rate_pence;
      currentisedPerSqm = canonicalPerSqm * factor * multiplier;
      adjustedPerSqm = currentisedPerSqm * adj;
      amount = roundHalfUp(adjustedPerSqm * sel.quantity);
    } else if (rate != null && (basis === 'per_unit' || basis === 'per_item' || basis === 'lump_sum')) {
      currentisedRate = rate.original_rate_pence * factor * multiplier;
      adjustedRate = currentisedRate * adj;
      const qty = basis === 'lump_sum' ? 1 : sel.quantity;
      amount = roundHalfUp(adjustedRate * qty);
    }
    // Percentage rows are filled in the second pass.

    const quartile = (q: number | null): number | null => {
      if (q == null || rate == null || basis === 'percentage') return null;
      const canonical = unit === 'gbp_per_sqft' ? q * SQFT_PER_SQM : q;
      return canonical * factor * multiplier;
    };
    const lq = quartile(rate?.lower_quartile_rate_pence ?? null);
    const md = quartile(rate?.median_rate_pence ?? null);
    const uq = quartile(rate?.upper_quartile_rate_pence ?? null);
    const compareRate = basis === 'area' ? currentisedPerSqm : currentisedRate;
    const outsideRange = lq != null && uq != null && compareRate != null
      ? (compareRate < lq || compareRate > uq)
      : null;

    const target = detailed && sel.target_cost_package_id != null
      ? (packageById.get(sel.target_cost_package_id) ?? null) : null;
    drafts.push({
      sel, rate,
      row: {
        element_code: sel.element_code,
        element_label: label,
        measurement_basis: basis,
        original_unit: unit,
        benchmark_rate_id: rate?.id ?? null,
        quantity: sel.quantity,
        quantity_unit: sel.quantity_unit,
        original_rate_pence: rate?.original_rate_pence ?? 0,
        rate_pct: rate?.rate_pct ?? null,
        canonical_rate_pence_per_sqm: canonicalPerSqm,
        currentised_rate_pence_per_sqm: currentisedPerSqm,
        adjustment_pct: sel.adjustment_pct,
        adjustment_reason: sel.adjustment_reason,
        adjusted_rate_pence_per_sqm: adjustedPerSqm,
        currentised_rate_pence: currentisedRate,
        adjusted_rate_pence: adjustedRate,
        benchmark_amount_pence: amount,
        target_cost_package_id: target?.id ?? null,
        target_package_label: target?.label ?? null,
        qs_amount_pence: target?.amount_pence ?? null,
        variance_pence: null,
        variance_pct: null,
        forward_inflation_factor: target?.inflation_factor ?? null,
        forward_inflated_benchmark_amount_pence: null,
        lower_quartile_currentised_pence: lq,
        median_currentised_pence: md,
        upper_quartile_currentised_pence: uq,
        sample_count: rate?.sample_count ?? null,
        evidence_status: rate?.evidence_status ?? 'unverified',
        outside_range: outsideRange,
        source_reference: rate?.source_reference ?? '',
      },
    });
  }

  const subtotal = drafts.reduce(
    (s, d) => s + (d.row.measurement_basis === 'percentage' ? 0 : d.row.benchmark_amount_pence), 0,
  );
  for (const d of drafts) {
    if (d.row.measurement_basis === 'percentage' && d.rate != null && d.rate.rate_pct != null) {
      const adj = 1 + d.sel.adjustment_pct / 100;
      d.row.benchmark_amount_pence = roundHalfUp(subtotal * (d.rate.rate_pct / 100) * adj);
    }
    if (d.row.qs_amount_pence != null) {
      d.row.variance_pence = d.row.benchmark_amount_pence - d.row.qs_amount_pence;
      d.row.variance_pct = pct(d.row.variance_pence, d.row.qs_amount_pence);
    }
    if (d.row.forward_inflation_factor != null) {
      d.row.forward_inflated_benchmark_amount_pence = roundHalfUp(d.row.benchmark_amount_pence * d.row.forward_inflation_factor);
    }
  }
  const rows = drafts.map((d) => d.row);

  const benchmarkTotal = rows.reduce((s, r) => s + r.benchmark_amount_pence, 0);
  const qsBase = costPlan.base_build_pence;
  const targeted = new Set(rows.map((r) => r.target_cost_package_id).filter((id): id is string => id != null));
  const mapped = [...targeted].reduce((s, id) => s + (packageById.get(id)?.amount_pence ?? 0), 0);
  const unpriced = drafts.filter((d) => d.rate == null
    || (d.row.measurement_basis !== 'percentage' && d.row.measurement_basis !== 'lump_sum' && d.sel.quantity <= 0)).length;
  const withoutEvidence = drafts.filter((d) => d.rate != null && d.rate.evidence_status !== 'verified').length;
  const outside = rows.filter((r) => r.outside_range === true).length;
  const pricedCore = drafts.filter((d) => d.rate != null && d.row.measurement_basis !== 'percentage'
    && (d.row.measurement_basis === 'lump_sum' || d.sel.quantity > 0)).length;
  const coverage = CORE_ELEMENT_COUNT > 0 ? Math.round((pricedCore / CORE_ELEMENT_COUNT) * 10000) / 100 : null;

  const totals: ElementalBenchmarkTotals = {
    benchmark_base_construction_pence: benchmarkTotal,
    elemental_subtotal_pence: subtotal,
    qs_base_construction_pence: qsBase,
    difference_pence: benchmarkTotal - qsBase,
    difference_pct: pct(benchmarkTotal - qsBase, qsBase),
    benchmark_rate_pence_per_sqm: areaSqm > 0 ? roundHalfUp(benchmarkTotal / areaSqm) : null,
    qs_rate_pence_per_sqm: costPlan.implied_rate_pence_per_sqm,
    mapped_qs_amount_pence: mapped,
    unmapped_qs_amount_pence: qsBase - mapped,
    unpriced_elements: unpriced,
    elements_without_evidence: withoutEvidence,
    elements_outside_range: outside,
    coverage_pct: coverage,
  };

  const warnings = benchmarkWarnings(block, set, method, totals, thresholds, inputs.acquisition.acquisition_date ?? null, drafts.map((d) => d.rate), costPlan);

  return {
    provider_type: set.provider_type,
    provider_label: PROVIDER_LABEL[set.provider_type],
    set_id: set.id,
    set_name: set.name,
    dataset_version: set.dataset_version,
    content_hash: set.content_hash,
    library_set_id: block.library_set_id,
    building_function: set.building_function,
    project_type: set.project_type,
    specification_level: set.specification_level,
    region: set.region,
    base_date: set.base_date,
    currentisation_date: set.currentisation_date,
    base_index_name: set.base_index_name,
    base_index_value: set.base_index_value,
    current_index_name: set.current_index_name,
    current_index_value: set.current_index_value,
    index_dataset_version: set.index_dataset_version,
    currentisation_factor: currentisationFactor,
    currentisation_method: method,
    location_factor: setLocation,
    location_multiplier: setMultiplier,
    location_evidenced: setLocation != null,
    area_sqm: areaSqm,
    cost_plan_mode: costPlan.mode,
    rows,
    totals,
    warnings,
    thresholds,
    enters_tdc: false,
  };
}

function benchmarkWarnings(
  block: SchemeElementalBenchmark,
  set: ElementalBenchmarkSet,
  method: 'index_ratio' | 'none',
  totals: ElementalBenchmarkTotals,
  thresholds: BenchmarkThresholds,
  acquisitionDate: string | null,
  rates: Array<ElementalBenchmarkRate | null>,
  costPlan: CostPlanResult,
): BenchmarkWarning[] {
  const out: BenchmarkWarning[] = [];
  const amber = (code: BenchmarkWarningCode, message: string) => out.push({ code, severity: 'amber', message });

  // Staleness against a date the DOCUMENT carries (§1.4: no wall clock).
  const reference = set.currentisation_date || acquisitionDate;
  const baseDate = typeof set.base_date === 'string' && set.base_date.trim() !== '' ? set.base_date : null;
  if (baseDate == null || reference == null) {
    amber('benchmark_age_unknown', 'Benchmark age cannot be measured: no currentisation date or acquisition date is recorded.');
  } else {
    const age = monthsBetween(baseDate, reference);
    if (age > thresholds.stale_after_months) {
      amber('benchmark_stale', `Benchmark base date ${baseDate} is ${age} months before ${reference} — over the ${thresholds.stale_after_months}-month staleness threshold.`);
    }
  }
  const blank = (s: string | null | undefined) => s == null || s.trim() === '';
  if (blank(set.source_title)
    || (set.provider_type === 'public_benchmark' && blank(set.source_url))
    || (set.provider_type === 'bcis_licensed' && blank(set.licence_or_permission))) {
    amber('missing_source', 'Benchmark source is incomplete: title, URL (public) or licence note (licensed) is missing.');
  }
  if (positiveOrNull(set.location_factor) == null) {
    amber('no_location_evidence', NO_LOCATION_SENTENCE);
  }
  if (set.project_type !== 'conversion') {
    amber('project_type_mismatch', `Benchmark project type is ${set.project_type}; this appraisal is a conversion.`);
  }
  if (set.project_type === 'new_build') {
    amber('new_build_benchmark_on_conversion', 'A conversion scheme is being benchmarked with new-build data; conversion works are not comparable.');
  }
  if (totals.coverage_pct != null && totals.coverage_pct < thresholds.min_coverage_pct) {
    amber('incomplete_coverage', `Only ${totals.coverage_pct}% of the non-percentage elements are priced — below the ${thresholds.min_coverage_pct}% coverage threshold.`);
  }
  if (totals.difference_pct != null && Math.abs(totals.difference_pct) > thresholds.material_variance_pct) {
    out.push({
      code: 'material_variance', severity: 'red',
      message: `Benchmark base build differs from the QS/developer figure by ${totals.difference_pct}% — beyond the ${thresholds.material_variance_pct}% material-variance threshold.`,
    });
  }
  if (method === 'none' && baseDate != null && set.currentisation_date != null && set.currentisation_date !== baseDate) {
    amber('rates_not_currentised', `Rates are compared at their base date ${baseDate}: no index ratio is available to currentise them to ${set.currentisation_date}.`);
  }
  if (rates.some((r) => r != null && (r.evidence_status === 'draft' || r.evidence_status === 'unverified'))) {
    amber('source_unverified', 'One or more selected rates are marked draft or unverified.');
  }
  if (totals.unpriced_elements > 0) {
    amber('unpriced_elements', `${totals.unpriced_elements} selected element(s) carry no rate or no quantity.`);
  }
  const appliedWithout = costPlan.packages.some((p) => {
    const origin = ('benchmark_origin' in p ? (p as { benchmark_origin?: BenchmarkOrigin | null }).benchmark_origin : null) ?? null;
    return origin != null && origin.currentisation_method === 'none';
  }) || block.applications.some((a) => a.element_codes.length > 0 && method === 'none' && a.set_content_hash === set.content_hash);
  if (appliedWithout) {
    amber('applied_without_currentisation', 'Benchmark rates were applied to the cost plan without currentisation.');
  }
  return out;
}

/** §27.5. Every warning surfaces as a flag: `benchmark_material_variance`
 *  (red) for the material one, `benchmark_warning` (amber) for the rest. */
export function benchmarkFlags(result: ElementalBenchmarkResult | null): ModelFlag[] {
  if (result == null) return [];
  return result.warnings.map((w) => ({
    code: w.code === 'material_variance' ? 'benchmark_material_variance' : 'benchmark_warning',
    severity: w.severity,
    month: null,
    amount_pence: w.code === 'material_variance' ? result.totals.difference_pence : null,
    message: w.message,
  }));
}
