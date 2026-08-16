import { describe, it, expect } from 'vitest';
import {
  LEVER_LABEL, LEVER_SHORT, formatStepLabel, formatRangeLabel, flagShortCodes, isUnsoundTornadoBar,
} from './sensitivity-format';

describe('sensitivity-format', () => {
  // The short labels are load-bearing: they reproduce the memo's historical
  // axis captions ("GDV -15%", "Cost +0%") exactly, so the §10 regression pin
  // in export-investment-memo.test.ts keeps passing.
  it('reproduces the memo axis captions', () => {
    expect(`${LEVER_SHORT.gdv} ${formatStepLabel('gdv', -15)}`).toBe('GDV -15%');
    expect(`${LEVER_SHORT.gdv} ${formatStepLabel('gdv', 0)}`).toBe('GDV +0%');
    expect(`${LEVER_SHORT.construction_cost} ${formatStepLabel('construction_cost', -5)}`).toBe('Cost -5%');
    expect(`${LEVER_SHORT.construction_cost} ${formatStepLabel('construction_cost', 15)}`).toBe('Cost +15%');
  });

  it('formats each lever in its own unit (spec §12.1)', () => {
    expect(formatStepLabel('timeline', -3)).toBe('-3 months');
    expect(formatStepLabel('timeline', 3)).toBe('+3 months');
    expect(formatStepLabel('interest_rate', -1)).toBe('-1.0 pp');
    expect(formatStepLabel('interest_rate', 1.5)).toBe('+1.5 pp');
  });

  it('formats a tornado range with the unit stated once', () => {
    expect(formatRangeLabel('gdv', -10, 10)).toBe('-10% to +10%');
    expect(formatRangeLabel('timeline', -3, 3)).toBe('-3 to +3 months');
    expect(formatRangeLabel('interest_rate', -1, 1)).toBe('-1.0 to +1.0 pp');
  });

  it('gives every lever a readable long label', () => {
    expect(LEVER_LABEL.gdv).toBe('GDV');
    expect(LEVER_LABEL.construction_cost).toBe('Construction cost');
    expect(LEVER_LABEL.timeline).toBe('Timeline');
    expect(LEVER_LABEL.interest_rate).toBe('Interest rate');
  });

  // The FE/FG/NR order is fixed, not the engine's flag order — the memo has
  // always printed them in this sequence and the §10 pin depends on it.
  it('emits flag short codes in the fixed FE, FG, NR order', () => {
    expect(flagShortCodes([])).toBe('');
    expect(flagShortCodes(['funding_gap'])).toBe('FG');
    expect(flagShortCodes(['senior_outstanding_at_maturity', 'facility_exceeded', 'funding_gap']))
      .toBe('FE,FG,NR');
  });

  it('ignores flag codes that have no short form', () => {
    expect(flagShortCodes(['requires_confirmation', 'funding_gap'])).toBe('FG');
  });
});

// Shared by export-investment-memo.ts and SensitivityPage.tsx (finding 1/2 of
// the R4b final review): the engine clamps a term-emptying timeline step to
// one month instead of rejecting it (safe-sensitivity.test.ts pins this), so
// a tornado bar with a clamping endpoint is unsound and both surfaces must
// agree on exactly when that is.
describe('isUnsoundTornadoBar', () => {
  it('is sound for a non-timeline lever regardless of term', () => {
    expect(isUnsoundTornadoBar(1, { lever: 'gdv', low_step: -100, high_step: 100 })).toBe(false);
    expect(isUnsoundTornadoBar(0, { lever: 'interest_rate', low_step: -50, high_step: 50 })).toBe(false);
  });

  it('is sound for a timeline bar whose endpoints both leave at least one month', () => {
    expect(isUnsoundTornadoBar(12, { lever: 'timeline', low_step: -3, high_step: 3 })).toBe(false);
    // Exactly one month remaining is the floor, not past it.
    expect(isUnsoundTornadoBar(4, { lever: 'timeline', low_step: -3, high_step: 3 })).toBe(false);
  });

  it('is unsound when the low endpoint would clamp the term below one month', () => {
    expect(isUnsoundTornadoBar(3, { lever: 'timeline', low_step: -3, high_step: 3 })).toBe(true);
    expect(isUnsoundTornadoBar(1, { lever: 'timeline', low_step: -3, high_step: 3 })).toBe(true);
  });

  it('is unsound when the high endpoint would clamp the term below one month', () => {
    // A tornado range need not be ordered "low is the risky end" — the check is
    // per-endpoint. Here the low step is comfortably positive but the high step
    // is the one that empties the term.
    expect(isUnsoundTornadoBar(2, { lever: 'timeline', low_step: 5, high_step: -2 })).toBe(true);
  });
});
