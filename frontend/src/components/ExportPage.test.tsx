import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project, FinancialAppraisal, LenderCase } from '../types';

// R8 Task 10 fix round 1: ExportPage.tsx had no test file at all, so the two
// snapshot-migration call sites that task introduced (the deal-spider
// computation inside handleAppraisalPdf, and the engine run inside
// handleInvestmentMemo) were entirely uncovered. Only the network boundary
// and the PDF-rendering libraries are stubbed here; `runAppraisal` and
// `computeSpider` are the real engine, so a successful call proves the
// migrated v6 document is genuinely computable, not just structurally valid.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getEligibility: vi.fn().mockRejectedValue(new actual.ApiError(404, 'not found', null)),
    getAppraisal: vi.fn(),
    // R14b Task 9: default to "no case" so pre-existing tests below (which
    // predate lender cases) are unaffected; the new describe block overrides
    // this per-test.
    getLenderCase: vi.fn().mockRejectedValue(new actual.ApiError(404, 'not found', null)),
  };
});
vi.mock('../lib/export-pdf', () => ({
  generateEligibilityPdf: vi.fn(() => new Blob()),
  generateAppraisalPdf: vi.fn(() => new Blob()),
}));
vi.mock('../lib/export-investment-memo', () => ({
  generateInvestmentMemo: vi.fn(() => new Blob()),
}));

const { default: ExportPage } = await import('./ExportPage');
const { getAppraisal, getLenderCase } = await import('../lib/api');
const { generateAppraisalPdf } = await import('../lib/export-pdf');
const { generateInvestmentMemo } = await import('../lib/export-investment-memo');
const { defaultCalculatorInputsV4, defaultCalculatorInputsV12 } = await import('../lib/conversion-defaults');

const PROJECT: Project = {
  id: 'p1',
  address_raw: '1 Test Street, Testville TS1 1TS',
  address_postcode: 'TS1 1TS',
  price_pence: 40_000_000,
  floor_area_sqm: 400,
  use_class: 'office',
  stage: 'opportunity_identified',
} as unknown as Project;

function storedV4Appraisal(): FinancialAppraisal {
  const v4Snapshot = defaultCalculatorInputsV4({
    id: PROJECT.id, price_pence: PROJECT.price_pence, floor_area_sqm: PROJECT.floor_area_sqm,
  });
  return {
    id: 'a1',
    project_id: 'p1',
    name: 'Stored appraisal',
    inputs_snapshot: v4Snapshot as unknown as Record<string, unknown>,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function selectProject() {
  fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
}

describe('ExportPage migrates a stored v4 snapshot to v6 (R8 Task 10, R9 Task 3)', () => {
  beforeEach(() => {
    // jsdom does not implement these; downloadBlob() calls them unconditionally.
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  it('Financial Appraisal PDF: migrates before computing the deal spider, no load-failure banner', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());

    render(<ExportPage projects={[PROJECT]} projectsLoading={false} backendOffline={false} />);
    selectProject();
    fireEvent.click(screen.getByRole('button', { name: /financial appraisal pdf/i }));

    await waitFor(() => expect(generateAppraisalPdf).toHaveBeenCalled());
    expect(
      screen.queryByText(/could not generate appraisal pdf/i),
    ).not.toBeInTheDocument();

    // The old migrateInputsToV4 call would throw building this on a v5
    // document, and migrateInputsToV5 would now throw on a v6 one; a defined
    // spider argument is only reached if migration to v6 succeeded and the
    // real engine (computeSpider -> runAppraisal) accepted it.
    const spiderArg = vi.mocked(generateAppraisalPdf).mock.calls[0][2];
    expect(spiderArg).toBeDefined();
  });

  it('Investment Memorandum: migrates before running the engine, and the real computed acquisition tax reflects the migrated defaults', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());

    render(<ExportPage projects={[PROJECT]} projectsLoading={false} backendOffline={false} />);
    selectProject();
    fireEvent.click(screen.getByRole('button', { name: /download investment memorandum/i }));

    await waitFor(() => expect(generateInvestmentMemo).toHaveBeenCalled());
    expect(
      screen.queryByText(/could not generate investment memorandum/i),
    ).not.toBeInTheDocument();

    // Second argument is the real `AppraisalRun` computed by the real engine
    // off the migrated v7 inputs (only `generateInvestmentMemo` is mocked
    // here) -- its acquisition_tax carries the migrated defaults through to a
    // real computed result: england_ni with no date on record, i.e. the
    // current (assumed) band set.
    const run = vi.mocked(generateInvestmentMemo).mock.calls[0][1];
    expect(run.metrics.acquisition_tax.jurisdiction).toBe('england_ni');
    expect(run.metrics.acquisition_tax.date_basis).toBe('assumed_current');
  });

  // R9 Task 3 fix round 1. Same regression as the ConversionCalculator one:
  // once the server stores v6, every export path reading a saved snapshot
  // through migrateInputsToV5 would have thrown, and both PDFs would have
  // failed for every saved appraisal with only a generic "Could not
  // generate..." banner to show for it.
  //
  // R10 Task 6 fix round 1: the same regression, one version on. The server
  // boundary moved to v7; this test (and its production call sites,
  // ExportPage.tsx:100 and :127) exercised migrateInputsToV7 against a
  // genuine v7 snapshot rather than v6.
  //
  // R11 Task 10: once more, to v8. R12 Task 18b: once more, to v9. R13 Task
  // 18: once more, to v10. R14 Task 14: once more, to v11. R13b Task 15: once
  // more, to v12. R15 Task 13: once more, to v13. R15b Task 6: once more, to
  // v14. R16 Task 4: once more, to v15. The whole point of moving the server
  // and both client halves in ONE commit is that this test can never be left
  // pinned a version behind the boundary it guards.
  it('exports from the v12 snapshot the server now stores, rather than failing on it', async () => {
    const storedV11 = storedV4Appraisal();
    storedV11.inputs_snapshot = defaultCalculatorInputsV12({
      id: PROJECT.id, price_pence: PROJECT.price_pence, floor_area_sqm: PROJECT.floor_area_sqm,
    }) as unknown as Record<string, unknown>;
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV11);

    render(<ExportPage projects={[PROJECT]} projectsLoading={false} backendOffline={false} />);
    selectProject();
    fireEvent.click(screen.getByRole('button', { name: /download investment memorandum/i }));

    await waitFor(() => expect(generateInvestmentMemo).toHaveBeenCalled());
    expect(
      screen.queryByText(/could not generate investment memorandum/i),
    ).not.toBeInTheDocument();

    const run = vi.mocked(generateInvestmentMemo).mock.calls.at(-1)![1];
    expect(run.inputs.inputs_version).toBe(17);
    // The block reached the engine, rather than being dropped somewhere on the
    // way through the export path. Narrowed with `in` rather than cast: `run.inputs`
    // is the AnyCalculatorInputs union and only v8 and later members declare
    // `vat`, so a cast would assert exactly the thing under test.
    expect('vat' in run.inputs).toBe(true);
    if ('vat' in run.inputs) {
      expect(run.inputs.vat.registered).toBe(false);
      expect(run.inputs.vat.treatments).toHaveLength(6);
    }
    // R12 spec 18.7: the memo's programme section (spec 18.10) reads this
    // field, so a v9+ document reaching the export path with its two-state
    // programme intact is what makes that section reachable at all.
    expect('programme' in run.inputs).toBe(true);
    if ('programme' in run.inputs) expect(run.inputs.programme).toBeNull();
    // R13 spec 19.9: a v10+ document reaches the export path with its
    // two-state investment_case intact (null here -- the explicit path).
    expect('investment_case' in run.inputs).toBe(true);
    if ('investment_case' in run.inputs) expect(run.inputs.investment_case).toBeNull();
    // R14 spec 20.1: a v11 document reaches the export path with its
    // two-state monitoring block intact (null here -- no statement entered).
    expect('monitoring' in run.inputs).toBe(true);
    if ('monitoring' in run.inputs) expect(run.inputs.monitoring).toBeNull();
    // R13b spec 22: a v12 document reaches the export path with its nullable
    // unit_sales block intact (null here -- no per-unit ledger entered).
    expect('unit_sales' in run.inputs).toBe(true);
    if ('unit_sales' in run.inputs) expect(run.inputs.unit_sales).toBeNull();
  });
});

// R14b Task 9 (spec §21, spec 13.1): the memo's provenance panel and FINAL
// gate must see the stored lender case, not always print the standing
// "No lender case" row.
describe('ExportPage feeds the lender case into the memo provenance (R14b Task 9)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  function approvedLenderCase(): LenderCase {
    return {
      id: 'case-1',
      project_id: 'p1',
      status: 'credit_approved',
      locked_inputs_snapshot: {},
      locked_calc_version: '2.14.0',
      locked_inputs_version: 11,
      locked_input_hash: 'input-hash',
      locked_outputs_hash: 'outputs-hash',
      locked_audit_hash: 'audit-hash',
      case_hash: 'case-hash',
      created_by: 'Alice',
      submitted_by: 'Alice',
      reviewer: 'Bob',
      decided_by: 'Bob',
      conditions: null,
      submitted_at: '2026-08-20T00:00:00Z',
      decided_at: '2026-08-21T00:00:00Z',
      stale: false,
      created_at: '2026-08-19T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
    };
  }

  it("passes the stored lender case into the memo's provenance", async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());
    vi.mocked(getLenderCase).mockResolvedValueOnce(approvedLenderCase());

    render(<ExportPage projects={[PROJECT]} projectsLoading={false} backendOffline={false} />);
    selectProject();
    fireEvent.click(screen.getByRole('button', { name: /download investment memorandum/i }));

    await waitFor(() => expect(generateInvestmentMemo).toHaveBeenCalled());
    const provenance = vi.mocked(generateInvestmentMemo).mock.calls.at(-1)![3]!;
    expect(provenance.lenderCaseStatus).toBe('credit_approved');
  });

  it('still exports with no lender case', async () => {
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV4Appraisal());
    vi.mocked(getLenderCase).mockRejectedValueOnce(new Error('no case on record'));

    render(<ExportPage projects={[PROJECT]} projectsLoading={false} backendOffline={false} />);
    selectProject();
    fireEvent.click(screen.getByRole('button', { name: /download investment memorandum/i }));

    await waitFor(() => expect(generateInvestmentMemo).toHaveBeenCalled());
    expect(
      screen.queryByText(/could not generate investment memorandum/i),
    ).not.toBeInTheDocument();
    const provenance = vi.mocked(generateInvestmentMemo).mock.calls.at(-1)![3]!;
    expect(provenance.lenderCase).toBeNull();
  });
});

// R16b review round 2 (Important 2a): every handler's `await import(...)`
// used to sit inside the same try/catch as the data fetch, so a failed
// chunk load (a stale deploy, a flaky network) reported the data-fetch
// message ("Ensure a financial appraisal has been saved...") instead of its
// own cause. The chunk load is now hoisted above the data fetch, in its own
// try/catch. This test forces the dynamic import of the memo generator to
// reject and asserts the distinct reload message is shown instead of the
// data-fetch message -- at minimum for the investment-memo handler, per the
// review finding.
//
// Placed last in the file and self-contained: it is the only test that
// needs `vi.resetModules()` + `vi.doMock()` to make the dynamic import
// itself reject (a normally-mocked module resolves fine, so its export
// function throwing is a different, already-covered error path). The
// afterEach restores a working mock rather than unmocking to the real
// module (which would pull in jsPDF/xlsx), so a later test run in the same
// process is never affected.
describe('ExportPage: chunk-load failure reports its own cause (R16b review round 2)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.doMock('../lib/export-investment-memo', () => ({
      generateInvestmentMemo: vi.fn(() => new Blob()),
    }));
    vi.resetModules();
  });

  it('shows the reload message, not the data-fetch message, when the memo chunk fails to load', async () => {
    vi.resetModules();
    vi.doMock('../lib/export-investment-memo', () => {
      throw new Error('Failed to fetch dynamically imported module: export-investment-memo');
    });

    const { default: FreshExportPage } = await import('./ExportPage');
    const { getAppraisal: freshGetAppraisal } = await import('../lib/api');
    vi.mocked(freshGetAppraisal).mockResolvedValue(storedV4Appraisal());

    render(<FreshExportPage projects={[PROJECT]} projectsLoading={false} backendOffline={false} />);
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: /download investment memorandum/i }));

    await waitFor(() =>
      expect(screen.getByText(/could not load the export module — reload the page and try again/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/ensure a financial appraisal has been saved/i),
    ).not.toBeInTheDocument();
  });
});
