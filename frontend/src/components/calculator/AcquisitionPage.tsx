import { useMemo } from 'react';
import type { CalculatorInputsV2, AppraisalRun } from '../../lib/model';
import { calculateCommercialSdlt } from '../../lib/commercial-sdlt';
import { calculateBrokerFee } from '../../lib/conversion-calc-engine';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV2;
  onChange: (partial: Partial<CalculatorInputsV2>) => void;
  run: AppraisalRun;
}

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

export default function AcquisitionPage({ inputs, onChange, run }: Props) {
  const acq = inputs.acquisition;
  const sdlt = useMemo(() => calculateCommercialSdlt(acq.purchase_price_pence), [acq.purchase_price_pence]);

  const updateAcq = (partial: Partial<typeof acq>) => {
    onChange({ acquisition: { ...acq, ...partial } });
  };

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
          <span>{penceToPounds(run.metrics.acquisition_cost_pence)}</span>
        </div>
      </div>
    </div>
  );
}
