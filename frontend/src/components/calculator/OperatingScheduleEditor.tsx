import type { OperatingLine, OpexCode, InvestmentCaseResult } from '../../lib/model';
import { OPEX_CODES } from '../../lib/model';
import { penceToPoundsExact } from '../../lib/format';

/**
 * R13 spec §19.1/§19.6. The operating cost schedule: add, remove and edit
 * every line's code/label/basis/value. NO calculation here -- each line's
 * stabilised monthly cost is read off `result.operating_lines`, matched by
 * id, never derived locally from `basis`/`value`. `result` is the engine's
 * own republished `InvestmentCaseResult` (`Schedule.investment_case`), the
 * same discipline `PhaseEditor` keeps against `derivePhases`: this component
 * never calls `operatingCostAt` or any other engine function.
 */
interface Props {
  lines: OperatingLine[];
  result: InvestmentCaseResult;
  onChange: (lines: OperatingLine[]) => void;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED_BG = '#7f1d1d';
const RED_TEXT = '#fca5a5';
const ACCENT = '#1e3a5f';

const BASIS_OPTIONS: OperatingLine['basis'][] = ['fixed_pence_per_month', 'pct_of_gross_rent'];
const BASIS_LABELS: Record<OperatingLine['basis'], string> = {
  fixed_pence_per_month: 'Fixed £/month',
  pct_of_gross_rent: '% of gross rent',
};

/** All ten `OpexCode` values, in `OPEX_CODES`' fixed order (spec §19.1). */
const OPEX_LABELS: Record<OpexCode, string> = {
  management: 'Management',
  letting_and_re_letting: 'Letting and re-letting',
  insurance: 'Insurance',
  repairs_and_maintenance: 'Repairs and maintenance',
  service_charge_shortfall: 'Service charge shortfall',
  ground_rent: 'Ground rent',
  utilities_on_voids: 'Utilities on voids',
  compliance_and_safety: 'Compliance and safety',
  bad_debt: 'Bad debt',
  other: 'Other',
};

const cellStyle: React.CSSProperties = { padding: '4px 6px', fontSize: 13, verticalAlign: 'top' };
const thStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: 12, color: MUTED, textAlign: 'left', borderBottom: `1px solid ${BORDER}`,
};
const numberInputStyle: React.CSSProperties = {
  width: 90, padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13,
};
const textInputStyle: React.CSSProperties = {
  width: 160, padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
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

function newLine(): OperatingLine {
  return {
    id: crypto.randomUUID(), code: 'other', label: '', basis: 'pct_of_gross_rent', value: 0,
  };
}

export default function OperatingScheduleEditor({ lines, result, onChange }: Props) {
  const update = (id: string, partial: Partial<OperatingLine>) => {
    onChange(lines.map((l) => (l.id === id ? { ...l, ...partial } : l)));
  };
  const add = () => onChange([...lines, newLine()]);
  const remove = (id: string) => onChange(lines.filter((l) => l.id !== id));

  const stabilisedById = new Map(result.operating_lines.map((l) => [l.id, l.stabilised_monthly_pence]));

  return (
    <div style={{ overflowX: 'auto' }}>
      <table aria-label="Operating costs" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr>
            {['Code', 'Label', 'Basis', 'Value', 'Stabilised monthly', ''].map((h) => (
              <th key={h || 'actions'} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} style={{ borderBottom: `1px solid ${PANEL}` }}>
              <td style={cellStyle}>
                <select
                  aria-label={`${line.label || line.id} code`}
                  value={line.code}
                  onChange={(e) => update(line.id, { code: e.target.value as OpexCode })}
                  style={selectStyle}
                >
                  {OPEX_CODES.map((c) => <option key={c} value={c}>{OPEX_LABELS[c]}</option>)}
                </select>
              </td>
              <td style={cellStyle}>
                <input
                  type="text"
                  aria-label={`${line.label || line.id} label`}
                  value={line.label}
                  onChange={(e) => update(line.id, { label: e.target.value })}
                  style={textInputStyle}
                />
              </td>
              <td style={cellStyle}>
                <select
                  aria-label={`${line.label || line.id} basis`}
                  value={line.basis}
                  onChange={(e) => update(line.id, { basis: e.target.value as OperatingLine['basis'], value: 0 })}
                  style={selectStyle}
                >
                  {BASIS_OPTIONS.map((b) => <option key={b} value={b}>{BASIS_LABELS[b]}</option>)}
                </select>
              </td>
              <td style={cellStyle}>
                {line.basis === 'fixed_pence_per_month' ? (
                  <div style={{ position: 'relative', width: 100, display: 'inline-block' }}>
                    <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>£</span>
                    <input
                      type="number"
                      aria-label={`${line.label || line.id} value`}
                      value={line.value ? line.value / 100 : ''}
                      onChange={(e) => update(line.id, { value: Math.round(Number(e.target.value) * 100) })}
                      style={{ ...numberInputStyle, width: '100%', paddingLeft: 20 }}
                    />
                  </div>
                ) : (
                  <div style={{ position: 'relative', width: 80, display: 'inline-block' }}>
                    <input
                      type="number"
                      aria-label={`${line.label || line.id} value`}
                      value={line.value}
                      onChange={(e) => update(line.id, { value: Number(e.target.value) })}
                      style={{ ...numberInputStyle, width: '100%' }}
                    />
                    <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>%</span>
                  </div>
                )}
              </td>
              <td style={{ ...cellStyle, color: TEXT }} data-testid={`line-${line.id}-stabilised`}>
                {penceToPoundsExact(stabilisedById.get(line.id) ?? 0)}
              </td>
              <td style={cellStyle}>
                <button
                  type="button"
                  aria-label={`Remove ${line.label || line.id}`}
                  onClick={() => remove(line.id)}
                  style={{ ...smallButtonStyle, background: RED_BG, color: RED_TEXT }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={add}
        style={{ padding: '8px 20px', background: '#1e3a5f', color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
      >
        + Add operating cost
      </button>
    </div>
  );
}
