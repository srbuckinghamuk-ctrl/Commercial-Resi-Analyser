import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExitStrategyPage from './ExitStrategyPage';
import { runAppraisal } from '../../lib/model';
import type { CalculatorInputsV8, SalesPhasingInputs, RefinanceInputs } from '../../lib/model';
import { defaultCalculatorInputsV8 } from '../../lib/conversion-defaults';
import { DEFAULT_UNIT_ANCILLARY } from '../../lib/conversion-types';
import { penceToPounds } from '../../lib/format';

function buildInputs(overrides: Partial<CalculatorInputsV8> = {}): CalculatorInputsV8 {
  const base = defaultCalculatorInputsV8();
  return { ...base, ...overrides };
}

function setup(inputs: CalculatorInputsV8, onChange = vi.fn()) {
  const run = runAppraisal(inputs);
  render(<ExitStrategyPage inputs={inputs} onChange={onChange} run={run} />);
  return { onChange, run };
}

// default finance.term_months === 12 -> term - 1 === 11
const SEEDED_PHASING: SalesPhasingInputs = {
  tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }],
};

const SEEDED_REFINANCE: RefinanceInputs = {
  month_offset: 11,
  investment_value_pence: 20_000_000,
  ltv_pct: 65,
  arrangement_fee_pence: 100_000,
  legal_costs_pence: 50_000,
};

const UNIT_A = {
  id: 'u1', type: '2bed' as const, floor_area_sqm: 60, estimated_value_pence: 30_000_000,
  comparable_notes: '', ancillary: { ...DEFAULT_UNIT_ANCILLARY },
};

describe('ExitStrategyPage — section visibility by route', () => {
  it('sell_all: shows the sales phasing toggle, hides the refinance section', () => {
    const inputs = buildInputs({ exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' } });
    setup(inputs);
    expect(screen.getByRole('button', { name: /phase the sales/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add refinance/i })).not.toBeInTheDocument();
  });

  it('retain_all: hides the sales phasing toggle, shows the refinance toggle', () => {
    const inputs = buildInputs({ exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'retain_all' } });
    setup(inputs);
    expect(screen.queryByRole('button', { name: /phase the sales/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add refinance/i })).toBeInTheDocument();
  });

  it('blended: shows both the sales phasing and refinance toggles', () => {
    const inputs = buildInputs({ exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'blended' } });
    setup(inputs);
    expect(screen.getByRole('button', { name: /phase the sales/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add refinance/i })).toBeInTheDocument();
  });
});

describe('ExitStrategyPage — route switch clears now-invalid blocks (IMPORTANT 3)', () => {
  // Switching to retain_all leaves an invalid sales_phasing (retain_all has no
  // sold portion); switching to sell_all leaves an invalid refinance
  // (sell_all retains nothing) — both blocks must clear in the SAME payload
  // as the route change, or the editor hides an orphaned block that still
  // moves money on screen.
  it('switching to retain_all clears sales_phasing but leaves refinance untouched', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'blended' },
      sales_phasing: SEEDED_PHASING,
      refinance: SEEDED_REFINANCE,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /retain all/i }));
    expect(onChange).toHaveBeenCalledWith({
      exit_strategy: { ...inputs.exit_strategy, route: 'retain_all' },
      sales_phasing: null,
    });
  });

  it('switching to sell_all clears refinance but leaves sales_phasing untouched', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'blended' },
      sales_phasing: SEEDED_PHASING,
      refinance: SEEDED_REFINANCE,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /^sell all$/i }));
    expect(onChange).toHaveBeenCalledWith({
      exit_strategy: { ...inputs.exit_strategy, route: 'sell_all' },
      refinance: null,
    });
  });

  it('switching to blended clears neither block (both remain valid)', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: SEEDED_PHASING,
      refinance: null,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /blended/i }));
    expect(onChange).toHaveBeenCalledWith({
      exit_strategy: { ...inputs.exit_strategy, route: 'blended' },
    });
  });
});

describe('ExitStrategyPage — sales phasing toggle', () => {
  it('toggling phasing on seeds a single final-month tranche at 100%', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: null,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /phase the sales/i }));
    expect(onChange).toHaveBeenCalledWith({
      sales_phasing: { tranches: [{ month_offset: 11, pct_of_gross_receipts: 100 }] },
    });
  });

  it('toggling phasing off clears the block', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: SEEDED_PHASING,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /disable phasing/i }));
    expect(onChange).toHaveBeenCalledWith({ sales_phasing: null });
  });
});

describe('ExitStrategyPage — sales phasing tranche editing', () => {
  it('"Add tranche" appends a zero-pct row at the final month', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: SEEDED_PHASING,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /add tranche/i }));
    expect(onChange).toHaveBeenCalledWith({
      sales_phasing: {
        tranches: [
          { month_offset: 11, pct_of_gross_receipts: 100 },
          { month_offset: 11, pct_of_gross_receipts: 0 },
        ],
      },
    });
  });

  it('editing a tranche pct calls onChange with the updated tranche only', () => {
    const twoTranche: SalesPhasingInputs = {
      tranches: [
        { month_offset: 5, pct_of_gross_receipts: 60 },
        { month_offset: 11, pct_of_gross_receipts: 40 },
      ],
    };
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: twoTranche,
    });
    const { onChange } = setup(inputs);
    fireEvent.change(screen.getByDisplayValue('60'), { target: { value: '70' } });
    expect(onChange).toHaveBeenCalledWith({
      sales_phasing: {
        tranches: [
          { month_offset: 5, pct_of_gross_receipts: 70 },
          { month_offset: 11, pct_of_gross_receipts: 40 },
        ],
      },
    });
  });

  it('removing a tranche filters it out', () => {
    const twoTranche: SalesPhasingInputs = {
      tranches: [
        { month_offset: 5, pct_of_gross_receipts: 60 },
        { month_offset: 11, pct_of_gross_receipts: 40 },
      ],
    };
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: twoTranche,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getAllByRole('button', { name: /remove tranche/i })[0]);
    expect(onChange).toHaveBeenCalledWith({
      sales_phasing: { tranches: [{ month_offset: 11, pct_of_gross_receipts: 40 }] },
    });
  });

  it('shows a red sum badge when tranche percentages do not sum to 100', () => {
    const badSum: SalesPhasingInputs = {
      tranches: [
        { month_offset: 5, pct_of_gross_receipts: 60 },
        { month_offset: 11, pct_of_gross_receipts: 30 },
      ],
    };
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: badSum,
    });
    setup(inputs);
    const badge = screen.getByText(/Σ\s*90%/);
    expect(badge).toHaveStyle({ color: '#ef4444' });
  });

  it('does not show a red sum badge when tranche percentages sum to 100', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'sell_all' },
      sales_phasing: SEEDED_PHASING,
    });
    setup(inputs);
    const badge = screen.getByText(/Σ\s*100%/);
    expect(badge).not.toHaveStyle({ color: '#ef4444' });
  });
});

describe('ExitStrategyPage — refinance toggle', () => {
  it('enabling refinance seeds defaults using the component\'s retainedCapitalValue', () => {
    const inputs = buildInputs({
      exit_strategy: {
        ...defaultCalculatorInputsV8().exit_strategy,
        route: 'retain_all',
        retained_units: [{ unit_id: 'u1', monthly_rent_pence: 100_000 }],
      },
      unit_mix: { units: [UNIT_A] },
      refinance: null,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /add refinance/i }));
    expect(onChange).toHaveBeenCalledWith({
      refinance: {
        month_offset: 11,
        investment_value_pence: 30_000_000, // retainedCapitalValue == UNIT_A.estimated_value_pence
        ltv_pct: 65,
        arrangement_fee_pence: 0,
        legal_costs_pence: 0,
      },
    });
  });

  // ── R9 fix wave ────────────────────────────────────────────────────────
  // The seeded `investment_value_pence` used to sum bare `estimated_value_pence`
  // over the retained units, so a scheme with retained parking or balconies
  // refinanced against an understated investment value. It now comes off the
  // run — `metrics.unrealised_value_pence`, which is the engine's own
  // `schedule.totals.retained_value_pence`.
  const UNIT_WITH_ANCILLARY = {
    id: 'u2', type: '1bed' as const, floor_area_sqm: 45, estimated_value_pence: 20_000_000,
    comparable_notes: '',
    ancillary: {
      balcony_terrace_sqm: 6, balcony_terrace_value_pence: 500_000,
      parking_spaces: 1, parking_value_pence: 1_500_000,
    },
  };

  it('seeds the refinance investment value INCLUDING retained ancillary value', () => {
    // Blended: the engine's retained set is exactly `retained_units`, so the
    // component's figure and `metrics.unrealised_value_pence` describe the
    // same units and must agree to the penny.
    const inputs = buildInputs({
      exit_strategy: {
        ...defaultCalculatorInputsV8().exit_strategy,
        route: 'blended',
        retained_units: [{ unit_id: 'u2', monthly_rent_pence: 100_000 }],
      },
      unit_mix: { units: [UNIT_A, UNIT_WITH_ANCILLARY] },
      refinance: null,
    });
    const { onChange, run } = setup(inputs);
    // Sanity, so the assertion cannot pass by coincidence: internal-only would
    // be £200,000 and the ancillary adds £20,000 on top.
    expect(run.metrics.unrealised_value_pence).toBe(22_000_000);
    fireEvent.click(screen.getByRole('button', { name: /add refinance/i }));
    expect(onChange).toHaveBeenCalledWith({
      refinance: {
        month_offset: 11,
        investment_value_pence: run.metrics.unrealised_value_pence,
        ltv_pct: 65,
        arrangement_fee_pence: 0,
        legal_costs_pence: 0,
      },
    });
    // The pre-fix figure, pinned so a regression to it fails loudly.
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ refinance: expect.objectContaining({ investment_value_pence: 20_000_000 }) }),
    );
  });

  it('bases the gross yield on the engine\'s retained value, ancillary included', () => {
    const inputs = buildInputs({
      exit_strategy: {
        ...defaultCalculatorInputsV8().exit_strategy,
        route: 'blended',
        retained_units: [{ unit_id: 'u2', monthly_rent_pence: 100_000 }],
      },
      unit_mix: { units: [UNIT_A, UNIT_WITH_ANCILLARY] },
    });
    const { run } = setup(inputs);
    const expected = ((100_000 * 12) / run.metrics.unrealised_value_pence) * 100;
    expect(screen.getByText(`${expected.toFixed(1)}%`)).toBeInTheDocument();
    expect(expected.toFixed(1)).toBe('5.5'); // sanity: £12,000 / £220,000
    // 6.0% is the pre-fix answer (rent ÷ internal value only, £12,000 /
    // £200,000) — pinned so a regression to it fails loudly.
    expect(screen.queryByText('6.0%')).not.toBeInTheDocument();
  });

  it('disabling refinance clears the block', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'retain_all' },
      refinance: SEEDED_REFINANCE,
    });
    const { onChange } = setup(inputs);
    fireEvent.click(screen.getByRole('button', { name: /remove refinance/i }));
    expect(onChange).toHaveBeenCalledWith({ refinance: null });
  });
});

describe('ExitStrategyPage — refinance field editing and preview', () => {
  it('editing the LTV % calls onChange with the updated refinance block', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'retain_all' },
      refinance: SEEDED_REFINANCE,
    });
    const { onChange } = setup(inputs);
    fireEvent.change(screen.getByDisplayValue('65'), { target: { value: '70' } });
    expect(onChange).toHaveBeenCalledWith({
      refinance: { ...SEEDED_REFINANCE, ltv_pct: 70 },
    });
  });

  it('editing the investment value (£) converts pounds to pence', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'retain_all' },
      refinance: SEEDED_REFINANCE,
    });
    const { onChange } = setup(inputs);
    fireEvent.change(screen.getByDisplayValue('200000'), { target: { value: '250000' } });
    expect(onChange).toHaveBeenCalledWith({
      refinance: { ...SEEDED_REFINANCE, investment_value_pence: 25_000_000 },
    });
  });

  it('shows the net-proceeds preview line computed from the current refinance inputs', () => {
    const inputs = buildInputs({
      exit_strategy: { ...defaultCalculatorInputsV8().exit_strategy, route: 'retain_all' },
      refinance: SEEDED_REFINANCE,
    });
    setup(inputs);
    // spec §4.5: net proceeds = round(investment_value_pence * ltv_pct / 100) - arrangement_fee_pence - legal_costs_pence
    const expected = Math.round(SEEDED_REFINANCE.investment_value_pence * (SEEDED_REFINANCE.ltv_pct / 100))
      - SEEDED_REFINANCE.arrangement_fee_pence - SEEDED_REFINANCE.legal_costs_pence;
    expect(screen.getByText(penceToPounds(expected))).toBeInTheDocument();
  });
});
