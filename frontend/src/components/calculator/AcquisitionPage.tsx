import { useMemo } from 'react';
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';
import { calculateCommercialSdlt } from '../../lib/commercial-sdlt';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
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

export default function AcquisitionPage({ inputs, onChange, metrics }: Props) {
  const acq = inputs.acquisition;
  const sdlt = useMemo(() => calculateCommercialSdlt(acq.purchase_price_pence), [acq.purchase_price_pence]);

  const updateAcq = (partial: Partial<typeof acq>) => {
    onChange({ acquisition: { ...acq, ...partial } });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>1. Acquisition Inputs</h3>

      <InputRow
        label="Purchase price (pence)"
        value={acq.purchase_price_pence}
        onChangeValue={(v) => updateAcq({ purchase_price_pence: v })}
        suffix={penceToPounds(acq.purchase_price_pence)}
      />
      <InputRow
        label="Legal fees (pence)"
        value={acq.legal_fees_pence}
        onChangeValue={(v) => updateAcq({ legal_fees_pence: v })}
        suffix={penceToPounds(acq.legal_fees_pence)}
      />
      <InputRow
        label="Survey cost (pence)"
        value={acq.survey_cost_pence}
        onChangeValue={(v) => updateAcq({ survey_cost_pence: v })}
        suffix={penceToPounds(acq.survey_cost_pence)}
      />
      <InputRow
        label="Broker fee (%)"
        value={acq.broker_fee_pct}
        onChangeValue={(v) => updateAcq({ broker_fee_pct: v })}
        suffix={penceToPounds(Math.round(acq.purchase_price_pence * acq.broker_fee_pct / 100))}
      />
      <InputRow
        label="Other costs (pence)"
        value={acq.other_acquisition_costs_pence}
        onChangeValue={(v) => updateAcq({ other_acquisition_costs_pence: v })}
        suffix={penceToPounds(acq.other_acquisition_costs_pence)}
      />

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <h4 style={{ color: '#e2e8f0', fontSize: 15, marginBottom: 12 }}>SDLT Breakdown</h4>
        {sdlt.bands.map((band, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: '#94a3b8', fontSize: 13 }}>
            <span>{band.rate_pct}% band</span>
            <span>{penceToPounds(band.tax_pence)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e3a5f', color: '#e2e8f0', fontWeight: 600 }}>
          <span>Total SDLT</span>
          <span>{penceToPounds(sdlt.total_pence)} ({sdlt.effective_rate_pct.toFixed(1)}%)</span>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>
          <span>Total Acquisition Cost</span>
          <span>{penceToPounds(metrics.total_acquisition_cost_pence)}</span>
        </div>
      </div>
    </div>
  );
}
