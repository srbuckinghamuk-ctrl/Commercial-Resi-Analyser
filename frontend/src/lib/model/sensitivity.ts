import type { AnyCalculatorInputs, FlagCode } from './finance-types';
import type { ScenarioOverrides } from '../conversion-types';
import type { ValidationIssue } from './validation';
import { validateInputs } from './validation';
import { applyScenario } from './apply-scenario';
import { runAppraisal } from './index';
import { isProgrammeNetwork } from './programme';

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

export type SensitivityLever =
  | 'gdv' | 'construction_cost' | 'timeline' | 'interest_rate' | 'phase_slip'
  | 'exit_yield' | 'operating_cost' | 'vacancy' | 'sales_slip'
  | 'saleable_area' | 'abnormal_cost' | 'programme_slip' | 'refi_ltv';

/** Spec §12.4 tie-break order, making the tornado sort total and so deterministic (§1.4).
 *  R12 spec §18.9 appended the fifth lever, `phase_slip`, at the end — it is the newest
 *  and lowest-priority tie-break, not a reordering of the four §12.1 levers. R13 spec
 *  §19.8 appends the three investment-case levers the same way: newest and
 *  lowest-priority, not a reordering of what came before. R13b spec §22.8 appends the
 *  ninth lever, `sales_slip`, last again, same rule. R16 spec §25.1 appends the four
 *  stress-pack levers, last again — and from R16 this order ALSO drives the order
 *  `_measure`/`measure` apply a cell's settings in (§12.1's composition rule for
 *  `saleable_area` -> `gdv`): `measure` applies settings in REVERSE of this order, so
 *  `gdv` (index 0 here) is applied last — see `measure`'s own comment. */
export const LEVER_ORDER: readonly SensitivityLever[] = [
  'gdv', 'construction_cost', 'timeline', 'interest_rate', 'phase_slip',
  'exit_yield', 'operating_cost', 'vacancy', 'sales_slip',
  'saleable_area', 'abnormal_cost', 'programme_slip', 'refi_ltv',
];

/** Spec §12.6: an axis is capped at nine steps, bounding the suite at 81 cells. */
export const MAX_AXIS_STEPS = 9;

export interface SensitivityAxis {
  lever: SensitivityLever;
  /** R12 spec §18.9. Required (non-null) exactly when `lever === 'phase_slip'`, and
   *  required to be `null`/absent otherwise — both hard validation errors under §12.6
   *  (`validateSensitivityConfig`). Optional rather than mandatory in the TYPE so that
   *  every pre-R12 construction site (the four scalar levers never had a target) keeps
   *  compiling unmodified; an absent field is treated identically to an explicit `null`
   *  everywhere this module reads it. */
  phase_id?: string | null;
  /** In the lever's own unit: percent for gdv/construction_cost, months for
   *  timeline/phase_slip, percentage points for interest_rate. */
  steps: number[];
}

export interface TornadoRange {
  lever: SensitivityLever;
  /** Same rule as `SensitivityAxis.phase_id` above. */
  phase_id?: string | null;
  low: number;
  high: number;
}

/** Pair-keys a lever with its target so two `phase_slip` positions aiming at different
 *  phases compare as distinct (§18.9) while every other lever — whose `phase_id` is
 *  always absent/null — still compares on the lever name alone. */
function leverKey(a: { lever: SensitivityLever; phase_id?: string | null }): string {
  return `${a.lever}:${a.phase_id ?? ''}`;
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
  /** Echoes the configured range's target (§18.9); `null`/absent for every non-
   *  `phase_slip` lever. */
  phase_id?: string | null;
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

/** The set of phase ids the document's programme network carries, or empty when
 *  `programme` is `null` or the legacy `{ packages }` shape — both cases where a
 *  `phase_slip` axis has no field it could possibly write to (§18.9). */
function networkPhaseIds(inputs: AnyCalculatorInputs | undefined): Set<string> {
  const programme = inputs != null && 'programme' in inputs ? inputs.programme : null;
  return new Set(
    programme != null && isProgrammeNetwork(programme) ? programme.phases.map((p) => p.id) : [],
  );
}

/**
 * Spec §12.6, extended by §18.9/§18.8 for the `phase_slip` lever's target. Returns
 * error-severity issues; an empty array means the config is usable.
 *
 * `inputs` is optional so every pre-R12 caller keeps compiling and behaving exactly as
 * before (`phase_slip` cannot appear in a config nobody has taught to build); passing it
 * additionally checks a `phase_slip` axis or tornado range names a phase the document
 * actually carries. `runSensitivity` always passes it.
 */
export function validateSensitivityConfig(
  config: SensitivityConfig,
  inputs?: AnyCalculatorInputs,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const axes: Array<['rows' | 'cols', SensitivityAxis]> = [['rows', config.rows], ['cols', config.cols]];
  const phaseIds = networkPhaseIds(inputs);

  for (const [name, axis] of axes) {
    const field = `sensitivity.${name}.lever`;
    // Spec §12.6: an axis lever must be one of the nine §12.1/§18.9/§19.8/§22.8 levers.
    // `LEVER_ORDER` is the closed set — this is what stops a bad-cased or
    // misspelled lever from silently producing a matrix in which that axis does
    // nothing, or (in the Python mirror) crashing inside LEVER_ORDER.index()
    // further down the pipeline.
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
    // app/financial_model/apply_scenario.py. §18.9 extends the same rule to
    // `phase_slip`: `slip_months` is a whole month count too. R13b spec §22.8 extends
    // it again to `sales_slip`.
    if (
      (axis.lever === 'timeline' || axis.lever === 'phase_slip' || axis.lever === 'sales_slip'
        || axis.lever === 'programme_slip')
      && axis.steps.some((s) => !Number.isInteger(s))
    ) {
      // Fix round 1, Finding 5: worded per the actual offending lever, not a fixed
      // "Timeline" — this surfaces verbatim in the calculator's issues panel.
      const label = axis.lever === 'timeline' ? 'Timeline steps' : `${axis.lever} steps`;
      issues.push({ severity: 'error', field, message: `${label} must be whole months.` });
    }
  }

  // §18.8/§18.9: `phase_id` is required exactly when the axis is `phase_slip`, and
  // forbidden otherwise. Encoding the target in the lever name itself
  // (`'phase_slip:planning'`) was rejected — see spec §18.9 — because `LEVER_ORDER`
  // is the closed set the checks above depend on, and a lever whose name is
  // user-composed cannot be a member of a closed set.
  for (const [name, axis] of axes) {
    const field = `sensitivity.${name}.phase_id`;
    if (axis.lever === 'phase_slip') {
      if (axis.phase_id == null) {
        issues.push({
          severity: 'error', field,
          message: 'A phase_slip axis needs a phase_id naming the phase it slips.',
        });
      } else if (inputs != null && !phaseIds.has(axis.phase_id)) {
        issues.push({
          severity: 'error', field,
          message: `A phase_slip axis references phase "${axis.phase_id}", but there is `
            + `no phase with id "${axis.phase_id}".`,
        });
      }
    } else if (axis.phase_id != null) {
      issues.push({
        severity: 'error', field,
        message: `phase_id is only meaningful for the phase_slip lever, not "${axis.lever}".`,
      });
    }
  }

  // §18.9: the "rows and cols must differ" rule compares the PAIR (lever, phase_id),
  // not the lever alone — two `phase_slip` axes targeting different phases are a
  // legitimate matrix, not a duplicate.
  if (leverKey(config.rows) === leverKey(config.cols)) {
    // Fix round 1, Finding 5: two identical-lever axes and two same-phase
    // `phase_slip` axes are different mistakes, and the message now says so — a
    // reader seeing "must use different levers" against two `phase_slip` axes
    // naming the SAME phase would otherwise wonder why `phase_slip`/`phase_slip`
    // on different phases is allowed a few lines above.
    const message = config.rows.lever === 'phase_slip' && config.cols.lever === 'phase_slip'
      ? 'Two phase_slip axes must target different phases (the row and column axes '
        + 'must use different levers, or different phase_slip targets).'
      : 'The row and column axes must use different levers.';
    issues.push({ severity: 'error', field: 'sensitivity.cols.lever', message });
  }

  const seen = new Set<string>();
  for (const range of config.tornado) {
    // Spec §12.6, same closed-set rule as the axes above.
    if (!LEVER_ORDER.includes(range.lever)) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Unknown lever "${range.lever}".`,
      });
    }
    // §18.9: the tornado's duplicate-lever check keys the same pair as the axis
    // check above, so a tornado may carry one bar per slipped phase.
    if (seen.has(leverKey(range))) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Lever ${range.lever} appears more than once in the tornado.`,
      });
    }
    seen.add(leverKey(range));
    if (!Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low >= range.high) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `Tornado range for ${range.lever} needs finite low < high.`,
      });
    }
    // Spec §12.6, same whole-month rule as the axes above; §18.9 extends it to
    // phase_slip, and R13b spec §22.8 extends it again to sales_slip.
    if (
      (range.lever === 'timeline' || range.lever === 'phase_slip' || range.lever === 'sales_slip'
        || range.lever === 'programme_slip')
      && (!Number.isInteger(range.low) || !Number.isInteger(range.high))
    ) {
      // Fix round 1, Finding 5: same rewording as the axis rule above.
      const label = range.lever === 'timeline' ? 'Timeline bounds' : `${range.lever} bounds`;
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `${label} must be whole months.`,
      });
    }
    // §18.8/§18.9, same pairing rule as the axes above.
    if (range.lever === 'phase_slip') {
      if (range.phase_id == null) {
        issues.push({
          severity: 'error', field: 'sensitivity.tornado',
          message: 'A phase_slip tornado range needs a phase_id naming the phase it slips.',
        });
      } else if (inputs != null && !phaseIds.has(range.phase_id)) {
        issues.push({
          severity: 'error', field: 'sensitivity.tornado',
          message: `A phase_slip tornado range references phase "${range.phase_id}", but `
            + `there is no phase with id "${range.phase_id}".`,
        });
      }
    } else if (range.phase_id != null) {
      issues.push({
        severity: 'error', field: 'sensitivity.tornado',
        message: `phase_id is only meaningful for the phase_slip lever, not "${range.lever}".`,
      });
    }
  }

  return issues;
}

/**
 * One lever's setting for a single measurement: the lever, its magnitude in the
 * lever's own unit, and — for `phase_slip` only — the phase it targets. A grid cell
 * or tornado endpoint is one or more of these.
 *
 * §18.9 is why this is a list rather than the pre-R12 `Partial<Record<SensitivityLever,
 * number>>`: a matrix whose rows AND cols are both `phase_slip` (targeting different
 * phases, per §12.6's pair-keyed duplicate check above) needs to carry TWO simultaneous
 * `phase_slip` settings, and a single `phase_slip` key in a record can hold only one.
 */
export interface LeverSetting {
  lever: SensitivityLever;
  phaseId: string | null;
  value: number;
}

/**
 * A true no-op scenario: every lever at its identity value. Applied once at the
 * START of every measurement — including the base case, whose `settings` is
 * `[]` — so `measure()` always routes through `applyScenario` at least once (fix
 * round 1, Finding 6). Without this, the base case bypassed `applyScenario`
 * entirely and the §12.5 "base case is the unadjusted appraisal" test stopped
 * exercising `applyScenario`'s own zero-value arithmetic — a defect there (e.g.
 * a multiplier that isn't truly 1 at zero adjustment) would have gone
 * undetected by that test.
 */
const ZERO_SCENARIO: ScenarioOverrides = {
  label: '',
  gdv_adjustment_pct: 0,
  construction_cost_adjustment_pct: 0,
  timeline_adjustment_months: 0,
  interest_rate_adjustment_pct: 0,
  phase_slip_phase_id: null,
  phase_slip_months: 0,
  exit_yield_adjustment_pct: 0,
  operating_cost_adjustment_pct: 0,
  vacancy_adjustment_pct: 0,
  sales_slip_months: 0,
  saleable_area_adjustment_pct: 0,
  abnormal_cost_adjustment_pct: 0,
  programme_slip_months: 0,
  refi_ltv_adjustment_pct: 0,
};

/** Builds the single-lever `ScenarioOverrides` for one setting. Every field the
 *  setting's own lever does not own is left at its no-op value (§12.1: the five
 *  levers write to disjoint fields), so applying several settings in sequence via
 *  `applyScenario` composes correctly regardless of order (§18.9 guard 7). */
function overridesFor(setting: LeverSetting): ScenarioOverrides {
  return {
    label: '',
    gdv_adjustment_pct: setting.lever === 'gdv' ? setting.value : 0,
    construction_cost_adjustment_pct: setting.lever === 'construction_cost' ? setting.value : 0,
    timeline_adjustment_months: setting.lever === 'timeline' ? setting.value : 0,
    interest_rate_adjustment_pct: setting.lever === 'interest_rate' ? setting.value : 0,
    phase_slip_phase_id: setting.lever === 'phase_slip' ? setting.phaseId : null,
    phase_slip_months: setting.lever === 'phase_slip' ? setting.value : 0,
    exit_yield_adjustment_pct: setting.lever === 'exit_yield' ? setting.value : 0,
    operating_cost_adjustment_pct: setting.lever === 'operating_cost' ? setting.value : 0,
    vacancy_adjustment_pct: setting.lever === 'vacancy' ? setting.value : 0,
    sales_slip_months: setting.lever === 'sales_slip' ? setting.value : 0,
    saleable_area_adjustment_pct: setting.lever === 'saleable_area' ? setting.value : 0,
    abnormal_cost_adjustment_pct: setting.lever === 'abnormal_cost' ? setting.value : 0,
    programme_slip_months: setting.lever === 'programme_slip' ? setting.value : 0,
    refi_ltv_adjustment_pct: setting.lever === 'refi_ltv' ? setting.value : 0,
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
 *
 * `settings` is applied via `applyScenario` once per setting, in order, ON TOP OF a
 * leading `ZERO_SCENARIO` pass — never combined into one `ScenarioOverrides` — precisely
 * because two settings can both be `phase_slip` (§18.9) and a single overrides object
 * cannot carry two simultaneous targets. Every setting's own lever is disjoint from
 * every other's field (§12.1), so the sequential application composes exactly as one
 * combined call would for the four scalar levers, and correctly for two different
 * phase_slip targets besides. The leading zero pass means the base case (`settings ===
 * []`) still goes through `applyScenario` exactly once, the same as every levered
 * position — see `ZERO_SCENARIO`'s own comment.
 *
 * R16 spec §12.1: settings are applied in REVERSE `LEVER_ORDER`, not caller
 * order — `gdv` is index 0 (`LEVER_ORDER`'s highest tie-break priority) and
 * is therefore applied LAST here. `saleable_area` and `gdv` share
 * `estimated_value_pence` and §12.1's stated composition is area first, then
 * gdv (each rounding once, see `apply-scenario.ts`); applying in reverse
 * `LEVER_ORDER` is what achieves that, since `saleable_area` (index 9) then
 * sorts ahead of `gdv`. Sorting (stable) also makes a cell identical
 * whichever axis is the row. For the nine disjoint levers — every pair other
 * than (`gdv`, `saleable_area`) — the direction changes nothing, since each
 * setting writes its own field: the v15 identity gate asserts exactly that.
 */
export function measure(inputs: AnyCalculatorInputs, settings: LeverSetting[]): SensitivityMetrics {
  const ordered = [...settings].sort(
    (a, b) => LEVER_ORDER.indexOf(b.lever) - LEVER_ORDER.indexOf(a.lever),
  );
  const levered = ordered.reduce(
    (doc, s) => applyScenario(doc, overridesFor(s)),
    applyScenario(inputs, ZERO_SCENARIO),
  );
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
 * The suite's two documented failures, given types so a consumer can catch exactly the
 * condition it knows how to handle and let anything else through as the defect it is.
 *
 * Before R6 both were bare `Error`s separated only by a message prefix, and both
 * consumers (`export-investment-memo.ts`, `safe-sensitivity.ts`) caught everything —
 * so an engine defect reached a lender-facing PDF describing itself as an orderly
 * validation outcome. The type is the contract; the message text is not, and no
 * consumer may branch on it.
 */
export class InvalidSensitivityConfigError extends Error {}   // §12.6
export class InvalidBaseDocumentError extends Error {}        // §12.7

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
  // §18.9: passing `inputs` activates the phase-existence check, so a `phase_slip`
  // axis naming a phase this document does not carry is rejected here rather than
  // reaching `measure` and failing every cell identically.
  const issues = validateSensitivityConfig(config, inputs);
  if (issues.length > 0) {
    // Deduplicated: e.g. both axes missing a step raises the identical "An axis needs
    // at least one step." issue twice, and repeating it says nothing extra.
    const messages = [...new Set(issues.map((i) => i.message))];
    throw new InvalidSensitivityConfigError(`Invalid sensitivity config: ${messages.join(' ')}`);
  }

  const base = measure(inputs, []);
  // §12.5 makes the base case an identity with the unadjusted appraisal, so a suite over
  // an invalid base is meaningless in every position at once — this is an input error
  // (§12.6/§12.7), not twenty-five unmeasured cells.
  if (base.validation_errors.length > 0) {
    // Deduplicated for the same reason as the config message above: validateInputs
    // emits one issue per offending element (e.g. one per phased-sales tranche) and
    // those issues carry an identical message.
    const messages = [...new Set(base.validation_errors.map((e) => e.message))];
    throw new InvalidBaseDocumentError(`Invalid base document: ${messages.join(' ')}`);
  }

  const matrix: SensitivityCell[][] = config.rows.steps.map((rowStep) =>
    config.cols.steps.map((colStep) => ({
      row_step: rowStep,
      col_step: colStep,
      ...measure(inputs, [
        { lever: config.rows.lever, phaseId: config.rows.phase_id ?? null, value: rowStep },
        { lever: config.cols.lever, phaseId: config.cols.phase_id ?? null, value: colStep },
      ]),
    })),
  );

  const tornado: TornadoBar[] = config.tornado
    .map((range) => {
      const phaseId = range.phase_id ?? null;
      const low = measure(inputs, [{ lever: range.lever, phaseId, value: range.low }]);
      const high = measure(inputs, [{ lever: range.lever, phaseId, value: range.high }]);
      return {
        lever: range.lever,
        phase_id: phaseId,
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
      // §18.9 extends the tie-break with the phase target, so two phase_slip bars (same
      // lever, different phase) still sort into a total, caller-order-independent order.
      if (a.span_pence === null || b.span_pence === null) {
        if (a.span_pence !== null) return -1;
        if (b.span_pence !== null) return 1;
        return LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever)
          || (a.phase_id ?? '').localeCompare(b.phase_id ?? '');
      }
      return (
        b.span_pence - a.span_pence
        || LEVER_ORDER.indexOf(a.lever) - LEVER_ORDER.indexOf(b.lever)
        || (a.phase_id ?? '').localeCompare(b.phase_id ?? '')
      );
    });

  // The cast is sound and load-bearing only here: the throw immediately above is what
  // proves the two money fields are non-null, and TypeScript cannot see that through the
  // `validation_errors.length` check.
  return { base: base as MeasuredMetrics, matrix, tornado, config };
}
