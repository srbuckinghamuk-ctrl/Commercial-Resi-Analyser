import type { FlagCode } from './model';
import type { MeasuredMetrics, SensitivityCell, SensitivityLever, TornadoBar } from './model/sensitivity';
import { LEVER_ORDER } from './model/sensitivity';

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
  // R12 spec §18.9. The fifth lever; the page does not yet offer a phase picker
  // for it (that is later UI work), but every exhaustive lookup keyed on
  // SensitivityLever must still resolve a label for a bar the engine can now
  // return.
  phase_slip: 'Phase slip',
  // R13 spec §19.8. The three investment-case levers.
  exit_yield: 'Exit yield',
  operating_cost: 'Operating cost',
  vacancy: 'Vacancy',
  // R13b spec §22.8. The ninth lever; needs a unit_sales document to have
  // anything to write to (selectableLevers below).
  sales_slip: 'Sales slip',
  // R16 spec §25.1. The four standard lender stress-pack levers.
  saleable_area: 'Saleable area',
  abnormal_cost: 'Abnormal cost',
  programme_slip: 'Programme slip',
  refi_ltv: 'Refinance LTV',
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
  phase_slip: 'Slip',
  exit_yield: 'Yield',
  operating_cost: 'Opex',
  vacancy: 'Vacancy',
  sales_slip: 'Sales',
  saleable_area: 'Area',
  abnormal_cost: 'Abnormal',
  programme_slip: 'Prog. slip',
  refi_ltv: 'Refi LTV',
};

/**
 * R12 Task 17: the lever dropdown's own offer list. `phase_slip` needs a
 * phase target (the picker SensitivityPage.tsx shows next to the lever
 * select), and that target can only be populated from a document that
 * actually carries a phase network — a `programme = null` document has no
 * phase to slip. Offering the lever there would reproduce exactly the defect
 * this replaces: a dropdown entry whose validation error the user has no
 * control to satisfy, which used to blank the whole matrix and tornado
 * (`outcome = issues.length > 0 ? null : run(...)`).
 *
 * `hasPhaseNetwork` is the caller's own `isProgrammeNetwork` check (the sole
 * sanctioned discriminator, programme.ts) — this module stays outside
 * `lib/model/` and takes the already-resolved boolean rather than the
 * document itself.
 *
 * R13b spec §22.8: `hasUnitSales` gates `sales_slip` the same way —
 * `'unit_sales' in inputs && inputs.unit_sales != null` at the call site — a
 * document with no unit-sales ledger has no completion date for the lever to
 * move.
 */
export function selectableLevers(
  hasPhaseNetwork: boolean,
  hasUnitSales: boolean,
): readonly SensitivityLever[] {
  return LEVER_ORDER.filter((l) => (
    (l !== 'phase_slip' || hasPhaseNetwork) && (l !== 'sales_slip' || hasUnitSales)
  ));
}

/** Decimal places each lever's unit is quoted to. Percentage-POINT levers are
 *  quoted to 0.1pp — R13 spec §19.8's `exit_yield` and `vacancy` join
 *  `interest_rate` in that unit, so they take the same precision. R16 spec
 *  §25.1's `abnormal_cost` and `refi_ltv` are percentage-point levers too. */
function decimalsFor(lever: SensitivityLever): number {
  return lever === 'interest_rate' || lever === 'exit_yield' || lever === 'vacancy'
    || lever === 'abnormal_cost' || lever === 'refi_ltv' ? 1 : 0;
}

function signed(value: number, decimals: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}`;
}

// R13 spec §19.8: operating_cost is a percent, same unit as gdv/construction_cost.
// R16 spec §25.1: saleable_area is a percent too.
const PERCENT_LEVERS: readonly SensitivityLever[] = ['gdv', 'construction_cost', 'operating_cost', 'saleable_area'];
// R12 spec §18.9: phase_slip is months, same unit as timeline. R13b spec §22.8:
// sales_slip is months too. R16 spec §25.1: programme_slip is months too.
const MONTH_LEVERS: readonly SensitivityLever[] = ['timeline', 'phase_slip', 'sales_slip', 'programme_slip'];

/** One lever position in its own unit (spec §12.1): "+5%", "-3 months", "+1.0 pp". */
export function formatStepLabel(lever: SensitivityLever, step: number): string {
  const text = signed(step, decimalsFor(lever));
  if (PERCENT_LEVERS.includes(lever)) return `${text}%`;
  if (MONTH_LEVERS.includes(lever)) return `${text} months`;
  return `${text} pp`;
}

/**
 * One stress-pack setting, in its own lever's label and unit: "Abnormal cost
 * +10.0 pp" (R16 spec §25). Same convention as `formatStepLabel`, with the
 * lever's full name in front rather than an axis caption's abbreviation --
 * a stress-pack row lists several settings in one cell (`s.settings.map(...)`
 * in SensitivityPage.tsx), so each one has to name its own lever.
 *
 * `decimals`, when given, overrides `formatStepLabel`'s own per-lever
 * precision (`decimalsFor`) rather than replacing its sign/unit conventions --
 * task 9's entry 9 (`risks_crystallise`) derives a cost percentage from the
 * document at full precision and needs more than the fixed 0dp `PERCENT_LEVERS`
 * quote everywhere else. Kept minimal and local to this function: it does not
 * feed back into `formatStepLabel` or `decimalsFor`, which stay the single
 * source for every other caller's precision.
 */
export function formatStressSetting(
  s: { lever: SensitivityLever; value: number },
  decimals?: number,
): string {
  if (decimals === undefined) return `${LEVER_LABEL[s.lever]} ${formatStepLabel(s.lever, s.value)}`;
  const text = signed(s.value, decimals);
  const unit = PERCENT_LEVERS.includes(s.lever) ? '%' : MONTH_LEVERS.includes(s.lever) ? ' months' : ' pp';
  return `${LEVER_LABEL[s.lever]} ${text}${unit}`;
}

/** A tornado range with the unit stated once: "-10% to +10%", "-3 to +3 months". */
export function formatRangeLabel(lever: SensitivityLever, low: number, high: number): string {
  const d = decimalsFor(lever);
  if (PERCENT_LEVERS.includes(lever)) return `${signed(low, d)}% to ${signed(high, d)}%`;
  const unit = MONTH_LEVERS.includes(lever) ? 'months' : 'pp';
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

/**
 * A tornado bar has a span (spec §12.4/§12.7) exactly when both endpoints were
 * measured, so `span_pence !== null` is sound evidence that `low` and `high` are
 * both `MeasuredMetrics`, not merely `SensitivityMetrics` — narrowing both here is
 * what lets every render site read `.profit_pence` as a plain number, with no cast.
 *
 * The narrowing to `MeasuredMetrics` covers all six metric fields, not just
 * `profit_pence`: `span_pence !== null` only directly proves both endpoints'
 * `profit_pence` are non-null, but `peak_debt_pence` being non-null too follows
 * from a separate fact about the engine — `unmeasured()` (sensitivity.ts) nulls
 * all six metric fields together, so a measured `profit_pence` implies a measured
 * `peak_debt_pence` on the same endpoint. A reader should not have to rediscover
 * that transitive step to trust the cast this predicate licenses.
 *
 * Single source shared by the memo (export-investment-memo.ts) and the
 * calculator's Sensitivity page (SensitivityPage.tsx) — see this file's header
 * for why the sharing matters.
 */
export function isMeasuredBar(
  bar: TornadoBar,
): bar is TornadoBar & { span_pence: number; low: MeasuredMetrics; high: MeasuredMetrics } {
  return bar.span_pence !== null;
}

/**
 * One fully-formed sentence per tornado bar dropped because the engine could not
 * measure one of its endpoints — the levered document failed validation (spec
 * §12.7) — empty when every bar is measured. Each sentence carries the engine's
 * own `validation_errors` message for that endpoint, not a rationale reconstructed
 * here: different levers fail for different reasons (an emptied term, a negative
 * rate, a sales tranche landing past the programme end, …), and only the engine
 * knows which applies. The caller must print these rather than silently shrinking
 * the table.
 *
 * Named for what it now holds — sentences, not lever codes — after the R4b guards
 * this module used to carry (`isUnsoundTornadoBar`) were retired in favour of the
 * §12.7 rule (see this file's header).
 */
export function omittedTornadoNotes(tornado: readonly TornadoBar[]): string[] {
  return tornado
    .filter((bar) => bar.span_pence === null)
    .map((bar) => {
      // Deduplicated within this bar: both endpoints can fail the same rule (e.g. an
      // emptied term rejects both a low and a high timeline step identically), and the
      // engine's message is byte-identical each time — repeating it says nothing extra.
      const messages = bar.low.validation_errors
        .concat(bar.high.validation_errors)
        .map((e) => e.message);
      const reasons = [...new Set(messages)].join(' ');
      return `${LEVER_LABEL[bar.lever]} omitted: one endpoint's levered document fails validation — ${reasons} (spec §12.7).`;
    });
}

/**
 * The one sentence a cell's §12.7 reason becomes, shared by the memo
 * (export-investment-memo.ts) and the calculator's Sensitivity page
 * (SensitivityPage.tsx) — before R6 each surface hand-wrote this sentence
 * separately, and nothing enforced that they stayed in step.
 *
 * Returned WITHOUT a list ordinal: the page's `<ol>` numbers itself and the
 * memo prepends its own `${i + 1}. ` — an ordinal belongs to the list the
 * sentence sits in, not to the sentence.
 */
export function unmeasuredCellNote(reason: string): string {
  return `Not measured — the levered document fails validation: ${reason} (spec §12.7).`;
}

/** The result of scanning a matrix for positions the engine could not measure. */
export interface UnmeasuredCellNotes {
  /** Distinct reasons, in first-appearance order scanning the matrix row-major. */
  notes: readonly string[];
  /** Zero-based index into `notes`, or null when the cell is measured. */
  noteIndexFor(cell: SensitivityCell): number | null;
}

/**
 * The reasons a grid's unmeasured positions exist (spec §12.7), deduplicated, for a
 * caller to print beneath the matrix.
 *
 * Single source shared by the memo (export-investment-memo.ts) and the calculator's
 * Sensitivity page (SensitivityPage.tsx). Sharing it is the point: before R6 the page
 * put each cell's reason in a `<td title>` — invisible to assistive tech, print and
 * touch — while the memo printed a caption saying only that the ambiguity existed,
 * without ever naming which reason applied. Two surfaces, two different failures to
 * carry information the engine had already handed over.
 *
 * A cell's reason is its `validation_errors` messages joined, exactly as
 * `omittedTornadoNotes` joins a bar's. Deduplication is keyed on the exact message
 * text, not on the lever position: it collapses a row into one note whenever every
 * cell in it produces byte-identical text, which is common but not universal — three
 * `validateInputs` messages interpolate `finance.term_months` (the very quantity the
 * timeline lever moves), so a set of timeline steps can still surface one distinct
 * note per step for what is, underneath, a single cause.
 *
 * Keyed on the reason string rather than on cell identity: the page rebuilds its cell
 * objects on every render and the memo holds different objects again, so identity is
 * not stable across the callers that need this.
 */
export function unmeasuredCellNotes(
  matrix: readonly (readonly SensitivityCell[])[],
): UnmeasuredCellNotes {
  const reasonOf = (cell: SensitivityCell): string | null => {
    if (cell.validation_errors.length === 0) return null;
    // Deduplicated within this cell: validateInputs emits one issue per offending
    // element (e.g. one per phased-sales tranche) and those issues carry an
    // identical message, so joining without dedup repeats the same sentence once
    // per element rather than saying anything new.
    const messages = cell.validation_errors.map((e) => e.message);
    return [...new Set(messages)].join(' ');
  };

  const index = new Map<string, number>();
  for (const row of matrix) {
    for (const cell of row) {
      const reason = reasonOf(cell);
      if (reason !== null && !index.has(reason)) index.set(reason, index.size);
    }
  }

  return {
    notes: [...index.keys()],
    noteIndexFor(cell) {
      const reason = reasonOf(cell);
      return reason === null ? null : index.get(reason) ?? null;
    },
  };
}
