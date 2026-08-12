import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ApiError,
  isNotFound,
  createProject,
  listProjects,
  deleteProject,
  getAppraisal,
  scrapeUrl,
  lookupPostcode,
  lookupFlood,
  lookupArticle4,
  runEligibility,
} from './api';

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

describe('ApiError', () => {
  it('a 404 rejects with ApiError carrying the status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Financial appraisal not found'),
    });

    const err = await getAppraisal('missing-id').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe('HTTP 404: Financial appraisal not found');
    expect(isNotFound(err)).toBe(true);
  });

  it('a 500 rejects with ApiError and isNotFound is false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });

    const err = await listProjects().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect(isNotFound(err)).toBe(false);
  });

  it('isNotFound still recognises legacy string-formatted errors', () => {
    expect(isNotFound(new Error('HTTP 404: nope'))).toBe(true);
    expect(isNotFound(new Error('HTTP 500: boom'))).toBe(false);
    expect(isNotFound('not an error')).toBe(false);
  });

  it('a 200 with an HTML body rejects instead of parsing garbage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });

    const err = await listProjects().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('non-JSON');
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
