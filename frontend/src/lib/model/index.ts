import type {
  AnyCalculatorInputs, AppraisalResultV2, MonthlyModel, Schedule,
} from './finance-types';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { deriveMetrics } from './metrics';
import { reconcile, validateInputs } from './validation';
import type { ReconciliationStatus, ValidationIssue } from './validation';

export interface AppraisalRun {
  // Widened in Task 8 (Release 2b): UI/report consumers now read the actual
  // document runAppraisal() was given, v2 or v3 — no cast to a narrower shape.
  // Fields common to both versions (acquisition, unit_mix, finance, ...) are
  // accessed identically either way; only `lender_valuation` needs an `in`
  // check (present on v3 only) or, more simply, deriveMetrics()' own
  // lender_gdv_pence/ltgdv_lender_pct/etc. outputs on `run.metrics`, which are
  // already null for v2 callers and never need that check at the read site.
  inputs: AnyCalculatorInputs;
  schedule: Schedule;
  model: MonthlyModel;
  metrics: AppraisalResultV2;
  validation: ValidationIssue[];
  reconciliation: ReconciliationStatus;
}

/** The only entry point UI/report/backend-parity code may use. Accepts v2
 * (pre-Release-2b), v3 (adds the optional lender_valuation block, spec §3.2),
 * v4 (adds the optional programme block, spec §6.1) and v5 (adds jurisdiction,
 * acquisition date and tax override, spec §14, R8) documents — v2 callers get
 * lender-basis metrics as null (spec §2: unknown lender-critical inputs are
 * never silently defaulted), exactly as they did before the block existed,
 * and callers on any version before v5 get acquisition tax computed as
 * England/NI SDLT with an unconfirmed basis (spec §14.6), exactly as they did
 * before the jurisdiction field existed. */
export function runAppraisal(inputs: AnyCalculatorInputs): AppraisalRun {
  const schedule = buildSchedule(inputs);
  const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
  const metrics = deriveMetrics(inputs, schedule, model);
  const validation = validateInputs(inputs);
  const reconciliation = reconcile(inputs, schedule, model);
  return { inputs, schedule, model, metrics, validation, reconciliation };
}

export {
  migrateInputs, migrateV2toV3, migrateInputsToV3, isV3, isV4, migrateV3toV4, migrateInputsToV4,
  isV5, migrateV4toV5, migrateInputsToV5,
  isV6, migrateV5toV6, migrateInputsToV6,
} from './migrate';
export { areaBridge, developedAreaSqm, unitNiaSqm, DEFAULT_AREA_BRIDGE } from './areas';
export type { AreaBasis, AreaBridgeInputs, AreaBridgeResult } from './areas';
export { validateInputs, reconcile };
export type { ReconciliationStatus, ValidationIssue };
export { solveSeniorBreakevenPhased, phasedReplayRedeems } from './breakeven';
export type { PhasedSeniorBreakevenTerms } from './breakeven';
export * from './finance-types';
