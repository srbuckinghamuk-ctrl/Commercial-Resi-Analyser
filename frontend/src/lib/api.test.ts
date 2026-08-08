import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  changeStage,
  scrapeUrl,
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
