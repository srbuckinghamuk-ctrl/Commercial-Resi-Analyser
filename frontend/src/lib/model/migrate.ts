import type { CalculatorInputs, FinanceInputs } from '../conversion-types';
import type { CalculatorInputsV2, EquitySource, FacilityTerms } from './finance-types';
import {
  calculateTotalAcquisitionCost, calculateTotalConstructionCost, calculateTotalProfessionalFees,
} from '../conversion-calc-engine';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';

function isV2(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV2 {
  return snapshot.inputs_version === 2 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

function migrateFinanceV1(v1: FinanceInputs, costBeforeFinance: number): {
  finance: FacilityTerms; equity: EquitySource[];
} {
  const isCash = v1.funding_source === 'cash';
  const proposedFacility = isCash ? 0 : Math.round((costBeforeFinance * v1.ltv_pct) / 100);
  const finance: FacilityTerms = {
    funding_source: v1.funding_source,
    day_one_advance_pence: null,
    day_one_market_value_pence: null,
    development_cost_advance_pct: 100,
    committed_net_facility_pence: proposedFacility,
    committed_gross_facility_pence: null,
    annual_interest_rate_pct: v1.interest_rate_annual_pct,
    interest_type: v1.interest_type,
    arrangement_fee_pct: v1.arrangement_fee_pct,
    arrangement_fee_basis: 'committed_net_facility',
    exit_fee_pct: v1.exit_fee_pct,
    exit_fee_basis: 'committed_gross_facility',
    broker_fee_pence: 0,
    lender_legal_fee_pence: 0,
    valuation_fee_pence: 0,
    monitoring_surveyor_fee_pence: 0,
    interest_reserve_pence: null,
    term_months: v1.loan_term_months,
    equity_draw_rule: 'fund_as_required',
    sales_sweep_pct: 100,
    legacy_leverage_pct: v1.ltv_pct,
    requires_confirmation: true,
    enforcement_cost_assumption_pence: 0,
  };
  const equity: EquitySource[] = [{
    id: 'migrated-cash-equity',
    classification: 'cash',
    amount_pence: costBeforeFinance - proposedFacility,
    timing_month: 0,
    repayment_priority: 1,
    evidence_status: 'unconfirmed',
    notes: 'Migrated from v1 snapshot: residual of cost before finance less proposed facility. Confirm before lender use.',
  }];
  return { finance, equity };
}

/** Accepts a v1 or v2 snapshot (or partial) and returns a normalised v2 document. */
export function migrateInputs(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV2 {
  const defaults = defaultCalculatorInputsV2(project);
  if (isV2(snapshot)) {
    const saved = snapshot as unknown as Partial<CalculatorInputsV2>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 2,
      acquisition: { ...defaults.acquisition, ...(saved.acquisition ?? {}) },
      unit_mix: saved.unit_mix ?? defaults.unit_mix,
      conversion_costs: { ...defaults.conversion_costs, ...(saved.conversion_costs ?? {}) },
      finance: { ...defaults.finance, ...(saved.finance ?? {}) },
      equity_sources: saved.equity_sources ?? defaults.equity_sources,
      exit_strategy: { ...defaults.exit_strategy, ...(saved.exit_strategy ?? {}) },
      risks: saved.risks ?? defaults.risks,
      scenarios: {
        base: { ...defaults.scenarios.base, ...(saved.scenarios?.base ?? {}) },
        upside: { ...defaults.scenarios.upside, ...(saved.scenarios?.upside ?? {}) },
        downside: { ...defaults.scenarios.downside, ...(saved.scenarios?.downside ?? {}) },
        severe: { ...defaults.scenarios.severe, ...(saved.scenarios?.severe ?? {}) },
      },
      deal_spider: {
        ...defaults.deal_spider,
        ...(saved.deal_spider ?? {}),
        weights: { ...defaults.deal_spider.weights, ...(saved.deal_spider?.weights ?? {}) },
      },
    };
  }

  // v1 path: merge onto v1-shaped defaults first, then translate finance.
  const v1 = snapshot as Partial<CalculatorInputs>;
  const acquisition = { ...defaults.acquisition, ...(v1.acquisition ?? {}) };
  const conversion_costs = { ...defaults.conversion_costs, ...(v1.conversion_costs ?? {}) };
  const unit_mix = v1.unit_mix ?? defaults.unit_mix;
  const v1Finance: FinanceInputs = {
    funding_source: 'bridging', ltv_pct: 70, interest_rate_annual_pct: 8,
    arrangement_fee_pct: 2, exit_fee_pct: 1, loan_term_months: 12, interest_type: 'rolled_up',
    ...((v1.finance ?? {}) as Partial<FinanceInputs>),
  };
  const costBeforeFinance =
    calculateTotalAcquisitionCost(acquisition) +
    calculateTotalConstructionCost(conversion_costs) +
    calculateTotalProfessionalFees(conversion_costs, unit_mix.units.length);
  const { finance, equity } = migrateFinanceV1(v1Finance, costBeforeFinance);

  return {
    ...defaults,
    inputs_version: 2,
    project_id: (v1.project_id as string | null) ?? defaults.project_id,
    acquisition,
    unit_mix,
    conversion_costs,
    finance,
    equity_sources: equity,
    exit_strategy: { ...defaults.exit_strategy, ...(v1.exit_strategy ?? {}) },
    risks: v1.risks ?? defaults.risks,
    scenarios: {
      base: { ...defaults.scenarios.base, ...(v1.scenarios?.base ?? {}) },
      upside: { ...defaults.scenarios.upside, ...(v1.scenarios?.upside ?? {}) },
      downside: { ...defaults.scenarios.downside, ...(v1.scenarios?.downside ?? {}) },
      severe: { ...defaults.scenarios.severe, ...(v1.scenarios?.severe ?? {}) },
    },
    deal_spider: {
      ...defaults.deal_spider,
      ...(v1.deal_spider ?? {}),
      weights: { ...defaults.deal_spider.weights, ...(v1.deal_spider?.weights ?? {}) },
    },
  };
}
