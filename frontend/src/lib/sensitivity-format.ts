import type { FlagCode } from './model';
import type { SensitivityLever } from './model/sensitivity';

/**
 * Presentation for the spec §12 sensitivity suite, shared by the investment
 * memo and the calculator's Sensitivity page.
 *
 * Deliberately outside `lib/model/`: that directory mirrors the Python engine
 * file-for-file (governance §1) and none of this has — or should have — a
 * Python counterpart. Same reasoning as `safe-run.ts`.
 */

/** Full lever names, for the tornado and the page's lever pickers. */
export const LEVER_LABEL: Record<SensitivityLever, string> = {
  gdv: 'GDV',
  construction_cost: 'Construction cost',
  timeline: 'Timeline',
  interest_rate: 'Interest rate',
};

/**
 * Abbreviated lever names for matrix axis captions. These reproduce the
 * captions the investment memo has printed since before R4 ("GDV -15%",
 * "Cost +0%") — changing `construction_cost` here changes printed memo output
 * and will fail the §10 regression pin.
 */
export const LEVER_SHORT: Record<SensitivityLever, string> = {
  gdv: 'GDV',
  construction_cost: 'Cost',
  timeline: 'Timeline',
  interest_rate: 'Rate',
};

/**
 * A tornado bar is unsound when it is the `timeline` lever and either endpoint
 * would drive `finance.term_months` below one month. Spec §12.6 constrains
 * timeline steps to whole months but says nothing about the term those months
 * leave behind, and the engine does not reject an empty one — it silently
 * clamps to a one-month term and returns a plausible-looking result (pinned as
 * current behaviour in safe-sensitivity.test.ts). Several distinct steps clamp
 * to the identical one-month answer, so a bar with a clamping endpoint is not
 * really reporting "-3 months" (or whatever the endpoint claims) — it is
 * reporting the clamp floor. Neither the memo nor the calculator page may
 * print or render that figure unflagged; both drop the bar instead. Shared
 * here so the two surfaces agree on what "unsound" means.
 */
export function isUnsoundTornadoBar(
  termMonths: number,
  bar: { lever: SensitivityLever; low_step: number; high_step: number },
): boolean {
  return bar.lever === 'timeline' && (termMonths + bar.low_step < 1 || termMonths + bar.high_step < 1);
}

/** Decimal places each lever's unit is quoted to. Rates are quoted to 0.1pp. */
function decimalsFor(lever: SensitivityLever): number {
  return lever === 'interest_rate' ? 1 : 0;
}

function signed(value: number, decimals: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

/** One lever position in its own unit (spec §12.1): "+5%", "-3 months", "+1.0 pp". */
export function formatStepLabel(lever: SensitivityLever, step: number): string {
  const text = signed(step, decimalsFor(lever));
  if (lever === 'gdv' || lever === 'construction_cost') return `${text}%`;
  if (lever === 'timeline') return `${text} months`;
  return `${text} pp`;
}

/** A tornado range with the unit stated once: "-10% to +10%", "-3 to +3 months". */
export function formatRangeLabel(lever: SensitivityLever, low: number, high: number): string {
  const d = decimalsFor(lever);
  if (lever === 'gdv' || lever === 'construction_cost') {
    return `${signed(low, d)}% to ${signed(high, d)}%`;
  }
  const unit = lever === 'timeline' ? 'months' : 'pp';
  return `${signed(low, d)} to ${signed(high, d)} ${unit}`;
}

/**
 * The memo's FE/FG/NR shorthand for the three covenant flags a fixed-facility
 * cell can raise (spec §12.2). The order is fixed rather than following the
 * engine's flag order, because the memo has always printed it this way.
 *
 * This is presentation, not model: `SensitivityMetrics.flags` carries raw
 * codes, and codes with no short form (e.g. `requires_confirmation`) are simply
 * not part of this grid's vocabulary.
 */
export function flagShortCodes(codes: readonly FlagCode[]): string {
  const shorthand: Array<[FlagCode, string]> = [
    ['facility_exceeded', 'FE'],
    ['funding_gap', 'FG'],
    ['senior_outstanding_at_maturity', 'NR'],
  ];
  return shorthand.filter(([code]) => codes.includes(code)).map(([, short]) => short).join(',');
}

/** The six fields of the §12 compact record, in the order the page offers them. */
export type SensitivityMetricKey =
  | 'profit_pence'
  | 'profit_on_cost_pct'
  | 'profit_on_gdv_pct'
  | 'irr_annual_pct'
  | 'ltgdv_developer_pct'
  | 'peak_debt_pence';

export const SENSITIVITY_METRICS: readonly {
  key: SensitivityMetricKey;
  label: string;
  kind: 'money' | 'pct';
}[] = [
  { key: 'profit_on_cost_pct', label: 'Profit on Cost', kind: 'pct' },
  { key: 'profit_pence', label: 'Profit', kind: 'money' },
  { key: 'profit_on_gdv_pct', label: 'Profit on GDV', kind: 'pct' },
  { key: 'irr_annual_pct', label: 'IRR (Annual)', kind: 'pct' },
  { key: 'ltgdv_developer_pct', label: 'LTGDV (developer basis)', kind: 'pct' },
  { key: 'peak_debt_pence', label: 'Peak Debt', kind: 'money' },
];
