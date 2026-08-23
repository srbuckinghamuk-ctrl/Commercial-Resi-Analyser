import { useCallback } from 'react';
import type {
  InvestmentCaseInputs, InvestmentCaseResult, BindingConstraint, Phase,
} from '../../lib/model';
import { penceToPoundsExact, formatPct } from '../../lib/format';
import ExitAnchorControl from './ExitAnchorControl';

/**
 * R13 spec §19.1/§19.3/§19.4/§19.6. Editor for the stabilisation, valuation
 * and take-out POLICY (`inputs`), paired with the read-only outcome that
 * policy produced the last time the engine ran (`result`).
 *
 * PURELY PRESENTATIONAL on the result side: the capitalised value, all THREE
 * candidate quanta, which one binds, and the achieved ratios are all read
 * off `result: InvestmentCaseResult` -- never `investmentValuePence`,
 * `sizeTakeout`, `stabilisedAnnualNoiPence` or any other engine function.
 * `inputs` is never used to derive a displayed figure, only to seed an
 * editable field.
 */
interface Props {
  inputs: InvestmentCaseInputs;
  result: InvestmentCaseResult;
  onChange: (next: InvestmentCaseInputs) => void;
  /** Phases to anchor the stabilisation month to (spec §18.6, reused from
   *  Task 14's `ExitAnchorControl`). Defaults to none, which disables the
   *  anchor control exactly as it does with no programme network. */
  phases?: Phase[];
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const AMBER = '#f59e0b';
const GREEN = '#22c55e';

const labelStyle: React.CSSProperties = { color: MUTED, fontSize: 13 };
const numberInputStyle: React.CSSProperties = {
  width: 90, padding: '6px 10px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 14,
};
const fieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 };
const summaryRowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', color: TEXT, marginBottom: 4 };
const thStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: 12, color: MUTED, textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
};
const tdStyle: React.CSSProperties = { padding: '4px 6px', fontSize: 13, color: TEXT };

const CAP_ROWS: { key: Exclude<BindingConstraint, null>; label: string }[] = [
  { key: 'ltv', label: 'LTV cap' },
  { key: 'dscr', label: 'DSCR cap' },
  { key: 'icr', label: 'ICR cap' },
];

export default function InvestmentCaseCard({
  inputs, result, onChange, phases = [],
}: Props) {
  const update = useCallback(
    (partial: Partial<InvestmentCaseInputs>) => onChange({ ...inputs, ...partial }),
    [inputs, onChange],
  );
  const updateStabilisation = (partial: Partial<InvestmentCaseInputs['stabilisation']>) => update({
    stabilisation: { ...inputs.stabilisation, ...partial },
  });
  const updateValuation = (partial: Partial<InvestmentCaseInputs['valuation']>) => update({
    valuation: { ...inputs.valuation, ...partial },
  });
  const updateTakeout = (partial: Partial<InvestmentCaseInputs['takeout']>) => update({
    takeout: { ...inputs.takeout, ...partial },
  });

  const caps: Record<Exclude<BindingConstraint, null>, number | null> = {
    ltv: result.takeout.ltv_cap_pence,
    dscr: result.takeout.dscr_cap_pence,
    icr: result.takeout.icr_cap_pence,
  };

  return (
    <div style={{ padding: 16, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 24 }}>
      <h4 style={{ color: MUTED, fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Investment Case
      </h4>

      <div style={rowStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Stabilisation month</label>
          <input
            type="number"
            min={0}
            value={inputs.stabilisation.month_offset}
            onChange={(e) => updateStabilisation({ month_offset: Math.max(0, Math.round(Number(e.target.value))) })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Ramp (months)</label>
          <input
            type="number"
            min={0}
            value={inputs.stabilisation.ramp_months}
            onChange={(e) => updateStabilisation({ ramp_months: Math.max(0, Math.round(Number(e.target.value))) })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Stabilised occupancy (%)</label>
          <input
            type="number"
            step="0.1"
            value={inputs.stabilisation.stabilised_occupancy_pct}
            onChange={(e) => updateStabilisation({ stabilised_occupancy_pct: Number(e.target.value) })}
            style={numberInputStyle}
          />
        </div>
        <ExitAnchorControl
          value={inputs.stabilisation.anchor}
          phases={phases}
          monthOffset={inputs.stabilisation.month_offset}
          onChange={(anchor) => updateStabilisation({ anchor })}
        />
      </div>

      <div style={rowStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Cap yield (%)</label>
          <input
            type="number"
            step="0.01"
            value={inputs.valuation.cap_yield_pct}
            onChange={(e) => updateValuation({ cap_yield_pct: Number(e.target.value) })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Purchaser&apos;s costs (%)</label>
          <input
            type="number"
            step="0.01"
            value={inputs.valuation.purchasers_costs_pct}
            onChange={(e) => updateValuation({ purchasers_costs_pct: Number(e.target.value) })}
            style={numberInputStyle}
          />
        </div>
      </div>

      <div style={rowStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Max LTV (%)</label>
          <input
            type="number"
            step="0.1"
            value={inputs.takeout.ltv_cap_pct}
            onChange={(e) => updateTakeout({ ltv_cap_pct: Number(e.target.value) })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>DSCR floor</label>
          <input
            type="number"
            step="0.01"
            value={inputs.takeout.dscr_floor}
            onChange={(e) => updateTakeout({ dscr_floor: Number(e.target.value) })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>ICR floor</label>
          <input
            type="number"
            step="0.01"
            value={inputs.takeout.icr_floor}
            onChange={(e) => updateTakeout({ icr_floor: Number(e.target.value) })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Rate (%)</label>
          <input
            type="number"
            step="0.01"
            value={inputs.takeout.annual_rate_pct}
            onChange={(e) => updateTakeout({ annual_rate_pct: Number(e.target.value) })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Amortisation (years)</label>
          <input
            type="number"
            min={0}
            aria-label="Amortisation (years)"
            placeholder="Interest-only"
            value={inputs.takeout.amortisation_years ?? ''}
            onChange={(e) => updateTakeout({
              amortisation_years: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
            })}
            style={numberInputStyle}
          />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Term (years)</label>
          <input
            type="number"
            min={1}
            value={inputs.takeout.term_years}
            onChange={(e) => updateTakeout({ term_years: Math.max(1, Math.round(Number(e.target.value))) })}
            style={numberInputStyle}
          />
        </div>
      </div>

      <div style={summaryRowStyle}>
        <span>Gross value</span><span>{penceToPoundsExact(result.valuation.gross_value_pence)}</span>
      </div>
      <div style={{ ...summaryRowStyle, fontWeight: 600, marginBottom: 12 }}>
        <span>Investment value</span><span>{penceToPoundsExact(result.valuation.investment_value_pence)}</span>
      </div>

      {!result.takeout.is_booked && (
        <div style={{ color: AMBER, fontSize: 13, marginBottom: 8 }}>
          Indicative — no refinance is booked against this case.
        </div>
      )}

      <table aria-label="Take-out sizing" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Constraint', 'Cap', 'Binds'].map((h) => <th key={h} style={thStyle}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {CAP_ROWS.map(({ key, label }) => {
            const cap = caps[key];
            const binds = result.takeout.binding_constraint === key;
            return (
              <tr key={key} data-binding={binds}>
                <td style={tdStyle}>{label}</td>
                <td style={tdStyle}>{cap == null ? '—' : penceToPoundsExact(cap)}</td>
                <td style={{ ...tdStyle, color: binds ? GREEN : MUTED }}>{binds ? 'Binds' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ ...summaryRowStyle, marginTop: 12, fontWeight: 600 }}>
        <span>Take-out quantum</span><span>{penceToPoundsExact(result.takeout.quantum_pence)}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, color: MUTED, fontSize: 13, marginTop: 4 }}>
        <span>Achieved LTV: {formatPct(result.takeout.achieved_ltv_pct)}</span>
        <span>Achieved DSCR: {result.takeout.achieved_dscr == null ? '—' : result.takeout.achieved_dscr.toFixed(2)}</span>
        <span>Achieved ICR: {result.takeout.achieved_icr == null ? '—' : result.takeout.achieved_icr.toFixed(2)}</span>
      </div>
    </div>
  );
}
