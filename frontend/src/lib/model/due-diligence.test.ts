import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DD_CATALOGUE, DERIVED_CODES, ENTERED_CODES, constructionStartMonth, dueDiligenceFlags,
  monthsBetween,
} from './due-diligence';
import { migrateInputsToV12 } from './migrate';
import { applyScenario } from './apply-scenario';
import { buildSchedule } from './schedule';
import { runAppraisal } from './index';
import { QS, computeFor, ddDoc, rawYAsV12 } from './__fixtures__/due-diligence-docs';
import { docZ, docZNoAllowance } from './__fixtures__/cost-plan-in-time-docs';
import type { DdItemCode, DdRow } from './due-diligence';
import type { AnyCalculatorInputs, CalculatorInputsV14, LenderValuation } from './finance-types';

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

// --- §23.3/§23.4: the derivation --------------------------------------------

describe('the due-diligence derivation (§23.3-§23.4)', () => {
  it('monthsBetween is whole months, floored', () => {
    expect(monthsBetween('2026-09-01', '2026-11-01')).toBe(2);
    // leap-day pair: day-of-month not reached
    expect(monthsBetween('2024-01-31', '2024-02-29')).toBe(0);
    expect(monthsBetween('2024-01-29', '2024-02-29')).toBe(1);
    // a lapse before acquisition is negative
    expect(monthsBetween('2026-09-01', '2026-08-15')).toBe(-1);
  });

  it('category counts match the hand table', () => {
    const r = computeFor(ddDoc());
    expect(r.categories.map((c) => [c.category, c.red, c.amber, c.green, c.unknown, c.not_applicable, c.total])).toEqual([
      ['planning', 0, 1, 3, 1, 0, 5],
      ['title_occupation', 1, 0, 1, 1, 2, 5],
      ['existing_building', 0, 2, 5, 1, 0, 8],
      ['construction', 0, 1, 3, 0, 0, 4],
      ['finance', 0, 0, 3, 1, 0, 4],
      ['exit', 0, 0, 2, 1, 0, 3],
    ]);
    const t = r.totals;
    expect([t.red, t.amber, t.green, t.unknown, t.not_applicable, t.total]).toEqual([1, 4, 17, 5, 2, 29]);
    expect(t.entered_unknown_count).toBe(3);
    expect(t.addressed_pct).toBe(87.5);
    expect(t.cost_impact_total_pence).toBe(2_550_000);
    expect(t.programme_impact_max_months).toBe(3);
    expect(t.unassessed_impact_count).toBe(1);
    // Task 8 fix round 1 (I1/I2): the counts the report prints, published on
    // the block. entered_total counts the 23 catalogue rows plus the custom
    // row; assessed_count is red + amber; stated_impact_count is the subset of
    // those whose cost the total above actually sums (structural_survey states
    // neither impact, so it is excluded); derived_unknown_count is
    // equity_sources + lender_valuation.
    expect([t.entered_total, t.assessed_count, t.stated_impact_count, t.derived_unknown_count])
      .toEqual([24, 5, 4, 2]);
    // Task 9 fix round 1: the numerator `addressed_pct` is taken over and the
    // count the Due Diligence page's coverage line prints — 24 entered rows
    // less the three unknown ones (cil_s106, leases_tenancies, fire_strategy).
    expect(t.entered_addressed_count).toBe(21);
  });

  it('row order is catalogue then custom, and derived rows name their source', () => {
    const r = computeFor(ddDoc());
    expect(r.rows.slice(0, 28).map((row) => row.code)).toEqual(DD_CATALOGUE.map((e) => e.code));
    expect(r.rows[28].code).toBe('custom');
    expect(r.rows[28].kind).toBe('custom');
    expect(r.rows[28].label).toBe('Basement water ingress');
    const derived = new Map(r.rows.filter((row) => row.kind === 'derived').map((row) => [row.code, row]));
    expect(derived.get('equity_sources')!.status).toBe('unknown');
    expect(derived.get('equity_sources')!.source).toBe('equity_sources[].evidence_status');
    expect(derived.get('lender_valuation')!.status).toBe('unknown');
    expect(derived.get('lender_valuation')!.source).toBe('lender_valuation');
    expect(derived.get('tax_basis')!.status).toBe('green');
    expect(derived.get('tax_basis')!.source).toBe('acquisition.jurisdiction_evidence_status + vat');
    expect(derived.get('facility_terms')!.status).toBe('green');
    expect(derived.get('facility_terms')!.source).toBe('finance.requires_confirmation');
    expect(derived.get('cost_plan_qs')!.status).toBe('green');
    expect(derived.get('cost_plan_qs')!.source).toBe('cost_plan.qs');
  });

  it('not_applicable counts as addressed but is its own column', () => {
    const r = computeFor(ddDoc({ status: { rights_of_light: 'unknown' }, notes: { rights_of_light: '' } }));
    expect(r.totals.entered_unknown_count).toBe(4);
    expect(r.totals.addressed_pct).toBe(83.33);   // pct(20, 24)
  });

  it('impact totals sum assessed red/amber rows only, and take the max months', () => {
    // A green with an impact contributes nothing.
    const r = computeFor(ddDoc({ impacts: { asbestos_survey: [9_999_999, 9] } }));
    expect(r.totals.cost_impact_total_pence).toBe(2_550_000);
    expect(r.totals.programme_impact_max_months).toBe(3);
    // Assessing structural_survey moves the total and clears the unassessed count.
    const r2 = computeFor(ddDoc({ impacts: { structural_survey: [100_000, 0] } }));
    expect(r2.totals.cost_impact_total_pence).toBe(2_650_000);
    expect(r2.totals.unassessed_impact_count).toBe(0);
    // ... and moves stated_impact_count with it: the count follows the SUM's
    // own membership, not the assessed count (5 assessed, now all 5 stated).
    expect([r2.totals.assessed_count, r2.totals.stated_impact_count]).toEqual([5, 5]);
  });

  const rowOf = (doc: Parameters<typeof computeFor>[0], code: string): DdRow =>
    computeFor(doc).rows.find((x) => x.code === code)!;

  it('each derived row maps its status from one field', () => {
    expect(rowOf(ddDoc({ equityStatus: 'confirmed' }), 'equity_sources').status).toBe('green');
    expect(rowOf(ddDoc({ equityStatus: 'rejected' }), 'equity_sources').status).toBe('red');
    expect(rowOf(ddDoc({ requiresConfirmation: true }), 'facility_terms').status).toBe('unknown');
    const lv: LenderValuation = {
      basis: 'global_pct', global_value: -5, per_key_values: null,
      reason: 'Valuer haircut', author: 'Knight Frank', date: '2026-08-20',
    };
    expect(rowOf(ddDoc({ lenderValuation: lv }), 'lender_valuation').status).toBe('green');
    expect(rowOf(ddDoc({ qs: { ...QS, status: 'draft' } }), 'cost_plan_qs').status).toBe('amber');
    expect(rowOf(ddDoc({ qs: null }), 'cost_plan_qs').status).toBe('unknown');
    expect(rowOf(ddDoc({ mode: 'headline' }), 'cost_plan_qs').status).toBe('unknown');
    expect(rowOf(ddDoc({ acquisitionDate: null }), 'tax_basis').status).toBe('unknown');
  });

  it('source conflicts are two rules, and their negatives hold', () => {
    const r = computeFor(ddDoc());
    expect(r.source_conflicts.map((c) => c.rule)).toEqual(['occupation', 'existing_area']);
    expect(computeFor(ddDoc({ isVacant: null })).source_conflicts[0].rule).toBe('existing_area');
    expect(computeFor(ddDoc({
      status: { vacant_possession: 'amber' }, action: { vacant_possession: 'Agree surrender' },
    })).source_conflicts.map((c) => c.rule)).toEqual(['existing_area']);
    // exactly 25% does not fire (strict): listing 400 vs existing 500
    expect(computeFor(ddDoc({ listingArea: 400, existingGia: 500 })).source_conflicts.map((c) => c.rule))
      .toEqual(['occupation']);
    expect(computeFor(ddDoc({ sourceRecord: null })).source_conflicts).toEqual([]);
  });

  it('consent expiry is measured against the construction start', () => {
    const r = computeFor(ddDoc());
    expect([
      r.consent_expiry!.expiry_month,
      r.consent_expiry!.construction_start_month,
      r.consent_expiry!.expires_before_start,
    ]).toEqual([2, 4, true]);
    // monthsBetween('2026-09-01', '2027-01-01') = 4, and 4 < 4 is false
    expect(computeFor(ddDoc({ expiry: { planning_route: '2027-01-01' } })).consent_expiry!.expires_before_start)
      .toBe(false);
    expect(computeFor(ddDoc({ acquisitionDate: null })).consent_expiry).toBeNull();
    expect(computeFor(ddDoc({ expiry: { planning_route: null } })).consent_expiry).toBeNull();
    expect(computeFor(ddDoc({ programme: null })).consent_expiry!.construction_start_month).toBe(0);
  });

  it('a pre-v13 document is read as the seed', () => {
    const v12 = migrateInputsToV12(rawYAsV12());
    const r = computeFor(v12);
    expect(r.totals.entered_unknown_count).toBe(23);
    expect(r.source_record).toBeNull();
    expect(r.source_conflicts).toEqual([]);
  });
});

// --- Fix round 1: the three arms the fixed test list above did not reach -----

/** Registered, with construction rated 20% and its treatments row left
 *  `unconfirmed` (fixture Y's default) — the minimal VAT setting that makes a
 *  charge line BEAR VAT on an unevidenced basis, so `vatBasisGate` is false.
 *  Fixture Y itself rates every category 0%, so the `tax_basis` row's VAT half
 *  is otherwise indistinguishable from a constant true. */
const VAT_BEARING_UNCONFIRMED = {
  registered: true, treatmentPatch: { construction: { rate_pct: 20 } },
};

/** The four R15 flag codes (spec §23.9), so a test that filters `metrics.flags`
 *  down to this release's own additions does not have to restate them inline. */
const R15_FLAG_CODES = new Set([
  'due_diligence_unknown', 'source_conflict', 'consent_expires_before_start',
  'provisional_sums_present',
]);

describe('the arms fixture Y alone cannot reach (§23.3, §23.9)', () => {
  it('tax_basis goes unknown through the VAT half alone', () => {
    const taxBasis = (doc: CalculatorInputsV14): DdRow =>
      computeFor(doc).rows.find((x) => x.code === 'tax_basis')!;

    expect(taxBasis(ddDoc({ vat: VAT_BEARING_UNCONFIRMED })).status).toBe('unknown');
    // The jurisdiction half is untouched on both arms, so confirming the SAME
    // bearing row's evidence — and nothing else — restores green. Without
    // this, `registered: true` alone could be what moved the row.
    expect(taxBasis(ddDoc({
      vat: {
        ...VAT_BEARING_UNCONFIRMED,
        treatmentPatch: { construction: { rate_pct: 20, evidence_status: 'confirmed' } },
      },
    })).status).toBe('green');
  });

  it('the flag table on fixture Y is exactly six flags', () => {
    // R15b spec §24.7 adds a sixth: fixture Y's QS record has no inflation
    // key at all (fixtures/financial-model/y-due-diligence.json), so
    // no_inflation_allowance fires alongside R15's original five.
    const doc = ddDoc();
    const run = runAppraisal(doc);
    const flags = dueDiligenceFlags(computeFor(doc), run.metrics.cost_plan);
    expect(flags.map((f) => [f.code, f.severity, f.month, f.amount_pence, f.message])).toEqual([
      ['due_diligence_unknown', 'amber', null, null,
        'due diligence: 3 of 24 entered items unknown - unknown is never treated as green'],
      ['source_conflict', 'red', null, null,
        'source conflict: the listing records the property as occupied; vacant possession is '
        + 'marked green - evidence the surrender or correct the status'],
      ['source_conflict', 'red', null, null,
        'source conflict: the listing floor area and the entered existing GIA differ by more '
        + 'than 25%'],
      ['consent_expires_before_start', 'red', 2, null,
        'planning consent lapses at month 2, before construction starts at month 4'],
      ['provisional_sums_present', 'amber', null, 8_000_000,
        'provisional sums are present in the cost plan: 8000000p'],
      ['no_inflation_allowance', 'amber', 7, null,
        'no tender-price inflation allowance recorded: priced at 2026-07-01; package spend '
        + 'midpoints fall up to 9 whole months later'],
    ]);
  });

  it('the seed twin raises the unknown flag and nothing else', () => {
    // No source record, no consent expiry and no price basis, so four of the
    // five arms above must fall silent rather than fire on absent data.
    const doc = ddDoc({ seed: true });
    const run = runAppraisal(doc);
    const flags = dueDiligenceFlags(computeFor(doc), run.metrics.cost_plan);
    expect(flags.map((f) => [f.code, f.severity, f.month, f.amount_pence, f.message])).toEqual([
      ['due_diligence_unknown', 'amber', null, null,
        'due diligence: 23 of 23 entered items unknown - unknown is never treated as green'],
    ]);
  });

  it('the result is published on metrics and the flags fire', () => {
    // §23.8: deriveMetrics computes the schedule ONCE and publishes it, and
    // §23.9's four flag codes reach `metrics.flags` — not merely
    // `dueDiligenceFlags`, which Task 3 already covered in isolation.
    const metrics = runAppraisal(ddDoc()).metrics;
    expect(metrics.due_diligence.totals.entered_unknown_count).toBe(3);
    const r15 = metrics.flags.filter((f) => R15_FLAG_CODES.has(f.code));
    expect(r15.map((f) => f.code)).toEqual([
      'due_diligence_unknown', 'source_conflict', 'source_conflict',
      'consent_expires_before_start', 'provisional_sums_present',
    ]);
    expect(r15.find((f) => f.code === 'provisional_sums_present')!.amount_pence).toBe(8_000_000);
    expect(r15.find((f) => f.code === 'consent_expires_before_start')!.month).toBe(2);
  });

  // R15b spec §24.7. `no_inflation_allowance` — a QS record with no allowance,
  // a known calendar and at least one package spend midpoint falling after
  // the base date. Twin of test_financial_model_due_diligence.py's
  // 'TestNoInflationAllowanceFlag'.
  describe('§24.7 no_inflation_allowance flag', () => {
    it('Z with the allowance cleared fires, month 12, "up to 18 whole months later"', () => {
      const doc = docZNoAllowance();
      const run = runAppraisal(doc);
      const flags = dueDiligenceFlags(computeFor(doc), run.metrics.cost_plan);
      const flag = flags.find((f) => f.code === 'no_inflation_allowance');
      expect(flag).toMatchObject({
        code: 'no_inflation_allowance', severity: 'amber', month: 12, amount_pence: null,
        message: 'no tender-price inflation allowance recorded: priced at 2026-02-01; package '
          + 'spend midpoints fall up to 18 whole months later',
      });
    });

    it('Z with the allowance in place fires nothing', () => {
      const doc = docZ();
      const run = runAppraisal(doc);
      const flags = dueDiligenceFlags(computeFor(doc), run.metrics.cost_plan);
      expect(flags.some((f) => f.code === 'no_inflation_allowance')).toBe(false);
    });

    it('fixture Y (no inflation key at all) fires', () => {
      const doc = ddDoc();
      const run = runAppraisal(doc);
      const flags = dueDiligenceFlags(computeFor(doc), run.metrics.cost_plan);
      expect(flags.find((f) => f.code === 'no_inflation_allowance')).toMatchObject({
        severity: 'amber', month: 7, amount_pence: null,
        message: 'no tender-price inflation allowance recorded: priced at 2026-07-01; package '
          + 'spend midpoints fall up to 9 whole months later',
      });
    });

    it('a Y twin with the base date moved after every midpoint does not fire', () => {
      const doc = ddDoc({ qs: { ...QS, base_date: '2028-01-01' } });
      const run = runAppraisal(doc);
      const flags = dueDiligenceFlags(computeFor(doc), run.metrics.cost_plan);
      expect(flags.some((f) => f.code === 'no_inflation_allowance')).toBe(false);
    });

    it('an acquisition_date: null twin does not fire — there is no calendar to place a midpoint on', () => {
      const doc = ddDoc({ acquisitionDate: null });
      const run = runAppraisal(doc);
      const flags = dueDiligenceFlags(computeFor(doc), run.metrics.cost_plan);
      expect(flags.some((f) => f.code === 'no_inflation_allowance')).toBe(false);
    });

    it('boundary: exactly 0 months from base does not fire; just over fires with "0 whole months"', () => {
      // Z-no-allowance's latest midpoint is 12.333… months from acquisition.
      // base_date = acquisition + 13 months clamps months_from_base to
      // exactly 0 (computeCostPlan floors at 0) — no fire. base_date =
      // acquisition + 12 months leaves 0.333… months, whole-floored to 0 —
      // fires, printing "0 whole months".
      const exactlyZero = docZNoAllowance();
      exactlyZero.cost_plan.qs!.base_date = '2027-09-01';   // acquisition (2026-08-01) + 13 months
      const runZero = runAppraisal(exactlyZero);
      const flagsZero = dueDiligenceFlags(computeFor(exactlyZero), runZero.metrics.cost_plan);
      expect(flagsZero.some((f) => f.code === 'no_inflation_allowance')).toBe(false);

      const justOver = docZNoAllowance();
      justOver.cost_plan.qs!.base_date = '2027-08-01';   // acquisition + 12 months
      const runOver = runAppraisal(justOver);
      const flagsOver = dueDiligenceFlags(computeFor(justOver), runOver.metrics.cost_plan);
      expect(flagsOver.find((f) => f.code === 'no_inflation_allowance')).toMatchObject({
        month: 12,
        message: 'no tender-price inflation allowance recorded: priced at 2027-08-01; package '
          + 'spend midpoints fall up to 0 whole months later',
      });
    });
  });

  it('money is inert', () => {
    // §23.8: the evidence layer is DISCLOSURE, not cost. Fixture Y against its
    // seed twin — which strips the source record, every entered status, the QS
    // record and every price basis — must move no figure at all, so the whole
    // monthly model is compared and not just the five headline totals.
    const evidenced = runAppraisal(ddDoc());
    const seeded = runAppraisal(ddDoc({ seed: true }));
    for (const name of [
      'gdv_pence', 'total_development_cost_pence', 'profit_pence',
      'peak_debt_pence', 'finance_costs_pence',
    ] as const) {
      expect(evidenced.metrics[name], name).toEqual(seeded.metrics[name]);
    }
    expect(evidenced.model).toEqual(seeded.model);
  });

  it('constructionStartMonth reads the legacy packages arm', () => {
    // Fixture H is the R3a explicit-programme document: its `programme` carries
    // `packages`, not `phases`, so it is the only route into
    // constructionStartMonth's legacy branch.
    //
    // It is used AS STORED, not migrated: migrateV8toV9 converts the legacy
    // three-package block into a precedence network, so a migrated H would take
    // the network arm and leave this branch as unreachable as it was before
    // this test. Running the stored document directly is exactly how
    // golden-fixtures.test.ts runs the pre-v9 corpus, and it is the shape the
    // legacy arm exists to serve.
    //
    // 1 is H's own `packages.construction.start_offset`, written as a literal —
    // and its professional (2) and statutory (4) offsets differ, so reading the
    // wrong package fails here rather than passing by coincidence.
    const doc = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/financial-model/h-programme-scurve.json'), 'utf-8'),
    ) as { inputs: AnyCalculatorInputs };
    const programme = (doc.inputs as unknown as { programme: Record<string, unknown> }).programme;
    expect('phases' in programme).toBe(false);
    expect(constructionStartMonth(doc.inputs, buildSchedule(doc.inputs))).toBe(1);
  });

  it('a blank expiry is absence, not a date', () => {
    // R15 fix wave (I1). Validation reads a blank-after-trim date as ABSENCE
    // (`isUnrealDate`, §23.9 rule 5), so a whitespace-only `expiry_date` raises
    // no error and must not reach `monthsBetween` — which would yield NaN here
    // and raise ValueError in the Python twin. Twin of
    // test_financial_model_due_diligence.py's
    // `test_a_blank_expiry_is_absence_not_a_date`.
    const doc = ddDoc({ expiry: { planning_route: '  ' } });
    expect(computeFor(doc).consent_expiry).toBeNull();
    const run = runAppraisal(doc);                 // throws nothing
    expect(run.metrics.flags.map((f) => f.code)).not.toContain('consent_expires_before_start');
  });

  it('the consent flag moves under the phase_slip lever', () => {
    // R15 fix wave (I2). §23.9: the schedule is §12.2-invariant, but
    // `consent_expires_before_start` is NOT invariant across sensitivity cells
    // — it compares the lapse month against `constructionStartMonth`, which the
    // `phase_slip` lever moves. Fixture Y's construction phase is
    // `construction` and resolves to month 4; an expiry of 2027-02-01 is month
    // 5, so the base clears it and a three-month slip does not. Twin of
    // test_financial_model_due_diligence.py's
    // `test_consent_flag_moves_under_the_phase_slip_lever`.
    const base = ddDoc({ expiry: { planning_route: '2027-02-01' } });
    expect(computeFor(base).consent_expiry!.expiry_month).toBe(5);
    expect(computeFor(base).consent_expiry!.construction_start_month).toBe(4);
    expect(runAppraisal(base).metrics.flags.map((f) => f.code))
      .not.toContain('consent_expires_before_start');

    const slipped = applyScenario(base, {
      label: '', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: 0,
      timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0,
      phase_slip_phase_id: 'construction', phase_slip_months: 3,
      exit_yield_adjustment_pct: 0, operating_cost_adjustment_pct: 0,
      vacancy_adjustment_pct: 0, sales_slip_months: 0,
      saleable_area_adjustment_pct: 0, abnormal_cost_adjustment_pct: 0,
      programme_slip_months: 0, refi_ltv_adjustment_pct: 0,
    });
    const slippedConsent = computeFor(slipped).consent_expiry!;
    expect([slippedConsent.construction_start_month, slippedConsent.expires_before_start])
      .toEqual([7, true]);
    expect(runAppraisal(slipped).metrics.flags.map((f) => f.code))
      .toContain('consent_expires_before_start');
  });
});
