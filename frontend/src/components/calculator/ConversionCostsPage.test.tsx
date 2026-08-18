import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConversionCostsPage from './ConversionCostsPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV6 } from '../../lib/model';
import { defaultCalculatorInputsV6 } from '../../lib/conversion-defaults';

/**
 * R9 Task 10 fix round 1. The riskiest wiring point this page added: which
 * "Total construction m²" figure is shown, and whether it is editable,
 * depends entirely on `inputs.areas.basis`. Reuses the FULL_BRIDGE-shaped
 * numbers from `model/areas.test.ts` (existing 600, demolished 20, extension
 * 40, retained 100 -> developed 520) so the bridge-derived figure asserted
 * here (520) is the same one that suite already pins.
 */
function baseInputs(basis: 'manual' | 'bridge_derived'): CalculatorInputsV6 {
  const inputs = defaultCalculatorInputsV6();
  return {
    ...inputs,
    areas: {
      ...inputs.areas,
      basis,
      existing_gia_sqm: 600,
      demolished_gia_sqm: 20,
      extension_gia_sqm: 40,
      retained_commercial_gia_sqm: 100,
      untouched_gia_sqm: 0,
    },
    conversion_costs: {
      ...inputs.conversion_costs,
      // A value that cannot be confused with the derived 520 m² figure.
      total_construction_sqm: 999,
    },
  };
}

describe('ConversionCostsPage — construction area basis selector', () => {
  it('under the manual basis, shows the editable field at the entered value', () => {
    const inputs = baseInputs('manual');
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    expect(screen.getByDisplayValue('999')).toBeInTheDocument();
    expect(screen.queryByText(/derived: proposed GIA/i)).not.toBeInTheDocument();
  });

  it('under the bridge-derived basis, shows the read-only derived figure and hides the manual field', () => {
    const inputs = baseInputs('bridge_derived');
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    // developed_area_sqm === developed_gia_sqm === 520 under this basis.
    expect(screen.getByText('520 m²')).toBeInTheDocument();
    expect(screen.getByText(/derived: proposed GIA 620 m²/i)).toBeInTheDocument();
    // The manually entered 999 must not be reachable or editable here.
    expect(screen.queryByDisplayValue('999')).not.toBeInTheDocument();
  });

  it('switching the basis selector calls onChange with the new basis, leaving other area fields untouched', () => {
    const inputs = baseInputs('manual');
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bridge_derived' } });

    expect(onChange).toHaveBeenCalledWith({
      areas: { ...inputs.areas, basis: 'bridge_derived' },
    });
  });
});
