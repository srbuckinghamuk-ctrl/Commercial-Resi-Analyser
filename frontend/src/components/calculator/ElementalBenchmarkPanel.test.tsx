/**
 * R17 spec §27 (design §4.3). The panel is rendered on fixture AB (seven
 * fictional rates, seven selections, one prior application) through
 * `runAppraisal`, so every figure asserted here is the engine's own. The
 * library client is mocked; the pure builders (template CSV, audit record)
 * are the real ones with the download spied.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import ElementalBenchmarkPanel from './ElementalBenchmarkPanel';
import { runAppraisal, NO_CURRENTISATION_DATE_REFUSAL, FIXED_PRICE_BLOCK_REASON, USER_PACKAGE_BLOCK_REASON } from '../../lib/model';
import type { CalculatorInputsV17, SchemeElementalBenchmark } from '../../lib/model';
import { AreaUnitProvider } from '../../lib/area-unit-context';
import { docAB, docABWith, docABWithoutBenchmark, abSet } from '../../lib/model/__fixtures__/elemental-benchmark-docs';
import * as benchmarkApi from '../../lib/benchmark-api';

vi.mock('../../lib/benchmark-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/benchmark-api')>();
  return {
    ...actual,
    listBenchmarkSets: vi.fn(),
    getBenchmarkSet: vi.fn(),
    importBenchmarkSetJson: vi.fn(),
    importBenchmarkSetCsv: vi.fn(),
    listIndexDatasets: vi.fn().mockResolvedValue([]),
    getIndexDataset: vi.fn(),
    downloadTextFile: vi.fn(),
  };
});

const download = vi.mocked(benchmarkApi.downloadTextFile);

function renderPanel(inputs: CalculatorInputsV17, onChange = vi.fn()) {
  const run = runAppraisal(inputs);
  render(
    <AreaUnitProvider initialUnit="metric">
      <ElementalBenchmarkPanel inputs={inputs} onChange={onChange} run={run} />
    </AreaUnitProvider>,
  );
  return { run, onChange };
}

function row(label: string): HTMLTableRowElement {
  return screen.getByText(label).closest('tr') as HTMLTableRowElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ElementalBenchmarkPanel on fixture AB', () => {
  it('prints the engine rows and totals, the header, the hash and both standing sentences', () => {
    const { run } = renderPanel(docAB());
    const result = run.metrics.elemental_benchmark!;
    // strip_out: 8,000p/m² × 600 m² × (126/120) × 0.95 = £47,880.00 — the engine's figure, not recomputed here.
    expect(within(row('Strip-out')).getByText('£47,880.00')).toBeTruthy();
    expect(within(row('Strip-out')).getByText('£80.00/m²')).toBeTruthy();
    const kitchens = row('Kitchens');
    // Benchmark amount and (applied) QS amount both read £31,920.00 — two cells.
    expect(within(kitchens).getAllByText('£31,920.00')).toHaveLength(2);
    expect((within(kitchens).getByLabelText('Include kitchens') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('User/QS benchmark')).toBeTruthy();
    expect(screen.getByText(new RegExp(result.content_hash))).toBeTruthy();
    expect(screen.getByText(/Benchmark rates are advisory: nothing here enters the cost plan/)).toBeTruthy();
    expect(screen.getByText(/initial reasonableness check/)).toBeTruthy();
    for (const w of result.warnings) expect(screen.getByText(new RegExp(w.message.slice(0, 40)))).toBeTruthy();
    expect(result.warnings).toHaveLength(3);
    expect(screen.getByText('Coverage').nextSibling!.textContent).toMatch(/%$/);
    expect(screen.queryByText('User-supplied licensed data — verify redistribution rights')).toBeNull();
  });

  it('the area-unit toggle flips the printed rate labels and the quantity unit', () => {
    renderPanel(docAB());
    const cells = (label: string) => Array.from(row(label).cells).map((c) => c.textContent ?? '');
    // Columns: Element, Basis, Quantity, Original, Currentised, Adjustment, Adjusted, ...
    let strip = cells('Strip-out');
    expect(strip[3]).toBe('£80.00/m²');
    expect(strip[4]).toBe('£79.80/m²');
    expect(strip[6]).toBe('£79.80/m²');
    expect((screen.getByLabelText('Quantity strip_out') as HTMLInputElement).value).toBe('600');
    fireEvent.click(screen.getByRole('button', { name: 'ft²' }));
    strip = cells('Strip-out');
    // The original rate stays in its published unit; the currentised and adjusted rates flip.
    expect(strip[3]).toBe('£80.00/m²');
    expect(strip[4]).toMatch(/^£7\.41\/ft²$/);
    expect(strip[6]).toMatch(/\/ft²$/);
    expect((screen.getByLabelText('Quantity strip_out') as HTMLInputElement).value).toBe('6458.3463');
    expect(screen.getByText('Benchmark rate').nextSibling!.textContent).toMatch(/\/ft²$/);
  });

  it('an area quantity typed in ft² is stored as canonical m²', () => {
    const { onChange } = renderPanel(docAB());
    fireEvent.click(screen.getByRole('button', { name: 'ft²' }));
    fireEvent.change(screen.getByLabelText('Quantity strip_out'), { target: { value: '10763.9104' } });
    const block = onChange.mock.calls[0][0].elemental_benchmark as SchemeElementalBenchmark;
    expect(block.selections.find((s) => s.element_code === 'strip_out')!.quantity).toBeCloseTo(1000, 3);
  });

  it('apply: the confirmation lists creates, replaces and blocked; Confirm emits a benchmark_origin package', () => {
    const doc = docABWith((b) => {
      for (const s of b.selections) {
        if (s.element_code === 'strip_out' || s.element_code === 'mechanical_services') s.include_in_cost_plan = true;
      }
    });
    const { onChange } = renderPanel(doc);
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected (3)' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm apply' });
    expect(within(dialog).getByText(/Mechanical services \(benchmark\)/)).toBeTruthy();
    expect(within(dialog).getByText(new RegExp(FIXED_PRICE_BLOCK_REASON))).toBeTruthy();
    expect(within(dialog).getByText(new RegExp(USER_PACKAGE_BLOCK_REASON))).toBeTruthy();
    expect(within(dialog).getByText(/^Kitchens: £/)).toBeTruthy();
    expect(within(dialog).getByText(/matches the currentisation date 2026-06-01/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Confirm apply' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onChange).toHaveBeenCalledTimes(1);
    const partial = onChange.mock.calls[0][0] as Partial<CalculatorInputsV17>;
    const created = partial.cost_plan!.packages.find((p) => p.benchmark_origin?.element_code === 'mechanical_services');
    expect(created).toBeTruthy();
    expect(created!.price_basis).toBe('estimate');
    expect(created!.benchmark_origin!.set_content_hash).toBe(doc.elemental_benchmark!.set.content_hash);
    expect(partial.elemental_benchmark!.applications).toHaveLength(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('apply: a refusal is shown and Confirm stays disabled', () => {
    const doc = docABWith((b) => { b.set.currentisation_date = null; });
    const { onChange } = renderPanel(doc);
    fireEvent.click(screen.getByRole('button', { name: /Apply selected/ }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm apply' });
    expect(within(dialog).getByText(NO_CURRENTISATION_DATE_REFUSAL)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Confirm apply' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Export template downloads the 39-row catalogue CSV', () => {
    renderPanel(docAB());
    fireEvent.click(screen.getByRole('button', { name: 'Export template' }));
    expect(download).toHaveBeenCalledTimes(1);
    const [name, csv, mime] = download.mock.calls[0];
    expect(name).toBe('benchmark-set-template.csv');
    expect(mime).toMatch(/^text\/csv/);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(benchmarkApi.TEMPLATE_CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(40);
  });

  it('Download audit record emits JSON carrying the content hash and the result', () => {
    const { run } = renderPanel(docAB());
    fireEvent.click(screen.getByRole('button', { name: 'Download audit record' }));
    const [name, json, mime] = download.mock.calls[0];
    const hash = run.metrics.elemental_benchmark!.content_hash;
    expect(name).toBe(`benchmark-audit-${hash.slice(0, 12)}.json`);
    expect(mime).toBe('application/json');
    expect(json).toContain(hash);
    const record = JSON.parse(json) as { result: { enters_tdc: boolean; rows: unknown[] }; set_header: { name: string } };
    expect(record.result.enters_tdc).toBe(false);
    expect(record.result.rows).toHaveLength(7);
    expect(record.set_header.name).toBe(abSet().name);
  });

  it('Clear selection needs window.confirm and then nulls the block', () => {
    const { onChange } = renderPanel(docAB());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onChange).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onChange).toHaveBeenCalledWith({ elemental_benchmark: null });
    confirm.mockRestore();
  });

  it('Add element emits a selection: no rate -> unpriced, area quantity from the result', () => {
    const { run, onChange } = renderPanel(docAB());
    const picker = screen.getByLabelText('Add element') as HTMLSelectElement;
    const options = Array.from(picker.options).map((o) => o.value);
    expect(options).not.toContain('strip_out');
    expect(options).toContain('demolition');
    fireEvent.change(picker, { target: { value: 'demolition' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add element' }));
    const block = onChange.mock.calls[0][0].elemental_benchmark as SchemeElementalBenchmark;
    expect(block.selections).toHaveLength(8);
    const added = block.selections[7];
    expect(added).toMatchObject({
      element_code: 'demolition', benchmark_rate_id: null, quantity: run.metrics.elemental_benchmark!.area_sqm,
      quantity_unit: 'sqm', include_in_cost_plan: false, target_cost_package_id: null, selected_by: 'user',
    });
    expect(added.selected_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The other selections and the set are untouched.
    expect(block.set).toEqual(docAB().elemental_benchmark!.set);
  });

  it('row edits: package mapping, include, adjustment and remove write only the selection', () => {
    const { onChange } = renderPanel(docAB());
    fireEvent.change(screen.getByLabelText('Package strip_out'), { target: { value: 'pkg-mande' } });
    fireEvent.click(screen.getByLabelText('Include strip_out'));
    fireEvent.change(screen.getByLabelText('Adjustment strip_out'), { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('Remove preliminaries'));
    const blocks = onChange.mock.calls.map((c) => c[0].elemental_benchmark as SchemeElementalBenchmark);
    const strip = (b: SchemeElementalBenchmark) => b.selections.find((s) => s.element_code === 'strip_out')!;
    expect(strip(blocks[0]).target_cost_package_id).toBe('pkg-mande');
    expect(strip(blocks[1]).include_in_cost_plan).toBe(true);
    expect(strip(blocks[2]).adjustment_pct).toBe(5);
    expect(blocks[3].selections.map((s) => s.element_code)).not.toContain('preliminaries');
    expect(blocks[3].selections).toHaveLength(6);
  });

  it('thresholds editor writes the block thresholds; a set-header edit recomputes the content hash', () => {
    const { onChange } = renderPanel(docAB());
    fireEvent.change(screen.getByLabelText('Material variance %'), { target: { value: '20' } });
    expect((onChange.mock.calls[0][0].elemental_benchmark as SchemeElementalBenchmark).thresholds.material_variance_pct).toBe(20);
    fireEvent.click(screen.getByRole('button', { name: 'Edit set header' }));
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'North West' } });
    const edited = (onChange.mock.calls[1][0].elemental_benchmark as SchemeElementalBenchmark).set;
    expect(edited.region).toBe('North West');
    expect(edited.content_hash).not.toBe(abSet().content_hash);
    expect(edited.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the assumed % p.a. helper writes a named current index and the currentisation date', () => {
    const doc = docABWith((b) => { b.set.current_index_name = null; b.set.current_index_value = null; });
    const { onChange } = renderPanel(doc);
    fireEvent.click(screen.getByRole('button', { name: 'Currentisation helper' }));
    fireEvent.change(screen.getByLabelText('Assumed % p.a.'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use assumed rate' }));
    const set = (onChange.mock.calls[0][0].elemental_benchmark as SchemeElementalBenchmark).set;
    expect(set.current_index_name).toBe('assumed: 5% p.a.');
    // base 120, 12 months at 5% → 126 (a UI input helper; the engine only ever divides current by base).
    expect(set.current_index_value).toBeCloseTo(126, 3);
    expect(set.currentisation_date).toBe('2026-06-01');
    expect(set.index_dataset_version).toBeNull();
  });

  it('Import from library lists the sets, embeds the chosen one with library_set_id and resets selections', async () => {
    vi.mocked(benchmarkApi.listBenchmarkSets).mockResolvedValue([
      { id: 'lib-1', name: 'Library set', provider_type: 'public_benchmark', provider_name: 'P', dataset_version: 'v2', base_date: '2026-01-01', currentisation_date: null, content_hash: 'h', created_at: 'c', region: 'r', project_type: 'conversion' },
    ]);
    vi.mocked(benchmarkApi.getBenchmarkSet).mockResolvedValue({ ...abSet(), id: 'lib-1', name: 'Library set' });
    const { onChange } = renderPanel(docAB());
    fireEvent.click(screen.getByRole('button', { name: 'Import from library' }));
    const option = await screen.findByRole('option', { name: /Library set — Public benchmark, v2/ });
    fireEvent.change(screen.getByLabelText('Library set'), { target: { value: (option as HTMLOptionElement).value } });
    fireEvent.click(screen.getByRole('button', { name: 'Use this set' }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(benchmarkApi.getBenchmarkSet).toHaveBeenCalledWith('lib-1');
    const block = onChange.mock.calls[0][0].elemental_benchmark as SchemeElementalBenchmark;
    expect(block.library_set_id).toBe('lib-1');
    expect(block.set.name).toBe('Library set');
    expect(block.selections).toEqual([]);
    expect(block.applications).toHaveLength(1);
  });

  it('Import JSON posts the document and reports a 422 detail inline', async () => {
    vi.mocked(benchmarkApi.importBenchmarkSetJson).mockRejectedValue(
      new (await import('../../lib/api')).ApiError(422, 'HTTP 422', [{ severity: 'error', field: 'rates', message: 'no rates' }]),
    );
    const { onChange } = renderPanel(docAB());
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON' }));
    fireEvent.change(screen.getByLabelText('Benchmark set JSON'), { target: { value: '{"name":"x"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import to library and embed' }));
    expect(await screen.findByText('rates: no rates')).toBeTruthy();
    expect(benchmarkApi.importBenchmarkSetJson).toHaveBeenCalledWith({ name: 'x' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Add manual benchmark: the header form, a rate row and Save embed a hashed set with the typed rate', () => {
    const { onChange } = renderPanel(docABWithoutBenchmark());
    fireEvent.click(screen.getByRole('button', { name: 'Add manual benchmark' }));
    fireEvent.change(screen.getByLabelText('Set name'), { target: { value: 'Manual' } });
    fireEvent.change(screen.getByLabelText('Provider name'), { target: { value: 'Me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rate row' }));
    fireEvent.change(screen.getByLabelText('Rate element facilitating_works'), { target: { value: 'strip_out' } });
    fireEvent.change(screen.getByLabelText('Rate basis strip_out'), { target: { value: 'area' } });
    fireEvent.change(screen.getByLabelText('Rate strip_out'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save benchmark to document' }));
    const block = onChange.mock.calls[0][0].elemental_benchmark as SchemeElementalBenchmark;
    expect(block.library_set_id).toBeNull();
    expect(block.set.name).toBe('Manual');
    expect(block.set.provider_type).toBe('user_qs');
    expect(block.set.rates).toHaveLength(1);
    expect(block.set.rates[0]).toMatchObject({ element_code: 'strip_out', measurement_basis: 'area', original_unit: 'gbp_per_sqm', original_rate_pence: 8000 });
    expect(block.set.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(block.set.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('empty state: no table, only the import actions and the standing sentences', () => {
    renderPanel(docABWithoutBenchmark());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /Apply selected/ })).toBeNull();
    expect(screen.getByText(/No benchmark set is attached/)).toBeTruthy();
    for (const name of ['Import from library', 'Import JSON', 'Import CSV', 'Add manual benchmark']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByText(/initial reasonableness check/)).toBeTruthy();
  });
});
