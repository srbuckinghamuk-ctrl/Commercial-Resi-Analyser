import type { AnyCalculatorInputs, ProgrammeNetwork } from './finance-types';
import type { SpendCurve } from './curves';
import { curveWeights } from './curves';
import { derivePhases, isProgrammeNetwork, isLegacyProgramme } from './programme';
import { resolvedPhaseId } from './schedule';

/** R15b spec §24.2. A package's place in time, resolved once and read by both
 *  computeCostPlan (midpoint → inflation) and buildSchedule (per-month share). */
export interface PackageTiming {
  id: string;
  /** The resolved phase in a network; null on the auto and legacy arms. */
  phase_id: string | null;
  start_month: number;
  finish_month: number;      // half-open, §18.2
  duration_months: number;   // >= 1
  curve: SpendCurve;
  weights: number[];         // curveWeights(duration_months, curve)
  /** start_month + Σ_k weights[k] × k, the fractional part rounded to 12 dp so
   *  a straight-line window's midpoint is exact and a whole-month floor
   *  downstream is not defeated by an ulp (spec §24.2). */
  midpoint_month: number;
}

/** R15b spec §24.2. One entry per `cost_plan.packages[]`, in order — the only
 *  place a package's window is resolved. `[]` when the document has no
 *  `cost_plan` or no packages (headline mode). */
export function computePackageTiming(inputs: AnyCalculatorInputs): PackageTiming[] {
  const packages = 'cost_plan' in inputs && inputs.cost_plan != null ? inputs.cost_plan.packages : [];
  if (packages.length === 0) return [];
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const rawProgramme = 'programme' in inputs ? inputs.programme : null;
  const network: ProgrammeNetwork | null = rawProgramme != null && isProgrammeNetwork(rawProgramme) ? rawProgramme : null;
  const legacy = rawProgramme != null && isLegacyProgramme(rawProgramme) ? rawProgramme : null;
  const derivation = network != null ? derivePhases(network) : null;
  const phaseById = network != null ? new Map(network.phases.map((p) => [p.id, p])) : null;

  return packages.map((pkg) => {
    let phaseId: string | null = null;
    let start: number; let duration: number; let curve: SpendCurve;
    if (network != null) {
      phaseId = resolvedPhaseId(pkg.phase_id ?? null, 'construction', network);
      // Mirrors schedule.ts's placeInPhase degrade: unreachable post-validation.
      const derived = derivation != null && !('cycle' in derivation) ? derivation.byId[phaseId] : undefined;
      start = derived?.start_month ?? 0;
      duration = Math.max(1, derived?.duration_months ?? 1);
      curve = phaseById?.get(phaseId)?.curve ?? { kind: 'straight_line' };
    } else if (legacy != null) {
      start = legacy.packages.construction.start_offset;
      duration = Math.max(1, Math.floor(legacy.packages.construction.duration_months));
      curve = legacy.packages.construction.curve;
    } else if (term === 1) {
      start = 0; duration = 1; curve = { kind: 'straight_line' };
    } else {
      start = 1; duration = Math.max(1, term - 2); curve = { kind: 'straight_line' };
    }
    const weights = curveWeights(duration, curve);
    // The start is folded in ONCE, outside the accumulation, and the
    // fractional part rounded to 12 dp: summing weights[k] × (start + k)
    // directly (start folded in on every term) accumulates 1/D-style binary
    // rounding error start times over, which can land a whole-month window's
    // midpoint one ulp off its exact value — defeating a downstream
    // `Math.floor` on `months_from_base` (spec §24.2, controller ruling).
    const frac = weights.reduce((s, w, k) => s + w * k, 0);
    const midpoint = start + Math.round(frac * 1e12) / 1e12;
    return {
      id: pkg.id, phase_id: phaseId, start_month: start, finish_month: start + duration,
      duration_months: duration, curve, weights, midpoint_month: midpoint,
    };
  });
}
