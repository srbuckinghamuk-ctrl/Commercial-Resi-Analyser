import type {
  AcquisitionInputs,
  UnitMixInputs,
  ConversionCostInputs,
  FinanceInputs,
  ExitStrategyInputs,
  RiskItem,
  ScenarioOverrides,
  CalculatorInputs,
} from './conversion-types';

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
  construction_cost_per_sqft_pence: 7_500,
  total_construction_sqft: 0,
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
};

export function defaultCalculatorInputs(project?: {
  id: string;
  price_pence: number;
  floor_area_sqft: number | null;
}): CalculatorInputs {
  return {
    project_id: project?.id ?? null,
    acquisition: {
      ...DEFAULT_ACQUISITION,
      purchase_price_pence: project?.price_pence ?? 0,
    },
    unit_mix: { ...DEFAULT_UNIT_MIX },
    conversion_costs: {
      ...DEFAULT_CONVERSION_COSTS,
      total_construction_sqft: project?.floor_area_sqft ?? 0,
    },
    finance: { ...DEFAULT_FINANCE },
    exit_strategy: { ...DEFAULT_EXIT_STRATEGY },
    risks: DEFAULT_RISK_REGISTER.map((r) => ({ ...r, id: crypto.randomUUID() })),
    scenarios: {
      base: { ...DEFAULT_SCENARIOS.base },
      upside: { ...DEFAULT_SCENARIOS.upside },
      downside: { ...DEFAULT_SCENARIOS.downside },
    },
  };
}
