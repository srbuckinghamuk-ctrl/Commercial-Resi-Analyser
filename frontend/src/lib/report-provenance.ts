/**
 * Report provenance (spec §13) — the facts a reader needs in order to know what
 * a printed appraisal actually is.
 *
 * The second lender-readiness audit found the exported memorandum showing no
 * calculation version, input version, result hash, audit hash, scenario identity
 * or generation time. Those are not decoration: without them, two PDFs of the
 * same scheme cannot be told apart, a figure cannot be traced back to the run
 * that produced it, and nothing on the page says whether the document is a
 * screening appraisal or an approved credit paper.
 *
 * This module owns the governance *rules* (what makes a document FINAL, when a
 * printed result is stale against the record it came from) so that neither the
 * report generator nor a React component has to decide them.
 */
import type { FinancialAppraisal, LenderCase, LenderCaseStatus } from '../types';
import type { AppraisalRun, ReconciliationStatus } from './model';
import { CALC_VERSION, vatBasisGate } from './model';
import type { Jurisdiction } from './tax/acquisition-tax';

/** Where a lender case has reached. Populated from R14b; was null-only until
 *  then. Canonical in ../types; re-exported here so existing importers of
 *  this module are unmoved. */
export type { LenderCaseStatus };

/** The lender-case statuses that permit a FINAL document (spec §13.3). */
const APPROVED_STATUSES: readonly LenderCaseStatus[] = ['credit_approved', 'approved_with_conditions'];

/** Spec §21.2, normative — mirrored literally in app/financial_model/
 *  provenance.py, and pinned against it by mirrored tests. The UI derives its
 *  transition buttons from this table; it never keeps its own list. */
export const ALLOWED_TRANSITIONS: Record<LenderCaseStatus, readonly LenderCaseStatus[]> = {
  draft: ['submitted', 'superseded'],
  submitted: ['under_review', 'superseded'],
  under_review: ['information_required', 'credit_approved',
    'approved_with_conditions', 'declined', 'superseded'],
  information_required: ['under_review', 'superseded'],
  credit_approved: ['superseded'],
  approved_with_conditions: ['superseded'],
  declined: ['superseded'],
  superseded: [],
};

export interface ReportProvenance {
  /** Stored appraisal record id, or null when the report is built from an unsaved run. */
  appraisalId: string | null;
  projectId: string;
  /** Which of the appraisal's scenarios the printed figures are on. */
  scenarioId: string;
  scenarioName: string;
  inputsVersion: number;
  /** Calculation version of the run that produced the printed figures. */
  calcVersion: string;
  /** Calculation version recorded against the stored result, when it differs. */
  storedCalcVersion: string | null;
  resultHash: string | null;
  auditHash: string | null;
  inputHash: string | null;
  generatedAt: Date;
  /** IANA zone the timestamp is rendered in. */
  timeZone: string;
  reportSafe: boolean;
  /** Spec §13.3 — the ledger repays the senior facility within the modelled term. */
  seniorRepaid: boolean;
  documentStatus: 'DRAFT' | 'FINAL';
  /** Which condition is keeping the document a draft; null once it is FINAL. */
  draftReason: DraftReason | null;
  lenderCaseStatus: LenderCaseStatus | null;
  /**
   * True when the printed run was computed under a different calculation version
   * from the one stored against the record — the report is then a
   * re-computation, not a reprint, and says so.
   */
  recomputedSinceSave: boolean;
  /** Semver of the acquisition-tax band table the printed figure came from. */
  taxTableVersion: string;
  /** The jurisdiction the printed acquisition tax was actually charged under. */
  jurisdiction: Jurisdiction;
  /**
   * Whether `jurisdiction` was *recorded on the document* or defaulted for it.
   *
   * Separate from `taxBasisConfirmed` on purpose. A pre-R8 document carries no
   * jurisdiction field at all, so `metrics` defaults it to `england_ni` — and
   * such a document may still reach FINAL, because it is not re-graded against a
   * condition that post-dates it (see `taxBasisConfirmedFor`). But a FINAL
   * credit paper must not print a defaulted jurisdiction as a recorded fact, so
   * the report says "assumed" wherever this is false. This field gates wording,
   * never document status.
   */
  jurisdictionRecorded: boolean;
  /**
   * Spec §14. True when the reader can rely on the tax basis without further
   * enquiry: the jurisdiction is evidenced *and* the band set was selected by
   * the transaction's own date rather than assumed to be the current one.
   * Either half missing means a re-run after a Budget could return a different
   * number, which a credit paper must not hide.
   */
  taxBasisConfirmed: boolean;
  /**
   * R11, spec §17.10. True when no charge line that actually bears VAT
   * (non-zero `vat_pence`) rests on an unconfirmed evidence status. Computed
   * by `vatBasisGate` from the run's own `metrics.vat`, never re-derived here.
   */
  vatBasisConfirmed: boolean;
  /** R14b, spec §21.3. The lender case backing this document, when one
   *  exists — the full record, not just its status. */
  lenderCase: LenderCase | null;
  /** R14b, spec §21.3. True when an approved lender case's locked snapshot no
   *  longer matches the document it was approved against. */
  lenderCaseStale: boolean;
}

export interface ProvenanceOptions {
  /** Injected so a report's bytes are reproducible in tests. */
  now?: Date;
  timeZone?: string;
  scenarioId?: string;
  scenarioName?: string;
  lenderCaseStatus?: LenderCaseStatus | null;
  /** R14b, spec §21.3. When supplied, wins over `lenderCaseStatus` for both
   *  the reported status and the staleness check. */
  lenderCase?: LenderCase | null;
}

export type DraftReason =
  | 'unreconciled' | 'senior_not_repaid' | 'tax_basis_unconfirmed'
  | 'vat_basis_unconfirmed' | 'not_approved' | 'lender_case_stale';

/** What `draftReason` needs to know about the acquisition-tax basis. Defaulted
 *  so that a pre-R8 two-argument caller keeps its exact previous behaviour. */
export interface TaxBasisGate {
  taxBasisConfirmed: boolean;
}

const TAX_BASIS_ASSUMED_CONFIRMED: TaxBasisGate = { taxBasisConfirmed: true };

/**
 * R11, spec §17.10. What `draftReason` needs to know about the VAT basis.
 * `draftReason` stays pure — it receives this, it does not compute it; the
 * computation is `vatBasisGate` (model/vat.ts), which reads the engine's own
 * `VatResult`. Defaulted exactly as `TaxBasisGate` was added defaulted in R8,
 * so no existing three-argument caller changes behaviour.
 */
export interface VatBasisGate {
  vatBasisConfirmed: boolean;
}

const VAT_BASIS_ASSUMED_CONFIRMED: VatBasisGate = { vatBasisConfirmed: true };

/** R14b, spec §21.3. What draftReason needs to know about the approved
 *  case's currency. Defaulted exactly as TaxBasisGate and VatBasisGate were,
 *  so no existing four-argument caller changes behaviour. */
export interface CaseStaleGate {
  lenderCaseStale: boolean;
}

const CASE_ASSUMED_CURRENT: CaseStaleGate = { lenderCaseStale: false };

/**
 * Spec §13.3, extended by §14 (R8), §17.10 (R11) and §21 (R14b). A document is
 * FINAL only when six separate things hold, and the reason it is not is worth
 * naming rather than collapsing.
 *
 * 1. **Reconciled.** Hard validations pass, so the figures may be right at all.
 * 2. **Senior repaid.** The ledger clears the facility inside the modelled term.
 *    `report_safe` deliberately does *not* require this — an appraisal that
 *    intends to refinance later is a perfectly valid appraisal — but a document
 *    a credit committee relies on cannot show the senior facility unrepaid at
 *    maturity and call itself final.
 * 3. **Tax basis confirmed.** The jurisdiction the acquisition tax was charged
 *    under is evidenced, and the band set was chosen by the transaction date.
 * 4. **VAT basis confirmed.** No charge line that actually bears VAT rests on an
 *    unconfirmed evidence status.
 * 5. **Approved.** A lender case exists and has been credit approved.
 * 6. **The approval is current.** That case is not stale — the stored document
 *    still hashes to the one the case locked.
 *
 * Conditions 5 and 6 became reachable at R14b, which shipped the lender case
 * itself (spec §21): the record, the state machine, the approval. Before it no
 * case could exist, condition 5 could never be met, and every document was a
 * DRAFT — the honest answer rather than a gap, since an appraisal nobody has
 * approved is not a credit paper however cleanly it reconciles. Now an approved,
 * current case reaches FINAL, and an approved case whose document has since moved
 * does not: it reports `lender_case_stale`, because a FINAL banner over figures
 * the lender never saw is worse than no approval at all. The audit asked
 * specifically that the watermark survive "whenever hard validations fail **or**
 * the lender case is not approved"; staleness is the third arm of that same ask.
 */
export function draftReason(
  reconciliation: Pick<ReconciliationStatus, 'report_safe' | 'senior_repaid'>,
  lenderCaseStatus: LenderCaseStatus | null,
  taxBasis: TaxBasisGate = TAX_BASIS_ASSUMED_CONFIRMED,
  vatBasis: VatBasisGate = VAT_BASIS_ASSUMED_CONFIRMED,
  caseStale: CaseStaleGate = CASE_ASSUMED_CURRENT,
): DraftReason | null {
  if (!reconciliation.report_safe) return 'unreconciled';
  if (!reconciliation.senior_repaid) return 'senior_not_repaid';
  // R8 (spec §14). Ordered here, not earlier: an unconfirmed jurisdiction does
  // not make the arithmetic wrong, so it must not displace a reason that says
  // the figures themselves may be. It sits above `not_approved` because a
  // reader needs to know the basis is unverified before they read an approval.
  if (!taxBasis.taxBasisConfirmed) return 'tax_basis_unconfirmed';
  // R11 (spec §17.10). Sits immediately below the tax-basis clause: the same
  // rationale applies unchanged — an unconfirmed VAT basis does not make the
  // arithmetic wrong, so it must not displace a reason saying the figures
  // themselves may be, but a reader must know the basis is unverified before
  // they read an approval.
  if (!vatBasis.vatBasisConfirmed) return 'vat_basis_unconfirmed';
  if (lenderCaseStatus === null || !APPROVED_STATUSES.includes(lenderCaseStatus)) return 'not_approved';
  // R14b (spec §21.3). Fires only when an approval exists — an unapproved
  // stale case reports not_approved — so the two are mutually exclusive by
  // construction, and a FINAL banner can never print over figures the lender
  // never saw.
  if (caseStale.lenderCaseStale) return 'lender_case_stale';
  return null;
}

export function documentStatus(
  reconciliation: Pick<ReconciliationStatus, 'report_safe' | 'senior_repaid'>,
  lenderCaseStatus: LenderCaseStatus | null,
  taxBasis: TaxBasisGate = TAX_BASIS_ASSUMED_CONFIRMED,
  vatBasis: VatBasisGate = VAT_BASIS_ASSUMED_CONFIRMED,
  caseStale: CaseStaleGate = CASE_ASSUMED_CURRENT,
): 'DRAFT' | 'FINAL' {
  return draftReason(reconciliation, lenderCaseStatus, taxBasis, vatBasis, caseStale) === null
    ? 'FINAL' : 'DRAFT';
}

/**
 * Whether the printed acquisition tax rests on an evidenced basis (spec §14).
 *
 * A v2/v3/v4 document carries no jurisdiction field at all, and this function
 * treats it as confirmed. Note what that is *not* an escape hatch for: the
 * product owner's accepted flag day is exactly "every pre-R8 document shows
 * the tax-basis draft banner until it is confirmed" (report §4), so a stored
 * record that genuinely predates R8 and is genuinely still on v2/v3/v4 *is*
 * meant to flip to DRAFT under that decision, once it is migrated and its
 * jurisdiction is examined — this branch does not contradict that. What it
 * does is describe a case the decision was never about: both production entry
 * points (`ExportPage.tsx`, `ConversionCalculator.tsx`) migrate every stored
 * document to v5 before calling `runAppraisal`, so by the time this function
 * runs in practice, `acq` is already v5-shaped and this `!('jurisdiction' in
 * acq)` branch is not reachable from stored data at all — only from a caller
 * that hands `taxBasisConfirmedFor` a raw v2/v3/v4 document directly (as the
 * unit tests do, deliberately, to pin the pre-migration behaviour). The `in`
 * guard is the established idiom for reading a field such a document lacks.
 *
 * Do not "tidy" the two halves into one. An undated v5 document is held and an
 * undated v4 document is not, and that asymmetry is not an oversight: the test
 * is *opportunity*, not irreproducibility. Both are equally irreproducible after
 * a Budget — but v5 gives the user a field in which to record the date and the
 * evidence status, so leaving them blank is a choice the document can fairly be
 * held to. v4 offered no such field, so its silence says nothing about its
 * author and cannot be graded. Honesty about the v4 case is the report's job
 * instead, not the gate's — see `jurisdictionRecorded`.
 *
 * `date_basis` is read from `metrics.acquisition_tax` rather than re-derived
 * from the date input, because it is the engine's own statement of which band
 * set it used — including where an unusable date degraded to the current set.
 */
export function taxBasisConfirmedFor(run: AppraisalRun): boolean {
  const acq = run.inputs.acquisition;
  if (!('jurisdiction' in acq)) return true;
  return acq.jurisdiction_evidence_status === 'confirmed'
    && run.metrics.acquisition_tax.date_basis === 'transaction_date';
}

/**
 * Whether the document itself records a jurisdiction, as opposed to having one
 * defaulted for it by `deriveMetrics`.
 *
 * The null check matters as well as the `in` check: `migrateInputsToV5`'s
 * already-v5 branch spreads a stored `"jurisdiction": null` straight over the
 * defaults, and `metrics.ts` then coalesces it to `england_ni`. Such a document
 * has a jurisdiction field but has recorded nothing in it, and the report must
 * describe it exactly as it describes a pre-R8 document: assumed.
 *
 * That false path is not reachable in production by an ordinary route: the
 * server's v5 inputs model types `jurisdiction` as a non-nullable literal, so
 * a client cannot legitimately produce a stored v5 document with an explicit
 * `null` there, and it rejects one that tries with a 422. The only way to
 * exercise this path today is a hand-crafted v5 snapshot that bypasses that
 * validation — which is also true of the three `!prov.jurisdictionRecorded`
 * branches in `export-investment-memo.ts`. The check is still correct to keep:
 * it is what makes the false path safe *if* that boundary is ever loosened.
 */
export function jurisdictionRecordedOn(run: AppraisalRun): boolean {
  const acq = run.inputs.acquisition;
  return 'jurisdiction' in acq && acq.jurisdiction !== null && acq.jurisdiction !== undefined;
}

/**
 * Build the provenance block for a run, taking the stored hashes from the saved
 * record where one exists.
 *
 * The hashes deliberately come from the record and never from the client: they
 * are the server's statement about what it computed and stored. A client-side
 * re-derivation would print a hash of the client's own arithmetic, which is
 * exactly the confusion the hashes exist to prevent — so when the run was
 * computed under a different calc version from the stored one, this reports
 * `recomputedSinceSave` instead of quietly reusing the stored hash as if it
 * described the printed figures.
 */
export function buildProvenance(
  run: AppraisalRun,
  record: FinancialAppraisal | null,
  options: ProvenanceOptions = {},
): ReportProvenance {
  const {
    now = new Date(),
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    scenarioId = 'base',
    scenarioName = 'Base Case',
    lenderCaseStatus = null,
    lenderCase = null,
  } = options;
  // The full case object wins over the bare status when both are supplied —
  // the status option survives for the tests and callers that predate R14b.
  const caseStatus = lenderCase?.status ?? lenderCaseStatus;
  const lenderCaseStale = lenderCase?.stale ?? false;

  const reportSafe = run.reconciliation.report_safe;
  const seniorRepaid = run.reconciliation.senior_repaid;
  const taxBasisConfirmed = taxBasisConfirmedFor(run);
  // R11 (spec §17.10, ruling R5). Computed from the run's own metrics.vat —
  // draftReason receives the gate, it does not compute one.
  const { vatBasisConfirmed } = vatBasisGate(run.metrics.vat);
  const reason = draftReason(
    run.reconciliation, caseStatus, { taxBasisConfirmed }, { vatBasisConfirmed },
    { lenderCaseStale },
  );
  const storedCalcVersion = record?.calc_version ?? null;
  const runCalcVersion = run.metrics.calc_version || CALC_VERSION;

  return {
    appraisalId: record?.id ?? null,
    projectId: record?.project_id ?? run.inputs.project_id ?? '',
    scenarioId,
    scenarioName,
    inputsVersion: run.inputs.inputs_version,
    calcVersion: runCalcVersion,
    storedCalcVersion,
    resultHash: record?.outputs_hash ?? null,
    auditHash: record?.audit_hash ?? null,
    inputHash: record?.input_hash ?? null,
    generatedAt: now,
    timeZone,
    reportSafe,
    seniorRepaid,
    documentStatus: reason === null ? 'FINAL' : 'DRAFT',
    draftReason: reason,
    lenderCaseStatus: caseStatus,
    recomputedSinceSave: storedCalcVersion !== null && storedCalcVersion !== runCalcVersion,
    taxTableVersion: run.metrics.acquisition_tax.table_version,
    jurisdiction: run.metrics.acquisition_tax.jurisdiction,
    jurisdictionRecorded: jurisdictionRecordedOn(run),
    taxBasisConfirmed,
    vatBasisConfirmed,
    lenderCase,
    lenderCaseStale,
  };
}

/** Human label for a lender-case status, or the absence of one. */
export function lenderCaseLabel(status: LenderCaseStatus | null): string {
  if (status === null) return 'No lender case — not submitted for credit approval';
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * The generation timestamp with its zone, in a form a reviewer can quote.
 * `Intl` is asked for the offset explicitly so the printed line is unambiguous
 * even when the reader is in another zone from the person who generated it.
 */
export function formatGeneratedAt(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const offset = get('timeZoneName');
  return `${get('day')} ${get('month')} ${get('year')} ${get('hour')}:${get('minute')}:${get('second')} ${offset} (${timeZone})`;
}

/**
 * R14b (spec §21.3) — the client half of staleness: deep structural equality
 * of the in-session inputs against a case's locked snapshot. An unsaved edit
 * moves no stored hash, so this is the only check that can see one. It drives
 * the Lender Case page's live warning and nothing else — the memo always
 * prints from the stored record, so it consumes the server-derived `stale`
 * flag instead. Key order is irrelevant; array order is meaningful.
 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => structurallyEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra).sort();
    const kb = Object.keys(rb).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => structurallyEqual(ra[k], rb[k]));
  }
  return false;
}
