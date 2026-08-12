import { useCallback } from 'react';
import type { CalculatorInputs, AppraisalMetrics, ProposedUnit, UnitType } from '../../lib/conversion-types';
import { penceToPounds } from '../../lib/format';
import { newId } from '../../lib/conversion-defaults';
import { checkSpaceStandards, suggestUnitMix, NDSS_MINIMUM_SQM } from '../../lib/space-standards';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

const UNIT_TYPES: { value: UnitType; label: string }[] = [
  { value: 'studio', label: 'Studio' },
  { value: '1bed', label: '1 Bed' },
  { value: '2bed', label: '2 Bed' },
  { value: '3bed', label: '3 Bed' },
];

const SQM_TO_SQFT = 10.7639;

function perSqft(unit: ProposedUnit): string {
  if (unit.floor_area_sqm <= 0 || unit.estimated_value_pence <= 0) return '';
  const sqft = unit.floor_area_sqm * SQM_TO_SQFT;
  return `£${Math.round(unit.estimated_value_pence / 100 / sqft).toLocaleString()}/sq ft`;
}

export default function UnitMixPage({ inputs, onChange, metrics }: Props) {
  const units = inputs.unit_mix.units;
  const gia = inputs.conversion_costs.total_construction_sqm;
  const spaceIssues = checkSpaceStandards(units);
  const issueByUnit = new Map(spaceIssues.map((i) => [i.unitId, i.message]));

  const totalUnitArea = units.reduce((s, u) => s + u.floor_area_sqm, 0);
  const areaOverrun = gia > 0 && totalUnitArea > gia;

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
        id: newId(),
        type: '1bed',
        floor_area_sqm: NDSS_MINIMUM_SQM['1bed'],
        estimated_value_pence: 0,
        comparable_notes: '',
      },
    ]);
  }, [units, updateUnits]);

  const generateFromArea = useCallback(() => {
    const suggested = suggestUnitMix(gia);
    if (suggested.length === 0) return;
    updateUnits(
      suggested.map((s) => ({
        id: newId(),
        type: s.type,
        floor_area_sqm: s.floor_area_sqm,
        estimated_value_pence: 0,
        comparable_notes: '',
      })),
    );
  }, [gia, updateUnits]);

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

      {units.length === 0 && (
        <div style={{ padding: 20, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', marginBottom: 16 }}>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 12px' }}>
            No units yet — the appraisal shows £0 GDV until you add the proposed units.
            {gia > 0 && ' You can start from a suggested NDSS-compliant mix based on the building’s floor area.'}
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {gia > 0 && (
              <button
                onClick={generateFromArea}
                style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Suggest units from {gia.toLocaleString()} m²
              </button>
            )}
            <button
              onClick={addUnit}
              style={{ padding: '8px 16px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              + Add a unit manually
            </button>
          </div>
        </div>
      )}

      {units.map((unit, i) => {
        const issue = issueByUnit.get(unit.id);
        return (
          <div
            key={unit.id}
            style={{
              padding: 16,
              marginBottom: 12,
              background: '#0f172a',
              borderRadius: 8,
              border: `1px solid ${issue ? '#854d0e' : '#1e3a5f'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                Unit {i + 1}
                {perSqft(unit) && (
                  <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 13, marginLeft: 10 }}>{perSqft(unit)}</span>
                )}
              </span>
              <button
                onClick={() => removeUnit(unit.id)}
                aria-label={`Remove unit ${i + 1}`}
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
                  min={0}
                  value={unit.floor_area_sqm}
                  onChange={(e) => updateUnit(unit.id, { floor_area_sqm: Number(e.target.value) })}
                  style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
              </div>
              <div>
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Est. value (£)</label>
                <div style={{ position: 'relative', display: 'inline-block', width: 160 }}>
                  <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 14 }}>£</span>
                  <input
                    type="number"
                    min={0}
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
            {issue && (
              <p role="alert" style={{ color: '#fbbf24', fontSize: 12, margin: '10px 0 0' }}>⚠ {issue}</p>
            )}
          </div>
        );
      })}

      {units.length > 0 && (
        <button
          onClick={addUnit}
          style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 8 }}
        >
          + Add Unit
        </button>
      )}

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Units: {units.length}</span>
          <span>
            Total unit area (NIA): {totalUnitArea.toLocaleString()} m²
            {gia > 0 && ` of ${gia.toLocaleString()} m² GIA`}
          </span>
        </div>
        {areaOverrun && (
          <p role="alert" style={{ color: '#fbbf24', fontSize: 12, margin: '0 0 8px' }}>
            ⚠ The units total more than the building's gross internal area — check the areas.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>
          <span>Total GDV</span>
          <span>{penceToPounds(metrics.total_gdv_pence)}</span>
        </div>
      </div>
    </div>
  );
}
