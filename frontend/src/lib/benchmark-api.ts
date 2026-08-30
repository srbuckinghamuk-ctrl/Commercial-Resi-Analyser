/**
 * R17 spec §27.6 / §27.8. The benchmark-library names the ElementalBenchmarkPanel
 * imports, plus the two client-side file builders it downloads (the CSV import
 * template and the audit record).
 *
 * Every network function delegates to `api.ts` -- its `request()` carries the
 * bearer token, and every benchmark route is authenticated -- so this module
 * holds no fetch of its own. The adapters only narrow the return types to the
 * engine's `ElementalBenchmarkSet` and keep the panel's snake_case
 * currentisation options. Every network function throws `ApiError` on a
 * non-2xx response, so callers can render `formatApiErrorDetail`.
 */
import * as api from './api';
import type {
  BenchmarkApplication, ElementalBenchmarkResult, ElementalBenchmarkSet, ProviderType,
} from './model/elemental-benchmark';
import { ELEMENT_CATALOGUE, UNITS_FOR_BASIS } from './model/elemental-benchmark';

/** The list route's row: the set header without its rates. */
export interface BenchmarkSetHeader {
  id: string;
  name: string;
  provider_type: ProviderType;
  provider_name: string;
  dataset_version: string;
  base_date: string;
  currentisation_date: string | null;
  content_hash: string;
  created_at: string;
  region: string;
  project_type: string;
  [key: string]: unknown;
}

export interface IndexDatasetHeader {
  id: string;
  publisher: string;
  series_code: string;
  series_name: string | null;
  dataset_version: string;
  base_period: string;
  observation_count: number;
  first_period: string | null;
  last_period: string | null;
  [key: string]: unknown;
}

export interface IndexObservation {
  period: string;
  value: number;
}

export interface IndexDataset extends IndexDatasetHeader {
  observations: IndexObservation[];
}

export async function listBenchmarkSets(): Promise<BenchmarkSetHeader[]> {
  return (await api.listBenchmarkSets()) as unknown as BenchmarkSetHeader[];
}

/** GET one set, optionally re-currentised by the server (`currentisation_date`
 *  and `current_index_value` are the route's two query parameters). */
export async function getBenchmarkSet(
  id: string,
  opts: { currentisation_date?: string | null; current_index_value?: number | null } = {},
): Promise<ElementalBenchmarkSet> {
  return (await api.getBenchmarkSet(id, {
    currentisationDate: opts.currentisation_date || undefined,
    currentIndexValue: opts.current_index_value ?? undefined,
  })) as unknown as ElementalBenchmarkSet;
}

/** POST a JSON document (an `ElementalBenchmarkSet` without `id`,
 *  `created_at` or `content_hash`); the server validates §27.5 rules 1–12
 *  and returns the stored set with its hash. */
export async function importBenchmarkSetJson(document: Record<string, unknown>): Promise<ElementalBenchmarkSet> {
  return (await api.importBenchmarkSet(document)) as unknown as ElementalBenchmarkSet;
}

/** Multipart import: `file` is the template-columned CSV, `header` the set
 *  header (everything but `rates`) as a JSON string form field. */
export async function importBenchmarkSetCsv(
  file: File, header: Record<string, unknown>,
): Promise<ElementalBenchmarkSet> {
  return (await api.importBenchmarkSetCsv(file, header)) as unknown as ElementalBenchmarkSet;
}

export async function listIndexDatasets(): Promise<IndexDatasetHeader[]> {
  return (await api.listIndexDatasets()) as unknown as IndexDatasetHeader[];
}

export async function getIndexDataset(id: string): Promise<IndexDataset> {
  return (await api.getIndexDataset(id)) as unknown as IndexDataset;
}

// --- client-side file builders --------------------------------------------

export const TEMPLATE_CSV_COLUMNS = [
  'element_code', 'element_label', 'measurement_basis', 'original_unit', 'original_rate_pence', 'rate_pct',
  'lower_quartile_rate_pence', 'median_rate_pence', 'upper_quartile_rate_pence', 'sample_count',
  'location_factor', 'evidence_status', 'source_reference', 'notes',
] as const;

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The import template: the header row then one row per catalogue element
 *  (39), pre-filled with its code, label, default basis and that basis's
 *  first admissible unit; every rate column blank for the user to fill. */
export function templateCsv(): string {
  const lines = [TEMPLATE_CSV_COLUMNS.join(',')];
  for (const entry of ELEMENT_CATALOGUE) {
    const cells: Record<(typeof TEMPLATE_CSV_COLUMNS)[number], string> = {
      element_code: entry.code, element_label: entry.label, measurement_basis: entry.default_basis,
      original_unit: UNITS_FOR_BASIS[entry.default_basis][0], original_rate_pence: '', rate_pct: '',
      lower_quartile_rate_pence: '', median_rate_pence: '', upper_quartile_rate_pence: '', sample_count: '',
      location_factor: '', evidence_status: '', source_reference: '', notes: '',
    };
    lines.push(TEMPLATE_CSV_COLUMNS.map((c) => csvCell(cells[c])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** The audit record: the engine's result block verbatim, the set header
 *  (rates omitted — the content hash pins them) and the application history. */
export function auditRecord(
  result: ElementalBenchmarkResult,
  set: ElementalBenchmarkSet,
  applications: BenchmarkApplication[],
  generatedAt: string,
): Record<string, unknown> {
  const { rates, ...header } = set;
  return {
    generated_at: generatedAt,
    result,
    set_header: header,
    rate_count: rates.length,
    applications: applications.map(({ previous_cost_plan, ...rest }) => ({
      ...rest, previous_cost_plan_package_count: previous_cost_plan.packages.length,
    })),
  };
}

/** Browser download via a Blob URL. A no-op where `URL.createObjectURL` is
 *  missing (jsdom), so the panel's tests spy on this rather than the DOM. */
export function downloadTextFile(filename: string, text: string, mime: string): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
