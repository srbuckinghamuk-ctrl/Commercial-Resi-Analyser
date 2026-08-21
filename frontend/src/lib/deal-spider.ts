import type { ProposedUnit, UnitType, DealSpiderInputs, AcquisitionInputs } from './conversion-types';
import type { EligibilityAssessment } from '../types';
import { calculateRlv } from './conversion-calc-engine';
import { chargeableConsiderationPence } from './model/vat';
import { calculateAcquisitionTax, resolveAcquisitionDate } from './tax/acquisition-tax';
import { applyScenario } from './model/apply-scenario';
import { runAppraisal } from './model';
import type { AnyCalculatorInputs } from './model';
import type { AcquisitionInputsV5 } from './model/finance-types';
import { CLASS_MA_AXES } from './spider-axes';
import type { SpiderAxisId, SpiderAxisDef } from './spider-axes';

export { CLASS_MA_AXES };
export type { SpiderAxisId, SpiderAxisDef };

// ── Scenario palette (ported from the refurb calculator) ─

export const SCENARIO_COLORS = {
  base: '#4a98c8', // blue
  upside: '#3acc88', // green
  downside: '#e05060', // red
  severe: '#e09040', // amber
  s1: '#c060c0', // purple
  s2: '#30b8cc', // teal
} as const;

export const SCENARIO_COLOR_LIST = [
  SCENARIO_COLORS.base,
  SCENARIO_COLORS.upside,
  SCENARIO_COLORS.downside,
  SCENARIO_COLORS.severe,
  SCENARIO_COLORS.s1,
  SCENARIO_COLORS.s2,
];

export function scenarioColor(name: string, fallback: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('upside')) return SCENARIO_COLORS.upside;
  if (n.includes('downside')) return SCENARIO_COLORS.downside;
  if (n.includes('severe')) return SCENARIO_COLORS.severe;
  if (n.includes('base')) return SCENARIO_COLORS.base;
  return fallback;
}

// ── Axis definitions ─────────────────────────────────────
// SpiderAxisId, SpiderAxisDef and CLASS_MA_AXES live in ./spider-axes and
// are re-exported above.

// Eligibility checks that legally gate Class MA — a confirmed fail means the
// scheme cannot proceed under permitted development rights.
export const HARD_GATE_KEYS = [
  'use_class_check',
  'floor_area_limit',
  'article_4',
  'listed_building',
  'vacancy_period',
  'prior_refusal',
];

// Unverified state on these caps the prior-approval axis at 2 (provisional).
const VERIFY_CAP_KEYS = ['article_4', 'vacancy_period'];

// ── NDSS ─────────────────────────────────────────────────

export const NDSS_MIN_SQM: Record<UnitType, number> = {
  studio: 37,
  '1bed': 50,
  '2bed': 61,
  '3bed': 74,
};

export function ndssPassPct(units: ProposedUnit[]): number {
  if (units.length === 0) return 0;
  const passing = units.filter((u) => u.floor_area_sqm >= NDSS_MIN_SQM[u.type]).length;
  return (passing / units.length) * 100;
}

// ── Normalisation ────────────────────────────────────────

export function normaliseAxis(
  def: Pick<SpiderAxisDef, 'min' | 'max' | 'direction'>,
  raw: number,
): number {
  const fraction = (raw - def.min) / (def.max - def.min);
  const oriented = def.direction === 'higher' ? fraction : 1 - fraction;
  return Math.min(5, Math.max(0, oriented * 5));
}

// ── Spider computation ───────────────────────────────────

export interface SpiderAxisResult {
  id: SpiderAxisId;
  label: string;
  short: string;
  unit: string;
  help: string;
  raw: number;
  score: number; // 0–5
  weight: number;
  weighted: number;
  provisional: boolean;
  note: string | null;
}

export interface SpiderResult {
  axes: SpiderAxisResult[];
  overall: number | null; // 0–5, null when blocked
  rag: 'green' | 'amber' | 'red' | 'blocked';
  blocked: boolean;
  blockedBy: string[];
  caveats: string[];
  max_bid_pence: number;
}

interface PriorApprovalScore {
  raw: number;
  provisional: boolean;
  note: string | null;
  blockedBy: string[];
}

function scorePriorApproval(eligibility: EligibilityAssessment | null): PriorApprovalScore {
  if (!eligibility || eligibility.criteria.length === 0) {
    return {
      raw: 2,
      provisional: true,
      note: 'No eligibility assessment found — run the Eligibility check. Score capped at 2 until then.',
      blockedBy: [],
    };
  }

  const criteria = eligibility.criteria;
  const hardFails = criteria.filter((c) => c.passed === false && HARD_GATE_KEYS.includes(c.key));
  if (hardFails.length > 0) {
    return {
      raw: 0,
      provisional: false,
      note: `Hard gate failed: ${hardFails.map((c) => c.label).join('; ')}`,
      blockedBy: hardFails.map((c) => c.label),
    };
  }

  const passed = criteria.filter((c) => c.passed === true).length;
  let raw = (passed / criteria.length) * 5;

  const unverifiedGates = criteria.filter(
    (c) => VERIFY_CAP_KEYS.includes(c.key) && (c.passed === null || c.risk_flag !== null),
  );
  const unconfirmed = criteria.filter((c) => c.passed === null);

  let note: string | null = null;
  if (unverifiedGates.length > 0) {
    raw = Math.min(raw, 2);
    note = `Unverified: ${unverifiedGates.map((c) => c.label).join('; ')} — axis capped at 2 until confirmed.`;
  } else if (unconfirmed.length > 0) {
    note = `${unconfirmed.length} check(s) unconfirmed: ${unconfirmed.map((c) => c.label).join('; ')}`;
  }

  return {
    raw,
    provisional: unverifiedGates.length > 0 || unconfirmed.length > 0,
    note,
    blockedBy: [],
  };
}

function buildingSafetyBand(spider: DealSpiderInputs): number {
  const higherRisk =
    spider.bsa_higher_risk || spider.building_height_m >= 18 || spider.storeys >= 7;
  if (higherRisk) return 0;
  if (spider.building_height_m >= 11 || spider.storeys >= 5) return 3;
  return 5;
}

export function computeSpider(
  inputs: AnyCalculatorInputs,
  eligibility: EligibilityAssessment | null,
): SpiderResult {
  const spider = inputs.deal_spider;
  const metrics = runAppraisal(inputs).metrics;
  const downsideMetrics = runAppraisal(applyScenario(inputs, inputs.scenarios.downside)).metrics;
  const priorApproval = scorePriorApproval(eligibility);

  // Tax advantage. §17.7: BOTH regimes are charged on the same VAT-inclusive
  // consideration — comparing a VAT-inclusive residential figure against a
  // VAT-exclusive commercial one would manufacture an advantage out of the
  // base, not the rates. Branded, so the intermediate variable this file used
  // to launder the raw price through no longer type-checks.
  const consideration = chargeableConsiderationPence(inputs);
  // R8 Task 7: both sides of this comparison must be the same regime, or the
  // score compares English residential rates against Scottish/Welsh commercial
  // ones. v2–v4 documents carry no jurisdiction at all — same `in` guard as
  // metrics.ts and conversion-calc-engine.ts — so they degrade to england_ni,
  // exactly as they always implicitly were, unchanged to the penny (Task 5's
  // reproduction of the deleted residential-sdlt.ts module).
  const acq = inputs.acquisition as Partial<AcquisitionInputsV5> & AcquisitionInputs;
  const jurisdiction = 'jurisdiction' in acq ? acq.jurisdiction ?? 'england_ni' : 'england_ni';
  const rawDate = 'acquisition_date' in acq ? acq.acquisition_date ?? null : null;
  // Fix round 1 (metrics.ts / conversion-calc-engine.ts): an unusable date
  // degrades to null (assumed-current) instead of throwing — see
  // resolveAcquisitionDate's doc comment. Resolved once per basis, since a
  // date can be covered by one basis's band set and not the other's.
  const residentialDate = resolveAcquisitionDate(jurisdiction, 'residential_higher', rawDate);
  const commercialDate = resolveAcquisitionDate(jurisdiction, 'non_residential', rawDate);
  const residentialSdlt = calculateAcquisitionTax({
    consideration_pence: consideration, jurisdiction,
    basis: 'residential_higher', date: residentialDate,
  }).total_pence;
  const commercialSdlt = calculateAcquisitionTax({
    consideration_pence: consideration, jurisdiction,
    basis: 'non_residential', date: commercialDate,
  }).total_pence;
  // Task 13 (spec §17.10). The hard-coded `construction_cost_pence * 0.15`
  // guess is replaced by the modelled figure: the VAT actually saved against a
  // standard-rated (UK 20%) counterfactual, less irrecoverable VAT and the VAT
  // carry's own finance cost. Every term is read off the RESULT
  // (`metrics.vat.charges[].net_base_pence`/`.vat_pence`, both already
  // resolved by `computeVat`, plus `metrics.irrecoverable_vat_pence` and
  // `metrics.vat_carry_interest_pence`) — none of `resolveVatTreatment`'s own
  // rate/recoverable/rounding logic is re-derived here. R9 recorded three
  // self-referential tests that recomputed the engine's own arithmetic and
  // would have agreed with a bug in it forever; this keeps that door shut by
  // construction, not by discipline.
  //
  // An unregistered (inert) document has `charges: []` and both metrics
  // figures at 0 (vat.ts's `inertVat()`), so this resolves to exactly 0 — the
  // true state ("VAT not modelled"), not a discovered "no tax advantage". The
  // distinction is surfaced below via `taxAdvantageNote`, not silently dropped.
  //
  // Ruling R43 (fix round 1, spec §17.10 "the spider's counterfactual counts
  // only evidenced rates"). Every category ships at `rate_pct: 0,
  // evidence_status: 'unconfirmed'` by default and nothing forces a user to
  // touch all six before setting `registered: true` — so "registered, one
  // category ever configured" is a valid, likely state. A 0% rate nobody has
  // filled in is arithmetically indistinguishable from a 0% rate someone
  // determined, so an untouched category must NOT be scored as a 20% saving.
  // The counterfactual therefore sums only charge lines whose
  // `evidence_status` is `'confirmed'` — an unevidenced rate contributes
  // nothing to a claimed saving, the same principle the rest of the release
  // runs on.
  const STANDARD_VAT_RATE_PCT = 20;
  const grossVatSavedVsStandardRate = metrics.vat.charges
    .filter((c) => c.evidence_status === 'confirmed')
    .reduce(
      (sum, c) => sum + (Math.round((c.net_base_pence * STANDARD_VAT_RATE_PCT) / 100) - c.vat_pence),
      0,
    );
  // Ruling R47. The two deductions below are WHOLE-DOCUMENT figures — unlike
  // `grossVatSavedVsStandardRate` above, they are NOT filtered to charge lines
  // whose `evidence_status` is `'confirmed'`. That asymmetry is deliberate,
  // not an oversight: `irrecoverable_vat_pence` and `vat_carry_interest_pence`
  // are real costs of the whole VAT position however each line is evidenced —
  // deducting only the confirmed share would UNDERSTATE them, since an
  // unconfirmed rate can still be charging real, irrecoverable VAT today. So
  // an unconfirmed line's irrecoverable VAT is deducted from a saving it was
  // not allowed to contribute to above; that is the conservative direction
  // for this figure to be asymmetric in, and it is why `taxAdvantageNote`
  // below does not claim the two sides are treated alike.
  const vatSaving =
    grossVatSavedVsStandardRate - metrics.irrecoverable_vat_pence - metrics.vat_carry_interest_pence;
  const taxAdvantagePct =
    metrics.gdv_pence > 0
      ? ((residentialSdlt - commercialSdlt + vatSaving + spider.cil_offset_pence) /
          metrics.gdv_pence) *
        100
      : 0;

  // Judgement calls 2 and 3 (task-13 brief, spec §17.10), R43-corrected:
  // `vatBasisGate` is deliberately NOT reused here (fix round 1 — that
  // instruction was wrong). `vatBasisGate` asks "does this document have
  // MATERIAL unconfirmed VAT?" and correctly ignores a non-charging
  // unconfirmed row, because for the §17.10 draft gate there is nothing at
  // stake in a row that charges nothing. Here a non-charging unconfirmed row
  // is EXACTLY where the phantom saving above is manufactured, so the axis
  // asks a different question: is ANY charge line unevidenced, whether or not
  // it currently charges? That is a second rule because it is a different
  // predicate, not a duplicate of the first.
  const anyChargeLineUnconfirmed = metrics.vat.charges.some((c) => c.evidence_status !== 'confirmed');
  const taxAdvantageNote: string | null = !metrics.vat.registered
    ? 'VAT saving not modelled: this document is not VAT-registered, so the figure above reflects SDLT and CIL only — it is not a confirmed zero tax advantage.'
    : anyChargeLineUnconfirmed
      ? 'VAT evidence UNCONFIRMED for at least one charge category (only confirmed rows count toward the saving above — irrecoverable VAT and its carry interest are still deducted in full, whatever their evidence status) — obtain specific tax advice before relying on this figure.'
      : null;
  const taxAdvantageProvisional = taxAdvantageNote !== null;

  // Acquisition headroom against max bid (RLV at the configured target return).
  // The PRICE here, not the chargeable consideration: this is what the buyer
  // pays the vendor, stripped out of TDC so the residual is compared against a
  // bid. §17.7 moves the tax BASE, not the price a bid is measured against.
  const price = acq.purchase_price_pence;
  const totalCostExLand = metrics.total_development_cost_pence - price - metrics.sdlt_pence;
  const maxBid = calculateRlv(totalCostExLand, metrics.gdv_pence, spider.target_profit_on_cost_pct);
  const headroomPct = maxBid > 0 ? ((maxBid - price) / maxBid) * 100 : -100;

  const exitCount = [spider.exit_sell, spider.exit_refinance, spider.exit_hold, spider.exit_part_sale].filter(
    Boolean,
  ).length;

  const programmeMonths =
    spider.prior_approval_window_months + inputs.finance.term_months + spider.programme_contingency_months;

  const deliverabilityPct = Math.min(ndssPassPct(inputs.unit_mix.units), spider.daylight_pass_pct);

  const raws: Record<SpiderAxisId, number> = {
    margin_resilience: downsideMetrics.profit_on_cost_pct ?? 0,
    prior_approval: priorApproval.raw,
    deliverability: deliverabilityPct,
    building_safety: buildingSafetyBand(spider),
    tax_advantage: taxAdvantagePct,
    programme: programmeMonths,
    sales_velocity: spider.absorption_months,
    exit_optionality: exitCount,
    acquisition_headroom: headroomPct,
  };

  const caveats: string[] = [];
  const axes: SpiderAxisResult[] = CLASS_MA_AXES.map((def) => {
    const raw = raws[def.id];
    const score = normaliseAxis(def, raw);
    const weight = spider.weights[def.id] ?? 1;
    const provisional =
      def.id === 'prior_approval' ? priorApproval.provisional
      : def.id === 'tax_advantage' ? taxAdvantageProvisional
      : false;
    const note =
      def.id === 'prior_approval' ? priorApproval.note
      : def.id === 'tax_advantage' ? taxAdvantageNote
      : null;
    if (provisional && note) caveats.push(`${def.short}: ${note}`);
    return {
      id: def.id,
      label: def.label,
      short: def.short,
      unit: def.unit,
      help: def.help,
      raw,
      score,
      weight,
      weighted: score * weight,
      provisional,
      note,
    };
  });

  const blocked = priorApproval.blockedBy.length > 0;
  if (blocked) {
    return {
      axes,
      overall: null,
      rag: 'blocked',
      blocked,
      blockedBy: priorApproval.blockedBy,
      caveats,
      max_bid_pence: maxBid,
    };
  }

  const totalWeight = axes.reduce((sum, a) => sum + a.weight, 0);
  const overall = totalWeight > 0 ? axes.reduce((sum, a) => sum + a.weighted, 0) / totalWeight : 0;
  const rag = overall >= 3.5 ? 'green' : overall >= 2.5 ? 'amber' : 'red';

  return { axes, overall, rag, blocked: false, blockedBy: [], caveats, max_bid_pence: maxBid };
}
