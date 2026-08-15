import type {
  AcquisitionInputs,
  ConversionCostInputs,
  ProposedUnit,
} from './conversion-types';
import { calculateCommercialSdlt } from './commercial-sdlt';

export function calculateGdv(units: ProposedUnit[]): number {
  return units.reduce((sum, u) => sum + u.estimated_value_pence, 0);
}

/** Spec §11.9: broker fee = round(purchase price × broker_fee_pct / 100). Single source
 * of truth — also used for the Acquisition page's inline display so the two never drift. */
export function calculateBrokerFee(pricePence: number, pct: number): number {
  return Math.round((pricePence * pct) / 100);
}

export function calculateTotalAcquisitionCost(acq: AcquisitionInputs): number {
  const sdlt = calculateCommercialSdlt(acq.purchase_price_pence).total_pence;
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

