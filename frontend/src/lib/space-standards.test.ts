import { describe, it, expect } from 'vitest';
import { checkSpaceStandards, suggestUnitMix, NDSS_MINIMUM_SQM } from './space-standards';
import type { ProposedUnit } from './conversion-types';

function unit(overrides: Partial<ProposedUnit>): ProposedUnit {
  return {
    id: 'u1',
    type: '1bed',
    floor_area_sqm: 50,
    estimated_value_pence: 20_000_000,
    comparable_notes: '',
    ...overrides,
  };
}

describe('checkSpaceStandards', () => {
  it('passes units at or above the minimum', () => {
    expect(checkSpaceStandards([unit({ floor_area_sqm: 50 })])).toHaveLength(0);
    expect(checkSpaceStandards([unit({ type: 'studio', floor_area_sqm: 37 })])).toHaveLength(0);
  });

  it('flags undersized units per type', () => {
    const issues = checkSpaceStandards([
      unit({ id: 'a', type: '1bed', floor_area_sqm: 46 }),
      unit({ id: 'b', type: '2bed', floor_area_sqm: 55 }),
      unit({ id: 'c', type: '3bed', floor_area_sqm: 74 }),
    ]);
    expect(issues.map((i) => i.unitId)).toEqual(['a', 'b']);
  });

  it('ignores zero-area (not yet entered) units', () => {
    expect(checkSpaceStandards([unit({ floor_area_sqm: 0 })])).toHaveLength(0);
  });
});

describe('suggestUnitMix', () => {
  it('returns nothing for a building too small for any unit', () => {
    expect(suggestUnitMix(30)).toHaveLength(0);
  });

  it('produces only NDSS-compliant units', () => {
    const mix = suggestUnitMix(500);
    expect(mix.length).toBeGreaterThan(0);
    for (const u of mix) {
      expect(u.floor_area_sqm).toBeGreaterThanOrEqual(NDSS_MINIMUM_SQM[u.type]);
    }
  });

  it('keeps the total within the net area', () => {
    const gross = 400;
    const mix = suggestUnitMix(gross);
    const total = mix.reduce((s, u) => s + u.floor_area_sqm, 0);
    expect(total).toBeLessThanOrEqual(gross * 0.85);
  });
});
