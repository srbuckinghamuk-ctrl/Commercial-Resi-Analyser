import type {
  AppraisalResultV2, CalculatorInputsV2, CalculatorInputsV3, MonthlyModel, Schedule,
} from './finance-types';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { deriveMetrics } from './metrics';
import { reconcile, validateInputs } from './validation';
import type { ReconciliationStatus, ValidationIssue } from './validation';

export interface AppraisalRun {
  // Kept as v2 (unwidened) — every existing UI/report consumer (ScenariosPage,
  // export-investment-memo.ts, deal-spider.ts, ...) still narrows on the v2
  // shape and is out of scope for this task (Task 8 wires the UI to v3). The
  // v3 caller path (golden fixtures, the API server) already has the
  // *original* v3 document it passed in to read lender_valuation from — it
  // does not need it echoed back through this field.
  inputs: CalculatorInputsV2;
  schedule: Schedule;
  model: MonthlyModel;
  metrics: AppraisalResultV2;
  validation: ValidationIssue[];
  reconciliation: ReconciliationStatus;
}

/** The only entry point UI/report/backend-parity code may use. Accepts both
 * v2 (pre-Release-2b) and v3 (adds the optional lender_valuation block, spec
 * §3.2) documents — v2 callers get lender-basis metrics as null (spec §2:
 * unknown lender-critical inputs are never silently defaulted), exactly as
 * they did before the block existed. */
export function runAppraisal(inputs: CalculatorInputsV2 | CalculatorInputsV3): AppraisalRun {
  const schedule = buildSchedule(inputs);
  const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
  const metrics = deriveMetrics(inputs, schedule, model);
  const validation = validateInputs(inputs);
  const reconciliation = reconcile(inputs, schedule, model);
  return { inputs: inputs as CalculatorInputsV2, schedule, model, metrics, validation, reconciliation };
}

export { migrateInputs, migrateV2toV3, isV3 } from './migrate';
export { validateInputs, reconcile };
export type { ReconciliationStatus, ValidationIssue };
export * from './finance-types';
