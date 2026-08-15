import { runAppraisal } from './model';
import type { AnyCalculatorInputs, AppraisalRun } from './model';

export type SafeRunResult =
  | { ok: true; run: AppraisalRun }
  | { ok: false; error: Error };

/**
 * `runAppraisal` wrapped so a thrown engine call becomes a value.
 *
 * Deliberately lives outside `lib/model/`: this is UI resilience, not part of
 * the calculation contract, so it has (and needs) no counterpart in the Python
 * engine that `lib/model/` mirrors file-for-file.
 *
 * ConversionCalculator computes the run in its own render body, above the
 * CalculatorErrorBoundary in the tree. A React error boundary only catches
 * throws from its descendants, so an engine throw there escapes the boundary
 * entirely and unmounts the calculator — losing every unsaved edit. Returning
 * the failure instead lets the component keep its state and render a recovery
 * panel in the page body.
 *
 * Callers must not substitute a stale or default run for a failed one: spec §2
 * forbids showing a number that is not the current calculation.
 */
export function safeRunAppraisal(inputs: AnyCalculatorInputs): SafeRunResult {
  try {
    return { ok: true, run: runAppraisal(inputs) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
