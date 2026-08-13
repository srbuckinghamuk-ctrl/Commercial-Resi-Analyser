import { useEffect, useMemo, useState } from 'react';
import type { Project, EligibilityAssessment } from '../../types';
import type { DealSpiderInputs } from '../../lib/conversion-types';
import type { CalculatorInputsV2 } from '../../lib/model';
import {
  CLASS_MA_AXES,
  computeSpider,
  scenarioColor,
  SCENARIO_COLORS,
  type SpiderResult,
} from '../../lib/deal-spider';
import { applyScenario } from '../../lib/apply-scenario';
import { getEligibility } from '../../lib/api';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV2;
  onChange: (partial: Partial<CalculatorInputsV2>) => void;
  project: Project;
}

const RAG_COLORS: Record<string, string> = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  blocked: '#ef4444',
};

const RAG_LABELS: Record<string, string> = {
  green: 'Strong deal',
  amber: 'Marginal — review weak axes',
  red: 'High risk — reconsider',
};

// Radar geometry (ported from the refurb calculator, rescaled to 0–5)
const CX = 220;
const CY = 215;
const R = 165;
const N = CLASS_MA_AXES.length;
const angle = (i: number) => (i / N) * 2 * Math.PI - Math.PI / 2;
const pt = (i: number, score: number): [number, number] => {
  const a = angle(i);
  const d = (score / 5) * R;
  return [CX + d * Math.cos(a), CY + d * Math.sin(a)];
};
const labelPt = (i: number): [number, number] => {
  const a = angle(i);
  const d = R + 28;
  return [CX + d * Math.cos(a), CY + d * Math.sin(a)];
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  marginTop: 4,
  background: '#0f172a',
  border: '1px solid #1e3a5f',
  borderRadius: 4,
  color: '#e2e8f0',
  fontSize: 13,
};

const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 12 };

export default function DealSpiderPage({ inputs, onChange, project }: Props) {
  const [eligibilityState, setEligibilityState] = useState<{
    projectId: string;
    assessment: EligibilityAssessment | null;
  } | null>(null);
  const [showScenarios, setShowScenarios] = useState(false);
  const [showDetail, setShowDetail] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEligibility(project.id)
      .then((assessment) => {
        if (!cancelled) setEligibilityState({ projectId: project.id, assessment });
      })
      .catch(() => {
        if (!cancelled) setEligibilityState({ projectId: project.id, assessment: null });
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const eligibilityLoaded = eligibilityState?.projectId === project.id;
  const eligibility = eligibilityLoaded ? eligibilityState.assessment : null;

  const spider = inputs.deal_spider;
  const setSpider = (partial: Partial<DealSpiderInputs>) =>
    onChange({ deal_spider: { ...spider, ...partial } });

  const base: SpiderResult = useMemo(() => computeSpider(inputs, eligibility), [inputs, eligibility]);

  const overlays = useMemo(() => {
    const list: { label: string; color: string; result: SpiderResult }[] = [
      { label: 'Base Deal', color: SCENARIO_COLORS.base, result: base },
    ];
    if (showScenarios) {
      for (const key of ['upside', 'downside', 'severe'] as const) {
        const overrides = inputs.scenarios[key];
        list.push({
          label: overrides.label,
          color: scenarioColor(overrides.label, SCENARIO_COLORS.s1),
          result: computeSpider(applyScenario(inputs, overrides), eligibility),
        });
      }
    }
    return list;
  }, [inputs, eligibility, base, showScenarios]);

  const weakest = useMemo(
    () => [...base.axes].sort((a, b) => a.score - b.score).slice(0, 3),
    [base],
  );

  const ragColor = RAG_COLORS[base.rag];

  const polyPts = (result: SpiderResult) =>
    result.axes.map((a, i) => pt(i, a.score).join(',')).join(' ');

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 4 }}>10. Deal Spider</h3>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 20 }}>
        9-axis Class MA risk profile. Every axis is normalised to 0–5 with outward always better.
        Axes marked † are provisional — an eligibility check behind them is unverified.
      </p>

      {/* Blocked banner — the eligibility gate outranks the score */}
      {base.blocked && (
        <div
          style={{
            background: '#450a0a',
            border: '1px solid #ef4444',
            borderRadius: 8,
            padding: '14px 18px',
            marginBottom: 20,
          }}
        >
          <div style={{ color: '#ef4444', fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            BLOCKED — Class MA not available
          </div>
          <div style={{ color: '#fca5a5', fontSize: 13 }}>
            Failing check{base.blockedBy.length > 1 ? 's' : ''}: {base.blockedBy.join('; ')}. A deal
            that cannot use Class MA does not get a score.
          </div>
        </div>
      )}

      {/* Eligibility status note */}
      {eligibilityLoaded && !eligibility && !base.blocked && (
        <div
          style={{
            background: '#451a03',
            border: '1px solid #f59e0b',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 20,
            color: '#fbbf24',
            fontSize: 13,
          }}
        >
          No eligibility assessment found for this project — the Prior Approval axis is provisional
          and capped at 2 until you run the Eligibility check.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        {/* LEFT: radar + weakest + detail */}
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <span style={{ color: '#64748b', fontSize: 12 }}>Compare:</span>
            {[false, true].map((mode) => (
              <button
                key={String(mode)}
                onClick={() => setShowScenarios(mode)}
                style={{
                  padding: '4px 12px',
                  background: showScenarios === mode ? '#1e3a5f' : '#0f172a',
                  border: `1px solid ${showScenarios === mode ? '#2563eb' : '#1e3a5f'}`,
                  borderRadius: 4,
                  color: showScenarios === mode ? '#e2e8f0' : '#64748b',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {mode ? 'Base / Upside / Downside / Severe' : 'Base only'}
              </button>
            ))}
          </div>

          <div
            style={{
              background: '#0f172a',
              border: '1px solid #1e3a5f',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
            }}
          >
            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
              {overlays.map((o) => (
                <div key={o.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: o.color }} />
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{o.label}</span>
                  <span style={{ fontSize: 12, color: o.color, fontWeight: 700 }}>
                    {o.result.blocked ? 'BLOCKED' : `${o.result.overall!.toFixed(1)}/5`}
                  </span>
                </div>
              ))}
            </div>

            <svg width="100%" viewBox="0 0 440 440" style={{ display: 'block', overflow: 'visible' }}>
              {/* Rings */}
              {[1, 2, 3, 4, 5].map((ring) => (
                <polygon
                  key={ring}
                  points={CLASS_MA_AXES.map((_, i) => pt(i, ring).join(',')).join(' ')}
                  fill="none"
                  stroke="#1e3a5f"
                  strokeWidth={ring === 5 ? 1.2 : 0.6}
                />
              ))}
              {[1, 2, 3, 4, 5].map((ring) => (
                <text key={ring} x={CX + 4} y={CY - (ring / 5) * R - 2} fontSize={8} fill="#475569">
                  {ring}
                </text>
              ))}
              {/* Spokes */}
              {CLASS_MA_AXES.map((_, i) => {
                const [x, y] = pt(i, 5);
                return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="#1e3a5f" strokeWidth={0.6} />;
              })}
              {/* Overlays — reversed so base renders on top */}
              {[...overlays].reverse().map((o) => (
                <polygon
                  key={o.label}
                  points={polyPts(o.result)}
                  fill={o.color + '22'}
                  stroke={o.color}
                  strokeWidth={o.label === 'Base Deal' ? 2 : 1.5}
                />
              ))}
              {/* Base vertex dots */}
              {base.axes.map((a, i) => {
                const [x, y] = pt(i, a.score);
                return <circle key={a.id} cx={x} cy={y} r={3.5} fill={SCENARIO_COLORS.base} />;
              })}
              {/* Axis labels */}
              {base.axes.map((a, i) => {
                const [lx, ly] = labelPt(i);
                const isWeak = weakest.some((w) => w.id === a.id);
                const color = a.provisional ? '#f59e0b' : isWeak ? '#f59e0b' : '#94a3b8';
                const lines = a.label.split('\n');
                return (
                  <g key={a.id}>
                    {lines.map((line, li) => (
                      <text
                        key={li}
                        x={lx}
                        y={ly + li * 11 - (lines.length - 1) * 5.5}
                        textAnchor="middle"
                        fontSize={9}
                        fill={color}
                        fontWeight={isWeak || a.provisional ? 700 : 400}
                      >
                        {line + (a.provisional && li === lines.length - 1 ? ' †' : '')}
                      </text>
                    ))}
                    <text
                      x={lx}
                      y={ly + lines.length * 11 - (lines.length - 1) * 5.5 + 1}
                      textAnchor="middle"
                      fontSize={8}
                      fill="#64748b"
                    >
                      {a.score.toFixed(1)}
                    </text>
                  </g>
                );
              })}
              {/* Centre */}
              {base.blocked ? (
                <text x={CX} y={CY + 5} textAnchor="middle" fontSize={16} fill="#ef4444" fontWeight={700}>
                  BLOCKED
                </text>
              ) : (
                <>
                  <text x={CX} y={CY + 4} textAnchor="middle" fontSize={22} fill={ragColor} fontWeight={700}>
                    {base.overall!.toFixed(1)}
                  </text>
                  <text x={CX} y={CY + 18} textAnchor="middle" fontSize={8} fill="#64748b">
                    /5 overall
                  </text>
                </>
              )}
            </svg>
          </div>

          {/* Weakest axes */}
          {!base.blocked && (
            <div
              style={{
                background: '#0f172a',
                border: '1px solid #1e3a5f',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 16,
              }}
            >
              <div style={{ color: '#f59e0b', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                ⚠ Weakest axes
              </div>
              {weakest.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 12, marginBottom: 6, alignItems: 'baseline' }}>
                  <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: 15, minWidth: 28 }}>
                    {a.score.toFixed(1)}
                  </span>
                  <span style={{ color: '#e2e8f0', fontSize: 13, minWidth: 90 }}>{a.short}</span>
                  <span style={{ color: '#64748b', fontSize: 12 }}>{a.help.split('.')[0]}.</span>
                </div>
              ))}
            </div>
          )}

          {/* Axis detail table */}
          <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px' }}>
              <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700 }}>AXIS DETAIL</span>
              <button
                onClick={() => setShowDetail((s) => !s)}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 12 }}
              >
                {showDetail ? '▲ hide' : '▼ show'}
              </button>
            </div>
            {showDetail && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
                      {['Axis', 'Raw', 'Range', 'Score /5', 'Weight', 'Contribution'].map((h) => (
                        <th key={h} style={{ padding: '6px 10px', color: '#64748b', textAlign: 'right', fontWeight: 600 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {base.axes.map((a) => {
                      const def = CLASS_MA_AXES.find((d) => d.id === a.id)!;
                      return (
                        <tr key={a.id} style={{ borderBottom: '1px solid #16233a' }} title={a.help}>
                          <td style={{ padding: '5px 10px', color: a.provisional ? '#f59e0b' : '#e2e8f0', textAlign: 'right' }}>
                            {a.short}
                            {a.provisional ? ' †' : ''}
                          </td>
                          <td style={{ padding: '5px 10px', color: '#94a3b8', textAlign: 'right' }}>
                            {a.raw.toFixed(1)} {a.unit}
                          </td>
                          <td style={{ padding: '5px 10px', color: '#475569', textAlign: 'right' }}>
                            {def.min}→{def.max} ({def.direction === 'higher' ? 'higher better' : 'lower better'})
                          </td>
                          <td
                            style={{
                              padding: '5px 10px',
                              textAlign: 'right',
                              fontWeight: 700,
                              color: a.score >= 3.5 ? '#22c55e' : a.score >= 2 ? '#f59e0b' : '#ef4444',
                            }}
                          >
                            {a.score.toFixed(1)}
                          </td>
                          <td style={{ padding: '5px 10px', color: '#94a3b8', textAlign: 'right' }}>{a.weight}</td>
                          <td style={{ padding: '5px 10px', color: '#94a3b8', textAlign: 'right' }}>
                            {a.weighted.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: score card + inputs + weights */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Overall score */}
          <div
            style={{
              background: '#0f172a',
              border: `2px solid ${ragColor}`,
              borderRadius: 8,
              padding: 16,
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#64748b', fontSize: 11, letterSpacing: 1, marginBottom: 6 }}>
              OVERALL DEAL SCORE
            </div>
            {base.blocked ? (
              <>
                <div style={{ fontSize: 32, color: '#ef4444', fontWeight: 700 }}>BLOCKED</div>
                <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 4 }}>{base.blockedBy.join('; ')}</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 44, color: ragColor, fontWeight: 700, lineHeight: 1 }}>
                  {base.overall!.toFixed(1)}
                  <span style={{ fontSize: 16, color: '#64748b' }}> /5</span>
                </div>
                <div style={{ fontSize: 12, color: ragColor, marginTop: 6, fontWeight: 700 }}>
                  {RAG_LABELS[base.rag]}
                </div>
              </>
            )}
          </div>

          {/* Provisional caveats */}
          {base.caveats.length > 0 && (
            <div
              style={{
                background: '#451a03',
                border: '1px solid #f59e0b',
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <div style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                † PROVISIONAL
              </div>
              {base.caveats.map((c, i) => (
                <div key={i} style={{ color: '#fbbf24', fontSize: 12, marginBottom: 4 }}>
                  {c}
                </div>
              ))}
            </div>
          )}

          {/* Spider inputs */}
          <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: 14 }}>
            <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700, marginBottom: 12 }}>
              SPIDER INPUTS
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <label style={labelStyle}>
                Storeys
                <input
                  type="number"
                  min={1}
                  value={spider.storeys}
                  onChange={(e) => setSpider({ storeys: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Building height (m)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={spider.building_height_m}
                  onChange={(e) => setSpider({ building_height_m: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
            </div>

            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={spider.bsa_higher_risk}
                onChange={(e) => setSpider({ bsa_higher_risk: e.target.checked })}
              />
              Higher-risk building (BSA / HRB)
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <label style={labelStyle}>
                Daylight pass %
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={spider.daylight_pass_pct}
                  onChange={(e) => setSpider({ daylight_pass_pct: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Absorption (months)
                <input
                  type="number"
                  min={1}
                  value={spider.absorption_months}
                  onChange={(e) => setSpider({ absorption_months: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
            </div>

            <div style={{ ...labelStyle, marginBottom: 6 }}>Viable exits</div>
            {(
              [
                ['exit_sell', 'Sell'],
                ['exit_refinance', 'Refinance'],
                ['exit_hold', 'Hold / let'],
                ['exit_part_sale', 'Part-sale, part-hold'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}
              >
                <input
                  type="checkbox"
                  checked={spider[key]}
                  onChange={(e) => setSpider({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0' }}>
              <label style={labelStyle}>
                PA window (months)
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={spider.prior_approval_window_months}
                  onChange={(e) => setSpider({ prior_approval_window_months: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Contingency (months)
                <input
                  type="number"
                  min={0}
                  value={spider.programme_contingency_months}
                  onChange={(e) => setSpider({ programme_contingency_months: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={labelStyle}>
                CIL offset (£)
                <input
                  type="number"
                  min={0}
                  value={spider.cil_offset_pence / 100}
                  onChange={(e) => setSpider({ cil_offset_pence: Math.round(Number(e.target.value) * 100) })}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Target profit on cost %
                <input
                  type="number"
                  min={1}
                  value={spider.target_profit_on_cost_pct}
                  onChange={(e) => setSpider({ target_profit_on_cost_pct: Number(e.target.value) })}
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ color: '#475569', fontSize: 11, marginTop: 8 }}>
              Max bid at target: {penceToPounds(Math.max(0, base.max_bid_pence))} · purchase price:{' '}
              {penceToPounds(inputs.acquisition.purchase_price_pence)}
            </div>
          </div>

          {/* Axis weights */}
          <div style={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700 }}>AXIS WEIGHTS</span>
              <button
                onClick={() =>
                  setSpider({ weights: Object.fromEntries(CLASS_MA_AXES.map((a) => [a.id, 1])) })
                }
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 11 }}
              >
                reset
              </button>
            </div>
            {CLASS_MA_AXES.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ color: '#64748b', fontSize: 11, width: 80, flexShrink: 0 }}>{a.short}</span>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.5}
                  value={spider.weights[a.id] ?? 1}
                  onChange={(e) =>
                    setSpider({ weights: { ...spider.weights, [a.id]: Number(e.target.value) } })
                  }
                  style={{ flex: 1, accentColor: '#2563eb' }}
                />
                <span style={{ color: '#94a3b8', fontSize: 11, width: 24, textAlign: 'right' }}>
                  {spider.weights[a.id] ?? 1}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
