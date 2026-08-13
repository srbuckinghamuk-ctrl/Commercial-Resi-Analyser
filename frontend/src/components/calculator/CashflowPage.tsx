import type { AppraisalRun } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  run: AppraisalRun;
}

export default function CashflowPage({ run }: Props) {
  const { model } = run;

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>5. Cashflow Projection</h3>

      <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Peak Debt</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 18 }}>{penceToPounds(model.peak_debt_pence)}</div>
        </div>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Total Interest</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 18 }}>{penceToPounds(model.totals.interest_pence)}</div>
        </div>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Total Draws</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 18 }}>{penceToPounds(model.totals.draws_pence)}</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
              {['Month', 'Draw', 'Capitalised Fees', 'Interest', 'Closing Balance', 'Gross Receipts', 'Distribution'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', color: '#94a3b8', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.months.map((m) => (
              <tr key={m.month} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '6px 12px', color: '#e2e8f0', textAlign: 'right' }}>Month {m.month}</td>
                <td style={{ padding: '6px 12px', color: '#94a3b8', textAlign: 'right' }}>{penceToPounds(m.draw_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#94a3b8', textAlign: 'right' }}>{penceToPounds(m.capitalised_fees_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#f59e0b', textAlign: 'right' }}>{penceToPounds(m.interest_accrued_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#e2e8f0', textAlign: 'right', fontWeight: 600 }}>{penceToPounds(m.closing_balance_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#22c55e', textAlign: 'right' }}>{penceToPounds(m.gross_receipts_pence)}</td>
                <td style={{ padding: '6px 12px', color: m.distribution_pence >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right' }}>{penceToPounds(m.distribution_pence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
