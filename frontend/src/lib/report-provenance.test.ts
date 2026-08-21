import { describe, it, expect } from 'vitest';
import { draftReason, documentStatus, buildProvenance } from './report-provenance';
import type { DraftReason } from './report-provenance';
import {
  runAppraisal, migrateInputsToV4, DEFAULT_AREA_BRIDGE,
  migrateV6toV7, migrateV7toV8, DEFAULT_VAT, defaultVatTreatments,
} from './model';
import type { AnyCalculatorInputs, CalculatorInputsV8 } from './model';
import {
  qaProject, sellAllInputs, legacyV1Snapshot, welshInputs,
} from './report-qa/memo-fixtures';

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

  it('leaves the DraftReason union at its five R11 members', () => {
    // R8's memory records that the ORDER of this union is load-bearing and that
    // inverting it survived all 1070 tests while being production-reachable.
    // R9 added no member; R11 adds exactly one ('vat_basis_unconfirmed', spec
    // §17.10) and this test is what makes that a decision rather than an
    // omission somebody later "fixes".
    //
    // Review fix round 1 (Important 2): a `DraftReason[]` array only checks
    // that the listed literals are ASSIGNABLE to the union, not that they
    // EXHAUST it — a sixth member added elsewhere would not fail that version
    // of this test. A `Record` over the union requires every member as a key:
    // a missing (or, symmetrically, an extra-but-unlisted) member becomes a
    // compile error, which is what actually pins the deliberate non-change.
    const ALL_DRAFT_REASONS: Record<DraftReason, true> = {
      unreconciled: true,
      senior_not_repaid: true,
      tax_basis_unconfirmed: true,
      vat_basis_unconfirmed: true,
      not_approved: true,
    };
    expect(Object.keys(ALL_DRAFT_REASONS)).toHaveLength(5);
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
