import type {
  AcquisitionInputs,
  UnitMixInputs,
  ConversionCostInputs,
  FinanceInputs,
  ExitStrategyInputs,
  RiskItem,
  ScenarioOverrides,
  DealSpiderInputs,
  CalculatorInputs,
} from './conversion-types';
import { DEFAULT_AREA_BRIDGE } from './model/areas';
import { DEFAULT_UNIT_ANCILLARY } from './conversion-types';
import { CLASS_MA_AXES } from './spider-axes';
import type {
  CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV4, CalculatorInputsV5,
  CalculatorInputsV6, CalculatorInputsV7, CalculatorInputsV8, CalculatorInputsV9,
  CalculatorInputsV10, CalculatorInputsV11, CalculatorInputsV12, CalculatorInputsV13,
  EquitySource, FacilityTerms,
} from './model/finance-types';
import { costPlanFromLegacyCosts } from './model/cost-plan';
import { defaultVatInputs } from './model/vat';
import type { SourceRecord } from './model/due-diligence';
// Imported from due-diligence.ts, NOT migrate.ts, for the same cycle reason
// defaultCalculatorInputsV11's own docstring gives: migrate.ts imports THIS
// module (defaultCalculatorInputsV2), so importing migrate.ts back here
// would be circular. due-diligence.ts imports neither.
import { defaultDueDiligence } from './model/due-diligence';
import type { Project } from '../types';

export const DEFAULT_ACQUISITION: AcquisitionInputs = {
  purchase_price_pence: 0,
  legal_fees_pence: 500_000,
  survey_cost_pence: 300_000,
  broker_fee_pct: 1.0,
  other_acquisition_costs_pence: 0,
};

export const DEFAULT_UNIT_MIX: UnitMixInputs = {
  units: [],
};

export const DEFAULT_CONVERSION_COSTS: ConversionCostInputs = {
  prior_approval_fee_per_dwelling_pence: 9_600,
  cil_s106_pence: 0,
  architect_pence: 1_500_000,
  structural_engineer_pence: 500_000,
  mande_pence: 500_000,
  planning_consultant_pence: 300_000,
  building_control_pence: 200_000,
  other_professional_fees_pence: 0,
  construction_cost_per_sqm_pence: 80_730,
  total_construction_sqm: 0,
  contingency_pct: 10.0,
  fire_safety_pence: 0,
  sound_insulation_pence: 0,
  part_l_compliance_pence: 0,
};

export const DEFAULT_FINANCE: FinanceInputs = {
  funding_source: 'bridging',
  ltv_pct: 70.0,
  interest_rate_annual_pct: 8.0,
  arrangement_fee_pct: 2.0,
  exit_fee_pct: 1.0,
  loan_term_months: 12,
  interest_type: 'rolled_up',
};

export const DEFAULT_EXIT_STRATEGY: ExitStrategyInputs = {
  route: 'sell_all',
  selling_agent_fee_pct: 1.5,
  selling_legal_fee_pence: 150_000,
  retained_units: [],
};

export const DEFAULT_RISK_REGISTER: RiskItem[] = [
  {
    id: crypto.randomUUID(),
    description: 'Prior approval refusal',
    likelihood: 'medium',
    impact: 'high',
    mitigation: 'Pre-application consultation with LPA',
  },
  {
    id: crypto.randomUUID(),
    description: 'Article 4 direction introduced mid-project',
    likelihood: 'low',
    impact: 'high',
    mitigation: 'Monitor LPA consultations and planning policy changes',
  },
  {
    id: crypto.randomUUID(),
    description: 'Construction cost overrun',
    likelihood: 'medium',
    impact: 'medium',
    mitigation: 'Fixed-price contract with contingency allowance',
  },
  {
    id: crypto.randomUUID(),
    description: 'GDV falls due to market movement',
    likelihood: 'medium',
    impact: 'high',
    mitigation: 'Conservative comparable evidence, stress test scenarios',
  },
  {
    id: crypto.randomUUID(),
    description: 'Void periods on retained units',
    likelihood: 'medium',
    impact: 'low',
    mitigation: 'Realistic rental assumptions, marketing budget',
  },
];

export const DEFAULT_SCENARIOS: {
  base: ScenarioOverrides;
  upside: ScenarioOverrides;
  downside: ScenarioOverrides;
  severe: ScenarioOverrides;
} = {
  base: {
    label: 'Base Case',
    gdv_adjustment_pct: 0,
    construction_cost_adjustment_pct: 0,
    timeline_adjustment_months: 0,
    interest_rate_adjustment_pct: 0,
    phase_slip_phase_id: null,
    phase_slip_months: 0,
    exit_yield_adjustment_pct: 0,
    operating_cost_adjustment_pct: 0,
    vacancy_adjustment_pct: 0,
    sales_slip_months: 0,
  },
  upside: {
    label: 'Upside',
    gdv_adjustment_pct: 10,
    construction_cost_adjustment_pct: -5,
    timeline_adjustment_months: -2,
    interest_rate_adjustment_pct: 0,
    phase_slip_phase_id: null,
    phase_slip_months: 0,
    exit_yield_adjustment_pct: 0,
    operating_cost_adjustment_pct: 0,
    vacancy_adjustment_pct: 0,
    sales_slip_months: 0,
  },
  downside: {
    label: 'Downside',
    gdv_adjustment_pct: -10,
    construction_cost_adjustment_pct: 15,
    timeline_adjustment_months: 3,
    interest_rate_adjustment_pct: 1,
    phase_slip_phase_id: null,
    phase_slip_months: 0,
    exit_yield_adjustment_pct: 0,
    operating_cost_adjustment_pct: 0,
    vacancy_adjustment_pct: 0,
    sales_slip_months: 0,
  },
  severe: {
    label: 'Severe',
    gdv_adjustment_pct: -15,
    construction_cost_adjustment_pct: 20,
    timeline_adjustment_months: 6,
    interest_rate_adjustment_pct: 2,
    phase_slip_phase_id: null,
    phase_slip_months: 0,
    exit_yield_adjustment_pct: 0,
    operating_cost_adjustment_pct: 0,
    vacancy_adjustment_pct: 0,
    sales_slip_months: 0,
  },
};

export function defaultSpiderWeights(): Record<string, number> {
  return Object.fromEntries(CLASS_MA_AXES.map((axis) => [axis.id, 1]));
}

export const DEFAULT_DEAL_SPIDER: DealSpiderInputs = {
  storeys: 2,
  building_height_m: 7,
  bsa_higher_risk: false,
  daylight_pass_pct: 100,
  absorption_months: 9,
  exit_sell: true,
  exit_refinance: true,
  exit_hold: false,
  exit_part_sale: false,
  prior_approval_window_months: 2,
  programme_contingency_months: 1,
  cil_offset_pence: 0,
  target_profit_on_cost_pct: 20,
  weights: defaultSpiderWeights(),
};

export function defaultCalculatorInputs(project?: {
  id: string;
  price_pence: number;
  floor_area_sqm: number | null;
  floors?: number | null;
}): CalculatorInputs {
  const storeys = project?.floors ?? DEFAULT_DEAL_SPIDER.storeys;
  return {
    project_id: project?.id ?? null,
    acquisition: {
      ...DEFAULT_ACQUISITION,
      purchase_price_pence: project?.price_pence ?? 0,
    },
    unit_mix: { ...DEFAULT_UNIT_MIX },
    conversion_costs: {
      ...DEFAULT_CONVERSION_COSTS,
      total_construction_sqm: project?.floor_area_sqm ?? 0,
    },
    finance: { ...DEFAULT_FINANCE },
    exit_strategy: { ...DEFAULT_EXIT_STRATEGY },
    risks: DEFAULT_RISK_REGISTER.map((r) => ({ ...r, id: crypto.randomUUID() })),
    scenarios: {
      base: { ...DEFAULT_SCENARIOS.base },
      upside: { ...DEFAULT_SCENARIOS.upside },
      downside: { ...DEFAULT_SCENARIOS.downside },
      severe: { ...DEFAULT_SCENARIOS.severe },
    },
    deal_spider: {
      ...DEFAULT_DEAL_SPIDER,
      storeys,
      building_height_m: storeys * 3.5,
      weights: defaultSpiderWeights(),
    },
  };
}

export const DEFAULT_FACILITY_TERMS: FacilityTerms = {
  funding_source: 'development_finance',
  day_one_advance_pence: null,
  day_one_market_value_pence: null,
  development_cost_advance_pct: 100,
  committed_net_facility_pence: null,
  committed_gross_facility_pence: null,
  annual_interest_rate_pct: 8.0,
  interest_type: 'rolled_up',
  arrangement_fee_pct: 2.0,
  arrangement_fee_basis: 'committed_net_facility',
  exit_fee_pct: 1.0,
  exit_fee_basis: 'committed_gross_facility',
  broker_fee_pence: 0,
  lender_legal_fee_pence: 0,
  valuation_fee_pence: 0,
  monitoring_surveyor_fee_pence: 0,
  interest_reserve_pence: null,
  term_months: 12,
  equity_draw_rule: 'equity_first',
  sales_sweep_pct: 100,
  legacy_leverage_pct: null,
  requires_confirmation: false,
  enforcement_cost_assumption_pence: 0,
};

export function defaultEquitySources(): EquitySource[] {
  return [{
    id: crypto.randomUUID(),
    classification: 'cash',
    amount_pence: 0,
    timing_month: 0,
    repayment_priority: 1,
    evidence_status: 'unconfirmed',
    notes: '',
  }];
}

export function defaultCalculatorInputsV2(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV2 {
  const v1 = defaultCalculatorInputs(project);
  return {
    inputs_version: 2,
    project_id: v1.project_id,
    acquisition: v1.acquisition,
    unit_mix: v1.unit_mix,
    conversion_costs: v1.conversion_costs,
    finance: { ...DEFAULT_FACILITY_TERMS },
    equity_sources: defaultEquitySources(),
    exit_strategy: v1.exit_strategy,
    risks: v1.risks,
    scenarios: v1.scenarios,
    deal_spider: v1.deal_spider,
  };
}

/** v3 defaults (Release 2b): identical to v2 plus `lender_valuation: null` — no lender
 * valuation recorded until a user enters one (spec §2: never silently defaulted). */
export function defaultCalculatorInputsV3(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV3 {
  const v2 = defaultCalculatorInputsV2(project);
  return { ...v2, inputs_version: 3, lender_valuation: null };
}

/** v4 defaults (Release 3b): v3 plus the three nullable blocks. null programme =
 * auto §6 windows; null sales_phasing = single final-month tranche; null
 * refinance = no event (spec §6.1, §4.4.1, §4.5). */
export function defaultCalculatorInputsV4(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV4 {
  const v3 = defaultCalculatorInputsV3(project);
  return { ...v3, inputs_version: 4, programme: null, sales_phasing: null, refinance: null };
}

/**
 * v5 defaults (R8 Task 11): the document a freshly opened calculator starts on.
 *
 * The acquisition-tax block is deliberately identical to what `migrateV4toV5`
 * stamps on a v4 document. (Fix round 1 deleted the unused
 * `defaultAcquisitionV5Fields` helper that used to sit above this one: it
 * returned `jurisdiction: 'england_ni'` together with
 * `jurisdiction_source: 'derived'` unconditionally, so any caller taking its
 * doc comment at its word would have produced a document claiming England/NI
 * was derived when nothing derived it — and simultaneously suppressed the
 * server's real derivation. Both reasons below are why.)
 *
 *  - `jurisdiction_source: 'migrated_default'` means "nothing has recorded a
 *    jurisdiction for this document yet", which is exactly true of a brand new
 *    one. It is also the only value the server will overwrite with a
 *    postcode-derived proposal (`calculate_authoritative` in app/api/app.py
 *    applies `derived_jurisdiction` only when the source is
 *    `'migrated_default'`), so stamping `'derived'` here client-side would
 *    silently disable R8 Task 10's postcode derivation on every new appraisal.
 *  - `acquisition_date: null` rather than today's date. Today is not the
 *    transaction date; it is a plausible substitute for one, and spec §1.5
 *    forbids substituting a plausible value for an unknown. Null is already
 *    defined as "use the currently open-ended band set and say so"
 *    (`date_basis: 'assumed_current'`), which is the honest reading.
 *
 * `conversion-defaults.test.ts` pins this against `migrateV4toV5(...)` field for
 * field so the two cannot drift; it is spelled out literally here rather than
 * calling the migration because `model/migrate.ts` already imports this module.
 */
export function defaultCalculatorInputsV5(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV5 {
  const v4 = defaultCalculatorInputsV4(project);
  return {
    ...v4,
    inputs_version: 5,
    acquisition: {
      ...v4.acquisition,
      jurisdiction: 'england_ni',
      jurisdiction_source: 'migrated_default',
      jurisdiction_evidence_status: 'unconfirmed',
      acquisition_date: null,
      acquisition_tax_override_pence: null,
      acquisition_tax_override_reason: '',
    },
  };
}

/** R9: a v6 document created fresh starts on the manual basis with a zeroed
 *  bridge — identical behaviour to every pre-R9 document until the user fills
 *  the bridge in and selects it. */
export const DEFAULT_AREAS = { ...DEFAULT_AREA_BRIDGE };

/**
 * v6 defaults (R9 Task 3): the document a freshly opened calculator starts on.
 *
 * Deliberately identical to what `migrateV5toV6` stamps on a v5 document — the
 * manual basis with a zeroed bridge, and a zeroed ancillary block on every unit
 * — so a brand-new appraisal and a migrated one behave the same and neither
 * computes a different cost area from `conversion_costs.total_construction_sqm`.
 * `conversion-defaults.test.ts` pins the two against each other field for field.
 *
 * The unit map is not dead code even though `DEFAULT_UNIT_MIX` ships empty: it
 * is what keeps this function honest if that default ever gains a starter unit.
 */
export function defaultCalculatorInputsV6(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV6 {
  const v5 = defaultCalculatorInputsV5(project);
  return {
    ...v5,
    inputs_version: 6,
    areas: { ...DEFAULT_AREAS },
    unit_mix: {
      units: v5.unit_mix.units.map((u) => ({ ...u, ancillary: { ...DEFAULT_UNIT_ANCILLARY } })),
    },
  };
}

/**
 * v7 defaults (R10 Task 12): the document a freshly opened calculator starts
 * on. `cost_plan` is derived from `DEFAULT_CONVERSION_COSTS` via
 * `costPlanFromLegacyCosts` -- the SAME construction `migrateV6toV7` and the
 * engine's pre-v7 fallback both use (ruling P2) -- so a brand-new document
 * starts with the same eight fee lines a migrated one gets, rather than
 * shipping a second, empty set of fee defaults.
 *
 * `conversion-defaults.test.ts` pins this cost plan against
 * `costPlanFromLegacyCosts(DEFAULT_CONVERSION_COSTS)` directly, and against
 * the literal fee-line/contingency values Python's `_default_v7()` test
 * helper (tests/test_cost_plan.py) independently produces via
 * `migrate_inputs_to_v7({})` -- the two engines' v7 defaults re-converge here
 * (Task 6 fix round 1, ruling on I3).
 */
export function defaultCalculatorInputsV7(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV7 {
  return {
    ...defaultCalculatorInputsV6(project),
    inputs_version: 7,
    cost_plan: costPlanFromLegacyCosts(DEFAULT_CONVERSION_COSTS),
  };
}

/**
 * v8 defaults (R11 Task 10, spec §17.11): the document a freshly opened
 * calculator starts on, now carrying the VAT block.
 *
 * `vat` goes through `defaultVatInputs()` -- the SAME construction
 * `migrateV7toV8` uses -- so a brand-new document and a migrated one get the
 * identical block, exactly as `cost_plan` above shares one construction with
 * `migrateV6toV7`. §17.11 makes that a requirement, not a tidiness: the block
 * is `registered: false`, so the feature ships opt-in and no migrated appraisal
 * moves, and the claim above that the two engines' v-defaults re-converge --
 * Python reaches the same document through `migrate_inputs_to_v8({})`, whose
 * `CalculatorInputsV8.vat` default_factory is `DEFAULT_VAT.model_copy(deep=True)`
 * -- stays true one version on.
 */
export function defaultCalculatorInputsV8(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV8 {
  return {
    ...defaultCalculatorInputsV7(project),
    inputs_version: 8,
    vat: defaultVatInputs(),
  };
}

/**
 * v9 defaults (R12 Task 18b, spec §18.7): the document a freshly opened
 * calculator starts on, now on the dated programme.
 *
 * Every v9-only field is already written by the v8 defaults above --
 * `cost_plan`'s per-line `phase_id` (via `costPlanFromLegacyCosts`) and each
 * scenario's `phase_slip_phase_id` / `phase_slip_months` (via
 * `DEFAULT_SCENARIOS`) -- because v9 shares those two blocks' types with v8
 * unchanged. What v9 re-types is `programme`, `sales_phasing` and `refinance`,
 * and all three are `null` on a new document: `null` programme means the §6
 * auto windows, which is exactly what a brand-new appraisal had before R12.
 * They are restated here rather than inherited through the spread because
 * their v8 types are not assignable to their v9 ones.
 *
 * Spelled out literally rather than calling `migrateV8toV9` for the same
 * reason `defaultCalculatorInputsV5` is: `model/migrate.ts` imports this
 * module, so importing it back would be a cycle. `conversion-defaults.test.ts`
 * pins the two against each other field for field so they cannot drift.
 */
export function defaultCalculatorInputsV9(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV9 {
  return {
    ...defaultCalculatorInputsV8(project),
    inputs_version: 9,
    programme: null,
    sales_phasing: null,
    refinance: null,
  };
}

/**
 * R13 Task 18 (spec §19.9): the client's persistence boundary. `refinance`
 * stays `null` on a brand-new document -- the same value v9's default already
 * carries, and `RefinanceInputsV10` only adds fields when `refinance` is
 * non-null (spec §19.1) -- so it is inherited through the spread unchanged;
 * only `inputs_version` and `investment_case` are new.
 *
 * Spelled out literally rather than calling `migrateV9toV10` for the same
 * reason `defaultCalculatorInputsV9` is: `model/migrate.ts` imports this
 * module, so importing it back would be a cycle. `conversion-defaults.test.ts`
 * pins the two against each other field for field so they cannot drift.
 */
export function defaultCalculatorInputsV10(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV10 {
  return {
    ...defaultCalculatorInputsV9(project),
    inputs_version: 10,
    // Restated explicitly, not merely inherited through the spread: the
    // spread's static type is still `RefinanceInputsV9 | null` (v9's own
    // return type), which is not assignable to `RefinanceInputsV10 | null`
    // even though the runtime value (`null`) is identical either way.
    refinance: null,
    investment_case: null,
  };
}

/**
 * R14 Task 14 (spec §20.1, the entry-point cutover): the client's persistence
 * boundary moves on again. `monitoring` is the only addition -- a brand-new
 * document has no monitoring statement entered yet, exactly as it has no
 * investment case -- so every other field is inherited through the spread
 * unchanged.
 *
 * Spelled out literally rather than calling `migrateV10toV11` for the same
 * reason `defaultCalculatorInputsV10` is: `model/migrate.ts` imports this
 * module, so importing it back would be a cycle. `conversion-defaults.test.ts`
 * pins the two against each other field for field so they cannot drift.
 */
export function defaultCalculatorInputsV11(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV11 {
  return {
    ...defaultCalculatorInputsV10(project),
    inputs_version: 11,
    monitoring: null,
  };
}

/**
 * R13b Task 15 (spec §22.1, the entry-point cutover): the client's persistence
 * boundary moves on again. `unit_sales: null` and `sales_slip_months: 0` (already
 * in DEFAULT_SCENARIOS since Task 1) are the only additions. Spelled out rather
 * than calling `migrateV11toV12` for the cycle reason `defaultCalculatorInputsV11` gives;
 * `conversion-defaults.test.ts` pins the two against each other field for field.
 */
export function defaultCalculatorInputsV12(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV12 {
  return { ...defaultCalculatorInputsV11(project), inputs_version: 12, unit_sales: null };
}

/** R15 spec §23.5. The listing's STRUCTURED fields, copied at capture time. */
export function captureSourceRecord(
  project: Pick<Project, 'source_name' | 'source_url' | 'is_vacant' | 'tenure' | 'lease_years_remaining' | 'floor_area_sqm' | 'use_class' | 'epc_rating'>,
  capturedAt: string,
): SourceRecord {
  return {
    captured_at: capturedAt,
    source_name: project.source_name, source_url: project.source_url,
    is_vacant: project.is_vacant, tenure: project.tenure,
    lease_years_remaining: project.lease_years_remaining, floor_area_sqm: project.floor_area_sqm,
    use_class: project.use_class, epc_rating: project.epc_rating,
  };
}

export type DefaultDocumentProject = {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
} & Partial<Pick<Project, 'source_name' | 'source_url' | 'is_vacant' | 'tenure' | 'lease_years_remaining' | 'use_class' | 'epc_rating'>>;

/**
 * R15 Task 13's cutover target. `now` is injected so tests are reproducible.
 *
 * `hasListing` (rather than checking each field individually) is the
 * discriminator between "a brand-new calculator with no project" and "a
 * calculator opened against a real listing" -- `is_vacant` is present (even
 * if `null`) only in the latter case, since a bare `{id, price_pence,
 * floor_area_sqm}` (the shape every OTHER defaultCalculatorInputsVN takes)
 * never carries it.
 */
export function defaultCalculatorInputsV13(project?: DefaultDocumentProject, now?: Date): CalculatorInputsV13 {
  const v12 = defaultCalculatorInputsV12(project);
  const dd = defaultDueDiligence();
  const hasListing = project !== undefined && 'is_vacant' in project;
  return {
    ...v12,
    inputs_version: 13,
    cost_plan: { ...v12.cost_plan, qs: null, packages: v12.cost_plan.packages.map((p) => ({ ...p, price_basis: null })) },
    due_diligence: hasListing
      ? { ...dd, source_record: captureSourceRecord({
          source_name: project!.source_name ?? null, source_url: project!.source_url ?? null,
          is_vacant: project!.is_vacant ?? null, tenure: project!.tenure ?? 'unknown',
          lease_years_remaining: project!.lease_years_remaining ?? null,
          floor_area_sqm: project!.floor_area_sqm, use_class: project!.use_class ?? 'other',
          epc_rating: project!.epc_rating ?? null,
        }, (now ?? new Date()).toISOString()) }
      : dd,
  };
}
