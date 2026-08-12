import type { CalculatorInputs, AppraisalMetrics, FundingSource, InterestType } from '../../lib/conversion-types';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

export default function FinancePage({ inputs, onChange, metrics }: Props) {
  const fin = inputs.finance;

  const updateFinance = (partial: Partial<typeof fin>) => {
    onChange({ finance: { ...fin, ...partial } });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>4. Finance Structure</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
          <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Funding source</label>
          <select
            value={fin.funding_source}
            onChange={(e) => updateFinance({ funding_source: e.target.value as FundingSource })}
            style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
          >
            <option value="cash">Cash</option>
            <option value="bridging">Bridging Loan</option>
            <option value="development_finance">Development Finance</option>
          </select>
        </div>

        {fin.funding_source !== 'cash' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>LTV (%)</label>
              <input type="number" value={fin.ltv_pct} onChange={(e) => updateFinance({ ltv_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Interest rate (% p.a.)</label>
              <input type="number" step="0.1" value={fin.interest_rate_annual_pct} onChange={(e) => updateFinance({ interest_rate_annual_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Arrangement fee (%)</label>
              <input type="number" step="0.1" value={fin.arrangement_fee_pct} onChange={(e) => updateFinance({ arrangement_fee_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Exit fee (%)</label>
              <input type="number" step="0.1" value={fin.exit_fee_pct} onChange={(e) => updateFinance({ exit_fee_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Loan term (months)</label>
              <input type="number" value={fin.loan_term_months} onChange={(e) => updateFinance({ loan_term_months: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Interest type</label>
              <select
                value={fin.interest_type}
                onChange={(e) => updateFinance({ interest_type: e.target.value as InterestType })}
                style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              >
                <option value="rolled_up">Rolled Up</option>
                <option value="serviced">Serviced</option>
              </select>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Loan amount</span>
          <span>{penceToPounds(metrics.loan_amount_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Equity required</span>
          <span>{penceToPounds(metrics.equity_required_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16, paddingTop: 8, borderTop: '1px solid #1e3a5f' }}>
          <span>Total Finance Cost</span>
          <span>{penceToPounds(metrics.total_finance_cost_pence)}</span>
        </div>
      </div>
    </div>
  );
}
