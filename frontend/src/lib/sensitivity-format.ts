import type { FlagCode } from './model';
import type { MeasuredMetrics, SensitivityCell, SensitivityLever, TornadoBar } from './model/sensitivity';

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
 * `omittedTornadoNotes` joins a bar's. Deduplicating matters because the ordinary case
 * is one lever position invalidating an entire row for one reason.
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
