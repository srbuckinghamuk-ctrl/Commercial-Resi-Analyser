import type {
  Phase, Dependency, DependencyType, PhaseCode, DerivedPhase, SpendCurve,
} from '../../lib/model';
import { PHASE_CODES } from '../../lib/model';

/**
 * R12 spec §18.1/§18.10. Phase list editor: add, remove, reorder; edit every
 * field the schema defines. NO calculation here — `derivedById` is read-only
 * output handed down by ProgrammePage, which is the ONLY caller of
 * `derivePhases` (spec §18.2/§18.4). This component never computes a start, a
 * finish or a float; it reads them.
 *
 * `derivedById` is `null` exactly when the network's derivation is a cycle
 * result (ProgrammePage's job to detect, not this component's) — the editor
 * still renders every row so the user can edit predecessors to BREAK the
 * cycle; the Start/Finish/Float columns fall back to '—'.
 */
interface Props {
  phases: Phase[];
  derivedById: Record<string, DerivedPhase> | null;
  onChange: (phases: Phase[]) => void;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED_BG = '#7f1d1d';
const RED_TEXT = '#fca5a5';
const ACCENT = '#1e3a5f';

const CURVE_KINDS = ['straight_line', 's_curve', 'back_loaded', 'user_defined'] as const;
const CURVE_LABELS: Record<(typeof CURVE_KINDS)[number], string> = {
  straight_line: 'Straight line',
  s_curve: 'S-curve',
  back_loaded: 'Back-loaded',
  user_defined: 'User-defined',
};

const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS'];

const cellStyle: React.CSSProperties = { padding: '4px 6px', fontSize: 13, verticalAlign: 'top' };
const thStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: 12, color: MUTED, textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
};
const numberInputStyle: React.CSSProperties = {
  width: 64, padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13,
};
const textInputStyle: React.CSSProperties = {
  width: 110, padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13,
};
const selectStyle: React.CSSProperties = {
  padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13,
};
const smallButtonStyle: React.CSSProperties = {
  padding: '2px 8px', background: ACCENT, color: TEXT, border: 'none', borderRadius: 4,
  cursor: 'pointer', fontSize: 12,
};

/** duration_months: whole months, 0 = milestone (spec §18.3), never negative. */
function clampDurationMonths(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
/** start_offset: an earliest-start FLOOR, whole months, never negative (spec §18.1). */
function clampStartOffset(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
/** slip_months: SIGNED whole months — negative is acceleration (spec §18.2). No floor at 0. */
function clampSlipMonths(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
/** lag_months: whole months, never negative (spec §18.1's DependencyType). */
function clampLagMonths(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function newPhase(): Phase {
  return {
    id: crypto.randomUUID(),
    code: 'other',
    label: '',
    duration_months: 1,
    slip_months: 0,
    start_offset: 0,
    curve: { kind: 'straight_line' },
    predecessors: [],
  };
}

export default function PhaseEditor({ phases, derivedById, onChange }: Props) {
  const update = (id: string, partial: Partial<Phase>) => {
    onChange(phases.map((p) => (p.id === id ? { ...p, ...partial } : p)));
  };

  const add = () => {
    onChange([...phases, newPhase()]);
  };

  // A removed phase's id must not survive as a stale predecessor reference on
  // another phase -- that would leave a dangling `phase_id` validation.ts (spec
  // §18.8) rejects, silently reintroducing the exact error the user just fixed
  // by deleting the phase they thought they were done with.
  const remove = (id: string) => {
    onChange(
      phases
        .filter((p) => p.id !== id)
        .map((p) => (
          p.predecessors.some((d) => d.phase_id === id)
            ? { ...p, predecessors: p.predecessors.filter((d) => d.phase_id !== id) }
            : p
        )),
    );
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= phases.length) return;
    const next = [...phases];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const updateCurveKind = (id: string, kind: SpendCurve['kind']) => {
    const phase = phases.find((p) => p.id === id);
    if (!phase) return;
    const curve: SpendCurve = kind === 'user_defined'
      ? { kind: 'user_defined', weights: Array(Math.max(phase.duration_months, 0)).fill(1) }
      : { kind };
    update(id, { curve });
  };

  // Only writes finite parses -- an in-progress edit like "1, 2," never
  // overwrites the last valid weights (mirrors the pre-R12 ProgrammePage rule).
  const updateWeights = (id: string, raw: string) => {
    const parsed = raw.split(',').map((s) => Number(s.trim()));
    if (parsed.length > 0 && parsed.every((n) => Number.isFinite(n))) {
      update(id, { curve: { kind: 'user_defined', weights: parsed } });
    }
  };

  const addPredecessor = (phaseId: string) => {
    const phase = phases.find((p) => p.id === phaseId);
    if (!phase) return;
    const candidate = phases.find((p) => p.id !== phaseId);
    if (!candidate) return;
    update(phaseId, {
      predecessors: [...phase.predecessors, { phase_id: candidate.id, type: 'FS', lag_months: 0 }],
    });
  };

  const updatePredecessor = (phaseId: string, index: number, partial: Partial<Dependency>) => {
    const phase = phases.find((p) => p.id === phaseId);
    if (!phase) return;
    update(phaseId, {
      predecessors: phase.predecessors.map((d, i) => (i === index ? { ...d, ...partial } : d)),
    });
  };

  const removePredecessor = (phaseId: string, index: number) => {
    const phase = phases.find((p) => p.id === phaseId);
    if (!phase) return;
    update(phaseId, { predecessors: phase.predecessors.filter((_, i) => i !== index) });
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table aria-label="Phases" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr>
            {['Phase', 'Code', 'Duration', 'Slip', 'Start offset', 'Curve', 'Start', 'Finish', 'Float', 'Predecessors', ''].map((h) => (
              <th key={h || 'actions'} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {phases.map((phase, i) => {
            const dp = derivedById?.[phase.id] ?? null;
            const others = phases.filter((p) => p.id !== phase.id);
            return (
              <tr key={phase.id} style={{ borderBottom: `1px solid ${PANEL}` }}>
                <td style={cellStyle}>
                  <input
                    type="text"
                    value={phase.label}
                    onChange={(e) => update(phase.id, { label: e.target.value })}
                    style={textInputStyle}
                  />
                </td>
                <td style={cellStyle}>
                  <select
                    value={phase.code}
                    onChange={(e) => update(phase.id, { code: e.target.value as PhaseCode })}
                    style={selectStyle}
                  >
                    {PHASE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={cellStyle}>
                  <input
                    type="number"
                    min={0}
                    value={phase.duration_months}
                    onChange={(e) => update(phase.id, { duration_months: clampDurationMonths(e.target.value) })}
                    style={numberInputStyle}
                  />
                </td>
                <td style={cellStyle}>
                  <input
                    type="number"
                    value={phase.slip_months}
                    onChange={(e) => update(phase.id, { slip_months: clampSlipMonths(e.target.value) })}
                    style={numberInputStyle}
                  />
                </td>
                <td style={cellStyle}>
                  <input
                    type="number"
                    min={0}
                    value={phase.start_offset}
                    onChange={(e) => update(phase.id, { start_offset: clampStartOffset(e.target.value) })}
                    style={numberInputStyle}
                  />
                </td>
                <td style={cellStyle}>
                  <select
                    value={phase.curve.kind}
                    onChange={(e) => updateCurveKind(phase.id, e.target.value as SpendCurve['kind'])}
                    style={selectStyle}
                  >
                    {CURVE_KINDS.map((k) => <option key={k} value={k}>{CURVE_LABELS[k]}</option>)}
                  </select>
                  {phase.curve.kind === 'user_defined' && (
                    <input
                      type="text"
                      aria-label={`${phase.label || phase.id} weights`}
                      value={phase.curve.weights.join(', ')}
                      onChange={(e) => updateWeights(phase.id, e.target.value)}
                      style={{ ...textInputStyle, display: 'block', marginTop: 4, width: 150 }}
                    />
                  )}
                </td>
                <td style={{ ...cellStyle, color: TEXT }}>{dp ? dp.start_month : '—'}</td>
                <td style={{ ...cellStyle, color: TEXT }}>{dp ? dp.finish_month : '—'}</td>
                <td style={{ ...cellStyle, color: TEXT }}>
                  {dp ? dp.total_float_months : '—'}
                  {dp?.is_critical ? ' (critical)' : ''}
                </td>
                <td style={cellStyle}>
                  {phase.predecessors.map((dep, di) => (
                    <div key={`${dep.phase_id}-${di}`} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
                      <select
                        aria-label={`${phase.label || phase.id} predecessor ${di + 1} phase`}
                        value={dep.phase_id}
                        onChange={(e) => updatePredecessor(phase.id, di, { phase_id: e.target.value })}
                        style={selectStyle}
                      >
                        {others.map((p) => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
                      </select>
                      <select
                        aria-label={`${phase.label || phase.id} predecessor ${di + 1} type`}
                        value={dep.type}
                        onChange={(e) => updatePredecessor(phase.id, di, { type: e.target.value as DependencyType })}
                        style={selectStyle}
                      >
                        {DEPENDENCY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input
                        type="number"
                        min={0}
                        aria-label={`${phase.label || phase.id} predecessor ${di + 1} lag`}
                        value={dep.lag_months}
                        onChange={(e) => updatePredecessor(phase.id, di, { lag_months: clampLagMonths(e.target.value) })}
                        style={{ ...numberInputStyle, width: 48 }}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${phase.label || phase.id} predecessor ${di + 1}`}
                        onClick={() => removePredecessor(phase.id, di)}
                        style={{ ...smallButtonStyle, background: RED_BG, color: RED_TEXT }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={others.length === 0}
                    onClick={() => addPredecessor(phase.id)}
                    style={{ ...smallButtonStyle, opacity: others.length === 0 ? 0.5 : 1 }}
                  >
                    + predecessor
                  </button>
                </td>
                <td style={cellStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        aria-label={`Move ${phase.label || phase.id} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        style={{ ...smallButtonStyle, opacity: i === 0 ? 0.5 : 1 }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${phase.label || phase.id} down`}
                        disabled={i === phases.length - 1}
                        onClick={() => move(i, 1)}
                        style={{ ...smallButtonStyle, opacity: i === phases.length - 1 ? 0.5 : 1 }}
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove phase ${phase.label || phase.id}`}
                      onClick={() => remove(phase.id)}
                      style={{ ...smallButtonStyle, background: RED_BG, color: RED_TEXT }}
                    >
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        onClick={add}
        style={{ padding: '8px 20px', background: '#1e3a5f', color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
      >
        + Add phase
      </button>
    </div>
  );
}
