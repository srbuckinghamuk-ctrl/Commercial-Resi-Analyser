/**
 * R15 spec §23. The due-diligence evidence schedule. Twin of
 * app/financial_model/due_diligence.py. Task 1 declares types and the
 * catalogue; Task 3 adds the derivation. It never imports `./migrate` —
 * migrate.ts imports `defaultDueDiligence` from HERE, which is why the seed
 * lives in this module rather than there.
 */
import { pct } from './pct';
import { vatBasisGate } from './vat';
import { isProgrammeNetwork } from './programme';
import type { CostPlanResult, QsProvenance } from './cost-plan';
import type { VatResult } from './vat';
import type { AcquisitionTaxResult } from '../tax/acquisition-tax';
import type {
  AnyCalculatorInputs, LenderValuation, ModelFlag, ProgrammeInputs, ProgrammeNetwork, Schedule,
} from './finance-types';

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

/** R17 spec §23.5 (amended). Which document a claim came from. */
export type SourceRecordKind =
  | 'listing_narrative' | 'listing_structured' | 'measured_survey' | 'valuation'
  | 'title' | 'planning' | 'appraisal_inputs' | 'other';
export const SOURCE_RECORD_KINDS: readonly SourceRecordKind[] = [
  'listing_narrative', 'listing_structured', 'measured_survey', 'valuation',
  'title', 'planning', 'appraisal_inputs', 'other',
];

/** R17 spec §23.5 (amended). The structured claims a source can make. A null
 *  claim is "this source says nothing about it", never a value. */
export interface SourceClaims {
  existing_use: string | null;
  proposed_use: string | null;
  floor_area_sqm: number | null;
  tenure: 'freehold' | 'leasehold' | 'unknown' | null;
  upper_parts_included: boolean | null;
  vacant_possession: boolean | null;
}
export type SourceClaimField = keyof SourceClaims;
export const SOURCE_CLAIM_FIELDS: readonly SourceClaimField[] = [
  'existing_use', 'proposed_use', 'floor_area_sqm', 'tenure', 'upper_parts_included', 'vacant_possession',
];

export interface SourceEvidenceRecord {
  id: string;
  kind: SourceRecordKind;
  captured_at: string;   // ISO yyyy-mm-dd
  reference: string;
  captured_by: string;
  /** Stored and printed; never parsed (spec §27.9 limitation 10). */
  narrative_excerpt: string | null;
  claims: SourceClaims;
}

export interface SourceConflictResolution {
  id: string;
  field: SourceClaimField;
  resolved_value: string | number | boolean | null;
  chosen_record_id: string | null;
  evidence_reference: string;
  resolved_by: string;
  resolved_at: string;   // ISO yyyy-mm-dd
  reason: string;
}

/** R17 spec §27.1. v17's due-diligence block: the two record arrays are
 *  present on every v17 document (`[]` by migration), never absent. */
export interface DueDiligenceInputsV17 extends DueDiligenceInputs {
  source_records: SourceEvidenceRecord[];
  source_resolutions: SourceConflictResolution[];
}

export function emptyClaims(): SourceClaims {
  return {
    existing_use: null, proposed_use: null, floor_area_sqm: null,
    tenure: null, upper_parts_included: null, vacant_possession: null,
  };
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

/**
 * R15 spec §23.10's seed: every ENTERED catalogue item `unknown`, ids
 * deterministic (`dd-<code>`) so the migration is reproducible. Port of
 * default_due_diligence. Re-exported (not merely used) from migrate.ts —
 * see that module's own defaultDueDiligence import.
 */
export function defaultDueDiligence(): DueDiligenceInputs {
  return {
    source_record: null,
    items: DD_CATALOGUE.filter((e) => !e.derived).map((e) => ({
      id: `dd-${e.code}`, code: e.code as DdItemCode, category: e.category, label: '',
      status: 'unknown', evidence: null, expiry_date: null, owner: '', due_date: null,
      cost_impact_pence: null, programme_impact_months: null, action: '', notes: '',
    })),
  };
}

// --- R15 spec §23.3/§23.4: the derivation -----------------------------------

/** Whole months from ISO date `a` to ISO date `b`, floored (spec §23.9). */
export function monthsBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map((x) => Number(x));
  const [yb, mb, db] = b.split('-').map((x) => Number(x));
  return (yb - ya) * 12 + (mb - ma) - (db < da ? 1 : 0);
}

/** Spec §23.9: the resolved start of the phase carrying construction spend
 *  (network), else the legacy construction package's `start_offset`, else 0. */
export function constructionStartMonth(inputs: AnyCalculatorInputs, schedule: Schedule): number {
  const programme = (inputs as { programme?: ProgrammeInputs | ProgrammeNetwork | null }).programme ?? null;
  if (programme == null) return 0;
  if (isProgrammeNetwork(programme)) {
    if (schedule.programme == null) return 0;
    const wanted = programme.category_phase_ids.construction;
    const phase = schedule.programme.phases.find((p) => p.id === wanted);
    return phase != null ? phase.start_month : 0;
  }
  return programme.packages.construction.start_offset;
}

/** One line of the schedule. `kind` says where the status came from: 'entered'
 *  and 'custom' rows read `items[]`; a 'derived' row reads the field named in
 *  `source` and is never editable here (spec §23.2). */
export interface DdRow {
  id: string;
  code: DdItemCode | DdDerivedCode;
  category: DdCategory;
  label: string;
  kind: 'entered' | 'custom' | 'derived';
  status: DdStatus;
  evidence: DdEvidence | null;
  expiry_date: string | null;
  owner: string;
  due_date: string | null;
  cost_impact_pence: number | null;
  programme_impact_months: number | null;
  action: string;
  notes: string;
  /** Derived rows: the field read. null on every entered and custom row. */
  source: string | null;
}

export interface DdCategorySummary {
  category: DdCategory;
  red: number;
  amber: number;
  green: number;
  unknown: number;
  not_applicable: number;
  total: number;
}

export interface DdTotals {
  red: number;
  amber: number;
  green: number;
  unknown: number;
  not_applicable: number;
  total: number;
  /** ENTERED rows only (spec §23.4): a derived row's `unknown` is a fact about
   *  another block's inputs, not evidence anyone can go and gather here. */
  entered_unknown_count: number;
  addressed_pct: number | null;
  cost_impact_total_pence: number;
  programme_impact_max_months: number | null;
  unassessed_impact_count: number;
  /** R15 Task 8 fix round 1 (I1). The three counts the REPORT prints, published
   *  here rather than counted by each surface: a report generator that filters
   *  `rows` itself is a second implementation of a count (spec §11.9), and the
   *  two engines' reports would be free to disagree about the same document.
   *  `entered_total` is also the denominator of the flag message ("N of M
   *  entered items unknown"), so message and memo read one field. */
  entered_total: number;
  /** Red plus amber over ALL rows — the rows carrying an assessment. */
  assessed_count: number;
  /** Assessed rows with a NON-NULL `cost_impact_pence`: exactly the set
   *  `cost_impact_total_pence` sums, so "stated cost impact X across N items"
   *  counts the rows the total is made of. */
  stated_impact_count: number;
  /** I2. Unknown over DERIVED rows. The report's §13 limitation is worded over
   *  entered items, and a derived row left unknown must not be silently covered
   *  by "every item is evidenced" — so it is stated separately. */
  derived_unknown_count: number;
  /** R15 Task 9 fix round 1. The numerator `addressed_pct` is taken over, and
   *  the count the Due Diligence page's coverage line prints ("N of M
   *  addressed"). Published rather than left to each surface to work out as
   *  `entered_total - entered_unknown_count`: a subtraction in a component is a
   *  second implementation of a count (spec §11.9), and the page and the
   *  percentage would be free to disagree about the same document. */
  entered_addressed_count: number;
}

export interface DdSourceConflict {
  rule: 'occupation' | 'existing_area';
  statement: string;
}

export interface DdConsentExpiry {
  expiry_month: number;
  construction_start_month: number;
  expires_before_start: boolean;
}

/** R17 spec §23.5 (amended). One structured claim, as a source made it. */
export interface DdSourceClaimValue {
  record_id: string;
  kind: SourceRecordKind;
  value: string | number | boolean;
}

/** R17 spec §23.5 (amended). A claims field on which two or more source
 *  records disagree. `resolved` is true only when a resolution names the
 *  field with a non-blank `evidence_reference` and `resolved_by`. */
export interface DdSourceFieldConflict {
  field: SourceClaimField;
  values: DdSourceClaimValue[];
  resolved: boolean;
  resolution_id: string | null;
}

export interface DueDiligenceResult {
  rows: DdRow[];
  categories: DdCategorySummary[];
  totals: DdTotals;
  source_record: SourceRecord | null;
  source_conflicts: DdSourceConflict[];
  consent_expiry: DdConsentExpiry | null;
  /** R17 spec §23.5 (amended). Derived from `due_diligence.source_records`
   *  and `source_resolutions`; `[]` on every document with fewer than two
   *  records. The engine never picks a winner. */
  source_field_conflicts: DdSourceFieldConflict[];
  /** R17. Count of `source_field_conflicts` with `resolved === false`; the
   *  seventh FINAL condition reads it beside `entered_unknown_count`. */
  unresolved_source_conflicts: number;
}

/** R17 spec §23.5 (amended). Two non-null claims conflict when they differ:
 *  strings case-insensitively after trimming; areas when they disagree by
 *  more than 5% of the smaller (multiplied out, never a float quotient);
 *  booleans and enums by value. */
function claimsDiffer(field: SourceClaimField, a: string | number | boolean, b: string | number | boolean): boolean {
  if (field === 'floor_area_sqm') {
    const x = Number(a); const y = Number(b);
    const smaller = Math.min(x, y);
    return Math.abs(x - y) * 20 > smaller;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() !== b.trim().toLowerCase();
  }
  return a !== b;
}

export function deriveSourceFieldConflicts(
  records: SourceEvidenceRecord[],
  resolutions: SourceConflictResolution[],
): DdSourceFieldConflict[] {
  const out: DdSourceFieldConflict[] = [];
  for (const field of SOURCE_CLAIM_FIELDS) {
    const values: DdSourceClaimValue[] = [];
    for (const r of records) {
      const v = r.claims[field];
      if (v != null && !(typeof v === 'string' && v.trim() === '')) {
        values.push({ record_id: r.id, kind: r.kind, value: v });
      }
    }
    if (values.length < 2) continue;
    const conflicting = values.some((v) => claimsDiffer(field, values[0].value, v.value));
    if (!conflicting) continue;
    const resolution = resolutions.find(
      (res) => res.field === field && res.evidence_reference.trim() !== '' && res.resolved_by.trim() !== '',
    ) ?? null;
    out.push({ field, values, resolved: resolution != null, resolution_id: resolution?.id ?? null });
  }
  return out;
}

export const OCCUPATION_CONFLICT =
  'source conflict: the listing records the property as occupied; vacant possession is marked '
  + 'green - evidence the surrender or correct the status';
export const EXISTING_AREA_CONFLICT =
  'source conflict: the listing floor area and the entered existing GIA differ by more than 25%';

function derivedStatus(
  code: DdDerivedCode, inputs: AnyCalculatorInputs, costPlan: CostPlanResult,
  vat: VatResult, acquisitionTax: AcquisitionTaxResult,
): { status: DdStatus; source: string; evidence: DdEvidence | null } {
  switch (code) {
    case 'cost_plan_qs': {
      const qs = (inputs as { cost_plan?: { qs?: QsProvenance | null } }).cost_plan?.qs ?? null;
      if (costPlan.mode !== 'detailed' || qs == null) {
        return { status: 'unknown', source: 'cost_plan.qs', evidence: null };
      }
      return {
        status: qs.status === 'draft' ? 'amber' : 'green',
        source: 'cost_plan.qs',
        evidence: { source: qs.source, reference: `${qs.stage} / ${qs.status}`, date: qs.date },
      };
    }
    case 'facility_terms':
      return {
        status: inputs.finance.requires_confirmation ? 'unknown' : 'green',
        source: 'finance.requires_confirmation',
        evidence: null,
      };
    case 'equity_sources': {
      const statuses = inputs.equity_sources.map((e) => e.evidence_status as string);
      let status: DdStatus = 'green';
      if (statuses.some((s) => s === 'rejected')) status = 'red';
      else if (statuses.some((s) => s === 'unconfirmed')) status = 'unknown';
      const reference = (['confirmed', 'unconfirmed', 'rejected'] as const)
        .map((k) => `${k}: ${statuses.filter((s) => s === k).length}`)
        .join(', ');
      return {
        status,
        source: 'equity_sources[].evidence_status',
        evidence: { source: 'equity_sources', reference, date: '' },
      };
    }
    case 'tax_basis': {
      const acq = inputs.acquisition as { jurisdiction_evidence_status?: string; jurisdiction_source?: string };
      const confirmed = acq.jurisdiction_evidence_status === 'confirmed'
        && acquisitionTax.date_basis === 'transaction_date'
        && vatBasisGate(vat).vatBasisConfirmed;
      return {
        status: confirmed ? 'green' : 'unknown',
        source: 'acquisition.jurisdiction_evidence_status + vat',
        evidence: {
          source: String(acq.jurisdiction_source ?? ''),
          reference: acquisitionTax.jurisdiction,
          date: acquisitionTax.band_set_effective_from,
        },
      };
    }
    case 'lender_valuation': {
      const lv = (inputs as { lender_valuation?: LenderValuation | null }).lender_valuation ?? null;
      if (lv == null) return { status: 'unknown', source: 'lender_valuation', evidence: null };
      return {
        status: 'green',
        source: 'lender_valuation',
        evidence: { source: lv.author, reference: lv.reason, date: lv.date },
      };
    }
    default: {
      const never: never = code;
      throw new Error(`derivedStatus: unknown derived code ${String(never)}`);
    }
  }
}

function rowFromItem(item: DdItem, label: string, kind: 'entered' | 'custom'): DdRow {
  return {
    id: item.id, code: item.code, category: item.category, label, kind, status: item.status,
    evidence: item.evidence == null ? null : { ...item.evidence },
    expiry_date: item.expiry_date, owner: item.owner, due_date: item.due_date,
    cost_impact_pence: item.cost_impact_pence,
    programme_impact_months: item.programme_impact_months,
    action: item.action, notes: item.notes, source: null,
  };
}

/**
 * Spec §23.3/§23.4. Pure: reads the document plus the three already-computed
 * results the derived rows grade against, and returns the schedule. A pre-v13
 * document has no `due_diligence` block, so it is read as §23.10's SEED — 23
 * unknown entered rows — and not as an empty schedule, which would read as
 * "there is nothing to evidence".
 */
export function computeDueDiligence(
  inputs: AnyCalculatorInputs, costPlan: CostPlanResult, vat: VatResult,
  acquisitionTax: AcquisitionTaxResult, schedule: Schedule,
): DueDiligenceResult {
  const dd = (inputs as { due_diligence?: DueDiligenceInputs }).due_diligence ?? null;
  const items: DdItem[] = dd != null ? dd.items : defaultDueDiligence().items;
  const sourceRecord = dd != null ? dd.source_record : null;
  const byCode = new Map(items.filter((i) => i.code !== 'custom').map((i) => [i.code as string, i]));

  const rows: DdRow[] = [];
  for (const entry of DD_CATALOGUE) {
    if (entry.derived) {
      const { status, source, evidence } = derivedStatus(
        entry.code as DdDerivedCode, inputs, costPlan, vat, acquisitionTax,
      );
      rows.push({
        id: `dd-${entry.code}`, code: entry.code, category: entry.category, label: entry.label,
        kind: 'derived', status, evidence, expiry_date: null, owner: '', due_date: null,
        cost_impact_pence: null, programme_impact_months: null, action: '', notes: '', source,
      });
      continue;
    }
    const item = byCode.get(entry.code);
    // Validation rule 1 reports a missing item; the dashboard cannot invent a row.
    if (item == null) continue;
    rows.push(rowFromItem(item, entry.label, 'entered'));
  }
  for (const item of items) {
    if (item.code === 'custom') rows.push(rowFromItem(item, item.label, 'custom'));
  }

  const categories: DdCategorySummary[] = DD_CATEGORIES.map((category) => ({
    category, red: 0, amber: 0, green: 0, unknown: 0, not_applicable: 0, total: 0,
  }));
  const byCat = new Map(categories.map((c) => [c.category, c]));
  const totals: DdTotals = {
    red: 0, amber: 0, green: 0, unknown: 0, not_applicable: 0, total: 0,
    entered_unknown_count: 0, addressed_pct: null, cost_impact_total_pence: 0,
    programme_impact_max_months: null, unassessed_impact_count: 0,
    entered_total: 0, assessed_count: 0, stated_impact_count: 0, derived_unknown_count: 0,
    entered_addressed_count: 0,
  };
  const enteredRows = rows.filter((r) => r.kind !== 'derived');
  for (const r of rows) {
    for (const target of [byCat.get(r.category)!, totals] as Array<DdCategorySummary | DdTotals>) {
      target[r.status] += 1;
      target.total += 1;
    }
  }
  totals.entered_unknown_count = enteredRows.filter((r) => r.status === 'unknown').length;
  totals.addressed_pct = pct(enteredRows.length - totals.entered_unknown_count, enteredRows.length);
  // §23.4: only an ASSESSED row (red or amber) carries an impact into the
  // totals — a green row with a stale figure on it contributes nothing.
  const assessed = rows.filter((r) => r.status === 'red' || r.status === 'amber');
  totals.cost_impact_total_pence = assessed.reduce(
    (sum, r) => sum + (r.cost_impact_pence ?? 0), 0,
  );
  const months = assessed
    .map((r) => r.programme_impact_months)
    .filter((m): m is number => m != null);
  totals.programme_impact_max_months = months.length > 0 ? Math.max(...months) : null;
  totals.unassessed_impact_count = assessed.filter(
    (r) => r.cost_impact_pence == null || r.programme_impact_months == null,
  ).length;
  // R15 Task 8 fix round 1 (I1/I2). Counted here, where every other total is,
  // from the same `rows`/`enteredRows`/`assessed` partitions above.
  totals.entered_total = enteredRows.length;
  totals.assessed_count = assessed.length;
  totals.stated_impact_count = assessed.filter((r) => r.cost_impact_pence != null).length;
  totals.derived_unknown_count = rows.filter(
    (r) => r.kind === 'derived' && r.status === 'unknown',
  ).length;
  // A projection of `enteredRows`, not `entered_total - entered_unknown_count`:
  // counted from the same partition every other total above is counted from.
  totals.entered_addressed_count = enteredRows.filter((r) => r.status !== 'unknown').length;

  const conflicts: DdSourceConflict[] = [];
  if (sourceRecord != null) {
    const vp = byCode.get('vacant_possession');
    if (sourceRecord.is_vacant === false && vp != null && vp.status === 'green') {
      conflicts.push({ rule: 'occupation', statement: OCCUPATION_CONFLICT });
    }
    const listing = sourceRecord.floor_area_sqm;
    const existing = (inputs as { areas?: { existing_gia_sqm?: number } }).areas?.existing_gia_sqm ?? 0;
    // STRICT: exactly 25% does not fire. Multiplied out rather than divided so
    // the comparison never rests on a float quotient's last bit.
    if (listing != null && listing > 0 && existing > 0 && Math.abs(existing - listing) * 4 > listing) {
      conflicts.push({ rule: 'existing_area', statement: EXISTING_AREA_CONFLICT });
    }
  }

  let consent: DdConsentExpiry | null = null;
  const planning = byCode.get('planning_route');
  const acqDate = (inputs.acquisition as { acquisition_date?: string | null }).acquisition_date ?? null;
  // R15 fix wave (I1). BLANK-AFTER-TRIM is absence, exactly as validation's
  // `isUnrealDate` reads it (spec §23.9 rule 5): a whitespace-only expiry
  // raises no validation error, so it must not reach `monthsBetween`, which
  // would yield NaN here (and a ValueError in the Python twin). `acqDate` is
  // trimmed the same way defensively — one absence rule for both dates the
  // consent block reads.
  const expiry = planning?.expiry_date ?? null;
  if (expiry != null && expiry.trim() !== '' && acqDate != null && acqDate.trim() !== '') {
    const expiryMonth = monthsBetween(acqDate, expiry);
    const start = constructionStartMonth(inputs, schedule);
    consent = {
      expiry_month: expiryMonth,
      construction_start_month: start,
      expires_before_start: expiryMonth < start,
    };
  }

  // R17 spec §23.5 (amended). `?? []`: a raw pre-v17 stored document has no
  // `source_records` key at all — read as "no records", not as an error.
  const v17 = dd as (DueDiligenceInputs & Partial<DueDiligenceInputsV17>) | null;
  const fieldConflicts = deriveSourceFieldConflicts(v17?.source_records ?? [], v17?.source_resolutions ?? []);

  return {
    rows,
    categories,
    totals,
    source_record: sourceRecord == null ? null : { ...sourceRecord },
    source_conflicts: conflicts,
    consent_expiry: consent,
    source_field_conflicts: fieldConflicts,
    unresolved_source_conflicts: fieldConflicts.filter((c) => !c.resolved).length,
  };
}

/** Spec §23.9's flag table. Pure; mirrors `due_diligence_flags`. Defined here
 *  and CALLED from metrics.ts (Task 5) — this module is never imported by the
 *  engine modules whose results it reads. */
export function dueDiligenceFlags(result: DueDiligenceResult, costPlan: CostPlanResult): ModelFlag[] {
  const out: ModelFlag[] = [];
  const t = result.totals;
  // R15 Task 8 fix round 1 (I1): the denominator is the published count, not a
  // second partition of `rows` taken here — the memo's §13 limitation prints
  // the same "N of M" and now reads the identical field.
  const entered = t.entered_total;
  if (t.entered_unknown_count > 0) {
    out.push({
      code: 'due_diligence_unknown', severity: 'amber', month: null, amount_pence: null,
      message: `due diligence: ${t.entered_unknown_count} of ${entered} entered items unknown `
        + '- unknown is never treated as green',
    });
  }
  for (const c of result.source_conflicts) {
    out.push({
      code: 'source_conflict', severity: 'red', month: null, amount_pence: null,
      message: c.statement,
    });
  }
  // R17 spec §23.5 (amended). One red flag per unresolved field; the values
  // are named so the reader sees the disagreement, not only that one exists.
  for (const c of result.source_field_conflicts) {
    if (c.resolved) continue;
    const named = c.values.map((v) => `${v.kind}: ${String(v.value)}`).join(' | ');
    out.push({
      code: 'source_conflict_unresolved', severity: 'red', month: null, amount_pence: null,
      message: `source conflict on ${c.field} is unresolved - ${named}; record an evidenced resolution`,
    });
  }
  const ce = result.consent_expiry;
  if (ce != null && ce.expires_before_start) {
    out.push({
      code: 'consent_expires_before_start', severity: 'red', month: ce.expiry_month,
      amount_pence: null,
      message: `planning consent lapses at month ${ce.expiry_month}, before construction `
        + `starts at month ${ce.construction_start_month}`,
    });
  }
  const pb = costPlan.price_basis;
  if (pb != null && pb.provisional_sums_pence > 0) {
    out.push({
      code: 'provisional_sums_present', severity: 'amber', month: null,
      amount_pence: pb.provisional_sums_pence,
      message: `provisional sums are present in the cost plan: ${pb.provisional_sums_pence}p`,
    });
  }
  // R15b spec §24.7. A QS record with no tender-price inflation allowance,
  // where the calendar IS known (a resolved acquisition date, so
  // `latest_midpoint_months_from_base` is not null) and at least one package
  // spend midpoint falls after the base date. `latest_midpoint_months_from_base`
  // is null whenever `acquisition_date` is null (Task 2) — that is this flag's
  // own "skipped" arm, not a separate guard. `> 0` (not `>= 0`): a base date at
  // or after every midpoint clamps the figure to exactly 0 (computeCostPlan's
  // own floor), which reads as "nothing to inflate", not "record an allowance".
  if (costPlan.mode === 'detailed' && costPlan.qs != null && (costPlan.qs.inflation ?? null) == null
      && costPlan.latest_midpoint_months_from_base != null && costPlan.latest_midpoint_months_from_base > 0) {
    // Published in Task 2; no arithmetic here — the flag prints the same
    // whole-month figure the memo does, never a re-floored copy of the float.
    const months = costPlan.latest_midpoint_whole_months_from_base!;
    out.push({
      code: 'no_inflation_allowance', severity: 'amber', month: Math.floor(costPlan.latest_midpoint_month!),
      amount_pence: null,
      message: `no tender-price inflation allowance recorded: priced at ${costPlan.qs.base_date}; `
        + `package spend midpoints fall up to ${months} whole months later`,
    });
  }
  return out;
}
