import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Project, FinancialAppraisal } from '../types';

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
const { getAppraisal } = await import('../lib/api');
const { generateAppraisalPdf } = await import('../lib/export-pdf');
const { generateInvestmentMemo } = await import('../lib/export-investment-memo');
const { defaultCalculatorInputsV4, defaultCalculatorInputsV7 } = await import('../lib/conversion-defaults');

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
  // ExportPage.tsx:100 and :127) now exercises migrateInputsToV7 against a
  // genuine v7 snapshot rather than v6.
  it('exports from the v7 snapshot the server now stores, rather than failing on it', async () => {
    const storedV7 = storedV4Appraisal();
    storedV7.inputs_snapshot = defaultCalculatorInputsV7({
      id: PROJECT.id, price_pence: PROJECT.price_pence, floor_area_sqm: PROJECT.floor_area_sqm,
    }) as unknown as Record<string, unknown>;
    vi.mocked(getAppraisal).mockResolvedValueOnce(storedV7);

    render(<ExportPage projects={[PROJECT]} projectsLoading={false} backendOffline={false} />);
    selectProject();
    fireEvent.click(screen.getByRole('button', { name: /download investment memorandum/i }));

    await waitFor(() => expect(generateInvestmentMemo).toHaveBeenCalled());
    expect(
      screen.queryByText(/could not generate investment memorandum/i),
    ).not.toBeInTheDocument();

    const run = vi.mocked(generateInvestmentMemo).mock.calls.at(-1)![1];
    expect(run.inputs.inputs_version).toBe(7);
  });
});
