import type { AppraisalRun, CalculatorInputsV3 } from '../../lib/model';
import { penceToPounds } from '../../lib/format';
import ReconciliationStrip from './ReconciliationStrip';

interface Props {
  inputs: CalculatorInputsV3;
  onChange: (partial: Partial<CalculatorInputsV3>) => void;
  run: AppraisalRun;
}

function pence(v: number | null): string {
  return v == null ? 'n/a' : penceToPounds(v);
}

const th: React.CSSProperties = { padding: '8px 10px', color: '#94a3b8', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '6px 10px', color: '#e2e8f0', textAlign: 'right', whiteSpace: 'nowrap' };

export default function CashflowPage({ run }: Props) {
  const { model, schedule } = run;
  const term = schedule.term_months;
  const spendWindow = term > 1 ? Math.max(1, term - 2) : 0;
  const assumptionsNote = term > 1
    ? `Straight-line spend over months 1–${spendWindow}; disposal in month ${term - 1}; see calculation specification §6.`
    : `Single-month term — all costs and disposal fall in month 0; see calculation specification §6.`;

  const costsTotal = model.months.reduce((s, m) => s + m.uses_total_pence, 0);
  const netReceiptsTotal = model.months.reduce((s, m) => s + m.net_receipts_pence, 0);
  const equityInTotal = model.totals.equity_contributed_pence + model.totals.additional_equity_pence;

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 16 }}>5. Cashflow Projection</h3>

      <ReconciliationStrip run={run} />

      <p style={{ color: '#64748b', fontSize: 12, marginBottom: 20 }}>{assumptionsNote}</p>

      <div style={{ display: 'flex', gap: 20, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1, minWidth: 160 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Peak Debt</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 17 }}>
            {penceToPounds(model.peak_debt_pence)}{model.peak_debt_month != null ? ` (Month ${model.peak_debt_month})` : ''}
          </div>
        </div>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1, minWidth: 160 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Total Interest</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 17 }}>{penceToPounds(model.totals.interest_pence)}</div>
        </div>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1, minWidth: 160 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>Total Draws</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 17 }}>{penceToPounds(model.totals.draws_pence)}</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #1e3a5f', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
              {['Month', 'Costs', 'Equity in', 'Draw', 'Cap. fees', 'Interest', 'Opening', 'Closing',
                'Undrawn net', 'Headroom', 'Receipts (net)', 'Repayment', 'Distribution', 'Gap'].map((h) => (
                <th key={h} style={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.months.map((m) => (
              <tr key={m.month} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ ...td, color: '#94a3b8' }}>Month {m.month}</td>
                <td style={td}>{penceToPounds(m.uses_total_pence)}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{penceToPounds(m.equity_contribution_pence + m.additional_equity_pence)}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{penceToPounds(m.draw_pence)}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{penceToPounds(m.capitalised_fees_pence)}</td>
                <td style={{ ...td, color: '#f59e0b' }}>{penceToPounds(m.interest_accrued_pence)}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{penceToPounds(m.opening_balance_pence)}</td>
                <td style={{ ...td, fontWeight: 600 }}>{penceToPounds(m.closing_balance_pence)}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{pence(m.undrawn_net_facility_pence)}</td>
                <td style={{ ...td, color: m.facility_headroom_pence != null && m.facility_headroom_pence < 0 ? '#ef4444' : '#94a3b8' }}>
                  {pence(m.facility_headroom_pence)}
                </td>
                <td style={{ ...td, color: '#22c55e' }}>{penceToPounds(m.net_receipts_pence)}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{penceToPounds(m.repayment_pence)}</td>
                <td style={{ ...td, color: m.distribution_pence >= 0 ? '#22c55e' : '#ef4444' }}>{penceToPounds(m.distribution_pence)}</td>
                <td style={{ ...td, color: m.funding_gap_pence > 0 ? '#ef4444' : '#94a3b8', fontWeight: m.funding_gap_pence > 0 ? 600 : 400 }}>
                  {penceToPounds(m.funding_gap_pence)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #1e3a5f' }}>
              <td style={{ ...td, fontWeight: 700, color: '#e2e8f0' }}>Total</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(costsTotal)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(equityInTotal)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(model.totals.draws_pence)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(model.totals.capitalised_fees_pence)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(model.totals.interest_pence)}</td>
              <td style={td}>—</td>
              <td style={td}>—</td>
              <td style={td}>—</td>
              <td style={td}>—</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(netReceiptsTotal)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(model.totals.repayments_pence)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{penceToPounds(model.totals.distributions_pence)}</td>
              <td style={{ ...td, fontWeight: 700, color: model.totals.funding_gap_pence > 0 ? '#ef4444' : '#e2e8f0' }}>
                {penceToPounds(model.totals.funding_gap_pence)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
