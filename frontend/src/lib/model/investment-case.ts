/** R13 spec §19. The investment case: the retained portion's income, its value
 *  and the take-out that income supports.
 *
 *  This module runs STRICTLY BEFORE the ledger and reads nothing from it
 *  (§17.5's one-direction rule, applied to the second engine that could have
 *  been made cyclic). It must never import `monthly-engine`, `metrics` or
 *  `schedule` — a debt figure entering an NOI base is the one thing that would
 *  make this cyclic, exactly as a VAT figure entering a cost base would. */
import type { PhaseAnchor } from './finance-types';

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
 *  a management fee is charged on rent collected, not on rent hoped for. */
export function operatingCostAt(lines: readonly OperatingLine[], egrPence: number): number {
  return lines.reduce((sum, l) => sum + (
    l.basis === 'fixed_pence_per_month' ? l.value : Math.round((egrPence * l.value) / 100)
  ), 0);
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
