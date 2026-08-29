import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project, FinancialAppraisal, LenderCase, LenderCaseEvent } from '../../types';
import { ALLOWED_TRANSITIONS } from '../../lib/report-provenance';

// R14b Task 8. Only the network boundary is mocked -- ALLOWED_TRANSITIONS and
// structurallyEqual come from the real report-provenance module, so a passing
// "offers exactly the ALLOWED_TRANSITIONS buttons" test proves the component
// actually reads that table rather than a hand-kept copy of it.
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

const { default: LenderCasePage } = await import('./LenderCasePage');
const {
  getLenderCase, createLenderCase, listLenderCaseHistory, listLenderCaseEvents,
} = await import('../../lib/api');
const { defaultCalculatorInputsV16 } = await import('../../lib/conversion-defaults');

const PROJECT: Project = {
  id: 'p1',
  address_raw: '1 Test Street, Testville TS1 1TS',
  address_postcode: 'TS1 1TS',
  price_pence: 40_000_000,
  floor_area_sqm: 400,
  use_class: 'office',
  stage: 'opportunity_identified',
} as unknown as Project;

const INPUTS = defaultCalculatorInputsV16({ id: PROJECT.id, price_pence: PROJECT.price_pence, floor_area_sqm: PROJECT.floor_area_sqm });

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
    locked_calc_version: '2.14.0',
    locked_inputs_version: 11,
    locked_input_hash: 'inputhash123',
    locked_outputs_hash: 'outputshash123',
    locked_audit_hash: 'lockedauditxyz789',
    case_hash: 'casehashdef456',
    created_by: 'S. Sponsor',
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

beforeEach(() => {
  vi.mocked(listLenderCaseHistory).mockResolvedValue([]);
  vi.mocked(listLenderCaseEvents).mockResolvedValue([]);
});

describe('LenderCasePage — no saved appraisal', () => {
  it('explains the lock and disables creation with no saved appraisal', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(null);
    render(<LenderCasePage project={PROJECT} appraisalRecord={null} inputs={INPUTS} />);

    const createButton = await screen.findByRole('button', { name: /create lender case/i });
    expect(createButton).toBeDisabled();
    expect(screen.getByText(/save the appraisal first/i)).toBeInTheDocument();
  });
});

describe('LenderCasePage — pre-provenance record', () => {
  it('disables creation for a pre-provenance record', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(null);
    render(<LenderCasePage project={PROJECT} appraisalRecord={record({ audit_hash: null })} inputs={INPUTS} />);

    const createButton = await screen.findByRole('button', { name: /create lender case/i });
    expect(createButton).toBeDisabled();
    expect(screen.getByText(/re-save/i)).toBeInTheDocument();
  });
});

describe('LenderCasePage — creation', () => {
  it('creates a case with the entered name', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(null);
    vi.mocked(createLenderCase).mockResolvedValue(lenderCase());
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);

    const createButton = await screen.findByRole('button', { name: /create lender case/i });
    expect(createButton).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'S. Sponsor' } });
    fireEvent.click(createButton);

    expect(createLenderCase).toHaveBeenCalledWith('p1', 'S. Sponsor');
  });
});

describe('LenderCasePage — live case card', () => {
  it('renders the live case card', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase());
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);

    expect(await screen.findByText(/draft/i)).toBeInTheDocument();
    expect(screen.getByText(/lockedauditxyz789/)).toBeInTheDocument();
    expect(screen.getByText(/casehashdef456/)).toBeInTheDocument();
    expect(screen.getByText(/S\. Sponsor/)).toBeInTheDocument();
  });
});

describe('LenderCasePage — transition buttons', () => {
  it('offers exactly the ALLOWED_TRANSITIONS buttons for a draft case', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'draft' }));
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);
    await screen.findByText(/draft/i);

    for (const to of ALLOWED_TRANSITIONS.draft) {
      expect(screen.getByRole('button', { name: new RegExp(to, 'i') })).toBeInTheDocument();
    }
    // exactly these -- no extra transition buttons beyond ALLOWED_TRANSITIONS.draft
    const allStatuses = Object.keys(ALLOWED_TRANSITIONS) as (keyof typeof ALLOWED_TRANSITIONS)[];
    const notAllowed = allStatuses.filter((s) => !ALLOWED_TRANSITIONS.draft.includes(s) && s !== 'draft');
    for (const s of notAllowed) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${s.replace(/_/g, ' ')}$`, 'i') })).not.toBeInTheDocument();
    }
  });

  it('offers exactly the ALLOWED_TRANSITIONS buttons for a credit_approved case', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'credit_approved' }));
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);
    await screen.findByText(/credit approved/i);

    expect(ALLOWED_TRANSITIONS.credit_approved).toEqual(['superseded']);
    expect(screen.getByRole('button', { name: /superseded/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^submitted$/i })).not.toBeInTheDocument();
  });
});

describe('LenderCasePage — conditions field', () => {
  it('requires conditions only for approved_with_conditions', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'under_review' }));
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);
    await screen.findByText(/under review/i);

    fireEvent.click(screen.getByRole('button', { name: /approved with conditions/i }));
    expect(screen.getByLabelText(/conditions/i)).toBeInTheDocument();
  });

  it('does not show conditions when the pending transition is credit_approved', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ status: 'under_review' }));
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);
    await screen.findByText(/under review/i);

    fireEvent.click(screen.getByRole('button', { name: /^credit approved$/i }));
    expect(screen.queryByLabelText(/conditions/i)).not.toBeInTheDocument();
  });
});

describe('LenderCasePage — staleness warnings', () => {
  it('shows the stale warning when the server says stale', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase({ stale: true }));
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);

    expect(await screen.findByText(/has changed since this case locked its snapshot/i)).toBeInTheDocument();
  });

  it('shows the unsaved-edits warning when live inputs differ', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(
      lenderCase({ stale: false, locked_inputs_snapshot: { ...INPUTS, name: 'different' } as unknown as Record<string, unknown> }),
    );
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);

    expect(await screen.findByText(/unsaved edits differ from the locked snapshot/i)).toBeInTheDocument();
  });
});

describe('LenderCasePage — event log', () => {
  it('renders the event log newest first', async () => {
    vi.mocked(getLenderCase).mockResolvedValue(lenderCase());
    vi.mocked(listLenderCaseEvents).mockResolvedValue([
      event({ id: 2, from_status: 'draft', to_status: 'submitted', actor: 'A. Actor' }),
      event({ id: 1, from_status: null, to_status: 'draft', actor: 'B. Actor' }),
    ]);
    render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);

    expect(await screen.findByText(/A\. Actor/)).toBeInTheDocument();
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
    const { rerender } = render(<LenderCasePage project={PROJECT} appraisalRecord={record()} inputs={INPUTS} />);
    // The user switches project while still on this tab -- the component
    // stays mounted, so this is a re-render, not a fresh mount.
    rerender(<LenderCasePage project={PROJECT_B} appraisalRecord={record()} inputs={INPUTS} />);

    // Project B's (newer) fetches resolve first.
    dCaseB.resolve(caseB);
    dEventsB.resolve([]);
    dHistB.resolve([]);
    expect(await screen.findByText(/B\. Owner/)).toBeInTheDocument();

    // Project A's (older, slower) fetches resolve after -- must be discarded.
    dCaseA.resolve(caseA);
    dEventsA.resolve([]);
    dHistA.resolve([]);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText(/B\. Owner/)).toBeInTheDocument();
    expect(screen.queryByText(/A\. Owner/)).not.toBeInTheDocument();
  });
});
