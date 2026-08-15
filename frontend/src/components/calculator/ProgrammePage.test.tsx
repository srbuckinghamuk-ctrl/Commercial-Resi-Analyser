import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProgrammePage from './ProgrammePage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV4, ProgrammeInputs } from '../../lib/model';
import { defaultCalculatorInputsV4 } from '../../lib/conversion-defaults';
import { penceToPounds } from '../../lib/format';

function buildInputs(overrides: Partial<CalculatorInputsV4> = {}): CalculatorInputsV4 {
  const base = defaultCalculatorInputsV4();
  return { ...base, ...overrides };
}

function setup(inputs: CalculatorInputsV4, onChange = vi.fn()) {
  const run = runAppraisal(inputs);
  render(<ProgrammePage inputs={inputs} onChange={onChange} run={run} />);
  return { onChange, run };
}

// Distinct, non-colliding durations so getByDisplayValue can target a single input.
const EDIT_PROGRAMME: ProgrammeInputs = {
  anchor_month: null,
  packages: {
    construction: { start_offset: 1, duration_months: 5, curve: { kind: 'straight_line' } },
    professional: { start_offset: 1, duration_months: 2, curve: { kind: 'straight_line' } },
    statutory: { start_offset: 1, duration_months: 3, curve: { kind: 'straight_line' } },
  },
};

describe('ProgrammePage — auto windows (programme === null)', () => {
  it('renders the auto-windows explanation and a "Set explicit programme" button', () => {
    const inputs = buildInputs({ programme: null });
    setup(inputs);
    expect(screen.getByText(/auto windows/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set explicit programme/i })).toBeInTheDocument();
  });

  it('clicking "Set explicit programme" seeds a programme from the auto windows (term 12)', () => {
    const inputs = buildInputs({ programme: null }); // default finance.term_months === 12
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /set explicit programme/i }));
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        anchor_month: null,
        packages: {
          construction: { start_offset: 1, duration_months: 10, curve: { kind: 'straight_line' } },
          professional: { start_offset: 1, duration_months: 5, curve: { kind: 'straight_line' } },
          statutory: { start_offset: 1, duration_months: 5, curve: { kind: 'straight_line' } },
        },
      },
    });
  });

  it('disables "Set explicit programme" with a note when term < 3 (sale-tail rule)', () => {
    const inputs = buildInputs({
      programme: null,
      finance: { ...defaultCalculatorInputsV4().finance, term_months: 2 },
    });
    setup(inputs);
    const button = screen.getByRole('button', { name: /set explicit programme/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/sale.tail/i)).toBeInTheDocument();
  });
});

describe('ProgrammePage — explicit programme editing', () => {
  it('editing a duration input calls onChange with the updated package', () => {
    const inputs = buildInputs({ programme: EDIT_PROGRAMME });
    const { onChange } = setup(inputs);
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '6' } });
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        ...EDIT_PROGRAMME,
        packages: {
          ...EDIT_PROGRAMME.packages,
          construction: { ...EDIT_PROGRAMME.packages.construction, duration_months: 6 },
        },
      },
    });
  });

  it('"Revert to auto windows" calls onChange({ programme: null })', () => {
    const inputs = buildInputs({ programme: EDIT_PROGRAMME });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /revert to auto windows/i }));
    expect(onChange).toHaveBeenCalledWith({ programme: null });
  });
});

describe('ProgrammePage — invalid-input clamping (CRITICAL 1a)', () => {
  // buildSchedule's programme arm floors the upper bound only; a raw negative
  // or fractional start_offset/duration_months reaching state can throw
  // (`uses[-1]` / `new Array(2.5)`) inside the render-time useMemo. The
  // editor must clamp on write so an invalid value never reaches state.
  it('typing "-1" into the start-offset input clamps to 0', () => {
    const inputs = buildInputs({ programme: EDIT_PROGRAMME });
    const { onChange } = setup(inputs);
    // All three packages share start_offset: 1 (only durations are distinct,
    // per the EDIT_PROGRAMME comment above) — the first '1' in DOM order is
    // construction's, since PACKAGES renders construction first.
    fireEvent.change(screen.getAllByDisplayValue('1')[0], { target: { value: '-1' } });
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        ...EDIT_PROGRAMME,
        packages: {
          ...EDIT_PROGRAMME.packages,
          construction: { ...EDIT_PROGRAMME.packages.construction, start_offset: 0 },
        },
      },
    });
  });

  it('typing "2.5" into the duration input clamps to 2 (floored)', () => {
    const inputs = buildInputs({ programme: EDIT_PROGRAMME });
    const { onChange } = setup(inputs);
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '2.5' } });
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        ...EDIT_PROGRAMME,
        packages: {
          ...EDIT_PROGRAMME.packages,
          construction: { ...EDIT_PROGRAMME.packages.construction, duration_months: 2 },
        },
      },
    });
  });

  it('clearing the duration field (NaN) clamps to 1, not NaN', () => {
    const inputs = buildInputs({ programme: EDIT_PROGRAMME });
    const { onChange } = setup(inputs);
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        ...EDIT_PROGRAMME,
        packages: {
          ...EDIT_PROGRAMME.packages,
          construction: { ...EDIT_PROGRAMME.packages.construction, duration_months: 1 },
        },
      },
    });
  });

  it('clearing the start-offset field (NaN) clamps to 0, not NaN', () => {
    const inputs = buildInputs({ programme: EDIT_PROGRAMME });
    const { onChange } = setup(inputs);
    fireEvent.change(screen.getAllByDisplayValue('1')[0], { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        ...EDIT_PROGRAMME,
        packages: {
          ...EDIT_PROGRAMME.packages,
          construction: { ...EDIT_PROGRAMME.packages.construction, start_offset: 0 },
        },
      },
    });
  });
});

describe('ProgrammePage — spend preview', () => {
  // Distinctive, non-colliding totals: all three packages placed in month 1 only
  // (duration 1), so each package's full total lands in a single, uniquely
  // identifiable cell.
  const SPEND_PROGRAMME: ProgrammeInputs = {
    anchor_month: null,
    packages: {
      construction: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
      professional: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
      statutory: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
    },
  };

  it('renders one row per month from run.schedule.uses (engine output, not local math)', () => {
    const inputs = buildInputs({
      programme: SPEND_PROGRAMME,
      conversion_costs: {
        ...defaultCalculatorInputsV4().conversion_costs,
        total_construction_sqm: 1000,
        construction_cost_per_sqm_pence: 250_000,
      },
    });
    const { run } = setup(inputs);

    // Sanity-check the fixture is deterministic before asserting against it.
    expect(run.schedule.uses[1].construction_pence).toBe(275_000_000);
    expect(run.schedule.uses.length).toBe(inputs.finance.term_months);

    expect(screen.getByText(penceToPounds(run.schedule.uses[1].construction_pence))).toBeInTheDocument();
  });
});
