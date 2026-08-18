import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project, EligibilityAssessment } from '../types';
import type { AnyCalculatorInputs, AppraisalRun, ModelFlag } from './model';
import { runAppraisal } from './model';
import { applyScenario } from './model/apply-scenario';
import { runSensitivity, InvalidBaseDocumentError } from './model/sensitivity';
import type { SensitivityCell, SensitivityConfig, SensitivityLever } from './model/sensitivity';
import {
  LEVER_LABEL, LEVER_SHORT, formatRangeLabel, formatStepLabel, flagShortCodes,
  isMeasuredBar, omittedTornadoNotes, unmeasuredCellNotes, unmeasuredCellNote,
} from './sensitivity-format';
import { formatProgrammeMonth } from './programme-months';
import { repairGluedDescription } from './format';
import { PAGE_H, PAGE_W } from './report-layout';
import { buildProvenance, formatGeneratedAt, lenderCaseLabel } from './report-provenance';
import {
  DARK_PAGE_TONE, LIGHT_PAGE_TONE, drawWatermark, fitWatermark, setDocumentMetadata,
} from './report-layout';
import type { DraftReason, ReportProvenance } from './report-provenance';
import type { Jurisdiction } from './tax/acquisition-tax';
import type { ProposedUnit, ProposedUnitV6, UnitAncillary } from './conversion-types';
import { DEFAULT_UNIT_ANCILLARY } from './conversion-types';

// ── This memo consumes the finished AppraisalRun only ─────
//
// generateInvestmentMemo performs zero recalculation of financial metrics:
// every figure it prints comes from run.metrics, run.model or
// run.schedule.totals (the shared engine's output — frontend/src/lib/model),
// or is a raw, unmodified input value. The only local arithmetic below is
// presentational: unit conversions (pence→£/sq ft), running totals for a
// cashflow table, ratios of two already-authoritative totals (e.g. a
// category's % of an engine-computed grand total), and the Retained
// Portfolio's indicative gross yield (rent ÷ capital value — the engine does
// not model rental income at all, so there is no authoritative figure to
// consume; captioned "indicative — not part of the appraisal" wherever shown).
// No cost, fee, LTV, LTC, IRR or profit figure is re-derived here — see
// docs/financial-model/calculation-specification.md §11 for the
// prohibited-calculations list this file was rewritten to comply with.

const MARGIN_L = 20;
const MARGIN_R = 20;
const MARGIN_T = 25;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const FOOTER_Y = 287;

/** Last baseline the flowing content may occupy; the footer sits below it. */
const CONTENT_BOTTOM = 272;

/** A table's header row plus roughly three body rows at the memo's 8-9pt sizes. */
const TABLE_MIN_BLOCK_MM = 34;
/** Tables at or below this height are kept whole rather than split (see `table`). */
const MOVE_WHOLE_MAX_MM = 110;

/**
 * Two distinct reasons a document is not a final lender paper, and they must not
 * be conflated: a run whose hard validations fail is *unreconciled* and its
 * figures may be wrong, whereas a run that reconciles cleanly but carries no
 * approved lender case is arithmetically sound and simply has not been approved.
 * Printing the first message over the second would state something untrue about
 * the model; printing no message at all would let an unapproved appraisal leave
 * the building looking like a credit paper. See spec Sec 13.3.
 */
/** The condition each watermark states, in a form that fits mid-sentence.
 *  Kept beside the banner text so a reason can never drift from its wording. */
const DRAFT_REASON_SENTENCE: Record<DraftReason, string> = {
  unreconciled: 'one or more hard validations fail',
  senior_not_repaid: 'the senior facility is not repaid within the modelled term',
  tax_basis_unconfirmed: 'the acquisition tax jurisdiction has not been confirmed',
  not_approved: 'no lender case has been credit approved',
};

const WATERMARK_TEXT: Record<DraftReason, string> = {
  unreconciled: 'DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE',
  senior_not_repaid: 'DRAFT - SENIOR DEBT NOT REPAID - NOT FOR LENDER RELIANCE',
  tax_basis_unconfirmed: 'DRAFT - TAX BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE',
  not_approved: 'DRAFT - NOT APPROVED FOR LENDER RELIANCE',
};

/** Spec §14. The reader is told which country's regime was applied, not the
 *  internal key. Kept beside the memo's other label tables so a new
 *  jurisdiction cannot be added without a printed name for it. */
const JURISDICTION_LABEL: Record<Jurisdiction, string> = {
  england_ni: 'England & Northern Ireland',
  scotland: 'Scotland',
  wales: 'Wales',
};

/**
 * An ISO band-set date as `25 Jan 2019`.
 *
 * Parsed by hand rather than through `new Date(...)`: `band_set_effective_from`
 * is a plain calendar date with no time or zone, and putting it through the
 * Date constructor would re-interpret it as UTC midnight and print the previous
 * day for any reader west of Greenwich. `fmtDate` above has the same shape but
 * takes timestamps, so it is deliberately not reused here.
 */
function formatBandDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * jspdf-autotable augments the jsPDF instance with `lastAutoTable` at
 * runtime (the position of the most recently drawn table); the package's
 * own type declarations don't add this to the jsPDF type, so callers cast.
 * This type documents the actual runtime shape instead of using `any`.
 */
interface JsPdfWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number };
}

/** Y-coordinate immediately below the most recently drawn table. */
function lastAutoTableFinalY(doc: jsPDF): number {
  return (doc as JsPdfWithAutoTable).lastAutoTable.finalY;
}

function fmt(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  });
}

function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** Percentage that may be `null` (spec §1.5 — unknown, zero-denominator, or not yet available). */
function fmtPctSafe(pct: number | null, naLabel = 'n/a'): string {
  return pct === null ? naLabel : fmtPct(pct);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function sqmToSqft(sqm: number): number {
  return Math.round(sqm * 10.7639);
}

/** Presentational unit conversion of an already-authoritative pence total — not a formula. */
function perSqftPence(totalPence: number, sqm: number): string {
  if (sqm <= 0) return '-';
  const sqft = sqmToSqft(sqm);
  return fmt(Math.round(totalPence / sqft));
}

function unitLabel(type: string): string {
  const map: Record<string, string> = {
    studio: 'Studio',
    '1bed': '1-Bed',
    '2bed': '2-Bed',
    '3bed': '3-Bed',
  };
  return map[type] ?? type;
}

function flagPresent(flags: ModelFlag[], code: ModelFlag['code']): boolean {
  return flags.some((f) => f.code === code);
}

/** Full-word flag summary for the Scenario Comparison table's Flags row. */
function flagSummary(flags: ModelFlag[]): string {
  const labels: string[] = [];
  if (flagPresent(flags, 'facility_exceeded')) labels.push('Facility exceeded');
  if (flagPresent(flags, 'funding_gap')) labels.push('Funding gap');
  if (flagPresent(flags, 'senior_outstanding_at_maturity')) labels.push('Senior not repaid');
  return labels.length > 0 ? labels.join('; ') : 'None';
}

/**
 * Sources = uses to the penny (spec §7), computed here for the report table only —
 * this mirrors frontend/src/lib/model/validation.ts's reconcile() aggregation of
 * already-computed ledger totals; it is a display grouping of engine output, not a
 * new financial formula. Exported so tests can assert the identity directly.
 */
export function sourcesAndUsesTotals(run: AppraisalRun): {
  usesTotal: number;
  sourcesTotal: number;
  rolledInterestPence: number;
} {
  const { model, schedule, metrics, inputs } = run;
  const rolledInterestPence = inputs.finance.interest_type === 'rolled_up' ? model.totals.interest_pence : 0;
  const usesTotal = metrics.total_development_cost_pence;
  const sourcesTotal =
    model.totals.equity_contributed_pence +
    // Spec §4.5/§7 (mirrors validation.ts reconcile() exactly): additional equity
    // absorbed by the refinance event's shortfall/negative-net-proceeds branches
    // funds a facility redemption — a financing-side flow, not a project cost —
    // so it is excluded here just like it is from reconcile()'s identity.
    (model.totals.additional_equity_pence - model.totals.refinance_shortfall_equity_pence) +
    model.totals.funding_gap_pence +
    model.totals.draws_pence +
    model.totals.capitalised_fees_pence +
    rolledInterestPence +
    schedule.totals.selling_costs_pence +
    model.totals.exit_fee_pence;
  return { usesTotal, sourcesTotal, rolledInterestPence };
}

/**
 * The §10 two-way sensitivity matrices and tornado, as the exact string rows
 * the PDF prints. Kept separate from generateInvestmentMemo's body so its
 * output can be pinned string-for-string by export-investment-memo.test.ts —
 * presentation only, every number here comes from run.metrics of an ordinary
 * appraisal (or the sensitivity engine's equivalent), per the file header's
 * no-recalculation rule.
 */
export interface MemoSensitivityTables {
  head: string[];
  pocRows: string[][];
  ltgdvRows: string[][];
  /** [lever, range, profit at low, profit at high, swing] per spec §12.4 bar.
   *  Excludes any bar with an unmeasured endpoint — see `omittedTornadoNotes`. */
  tornadoRows: string[][];
  /** One fully-formed sentence per lever dropped from `tornadoRows` because the engine
   *  could not measure one of its endpoints — the levered document failed validation
   *  (spec §12.7) — empty when every bar is measured. Each sentence carries the
   *  engine's own `validation_errors` message for that endpoint, not a rationale
   *  reconstructed here: different levers fail for different reasons (an emptied
   *  term, a negative rate, a sales tranche past the programme end, …), and only the
   *  engine knows which applies. The caller must print these rather than silently
   *  shrinking the table. Built by the shared `omittedTornadoNotes` (sensitivity-format.ts),
   *  the same function SensitivityPage.tsx uses, so the two surfaces cannot disagree. */
  omittedTornadoNotes: string[];
  /** The reasons this grid's unmeasured positions exist (spec §12.7), deduplicated and
   *  in first-appearance order, empty when every position was measured. A cell the
   *  engine could not measure prints the same "n/a" as a metric that is merely null
   *  (e.g. a zero-denominator ratio), so §10 prints these beneath the matrices to say
   *  which positions are which — and why, in the engine's own words rather than a
   *  rationale reconstructed here. Built by the shared module the Sensitivity page
   *  reads too. */
  unmeasuredCellNotes: readonly string[];
}

export function sensitivityTables(
  inputs: AnyCalculatorInputs,
  config?: SensitivityConfig,
): MemoSensitivityTables {
  // R4b: the grid steps, the lever rule and the base-case identity are now the
  // engine's (spec §12.3–§12.5) rather than constants living in this file. The
  // default config *is* the grid this memo has always printed — R4a promoted
  // these very steps into the specification — so the output is unchanged, and
  // export-investment-memo.test.ts pins that string for string. generateInvestmentMemo
  // always calls this with one argument; `config` exists so tests can drive a grid
  // that actually produces unmeasured cells (spec §12.7), exactly as safeRunSensitivity
  // does for the Sensitivity page.
  const result = config ? runSensitivity(inputs, config) : runSensitivity(inputs);
  const { rows, cols } = result.config;

  const axisCaption = (lever: SensitivityLever, step: number) =>
    `${LEVER_SHORT[lever]} ${formatStepLabel(lever, step)}`;

  const cellText = (cell: SensitivityCell, key: 'profit_on_cost_pct' | 'ltgdv_developer_pct') => {
    const codes = flagShortCodes(cell.flags);
    return `${fmtPctSafe(cell[key])}${codes ? ` [${codes}]` : ''}`;
  };

  const bodyFor = (key: 'profit_on_cost_pct' | 'ltgdv_developer_pct') =>
    result.matrix.map((row) => [
      axisCaption(rows.lever, row[0].row_step),
      ...row.map((cell) => cellText(cell, key)),
    ]);

  // §12.7: the engine reports a bar with an unmeasured endpoint as having no span. The
  // memo omits those rather than printing a partial bar, and says so beneath the table
  // — using the engine's own `validation_errors` message for that endpoint, not a
  // rationale reconstructed here (the earlier term-only wording was wrong for any bar
  // whose endpoint failed validation for a reason other than an emptied term, e.g. an
  // interest-rate endpoint gone negative, or a sales tranche landing past the
  // programme end). Both `isMeasuredBar` and the sentence builder are shared with
  // SensitivityPage.tsx via sensitivity-format.ts, so the two surfaces cannot drift.
  const soundBars = result.tornado.filter(isMeasuredBar);
  const tornadoNotes = omittedTornadoNotes(result.tornado);

  const tornadoRows = soundBars.map((bar) => [
    LEVER_LABEL[bar.lever],
    formatRangeLabel(bar.lever, bar.low_step, bar.high_step),
    fmt(bar.low.profit_pence),
    fmt(bar.high.profit_pence),
    // |profit(high) - profit(low)| (spec §12.4) — a magnitude, so it stays
    // unsigned even where the high endpoint is the adverse one (cost, rate).
    fmt(bar.span_pence),
  ]);

  const cellNotes = unmeasuredCellNotes(result.matrix);

  return {
    head: ['', ...cols.steps.map((step) => axisCaption(cols.lever, step))],
    pocRows: bodyFor('profit_on_cost_pct'),
    ltgdvRows: bodyFor('ltgdv_developer_pct'),
    tornadoRows,
    omittedTornadoNotes: tornadoNotes,
    unmeasuredCellNotes: cellNotes.notes,
  };
}

export function generateInvestmentMemo(
  project: Project,
  run: AppraisalRun,
  eligibility?: EligibilityAssessment | null,
  provenance?: ReportProvenance | null,
): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { inputs, metrics, model, schedule } = run;
  // Spec Sec 13. A caller that supplies no provenance still gets a governed
  // document: with no stored record there are no hashes to print and no lender
  // case to be approved, so the report says so and stays a DRAFT rather than
  // silently dropping the panel.
  const prov = provenance ?? buildProvenance(run, null);
  // The two conditions are separate (spec Sec 13.3): an unreconciled run's
  // figures may be wrong; a reconciled but unapproved run's figures are sound
  // and merely unapproved. Only the first may claim the model is at fault.
  const draft = prov.draftReason !== null;
  const watermarkText = prov.draftReason === null ? '' : WATERMARK_TEXT[prov.draftReason];
  // Spec §14. The engine's own record of which regime, jurisdiction, band set
  // and table version produced `acquisition_tax_pence`. Read, never re-derived:
  // the memo names the basis the figure came from, it does not choose one.
  const tax = metrics.acquisition_tax;
  // `inputs` may be a pre-Release-2b v2 document with no `lender_valuation` field at all —
  // this mirrors the null it would carry on a v3 document with no block recorded.
  const lenderValuation = 'lender_valuation' in inputs ? inputs.lender_valuation : null;
  // Release 3b (Task 13): v4-aware, polymorphic over AnyCalculatorInputs — v2/v3
  // documents carry none of these blocks at all, so every read is `in`-guarded
  // exactly like lenderValuation above. anchor_month is display-only (spec §2.1)
  // and never enters calculation; monthLabel is the memo's single conversion point.
  const programme = 'programme' in inputs ? inputs.programme : null;
  const salesPhasing = 'sales_phasing' in inputs ? inputs.sales_phasing : null;
  const refinance = 'refinance' in inputs ? inputs.refinance : null;
  const anchor = programme?.anchor_month ?? null;
  const monthLabel = (m: number) => formatProgrammeMonth(anchor, m);

  const totalSqm = inputs.unit_mix.units.reduce((s, u) => s + u.floor_area_sqm, 0);
  const totalSqft = sqmToSqft(totalSqm);
  const unitCount = inputs.unit_mix.units.length;

  // R9 (spec §15). The one place the memo reads areas from — never
  // `conversion_costs.total_construction_sqm` directly (eslint-enforced, spec
  // §15.4). Every figure below is read off `bridge`/`metrics`, not recomputed.
  const bridge = metrics.area_bridge;

  /** A pre-v6 document has units with no `ancillary` block at all. */
  function unitAncillaryOf(u: ProposedUnit | ProposedUnitV6): UnitAncillary {
    return 'ancillary' in u ? u.ancillary : DEFAULT_UNIT_ANCILLARY;
  }

  // ── Text style: the one place font, weight and colour are set ────────────
  //
  // R7. Every layout defect the second audit found on page 8 came from style
  // state outliving the call that set it. `watermark()` left the document at
  // 40 pt bold grey and `infoRequired()` set its own 10 pt italic amber *before*
  // testing whether it needed a page break — so the break repainted the state
  // and the line was drawn at 40 pt, running 400 mm off a 210 mm page.
  //
  // The rule that removes the whole class: style is applied immediately before
  // each draw, never before a break, and anything that draws out-of-band
  // restores what it found. `Style` makes both halves cheap enough that there is
  // no reason to reach past them.
  interface Style {
    size: number;
    weight: 'normal' | 'bold' | 'italic' | 'bolditalic';
    color: [number, number, number];
  }

  const BODY: Style = { size: 10, weight: 'normal', color: [51, 65, 85] };
  const SECTION: Style = { size: 14, weight: 'bold', color: [30, 58, 95] };
  const SUBHEAD: Style = { size: 11, weight: 'bold', color: [30, 41, 59] };
  const INFO: Style = { size: 10, weight: 'italic', color: [180, 83, 9] };
  const CAPTION: Style = { size: 8, weight: 'normal', color: [100, 116, 139] };

  function applyStyle(style: Style): void {
    doc.setFontSize(style.size);
    doc.setFont('helvetica', style.weight);
    doc.setTextColor(...style.color);
  }

  // ── Draft watermark (spec: unreconciled appraisals never look lender-ready) ──

  /** Measure with a throwaway font state; restores whatever was current. */
  function preservingMeasurement<T>(measure: () => T): T {
    const size = doc.getFontSize();
    const { fontName, fontStyle } = doc.getFont();
    const result = measure();
    doc.setFontSize(size);
    doc.setFont(fontName, fontStyle);
    return result;
  }

  // Sized once: the fit search measures the string at up to 69 candidate sizes,
  // and the answer cannot change between pages of the same document.
  const watermarkGeometry = draft ? fitWatermark(doc, watermarkText) : null;

  // The cover is a full-bleed dark page; every other page is white.
  let onDarkPage = true;

  function watermark(): void {
    if (!watermarkGeometry) return;
    drawWatermark(
      doc, watermarkText, watermarkGeometry,
      onDarkPage ? DARK_PAGE_TONE : LIGHT_PAGE_TONE,
    );
  }

  // jspdf-autotable paginates internally via its own doc.addPage() calls when
  // a table spans multiple pages — those pages never go through newPage()
  // below, so watermarking must also be driven by autoTable's didDrawPage
  // hook (see the table() wrapper). lastWatermarkedPage guards against
  // watermarking the same physical page twice (harmless — it would just
  // redraw identical grey text in the same place — but pointless work).
  let lastWatermarkedPage = 0;

  /** Draws the watermark on the current page, at most once per physical page. */
  function ensureWatermark(): void {
    if (!draft) return;
    const page = doc.getNumberOfPages();
    if (page === lastWatermarkedPage) return;
    lastWatermarkedPage = page;
    watermark();
  }

  /** Every new page gets the watermark when the run isn't report-safe. */
  function newPage(): void {
    doc.addPage();
    ensureWatermark();
  }

  /**
   * The keep-together primitive: return a cursor with at least `neededMm` of
   * flowing space beneath it, breaking the page first if there is not.
   *
   * This replaces the fixed `if (y > 200)` / `if (y > 245)` guards the memo used
   * to carry. Those numbers were guesses about how tall whatever came next would
   * be, and they were wrong in both directions — too eager, and a section that
   * would have fitted was pushed onto a page of its own (the audit's near-blank
   * page 11); too lax, and a heading was left stranded at the foot of a page.
   */
  function ensureSpace(y: number, neededMm: number): number {
    if (y + neededMm <= CONTENT_BOTTOM) return y;
    newPage();
    return MARGIN_T;
  }

  /**
   * autoTable wrapper — every table call must go through this, not
   * autoTable(doc, ...) directly, so that pages autoTable creates on its own
   * (internal pagination for a table taller than one page) also get the
   * watermark via didDrawPage, which fires once per physical page the table
   * touches, including the first.
   *
   * It also owns the table's own keep-together: a table that begins with only
   * its header and a row or two visible above the page break reads as a
   * mistake, so the wrapper breaks first and starts the table at the top of the
   * next page instead.
   */
  function table(options: Parameters<typeof autoTable>[1]): void {
    const requestedY = typeof options.startY === 'number' ? options.startY : MARGIN_T;
    const height = measureTableHeight(options);
    // Heading first, and measured together with the table, so a heading can
    // never be left on the page the table just moved off.
    const afterHeadings = flushHeadings(
      requestedY,
      Number.isFinite(height) && height <= MOVE_WHOLE_MAX_MM ? height : TABLE_MIN_BLOCK_MM,
    );
    // A short table moves whole rather than splitting: splitting one costs more
    // in legibility than the white space it saves, and a two-row tail on its own
    // page is the orphan the second audit reported. A long one is allowed to
    // split — moving a 200 mm schedule off a half-empty page would leave a
    // worse hole than the split it avoided — and only has to clear the
    // header-plus-a-few-rows minimum where it starts.
    const startY = height <= MOVE_WHOLE_MAX_MM
      ? ensureSpace(afterHeadings, height)
      : ensureSpace(afterHeadings, TABLE_MIN_BLOCK_MM);
    autoTable(doc, {
      ...options,
      startY,
      didDrawPage: (data) => {
        ensureWatermark();
        options.didDrawPage?.(data);
      },
    });
  }

  /**
   * The height this table would occupy drawn at the top of an empty page, or
   * Infinity when it is taller than one page.
   *
   * Measured by drawing it into a throwaway document rather than estimating
   * from row counts and font sizes: autoTable decides its own row heights from
   * wrapped cell content, and a guess that is wrong by one row is exactly what
   * leaves a single orphaned row — and, once, a three-line closing statement —
   * alone on a final page.
   */
  function measureTableHeight(options: Parameters<typeof autoTable>[1]): number {
    const probe = new jsPDF({ unit: 'mm', format: 'a4' });
    autoTable(probe, { ...options, startY: MARGIN_T, didDrawPage: undefined });
    if (probe.getNumberOfPages() > 1) return Number.POSITIVE_INFINITY;
    return (probe as JsPdfWithAutoTable).lastAutoTable.finalY - MARGIN_T;
  }

  function addPageFooter(): void {
    const pageCount = doc.getNumberOfPages();
    for (let i = 2; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150);
      doc.text(project.address_raw, MARGIN_L, FOOTER_Y);
      doc.text('CONFIDENTIAL', PAGE_W / 2, FOOTER_Y, { align: 'center' });
      doc.text(`Page ${i - 1} of ${pageCount - 1}`, PAGE_W - MARGIN_R, FOOTER_Y, { align: 'right' });
    }
  }

  /** Wrap to the content width, measured in the style the text will be drawn in. */
  function wrap(text: string, style: Style, widthMm = CONTENT_W): string[] {
    return preservingMeasurement(() => {
      doc.setFont('helvetica', style.weight);
      doc.setFontSize(style.size);
      return doc.splitTextToSize(text, widthMm) as string[];
    });
  }

  /**
   * Draw wrapped lines from `y`, breaking pages as needed and re-applying the
   * style after every break. A block that would fit on a page of its own is
   * never split: it moves whole, which is what stops three orphaned lines of a
   * footnote from becoming a page.
   */
  function writeLines(y: number, lines: string[], style: Style, lineHeight: number): number {
    const blockHeight = lines.length * lineHeight;
    y = flushHeadings(y, blockHeight);
    for (const line of lines) {
      y = ensureSpace(y, lineHeight);
      applyStyle(style);
      doc.text(line, MARGIN_L, y);
      y += lineHeight;
    }
    return y;
  }

  // ── Headings are deferred, not drawn where they are asked for ────────────
  //
  // A heading cannot decide its own page, because whether it fits depends on
  // the height of the block that follows it — and that block is measured after
  // the heading has already been placed. Reserving a guessed 18 mm for "the
  // heading plus a couple of lines" is not enough when what follows is a 90 mm
  // table that then moves whole to the next page, leaving the heading stranded
  // at the foot of the previous one. (Which is exactly what happened to "Two-Way
  // Sensitivity Matrix: LTGDV, developer basis" on the first pass of this fix.)
  //
  // So a heading is queued, and the next block to draw flushes the queue as part
  // of its own keep-together decision: heading heights are added to the block's
  // height, the page break is taken once for the lot, and the heading is drawn
  // on whichever page its content ended up on. A section title followed by a
  // sub-heading followed by a table travels as one unit.
  type PendingHeading =
    | { kind: 'section'; num: number; title: string }
    | { kind: 'sub'; text: string };

  const SECTION_HEADING_MM = 12;
  const SUB_HEADING_MM = 6;
  let pendingHeadings: PendingHeading[] = [];

  function headingHeight(h: PendingHeading): number {
    return h.kind === 'section' ? SECTION_HEADING_MM : SUB_HEADING_MM;
  }

  /**
   * Take the page break for the queued headings plus `contentMm` of the block
   * about to be drawn, draw the headings, and return the cursor for the content.
   */
  function flushHeadings(y: number, contentMm: number): number {
    const headingsMm = pendingHeadings.reduce((sum, h) => sum + headingHeight(h), 0);
    y = ensureSpace(y, headingsMm + Math.min(contentMm, CONTENT_BOTTOM - MARGIN_T));
    for (const heading of pendingHeadings) {
      if (heading.kind === 'section') {
        applyStyle(SECTION);
        doc.text(`${heading.num}. ${heading.title}`, MARGIN_L, y);
        y += 4;
        doc.setDrawColor(30, 58, 95);
        doc.setLineWidth(0.5);
        doc.line(MARGIN_L, y, MARGIN_L + CONTENT_W, y);
        y += 8;
      } else {
        applyStyle(SUBHEAD);
        doc.text(heading.text, MARGIN_L, y);
        y += SUB_HEADING_MM;
      }
    }
    pendingHeadings = [];
    return y;
  }

  function sectionTitle(y: number, num: number, title: string): number {
    pendingHeadings.push({ kind: 'section', num, title });
    return y;
  }

  function subHeading(y: number, text: string): number {
    pendingHeadings.push({ kind: 'sub', text });
    return y;
  }

  function bodyText(y: number, text: string): number {
    return writeLines(y, wrap(text, BODY), BODY, 5) + 2;
  }

  /** Small grey note text, used for provenance captions and figure footnotes. */
  function captionText(y: number, text: string): number {
    return writeLines(y, wrap(text, CAPTION), CAPTION, 4) + 2;
  }

  // ── Return metrics: label and suppression (spec §3.16.1) ─────────────────
  //
  // The second audit found the memo printing "Return on Equity 64.38%" beside
  // "Equity Multiple 0.00x" for a retain-all case with no exit modelled. Both
  // figures were arithmetically right and together they told a non-specialist
  // reader something false. The engine now says which basis it is on; the memo
  // says so on the page.
  const roeLabel = metrics.return_on_equity_is_unrealised
    ? 'Return on Equity (unrealised)'
    : 'Return on Equity';

  const equityMultipleValue = metrics.equity_multiple === null
    ? 'not available — no sale or refinance modelled within the term'
    : `${metrics.equity_multiple.toFixed(2)}x`;

  const irrValue = fmtPctSafe(
    metrics.irr_annual_pct,
    'not available (no sign change in equity flows)',
  );

  function infoRequired(y: number, label: string): number {
    // Wrapped, not drawn as one unbounded line: "[Information Required: Risks
    // not yet addressed: …]" is routinely wider than the page even at 10 pt.
    return writeLines(y, wrap(`[Information Required: ${label}]`, INFO), INFO, 5) + 1;
  }

  // ── Cover Page ──
  doc.setFillColor(10, 22, 40);
  doc.rect(0, 0, PAGE_W, 297, 'F');
  ensureWatermark();

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('PROJECT REPORT / INVESTMENT MEMORANDUM', MARGIN_L, 60);

  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(226, 232, 240);
  const titleLines = doc.splitTextToSize(project.address_raw, CONTENT_W);
  let ty = 75;
  for (const line of titleLines) {
    doc.text(line, MARGIN_L, ty);
    ty += 10;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  ty += 5;
  if (project.address_postcode) {
    doc.text(project.address_postcode, MARGIN_L, ty);
    ty += 7;
  }
  doc.text(
    `${project.use_class.replace(/_/g, ' ').toUpperCase()} -> RESIDENTIAL CONVERSION`,
    MARGIN_L,
    ty,
  );
  ty += 7;
  doc.text(
    `${unitCount} unit${unitCount !== 1 ? 's' : ''} | ${totalSqft.toLocaleString()} sq ft NIA`,
    MARGIN_L,
    ty,
  );

  ty += 20;
  doc.setDrawColor(30, 58, 95);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_L, ty, MARGIN_L + CONTENT_W, ty);
  ty += 12;

  const coverMetrics = [
    ['GDV', fmt(metrics.gdv_pence)],
    ['Total Development Cost', fmt(metrics.total_development_cost_pence)],
    ['Profit on Cost', fmtPctSafe(metrics.profit_on_cost_pct)],
    ['Profit on GDV', fmtPctSafe(metrics.profit_on_gdv_pct)],
    ['IRR (Annual)', fmtPctSafe(metrics.irr_annual_pct)],
    ['Equity Contributed', fmt(metrics.equity_contributed_pence)],
  ];
  doc.setFontSize(10);
  for (const [label, value] of coverMetrics) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(label, MARGIN_L, ty);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(226, 232, 240);
    doc.text(value, MARGIN_L + 65, ty);
    ty += 7;
  }

  ty = 250;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated: ${formatGeneratedAt(prov.generatedAt, prov.timeZone)}`, MARGIN_L, ty);
  ty += 5;
  doc.text(
    `${prov.documentStatus} | Calc ${prov.calcVersion} | Inputs v${prov.inputsVersion} | Scenario: ${prov.scenarioName}`,
    MARGIN_L,
    ty,
  );
  ty += 5;
  doc.text('PRIVATE & CONFIDENTIAL', MARGIN_L, ty);
  ty += 5;
  doc.text(
    'This document is prepared for the sole use of the intended recipient and should not be',
    MARGIN_L,
    ty,
  );
  ty += 4;
  doc.text(
    'distributed without the prior written consent of the sponsor.',
    MARGIN_L,
    ty,
  );

  // ── Report Provenance ──
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  onDarkPage = false;
  ensureWatermark();
  let y = MARGIN_T;

  // Spec Sec 13.1. First page of body text, before any figure, because a reader
  // must be able to tell what this document is before reading what it says: the
  // second audit found a 13-page memorandum carrying no model version, no
  // hashes, no scenario identity and no generation time, which left two PDFs of
  // the same scheme indistinguishable and every printed figure untraceable.
  y = sectionTitle(y, 0, 'Report Provenance');
  const hashOrAbsent = (hash: string | null) =>
    hash ?? 'not recorded — result predates provenance hashing';
  // R8 fix round 1 (spec §14). A pre-R8 document records no jurisdiction, so
  // `deriveMetrics` defaults it to England/NI — and such a document can still
  // reach FINAL, because it is not re-graded against a condition that post-dates
  // it. That combination is precisely how a credit paper ends up asserting an
  // assumption as a recorded fact, which is the defect this release exists to
  // remove. The claim is therefore qualified wherever it is not evidenced. The
  // two qualifiers are independent and both may apply: a jurisdiction can be
  // absent, and the basis can additionally be unconfirmed for the date's sake.
  const taxBasisQualifiers: string[] = [];
  if (!prov.jurisdictionRecorded) {
    taxBasisQualifiers.push('assumed; no jurisdiction recorded on this document');
  }
  if (!prov.taxBasisConfirmed) taxBasisQualifiers.push('basis unconfirmed');
  const taxBasisQualifier =
    taxBasisQualifiers.length === 0 ? '' : ` — ${taxBasisQualifiers.join('; ')}`;
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Field', 'Value']],
    body: [
      ['Appraisal ID', prov.appraisalId ?? 'unsaved — generated from an in-session run'],
      ['Project ID', prov.projectId || 'not recorded'],
      ['Scenario', `${prov.scenarioName} (${prov.scenarioId})`],
      ['Input schema version', `v${prov.inputsVersion}`],
      ['Calculation version', prov.calcVersion],
      ['Authoritative result hash', hashOrAbsent(prov.resultHash)],
      ['Input hash', hashOrAbsent(prov.inputHash)],
      ['Audit hash', hashOrAbsent(prov.auditHash)],
      ['Generated', formatGeneratedAt(prov.generatedAt, prov.timeZone)],
      ['Report-safe status', prov.reportSafe ? 'Report-safe — hard validations pass' : 'NOT report-safe — hard validations fail'],
      ['Document status', prov.documentStatus],
      ['Lender case', lenderCaseLabel(prov.lenderCaseStatus)],
      // Spec §14. Two figures the audit hash already commits to transitively
      // (jurisdiction through the inputs, table version through the metrics),
      // printed here so a reader can see the tax basis without re-running.
      ['Tax jurisdiction applied', `${JURISDICTION_LABEL[prov.jurisdiction]} (${tax.regime})${taxBasisQualifier}`],
      ['Acquisition tax table version', prov.taxTableVersion],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold' } },
  });
  y = lastAutoTableFinalY(doc) + 6;

  if (prov.recomputedSinceSave) {
    y = infoRequired(
      y,
      `Recomputed for this export under calculation version ${prov.calcVersion}; the stored result was produced under ${prov.storedCalcVersion}. The hashes above describe the stored result, not the figures printed here — re-save the appraisal to bring them back into agreement.`,
    );
  }

  // Spec §14. Three separate things can leave the acquisition tax basis needing
  // enquiry, and each asks for a different document, so none is folded into
  // another. They sit here rather than in the numbered Appendix B schedule
  // because they qualify the provenance panel immediately above them.
  //
  // Fix round 1: a pre-R8 document records no jurisdiction *at all*, so asking
  // it for "evidence of a recorded but unconfirmed jurisdiction" would misstate
  // what it is missing. The two cases are different requests and the branches
  // are exclusive: one asks for a jurisdiction, the other for evidence of one.
  if (!prov.jurisdictionRecorded) {
    y = infoRequired(
      y,
      `The property's jurisdiction. This document records none, so the acquisition tax above is charged as ${tax.regime} on an assumed ${JURISDICTION_LABEL[tax.jurisdiction]} property rather than an evidenced one. A different jurisdiction would charge a different regime and a different figure.`,
    );
  } else if (
    'jurisdiction_evidence_status' in inputs.acquisition
    && inputs.acquisition.jurisdiction_evidence_status === 'unconfirmed'
  ) {
    y = infoRequired(
      y,
      `Evidence of the property's jurisdiction. The acquisition tax above is charged as ${tax.regime} on the basis of a ${JURISDICTION_LABEL[tax.jurisdiction]} property, but that jurisdiction is recorded as unconfirmed. A different jurisdiction would charge a different regime and a different figure.`,
    );
  }
  if (tax.date_basis === 'assumed_current') {
    y = infoRequired(
      y,
      `The date of the transaction. With no date recorded, acquisition tax uses the ${tax.regime} band set currently in force (from ${formatBandDate(tax.band_set_effective_from)}) rather than the set in force on the transaction date, so re-running this appraisal after a change to the bands could return a different figure.`,
    );
  }
  if (tax.is_override) {
    y = infoRequired(
      y,
      `Supporting advice for the acquisition tax override. The printed figure of ${fmt(tax.total_pence)} was entered manually and replaces the band-derived figure of ${tax.computed_total_pence === null ? 'not recorded' : fmt(tax.computed_total_pence)}. Reason given: ${tax.override_reason === null || tax.override_reason.trim() === '' ? 'none recorded' : tax.override_reason}.`,
    );
  }

  y = captionText(
    y,
    'The audit hash is sha256 over project id, calculation version, input schema version, governance status, input hash and authoritative result hash, joined by "|" (spec §13.2). A reviewer holding this page can recompute it from the six fields above and detect any later alteration of them.',
  );
  y += 2;

  // ── Section 1: Executive Summary ──
  y = sectionTitle(y, 1, 'Executive Summary');

  const fundingLabel =
    inputs.finance.funding_source === 'cash'
      ? 'Cash'
      : inputs.finance.funding_source === 'bridging'
        ? 'Bridging loan'
        : 'Development finance';

  y = bodyText(
    y,
    `This memorandum presents the investment case for the acquisition and conversion of ${project.address_raw} from ${project.use_class.replace(/_/g, ' ')} use to ${unitCount} residential unit${unitCount !== 1 ? 's' : ''} under Permitted Development Rights.`,
  );

  y = subHeading(y, 'The Ask');
  y = bodyText(
    y,
    `Total development cost is ${fmt(metrics.total_development_cost_pence)}, funded through ${fmt(metrics.equity_contributed_pence)} equity and peak senior debt of ${fmt(metrics.peak_debt_pence)} (${fundingLabel.toLowerCase()}), representing gross LTC of ${fmtPctSafe(metrics.gross_ltc_pct)}.`,
  );

  y = subHeading(y, 'Use of Funds');
  const tdcForShare = metrics.total_development_cost_pence;
  const shareOfTdc = (part: number) => (tdcForShare > 0 ? fmtPct((part / tdcForShare) * 100) : fmtPct(0));
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Category', 'Amount', '% of Total']],
    body: [
      ['Acquisition (inc. tax)', fmt(metrics.acquisition_cost_pence), shareOfTdc(metrics.acquisition_cost_pence)],
      ['Construction', fmt(metrics.construction_cost_pence), shareOfTdc(metrics.construction_cost_pence)],
      ['Professional Fees', fmt(metrics.professional_fees_pence), shareOfTdc(metrics.professional_fees_pence)],
      ['Statutory Costs', fmt(metrics.statutory_costs_pence), shareOfTdc(metrics.statutory_costs_pence)],
      ['Selling Costs', fmt(metrics.selling_costs_pence), shareOfTdc(metrics.selling_costs_pence)],
      ['Finance Costs', fmt(metrics.finance_costs_pence), shareOfTdc(metrics.finance_costs_pence)],
      ['Total', fmt(metrics.total_development_cost_pence), '100.0%'],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  });
  y = lastAutoTableFinalY(doc) + 8;

  y = subHeading(y, 'Headline Returns');
  y = bodyText(
    y,
    `GDV of ${fmt(metrics.gdv_pence)} against total development cost of ${fmt(metrics.total_development_cost_pence)} generates a profit of ${fmt(metrics.profit_pence)}${metrics.profit_is_unrealised ? ' (unrealised — subject to refinance/valuation)' : ''}, equating to ${fmtPctSafe(metrics.profit_on_cost_pct)} profit on cost and ${fmtPctSafe(metrics.profit_on_gdv_pct)} profit on GDV. Annualised IRR is ${fmtPctSafe(metrics.irr_annual_pct, 'not available (no sign change in equity flows)')}, with ${metrics.return_on_equity_is_unrealised ? 'an unrealised' : 'a'} return on equity of ${fmtPctSafe(metrics.return_on_equity_pct)} over a ${inputs.finance.term_months}-month programme.${metrics.return_on_equity_is_unrealised ? ' That return on equity is an accounting return on the value created, not cash distributed to equity: it is stated before any realisation event and must not be read as a distributed return.' : ''}`,
  );

  y = subHeading(y, 'Exit');
  const exitLabel =
    inputs.exit_strategy.route === 'sell_all'
      ? 'Sale of all units on the open market'
      : inputs.exit_strategy.route === 'retain_all'
        ? 'Retention of all units as buy-to-let investments'
        : 'Blended exit — partial sale and partial retention';
  y = bodyText(y, `Primary exit: ${exitLabel}.`);

  // ── Section 2: The Opportunity ──
  y = sectionTitle(y, 2, 'The Opportunity');
  y = bodyText(
    y,
    `The property at ${project.address_raw} is a ${project.use_class.replace(/_/g, ' ')} premises being offered at ${fmt(project.price_pence)}${project.price_qualifier ? ` (${project.price_qualifier})` : ''}. The building comprises ${project.floors ?? '—'} storey${(project.floors ?? 0) > 1 ? 's' : ''} with a gross floor area of approximately ${project.floor_area_sqm?.toLocaleString() ?? '—'} m² (${project.floor_area_sqft?.toLocaleString() ?? '—'} sq ft).`,
  );
  y = bodyText(
    y,
    `Tenure is ${project.tenure}${project.lease_years_remaining ? ` with ${project.lease_years_remaining} years remaining` : ''}. EPC rating: ${project.epc_rating ?? 'Unknown'}. Vacancy status: ${project.is_vacant === true ? 'Vacant' : project.is_vacant === false ? 'Occupied' : 'Unknown'}.`,
  );
  if (project.description) {
    // Legacy scraped records glued the listing's "Description" heading to the
    // first sentence; the scraper is fixed, this repairs what is already stored.
    y = bodyText(y, repairGluedDescription(project.description));
  }
  y = infoRequired(y, 'Market rationale — why this asset, why now, demand drivers');

  // ── Section 3: The Scheme ──
  y = sectionTitle(y, 3, 'The Scheme');

  y = subHeading(y, 'Description');
  y = bodyText(
    y,
    `Conversion of existing ${project.use_class.replace(/_/g, ' ')} premises to ${unitCount} residential unit${unitCount !== 1 ? 's' : ''} comprising a total of ${totalSqm.toLocaleString()} m² (${totalSqft.toLocaleString()} sq ft) net internal area.`,
  );

  y = subHeading(y, 'Proposed Unit Mix');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Unit', 'Type', 'NIA (m²)', 'NIA (sq ft)', 'Balcony/Terrace (m²)', 'Parking (spaces)', 'Est. Value', '£/sq ft', 'Notes']],
    body: inputs.unit_mix.units.map((u, i) => [
      `${i + 1}`,
      unitLabel(u.type),
      u.floor_area_sqm.toLocaleString(),
      sqmToSqft(u.floor_area_sqm).toLocaleString(),
      unitAncillaryOf(u).balcony_terrace_sqm.toLocaleString(),
      unitAncillaryOf(u).parking_spaces.toLocaleString(),
      fmt(u.estimated_value_pence),
      perSqftPence(u.estimated_value_pence, u.floor_area_sqm),
      u.comparable_notes || '—',
    ]),
    foot: [[
      '',
      `${unitCount} units`,
      totalSqm.toLocaleString(),
      totalSqft.toLocaleString(),
      '',
      '',
      fmt(metrics.gdv_pence),
      perSqftPence(metrics.gdv_pence, totalSqm),
      '',
    ]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    footStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
  });
  y = lastAutoTableFinalY(doc) + 6;

  // ── Area Schedule (R9, spec §15) ──────────────────────────────────────────
  //
  // Rows mirror AreasPage's own reconciliation table exactly (same labels,
  // same sign convention: a "less X" row is passed in already negative). The
  // caption states which number priced the works in words, because a reader
  // who cannot tell that is a reader who might price the works off the wrong
  // figure (spec §15.3/§15.4).
  y = subHeading(y, 'Area Schedule');
  y = captionText(
    y,
    bridge.basis === 'bridge_derived'
      ? 'Construction area derived from the area schedule.'
      : 'Construction area entered manually; the area schedule below is recorded but does not price the works.',
  );

  const AREA_SCHEDULE_TOTAL_ROWS = new Set([
    'Proposed GIA', 'Developed area', 'Available for units', 'Unallocated',
  ]);
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Area Reconciliation', 'm²']],
    body: ([
      ['Existing GIA', bridge.existing_gia_sqm],
      ['less demolished', -bridge.demolished_gia_sqm],
      ['plus extension', bridge.extension_gia_sqm],
      ['Proposed GIA', bridge.proposed_gia_sqm],
      ['less retained commercial', -bridge.retained_commercial_gia_sqm],
      ['less untouched', -bridge.untouched_gia_sqm],
      ['Developed area', bridge.developed_gia_sqm],
      ['less circulation', -bridge.circulation_common_sqm],
      ['less plant', -bridge.plant_riser_sqm],
      ['less storage', -bridge.store_bin_cycle_sqm],
      ['less amenity', -bridge.amenity_sqm],
      ['Available for units', bridge.available_for_units_sqm],
      ['less unit NIA', -bridge.unit_nia_sqm],
      ['Unallocated', bridge.unallocated_sqm],
    ] as Array<[string, number]>).map(([label, value]) => [label, value.toFixed(1)]),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell(data) {
      if (data.section === 'body' && AREA_SCHEDULE_TOTAL_ROWS.has(String(data.cell.raw))) {
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = lastAutoTableFinalY(doc) + 4;

  y = subHeading(y, 'Area Efficiencies');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Efficiency', 'Ratio']],
    // A null ratio (zero denominator) prints as an em dash, never as 0% — a
    // printed 0% would assert a figure the engine explicitly declined to
    // produce (spec §15.2).
    body: [
      ['Net to gross', fmtPctSafe(bridge.nia_to_gia_pct, '—')],
      ['NIA to proposed GIA', fmtPctSafe(bridge.nia_to_proposed_gia_pct, '—')],
      ['Saleable to developed', fmtPctSafe(bridge.saleable_to_developed_pct, '—')],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: { 1: { halign: 'right' } },
  });
  y = lastAutoTableFinalY(doc) + 4;

  // Disclosure, not a schedule that merely appears to tie (spec §15.7): a
  // zeroed bridge (basis manual, nothing entered) is guarded out here exactly
  // as it is in validateInputs — a real unit schedule must not be judged
  // against a "0 m² building" nobody is reconciling against.
  if (bridge.developed_gia_sqm > 0 && bridge.unallocated_sqm > bridge.developed_gia_sqm * 0.10) {
    y = captionText(
      y,
      `${bridge.unallocated_sqm.toFixed(1)} m² of the developed area is unallocated — `
      + 'see the area schedule above.',
    );
  }

  y = subHeading(y, 'Planning Position');
  if (eligibility) {
    const pdrLabel = eligibility.pdr_class.replace(/_/g, ' ').toUpperCase();
    y = bodyText(
      y,
      `Eligible for conversion under ${pdrLabel}. Eligibility verdict: ${eligibility.verdict.toUpperCase()}.`,
    );
    const failedCriteria = eligibility.criteria.filter((c) => c.passed === false);
    const pendingCriteria = eligibility.criteria.filter((c) => c.passed === null);
    if (failedCriteria.length > 0) {
      y = bodyText(
        y,
        `Failed criteria: ${failedCriteria.map((c) => c.label).join('; ')}.`,
      );
    }
    if (pendingCriteria.length > 0) {
      y = bodyText(
        y,
        `Pending verification: ${pendingCriteria.map((c) => c.label).join('; ')}.`,
      );
    }
  } else {
    y = infoRequired(y, 'Planning status, permission reference, conditions outstanding');
  }
  y = infoRequired(y, 'Design and specification status, procurement route, contractor');

  // ── Section 4: Market Evidence ──
  y = sectionTitle(y, 4, 'Market Evidence');
  y = bodyText(
    y,
    'Comparable evidence should support the revenue assumptions adopted in the appraisal. Each comparable is listed below with address, transaction date, size, achieved £/sq ft, and source.',
  );

  const compsWithNotes = inputs.unit_mix.units.filter((u) => u.comparable_notes);
  if (compsWithNotes.length > 0) {
    y = subHeading(y, 'Comparable Notes from Unit Schedule');
    for (const u of compsWithNotes) {
      y = bodyText(
        y,
        `${unitLabel(u.type)} (${u.floor_area_sqm} m²) at ${fmt(u.estimated_value_pence)} — ${u.comparable_notes}`,
      );
    }
  }

  y = infoRequired(
    y,
    'Full comparable table: address, date, size (sq ft), £/sq ft, source for each transaction',
  );
  y = infoRequired(y, 'Absorption rates, demand drivers, local market commentary');

  // ── Section 5: Development Appraisal ──
  y = sectionTitle(y, 5, 'Development Appraisal');

  y = subHeading(y, 'Revenue');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Item', 'Amount']],
    body: [
      ['Gross Development Value (GDV)', fmt(metrics.gdv_pence)],
      // R9 (spec §3.1): the total split into its two components. `gdv_pence`
      // above remains the sum of both — neither figure below is computed
      // here, both are read straight off the run.
      ['  Internal saleable value', fmt(metrics.gdv_internal_pence)],
      ['  Parking, balconies and terraces', fmt(metrics.gdv_ancillary_pence)],
      ['Blended £/sq ft', perSqftPence(metrics.gdv_pence, totalSqm)],
      [
        'Lender-Underwritten GDV',
        metrics.lender_gdv_pence === null ? 'not available — no lender valuation recorded' : fmt(metrics.lender_gdv_pence),
      ],
      [
        'Variance vs Developer GDV',
        metrics.lender_gdv_variance_pence === null
          ? 'not available — no lender valuation recorded'
          : `${fmt(metrics.lender_gdv_variance_pence)} (${fmtPctSafe(metrics.lender_gdv_variance_pct)})`,
      ],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: { 1: { halign: 'right' } },
  });
  y = lastAutoTableFinalY(doc) + 4;
  // Provenance line (spec §3.2: the lender GDV variance is displayed with reason/author/date)
  // — only ever shown alongside a lender valuation that actually produced a computable GDV.
  if (metrics.lender_gdv_pence !== null && lenderValuation != null) {
    y = bodyText(y, `Lender valuation basis: ${lenderValuation.reason} — ${lenderValuation.author}, ${fmtDate(lenderValuation.date)}.`);
  }

  // Release 3b (Task 13) provenance lines — one each for the three v4-only
  // blocks, printed unconditionally (unlike the lender-valuation line above,
  // which only appears when a lender valuation actually produced a GDV).
  y = bodyText(
    y,
    programme != null
      ? `Programme: explicit${anchor != null ? ` (anchored ${anchor})` : ' (no calendar anchor)'}.`
      : 'Programme: auto-derived from term (spec §6).',
  );
  y = bodyText(
    y,
    salesPhasing != null
      ? `Sales phasing: ${salesPhasing.tranches.length} tranches (months ${salesPhasing.tranches.map((t) => monthLabel(t.month_offset)).join(', ')}).`
      : schedule.totals.gross_sales_pence > 0
        ? 'Sales phasing: single disposal in final month.'
        : 'Sales phasing: not applicable — no units sold.',
  );
  y = bodyText(
    y,
    refinance != null && schedule.refinance != null
      ? `Refinance: modelled (${monthLabel(schedule.refinance.month)}).`
      : 'Refinance: not modelled.',
  );
  y += 2;

  // R7: "Cost Plan" overstated what this section is. Until the detailed QS
  // package mode lands (R10) the model is a rate x area headline estimate with
  // named allowances, and a lender reading "cost plan" would reasonably expect
  // a priced package schedule behind it.
  y = subHeading(y, 'Headline Cost Estimate');
  // Every row below is either a raw stored input (rate, area, fixed fee) or an
  // engine-computed total from run.metrics / run.model.totals — no cost or fee
  // amount is derived here (spec §11.9).
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Element', 'Amount', '£/sq ft']],
    body: [
      ['ACQUISITION', '', ''],
      ['  Purchase price', fmt(inputs.acquisition.purchase_price_pence), perSqftPence(inputs.acquisition.purchase_price_pence, totalSqm)],
      ['  Acquisition tax', fmt(metrics.acquisition_tax_pence), perSqftPence(metrics.acquisition_tax_pence, totalSqm)],
      ['  Legal fees', fmt(inputs.acquisition.legal_fees_pence), ''],
      ['  Survey', fmt(inputs.acquisition.survey_cost_pence), ''],
      [`  Broker fee rate`, fmtPct(inputs.acquisition.broker_fee_pct), ''],
      ['  Other acquisition costs', fmt(inputs.acquisition.other_acquisition_costs_pence), ''],
      ['  Sub-total acquisition (inc. tax, fees)', fmt(metrics.acquisition_cost_pence), perSqftPence(metrics.acquisition_cost_pence, totalSqm)],
      ['', '', ''],
      ['CONSTRUCTION', '', ''],
      ['  Build rate', `${fmt(inputs.conversion_costs.construction_cost_per_sqm_pence)}/m²`, ''],
      [`  Contingency rate`, fmtPct(inputs.conversion_costs.contingency_pct), ''],
      ['  Fire safety', fmt(inputs.conversion_costs.fire_safety_pence), ''],
      ['  Sound insulation', fmt(inputs.conversion_costs.sound_insulation_pence), ''],
      ['  Part L compliance', fmt(inputs.conversion_costs.part_l_compliance_pence), ''],
      ['  Sub-total construction (inc. contingency)', fmt(metrics.construction_cost_pence), perSqftPence(metrics.construction_cost_pence, totalSqm)],
      ['', '', ''],
      ['PROFESSIONAL FEES', '', ''],
      ['  Architect', fmt(inputs.conversion_costs.architect_pence), ''],
      ['  Structural engineer', fmt(inputs.conversion_costs.structural_engineer_pence), ''],
      ['  M&E', fmt(inputs.conversion_costs.mande_pence), ''],
      ['  Planning consultant', fmt(inputs.conversion_costs.planning_consultant_pence), ''],
      ['  Other professional fees', fmt(inputs.conversion_costs.other_professional_fees_pence), ''],
      ['  Sub-total professional fees', fmt(metrics.professional_fees_pence), perSqftPence(metrics.professional_fees_pence, totalSqm)],
      ['', '', ''],
      ['STATUTORY COSTS', '', ''],
      ['  Prior approval fee per dwelling', fmt(inputs.conversion_costs.prior_approval_fee_per_dwelling_pence), ''],
      ['  CIL / S106', fmt(inputs.conversion_costs.cil_s106_pence), ''],
      ['  Building control', fmt(inputs.conversion_costs.building_control_pence), ''],
      ['  Sub-total statutory costs', fmt(metrics.statutory_costs_pence), perSqftPence(metrics.statutory_costs_pence, totalSqm)],
      ['', '', ''],
      ['FINANCE COSTS', '', ''],
      [`  Arrangement fee (${fmtPct(inputs.finance.arrangement_fee_pct)} of ${inputs.finance.arrangement_fee_basis.replace(/_/g, ' ')})`, fmt(model.totals.arrangement_fee_pence), ''],
      [`  Exit fee (${fmtPct(inputs.finance.exit_fee_pct)} of ${inputs.finance.exit_fee_basis.replace(/_/g, ' ')})`, fmt(model.totals.exit_fee_pence), ''],
      [`  Interest (${fmtPct(inputs.finance.annual_interest_rate_pct)} p.a., ${inputs.finance.term_months} months)`, fmt(model.totals.interest_pence), ''],
      ['  Ancillary lender fees', fmt(model.totals.ancillary_fees_pence), ''],
      ['  Sub-total finance costs', fmt(metrics.finance_costs_pence), ''],
      ['', '', ''],
      ['TOTAL DEVELOPMENT COST', fmt(metrics.total_development_cost_pence), perSqftPence(metrics.total_development_cost_pence, totalSqm)],
    ],
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
    didParseCell(data) {
      const text = String(data.cell.raw);
      if (
        text.startsWith('ACQUISITION') ||
        text.startsWith('CONSTRUCTION') ||
        text.startsWith('PROFESSIONAL') ||
        text.startsWith('STATUTORY') ||
        text.startsWith('FINANCE') ||
        text.startsWith('TOTAL')
      ) {
        data.cell.styles.fontStyle = 'bold';
      }
      if (text.includes('Sub-total') || text.startsWith('TOTAL')) {
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = lastAutoTableFinalY(doc) + 6;

  y = subHeading(y, 'Appraisal Metrics');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Gross Development Value', fmt(metrics.gdv_pence)],
      ['Total Development Cost', fmt(metrics.total_development_cost_pence)],
      [`Developer Profit${metrics.profit_is_unrealised ? ' (unrealised)' : ''}`, fmt(metrics.profit_pence)],
      ['Profit on Cost', fmtPctSafe(metrics.profit_on_cost_pct)],
      ['Profit on GDV', fmtPctSafe(metrics.profit_on_gdv_pct)],
      [roeLabel, fmtPctSafe(metrics.return_on_equity_pct)],
      ['Equity Multiple', equityMultipleValue],
      ['IRR (Annual)', irrValue],
      [`Residual Land Value (at ${fmtPct(inputs.deal_spider.target_profit_on_cost_pct)} target profit on cost)`, fmt(metrics.rlv_pence)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = lastAutoTableFinalY(doc) + 6;

  y = subHeading(y, 'Residual Land Value Check');
  const rlvDiff = metrics.rlv_pence - inputs.acquisition.purchase_price_pence;
  const rlvHeadroom = inputs.acquisition.purchase_price_pence > 0
    ? (rlvDiff / inputs.acquisition.purchase_price_pence) * 100
    : 0;
  y = bodyText(
    y,
    `At the deal spider's configured target profit on cost of ${fmtPct(inputs.deal_spider.target_profit_on_cost_pct)}, the residual land value is ${fmt(metrics.rlv_pence)}. The purchase price of ${fmt(inputs.acquisition.purchase_price_pence)} is ${rlvDiff >= 0 ? `${fmt(Math.abs(rlvDiff))} below` : `${fmt(Math.abs(rlvDiff))} above`} the RLV, representing ${rlvDiff >= 0 ? 'positive' : 'negative'} headroom of ${fmtPct(Math.abs(rlvHeadroom))}. This RLV uses the appraisal's own finance and acquisition tax (spec §3.18) — it is not re-solved for the residual price.`,
  );

  // ── Section 6: Programme ──
  y = sectionTitle(y, 6, 'Programme');

  y = subHeading(y, 'Timeline');
  if (programme != null) {
    // Explicit dated programme (spec §6.1) — one row per package, straight from
    // the recorded input windows; Start/Finish are display-only calendar labels.
    const pkgRows: string[][] = (['construction', 'professional', 'statutory'] as const).map((key) => {
      const p = programme.packages[key];
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      return [label, monthLabel(p.start_offset), monthLabel(p.start_offset + p.duration_months - 1), p.curve.kind];
    });
    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Package', 'Start', 'Finish', 'Curve']],
      body: pkgRows,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
    });
    y = lastAutoTableFinalY(doc) + 6;
  }
  y = bodyText(
    y,
    // With a calendar anchor the peak-debt month reads as a date, matching the
    // dated tables in this section and the calculator's own tiles. Without one
    // the original 1-based prose is kept: re-basing the number under a labelling
    // change would alter what this document states the peak-debt month is.
    `Total programme: ${inputs.finance.term_months} months. Peak senior debt of ${fmt(metrics.peak_debt_pence)} is reached in ${
      metrics.peak_debt_month === null
        ? 'month —'
        : anchor != null
          ? monthLabel(metrics.peak_debt_month)
          : `month ${metrics.peak_debt_month + 1}`
    } of the programme. Total interest cost: ${fmt(model.totals.interest_pence)}.`,
  );
  if (programme == null) {
    y = infoRequired(y, 'Key dates — start on site, practical completion, sales/letting period');
    y = infoRequired(y, 'Critical path, long-lead items');
  } else if (anchor == null) {
    // An explicit programme IS the dated programme (the package table above
    // replaces the two gap markers) — only the calendar anchor is still missing.
    y = infoRequired(y, 'Programme anchor month (calendar dates)');
  }

  y = subHeading(y, 'Monthly Cashflow');
  const cfHasRefi = model.months.some((m) => m.refinance_proceeds_pence > 0);
  let cumDraw = 0;
  let cumEquityCf = 0;
  const cfRows = model.months.map((m, i) => {
    cumDraw += m.draw_pence;
    cumEquityCf += model.equity_cashflows_pence[i] ?? 0;
    return [
      monthLabel(m.month),
      fmt(m.draw_pence),
      fmt(cumDraw),
      fmt(m.interest_accrued_pence),
      fmt(m.closing_balance_pence),
      fmt(m.gross_receipts_pence),
      ...(cfHasRefi ? [fmt(m.refinance_proceeds_pence)] : []),
      fmt(model.equity_cashflows_pence[i] ?? 0),
      fmt(cumEquityCf),
    ];
  });
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Month', 'Draw', 'Cum. Draw', 'Interest', 'Closing Bal.', 'Receipts',
      ...(cfHasRefi ? ['Refi'] : []), 'Equity CF', 'Cum. Equity CF']],
    body: cfRows,
    styles: { fontSize: 7, cellPadding: 1.5, halign: 'right' },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 7 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { cellWidth: 18, halign: 'left' },
    },
  });
  y = lastAutoTableFinalY(doc) + 8;

  y = subHeading(y, 'Cost to Complete');
  if (metrics.cost_to_complete === null) {
    y = bodyText(y, 'Cost to complete: not available.');
  } else {
    const ctc = metrics.cost_to_complete;
    // `CostToCompleteSummary.months[].month` (and `first_shortfall_month`) is already 1-indexed
    // (cost-to-complete.ts: labels run `m = 1..term`) — unlike `model.months` in the Monthly
    // Cashflow table above, which is 0-indexed ledger months and genuinely needs `+ 1` for
    // display. No `+ 1` here: the UI's CostToCompleteCard renders these raw, and the PDF must
    // match it and the underlying data exactly.
    y = bodyText(
      y,
      `First funding shortfall: ${ctc.first_shortfall_month !== null ? `month ${ctc.first_shortfall_month}` : 'none — fully funded throughout'}. Maximum shortfall: ${fmt(ctc.max_shortfall_pence)}.`,
    );
    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Month', 'Remaining Cost', 'Remaining Funding', 'Surplus']],
      body: ctc.months.map((m) => [
        `Month ${m.month}`,
        fmt(m.remaining_cost_pence),
        fmt(m.remaining_funding_pence),
        fmt(m.surplus_pence),
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 7 },
      bodyStyles: { textColor: [51, 65, 85] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: {
        0: { cellWidth: 18 },
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
      didParseCell(data) {
        if (data.column.index === 3 && data.section === 'body') {
          const raw = ctc.months[data.row.index]?.surplus_pence;
          if (raw != null && raw < 0) data.cell.styles.textColor = [220, 38, 38];
        }
      },
    });
    y = lastAutoTableFinalY(doc) + 8;
  }

  // ── Section 7: Funding Request ──
  y = sectionTitle(y, 7, 'Funding Request');

  y = subHeading(y, 'Sources & Uses');
  const { usesTotal, sourcesTotal, rolledInterestPence } = sourcesAndUsesTotals(run);
  const usesRows: Array<[string, number]> = [
    ['Acquisition (inc. tax)', metrics.acquisition_cost_pence],
    ['Construction', metrics.construction_cost_pence],
    ['Professional fees', metrics.professional_fees_pence],
    ['Statutory costs', metrics.statutory_costs_pence],
    ['Selling costs', metrics.selling_costs_pence],
    ['Finance costs', metrics.finance_costs_pence],
  ];
  const sourcesRows: Array<[string, number]> = [
    ['Equity contributed', model.totals.equity_contributed_pence],
    // IMPORTANT 2: netted against refinance_shortfall_equity_pence, exactly as
    // sourcesAndUsesTotals() nets it out of sourcesTotal above (spec §7) — the
    // full, un-netted additional_equity_pence would make this row's printed
    // value disagree with the printed "Total" row whenever a refinance
    // shortfall is present.
    ['Additional equity required', model.totals.additional_equity_pence - model.totals.refinance_shortfall_equity_pence],
    ['Funding gap (unfunded)', model.totals.funding_gap_pence],
    ['Senior debt draws', model.totals.draws_pence],
    ['Capitalised lender fees', model.totals.capitalised_fees_pence],
    ['Rolled-up interest', rolledInterestPence],
    ['Proceeds applied — selling costs', schedule.totals.selling_costs_pence],
    ['Proceeds applied — exit fee', model.totals.exit_fee_pence],
  ];
  const suRowCount = Math.max(usesRows.length, sourcesRows.length);
  const suBody: string[][] = [];
  for (let i = 0; i < suRowCount; i++) {
    const s = sourcesRows[i];
    const u = usesRows[i];
    suBody.push([
      s ? s[0] : '',
      s ? fmt(s[1]) : '',
      '',
      u ? u[0] : '',
      u ? fmt(u[1]) : '',
    ]);
  }
  suBody.push(['Total', fmt(sourcesTotal), '', 'Total', fmt(usesTotal)]);

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Sources', 'Amount', '', 'Uses', 'Amount']],
    body: suBody,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      1: { halign: 'right' },
      2: { cellWidth: 5 },
      4: { halign: 'right' },
    },
    didParseCell(data) {
      const text = String(data.cell.raw);
      if (text === 'Total') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });
  y = lastAutoTableFinalY(doc) + 4;
  y = bodyText(
    y,
    `Sources and uses both total ${fmt(sourcesTotal)} (spec §7 invariant: sum of sources = sum of uses).${!run.reconciliation.sources_equal_uses ? ' WARNING: this run does not reconcile — see the draft watermark and the reconciliation panel.' : ''}`,
  );
  if (model.totals.refinance_shortfall_equity_pence > 0) {
    y = bodyText(
      y,
      `Additional equity of ${fmt(model.totals.refinance_shortfall_equity_pence)} absorbed by the refinance event is a financing-side flow, excluded from this reconciliation (spec §7).`,
    );
  }

  y = subHeading(y, 'Key Lending Metrics');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Peak senior debt', fmt(metrics.peak_debt_pence)],
      ['Net LTC (excl. finance)', fmtPctSafe(metrics.net_ltc_pct)],
      ['Gross LTC (incl. finance)', fmtPctSafe(metrics.gross_ltc_pct)],
      ['LTGDV (developer basis)', fmtPctSafe(metrics.ltgdv_developer_pct)],
      [
        'LTGDV (lender basis)',
        metrics.ltgdv_lender_pct === null ? 'not available — no lender valuation recorded' : fmtPct(metrics.ltgdv_lender_pct),
      ],
      ['Facility headroom (gross)', metrics.facility_headroom_pence === null ? 'not available — no facility' : fmt(metrics.facility_headroom_pence)],
      // Floored at reporting per spec §4 ("interest_reserve_remaining ... floored at
      // reporting, exhaustion is flagged, not hidden") — AppraisalSummaryPage applies
      // the same Math.max(0, …) floor; the underlying model.flags still carries
      // interest_reserve_exhausted (spec §4) so exhaustion is never hidden by the floor.
      ['Interest reserve remaining', metrics.interest_reserve_remaining_pence === null ? 'n/a' : fmt(Math.max(0, metrics.interest_reserve_remaining_pence))],
      ['Interest rate', `${fmtPct(inputs.finance.annual_interest_rate_pct)} p.a.`],
      ['Interest type', inputs.finance.interest_type === 'rolled_up' ? 'Rolled up' : 'Serviced'],
      ['Facility term', `${inputs.finance.term_months} months`],
      ['Senior repayment break-even (price)', metrics.senior_breakeven_pence === null ? 'not available' : fmt(metrics.senior_breakeven_pence)],
      ['Senior break-even, % of lender GDV', fmtPctSafe(metrics.senior_breakeven_pct_of_lender_gdv)],
      ['Senior break-even, fall from lender GDV', fmtPctSafe(metrics.senior_breakeven_fall_from_lender_gdv_pct)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = lastAutoTableFinalY(doc) + 4;
  y = bodyText(
    y,
    'Net LTC = cumulative net senior advances (principal draws + capitalised non-interest fees) ÷ development cost before disposal and finance (spec §5.4). Gross LTC = peak gross senior debt ÷ total development cost, TDC (spec §5.5). LTGDV = peak gross senior debt ÷ GDV [developer basis], or ÷ lender-underwritten GDV [lender basis, not available until a lender valuation is recorded]. Senior repayment break-even (spec §5.11) = minimum gross sale price fully redeeming the senior facility, including the disclosed enforcement-cost assumption of ' + fmt(inputs.finance.enforcement_cost_assumption_pence) + '.',
  );
  if (metrics.senior_breakeven_pence !== null && lenderValuation != null) {
    y = bodyText(y, `Senior break-even percentages are measured against the lender valuation: ${lenderValuation.reason} — ${lenderValuation.author}, ${fmtDate(lenderValuation.date)}.`);
  }

  y = infoRequired(y, 'Security package — first charge, debenture, personal guarantees');
  y = infoRequired(y, 'Drawdown profile, priority of repayment');

  // ── Section 8: Returns ──
  y = sectionTitle(y, 8, 'Returns');

  y = subHeading(y, 'Investor Returns');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Internal Rate of Return (IRR, annual)', irrValue],
      ['Equity Multiple', equityMultipleValue],
      [roeLabel, fmtPctSafe(metrics.return_on_equity_pct)],
      ['Profit on Cost', fmtPctSafe(metrics.profit_on_cost_pct)],
      ['Profit on GDV', fmtPctSafe(metrics.profit_on_gdv_pct)],
      ['Hold Period', `${inputs.finance.term_months} months`],
      [`Total Profit${metrics.profit_is_unrealised ? ' (unrealised)' : ''}`, fmt(metrics.profit_pence)],
      [
        'Developer profit break-even (price)',
        metrics.developer_breakeven_pence === null ? 'not available — no disposal to solve for' : fmt(metrics.developer_breakeven_pence),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = lastAutoTableFinalY(doc) + 4;
  y = bodyText(
    y,
    'Developer profit break-even (spec §5.12) = minimum gross sale price covering total development cost excluding selling costs (re-solved at that price) — lender- and debt-independent; distinct from the senior repayment break-even above.',
  );

  y = infoRequired(y, 'Waterfall / promote structure (if JV)');

  y = subHeading(y, 'Lender Position — Day-one LTV');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Day-one senior advance', fmt(metrics.day_one_advance_pence)],
      ['Day-one LTV (vs purchase price)', fmtPctSafe(metrics.day_one_ltv_on_price_pct)],
      [
        'Day-one LTV (vs day-one market value)',
        metrics.day_one_ltv_on_value_pct === null
          ? 'not available — no day-one market value provided'
          : fmtPct(metrics.day_one_ltv_on_value_pct),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = lastAutoTableFinalY(doc) + 4;
  y = bodyText(
    y,
    'Day-one LTV = the actual month-0 senior advance (not the committed facility) ÷ purchase price, or ÷ day-one market value where provided (spec §5.1). Dividing the total committed facility by purchase price is not a valid day-one LTV and is never reported.',
  );

  // ── Section 9: Risk Register ──
  y = sectionTitle(y, 9, 'Risk Register');

  if (inputs.risks.length > 0) {
    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['#', 'Risk', 'Likelihood', 'Impact', 'Mitigation']],
      body: inputs.risks.map((r, i) => [
        `${i + 1}`,
        r.description || '—',
        r.likelihood.charAt(0).toUpperCase() + r.likelihood.slice(1),
        r.impact.charAt(0).toUpperCase() + r.impact.slice(1),
        r.mitigation || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { cellWidth: 45 },
        2: { cellWidth: 22 },
        3: { cellWidth: 22 },
      },
      didParseCell(data) {
        if (data.section === 'body') {
          const val = String(data.cell.raw).toLowerCase();
          if (data.column.index === 2 || data.column.index === 3) {
            if (val === 'high') data.cell.styles.textColor = [220, 38, 38];
            else if (val === 'medium') data.cell.styles.textColor = [217, 119, 6];
            else data.cell.styles.textColor = [22, 163, 74];
          }
        }
      },
    });
    y = lastAutoTableFinalY(doc) + 6;
  } else {
    y = infoRequired(y, 'Risk register — no risks have been entered in the calculator');
  }

  y = bodyText(
    y,
    'The risk register should cover: planning risk, cost inflation, contractor insolvency, ground conditions / existing structure, MEES/EPC compliance, building safety (Gateway 2/3 where applicable), sales rate, interest rate, and exit liquidity.',
  );

  const missingRiskCategories = [
    'planning', 'cost inflation', 'contractor insolvency', 'ground conditions',
    'MEES/EPC', 'building safety', 'sales rate', 'interest rate', 'exit liquidity',
  ];
  const enteredDescriptions = inputs.risks.map((r) => r.description.toLowerCase());
  const missing = missingRiskCategories.filter(
    (cat) => !enteredDescriptions.some((d) => d.includes(cat.toLowerCase())),
  );
  if (missing.length > 0) {
    y = infoRequired(y, `Risks not yet addressed: ${missing.join(', ')}`);
  }

  // ── Section 10: Sensitivity & Downside ──
  y = sectionTitle(y, 10, 'Sensitivity & Downside');
  y = bodyText(
    y,
    'Every scenario below re-runs the full appraisal engine (runAppraisal) against adjusted GDV/cost/timeline/rate assumptions with the committed facility and equity sources held fixed — debt is never re-sized inside a scenario (spec §11.8). FE = facility exceeded, FG = funding gap, NR = senior debt not repaid within the modelled term.',
  );

  y = subHeading(y, 'Scenario Comparison');
  const scenarioKeys = ['base', 'upside', 'downside'] as const;
  const scenarioRuns = scenarioKeys.map((key) => {
    const overrides = inputs.scenarios[key];
    return { label: overrides.label, overrides, run: runAppraisal(applyScenario(inputs, overrides)) };
  });

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Metric', ...scenarioRuns.map((s) => s.label)]],
    body: [
      ['GDV adjustment', ...scenarioRuns.map((s) => `${s.overrides.gdv_adjustment_pct >= 0 ? '+' : ''}${s.overrides.gdv_adjustment_pct}%`)],
      ['Cost adjustment', ...scenarioRuns.map((s) => `${s.overrides.construction_cost_adjustment_pct >= 0 ? '+' : ''}${s.overrides.construction_cost_adjustment_pct}%`)],
      ['GDV', ...scenarioRuns.map((s) => fmt(s.run.metrics.gdv_pence))],
      ['Total Development Cost', ...scenarioRuns.map((s) => fmt(s.run.metrics.total_development_cost_pence))],
      ['Profit', ...scenarioRuns.map((s) => fmt(s.run.metrics.profit_pence))],
      ['Profit on Cost', ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.profit_on_cost_pct))],
      ['Profit on GDV', ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.profit_on_gdv_pct))],
      ['IRR (Annual)', ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.irr_annual_pct))],
      [roeLabel, ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.return_on_equity_pct))],
      ['Flags', ...scenarioRuns.map((s) => flagSummary(s.run.metrics.flags))],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });
  y = lastAutoTableFinalY(doc) + 8;

  // §12.7/§12.5: runSensitivity throws when the *base* document itself fails validation
  // — a saved appraisal can reach this function in that state (e.g.
  // `finance.equity_draw_rule: 'pari_passu'`, a migration state some historical
  // documents still carry). A ten-section memo should not vanish for one section's
  // sake: the DRAFT watermark already flags a document in this state
  // (`run.reconciliation.report_safe`), so §10 degrades rather than the whole export
  // failing.
  //
  // R6: that degradation answers exactly one condition, so it catches exactly one type.
  // Anything else thrown from the suite is a defect, and rendering a defect as an
  // orderly §12.7 omission in a lender-facing PDF is how a defect stays unfound —
  // it propagates instead. `InvalidSensitivityConfigError` (§12.6) is deliberately not
  // caught either: this memo only ever passes the fixed default config, so reaching it
  // would itself be a defect.
  let sens: MemoSensitivityTables | null = null;
  let sensitivityFailureMessage: string | null = null;
  try {
    sens = sensitivityTables(inputs);
  } catch (err) {
    if (!(err instanceof InvalidBaseDocumentError)) throw err;
    sensitivityFailureMessage = err.message;
  }

  if (sens) {
    y = subHeading(y, 'Single-Lever Sensitivity (Tornado)');
    y = bodyText(
      y,
      'Each lever is moved alone, with every other assumption at base. Swing is the absolute profit difference between the two endpoints; bars are listed widest swing first (spec §12.4).',
    );

    if (sens.tornadoRows.length > 0) {
      table({
        startY: y,
        margin: { left: MARGIN_L, right: MARGIN_R },
        head: [['Lever', 'Range', 'Profit at low', 'Profit at high', 'Swing']],
        body: sens.tornadoRows,
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [30, 58, 95], textColor: 255 },
        bodyStyles: { textColor: [51, 65, 85] },
        alternateRowStyles: { fillColor: [241, 245, 249] },
        columnStyles: {
          0: { fontStyle: 'bold' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold' },
        },
      });
      y = lastAutoTableFinalY(doc) + 4;
    }
    // A bar is omitted rather than printed when the engine could not measure one of
    // its endpoints — the levered document failed validation (spec §12.7). Each
    // sentence in `omittedTornadoNotes` already carries the engine's own reason for
    // that specific endpoint (built in sensitivityTables()); this only joins them so
    // the omission is stated rather than silent. If every bar were omitted, this line
    // prints alone with no table above it (see sens.tornadoRows.length guard above)
    // rather than an empty or misleadingly-partial table.
    if (sens.omittedTornadoNotes.length > 0) {
      y = bodyText(y, sens.omittedTornadoNotes.join(' '));
    }
    y += 4;

    y = subHeading(y, 'Two-Way Sensitivity Matrix: Profit on Cost (%)');

    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [sens.head],
      body: sens.pocRows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, halign: 'center' },
      bodyStyles: { textColor: [51, 65, 85], halign: 'center' },
      columnStyles: { 0: { fontStyle: 'bold', halign: 'left' } },
      didParseCell(data) {
        if (data.section === 'body' && data.column.index > 0) {
          const val = parseFloat(String(data.cell.raw));
          if (val < 0) {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = 'bold';
          } else if (val < 15) {
            data.cell.styles.textColor = [217, 119, 6];
          }
        }
      },
    });
    y = lastAutoTableFinalY(doc) + 6;

    y = subHeading(y, 'Two-Way Sensitivity Matrix: LTGDV, developer basis (%)');

    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [sens.head],
      body: sens.ltgdvRows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255, halign: 'center' },
      bodyStyles: { textColor: [51, 65, 85], halign: 'center' },
      columnStyles: { 0: { fontStyle: 'bold', halign: 'left' } },
      didParseCell(data) {
        if (data.section === 'body' && data.column.index > 0) {
          const val = parseFloat(String(data.cell.raw));
          if (val > 75) {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = 'bold';
          } else if (val > 65) {
            data.cell.styles.textColor = [217, 119, 6];
          }
        }
      },
    });
    y = lastAutoTableFinalY(doc) + 4;

    // A matrix cell reads "n/a" for two different reasons that print identically: a
    // metric that is genuinely undefined (e.g. a zero-denominator ratio), or a position
    // the engine could not measure at all because its levered document failed
    // validation (spec §12.7). Printed only when the latter actually occurs in this
    // grid, so an ordinary deal's matrices carry no extra caption.
    //
    // R6: this used to say only that the ambiguity existed. The engine had already
    // handed over the exact reason for every unmeasured cell, so it now says which.
    //
    // This loop is unreachable through generateInvestmentMemo below: that function
    // always calls sensitivityTables() with no config argument, so the memo only ever
    // prints the fixed default grid, and no fixture's default grid produces an
    // unmeasured matrix cell. `config` exists solely so tests can drive a grid that
    // does (see the sensitivityTables doc comment above), which is how this loop and
    // `unmeasuredCellNote` are exercised at all.
    for (const [i, note] of sens.unmeasuredCellNotes.entries()) {
      y = bodyText(y, `${i + 1}. ${unmeasuredCellNote(note)}`);
    }
  } else {
    // In place of the tornado and the two matrices: the engine refused to run the
    // suite at all because the base document itself fails validation (spec
    // §12.5/§12.7) — not one position out of many, every position at once — so
    // there is nothing partial to print. The reason is the engine's own thrown
    // message, not a rationale reconstructed here.
    y = subHeading(y, 'Sensitivity Analysis');
    y = bodyText(
      y,
      `The spec §12 sensitivity analysis was not produced for this document: ${sensitivityFailureMessage} (spec §12.7).`,
    );
  }
  y += 2;

  y = subHeading(y, 'Senior Debt Position');
  y = bodyText(
    y,
    `Senior repayment break-even prints under Key Lending Metrics (§7) and developer profit break-even under Investor Returns (§8).${salesPhasing != null ? ' Both figures are computed on this appraisal\'s phased-disposal basis (calc 2.3.0, spec §5.11/§5.12).' : ''}`,
  );

  // ── Section 11: Exit Strategy ──
  y = sectionTitle(y, 11, 'Exit Strategy');

  y = subHeading(y, 'Primary Exit');
  y = bodyText(y, exitLabel + '.');

  if (inputs.exit_strategy.route === 'sell_all' || inputs.exit_strategy.route === 'blended') {
    const agentFee = fmtPct(inputs.exit_strategy.selling_agent_fee_pct);
    const legalFee = fmt(inputs.exit_strategy.selling_legal_fee_pence);
    y = bodyText(
      y,
      `Disposal costs: agent at ${agentFee} of sale price, legal at ${legalFee} per transaction.`,
    );
  }

  if (
    (inputs.exit_strategy.route === 'retain_all' || inputs.exit_strategy.route === 'blended') &&
    inputs.exit_strategy.retained_units.length > 0
  ) {
    y = subHeading(y, 'Retained Portfolio');
    const retainedRows = inputs.exit_strategy.retained_units.map((r) => {
      const unit = inputs.unit_mix.units.find((u) => u.id === r.unit_id);
      const annualRent = r.monthly_rent_pence * 12;
      const cv = unit?.estimated_value_pence ?? 0;
      const yieldPct = cv > 0 ? (annualRent / cv) * 100 : 0;
      return [
        unit ? unitLabel(unit.type) : '—',
        unit ? `${unit.floor_area_sqm} m²` : '—',
        fmt(r.monthly_rent_pence),
        fmt(annualRent),
        fmt(cv),
        fmtPct(yieldPct),
      ];
    });

    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Unit', 'Size', 'Monthly Rent', 'Annual Rent', 'Capital Value', 'Gross Yield (indicative — not part of the appraisal)']],
      body: retainedRows,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
    });
    y = lastAutoTableFinalY(doc) + 6;
  }

  if (salesPhasing != null) {
    // Sale Tranches (spec §4.4.1) — one row per month with recorded sale receipts,
    // straight from schedule.receipts; Net comes from model.months (already the
    // engine's own gross − agent − legal for that month), zero recalculation.
    y = subHeading(y, 'Sale Tranches');
    const trancheRows = schedule.receipts
      .map((r, m) => ({ r, m }))
      .filter(({ r }) => r.gross_sale_pence > 0)
      .map(({ r, m }, i) => [
        `${i + 1}`,
        monthLabel(m),
        fmt(r.gross_sale_pence),
        fmt(r.agent_fee_pence + r.selling_legal_pence),
        fmt(model.months[m].net_receipts_pence),
      ]);
    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Tranche', 'Month', 'Gross', 'Costs', 'Net']],
      body: trancheRows,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
      columnStyles: {
        0: { halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
    });
    y = lastAutoTableFinalY(doc) + 6;
  }

  if (model.redemption_schedule.length > 0) {
    // Declining redemption schedule (spec §4.4.1) — senior balance immediately
    // before each disposal month's receipts are applied, straight off the engine.
    y = subHeading(y, 'Redemption Schedule');
    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Month', 'Senior balance before receipts']],
      body: model.redemption_schedule.map((r) => [monthLabel(r.month), fmt(r.balance_pence)]),
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
      columnStyles: { 1: { halign: 'right' } },
    });
    y = lastAutoTableFinalY(doc) + 6;
  }

  if (refinance != null && schedule.refinance != null) {
    y = bodyText(
      y,
      `Refinance (${monthLabel(schedule.refinance.month)}): investment value ${fmt(refinance.investment_value_pence)}, LTV ${fmtPct(refinance.ltv_pct)}, net proceeds ${fmt(schedule.refinance.net_proceeds_pence)} — applied to senior redemption; surplus distributes to equity (spec §4.5).`,
    );
  }

  y = subHeading(y, 'Contingent Exit');
  if (refinance == null) {
    y = infoRequired(y, 'At least one contingent exit strategy with supporting evidence');
  }
  y = bodyText(
    y,
    'Contingent exits may include: sale of individual units to owner-occupiers at revised pricing, bulk sale to a registered provider or institutional PRS investor, or refinance onto long-term BTL debt.',
  );

  // ── Section 12: Appendices ──
  y = sectionTitle(y, 12, 'Appendices');

  y = subHeading(y, 'A. Assumption Schedule');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Assumption', 'Value', 'Basis']],
    body: [
      ['Purchase price', fmt(inputs.acquisition.purchase_price_pence), 'Asking price / offer'],
      // R8 (spec §14). This row previously read "Commercial (non-residential)
      // bands — England/NI only", which stopped being true when the engine
      // became jurisdiction-aware: it named a regime the figure may not have
      // been charged under. It now states the basis actually applied.
      ['Acquisition tax', fmt(metrics.acquisition_tax_pence),
        `${tax.regime} — ${JURISDICTION_LABEL[tax.jurisdiction]}, non-residential, `
        + `bands in force from ${formatBandDate(tax.band_set_effective_from)} `
        + `(table ${tax.table_version})`],
      ['Build rate £/m²', fmt(inputs.conversion_costs.construction_cost_per_sqm_pence), 'Assumption — verify with QS'],
      ['Contingency', fmtPct(inputs.conversion_costs.contingency_pct), 'On base build cost only'],
      ['Blended GDV £/sq ft', perSqftPence(metrics.gdv_pence, totalSqm), 'Comparable evidence — verify'],
      ['Committed net facility', inputs.finance.committed_net_facility_pence === null ? 'Not entered' : fmt(inputs.finance.committed_net_facility_pence), inputs.finance.requires_confirmation ? 'Requires confirmation' : 'Confirmed'],
      ['RLV target profit', fmtPct(inputs.deal_spider.target_profit_on_cost_pct), 'deal_spider.target_profit_on_cost_pct (configurable)'],
      ['Interest rate', `${fmtPct(inputs.finance.annual_interest_rate_pct)} p.a.`, 'Market rate / indicative terms'],
      ['Interest type', inputs.finance.interest_type === 'rolled_up' ? 'Rolled up' : 'Serviced', 'Assumed'],
      ['Loan term', `${inputs.finance.term_months} months`, 'Assumed programme duration'],
      ['Arrangement fee', fmtPct(inputs.finance.arrangement_fee_pct), 'Indicative terms'],
      ['Exit fee', fmtPct(inputs.finance.exit_fee_pct), 'Indicative terms'],
      ['Construction VAT', 'Treatment unconfirmed', 'No reduced-rate saving assumed in this appraisal (spec §3.4)'],
      ['Purchase VAT / TOGC', 'Unconfirmed', 'Purchase price treated as VAT-exempt/TOGC — unconfirmed (spec §3.3)'],
      ['Agent fee', fmtPct(inputs.exit_strategy.selling_agent_fee_pct), 'Standard estate agent fee'],
      ['Legal fee (disposal)', fmt(inputs.exit_strategy.selling_legal_fee_pence), 'Estimate'],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
  });
  y = lastAutoTableFinalY(doc) + 8;

  y = subHeading(y, 'B. Information Required');
  const infoItems = [
    'Market rationale — why this asset, why now, demand drivers',
    'Full comparable evidence table (address, date, size, £/sq ft, source)',
    'Planning permission reference / prior approval application status',
    'Design and specification status',
    'Procurement route and contractor details',
    'Programme — key dates (start on site, PC, sales period)',
    'Critical path and long-lead items',
    'Sponsor / team track record and CVs',
    'Professional team and warranties / collateral warranties',
    'Insurance details (CAR, PI, etc.)',
    'Security package details',
    'Drawdown profile',
    'Contingent exit strategy with evidence',
  ];
  // The former "C. Additional Appendices Required" block asked for team CVs, a
  // professional team schedule and an insurance schedule. All three were already
  // in the list above under slightly different wording (items 8, 9 and 10), so
  // folding that block in here printed each of them twice. The block is gone;
  // the items it duplicated stay where they were.
  if (missing.length > 0) {
    infoItems.push(`Risk register gaps: ${missing.join(', ')}`);
  }
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['#', 'Item']],
    body: infoItems.map((item, i) => [`${i + 1}`, item]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [180, 83, 9], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' } },
  });
  y = lastAutoTableFinalY(doc) + 8;

  // ── Section 13: Basis of Preparation and Limitations ──
  //
  // Two jobs. First, the audit asked that the export stop claiming more than it
  // has: a headline cost model is not a cost plan, an unapproved appraisal is
  // not a credit paper, and an accounting return is not a distributed one. That
  // belongs in the document, not only in the UI that launched it.
  //
  // Second, it is what the document ends on. The three "additional appendices
  // required" lines that used to close the memo have moved into the numbered
  // schedule above, because a heading and three bracketed lines were all that
  // remained after the table paginated — the near-blank final page the audit
  // reported, in a different place from the one it happened to see.
  y = sectionTitle(y, 13, 'Basis of Preparation and Limitations');

  y = bodyText(
    y,
    `This document is a ${prov.documentStatus} development appraisal prepared from the sponsor's own inputs. `
    + `${prov.reportSafe
        ? 'It is report-safe: every hard validation in the model passes.'
        : 'It is NOT report-safe: one or more hard validations fail, and the figures may be wrong.'} `
    // The lender-case sentence and the draft-reason sentence collapse into one
    // when they would otherwise state the same fact twice: with no case
    // submitted, "no lender case has been credit approved" is not a second
    // reason, it is the same reason reworded.
    + `${prov.lenderCaseStatus === null && prov.draftReason === 'not_approved'
        ? 'No lender case has been submitted for credit approval, which is why it remains a draft.'
        : [
            prov.lenderCaseStatus === null
              ? 'No lender case has been submitted for credit approval.'
              : `The lender case is at "${lenderCaseLabel(prov.lenderCaseStatus)}".`,
            prov.draftReason === null
              ? 'It is a final lender report.'
              : `It is a draft because ${DRAFT_REASON_SENTENCE[prov.draftReason]}.`,
          ].join(' ')} `
    + 'It is suitable for sponsor review and for preliminary lender appraisal. It is not a credit paper, '
    + 'a valuation, a cost plan, a tax opinion or a legal report, and no lender should rely on it for a '
    + 'credit decision without independently verifying the matters listed below.',
  );

  y = subHeading(y, 'What the figures rest on');
  const limitations: string[] = [
    'Construction cost is a headline rate x area estimate with named allowances, not a priced quantity-surveyed package schedule. No provisional sums, fixed-price coverage or package-level exclusions are modelled.',
    'VAT is not modelled as a cash flow. Conversion VAT treatment is fact-specific and no reduced-rate saving is assumed; purchase VAT and any TOGC treatment are unconfirmed. An adverse VAT position would increase the funding requirement.',
    // R8 (spec §14). The sentence this replaces said the model taxed every
    // property on England/NI SDLT bands and that Scotland and Wales were not
    // correctly taxed. Both halves became false when the engine became
    // jurisdiction-aware, and a false limitation is worse than none: it tells a
    // credit committee to discount a figure that is in fact right.
    `Acquisition tax is calculated on the ${tax.regime} non-residential bands for `
    + `${JURISDICTION_LABEL[tax.jurisdiction]} in force from ${formatBandDate(tax.band_set_effective_from)} `
    + `(assumption table version ${tax.table_version}). `
    // Fix round 1. Without this clause the sentence above reads as a statement
    // of record on a document that recorded nothing, which is the same fault as
    // the sentence it replaced, one degree milder.
    + (prov.jurisdictionRecorded
      ? ''
      : `This document records no jurisdiction, so ${JURISDICTION_LABEL[tax.jurisdiction]} `
        + 'has been assumed rather than evidenced, and the regime above is an assumption not a finding. ')
    + 'Reliefs, linked transactions and multiple dwellings relief are not modelled.',
    // R9 (spec §15). This line used to say there was no reconciled area
    // bridge at all — true before R9, false once one is entered, and a false
    // limitation is the same fault the acquisition-tax sentence above was
    // fixed for. A document that has not entered one is still exactly the
    // pre-R9 case, so it keeps (a corrected version of) the old wording.
    bridge.developed_gia_sqm > 0
      ? 'Areas rest on the entered area schedule (Section 3), reconciled from existing GIA through to net internal area; see that schedule for every entered and derived line and the stated basis of the construction cost area.'
      : 'No area schedule has been entered for this appraisal. Areas are taken from the unit schedule and the entered construction area only, with no existing-to-developed reconciliation to check them against.',
    'Technical, title, occupation and planning due diligence is recorded as narrative and as a free-form risk register, not as an evidenced schedule with status, owner and date.',
  ];
  if (metrics.lender_gdv_pence === null) {
    limitations.push('No lender-underwritten valuation has been provided. Every loan-to-value figure on a lender basis is therefore unavailable rather than assumed from the developer GDV.');
  }
  if (inputs.finance.requires_confirmation) {
    limitations.push('The facility terms were migrated from an earlier record and remain unconfirmed. They must be checked against the actual offer before any figure derived from them is relied on.');
  }
  // Two different reasons a return can be unrealised, and they must not share a
  // sentence: nothing realised at all is not the same as a partial retention.
  if (!metrics.has_realisation_event) {
    limitations.push('No sale or refinance is modelled within the term, so profit and return on equity are unrealised accounting returns on value created. Equity multiple and IRR are reported as unavailable rather than as zero, because there is no realisation event to measure them against.');
  } else if (metrics.profit_is_unrealised) {
    limitations.push('Profit and return on equity include the market value of the retained units, which is unrealised until those units are sold or refinanced. Only the realised element is reflected in the equity multiple and IRR.');
  }
  if (!prov.reportSafe) {
    limitations.push('This appraisal is not report-safe. The reconciliation panel in the application lists the failing validations; they must be cleared before the figures here are quoted.');
  }
  if (!prov.seniorRepaid) {
    limitations.push('The senior facility is not repaid within the modelled term. Whatever the exit route intends, this appraisal does not demonstrate repayment, and no document showing an unrepaid senior balance at maturity can be issued as a final lender report (spec §13.3).');
  }
  // The closing statement is the table's foot rather than a paragraph after it.
  // As a free-standing block it was the last thing in the document, so whenever
  // the table's final rows happened to land near a page bottom the statement
  // alone became the next page — the same orphan defect in a new place. A foot
  // row cannot separate from the table it belongs to.
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['#', 'Limitation']],
    body: limitations.map((item, i) => [`${i + 1}`, item]),
    foot: [[
      '',
      `Prepared under calculation version ${prov.calcVersion}, input schema v${prov.inputsVersion}. `
      + 'Every figure in this document comes from a single server-authoritative run of the appraisal model; '
      + 'no figure is recalculated by the report generator. See the Report Provenance panel on page 1 for '
      + 'the hashes that bind these figures to the stored calculation.',
    ]],
    showFoot: 'lastPage',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [180, 83, 9], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    footStyles: { fillColor: [226, 232, 240], textColor: [71, 85, 105], fontStyle: 'normal' },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' } },
  });
  y = lastAutoTableFinalY(doc) + 8;

  // A heading queued with nothing after it would otherwise never be drawn. It
  // is a defect if this ever fires, but a silently missing heading is worse
  // than one sitting alone at the end of the document. Guarded on there being
  // one at all (R9 fix): `flushHeadings` always re-runs its own page-break
  // check, even with nothing to place, and running that check here -- after
  // the very last block has already been drawn, with nothing left to keep
  // together -- produced a genuinely blank trailing page whenever the
  // Limitations table's foot happened to end past CONTENT_BOTTOM. Nothing
  // pending means nothing to flush, so there is nothing here that should ever
  // force a page break.
  if (pendingHeadings.length > 0) {
    y = flushHeadings(y, 0);
  }

  // ── Footer on all pages ──
  addPageFooter();

  setDocumentMetadata(doc, {
    title: `Investment Memorandum — ${project.address_raw} (${prov.documentStatus})`,
    subject: `Development appraisal, calculation version ${prov.calcVersion}, scenario ${prov.scenarioName}`,
    keywords: 'development appraisal, commercial to residential, lender report',
  });

  return doc.output('blob');
}
