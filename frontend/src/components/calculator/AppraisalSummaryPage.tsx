import type { AppraisalRun } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  run: AppraisalRun;
}

function pctOrNa(v: number | null, digits = 1): string {
  return v == null ? 'n/a' : `${v.toFixed(digits)}%`;
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: `1px solid ${highlight ? '#2563eb' : '#1e3a5f'}`, minWidth: 180 }}>
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ color: highlight ? '#60a5fa' : '#e2e8f0', fontWeight: 700, fontSize: 20 }}>{value}</div>
    </div>
  );
}

export default function AppraisalSummaryPage({ run }: Props) {
  const { metrics } = run;

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>6. Appraisal Summary</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <MetricCard label="Total GDV" value={penceToPounds(metrics.gdv_pence)} highlight />
        <MetricCard label="Total Development Cost" value={penceToPounds(metrics.total_development_cost_pence)} />
        <MetricCard
          label={metrics.profit_is_unrealised ? 'Profit (incl. unrealised)' : 'Profit'}
          value={penceToPounds(metrics.profit_pence)}
          highlight
        />
        <MetricCard label="Profit on Cost" value={pctOrNa(metrics.profit_on_cost_pct)} highlight />
        <MetricCard label="Profit on GDV" value={pctOrNa(metrics.profit_on_gdv_pct)} />
        <MetricCard label="Return on Equity" value={pctOrNa(metrics.return_on_equity_pct)} />
        <MetricCard
          label="IRR (Annual)"
          value={metrics.irr_annual_pct == null ? 'n/a — no realised equity flows' : `${metrics.irr_annual_pct.toFixed(1)}%`}
          highlight
        />
        <MetricCard label="Equity Multiple" value={metrics.equity_multiple == null ? 'n/a' : `${metrics.equity_multiple.toFixed(2)}x`} />
        <MetricCard label="Residual Land Value" value={penceToPounds(metrics.rlv_pence)} />
      </div>

      {metrics.profit_is_unrealised && (
        <div style={{ marginBottom: 24, padding: '10px 16px', background: '#451a03', border: '1px solid #f59e0b', borderRadius: 8, color: '#fbbf24', fontSize: 13 }}>
          Profit includes {penceToPounds(metrics.unrealised_value_pence)} of unrealised value from retained units — not yet cash.
        </div>
      )}

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Cost Breakdown</h4>
      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        {[
          { label: 'Acquisition', value: metrics.acquisition_cost_pence },
          { label: 'SDLT', value: metrics.sdlt_pence },
          { label: 'Construction', value: metrics.construction_cost_pence },
          { label: 'Professional Fees', value: metrics.professional_fees_pence },
          { label: 'Statutory Costs', value: metrics.statutory_costs_pence },
          { label: 'Selling Costs', value: metrics.selling_costs_pence },
          { label: 'Finance Costs', value: metrics.finance_costs_pence },
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#94a3b8', fontSize: 14 }}>
            <span>{row.label}</span>
            <span>{penceToPounds(row.value)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 4px', borderTop: '1px solid #1e3a5f', color: '#e2e8f0', fontWeight: 700, fontSize: 16 }}>
          <span>Total Development Cost</span>
          <span>{penceToPounds(metrics.total_development_cost_pence)}</span>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Peak debt</span>
          <span>{penceToPounds(metrics.peak_debt_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600 }}>
          <span>Equity contributed</span>
          <span>{penceToPounds(metrics.equity_contributed_pence)}</span>
        </div>
      </div>
    </div>
  );
}
