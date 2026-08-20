import { useCallback } from 'react';
import type { CalculatorInputsV7, AppraisalRun, ProgrammePackage, SpendCurve } from '../../lib/model';
import { penceToPounds } from '../../lib/format';
import { formatProgrammeMonth } from '../../lib/programme-months';

interface Props {
  inputs: CalculatorInputsV7;
  onChange: (partial: Partial<CalculatorInputsV7>) => void;
  run: AppraisalRun;
}

const PACKAGES = ['construction', 'professional', 'statutory'] as const;
type PackageName = (typeof PACKAGES)[number];

const PACKAGE_LABELS: Record<PackageName, string> = {
  construction: 'Construction',
  professional: 'Professional',
  statutory: 'Statutory',
};

const CURVE_KINDS = ['straight_line', 's_curve', 'back_loaded', 'user_defined'] as const;
const CURVE_LABELS: Record<(typeof CURVE_KINDS)[number], string> = {
  straight_line: 'Straight line',
  s_curve: 'S-curve',
  back_loaded: 'Back-loaded',
  user_defined: 'User-defined',
};

const numberInputStyle: React.CSSProperties = {
  width: 90, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 14,
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 14,
};

const cellStyle: React.CSSProperties = { padding: '4px 10px', fontSize: 13, textAlign: 'right', color: '#e2e8f0' };

// CRITICAL 1: a typed negative or fractional value reaches buildSchedule's
// programme arm untouched — `uses[-1]`/`uses[2.5]` throws (TypeError) or
// `new Array(2.5)` throws (RangeError) inside a render-time useMemo, which
// unmounts the whole calculator. Clamp on write so the input can never carry
// an invalid value into state. Number.isFinite guards NaN (an emptied field)
// before Math.floor, since Math.floor(NaN) is NaN, not 0/1.
function clampStartOffset(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function clampDurationMonths(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

export default function ProgrammePage({ inputs, onChange, run }: Props) {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const programme = inputs.programme;
  const anchor = programme?.anchor_month ?? null;
  const canSetExplicit = term >= 3;

  const seedFromAuto = useCallback(() => {
    const cw = Math.max(1, term - 2);
    const pw = Math.max(1, Math.ceil(cw / 2));
    const straight = { kind: 'straight_line' as const };
    onChange({
      programme: {
        anchor_month: null,
        packages: {
          construction: { start_offset: 1, duration_months: cw, curve: straight },
          professional: { start_offset: 1, duration_months: pw, curve: straight },
          statutory: { start_offset: 1, duration_months: pw, curve: straight },
        },
      },
    });
  }, [term, onChange]);

  const updatePackage = useCallback(
    (name: PackageName, partial: Partial<ProgrammePackage>) => {
      if (!programme) return;
      onChange({
        programme: {
          ...programme,
          packages: { ...programme.packages, [name]: { ...programme.packages[name], ...partial } },
        },
      });
    },
    [programme, onChange],
  );

  const updateCurveKind = useCallback(
    (name: PackageName, kind: SpendCurve['kind']) => {
      if (!programme) return;
      const pkg = programme.packages[name];
      const curve: SpendCurve =
        kind === 'user_defined' ? { kind: 'user_defined', weights: Array(pkg.duration_months).fill(1) } : { kind };
      updatePackage(name, { curve });
    },
    [programme, updatePackage],
  );

  // Only writes finite parses -- an in-progress edit like "1, 2," or "1, abc"
  // never overwrites the last valid weights (spec §6.1: NaN/Infinity would
  // poison the curve spread downstream).
  const updateWeights = useCallback(
    (name: PackageName, raw: string) => {
      const parsed = raw.split(',').map((s) => Number(s.trim()));
      if (parsed.length > 0 && parsed.every((n) => Number.isFinite(n))) {
        updatePackage(name, { curve: { kind: 'user_defined', weights: parsed } });
      }
    },
    [updatePackage],
  );

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>6. Programme</h3>

      {programme == null ? (
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', marginBottom: 24 }}>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12 }}>
            Auto windows: straight-line construction over months 1–{Math.max(1, term - 2)}, professional/statutory
            over the first half — spec §6.
          </p>
          <button
            onClick={seedFromAuto}
            disabled={!canSetExplicit}
            style={{
              padding: '8px 20px',
              background: canSetExplicit ? '#2563eb' : '#1e293b',
              color: canSetExplicit ? '#fff' : '#475569',
              border: 'none',
              borderRadius: 6,
              cursor: canSetExplicit ? 'pointer' : 'default',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Set explicit programme
          </button>
          {!canSetExplicit && (
            <p style={{ color: '#f59e0b', fontSize: 13, marginTop: 8 }}>
              Explicit programme editing requires a term of at least 3 months — the final two months are the
              sale-tail (spec §6).
            </p>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ color: '#94a3b8', fontSize: 14 }}>Anchor month</label>
            <input
              type="month"
              value={anchor ?? ''}
              onChange={(e) => onChange({ programme: { ...programme, anchor_month: e.target.value || null } })}
              style={numberInputStyle}
            />
            <button
              onClick={() => onChange({ programme: null })}
              style={{
                padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none',
                borderRadius: 6, cursor: 'pointer', fontSize: 14,
              }}
            >
              Revert to auto windows
            </button>
          </div>

          {PACKAGES.map((name) => {
            const pkg = programme.packages[name];
            return (
              <div
                key={name}
                style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', marginBottom: 12 }}
              >
                <h4 style={{ color: '#e2e8f0', fontSize: 14, marginBottom: 12 }}>{PACKAGE_LABELS[name]}</h4>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#94a3b8', fontSize: 13 }}>Start offset</label>
                    <input
                      type="number"
                      min={0}
                      value={pkg.start_offset}
                      onChange={(e) => updatePackage(name, { start_offset: clampStartOffset(e.target.value) })}
                      style={numberInputStyle}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#94a3b8', fontSize: 13 }}>Duration (months)</label>
                    <input
                      type="number"
                      min={1}
                      value={pkg.duration_months}
                      onChange={(e) => updatePackage(name, { duration_months: clampDurationMonths(e.target.value) })}
                      style={numberInputStyle}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ color: '#94a3b8', fontSize: 13 }}>Curve</label>
                    <select
                      value={pkg.curve.kind}
                      onChange={(e) => updateCurveKind(name, e.target.value as SpendCurve['kind'])}
                      style={selectStyle}
                    >
                      {CURVE_KINDS.map((k) => (
                        <option key={k} value={k}>{CURVE_LABELS[k]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {pkg.curve.kind === 'user_defined' && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>
                      Weights (comma-separated, one per window month)
                    </label>
                    <input
                      type="text"
                      value={pkg.curve.weights.join(', ')}
                      onChange={(e) => updateWeights(name, e.target.value)}
                      style={{
                        width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
                        borderRadius: 4, color: '#e2e8f0', fontSize: 14,
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div>
        <h4 style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          Spend Preview
        </h4>
        {/* Engine output only (run.schedule.uses) -- component-local spend arithmetic
            is prohibited, see ExitStrategyPage.tsx for the same precedent. */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Month', 'Construction', 'Professional', 'Statutory', 'Total'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: h === 'Month' ? 'left' : 'right', color: '#94a3b8', fontSize: 12,
                      padding: '6px 10px', borderBottom: '1px solid #1e3a5f',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.schedule.uses.map((u, m) => {
                const total = u.construction_pence + u.professional_pence + u.statutory_pence;
                return (
                  <tr key={m}>
                    <td style={{ padding: '4px 10px', fontSize: 13, color: '#e2e8f0' }}>
                      {formatProgrammeMonth(anchor, m)}
                    </td>
                    <td style={cellStyle}>{penceToPounds(u.construction_pence)}</td>
                    <td style={cellStyle}>{penceToPounds(u.professional_pence)}</td>
                    <td style={cellStyle}>{penceToPounds(u.statutory_pence)}</td>
                    <td style={{ ...cellStyle, fontWeight: 600 }}>{penceToPounds(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
