import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Project, FinancialAppraisal, LenderCase, LenderCaseEvent, AuthUser } from '../../types';
import { ALLOWED_TRANSITIONS, ROLE_TRANSITIONS } from '../../lib/report-provenance';

// R17 (design §10.6). Two boundaries are mocked -- the network (lib/api) and
// the signed-in user (lib/auth's useAuth). ALLOWED_TRANSITIONS, ROLE_TRANSITIONS,
// canTransition and structurallyEqual are the real modules, so the
// role-filtering tests prove the component reads those tables rather than a
// hand-kept copy.
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return {
    ...actual,
    getLenderCase: vi.fn(),
    createLenderCase: vi.fn(),
    transitionLenderCase: vi.fn(),
    listLenderCaseHistory: vi.fn(),
    listLenderCaseEvents: vi.fn(),
  };
});

const authState = { user: null as AuthUser | null, loading: false };
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/auth')>();
  return {
    ...actual,
    useAuth: () => ({ ...authState, token: authState.user ? 'tok' : null, login: vi.fn(), logout: vi.fn() }),
  };
});

const { default: LenderCasePage } = await import('./LenderCasePage');
const SIGN_IN_PROMPT = 'Sign in to open or move a lender case';
const {
  getLenderCase, createLenderCase, transitionLenderCase, listLenderCaseHistory, listLenderCaseEvents, ApiError,
} = await import('../../lib/api');
const { defaultCalculatorInputsV17 } = await import('../../lib/conversion-defaults');

const PROJECT: Project = {
  id: 'p1',
  address_raw: '1 Test Street, Testville TS1 1TS',
  address_postcode: 'TS1 1TS',
  price_pence: 40_000_000,
  floor_area_sqm: 400,
  use_class: 'office',
  stage: 'opportunity_identified',
} as unknown as Project;

const INPUTS = defaultCalculatorInputsV17({ id: PROJECT.id, price_pence: PROJECT.price_pence, floor_area_sqm: PROJECT.floor_area_sqm });

const DEVELOPER: AuthUser = { id: 'u-dev', email: 'dev@x.test', display_name: 'D. Developer', role: 'developer', is_active: true };
const UNDERWRITER: AuthUser = { id: 'u-uw', email: 'uw@x.test', display_name: 'U. Writer', role: 'underwriter', is_active: true };
const APPROVER: AuthUser = { id: 'u-ca', email: 'ca@x.test', display_name: 'C. Approver', role: 'credit_approver', is_active: true };

const CASE_HASH = 'c'.repeat(64);

function record(overrides: Partial<FinancialAppraisal> = {}): FinancialAppraisal {
  return {
    id: 'a1',
    project_id: 'p1',
    name: 'Base case',
    inputs_snapshot: INPUTS as unknown as Record<string, unknown>,
    audit_hash: 'auditabc123',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function lenderCase(overrides: Partial<LenderCase> = {}): LenderCase {
  return {
    id: 'c1',
    project_id: 'p1',
    status: 'draft',
    locked_inputs_snapshot: INPUTS as unknown as Record<string, unknown>,
    locked_calc_version: '2.19.0',
    locked_inputs_version: 17,
    locked_input_hash: 'inputhash123',
    locked_outputs_hash: 'outputshash123',
    locked_audit_hash: 'lockedauditxyz789',
    case_hash: CASE_HASH,
    version: 3,
    created_by: 'S. Sponsor',
    created_by_user_id: 'u-sponsor',
    submitted_by: null,
    reviewer: null,
    decided_by: null,
    conditions: null,
    submitted_at: null,
    decided_at: null,
    stale: false,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function event(overrides: Partial<LenderCaseEvent> = {}): LenderCaseEvent {
  return {
    id: 1,
    case_id: 'c1',
    from_status: null,
    to_status: 'draft',
    actor: 'S. Sponsor',
    note: null,
    occurred_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage(props: Partial<React.ComponentProps<typeof LenderCasePage>> = {}) {
  return render(
    <MemoryRouter>
      <LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} {...props} />
    </MemoryRouter>,
  );
}

function humanise(status: string): string {
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

beforeEach(() => {
  authState.user = DEVELOPER;
  authState.loading = false;
  vi.mocked(getLenderCase).mockReset();
  vi.mocked(createLenderCase).mockReset();
  vi.mocked(transitionLenderCase).mockReset();
  vi.mocked(listLenderCaseHistory).mockResolvedValue([]);
  vi.mocked(listLenderCaseEvents).mockResolvedValue([]);
});

describe('LenderCasePage — signed out', () => {
  it('offers a sign-in link, no actions, and fetches nothing', async () => {
    authState.user = null;
    renderPage();

    expect(screen.getByText(new RegExp(SIGN_IN_PROMPT))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(getLenderCase).not.toHaveBeenCalled();
    expect(listLenderCaseEvents).not.toHaveBeenCalled();
  });

  it('waits while a stored token is being verified', () => {
    authState.user = null;
    authState.loading = true;
    renderPage();
    expect(screen.getByText(/checking sign-in/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });
});

describe('LenderCasePage — no case yet', () => {
  it('shows the signed-in user and role, and no "Your name" field', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(null);
    renderPage();
    await screen.findByText('No lender case');
    expect(screen.getByText('D. Developer')).toBeInTheDocument();
    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
  });

  it('disables creation with no saved appraisal', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(null);
    renderPage({ appraisalRecord: null });
    expect(await screen.findByRole('button', { name: /create lender case/i })).toBeDisabled();
    expect(screen.getByText(/save the appraisal first/i)).toBeInTheDocument();
  });

  it('disables creation for a pre-provenance record', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(null);
    renderPage({ appraisalRecord: record({ audit_hash: null }) });
    expect(await screen.findByRole('button', { name: /create lender case/i })).toBeDisabled();
    expect(screen.getByText(/re-save/i)).toBeInTheDocument();
  });

  it('a developer creates with only the project id (no created_by)', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(null);
    vi.mocked(createLenderCase).mockResolvedValue(lenderCase());
    renderPage();
    const button = await screen.findByRole('button', { name: /create lender case/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(createLenderCase).toHaveBeenCalledWith('p1');
    expect(createLenderCase).toHaveBeenCalledTimes(1);
  });

  it('an underwriter (not in CREATE_ROLES) gets no create button', async () => {
    authState.user = UNDERWRITER;
    vi.mocked(getLenderCase).mockResolvedValue(null);
    renderPage();
    await screen.findByText('No lender case');
    expect(screen.queryByRole('button', { name: /create lender case/i })).not.toBeInTheDocument();
    expect(screen.getByText(/may not open a lender case/i)).toBeInTheDocument();
  });
});

describe('LenderCasePage — live case card', () => {
  it('renders the card with version and hashes', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase());
    renderPage();
    expect(await screen.findByText(/Lender case — Draft/)).toBeInTheDocument();
    expect(screen.getByText(/lockedauditxyz789/)).toBeInTheDocument();
    expect(screen.getByText(CASE_HASH)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/S\. Sponsor/)).toBeInTheDocument();
  });
});

describe('LenderCasePage — role-filtered transition buttons', () => {
  it('a developer on a draft case sees Submit (and Supersede) but never Approve', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'draft' }));
    renderPage();
    await screen.findByText(/Lender case — Draft/);
    expect(screen.getByRole('button', { name: /^submitted$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^superseded$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /credit approved/i })).not.toBeInTheDocument();
  });

  it('a developer on an under_review case sees only Supersede — the decisions are withheld', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'under_review' }));
    renderPage();
    await screen.findByText(/Lender case — Under review/);
    expect(screen.getByRole('button', { name: /^superseded$/i })).toBeInTheDocument();
    for (const to of ['credit_approved', 'approved_with_conditions', 'declined', 'information_required'] as const) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${humanise(to)}$`, 'i') })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/not offered to role developer/i)).toBeInTheDocument();
  });

  it('a credit approver on an under_review case sees exactly the ROLE_TRANSITIONS-permitted buttons', async () => {
    authState.user = APPROVER;
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'under_review' }));
    renderPage();
    await screen.findByText(/Lender case — Under review/);
    for (const to of ALLOWED_TRANSITIONS.under_review) {
      const allowed = (ROLE_TRANSITIONS as Record<string, readonly string[]>)[to].includes('credit_approver');
      const button = screen.queryByRole('button', { name: new RegExp(`^${humanise(to)}$`, 'i') });
      if (allowed) expect(button, to).toBeInTheDocument();
      else expect(button, to).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /^credit approved$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^declined$/i })).toBeInTheDocument();
  });

  it('a credit approver on a draft case cannot Submit', async () => {
    authState.user = APPROVER;
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'draft' }));
    renderPage();
    await screen.findByText(/Lender case — Draft/);
    expect(screen.queryByRole('button', { name: /^submitted$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^superseded$/i })).toBeInTheDocument();
  });
});

describe('LenderCasePage — the transition request', () => {
  it('sends expected_version, expected_case_hash, a fresh idempotency key and the optional reason; no actor', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'draft', version: 3 }));
    vi.mocked(transitionLenderCase).mockResolvedValue(lenderCase({ status: 'submitted', version: 4 }));
    renderPage();
    await screen.findByText(/Lender case — Draft/);

    fireEvent.click(screen.getByRole('button', { name: /^submitted$/i }));
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'ready' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'sponsor sign-off' } });
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => expect(transitionLenderCase).toHaveBeenCalledTimes(1));
    const [projectId, body] = vi.mocked(transitionLenderCase).mock.calls[0];
    expect(projectId).toBe('p1');
    expect(body).toEqual({
      to_status: 'submitted',
      note: 'ready',
      reason: 'sponsor sign-off',
      conditions: undefined,
      expected_version: 3,
      expected_case_hash: CASE_HASH,
      idempotency_key: expect.any(String),
    });
    expect(body.idempotency_key.length).toBeGreaterThan(0);
    expect(body.idempotency_key).not.toContain('|');
    expect('actor' in body).toBe(false);
  });

  it('reuses the same idempotency key on a retry of the same confirmation, and mints a new one for a new choice', async () => {
    authState.user = APPROVER;
    vi.mocked(getLenderCase)
      .mockResolvedValueOnce(lenderCase({ status: 'under_review' }))
      .mockResolvedValue(lenderCase({ status: 'declined', version: 4 }));
    vi.mocked(transitionLenderCase)
      .mockRejectedValueOnce(new ApiError(409, 'HTTP 409', 'The lender case moved while this transition was validated — re-read and retry'))
      .mockResolvedValue(lenderCase({ status: 'declined' }));
    renderPage();
    await screen.findByText(/Lender case — Under review/);

    fireEvent.click(screen.getByRole('button', { name: /^declined$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await screen.findByRole('alert');
    // The failure keeps the pending confirmation open; retrying it reuses the key.
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(transitionLenderCase).toHaveBeenCalledTimes(2));
    const key1 = vi.mocked(transitionLenderCase).mock.calls[0][1].idempotency_key;
    const key2 = vi.mocked(transitionLenderCase).mock.calls[1][1].idempotency_key;
    expect(key2).toBe(key1);

    // After the reload the case is declined; only Supersede remains -- a new
    // choice mints a new key.
    await screen.findByText(/Lender case — Declined/);
    fireEvent.click(screen.getByRole('button', { name: /^superseded$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    await waitFor(() => expect(transitionLenderCase).toHaveBeenCalledTimes(3));
    const key3 = vi.mocked(transitionLenderCase).mock.calls[2][1].idempotency_key;
    expect(key3).not.toBe(key1);
  });

  it('prints a server 403 verbatim', async () => {
    authState.user = APPROVER;
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'under_review' }));
    const refusal = 'maker-checker: the user who created or submitted a case may not decide it';
    vi.mocked(transitionLenderCase).mockRejectedValue(new ApiError(403, 'HTTP 403', refusal));
    renderPage();
    await screen.findByText(/Lender case — Under review/);

    fireEvent.click(screen.getByRole('button', { name: /^credit approved$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^confirm$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
  });

  it('requires the conditions field only for approved_with_conditions', async () => {
    authState.user = APPROVER;
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'under_review' }));
    renderPage();
    await screen.findByText(/Lender case — Under review/);

    fireEvent.click(screen.getByRole('button', { name: /^approved with conditions$/i }));
    expect(screen.getByLabelText('Conditions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^credit approved$/i }));
    expect(screen.queryByLabelText('Conditions')).not.toBeInTheDocument();
  });
});

describe('LenderCasePage — staleness warnings', () => {
  it('shows the stale warning when the server says stale', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ stale: true }));
    renderPage();
    expect(await screen.findByText(/has changed since this case locked its snapshot/i)).toBeInTheDocument();
  });

  it('shows the unsaved-edits warning when live inputs differ', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(
      lenderCase({ stale: false, locked_inputs_snapshot: { ...INPUTS, name: 'different' } as unknown as Record<string, unknown> }),
    );
    renderPage();
    expect(await screen.findByText(/unsaved edits differ from the locked snapshot/i)).toBeInTheDocument();
  });
});

describe('LenderCasePage — event log', () => {
  it('renders the actor display name and the reason, newest first', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase());
    vi.mocked(listLenderCaseEvents).mockResolvedValue([
      event({ id: 2, from_status: 'draft', to_status: 'submitted', actor: 'A. Actor', reason: 'board approved', case_version_after: 2 }),
      event({ id: 1, from_status: null, to_status: 'draft', actor: 'B. Actor' }),
    ]);
    renderPage();
    expect(await screen.findByText(/A\. Actor/)).toBeInTheDocument();
    expect(screen.getByText(/reason: board approved/)).toBeInTheDocument();
    expect(screen.getByText(/B\. Actor/)).toBeInTheDocument();
  });
});

// Review round 1 (Important finding): the mount-time reload is keyed on
// project.id, so the component can stay mounted while the project switches
// under it. Without a stale-response guard, project A's slower Promise.all
// could resolve after project B's and silently clobber B's state.
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('LenderCasePage — stale reload guard (review round 1)', () => {
  it("a late-resolving fetch for the previous project does not overwrite the new project's case", async () => {
    const caseA = lenderCase({ id: 'ca', created_by: 'A. Owner' });
    const caseB = lenderCase({ id: 'cb', created_by: 'B. Owner' });
    const dCaseA = deferred<LenderCase | null>();
    const dCaseB = deferred<LenderCase | null>();
    const dEventsA = deferred<LenderCaseEvent[]>();
    const dEventsB = deferred<LenderCaseEvent[]>();
    const dHistA = deferred<LenderCase[]>();
    const dHistB = deferred<LenderCase[]>();

    vi.mocked(getLenderCase).mockImplementation((projectId) => (projectId === 'p1' ? dCaseA.promise : dCaseB.promise));
    vi.mocked(listLenderCaseEvents).mockImplementation((projectId) => (projectId === 'p1' ? dEventsA.promise : dEventsB.promise));
    vi.mocked(listLenderCaseHistory).mockImplementation((projectId) => (projectId === 'p1' ? dHistA.promise : dHistB.promise));

    const PROJECT_B: Project = { ...PROJECT, id: 'p2' };
    const { rerender } = render(
      <MemoryRouter><LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} /></MemoryRouter>,
    );
    rerender(
      <MemoryRouter><LenderCasePage project={PROJECT_B} appraisalRecord={record()} inputs={INPUTS} /></MemoryRouter>,
    );

    dCaseB.resolve(caseB);
    dEventsB.resolve([]);
    dHistB.resolve([]);
    expect(await screen.findByText(/B\. Owner/)).toBeInTheDocument();

    dCaseA.resolve(caseA);
    dEventsA.resolve([]);
    dHistA.resolve([]);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText(/B\. Owner/)).toBeInTheDocument();
    expect(screen.queryByText(/A\. Owner/)).not.toBeInTheDocument();
  });
});
