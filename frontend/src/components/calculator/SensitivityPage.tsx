import { useMemo, useState } from 'react';
import type { CalculatorInputsV4 } from '../../lib/model';
import {
  defaultSensitivityConfig, validateSensitivityConfig, LEVER_ORDER, MAX_AXIS_STEPS,
} from '../../lib/model/sensitivity';
import type {
  SensitivityCell, SensitivityConfig, SensitivityLever, SensitivityMetrics,
} from '../../lib/model/sensitivity';
import { safeRunSensitivity } from '../../lib/safe-sensitivity';
import {
  LEVER_LABEL, LEVER_SHORT, SENSITIVITY_METRICS,
  formatStepLabel, formatRangeLabel, flagShortCodes, isMeasuredBar, omittedTornadoNotes,
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
  if (value === null) return '—';
  return metric.kind === 'money' ? penceToPounds(value) : formatPct(value);
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

/**
 * Steps are held as the user's raw text, not as numbers, so a half-typed "-" or
 * a trailing comma does not silently become a different grid. Empty segments
 * (from a leading, trailing or doubled comma) are dropped before parsing —
 * `Number('')` is 0, and silently turning a stray comma into a "+0%" step
 * would run a grid the user did not ask for. Anything left that is not a
 * finite number becomes NaN, which validateSensitivityConfig (spec §12.6)
 * then reports.
 */
function parseSteps(text: string): number[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
}

function stepsToText(steps: number[]): string {
  return steps.join(', ');
}

const DEFAULTS = defaultSensitivityConfig();

export default function SensitivityPage({ inputs }: Props) {
  const [metric, setMetric] = useState<SensitivityMetricKey>('profit_on_cost_pct');
  const [rowLever, setRowLever] = useState<SensitivityLever>(DEFAULTS.rows.lever);
  const [colLever, setColLever] = useState<SensitivityLever>(DEFAULTS.cols.lever);
  const [rowStepsText, setRowStepsText] = useState(stepsToText(DEFAULTS.rows.steps));
  const [colStepsText, setColStepsText] = useState(stepsToText(DEFAULTS.cols.steps));

  const resetToDefaults = () => {
    setRowLever(DEFAULTS.rows.lever);
    setColLever(DEFAULTS.cols.lever);
    setRowStepsText(stepsToText(DEFAULTS.rows.steps));
    setColStepsText(stepsToText(DEFAULTS.cols.steps));
  };

  // The tornado ranges stay at the spec §12.4 defaults in R4b — only the matrix
  // axes are editable, which is the whole of design §5.1's third region.
  const config: SensitivityConfig = useMemo(() => ({
    rows: { lever: rowLever, steps: parseSteps(rowStepsText) },
    cols: { lever: colLever, steps: parseSteps(colStepsText) },
    tornado: DEFAULTS.tornado,
  }), [rowLever, rowStepsText, colLever, colStepsText]);

  // Spec §12.6 config errors only. A position whose *levered document* is invalid is no
  // longer this component's problem: §12.7 makes the engine report it per position, which
  // is strictly more informative than refusing the grid — the analyst sees which steps
  // work and which do not.
  const issues = useMemo(
    () => validateSensitivityConfig(config).map((issue) => issue.message),
    [config],
  );

  // Spec §12.6 errors are input errors: report them and compute nothing, rather
  // than leaving the previous grid on screen beside an invalid config.
  const outcome = useMemo(
    () => (issues.length > 0 ? null : safeRunSensitivity(inputs, config)),
    [inputs, config, issues],
  );

  const editor = (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end',
      padding: 16, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 24,
    }}>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Row lever
        <select
          value={rowLever}
          onChange={(e) => setRowLever(e.target.value as SensitivityLever)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        >
          {LEVER_ORDER.map((lever) => (
            <option key={lever} value={lever}>{LEVER_LABEL[lever]}</option>
          ))}
        </select>
      </label>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Row steps
        <input
          type="text"
          value={rowStepsText}
          onChange={(e) => setRowStepsText(e.target.value)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', width: 200, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        />
      </label>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Column lever
        <select
          value={colLever}
          onChange={(e) => setColLever(e.target.value as SensitivityLever)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        >
          {LEVER_ORDER.map((lever) => (
            <option key={lever} value={lever}>{LEVER_LABEL[lever]}</option>
          ))}
        </select>
      </label>
      <label style={{ color: MUTED, fontSize: 13 }}>
        Column steps
        <input
          type="text"
          value={colStepsText}
          onChange={(e) => setColStepsText(e.target.value)}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', width: 200, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
        />
      </label>
      <button
        type="button"
        onClick={resetToDefaults}
        style={{ padding: '6px 14px', background: '#1e3a5f', border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT, fontSize: 13, cursor: 'pointer' }}
      >
        Reset to defaults
      </button>
      <span style={{ color: MUTED, fontSize: 12, flexBasis: '100%' }}>
        Comma-separated, up to {MAX_AXIS_STEPS} per axis. This view only — nothing here is
        saved with the appraisal, and reloading restores the specified defaults.
      </span>
    </div>
  );

  const heading = (
    <>
      <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 8 }}>9. Sensitivity</h3>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 24, maxWidth: 780 }}>
        Every cell and every bar re-runs the full appraisal with the committed facility and
        equity sources held at their base values (spec §12.2). A position needing more debt
        than the facility does not receive it — it raises FE (facility exceeded), FG (funding
        gap) or NR (senior debt not repaid within the term), and that flag is the finding.
      </p>
    </>
  );

  if (issues.length > 0) {
    return (
      <div>
        {heading}
        {editor}
        <CalculatorFailurePanel title="These axes do not describe a valid grid">
          {issues.join(' ')}
        </CalculatorFailurePanel>
      </div>
    );
  }

  if (!outcome || !outcome.ok) {
    return (
      <div>
        {heading}
        {editor}
        <CalculatorFailurePanel title="The sensitivity suite could not be calculated">
          {outcome ? outcome.error.message : 'No result was produced for these axes.'}
        </CalculatorFailurePanel>
      </div>
    );
  }

  const { base, matrix, tornado, config: resolved } = outcome.result;

  // §12.7: a bar with an unmeasured endpoint has no span at all. `isMeasuredBar`
  // narrows both endpoints to `MeasuredMetrics`, so every render site below can
  // read `.profit_pence` as a plain number with no cast.
  const measuredBars = tornado.filter(isMeasuredBar);
  const omittedTornado = tornado.filter((bar) => bar.span_pence === null);

  // One shared scale across every tornado endpoint and the base, so bar lengths
  // are comparable between levers rather than each bar filling its own row.
  const profits = measuredBars
    .flatMap((bar) => [bar.low.profit_pence, bar.high.profit_pence])
    .concat(base.profit_pence);
  const minProfit = Math.min(...profits);
  const maxProfit = Math.max(...profits);
  const span = maxProfit - minProfit;
  const pos = (pence: number) => (span === 0 ? 50 : ((pence - minProfit) / span) * 100);

  return (
    <div>
      {heading}
      {editor}

      {/* ── Region 1: tornado ── */}
      <h4 style={{ color: MUTED, fontSize: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        Single-Lever Sensitivity
      </h4>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
        Base profit {penceToPounds(base.profit_pence)} — the centre line below. Bars are
        ordered widest swing first (spec §12.4).
      </p>

      {measuredBars.length > 0 && (
        <table
          aria-label="Single-lever sensitivity (tornado)"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: omittedTornado.length > 0 ? 8 : 28 }}
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
            {measuredBars.map((bar) => {
              const lowProfit = bar.low.profit_pence;
              const highProfit = bar.high.profit_pence;
              const lowPos = pos(Math.min(lowProfit, highProfit));
              const highPos = pos(Math.max(lowProfit, highProfit));
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
                      <span>{penceToPounds(lowProfit)}</span>
                      <span>{penceToPounds(highProfit)}</span>
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
      )}

      {/* A bar is dropped rather than rendered when the engine could not measure one
          of its endpoints — the levered document failed validation (spec §12.7). The
          reason printed is the engine's own `validation_errors` message for that
          endpoint, not a guess reconstructed here: an unmeasured timeline endpoint
          and an unmeasured interest-rate endpoint fail for entirely different
          reasons (an emptied term vs. a negative rate), and only the engine knows
          which. If every bar were omitted this note prints alone, with no tornado
          table above it. */}
      {omittedTornado.length > 0 && (
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 28 }}>
          {omittedTornadoNotes(tornado).join(' ')}
        </p>
      )}

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
                {LEVER_SHORT[resolved.rows.lever]} \ {LEVER_SHORT[resolved.cols.lever]}
              </th>
              {resolved.cols.steps.map((step) => (
                <th key={step} style={{ padding: '8px 12px', color: MUTED, textAlign: 'right' }}>
                  {`${LEVER_SHORT[resolved.cols.lever]} ${formatStepLabel(resolved.cols.lever, step)}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row[0].row_step} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <th scope="row" style={{ padding: '8px 12px', color: TEXT, textAlign: 'left', fontWeight: 600 }}>
                  {`${LEVER_SHORT[resolved.rows.lever]} ${formatStepLabel(resolved.rows.lever, row[0].row_step)}`}
                </th>
                {row.map((cell: SensitivityCell) => {
                  const codes = flagShortCodes(cell.flags);
                  const unmeasured = cell.validation_errors.length > 0;
                  return (
                    <td
                      key={cell.col_step}
                      title={unmeasured ? cell.validation_errors.map((e) => e.message).join(' ') : undefined}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: unmeasured ? MUTED : metricColor(metric, cell[metric]),
                        fontStyle: unmeasured ? 'italic' : undefined,
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
