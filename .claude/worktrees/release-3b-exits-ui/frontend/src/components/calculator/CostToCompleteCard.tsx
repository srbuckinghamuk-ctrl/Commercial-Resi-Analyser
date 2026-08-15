import { useState } from 'react';
import type { CostToCompleteSummary } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  summary: CostToCompleteSummary | null;
}

const th: React.CSSProperties = { padding: '6px 10px', color: '#94a3b8', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '5px 10px', color: '#e2e8f0', textAlign: 'right', whiteSpace: 'nowrap' };

/** §5.10: for every month, remaining cost to complete vs remaining available funding under the
 * straight-line spend profile. `summary` is null only when the appraisal has no schedule at all
 * (never happens in practice — buildSchedule always floors term_months to >= 1 — but the type
 * stays nullable, so this still renders the existing "not available" treatment rather than
 * assuming). */
export default function CostToCompleteCard({ summary }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (summary == null) {
    return (
      <div
        title="§5.10: remaining cost to complete vs remaining available funding, month by month, under the straight-line spend profile."
        style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}
      >
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Cost to complete</div>
        <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18 }}>n/a</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div
          title="§5.10: remaining cost to complete vs remaining available funding, month by month, under the straight-line spend profile."
          style={{ color: '#94a3b8', fontSize: 12 }}
        >
          Cost to complete
        </div>
        <button
          onClick={() => setExpanded((s) => !s)}
          style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}
        >
          {expanded ? '▲ hide months' : '▼ show months'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 32, marginBottom: expanded ? 12 : 0 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>First shortfall month</div>
          <div style={{ color: summary.first_shortfall_month != null ? '#ef4444' : '#e2e8f0', fontWeight: 700, fontSize: 16 }}>
            {summary.first_shortfall_month != null ? `Month ${summary.first_shortfall_month}` : 'None'}
          </div>
        </div>
        <div>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 2 }}>Max shortfall</div>
          <div style={{ color: summary.max_shortfall_pence > 0 ? '#ef4444' : '#e2e8f0', fontWeight: 700, fontSize: 16 }}>
            {penceToPounds(summary.max_shortfall_pence)}
          </div>
        </div>
      </div>
      {expanded && (
        <div style={{ overflowX: 'auto', border: '1px solid #1e3a5f', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                {['Month', 'Remaining cost', 'Remaining funding', 'Surplus'].map((h) => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.months.map((m) => (
                <tr key={m.month} style={{ borderBottom: '1px solid #0f172a' }}>
                  <td style={{ ...td, color: '#94a3b8' }}>Month {m.month}</td>
                  <td style={td}>{penceToPounds(m.remaining_cost_pence)}</td>
                  <td style={td}>{penceToPounds(m.remaining_funding_pence)}</td>
                  <td style={{ ...td, color: m.surplus_pence < 0 ? '#ef4444' : '#22c55e' }}>
                    {penceToPounds(m.surplus_pence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
