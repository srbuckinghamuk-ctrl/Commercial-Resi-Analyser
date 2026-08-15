import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProject,
  listProjects,
  deleteProject,
  scrapeUrl,
  lookupPostcode,
  lookupFlood,
  lookupArticle4,
  runEligibility,
  saveAppraisal,
  getAppraisal,
  ApiError,
  formatApiErrorDetail,
} from './api';
import type { FinancialAppraisalCreate } from '../types';

const mockFetch = vi.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('createProject', () => {
  it('sends POST to /api/v1/projects', async () => {
    const project = { id: '123', address_raw: '1 Test St' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(project),
    });

    const result = await createProject({
      address_raw: '1 Test St',
      price_pence: 30000000,
      use_class: 'office',
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/projects', expect.objectContaining({
      method: 'POST',
    }));
    expect(result).toEqual(project);
  });
});

describe('listProjects', () => {
  it('sends GET to /api/v1/projects', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const result = await listProjects();
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/projects', expect.any(Object));
    expect(result).toEqual([]);
  });
});

describe('deleteProject', () => {
  it('sends DELETE to /api/v1/projects/{id}', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await deleteProject('abc-123');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/projects/abc-123', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('scrapeUrl', () => {
  it('sends POST to /api/v1/scrape-url', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ listing: null, error: 'not implemented' }),
    });

    await scrapeUrl('https://example.com');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/scrape-url', expect.objectContaining({
      method: 'POST',
    }));
  });
});

describe('lookupPostcode', () => {
  it('sends GET to /api/v1/lookup/postcode/{postcode}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ postcode: 'SW1A 1AA', latitude: 51.5, longitude: -0.14 }),
    });

    const result = await lookupPostcode('SW1A 1AA');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/lookup/postcode/SW1A%201AA',
      expect.any(Object),
    );
    expect(result.postcode).toBe('SW1A 1AA');
  });
});

describe('lookupFlood', () => {
  it('sends GET to /api/v1/lookup/flood/{postcode}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ flood_zone: 'Zone 1', in_flood_zone_2_or_3: false }),
    });

    const result = await lookupFlood('SW1A 1AA');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/lookup/flood/SW1A%201AA',
      expect.any(Object),
    );
    expect(result.in_flood_zone_2_or_3).toBe(false);
  });
});

describe('lookupArticle4', () => {
  it('sends GET to /api/v1/lookup/article4/{lpa_code}', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ lpa_code: 'E09000033', has_article4: true }),
    });

    const result = await lookupArticle4('E09000033');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/lookup/article4/E09000033',
      expect.any(Object),
    );
    expect(result.has_article4).toBe(true);
  });
});

describe('runEligibility', () => {
  it('sends POST to /api/v1/eligibility/{id}/run', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ assessment: {}, auto_checks_performed: [], manual_checks_pending: [] }),
    });

    await runEligibility('proj-123', {});
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/eligibility/proj-123/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('saveAppraisal', () => {
  const payload: FinancialAppraisalCreate = {
    project_id: 'proj-123',
    name: 'Appraisal — 1 Test St',
    inputs_snapshot: { inputs_version: 2, foo: 'bar' },
    gdv_pence: 1_000_000,
    total_cost_pence: 800_000,
    profit_on_cost_pct: 25,
    profit_on_gdv_pct: 20,
    return_on_equity_pct: 40,
    irr: 18,
    rlv_pence: 500_000,
  };

  it('POSTs the inputs_snapshot and client metric fields when there is no existing record', async () => {
    const serverRecord = {
      id: 'appr-1',
      project_id: 'proj-123',
      status: 'reconciled',
      outputs: { metrics: { gdv_pence: 1_000_000 }, reconciliation: { report_safe: true } },
      validation: { issues: [], client_mismatches: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(serverRecord),
    });

    const result = await saveAppraisal('proj-123', payload);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/appraisals',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(payload) }),
    );
    expect(result.status).toBe('reconciled');
    expect(result).toEqual(serverRecord);
  });

  it('PUTs to the project route and surfaces status/validation when an existing record id is given', async () => {
    const serverRecord = {
      id: 'appr-1',
      project_id: 'proj-123',
      status: 'draft',
      outputs: { metrics: { gdv_pence: 1_000_000 }, reconciliation: { report_safe: false } },
      validation: {
        issues: [],
        client_mismatches: [{ field: 'gdv_pence', client: 1_000_000, server: 1_100_000 }],
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(serverRecord),
    });

    const result = await saveAppraisal('proj-123', payload, 'appr-1');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/appraisals/proj-123',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) }),
    );
    expect(result.status).toBe('draft');
    expect(result.validation?.client_mismatches).toHaveLength(1);
  });

  it('throws an ApiError carrying the 422 detail list on validation failure', async () => {
    const detail = [{ severity: 'error', field: 'acquisition.purchase_price_pence', message: 'must be non-negative' }];
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: () => Promise.resolve(JSON.stringify({ detail })),
    });

    let caught: unknown;
    try {
      await saveAppraisal('proj-123', payload);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(422);
    expect(formatApiErrorDetail((caught as ApiError).detail)).toEqual([
      'acquisition.purchase_price_pence: must be non-negative',
    ]);
  });
});

describe('getAppraisal', () => {
  it('sends GET to /api/v1/appraisals/{project_id} and returns server-authoritative fields', async () => {
    const record = {
      id: 'appr-1',
      project_id: 'proj-123',
      status: 'legacy_unreconciled',
      outputs: null,
      calc_version: null,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(record),
    });

    const result = await getAppraisal('proj-123');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/appraisals/proj-123', expect.any(Object));
    expect(result.status).toBe('legacy_unreconciled');
    expect(result.outputs).toBeNull();
  });
});
