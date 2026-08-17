import { describe, it, expect } from 'vitest';
import { draftReason, documentStatus, buildProvenance } from './report-provenance';
import { runAppraisal, migrateInputsToV4 } from './model';
import type { AnyCalculatorInputs } from './model';
import { qaProject, sellAllInputs, legacyV1Snapshot } from './report-qa/memo-fixtures';

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
