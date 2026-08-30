import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    resaveAppraisal: vi.fn(),
  };
});

// R17: the governed-resave button needs a signed-in user; the badge does not.
const authState = { user: null as null | { id: string; email: string; display_name: string; role: 'developer'; is_active: boolean } };
vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth')>();
  return {
    ...actual,
    useAuth: () => ({ user: authState.user, token: authState.user ? 'tok' : null, loading: false, login: vi.fn(), logout: vi.fn() }),
  };
});

const { default: ProjectDetail } = await import('./ProjectDetail');
const { getAppraisal, resaveAppraisal } = await import('../lib/api');
const { CALC_VERSION } = await import('../lib/model/finance-types');

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
        return_on_equity_is_unrealised: false,
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

  // R17 spec §13.1. The label is read from the STORED flag, never recomputed;
  // a row without the key (older stored outputs) says the basis is unrecorded.
  it('labels the tile "Unrealised Return on Equity" when the stored flag is true', async () => {
    const appraisal = baseAppraisal();
    appraisal.outputs = {
      metrics: { return_on_equity_pct: 33.333, return_on_equity_is_unrealised: true },
      reconciliation: 'reconciled',
    } as unknown as FinancialAppraisal['outputs'];
    vi.mocked(getAppraisal).mockResolvedValueOnce(appraisal);

    renderDetail();

    expect(await screen.findByText('Unrealised Return on Equity')).toBeInTheDocument();
    expect(screen.queryByText('Return on Equity')).not.toBeInTheDocument();
    expect(screen.queryByText('Return on Equity (realisation basis not recorded)')).not.toBeInTheDocument();
  });

  it('labels the tile "Return on Equity (realisation basis not recorded)" when the stored metrics lack the flag', async () => {
    const appraisal = baseAppraisal();
    appraisal.outputs = {
      metrics: { return_on_equity_pct: 33.333 },
      reconciliation: 'reconciled',
    } as unknown as FinancialAppraisal['outputs'];
    vi.mocked(getAppraisal).mockResolvedValueOnce(appraisal);

    renderDetail();

    expect(await screen.findByText('Return on Equity (realisation basis not recorded)')).toBeInTheDocument();
    expect(screen.queryByText('Return on Equity')).not.toBeInTheDocument();
    expect(screen.queryByText('Unrealised Return on Equity')).not.toBeInTheDocument();
  });
});

// R17 design §11: the stale-version badge and the governed resave.
describe('ProjectDetail stale-version badge (R17 design §11)', () => {
  const RESAVE_BADGE = /Stored under inputs v\d+ \/ calc .* — governed resave required/;

  it('shows no badge when the stored row is at the current inputs and calc versions', async () => {
    authState.user = null;
    const appraisal = baseAppraisal();
    appraisal.inputs_version = 17;
    appraisal.calc_version = CALC_VERSION;
    appraisal.outputs = null;
    vi.mocked(getAppraisal).mockResolvedValueOnce(appraisal);

    renderDetail();

    await screen.findByText('Not yet recalculated — open and save the appraisal to compute its figures.');
    expect(screen.queryByText(RESAVE_BADGE)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resave' })).not.toBeInTheDocument();
  });

  it('shows the badge with the stored versions and a sign-in link when signed out', async () => {
    authState.user = null;
    const appraisal = baseAppraisal();
    appraisal.inputs_version = 3;
    appraisal.calc_version = '2.1.0';
    appraisal.outputs = null;
    vi.mocked(getAppraisal).mockResolvedValueOnce(appraisal);

    renderDetail();

    expect(await screen.findByText('Stored under inputs v3 / calc 2.1.0 — governed resave required')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resave' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in to resave' })).toHaveAttribute('href', '/login');
  });

  it('a stale calc version alone is enough for the badge', async () => {
    authState.user = null;
    const appraisal = baseAppraisal();
    appraisal.inputs_version = 17;
    appraisal.calc_version = '2.18.0';
    appraisal.outputs = null;
    vi.mocked(getAppraisal).mockResolvedValueOnce(appraisal);

    renderDetail();

    expect(await screen.findByText('Stored under inputs v17 / calc 2.18.0 — governed resave required')).toBeInTheDocument();
  });

  it('signed in: Resave calls the governed resave, then reloads the row and the badge clears', async () => {
    authState.user = { id: 'u1', email: 'd@x.test', display_name: 'D. Developer', role: 'developer', is_active: true };
    const stale = baseAppraisal();
    stale.inputs_version = 3;
    stale.calc_version = '2.1.0';
    stale.outputs = null;
    const fresh = baseAppraisal();
    fresh.inputs_version = 17;
    fresh.calc_version = CALC_VERSION;
    fresh.outputs = null;
    vi.mocked(getAppraisal).mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
    vi.mocked(resaveAppraisal).mockResolvedValueOnce({ ...fresh, previous_version_id: 'v1' });

    renderDetail();

    const button = await screen.findByRole('button', { name: 'Resave' });
    fireEvent.click(button);

    await waitFor(() => expect(resaveAppraisal).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.queryByText(RESAVE_BADGE)).not.toBeInTheDocument());
    expect(vi.mocked(getAppraisal).mock.calls.at(-1)).toEqual(['p1']);
  });

  it('signed in: a refused resave prints the server detail and keeps the badge', async () => {
    authState.user = { id: 'u1', email: 'd@x.test', display_name: 'D. Developer', role: 'developer', is_active: true };
    const stale = baseAppraisal();
    stale.inputs_version = 3;
    stale.calc_version = '2.1.0';
    stale.outputs = null;
    vi.mocked(getAppraisal).mockResolvedValueOnce(stale);
    const { ApiError } = await import('../lib/api');
    vi.mocked(resaveAppraisal).mockRejectedValueOnce(new ApiError(401, 'HTTP 401', 'authentication required'));

    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Resave' }));
    expect(await screen.findByText('authentication required')).toBeInTheDocument();
    expect(screen.getByText(RESAVE_BADGE)).toBeInTheDocument();
  });
});
