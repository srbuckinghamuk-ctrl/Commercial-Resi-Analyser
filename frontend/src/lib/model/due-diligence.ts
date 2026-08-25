/**
 * R15 spec §23. The due-diligence evidence schedule. Twin of
 * app/financial_model/due_diligence.py. Task 1 declares types and the
 * catalogue; Task 3 adds the derivation.
 */
export type DdCategory = 'planning' | 'title_occupation' | 'existing_building' | 'construction' | 'finance' | 'exit';
export const DD_CATEGORIES: readonly DdCategory[] =
  ['planning', 'title_occupation', 'existing_building', 'construction', 'finance', 'exit'];
export type DdStatus = 'red' | 'amber' | 'green' | 'unknown' | 'not_applicable';
export const DD_STATUSES: readonly DdStatus[] = ['red', 'amber', 'green', 'unknown', 'not_applicable'];
export type DdItemCode =
  | 'planning_route' | 'planning_conditions' | 'article_4_direction' | 'conservation_listed' | 'cil_s106'
  | 'title_report' | 'vacant_possession' | 'leases_tenancies' | 'rights_of_light' | 'party_wall'
  | 'structural_survey' | 'asbestos_survey' | 'measured_survey' | 'higher_risk_building'
  | 'fire_strategy' | 'acoustic_thermal' | 'services_mande'
  | 'procurement_contractor' | 'warranties_building_control' | 'insurance' | 'sponsor_entity'
  | 'sales_evidence' | 'exit_route_evidence' | 'custom';
export type DdDerivedCode = 'cost_plan_qs' | 'facility_terms' | 'equity_sources' | 'tax_basis' | 'lender_valuation';

export interface DdEvidence { source: string; reference: string; date: string; }

export interface DdItem {
  id: string;
  code: DdItemCode;
  category: DdCategory;
  label: string;
  status: DdStatus;
  evidence: DdEvidence | null;
  expiry_date: string | null;
  owner: string;
  due_date: string | null;
  cost_impact_pence: number | null;
  programme_impact_months: number | null;
  action: string;
  notes: string;
}

export interface SourceRecord {
  captured_at: string;
  source_name: string | null;
  source_url: string | null;
  is_vacant: boolean | null;
  tenure: 'freehold' | 'leasehold' | 'unknown' | null;
  lease_years_remaining: number | null;
  floor_area_sqm: number | null;
  use_class: string | null;
  epc_rating: string | null;
}

export interface DueDiligenceInputs {
  source_record: SourceRecord | null;
  items: DdItem[];
}

export interface DdCatalogueEntry {
  code: DdItemCode | DdDerivedCode;
  category: DdCategory;
  label: string;
  derived: boolean;
  /** Editor help text — UI only, NOT part of the cross-engine identity. */
  prompt: string;
}

/** Spec §23.2, normative and ORDERED. Pinned byte-identical (code, category,
 *  label, derived) against due_diligence.py. */
export const DD_CATALOGUE: readonly DdCatalogueEntry[] = [
  { code: 'planning_route', category: 'planning', label: 'Planning consent or prior approval', derived: false,
    prompt: 'Reference, decision date and lapse date of the consent or prior approval the scheme relies on.' },
  { code: 'planning_conditions', category: 'planning', label: 'Planning conditions', derived: false,
    prompt: 'Pre-commencement and other conditions, and evidence of discharge for each.' },
  { code: 'article_4_direction', category: 'planning', label: 'Article 4 direction', derived: false,
    prompt: 'Whether an Article 4 direction removes permitted development rights the scheme relies on.' },
  { code: 'conservation_listed', category: 'planning', label: 'Conservation area and listed status', derived: false,
    prompt: 'Conservation area designation and listed building status or grade, if any.' },
  { code: 'cil_s106', category: 'planning', label: 'CIL and S106 liability', derived: false,
    prompt: 'CIL liability notice and S106 obligations, and whether they are reflected in the cost plan.' },
  { code: 'title_report', category: 'title_occupation', label: 'Report on title', derived: false,
    prompt: 'The solicitor report on title: easements, covenants and any defects affecting the scheme.' },
  { code: 'vacant_possession', category: 'title_occupation', label: 'Vacant possession', derived: false,
    prompt: 'Evidence the site will be vacant, or the strategy and timeline for achieving vacant possession.' },
  { code: 'leases_tenancies', category: 'title_occupation', label: 'Occupational leases and tenancies', derived: false,
    prompt: 'Schedule of existing occupational leases and tenancies, and their treatment in the scheme.' },
  { code: 'rights_of_light', category: 'title_occupation', label: 'Rights of light', derived: false,
    prompt: 'Rights of light assessment and any neighbouring interests that could constrain the massing.' },
  { code: 'party_wall', category: 'title_occupation', label: 'Party wall', derived: false,
    prompt: 'Party wall notices served, awards obtained, and any outstanding neighbour matters.' },
  { code: 'structural_survey', category: 'existing_building', label: 'Structural survey', derived: false,
    prompt: 'Structural survey findings and any works they require before or during construction.' },
  { code: 'asbestos_survey', category: 'existing_building', label: 'Asbestos survey', derived: false,
    prompt: 'Asbestos survey findings and the removal strategy, if asbestos is present.' },
  { code: 'measured_survey', category: 'existing_building', label: 'Measured survey', derived: false,
    prompt: 'Measured survey confirming the dimensions of the existing building relied on by the design.' },
  { code: 'higher_risk_building', category: 'existing_building', label: 'Higher-risk building confirmation', derived: false,
    prompt: 'Whether the building falls within the higher-risk regime and what that requires of the programme.' },
  { code: 'fire_strategy', category: 'existing_building', label: 'Fire strategy', derived: false,
    prompt: 'Fire strategy report and its implications for the design and specification.' },
  { code: 'acoustic_thermal', category: 'existing_building', label: 'Acoustic and thermal compliance', derived: false,
    prompt: 'Acoustic and thermal performance evidence against the applicable Building Regulations parts.' },
  { code: 'services_mande', category: 'existing_building', label: 'Services, drainage and utilities', derived: false,
    prompt: 'Existing services, drainage and utility capacity, and any upgrade works they require.' },
  { code: 'cost_plan_qs', category: 'construction', label: 'QS cost plan', derived: true,
    prompt: 'Derived from the cost plan QS provenance record -- not entered here.' },
  { code: 'procurement_contractor', category: 'construction', label: 'Procurement and contractor', derived: false,
    prompt: 'Procurement route, contractor selection status and any pre-construction agreement.' },
  { code: 'warranties_building_control', category: 'construction', label: 'Warranty and building control', derived: false,
    prompt: 'Structural warranty provider and building control route (approved inspector or local authority).' },
  { code: 'insurance', category: 'construction', label: 'Insurance', derived: false,
    prompt: 'Contract works and other insurances in place for the construction period.' },
  { code: 'facility_terms', category: 'finance', label: 'Facility terms', derived: true,
    prompt: 'Derived from the facility inputs terms -- not entered here.' },
  { code: 'equity_sources', category: 'finance', label: 'Equity sources', derived: true,
    prompt: 'Derived from the funding structure equity inputs -- not entered here.' },
  { code: 'sponsor_entity', category: 'finance', label: 'Sponsor entity', derived: false,
    prompt: 'The borrower / sponsor entity, its structure and any guarantees supporting the facility.' },
  { code: 'tax_basis', category: 'finance', label: 'Tax and VAT basis', derived: true,
    prompt: 'Derived from the VAT and tax treatment recorded on the cost plan -- not entered here.' },
  { code: 'sales_evidence', category: 'exit', label: 'Sales evidence', derived: false,
    prompt: 'Comparable sales or pre-sales evidence supporting the assumed exit values.' },
  { code: 'lender_valuation', category: 'exit', label: 'Lender valuation', derived: true,
    prompt: 'Derived from the lender valuation metrics -- not entered here.' },
  { code: 'exit_route_evidence', category: 'exit', label: 'Exit route evidence', derived: false,
    prompt: 'Pre-sales, a take-out term sheet or absorption evidence for the modelled exit.' },
];
export const ENTERED_CODES: readonly DdItemCode[] =
  DD_CATALOGUE.filter((e) => !e.derived).map((e) => e.code as DdItemCode);
export const DERIVED_CODES: readonly DdDerivedCode[] =
  DD_CATALOGUE.filter((e) => e.derived).map((e) => e.code as DdDerivedCode);
