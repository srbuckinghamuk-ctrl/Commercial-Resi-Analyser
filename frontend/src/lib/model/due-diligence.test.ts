import { describe, it, expect } from 'vitest';
import { DD_CATALOGUE, DERIVED_CODES, ENTERED_CODES } from './due-diligence';
import type { DdItemCode } from './due-diligence';

/** R15 spec §23. Twin of test_financial_model_due_diligence.py. */

// The literal table BOTH test files carry (spec §23.2). A relabelled or
// reordered entry fails here and in test_financial_model_due_diligence.py alike.
const CATALOGUE_TRIPLES: Array<[string, string, string, boolean]> = [
  ['planning_route', 'planning', 'Planning consent or prior approval', false],
  ['planning_conditions', 'planning', 'Planning conditions', false],
  ['article_4_direction', 'planning', 'Article 4 direction', false],
  ['conservation_listed', 'planning', 'Conservation area and listed status', false],
  ['cil_s106', 'planning', 'CIL and S106 liability', false],
  ['title_report', 'title_occupation', 'Report on title', false],
  ['vacant_possession', 'title_occupation', 'Vacant possession', false],
  ['leases_tenancies', 'title_occupation', 'Occupational leases and tenancies', false],
  ['rights_of_light', 'title_occupation', 'Rights of light', false],
  ['party_wall', 'title_occupation', 'Party wall', false],
  ['structural_survey', 'existing_building', 'Structural survey', false],
  ['asbestos_survey', 'existing_building', 'Asbestos survey', false],
  ['measured_survey', 'existing_building', 'Measured survey', false],
  ['higher_risk_building', 'existing_building', 'Higher-risk building confirmation', false],
  ['fire_strategy', 'existing_building', 'Fire strategy', false],
  ['acoustic_thermal', 'existing_building', 'Acoustic and thermal compliance', false],
  ['services_mande', 'existing_building', 'Services, drainage and utilities', false],
  ['cost_plan_qs', 'construction', 'QS cost plan', true],
  ['procurement_contractor', 'construction', 'Procurement and contractor', false],
  ['warranties_building_control', 'construction', 'Warranty and building control', false],
  ['insurance', 'construction', 'Insurance', false],
  ['facility_terms', 'finance', 'Facility terms', true],
  ['equity_sources', 'finance', 'Equity sources', true],
  ['sponsor_entity', 'finance', 'Sponsor entity', false],
  ['tax_basis', 'finance', 'Tax and VAT basis', true],
  ['sales_evidence', 'exit', 'Sales evidence', false],
  ['lender_valuation', 'exit', 'Lender valuation', true],
  ['exit_route_evidence', 'exit', 'Exit route evidence', false],
];

describe('DD_CATALOGUE is exactly the spec §23.2 table', () => {
  it('matches the pinned (code, category, label, derived) tuples in order', () => {
    expect(DD_CATALOGUE.map((e) => [e.code, e.category, e.label, e.derived])).toEqual(CATALOGUE_TRIPLES);
    expect(DD_CATALOGUE.length).toBe(28);
  });
});

describe('ENTERED_CODES and DERIVED_CODES partition the catalogue', () => {
  it('has 23 entered codes and the 5 named derived codes, disjoint', () => {
    expect(ENTERED_CODES.length).toBe(23);
    expect(new Set(DERIVED_CODES)).toEqual(
      new Set(['cost_plan_qs', 'facility_terms', 'equity_sources', 'tax_basis', 'lender_valuation']),
    );
    expect(ENTERED_CODES.every((c) => !(DERIVED_CODES as readonly string[]).includes(c))).toBe(true);
  });

  // Compile-time exhaustiveness pin: every non-'custom' DdItemCode must appear
  // here. Adding a code to the DdItemCode union without adding it to the
  // catalogue (or vice versa) fails `tsc`, not just a runtime assertion.
  const ALL_ENTERED: Record<Exclude<DdItemCode, 'custom'>, true> = {
    planning_route: true,
    planning_conditions: true,
    article_4_direction: true,
    conservation_listed: true,
    cil_s106: true,
    title_report: true,
    vacant_possession: true,
    leases_tenancies: true,
    rights_of_light: true,
    party_wall: true,
    structural_survey: true,
    asbestos_survey: true,
    measured_survey: true,
    higher_risk_building: true,
    fire_strategy: true,
    acoustic_thermal: true,
    services_mande: true,
    procurement_contractor: true,
    warranties_building_control: true,
    insurance: true,
    sponsor_entity: true,
    sales_evidence: true,
    exit_route_evidence: true,
  };

  it('ALL_ENTERED names exactly the ENTERED_CODES set', () => {
    expect(Object.keys(ALL_ENTERED).sort()).toEqual([...ENTERED_CODES].sort());
  });
});
