import type {
  AcquisitionInputs,
  ConversionCostInputs,
  ProposedUnit,
  ProposedUnitV6,
} from './conversion-types';
import type { AcquisitionInputsV5 } from './model/finance-types';
import { calculateAcquisitionTax, resolveAcquisitionDate } from './tax/acquisition-tax';

/** R9 spec §15.5 — a unit's ancillary value. A pre-v6 unit carries no
 *  `ancillary` block at all, read structurally (the codebase's version-dispatch
 *  idiom) and resolving to zero. */
export function unitAncillaryValuePence(u: ProposedUnit | ProposedUnitV6): number {
  if (!('ancillary' in u) || u.ancillary == null) return 0;
  return u.ancillary.parking_value_pence + u.ancillary.balcony_terrace_value_pence;
}

export interface GdvBreakdown {
  /** Internal saleable unit values — the pre-R9 figure, unchanged. */
  internal_pence: number;
  /** Parking plus balcony/terrace. Reported separately, never folded into
   *  internal saleable value (spec §3.1, which this release rewrites). */
  ancillary_pence: number;
  total_pence: number;
}

export function calculateGdvBreakdown(
  units: readonly (ProposedUnit | ProposedUnitV6)[],
): GdvBreakdown {
  const internal = units.reduce((s, u) => s + u.estimated_value_pence, 0);
  const ancillary = units.reduce((s, u) => s + unitAncillaryValuePence(u), 0);
  return { internal_pence: internal, ancillary_pence: ancillary, total_pence: internal + ancillary };
}

/** Total developer GDV. Retained as the total so every existing caller is
 *  unaffected by the R9 split; use `calculateGdvBreakdown` where the parts matter. */
export function calculateGdv(units: readonly (ProposedUnit | ProposedUnitV6)[]): number {
  return calculateGdvBreakdown(units).total_pence;
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
  // Fix round 2: `in` guard *and* `??`. A stored document can carry an explicit
  // `"jurisdiction": null` — migrateInputsToV5's already-v5 branch spreads
  // `saved.acquisition` over the defaults, so the null survives — and a bare `in`
  // guard would then reach selectBandSet and throw "No band sets for
  // null/non_residential", where the Python engine rejects the same document at
  // validation. Both engines must degrade the same way. Only `jurisdiction` is
  // fatal; a null date, override or reason are all absorbed downstream.
  const jurisdiction = 'jurisdiction' in acq ? acq.jurisdiction ?? 'england_ni' : 'england_ni';
  const rawDate = 'acquisition_date' in acq ? acq.acquisition_date : null;
  // Fix round 1: an unusable date (malformed, or uncovered) degrades to null
  // (assumed-current) here instead of throwing — see resolveAcquisitionDate's
  // doc comment. validateInputs re-derives this as a hard error independently.
  const date = resolveAcquisitionDate(jurisdiction, 'non_residential', rawDate);
  const sdlt = calculateAcquisitionTax({
    consideration_pence: acq.purchase_price_pence,
    jurisdiction,
    basis: 'non_residential',
    date,
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

/**
 * Spec §3.4 — the construction line of the cost stack.
 *
 * R9: the area is an explicit parameter. It used to read
 * `costs.total_construction_sqm` directly, which made this one of several sites
 * that each independently decided what "the construction area" meant. Callers
 * now resolve it once through `developedAreaSqm` (spec §15.4), and the eslint
 * guard makes reading the raw field here a build failure.
 */
export function calculateTotalConstructionCost(
  costs: ConversionCostInputs,
  areaSqm: number,
): number {
  // Spec §1.1: fractional-area products round once, at source, in one step before
  // contingency -- base = round_half_up(construction_cost_per_sqm_pence × area).
  // Integer-sqm inputs are unaffected (rounding an already-integer product is identity).
  const baseCost = Math.round(costs.construction_cost_per_sqm_pence * areaSqm);
  // R10 Task 9 fix round 1 (C1): this is computeCostPlan's predecessor, still the
  // live cost estimate migrate.ts's v1→v2 bootstrap uses (there is no cost_plan
  // yet that early in the migration chain) — a legitimate read, line-scoped
  // rather than allowlisting the whole file, which would also un-guard
  // total_construction_sqm, TAX_TABLES and selectBandSet here.
  // eslint-disable-next-line no-restricted-syntax -- legitimate: computeCostPlan's predecessor (see above)
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

