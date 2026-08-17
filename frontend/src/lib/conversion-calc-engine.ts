import type {
  AcquisitionInputs,
  ConversionCostInputs,
  ProposedUnit,
} from './conversion-types';
import type { AcquisitionInputsV5 } from './model/finance-types';
import { calculateAcquisitionTax } from './tax/acquisition-tax';

export function calculateGdv(units: ProposedUnit[]): number {
  return units.reduce((sum, u) => sum + u.estimated_value_pence, 0);
}

/** Spec §11.9: broker fee = round(purchase price × broker_fee_pct / 100). Single source
 * of truth — also used for the Acquisition page's inline display so the two never drift. */
export function calculateBrokerFee(pricePence: number, pct: number): number {
  return Math.round((pricePence * pct) / 100);
}

/**
 * Spec §3.3 — the acquisition line of the cost stack, acquisition tax included.
 *
 * R8 (spec §14): the tax is the document's own regime, not England/NI's. This is
 * the *second* site that computes acquisition tax — `deriveMetrics` is the other,
 * and the two must always agree, because `acquisition_cost_pence` (this figure)
 * flows into TDC while `acquisition_tax_pence` (that one) is what the report
 * names. `golden-fixtures.test.ts` and `metrics.test.ts` both pin their equality.
 *
 * The parameter is widened to accept a v5 acquisition block; v2–v4 documents
 * carry none of the new keys, so the same `in` guards `deriveMetrics` uses resolve
 * them to `england_ni` with a null date and no override — byte-for-byte what
 * `calculateCommercialSdlt` returned before R8 deleted it.
 */
export function calculateTotalAcquisitionCost(
  acq: AcquisitionInputs | AcquisitionInputsV5,
): number {
  const sdlt = calculateAcquisitionTax({
    consideration_pence: acq.purchase_price_pence,
    jurisdiction: 'jurisdiction' in acq ? acq.jurisdiction : 'england_ni',
    basis: 'non_residential',
    date: 'acquisition_date' in acq ? acq.acquisition_date : null,
    override_pence:
      'acquisition_tax_override_pence' in acq ? acq.acquisition_tax_override_pence : null,
    override_reason:
      'acquisition_tax_override_reason' in acq ? acq.acquisition_tax_override_reason : null,
  }).total_pence;
  const brokerFee = calculateBrokerFee(acq.purchase_price_pence, acq.broker_fee_pct);
  return (
    acq.purchase_price_pence +
    sdlt +
    acq.legal_fees_pence +
    acq.survey_cost_pence +
    brokerFee +
    acq.other_acquisition_costs_pence
  );
}

export function calculateTotalConstructionCost(costs: ConversionCostInputs): number {
  // Spec §1.1: fractional-area products round once, at source, in one step before
  // contingency -- base = round_half_up(construction_cost_per_sqm_pence × total_construction_sqm).
  // Integer-sqm inputs are unaffected (rounding an already-integer product is identity).
  const baseCost = Math.round(costs.construction_cost_per_sqm_pence * costs.total_construction_sqm);
  const contingency = Math.round((baseCost * costs.contingency_pct) / 100);
  const compliance = costs.fire_safety_pence + costs.sound_insulation_pence + costs.part_l_compliance_pence;
  return baseCost + contingency + compliance;
}

export function calculateTotalProfessionalFees(costs: ConversionCostInputs, unitCount: number = 1): number {
  return (
    costs.prior_approval_fee_per_dwelling_pence * Math.max(1, unitCount) +
    costs.cil_s106_pence +
    costs.architect_pence +
    costs.structural_engineer_pence +
    costs.mande_pence +
    costs.planning_consultant_pence +
    costs.building_control_pence +
    costs.other_professional_fees_pence
  );
}

export function calculateRlv(
  totalCostExLand: number,
  gdv: number,
  targetProfitOnCostPct: number,
): number {
  const targetMultiplier = 1 + targetProfitOnCostPct / 100;
  return Math.round(gdv / targetMultiplier - totalCostExLand);
}

