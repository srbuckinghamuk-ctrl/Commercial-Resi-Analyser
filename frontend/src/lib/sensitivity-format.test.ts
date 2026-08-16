import { describe, it, expect } from 'vitest';
import {
  LEVER_LABEL, LEVER_SHORT, formatStepLabel, formatRangeLabel, flagShortCodes, unmeasuredCellNotes,
  isMeasuredBar, omittedTornadoNotes,
} from './sensitivity-format';
import type { SensitivityCell, TornadoBar } from './model/sensitivity';

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

  // F1: validateInputs emits one issue per offending element (e.g. one per phased-sales
  // tranche) and those issues carry an identical message. A single cell with three such
  // issues must not print the same sentence three times.
  it('deduplicates a single cell\'s repeated identical message down to one occurrence', () => {
    const { notes } = unmeasuredCellNotes([[cell(0, 0, TERM, TERM, TERM)]]);
    expect(notes).toEqual([TERM]);
  });
});

// Bars built by hand, not by running the suite: this tests the predicates, not the
// engine, and a literal keeps every branch reachable without hunting for a fixture.
function endpoint(profit: number | null, ...messages: string[]) {
  return {
    profit_pence: profit,
    profit_on_cost_pct: profit === null ? null : 20,
    profit_on_gdv_pct: profit === null ? null : 15,
    irr_annual_pct: profit === null ? null : 25,
    ltgdv_developer_pct: profit === null ? null : 60,
    peak_debt_pence: profit === null ? null : 5_000_000,
    flags: [],
    validation_errors: messages.map((message) => ({
      severity: 'error' as const,
      field: 'finance.term_months',
      message,
    })),
  };
}

function bar(
  lever: 'gdv' | 'construction_cost' | 'timeline' | 'interest_rate',
  low: ReturnType<typeof endpoint>,
  high: ReturnType<typeof endpoint>,
  span: number | null,
): TornadoBar {
  return { lever, low_step: -10, high_step: 10, low, high, span_pence: span };
}

describe('isMeasuredBar', () => {
  it('accepts a bar with a span', () => {
    expect(isMeasuredBar(bar('gdv', endpoint(1000), endpoint(2000), 1000))).toBe(true);
  });

  it('rejects a bar whose low endpoint was not measured', () => {
    expect(isMeasuredBar(bar('timeline', endpoint(null, 'x'), endpoint(2000), null))).toBe(false);
  });

  it('rejects a bar whose high endpoint was not measured', () => {
    expect(isMeasuredBar(bar('timeline', endpoint(1000), endpoint(null, 'x'), null))).toBe(false);
  });

  it('rejects a bar with neither endpoint measured', () => {
    expect(isMeasuredBar(bar('timeline', endpoint(null, 'x'), endpoint(null, 'x'), null))).toBe(false);
  });

  // The distinction the whole predicate exists to make: a genuine zero span is a
  // measurement, not an omission. Getting this wrong drops a real bar from the memo.
  it('accepts a genuine zero span', () => {
    expect(isMeasuredBar(bar('interest_rate', endpoint(1000), endpoint(1000), 0))).toBe(true);
  });
});

describe('omittedTornadoNotes', () => {
  const TERM = 'Term must be a whole number of months, at least 1.';
  const RATE = 'Interest rate must not be negative.';

  it('returns nothing when every bar is measured', () => {
    expect(omittedTornadoNotes([bar('gdv', endpoint(1000), endpoint(2000), 1000)])).toEqual([]);
  });

  it('carries the engine\'s own message for the omitted bar', () => {
    const notes = omittedTornadoNotes([bar('timeline', endpoint(null, TERM), endpoint(2000), null)]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Timeline omitted');
    expect(notes[0]).toContain(TERM);
    expect(notes[0]).toContain('(spec §12.7)');
  });

  // Different levers fail for entirely different reasons — an emptied term versus a
  // negative rate — which is exactly why the sentence must not be reconstructed by the
  // caller from the lever alone.
  it('gives each omitted bar its own reason, in bar order', () => {
    const notes = omittedTornadoNotes([
      bar('gdv', endpoint(1000), endpoint(2000), 1000),
      bar('timeline', endpoint(null, TERM), endpoint(2000), null),
      bar('interest_rate', endpoint(1000), endpoint(null, RATE), null),
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain(TERM);
    expect(notes[1]).toContain(RATE);
  });

  it('joins both endpoints\' reasons when neither was measured', () => {
    const notes = omittedTornadoNotes([bar('timeline', endpoint(null, TERM), endpoint(null, RATE), null)]);
    expect(notes[0]).toContain(TERM);
    expect(notes[0]).toContain(RATE);
  });

  // F1: both endpoints of a bar can fail the same rule (e.g. an emptied term rejects a
  // low and a high timeline step identically), and the engine's message is
  // byte-identical each time. The sentence must carry it once, not once per endpoint.
  it('deduplicates a bar\'s repeated identical message down to one occurrence', () => {
    const notes = omittedTornadoNotes([bar('timeline', endpoint(null, TERM), endpoint(null, TERM), null)]);
    expect(notes).toHaveLength(1);
    const occurrences = notes[0].split(TERM).length - 1;
    expect(occurrences).toBe(1);
  });
});
