import { useCallback } from 'react';
import type { RiskItem, Likelihood, Impact } from '../../lib/conversion-types';
import type { CalculatorInputsV2 } from '../../lib/model';

interface Props {
  inputs: CalculatorInputsV2;
  onChange: (partial: Partial<CalculatorInputsV2>) => void;
}

const LIKELIHOOD_OPTIONS: Likelihood[] = ['low', 'medium', 'high'];
const IMPACT_OPTIONS: Impact[] = ['low', 'medium', 'high'];

const SCORE_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

export default function RiskRegisterPage({ inputs, onChange }: Props) {
  const risks = inputs.risks;

  const updateRisks = useCallback(
    (newRisks: RiskItem[]) => {
      onChange({ risks: newRisks });
    },
    [onChange],
  );

  const addRisk = useCallback(() => {
    updateRisks([
      ...risks,
      { id: crypto.randomUUID(), description: '', likelihood: 'medium', impact: 'medium', mitigation: '' },
    ]);
  }, [risks, updateRisks]);

  const removeRisk = useCallback(
    (id: string) => {
      updateRisks(risks.filter((r) => r.id !== id));
    },
    [risks, updateRisks],
  );

  const updateRisk = useCallback(
    (id: string, partial: Partial<RiskItem>) => {
      updateRisks(risks.map((r) => (r.id === id ? { ...r, ...partial } : r)));
    },
    [risks, updateRisks],
  );

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>9. Risk Register</h3>

      {risks.map((risk, i) => (
        <div key={risk.id} style={{ padding: 16, marginBottom: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Risk {i + 1}</span>
            <button onClick={() => removeRisk(risk.id)} style={{ background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}>Remove</button>
          </div>
          <div style={{ marginBottom: 10 }}>
            <input type="text" placeholder="Risk description" value={risk.description} onChange={(e) => updateRisk(risk.id, { description: e.target.value })} style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Likelihood</label>
              <select value={risk.likelihood} onChange={(e) => updateRisk(risk.id, { likelihood: e.target.value as Likelihood })} style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: SCORE_COLORS[risk.likelihood], fontSize: 14 }}>
                {LIKELIHOOD_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Impact</label>
              <select value={risk.impact} onChange={(e) => updateRisk(risk.id, { impact: e.target.value as Impact })} style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: SCORE_COLORS[risk.impact], fontSize: 14 }}>
                {IMPACT_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <input type="text" placeholder="Mitigation strategy" value={risk.mitigation} onChange={(e) => updateRisk(risk.id, { mitigation: e.target.value })} style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
          </div>
        </div>
      ))}

      <button onClick={addRisk} style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 8 }}>+ Add Risk</button>
    </div>
  );
}
