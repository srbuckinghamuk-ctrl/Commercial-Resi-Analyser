import type {
  CalculatorInputsV8, AppraisalRun, VatChargeCategory, VatTreatment,
  RecoveryBasis, TogcTreatment, EvidenceStatus,
} from '../../lib/model';
import { VAT_CHARGE_CATEGORIES } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV8;
  onChange: (partial: Partial<CalculatorInputsV8>) => void;
  run: AppraisalRun;
}

const CATEGORY_LABEL: Record<VatChargeCategory, string> = {
  acquisition: 'Acquisition',
  construction: 'Construction',
  professional: 'Professional fees',
  statutory: 'Statutory costs',
  selling: 'Selling costs',
  lender_ancillary: 'Lender ancillary (finance)',
};

const RECOVERY_BASES: readonly RecoveryBasis[] = [
  'zero_rated_sale', 'partial_exemption', 'blocked', 'unconfirmed',
];
const RECOVERY_BASIS_LABEL: Record<RecoveryBasis, string> = {
  zero_rated_sale: 'Zero-rated sale',
  partial_exemption: 'Partial exemption',
  blocked: 'Blocked',
  unconfirmed: 'Unconfirmed',
};

const TOGC_TREATMENTS: readonly TogcTreatment[] = ['applies', 'does_not_apply', 'unconfirmed'];
const TOGC_LABEL: Record<TogcTreatment, string> = {
  applies: 'TOGC applies',
  does_not_apply: 'TOGC does not apply',
  unconfirmed: 'Unconfirmed',
};

// Same vocabulary as FinancePage.tsx's EquitySource editor (R8 precedent,
// reused deliberately rather than invented a second time -- spec §17.1's
// VatTreatment.evidence_status doc comment).
const EVIDENCE_STATUSES: readonly EvidenceStatus[] = ['confirmed', 'unconfirmed', 'rejected'];

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' };
const labelStyle: React.CSSProperties = { color: '#94a3b8', width: 260, fontSize: 14 };
const selectStyle: React.CSSProperties = { padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 };
const numStyle: React.CSSProperties = { width: 90, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 };
const textStyle: React.CSSProperties = { width: 220, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 };
const summaryRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 };

export default function VatPage({ inputs, onChange, run }: Props) {
  const vatInputs = inputs.vat;
  const vatResult = run.metrics.vat;
  const carryInterest = run.metrics.vat_carry_interest_pence;

  // R11 spec §17.2 rule 3. The write-side row editor for the FIXED six-row
  // array (schema, not a user-managed list -- §17.1: a user edits rows, a
  // user never adds or removes one). Read ONCE here, reused by every row
  // below through the local `treatments` binding -- never compared against a
  // `vat_override` to decide which figure is charged, so this is the write
  // side of the mechanism the schema carries, not a second implementation of
  // `resolveVatTreatment`'s override-over-category precedence (spec §17.2
  // rule 1). Same category of exemption as validation.ts's structural reads
  // (accessor-guard.test.ts), scoped at this one call site rather than
  // file-wide.
  // eslint-disable-next-line no-restricted-syntax -- see comment above
  const treatments = vatInputs.treatments;

  const updateVat = (partial: Partial<typeof vatInputs>) => {
    onChange({ vat: { ...vatInputs, ...partial } });
  };

  const updateTreatment = (category: VatChargeCategory, partial: Partial<VatTreatment>) => {
    updateVat({
      treatments: treatments.map((t) => (t.category === category ? { ...t, ...partial } : t)),
    });
  };

  const updatePurchase = (partial: Partial<typeof vatInputs.purchase>) => {
    updateVat({ purchase: { ...vatInputs.purchase, ...partial } });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>5. VAT</h3>

      <div style={rowStyle}>
        <label style={labelStyle}>VAT registered</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#e2e8f0', fontSize: 14 }}>
          <input
            type="checkbox"
            aria-label="VAT registered"
            checked={vatInputs.registered}
            onChange={(e) => updateVat({ registered: e.target.checked })}
          />
          Registered for VAT
        </label>
      </div>
      {!vatInputs.registered && (
        <p style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
          Not registered: every VAT figure below is zero and no reclaim is scheduled, whatever the
          treatment rows below say (spec §17.1).
        </p>
      )}

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Return cycle
      </h4>
      <div style={rowStyle}>
        <label style={labelStyle}>Return frequency</label>
        <select
          aria-label="Return frequency"
          value={vatInputs.return_frequency}
          onChange={(e) => updateVat({ return_frequency: e.target.value as 'monthly' | 'quarterly' })}
          style={selectStyle}
        >
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>First period end (month)</label>
        <input
          type="number"
          aria-label="First period end month"
          value={vatInputs.first_period_end_month}
          onChange={(e) => updateVat({ first_period_end_month: Number(e.target.value) })}
          style={numStyle}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Repayment lag (months)</label>
        <input
          type="number"
          aria-label="Repayment lag months"
          value={vatInputs.repayment_lag_months}
          onChange={(e) => updateVat({ repayment_lag_months: Number(e.target.value) })}
          style={numStyle}
        />
      </div>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Treatment by category
      </h4>
      {VAT_CHARGE_CATEGORIES.map((category) => {
        const row = treatments.find((t) => t.category === category);
        if (row === undefined) return null; // schema invariant (§17.1): always present after migration
        const label = CATEGORY_LABEL[category];
        return (
          <div key={category} style={rowStyle}>
            <label style={labelStyle}>{label}</label>
            <div style={{ position: 'relative', width: 90 }}>
              <input
                type="number"
                aria-label={`${label} rate %`}
                value={row.rate_pct}
                onChange={(e) => updateTreatment(category, { rate_pct: Number(e.target.value) })}
                style={{ ...numStyle, width: '100%' }}
              />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>%</span>
            </div>
            <div style={{ position: 'relative', width: 90 }}>
              <input
                type="number"
                aria-label={`${label} recoverable %`}
                value={row.recoverable_pct}
                onChange={(e) => updateTreatment(category, { recoverable_pct: Number(e.target.value) })}
                style={{ ...numStyle, width: '100%' }}
              />
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>%</span>
            </div>
            <select
              aria-label={`${label} recovery basis`}
              value={row.recovery_basis}
              onChange={(e) => updateTreatment(category, { recovery_basis: e.target.value as RecoveryBasis })}
              style={selectStyle}
            >
              {RECOVERY_BASES.map((b) => <option key={b} value={b}>{RECOVERY_BASIS_LABEL[b]}</option>)}
            </select>
            {/* Ruling R44 -- required, not optional (task-14 brief). Nothing
                else in the product lets a user move a row to 'confirmed'; the
                draft gate (§17.10) and the spider's tax-advantage axis (R43)
                both depend on this control existing. */}
            <select
              aria-label={`${label} evidence status`}
              value={row.evidence_status}
              onChange={(e) => updateTreatment(category, { evidence_status: e.target.value as EvidenceStatus })}
              style={selectStyle}
            >
              {EVIDENCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              type="text"
              aria-label={`${label} notes`}
              placeholder="Notes"
              value={row.notes}
              onChange={(e) => updateTreatment(category, { notes: e.target.value })}
              style={textStyle}
            />
          </div>
        );
      })}

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Purchase VAT / TOGC
      </h4>
      <div style={rowStyle}>
        <label style={labelStyle}>Vendor opted to tax</label>
        <input
          type="checkbox"
          aria-label="Vendor opted to tax"
          checked={vatInputs.purchase.vendor_opted_to_tax}
          onChange={(e) => updatePurchase({ vendor_opted_to_tax: e.target.checked })}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>TOGC treatment</label>
        <select
          aria-label="TOGC treatment"
          value={vatInputs.purchase.togc_treatment}
          onChange={(e) => updatePurchase({ togc_treatment: e.target.value as TogcTreatment })}
          style={selectStyle}
        >
          {TOGC_TREATMENTS.map((t) => <option key={t} value={t}>{TOGC_LABEL[t]}</option>)}
        </select>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Purchase VAT evidence</label>
        {/* Ruling R44 -- the purchase leg's OWN evidence control. Distinct
            from any treatment row's evidence_status (spec §17.12 doc comment
            on `purchase_evidence_status`): a document can have one confirmed
            while the other is not. */}
        <select
          aria-label="Purchase VAT evidence status"
          value={vatInputs.purchase.evidence_status}
          onChange={(e) => updatePurchase({ evidence_status: e.target.value as EvidenceStatus })}
          style={selectStyle}
        >
          {EVIDENCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Purchase VAT notes</label>
        <input
          type="text"
          aria-label="Purchase VAT notes"
          value={vatInputs.purchase.notes}
          onChange={(e) => updatePurchase({ notes: e.target.value })}
          style={textStyle}
        />
      </div>

      {/* Resolved position. Every figure below is read from run.metrics.vat
          or run.metrics -- never recomputed here (R9's sixth plan defect was
          arithmetic in JSX; this release exists to eliminate that pattern). */}
      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={summaryRow}>
          <span>Total input VAT</span>
          <span>{penceToPounds(vatResult.total_input_vat_pence)}</span>
        </div>
        <div style={summaryRow}>
          <span>Total reclaimed</span>
          <span>{penceToPounds(vatResult.total_reclaimed_pence)}</span>
        </div>
        <div style={summaryRow}>
          <span>Irrecoverable VAT (a cost of the scheme)</span>
          <span>{penceToPounds(run.metrics.irrecoverable_vat_pence)}</span>
        </div>
        <div style={summaryRow}>
          <span>Peak VAT carry</span>
          <span>
            {penceToPounds(vatResult.peak_carry_pence)}
            {vatResult.peak_carry_month != null ? ` (month ${vatResult.peak_carry_month})` : ''}
          </span>
        </div>
        {/* Ruling R32 -- may legitimately be negative (equity funds the VAT,
            the reclaim repays senior debt, the facility ends up smaller).
            Shown with its sign, never clamped, and read as a SAVING when
            negative rather than a cost. */}
        <div style={summaryRow}>
          <span>VAT carry interest</span>
          <span style={{ color: carryInterest < 0 ? '#22c55e' : '#e2e8f0' }}>
            {penceToPounds(carryInterest)}
            {carryInterest < 0 ? ' (a saving -- carrying VAT reduced net interest, spec §17.12 R32)' : ''}
          </span>
        </div>
        <div style={summaryRow}>
          <span>Receivable at maturity (reported, not in the cash flow)</span>
          <span>{penceToPounds(vatResult.receivable_at_maturity_pence)}</span>
        </div>
        <div style={{ ...summaryRow, marginBottom: 0 }}>
          <span>Chargeable consideration (acquisition tax base)</span>
          <span>{penceToPounds(run.metrics.chargeable_consideration_pence)}</span>
        </div>
      </div>
    </div>
  );
}
