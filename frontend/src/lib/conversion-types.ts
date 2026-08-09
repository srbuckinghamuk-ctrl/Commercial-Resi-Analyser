export type UnitType = 'studio' | '1bed' | '2bed' | '3bed';

export interface ProposedUnit {
  id: string;
  type: UnitType;
  floor_area_sqft: number;
  estimated_value_pence: number;
  comparable_notes: string;
}

export interface AcquisitionInputs {
  purchase_price_pence: number;
  legal_fees_pence: number;
  survey_cost_pence: number;
  broker_fee_pct: number;
  other_acquisition_costs_pence: number;
}

export interface UnitMixInputs {
  units: ProposedUnit[];
}

export interface ConversionCostInputs {
  prior_approval_fee_per_dwelling_pence: number;
  cil_s106_pence: number;
  architect_pence: number;
  structural_engineer_pence: number;
  mande_pence: number;
  planning_consultant_pence: number;
  building_control_pence: number;
  other_professional_fees_pence: number;
  construction_cost_per_sqft_pence: number;
  total_construction_sqft: number;
  contingency_pct: number;
  fire_safety_pence: number;
  sound_insulation_pence: number;
  part_l_compliance_pence: number;
}

export type FundingSource = 'cash' | 'bridging' | 'development_finance';
export type InterestType = 'rolled_up' | 'serviced';

export interface FinanceInputs {
  funding_source: FundingSource;
  ltv_pct: number;
  interest_rate_annual_pct: number;
  arrangement_fee_pct: number;
  exit_fee_pct: number;
  loan_term_months: number;
  interest_type: InterestType;
}

export type ExitRoute = 'sell_all' | 'retain_all' | 'blended';

export interface RetainedUnit {
  unit_id: string;
  monthly_rent_pence: number;
}

export interface ExitStrategyInputs {
  route: ExitRoute;
  selling_agent_fee_pct: number;
  selling_legal_fee_pence: number;
  retained_units: RetainedUnit[];
}

export type Likelihood = 'low' | 'medium' | 'high';
export type Impact = 'low' | 'medium' | 'high';

export interface RiskItem {
  id: string;
  description: string;
  likelihood: Likelihood;
  impact: Impact;
  mitigation: string;
}

export interface ScenarioOverrides {
  label: string;
  gdv_adjustment_pct: number;
  construction_cost_adjustment_pct: number;
  timeline_adjustment_months: number;
  interest_rate_adjustment_pct: number;
}

export interface CalculatorInputs {
  project_id: string | null;
  acquisition: AcquisitionInputs;
  unit_mix: UnitMixInputs;
  conversion_costs: ConversionCostInputs;
  finance: FinanceInputs;
  exit_strategy: ExitStrategyInputs;
  risks: RiskItem[];
  scenarios: {
    base: ScenarioOverrides;
    upside: ScenarioOverrides;
    downside: ScenarioOverrides;
  };
}

export interface AppraisalMetrics {
  total_gdv_pence: number;
  total_acquisition_cost_pence: number;
  sdlt_pence: number;
  total_construction_cost_pence: number;
  total_professional_fees_pence: number;
  total_finance_cost_pence: number;
  total_cost_pence: number;
  profit_pence: number;
  profit_on_cost_pct: number;
  profit_on_gdv_pct: number;
  return_on_equity_pct: number;
  irr_monthly: number;
  irr_annual: number;
  rlv_pence: number;
  equity_required_pence: number;
  loan_amount_pence: number;
}

export interface CashflowMonth {
  month: number;
  label: string;
  drawdown_pence: number;
  cumulative_drawdown_pence: number;
  interest_pence: number;
  cumulative_interest_pence: number;
  income_pence: number;
  net_cashflow_pence: number;
  cumulative_cashflow_pence: number;
}

export interface CashflowResult {
  months: CashflowMonth[];
  peak_funding_pence: number;
  total_interest_pence: number;
}
