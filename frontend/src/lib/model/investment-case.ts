/** R13 spec §19. The investment case: the retained portion's income, its value
 *  and the take-out that income supports.
 *
 *  This module runs STRICTLY BEFORE the ledger and reads nothing from it
 *  (§17.5's one-direction rule, applied to the second engine that could have
 *  been made cyclic). It must never import `monthly-engine`, `metrics` or
 *  `schedule` — a debt figure entering an NOI base is the one thing that would
 *  make this cyclic, exactly as a VAT figure entering a cost base would. */
import type { AnyCalculatorInputs, PhaseAnchor } from './finance-types';
import { isProgrammeNetwork, derivePhases } from './programme';

export type OpexCode =
  | 'management' | 'letting_and_re_letting' | 'insurance'
  | 'repairs_and_maintenance' | 'service_charge_shortfall' | 'ground_rent'
  | 'utilities_on_voids' | 'compliance_and_safety' | 'bad_debt' | 'other';

/** Fixed order, as `VAT_CHARGE_CATEGORIES` and `PHASE_CODES` are. Unlike those,
 *  `operating_lines` is a USER-MANAGED list — this array is the enum's domain
 *  for validation and the editor's dropdown, not a required shape. */
export const OPEX_CODES: readonly OpexCode[] = [
  'management', 'letting_and_re_letting', 'insurance',
  'repairs_and_maintenance', 'service_charge_shortfall', 'ground_rent',
  'utilities_on_voids', 'compliance_and_safety', 'bad_debt', 'other',
];

export type OperatingLineBasis = 'fixed_pence_per_month' | 'pct_of_gross_rent';

export interface OperatingLine {
  id: string;
  code: OpexCode;
  label: string;
  basis: OperatingLineBasis;
  /** Pence per month on the fixed basis; a percentage on the other. */
  value: number;
}

export interface StabilisationInputs {
  /** §18.6 resolution, reused verbatim. null = use `month_offset`. */
  anchor: PhaseAnchor | null;
  month_offset: number;
  ramp_months: number;
  stabilised_occupancy_pct: number;
}

export interface TakeoutInputs {
  ltv_cap_pct: number;
  dscr_floor: number;
  icr_floor: number;
  annual_rate_pct: number;
  /** null = interest-only, which makes the DSCR and ICR caps equal at equal
   *  floors (§19.4). That equality is a feature and is asserted, not worked
   *  around. */
  amortisation_years: number | null;
  term_years: number;
}

export interface InvestmentCaseInputs {
  stabilisation: StabilisationInputs;
  operating_lines: OperatingLine[];
  valuation: { cap_yield_pct: number; purchasers_costs_pct: number };
  takeout: TakeoutInputs;
}

export interface InvestmentCaseMonth {
  month: number;
  occupancy_pct: number;
  gross_potential_rent_pence: number;
  effective_gross_rent_pence: number;
  operating_cost_pence: number;
  noi_pence: number;
}

/**
 * §19.2. Zero before `s`; a linear ramp reaching `stabilisedPct` in the FINAL
 * ramp month `s + R - 1`; `stabilisedPct` thereafter. `R = 0` collapses the
 * middle arm, so occupancy is stabilised from `s` itself.
 */
export function occupancyPctAt(
  month: number, stabilisationMonth: number, rampMonths: number, stabilisedPct: number,
): number {
  if (month < stabilisationMonth) return 0;
  if (rampMonths > 0 && month < stabilisationMonth + rampMonths) {
    return (stabilisedPct * (month - stabilisationMonth + 1)) / rampMonths;
  }
  return stabilisedPct;
}

/**
 * §19.2. The sum is over `exit_strategy.retained_units[]`, NOT over
 * `unit_mix.units`. For `blended` that list *is* the retained set; for
 * `retain_all` §19.7 rule 2 makes it complete. Those two facts together are the
 * only reason one expression serves both routes — summing `unit_mix` instead
 * would double-count nothing but would silently read zero rent for every unit
 * the user has not priced.
 */
export function grossPotentialMonthlyPence(
  retainedUnits: readonly { monthly_rent_pence: number }[],
): number {
  return retainedUnits.reduce((sum, r) => sum + r.monthly_rent_pence, 0);
}

/** §19.2. A percentage line is a percent of the month's EFFECTIVE gross rent —
 *  a management fee is charged on rent collected, not on rent hoped for.
 *
 *  R13 fix-wave Minor 7. `value` carries no integer constraint (§19.1) and
 *  validation permits a non-integer fixed-pence line, so the fixed basis is
 *  `Math.round`'d here exactly like the percentage basis — not passed
 *  through raw. A raw pass-through let a fractional pence value leak into a
 *  nominally-integer-pence total; Python's `operating_cost_at` is fixed to
 *  match (money_round, not int()-truncation) for the same reason. */
export function operatingCostAt(lines: readonly OperatingLine[], egrPence: number): number {
  return lines.reduce((sum, l) => sum + (
    l.basis === 'fixed_pence_per_month' ? Math.round(l.value) : Math.round((egrPence * l.value) / 100)
  ), 0);
}

/** §19.7/§19.6. The stabilisation month under §18.6's resolution rule. Lives
 *  here, not in validation.ts and not inlined in computeInvestmentCase, because
 *  a rule written twice is a rule that drifts. */
export function resolveStabilisationMonth(
  inputs: AnyCalculatorInputs, stabilisation: StabilisationInputs,
): number {
  if (stabilisation.anchor == null) return stabilisation.month_offset;
  const prog = 'programme' in inputs ? inputs.programme : null;
  if (prog == null || !isProgrammeNetwork(prog)) return stabilisation.month_offset;
  const d = derivePhases(prog);
  if ('cycle' in d) return stabilisation.month_offset;
  const ph = d.byId[stabilisation.anchor.phase_id];
  return ph ? ph.start_month + stabilisation.anchor.offset_months : stabilisation.month_offset;
}

export interface NoiSeriesArgs {
  termMonths: number;
  stabilisationMonth: number;
  rampMonths: number;
  stabilisedOccupancyPct: number;
  grossPotentialMonthlyPence: number;
  lines: readonly OperatingLine[];
}

export function noiSeries(args: NoiSeriesArgs): InvestmentCaseMonth[] {
  const out: InvestmentCaseMonth[] = [];
  for (let m = 0; m < args.termMonths; m += 1) {
    const occ = occupancyPctAt(
      m, args.stabilisationMonth, args.rampMonths, args.stabilisedOccupancyPct,
    );
    const egr = Math.round((args.grossPotentialMonthlyPence * occ) / 100);
    // Operating costs start with the income, not with the term: a scheme incurs
    // management and letting cost against a let asset, and charging them from
    // month 0 would book an operating loss through the whole build.
    const opex = m < args.stabilisationMonth ? 0 : operatingCostAt(args.lines, egr);
    out.push({
      month: m,
      occupancy_pct: occ,
      gross_potential_rent_pence: args.grossPotentialMonthlyPence,
      effective_gross_rent_pence: egr,
      operating_cost_pence: opex,
      noi_pence: egr - opex,
    });
  }
  return out;
}

/**
 * §19.2. TWELVE TIMES THE STABILISED MONTH. Never the sum of the first twelve
 * actual months, never an average over the term. Valuation (§19.3) and both
 * coverage caps (§19.4) read this figure and only this figure — capitalising
 * ramp-period NOI is the classic error in this calculation.
 */
export function stabilisedAnnualNoiPence(args: NoiSeriesArgs): number {
  const egr = Math.round(
    (args.grossPotentialMonthlyPence * args.stabilisedOccupancyPct) / 100,
  );
  return 12 * (egr - operatingCostAt(args.lines, egr));
}

/**
 * §19.4. Annual debt service per £1 of debt — the constant that makes the DSCR
 * cap solve in closed form and lets this whole module stay one-directional.
 *
 * Interest-only: the bare rate. Amortising: twelve times the standard monthly
 * annuity constant, with a zero-rate arm because the annuity formula divides by
 * zero there (a 0% loan simply repays 1/N of principal a month).
 */
export function annualDebtServiceFactor(takeout: TakeoutInputs): number {
  const r = takeout.annual_rate_pct / 100;
  if (takeout.amortisation_years == null) return r;
  const i = r / 12;
  const n = takeout.amortisation_years * 12;
  if (n <= 0) return r;
  return 12 * (i === 0 ? 1 / n : i / (1 - (1 + i) ** -n));
}

/**
 * §19.3. The net-initial-yield convention: capitalise at the yield, then deduct
 * purchaser's costs. ONE expression and ONE rounding — a two-step derivation
 * would let a report's own arithmetic drift a penny from the published figure.
 */
export function investmentValuePence(
  annualNoiPence: number, capYieldPct: number, purchasersCostsPct: number,
): number {
  if (annualNoiPence <= 0 || capYieldPct <= 0) return 0;
  return Math.round(
    (annualNoiPence * 100) / capYieldPct / (1 + purchasersCostsPct / 100),
  );
}

export type BindingConstraint = 'ltv' | 'dscr' | 'icr' | null;

export interface TakeoutSizing {
  ltv_cap_pence: number;
  /** null when the cap cannot bind: `a === 0` for DSCR, `r === 0` for ICR. */
  dscr_cap_pence: number | null;
  icr_cap_pence: number | null;
  quantum_pence: number;
  binding_constraint: BindingConstraint;
  annual_debt_service_factor: number;
  achieved_ltv_pct: number | null;
  achieved_dscr: number | null;
  achieved_icr: number | null;
}

/**
 * §19.4. `quantum = min(applicable caps)`; the binding constraint is the argmin
 * with a stated precedence — LTV, then DSCR, then ICR — so an exact tie
 * resolves the same way every run (§1.4 determinism).
 *
 * ALL THREE caps are published, not only the binding one. A reader who sees
 * "LTV 4,200,000 / DSCR 3,610,000 / ICR 4,050,000 — DSCR binds" learns the shape
 * of the constraint; a reader given only 3,610,000 learns a number.
 *
 * Every cap FLOORS (§19.4), a deliberate departure from §1.1's half-up default.
 */
export interface InvestmentCaseResult {
  stabilisation_month: number;
  months: InvestmentCaseMonth[];
  stabilised: {
    effective_gross_rent_pence: number; operating_cost_pence: number;
    monthly_noi_pence: number; annual_noi_pence: number;
  };
  operating_lines: (OperatingLine & { stabilised_monthly_pence: number })[];
  valuation: {
    cap_yield_pct: number; purchasers_costs_pct: number;
    gross_value_pence: number; investment_value_pence: number;
  };
  takeout: TakeoutSizing & { is_booked: boolean };
  totals: {
    effective_gross_rent_pence: number; operating_cost_pence: number; noi_pence: number;
  };
}

/**
 * §19.6. Runs strictly before the ledger. `_resolveAnchorMonth` is accepted
 * (not recomputed here) to keep this function's public signature the one
 * `schedule.ts` calls with its own `resolveAnchorMonth` closure — but the
 * body below never calls it: stabilisation resolves through
 * `resolveStabilisationMonth`, which derives its own phase network from
 * `inputs` rather than sharing schedule.ts's derivation. Underscore-prefixed
 * because it is genuinely unused by this function today (verified — do not
 * remove the parameter to "fix" the lint warning without re-checking
 * whether a later task starts reading it); tranches and refinance still go
 * through the real `resolveAnchorMonth` in `schedule.ts` itself, never here.
 */
export function computeInvestmentCase(
  inputs: AnyCalculatorInputs,
  termMonths: number,
  _resolveAnchorMonth: (anchor: PhaseAnchor | null, monthOffset: number) => number,
): InvestmentCaseResult | null {
  const ic = 'investment_case' in inputs ? inputs.investment_case : null;
  if (ic == null) return null;

  // Task 6's exported helper, NOT a second inline resolution. Stabilisation
  // goes through the same §18.6 rule via this shared helper — it derives its
  // own phase network from `inputs`, independently of schedule.ts's
  // `resolveAnchorMonth` closure.
  const s = Math.min(Math.max(0, Math.floor(
    resolveStabilisationMonth(inputs, ic.stabilisation),
  )), termMonths - 1);
  const gross = grossPotentialMonthlyPence(inputs.exit_strategy.retained_units);
  const args: NoiSeriesArgs = {
    termMonths, stabilisationMonth: s, rampMonths: ic.stabilisation.ramp_months,
    stabilisedOccupancyPct: ic.stabilisation.stabilised_occupancy_pct,
    grossPotentialMonthlyPence: gross, lines: ic.operating_lines,
  };
  const months = noiSeries(args);
  const annualNoi = stabilisedAnnualNoiPence(args);
  const stabEgr = Math.round((gross * ic.stabilisation.stabilised_occupancy_pct) / 100);
  const stabOpex = operatingCostAt(ic.operating_lines, stabEgr);
  const value = investmentValuePence(
    annualNoi, ic.valuation.cap_yield_pct, ic.valuation.purchasers_costs_pct,
  );
  const sizing = sizeTakeout(annualNoi, value, ic.takeout);
  const refi = 'refinance' in inputs ? inputs.refinance : null;

  return {
    stabilisation_month: s,
    months,
    stabilised: {
      effective_gross_rent_pence: stabEgr,
      operating_cost_pence: stabOpex,
      monthly_noi_pence: stabEgr - stabOpex,
      annual_noi_pence: annualNoi,
    },
    // R13 fix-wave Minor 7 -- see operatingCostAt's comment above.
    operating_lines: ic.operating_lines.map((l) => ({
      ...l,
      stabilised_monthly_pence: l.basis === 'fixed_pence_per_month'
        ? Math.round(l.value) : Math.round((stabEgr * l.value) / 100),
    })),
    valuation: {
      cap_yield_pct: ic.valuation.cap_yield_pct,
      purchasers_costs_pct: ic.valuation.purchasers_costs_pct,
      // Published for the report's bridge, NOT an intermediate the value is
      // computed from — §19.3 keeps the value a single expression with a single
      // rounding so a two-step derivation cannot drift a penny from it.
      gross_value_pence: annualNoi > 0 && ic.valuation.cap_yield_pct > 0
        ? Math.round((annualNoi * 100) / ic.valuation.cap_yield_pct) : 0,
      investment_value_pence: value,
    },
    takeout: { ...sizing, is_booked: refi != null },
    totals: {
      effective_gross_rent_pence: months.reduce((t, m) => t + m.effective_gross_rent_pence, 0),
      operating_cost_pence: months.reduce((t, m) => t + m.operating_cost_pence, 0),
      noi_pence: months.reduce((t, m) => t + m.noi_pence, 0),
    },
  };
}

export function sizeTakeout(
  annualNoiPence: number, valuePence: number, takeout: TakeoutInputs,
): TakeoutSizing {
  const r = takeout.annual_rate_pct / 100;
  const a = annualDebtServiceFactor(takeout);
  const noi = Math.max(0, annualNoiPence);

  const ltvCap = Math.floor((valuePence * takeout.ltv_cap_pct) / 100);
  const dscrCap = a > 0 ? Math.floor(noi / (takeout.dscr_floor * a)) : null;
  const icrCap = r > 0 ? Math.floor(noi / (takeout.icr_floor * r)) : null;

  // Precedence order IS the tie-break: `<` (not `<=`) keeps the earlier entry.
  const candidates: { key: Exclude<BindingConstraint, null>; cap: number }[] = [
    { key: 'ltv', cap: ltvCap },
    ...(dscrCap == null ? [] : [{ key: 'dscr' as const, cap: dscrCap }]),
    ...(icrCap == null ? [] : [{ key: 'icr' as const, cap: icrCap }]),
  ];
  let binding = candidates[0];
  for (const c of candidates) if (c.cap < binding.cap) binding = c;

  const quantum = Math.max(0, binding.cap);
  const sized = quantum > 0;
  return {
    ltv_cap_pence: ltvCap,
    dscr_cap_pence: dscrCap,
    icr_cap_pence: icrCap,
    quantum_pence: quantum,
    binding_constraint: sized ? binding.key : null,
    annual_debt_service_factor: a,
    achieved_ltv_pct: sized && valuePence > 0 ? (quantum / valuePence) * 100 : null,
    achieved_dscr: sized && a > 0 ? noi / (quantum * a) : null,
    achieved_icr: sized && r > 0 ? noi / (quantum * r) : null,
  };
}
