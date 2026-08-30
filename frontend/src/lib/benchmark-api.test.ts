import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listBenchmarkSets, getBenchmarkSet, importBenchmarkSetJson, importBenchmarkSetCsv, listIndexDatasets,
  getIndexDataset, templateCsv, auditRecord, downloadTextFile, TEMPLATE_CSV_COLUMNS,
} from './benchmark-api';
import { ApiError } from './api';
import { ELEMENT_CATALOGUE, computeElementalBenchmark, computeCostPlan, developedAreaSqm } from './model';
import { docAB } from './model/__fixtures__/elemental-benchmark-docs';

function fakeResponse(status: number, body: unknown, contentType = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k: string) => (k === 'content-type' ? contentType : null) },
    text: async () => text, json: async () => JSON.parse(text),
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('benchmark-api routes (R17 spec §27.8)', () => {
  it('lists, gets (with the two currentisation query params) and imports JSON against /api/v1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(200, []));
    vi.stubGlobal('fetch', fetchMock);
    await listBenchmarkSets();
    await getBenchmarkSet('abc', { currentisation_date: '2026-06-01', current_index_value: 126 });
    await getBenchmarkSet('abc');
    await importBenchmarkSetJson({ name: 'x' });
    await listIndexDatasets();
    await getIndexDataset('idx');
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      '/api/v1/benchmark-sets',
      '/api/v1/benchmark-sets/abc?currentisation_date=2026-06-01&current_index_value=126',
      '/api/v1/benchmark-sets/abc',
      '/api/v1/benchmark-sets',
      '/api/v1/index-datasets',
      '/api/v1/index-datasets/idx',
    ]);
    const post = fetchMock.mock.calls[3][1] as RequestInit;
    expect(post.method).toBe('POST');
    expect(post.body).toBe('{"name":"x"}');
  });

  it('sends the CSV as multipart `file` with the header as a JSON `header` form field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(201, { id: 's1' }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['element_code\n'], 'rates.csv', { type: 'text/csv' });
    const out = await importBenchmarkSetCsv(file, { name: 'n', provider_type: 'user_qs' });
    expect(out).toEqual({ id: 's1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/benchmark-sets/import-csv');
    const form = init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('header')).toBe('{"name":"n","provider_type":"user_qs"}');
  });

  it('throws ApiError carrying the 422 detail list', async () => {
    const detail = [{ severity: 'error', field: 'rates[0].original_unit', message: 'not admissible' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(422, { detail })));
    await expect(importBenchmarkSetJson({})).rejects.toMatchObject({ status: 422, detail });
    await expect(importBenchmarkSetJson({})).rejects.toBeInstanceOf(ApiError);
  });

  it('refuses a non-JSON 200 (the SPA fallback) honestly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(200, '<html>', 'text/html')));
    await expect(listBenchmarkSets()).rejects.toThrow(/non-JSON/);
  });
});

describe('client-side builders', () => {
  it('templateCsv: the 14 columns then one row per catalogue element (39)', () => {
    const lines = templateCsv().trimEnd().split('\n');
    expect(lines[0]).toBe(TEMPLATE_CSV_COLUMNS.join(','));
    expect(TEMPLATE_CSV_COLUMNS).toHaveLength(14);
    expect(lines).toHaveLength(1 + ELEMENT_CATALOGUE.length);
    expect(ELEMENT_CATALOGUE).toHaveLength(39);
    expect(lines[1]).toBe('facilitating_works,Facilitating works,lump_sum,gbp,,,,,,,,,,');
    expect(lines[3]).toBe('strip_out,Strip-out,area,gbp_per_sqm,,,,,,,,,,');
    // The one label with a comma is quoted.
    expect(lines.find((l) => l.startsWith('ffe,'))).toBe('ffe,"Fittings, furnishings and equipment",per_unit,gbp_per_unit,,,,,,,,,,');
  });

  it('auditRecord: the result verbatim, the set header without rates, the applications without the retained plan', () => {
    const doc = docAB();
    const area = developedAreaSqm(doc);
    const result = computeElementalBenchmark(doc, computeCostPlan(doc, area, doc.unit_mix.units.length), area)!;
    const block = doc.elemental_benchmark!;
    const record = auditRecord(result, block.set, block.applications, '2026-08-30T00:00:00Z');
    expect(record.result).toBe(result);
    expect(record.rate_count).toBe(7);
    expect((record.set_header as Record<string, unknown>).rates).toBeUndefined();
    expect((record.set_header as Record<string, unknown>).content_hash).toBe(block.set.content_hash);
    const apps = record.applications as Record<string, unknown>[];
    expect(apps).toHaveLength(1);
    expect(apps[0].previous_cost_plan).toBeUndefined();
    expect(typeof apps[0].previous_cost_plan_package_count).toBe('number');
    expect(JSON.stringify(record)).toContain(result.content_hash);
  });

  it('downloadTextFile is a no-op where URL.createObjectURL is absent, and clicks a Blob link where it exists', () => {
    expect(() => downloadTextFile('a.csv', 'x', 'text/csv')).not.toThrow();
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadTextFile('a.csv', 'x', 'text/csv');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    click.mockRestore();
  });
});
