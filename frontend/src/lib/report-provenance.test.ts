import { describe, it, expect } from 'vitest';
import {
  draftReason, documentStatus, buildProvenance, ALLOWED_TRANSITIONS, ROLE_TRANSITIONS,
  CREATE_ROLES, canTransition, structurallyEqual, dueDiligenceGateFor,
} from './report-provenance';
import { emptyClaims } from './model/due-diligence';
import type { SourceConflictResolution, SourceEvidenceRecord } from './model/due-diligence';
import type { CalculatorInputsV17 } from './model/finance-types';
import type { DraftReason } from './report-provenance';
import type { LenderCase } from '../types';
import {
  runAppraisal, migrateInputsToV4, DEFAULT_AREA_BRIDGE,
  migrateV6toV7, migrateV7toV8, DEFAULT_VAT, defaultVatTreatments,
} from './model';
import type { AnyCalculatorInputs, CalculatorInputsV8 } from './model';
import {
  qaProject, sellAllInputs, legacyV1Snapshot, welshInputs, costPlanInTimeInputs, benchmarkInputs,
} from './report-qa/memo-fixtures';
import { ddDoc } from './model/__fixtures__/due-diligence-docs';

describe('tax basis in provenance (R8)', () => {
  const reconciled = { report_safe: true, senior_repaid: true };

  it('holds a document in DRAFT while the jurisdiction is unconfirmed', () => {
    expect(draftReason(reconciled, 'credit_approved', { taxBasisConfirmed: false }))
      .toBe('tax_basis_unconfirmed');
  });

  it('reaches FINAL once the basis is confirmed and the case approved', () => {
    expect(draftReason(reconciled, 'credit_approved', { taxBasisConfirmed: true })).toBeNull();
  });

  it('does not displace a more fundamental reason', () => {
    expect(draftReason({ report_safe: false, senior_repaid: true }, 'credit_approved',
      { taxBasisConfirmed: false })).toBe('unreconciled');
    expect(draftReason({ report_safe: true, senior_repaid: false }, 'credit_approved',
      { taxBasisConfirmed: false })).toBe('senior_not_repaid');
    // Fix round 1 — the diagonal, and the only case that pins the clause's
    // position *below* `not_approved` rather than merely above the two reasons
    // in the lines above. Without it, moving the tax clause after `not_approved`
    // passes the entire suite, and the failure would be silent in production:
    // ExportPage builds provenance with no lender case at all, so `not_approved`
    // holds on every real export until R14 and would mask the tax gate
    // completely — an unconfirmed basis would never once raise its watermark.
    expect(draftReason(reconciled, null, { taxBasisConfirmed: false }))
      .toBe('tax_basis_unconfirmed');
    expect(draftReason(reconciled, 'declined', { taxBasisConfirmed: false }))
      .toBe('tax_basis_unconfirmed');
  });

  it('still reports not_approved when the basis is confirmed', () => {
    expect(draftReason(reconciled, null, { taxBasisConfirmed: true })).toBe('not_approved');
  });

  // The third argument was added after every existing call site was written.
  // A default that did not preserve today's behaviour would silently change the
  // meaning of every two-argument caller in the app and in the R7 report gate.
  it('keeps two-argument callers behaving exactly as before', () => {
    expect(draftReason(reconciled, 'credit_approved')).toBeNull();
    expect(draftReason(reconciled, null)).toBe('not_approved');
    expect(documentStatus(reconciled, 'credit_approved')).toBe('FINAL');
    expect(documentStatus(reconciled, null)).toBe('DRAFT');
  });

  it('carries the reason through documentStatus', () => {
    expect(documentStatus(reconciled, 'credit_approved', { taxBasisConfirmed: false }))
      .toBe('DRAFT');
    expect(documentStatus(reconciled, 'credit_approved', { taxBasisConfirmed: true }))
      .toBe('FINAL');
  });
});

// Task 12, spec §17.10. `draftReason` stays pure -- it receives the VAT gate,
// it does not compute one (that is `vatBasisGate` in model/vat.ts, tested on
// its own terms there). Ordered immediately after `tax_basis_unconfirmed`:
// the ordering rationale already written into `draftReason` applies
// unchanged -- an unconfirmed VAT basis does not make the arithmetic wrong,
// so it must not displace a reason saying the figures themselves may be, but
// a reader must know the basis is unverified before they read an approval.
describe('VAT basis in the draft gate (R11, spec §17.10)', () => {
  const reconciled = { report_safe: true, senior_repaid: true };
  const confirmedTax = { taxBasisConfirmed: true };

  it('gates on an unconfirmed VAT basis that actually bears VAT', () => {
    expect(draftReason(reconciled, 'credit_approved', confirmedTax, { vatBasisConfirmed: false }))
      .toBe('vat_basis_unconfirmed');
  });

  it('does not gate on an unconfirmed row that charges nothing', () => {
    // "Material" means the category actually bears VAT (§17.10). No threshold
    // constant is invented, and `registered: false` can never gate.
    expect(draftReason(reconciled, 'credit_approved', confirmedTax, { vatBasisConfirmed: true }))
      .toBeNull();
  });

  it('orders below tax_basis_unconfirmed', () => {
    expect(draftReason(reconciled, 'credit_approved', { taxBasisConfirmed: false }, { vatBasisConfirmed: false }))
      .toBe('tax_basis_unconfirmed');
  });

  it('does not displace a more fundamental reason', () => {
    expect(draftReason({ report_safe: false, senior_repaid: true }, 'credit_approved',
      confirmedTax, { vatBasisConfirmed: false })).toBe('unreconciled');
    expect(draftReason({ report_safe: true, senior_repaid: false }, 'credit_approved',
      confirmedTax, { vatBasisConfirmed: false })).toBe('senior_not_repaid');
  });

  it('still reports not_approved when the VAT basis is confirmed', () => {
    expect(draftReason(reconciled, null, confirmedTax, { vatBasisConfirmed: true }))
      .toBe('not_approved');
  });

  // Fix round 1 (minor 1). The mirror image of the test above: with NO lender
  // case AND an unconfirmed VAT basis, the reason must still be
  // 'vat_basis_unconfirmed', not 'not_approved' — the two adjacent tests
  // (this describe block's first case, and the one above) made this likely
  // but neither actually pinned the ORDER at the no-lender-case boundary,
  // which is exactly the shape R8's own "does not displace" test found worth
  // a dedicated case for the tax-basis clause.
  it('orders above not_approved with no lender case at all', () => {
    expect(draftReason(reconciled, null, confirmedTax, { vatBasisConfirmed: false }))
      .toBe('vat_basis_unconfirmed');
  });

  // The fourth argument was added after every existing call site was written.
  // A default that did not preserve today's behaviour would silently change
  // the meaning of every one-, two- and three-argument caller in the app.
  it('keeps three-argument callers behaving exactly as before', () => {
    expect(draftReason(reconciled, 'credit_approved', confirmedTax)).toBeNull();
    expect(draftReason(reconciled, null, confirmedTax)).toBe('not_approved');
    expect(documentStatus(reconciled, 'credit_approved', confirmedTax)).toBe('FINAL');
    expect(documentStatus(reconciled, null, confirmedTax)).toBe('DRAFT');
  });

  it('carries the reason through documentStatus', () => {
    expect(documentStatus(reconciled, 'credit_approved', confirmedTax, { vatBasisConfirmed: false }))
      .toBe('DRAFT');
    expect(documentStatus(reconciled, 'credit_approved', confirmedTax, { vatBasisConfirmed: true }))
      .toBe('FINAL');
  });
});

describe('buildProvenance derives the VAT basis (R11, spec §17.10)', () => {
  /** `welshInputs()` (v6, reconciled, evidenced tax basis) promoted to v8 and
   *  given a registered VAT block with the construction category rated —
   *  base build is non-zero, so the category's charge line is genuinely
   *  material rather than vacuously zero. */
  function vatInputs(evidence_status: 'confirmed' | 'unconfirmed'): CalculatorInputsV8 {
    const v7 = migrateV6toV7(welshInputs());
    const v8 = migrateV7toV8(v7);
    return {
      ...v8,
      // R11 spec §17.6: VAT is deliberately NOT advance-eligible, so a facility
      // draw alone cannot fund it past month 0 — only equity or gross headroom
      // can. Widened to comfortably cover the VAT carry so THIS fixture stays
      // about the draft GATE, not about facility/equity sizing (see
      // monthly-engine.ts:159's "eligible" comment for why raising the
      // facility limit alone does not fund this).
      equity_sources: [{ ...v8.equity_sources[0], amount_pence: 900_000_000 }],
      finance: {
        ...v8.finance,
        committed_net_facility_pence: 500_000_000,
        committed_gross_facility_pence: 600_000_000,
      },
      vat: {
        ...DEFAULT_VAT,
        registered: true,
        treatments: defaultVatTreatments().map((t) => (t.category === 'construction'
          ? {
              ...t, rate_pct: 20, recoverable_pct: 100,
              recovery_basis: 'zero_rated_sale' as const, evidence_status,
            }
          : t)),
      },
    };
  }

  it('holds a document in DRAFT while a material VAT row is unconfirmed', () => {
    const run = runAppraisal(vatInputs('unconfirmed'));
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.vatBasisConfirmed).toBe(false);
    expect(prov.draftReason).toBe('vat_basis_unconfirmed');
    expect(prov.documentStatus).toBe('DRAFT');
  });

  it('reaches FINAL once the bearing VAT row is confirmed', () => {
    const run = runAppraisal(vatInputs('confirmed'));
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.vatBasisConfirmed).toBe(true);
    expect(prov.draftReason).toBeNull();
    expect(prov.documentStatus).toBe('FINAL');
  });

  it('never gates an unregistered document', () => {
    // The migration default (vat.registered: false, every row unconfirmed) —
    // an inert engine has no charge lines to have an opinion about.
    const run = runAppraisal(migrateV7toV8(migrateV6toV7(welshInputs())));
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.vatBasisConfirmed).toBe(true);
    expect(prov.draftReason).toBeNull();
  });
});

describe('buildProvenance derives the tax basis (R8)', () => {
  function withAcquisition(patch: Record<string, unknown>): AnyCalculatorInputs {
    const inputs = JSON.parse(JSON.stringify(sellAllInputs())) as Record<string, unknown>;
    inputs.inputs_version = 5;
    inputs.acquisition = {
      ...(inputs.acquisition as Record<string, unknown>),
      jurisdiction: 'england_ni',
      jurisdiction_source: 'user',
      jurisdiction_evidence_status: 'confirmed',
      acquisition_date: '2026-01-15',
      acquisition_tax_override_pence: null,
      acquisition_tax_override_reason: '',
      ...patch,
    };
    return inputs as unknown as AnyCalculatorInputs;
  }

  it('reports a confirmed jurisdiction with a transaction date as confirmed', () => {
    const prov = buildProvenance(runAppraisal(withAcquisition({})), null);
    expect(prov.taxBasisConfirmed).toBe(true);
    expect(prov.jurisdiction).toBe('england_ni');
    expect(prov.taxTableVersion).toBe('1.0.0');
  });

  it('reports an unconfirmed jurisdiction as unconfirmed', () => {
    const prov = buildProvenance(
      runAppraisal(withAcquisition({ jurisdiction_evidence_status: 'unconfirmed' })),
      null,
      { lenderCaseStatus: 'credit_approved' },
    );
    expect(prov.taxBasisConfirmed).toBe(false);
    expect(prov.draftReason).toBe('tax_basis_unconfirmed');
    expect(prov.documentStatus).toBe('DRAFT');
  });

  it('reports an assumed-current band set as unconfirmed', () => {
    const prov = buildProvenance(
      runAppraisal(withAcquisition({ acquisition_date: null })),
      null,
      { lenderCaseStatus: 'credit_approved' },
    );
    expect(prov.taxBasisConfirmed).toBe(false);
    expect(prov.draftReason).toBe('tax_basis_unconfirmed');
  });

  it('names the jurisdiction actually applied', () => {
    const prov = buildProvenance(runAppraisal(withAcquisition({ jurisdiction: 'scotland' })), null);
    expect(prov.jurisdiction).toBe('scotland');
  });

  // A v2/v3/v4 document carries no jurisdiction field at all. Flipping every
  // stored legacy record to DRAFT for a reason that did not exist when it was
  // saved would be a change of meaning, not a governance improvement.
  it('treats a pre-R8 document as confirmed rather than newly deficient', () => {
    const legacy = migrateInputsToV4(legacyV1Snapshot(), qaProject);
    expect('jurisdiction' in legacy.acquisition).toBe(false);
    const prov = buildProvenance(runAppraisal(legacy), null, {
      lenderCaseStatus: 'credit_approved',
    });
    expect(prov.taxBasisConfirmed).toBe(true);
    expect(prov.draftReason).not.toBe('tax_basis_unconfirmed');
    // …but it must not be reported as having *recorded* the jurisdiction it was
    // defaulted. Able to reach FINAL, obliged to say the basis is assumed.
    expect(prov.jurisdictionRecorded).toBe(false);
    expect(prov.jurisdiction).toBe('england_ni');
  });

  it('counts a v5 document that recorded an explicit null as not recorded', () => {
    // migrateInputsToV5's already-v5 branch spreads a stored null straight over
    // the defaults, so this shape reaches the report in practice.
    const prov = buildProvenance(runAppraisal(withAcquisition({ jurisdiction: null })), null);
    expect(prov.jurisdictionRecorded).toBe(false);
    expect(prov.jurisdiction).toBe('england_ni');
  });

  it('reports a recorded jurisdiction as recorded', () => {
    expect(buildProvenance(runAppraisal(withAcquisition({})), null).jurisdictionRecorded).toBe(true);
    expect(
      buildProvenance(runAppraisal(withAcquisition({ jurisdiction: 'wales' })), null)
        .jurisdictionRecorded,
    ).toBe(true);
  });
});

// R9 (Task 8, Step 5). Spec §7 decides deliberately that an unreconciled area
// bridge produces warnings and never forces DRAFT: unlike an unconfirmed tax
// jurisdiction (knowable on day one), an unallocated balance is frequently and
// legitimately unknown at appraisal stage, and gating on it would put every
// existing appraisal into permanent DRAFT for a number nobody can yet supply.
describe('R9 — the area bridge does not gate the document', () => {
  const approvedStatus = 'credit_approved';

  it('leaves the DraftReason union at its seven R15 members', () => {
    // R8's memory records that the ORDER of this union is load-bearing and that
    // inverting it survived all 1070 tests while being production-reachable.
    // R9 added no member; R11 added exactly one ('vat_basis_unconfirmed', spec
    // §17.10); R14b added exactly one more ('lender_case_stale', spec §21.3);
    // R15 adds exactly one more still ('due_diligence_incomplete', spec §23.7)
    // and this test is what makes that a decision rather than an omission
    // somebody later "fixes".
    //
    // Review fix round 1 (Important 2): a `DraftReason[]` array only checks
    // that the listed literals are ASSIGNABLE to the union, not that they
    // EXHAUST it — an eighth member added elsewhere would not fail that
    // version of this test. A `Record` over the union requires every member
    // as a key: a missing (or, symmetrically, an extra-but-unlisted) member
    // becomes a compile error, which is what actually pins the deliberate
    // non-change.
    const ALL_DRAFT_REASONS: Record<DraftReason, true> = {
      unreconciled: true,
      senior_not_repaid: true,
      tax_basis_unconfirmed: true,
      vat_basis_unconfirmed: true,
      due_diligence_incomplete: true,
      not_approved: true,
      lender_case_stale: true,
    };
    expect(Object.keys(ALL_DRAFT_REASONS)).toHaveLength(7);
  });

  it('keeps a document with a large unallocated balance FINAL when nothing else blocks it', () => {
    // welshInputs() is a proven reconciled, report-safe v6 base (5 units
    // totalling 290 m² NIA) — only the `areas` block is touched, and the basis
    // stays `manual` so the entered bridge does not also swing the funded
    // construction cost (bridge.developed_area_sqm only feeds the cost stack
    // under `bridge_derived`); the bridge's derived arithmetic — and the
    // unallocated-balance warning under test — is computed the same regardless
    // of basis, so any DRAFT outcome can only trace to that warning.
    const inputs = welshInputs();
    inputs.areas = { ...DEFAULT_AREA_BRIDGE, basis: 'manual', existing_gia_sqm: 2000 };
    const run = runAppraisal(inputs);
    expect(run.reconciliation.report_safe).toBe(true);
    // The unallocated balance is a WARNING (spec §15.7) — `reconciliation.issues`
    // (which gates `report_safe`/`draftReason`) carries only errors and
    // model-level issues, so it is `run.validation` — the full list — that
    // proves the warning was raised at all.
    expect(run.validation.some((i) => i.severity === 'warning' && i.field === 'areas.unallocated_sqm')).toBe(true);
    expect(draftReason(run.reconciliation, approvedStatus, { taxBasisConfirmed: true })).toBeNull();
  });

  it('still marks a document unreconciled when the bridge fails a HARD rule', () => {
    // The basis conflict IS resolvable by the user, so it stays a hard error,
    // and hard validation failure already produces `unreconciled` (spec §7).
    const inputs = welshInputs();
    inputs.areas = { ...DEFAULT_AREA_BRIDGE, basis: 'bridge_derived' }; // no existing_gia_sqm entered
    const run = runAppraisal(inputs);
    expect(run.validation.some((i) => i.severity === 'error' && i.field === 'areas.existing_gia_sqm')).toBe(true);
    expect(draftReason(run.reconciliation, approvedStatus, { taxBasisConfirmed: true })).toBe('unreconciled');
  });
});

describe('R14b — lender case staleness (spec §21.3)', () => {
  const ok = { report_safe: true, senior_repaid: true };

  it('reports lender_case_stale for an approved case whose document moved', () => {
    expect(draftReason(ok, 'credit_approved', undefined, undefined, { lenderCaseStale: true }))
      .toBe('lender_case_stale');
    expect(draftReason(ok, 'approved_with_conditions', undefined, undefined, { lenderCaseStale: true }))
      .toBe('lender_case_stale');
  });

  it('never fires for an unapproved case — not_approved wins', () => {
    expect(draftReason(ok, 'declined', undefined, undefined, { lenderCaseStale: true }))
      .toBe('not_approved');
    expect(draftReason(ok, null, undefined, undefined, { lenderCaseStale: true }))
      .toBe('not_approved');
  });

  it('never displaces conditions 1–4', () => {
    expect(draftReason({ report_safe: false, senior_repaid: true }, 'credit_approved',
      undefined, undefined, { lenderCaseStale: true })).toBe('unreconciled');
    expect(draftReason(ok, 'credit_approved', { taxBasisConfirmed: false },
      undefined, { lenderCaseStale: true })).toBe('tax_basis_unconfirmed');
  });

  it('keeps four-argument callers behaving exactly as before', () => {
    expect(draftReason(ok, 'credit_approved')).toBeNull();
  });

  it('carries through documentStatus', () => {
    expect(documentStatus(ok, 'credit_approved', undefined, undefined,
      { lenderCaseStale: true })).toBe('DRAFT');
  });
});

describe('R14b — the transition table mirror (spec §21.2)', () => {
  it('is exactly the Python table', () => {
    // Mirrors tests/test_provenance.py::test_the_table_is_exactly_the_spec_sec_21_2_table.
    expect(ALLOWED_TRANSITIONS).toEqual({
      draft: ['submitted', 'superseded'],
      submitted: ['under_review', 'superseded'],
      under_review: ['information_required', 'credit_approved',
        'approved_with_conditions', 'declined', 'superseded'],
      information_required: ['under_review', 'superseded'],
      credit_approved: ['superseded'],
      approved_with_conditions: ['superseded'],
      declined: ['superseded'],
      superseded: [],
    });
  });
});

describe('R17 — the role matrix mirror (spec §21.2 amended, design §10.3)', () => {
  it('is exactly the Python table', () => {
    // Mirrors tests/test_provenance.py::TestRoleTransitions::test_the_table_is_exactly_the_design_sec_10_3_table.
    expect(ROLE_TRANSITIONS).toEqual({
      submitted: ['developer', 'broker', 'administrator'],
      under_review: ['underwriter', 'credit_approver'],
      information_required: ['underwriter', 'credit_approver'],
      credit_approved: ['credit_approver'],
      approved_with_conditions: ['credit_approver'],
      declined: ['credit_approver'],
      superseded: ['developer', 'broker', 'underwriter', 'credit_approver', 'administrator'],
    });
    expect(CREATE_ROLES).toEqual(['developer', 'broker', 'administrator']);
  });

  it('canTransition reads the table and nothing else', () => {
    expect(canTransition('developer', 'submitted')).toBe(true);
    expect(canTransition('developer', 'under_review')).toBe(false);
    expect(canTransition('underwriter', 'credit_approved')).toBe(false);
    expect(canTransition('credit_approver', 'declined')).toBe(true);
    expect(canTransition('broker', 'superseded')).toBe(true);
    // Creation is not a transition; nobody "transitions" to draft.
    expect(canTransition('administrator', 'draft')).toBe(false);
    // An unknown role is never allowed, superseded included.
    expect(canTransition('viewer', 'superseded')).toBe(false);
  });
});

describe('R14b — structurallyEqual (the unsaved-edit staleness check)', () => {
  it('ignores key order', () => {
    expect(structurallyEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
  });
  it('sees a changed nested value', () => {
    expect(structurallyEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } })).toBe(false);
  });
  it('treats array order as meaningful', () => {
    expect(structurallyEqual([1, 2], [2, 1])).toBe(false);
  });
  it('distinguishes null from absent', () => {
    expect(structurallyEqual({ a: null }, {})).toBe(false);
  });
});

// R14b, spec §21.3. buildProvenance's lender-case wiring: the full LenderCase
// object (when supplied) wins over the bare lenderCaseStatus option, and its
// `stale` flag drives draftReason's new fifth argument. Reuses the same
// FINAL-reaching run construction as the "never gates an unregistered
// document" case above (welshInputs -> v7 -> v8: reconciled, evidenced tax
// basis, unregistered VAT) so the only thing under test is the lender-case
// wiring itself, not the run's own reconciliation.
describe('R14b — buildProvenance derives lender case staleness (spec §21.3)', () => {
  function finalReachingRun() {
    return runAppraisal(migrateV7toV8(migrateV6toV7(welshInputs())));
  }

  function fakeLenderCase(status: LenderCase['status'], stale: boolean): LenderCase {
    return {
      id: 'case-1',
      project_id: 'project-1',
      status,
      locked_inputs_snapshot: {},
      locked_calc_version: '2.14.0',
      locked_inputs_version: 11,
      locked_input_hash: 'hash-input',
      locked_outputs_hash: 'hash-outputs',
      locked_audit_hash: 'hash-audit',
      case_hash: 'hash-case',
      created_by: 'tester',
      submitted_by: 'tester',
      reviewer: 'reviewer',
      decided_by: 'reviewer',
      conditions: null,
      submitted_at: '2026-08-01T00:00:00Z',
      decided_at: '2026-08-02T00:00:00Z',
      stale,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-02T00:00:00Z',
    };
  }

  it('reports lender_case_stale for an approved case whose document moved on', () => {
    const run = finalReachingRun();
    const lenderCase = fakeLenderCase('credit_approved', true);
    const prov = buildProvenance(run, null, { lenderCase });
    expect(prov.lenderCaseStatus).toBe('credit_approved');
    expect(prov.lenderCaseStale).toBe(true);
    expect(prov.draftReason).toBe('lender_case_stale');
  });

  it('reaches FINAL for the same run when the case is not stale', () => {
    const run = finalReachingRun();
    const lenderCase = fakeLenderCase('credit_approved', false);
    const prov = buildProvenance(run, null, { lenderCase });
    expect(prov.documentStatus).toBe('FINAL');
  });

  it('defaults to no lender case, not stale, not approved', () => {
    const run = finalReachingRun();
    const prov = buildProvenance(run, null, {});
    expect(prov.lenderCase).toBeNull();
    expect(prov.lenderCaseStale).toBe(false);
    expect(prov.draftReason).toBe('not_approved');
  });
});

// R15 (spec §23.7). `draftReason` stays pure here too -- it receives the
// due-diligence gate, it does not compute one (that is `dueDiligenceGateFor`,
// tested on its own terms in the buildProvenance describe block below).
// Ordered immediately below vat_basis_unconfirmed for the same rationale
// already written into draftReason(): an unknown due-diligence item does not
// make the arithmetic wrong, so it must not displace a reason saying the
// figures themselves may be -- but it must outrank not_approved, because an
// approval read over unevidenced title, leases or consents is the stale
// case's cousin.
describe('R15 — due diligence in the draft gate (spec §23.7)', () => {
  const reconciled = { report_safe: true, senior_repaid: true };
  const confirmedTax = { taxBasisConfirmed: true };
  const confirmedVat = { vatBasisConfirmed: true };
  const incomplete = { dueDiligenceComplete: false };
  const complete = { dueDiligenceComplete: true };

  it('gates on an incomplete due-diligence catalogue', () => {
    expect(draftReason(reconciled, 'credit_approved', confirmedTax, confirmedVat, undefined, incomplete))
      .toBe('due_diligence_incomplete');
  });

  it('orders below vat_basis_unconfirmed', () => {
    expect(draftReason(reconciled, 'credit_approved', confirmedTax, { vatBasisConfirmed: false }, undefined, incomplete))
      .toBe('vat_basis_unconfirmed');
  });

  it('orders above not_approved with no lender case at all', () => {
    expect(draftReason(reconciled, null, confirmedTax, confirmedVat, undefined, incomplete))
      .toBe('due_diligence_incomplete');
  });

  it('outranks lender_case_stale — the gate is checked before the case even matters', () => {
    expect(draftReason(reconciled, 'credit_approved', confirmedTax, confirmedVat,
      { lenderCaseStale: true }, incomplete)).toBe('due_diligence_incomplete');
  });

  it('does not displace a more fundamental reason', () => {
    expect(draftReason({ report_safe: false, senior_repaid: true }, 'credit_approved',
      confirmedTax, confirmedVat, undefined, incomplete)).toBe('unreconciled');
    expect(draftReason({ report_safe: true, senior_repaid: false }, 'credit_approved',
      confirmedTax, confirmedVat, undefined, incomplete)).toBe('senior_not_repaid');
  });

  // The sixth argument was added after every existing call site was written.
  // A default that did not preserve today's behaviour would silently change
  // the meaning of every one- through five-argument caller in the app.
  it('keeps five-argument callers behaving exactly as before', () => {
    expect(draftReason(reconciled, 'credit_approved', confirmedTax, confirmedVat, { lenderCaseStale: false }))
      .toBeNull();
    expect(draftReason(reconciled, null, confirmedTax, confirmedVat, { lenderCaseStale: false }))
      .toBe('not_approved');
    expect(documentStatus(reconciled, 'credit_approved', confirmedTax, confirmedVat, { lenderCaseStale: false }))
      .toBe('FINAL');
    expect(documentStatus(reconciled, null, confirmedTax, confirmedVat, { lenderCaseStale: false }))
      .toBe('DRAFT');
  });

  it('carries through documentStatus', () => {
    expect(documentStatus(reconciled, 'credit_approved', confirmedTax, confirmedVat, undefined, incomplete))
      .toBe('DRAFT');
    expect(documentStatus(reconciled, 'credit_approved', confirmedTax, confirmedVat, undefined, complete))
      .toBe('FINAL');
  });
});

// R15 (spec §23.7). `ddDoc()` (model/__fixtures__/due-diligence-docs.ts) is
// fixture Y with three entered items still `unknown` (cil_s106,
// leases_tenancies, fire_strategy) and a derived `equity_sources` row that is
// also `unknown` -- the derived row is never counted by
// `entered_unknown_count` (due-diligence.ts) and so must never gate the
// document, only the three entered ones do.
describe('buildProvenance derives the due-diligence gate', () => {
  it('holds a document in DRAFT while entered items are still unknown', () => {
    const run = runAppraisal(ddDoc());
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.dueDiligenceComplete).toBe(false);
    expect(prov.draftReason).toBe('due_diligence_incomplete');
  });

  it('reaches FINAL once every entered item is evidenced, though a derived row may still read unknown', () => {
    const evidence = { source: 'Site solicitor', reference: 'Report ref 1', date: '2026-08-01' };
    const doc = ddDoc({
      status: { cil_s106: 'green', leases_tenancies: 'green', fire_strategy: 'green' },
      evidence: { cil_s106: evidence, leases_tenancies: evidence, fire_strategy: evidence },
    });
    const run = runAppraisal(doc);
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.dueDiligenceComplete).toBe(true);
    expect(prov.draftReason).toBeNull();
    expect(prov.documentStatus).toBe('FINAL');
    // The derived equity_sources row is a fact about the funding structure,
    // not evidence gathered on the due-diligence page — it stays unknown and
    // must not have re-opened the gate this test just closed.
    const equityRow = run.metrics.due_diligence.rows.find((r) => r.code === 'equity_sources');
    expect(equityRow?.status).toBe('unknown');
  });

  it('treats a raw pre-v13 document as due-diligence complete (the R8 exemption)', () => {
    const run = runAppraisal(sellAllInputs());
    expect('due_diligence' in run.inputs).toBe(false);
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.dueDiligenceComplete).toBe(true);
  });
});

// R17 (spec §23.5 amended, design decision 12). The gate's second count:
// two source records disagreeing on a claim, with no evidenced resolution,
// holds the document in DRAFT under the SAME reason the unknown items do.
// Twin of tests/test_provenance.py::TestDueDiligenceComplete.
describe('R17 — the source-conflict half of the due-diligence gate', () => {
  const evidence = { source: 'Site solicitor', reference: 'Report ref 1', date: '2026-08-01' };
  const evidenced = () => ddDoc({
    status: { cil_s106: 'green', leases_tenancies: 'green', fire_strategy: 'green' },
    evidence: { cil_s106: evidence, leases_tenancies: evidence, fire_strategy: evidence },
  });
  const record = (id: string, kind: SourceEvidenceRecord['kind'], existingUse: string): SourceEvidenceRecord => ({
    id, kind, captured_at: '2026-08-01', reference: `ref ${id}`, captured_by: 'tester',
    narrative_excerpt: null, claims: { ...emptyClaims(), existing_use: existingUse },
  });
  const conflicting = [record('rec-1', 'listing_structured', 'office'), record('rec-2', 'measured_survey', 'retail')];
  const withRecords = (
    records: SourceEvidenceRecord[], resolutions: SourceConflictResolution[],
  ): CalculatorInputsV17 => {
    const doc = evidenced();
    return { ...doc, due_diligence: { ...doc.due_diligence, source_records: records, source_resolutions: resolutions } };
  };

  it('two conflicting records without a resolution hold the document in DRAFT', () => {
    const run = runAppraisal(withRecords(conflicting, []));
    expect(run.metrics.due_diligence.totals.entered_unknown_count).toBe(0);
    expect(run.metrics.due_diligence.unresolved_source_conflicts).toBe(1);
    expect(dueDiligenceGateFor(run).dueDiligenceComplete).toBe(false);
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.draftReason).toBe('due_diligence_incomplete');
    expect(prov.documentStatus).toBe('DRAFT');
  });

  it('an evidenced resolution closes the gate', () => {
    const resolution: SourceConflictResolution = {
      id: 'res-1', field: 'existing_use', resolved_value: 'office', chosen_record_id: 'rec-1',
      evidence_reference: 'Survey p.3', resolved_by: 'tester', resolved_at: '2026-08-02', reason: 'measured',
    };
    const run = runAppraisal(withRecords(conflicting, [resolution]));
    expect(run.metrics.due_diligence.unresolved_source_conflicts).toBe(0);
    expect(dueDiligenceGateFor(run).dueDiligenceComplete).toBe(true);
    const prov = buildProvenance(run, null, { lenderCaseStatus: 'credit_approved' });
    expect(prov.draftReason).toBeNull();
    expect(prov.documentStatus).toBe('FINAL');
  });
});

// R17 (spec §12, §27.2). The three panel rows the benchmark release adds:
// the report unit (a presentation preference, stated and never hashed) and,
// when the run carries a benchmark block, the set and index versions the
// memo's §12C comparison was computed from — read off the run's own result
// block, never re-derived.
describe('report area unit and benchmark rows (R17, spec §12)', () => {
  it('defaults the report unit to metric and prints no benchmark rows without a block', () => {
    const run = runAppraisal(costPlanInTimeInputs());
    expect(run.metrics.elemental_benchmark).toBeNull();
    const prov = buildProvenance(run, null);
    expect(prov.reportAreaUnit).toBe('metric');
    expect(prov.benchmarkDatasetVersion).toBeNull();
    expect(prov.benchmarkContentHash).toBeNull();
    expect(prov.indexDatasetVersion).toBeNull();
  });

  it('carries the caller\'s area unit', () => {
    const run = runAppraisal(costPlanInTimeInputs());
    expect(buildProvenance(run, null, { areaUnit: 'imperial' }).reportAreaUnit).toBe('imperial');
  });

  it('reports the benchmark set and index dataset versions off the result block', () => {
    const run = runAppraisal(benchmarkInputs());
    const eb = run.metrics.elemental_benchmark!;
    expect(eb).not.toBeNull();
    const prov = buildProvenance(run, null);
    expect(prov.benchmarkDatasetVersion).toBe(eb.dataset_version);
    expect(prov.benchmarkContentHash).toBe(eb.content_hash);
    expect(prov.benchmarkContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.indexDatasetVersion).toBe(eb.index_dataset_version);
  });
});
