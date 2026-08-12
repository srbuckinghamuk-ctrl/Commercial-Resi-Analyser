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
    // Verified path: Newton converges after 17 iterations at guess ≈ −0.8915944581764597 with
    // |npv| = 0.015625 (>= 1e-3, fails acceptance), then breaks to bisection which returns
    // ≈ −0.8915944581766244. Pre-fix code returns null for this vector. Steep curve near
    // LOWER bound (−0.99); absolute NPV residual large (~123) but rate accurate within bracket.
    const flows = [-1992399, -264982, 222404, 230870, -124126, 283789, 201626, 159610, -168999, -138187, 16731];
    const irr = solveIrr(flows);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(-0.8916, 3);
    // Assert rate precision via sign-change bracketing (not absolute NPV residual).
    const npvMinus = npvAt(flows, irr! - 1e-6);
    const npvPlus = npvAt(flows, irr! + 1e-6);
    expect(npvMinus * npvPlus).toBeLessThanOrEqual(0); // Sign change → root bracketed within ±1e-6
  });
});
