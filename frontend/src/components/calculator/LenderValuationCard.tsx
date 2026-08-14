import type { LenderAdjustmentBasis, LenderValuation, ValidationIssue } from '../../lib/model';
import type { ProposedUnit, UnitType } from '../../lib/conversion-types';

interface Props {
  lenderValuation: LenderValuation | null;
  units: ProposedUnit[];
  /** The live run's full validation list — filtered here to `lender_valuation*`
   * fields. Reusing `validateInputs()`'s own output (rather than re-implementing
   * the rules client-side) is what "mirrors the model rules": the same function
   * the server calls, so there is no second, driftable copy of the logic. */
  validationIssues: ValidationIssue[];
  onChange: (lenderValuation: LenderValuation | null) => void;
}

const BASIS_OPTIONS: { value: LenderAdjustmentBasis; label: string }[] = [
  { value: 'global_pct', label: 'Global % adjustment' },
  { value: 'global_per_sqft', label: 'Global £ per sq ft' },
  { value: 'unit_type', label: 'By unit type (% adjustment)' },
  { value: 'per_unit', label: 'Per unit (absolute value)' },
  { value: 'fixed_amount', label: 'Fixed total lender GDV' },
];

const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  studio: 'Studio', '1bed': '1-Bed', '2bed': '2-Bed', '3bed': '3-Bed',
};

function emptyLenderValuation(): LenderValuation {
  return { basis: 'global_pct', global_value: null, per_key_values: null, reason: '', author: '', date: '' };
}

/** Sets or removes a key in a per-unit/per-type adjustment map. `null` removes the key
 * (never stores it as a literal null) so a blank field reads as "not yet entered" —
 * the same "missing value for this id" the model reports, not a bad numeric value. */
function withKeyValue(map: Record<string, number> | null, key: string, value: number | null): Record<string, number> {
  const next = { ...(map ?? {}) };
  if (value == null) delete next[key];
  else next[key] = value;
  return next;
}

const rowLabel: React.CSSProperties = { color: '#94a3b8', width: 200, fontSize: 13, flexShrink: 0 };
const textInput: React.CSSProperties = {
  padding: '6px 10px', background: '#0a1120', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 13, width: 220,
};
const selectStyle: React.CSSProperties = { ...textInput, width: 260 };

function PoundsInput({ value, onChange, placeholder }: {
  value: number | null; onChange: (pence: number | null) => void; placeholder?: string;
}) {
  return (
    <div style={{ position: 'relative', width: 200 }}>
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>£</span>
      <input
        type="number"
        value={value != null ? value / 100 : ''}
        placeholder={placeholder ?? 'unset'}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? null : Math.round(Number(raw) * 100));
        }}
        style={{ ...textInput, width: '100%', padding: '6px 10px 6px 24px' }}
      />
    </div>
  );
}

export default function LenderValuationCard({ lenderValuation, units, validationIssues, onChange }: Props) {
  const lenderIssues = validationIssues.filter((v) => v.field.startsWith('lender_valuation'));

  if (lenderValuation == null) {
    return (
      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px dashed #1e3a5f', marginBottom: 20 }}>
        <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Lender valuation</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
          No lender valuation recorded — lender-basis metrics (lender GDV, LTGDV lender, senior
          break-even % of lender GDV) are unavailable until one is added.
        </div>
        <button
          onClick={() => onChange(emptyLenderValuation())}
          style={{ padding: '8px 18px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
        >
          + Add lender valuation
        </button>
      </div>
    );
  }

  const lv = lenderValuation;
  const update = (partial: Partial<LenderValuation>) => onChange({ ...lv, ...partial });
  const distinctTypes = Array.from(new Set(units.map((u) => u.type)));

  return (
    <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 14 }}>Lender valuation</span>
        <button
          onClick={() => onChange(null)}
          style={{ background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
        >
          Remove
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={rowLabel}>Basis</label>
        <select
          value={lv.basis}
          onChange={(e) => update({ basis: e.target.value as LenderAdjustmentBasis, global_value: null, per_key_values: null })}
          style={selectStyle}
        >
          {BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {lv.basis === 'global_pct' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <label style={rowLabel}>Adjustment (%, e.g. -10 for a 10% haircut)</label>
          <input
            type="number"
            step="0.1"
            value={lv.global_value ?? ''}
            placeholder="unset"
            onChange={(e) => update({ global_value: e.target.value === '' ? null : Number(e.target.value) })}
            style={textInput}
          />
        </div>
      )}

      {lv.basis === 'global_per_sqft' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <label style={rowLabel}>Value per sq ft (£)</label>
          <PoundsInput value={lv.global_value} onChange={(pence) => update({ global_value: pence })} />
        </div>
      )}

      {lv.basis === 'fixed_amount' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <label style={rowLabel}>Total lender GDV (£)</label>
          <PoundsInput value={lv.global_value} onChange={(pence) => update({ global_value: pence })} />
        </div>
      )}

      {lv.basis === 'unit_type' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>% adjustment by unit type</div>
          {distinctTypes.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12 }}>No units defined yet — add units on the Unit Mix page.</div>
          ) : distinctTypes.map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <label style={rowLabel}>{UNIT_TYPE_LABELS[t]}</label>
              <input
                type="number"
                step="0.1"
                value={lv.per_key_values?.[t] ?? ''}
                placeholder="unset — developer value used"
                onChange={(e) => {
                  const raw = e.target.value;
                  update({ per_key_values: withKeyValue(lv.per_key_values, t, raw === '' ? null : Number(raw)) });
                }}
                style={textInput}
              />
            </div>
          ))}
        </div>
      )}

      {lv.basis === 'per_unit' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Lender value per unit (£)</div>
          {units.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12 }}>No units defined yet — add units on the Unit Mix page.</div>
          ) : units.map((u, i) => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <label style={rowLabel}>Unit {i + 1} ({UNIT_TYPE_LABELS[u.type]})</label>
              <PoundsInput
                value={lv.per_key_values?.[u.id] ?? null}
                onChange={(pence) => update({ per_key_values: withKeyValue(lv.per_key_values, u.id, pence) })}
              />
            </div>
          ))}
        </div>
      )}

      <h4 style={{ color: '#94a3b8', fontSize: 12, marginTop: 16, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        Provenance (required)
      </h4>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <label style={rowLabel}>Reason</label>
        <input
          type="text"
          value={lv.reason}
          onChange={(e) => update({ reason: e.target.value })}
          placeholder="e.g. Independent RICS valuation"
          style={{ ...textInput, width: 340 }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <label style={rowLabel}>Author</label>
        <input
          type="text"
          value={lv.author}
          onChange={(e) => update({ author: e.target.value })}
          placeholder="e.g. J. Smith, ABC Surveyors"
          style={textInput}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <label style={rowLabel}>Date</label>
        <input
          type="date"
          value={lv.date}
          onChange={(e) => update({ date: e.target.value })}
          style={textInput}
        />
      </div>

      {lenderIssues.length > 0 && (
        <div style={{ padding: '10px 14px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: 6 }}>
          {lenderIssues.map((issue, i) => (
            <div key={`${issue.field}-${i}`} style={{ color: '#fca5a5', fontSize: 12, marginBottom: i < lenderIssues.length - 1 ? 4 : 0 }}>
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
