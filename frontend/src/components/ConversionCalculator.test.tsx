import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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
    // R14b Task 9: page 16 (LenderCasePage) fetches all three on mount --
    // stub them so the mount test below exercises the real component, not a
    // hung network call.
    getLenderCase: vi.fn().mockResolvedValue(null),
    listLenderCaseEvents: vi.fn().mockResolvedValue([]),
    listLenderCaseHistory: vi.fn().mockResolvedValue([]),
  };
});

const { default: ConversionCalculator } = await import('./ConversionCalculator');
const { getAppraisal, saveAppraisal } = await import('../lib/api');
const { defaultCalculatorInputsV4, defaultCalculatorInputsV12 } =
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

/** Mounts the calculator under its real route so `:page` drives it. No slug
 *  = the bare `/calculator` address, which must redirect to Acquisition. */
function renderCalculator(slug?: string) {
  const path = `/projects/${PROJECT.id}/calculator${slug ? `/${slug}` : ''}`;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:id/calculator/:page?" element={<ConversionCalculator project={PROJECT} />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Sets the Finance page's facility term. 1e21 months makes the real engine
 * throw a RangeError building the schedule (`Array.from({length: 1e21})`) —
 * the class of failure that used to unmount the whole calculator. */
function setFacilityTerm(value: string): void {
  fireEvent.click(screen.getByRole('link', { name: /6\. Finance/ }));
  fireEvent.change(screen.getByDisplayValue('12'), { target: { value } });
}

describe('ConversionCalculator when the engine cannot compute', () => {
  // React logs the caught render error; keep the output pristine without
  // hiding an unexpected error from another test.
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  beforeEach(() => consoleErrorSpy.mockClear());
  afterEach(() => consoleErrorSpy.mockClear());

  it('keeps the calculator mounted and shows a recovery panel instead of unmounting', () => {
    renderCalculator();
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();

    setFacilityTerm('1e21');

    // The chrome survives: the nav is still there, so the component did not
    // unmount and its unsaved state is intact.
    expect(screen.getByRole('link', { name: /7\. Programme/ })).toBeInTheDocument();
    expect(screen.getByText(/appraisal could not be calculated/i)).toBeInTheDocument();
  });

  it('disables saving while the appraisal cannot be calculated', () => {
    renderCalculator();
    const saveButton = screen.getByRole('button', { name: /save appraisal|update appraisal/i });
    expect(saveButton).toBeEnabled();

    setFacilityTerm('1e21');

    expect(screen.getByRole('button', { name: /save appraisal|update appraisal/i })).toBeDisabled();
  });

  it('restores the last inputs that calculated when the user undoes the change', () => {
    renderCalculator();
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
    renderCalculator();
    fireEvent.click(screen.getByRole('link', { name: /10\. Appraisal/ }));
    // A computable document shows real metric cards.
    expect(screen.getByText('Developer GDV')).toBeInTheDocument();

    setFacilityTerm('1e21');

    // Once it cannot compute, the previous run must not remain on screen.
    expect(screen.queryByText('Developer GDV')).not.toBeInTheDocument();
  });
});

const STAGE_NAMES = ['Inputs', 'Funding', 'Exit', 'Underwriting', 'Output'];

describe('ConversionCalculator — five stages (spec §26.5)', () => {
  it('groups the sixteen links under the five stage labels, in order', () => {
    renderCalculator();
    // Filter by the five stage names: fieldsets elsewhere on the page also carry the group role.
    const groups = screen.getAllByRole('group').filter((g) => STAGE_NAMES.includes(g.getAttribute('aria-label') ?? ''));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(STAGE_NAMES);
    expect(within(groups[2]).getAllByRole('link').map((l) => l.textContent)).toEqual(['9. Exit']);
    // R16b Task 9: Due Diligence always carries its "assessed/entered" evidence
    // count (spec §26.5), so its own link's textContent is asserted separately
    // with a pattern rather than by exact equality with the other three.
    const underwritingLinks = within(groups[3]).getAllByRole('link').map((l) => l.textContent);
    expect(underwritingLinks.slice(0, 3)).toEqual(['10. Appraisal', '11. Scenarios', '12. Sensitivity']);
    expect(underwritingLinks[3]).toMatch(/^13\. Due Diligence\d+\/\d+ assessed$/);
  });

  it('renders the Sensitivity page when its tab is selected', () => {
    renderCalculator();
    fireEvent.click(screen.getByRole('link', { name: '12. Sensitivity' }));
    expect(screen.getByRole('heading', { name: /12\. Sensitivity/ })).toBeInTheDocument();
  });

  it('shows an error badge on the page that owns the failing field, and the evidence count on Due Diligence', () => {
    renderCalculator('finance');
    // 0 months fails finance.term_months (validation.ts: "!Number.isInteger(f.term_months) ||
    // f.term_months < 1") and, on the default document, nothing else -- every other block
    // that reads term_months (programme, sales_phasing, refinance, monitoring, investment_case,
    // unit_sales) is null on a fresh document, so this is the ONE finance-owned error it fires.
    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '0' } });
    expect(screen.getByRole('link', { name: /6\. Finance/ })).toHaveTextContent(/6\. Finance\s*1/);
    expect(screen.getByRole('link', { name: /13\. Due Diligence/ })).toHaveTextContent(/\d+\/\d+ assessed/);
  });
});

// R14b Task 9 (spec §21): a page exists only if a test fails when it is
// unmounted -- this is that test for page 16.
describe('ConversionCalculator — Lender Case is page 16 (R14b)', () => {
  it('mounts the Lender Case page on its tab', async () => {
    renderCalculator();
    fireEvent.click(screen.getByRole('link', { name: '16. Lender Case' }));
    expect(await screen.findByText('No lender case')).toBeInTheDocument();
  });
});

// R8 Task 10 fix round 1: this is the flag-day load path every existing
// appraisal goes through -- a stored v4 snapshot, migrated to v7 on load
// (ConversionCalculator.tsx's getAppraisal(...).then(...) handler; the
// migration target moved v6 -> v7 in R10 Task 6, M4 fix round 1 corrects
// this block's stale "v6" text to match). It had zero coverage: the
// module-level mock above always rejects getAppraisal with 404, so this
// branch never ran in any prior test.
describe('ConversionCalculator loads a stored v4 snapshot onto v12 (R8 Task 10, R9 Task 3, R10 Task 6, R11 Task 10, R12 Task 18b, R13 Task 18, R14 Task 14, R13b Task 15)', () => {
  function storedV4Appraisal(): FinancialAppraisal {
    const v4Snapshot = defaultCalculatorInputsV4(PROJECT);
    return {
      id: 'a1',
      project_id: 'p1',
      name: 'Stored appraisal',
      inputs_snapshot: v4Snapshot as unknown as Record<string, unknown>,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  it('migrates the snapshot to v12 and renders it without an error, not a load failure', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());

    renderCalculator();

    // savedId is only set inside the .then() branch, after setInputs(migrateInputsToV12(...))
    // succeeds -- if that call threw (as it would on a snapshot with an
    // unrecognised inputs_version -- migrateInputsToV12 accepts 1 through 12
    // and throws otherwise), the promise chain's .catch() would run instead
    // and the button would stay "Save Appraisal". Finding "Update Appraisal"
    // is proof the v4->v12 migration executed cleanly on load.
    expect(
      await screen.findByRole('button', { name: /update appraisal/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to load the saved appraisal/i)).not.toBeInTheDocument();
  });

  it('the migrated state carries the six R8 acquisition fields at their migrated defaults', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());
    vi.mocked(saveAppraisal).mockResolvedValueOnce(storedV4Appraisal());

    renderCalculator();
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

    expect(sentSnapshot.inputs_version).toBe(16);
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
    // R9 Task 3 moved the stand-in from 6 to 7; R10 Task 6 moved it again,
    // from 7 to 8; R11 Task 10 moved it from 8 to 9; R12 Task 18b moved it
    // from 9 to 10; R13 Task 18 moved it from 10 to 11; R14 Task 14 moved it
    // from 11 to 12; R13b Task 15 moved it from 12 to 13; R15 Task 13 moved
    // it from 13 to 14; R15b Task 6 moved it from 14 to 15; R16 Task 4 moves
    // it from 15 to 16. Each time for the same reason: the old stand-in
    // became a version the client implements, so it stopped standing in for
    // one it does not -- and, being structurally valid, it stopped throwing
    // at all and this test went quietly green against nothing. Bumping it
    // with the boundary is what keeps it honest.
    const badAppraisal = storedV4Appraisal();
    badAppraisal.inputs_snapshot = { ...badAppraisal.inputs_snapshot, inputs_version: 16 };
    vi.mocked(getAppraisal).mockResolvedValueOnce(badAppraisal);

    renderCalculator();

    expect(await screen.findByText(/failed to load saved appraisal/i)).toBeInTheDocument();
    // Not a blank screen: the calculator chrome is fully present and usable
    // on the default document the effect seeded before the failed load.
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /10\. Appraisal/ })).toBeInTheDocument();
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
  // call site, ConversionCalculator.tsx's load effect) exercised
  // migrateInputsToV7 against a genuine v7 snapshot rather than v6. R11 Task
  // 10 moved both to v8 in ONE commit, which is what this test guards. R12
  // Task 18b moved both to v9; R13 Task 18 moved both to v10; R14 Task 14
  // moved both to v11; R13b Task 15 moved both to v12; R15 Task 13 moved both
  // to v13; R15b Task 6 moved both to v14; R16 Task 4 moves both to v15.
  it('loads the v12 snapshot the server now stores, rather than failing on it', async () => {
    const storedV11 = storedV4Appraisal();
    storedV11.inputs_snapshot = defaultCalculatorInputsV12(PROJECT) as unknown as Record<string, unknown>;
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV11);
    vi.mocked(saveAppraisal).mockResolvedValueOnce(storedV11);

    renderCalculator();

    expect(
      await screen.findByRole('button', { name: /update appraisal/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to load the saved appraisal/i)).not.toBeInTheDocument();

    // And the document held in state is now migrated on to v15, with its
    // R9/R10/R11/R12/R13/R14/R13b/R15/R15b/R16 blocks intact -- proof the load
    // merged rather than silently downgrading.
    fireEvent.click(screen.getByRole('button', { name: /update appraisal/i }));
    await waitFor(() => expect(saveAppraisal).toHaveBeenCalled());
    const sent = vi.mocked(saveAppraisal).mock.calls.at(-1)![1]
      .inputs_snapshot as unknown as {
        inputs_version: number;
        areas: { basis: string; existing_gia_sqm: number };
        cost_plan: { mode: string };
        vat: { registered: boolean; treatments: unknown[] };
        programme: unknown;
        investment_case: unknown;
        monitoring: unknown;
        unit_sales: unknown;
        due_diligence: unknown;
        scenarios: {
          base: {
            phase_slip_phase_id: string | null; phase_slip_months: number;
            programme_slip_months: number;
          };
        };
      };
    expect(sent.inputs_version).toBe(16);
    expect(sent.areas.basis).toBe('manual');
    expect(sent.areas.existing_gia_sqm).toBe(0);
    expect(sent.cost_plan.mode).toBe('headline');
    // R11 spec 17.11: the VAT block survives the round trip inert. A client
    // still on v7 would have thrown on this document instead.
    expect(sent.vat.registered).toBe(false);
    expect(sent.vat.treatments).toHaveLength(6);
    // R12 spec 18.7: a v9 document round-trips with its two-state programme and
    // the phase_slip lever fields intact. A client still on v8 would have
    // thrown on this document instead -- the exact regression R9, R10 and R11
    // each recorded one version earlier.
    expect(sent.programme).toBeNull();
    expect(sent.scenarios.base.phase_slip_phase_id).toBeNull();
    expect(sent.scenarios.base.phase_slip_months).toBe(0);
    // R16 spec 25.7: a v14->v15 document round-trips with the four stress-pack
    // scenario lever fields written at their identity zero. A client still on
    // v14 would have thrown on this document instead.
    expect(sent.scenarios.base.programme_slip_months).toBe(0);
    // R13 spec 19.9: a v10 document round-trips with its two-state
    // investment_case intact (null here -- the explicit path). A client
    // still on v9 would have thrown on this document instead.
    expect(sent.investment_case).toBeNull();
    // R14 spec 20.1: a v11 document round-trips with its two-state monitoring
    // block intact (null here -- no statement entered). A client still on v10
    // would have thrown on this document instead.
    expect(sent.monitoring).toBeNull();
    // R13b spec 22: a v12 document round-trips with its nullable unit_sales
    // block intact (null here -- no per-unit ledger entered). A client still
    // on v11 would have thrown on this document instead.
    expect(sent.unit_sales).toBeNull();
    // R15 spec 23.10: the v12->v13 migration on load seeds a due_diligence
    // block (never absent on a v13 document) even though this fixture never
    // entered an evidence schedule.
    expect(sent.due_diligence).not.toBeNull();
  });
});


// R15 Task 13 (spec 23.5). Source-record capture is a CLIENT act:
// `defaultCalculatorInputsV15(project)` (R16 Task 4 moved this on from
// `defaultCalculatorInputsV14`, which R15b Task 6 itself moved on from
// `defaultCalculatorInputsV13`) receives the full `Project`, so a
// brand-new appraisal for a project that already has a listing captures it
// into `due_diligence.source_record` on construction -- there is no separate
// Python-side capture, and none is expected.
describe('ConversionCalculator captures the listing on a fresh document (R15 Task 13, spec 23.5)', () => {
  function savedAppraisal(inputsSnapshot: Record<string, unknown>): FinancialAppraisal {
    return {
      id: 'a3',
      project_id: 'p1',
      name: 'Saved appraisal',
      inputs_snapshot: inputsSnapshot,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as FinancialAppraisal;
  }

  it('a fresh document for a project with is_vacant: false carries due_diligence.source_record.is_vacant === false', async () => {
    const vacantlyOccupiedProject = { ...PROJECT, is_vacant: false };
    vi.mocked(saveAppraisal).mockResolvedValueOnce(savedAppraisal({}));

    render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT.id}/calculator`]}>
        <Routes>
          <Route path="/projects/:id/calculator/:page?" element={<ConversionCalculator project={vacantlyOccupiedProject} />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));
    await waitFor(() => expect(saveAppraisal).toHaveBeenCalled());

    const sent = vi.mocked(saveAppraisal).mock.calls.at(-1)![1].inputs_snapshot as unknown as {
      due_diligence: { source_record: { is_vacant: boolean | null } | null };
    };
    expect(sent.due_diligence.source_record).not.toBeNull();
    expect(sent.due_diligence.source_record!.is_vacant).toBe(false);
  });
});

// R8 Task 11 (defect B). The calculator posts the document it is holding, but
// the server is authoritative over that document: it normalises the snapshot to
// v15 (R16 Task 4; v14 through R15b, v13 through R15, v12 through R13b, v11
// through R14, v10 through R13, v9 through R12, v8 through R11) and, on a
// project's first appraisal, derives the tax jurisdiction from the postcode. Before
// this, `handleSave` set
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
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as unknown as FinancialAppraisal;
  }

  /** What app/api/app.py stores for a Welsh postcode on a first save. This
   *  helper builds it from a v12 document deliberately -- `migrateInputsToV15`
   *  (the adoption path below) must accept it and migrate it on, exactly as
   *  the real server's `migrate_inputs_to_v15` would for a stored v12 result. */
  function serverDerivedWelshSnapshot(): Record<string, unknown> {
    const v12 = defaultCalculatorInputsV12(PROJECT);
    return {
      ...v12,
      acquisition: { ...v12.acquisition, jurisdiction: 'wales', jurisdiction_source: 'derived' },
    } as unknown as Record<string, unknown>;
  }

  it('posts a v15 document whose jurisdiction the server is still free to derive', async () => {
    vi.mocked(saveAppraisal).mockResolvedValueOnce(savedAppraisal(serverDerivedWelshSnapshot()));
    renderCalculator();
    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));
    await waitFor(() => expect(saveAppraisal).toHaveBeenCalled());

    const sent = vi.mocked(saveAppraisal).mock.calls.at(-1)![1].inputs_snapshot as unknown as {
      inputs_version: number;
      acquisition: { jurisdiction_source: string; acquisition_date: string | null };
    };
    expect(sent.inputs_version).toBe(16);
    expect(sent.acquisition.jurisdiction_source).toBe('migrated_default');
    expect(sent.acquisition.acquisition_date).toBeNull();
  });

  it('re-renders on the jurisdiction the server derived instead of the one it posted', async () => {
    vi.mocked(saveAppraisal).mockResolvedValueOnce(savedAppraisal(serverDerivedWelshSnapshot()));
    renderCalculator();

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
    renderCalculator();

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
    renderCalculator();
    fireEvent.click(screen.getByRole('button', { name: /save appraisal/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /update appraisal/i })).toBeInTheDocument());
    expect(screen.queryByText(/save failed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SDLT Breakdown' })).toBeInTheDocument();
  });
});

describe('ConversionCalculator — addresses (spec §26.5)', () => {
  it('redirects the bare calculator address to Acquisition', () => {
    renderCalculator();
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();
  });

  it('redirects an unknown slug to Acquisition', () => {
    renderCalculator('nonsense');
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();
  });

  it('opens the page a deep link names', () => {
    renderCalculator('sensitivity');
    // /Sensitivity/ alone is ambiguous -- the page also carries an h4
    // "Single-Lever Sensitivity" subheading; the page's own h3 is "12.
    // Sensitivity", so anchoring on the number disambiguates it.
    expect(screen.getByRole('heading', { name: /12\. Sensitivity/ })).toBeInTheDocument();
  });

  it('keeps unsaved edits when the page changes through the URL (decision 3)', () => {
    renderCalculator('finance');
    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '18' } });
    fireEvent.click(screen.getByRole('link', { name: /Appraisal/ }));
    expect(screen.getByRole('heading', { name: /Appraisal Summary/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /6\. Finance/ }));
    expect(screen.getByDisplayValue('18')).toBeInTheDocument();
  });

  it('the active tab is a link whose href is the page address', () => {
    renderCalculator('vat');
    expect(screen.getByRole('link', { name: '5. VAT' })).toHaveAttribute('href', '/projects/p1/calculator/vat');
  });
});
