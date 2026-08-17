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
import { CLASS_MA_AXES } from './spider-axes';
import type {
  CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV4,
  AcquisitionInputsV5, EquitySource, FacilityTerms,
} from './model/finance-types';

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
  },
  upside: {
    label: 'Upside',
    gdv_adjustment_pct: 10,
    construction_cost_adjustment_pct: -5,
    timeline_adjustment_months: -2,
    interest_rate_adjustment_pct: 0,
  },
  downside: {
    label: 'Downside',
    gdv_adjustment_pct: -10,
    construction_cost_adjustment_pct: 15,
    timeline_adjustment_months: 3,
    interest_rate_adjustment_pct: 1,
  },
  severe: {
    label: 'Severe',
    gdv_adjustment_pct: -15,
    construction_cost_adjustment_pct: 20,
    timeline_adjustment_months: 6,
    interest_rate_adjustment_pct: 2,
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

/** The v5 acquisition fields for a *new* appraisal: jurisdiction derived where a
 *  postcode is known (set by the caller), date defaulting to today. */
export function defaultAcquisitionV5Fields(
  today: string,
): Omit<AcquisitionInputsV5, keyof AcquisitionInputs> {
  return {
    jurisdiction: 'england_ni',
    jurisdiction_source: 'derived',
    jurisdiction_evidence_status: 'unconfirmed',
    acquisition_date: today,
    acquisition_tax_override_pence: null,
    acquisition_tax_override_reason: '',
  };
}
