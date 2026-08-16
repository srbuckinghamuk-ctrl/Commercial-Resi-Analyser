import { runSensitivity } from './model/sensitivity';
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
 * `runSensitivity` throws on an invalid config (spec §12.6). The investment memo
 * never reaches that — it only ever passes the fixed default config — but the
 * Sensitivity page puts the axes in the user's hands, so the throw becomes
 * reachable. CalculatorErrorBoundary would catch it, at the cost of blanking the
 * page and the axis text that caused it; a value lets the page keep its editor
 * and state the reason.
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
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
