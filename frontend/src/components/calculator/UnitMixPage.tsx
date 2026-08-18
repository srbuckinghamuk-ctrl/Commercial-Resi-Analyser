import { useCallback } from 'react';
import type { ProposedUnitV6, UnitType } from '../../lib/conversion-types';
import { DEFAULT_UNIT_ANCILLARY } from '../../lib/conversion-types';
import type { CalculatorInputsV6, AppraisalRun } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV6;
  onChange: (partial: Partial<CalculatorInputsV6>) => void;
  run: AppraisalRun;
}

const UNIT_TYPES: { value: UnitType; label: string }[] = [
  { value: 'studio', label: 'Studio' },
  { value: '1bed', label: '1 Bed' },
  { value: '2bed', label: '2 Bed' },
  { value: '3bed', label: '3 Bed' },
];

export default function UnitMixPage({ inputs, onChange, run }: Props) {
  const units = inputs.unit_mix.units;

  const updateUnits = useCallback(
    (newUnits: ProposedUnitV6[]) => {
      onChange({ unit_mix: { units: newUnits } });
    },
    [onChange],
  );

  const addUnit = useCallback(() => {
    updateUnits([
      ...units,
      {
        id: crypto.randomUUID(),
        type: '1bed',
        floor_area_sqm: 46,
        estimated_value_pence: 25_000_000,
        comparable_notes: '',
        // R9: a new unit starts with a zeroed ancillary block, exactly as
        // migration writes on every existing one. The controls that let a user
        // fill it in are Task 10's — this page does not render them yet.
        ancillary: { ...DEFAULT_UNIT_ANCILLARY },
      },
    ]);
  }, [units, updateUnits]);

  const removeUnit = useCallback(
    (id: string) => {
      updateUnits(units.filter((u) => u.id !== id));
    },
    [units, updateUnits],
  );

  // R9 Task 10: widened from Partial<ProposedUnit> so `ancillary` (a v6-only
  // field) is a legal partial update — the type this page's own units are.
  const updateUnit = useCallback(
    (id: string, partial: Partial<ProposedUnitV6>) => {
      updateUnits(units.map((u) => (u.id === id ? { ...u, ...partial } : u)));
    },
    [units, updateUnits],
  );

  const updateAncillary = useCallback(
    (unit: ProposedUnitV6, partial: Partial<ProposedUnitV6['ancillary']>) => {
      updateUnit(unit.id, { ancillary: { ...unit.ancillary, ...partial } });
    },
    [updateUnit],
  );

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>3. Unit Mix & Schedule</h3>

      {units.map((unit, i) => (
        <div
          key={unit.id}
          style={{
            padding: 16,
            marginBottom: 12,
            background: '#0f172a',
            borderRadius: 8,
            border: '1px solid #1e3a5f',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Unit {i + 1}</span>
            <button
              onClick={() => removeUnit(unit.id)}
              style={{ background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}
            >
              Remove
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Type</label>
              <select
                value={unit.type}
                onChange={(e) => updateUnit(unit.id, { type: e.target.value as UnitType })}
                style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              >
                {UNIT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Floor area (m²)</label>
              <input
                type="number"
                value={unit.floor_area_sqm}
                onChange={(e) => updateUnit(unit.id, { floor_area_sqm: Number(e.target.value) })}
                style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              />
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Est. value (£)</label>
              <div style={{ position: 'relative', display: 'inline-block', width: 160 }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                <input
                  type="number"
                  value={unit.estimated_value_pence ? unit.estimated_value_pence / 100 : ''}
                  onChange={(e) => updateUnit(unit.id, { estimated_value_pence: Math.round(Number(e.target.value) * 100) })}
                  style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Comparable notes</label>
              <input
                type="text"
                value={unit.comparable_notes}
                onChange={(e) => updateUnit(unit.id, { comparable_notes: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              />
            </div>
          </div>

          {/* R9 Task 10 (spec §15.5). Visually separated from the internal area
              field above by a left border and its own sub-heading, deliberately:
              a balcony or terrace area typed into `floor_area_sqm` corrupts NIA,
              the NDSS space-standards check and every efficiency at once
              (space-standards.ts's own test pins that a 45 m² 1-bed with a
              10 m² balcony must still fail — ancillary must never leak into
              that check). These four fields never touch `floor_area_sqm`. */}
          <div style={{ marginTop: 16, paddingLeft: 16, borderLeft: '2px solid #1e3a5f' }}>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Ancillary (outside NIA)
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Balcony/terrace (m²)</label>
                <input
                  type="number"
                  value={unit.ancillary.balcony_terrace_sqm}
                  onChange={(e) => updateAncillary(unit, { balcony_terrace_sqm: Number(e.target.value) })}
                  style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Balcony/terrace value (£)</label>
                <div style={{ position: 'relative', display: 'inline-block', width: 160 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                  <input
                    type="number"
                    value={unit.ancillary.balcony_terrace_value_pence ? unit.ancillary.balcony_terrace_value_pence / 100 : ''}
                    onChange={(e) => updateAncillary(unit, { balcony_terrace_value_pence: Math.round(Number(e.target.value) * 100) })}
                    style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </div>
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Parking spaces</label>
                <input
                  type="number"
                  value={unit.ancillary.parking_spaces}
                  onChange={(e) => updateAncillary(unit, { parking_spaces: Number(e.target.value) })}
                  style={{ width: 100, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Parking value (£)</label>
                <div style={{ position: 'relative', display: 'inline-block', width: 160 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 14 }}>£</span>
                  <input
                    type="number"
                    value={unit.ancillary.parking_value_pence ? unit.ancillary.parking_value_pence / 100 : ''}
                    onChange={(e) => updateAncillary(unit, { parking_value_pence: Math.round(Number(e.target.value) * 100) })}
                    style={{ width: '100%', padding: '6px 10px 6px 24px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={addUnit}
        style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 8 }}
      >
        + Add Unit
      </button>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        {/* Fix round 1. This used to sum `floor_area_sqm`/`ancillary.*` across
            `units` in JSX — a second, local computation of the exact figures
            the area bridge already derives once (spec §15.4). Read from
            `run.metrics.area_bridge` instead: `unit_nia_sqm` IS
            `unitNiaSqm(units)` (areas.ts), and the two ancillary totals are
            summed there too, so this footer cannot drift from the Areas page
            or the reconciliation table. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Units: {units.length}</span>
          <span>Total NIA: {run.metrics.area_bridge.unit_nia_sqm.toLocaleString()} m²</span>
          <span style={{ color: '#64748b' }}>
            Ancillary: {run.metrics.area_bridge.ancillary_balcony_terrace_sqm.toLocaleString()} m²
            balcony/terrace · {run.metrics.area_bridge.ancillary_parking_spaces} parking
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>
          <span>Total GDV</span>
          <span>{penceToPounds(run.metrics.gdv_pence)}</span>
        </div>
      </div>
    </div>
  );
}
