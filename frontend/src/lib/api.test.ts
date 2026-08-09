import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  changeStage,
  scrapeUrl,
  lookupPostcode,
  lookupFlood,
  lookupArticle4,
  runEligibility,
} from './api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

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

    const result = await scrapeUrl('https://example.com');
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
