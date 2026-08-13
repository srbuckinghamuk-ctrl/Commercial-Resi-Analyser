import type { CalculatorInputsV2, MonthlyModel, Schedule } from './finance-types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ReconciliationStatus {
  sources_equal_uses: boolean;
  debt_rollforward_ok: boolean;
  closing_never_negative: boolean;
  facility_within_limit: boolean;
  senior_repaid: boolean;
  funding_complete: boolean;
  report_safe: boolean;
  issues: ValidationIssue[];
}

const NON_NEGATIVE_MONEY: Array<[string, (i: CalculatorInputsV2) => number]> = [
  ['acquisition.purchase_price_pence', (i) => i.acquisition.purchase_price_pence],
  ['acquisition.legal_fees_pence', (i) => i.acquisition.legal_fees_pence],
  ['acquisition.survey_cost_pence', (i) => i.acquisition.survey_cost_pence],
  ['acquisition.other_acquisition_costs_pence', (i) => i.acquisition.other_acquisition_costs_pence],
  ['conversion_costs.prior_approval_fee_per_dwelling_pence', (i) => i.conversion_costs.prior_approval_fee_per_dwelling_pence],
  ['conversion_costs.cil_s106_pence', (i) => i.conversion_costs.cil_s106_pence],
  ['conversion_costs.architect_pence', (i) => i.conversion_costs.architect_pence],
  ['conversion_costs.structural_engineer_pence', (i) => i.conversion_costs.structural_engineer_pence],
  ['conversion_costs.mande_pence', (i) => i.conversion_costs.mande_pence],
  ['conversion_costs.planning_consultant_pence', (i) => i.conversion_costs.planning_consultant_pence],
  ['conversion_costs.building_control_pence', (i) => i.conversion_costs.building_control_pence],
  ['conversion_costs.other_professional_fees_pence', (i) => i.conversion_costs.other_professional_fees_pence],
  ['conversion_costs.construction_cost_per_sqm_pence', (i) => i.conversion_costs.construction_cost_per_sqm_pence],
  ['conversion_costs.fire_safety_pence', (i) => i.conversion_costs.fire_safety_pence],
  ['conversion_costs.sound_insulation_pence', (i) => i.conversion_costs.sound_insulation_pence],
  ['conversion_costs.part_l_compliance_pence', (i) => i.conversion_costs.part_l_compliance_pence],
  ['exit_strategy.selling_legal_fee_pence', (i) => i.exit_strategy.selling_legal_fee_pence],
];

export function validateInputs(inputs: CalculatorInputsV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ severity: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ severity: 'warning', field, message });

  for (const [field, get] of NON_NEGATIVE_MONEY) {
    if (get(inputs) < 0) err(field, 'Monetary values cannot be negative.');
  }
  if (inputs.conversion_costs.total_construction_sqm < 0) {
    err('conversion_costs.total_construction_sqm', 'Area cannot be negative.');
  }
  if (inputs.conversion_costs.contingency_pct < 0) {
    err('conversion_costs.contingency_pct', 'Contingency cannot be negative.');
  }
  for (const [idx, u] of inputs.unit_mix.units.entries()) {
    if (u.floor_area_sqm < 0) err(`unit_mix.units[${idx}].floor_area_sqm`, 'Unit area cannot be negative.');
    if (u.estimated_value_pence <= 0) err(`unit_mix.units[${idx}].estimated_value_pence`, 'Every unit needs a positive value — zero GDV with units present is invalid.');
  }

  const f = inputs.finance;
  if (!Number.isInteger(f.term_months) || f.term_months < 1) {
    err('finance.term_months', 'Term must be a whole number of months, at least 1.');
  }
  if (f.annual_interest_rate_pct < 0) err('finance.annual_interest_rate_pct', 'Rate cannot be negative.');
  if (f.arrangement_fee_pct < 0 || f.exit_fee_pct < 0) err('finance.fees', 'Fees cannot be negative.');
  if (f.sales_sweep_pct < 0 || f.sales_sweep_pct > 100) err('finance.sales_sweep_pct', 'Sweep must be between 0 and 100%.');
  if (f.development_cost_advance_pct < 0 || f.development_cost_advance_pct > 100) {
    err('finance.development_cost_advance_pct', 'Development advance rate must be between 0 and 100%.');
  }
  if (f.equity_draw_rule === 'pari_passu') {
    err('finance.equity_draw_rule', 'Pari-passu draws are not yet supported — use equity-first.');
  }
  if (f.funding_source === 'cash') {
    if ((f.committed_net_facility_pence ?? 0) !== 0 || (f.committed_gross_facility_pence ?? 0) !== 0) {
      err('finance.committed_net_facility_pence', 'Cash funding must have a zero senior facility.');
    }
  } else {
    const net = f.committed_net_facility_pence;
    if (net != null && f.day_one_advance_pence != null && f.day_one_advance_pence > net) {
      err('finance.day_one_advance_pence', 'Day-one advance cannot exceed the committed net facility.');
    }
    if (net != null && f.committed_gross_facility_pence != null && f.committed_gross_facility_pence < net) {
      err('finance.committed_gross_facility_pence', 'Gross facility cannot be below the net facility.');
    }
    if (net == null) warn('finance.committed_net_facility_pence', 'No committed facility entered — debt metrics will be unavailable.');
  }

  for (const [idx, e] of inputs.equity_sources.entries()) {
    if (e.amount_pence < 0) err(`equity_sources[${idx}].amount_pence`, 'Equity amounts cannot be negative.');
    if (e.classification === 'planning_uplift' && e.evidence_status !== 'confirmed') {
      warn(`equity_sources[${idx}]`, 'Planning/revaluation uplift is not cash equity — evidence required.');
    }
    if (e.classification !== 'cash' && e.amount_pence > 0) {
      warn(`equity_sources[${idx}]`, 'Non-cash equity (land/uplift/vendor/deferred) is recorded but not yet modelled as funding — Release 2; it does not fund monthly costs.');
    }
  }

  const unitArea = inputs.unit_mix.units.reduce((s, u) => s + u.floor_area_sqm, 0);
  const constArea = inputs.conversion_costs.total_construction_sqm;
  if (unitArea > 0 && constArea > 0) {
    const ratio = unitArea / constArea;
    if (ratio < 0.75 || ratio > 1.25) {
      warn('conversion_costs.total_construction_sqm',
        `Unit NIA (${unitArea} m²) and construction area (${constArea} m²) differ by more than 25% — check the area basis.`);
    }
  }
  if (inputs.exit_strategy.route === 'blended' && inputs.exit_strategy.retained_units.length === 0) {
    warn('exit_strategy.retained_units', 'Blended exit selected but no units are marked as retained.');
  }
  if (f.requires_confirmation) {
    warn('finance', 'Facility terms were migrated from a legacy appraisal and require confirmation.');
  }

  // Spec §3.18: RLV = GDV / (1 + target/100) − cost-excluding-land. A target of exactly
  // -100% divides by zero; below -100% flips the sign and produces a non-finite/nonsensical
  // RLV. Approved in Task 5 review: guard this at validation time rather than let RLV emit
  // Infinity/NaN downstream.
  if (inputs.deal_spider.target_profit_on_cost_pct <= -100) {
    err('deal_spider.target_profit_on_cost_pct', 'Target profit on cost must be greater than -100% — this value makes the residual land value calculation non-finite.');
  }

  return issues;
}

export function reconcile(
  inputs: CalculatorInputsV2, schedule: Schedule, model: MonthlyModel,
): ReconciliationStatus {
  const issues: ValidationIssue[] = [];

  let rollforwardOk = true;
  let neverNegative = true;
  for (const mo of model.months) {
    if (mo.closing_balance_pence !== mo.opening_balance_pence + mo.draw_pence
      + mo.capitalised_fees_pence + mo.interest_capitalised_pence - mo.repayment_pence) {
      rollforwardOk = false;
    }
    if (mo.closing_balance_pence < 0) neverNegative = false;
  }

  // Sources = uses, cumulatively, to the penny (spec §7). Spec §7 lists "lender fees" and
  // "interest whether capitalised or serviced" as uses, and "capitalised fees & rolled-up
  // interest (self-funding within the gross facility)" as sources — i.e. capitalised fees
  // (the arrangement fee) and rolled-up interest each appear once on both sides of the
  // identity (they fund themselves within the facility) rather than cancelling out of the
  // equation entirely. Keeping them explicit on both sides is both the clearest reading and
  // the one that holds to the penny, because the engine's per-month cost-funding loop already
  // guarantees Σ(cash uses) + serviced interest == draws + equity + funding gap + additional
  // equity; capitalised fees and rolled interest are additional matched pairs layered on top.
  const servicedInterest = model.months.reduce((s, m) => s + m.interest_serviced_pence, 0);
  const rolledInterest = model.months.reduce((s, m) => s + m.interest_capitalised_pence, 0);
  const capitalisedFees = model.totals.capitalised_fees_pence;

  const usesTotal = model.months.reduce((s, m) => s + m.uses_total_pence, 0)
    + servicedInterest + rolledInterest + capitalisedFees
    + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence;
  const sourcesTotal =
    model.totals.equity_contributed_pence + model.totals.additional_equity_pence
    + model.totals.funding_gap_pence // shown explicitly, never hidden
    + model.totals.draws_pence + capitalisedFees + rolledInterest
    + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence; // proceeds applied at source
  const sourcesEqualUses = usesTotal === sourcesTotal;

  const facilityWithinLimit = !model.flags.some((f) => f.code === 'facility_exceeded');
  const seniorRepaid = model.senior_outstanding_at_maturity_pence === 0;
  const fundingComplete = model.totals.funding_gap_pence === 0
    && model.totals.additional_equity_pence === 0;

  if (!sourcesEqualUses) issues.push({ severity: 'error', field: 'model', message: 'Sources and uses do not balance.' });
  if (!rollforwardOk) issues.push({ severity: 'error', field: 'model', message: 'Debt ledger roll-forward mismatch.' });
  if (!fundingComplete) issues.push({ severity: 'error', field: 'model', message: 'Funding gap or uncommitted equity requirement present.' });
  if (!seniorRepaid) issues.push({ severity: 'warning', field: 'model', message: 'Senior debt not repaid within the modelled term.' });

  const inputErrors = validateInputs(inputs).filter((i) => i.severity === 'error');
  const reportSafe = inputErrors.length === 0 && sourcesEqualUses && rollforwardOk
    && neverNegative && facilityWithinLimit && fundingComplete
    && !inputs.finance.requires_confirmation;

  return {
    sources_equal_uses: sourcesEqualUses,
    debt_rollforward_ok: rollforwardOk,
    closing_never_negative: neverNegative,
    facility_within_limit: facilityWithinLimit,
    senior_repaid: seniorRepaid,
    funding_complete: fundingComplete,
    report_safe: reportSafe,
    issues: [...inputErrors, ...issues],
  };
}
