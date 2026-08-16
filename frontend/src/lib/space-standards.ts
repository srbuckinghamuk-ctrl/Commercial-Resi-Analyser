import type { ProposedUnit, UnitType } from './conversion-types';

/**
 * Nationally Described Space Standard minimum gross internal areas (m²)
 * for single-storey flats, at the smallest occupancy for each unit type.
 * NDSS compliance is mandatory for residential units delivered under
 * permitted development since 6 April 2021.
 */
export const NDSS_MINIMUM_SQM: Record<UnitType, number> = {
  studio: 37, // 1 person with shower room (39 with bathroom)
  '1bed': 50, // 1 bed 2 person
  '2bed': 61, // 2 bed 3 person (70 for 2b4p)
  '3bed': 74, // 3 bed 4 person (86 for 3b5p)
};

export interface SpaceStandardIssue {
  unitId: string;
  message: string;
}

/** Units below the NDSS minimum for their type — these are undeliverable under PD. */
export function checkSpaceStandards(units: ProposedUnit[]): SpaceStandardIssue[] {
  const issues: SpaceStandardIssue[] = [];
  for (const unit of units) {
    const minimum = NDSS_MINIMUM_SQM[unit.type];
    if (unit.floor_area_sqm > 0 && unit.floor_area_sqm < minimum) {
      issues.push({
        unitId: unit.id,
        message: `Below the ${minimum} m² NDSS minimum for a ${unit.type === 'studio' ? 'studio' : unit.type.replace('bed', '-bed')} — not deliverable under permitted development`,
      });
    }
  }
  return issues;
}

/**
 * Suggest a deliverable unit mix from the building's gross internal area.
 * Assumes ~85% net-to-gross efficiency for a conversion, then fills with a
 * mix of 1-beds and 2-beds at NDSS-compliant sizes. Returns unit templates
 * (no ids/values) — the caller assigns ids and pricing.
 */
export function suggestUnitMix(grossInternalSqm: number): { type: UnitType; floor_area_sqm: number }[] {
  const net = grossInternalSqm * 0.85;
  if (net < NDSS_MINIMUM_SQM.studio) return [];

  const ONE_BED = 52;
  const TWO_BED = 65;
  const suggestions: { type: UnitType; floor_area_sqm: number }[] = [];
  let remaining = net;

  // Alternate 2-beds and 1-beds while space allows, favouring 1-beds
  // (the deepest demand for conversions).
  while (remaining >= ONE_BED) {
    if (suggestions.length % 3 === 2 && remaining >= TWO_BED) {
      suggestions.push({ type: '2bed', floor_area_sqm: TWO_BED });
      remaining -= TWO_BED;
    } else {
      suggestions.push({ type: '1bed', floor_area_sqm: ONE_BED });
      remaining -= ONE_BED;
    }
  }
  if (remaining >= NDSS_MINIMUM_SQM.studio) {
    suggestions.push({ type: 'studio', floor_area_sqm: Math.floor(remaining) });
  }
  return suggestions;
}
