import type { CalculatorInputs, ProposedUnit, UnitType } from './conversion-types';
import type { EligibilityAssessment } from '../types';
import { calculateAppraisal, calculateRlv } from './conversion-calc-engine';
import { calculateCommercialSdlt } from './commercial-sdlt';
import { calculateResidentialSdlt } from './residential-sdlt';
import { applyScenario } from './apply-scenario';

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

export type SpiderAxisId =
  | 'margin_resilience'
  | 'prior_approval'
  | 'deliverability'
  | 'building_safety'
  | 'tax_advantage'
  | 'programme'
  | 'sales_velocity'
  | 'exit_optionality'
  | 'acquisition_headroom';

export interface SpiderAxisDef {
  id: SpiderAxisId;
  label: string; // radar label, may contain \n
  short: string;
  min: number;
  max: number;
  direction: 'higher' | 'lower';
  unit: string;
  help: string;
}

export const CLASS_MA_AXES: SpiderAxisDef[] = [
  {
    id: 'margin_resilience',
    label: 'Margin\nResilience',
    short: 'Resilience',
    min: -5,
    max: 15,
    direction: 'higher',
    unit: '%',
    help: 'Profit on cost (%) recomputed under the saved Downside scenario, not the base case. Normalised linearly from -5% (score 0) to +15% (score 5).',
  },
  {
    id: 'prior_approval',
    label: 'Prior Approval\nRisk',
    short: 'Approval',
    min: 0,
    max: 5,
    direction: 'higher',
    unit: '/5',
    help: 'Derived from the Eligibility gate: 5 × (passed checks ÷ applicable checks). Any hard-gate fail forces 0 and blocks the overall score. An unverified Article 4 or vacancy-period check caps the axis at 2 and marks it provisional.',
  },
  {
    id: 'deliverability',
    label: 'Daylight &\nLayout',
    short: 'Layout',
    min: 0,
    max: 100,
    direction: 'higher',
    unit: '%',
    help: 'The lower of (a) % of proposed units meeting NDSS minimum floor areas (studio 37m², 1-bed 50m², 2-bed 61m², 3-bed 74m²) and (b) the manual daylight pass % entered on this page. Normalised 0–100% to 0–5.',
  },
  {
    id: 'building_safety',
    label: 'Building\nSafety',
    short: 'Safety',
    min: 0,
    max: 5,
    direction: 'higher',
    unit: '/5',
    help: 'Banded from height/storeys: higher-risk building (≥18m, ≥7 storeys, or flagged HRB) scores 0; 11–18m or 5–6 storeys scores 3 (EWS1 / remediation exposure); below that scores 5.',
  },
  {
    id: 'tax_advantage',
    label: 'Tax\nAdvantage',
    short: 'Tax',
    min: 0,
    max: 6,
    direction: 'higher',
    unit: '% GDV',
    help: 'Tax captured by the commercial-to-resi route as % of GDV: (residential SDLT incl. 5% surcharge − non-residential SDLT actually paid) + 15% VAT saving on construction (5% conversion rate vs 20%) + CIL existing-floorspace offset. Normalised 0–6% of GDV to 0–5.',
  },
  {
    id: 'programme',
    label: 'Programme\nRisk',
    short: 'Programme',
    min: 8,
    max: 30,
    direction: 'lower',
    unit: 'mo',
    help: 'Total months from exchange to practical completion: 56-day prior approval window (as months) + loan term + programme contingency. Normalised 8 months (score 5) to 30 months (score 0).',
  },
  {
    id: 'sales_velocity',
    label: 'Sales\nVelocity',
    short: 'Sales',
    min: 3,
    max: 18,
    direction: 'lower',
    unit: 'mo',
    help: 'Absorption months to dispose of the full unit count, entered manually on this page. Normalised 3 months (score 5) to 18 months (score 0).',
  },
  {
    id: 'exit_optionality',
    label: 'Exit\nOptionality',
    short: 'Exit',
    min: 0,
    max: 4,
    direction: 'higher',
    unit: 'routes',
    help: 'Count of viable exits ticked on this page: sell / refinance / hold / part-sale-part-hold. Normalised 0 routes (score 0) to 4 routes (score 5).',
  },
  {
    id: 'acquisition_headroom',
    label: 'Acquisition\nHeadroom',
    short: 'Headroom',
    min: 0,
    max: 30,
    direction: 'higher',
    unit: '%',
    help: '(Max bid − purchase price) ÷ max bid, where max bid is the residual land value at the target profit on cost set on this page. Normalised 0% (score 0) to 30% (score 5). Negative headroom scores 0.',
  },
];

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

function buildingSafetyBand(spider: CalculatorInputs['deal_spider']): number {
  const higherRisk =
    spider.bsa_higher_risk || spider.building_height_m >= 18 || spider.storeys >= 7;
  if (higherRisk) return 0;
  if (spider.building_height_m >= 11 || spider.storeys >= 5) return 3;
  return 5;
}

export function computeSpider(
  inputs: CalculatorInputs,
  eligibility: EligibilityAssessment | null,
): SpiderResult {
  const spider = inputs.deal_spider;
  const metrics = calculateAppraisal(inputs);
  const downsideMetrics = calculateAppraisal(applyScenario(inputs, inputs.scenarios.downside));
  const priorApproval = scorePriorApproval(eligibility);

  // Tax advantage
  const price = inputs.acquisition.purchase_price_pence;
  const residentialSdlt = calculateResidentialSdlt(price).total_pence;
  const commercialSdlt = calculateCommercialSdlt(price).total_pence;
  const vatSaving = Math.round(metrics.total_construction_cost_pence * 0.15);
  const taxAdvantagePct =
    metrics.total_gdv_pence > 0
      ? ((residentialSdlt - commercialSdlt + vatSaving + spider.cil_offset_pence) /
          metrics.total_gdv_pence) *
        100
      : 0;

  // Acquisition headroom against max bid (RLV at the configured target return)
  const totalCostExLand = metrics.total_cost_pence - price - metrics.sdlt_pence;
  const maxBid = calculateRlv(totalCostExLand, metrics.total_gdv_pence, spider.target_profit_on_cost_pct);
  const headroomPct = maxBid > 0 ? ((maxBid - price) / maxBid) * 100 : -100;

  const exitCount = [spider.exit_sell, spider.exit_refinance, spider.exit_hold, spider.exit_part_sale].filter(
    Boolean,
  ).length;

  const programmeMonths =
    spider.prior_approval_window_months + inputs.finance.loan_term_months + spider.programme_contingency_months;

  const deliverabilityPct = Math.min(ndssPassPct(inputs.unit_mix.units), spider.daylight_pass_pct);

  const raws: Record<SpiderAxisId, number> = {
    margin_resilience: downsideMetrics.profit_on_cost_pct,
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
    const provisional = def.id === 'prior_approval' ? priorApproval.provisional : false;
    const note = def.id === 'prior_approval' ? priorApproval.note : null;
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
