/** R11 spec §17. VAT: treatment by charge category, an optional per-line
 *  override, the HMRC return cycle, and the engine that turns them into cash.
 *
 *  This module owns the VAT block the way areas.ts owns the bridge and
 *  cost-plan.ts owns the cost plan. `resolveVatTreatment` is the ONLY function
 *  anywhere that may read `vat.treatments` or a `vat_override` — see §17.2 and
 *  the single-accessor guard in eslint.config.js. */
import type { EvidenceStatus } from './finance-types';

export type VatChargeCategory =
  | 'acquisition' | 'construction' | 'professional'
  | 'statutory' | 'selling' | 'lender_ancillary';

/** Fixed order. `VatInputs.treatments` must hold exactly these, once each, in
 *  this sequence — schema, not a user-managed list, exactly as
 *  `CostPlanInputs.contingency` is (spec §16.3). */
export const VAT_CHARGE_CATEGORIES: readonly VatChargeCategory[] = [
  'acquisition', 'construction', 'professional', 'statutory', 'selling', 'lender_ancillary',
];

export type RecoveryBasis =
  | 'zero_rated_sale' | 'partial_exemption' | 'blocked' | 'unconfirmed';

export type TogcTreatment = 'applies' | 'does_not_apply' | 'unconfirmed';

export interface VatTreatment {
  category: VatChargeCategory;
  rate_pct: number;
  recoverable_pct: number;
  recovery_basis: RecoveryBasis;
  /** Reuses EquitySource.evidence_status' vocabulary deliberately: the report
   *  handles evidence with one mechanism, not two (R8 precedent). */
  evidence_status: EvidenceStatus;
  notes: string;
}

/** Detailed-mode only. States rate and recovery for one package or fee line; it
 *  deliberately does NOT state evidence, which stays a category-level fact. */
export interface VatOverride {
  rate_pct: number;
  recoverable_pct: number;
  recovery_basis: RecoveryBasis;
}

export interface PurchaseVatInputs {
  vendor_opted_to_tax: boolean;
  togc_treatment: TogcTreatment;
  evidence_status: EvidenceStatus;
  notes: string;
}

export interface VatInputs {
  registered: boolean;
  return_frequency: 'monthly' | 'quarterly';
  /** 0-indexed month offset at which the first return period ends. */
  first_period_end_month: number;
  repayment_lag_months: number;
  treatments: VatTreatment[];
  purchase: PurchaseVatInputs;
}

export function defaultVatTreatments(): VatTreatment[] {
  return VAT_CHARGE_CATEGORIES.map((category) => ({
    category,
    rate_pct: 0,
    recoverable_pct: 0,
    recovery_basis: 'unconfirmed' as const,
    evidence_status: 'unconfirmed' as const,
    notes: '',
  }));
}

/** A new document and a migrated document get the SAME block. §17.11: the
 *  engine is inert, so no existing appraisal's computed values move, and the
 *  feature ships opt-in exactly as detailed cost-plan mode did. */
export const DEFAULT_VAT: VatInputs = {
  registered: false,
  return_frequency: 'quarterly',
  first_period_end_month: 2,
  repayment_lag_months: 1,
  treatments: defaultVatTreatments(),
  purchase: {
    vendor_opted_to_tax: false,
    togc_treatment: 'unconfirmed',
    evidence_status: 'unconfirmed',
    notes: '',
  },
};

export interface VatCharge {
  category: VatChargeCategory;
  override: VatOverride | null;
}

export interface ResolvedVatTreatment {
  rate_pct: number;
  recoverable_pct: number;
  recovery_basis: RecoveryBasis;
  evidence_status: EvidenceStatus;
  source: 'category' | 'override';
}

const INERT: ResolvedVatTreatment = {
  rate_pct: 0, recoverable_pct: 0, recovery_basis: 'unconfirmed',
  evidence_status: 'unconfirmed', source: 'category',
};

/** THE single read site for `vat.treatments` and for any `vat_override`.
 *  Adding a second one is a lint failure, not a review comment. */
export function resolveVatTreatment(vat: VatInputs, charge: VatCharge): ResolvedVatTreatment {
  if (!vat.registered) return INERT;
  const row = vat.treatments.find((t) => t.category === charge.category);
  if (row === undefined) return INERT;
  if (charge.override == null) {
    return {
      rate_pct: row.rate_pct,
      recoverable_pct: row.recoverable_pct,
      recovery_basis: row.recovery_basis,
      evidence_status: row.evidence_status,
      source: 'category',
    };
  }
  return {
    rate_pct: charge.override.rate_pct,
    recoverable_pct: charge.override.recoverable_pct,
    recovery_basis: charge.override.recovery_basis,
    // Evidence stays a category fact. An override that could silently claim
    // 'confirmed' would blind the §17.10 draft gate.
    evidence_status: row.evidence_status,
    source: 'override',
  };
}

/** §17.7, stated as one biconditional rather than three branches so that
 *  `'unconfirmed'` needs no separate clause: an unconfirmed TOGC is charged,
 *  which is the prudent case. Where TOGC applies, VAT is nil regardless of the
 *  option to tax — that is the whole effect of a TOGC (§17.3). */
export function isPurchaseVatChargeable(purchase: PurchaseVatInputs): boolean {
  return purchase.vendor_opted_to_tax && purchase.togc_treatment !== 'applies';
}
