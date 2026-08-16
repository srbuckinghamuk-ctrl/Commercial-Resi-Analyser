import type { AnyCalculatorInputs, FlagCode } from './finance-types';
import type { ScenarioOverrides } from '../conversion-types';
import type { ValidationIssue } from './validation';
import { validateInputs } from './validation';
import { applyScenario } from './apply-scenario';
import { runAppraisal } from './index';

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

/** Spec §12.3 and §12.4, built by a factory rather than held as a module-level mutable
 *  so a caller cannot adjust the defaults for the whole process — mirrors Python's
 *  `_default_config()` (app/financial_model/sensitivity.py). Every call returns a fresh
 *  structure with no shared references, so mutating one caller's result can never leak
 *  into another's. */
export function defaultSensitivityConfig(): SensitivityConfig {
  return {
    rows: { lever: 'construction_cost', steps: [-5, 0, 5, 10, 15] },
    cols: { lever: 'gdv', steps: [-15, -10, -5, 0, 5] },
    tornado: [
      { lever: 'gdv', low: -10, high: 10 },
      { lever: 'construction_cost', low: -10, high: 10 },
      { lever: 'timeline', low: -3, high: 3 },
      { lever: 'interest_rate', low: -1, high: 1 },
    ],
  };
}

/** Spec §12.3 and §12.4. These are the steps the investment memo has always used;
 *  R4 promoted them from a constant inside the exporter to a specified default. Kept
 *  for callers that want to compare against the normative shape (tests, the exporter);
 *  `runSensitivity` never hands this object out by identity — see `defaultSensitivityConfig`. */
export const DEFAULT_SENSITIVITY_CONFIG: SensitivityConfig = defaultSensitivityConfig();

/**
 * The metric reduction of one appraisal (§12.3), or the record of why no appraisal was
 * run (§12.7). `validation_errors` is empty exactly when the position was measured; it
 * carries error-severity issues only, so a measured document that merely raises warnings
 * still reports an empty array.
 *
 * Every metric field is nullable. The four percentages already were — a zero-cost or
 * unrealised-profit run yields null there — and R5 widened the two money fields so that
 * an unmeasured position cannot present a number at all. That widening is the point: a
 * consumer reading `profit_pence` must handle the null, which is what stops a clamped or
 * absent figure being printed as though it were a measurement.
 */
export interface SensitivityMetrics {
  profit_pence: number | null;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  irr_annual_pct: number | null;
  ltgdv_developer_pct: number | null;
  peak_debt_pence: number | null;
  flags: FlagCode[];
  validation_errors: ValidationIssue[];
}

/**
 * The base case is always measured: `runSensitivity` throws when the base document fails
 * validation (§12.7), so `result.base` needs no null check at its use sites. Cells and
 * tornado endpoints carry the wider `SensitivityMetrics`.
 */
export type MeasuredMetrics = Omit<SensitivityMetrics, 'profit_pence' | 'peak_debt_pence'> & {
  profit_pence: number;
  peak_debt_pence: number;
};

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
  /** |profit(high) − profit(low)| (§12.4), or null when either endpoint is unmeasured. */
  span_pence: number | null;
}

export interface SensitivityResult {
  base: MeasuredMetrics;
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
    const field = `sensitivity.${name}.lever`;
    // Spec §12.6: an axis lever must be one of the four §12.1 levers. `LEVER_ORDER`
    // is the closed set — this is what stops a bad-cased or misspelled lever from
    // silently producing a matrix in which that axis does nothing, or (in the Python
    // mirror) crashing inside LEVER_ORDER.index() further down the pipeline.
    if (!LEVER_ORDER.includes(axis.lever)) {
      issues.push({ severity: 'error', field, message: `Unknown lever "${axis.lever}".` });
    }
  }

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
    // Spec §12.6, same closed-set rule as the axes above.
    if (!LEVER_ORDER.includes(range.lever)) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Unknown lever "${range.lever}".`,
      });
    }
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

/** Builds the `ScenarioOverrides` for a set of lever positions. Levers not named sit at
 *  zero, which §12.1 guarantees is a no-op because the four levers are disjoint. */
function overridesFor(levers: Partial<Record<SensitivityLever, number>>): ScenarioOverrides {
  return {
    label: '',
    gdv_adjustment_pct: levers.gdv ?? 0,
    construction_cost_adjustment_pct: levers.construction_cost ?? 0,
    timeline_adjustment_months: levers.timeline ?? 0,
    interest_rate_adjustment_pct: levers.interest_rate ?? 0,
  };
}

/** The record of a position that was not measured (§12.7). */
function unmeasured(errors: ValidationIssue[]): SensitivityMetrics {
  return {
    profit_pence: null,
    profit_on_cost_pct: null,
    profit_on_gdv_pct: null,
    irr_annual_pct: null,
    ltgdv_developer_pct: null,
    peak_debt_pence: null,
    flags: [],
    validation_errors: errors,
  };
}

/**
 * One position: the levered document is validated first (§12.7), and only a document that
 * passes is appraised. An unmeasured position never reaches the ledger, so the suite does
 * not depend on `buildSchedule`'s defensive term clamp holding.
 */
function measure(inputs: AnyCalculatorInputs, levers: Partial<Record<SensitivityLever, number>>): SensitivityMetrics {
  const levered = applyScenario(inputs, overridesFor(levers));
  const errors = validateInputs(levered).filter((i) => i.severity === 'error');
  if (errors.length > 0) return unmeasured(errors);

  const m = runAppraisal(levered).metrics;
  return {
    profit_pence: m.profit_pence,
    profit_on_cost_pct: m.profit_on_cost_pct,
    profit_on_gdv_pct: m.profit_on_gdv_pct,
    irr_annual_pct: m.irr_annual_pct,
    ltgdv_developer_pct: m.ltgdv_developer_pct,
    peak_debt_pence: m.peak_debt_pence,
    flags: m.flags.map((f) => f.code),
    validation_errors: [],
  };
}

/**
 * The fixed-facility sensitivity suite (spec §12). Runs `config.rows.steps.length ×
 * config.cols.steps.length` matrix appraisals, two per tornado range, and one base —
 * 34 with the default config, against the 28 the investment memo already ran before
 * R4, so this is not a new order of magnitude. Callers that re-render on every
 * keystroke should memoise on the inputs object.
 *
 * Throws on an invalid config (§12.6). It throws rather than returning issues because
 * a partially-valid grid is a misleading grid; callers wanting to *display* the reason
 * call `validateSensitivityConfig` first.
 */
export function runSensitivity(
  inputs: AnyCalculatorInputs,
  // A default parameter expression is re-evaluated on every call it fires for (unlike
  // Python, where a default is bound once at function definition) — so this already
  // hands each caller a fresh, unshared config, and `result.config` below echoes that
  // resolved value rather than the `DEFAULT_SENSITIVITY_CONFIG` singleton.
  config: SensitivityConfig = defaultSensitivityConfig(),
): SensitivityResult {
  const issues = validateSensitivityConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid sensitivity config: ${issues.map((i) => i.message).join(' ')}`);
  }

  const base = measure(inputs, {});
  // §12.5 makes the base case an identity with the unadjusted appraisal, so a suite over
  // an invalid base is meaningless in every position at once — this is an input error
  // (§12.6/§12.7), not twenty-five unmeasured cells.
  if (base.validation_errors.length > 0) {
    throw new Error(
      `Invalid base document: ${base.validation_errors.map((e) => e.message).join(' ')}`,
    );
  }

  const matrix: SensitivityCell[][] = config.rows.steps.map((rowStep) =>
    config.cols.steps.map((colStep) => ({
      row_step: rowStep,
      col_step: colStep,
      ...measure(inputs, { [config.rows.lever]: rowStep, [config.cols.lever]: colStep }),
    })),
  );

  const tornado: TornadoBar[] = config.tornado
    .map((range) => {
      const low = measure(inputs, { [range.lever]: range.low });
      const high = measure(inputs, { [range.lever]: range.high });
      return {
        lever: range.lever,
        low_step: range.low,
        high_step: range.high,
        low,
        high,
        // §12.7: an unmeasured endpoint leaves the bar with no span at all, rather than a
        // span computed against a number that was never a measurement.
        span_pence: low.profit_pence === null || high.profit_pence === null
          ? null
          : Math.abs(high.profit_pence - low.profit_pence),
      };
    })
    .sort((a, b) => {
      // §12.4, extended by §12.7: spanless bars sort after every bar with a span; within
      // each group the fixed lever order keeps the sort total and so deterministic (§1.4).
      if (a.span_pence === null || b.span_pence === null) {
        if (a.span_pence !== null) return -1;
        if (b.span_pence !== null) return 1;
        return LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever);
      }
      return (
        b.span_pence - a.span_pence
        || LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever)
      );
    });

  // The cast is sound and load-bearing only here: the throw immediately above is what
  // proves the two money fields are non-null, and TypeScript cannot see that through the
  // `validation_errors.length` check.
  return { base: base as MeasuredMetrics, matrix, tornado, config };
}
