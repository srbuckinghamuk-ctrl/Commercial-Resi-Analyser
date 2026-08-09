import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  metrics: AppraisalMetrics;
  inputs: CalculatorInputs;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: `1px solid ${highlight ? '#2563eb' : '#1e3a5f'}`, minWidth: 180 }}>
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ color: highlight ? '#60a5fa' : '#e2e8f0', fontWeight: 700, fontSize: 20 }}>{value}</div>
    </div>
  );
}

export default function AppraisalSummaryPage({ metrics }: Props) {
  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>6. Appraisal Summary</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <MetricCard label="Total GDV" value={penceToPounds(metrics.total_gdv_pence)} highlight />
        <MetricCard label="Total Cost" value={penceToPounds(metrics.total_cost_pence)} />
        <MetricCard label="Profit" value={penceToPounds(metrics.profit_pence)} highlight />
        <MetricCard label="Profit on Cost" value={`${metrics.profit_on_cost_pct.toFixed(1)}%`} highlight />
        <MetricCard label="Profit on GDV" value={`${metrics.profit_on_gdv_pct.toFixed(1)}%`} />
        <MetricCard label="Return on Equity" value={`${metrics.return_on_equity_pct.toFixed(1)}%`} />
        <MetricCard label="IRR (Annual)" value={`${metrics.irr_annual.toFixed(1)}%`} highlight />
        <MetricCard label="IRR (Monthly)" value={`${metrics.irr_monthly.toFixed(2)}%`} />
        <MetricCard label="Residual Land Value" value={penceToPounds(metrics.rlv_pence)} />
      </div>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Cost Breakdown</h4>
      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        {[
          { label: 'Acquisition (inc. SDLT)', value: metrics.total_acquisition_cost_pence },
          { label: 'SDLT', value: metrics.sdlt_pence },
          { label: 'Construction', value: metrics.total_construction_cost_pence },
          { label: 'Professional Fees', value: metrics.total_professional_fees_pence },
          { label: 'Finance Costs', value: metrics.total_finance_cost_pence },
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#94a3b8', fontSize: 14 }}>
            <span>{row.label}</span>
            <span>{penceToPounds(row.value)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 4px', borderTop: '1px solid #1e3a5f', color: '#e2e8f0', fontWeight: 700, fontSize: 16 }}>
          <span>Total Cost</span>
          <span>{penceToPounds(metrics.total_cost_pence)}</span>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Loan amount</span>
          <span>{penceToPounds(metrics.loan_amount_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600 }}>
          <span>Equity required</span>
          <span>{penceToPounds(metrics.equity_required_pence)}</span>
        </div>
      </div>
    </div>
  );
}
