import { spreadStraightLine } from './schedule';

/** Spend-curve discriminated union (spec §6.1, calc 2.2.0). Re-exported via
 * finance-types.ts once inputs v4 lands (Task 3). */
export type SpendCurve =
  | { kind: 'straight_line' | 's_curve' | 'back_loaded' }
  | { kind: 'user_defined'; weights: number[] };

/** Spread by ideal per-month fractions: month k = round_half_up(total·w_k),
 * final month absorbs the residue (spec §6.1 invariant). */
function spreadByWeights(total: number, idealWeights: number[]): number[] {
  const D = idealWeights.length;
  if (D === 0) return [];
  const out: number[] = new Array(D);
  let allocated = 0;
  for (let i = 0; i < D - 1; i++) {
    out[i] = Math.round(total * idealWeights[i]);
    allocated += out[i];
  }
  out[D - 1] = total - allocated;
  return out;
}

/** Raised-cosine S-curve: cumulative W(k) = (1 − cos(πk/D)) / 2. */
export function spreadSCurve(total: number, months: number): number[] {
  if (months <= 0) return [];
  const weights: number[] = [];
  let prev = 0;
  for (let k = 1; k <= months; k++) {
    const cum = (1 - Math.cos((Math.PI * k) / months)) / 2;
    weights.push(cum - prev);
    prev = cum;
  }
  return spreadByWeights(total, weights);
}

/** Linear ramp: w_k = 2k / (D(D+1)). */
export function spreadBackLoaded(total: number, months: number): number[] {
  if (months <= 0) return [];
  const weights = Array.from({ length: months }, (_, i) => (2 * (i + 1)) / (months * (months + 1)));
  return spreadByWeights(total, weights);
}

/** Normalised explicit weights. Callers validate length/non-negativity/sum
 * (validation.ts, Task 5) — this function assumes valid input. */
export function spreadUserDefined(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  return spreadByWeights(total, weights.map((w) => w / sum));
}

export function spreadByCurve(total: number, durationMonths: number, curve: SpendCurve): number[] {
  // CRITICAL 1c: durationMonths comes from a ProgrammePackage; validation.ts
  // rejects a fractional value, but this is the single dispatch point every
  // curve kind funnels through, so floor it here defensively — spreadStraightLine's
  // `new Array(months)` throws RangeError for a non-integer length (e.g. 2.5),
  // which would otherwise crash a render-time useMemo. Integer durations are
  // unaffected (Math.floor is a no-op on them).
  const months = Math.floor(durationMonths);
  switch (curve.kind) {
    case 'straight_line': return spreadStraightLine(total, months);
    case 's_curve': return spreadSCurve(total, months);
    case 'back_loaded': return spreadBackLoaded(total, months);
    case 'user_defined': return spreadUserDefined(total, curve.weights);
  }
}
