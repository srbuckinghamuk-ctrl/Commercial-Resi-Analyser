export function npvAt(cashflows: number[], rate: number): number {
  let npv = 0;
  for (let t = 0; t < cashflows.length; t++) {
    npv += cashflows[t] / Math.pow(1 + rate, t);
  }
  return npv;
}

const LOWER = -0.99;
const UPPER = 10; // 1000% per period — beyond any sane monthly equity return

/**
 * Periodic IRR of a cash-flow vector (index = period). Returns a decimal rate
 * (0.01 = 1% per period) or null when no root exists in (−99%, 1000%].
 * Newton–Raphson first; bisection fallback. Spec §3.17.
 */
export function solveIrr(cashflows: number[]): number | null {
  if (cashflows.length < 2) return null;
  const hasNegative = cashflows.some((c) => c < 0);
  const hasPositive = cashflows.some((c) => c > 0);
  if (!hasNegative || !hasPositive) return null;

  // Newton–Raphson
  let guess = 0.01;
  for (let i = 0; i < 1000; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const factor = Math.pow(1 + guess, t);
      npv += cashflows[t] / factor;
      if (t > 0) dnpv -= (t * cashflows[t]) / Math.pow(1 + guess, t + 1);
    }
    if (Math.abs(dnpv) < 1e-15) break;
    const next = guess - npv / dnpv;
    if (!Number.isFinite(next) || next <= LOWER || next > UPPER) break;
    if (Math.abs(next - guess) < 1e-9) {
      return Math.abs(npvAt(cashflows, next)) < 1e-3 ? next : null;
    }
    guess = next;
  }

  // Bisection fallback over (LOWER, UPPER]
  let lo = LOWER + 1e-9;
  let hi = UPPER;
  let fLo = npvAt(cashflows, lo);
  const fHi = npvAt(cashflows, hi);
  if (fLo * fHi > 0) return null; // no sign change — no root in bracket
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(cashflows, mid);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (fLo * fMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
