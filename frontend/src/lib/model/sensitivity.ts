import type { FlagCode } from './finance-types';
import type { ValidationIssue } from './validation';

/**
 * The fixed-facility sensitivity suite of spec §12. Every cell and every tornado
 * endpoint is one ordinary appraisal of the base document with levers applied per
 * §12.1; the committed facility and equity sources are never adjusted (§12.2), so a
 * cell that would need more debt raises `facility_exceeded`/`funding_gap` rather than
 * receiving it.
 *
 * This module imports `runAppraisal` from `./index`. `index.ts` must therefore never
 * import or re-export this module — consumers import `./model/sensitivity` directly.
 */

export type SensitivityLever = 'gdv' | 'construction_cost' | 'timeline' | 'interest_rate';

/** Spec §12.4 tie-break order, making the tornado sort total and so deterministic (§1.4). */
export const LEVER_ORDER: readonly SensitivityLever[] = [
  'gdv', 'construction_cost', 'timeline', 'interest_rate',
];

/** Spec §12.6: an axis is capped at nine steps, bounding the suite at 81 cells. */
export const MAX_AXIS_STEPS = 9;

export interface SensitivityAxis {
  lever: SensitivityLever;
  /** In the lever's own unit: percent for gdv/construction_cost, months for timeline,
   *  percentage points for interest_rate. */
  steps: number[];
}

export interface TornadoRange {
  lever: SensitivityLever;
  low: number;
  high: number;
}

export interface SensitivityConfig {
  rows: SensitivityAxis;
  cols: SensitivityAxis;
  tornado: TornadoRange[];
}

/** Spec §12.3 and §12.4. These are the steps the investment memo has always used;
 *  R4 promoted them from a constant inside the exporter to a specified default. */
export const DEFAULT_SENSITIVITY_CONFIG: SensitivityConfig = {
  rows: { lever: 'construction_cost', steps: [-5, 0, 5, 10, 15] },
  cols: { lever: 'gdv', steps: [-15, -10, -5, 0, 5] },
  tornado: [
    { lever: 'gdv', low: -10, high: 10 },
    { lever: 'construction_cost', low: -10, high: 10 },
    { lever: 'timeline', low: -3, high: 3 },
    { lever: 'interest_rate', low: -1, high: 1 },
  ],
};

/**
 * The metric reduction of one appraisal. Percentage fields stay nullable to match
 * `AppraisalResultV2` — a zero-cost or unrealised-profit run already yields null
 * there, and the suite must not invent a number the engine declined to produce.
 * `flags` carries raw codes; the memo's FE/FG/NR shorthand is presentation, not model.
 */
export interface SensitivityMetrics {
  profit_pence: number;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  irr_annual_pct: number | null;
  ltgdv_developer_pct: number | null;
  peak_debt_pence: number;
  flags: FlagCode[];
}

/** A measurement at a grid position. Tornado endpoints are single-lever measurements
 *  with no grid position, so they carry `SensitivityMetrics` instead. */
export interface SensitivityCell extends SensitivityMetrics {
  row_step: number;
  col_step: number;
}

export interface TornadoBar {
  lever: SensitivityLever;
  low_step: number;
  high_step: number;
  low: SensitivityMetrics;
  high: SensitivityMetrics;
  /** |profit(high) − profit(low)|, spec §12.4. */
  span_pence: number;
}

export interface SensitivityResult {
  base: SensitivityMetrics;
  /** matrix[rowIndex][colIndex], indexed by `config.rows.steps` / `config.cols.steps`. */
  matrix: SensitivityCell[][];
  tornado: TornadoBar[];
  /** The resolved config, echoed back so a report prints the ranges actually used
   *  rather than assuming the defaults. */
  config: SensitivityConfig;
}

/** Spec §12.6. Returns error-severity issues; an empty array means the config is usable. */
export function validateSensitivityConfig(config: SensitivityConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const axes: Array<['rows' | 'cols', SensitivityAxis]> = [['rows', config.rows], ['cols', config.cols]];

  for (const [name, axis] of axes) {
    const field = `sensitivity.${name}.steps`;
    if (axis.steps.length === 0) {
      issues.push({ severity: 'error', field, message: 'An axis needs at least one step.' });
    }
    if (axis.steps.length > MAX_AXIS_STEPS) {
      issues.push({ severity: 'error', field, message: `An axis takes at most ${MAX_AXIS_STEPS} steps.` });
    }
    if (axis.steps.some((s) => !Number.isFinite(s))) {
      issues.push({ severity: 'error', field, message: 'Every step must be a finite number.' });
    }
    // Spec §12.6: the engine is month-indexed (§1.3), so a fractional term has no
    // meaning in the ledger. Constraining the timeline lever here is also what makes
    // the Python mirror's int() narrowing of `timeline_adjustment_months` safe — see
    // app/financial_model/apply_scenario.py.
    if (axis.lever === 'timeline' && axis.steps.some((s) => !Number.isInteger(s))) {
      issues.push({ severity: 'error', field, message: 'Timeline steps must be whole months.' });
    }
  }

  if (config.rows.lever === config.cols.lever) {
    issues.push({
      severity: 'error', field: 'sensitivity.cols.lever',
      message: 'The row and column axes must use different levers.',
    });
  }

  const seen = new Set<SensitivityLever>();
  for (const range of config.tornado) {
    if (seen.has(range.lever)) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Lever ${range.lever} appears more than once in the tornado.`,
      });
    }
    seen.add(range.lever);
    if (!Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low >= range.high) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Tornado range for ${range.lever} needs finite low < high.`,
      });
    }
    // Spec §12.6, same whole-month rule as the axes above.
    if (range.lever === 'timeline' && (!Number.isInteger(range.low) || !Number.isInteger(range.high))) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: 'Timeline bounds must be whole months.',
      });
    }
  }

  return issues;
}
