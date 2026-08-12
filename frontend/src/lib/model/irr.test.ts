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

  it('falls back to bisection when Newton diverges and still finds a root', () => {
    // Steep, ill-conditioned flow that defeats a naive Newton start
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
});
