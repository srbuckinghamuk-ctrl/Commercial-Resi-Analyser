import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Project, FinancialAppraisal } from '../types';

// R16b review round 2 (Minor 5): ProjectDetail had no test file at all, so
// the §26.3 "outputs.metrics is the only stored copy" behaviour -- a null
// `outputs` prints the standing sentence, never a second, older set of
// figures -- was entirely uncovered. Only the network boundary is stubbed;
// `useNavigate` requires a router, so the component mounts under
// MemoryRouter.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getEligibility: vi.fn().mockRejectedValue(new actual.ApiError(404, 'not found', null)),
    getAppraisal: vi.fn(),
    listTransitions: vi.fn().mockResolvedValue([]),
  };
});

const { default: ProjectDetail } = await import('./ProjectDetail');
const { getAppraisal } = await import('../lib/api');

const PROJECT: Project = {
  id: 'p1',
  address_raw: '1 Test Street, Testville TS1 1TS',
  address_postcode: 'TS1 1TS',
  price_pence: 40_000_000,
  floor_area_sqm: 400,
  use_class: 'office',
  tenure: 'unknown',
  stage: 'financial_appraisal',
  source_url: null,
  image_urls: [],
  pa_submitted_date: null,
  pa_decision_date: null,
  floors: null,
} as unknown as Project;

function baseAppraisal(): FinancialAppraisal {
  return {
    id: 'a1',
    project_id: 'p1',
    name: 'Stored appraisal',
    inputs_snapshot: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function renderDetail() {
  return render(
    <MemoryRouter>
      <ProjectDetail project={PROJECT} view="overview" onProjectUpdated={() => {}} />
    </MemoryRouter>,
  );
}

describe('ProjectDetail key metrics (spec §26.3)', () => {
  it('a null outputs prints the standing sentence and no metric tiles', async () => {
    const appraisal = baseAppraisal();
    appraisal.outputs = null;
    vi.mocked(getAppraisal).mockResolvedValueOnce(appraisal);

    renderDetail();

    expect(
      await screen.findByText('Not yet recalculated — open and save the appraisal to compute its figures.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('GDV')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Profit on Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Profit on GDV')).not.toBeInTheDocument();
    expect(screen.queryByText('Return on Equity')).not.toBeInTheDocument();
    expect(screen.queryByText('IRR')).not.toBeInTheDocument();
  });

  it('outputs.metrics renders the six tiles, formatted as the component formats them', async () => {
    const appraisal = baseAppraisal();
    appraisal.outputs = {
      metrics: {
        gdv_pence: 123_456_78,
        total_development_cost_pence: 987_654_32,
        profit_on_cost_pct: 21.456,
        profit_on_gdv_pct: 17.05,
        return_on_equity_pct: 33.333,
        irr_annual_pct: 12.3,
      },
      reconciliation: 'reconciled',
    } as unknown as FinancialAppraisal['outputs'];
    vi.mocked(getAppraisal).mockResolvedValueOnce(appraisal);

    renderDetail();

    // £(pence / 100).toLocaleString() -- same formatting the component uses.
    expect(await screen.findByText('GDV')).toBeInTheDocument();
    expect(screen.getByText(`£${(123_456_78 / 100).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText('Total Cost')).toBeInTheDocument();
    expect(screen.getByText(`£${(987_654_32 / 100).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText('Profit on Cost')).toBeInTheDocument();
    expect(screen.getByText('21.5%')).toBeInTheDocument();
    expect(screen.getByText('Profit on GDV')).toBeInTheDocument();
    expect(screen.getByText('17.1%')).toBeInTheDocument();
    expect(screen.getByText('Return on Equity')).toBeInTheDocument();
    expect(screen.getByText('33.3%')).toBeInTheDocument();
    expect(screen.getByText('IRR')).toBeInTheDocument();
    expect(screen.getByText('12.3%')).toBeInTheDocument();
    expect(
      screen.queryByText('Not yet recalculated — open and save the appraisal to compute its figures.'),
    ).not.toBeInTheDocument();
  });
});
