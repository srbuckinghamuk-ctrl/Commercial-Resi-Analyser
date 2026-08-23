import type { Phase, PhaseAnchor } from '../../lib/model';

/**
 * R13 Task 14, closing spec §18.10 limitation 9. R12 shipped an engine that
 * resolves an anchored tranche/refinance correctly, but no screen ever wrote
 * a non-null `anchor` -- this is that missing control.
 *
 * PURELY PRESENTATIONAL: it reads `phases` and emits a `PhaseAnchor | null`.
 * It performs NO month resolution -- no arithmetic on `offset_months`, no
 * call to `derivePhases`. The month the ledger will actually use comes from
 * `schedule.resolved_exit_months` (Task 8) and is the caller's job to read
 * and display; this component never computes it.
 *
 * An anchor needs a programme network to anchor to (spec §19.7 rule 6: an
 * anchor without one is a validation error), so with no phases the control
 * disables itself and explains why, rather than offering a choice that would
 * fail validation the moment it is made.
 */
interface Props {
  value: PhaseAnchor | null;
  phases: Phase[];
  monthOffset: number;
  onChange: (anchor: PhaseAnchor | null) => void;
}

const FIXED = '__fixed__';

const MUTED = '#94a3b8';
const PANEL = '#0f172a';
const BORDER = '#1e3a5f';
const TEXT = '#e2e8f0';

const selectStyle: React.CSSProperties = {
  padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13,
};
const numberInputStyle: React.CSSProperties = {
  width: 64, padding: '4px 6px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13,
};
const hintStyle: React.CSSProperties = { color: MUTED, fontSize: 12 };

export default function ExitAnchorControl({
  value, phases, monthOffset, onChange,
}: Props) {
  const hasProgramme = phases.length > 0;
  const selected = value?.phase_id ?? FIXED;

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value;
    if (nextId === FIXED) {
      onChange(null);
      return;
    }
    onChange({ phase_id: nextId, offset_months: 0 });
  };

  const handleOffset = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!value) return;
    const n = Number(e.target.value);
    onChange({ ...value, offset_months: Number.isFinite(n) ? Math.round(n) : 0 });
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select
        aria-label="Exit anchor"
        value={selected}
        disabled={!hasProgramme}
        onChange={handleSelect}
        style={selectStyle}
      >
        <option value={FIXED}>Fixed month</option>
        {phases.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      {!hasProgramme && (
        <span style={hintStyle}>needs a programme network to anchor to</span>
      )}

      {hasProgramme && !value && (
        <span style={hintStyle}>uses month {monthOffset} directly</span>
      )}

      {hasProgramme && value && (
        <>
          <span style={hintStyle}>months after</span>
          <input
            type="number"
            aria-label="Months after phase start"
            value={value.offset_months}
            onChange={handleOffset}
            style={numberInputStyle}
          />
        </>
      )}
    </div>
  );
}
