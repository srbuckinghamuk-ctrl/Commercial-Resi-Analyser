/** R11 spec §17. VAT: treatment by charge category, an optional per-line
 *  override, the HMRC return cycle, and the engine that turns them into cash.
 *
 *  This module owns the VAT block the way areas.ts owns the bridge and
 *  cost-plan.ts owns the cost plan. `resolveVatTreatment` is the ONLY function
 *  anywhere that may read `vat.treatments` or a `vat_override` — see §17.2 and
 *  the single-accessor guard in eslint.config.js. */
import type {
  AnyCalculatorInputs, EvidenceStatus, MonthReceipts, MonthUses, Schedule,
} from './finance-types';
import type { CostPlanResult } from './cost-plan';

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

export interface VatReturnPeriod {
  index: number;
  first_month: number;
  last_month: number;
  /** null where the reclaim falls outside the modelled term. Never clamped
   *  into the final month — that would manufacture a receipt (§17.4). */
  reclaim_month: number | null;
}

/** §17.4. The first return period covers months 0..first_period_end_month
 *  inclusive; subsequent periods are one month (monthly) or three months
 *  (quarterly). VAT incurred anywhere in a period is reclaimed in a single
 *  amount at period_end + repayment_lag_months. A reclaim falling after the
 *  final modelled month is reported as null, never clamped into the final
 *  month — that would manufacture a receipt the borrower has not had. */
export function vatReturnPeriods(vat: VatInputs, termMonths: number): VatReturnPeriod[] {
  if (!vat.registered) return [];
  const term = Math.max(1, Math.floor(termMonths));
  const length = vat.return_frequency === 'quarterly' ? 3 : 1;
  const lag = Math.max(0, Math.floor(vat.repayment_lag_months));
  const periods: VatReturnPeriod[] = [];
  let first = 0;
  let end = Math.max(0, Math.floor(vat.first_period_end_month));
  let index = 0;
  while (first <= term - 1) {
    const last = Math.min(end, term - 1);
    const reclaim = last + lag;
    periods.push({
      index,
      first_month: first,
      last_month: last,
      reclaim_month: reclaim <= term - 1 ? reclaim : null,
    });
    first = last + 1;
    end = last + length;
    index += 1;
  }
  return periods;
}

/** §17.7, stated as one biconditional rather than three branches so that
 *  `'unconfirmed'` needs no separate clause: an unconfirmed TOGC is charged,
 *  which is the prudent case. Where TOGC applies, VAT is nil regardless of the
 *  option to tax — that is the whole effect of a TOGC (§17.3). */
export function isPurchaseVatChargeable(purchase: PurchaseVatInputs): boolean {
  return purchase.vendor_opted_to_tax && purchase.togc_treatment !== 'applies';
}

// ---------------------------------------------------------------------------
// §17.5 — the engine, and it runs in ONE direction only.
//
// `computeVat` reads the cost plan and the spend profile. NOTHING in the cost
// plan reads VAT: no fee basis, no contingency base and no construction total
// includes a VAT figure. That is what makes a cycle impossible by construction
// rather than detected — there is no ordering to get wrong, no iteration and no
// cycle detection.
//
// The direct consequence, and it reads wrong until you have held the argument:
// irrecoverable VAT is NOT folded back into `construction_cost_pence`. It
// becomes its own line, which the metrics task adds to cost-before-finance. If
// anything here ever wants to adjust a cost total, that is the defect this
// design exists to prevent.
// ---------------------------------------------------------------------------

/** One resolved charge. Rounding happens ONCE here, per line, and the months
 *  are spread from the rounded figure — three charges at 20% are not one charge
 *  at 60%, the same rule the cost plan already follows for contingency classes
 *  ("Sum of ROUNDED figures", §16). */
export interface VatChargeLine {
  /** Stable within a run: `category:<name>`, `package:<id>` or `fee:<id>`. */
  id: string;
  category: VatChargeCategory;
  label: string;
  /** Whichever precedence `resolveVatTreatment` applied. */
  source: 'category' | 'override';
  /** VAT-exclusive base. Never includes a VAT figure, and never double counts:
   *  where a package or fee line is overridden, its amount is subtracted from
   *  its category's base and carried on the override's own line instead. */
  net_base_pence: number;
  rate_pct: number;
  recoverable_pct: number;
  recovery_basis: RecoveryBasis;
  evidence_status: EvidenceStatus;
  vat_pence: number;
  recoverable_pence: number;
  /** charged − recoverable, so the rounding residue lands in irrecoverable
   *  rather than being lost. This is the figure that becomes a real cost. */
  irrecoverable_pence: number;
}

export interface VatMonthLine {
  month: number;
  incurred_pence: number;
  reclaimed_pence: number;
  /** Cumulative incurred − cumulative reclaimed. The saw-tooth a lender sizes
   *  a VAT facility against (§17.4). */
  carry_pence: number;
}

export interface VatResult {
  registered: boolean;
  charges: VatChargeLine[];
  periods: VatReturnPeriod[];
  months: VatMonthLine[];
  total_input_vat_pence: number;
  total_recoverable_pence: number;
  total_irrecoverable_pence: number;
  total_reclaimed_pence: number;
  /** Reclaims falling after the final modelled month. Reported, never credited
   *  to the ledger — clamping them into the final month would manufacture a
   *  receipt the borrower has not had (§17.4). */
  receivable_at_maturity_pence: number;
  peak_carry_pence: number;
  peak_carry_month: number | null;
  /** Disclosure of the acquisition line's VAT, so §17.7's chargeable
   *  consideration is visible rather than buried in a tax figure. */
  purchase_vat_pence: number;
}

/**
 * Integer-pence pro-rata allocation summing EXACTLY to `total`.
 *
 * Every month but the last non-zero weight takes `Math.round(total·wᵢ/Σw)`; the
 * last non-zero weight absorbs the residue, mirroring `spreadStraightLine` and
 * `spreadByCurve` (spec §6.1's invariant).
 *
 * When `Σw === 0` it returns all zeros — this function has no month to prefer,
 * so it makes no choice. The CALLER decides what an unplaceable charge means:
 * `computeVat` falls back to month 0 (ruling R15), because a charged penny the
 * months never carry is never funded by the ledger while Task 8 still puts its
 * irrecoverable part into cost-before-finance — a cost in the profit line no
 * source ever paid for.
 */
export function spreadProRata(total: number, weights: readonly number[]): number[] {
  const out: number[] = new Array(weights.length).fill(0);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0) return out;
  let last = -1;
  for (let i = 0; i < weights.length; i += 1) if (weights[i] !== 0) last = i;
  let allocated = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (i === last) continue;
    out[i] = Math.round((total * weights[i]) / sum);
    allocated += out[i];
  }
  out[last] = total - allocated;
  return out;
}

const CATEGORY_LABEL: Readonly<Record<VatChargeCategory, string>> = {
  acquisition: 'Purchase price',
  construction: 'Construction',
  professional: 'Professional fees',
  statutory: 'Statutory costs',
  selling: 'Selling costs',
  // §17.3: a FINANCE-side charge. It must never be swept into the professional
  // total — that moves money between two separately-reported, separately-spread
  // lines while every grand total stays correct, exactly the trap
  // FEE_CODE_CATEGORY's `building_control` comment records.
  lender_ancillary: 'Lender ancillary fees',
};

function chargeLine(
  id: string,
  category: VatChargeCategory,
  label: string,
  resolved: ResolvedVatTreatment,
  netBase: number,
): VatChargeLine {
  const vatPence = Math.round((netBase * resolved.rate_pct) / 100);
  const recoverable = Math.round((vatPence * resolved.recoverable_pct) / 100);
  return {
    id,
    category,
    label,
    source: resolved.source,
    net_base_pence: netBase,
    rate_pct: resolved.rate_pct,
    recoverable_pct: resolved.recoverable_pct,
    recovery_basis: resolved.recovery_basis,
    evidence_status: resolved.evidence_status,
    vat_pence: vatPence,
    recoverable_pence: recoverable,
    irrecoverable_pence: vatPence - recoverable,
  };
}

function inertVat(termMonths: number): VatResult {
  return {
    registered: false,
    charges: [],
    periods: [],
    months: Array.from({ length: termMonths }, (_, month) => ({
      month, incurred_pence: 0, reclaimed_pence: 0, carry_pence: 0,
    })),
    total_input_vat_pence: 0,
    total_recoverable_pence: 0,
    total_irrecoverable_pence: 0,
    total_reclaimed_pence: 0,
    receivable_at_maturity_pence: 0,
    peak_carry_pence: 0,
    peak_carry_month: null,
    purchase_vat_pence: 0,
  };
}

/**
 * §17.5. Charges, timing and recovery — strictly downstream of the cost plan.
 *
 * The third parameter is a `Pick`, not a `Schedule` (ruling R2): VAT reads the
 * spend profile and nothing else, so there is no way to reach `schedule.vat`
 * from inside the function that produces it, and the schedule task can call
 * this with a part-built object without a cast.
 *
 * Timing follows each base's own spend months, read from the schedule rather
 * than assumed: acquisition and lender-ancillary VAT land where the schedule
 * puts those uses (month 0), construction/professional/statutory follow their
 * own `uses` curve, and selling VAT follows `receipts`, weighted by each
 * month's `agent_fee_pence + selling_legal_pence`. An overridden line follows
 * its own CATEGORY's curve — R11 does not model per-package programme timing;
 * R12's dated programme does.
 */
export function computeVat(
  inputs: AnyCalculatorInputs,
  costPlan: CostPlanResult,
  schedule: Pick<Schedule, 'term_months' | 'uses' | 'receipts'>,
): VatResult {
  const term = Math.max(1, Math.floor(schedule.term_months));
  // Read structurally, exactly as validation.ts reads `cost_plan` and `areas`:
  // a pre-v8 document has no `vat` block at all and must be inert, not crash.
  const vat = 'vat' in inputs ? inputs.vat : null;
  if (vat == null || !vat.registered) return inertVat(term);

  const usesAt = (m: number): MonthUses | undefined => schedule.uses[m];
  const receiptsAt = (m: number): MonthReceipts | undefined => schedule.receipts[m];
  const weightsFrom = (pick: (u: MonthUses) => number): number[] =>
    Array.from({ length: term }, (_, m) => {
      const u = usesAt(m);
      return u === undefined ? 0 : pick(u);
    });
  const sellingWeights = Array.from({ length: term }, (_, m) => {
    const r = receiptsAt(m);
    return r === undefined ? 0 : r.agent_fee_pence + r.selling_legal_pence;
  });
  // Month 0 — where the ledger capitalises the ancillary fees, and the fallback
  // for any charge whose own base has no spend months at all (ruling R15).
  const monthZeroWeights = Array.from({ length: term }, (_, m) => (m === 0 ? 1 : 0));
  const weights: Readonly<Record<VatChargeCategory, number[]>> = {
    acquisition: weightsFrom((u) => u.acquisition_pence),
    construction: weightsFrom((u) => u.construction_pence),
    professional: weightsFrom((u) => u.professional_pence),
    statutory: weightsFrom((u) => u.statutory_pence),
    selling: sellingWeights,
    lender_ancillary: monthZeroWeights,
  };

  // §17.3 and ruling R13. Interest and the arrangement, exit, non-utilisation
  // and extension fees are exempt financial services and never bear VAT;
  // `lender_ancillary` — broker, lender legal, valuation, monitoring surveyor —
  // is the ONLY finance-side base, and there is no code path from here to an
  // interest or arrangement-fee figure.
  //
  // The base comes from `inputs.finance`, NOT from
  // `MonthUses.lender_ancillary_fees_pence`: that schedule field is initialised
  // to 0 in `emptyUses()` and never assigned by `buildSchedule`, because the
  // ledger computes and capitalises these fees itself (monthly-engine.ts:57-60).
  // Reading it would leave this charge structurally zero forever — R10's
  // "recorded but not live" shape. `finance` is an INPUT, so the one-direction
  // rule is intact. Gated exactly as the ledger gates it: a cash deal, or one
  // with no committed net facility, pays no lender fees and must bear no VAT on
  // them.
  const finance = inputs.finance;
  const isCash = finance.funding_source === 'cash';
  const netFacility = isCash ? 0 : (finance.committed_net_facility_pence ?? 0);
  const hasFacility = !isCash && netFacility > 0;
  const lenderAncillaryBase = hasFacility
    ? finance.broker_fee_pence + finance.lender_legal_fee_pence
      + finance.valuation_fee_pence + finance.monitoring_surveyor_fee_pence
    : 0;

  // The per-line overrides live on the INPUT cost plan; the computed amounts
  // live on the result. Matched by id so a pct-based fee is charged on the
  // amount the cost plan actually resolved, not on its stale `amount_pence`.
  const plan = 'cost_plan' in inputs && inputs.cost_plan != null ? inputs.cost_plan : null;
  const packageOverrides = new Map<string, VatOverride>();
  const feeOverrides = new Map<string, VatOverride>();
  if (plan != null) {
    for (const p of plan.packages) {
      if (p.vat_override != null) packageOverrides.set(p.id, p.vat_override);
    }
    for (const f of plan.fee_lines) {
      if (f.vat_override != null) feeOverrides.set(f.id, f.vat_override);
    }
  }

  const category = (c: VatChargeCategory, base: number): VatChargeLine =>
    chargeLine(
      `category:${c}`, c, CATEGORY_LABEL[c],
      resolveVatTreatment(vat, { category: c, override: null }), base,
    );

  // --- acquisition: purchase VAT, and only purchase VAT (§17.7) ---
  const purchaseBase = isPurchaseVatChargeable(vat.purchase)
    ? inputs.acquisition.purchase_price_pence
    : 0;

  // --- construction: the category base is net of every overridden package ---
  // Gated on detailed mode, mirroring cost-plan.ts:262: `computeCostPlan`
  // returns `packages` populated in EITHER mode but folds their amounts into
  // `construction_total_pence` only in detailed mode. Subtracting
  // unconditionally would drive a headline document's category base negative —
  // negative VAT, negative months, and a negative contribution to
  // `total_irrecoverable_pence` that Task 8 adds to cost-before-finance.
  // validation.ts:244-246 hard-errors on headline-with-packages, so this is
  // latent, not live; the unvalidated path still has to degrade to something
  // defined rather than to silently negative money, exactly as schedule.ts:74-82
  // records for its own clamp.
  const detailed = costPlan.mode === 'detailed';
  const packageLines: VatChargeLine[] = [];
  let overriddenPackages = 0;
  for (const p of detailed ? costPlan.packages : []) {
    const override = packageOverrides.get(p.id);
    if (override === undefined) continue;
    overriddenPackages += p.amount_pence;
    packageLines.push(chargeLine(
      `package:${p.id}`, 'construction', p.label !== '' ? p.label : p.code,
      resolveVatTreatment(vat, { category: 'construction', override }), p.amount_pence,
    ));
  }

  // --- fees: same subtraction, per fee CATEGORY ---
  const professionalLines: VatChargeLine[] = [];
  const statutoryLines: VatChargeLine[] = [];
  let overriddenProfessional = 0;
  let overriddenStatutory = 0;
  for (const f of costPlan.fees) {
    const override = feeOverrides.get(f.id);
    if (override === undefined) continue;
    const cat: VatChargeCategory = f.category === 'statutory' ? 'statutory' : 'professional';
    const line = chargeLine(
      `fee:${f.id}`, cat, f.label !== '' ? f.label : f.code,
      resolveVatTreatment(vat, { category: cat, override }), f.amount_pence,
    );
    if (cat === 'statutory') { overriddenStatutory += f.amount_pence; statutoryLines.push(line); }
    else { overriddenProfessional += f.amount_pence; professionalLines.push(line); }
  }

  const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

  const acquisitionLine = category('acquisition', purchaseBase);
  const charges: VatChargeLine[] = [
    acquisitionLine,
    category('construction', costPlan.construction_total_pence - overriddenPackages),
    ...packageLines,
    category('professional', costPlan.professional_total_pence - overriddenProfessional),
    ...professionalLines,
    category('statutory', costPlan.statutory_total_pence - overriddenStatutory),
    ...statutoryLines,
    category('selling', sum(sellingWeights)),
    category('lender_ancillary', lenderAncillaryBase),
  ];

  // Spread each ROUNDED charge line across its base's months. The charged and
  // the recoverable amounts are spread separately over the same weights, so a
  // partly-recoverable line reclaims exactly its recoverable figure.
  const incurred: number[] = new Array(term).fill(0);
  const recoverableByMonth: number[] = new Array(term).fill(0);
  for (const c of charges) {
    if (c.vat_pence === 0 && c.recoverable_pence === 0) continue;
    // Ruling R15: a base with no spend months places its VAT in month 0 rather
    // than nowhere, so `Σ months[].incurred_pence === total_input_vat_pence`
    // holds for every document and the ledger funds every penny charged.
    const own = weights[c.category];
    const w = sum(own) === 0 ? monthZeroWeights : own;
    const inc = spreadProRata(c.vat_pence, w);
    const rec = spreadProRata(c.recoverable_pence, w);
    for (let m = 0; m < term; m += 1) {
      incurred[m] += inc[m];
      recoverableByMonth[m] += rec[m];
    }
  }

  // §17.4: input VAT incurred anywhere in a period is reclaimed in ONE amount at
  // period_end + repayment_lag_months. A reclaim landing past the final month is
  // receivable, never clamped into it.
  const periods = vatReturnPeriods(vat, term);
  const reclaimed: number[] = new Array(term).fill(0);
  let receivable = 0;
  for (const p of periods) {
    let amount = 0;
    for (let m = p.first_month; m <= p.last_month && m < term; m += 1) {
      amount += recoverableByMonth[m];
    }
    if (amount === 0) continue;
    if (p.reclaim_month == null) receivable += amount;
    else reclaimed[p.reclaim_month] += amount;
  }

  const months: VatMonthLine[] = [];
  let cumulativeIncurred = 0;
  let cumulativeReclaimed = 0;
  let peakCarry = 0;
  let peakCarryMonth: number | null = null;
  for (let m = 0; m < term; m += 1) {
    cumulativeIncurred += incurred[m];
    cumulativeReclaimed += reclaimed[m];
    const carry = cumulativeIncurred - cumulativeReclaimed;
    months.push({
      month: m,
      incurred_pence: incurred[m],
      reclaimed_pence: reclaimed[m],
      carry_pence: carry,
    });
    if (carry > peakCarry) { peakCarry = carry; peakCarryMonth = m; }
  }

  return {
    registered: true,
    charges,
    periods,
    months,
    total_input_vat_pence: sum(charges.map((c) => c.vat_pence)),
    total_recoverable_pence: sum(charges.map((c) => c.recoverable_pence)),
    total_irrecoverable_pence: sum(charges.map((c) => c.irrecoverable_pence)),
    total_reclaimed_pence: sum(reclaimed),
    receivable_at_maturity_pence: receivable,
    peak_carry_pence: peakCarry,
    peak_carry_month: peakCarryMonth,
    purchase_vat_pence: acquisitionLine.vat_pence,
  };
}
