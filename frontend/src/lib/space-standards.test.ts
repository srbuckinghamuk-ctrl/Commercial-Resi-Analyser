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

  it('tests NDSS against internal NIA only, never ancillary area', () => {
    // A 45 m² 1-bed with a 10 m² balcony is still below the 50 m² NDSS minimum
    // and still undeliverable. Letting balcony area into this check would turn
    // failing units into passing ones.
    const issues = checkSpaceStandards([{
      id: 'u1', type: '1bed', floor_area_sqm: 45, estimated_value_pence: 1, comparable_notes: '',
      ancillary: { balcony_terrace_sqm: 10, balcony_terrace_value_pence: 0, parking_spaces: 0, parking_value_pence: 0 },
    } as never]);
    expect(issues).toHaveLength(1);
    expect(issues[0].unitId).toBe('u1');
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
