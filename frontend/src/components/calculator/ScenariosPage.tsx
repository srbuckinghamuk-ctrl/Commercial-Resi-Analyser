import { useMemo } from 'react';
import type { CalculatorInputs, ScenarioOverrides } from '../../lib/conversion-types';
import { calculateAppraisal } from '../../lib/conversion-calc-engine';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
}

type ScenarioKey = 'base' | 'upside' | 'downside';

function applyScenario(inputs: CalculatorInputs, overrides: ScenarioOverrides): CalculatorInputs {
  const gdvMultiplier = 1 + overrides.gdv_adjustment_pct / 100;
  const costMultiplier = 1 + overrides.construction_cost_adjustment_pct / 100;
  return {
    ...inputs,
    unit_mix: {
      units: inputs.unit_mix.units.map((u) => ({
        ...u,
        estimated_value_pence: Math.round(u.estimated_value_pence * gdvMultiplier),
      })),
    },
    conversion_costs: {
      ...inputs.conversion_costs,
      construction_cost_per_sqm_pence: Math.round(
        inputs.conversion_costs.construction_cost_per_sqm_pence * costMultiplier,
      ),
    },
    finance: {
      ...inputs.finance,
      loan_term_months: inputs.finance.loan_term_months + overrides.timeline_adjustment_months,
      interest_rate_annual_pct: inputs.finance.interest_rate_annual_pct + overrides.interest_rate_adjustment_pct,
    },
  };
}

export default function ScenariosPage({ inputs, onChange }: Props) {
  const scenarioKeys: ScenarioKey[] = ['base', 'upside', 'downside'];

  const scenarioMetrics = useMemo(
    () =>
      Object.fromEntries(
        scenarioKeys.map((key) => [key, calculateAppraisal(applyScenario(inputs, inputs.scenarios[key]))]),
      ) as Record<ScenarioKey, ReturnType<typeof calculateAppraisal>>,
    [inputs],
  );

  const updateScenario = (key: ScenarioKey, partial: Partial<ScenarioOverrides>) => {
    onChange({
      scenarios: {
        ...inputs.scenarios,
        [key]: { ...inputs.scenarios[key], ...partial },
      },
    });
  };

  const metricRows: { label: string; accessor: (m: ReturnType<typeof calculateAppraisal>) => string }[] = [
    { label: 'GDV', accessor: (m) => penceToPounds(m.total_gdv_pence) },
    { label: 'Total Cost', accessor: (m) => penceToPounds(m.total_cost_pence) },
    { label: 'Profit', accessor: (m) => penceToPounds(m.profit_pence) },
    { label: 'Profit on Cost', accessor: (m) => `${m.profit_on_cost_pct.toFixed(1)}%` },
    { label: 'Profit on GDV', accessor: (m) => `${m.profit_on_gdv_pct.toFixed(1)}%` },
    { label: 'IRR (Annual)', accessor: (m) => `${m.irr_annual.toFixed(1)}%` },
    { label: 'Return on Equity', accessor: (m) => `${m.return_on_equity_pct.toFixed(1)}%` },
  ];

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>7. Scenario Comparison</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {scenarioKeys.map((key) => (
          <div key={key} style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
            <h4 style={{ color: '#e2e8f0', fontSize: 15, marginBottom: 12 }}>{inputs.scenarios[key].label}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                GDV adjustment (%)
                <input type="number" value={inputs.scenarios[key].gdv_adjustment_pct} onChange={(e) => updateScenario(key, { gdv_adjustment_pct: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                Construction cost adjustment (%)
                <input type="number" value={inputs.scenarios[key].construction_cost_adjustment_pct} onChange={(e) => updateScenario(key, { construction_cost_adjustment_pct: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                Timeline adjustment (months)
                <input type="number" value={inputs.scenarios[key].timeline_adjustment_months} onChange={(e) => updateScenario(key, { timeline_adjustment_months: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                Interest rate adjustment (%)
                <input type="number" step="0.1" value={inputs.scenarios[key].interest_rate_adjustment_pct} onChange={(e) => updateScenario(key, { interest_rate_adjustment_pct: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
              <th style={{ padding: '8px 12px', color: '#94a3b8', textAlign: 'left' }}>Metric</th>
              {scenarioKeys.map((key) => (
                <th key={key} style={{ padding: '8px 12px', color: '#94a3b8', textAlign: 'right' }}>{inputs.scenarios[key].label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{row.label}</td>
                {scenarioKeys.map((key) => (
                  <td key={key} style={{ padding: '8px 12px', color: '#e2e8f0', textAlign: 'right', fontWeight: key === 'base' ? 600 : 400 }}>{row.accessor(scenarioMetrics[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
