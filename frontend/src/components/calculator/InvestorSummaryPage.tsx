import type { Project } from '../../types';
import type { CalculatorInputs, AppraisalMetrics, CashflowResult } from '../../lib/conversion-types';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputs;
  metrics: AppraisalMetrics;
  cashflow: CashflowResult;
  project: Project;
}

export default function InvestorSummaryPage({ inputs, metrics, cashflow, project }: Props) {
  const highRisks = inputs.risks.filter((r) => r.impact === 'high');

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 4 }}>10. Investor Summary</h3>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>One-page deal overview for investors and JV partners</p>

      <div style={{ padding: 24, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 4 }}>{project.address_raw}</h2>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
          {project.use_class.replace('_', ' ')} | {project.floor_area_sqm?.toLocaleString() ?? '—'} m² | {project.tenure}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Purchase Price', value: penceToPounds(inputs.acquisition.purchase_price_pence) },
            { label: 'GDV', value: penceToPounds(metrics.total_gdv_pence) },
            { label: 'Total Cost', value: penceToPounds(metrics.total_cost_pence) },
            { label: 'Profit', value: penceToPounds(metrics.profit_pence) },
          ].map((m) => (
            <div key={m.label}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{m.label}</div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16 }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Profit on Cost', value: `${metrics.profit_on_cost_pct.toFixed(1)}%` },
            { label: 'Profit on GDV', value: `${metrics.profit_on_gdv_pct.toFixed(1)}%` },
            { label: 'IRR (Annual)', value: `${metrics.irr_annual.toFixed(1)}%` },
            { label: 'Return on Equity', value: `${metrics.return_on_equity_pct.toFixed(1)}%` },
          ].map((m) => (
            <div key={m.label}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{m.label}</div>
              <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 16 }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          <div>
            <h4 style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Unit Mix</h4>
            {inputs.unit_mix.units.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: 14 }}>No units defined</p>
            ) : (
              inputs.unit_mix.units.map((u, i) => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#e2e8f0', fontSize: 14 }}>
                  <span>Unit {i + 1} — {u.type} ({u.floor_area_sqm} m²)</span>
                  <span>{penceToPounds(u.estimated_value_pence)}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <h4 style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Finance & Timeline</h4>
            <div style={{ color: '#e2e8f0', fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Funding</span><span>{inputs.finance.funding_source.replace('_', ' ')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Equity required</span><span>{penceToPounds(metrics.equity_required_pence)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Loan amount</span><span>{penceToPounds(metrics.loan_amount_pence)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Timeline</span><span>{inputs.finance.loan_term_months} months</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Peak funding</span><span>{penceToPounds(cashflow.peak_funding_pence)}</span>
              </div>
            </div>
          </div>
        </div>

        {highRisks.length > 0 && (
          <div>
            <h4 style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Key Risks</h4>
            {highRisks.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#e2e8f0', fontSize: 14 }}>
                <span style={{ color: '#ef4444' }}>{r.description}</span>
                <span style={{ color: '#94a3b8' }}>{r.mitigation}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
