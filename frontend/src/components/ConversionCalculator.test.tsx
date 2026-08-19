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
const { defaultCalculatorInputsV4, defaultCalculatorInputsV7 } =
  await import('../lib/conversion-defaults');

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
  fireEvent.click(screen.getByRole('button', { name: /5\. Finance/ }));
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
    expect(screen.getByRole('button', { name: /6\. Programme/ })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /8\. Appraisal/ }));
    // A computable document shows real metric cards.
    expect(screen.getByText('Developer GDV')).toBeInTheDocument();

    setFacilityTerm('1e21');

    // Once it cannot compute, the previous run must not remain on screen.
    expect(screen.queryByText('Developer GDV')).not.toBeInTheDocument();
  });
});

describe('ConversionCalculator — Sensitivity is page 10', () => {
  it('offers fourteen numbered pages with Sensitivity tenth', () => {
    render(<ConversionCalculator project={PROJECT} />);
    for (const label of [
      '10. Sensitivity', '11. Exit', '12. Risk', '13. Deal Spider', '14. Investor',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the Sensitivity page when its tab is selected', () => {
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: '10. Sensitivity' }));
    expect(screen.getByRole('heading', { name: /10\. Sensitivity/ })).toBeInTheDocument();
  });
});

// R8 Task 10 fix round 1: this is the flag-day load path every existing
// appraisal goes through -- a stored v4 snapshot, migrated to v6 on load
// (ConversionCalculator.tsx's getAppraisal(...).then(...) handler). It had
// zero coverage: the module-level mock above always rejects getAppraisal
// with 404, so this branch never ran in any prior test.
describe('ConversionCalculator loads a stored v4 snapshot onto v6 (R8 Task 10, R9 Task 3)', () => {
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

  it('migrates the snapshot to v6 and renders it without an error, not a load failure', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());

    render(<ConversionCalculator project={PROJECT} />);

    // savedId is only set inside the .then() branch, after setInputs(migrateInputsToV6(...))
    // succeeds -- if that call threw (as migrateInputsToV4 would on a v5
    // document, or migrateInputsToV5 now would on a v6 one), the promise
    // chain's .catch() would run instead and the button would stay "Save
    // Appraisal". Finding "Update Appraisal" is proof the v4->v6 migration
    // executed cleanly on load.
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
    // its own state, so the six fields migrateV4toV5 added are still on the
    // runtime object. Inspecting the real payload sent to saveAppraisal
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

    expect(sentSnapshot.inputs_version).toBe(7);
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
    // R9 Task 3 moved the stand-in from 6 to 7; R10 Task 6 moves it again,
    // from 7 to 8: 7 is a version the client now implements, so it no longer
    // stands in for one it does not.
    const badAppraisal = storedV4Appraisal();
    badAppraisal.inputs_snapshot = { ...badAppraisal.inputs_snapshot, inputs_version: 8 };
    vi.mocked(getAppraisal).mockResolvedValueOnce(badAppraisal);

    render(<ConversionCalculator project={PROJECT} />);

    expect(await screen.findByText(/failed to load saved appraisal/i)).toBeInTheDocument();
    // Not a blank screen: the calculator chrome is fully present and usable
    // on the default document the effect seeded before the failed load.
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /8\. Appraisal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save appraisal/i })).toBeEnabled();
  });

  // R9 Task 3 fix round 1. THE regression this fix exists to stop: once the
  // server boundary moved to v6, every snapshot it stores is a v6 document.
  // The client was still calling migrateInputsToV5, which refuses a v6
  // document by design -- so the throw landed in the .catch() above and every
  // saved appraisal came back as "Failed to load the saved appraisal" on a
  // blank default document. Nothing was corrupted, but nothing was reachable
  // either. This is the round-trip the server actually produces.
  //
  // R10 Task 6 fix round 1: the same regression, one version on. The server
  // boundary moved to v7 (app/api/app.py); this test (and its production
  // call site, ConversionCalculator.tsx's load effect) now exercises
  // migrateInputsToV7 against a genuine v7 snapshot rather than v6.
  it('loads the v7 snapshot the server now stores, rather than failing on it', async () => {
    const storedV7 = storedV4Appraisal();
    storedV7.inputs_snapshot = defaultCalculatorInputsV7(PROJECT) as unknown as Record<string, unknown>;
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV7);
    vi.mocked(saveAppraisal).mockResolvedValueOnce(storedV7);

    render(<ConversionCalculator project={PROJECT} />);

    expect(
      await screen.findByRole('button', { name: /update appraisal/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to load the saved appraisal/i)).not.toBeInTheDocument();

    // And the document held in state is still v7 with its R9/R10 blocks
    // intact -- proof the load merged rather than silently downgrading.
    fireEvent.click(screen.getByRole('button', { name: /update appraisal/i }));
    await waitFor(() => expect(saveAppraisal).toHaveBeenCalled());
    const sent = vi.mocked(saveAppraisal).mock.calls.at(-1)![1]
      .inputs_snapshot as unknown as {
        inputs_version: number;
        areas: { basis: string; existing_gia_sqm: number };
        cost_plan: { mode: string };
      };
    expect(sent.inputs_version).toBe(7);
    expect(sent.areas.basis).toBe('manual');
    expect(sent.areas.existing_gia_sqm).toBe(0);
    expect(sent.cost_plan.mode).toBe('headline');
  });
});

// R8 Task 11 (defect B). The calculator posts the document it is holding, but
// the server is authoritative over that document: it normalises the snapshot to
// v7 (R10 Task 6; v6 through R9) and, on a project's first appraisal, derives
// the tax jurisdiction from the postcode. Before this, `handleSave` set
// `appraisalRecord` and dropped the returned snapshot on the floor, so the
// screen kept charging England/NI SDLT on a Welsh deal while the store held
// LTT -- measured on one fixture as total_development_cost_pence 91,388,400
// shown against 91,213,400 stored -- and a `client_mismatch` was recorded on
// every such first save.
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

  /** What app/api/app.py stores for a Welsh postcode on a first save. R10
   *  Task 6: the server boundary is v7, so this is a v7 document. */
  function serverDerivedWelshSnapshot(): Record<string, unknown> {
    const v7 = defaultCalculatorInputsV7(PROJECT);
    return {
      ...v7,
      acquisition: { ...v7.acquisition, jurisdiction: 'wales', jurisdiction_source: 'derived' },
    } as unknown as Record<string, unknown>;
  }

  it('posts a v7 document whose jurisdiction the server is still free to derive', async () => {
    vi.mocked(saveAppraisal).mockResolvedValueOnce(savedAppraisal(serverDerivedWelshSnapshot()));
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));
    await waitFor(() => expect(saveAppraisal).toHaveBeenCalled());

    const sent = vi.mocked(saveAppraisal).mock.calls.at(-1)![1].inputs_snapshot as unknown as {
      inputs_version: number;
      acquisition: { jurisdiction_source: string; acquisition_date: string | null };
    };
    expect(sent.inputs_version).toBe(7);
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

  // Fix round 1. `saving` disables only the Save button -- it has no other
  // consumer -- so every field on every page stays editable for the whole
  // round-trip. An unguarded adoption therefore silently reverted anything
  // typed while the POST was in flight, which is a data-loss path this repo's
  // audit history grades P0. The adoption is identity-guarded against the
  // document that was posted, so a newer one wins.
  it('does not discard an edit made while the save was in flight', async () => {
    let resolveSave: (value: FinancialAppraisal) => void = () => {};
    vi.mocked(saveAppraisal).mockReturnValueOnce(
      new Promise<FinancialAppraisal>((resolve) => { resolveSave = resolve; }),
    );
    render(<ConversionCalculator project={PROJECT} />);

    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));
    // £400,000 -> £500,000 while the request is still open.
    fireEvent.change(screen.getByDisplayValue('400000'), { target: { value: '500000' } });

    resolveSave(savedAppraisal(serverDerivedWelshSnapshot()));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /update appraisal/i })).toBeInTheDocument());

    // The edit survives, and with it the rest of the document the user is
    // holding -- the server's answer was about the superseded one.
    expect(screen.getByDisplayValue('500000')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('400000')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SDLT Breakdown' })).toBeInTheDocument();
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
