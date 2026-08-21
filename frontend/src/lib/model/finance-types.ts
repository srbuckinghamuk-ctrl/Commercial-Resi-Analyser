import type {
  AcquisitionInputs, UnitMixInputs, ConversionCostInputs, ExitStrategyInputs,
  RiskItem, ScenarioOverrides, DealSpiderInputs,
} from '../conversion-types';
import type { UnitMixInputsV6 } from '../conversion-types';
import type { SpendCurve } from './curves';
import type { AreaBridgeInputs, AreaBridgeResult } from './areas';
import type { AcquisitionTaxResult, Jurisdiction } from '../tax/acquisition-tax';
import type { CostPlanInputs, CostPlanResult } from './cost-plan';
import type { VatInputs, VatResult } from './vat';

export type { SpendCurve };

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

export interface ProgrammePackage {
  start_offset: number;
  duration_months: number;
  curve: SpendCurve;
}

export interface ProgrammeInputs {
  anchor_month: string | null;
  packages: {
    construction: ProgrammePackage;
    professional: ProgrammePackage;
    statutory: ProgrammePackage;
  };
}

export interface SalesPhasingInputs {
  tranches: Array<{ month_offset: number; pct_of_gross_receipts: number }>;
}

export interface RefinanceInputs {
  month_offset: number;
  investment_value_pence: number;
  ltv_pct: number;
  arrangement_fee_pence: number;
  legal_costs_pence: number;
}

export interface CalculatorInputsV4 {
  inputs_version: 4;
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
  programme: ProgrammeInputs | null;
  sales_phasing: SalesPhasingInputs | null;
  refinance: RefinanceInputs | null;
}

/** How the jurisdiction on a document came to be set. */
export type JurisdictionSource = 'derived' | 'user' | 'migrated_default';

/**
 * R8 (spec §14). The acquisition block gains the tax basis the appraisal is
 * charged on. Extended rather than edited because `AcquisitionInputs` is shared
 * with the v1 document shape.
 */
export interface AcquisitionInputsV5 extends AcquisitionInputs {
  jurisdiction: Jurisdiction;
  jurisdiction_source: JurisdictionSource;
  /** Reuses the vocabulary of EquitySource.evidence_status deliberately: the
   *  report handles evidence with one mechanism, not two. */
  jurisdiction_evidence_status: 'unconfirmed' | 'confirmed';
  /** Effective date of the transaction; selects the band set. Null on migrated
   *  documents, which then use the current set and say so. */
  acquisition_date: string | null;
  /** Set only where a relief, linked transaction or other rule no band table
   *  models applies. Requires a reason (validation, Task 6). */
  acquisition_tax_override_pence: number | null;
  acquisition_tax_override_reason: string;
}

export interface CalculatorInputsV5 extends Omit<CalculatorInputsV4, 'inputs_version' | 'acquisition'> {
  inputs_version: 5;
  acquisition: AcquisitionInputsV5;
}

/**
 * R9 (spec §15). Adds the area bridge and per-unit ancillary. Purely additive:
 * migration writes `basis: 'manual'` with a zeroed bridge and zeroed ancillary,
 * so **no existing appraisal's computed values move**.
 */
export interface CalculatorInputsV6
  extends Omit<CalculatorInputsV5, 'inputs_version' | 'unit_mix'> {
  inputs_version: 6;
  unit_mix: UnitMixInputsV6;
  areas: AreaBridgeInputs;
}

/**
 * R10 (spec §16). Adds the cost plan. Purely additive: migration writes
 * `mode: 'headline'` with no packages, the general contingency class carrying
 * the document's existing `conversion_costs.contingency_pct`, and the eight
 * existing fee fields as `fixed` fee lines — so **no existing appraisal's
 * computed values move**.
 */
export interface CalculatorInputsV7 extends Omit<CalculatorInputsV6, 'inputs_version'> {
  inputs_version: 7;
  cost_plan: CostPlanInputs;
}

/** R11 (spec 17). Adds the VAT block. Purely additive: migration (Task 10)
 *  writes `registered: false`, so the engine is inert and no existing
 *  appraisal's computed values move. */
export interface CalculatorInputsV8 extends Omit<CalculatorInputsV7, 'inputs_version'> {
  inputs_version: 8;
  vat: VatInputs;
}

export type AnyCalculatorInputs =
  CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4
  | CalculatorInputsV5 | CalculatorInputsV6 | CalculatorInputsV7 | CalculatorInputsV8;

export type FlagCode =
  | 'facility_exceeded' | 'funding_gap' | 'interest_reserve_exhausted'
  | 'senior_outstanding_at_maturity' | 'additional_equity_required'
  | 'negative_profit' | 'requires_confirmation' | 'irr_unavailable'
  | 'unrealised_profit_basis' | 'exit_fee_not_charged'
  | 'senior_breakeven_unsolvable' | 'developer_breakeven_unsolvable'
  | 'breakeven_cap_exhausted' | 'facility_redrawn_after_redemption'
  /** R11 spec §17.6: VAT is not eligible for the development-cost advance, so a
   *  month's VAT can fall through to a funding gap even where the build itself
   *  is fully advanced. Narrows the generic `funding_gap` — both fire. */
  | 'vat_funding_gap';

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
  /** R11 spec §17.6. Written back from `computeVat`'s `months[].incurred_pence`
   *  after the uses/receipts arrays are fully built — never a source figure
   *  itself (§17.5's one-direction rule). */
  vat_pence: number;
}

export interface MonthReceipts {
  gross_sale_pence: number;
  agent_fee_pence: number;
  selling_legal_pence: number;
  /** R11 spec §17.6. Written back from `computeVat`'s `months[].reclaimed_pence`.
   *  Deliberately NOT part of `gross_sale_pence`: it is not a sale receipt, so
   *  no GDV-, LTGDV- or break-even-denominated metric may read it. */
  vat_reclaim_pence: number;
}

export interface Schedule {
  term_months: number;
  uses: MonthUses[];
  receipts: MonthReceipts[];
  /** Spec §4.5 net refinance proceeds, wired into the ledger.
   * null when `refinance` inputs are null (the migration default; byte-identical to calc 2.2.0). */
  refinance: { month: number; net_proceeds_pence: number } | null;
  totals: {
    acquisition_pence: number; construction_pence: number;
    professional_pence: number; statutory_pence: number;
    selling_costs_pence: number; gross_sales_pence: number;
    gdv_pence: number; retained_value_pence: number;
    cost_before_finance_ex_selling_pence: number;
    /** R11 spec §17.6/§17.5. `vat_pence`/`vat_reclaim_pence` disclose the gross
     *  VAT cycle; `irrecoverable_vat_pence` is the cost-plan-adjacent figure
     *  Task 8 adds to cost-before-finance on its own line. None of these three
     *  feed `cost_before_finance_ex_selling_pence` above — that would double
     *  count the very figure Task 8 adds downstream. */
    vat_pence: number;
    vat_reclaim_pence: number;
    irrecoverable_vat_pence: number;
  };
  /** R11 spec §17.5/§17.6. The full VAT result, computed strictly downstream of
   *  the finished uses/receipts arrays and written back into them — never the
   *  other way round. */
  vat: VatResult;
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
  /** R11 spec §17.6. The VAT reclaimed this month, applied to senior debt in
   *  full (ignoring `sales_sweep_pct`) and before the sales sweep and the §4.5
   *  refinance event. Deliberately absent from `gross_receipts_pence` and
   *  `net_receipts_pence`: it returns a specific advance rather than realising
   *  an asset, so no GDV-, LTGDV- or break-even-denominated metric may read it.
   *  Where it exceeds the balance plus the exit fee, or where there is no
   *  facility, the excess falls into `distribution_pence`. */
  vat_reclaim_pence: number;
  /** Spec §4.5 — 0 when no refinance event occurs this month. */
  refinance_proceeds_pence: number;
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
    /** Spec §4.5/§7: the slice of `additional_equity_pence` injected by the refinance
     * event's shortfall or negative-net-proceeds branches. It funds a facility
     * redemption (financing-side), not a project cost, so reconcile() excludes it from
     * §7's sources-and-uses identity while it still counts toward
     * `additional_equity_pence`, the `additional_equity_required` flag, equity
     * contributed, and the equity cash-flow vector. Always 0 when `refinance` is null. */
    refinance_shortfall_equity_pence: number;
    funding_gap_pence: number;
    distributions_pence: number;
    repayments_pence: number;
    /** R11 spec §17.6. The gross VAT cycle as the LEDGER saw it: `vat_pence` is
     *  the VAT funded through the per-month loop (part of `uses_total_pence`),
     *  `vat_reclaim_pence` the VAT swept back out. Disclosure only — neither is
     *  a finance cost, and `vat_reclaim_pence` appears on neither side of §7's
     *  sources-and-uses identity. */
    vat_pence: number;
    vat_reclaim_pence: number;
  };
  peak_debt_pence: number;
  peak_debt_month: number | null;
  day_one_advance_pence: number;
  committed_net_facility_pence: number;
  committed_gross_facility_pence: number;
  senior_outstanding_at_maturity_pence: number;
  /** Spec §5.11: the disposal month's senior balance immediately before sale receipts are
   * applied. null for cash deals (no senior facility) and for schedules with no disposal
   * (e.g. exit_strategy.route === 'retain_all'). */
  redemption_balance_at_disposal_pence: number | null;
  /** Spec §4.4.1 declining redemption schedule: one entry per disposal month,
   * balance captured immediately before that month's receipts. Empty for cash
   * deals and no-disposal schedules. The scalar above equals the last entry. */
  redemption_schedule: Array<{ month: number; balance_pence: number }>;
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
  /** Spec §14 (R8) — the tax actually charged on the acquisition under the
   *  document's jurisdiction: SDLT, LBTT or LTT. Equal to
   *  `acquisition_tax.total_pence`. */
  acquisition_tax_pence: number;
  /** Spec §14 (R8) — the full derivation: regime, band breakdown, surcharge,
   *  band-set effective date, table version, source and override provenance. */
  acquisition_tax: AcquisitionTaxResult;
  /** R11 spec §17.7 — the figure the acquisition tax was actually charged on:
   *  the price PLUS any chargeable purchase VAT. Equal to
   *  `acquisition.purchase_price_pence` unless the vendor has opted to tax and
   *  TOGC does not apply. Disclosed rather than left implicit, so the tax base
   *  is visible in the result instead of buried inside a tax figure. */
  chargeable_consideration_pence: number;
  /**
   * @deprecated R8 — a jurisdiction-neutral figure under an England/NI-only
   * name. Carries the identical value to `acquisition_tax_pence`; retained only
   * so pre-R8 report and export readers keep working. Removed in R16.
   */
  sdlt_pence: number;
  /** R9 spec §15.8 — the full area reconciliation: every entered line, every
   *  derived line, every efficiency. The UI and the report read areas from here
   *  and never recompute one. */
  area_bridge: AreaBridgeResult;
  /** R9 spec §15.8 — the construction cost area actually used, whichever basis
   *  produced it. Equal to `area_bridge.developed_area_sqm`. */
  developed_area_sqm: number;
  /** R10 spec §16 — the full cost derivation: every package, every contingency
   *  class with its base, every fee line with its base. The UI and the report
   *  read cost from here and never recompute one. */
  cost_plan: CostPlanResult;
  /** R11 spec §17.12 — the full VAT derivation: per-category resolved treatment,
   *  per-month VAT out, per-month reclaim, the carry vector, peak carry and its
   *  month, total input VAT, total reclaimed, total irrecoverable, and
   *  `receivable_at_maturity_pence`. This is the SCHEDULE's `vat`, republished
   *  here rather than recomputed: §17.5 runs the engine once, in one direction.
   *  The UI and the report read VAT from here and never call `computeVat`. */
  vat: VatResult;
  /** R9 spec §3.1 — GDV excluding ancillary. This is the pre-R9 figure, kept so
   *  a variance against it stays expressible. */
  gdv_internal_pence: number;
  /** R9 spec §3.1 — parking plus balcony/terrace value. `gdv_pence` remains the
   *  TOTAL of the two, so every existing GDV-denominated ratio is unchanged. */
  gdv_ancillary_pence: number;
  construction_cost_pence: number;
  professional_fees_pence: number;
  statutory_costs_pence: number;
  selling_costs_pence: number;
  /** R11 spec §17.5 — VAT the scheme cannot recover, on its OWN line and added
   *  to `cost_before_finance_pence` (and so to TDC and to profit). Deliberately
   *  NOT folded back into `construction_cost_pence`, however natural that
   *  reads: `computeVat` reads the cost plan, so a VAT figure entering a cost
   *  base is the one thing that could make the engine cyclic. Equal to
   *  `vat.total_irrecoverable_pence`. */
  irrecoverable_vat_pence: number;
  cost_before_finance_pence: number;
  finance_costs_pence: number;
  /** R11 spec §17.12 — the finance cost attributable to carrying recoverable
   *  VAT. A **disclosure of a slice of `finance_costs_pence`, not an addition
   *  to it**: the interest is already there, charged by the ledger on a balance
   *  the VAT outflow raised, and adding it again would double count.
   *
   *  Defined by an explicit counterfactual, never by apportioning interest
   *  across balances: total interest with the document as given, less total
   *  interest from the same document with `vat.registered` forced false. That
   *  is the same quantity §17.5's primary invariant measures wherever the
   *  facility's fee bases are VAT-independent, so the two pin each other. 0 for
   *  a document with no VAT block, or one that is not registered. */
  vat_carry_interest_pence: number;
  total_development_cost_pence: number;
  profit_pence: number;
  profit_is_unrealised: boolean;
  /** Spec §3.16.1 — the schedule books a disposal or a refinance within the term,
   *  so distributed-return metrics have something to measure against. */
  has_realisation_event: boolean;
  /** Spec §3.16.1 — return on equity is an accounting return here, not a
   *  distributed one: either profit includes retained value, or nothing has been
   *  realised at all. Reports must label the figure "unrealised" when true. */
  return_on_equity_is_unrealised: boolean;
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
  /** Ledger flags (model.flags, unmutated) followed by metric flags computed by
   * deriveMetrics itself (senior/developer breakeven unsolvable, cap-exhausted).
   * Wired in Release 3a Task 6 — deriveMetrics is pure and no longer mutates
   * model.flags; this is now the single read site for the full flag set. */
  flags: ModelFlag[];
}

export const CALC_VERSION = '2.9.0';
