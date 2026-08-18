import type { CalculatorInputsV6, AppraisalRun } from '../../lib/model';
import type { AreaBridgeInputs } from '../../lib/model';

interface Props {
  inputs: CalculatorInputsV6;
  onChange: (partial: Partial<CalculatorInputsV6>) => void;
  run: AppraisalRun;
}

const RED_TEXT = '#f87171';
const RED_BG = 'rgba(239, 68, 68, 0.12)';
const RED = '#ef4444';
const AMBER_TEXT = '#fbbf24';
const AMBER_BG = 'rgba(245, 158, 11, 0.12)';
const AMBER = '#f59e0b';

/** Same row shape as `ConversionCostsPage`'s `CostRow` — 260px label column,
 * `#0f172a` field background, `#1e3a5f` border. Renamed per the brief: every
 * field here is an entered line of `AreaBridgeInputs`, never a derived one. */
function AreaRow({ id, label, value, onChangeValue }: {
  id: string;
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <label htmlFor={id} style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>{label}</label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={{ width: 140, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
      />
    </div>
  );
}

/** One line of the reconciliation table (spec §15.1 order). `value` already
 * carries the correct sign — "less X" lines are passed in negative, and
 * `Unallocated` is passed in exactly as the run computed it, so a negative
 * balance prints with its minus sign rather than being suppressed. */
function ReconciliationRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <tr>
      <td style={{ padding: '4px 8px', color: bold ? '#e2e8f0' : '#94a3b8', fontSize: 13, fontWeight: bold ? 700 : 400 }}>
        {label}
      </td>
      <td style={{ padding: '4px 8px', textAlign: 'right', color: '#e2e8f0', fontSize: 13, fontWeight: bold ? 700 : 400 }}>
        {value.toFixed(1)}
      </td>
    </tr>
  );
}

function EfficiencyStat({ label, value, caption }: { label: string; value: number | null; caption?: string }) {
  return (
    <div style={{ minWidth: 160 }}>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div aria-label={label} style={{ color: '#e2e8f0', fontSize: 22, fontWeight: 600 }}>
        {value == null ? '—' : `${value.toFixed(1)}%`}
      </div>
      {caption && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4, maxWidth: 220 }}>{caption}</div>}
    </div>
  );
}

export default function AreasPage({ inputs, onChange, run }: Props) {
  const areas = inputs.areas;
  const bridge = run.metrics.area_bridge;

  const updateAreas = (partial: Partial<AreaBridgeInputs>) => {
    onChange({ areas: { ...areas, ...partial } });
  };

  // R9 spec §15.6/§15.7. Errors gate the document and live on
  // `run.reconciliation.issues` (ERROR-severity input issues only); warnings
  // are advisory and live on `run.validation` alongside every other severity.
  // Both are surfaced here, scoped to this page's own fields — the same
  // `field.startsWith(...)` pattern `LenderValuationCard` already uses for its
  // own fields.
  const areaErrors = run.reconciliation.issues.filter((i) => i.field.startsWith('areas.'));
  const areaWarnings = run.validation.filter((i) => i.severity === 'warning' && i.field.startsWith('areas.'));

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>2. Areas</h3>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Existing and proposed
      </h4>
      <AreaRow id="area-existing-gia" label="Existing GIA (m²)" value={areas.existing_gia_sqm} onChangeValue={(v) => updateAreas({ existing_gia_sqm: v })} />
      <AreaRow id="area-demolished-gia" label="Demolished (m²)" value={areas.demolished_gia_sqm} onChangeValue={(v) => updateAreas({ demolished_gia_sqm: v })} />
      <AreaRow id="area-extension-gia" label="Extension (m²)" value={areas.extension_gia_sqm} onChangeValue={(v) => updateAreas({ extension_gia_sqm: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Not part of the residential works
      </h4>
      <AreaRow id="area-retained-commercial" label="Retained commercial (m²)" value={areas.retained_commercial_gia_sqm} onChangeValue={(v) => updateAreas({ retained_commercial_gia_sqm: v })} />
      <AreaRow id="area-untouched" label="Untouched (m²)" value={areas.untouched_gia_sqm} onChangeValue={(v) => updateAreas({ untouched_gia_sqm: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
        Non-saleable internal
      </h4>
      <AreaRow id="area-circulation" label="Circulation / common (m²)" value={areas.circulation_common_sqm} onChangeValue={(v) => updateAreas({ circulation_common_sqm: v })} />
      <AreaRow id="area-plant" label="Plant / riser (m²)" value={areas.plant_riser_sqm} onChangeValue={(v) => updateAreas({ plant_riser_sqm: v })} />
      <AreaRow id="area-store" label="Store / bin / cycle (m²)" value={areas.store_bin_cycle_sqm} onChangeValue={(v) => updateAreas({ store_bin_cycle_sqm: v })} />
      <AreaRow id="area-amenity" label="Amenity (m²)" value={areas.amenity_sqm} onChangeValue={(v) => updateAreas({ amenity_sqm: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
        External
      </h4>
      <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
        Recorded for the schedule; never part of the GIA reconciliation.
      </div>
      <AreaRow id="area-external-amenity" label="External amenity (m²)" value={areas.external_amenity_sqm} onChangeValue={(v) => updateAreas({ external_amenity_sqm: v })} />

      <h4 style={{ color: '#e2e8f0', fontSize: 15, marginTop: 28, marginBottom: 12 }}>Reconciliation</h4>
      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <ReconciliationRow label="Existing GIA" value={bridge.existing_gia_sqm} />
            <ReconciliationRow label="less demolished" value={-bridge.demolished_gia_sqm} />
            <ReconciliationRow label="plus extension" value={bridge.extension_gia_sqm} />
            <ReconciliationRow label="Proposed GIA" value={bridge.proposed_gia_sqm} bold />
            <ReconciliationRow label="less retained commercial" value={-bridge.retained_commercial_gia_sqm} />
            <ReconciliationRow label="less untouched" value={-bridge.untouched_gia_sqm} />
            <ReconciliationRow label="Developed area" value={bridge.developed_gia_sqm} bold />
            <ReconciliationRow label="less circulation" value={-bridge.circulation_common_sqm} />
            <ReconciliationRow label="less plant" value={-bridge.plant_riser_sqm} />
            <ReconciliationRow label="less storage" value={-bridge.store_bin_cycle_sqm} />
            <ReconciliationRow label="less amenity" value={-bridge.amenity_sqm} />
            <ReconciliationRow label="Available for units" value={bridge.available_for_units_sqm} bold />
            <ReconciliationRow label="less unit NIA" value={-bridge.unit_nia_sqm} />
            <ReconciliationRow label="Unallocated" value={bridge.unallocated_sqm} bold />
          </tbody>
        </table>
      </div>

      <h4 style={{ color: '#e2e8f0', fontSize: 15, marginTop: 24, marginBottom: 12 }}>Efficiencies</h4>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <EfficiencyStat label="Net to gross" value={bridge.nia_to_gia_pct} />
        <EfficiencyStat label="NIA to proposed GIA" value={bridge.nia_to_proposed_gia_pct} />
        <EfficiencyStat
          label="Saleable to developed"
          value={bridge.saleable_to_developed_pct}
          caption="Counts only units being sold — a retain-all scheme reads 0%."
        />
      </div>

      {(areaErrors.length > 0 || areaWarnings.length > 0) && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {areaErrors.map((issue, i) => (
            <div
              key={`err-${i}`}
              style={{ padding: '8px 12px', background: RED_BG, border: `1px solid ${RED}`, borderRadius: 4, color: RED_TEXT, fontSize: 12 }}
            >
              {issue.message}
            </div>
          ))}
          {areaWarnings.map((issue, i) => (
            <div
              key={`warn-${i}`}
              style={{ padding: '8px 12px', background: AMBER_BG, border: `1px solid ${AMBER}`, borderRadius: 4, color: AMBER_TEXT, fontSize: 12 }}
            >
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
