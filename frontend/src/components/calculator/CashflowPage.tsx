import type { CalculatorInputs, CashflowResult } from '../../lib/conversion-types';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputs;
  cashflow: CashflowResult;
}

export default function CashflowPage({ cashflow }: Props) {
  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>5. Cashflow Projection</h3>

      <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Peak Funding</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 18 }}>{penceToPounds(cashflow.peak_funding_pence)}</div>
        </div>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Total Interest</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 18 }}>{penceToPounds(cashflow.total_interest_pence)}</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
              {['Month', 'Drawdown', 'Cum. Drawdown', 'Interest', 'Cum. Interest', 'Income', 'Net Cashflow', 'Cum. Cashflow'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', color: '#94a3b8', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cashflow.months.map((m) => (
              <tr key={m.month} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '6px 12px', color: '#e2e8f0', textAlign: 'right' }}>{m.label}</td>
                <td style={{ padding: '6px 12px', color: '#94a3b8', textAlign: 'right' }}>{penceToPounds(m.drawdown_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#94a3b8', textAlign: 'right' }}>{penceToPounds(m.cumulative_drawdown_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#f59e0b', textAlign: 'right' }}>{penceToPounds(m.interest_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#f59e0b', textAlign: 'right' }}>{penceToPounds(m.cumulative_interest_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#22c55e', textAlign: 'right' }}>{penceToPounds(m.income_pence)}</td>
                <td style={{ padding: '6px 12px', color: m.net_cashflow_pence >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right' }}>{penceToPounds(m.net_cashflow_pence)}</td>
                <td style={{ padding: '6px 12px', color: m.cumulative_cashflow_pence >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right', fontWeight: 600 }}>{penceToPounds(m.cumulative_cashflow_pence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
