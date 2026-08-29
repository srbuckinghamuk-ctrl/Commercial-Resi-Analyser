import {
  runSensitivity, InvalidBaseDocumentError, InvalidSensitivityConfigError,
} from './model/sensitivity';
import type { SensitivityConfig, SensitivityLever, SensitivityResult } from './model/sensitivity';
import { runStressPack } from './model/stress-pack';
import type { StressPackResult } from './model/stress-pack';
import type { AnyCalculatorInputs } from './model';
import type { ScenarioOverrides } from './conversion-types';

export type SafeSensitivityResult =
  | { ok: true; result: SensitivityResult }
  | { ok: false; error: Error };

export type SafeStressPackResult =
  | { ok: true; result: StressPackResult }
  | { ok: false; error: Error };

/**
 * The lever -> `ScenarioOverrides` field map, shared by the Scenarios page and
 * the investment memo (R16 spec §25). `phase_slip` is excluded: it carries a
 * target phase id alongside its magnitude (`phase_slip_phase_id` /
 * `phase_slip_months`), so a single `keyof ScenarioOverrides` cannot name its
 * field the way it can every other lever's.
 *
 * Typed as a `Record` over `Exclude<SensitivityLever, 'phase_slip'>` rather than
 * a partial map, so adding a fourteenth lever to `SensitivityLever` without
 * adding it here is a compile error, not a silent gap a caller discovers at
 * runtime.
 */
export const SCENARIO_FIELD: Record<Exclude<SensitivityLever, 'phase_slip'>, keyof ScenarioOverrides> = {
  gdv: 'gdv_adjustment_pct',
  construction_cost: 'construction_cost_adjustment_pct',
  timeline: 'timeline_adjustment_months',
  interest_rate: 'interest_rate_adjustment_pct',
  exit_yield: 'exit_yield_adjustment_pct',
  operating_cost: 'operating_cost_adjustment_pct',
  vacancy: 'vacancy_adjustment_pct',
  sales_slip: 'sales_slip_months',
  saleable_area: 'saleable_area_adjustment_pct',
  abnormal_cost: 'abnormal_cost_adjustment_pct',
  programme_slip: 'programme_slip_months',
  refi_ltv: 'refi_ltv_adjustment_pct',
};

/**
 * `runSensitivity` wrapped so a thrown call becomes a value — the same pattern,
 * and the same rationale, as `safeRunAppraisal` in `safe-run.ts`. This is UI
 * resilience, not part of the calculation contract, so it lives outside
 * `lib/model/` and has no Python counterpart.
 *
 * `runSensitivity` throws on an invalid config (spec §12.6) and on a base document
 * that fails validation (spec §12.7). The investment memo only ever handles the
 * latter — it always passes the fixed default config, so §12.6 never reaches it.
 * The Sensitivity page puts the axes in the user's hands, but it also runs
 * `validateSensitivityConfig` on the same config itself and early-returns to its
 * own panel before ever calling this wrapper (SensitivityPage.tsx), so in normal
 * operation §12.6 does not reach here either — the `InvalidSensitivityConfigError`
 * branch below is defence-in-depth against that duplicated check drifting, not a
 * path either caller exercises live. This wrapper catches both documented failures
 * and returns each as a value, so the page keeps its axis editor and states the
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

/**
 * `runStressPack` wrapped the same way `safeRunSensitivity` wraps
 * `runSensitivity`, and for the same reason: the Sensitivity page needs a
 * value it can render a panel from, not an unmount. The stress pack has no
 * config of its own (spec §25.2's nine cells are fixed and normative), so the
 * only documented failure is `InvalidBaseDocumentError` (§12.7, via
 * `sensitivity.measure`) -- there is no `InvalidSensitivityConfigError`
 * counterpart to catch. Anything else thrown is a defect and is rethrown, not
 * absorbed, for the same reason `safeRunSensitivity` rethrows: a panel that
 * says "could not be calculated" must not assert a cause this wrapper has not
 * established.
 */
export function safeRunStressPack(inputs: AnyCalculatorInputs): SafeStressPackResult {
  try {
    return { ok: true, result: runStressPack(inputs) };
  } catch (error) {
    if (error instanceof InvalidBaseDocumentError) {
      return { ok: false, error };
    }
    throw error;
  }
}
