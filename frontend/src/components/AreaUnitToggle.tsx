/**
 * The m² / ft² segmented control (R17, spec §27.2). Two buttons in a group
 * labelled "Area unit"; the pressed one is the current display unit. It
 * writes the preference to context (and through it to `localStorage`) —
 * never to the document.
 */
import { AREA_UNITS, areaUnitLabel } from '../lib/area-units';
import { useAreaUnit } from '../lib/area-unit-context';

export default function AreaUnitToggle({ compact = false }: { compact?: boolean }) {
  const { unit, setUnit } = useAreaUnit();
  return (
    <div role="group" aria-label="Area unit" style={{ display: 'inline-flex', gap: 0, border: '1px solid #1e3a5f', borderRadius: 4, overflow: 'hidden' }}>
      {AREA_UNITS.map((u) => {
        const pressed = u === unit;
        return (
          <button
            key={u}
            type="button"
            aria-pressed={pressed}
            onClick={() => setUnit(u)}
            style={{
              padding: compact ? '2px 8px' : '4px 12px',
              fontSize: compact ? 12 : 13,
              background: pressed ? '#1e3a5f' : '#0f172a',
              color: pressed ? '#e2e8f0' : '#94a3b8',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {areaUnitLabel(u)}
          </button>
        );
      })}
    </div>
  );
}
