import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import ConversionCostsPage from './ConversionCostsPage';
import { runAppraisal } from '../../lib/model';
import type { AppraisalRun, CalculatorInputsV7, CostPackage, FeeLine } from '../../lib/model';
import { defaultCalculatorInputsV7 } from '../../lib/conversion-defaults';
import { DEFAULT_UNIT_ANCILLARY } from '../../lib/conversion-types';
import type { ProposedUnitV6 } from '../../lib/conversion-types';

/**
 * R9 Task 10 fix round 1. The riskiest wiring point this page added: which
 * "Total construction m²" figure is shown, and whether it is editable,
 * depends entirely on `inputs.areas.basis`. Reuses the FULL_BRIDGE-shaped
 * numbers from `model/areas.test.ts` (existing 600, demolished 20, extension
 * 40, retained 100 -> developed 520) so the bridge-derived figure asserted
 * here (520) is the same one that suite already pins.
 */
function baseInputs(basis: 'manual' | 'bridge_derived'): CalculatorInputsV7 {
  const inputs = defaultCalculatorInputsV7();
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

afterEach(() => {
  cleanup();
});

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

    fireEvent.change(screen.getByRole('combobox', { name: /construction area basis/i }), { target: { value: 'bridge_derived' } });

    expect(onChange).toHaveBeenCalledWith({
      areas: { ...inputs.areas, basis: 'bridge_derived' },
    });
  });
});

// R10 Task 12. `run.metrics.cost_plan` is the single read site for every
// displayed total, base and amount on this page (Task 9's accessor). A
// figure chosen so that NO arithmetic over the visible inputs would produce
// it -- £123,456.78 on a document whose contingency is nowhere near that --
// so a component that recomputed the contingency amount itself, instead of
// reading the run, would render something else (or throw).
function runWithContingencyAmount(amountPence: number): AppraisalRun {
  const inputs = defaultCalculatorInputsV7();
  const run = runAppraisal(inputs);
  return {
    ...run,
    metrics: {
      ...run.metrics,
      cost_plan: {
        ...run.metrics.cost_plan,
        contingency: run.metrics.cost_plan.contingency.map((c, i) => (
          i === 0 ? { ...c, amount_pence: amountPence } : c
        )),
      },
    },
  };
}

// Task 9 Step 2's cross-site fixture: two packages ('Strip out' existing-
// building, 'structure' general) totalling the base build, three
// contingency classes and two fee lines. funding_source is 'cash' so the
// run needs nothing else to compute. Module scope so both the read-site
// describe block and the fix-round-1 (C2/I2) blocks below can share it.
//
// I4 (fix round 1). p2's free-text `label` is deliberately NOT "Structure"
// (Task 9's own fixture used that exact string for both the code and the
// label) -- getByDisplayValue('Structure') below must resolve to exactly
// one element, and a package's label <input> is also queryable by display
// value, so a label that happened to equal the code's human name would make
// this test ambiguous for a reason that has nothing to do with what it is
// checking.
function detailedInputs(): CalculatorInputsV7 {
  const base = defaultCalculatorInputsV7();
  return {
    ...base,
    finance: { ...base.finance, funding_source: 'cash', term_months: 12 },
    conversion_costs: {
      ...base.conversion_costs,
      fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
    },
    cost_plan: {
      mode: 'detailed',
      packages: [
        { id: 'p1', code: 'enabling_strip_out_asbestos', label: 'Strip out',
          amount_pence: 1_000_000, contingency_class: 'existing_building',
          lender_eligible: true, notes: '' },
        { id: 'p2', code: 'structure', label: 'Structural frame', amount_pence: 3_000_000,
          contingency_class: 'general', lender_eligible: true, notes: '' },
      ],
      contingency: [
        { name: 'general', pct: 5, basis: 'all_packages', package_ids: [] },
        { name: 'existing_building', pct: 15, basis: 'selected_packages', package_ids: ['p1'] },
        { name: 'abnormal', pct: 2.5, basis: 'all_packages', package_ids: [] },
      ],
      fee_lines: [
        { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
          basis: 'pct_of_construction_total', amount_pence: 0, pct: 6, per_dwelling: false },
        { id: 'f2', code: 'cil_s106', category: 'statutory', label: 'CIL / S106',
          basis: 'fixed', amount_pence: 700_000, pct: 0, per_dwelling: false },
      ],
    },
  };
}

describe('ConversionCostsPage — reads cost figures from run.metrics.cost_plan, never recomputes them', () => {
  it('renders the contingency amount from the run, not from its own arithmetic', () => {
    const inputs = defaultCalculatorInputsV7();
    const run = runWithContingencyAmount(12_345_678);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByText(/123,456\.78/)).toBeInTheDocument();
  });

  it('shows the package grid in detailed mode and hides it in headline mode', () => {
    const inputs = detailedInputs();
    const props = { inputs, run: runAppraisal(inputs), onChange: vi.fn() };
    render(<ConversionCostsPage {...props} />);
    // I4 (fix round 1). getByText('Structure') was dropped: with readable
    // <option> text restored, EVERY package row's code <select> lists
    // "Structure" among its 13 options regardless of that row's own code
    // (React Testing Library matches unselected <option> text), so with two
    // package rows getByText('Structure') throws "found multiple elements"
    // before it can prove anything about which package actually carries that
    // code. getByDisplayValue matches a <select>'s CURRENTLY SELECTED option
    // only, so it is tied to the specific package (p2) whose code is
    // 'structure' -- p1's own select displays "Enabling Strip Out Asbestos",
    // not "Structure", so there is exactly one match.
    expect(screen.getByDisplayValue('Structure')).toBeInTheDocument();
    // And the negative half — without it, a grid rendered unconditionally passes.
    cleanup();
    const headline: CalculatorInputsV7 = {
      ...inputs,
      cost_plan: { ...inputs.cost_plan, mode: 'headline' as const, packages: [] },
    };
    render(<ConversionCostsPage inputs={headline} run={runAppraisal(headline)} onChange={vi.fn()} />);
    expect(screen.queryByDisplayValue('Structure')).not.toBeInTheDocument();
  });

  // §3.2.1 / §6. Switching to detailed mode on a document carrying compliance
  // allowances offers a one-click conversion into a single
  // fire_acoustic_thermal package. Assert the resulting package amount
  // equals the sum of the three compliance fields and that the three fields
  // are zeroed -- the money is visibly moved, not silently dropped or
  // duplicated -- and that it happens through the SAME onChange every other
  // edit on this page uses, not a second code path.
  it('offers to convert compliance allowances into a package when switching to detailed mode', () => {
    const base = defaultCalculatorInputsV7();
    const inputs: CalculatorInputsV7 = {
      ...base,
      conversion_costs: {
        ...base.conversion_costs,
        fire_safety_pence: 200_000,
        sound_insulation_pence: 150_000,
        part_l_compliance_pence: 150_000,
      },
    };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Detailed'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    const partial = onChange.mock.calls[0][0];
    expect(partial.cost_plan.mode).toBe('detailed');
    const converted = (partial.cost_plan.packages as CostPackage[])
      .find((p) => p.code === 'fire_acoustic_thermal');
    expect(converted).toBeDefined();
    expect(converted!.amount_pence).toBe(500_000); // 200,000 + 150,000 + 150,000
    expect(partial.conversion_costs.fire_safety_pence).toBe(0);
    expect(partial.conversion_costs.sound_insulation_pence).toBe(0);
    expect(partial.conversion_costs.part_l_compliance_pence).toBe(0);

    confirmSpy.mockRestore();
  });

  it('switches mode without prompting when there is no compliance to convert', () => {
    const inputs = defaultCalculatorInputsV7(); // compliance fields are 0 by default
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Detailed'));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ cost_plan: { ...inputs.cost_plan, mode: 'detailed' } });
    confirmSpy.mockRestore();
  });

  it('leaves the compliance fields untouched when the user declines the conversion', () => {
    const base = defaultCalculatorInputsV7();
    const inputs: CalculatorInputsV7 = {
      ...base,
      conversion_costs: { ...base.conversion_costs, fire_safety_pence: 200_000 },
    };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Detailed'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ cost_plan: { ...inputs.cost_plan, mode: 'detailed' } });
    confirmSpy.mockRestore();
  });
});

// C2 (fix round 1, Critical). The forward path (headline -> detailed) got
// three tests above; the return path got none, and the engine silently
// ignores `packages` in headline mode (cost-plan.ts) -- so a package
// carrying value that switched back to headline would vanish from every
// total with no error. Refusal was chosen over "reverse the conversion":
// see the ruling in handleModeChange's comment for why a reverse mapping is
// not principled for a general package. These tests assert on the RESULT
// (was onChange invoked at all, i.e. could the caller's totals have moved),
// not merely on whether a confirmation dialog fired.
describe('ConversionCostsPage — the return trip cannot lose money (C2, fix round 1)', () => {
  it('refuses to switch back to headline while a package still carries value', () => {
    const inputs = detailedInputs(); // packages worth 1,000,000 + 3,000,000
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Headline'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    // The discriminator: if the guard were missing, this would be
    // `toHaveBeenCalledWith({ cost_plan: { ...inputs.cost_plan, mode: 'headline' } })`
    // -- silently dropping 4,000,000 pence of package value. Asserting
    // "never called" is what proves nothing moved, not just that a dialog
    // appeared.
    expect(onChange).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('allows switching back to headline once every package is zeroed', () => {
    const inputs = detailedInputs();
    const zeroed: CalculatorInputsV7 = {
      ...inputs,
      cost_plan: {
        ...inputs.cost_plan,
        packages: inputs.cost_plan.packages.map((p) => ({ ...p, amount_pence: 0 })),
      },
    };
    const run = runAppraisal(zeroed);
    const onChange = vi.fn();
    const alertSpy = vi.spyOn(window, 'alert');
    render(<ConversionCostsPage inputs={zeroed} run={run} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('Headline'));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith({ cost_plan: { ...zeroed.cost_plan, mode: 'headline' } });
    alertSpy.mockRestore();
  });
});

// I2 (fix round 1, Important). The fee basis selector shipped with zero
// coverage. base_build 4,000,000 / contingency 400,000 (10%) /
// construction_total 4,400,000 (no compliance, no other fee lines) are
// pinned literals so the resolved-base assertions below are falsifiable,
// not just "some text appeared".
function feeTestInputs(feeLines: FeeLine[]): CalculatorInputsV7 {
  const base = defaultCalculatorInputsV7();
  return {
    ...base,
    areas: { ...base.areas, basis: 'manual' },
    conversion_costs: {
      ...base.conversion_costs,
      construction_cost_per_sqm_pence: 10_000,
      total_construction_sqm: 400,
    },
    cost_plan: { ...base.cost_plan, fee_lines: feeLines },
  };
}

// The Contingency block (always rendered) shows its own "of £X = £Y" text
// for all three classes, so a bare page-wide getByText(/of £/) is ambiguous
// by construction, not by accident. Scope to the fee row itself: each
// basis <select> sits as a direct child of its row's <div>.
function feeRow(basisSelectName: string): HTMLElement {
  return screen.getByRole('combobox', { name: basisSelectName }).closest('div')!;
}

describe('ConversionCostsPage — fee rows render every basis from the run (I2, fix round 1)', () => {
  it('renders a fixed-basis fee as an amount input, with no resolved-base note', () => {
    const inputs = feeTestInputs([
      { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
        basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false },
    ]);
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument(); // 500,000p -> £5,000
    expect(within(feeRow('Architect basis')).queryByText(/of £/)).not.toBeInTheDocument();
  });

  it('renders a pct_of_base_build fee with the resolved base and amount read from the run', () => {
    const inputs = feeTestInputs([
      { id: 'f2', code: 'other_professional', category: 'professional', label: 'QS fee',
        basis: 'pct_of_base_build', amount_pence: 0, pct: 5, per_dwelling: false },
    ]);
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    // base_build only (400 sqm x 10,000p/sqm = 4,000,000p = £40,000),
    // excludes the 400,000p contingency: 5% of 4,000,000 = 200,000p = £2,000.00.
    expect(within(feeRow('QS fee basis')).getByText(/of £40,000 = £2,000\.00/)).toBeInTheDocument();
  });

  it('renders a pct_of_construction_total fee against a base that includes contingency, unlike pct_of_base_build', () => {
    const inputs = feeTestInputs([
      { id: 'f3', code: 'other_professional', category: 'professional', label: 'QS fee',
        basis: 'pct_of_construction_total', amount_pence: 0, pct: 5, per_dwelling: false },
    ]);
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={vi.fn()} />);
    // construction_total = 4,000,000 base + 400,000 (10%) contingency =
    // 4,400,000p = £44,000; 5% of that = 220,000p = £2,200.00 -- a different
    // base AND a different amount than the pct_of_base_build case above.
    expect(within(feeRow('QS fee basis')).getByText(/of £44,000 = £2,200\.00/)).toBeInTheDocument();
  });

  it('switching a fee basis selector calls onChange with the new basis', () => {
    const inputs = feeTestInputs([
      { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
        basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false },
    ]);
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={onChange} />);

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Architect basis' }),
      { target: { value: 'pct_of_base_build' } },
    );

    const updated = (onChange.mock.calls[0][0].cost_plan.fee_lines as FeeLine[])
      .find((f) => f.id === 'f1')!;
    expect(updated.basis).toBe('pct_of_base_build');
  });
});

// I2's zeroing rule specifically: FeeLine's doc comments (cost-plan.ts) hard-
// validate amount_pence to 0 on a pct_* basis and pct to 0 on 'fixed'. A
// basis switch that forgot to zero the field the new basis does not use
// would either fail that validation immediately, or -- worse -- leave a
// stale figure that resurrects the moment the basis is switched back.
describe('ConversionCostsPage — a fee basis switch zeroes the field the new basis does not use (I2, fix round 1)', () => {
  it('zeroes amount_pence when switching FROM fixed TO a percentage basis', () => {
    const inputs = feeTestInputs([
      { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
        basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false },
    ]);
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={onChange} />);

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Architect basis' }),
      { target: { value: 'pct_of_base_build' } },
    );

    const updated = (onChange.mock.calls[0][0].cost_plan.fee_lines as FeeLine[])
      .find((f) => f.id === 'f1')!;
    expect(updated.basis).toBe('pct_of_base_build');
    // The discriminator: a bug that forgot to zero amount_pence would leave
    // 500,000 here.
    expect(updated.amount_pence).toBe(0);
  });

  it('zeroes pct when switching FROM a percentage basis TO fixed', () => {
    const inputs = feeTestInputs([
      { id: 'f2', code: 'other_professional', category: 'professional', label: 'QS fee',
        basis: 'pct_of_base_build', amount_pence: 0, pct: 6, per_dwelling: false },
    ]);
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={onChange} />);

    fireEvent.change(
      screen.getByRole('combobox', { name: 'QS fee basis' }),
      { target: { value: 'fixed' } },
    );

    const updated = (onChange.mock.calls[0][0].cost_plan.fee_lines as FeeLine[])
      .find((f) => f.id === 'f2')!;
    expect(updated.basis).toBe('fixed');
    // The discriminator: a bug that forgot to zero pct would leave 6 here.
    expect(updated.pct).toBe(0);
  });
});

// I3 (fix round 1, Important). A per_dwelling fixed fee's entered amount is
// PER dwelling; the engine multiplies by max(1, unit_count) (cost-plan.ts).
// Pin a document whose entered figure and resolved figure are provably
// different, so a component that only echoed the input would fail this.
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

describe('ConversionCostsPage — a per_dwelling fixed fee shows its resolved (multiplied) amount (I3, fix round 1)', () => {
  it('shows the resolved amount, not the per-dwelling figure typed in', () => {
    const base = defaultCalculatorInputsV7();
    const inputs: CalculatorInputsV7 = {
      ...base,
      unit_mix: { units: ['u1', 'u2', 'u3'].map(unit) },
      cost_plan: {
        ...base.cost_plan,
        fee_lines: [
          { id: 'pa', code: 'prior_approval', category: 'statutory', label: 'Prior approval fee',
            basis: 'fixed', amount_pence: 9_600, pct: 0, per_dwelling: true },
        ],
      },
    };
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={vi.fn()} />);
    // The typed-in per-dwelling figure (£96.00) IS visible (it's the editable
    // input), but the resolved 3-unit total (9,600 x 3 = 28,800p = £288.00)
    // must ALSO be shown -- a component that only echoed the input would not
    // render this string at all.
    expect(screen.getByDisplayValue('96')).toBeInTheDocument();
    expect(screen.getByText(/x 3 units = £288\.00/)).toBeInTheDocument();
  });
});
