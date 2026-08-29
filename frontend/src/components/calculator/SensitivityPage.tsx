import { useMemo, useState } from 'react';
import type { AnyCalculatorInputs } from '../../lib/model';
import { isProgrammeNetwork } from '../../lib/model';
import {
  defaultSensitivityConfig, validateSensitivityConfig, MAX_AXIS_STEPS,
} from '../../lib/model/sensitivity';
import type {
  SensitivityCell, SensitivityConfig, SensitivityLever, SensitivityMetrics,
} from '../../lib/model/sensitivity';
import { safeRunSensitivity, safeRunStressPack } from '../../lib/safe-sensitivity';
import {
  LEVER_LABEL, LEVER_SHORT, selectableLevers, SENSITIVITY_METRICS,
  formatStepLabel, formatRangeLabel, stressSettingText, flagShortCodes, isMeasuredBar,
  omittedTornadoNotes, unmeasuredCellNotes, unmeasuredCellNote, STRESS_SIGN_CONVENTION,
} from '../../lib/sensitivity-format';
import type { SensitivityMetricKey } from '../../lib/sensitivity-format';
import { penceToPounds, formatPct, signedPenceToPounds } from '../../lib/format';
import CalculatorFailurePanel from '../CalculatorFailurePanel';

interface Props {
  // R8 Task 5: widened from CalculatorInputsV4 — the shared corpus is now v5 and
  // the only thing this page does with the document is hand it to
  // safeRunSensitivity, which has always taken the union. Pure type widening.
  inputs: AnyCalculatorInputs;
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
  // R12 (spec §18.9). `phase_slip`'s target -- null until the user picks one,
  // in which case the config below falls back to the document's first phase
  // so choosing the lever alone never lands on an unsatisfiable axis.
  const [rowPhaseId, setRowPhaseId] = useState<string | null>(null);
  const [colPhaseId, setColPhaseId] = useState<string | null>(null);

  // `isProgrammeNetwork` is the sole sanctioned discriminator (programme.ts) --
  // a `programme = null` document, or a v4-v8 document still carrying the
  // legacy `{ packages }` shape, has no phase to target, and `phase_slip`
  // stays off the lever dropdown for exactly that document (§18.9: "on a
  // programme = null document [the lever] has no field to write").
  const rawProgramme = 'programme' in inputs ? inputs.programme : null;
  const network = rawProgramme != null && isProgrammeNetwork(rawProgramme) ? rawProgramme : null;
  // Memoised on `network` (a stable reference across renders that do not
  // change `inputs.programme`) so the `config` useMemo below, which reads
  // `phases`, is not invalidated by a fresh `[]` literal on every render of a
  // `programme = null` document.
  const phases = useMemo(() => network?.phases ?? [], [network]);
  const levers = selectableLevers(network != null, 'unit_sales' in inputs && inputs.unit_sales != null);

  // R12 final review wave (Finding 3). The engine deliberately allows rows
  // and cols to both be `phase_slip`, targeting different phases (spec
  // §18.9) — `LEVER_LABEL`/`LEVER_SHORT` alone render both axes as the same
  // bare "Slip", with nothing naming which phase. `TornadoBar.phase_id` and
  // `SensitivityAxis.phase_id` are the engine's own echo of the phase a
  // `phase_slip` axis targets (sensitivity.ts); look it up against this
  // page's own `phases` list rather than trusting the id to already read
  // sensibly, and fall back to the raw id if a phase was ever removed after
  // the axis was configured.
  const phaseLabel = (phaseId: string | null | undefined): string => {
    if (phaseId == null) return '';
    return phases.find((p) => p.id === phaseId)?.label ?? phaseId;
  };
  const leverLabel = (lever: SensitivityLever, phaseId: string | null | undefined): string => (
    lever === 'phase_slip' && phaseId != null
      ? `${LEVER_LABEL[lever]}: ${phaseLabel(phaseId)}`
      : LEVER_LABEL[lever]
  );
  const leverShort = (lever: SensitivityLever, phaseId: string | null | undefined): string => (
    lever === 'phase_slip' && phaseId != null
      ? `${LEVER_SHORT[lever]}: ${phaseLabel(phaseId)}`
      : LEVER_SHORT[lever]
  );

  const resetToDefaults = () => {
    setRowLever(DEFAULTS.rows.lever);
    setColLever(DEFAULTS.cols.lever);
    setRowStepsText(stepsToText(DEFAULTS.rows.steps));
    setColStepsText(stepsToText(DEFAULTS.cols.steps));
    setRowPhaseId(null);
    setColPhaseId(null);
  };

  // The tornado ranges stay at the spec §12.4 defaults in R4b — only the matrix
  // axes are editable, which is the whole of design §5.1's third region.
  const config: SensitivityConfig = useMemo(() => ({
    rows: {
      lever: rowLever,
      phase_id: rowLever === 'phase_slip' ? (rowPhaseId ?? phases[0]?.id ?? null) : null,
      steps: parseSteps(rowStepsText),
    },
    cols: {
      lever: colLever,
      phase_id: colLever === 'phase_slip' ? (colPhaseId ?? phases[0]?.id ?? null) : null,
      steps: parseSteps(colStepsText),
    },
    tornado: DEFAULTS.tornado,
  }), [rowLever, rowPhaseId, rowStepsText, colLever, colPhaseId, colStepsText, phases]);

  // Spec §12.6 config errors only. A position whose *levered document* is invalid is no
  // longer this component's problem: §12.7 makes the engine report it per position, which
  // is strictly more informative than refusing the grid — the analyst sees which steps
  // work and which do not. Passing `inputs` activates §18.9's phase-existence check too.
  const issues = useMemo(
    () => validateSensitivityConfig(config, inputs).map((issue) => issue.message),
    [config, inputs],
  );

  // Spec §12.6 errors are input errors: report them and compute nothing, rather
  // than leaving the previous grid on screen beside an invalid config.
  const outcome = useMemo(
    () => (issues.length > 0 ? null : safeRunSensitivity(inputs, config)),
    [inputs, config, issues],
  );

  // R16 (spec §25): the fixed nine-entry lender stress pack. Independent of the
  // row/col axis editor above -- it has no config of its own -- so it is computed
  // unconditionally, unlike `outcome`.
  const pack = useMemo(() => safeRunStressPack(inputs), [inputs]);

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
          {levers.map((lever) => (
            <option key={lever} value={lever}>{LEVER_LABEL[lever]}</option>
          ))}
        </select>
      </label>
      {/* R12 spec §18.9: `phase_slip` needs a target as well as a magnitude.
          Shown only when the row lever is phase_slip, so every other lever's
          editor looks exactly as it did before this release. */}
      {rowLever === 'phase_slip' && (
        <label style={{ color: MUTED, fontSize: 13 }}>
          Row phase
          <select
            value={rowPhaseId ?? phases[0]?.id ?? ''}
            onChange={(e) => setRowPhaseId(e.target.value)}
            style={{ display: 'block', marginTop: 4, padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
          >
            {phases.map((p) => (
              <option key={p.id} value={p.id}>{p.label || p.id}</option>
            ))}
          </select>
        </label>
      )}
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
          {levers.map((lever) => (
            <option key={lever} value={lever}>{LEVER_LABEL[lever]}</option>
          ))}
        </select>
      </label>
      {colLever === 'phase_slip' && (
        <label style={{ color: MUTED, fontSize: 13 }}>
          Column phase
          <select
            value={colPhaseId ?? phases[0]?.id ?? ''}
            onChange={(e) => setColPhaseId(e.target.value)}
            style={{ display: 'block', marginTop: 4, padding: '4px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13 }}
          >
            {phases.map((p) => (
              <option key={p.id} value={p.id}>{p.label || p.id}</option>
            ))}
          </select>
        </label>
      )}
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
      <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 8 }}>12. Sensitivity</h3>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 24, maxWidth: 780 }}>
        Every cell and every bar re-runs the full appraisal with the committed facility and
        equity sources held at their base values (spec §12.2). A position needing more debt
        than the facility does not receive it — it raises FE (facility exceeded), FG (funding
        gap) or NR (senior debt not repaid within the term), and that flag is the finding.
      </p>
    </>
  );

  // Fix round 1, Finding 2. The stress pack (Region 0) has no config of its own --
  // it does not depend on the row/col axis editor at all -- so it renders on every
  // branch below, including the two axis-editor failure panels, rather than only
  // on the matrix's own success path. Built once here, ahead of every return, so
  // "after the heading/editor and before Region 1" holds regardless of which
  // branch a given render takes.
  const region0 = (
    <>
      {/* ── Region 0: standard lender stress pack (spec §25) ── */}
      <h4 style={{ color: MUTED, fontSize: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        Standard Lender Stresses
      </h4>
      {!pack.ok && (
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 28 }}>
          Standard lender stresses could not be calculated: {pack.error.message}
        </p>
      )}
      {pack.ok && (
        <table
          aria-label="Standard lender stresses"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 8 }}
        >
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left' }}>Stress</th>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left' }}>Setting</th>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'right' }}>Profit</th>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'right' }}>Delta vs base</th>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'right' }}>Peak debt</th>
              <th style={{ padding: '8px 12px', color: MUTED, textAlign: 'left' }}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {pack.result.stresses.map((s) => {
              // §12.7: the levered document failed validation, exactly the
              // matrix's own unmeasured-cell criterion (`s.delta_profit_pence`
              // is null on precisely this condition — stress-pack.ts).
              const unmeasured = s.metrics.validation_errors.length > 0;
              const codes = flagShortCodes(s.metrics.flags);
              return (
                <tr key={s.key} style={{ borderBottom: `1px solid ${PANEL}` }}>
                  <td style={{ padding: '8px 12px', color: TEXT }}>{s.label}</td>
                  <td style={{ padding: '8px 12px', color: TEXT }}>
                    {/* R16 spec §25.5, fix wave FI1: the whole Setting-cell rule
                        (per-lever precision, entry 9's 2dp derived cost
                        percentage, the recorded-pounds parenthetical) is
                        `stressSettingText` — the same function the investment
                        memo's own stress table calls. Before this the page
                        printed neither the 2dp quote nor the parenthetical, so
                        the two surfaces disagreed on entry 9. `s.note` stays
                        the page's own italic <div> below. */}
                    {stressSettingText(s)}
                    {s.note != null && (
                      <div style={{ color: MUTED, fontSize: 12, fontStyle: 'italic', marginTop: 2 }}>
                        {s.note}
                      </div>
                    )}
                    {unmeasured && (
                      <div style={{ color: MUTED, fontSize: 12, fontStyle: 'italic', marginTop: 2 }}>
                        {unmeasuredCellNote(s.metrics.validation_errors[0].message)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: unmeasured ? MUTED : TEXT, textAlign: 'right' }}>
                    {unmeasured ? '—' : penceToPounds(s.metrics.profit_pence as number)}
                  </td>
                  <td style={{ padding: '8px 12px', color: unmeasured ? MUTED : TEXT, textAlign: 'right' }}>
                    {unmeasured || s.delta_profit_pence === null ? '—' : signedPenceToPounds(s.delta_profit_pence)}
                  </td>
                  <td style={{ padding: '8px 12px', color: unmeasured ? MUTED : TEXT, textAlign: 'right' }}>
                    {unmeasured ? '—' : penceToPounds(s.metrics.peak_debt_pence as number)}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {codes && <span style={{ color: RED, fontSize: 11 }}>[{codes}]</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {/* Fix wave FI2. Entry 7's label reads "Refinance LTV -10 pp" while its
          Setting reads "Refinance LTV +10.0 pp", and a reader with only the
          table in front of them has no way to tell that is a convention rather
          than a contradiction. The label is normative (spec §25.2) and stays;
          the convention it is quoted against is stated once, here, and in the
          memo's own method sentence (export-investment-memo.ts §25 block) in
          the same words. Every lever's Setting is signed so that POSITIVE is
          the adverse direction, which for `refi_ltv` means a lower cap. */}
      {pack.ok && (
        <p style={{ color: MUTED, fontSize: 12, marginBottom: 28, maxWidth: 780 }}>
          {STRESS_SIGN_CONVENTION}
        </p>
      )}
    </>
  );

  if (issues.length > 0) {
    return (
      <div>
        {heading}
        {editor}
        {region0}
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
        {region0}
        <CalculatorFailurePanel title="The sensitivity suite could not be calculated">
          {outcome ? outcome.error.message : 'No result was produced for these axes.'}
        </CalculatorFailurePanel>
      </div>
    );
  }

  const { base, matrix, tornado, config: resolved } = outcome.result;

  // §12.7: the reasons this grid's unmeasured positions exist, deduplicated. Built by
  // the shared module so the memo prints the same sentences from the same source —
  // neither surface writes its own explanation of what an unmeasured cell means.
  //
  // Not wrapped in useMemo: `matrix` only exists after the issues/outcome early
  // returns above, so a hook here would run on some renders and not others,
  // violating the Rules of Hooks (React throws "Rendered fewer hooks than
  // expected" the moment a render crosses from the early-return path to this
  // one). The scan itself is cheap — at most 9x9 cells (spec §12.6's MAX_AXIS_STEPS).
  const cellNotes = unmeasuredCellNotes(matrix);

  // §12.7: a bar with an unmeasured endpoint has no span at all. `isMeasuredBar`
  // narrows both endpoints to `MeasuredMetrics`, so every render site below can
  // read `.profit_pence` as a plain number with no cast.
  const measuredBars = tornado.filter(isMeasuredBar);
  // The omitted-bar sentences, built once and reused below both to decide whether the
  // note paragraph renders at all and to print it — rather than a third, separately
  // maintained filter over the same `span_pence === null` condition `omittedTornadoNotes`
  // already applies internally.
  const tornadoNotes = omittedTornadoNotes(tornado);

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
      {region0}

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
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: tornadoNotes.length > 0 ? 8 : 28 }}
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
                  <td style={{ padding: '8px 12px', color: TEXT }}>{leverLabel(bar.lever, bar.phase_id)}</td>
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
      {tornadoNotes.length > 0 && (
        <p style={{ color: MUTED, fontSize: 13, marginBottom: 28 }}>
          {tornadoNotes.join(' ')}
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
                {leverShort(resolved.rows.lever, resolved.rows.phase_id)} \ {leverShort(resolved.cols.lever, resolved.cols.phase_id)}
              </th>
              {resolved.cols.steps.map((step) => (
                <th key={step} style={{ padding: '8px 12px', color: MUTED, textAlign: 'right' }}>
                  {`${leverShort(resolved.cols.lever, resolved.cols.phase_id)} ${formatStepLabel(resolved.cols.lever, step)}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row[0].row_step} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <th scope="row" style={{ padding: '8px 12px', color: TEXT, textAlign: 'left', fontWeight: 600 }}>
                  {`${leverShort(resolved.rows.lever, resolved.rows.phase_id)} ${formatStepLabel(resolved.rows.lever, row[0].row_step)}`}
                </th>
                {row.map((cell: SensitivityCell) => {
                  const codes = flagShortCodes(cell.flags);
                  const noteIndex = cellNotes.noteIndexFor(cell);
                  const unmeasured = noteIndex !== null;
                  return (
                    <td
                      key={cell.col_step}
                      aria-describedby={unmeasured ? `sens-note-${noteIndex}` : undefined}
                      style={{
                        padding: '8px 12px',
                        textAlign: 'right',
                        color: unmeasured ? MUTED : metricColor(metric, cell[metric]),
                        fontStyle: unmeasured ? 'italic' : undefined,
                        fontWeight: cell.row_step === 0 && cell.col_step === 0 ? 700 : 400,
                      }}
                    >
                      {metricText(cell, metric)}
                      {unmeasured && (
                        // A text marker, not a colour or a style: it has to survive
                        // print, high-contrast mode and a screenshot.
                        <sup style={{ color: MUTED, fontSize: 11, marginLeft: 3 }}>
                          {noteIndex + 1}
                        </sup>
                      )}
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

      {/* §12.7: an unmeasured position prints the same "—" as a genuinely null metric
          (a zero-denominator ratio), so without the reason a reader cannot tell the two
          apart. Before R6 this lived only in a `<td title>` — unreachable by screen
          reader, print and touch — for information that is load-bearing. Each cell
          points here by aria-describedby; the marker is what a sighted reader follows.
          The sentences are the engine's own validation messages, built by the shared
          module the memo reads too. */}
      {cellNotes.notes.length > 0 && (
        <ol style={{ color: MUTED, fontSize: 13, marginBottom: 24, paddingLeft: 20 }}>
          {cellNotes.notes.map((note, i) => (
            <li key={note} id={`sens-note-${i}`}>{unmeasuredCellNote(note)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
