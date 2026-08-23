import { useCallback } from 'react';
import type { MonitoringCategory, MonitoringInputs, MonitoringLineInputs, ValidationIssue } from '../../lib/model';
import { MONITORING_CATEGORIES } from '../../lib/model';
import { PenceInput, PenceRow, NumRow } from './form-rows';

/**
 * R14 Task 10, spec §9/§20.4. The Finance-page editor for a monitoring
 * statement: `reporting_month`, `reporting_date`, the five-category table of
 * pence figures, the two cumulative facility figures, and provenance. A
 * "Remove monitoring statement" button sets the whole block to null.
 *
 * NO ARITHMETIC — this component never sums, compares or derives a figure.
 * Every number it shows is either an input value being edited or a
 * validation issue's message, verbatim.
 */
interface Props {
  monitoring: MonitoringInputs | null;
  termMonths: number;
  /** Filtered by the parent to `field.startsWith('monitoring')` — the same
   *  idiom `LenderValuationCard` uses for `lender_valuation*`. */
  issues: ValidationIssue[];
  onChange: (m: MonitoringInputs | null) => void;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED_BG = '#450a0a';
const RED = '#ef4444';
const RED_TEXT = '#fca5a5';

const CATEGORY_LABELS: Record<MonitoringCategory, string> = {
  acquisition: 'Acquisition',
  construction: 'Construction',
  professional: 'Professional',
  statutory: 'Statutory',
  contingency: 'Contingency',
};

const LINE_FIELDS: { key: keyof Omit<MonitoringLineInputs, 'category'>; label: string }[] = [
  { key: 'current_budget_pence', label: 'Current budget' },
  { key: 'certified_to_date_pence', label: 'Certified to date' },
  { key: 'paid_to_date_pence', label: 'Paid to date' },
  { key: 'committed_to_date_pence', label: 'Committed to date' },
  { key: 'forecast_to_complete_pence', label: 'Forecast to complete' },
];

const rowLabel: React.CSSProperties = { color: MUTED, width: 240, fontSize: 13 };
const textInput: React.CSSProperties = {
  padding: '6px 10px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13, width: 260,
};
const thStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: 12, color: MUTED, textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
};
const tdStyle: React.CSSProperties = { padding: '4px 6px', fontSize: 13, verticalAlign: 'top' };

function emptyLine(category: MonitoringCategory): MonitoringLineInputs {
  return {
    category,
    current_budget_pence: 0,
    certified_to_date_pence: 0,
    paid_to_date_pence: 0,
    committed_to_date_pence: 0,
    forecast_to_complete_pence: 0,
  };
}

function emptyMonitoring(): MonitoringInputs {
  return {
    reporting_month: 1,
    reporting_date: '',
    lines: MONITORING_CATEGORIES.map(emptyLine),
    debt_drawn_to_date_pence: 0,
    cash_equity_injected_to_date_pence: 0,
    author: '',
    date: '',
    note: null,
  };
}

function issuesFor(issues: ValidationIssue[], field: string): ValidationIssue[] {
  return issues.filter((i) => i.field === field);
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div style={{ marginTop: 4 }}>
      {issues.map((issue, i) => (
        <div key={`${issue.field}-${i}`} style={{ color: RED_TEXT, fontSize: 12 }}>{issue.message}</div>
      ))}
    </div>
  );
}

export default function MonitoringEditor({ monitoring, termMonths, issues, onChange }: Props) {
  const update = useCallback(
    (partial: Partial<MonitoringInputs>) => {
      if (monitoring == null) return;
      onChange({ ...monitoring, ...partial });
    },
    [monitoring, onChange],
  );

  const updateLine = useCallback(
    (index: number, partial: Partial<MonitoringLineInputs>) => {
      if (monitoring == null) return;
      const lines = monitoring.lines.map((line, i) => (i === index ? { ...line, ...partial } : line));
      onChange({ ...monitoring, lines });
    },
    [monitoring, onChange],
  );

  if (monitoring == null) {
    return (
      <div style={{ padding: 16, background: PANEL, borderRadius: 8, border: `1px dashed ${BORDER}`, marginBottom: 20 }}>
        <div style={{ color: TEXT, fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Monitoring statement</div>
        <div style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
          No monitoring statement recorded — cost-to-complete reserve headroom and the summary
          page's monitoring statement are unavailable until one is added.
        </div>
        <button
          type="button"
          onClick={() => onChange(emptyMonitoring())}
          style={{ padding: '8px 18px', background: '#1e3a5f', color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
        >
          + Add monitoring statement
        </button>
      </div>
    );
  }

  const monthIssues = issuesFor(issues, 'monitoring.reporting_month');
  const linesIssues = issuesFor(issues, 'monitoring.lines');
  const debtIssues = issuesFor(issues, 'monitoring.debt_drawn_to_date_pence');
  const cashIssues = issuesFor(issues, 'monitoring.cash_equity_injected_to_date_pence');

  const namedFields = new Set([
    'monitoring.reporting_month', 'monitoring.lines',
    'monitoring.debt_drawn_to_date_pence', 'monitoring.cash_equity_injected_to_date_pence',
    ...monitoring.lines.flatMap((_, i) => LINE_FIELDS.map((f) => `monitoring.lines[${i}].${f.key}`)),
  ]);
  const otherIssues = issues.filter((i) => !namedFields.has(i.field));

  return (
    <div style={{ padding: 16, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>Monitoring statement</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          style={{ background: '#7f1d1d', color: RED_TEXT, border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
        >
          Remove monitoring statement
        </button>
      </div>

      <NumRow
        label="Reporting month"
        value={monitoring.reporting_month}
        onChangeValue={(v) => update({ reporting_month: v })}
        min={1}
        max={termMonths}
      />
      <IssueList issues={monthIssues} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={rowLabel}>Reporting date</label>
        <input
          type="date"
          value={monitoring.reporting_date}
          onChange={(e) => update({ reporting_date: e.target.value })}
          style={textInput}
        />
      </div>

      <h4 style={{ color: MUTED, fontSize: 12, marginTop: 16, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Cost categories
      </h4>
      <IssueList issues={linesIssues} />
      <div style={{ overflowX: 'auto' }}>
        <table aria-label="Monitoring cost categories" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Category</th>
              {LINE_FIELDS.map((f) => <th key={f.key} style={thStyle}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {monitoring.lines.map((line, i) => {
              const categoryLabel = CATEGORY_LABELS[line.category];
              return (
                <tr key={line.category} data-testid={`monitoring-line-${line.category}`} style={{ borderBottom: `1px solid ${PANEL}` }}>
                  <td style={{ ...tdStyle, color: TEXT }}>{categoryLabel}</td>
                  {LINE_FIELDS.map((f) => {
                    const cellIssues = issuesFor(issues, `monitoring.lines[${i}].${f.key}`);
                    return (
                      <td key={f.key} style={tdStyle}>
                        <PenceInput
                          ariaLabel={`${categoryLabel} ${f.label.toLowerCase()}`}
                          penceValue={line[f.key]}
                          onChangePence={(v) => updateLine(i, { [f.key]: v ?? 0 })}
                          style={{ width: 140 }}
                        />
                        <IssueList issues={cellIssues} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h4 style={{ color: MUTED, fontSize: 12, marginTop: 16, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Funding drawn to date
      </h4>
      <PenceRow
        label="Debt drawn to date (£)"
        penceValue={monitoring.debt_drawn_to_date_pence}
        onChangePence={(v) => update({ debt_drawn_to_date_pence: v ?? 0 })}
      />
      <IssueList issues={debtIssues} />
      <PenceRow
        label="Cash equity injected to date (£)"
        penceValue={monitoring.cash_equity_injected_to_date_pence}
        onChangePence={(v) => update({ cash_equity_injected_to_date_pence: v ?? 0 })}
      />
      <IssueList issues={cashIssues} />

      <h4 style={{ color: MUTED, fontSize: 12, marginTop: 16, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Provenance
      </h4>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <label style={rowLabel}>Author</label>
        <input
          type="text"
          aria-label="Author"
          value={monitoring.author}
          onChange={(e) => update({ author: e.target.value })}
          placeholder="e.g. J. Smith, ABC QS"
          style={textInput}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <label style={rowLabel}>Date</label>
        <input
          type="date"
          aria-label="Provenance date"
          value={monitoring.date}
          onChange={(e) => update({ date: e.target.value })}
          style={textInput}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={rowLabel}>Note</label>
        <input
          type="text"
          aria-label="Note"
          value={monitoring.note ?? ''}
          onChange={(e) => update({ note: e.target.value === '' ? null : e.target.value })}
          placeholder="optional"
          style={{ ...textInput, width: 340 }}
        />
      </div>

      {otherIssues.length > 0 && (
        <div style={{ padding: '10px 14px', background: RED_BG, border: `1px solid ${RED}`, borderRadius: 6 }}>
          {otherIssues.map((issue, i) => (
            <div key={`${issue.field}-${i}`} style={{ color: RED_TEXT, fontSize: 12, marginBottom: i < otherIssues.length - 1 ? 4 : 0 }}>
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
