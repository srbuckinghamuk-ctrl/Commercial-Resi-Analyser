import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UnitMixPage from './UnitMixPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV8 } from '../../lib/model';
import { defaultCalculatorInputsV8 } from '../../lib/conversion-defaults';
import { DEFAULT_UNIT_ANCILLARY } from '../../lib/conversion-types';
import type { ProposedUnitV6 } from '../../lib/conversion-types';

/** No `htmlFor`/`id` pairing exists on this page's field labels (matching
 * every other calculator page's row components), so locate an input by its
 * visible label text's next sibling — either the `<input>` itself (plain
 * fields) or a wrapping `<div>` holding a `£`-prefixed `<input>` (pence
 * fields), the same two DOM shapes every field on this page uses. */
function inputAfterLabel(label: string): HTMLInputElement {
  const sibling = screen.getByText(label).nextElementSibling;
  if (sibling instanceof HTMLInputElement) return sibling;
  const nested = sibling?.querySelector('input');
  if (nested == null) throw new Error(`No input found near label "${label}"`);
  return nested as HTMLInputElement;
}

function unit(id: string): ProposedUnitV6 {
  return {
    id,
    type: '1bed',
    floor_area_sqm: 50,
    estimated_value_pence: 20_000_000,
    comparable_notes: '',
    ancillary: { ...DEFAULT_UNIT_ANCILLARY },
  };
}

function setup() {
  const base = defaultCalculatorInputsV8();
  const inputs: CalculatorInputsV8 = { ...base, unit_mix: { units: [unit('u1')] } };
  const run = runAppraisal(inputs);
  const onChange = vi.fn();
  render(<UnitMixPage inputs={inputs} onChange={onChange} run={run} />);
  return { inputs, onChange };
}

describe('UnitMixPage — per-unit ancillary wiring', () => {
  it('editing balcony/terrace area calls onChange with only that ancillary field changed', () => {
    const { inputs, onChange } = setup();
    fireEvent.change(inputAfterLabel('Balcony/terrace (m²)'), { target: { value: '12' } });

    expect(onChange).toHaveBeenCalledWith({
      unit_mix: {
        units: [{ ...inputs.unit_mix.units[0], ancillary: { ...DEFAULT_UNIT_ANCILLARY, balcony_terrace_sqm: 12 } }],
      },
    });
  });

  it('editing balcony/terrace value (£) calls onChange with the value in pence', () => {
    const { inputs, onChange } = setup();
    fireEvent.change(inputAfterLabel('Balcony/terrace value (£)'), { target: { value: '5000' } });

    expect(onChange).toHaveBeenCalledWith({
      unit_mix: {
        units: [{
          ...inputs.unit_mix.units[0],
          ancillary: { ...DEFAULT_UNIT_ANCILLARY, balcony_terrace_value_pence: 500_000 },
        }],
      },
    });
  });

  it('editing parking spaces calls onChange, and never touches floor_area_sqm', () => {
    const { inputs, onChange } = setup();
    fireEvent.change(inputAfterLabel('Parking spaces'), { target: { value: '2' } });

    const call = onChange.mock.calls.at(-1)![0];
    expect(call.unit_mix.units[0].ancillary.parking_spaces).toBe(2);
    // The defect this task exists to prevent: an ancillary edit must never
    // change the unit's internal NIA field.
    expect(call.unit_mix.units[0].floor_area_sqm).toBe(inputs.unit_mix.units[0].floor_area_sqm);
  });

  it('editing parking value (£) calls onChange with the value in pence', () => {
    const { inputs, onChange } = setup();
    fireEvent.change(inputAfterLabel('Parking value (£)'), { target: { value: '3500' } });

    expect(onChange).toHaveBeenCalledWith({
      unit_mix: {
        units: [{
          ...inputs.unit_mix.units[0],
          ancillary: { ...DEFAULT_UNIT_ANCILLARY, parking_value_pence: 350_000 },
        }],
      },
    });
  });

  it('reads the footer NIA and ancillary totals from the area bridge, not a local sum', () => {
    setup();
    // unit_nia_sqm for a single 50 sqm unit with no ancillary entered.
    expect(screen.getByText(/Total NIA: 50 m²/)).toBeInTheDocument();
    expect(screen.getByText(/Ancillary: 0 m² balcony\/terrace · 0 parking/)).toBeInTheDocument();
  });
});
