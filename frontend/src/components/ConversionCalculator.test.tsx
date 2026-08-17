import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project, FinancialAppraisal } from '../types';

// Only the network boundary is stubbed. The engine is the real one: the tests
// below make it throw by driving the real UI, so they prove the component
// survives a genuine `runAppraisal` failure rather than a simulated one.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getAppraisal: vi.fn().mockRejectedValue(new actual.ApiError(404, 'not found', null)),
    saveAppraisal: vi.fn(),
  };
});

const { default: ConversionCalculator } = await import('./ConversionCalculator');
const { getAppraisal, saveAppraisal } = await import('../lib/api');
const { defaultCalculatorInputsV4, defaultCalculatorInputsV5 } = await import('../lib/conversion-defaults');

const PROJECT: Project = {
  id: 'p1',
  address_raw: '1 Test Street, Testville TS1 1TS',
  postcode: 'TS1 1TS',
  price_pence: 40000000,
  floor_area_sqm: 400,
  use_class: 'office',
  stage: 'opportunity_identified',
} as unknown as Project;

/** Sets the Finance page's facility term. 1e21 months makes the real engine
 * throw a RangeError building the schedule (`Array.from({length: 1e21})`) —
 * the class of failure that used to unmount the whole calculator. */
function setFacilityTerm(value: string): void {
  fireEvent.click(screen.getByRole('button', { name: /4\. Finance/ }));
  fireEvent.change(screen.getByDisplayValue('12'), { target: { value } });
}

describe('ConversionCalculator when the engine cannot compute', () => {
  // React logs the caught render error; keep the output pristine without
  // hiding an unexpected error from another test.
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  beforeEach(() => consoleErrorSpy.mockClear());
  afterEach(() => consoleErrorSpy.mockClear());

  it('keeps the calculator mounted and shows a recovery panel instead of unmounting', () => {
    render(<ConversionCalculator project={PROJECT} />);
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();

    setFacilityTerm('1e21');

    // The chrome survives: the nav is still there, so the component did not
    // unmount and its unsaved state is intact.
    expect(screen.getByRole('button', { name: /5\. Programme/ })).toBeInTheDocument();
    expect(screen.getByText(/appraisal could not be calculated/i)).toBeInTheDocument();
  });

  it('disables saving while the appraisal cannot be calculated', () => {
    render(<ConversionCalculator project={PROJECT} />);
    const saveButton = screen.getByRole('button', { name: /save appraisal|update appraisal/i });
    expect(saveButton).toBeEnabled();

    setFacilityTerm('1e21');

    expect(screen.getByRole('button', { name: /save appraisal|update appraisal/i })).toBeDisabled();
  });

  it('restores the last inputs that calculated when the user undoes the change', () => {
    render(<ConversionCalculator project={PROJECT} />);
    setFacilityTerm('1e21');
    expect(screen.getByText(/appraisal could not be calculated/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /undo last change/i }));

    // Back on a computable document: the Finance page renders again with the
    // term it had before the change, and saving is possible once more.
    expect(screen.queryByText(/appraisal could not be calculated/i)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save appraisal|update appraisal/i })).toBeEnabled();
  });

  it('never shows a stale calculation alongside the failure (spec §2)', () => {
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: /7\. Appraisal/ }));
    // A computable document shows real metric cards.
    expect(screen.getByText('Developer GDV')).toBeInTheDocument();

    setFacilityTerm('1e21');

    // Once it cannot compute, the previous run must not remain on screen.
    expect(screen.queryByText('Developer GDV')).not.toBeInTheDocument();
  });
});

describe('ConversionCalculator — Sensitivity is page 9', () => {
  it('offers thirteen numbered pages with Sensitivity ninth', () => {
    render(<ConversionCalculator project={PROJECT} />);
    for (const label of [
      '9. Sensitivity', '10. Exit', '11. Risk', '12. Deal Spider', '13. Investor',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the Sensitivity page when its tab is selected', () => {
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: '9. Sensitivity' }));
    expect(screen.getByRole('heading', { name: /9\. Sensitivity/ })).toBeInTheDocument();
  });
});

// R8 Task 10 fix round 1: this is the flag-day load path every existing
// appraisal goes through -- a stored v4 snapshot, migrated to v5 on load
// (ConversionCalculator.tsx's getAppraisal(...).then(...) handler). It had
// zero coverage: the module-level mock above always rejects getAppraisal
// with 404, so this branch never ran in any prior test.
describe('ConversionCalculator loads a stored v4 snapshot onto v5 (R8 Task 10)', () => {
  function storedV4Appraisal(): FinancialAppraisal {
    const v4Snapshot = defaultCalculatorInputsV4(PROJECT);
    return {
      id: 'a1',
      project_id: 'p1',
      name: 'Stored appraisal',
      inputs_snapshot: v4Snapshot as unknown as Record<string, unknown>,
      gdv_pence: null,
      total_cost_pence: null,
      profit_on_cost_pct: null,
      profit_on_gdv_pct: null,
      return_on_equity_pct: null,
      irr: null,
      rlv_pence: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  it('migrates the snapshot to v5 and renders it without an error, not a load failure', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());

    render(<ConversionCalculator project={PROJECT} />);

    // savedId is only set inside the .then() branch, after setInputs(migrateInputsToV5(...))
    // succeeds -- if that call threw (as migrateInputsToV4 would on a v5
    // document), the promise chain's .catch() would run instead and the
    // button would stay "Save Appraisal". Finding "Update Appraisal" is
    // proof the v4->v5 migration executed cleanly on load.
    expect(
      await screen.findByRole('button', { name: /update appraisal/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to load the saved appraisal/i)).not.toBeInTheDocument();
  });

  it('the migrated state carries the six R8 acquisition fields at their migrated defaults', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());
    vi.mocked(saveAppraisal).mockResolvedValueOnce(storedV4Appraisal());

    render(<ConversionCalculator project={PROJECT} />);
    await screen.findByRole('button', { name: /update appraisal/i });

    // handleSave spreads the current `inputs` state as-is into inputs_snapshot
    // (ConversionCalculator.tsx: `inputs_snapshot: inputs as unknown as Record<string,
    // unknown>`) -- it is not rebuilt from the v4 type the component declares for
    // its own state, so the six fields migrateInputsToV5 added are still on the
    // runtime object even though this component's state type doesn't model them
    // yet (Task 11 widens it). Inspecting the real payload sent to saveAppraisal
    // is therefore the direct way to prove they made it through the load, not a
    // rendered string (nothing in the UI shows them until Task 11).
    fireEvent.click(screen.getByRole('button', { name: /update appraisal/i }));
    await waitFor(() => expect(saveAppraisal).toHaveBeenCalled());

    const sentSnapshot = vi.mocked(saveAppraisal).mock.calls[0][1]
      .inputs_snapshot as unknown as {
        inputs_version: number;
        acquisition: {
          jurisdiction: string;
          jurisdiction_source: string;
          jurisdiction_evidence_status: string;
          acquisition_date: string | null;
          acquisition_tax_override_pence: number | null;
          acquisition_tax_override_reason: string;
        };
      };

    expect(sentSnapshot.inputs_version).toBe(5);
    expect(sentSnapshot.acquisition.jurisdiction).toBe('england_ni');
    expect(sentSnapshot.acquisition.jurisdiction_source).toBe('migrated_default');
    expect(sentSnapshot.acquisition.jurisdiction_evidence_status).toBe('unconfirmed');
    expect(sentSnapshot.acquisition.acquisition_date).toBeNull();
    expect(sentSnapshot.acquisition.acquisition_tax_override_pence).toBeNull();
    expect(sentSnapshot.acquisition.acquisition_tax_override_reason).toBe('');
  });

  it('a load-path migration throw (e.g. an unrecognised inputs_version) is a usable failure, not a blank screen', async () => {
    // Task 10 fix round 2: the coordinator asked whether a throw from the
    // v4->v5 migration guard (mirrored client-side this round) produces a
    // usable failure or a blank screen, before deciding whether Task 11
    // needs to build anything here. It does not need to: getAppraisal(...)
    // .then(...) already sits in a plain promise chain above any
    // CalculatorErrorBoundary, not inside a render body, so a throw here
    // rejects the promise and is caught by the existing .catch() -- the
    // same path a 500 or a network error already takes -- rather than
    // escaping to unmount the component. And setInputs(defaultCalculatorInputsV4(project))
    // already ran synchronously before this async load even started
    // (ConversionCalculator.tsx's effect, first line), so there is always a
    // fresh, computable document on screen regardless of how the load goes.
    const badAppraisal = storedV4Appraisal();
    badAppraisal.inputs_snapshot = { ...badAppraisal.inputs_snapshot, inputs_version: 6 };
    vi.mocked(getAppraisal).mockResolvedValueOnce(badAppraisal);

    render(<ConversionCalculator project={PROJECT} />);

    expect(await screen.findByText(/failed to load saved appraisal/i)).toBeInTheDocument();
    // Not a blank screen: the calculator chrome is fully present and usable
    // on the default document the effect seeded before the failed load.
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /7\. Appraisal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save appraisal/i })).toBeEnabled();
  });
});

// R8 Task 11 (defect B). The calculator posts the document it is holding, but
// the server is authoritative over that document: it normalises the snapshot to
// v5 and, on a project's first appraisal, derives the tax jurisdiction from the
// postcode. Before this, `handleSave` set `appraisalRecord` and dropped the
// returned snapshot on the floor, so the screen kept charging England/NI SDLT
// on a Welsh deal while the store held LTT -- measured on one fixture as
// total_development_cost_pence 91,388,400 shown against 91,213,400 stored --
// and a `client_mismatch` was recorded on every such first save.
describe('ConversionCalculator adopts the saved snapshot the server returns (R8 Task 11)', () => {
  function savedAppraisal(inputsSnapshot: Record<string, unknown>): FinancialAppraisal {
    return {
      id: 'a2',
      project_id: 'p1',
      name: 'Saved appraisal',
      inputs_snapshot: inputsSnapshot,
      gdv_pence: null,
      total_cost_pence: null,
      profit_on_cost_pct: null,
      profit_on_gdv_pct: null,
      return_on_equity_pct: null,
      irr: null,
      rlv_pence: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as FinancialAppraisal;
  }

  /** What app/api/app.py stores for a Welsh postcode on a first save. */
  function serverDerivedWelshSnapshot(): Record<string, unknown> {
    const v5 = defaultCalculatorInputsV5(PROJECT);
    return {
      ...v5,
      acquisition: { ...v5.acquisition, jurisdiction: 'wales', jurisdiction_source: 'derived' },
    } as unknown as Record<string, unknown>;
  }

  it('posts a v5 document whose jurisdiction the server is still free to derive', async () => {
    vi.mocked(saveAppraisal).mockResolvedValueOnce(savedAppraisal(serverDerivedWelshSnapshot()));
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));
    await waitFor(() => expect(saveAppraisal).toHaveBeenCalled());

    const sent = vi.mocked(saveAppraisal).mock.calls.at(-1)![1].inputs_snapshot as unknown as {
      inputs_version: number;
      acquisition: { jurisdiction_source: string; acquisition_date: string | null };
    };
    expect(sent.inputs_version).toBe(5);
    expect(sent.acquisition.jurisdiction_source).toBe('migrated_default');
    expect(sent.acquisition.acquisition_date).toBeNull();
  });

  it('re-renders on the jurisdiction the server derived instead of the one it posted', async () => {
    vi.mocked(saveAppraisal).mockResolvedValueOnce(savedAppraisal(serverDerivedWelshSnapshot()));
    render(<ConversionCalculator project={PROJECT} />);

    // Before the save: the client-side default document is England/NI.
    expect(screen.getByRole('heading', { name: 'SDLT Breakdown' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));

    // After it: the stored document, charged as LTT and shown as derived.
    expect(await screen.findByRole('heading', { name: 'LTT Breakdown' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'SDLT Breakdown' })).not.toBeInTheDocument();
    // This fixture PROJECT carries no address_postcode, so the page names the
    // source without quoting one.
    expect(screen.getByText(/Derived from the project postcode/)).toBeInTheDocument();
  });

  it('a snapshot the migration cannot read leaves the local document alone and is not a save failure', async () => {
    vi.mocked(saveAppraisal).mockResolvedValueOnce(
      savedAppraisal({ ...serverDerivedWelshSnapshot(), inputs_version: 99 }),
    );
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /update appraisal/i })).toBeInTheDocument());
    expect(screen.queryByText(/save failed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SDLT Breakdown' })).toBeInTheDocument();
  });
});
