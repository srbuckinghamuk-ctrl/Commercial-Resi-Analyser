import type { AppraisalResultV2, CalculatorInputsV2, MonthlyModel, Schedule } from './finance-types';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { deriveMetrics } from './metrics';
import { reconcile, validateInputs } from './validation';
import type { ReconciliationStatus, ValidationIssue } from './validation';

export interface AppraisalRun {
  inputs: CalculatorInputsV2;
  schedule: Schedule;
  model: MonthlyModel;
  metrics: AppraisalResultV2;
  validation: ValidationIssue[];
  reconciliation: ReconciliationStatus;
}

/** The only entry point UI/report/backend-parity code may use. */
export function runAppraisal(inputs: CalculatorInputsV2): AppraisalRun {
  const schedule = buildSchedule(inputs);
  const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
  const metrics = deriveMetrics(inputs, schedule, model);
  const validation = validateInputs(inputs);
  const reconciliation = reconcile(inputs, schedule, model);
  return { inputs, schedule, model, metrics, validation, reconciliation };
}

export { migrateInputs } from './migrate';
export { validateInputs, reconcile };
export type { ReconciliationStatus, ValidationIssue };
export * from './finance-types';
