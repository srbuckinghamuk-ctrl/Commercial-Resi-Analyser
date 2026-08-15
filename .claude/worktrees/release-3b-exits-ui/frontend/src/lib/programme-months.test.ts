import { describe, expect, it } from 'vitest';
import { formatProgrammeMonth } from './programme-months';

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
