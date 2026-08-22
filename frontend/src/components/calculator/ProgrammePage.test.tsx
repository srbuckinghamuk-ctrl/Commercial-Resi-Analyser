import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProgrammePage from './ProgrammePage';
import { runAppraisal, migrateV8toV9 } from '../../lib/model';
import type {
  CalculatorInputsV8, CalculatorInputsV9, ProgrammeInputs, ProgrammeNetwork,
} from '../../lib/model';
import { defaultCalculatorInputsV8 } from '../../lib/conversion-defaults';
import { penceToPounds } from '../../lib/format';

function buildInputsV8(overrides: Partial<CalculatorInputsV8> = {}): CalculatorInputsV8 {
  const base = defaultCalculatorInputsV8();
  return { ...base, ...overrides };
}

function buildInputsV9(overrides: Partial<CalculatorInputsV9> = {}): CalculatorInputsV9 {
  // migrateV8toV9 on the plain default document -- `programme` comes back
  // null (the default V8 document carries no explicit programme), so this is
  // an ordinary, hard-won-correct v9 document a test can freely overwrite
  // `.programme` on, exactly the way schedule.test.ts's own baseNetworkDoc()
  // fixture does.
  const v9 = migrateV8toV9(defaultCalculatorInputsV8());
  return { ...v9, ...overrides };
}

function setup<T extends CalculatorInputsV8 | CalculatorInputsV9>(inputs: T, onChange = vi.fn()) {
  const run = runAppraisal(inputs);
  render(<ProgrammePage inputs={inputs} onChange={onChange} run={run} />);
  return { onChange, run };
}

// Two predecessor-free... no, `construction` depends FS on `design` -- a real
// dependency, so the derivation exercises the forward pass, not just floors.
// design [0,2), construction starts at finish(design)=2, runs 8 -> [2,10).
// Distinct durations/starts throughout so a query can target one cell.
const NETWORK: ProgrammeNetwork = {
  anchor_month: null,
  phases: [
    {
      id: 'design', code: 'design', label: 'Design', duration_months: 2, slip_months: 0,
      start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [],
    },
    {
      id: 'construction', code: 'construction', label: 'Construction', duration_months: 8, slip_months: 0,
      start_offset: 0, curve: { kind: 'straight_line' },
      predecessors: [{ phase_id: 'design', type: 'FS', lag_months: 0 }],
    },
  ],
  category_phase_ids: { construction: 'construction', professional: 'design', statutory: 'design' },
};

const CYCLIC_NETWORK: ProgrammeNetwork = {
  anchor_month: null,
  phases: [
    {
      id: 'a', code: 'other', label: 'A', duration_months: 1, slip_months: 0, start_offset: 0,
      curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'b', type: 'FS', lag_months: 0 }],
    },
    {
      id: 'b', code: 'other', label: 'B', duration_months: 1, slip_months: 0, start_offset: 0,
      curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'a', type: 'FS', lag_months: 0 }],
    },
  ],
  category_phase_ids: { construction: 'a', professional: 'a', statutory: 'a' },
};

const LEGACY_PROGRAMME: ProgrammeInputs = {
  anchor_month: '2026-01',
  packages: {
    construction: { start_offset: 1, duration_months: 5, curve: { kind: 'straight_line' } },
    professional: { start_offset: 2, duration_months: 2, curve: { kind: 'straight_line' } },
    statutory: { start_offset: 3, duration_months: 3, curve: { kind: 's_curve' } },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProgrammePage — programme === null (auto windows)', () => {
  it('renders the auto-windows explanation and a "Build phase network" button', () => {
    setup(buildInputsV8({ programme: null }));
    expect(screen.getByText(/auto windows/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /build phase network/i })).toBeInTheDocument();
  });

  it('confirming builds a default template network (term 12) and calls onChange once', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChange } = setup(buildInputsV8({ programme: null })); // default term_months === 12
    fireEvent.click(screen.getByRole('button', { name: /build phase network/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        anchor_month: null,
        phases: [
          {
            id: 'construction', code: 'construction', label: 'Construction', duration_months: 10,
            slip_months: 0, start_offset: 1, curve: { kind: 'straight_line' }, predecessors: [],
          },
          {
            id: 'professional', code: 'design', label: 'Professional', duration_months: 5,
            slip_months: 0, start_offset: 1, curve: { kind: 'straight_line' }, predecessors: [],
          },
          {
            id: 'statutory', code: 'planning', label: 'Statutory', duration_months: 5,
            slip_months: 0, start_offset: 1, curve: { kind: 'straight_line' }, predecessors: [],
          },
        ],
        category_phase_ids: { construction: 'construction', professional: 'professional', statutory: 'statutory' },
      },
    });
  });

  it('cancelling the confirmation does NOT fire onChange', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onChange } = setup(buildInputsV8({ programme: null }));
    fireEvent.click(screen.getByRole('button', { name: /build phase network/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables "Build phase network" with a note when term < 3 (sale-tail rule)', () => {
    setup(buildInputsV8({
      programme: null,
      finance: { ...defaultCalculatorInputsV8().finance, term_months: 2 },
    }));
    const button = screen.getByRole('button', { name: /build phase network/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/sale.tail/i)).toBeInTheDocument();
  });
});

describe('ProgrammePage — legacy { packages } programme (v4-v8)', () => {
  it('offers a conversion prompt, not the retired inline package editor', () => {
    setup(buildInputsV8({ programme: LEGACY_PROGRAMME }));
    expect(screen.getByText(/legacy three-package programme/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /convert to phase network/i })).toBeInTheDocument();
    // The retired UI's own control must not survive under a new name either.
    expect(screen.queryByRole('button', { name: /revert to auto windows/i })).not.toBeInTheDocument();
  });

  it('confirming converts the three packages to phases with the migration\'s own ids and codes', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onChange } = setup(buildInputsV8({ programme: LEGACY_PROGRAMME }));
    fireEvent.click(screen.getByRole('button', { name: /convert to phase network/i }));
    expect(onChange).toHaveBeenCalledWith({
      programme: {
        anchor_month: '2026-01',
        phases: [
          {
            id: 'construction', code: 'construction', label: 'Construction', duration_months: 5,
            slip_months: 0, start_offset: 1, curve: { kind: 'straight_line' }, predecessors: [],
          },
          {
            id: 'professional', code: 'design', label: 'Professional', duration_months: 2,
            slip_months: 0, start_offset: 2, curve: { kind: 'straight_line' }, predecessors: [],
          },
          {
            id: 'statutory', code: 'planning', label: 'Statutory', duration_months: 3,
            slip_months: 0, start_offset: 3, curve: { kind: 's_curve' }, predecessors: [],
          },
        ],
        category_phase_ids: { construction: 'construction', professional: 'professional', statutory: 'statutory' },
      },
    });
  });

  it('cancelling the conversion does NOT fire onChange', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onChange } = setup(buildInputsV8({ programme: LEGACY_PROGRAMME }));
    fireEvent.click(screen.getByRole('button', { name: /convert to phase network/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ProgrammePage — v9 phase network', () => {
  it('renders the phase editor and the Gantt, with no failure panel', () => {
    setup(buildInputsV9({ programme: NETWORK }));
    expect(screen.getByRole('table', { name: 'Phases' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Programme Gantt' })).toBeInTheDocument();
    expect(screen.queryByText(/dependency cycle/i)).not.toBeInTheDocument();
  });

  it('editing the anchor month calls onChange with the updated network', () => {
    const { onChange } = setup(buildInputsV9({ programme: NETWORK }));
    fireEvent.change(screen.getByLabelText(/anchor month/i), { target: { value: '2027-03' } });
    expect(onChange).toHaveBeenCalledWith({ programme: { ...NETWORK, anchor_month: '2027-03' } });
  });

  it('adding a phase through the embedded editor reaches onChange as an updated programme.phases', () => {
    const { onChange } = setup(buildInputsV9({ programme: NETWORK }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add phase' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const written = onChange.mock.calls[0][0] as { programme: ProgrammeNetwork };
    expect(written.programme.phases).toHaveLength(3);
    expect(written.programme.phases[2]).toEqual(expect.objectContaining({
      slip_months: 0, start_offset: 0, predecessors: [],
    }));
  });
});

describe('ProgrammePage — a cyclic v9 network (spec §18.2 "Cycles")', () => {
  it('renders the validation error and no Gantt bars, while keeping the editor open to fix it', () => {
    setup(buildInputsV9({ programme: CYCLIC_NETWORK }));
    expect(screen.getByText(/Phase dependency cycle: a → b → a\./)).toBeInTheDocument();
    // No half-drawn chart, no zeroes: the Gantt does not mount at all.
    expect(screen.queryByRole('table', { name: 'Programme Gantt' })).not.toBeInTheDocument();
    // The editor itself stays up -- otherwise there is no way to fix the cycle.
    expect(screen.getByRole('table', { name: 'Phases' })).toBeInTheDocument();
  });
});

describe('ProgrammePage — spend preview', () => {
  // Distinctive, non-colliding totals: all three packages placed in month 1 only
  // (duration 1), so each package's full total lands in a single, uniquely
  // identifiable cell. Deliberately using the LEGACY (v8) programme shape here
  // -- the spend preview reads run.schedule.uses regardless of which of the
  // three programme states produced it, and this is the shape closest to the
  // pre-R12 fixture this test descends from.
  const SPEND_PROGRAMME: ProgrammeInputs = {
    anchor_month: null,
    packages: {
      construction: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
      professional: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
      statutory: { start_offset: 1, duration_months: 1, curve: { kind: 'straight_line' } },
    },
  };

  it('renders one row per month from run.schedule.uses (engine output, not local math)', () => {
    const inputs = buildInputsV8({
      programme: SPEND_PROGRAMME,
      conversion_costs: {
        ...defaultCalculatorInputsV8().conversion_costs,
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
