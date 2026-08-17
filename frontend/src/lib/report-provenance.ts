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
import type { FinancialAppraisal } from '../types';
import type { AppraisalRun, ReconciliationStatus } from './model';
import { CALC_VERSION } from './model';

/** Where a lender case has reached. Populated from R14; null until then. */
export type LenderCaseStatus =
  | 'draft' | 'submitted' | 'under_review' | 'information_required'
  | 'credit_approved' | 'approved_with_conditions' | 'declined' | 'superseded';

/** The lender-case statuses that permit a FINAL document (spec §13.3). */
const APPROVED_STATUSES: readonly LenderCaseStatus[] = ['credit_approved', 'approved_with_conditions'];

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
}

export interface ProvenanceOptions {
  /** Injected so a report's bytes are reproducible in tests. */
  now?: Date;
  timeZone?: string;
  scenarioId?: string;
  scenarioName?: string;
  lenderCaseStatus?: LenderCaseStatus | null;
}

export type DraftReason = 'unreconciled' | 'senior_not_repaid' | 'not_approved';

/**
 * Spec §13.3. A document is FINAL only when three separate things hold, and the
 * reason it is not is worth naming rather than collapsing.
 *
 * 1. **Reconciled.** Hard validations pass, so the figures may be right at all.
 * 2. **Senior repaid.** The ledger clears the facility inside the modelled term.
 *    `report_safe` deliberately does *not* require this — an appraisal that
 *    intends to refinance later is a perfectly valid appraisal — but a document
 *    a credit committee relies on cannot show the senior facility unrepaid at
 *    maturity and call itself final.
 * 3. **Approved.** A lender case exists and has been credit approved.
 *
 * With no lender case in existence (the position until R14 lands) the third
 * condition cannot be met, so every document is a DRAFT. That is the honest
 * answer rather than a gap: an appraisal nobody has approved is not a credit
 * paper, however cleanly it reconciles, and the audit asked specifically that
 * the watermark survive "whenever hard validations fail **or** the lender case
 * is not approved".
 */
export function draftReason(
  reconciliation: Pick<ReconciliationStatus, 'report_safe' | 'senior_repaid'>,
  lenderCaseStatus: LenderCaseStatus | null,
): DraftReason | null {
  if (!reconciliation.report_safe) return 'unreconciled';
  if (!reconciliation.senior_repaid) return 'senior_not_repaid';
  if (lenderCaseStatus === null || !APPROVED_STATUSES.includes(lenderCaseStatus)) return 'not_approved';
  return null;
}

export function documentStatus(
  reconciliation: Pick<ReconciliationStatus, 'report_safe' | 'senior_repaid'>,
  lenderCaseStatus: LenderCaseStatus | null,
): 'DRAFT' | 'FINAL' {
  return draftReason(reconciliation, lenderCaseStatus) === null ? 'FINAL' : 'DRAFT';
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
  } = options;

  const reportSafe = run.reconciliation.report_safe;
  const seniorRepaid = run.reconciliation.senior_repaid;
  const reason = draftReason(run.reconciliation, lenderCaseStatus);
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
    lenderCaseStatus,
    recomputedSinceSave: storedCalcVersion !== null && storedCalcVersion !== runCalcVersion,
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
