import { useMemo, useCallback } from 'react';
import type { CalculatorInputs, AppraisalMetrics, ExitRoute } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

export default function ExitStrategyPage({ inputs, onChange, metrics }: Props) {
  const exit = inputs.exit_strategy;
  const units = inputs.unit_mix.units;

  const updateExit = useCallback(
    (partial: Partial<typeof exit>) => {
      onChange({ exit_strategy: { ...exit, ...partial } });
    },
    [exit, onChange],
  );

  const updateRetained = useCallback(
    (unitId: string, rent: number) => {
      const existing = exit.retained_units.filter((r) => r.unit_id !== unitId);
      if (rent > 0) {
        existing.push({ unit_id: unitId, monthly_rent_pence: rent });
      }
      updateExit({ retained_units: existing });
    },
    [exit, updateExit],
  );

  const totalAnnualRent = useMemo(
    () => exit.retained_units.reduce((s, r) => s + r.monthly_rent_pence * 12, 0),
    [exit.retained_units],
  );

  const retainedCapitalValue = useMemo(
    () =>
      exit.retained_units.reduce((s, r) => {
        const unit = units.find((u) => u.id === r.unit_id);
        return s + (unit?.estimated_value_pence ?? 0);
      }, 0),
    [exit.retained_units, units],
  );

  const grossYield = retainedCapitalValue > 0 ? (totalAnnualRent / retainedCapitalValue) * 100 : 0;

  const sellingCosts = useMemo(() => {
    const soldUnitsValue = metrics.total_gdv_pence - retainedCapitalValue;
    const agentFee = Math.round((soldUnitsValue * exit.selling_agent_fee_pct) / 100);
    return agentFee + exit.selling_legal_fee_pence;
  }, [metrics, retainedCapitalValue, exit]);

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>8. Exit Strategy</h3>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {(['sell_all', 'retain_all', 'blended'] as ExitRoute[]).map((route) => (
          <button
            key={route}
            onClick={() => updateExit({ route })}
            style={{
              padding: '10px 24px',
              background: exit.route === route ? '#1e3a5f' : '#0f172a',
              border: `1px solid ${exit.route === route ? '#2563eb' : '#1e3a5f'}`,
              borderRadius: 6,
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {route === 'sell_all' ? 'Sell All' : route === 'retain_all' ? 'Retain All (BTL)' : 'Blended'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: '#94a3b8', fontSize: 14 }}>Agent fee (%)</label>
          <input type="number" step="0.1" value={exit.selling_agent_fee_pct} onChange={(e) => updateExit({ selling_agent_fee_pct: Number(e.target.value) })} style={{ width: 100, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: '#94a3b8', fontSize: 14 }}>Legal fee (pence)</label>
          <input type="number" value={exit.selling_legal_fee_pence} onChange={(e) => updateExit({ selling_legal_fee_pence: Number(e.target.value) })} style={{ width: 140, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
        </div>
      </div>

      {(exit.route === 'retain_all' || exit.route === 'blended') && units.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Retained Units — Monthly Rent</h4>
          {units.map((unit, i) => {
            const retained = exit.retained_units.find((r) => r.unit_id === unit.id);
            return (
              <div key={unit.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ color: '#94a3b8', width: 140, fontSize: 14 }}>Unit {i + 1} ({unit.type})</span>
                <input
                  type="number"
                  value={retained?.monthly_rent_pence ?? 0}
                  onChange={(e) => updateRetained(unit.id, Number(e.target.value))}
                  style={{ width: 140, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
                <span style={{ color: '#64748b', fontSize: 13 }}>{penceToPounds(retained?.monthly_rent_pence ?? 0)}/month</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Selling costs</span><span>{penceToPounds(sellingCosts)}</span>
        </div>
        {exit.retained_units.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
              <span>Annual rental income</span><span>{penceToPounds(totalAnnualRent)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600 }}>
              <span>Gross yield</span><span>{grossYield.toFixed(1)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
