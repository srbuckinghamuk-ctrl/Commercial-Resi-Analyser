import {
  runSensitivity, InvalidBaseDocumentError, InvalidSensitivityConfigError,
} from './model/sensitivity';
import type { SensitivityConfig, SensitivityResult } from './model/sensitivity';
import type { AnyCalculatorInputs } from './model';

export type SafeSensitivityResult =
  | { ok: true; result: SensitivityResult }
  | { ok: false; error: Error };

/**
 * `runSensitivity` wrapped so a thrown call becomes a value — the same pattern,
 * and the same rationale, as `safeRunAppraisal` in `safe-run.ts`. This is UI
 * resilience, not part of the calculation contract, so it lives outside
 * `lib/model/` and has no Python counterpart.
 *
 * `runSensitivity` throws on an invalid config (spec §12.6) and on a base document
 * that fails validation (spec §12.7). The investment memo only ever handles the
 * latter — it always passes the fixed default config, so §12.6 never reaches it —
 * but the Sensitivity page puts the axes in the user's hands, so both become
 * reachable here. This wrapper catches exactly those two documented failures and
 * returns each as a value, so the page keeps its axis editor and states the
 * reason instead of unmounting. Anything else thrown is a defect, not a
 * documented outcome, and is rethrown rather than absorbed: rendering it in a
 * panel that asserts "the suite could not be calculated" would assert a cause
 * this wrapper has not established. CalculatorErrorBoundary is where that defect
 * belongs — it is the surface every other calculator page uses for a genuine
 * fault.
 *
 * Note what this does NOT cover: a *valid* config whose timeline step drives
 * finance.term_months to zero or below does not throw either. Since R5 (spec
 * §12.7), that levered document fails validation and the position comes back
 * unmeasured (null metrics, populated `validation_errors`) rather than throwing
 * or being silently clamped — see safe-sensitivity.test.ts. SensitivityPage
 * renders that position rather than refusing the whole grid over it.
 *
 * Callers must not substitute a stale or default grid for a failed one: spec §2
 * forbids showing a number that is not the current calculation.
 */
export function safeRunSensitivity(
  inputs: AnyCalculatorInputs,
  config?: SensitivityConfig,
): SafeSensitivityResult {
  try {
    return { ok: true, result: config ? runSensitivity(inputs, config) : runSensitivity(inputs) };
  } catch (error) {
    // R6: only the suite's two documented failures (§12.6 config, §12.7 base document)
    // become values. Anything else is a defect: absorbing it here would render it in a
    // panel that says the inputs did not describe a runnable suite — a cause this
    // wrapper has not established — and would keep it away from
    // CalculatorErrorBoundary, where every other calculator page sends a genuine fault.
    if (
      error instanceof InvalidSensitivityConfigError
      || error instanceof InvalidBaseDocumentError
    ) {
      return { ok: false, error };
    }
    throw error;
  }
}
