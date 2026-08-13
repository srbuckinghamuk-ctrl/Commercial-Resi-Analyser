import type {
  AcquisitionInputs, UnitMixInputs, ConversionCostInputs, ExitStrategyInputs,
  RiskItem, ScenarioOverrides, DealSpiderInputs,
} from '../conversion-types';

export type FundingSource = 'cash' | 'bridging' | 'development_finance';
export type InterestType = 'rolled_up' | 'serviced';
export type ArrangementFeeBasis = 'committed_net_facility' | 'committed_gross_facility';
export type ExitFeeBasis = 'committed_gross_facility' | 'peak_debt' | 'redemption_balance';
export type EquityDrawRule = 'equity_first' | 'pari_passu' | 'fund_as_required';
export type EvidenceStatus = 'confirmed' | 'unconfirmed' | 'rejected';

export interface FacilityTerms {
  funding_source: FundingSource;
  /** Senior tranche drawn at acquisition. null = unknown / no separate tranche. */
  day_one_advance_pence: number | null;
  day_one_market_value_pence: number | null;
  /** Caps monthly development draws at this % of that month's eligible dev costs. */
  development_cost_advance_pct: number;
  committed_net_facility_pence: number | null;
  /** null → derived as net + interest_reserve. */
  committed_gross_facility_pence: number | null;
  annual_interest_rate_pct: number;
  interest_type: InterestType;
  arrangement_fee_pct: number;
  arrangement_fee_basis: ArrangementFeeBasis;
  exit_fee_pct: number;
  exit_fee_basis: ExitFeeBasis;
  broker_fee_pence: number;
  lender_legal_fee_pence: number;
  valuation_fee_pence: number;
  monitoring_surveyor_fee_pence: number;
  interest_reserve_pence: number | null;
  term_months: number;
  equity_draw_rule: EquityDrawRule;
  /** % of net sale receipts applied to senior debt. */
  sales_sweep_pct: number;
  /** Migrated v1 ltv_pct, display-only; never used in calculation. */
  legacy_leverage_pct: number | null;
  /** True until a user confirms migrated/unevidenced facility terms. */
  requires_confirmation: boolean;
  /** Disclosed lender cost-of-enforcement assumption (spec §2, §5.11). Default 0, >= 0. */
  enforcement_cost_assumption_pence: number;
}

export type EquityClassification =
  | 'cash' | 'land' | 'planning_uplift' | 'vendor_finance'
  | 'deferred_consideration' | 'other_subordinated';

export interface EquitySource {
  id: string;
  classification: EquityClassification;
  amount_pence: number;
  /** Earliest month the money is available (0 = acquisition month). */
  timing_month: number;
  /** 1 = repaid first among subordinated capital. */
  repayment_priority: number;
  evidence_status: EvidenceStatus;
  notes: string;
}

export interface CalculatorInputsV2 {
  inputs_version: 2;
  project_id: string | null;
  acquisition: AcquisitionInputs;
  unit_mix: UnitMixInputs;
  conversion_costs: ConversionCostInputs;
  finance: FacilityTerms;
  equity_sources: EquitySource[];
  exit_strategy: ExitStrategyInputs;
  risks: RiskItem[];
  scenarios: {
    base: ScenarioOverrides; upside: ScenarioOverrides;
    downside: ScenarioOverrides; severe: ScenarioOverrides;
  };
  deal_spider: DealSpiderInputs;
}

export type LenderAdjustmentBasis =
  | 'global_pct' | 'global_per_sqft' | 'unit_type' | 'per_unit' | 'fixed_amount';

export interface LenderValuation {
  basis: LenderAdjustmentBasis;
  /** basis-dependent value:
   *  global_pct: percentage adjustment applied to every unit's developer value (e.g. -10)
   *  global_per_sqft: pence per sq ft applied to every unit's area (replaces unit value)
   *  fixed_amount: total lender GDV in pence (single figure, replaces the sum)
   */
  global_value: number | null;
  /** unit_type basis: map unit type -> pct adjustment; per_unit basis: map unit id -> lender value pence */
  per_key_values: Record<string, number> | null;
  /** Required provenance (spec §3.2: variance displayed with reason/author/date). */
  reason: string;
  author: string;
  date: string; // ISO yyyy-mm-dd
}

export interface CalculatorInputsV3 {
  inputs_version: 3;
  project_id: string | null;
  acquisition: AcquisitionInputs;
  unit_mix: UnitMixInputs;
  conversion_costs: ConversionCostInputs;
  finance: FacilityTerms;
  equity_sources: EquitySource[];
  exit_strategy: ExitStrategyInputs;
  risks: RiskItem[];
  scenarios: {
    base: ScenarioOverrides; upside: ScenarioOverrides;
    downside: ScenarioOverrides; severe: ScenarioOverrides;
  };
  deal_spider: DealSpiderInputs;
  lender_valuation: LenderValuation | null;
}

export type FlagCode =
  | 'facility_exceeded' | 'funding_gap' | 'interest_reserve_exhausted'
  | 'senior_outstanding_at_maturity' | 'additional_equity_required'
  | 'negative_profit' | 'requires_confirmation' | 'irr_unavailable'
  | 'unrealised_profit_basis' | 'exit_fee_not_charged';

export interface ModelFlag {
  code: FlagCode;
  severity: 'red' | 'amber' | 'info';
  month: number | null;
  amount_pence: number | null;
  message: string;
}

export interface MonthUses {
  acquisition_pence: number;
  construction_pence: number;
  professional_pence: number;
  statutory_pence: number;
  lender_ancillary_fees_pence: number;
}

export interface MonthReceipts {
  gross_sale_pence: number;
  agent_fee_pence: number;
  selling_legal_pence: number;
}

export interface Schedule {
  term_months: number;
  uses: MonthUses[];
  receipts: MonthReceipts[];
  totals: {
    acquisition_pence: number; construction_pence: number;
    professional_pence: number; statutory_pence: number;
    selling_costs_pence: number; gross_sales_pence: number;
    gdv_pence: number; retained_value_pence: number;
    cost_before_finance_ex_selling_pence: number;
  };
}

export interface LedgerMonth {
  month: number;
  uses_total_pence: number;
  opening_balance_pence: number;
  draw_pence: number;
  capitalised_fees_pence: number;
  interest_accrued_pence: number;
  interest_capitalised_pence: number;
  interest_serviced_pence: number;
  exit_fee_pence: number;
  repayment_pence: number;
  closing_balance_pence: number;
  undrawn_net_facility_pence: number | null;
  facility_headroom_pence: number | null;
  interest_reserve_remaining_pence: number | null;
  equity_contribution_pence: number;
  additional_equity_pence: number;
  funding_gap_pence: number;
  gross_receipts_pence: number;
  net_receipts_pence: number;
  distribution_pence: number;
}

export interface MonthlyModel {
  months: LedgerMonth[];
  totals: {
    interest_pence: number;
    arrangement_fee_pence: number;
    exit_fee_pence: number;
    ancillary_fees_pence: number;
    finance_costs_pence: number;
    draws_pence: number;
    capitalised_fees_pence: number;
    equity_contributed_pence: number;
    additional_equity_pence: number;
    funding_gap_pence: number;
    distributions_pence: number;
    repayments_pence: number;
  };
  peak_debt_pence: number;
  peak_debt_month: number | null;
  day_one_advance_pence: number;
  committed_net_facility_pence: number;
  committed_gross_facility_pence: number;
  senior_outstanding_at_maturity_pence: number;
  flags: ModelFlag[];
  /** Developer equity cash-flow vector, one entry per month (− out, + in). */
  equity_cashflows_pence: number[];
}

export interface CostToCompleteSummary {
  first_shortfall_month: number | null;
  max_shortfall_pence: number;
  months: { month: number; remaining_cost_pence: number; remaining_funding_pence: number; surplus_pence: number }[];
}

export interface AppraisalResultV2 {
  calc_version: string;
  gdv_pence: number;
  lender_gdv_pence: number | null;
  lender_gdv_variance_pence: number | null;
  lender_gdv_variance_pct: number | null;
  acquisition_cost_pence: number;
  sdlt_pence: number;
  construction_cost_pence: number;
  professional_fees_pence: number;
  statutory_costs_pence: number;
  selling_costs_pence: number;
  cost_before_finance_pence: number;
  finance_costs_pence: number;
  total_development_cost_pence: number;
  profit_pence: number;
  profit_is_unrealised: boolean;
  unrealised_value_pence: number;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  equity_contributed_pence: number;
  equity_multiple: number | null;
  irr_monthly_pct: number | null;
  irr_annual_pct: number | null;
  rlv_pence: number;
  day_one_advance_pence: number;
  day_one_ltv_on_price_pct: number | null;
  day_one_ltv_on_value_pct: number | null;
  development_advances_pence: number;
  net_ltc_pct: number | null;
  gross_ltc_pct: number | null;
  ltgdv_developer_pct: number | null;
  ltgdv_lender_pct: number | null;
  peak_debt_pence: number;
  peak_debt_month: number | null;
  facility_headroom_pence: number | null;
  interest_reserve_remaining_pence: number | null;
  return_on_equity_pct: number | null;
  /** Wired in Task 4 (spec §5.11). */
  senior_breakeven_pence: number | null;
  senior_breakeven_pct_of_lender_gdv: number | null;
  senior_breakeven_fall_from_lender_gdv_pct: number | null;
  /** Wired in Task 5 (spec §5.12). */
  developer_breakeven_pence: number | null;
  /** Wired in Task 6 (spec §5.10). */
  cost_to_complete: CostToCompleteSummary | null;
}

export const CALC_VERSION = '2.1.0';
