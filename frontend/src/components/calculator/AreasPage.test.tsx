import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AreasPage from './AreasPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV8 } from '../../lib/model';
import { defaultCalculatorInputsV8 } from '../../lib/conversion-defaults';
import { DEFAULT_UNIT_ANCILLARY } from '../../lib/conversion-types';
import type { ProposedUnitV6 } from '../../lib/conversion-types';

/**
 * Fixture numbers reuse the exact FULL_BRIDGE shape already pinned in
 * `model/areas.test.ts` (existing 600, demolished 20, extension 40 -> proposed
 * 620; retained 100, untouched 0 -> developed 520), so this suite is checking
 * the same arithmetic the engine's own unit tests already lock down — this
 * page must render it, never recompute it.
 */
function baseInputs(): CalculatorInputsV8 {
  const inputs = defaultCalculatorInputsV8();
  return {
    ...inputs,
    areas: {
      ...inputs.areas,
      basis: 'manual',
      existing_gia_sqm: 600,
      demolished_gia_sqm: 20,
      extension_gia_sqm: 40,
      retained_commercial_gia_sqm: 100,
      untouched_gia_sqm: 0,
      circulation_common_sqm: 62,
      plant_riser_sqm: 18,
      store_bin_cycle_sqm: 14,
      amenity_sqm: 6,
      external_amenity_sqm: 150,
    },
  };
}

function unit(id: string, floor_area_sqm: number): ProposedUnitV6 {
  return {
    id,
    type: '1bed',
    floor_area_sqm,
    estimated_value_pence: 20_000_000,
    comparable_notes: '',
    ancillary: { ...DEFAULT_UNIT_ANCILLARY },
  };
}

// available_for_units_sqm = 520 - 62 - 18 - 14 - 6 = 420.
// Two 60 sqm units -> unit NIA 120 -> unallocated 420 - 120 = 300.
const inputsFixture: CalculatorInputsV8 = {
  ...baseInputs(),
  unit_mix: { units: [unit('u1', 60), unit('u2', 60)] },
};
const runFixture = runAppraisal(inputsFixture);

// Same building, an oversized schedule: 300 + 200 = 500 sqm of units against
// 420 sqm available -> unallocated -80.
const overfilledInputsFixture: CalculatorInputsV8 = {
  ...baseInputs(),
  unit_mix: { units: [unit('u1', 300), unit('u2', 200)] },
};
const overfilledRunFixture = runAppraisal(overfilledInputsFixture);

// No existing building recorded at all -> every GIA-denominated ratio has a
// zero denominator and must render as an em dash, not 0%.
const zeroGiaInputsFixture: CalculatorInputsV8 = {
  ...baseInputs(),
  areas: {
    ...baseInputs().areas,
    existing_gia_sqm: 0,
    demolished_gia_sqm: 0,
    extension_gia_sqm: 0,
    retained_commercial_gia_sqm: 0,
    untouched_gia_sqm: 0,
    circulation_common_sqm: 0,
    plant_riser_sqm: 0,
    store_bin_cycle_sqm: 0,
    amenity_sqm: 0,
  },
  unit_mix: { units: [] },
};
const zeroGiaRunFixture = runAppraisal(zeroGiaInputsFixture);

describe('AreasPage', () => {
  it('shows the reconciliation from the run, not from a local computation', () => {
    render(<AreasPage inputs={inputsFixture} onChange={vi.fn()} run={runFixture} />);
    expect(screen.getByText('Proposed GIA').closest('tr')).toHaveTextContent('620');
    expect(screen.getByText('Developed area').closest('tr')).toHaveTextContent('520');
    expect(screen.getByText('Unallocated').closest('tr')).toHaveTextContent('300');
  });

  it('displays a negative unallocated balance with its sign rather than suppressing it', () => {
    render(<AreasPage inputs={overfilledInputsFixture} onChange={vi.fn()} run={overfilledRunFixture} />);
    expect(screen.getByText('Unallocated').closest('tr')).toHaveTextContent('-80');
  });

  // Fix round 1. `validateInputs` files this over-fill error under
  // `field: 'unit_mix.units'`, not `areas.*` (validation.ts) — the schedule is
  // what does not fit, not an area line. A prefix-only filter dropped it, so a
  // user reading "Unallocated: -80.0 m²" on this exact page got the signed
  // number with no explanation anywhere on it. Both must be present together.
  it('explains a negative unallocated balance on the same page that shows it', () => {
    render(<AreasPage inputs={overfilledInputsFixture} onChange={vi.fn()} run={overfilledRunFixture} />);
    expect(screen.getByText('Unallocated').closest('tr')).toHaveTextContent('-80');
    expect(screen.getByText(/schedule does not fit the building/i)).toBeInTheDocument();
  });

  it('shows all three efficiencies, and an em dash where the ratio is unavailable', () => {
    render(<AreasPage inputs={zeroGiaInputsFixture} onChange={vi.fn()} run={zeroGiaRunFixture} />);
    expect(screen.getByLabelText('Net to gross')).toHaveTextContent('—');
    expect(screen.getByLabelText('NIA to proposed GIA')).toHaveTextContent('—');
    expect(screen.getByLabelText('Saleable to developed')).toHaveTextContent('—');
  });

  it('renders a real percentage (not an em dash) once the denominator is non-zero', () => {
    render(<AreasPage inputs={inputsFixture} onChange={vi.fn()} run={runFixture} />);
    // 120 / 520 = 23.08%
    expect(screen.getByLabelText('Net to gross')).toHaveTextContent('23.1%');
  });

  it('writes entered areas back through onChange', () => {
    const onChange = vi.fn();
    render(<AreasPage inputs={inputsFixture} onChange={onChange} run={runFixture} />);
    fireEvent.change(screen.getByLabelText('Existing GIA (m²)'), { target: { value: '700' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ areas: expect.objectContaining({ existing_gia_sqm: 700 }) }),
    );
  });

  it('surfaces areas-scoped validation warnings, ignoring unrelated ones', () => {
    // The base fixture trips the 65-90% net-to-gross warning
    // (120/520 = 23%, well outside the range) — field `areas.nia_to_gia_pct`.
    render(<AreasPage inputs={inputsFixture} onChange={vi.fn()} run={runFixture} />);
    expect(screen.getByText(/net-to-gross efficiency/i)).toBeInTheDocument();
  });

  it('does not surface the over-fill error when the schedule fits (no false positive)', () => {
    render(<AreasPage inputs={inputsFixture} onChange={vi.fn()} run={runFixture} />);
    expect(screen.queryByText(/schedule does not fit the building/i)).not.toBeInTheDocument();
  });
});
