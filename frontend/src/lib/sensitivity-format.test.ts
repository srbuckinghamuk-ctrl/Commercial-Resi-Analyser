import { describe, it, expect } from 'vitest';
import {
  LEVER_LABEL, LEVER_SHORT, formatStepLabel, formatRangeLabel, flagShortCodes, unmeasuredCellNotes,
} from './sensitivity-format';
import type { SensitivityCell } from './model/sensitivity';

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

// A cell built by hand rather than by running the suite: this tests the note builder,
// not the engine, and a literal keeps the failure modes visible.
function cell(row: number, col: number, ...messages: string[]): SensitivityCell {
  return {
    row_step: row,
    col_step: col,
    profit_pence: messages.length ? null : 1_000_000,
    profit_on_cost_pct: messages.length ? null : 20,
    profit_on_gdv_pct: messages.length ? null : 15,
    irr_annual_pct: messages.length ? null : 25,
    ltgdv_developer_pct: messages.length ? null : 60,
    peak_debt_pence: messages.length ? null : 5_000_000,
    flags: [],
    validation_errors: messages.map((message) => ({
      severity: 'error' as const,
      field: 'finance.term_months',
      message,
    })),
  };
}

describe('unmeasuredCellNotes', () => {
  const TERM = 'Term must be a whole number of months, at least 1.';
  const TRANCHE = 'A sale tranche falls outside the programme term.';

  it('returns no notes for a fully measured grid', () => {
    const { notes } = unmeasuredCellNotes([[cell(0, 0), cell(0, 5)]]);
    expect(notes).toEqual([]);
  });

  it('gives a measured cell no note index', () => {
    const measured = cell(0, 0);
    const { noteIndexFor } = unmeasuredCellNotes([[measured, cell(0, 5)]]);
    expect(noteIndexFor(measured)).toBeNull();
  });

  // The common case: one lever position invalidates a whole row for one reason. A
  // per-cell note list would print the same sentence five times.
  it('deduplicates one reason shared across many cells into a single note', () => {
    const { notes, noteIndexFor } = unmeasuredCellNotes([
      [cell(-12, 0, TERM), cell(-12, 5, TERM), cell(-12, 10, TERM)],
    ]);
    expect(notes).toEqual([TERM]);
    expect(noteIndexFor(cell(-12, 5, TERM))).toBe(0);
  });

  it('keeps distinct reasons as separate notes, in first-appearance order', () => {
    const { notes, noteIndexFor } = unmeasuredCellNotes([
      [cell(0, 0), cell(0, 5, TRANCHE)],
      [cell(-12, 0, TERM), cell(-12, 5, TERM)],
    ]);
    // Row-major scan reaches TRANCHE first even though TERM's row is "worse".
    expect(notes).toEqual([TRANCHE, TERM]);
    expect(noteIndexFor(cell(0, 5, TRANCHE))).toBe(0);
    expect(noteIndexFor(cell(-12, 0, TERM))).toBe(1);
  });

  // The case above alone doesn't distinguish first-appearance order from an
  // alphabetizing bug, because TRANCHE ("A sale...") happens to sort before TERM
  // ("Term...") too. Here the first-appearing reason sorts alphabetically *after*
  // the second, so only genuine first-appearance order — not a sort — passes.
  it('does not alphabetize the notes', () => {
    const AREA = 'Area cannot be negative.';
    const { notes } = unmeasuredCellNotes([
      [cell(0, 0, TERM)],
      [cell(-12, 0, AREA)],
    ]);
    expect(notes).toEqual([TERM, AREA]);
  });

  // A cell can carry more than one error-severity issue; the note is the whole reason,
  // joined the same way the tornado's omission sentences join theirs.
  it('joins a cell\'s several validation errors into one note', () => {
    const { notes } = unmeasuredCellNotes([[cell(-12, 0, TERM, TRANCHE)]]);
    expect(notes).toEqual([`${TERM} ${TRANCHE}`]);
  });

  // noteIndexFor is keyed on the reason, not on object identity — the memo and the page
  // hold different cell objects for the same position across re-renders.
  it('resolves a note index by reason rather than by object identity', () => {
    const { noteIndexFor } = unmeasuredCellNotes([[cell(-12, 0, TERM)]]);
    expect(noteIndexFor(cell(-99, 99, TERM))).toBe(0);
  });
});
