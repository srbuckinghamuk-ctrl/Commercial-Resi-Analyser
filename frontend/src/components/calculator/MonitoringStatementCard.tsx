import type { MonitoringCategory, MonitoringStatement, MonitoringStatementLine } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  statement: MonitoringStatement | null;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED = '#ef4444';

const CATEGORY_LABELS: Record<MonitoringCategory, string> = {
  acquisition: 'Acquisition',
  construction: 'Construction',
  professional: 'Professional',
  statutory: 'Statutory',
  contingency: 'Contingency',
};

const COLUMNS: { key: keyof Omit<MonitoringStatementLine, 'category'>; label: string }[] = [
  { key: 'original_budget_pence', label: 'Original budget' },
  { key: 'current_budget_pence', label: 'Current budget' },
  { key: 'certified_to_date_pence', label: 'Certified to date' },
  { key: 'paid_to_date_pence', label: 'Paid to date' },
  { key: 'committed_to_date_pence', label: 'Committed to date' },
  { key: 'committed_not_certified_pence', label: 'Committed not certified' },
  { key: 'forecast_to_complete_pence', label: 'Forecast to complete' },
  { key: 'estimated_final_cost_pence', label: 'Estimated final cost' },
  { key: 'variance_vs_original_pence', label: 'Variance vs original' },
  { key: 'variance_vs_current_pence', label: 'Variance vs current' },
  { key: 'remaining_to_spend_pence', label: 'Remaining to spend' },
];

const thStyle: React.CSSProperties = {
  padding: '6px 10px', color: MUTED, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = {
  padding: '5px 10px', color: TEXT, textAlign: 'right', whiteSpace: 'nowrap',
};
const rowLabelStyle: React.CSSProperties = { ...tdStyle, textAlign: 'left', color: MUTED };

function ReconciliationRow({ label, valuePence }: { label: string; valuePence: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', color: TEXT, marginBottom: 4 }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span>{penceToPounds(valuePence)}</span>
    </div>
  );
}

function VarianceItem({ label, valuePence }: { label: string; valuePence: number }) {
  return (
    <div>
      <div style={{ color: MUTED, fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ color: valuePence < 0 ? RED : '#22c55e', fontWeight: 700, fontSize: 15 }}>
        {penceToPounds(valuePence)}
      </div>
    </div>
  );
}

/**
 * R14 spec §9/§20.4. The read-only monitoring cost-to-complete statement: the
 * per-category table (§20.2's twelve columns, category plus eleven pence
 * figures), the funding reconciliation and the three inception-plan
 * variances. Renders nothing when `statement` is null — the summary page
 * predates construction monitoring, or no monitoring block was entered.
 *
 * NO ARITHMETIC — every figure printed is a field already computed by
 * `computeMonitoringStatement`; the totals row reads `statement.totals`
 * rather than summing `statement.lines` again, and every variance's colour
 * is a render condition on that field's own sign, never a recomputed one.
 */
export default function MonitoringStatementCard({ statement }: Props) {
  if (statement == null) return null;

  return (
    <div style={{ padding: 16, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, gridColumn: '1 / -1' }}>
      <h4 style={{ color: TEXT, fontSize: 14, marginBottom: 12 }}>
        {`Monitoring cost-to-complete — month ${statement.reporting_month} (${statement.reporting_date})`}
      </h4>

      <div style={{ overflowX: 'auto', border: `1px solid ${BORDER}`, borderRadius: 6, marginBottom: 16 }}>
        <table
          aria-label="Monitoring cost-to-complete by category"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              <th style={{ ...thStyle, textAlign: 'left' }}>Category</th>
              {COLUMNS.map((c) => <th key={c.key} style={thStyle}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((line) => (
              <tr key={line.category} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <td style={rowLabelStyle}>{CATEGORY_LABELS[line.category]}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} style={tdStyle}>{penceToPounds(line[c.key])}</td>
                ))}
              </tr>
            ))}
            <tr style={{ borderTop: `1px solid ${BORDER}`, fontWeight: 700 }}>
              <td style={rowLabelStyle}>Total</td>
              {COLUMNS.map((c) => (
                <td key={c.key} style={tdStyle}>{penceToPounds(statement.totals[c.key])}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h5 style={{ color: MUTED, fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
        Funding reconciliation
      </h5>
      <div style={{ marginBottom: 16 }}>
        <ReconciliationRow label="Undrawn net facility" valuePence={statement.undrawn_net_facility_pence} />
        <ReconciliationRow label="Reserve headroom" valuePence={statement.reserve_headroom_pence} />
        <ReconciliationRow label="Remaining cash equity" valuePence={statement.remaining_cash_equity_pence} />
        <ReconciliationRow label="Remaining funding" valuePence={statement.remaining_funding_pence} />
        <ReconciliationRow label="Forecast finance" valuePence={statement.forecast_finance_pence} />
        <ReconciliationRow label="Remaining uses" valuePence={statement.remaining_uses_pence} />
        <ReconciliationRow label="Surplus" valuePence={statement.surplus_pence} />
        {statement.shortfall_pence > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', color: RED, fontWeight: 700, marginTop: 6 }}>
            <span>Shortfall</span>
            <span>{penceToPounds(statement.shortfall_pence)}</span>
          </div>
        )}
      </div>

      <h5 style={{ color: MUTED, fontSize: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        Variances against the inception plan
      </h5>
      <div style={{ color: MUTED, fontSize: 11, marginBottom: 8 }}>
        positive = more than the inception plan
      </div>
      <div style={{ display: 'flex', gap: 32 }}>
        <VarianceItem label="Debt drawn" valuePence={statement.debt_drawn_variance_pence} />
        <VarianceItem label="Equity injected" valuePence={statement.equity_injected_variance_pence} />
        <VarianceItem label="Cost to date" valuePence={statement.cost_to_date_variance_pence} />
      </div>
    </div>
  );
}
