import { describe, it, expect } from 'vitest';
import {
  LEVER_LABEL, LEVER_SHORT, formatStepLabel, formatRangeLabel, flagShortCodes,
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
