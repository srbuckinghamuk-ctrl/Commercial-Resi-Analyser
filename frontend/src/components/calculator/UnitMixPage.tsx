import { useCallback } from 'react';
import type { ProposedUnit, UnitType } from '../../lib/conversion-types';
import type { CalculatorInputsV5, AppraisalRun } from '../../lib/model';
import { penceToPounds } from '../../lib/format';

interface Props {
  inputs: CalculatorInputsV5;
  onChange: (partial: Partial<CalculatorInputsV5>) => void;
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
    (newUnits: ProposedUnit[]) => {
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
      },
    ]);
  }, [units, updateUnits]);

  const removeUnit = useCallback(
    (id: string) => {
      updateUnits(units.filter((u) => u.id !== id));
    },
    [units, updateUnits],
  );

  const updateUnit = useCallback(
    (id: string, partial: Partial<ProposedUnit>) => {
      updateUnits(units.map((u) => (u.id === id ? { ...u, ...partial } : u)));
    },
    [units, updateUnits],
  );

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>2. Unit Mix & Schedule</h3>

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
        </div>
      ))}

      <button
        onClick={addUnit}
        style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 8 }}
      >
        + Add Unit
      </button>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Units: {units.length}</span>
          <span>Total floor area: {units.reduce((s, u) => s + u.floor_area_sqm, 0).toLocaleString()} m²</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>
          <span>Total GDV</span>
          <span>{penceToPounds(run.metrics.gdv_pence)}</span>
        </div>
      </div>
    </div>
  );
}
