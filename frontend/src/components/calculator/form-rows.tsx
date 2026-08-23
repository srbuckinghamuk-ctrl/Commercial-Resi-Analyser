/**
 * R14 Task 10. `PenceRow` and `NumRow` extracted from `FinancePage.tsx`
 * (where they were local, unexported helpers) so `MonitoringEditor` can
 * reuse the same "£-prefixed pence input" and "plain number input" widgets
 * rather than re-implementing the blank-vs-zero handling a second time.
 * `FinancePage` now imports these instead of defining its own copies.
 */
const ROW_LABEL_STYLE: React.CSSProperties = { color: '#94a3b8', width: 240, fontSize: 13 };
const NUM_INPUT_STYLE: React.CSSProperties = {
  width: 160, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f',
  borderRadius: 4, color: '#e2e8f0', fontSize: 13,
};

/** The bare £-prefixed pence input, with no label — the part `PenceRow` wraps
 *  and the part a table cell (no room for a 240px label) needs on its own. */
export function PenceInput({ penceValue, onChangePence, nullable, placeholder, ariaLabel, style }: {
  penceValue: number | null;
  onChangePence: (v: number | null) => void;
  nullable?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: 'relative', width: 200, ...style }}>
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13 }}>£</span>
      <input
        type="number"
        aria-label={ariaLabel}
        value={penceValue === 0 ? 0 : penceValue != null ? penceValue / 100 : ''}
        placeholder={placeholder ?? (nullable ? 'unset' : undefined)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') { onChangePence(nullable ? null : 0); return; }
          onChangePence(Math.round(Number(raw) * 100));
        }}
        style={{ ...NUM_INPUT_STYLE, width: '100%', padding: '6px 10px 6px 24px' }}
      />
    </div>
  );
}

/** Blank ⇔ null, explicit 0 ⇔ 0 — never conflate "unknown" with "known to be zero" (spec §1.5). */
export function PenceRow({ label, penceValue, onChangePence, nullable, placeholder }: {
  label: string;
  penceValue: number | null;
  onChangePence: (v: number | null) => void;
  nullable?: boolean;
  placeholder?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={ROW_LABEL_STYLE}>{label}</label>
      <PenceInput
        penceValue={penceValue}
        onChangePence={onChangePence}
        nullable={nullable}
        placeholder={placeholder}
        ariaLabel={label}
      />
    </div>
  );
}

export function NumRow({ label, value, onChangeValue, suffix, step, min, max }: {
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
  suffix?: string;
  step?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={ROW_LABEL_STYLE}>{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={NUM_INPUT_STYLE}
      />
      {suffix && <span style={{ color: '#64748b', fontSize: 12 }}>{suffix}</span>}
    </div>
  );
}
