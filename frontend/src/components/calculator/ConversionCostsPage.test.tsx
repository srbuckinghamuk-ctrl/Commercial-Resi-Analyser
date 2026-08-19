import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ConversionCostsPage from './ConversionCostsPage';
import { runAppraisal } from '../../lib/model';
import type { AppraisalRun, CalculatorInputsV7, CostPackage } from '../../lib/model';
import { defaultCalculatorInputsV7 } from '../../lib/conversion-defaults';

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

describe('ConversionCostsPage — reads cost figures from run.metrics.cost_plan, never recomputes them', () => {
  it('renders the contingency amount from the run, not from its own arithmetic', () => {
    const inputs = defaultCalculatorInputsV7();
    const run = runWithContingencyAmount(12_345_678);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByText(/123,456\.78/)).toBeInTheDocument();
  });

  // Task 9 Step 2's cross-site fixture: two packages ('Strip out' existing-
  // building, 'Structure' general) totalling the base build, three
  // contingency classes and two fee lines. funding_source is 'cash' so the
  // run needs nothing else to compute.
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
          { id: 'p2', code: 'structure', label: 'Structure', amount_pence: 3_000_000,
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

  it('shows the package grid in detailed mode and hides it in headline mode', () => {
    const inputs = detailedInputs();
    const props = { inputs, run: runAppraisal(inputs), onChange: vi.fn() };
    render(<ConversionCostsPage {...props} />);
    expect(screen.getByText('Structure')).toBeInTheDocument();
    // And the negative half — without it, a grid rendered unconditionally passes.
    cleanup();
    const headline: CalculatorInputsV7 = {
      ...inputs,
      cost_plan: { ...inputs.cost_plan, mode: 'headline' as const, packages: [] },
    };
    render(<ConversionCostsPage inputs={headline} run={runAppraisal(headline)} onChange={vi.fn()} />);
    expect(screen.queryByText('Structure')).not.toBeInTheDocument();
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
