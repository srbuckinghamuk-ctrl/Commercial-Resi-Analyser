import { describe, expect, it } from 'vitest';
import { formatProgrammeMonth, programmeAnchor } from './programme-months';
import { migrateInputs, migrateInputsToV3, migrateInputsToV4 } from './model';

describe('programmeAnchor', () => {
  it('returns the anchor of an explicit programme', () => {
    const v4 = migrateInputsToV4({});
    v4.programme = {
      anchor_month: '2026-10',
      packages: {
        construction: { start_offset: 1, duration_months: 6, curve: { kind: 'straight_line' } },
        professional: { start_offset: 1, duration_months: 3, curve: { kind: 'straight_line' } },
        statutory: { start_offset: 1, duration_months: 3, curve: { kind: 'straight_line' } },
      },
    };
    expect(programmeAnchor(v4)).toBe('2026-10');
  });

  it('returns null for auto windows and for pre-v4 documents', () => {
    expect(programmeAnchor(migrateInputsToV4({}))).toBeNull();
    expect(programmeAnchor(migrateInputsToV3({}))).toBeNull();
    expect(programmeAnchor(migrateInputs({}))).toBeNull();
  });
});

describe('formatProgrammeMonth', () => {
  it('falls back to Month N without an anchor', () => {
    expect(formatProgrammeMonth(null, 0)).toBe('Month 0');
    expect(formatProgrammeMonth(undefined, 11)).toBe('Month 11');
    expect(formatProgrammeMonth('garbage', 3)).toBe('Month 3');
  });
  it('labels calendar months from an ISO yyyy-mm anchor, rolling years', () => {
    expect(formatProgrammeMonth('2026-09', 0)).toBe('Sep 2026');
    expect(formatProgrammeMonth('2026-09', 3)).toBe('Dec 2026');
    expect(formatProgrammeMonth('2026-09', 4)).toBe('Jan 2027');
    expect(formatProgrammeMonth('2026-01', 23)).toBe('Dec 2027');
  });
});
