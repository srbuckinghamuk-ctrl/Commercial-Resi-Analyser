import { useMemo, useState } from 'react';
import type { CalculatorInputsV4 } from '../../lib/model';
import type { SensitivityCell, SensitivityMetrics } from '../../lib/model/sensitivity';
import { safeRunSensitivity } from '../../lib/safe-sensitivity';
import {
  LEVER_LABEL, LEVER_SHORT, SENSITIVITY_METRICS,
  formatStepLabel, formatRangeLabel, flagShortCodes,
} from '../../lib/sensitivity-format';
import type { SensitivityMetricKey } from '../../lib/sensitivity-format';
import { penceToPounds, formatPct } from '../../lib/format';
import CalculatorFailurePanel from '../CalculatorFailurePanel';

interface Props {
  inputs: CalculatorInputsV4;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED = '#f87171';
const AMBER = '#fbbf24';

function metricText(cell: SensitivityMetrics, key: SensitivityMetricKey): string {
  const metric = SENSITIVITY_METRICS.find((m) => m.key === key)!;
  const value = cell[key];
  return metric.kind === 'money' ? penceToPounds(value as number) : formatPct(value as number | null);
}

/**
 * The amber/red conventions the investment memo's §10 matrices have always
 * used, carried onto the screen. Presentation thresholds, not model rules —
 * spec §12 defines no colouring, and no engine flag depends on these numbers.
 */
function metricColor(key: SensitivityMetricKey, value: number | null): string {
  if (value === null) return MUTED;
  if (key === 'profit_on_cost_pct') return value < 0 ? RED : value < 15 ? AMBER : TEXT;
  if (key === 'ltgdv_developer_pct') return value > 75 ? RED : value > 65 ? AMBER : TEXT;
  if (key === 'profit_pence') return value < 0 ? RED : TEXT;
  return TEXT;
}

export default function SensitivityPage({ inputs }: Props) {
  const [metric, setMetric] = useState<SensitivityMetricKey>('profit_on_cost_pct');

  // One call runs 34 appraisals (25 cells + 8 tornado endpoints + base), so it
  // is memoised on the inputs object exactly as the engine's own docstring asks.
  const outcome = useMemo(() => safeRunSensitivity(inputs), [inputs]);

  if (!outcome.ok) {
    return (
      <div>
        <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 20 }}>9. Sensitivity</h3>
        <CalculatorFailurePanel title="The sensitivity suite could not be calculated">
          {outcome.error.message}
        </CalculatorFailurePanel>
      </div>
    );
  }

  const { base, matrix, tornado, config } = outcome.result;

  // One shared scale across every tornado endpoint and the base, so bar lengths
  // are comparable between levers rather than each bar filling its own row.
  const profits = tornado
    .flatMap((bar) => [bar.low.profit_pence, bar.high.profit_pence])
    .concat(base.profit_pence);
  const minProfit = Math.min(...profits);
  const maxProfit = Math.max(...profits);
  const span = maxProfit - minProfit;
  const pos = (pence: number) => (span === 0 ? 50 : ((pence - minProfit) / span) * 100);

  return (
    <div>
      <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 8 }}>9. Sensitivity</h3>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 24, maxWidth: 780 }}>
        Every cell and every bar re-runs the full appraisal with the committed facility and
        equity sources held at their base values (spec §12.2). A position needing more debt
        than the facility does not receive it — it raises FE (facility exceeded), FG (funding
        gap) or NR (senior debt not repaid within the term), and that flag is the finding.
      </p>

      {/* ── Region 1: tornado ── */}
      <h4 style={{ color: MUTED, fontSize: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        Single-Lever Sensitivity
      </h4>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
        Base profit {penceToPounds(base.profit_pence)} — the centre line below. Bars are
        ordered widest swing first (spec §12.4).
      </p>

      <table
        aria-label="Single-lever sensitivity (tornado)"
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 28 }}
      >
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left', width: 160 }}>Lever</th>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left', width: 160 }}>Range</th>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left' }}>Profit swing</th>
            <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'right', width: 130 }}>Swing</th>
          </tr>
        </thead>
        <tbody>
          {tornado.map((bar) => {
            const lowPos = pos(Math.min(bar.low.profit_pence, bar.high.profit_pence));
            const highPos = pos(Math.max(bar.low.profit_pence, bar.high.profit_pence));
            return (
              <tr key={bar.lever} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <td style={{ padding: '8px 12px', color: TEXT }}>{LEVER_LABEL[bar.lever]}</td>
                <td style={{ padding: '8px 12px', color: MUTED }}>
                  {formatRangeLabel(bar.lever, bar.low_step, bar.high_step)}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ position: 'relative', height: 20, background: PANEL, borderRadius: 4 }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: `${lowPos}%`,
                        width: `${Math.max(highPos - lowPos, 0.5)}%`,
                        top: 3,
                        height: 14,
                        background: '#2563eb',
                        borderRadius: 3,
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        left: `${pos(base.profit_pence)}%`,
                        top: 0,
                        width: 1,
                        height: 20,
                        background: MUTED,
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: MUTED, fontSize: 12, marginTop: 3 }}>
                    <span>{penceToPounds(bar.low.profit_pence)}</span>
                    <span>{penceToPounds(bar.high.profit_pence)}</span>
                  </div>
                </td>
                <td style={{ padding: '8px 12px', color: TEXT, textAlign: 'right', fontWeight: 600 }}>
                  {penceToPounds(bar.span_pence)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Region 2: two-way matrix ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
        <h4 style={{ color: MUTED, fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
          Two-Way Sensitivity Matrix
        </h4>
        <label style={{ color: MUTED, fontSize: 13 }}>
          Metric{' '}
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as SensitivityMetricKey)}
            style={{ padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
          >
            {SENSITIVITY_METRICS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
        <table
          aria-label="Two-way sensitivity matrix"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left' }}>
                {LEVER_SHORT[config.rows.lever]} \ {LEVER_SHORT[config.cols.lever]}
              </th>
              {config.cols.steps.map((step) => (
                <th key={step} style={{ padding: '8px 12px', color: MUTED, textAlign: 'right' }}>
                  {`${LEVER_SHORT[config.cols.lever]} ${formatStepLabel(config.cols.lever, step)}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row[0].row_step} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <th scope="row" style={{ padding: '8px 12px', color: TEXT, textAlign: 'left', fontWeight: 600 }}>
                  {`${LEVER_SHORT[config.rows.lever]} ${formatStepLabel(config.rows.lever, row[0].row_step)}`}
                </th>
                {row.map((cell: SensitivityCell) => {
                  const codes = flagShortCodes(cell.flags);
                  return (
                    <td
                      key={cell.col_step}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: metricColor(metric, cell[metric]),
                        fontWeight: cell.row_step === 0 && cell.col_step === 0 ? 700 : 400,
                      }}
                    >
                      {metricText(cell, metric)}
                      {codes && (
                        <span style={{ color: RED, fontSize: 11, marginLeft: 6 }}>[{codes}]</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
