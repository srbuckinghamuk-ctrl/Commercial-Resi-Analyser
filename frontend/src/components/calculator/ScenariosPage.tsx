import { useMemo } from 'react';
import type { ScenarioOverrides } from '../../lib/conversion-types';
import type { AppraisalRun, CalculatorInputsV8 } from '../../lib/model';
import { runAppraisal } from '../../lib/model';
import { applyScenario } from '../../lib/model/apply-scenario';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV8;
  onChange: (partial: Partial<CalculatorInputsV8>) => void;
}

type ScenarioKey = 'base' | 'upside' | 'downside' | 'severe';

const scenarioKeys: ScenarioKey[] = ['base', 'upside', 'downside', 'severe'];

function pctOrNa(v: number | null): string {
  return v == null ? 'n/a' : `${v.toFixed(1)}%`;
}

export default function ScenariosPage({ inputs, onChange }: Props) {
  const scenarioRuns = useMemo(
    () =>
      Object.fromEntries(
        scenarioKeys.map((key) => [key, runAppraisal(applyScenario(inputs, inputs.scenarios[key]))]),
      ) as Record<ScenarioKey, AppraisalRun>,
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

  const metricRows: { label: string; accessor: (r: AppraisalRun) => string }[] = [
    { label: 'GDV', accessor: (r) => penceToPounds(r.metrics.gdv_pence) },
    { label: 'Total Development Cost', accessor: (r) => penceToPounds(r.metrics.total_development_cost_pence) },
    { label: 'Profit', accessor: (r) => penceToPounds(r.metrics.profit_pence) },
    { label: 'Profit on Cost', accessor: (r) => pctOrNa(r.metrics.profit_on_cost_pct) },
    { label: 'Profit on GDV', accessor: (r) => pctOrNa(r.metrics.profit_on_gdv_pct) },
    { label: 'IRR (Annual)', accessor: (r) => pctOrNa(r.metrics.irr_annual_pct) },
    { label: 'Return on Equity', accessor: (r) => pctOrNa(r.metrics.return_on_equity_pct) },
  ];

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>10. Scenario Comparison</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
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

      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
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
                  <td key={key} style={{ padding: '8px 12px', color: '#e2e8f0', textAlign: 'right', fontWeight: key === 'base' ? 600 : 400 }}>{row.accessor(scenarioRuns[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Flags by Scenario</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
        {scenarioKeys.map((key) => {
          const flags = scenarioRuns[key].metrics.flags;
          return (
            <div key={key} style={{ padding: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', minHeight: 40 }}>
              {flags.length === 0 ? (
                <span style={{ color: '#22c55e', fontSize: 12 }}>No flags</span>
              ) : (
                flags.map((f, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12, marginBottom: 6,
                      color: f.severity === 'red' ? '#fca5a5' : f.severity === 'amber' ? '#fbbf24' : '#94a3b8',
                    }}
                  >
                    {f.message}
                  </div>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
