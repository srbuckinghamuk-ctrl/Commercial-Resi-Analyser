import { useState } from 'react';
import type { CalculatorInputsV6, AppraisalRun } from '../../lib/model';
import type { Jurisdiction } from '../../lib/tax/acquisition-tax';
import { calculateBrokerFee } from '../../lib/conversion-calc-engine';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV6;
  onChange: (partial: Partial<CalculatorInputsV6>) => void;
  run: AppraisalRun;
  /** Only used to name the postcode a derived jurisdiction came from. */
  project?: { address_postcode: string | null } | null;
}

const AMBER = '#f59e0b';
const AMBER_TEXT = '#fbbf24';
const AMBER_BG = '#451a03';
const RED = '#ef4444';
const RED_TEXT = '#f87171';
const GREEN = '#22c55e';

const JURISDICTIONS: { value: Jurisdiction; label: string; regime: string }[] = [
  { value: 'england_ni', label: 'England & Northern Ireland', regime: 'SDLT' },
  { value: 'scotland', label: 'Scotland', regime: 'LBTT' },
  { value: 'wales', label: 'Wales', regime: 'LTT' },
];

function jurisdictionLabel(j: Jurisdiction): string {
  return JURISDICTIONS.find((o) => o.value === j)?.label ?? j;
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: '#0f172a',
  border: '1px solid #1e3a5f',
  borderRadius: 4,
  color: '#e2e8f0',
  fontSize: 14,
};

function PenceInputRow({ label, penceValue, onChangePence }: {
  label: string;
  penceValue: number;
  onChangePence: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>{label}</label>
      <div style={{ position: 'relative', width: 160 }}>
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
        <input
          type="number"
          value={penceValue ? penceValue / 100 : ''}
          onChange={(e) => onChangePence(Math.round(Number(e.target.value) * 100))}
          style={{
            width: '100%',
            padding: '6px 10px 6px 24px',
            background: '#0f172a',
            border: '1px solid #1e3a5f',
            borderRadius: 4,
            color: '#e2e8f0',
            fontSize: 14,
          }}
        />
      </div>
    </div>
  );
}

function InputRow({ label, value, onChangeValue, suffix }: {
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={{
          width: 160,
          padding: '6px 10px',
          background: '#0f172a',
          border: '1px solid #1e3a5f',
          borderRadius: 4,
          color: '#e2e8f0',
          fontSize: 14,
        }}
      />
      {suffix && <span style={{ color: '#64748b', fontSize: 13 }}>{suffix}</span>}
    </div>
  );
}

export default function AcquisitionPage({ inputs, onChange, run, project }: Props) {
  const acq = inputs.acquisition;

  // R8 Task 11 (defect A). The page used to compute its own England/NI-only
  // figure here while "Total Acquisition Cost" below read the jurisdiction-aware
  // `run.metrics.acquisition_cost_pence`, so a Welsh document showed two
  // different taxes on one screen. Both now come from the same run:
  // `run.metrics.acquisition_tax` IS the AcquisitionTaxResult `deriveMetrics`
  // charged inside `acquisition_cost_pence` (metrics.ts), carrying the
  // document's jurisdiction, date, band set, source and override provenance.
  // Reading it — rather than re-calling `calculateAcquisitionTax` with a second
  // copy of the arguments — is what makes the two figures incapable of drifting
  // apart again, and keeps this component free of any calculation of its own.
  const tax = run.metrics.acquisition_tax;

  const [overrideOpen, setOverrideOpen] = useState(acq.acquisition_tax_override_pence !== null);

  const updateAcq = (partial: Partial<typeof acq>) => {
    onChange({ acquisition: { ...acq, ...partial } });
  };

  const unconfirmed = acq.jurisdiction_evidence_status === 'unconfirmed';
  const dateBasisAssumed = tax.date_basis === 'assumed_current';

  // Rendered, never re-derived: `validateInputs` (spec §14) owns the rule that
  // an override must state a reason.
  const overrideReasonIssue = run.validation.find(
    (i) => i.field === 'acquisition.acquisition_tax_override_reason',
  );
  const acquisitionDateIssue = run.validation.find(
    (i) => i.field === 'acquisition.acquisition_date',
  );

  const derivedFrom = project?.address_postcode ?? null;
  const sourceLine = acq.jurisdiction_source === 'derived'
    ? (derivedFrom
      ? `Derived from postcode ${derivedFrom} — ${jurisdictionLabel(acq.jurisdiction)}`
      : `Derived from the project postcode — ${jurisdictionLabel(acq.jurisdiction)}`)
    : acq.jurisdiction_source === 'user'
      ? `Set on this appraisal — ${jurisdictionLabel(acq.jurisdiction)}`
      : `No jurisdiction recorded — defaulted to ${jurisdictionLabel(acq.jurisdiction)}`;

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>1. Acquisition Inputs</h3>

      <PenceInputRow
        label="Purchase price (£)"
        penceValue={acq.purchase_price_pence}
        onChangePence={(v) => updateAcq({ purchase_price_pence: v })}
      />
      <PenceInputRow
        label="Legal fees (£)"
        penceValue={acq.legal_fees_pence}
        onChangePence={(v) => updateAcq({ legal_fees_pence: v })}
      />
      <PenceInputRow
        label="Survey cost (£)"
        penceValue={acq.survey_cost_pence}
        onChangePence={(v) => updateAcq({ survey_cost_pence: v })}
      />
      <InputRow
        label="Broker fee (%)"
        value={acq.broker_fee_pct}
        onChangeValue={(v) => updateAcq({ broker_fee_pct: v })}
        suffix={penceToPounds(calculateBrokerFee(acq.purchase_price_pence, acq.broker_fee_pct))}
      />
      <PenceInputRow
        label="Other costs (£)"
        penceValue={acq.other_acquisition_costs_pence}
        onChangePence={(v) => updateAcq({ other_acquisition_costs_pence: v })}
      />

      {/* --- Tax basis (spec §14) --- */}
      <h4 style={{ color: '#94a3b8', fontSize: 13, marginTop: 28, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Acquisition tax basis
      </h4>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label htmlFor="acq-jurisdiction" style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Tax jurisdiction</label>
        <select
          id="acq-jurisdiction"
          value={acq.jurisdiction}
          // Choosing a jurisdiction records WHO set it (`'user'`), not that it
          // has been evidenced. See the report: confirmation stays a separate,
          // deliberate act so that browsing the three regimes cannot silently
          // clear the §14 draft gate.
          onChange={(e) => updateAcq({
            jurisdiction: e.target.value as Jurisdiction,
            jurisdiction_source: 'user',
            jurisdiction_evidence_status: 'unconfirmed',
          })}
          style={selectStyle}
        >
          {JURISDICTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label} ({o.regime})</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label htmlFor="acq-date" style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Acquisition date</label>
        <input
          id="acq-date"
          type="date"
          value={acq.acquisition_date ?? ''}
          onChange={(e) => updateAcq({ acquisition_date: e.target.value === '' ? null : e.target.value })}
          style={selectStyle}
        />
        <span style={{ color: '#64748b', fontSize: 12 }}>selects the band set in force</span>
      </div>

      {acquisitionDateIssue && (
        <div style={{ color: RED_TEXT, fontSize: 12, marginBottom: 12, marginLeft: 232 }}>
          {acquisitionDateIssue.message}
        </div>
      )}

      {/* The same amber "requires confirmation" treatment FinancePage gives
          unevidenced facility terms and equity sources — one mechanism for
          evidence across the app, not two. */}
      {unconfirmed ? (
        <div
          style={{
            background: AMBER_BG, border: `1px solid ${AMBER}`, borderRadius: 8,
            padding: '10px 16px', marginBottom: 20, color: AMBER_TEXT, fontSize: 13,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>
            {sourceLine} — unconfirmed. Acquisition tax is charged as {tax.regime} and the
            report stays a draft until the basis is confirmed.
          </span>
          <button
            onClick={() => updateAcq({
              jurisdiction_source: 'user',
              jurisdiction_evidence_status: 'confirmed',
            })}
            style={{ padding: '6px 14px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap', marginLeft: 12 }}
          >
            Confirm jurisdiction
          </button>
        </div>
      ) : dateBasisAssumed ? (
        // Fix round 1. `taxBasisConfirmedFor` (report-provenance.ts) requires
        // BOTH a confirmed jurisdiction AND `date_basis === 'transaction_date'`,
        // so a confirmed jurisdiction with no usable acquisition date still
        // watermarks the memo DRAFT — TAX BASIS UNCONFIRMED. A flat green
        // "confirmed" here contradicted that. Name what is still outstanding.
        <div style={{ color: AMBER_TEXT, fontSize: 13, marginBottom: 20 }}>
          {sourceLine} — jurisdiction confirmed, but no usable acquisition date is recorded,
          so the band set currently in force is assumed. The tax basis is not fully evidenced
          and the report stays a draft until a date is given.
        </div>
      ) : (
        <div style={{ color: GREEN, fontSize: 13, marginBottom: 20 }}>
          {sourceLine} — confirmed. Acquisition tax is charged as {tax.regime}.
        </div>
      )}

      {/* --- Band breakdown, named for the regime actually applied --- */}
      <div style={{ marginTop: 8, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <h4 style={{ color: '#e2e8f0', fontSize: 15, marginBottom: 4 }}>{tax.regime} Breakdown</h4>
        <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
          {jurisdictionLabel(tax.jurisdiction)} non-residential bands effective from{' '}
          {tax.band_set_effective_from} (table v{tax.table_version}){' '}
          <a href={tax.source_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>
            Source
          </a>
          {dateBasisAssumed && (
            <span style={{ color: AMBER_TEXT }}>
              {' '}— no usable acquisition date recorded, so the band set currently in force is assumed.
            </span>
          )}
        </div>
        {tax.bands.map((band, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: '#94a3b8', fontSize: 13 }}>
            <span>{band.rate_pct}% band</span>
            <span>{penceToPounds(band.tax_pence)}</span>
          </div>
        ))}
        {tax.surcharge_pence > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: '#94a3b8', fontSize: 13 }}>
            <span>Surcharge</span>
            <span>{penceToPounds(tax.surcharge_pence)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e3a5f', color: '#e2e8f0', fontWeight: 600 }}>
          <span>Total {tax.regime}</span>
          <span>{penceToPounds(tax.total_pence)} ({tax.effective_rate_pct.toFixed(1)}%)</span>
        </div>
        {tax.is_override && tax.computed_total_pence !== null && (
          <div style={{ color: AMBER_TEXT, fontSize: 12, marginTop: 8 }}>
            Overridden — the band calculation of {penceToPounds(tax.computed_total_pence)} was
            replaced. Reason: {tax.override_reason?.trim() ? tax.override_reason : '(none recorded)'}
          </div>
        )}
      </div>

      {/* --- Override, collapsed by default --- */}
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => setOverrideOpen((o) => !o)}
          aria-expanded={overrideOpen}
          style={{ padding: '6px 12px', background: '#1e293b', color: '#94a3b8', border: '1px solid #1e3a5f', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
        >
          {overrideOpen ? '▾' : '▸'} Override {tax.regime}
        </button>
        {overrideOpen && (
          <div style={{ marginTop: 12, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
              Set only where a relief, linked transaction or other rule the band table does not
              model applies. A reason is mandatory.
            </div>
            {/* Not PenceInputRow: that row cannot express the difference
                between "no override" and "an override of £0", and a full relief
                is a real, recordable zero. Blank is null; 0 is zero. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <label htmlFor="acq-override-pence" style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>
                Override {tax.regime} (£)
              </label>
              <div style={{ position: 'relative', width: 160 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                <input
                  id="acq-override-pence"
                  type="number"
                  value={acq.acquisition_tax_override_pence === null ? '' : acq.acquisition_tax_override_pence / 100}
                  onChange={(e) => updateAcq({
                    acquisition_tax_override_pence:
                      e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                  })}
                  style={{ ...selectStyle, width: '100%', padding: '6px 10px 6px 24px' }}
                />
              </div>
              <span style={{ color: '#64748b', fontSize: 12 }}>blank = no override</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <label htmlFor="acq-override-reason" style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Override reason</label>
              <input
                id="acq-override-reason"
                type="text"
                value={acq.acquisition_tax_override_reason}
                onChange={(e) => updateAcq({ acquisition_tax_override_reason: e.target.value })}
                style={{ ...selectStyle, flex: 1, minWidth: 240 }}
              />
            </div>
            {overrideReasonIssue && (
              <div style={{ color: RED_TEXT, fontSize: 12, marginLeft: 232, border: `1px solid ${RED}`, borderRadius: 4, padding: '6px 10px', background: 'rgba(239, 68, 68, 0.12)' }}>
                {overrideReasonIssue.message}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>
          <span>Total Acquisition Cost</span>
          <span>{penceToPounds(run.metrics.acquisition_cost_pence)}</span>
        </div>
      </div>
    </div>
  );
}
