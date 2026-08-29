import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import ConversionCostsPage from './ConversionCostsPage';
import { runAppraisal, migrateInputsToV16 } from '../../lib/model';
import type { AppraisalRun, CalculatorInputsV16, CostPackage, FeeLine } from '../../lib/model';
import { defaultCalculatorInputsV16 } from '../../lib/conversion-defaults';
import { DEFAULT_UNIT_ANCILLARY } from '../../lib/conversion-types';
import type { ProposedUnitV6 } from '../../lib/conversion-types';
import { ddDoc, QS } from '../../lib/model/__fixtures__/due-diligence-docs';
import { docZ, docZNoAllowance } from '../../lib/model/__fixtures__/cost-plan-in-time-docs';

// R15b Task 9 (spec §24.6). Fixture Q (fixtures/financial-model/q-detailed-cost-plan.json):
// detailed mode, `programme: null` -- the auto-path document the phase picker
// must show disabled on. Loaded the same way package-timing.test.ts's `load()`
// loads it: raw JSON through `migrateInputsToV16` (R16b Task 2 moved this on
// from `migrateInputsToV15`, which itself moved it on from `migrateInputsToV14`),
// never a hand-authored object.
const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
function docQ(): CalculatorInputsV16 {
  const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'q-detailed-cost-plan.json'), 'utf-8')) as {
    inputs: Record<string, unknown>;
  };
  return migrateInputsToV16(raw.inputs);
}

/**
 * R9 Task 10 fix round 1. The riskiest wiring point this page added: which
 * "Total construction m²" figure is shown, and whether it is editable,
 * depends entirely on `inputs.areas.basis`. Reuses the FULL_BRIDGE-shaped
 * numbers from `model/areas.test.ts` (existing 600, demolished 20, extension
 * 40, retained 100 -> developed 520) so the bridge-derived figure asserted
 * here (520) is the same one that suite already pins.
 */
function baseInputs(basis: 'manual' | 'bridge_derived'): CalculatorInputsV16 {
  const inputs = defaultCalculatorInputsV16();
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
  const inputs = defaultCalculatorInputsV16();
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
function detailedInputs(): CalculatorInputsV16 {
  const base = defaultCalculatorInputsV16();
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
          lender_eligible: true, notes: '', vat_override: null, phase_id: null, price_basis: null },
        { id: 'p2', code: 'structure', label: 'Structural frame', amount_pence: 3_000_000,
          contingency_class: 'general', lender_eligible: true, notes: '', vat_override: null, phase_id: null,
          price_basis: null },
      ],
      contingency: [
        { name: 'general', pct: 5 },
        { name: 'existing_building', pct: 15 },
        { name: 'abnormal', pct: 2.5 },
      ],
      fee_lines: [
        { id: 'f1', code: 'architect', category: 'professional', label: 'Architect',
          basis: 'pct_of_construction_total', amount_pence: 0, pct: 6, per_dwelling: false, vat_override: null,
          phase_id: null },
        { id: 'f2', code: 'cil_s106', category: 'statutory', label: 'CIL / S106',
          basis: 'fixed', amount_pence: 700_000, pct: 0, per_dwelling: false, vat_override: null,
          phase_id: null },
      ],
      qs: null,
    },
  };
}

describe('ConversionCostsPage — reads cost figures from run.metrics.cost_plan, never recomputes them', () => {
  it('renders the contingency amount from the run, not from its own arithmetic', () => {
    const inputs = defaultCalculatorInputsV16();
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
    const headline: CalculatorInputsV16 = {
      ...inputs,
      cost_plan: { ...inputs.cost_plan, mode: 'headline' as const, packages: [] },
    };
    render(<ConversionCostsPage inputs={headline} run={runAppraisal(headline)} onChange={vi.fn()} />);
    expect(screen.queryByDisplayValue('Structure')).not.toBeInTheDocument();
  });

  // R11 spec §17.8. The contingency-class select on each package row went live
  // this release (previously "recorded only" -- see the R10 comment this task
  // rewrote). Assert it writes ONLY the row it belongs to: a change handler
  // that updated every package (e.g. a stale closure over the wrong id) would
  // still pass a test that only checked the changed row.
  it("changing a package's contingency class select updates that package, and no other", () => {
    const inputs = detailedInputs(); // p1 tagged existing_building, p2 tagged general
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} run={runAppraisal(inputs)} onChange={onChange} />);

    const selects = screen.getAllByRole('combobox', { name: 'Package contingency class' });
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0], { target: { value: 'abnormal' } });

    expect(onChange).toHaveBeenCalledWith({
      cost_plan: {
        ...inputs.cost_plan,
        packages: [
          { ...inputs.cost_plan.packages[0], contingency_class: 'abnormal' },
          inputs.cost_plan.packages[1],
        ],
      },
    });
  });

  // §3.2.1 / §6. Switching to detailed mode on a document carrying compliance
  // allowances offers a one-click conversion into a single
  // fire_acoustic_thermal package. Assert the resulting package amount
  // equals the sum of the three compliance fields and that the three fields
  // are zeroed -- the money is visibly moved, not silently dropped or
  // duplicated -- and that it happens through the SAME onChange every other
  // edit on this page uses, not a second code path.
  it('offers to convert compliance allowances into a package when switching to detailed mode', () => {
    const base = defaultCalculatorInputsV16();
    const inputs: CalculatorInputsV16 = {
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
    const inputs = defaultCalculatorInputsV16(); // compliance fields are 0 by default
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
    const base = defaultCalculatorInputsV16();
    const inputs: CalculatorInputsV16 = {
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
    const zeroed: CalculatorInputsV16 = {
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
function feeTestInputs(feeLines: FeeLine[]): CalculatorInputsV16 {
  const base = defaultCalculatorInputsV16();
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
        basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false, vat_override: null,
        phase_id: null },
    ]);
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} run={run} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('5000')).toBeInTheDocument(); // 500,000p -> £5,000
    expect(within(feeRow('Architect basis')).queryByText(/of £/)).not.toBeInTheDocument();
  });

  it('renders a pct_of_base_build fee with the resolved base and amount read from the run', () => {
    const inputs = feeTestInputs([
      { id: 'f2', code: 'other_professional', category: 'professional', label: 'QS fee',
        basis: 'pct_of_base_build', amount_pence: 0, pct: 5, per_dwelling: false, vat_override: null,
        phase_id: null },
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
        basis: 'pct_of_construction_total', amount_pence: 0, pct: 5, per_dwelling: false, vat_override: null,
        phase_id: null },
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
        basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false, vat_override: null,
        phase_id: null },
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
        basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false, vat_override: null,
        phase_id: null },
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
        basis: 'pct_of_base_build', amount_pence: 0, pct: 6, per_dwelling: false, vat_override: null,
        phase_id: null },
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
    const base = defaultCalculatorInputsV16();
    const inputs: CalculatorInputsV16 = {
      ...base,
      unit_mix: { units: ['u1', 'u2', 'u3'].map(unit) },
      cost_plan: {
        ...base.cost_plan,
        fee_lines: [
          { id: 'pa', code: 'prior_approval', category: 'statutory', label: 'Prior approval fee',
            basis: 'fixed', amount_pence: 9_600, pct: 0, per_dwelling: true, vat_override: null,
            phase_id: null },
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

// R11 Task 14 (spec §17.2 rule 3). If no UI writes `vat_override`, the schema
// carries a mechanism nothing writes -- the exact defect R10 shipped
// (`contingency_class`). Detailed-mode package and fee rows get an override
// control that writes `vat_override` on that ONE row and clears it to `null`,
// never a zeroed object.
describe('ConversionCostsPage — per-line VAT override control (spec §17.2 rule 3)', () => {
  it('setting an override on one package writes vat_override on that package and leaves every other package null', () => {
    const inputs = detailedInputs();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByRole('button', { name: /add vat override — strip out/i }));

    const updated = onChange.mock.calls[0][0].cost_plan.packages as CostPackage[];
    expect(updated.find((p) => p.id === 'p1')!.vat_override).not.toBeNull();
    expect(updated.find((p) => p.id === 'p2')!.vat_override).toBeNull();
  });

  it('clearing a package override writes null, not a zeroed object', () => {
    const inputs = detailedInputs();
    inputs.cost_plan.packages[0].vat_override = { rate_pct: 5, recoverable_pct: 50, recovery_basis: 'partial_exemption' };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByRole('button', { name: /clear vat override — strip out/i }));

    const updated = onChange.mock.calls[0][0].cost_plan.packages as CostPackage[];
    const p1 = updated.find((p) => p.id === 'p1')!;
    expect(p1.vat_override).toBeNull();
    // Not a zeroed object -- an object with all-zero fields would also pass a
    // naive `!p1.vat_override.rate_pct` check but is NOT what the spec asks for.
    expect(p1.vat_override).not.toEqual({ rate_pct: 0, recoverable_pct: 0, recovery_basis: 'unconfirmed' });
  });

  it('editing an active package override writes the changed field only, on that package', () => {
    const inputs = detailedInputs();
    inputs.cost_plan.packages[0].vat_override = { rate_pct: 5, recoverable_pct: 50, recovery_basis: 'partial_exemption' };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: /strip out vat override rate %/i }), { target: { value: '12' } });

    const updated = onChange.mock.calls[0][0].cost_plan.packages as CostPackage[];
    const p1 = updated.find((p) => p.id === 'p1')!;
    expect(p1.vat_override).toEqual({ rate_pct: 12, recoverable_pct: 50, recovery_basis: 'partial_exemption' });
    expect(updated.find((p) => p.id === 'p2')!.vat_override).toBeNull();
  });

  it('setting an override on one fee line writes vat_override on that fee and leaves the other fee null', () => {
    const inputs = detailedInputs();
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByRole('button', { name: /add vat override — architect/i }));

    const updated = onChange.mock.calls[0][0].cost_plan.fee_lines as FeeLine[];
    expect(updated.find((f) => f.id === 'f1')!.vat_override).not.toBeNull();
    expect(updated.find((f) => f.id === 'f2')!.vat_override).toBeNull();
  });

  it('clearing a fee line override writes null', () => {
    const inputs = detailedInputs();
    inputs.cost_plan.fee_lines[0].vat_override = { rate_pct: 20, recoverable_pct: 100, recovery_basis: 'zero_rated_sale' };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByRole('button', { name: /clear vat override — architect/i }));

    const updated = onChange.mock.calls[0][0].cost_plan.fee_lines as FeeLine[];
    expect(updated.find((f) => f.id === 'f1')!.vat_override).toBeNull();
  });

  it('does not render the override control in headline mode', () => {
    const inputs = defaultCalculatorInputsV16();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.queryByText(/vat override/i)).not.toBeInTheDocument();
  });
});

// R15 Task 10, spec §23.6. QS provenance card and per-package price basis.
describe('ConversionCostsPage — QS provenance card (spec 23.6)', () => {
  it('shows "No QS recorded" checked when cost_plan.qs is null', () => {
    const inputs = detailedInputs(); // qs: null
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getByLabelText('No QS recorded')).toBeChecked();
    expect(screen.queryByLabelText('QS source')).not.toBeInTheDocument();
  });

  it('shows "No QS recorded" unchecked, and the editable fields, when cost_plan.qs is set', () => {
    const inputs: CalculatorInputsV16 = { ...detailedInputs(), cost_plan: { ...detailedInputs().cost_plan, qs: QS } };
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getByLabelText('No QS recorded')).not.toBeChecked();
    expect(screen.getByLabelText('QS source')).toHaveValue('Gardiner & Theobald');
  });

  it('unchecking "No QS recorded" writes the seeded QS record', () => {
    const inputs = detailedInputs(); // qs: null
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByLabelText('No QS recorded'));

    expect(onChange).toHaveBeenCalledWith({
      cost_plan: {
        ...inputs.cost_plan,
        qs: { source: '', stage: 'order_of_cost', date: '', status: 'draft', base_date: '', inflation: null },
      },
    });
  });

  it('checking "No QS recorded" writes qs: null', () => {
    const inputs: CalculatorInputsV16 = { ...detailedInputs(), cost_plan: { ...detailedInputs().cost_plan, qs: QS } };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.click(screen.getByLabelText('No QS recorded'));

    expect(onChange).toHaveBeenCalledWith({ cost_plan: { ...inputs.cost_plan, qs: null } });
  });

  it('editing the QS source writes through, leaving the other QS fields untouched', () => {
    const inputs: CalculatorInputsV16 = { ...detailedInputs(), cost_plan: { ...detailedInputs().cost_plan, qs: QS } };
    const run = runAppraisal(inputs);
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={run} />);

    fireEvent.change(screen.getByLabelText('QS source'), { target: { value: 'Turner & Townsend' } });

    expect(onChange).toHaveBeenCalledWith({
      cost_plan: { ...inputs.cost_plan, qs: { ...QS, source: 'Turner & Townsend' } },
    });
  });

  it('shows the rule-8 issue text when run.validation carries it', () => {
    const inputs: CalculatorInputsV16 = {
      ...detailedInputs(),
      cost_plan: { ...detailedInputs().cost_plan, qs: { ...QS, source: '' } },
    };
    const run = runAppraisal(inputs);
    expect(run.validation.some((i) => i.field === 'cost_plan.qs.source')).toBe(true);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.getByText('QS provenance needs a source.')).toBeInTheDocument();
  });

  it('shows no rule-8 issue text on a valid QS record', () => {
    const inputs: CalculatorInputsV16 = { ...detailedInputs(), cost_plan: { ...detailedInputs().cost_plan, qs: QS } };
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.queryByText('QS provenance needs a source.')).not.toBeInTheDocument();
  });
});

describe('ConversionCostsPage — per-package price basis (spec 23.6)', () => {
  it('lists Unset / Fixed price / Provisional sum / Estimate, selected at Unset for a null price_basis', () => {
    const inputs = detailedInputs(); // both packages price_basis: null
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    const selects = screen.getAllByRole('combobox', { name: 'Package price basis' });
    expect(selects).toHaveLength(2);
    const options = within(selects[0]).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Unset', 'Fixed price', 'Provisional sum', 'Estimate']);
    expect(selects[0]).toHaveValue('');
  });

  it('changing a price basis select writes price_basis on that package only', () => {
    const inputs = detailedInputs(); // p1, p2, both price_basis: null
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    const selects = screen.getAllByRole('combobox', { name: 'Package price basis' });
    fireEvent.change(selects[0], { target: { value: 'fixed_price' } });

    expect(onChange).toHaveBeenCalledWith({
      cost_plan: {
        ...inputs.cost_plan,
        packages: [
          { ...inputs.cost_plan.packages[0], price_basis: 'fixed_price' },
          inputs.cost_plan.packages[1],
        ],
      },
    });
  });

  it('writes price_basis: null when switching a select back to Unset', () => {
    const inputs = detailedInputs();
    inputs.cost_plan.packages[0].price_basis = 'estimate';
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    const selects = screen.getAllByRole('combobox', { name: 'Package price basis' });
    fireEvent.change(selects[0], { target: { value: '' } });

    const updated = (onChange.mock.calls[0][0].cost_plan.packages as CostPackage[])
      .find((p) => p.id === 'p1')!;
    expect(updated.price_basis).toBeNull();
  });

  it('newPackage() seeds price_basis: null', () => {
    const inputs = detailedInputs();
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add package' }));

    const packages = onChange.mock.calls[0][0].cost_plan.packages as CostPackage[];
    expect(packages[packages.length - 1].price_basis).toBeNull();
  });
});

// R15 Task 10, spec §23.6. Fixture Y: detailed mode, three packages tagged
// fixed_price (12,000,000p) / provisional_sum (8,000,000p) / null
// (6,000,000p, unclassified), base build 26,000,000p -- 46.15% / 30.77% /
// £60,000, exactly as `PriceBasisSummary` computes it (cost-plan.ts).
describe('ConversionCostsPage — price basis coverage line (spec 23.6)', () => {
  it('prints the coverage line from run.metrics.cost_plan.price_basis on fixture Y', () => {
    const inputs = ddDoc();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    // R15b Task 9 (spec §24.6). ddDoc()'s QS carries no inflation allowance
    // (QS.inflation is null, __fixtures__/due-diligence-docs.ts), so the
    // appended clause is £0.00 at 0.00% of base build -- the coverage line's
    // OWN suffix, not a re-derivation of the figures already asserted above.
    expect(screen.getByText(
      'Fixed-price coverage 46.15% · provisional sums 30.77% · unclassified £60,000 · '
      + 'inflation to spend midpoints £0.00 (0.00% of base build)',
    )).toBeInTheDocument();
  });

  it('is absent in headline mode', () => {
    const inputs = defaultCalculatorInputsV16(); // headline, no packages
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    expect(screen.queryByText(/Fixed-price coverage/)).not.toBeInTheDocument();
  });

  // R15b Task 9 (spec §24.6). `inflation_total_pence` / `inflation_pct_of_base_build`
  // are read verbatim off `run.metrics.cost_plan` -- fixture Z's hand-derived
  // worksheet figures (cost-plan.test.ts's own §24.3 describe block), never
  // recomputed here.
  it('appends the inflation clause on fixture Z', () => {
    const inputs = docZ();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);
    const line = screen.getByText(/inflation to spend midpoints/);
    expect(line.textContent).toContain('inflation to spend midpoints £54,967.22 (8.33% of base build)');
  });
});

// R15b Task 9 (spec §24.6). The phase picker on packages and fee lines.
// Fixture Z's programme is a phase network with 15 phases; two carry
// duration_months 0 (`practical_completion`, `maturity_tail`) and must NOT be
// offered as a tag target -- a zero-duration phase has no window to place a
// spend midpoint inside. `category_phase_ids` names 'construction' (label
// "Main construction") as every package's category default, 'design'
// ("Technical design") as every professional fee's, and 'conditions'
// ("Discharge of conditions") as every statutory fee's.
describe('ConversionCostsPage — package/fee-line phase picker (spec 24.6)', () => {
  it('lists the category default plus every duration >= 1 phase, excluding the two milestones', () => {
    const inputs = docZ();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    const selects = screen.getAllByRole('combobox', { name: 'Package phase' });
    expect(selects).toHaveLength(inputs.cost_plan.packages.length);
    const options = within(selects[0]).getAllByRole('option').map((o) => o.textContent);
    expect(options[0]).toBe('Category default — Main construction');
    expect(options).toContain('Main construction (construction)');
    expect(options).toContain('Enabling works and strip-out (strip_out)');
    expect(options).toContain('M&E fit-out (mande_fitout)');
    expect(options.some((t) => t?.includes('practical_completion'))).toBe(false);
    expect(options.some((t) => t?.includes('maturity_tail'))).toBe(false);
    expect(options).toHaveLength(14); // 1 default + 13 phases with duration_months >= 1
  });

  it('choosing a phase on a package row writes phase_id on that package only', () => {
    const inputs = docZ();
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    const selects = screen.getAllByRole('combobox', { name: 'Package phase' });
    const structureIndex = inputs.cost_plan.packages.findIndex((p) => p.id === 'pkg-structure');
    fireEvent.change(selects[structureIndex], { target: { value: 'mande_fitout' } });

    const updated = (onChange.mock.calls[0][0].cost_plan.packages as CostPackage[])
      .find((p) => p.id === 'pkg-structure')!;
    expect(updated.phase_id).toBe('mande_fitout');
    // Every other package is untouched.
    const others = (onChange.mock.calls[0][0].cost_plan.packages as CostPackage[])
      .filter((p) => p.id !== 'pkg-structure');
    others.forEach((p, i) => {
      const original = inputs.cost_plan.packages.filter((pp) => pp.id !== 'pkg-structure')[i];
      expect(p).toEqual(original);
    });
  });

  it('choosing the category default on a package row writes phase_id: null', () => {
    const inputs = docZ();
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    const selects = screen.getAllByRole('combobox', { name: 'Package phase' });
    const enablingIndex = inputs.cost_plan.packages.findIndex((p) => p.id === 'pkg-enabling');
    fireEvent.change(selects[enablingIndex], { target: { value: '' } });

    const updated = (onChange.mock.calls[0][0].cost_plan.packages as CostPackage[])
      .find((p) => p.id === 'pkg-enabling')!;
    expect(updated.phase_id).toBeNull();
  });

  it('fee-line rows carry the same "Fee line phase" control, category-scoped default', () => {
    const inputs = docZ();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    const selects = screen.getAllByRole('combobox', { name: 'Fee line phase' });
    expect(selects).toHaveLength(inputs.cost_plan.fee_lines.length);
    const architectIndex = inputs.cost_plan.fee_lines.findIndex((f) => f.id === 'fee-architect');
    const architectOptions = within(selects[architectIndex]).getAllByRole('option').map((o) => o.textContent);
    expect(architectOptions[0]).toBe('Category default — Technical design');

    const priorApprovalIndex = inputs.cost_plan.fee_lines.findIndex((f) => f.id === 'fee-prior-approval');
    const priorApprovalOptions = within(selects[priorApprovalIndex]).getAllByRole('option')
      .map((o) => o.textContent);
    expect(priorApprovalOptions[0]).toBe('Category default — Discharge of conditions');
  });

  it('choosing a phase on a fee-line row writes phase_id on that fee line only', () => {
    const inputs = docZ();
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    const selects = screen.getAllByRole('combobox', { name: 'Fee line phase' });
    const architectIndex = inputs.cost_plan.fee_lines.findIndex((f) => f.id === 'fee-architect');
    fireEvent.change(selects[architectIndex], { target: { value: 'design' } });

    const updated = (onChange.mock.calls[0][0].cost_plan.fee_lines as FeeLine[])
      .find((f) => f.id === 'fee-architect')!;
    expect(updated.phase_id).toBe('design');
  });

  it('choosing the category default on a fee-line row writes phase_id: null', () => {
    const inputs = docZ();
    inputs.cost_plan.fee_lines.find((f) => f.id === 'fee-prior-approval')!.phase_id = 'planning';
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    const selects = screen.getAllByRole('combobox', { name: 'Fee line phase' });
    const priorApprovalIndex = inputs.cost_plan.fee_lines.findIndex((f) => f.id === 'fee-prior-approval');
    fireEvent.change(selects[priorApprovalIndex], { target: { value: '' } });

    const updated = (onChange.mock.calls[0][0].cost_plan.fee_lines as FeeLine[])
      .find((f) => f.id === 'fee-prior-approval')!;
    expect(updated.phase_id).toBeNull();
  });

  // Fixture Q: detailed mode, `programme: null` -- the auto path. Both
  // controls must be disabled rather than silently offering phases that do
  // not exist, and the hint renders exactly once above the grid, not per row.
  it('disables every phase select and shows the hint exactly once on an auto-path document (Q)', () => {
    const inputs = docQ();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    const packageSelects = screen.getAllByRole('combobox', { name: 'Package phase' });
    const feeSelects = screen.getAllByRole('combobox', { name: 'Fee line phase' });
    expect(packageSelects.length).toBeGreaterThan(0);
    expect(feeSelects.length).toBeGreaterThan(0);
    [...packageSelects, ...feeSelects].forEach((s) => expect(s).toBeDisabled());
    expect(screen.getAllByText('Tag lines to phases once the programme is a phase network'))
      .toHaveLength(1);
  });
});

// R15b Task 9 (spec §24.6). Timing cells: three read-only figures per package
// row, read from `run.metrics.cost_plan.packages`, never recomputed.
// Fixture Z's pkg-enabling is on `strip_out` (window 6-8, midpoint 6.5,
// inflation 375,460p) -- cost-plan.test.ts's own §24.3 describe block pins
// the same figures from `computeCostPlan` directly.
describe('ConversionCostsPage — package timing cells (spec 24.6)', () => {
  it('prints the window, midpoint and inflation for pkg-enabling on fixture Z', () => {
    const inputs = docZ();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    expect(screen.getByText('6–8')).toBeInTheDocument();
    expect(screen.getByText('6.50')).toBeInTheDocument();
    expect(screen.getByText('£3,754.60')).toBeInTheDocument();
  });
});

// R15b Task 9 (spec §24.6). The QS card's inflation control. `docZ()` carries
// `annual_pct: 6`; `docZNoAllowance()` is the same document with the
// allowance cleared to `null` (__fixtures__/cost-plan-in-time-docs.ts).
describe('ConversionCostsPage — QS inflation allowance control (spec 24.6)', () => {
  it('on fixture Z (allowance present): unchecked, with the % input at 6', () => {
    const inputs = docZ();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    expect(screen.getByLabelText('No inflation allowance')).not.toBeChecked();
    expect(screen.getByLabelText('Tender-price inflation % p.a.')).toHaveValue(6);
  });

  it('checking "No inflation allowance" on fixture Z writes inflation: null', () => {
    const inputs = docZ();
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    fireEvent.click(screen.getByLabelText('No inflation allowance'));

    expect(onChange).toHaveBeenCalledWith({
      cost_plan: { ...inputs.cost_plan, qs: { ...inputs.cost_plan.qs, inflation: null } },
    });
  });

  it('on fixture Z with no allowance: checked, and no % input shown', () => {
    const inputs = docZNoAllowance();
    const run = runAppraisal(inputs);
    render(<ConversionCostsPage inputs={inputs} onChange={vi.fn()} run={run} />);

    expect(screen.getByLabelText('No inflation allowance')).toBeChecked();
    expect(screen.queryByLabelText('Tender-price inflation % p.a.')).not.toBeInTheDocument();
  });

  it('unchecking "No inflation allowance" on the no-allowance document seeds { annual_pct: 0 }', () => {
    const inputs = docZNoAllowance();
    const onChange = vi.fn();
    render(<ConversionCostsPage inputs={inputs} onChange={onChange} run={runAppraisal(inputs)} />);

    fireEvent.click(screen.getByLabelText('No inflation allowance'));

    expect(onChange).toHaveBeenCalledWith({
      cost_plan: { ...inputs.cost_plan, qs: { ...inputs.cost_plan.qs, inflation: { annual_pct: 0 } } },
    });
  });
});
