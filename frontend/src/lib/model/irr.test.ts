import { describe, it, expect } from 'vitest';
import { solveIrr, npvAt } from './irr';

describe('solveIrr', () => {
  it('solves a simple two-flow case exactly', () => {
    // -100 now, +110 in one period → 10%
    const irr = solveIrr([-100, 110]);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(0.10, 8);
  });

  it('solves multi-contribution flows and NPV at the root is ~0', () => {
    const flows = [-10_000_000, -15_000_000, -5_000_000, 40_490_776];
    const irr = solveIrr(flows);
    expect(irr).not.toBeNull();
    expect(Math.abs(npvAt(flows, irr!))).toBeLessThan(1); // < 1 penny
  });

  it('returns null when all flows are negative (retain_all, no distributions)', () => {
    expect(solveIrr([-100, -50, -25])).toBeNull();
  });

  it('returns null when all flows are positive', () => {
    expect(solveIrr([100, 50])).toBeNull();
  });

  it('returns null for empty or single-entry vectors', () => {
    expect(solveIrr([])).toBeNull();
    expect(solveIrr([-100])).toBeNull();
  });

  it('solves steep multi-period flows with large scale disparities', () => {
    // Steep flow with 11 periods between outflow and inflow; Newton converges within bounds.
    // Tests that solver handles scale disparities without diverging out of bounds.
    const flows = [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1_000_000];
    const irr = solveIrr(flows);
    expect(irr).not.toBeNull();
    expect(Math.abs(npvAt(flows, irr!))).toBeLessThan(1e-6);
  });

  it('handles a deeply negative but valid IRR', () => {
    const irr = solveIrr([-100, 10]); // −90% per period
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(-0.9, 6);
  });

  it('falls through to bisection when Newton converges but fails NPV acceptance: regression', () => {
    // Regression test for critical fix: when Newton step converges (|next - guess| < 1e-9)
    // but NPV acceptance fails (|npvAt| >= 1e-3), code breaks to bisection instead of returning null.
    // This vector (found via instrumented search, seed 1) exercises that exact path: Newton
    // converges after 46 iterations to a point with bad NPV, then bisection finds the true root.
    // Severe-loss shape: large negative flows with eventual recovery.
    const flows = [-1000000, -69877, -75005, 139568];
    const irr = solveIrr(flows);
    expect(irr).not.toBeNull();
    // On steep NPV curves, absolute residual can be large while rate is accurate (±1e-6 bracket).
    // Assert rate precision via sign-change bracketing: npvAt must change sign within ±1e-6.
    const npvMinus = npvAt(flows, irr! - 1e-6);
    const npvPlus = npvAt(flows, irr! + 1e-6);
    expect(npvMinus * npvPlus).toBeLessThanOrEqual(0); // Sign change → root bracketed within ±1e-6
  });
});
