/**
 * R17 spec §27 (design §4.3). The elemental cost benchmark panel, rendered
 * once at the foot of the Conversion Costs page.
 *
 * Reads: `run.metrics.elemental_benchmark` (every figure it prints — this
 * file does no arithmetic on rates or amounts), `run.validation` (the
 * `elemental_benchmark` root), `inputs.elemental_benchmark` (the block it
 * edits) and `inputs.cost_plan.packages` (the mapping targets). It never
 * reads a guarded raw field. Writes go through `onChange` as whole-block
 * replacements; a set edit recomputes `content_hash` via
 * `benchmarkContentHash` so the hash never lags the content (§27.6).
 *
 * Everything shown is ADVISORY (§27.4): nothing enters the cost plan until
 * "Apply selected" is confirmed, and that path is `planApplication` →
 * `applyBenchmark` (apply-benchmark.ts), never a local edit of packages.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AppraisalRun, CalculatorInputsV17, ElementCode, ElementalBenchmarkRate, ElementalBenchmarkRow,
  ElementalBenchmarkSet, ProviderType, SchemeElementalBenchmark, SchemeElementalCostSelection,
  MeasurementBasis, ApplicationPlan, BenchmarkThresholds,
} from '../../lib/model';
import {
  ELEMENT_CATALOGUE, ELEMENT_BY_CODE, PROVIDER_LABEL, PROVIDER_TYPES, DEFAULT_THRESHOLDS,
  BENCHMARK_LIMITATION_SENTENCE, benchmarkContentHash, UNITS_FOR_BASIS, QUANTITY_UNIT_FOR_BASIS,
  MEASUREMENT_BASES, RATE_EVIDENCE_STATUSES, BENCHMARK_PROJECT_TYPES, planApplication, applyBenchmark,
  monthsBetween,
} from '../../lib/model';
import { penceToPounds, penceToPoundsExact, signedPenceToPounds, formatPct, humanise } from '../../lib/format';
import { displayArea, entryAreaToSqm, formatRatePence, areaUnitLabel } from '../../lib/area-units';
import { useAreaUnit } from '../../lib/area-unit-context';
import AreaUnitToggle from '../AreaUnitToggle';
import {
  listBenchmarkSets, getBenchmarkSet, importBenchmarkSetJson, importBenchmarkSetCsv,
  listIndexDatasets, getIndexDataset, templateCsv, auditRecord, downloadTextFile,
} from '../../lib/benchmark-api';
import type { BenchmarkSetHeader, IndexDataset, IndexDatasetHeader } from '../../lib/benchmark-api';
import { formatApiErrorDetail, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fieldRoot } from './page-status';

interface Props {
  inputs: CalculatorInputsV17;
  onChange: (partial: Partial<CalculatorInputsV17>) => void;
  run: AppraisalRun;
}

type Mode = 'idle' | 'library' | 'json' | 'csv' | 'manual' | 'edit_header' | 'currentise' | 'confirm';

/** The actor recorded on selections and applications when nobody is signed
 *  in; otherwise the signed-in user's display name (`useAuth()`). */
const ACTOR = 'user';

const ADVISORY_SENTENCE = 'Benchmark rates are advisory: nothing here enters the cost plan until you apply it.';
const BCIS_REDISTRIBUTION_NOTE = 'User-supplied licensed data — verify redistribution rights';

const inputStyle = {
  padding: '4px 8px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4,
  color: '#e2e8f0', fontSize: 13,
} as const;
const cellStyle = { padding: '6px 8px', borderBottom: '1px solid #1e3a5f', fontSize: 13, color: '#e2e8f0', verticalAlign: 'top' } as const;
const headStyle = { ...cellStyle, color: '#94a3b8', fontWeight: 500, textAlign: 'left', whiteSpace: 'nowrap' } as const;
const buttonStyle = {
  padding: '6px 12px', background: '#1e3a5f', border: '1px solid #2b4a75', borderRadius: 4,
  color: '#e2e8f0', fontSize: 13, cursor: 'pointer',
} as const;
const mutedStyle = { color: '#64748b', fontSize: 12 } as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function withHash(set: ElementalBenchmarkSet): ElementalBenchmarkSet {
  return { ...set, content_hash: benchmarkContentHash(set) };
}

function newSetDraft(actor: string): ElementalBenchmarkSet {
  return withHash({
    id: crypto.randomUUID(), name: '', provider_type: 'user_qs', provider_name: '', source_title: '',
    source_url: null, source_publication_date: null, retrieved_at: null, licence_or_permission: '',
    dataset_version: '', building_function: '', project_type: 'conversion', specification_level: '',
    region: '', location_factor: null, location_factor_source: null, base_date: today(),
    base_index_name: null, base_index_value: null, current_index_name: null, current_index_value: null,
    index_dataset_version: null, currentisation_date: null, currency: 'GBP', notes: '', imported_by: actor,
    created_at: new Date().toISOString(), source_file_sha256: null, content_hash: '', rates: [],
  });
}

function newRate(code: ElementCode): ElementalBenchmarkRate {
  const entry = ELEMENT_BY_CODE.get(code)!;
  return {
    id: crypto.randomUUID(), element_code: code, element_label: entry.label, description: '',
    measurement_basis: entry.default_basis, original_unit: UNITS_FOR_BASIS[entry.default_basis][0],
    original_rate_pence: 0, rate_pct: entry.default_basis === 'percentage' ? 0 : null,
    lower_quartile_rate_pence: null, median_rate_pence: null, upper_quartile_rate_pence: null,
    sample_count: null, location_factor: null, evidence_status: 'unverified', source_reference: '', notes: '',
  };
}

function errorLines(e: unknown): string[] {
  if (e instanceof ApiError) {
    const lines = formatApiErrorDetail(e.detail);
    return lines.length > 0 ? lines : [e.message];
  }
  return [e instanceof Error ? e.message : String(e)];
}

const ORIGINAL_UNIT_SUFFIX = {
  gbp_per_sqm: '/m²', gbp_per_sqft: '/ft²', gbp_per_unit: '/unit', gbp_per_item: '/item', gbp: '',
} as const;

function printOriginalRate(row: ElementalBenchmarkRow): string {
  if (row.original_unit === 'pct') return row.rate_pct == null ? '—' : `${row.rate_pct}%`;
  return `${penceToPoundsExact(row.original_rate_pence)}${ORIGINAL_UNIT_SUFFIX[row.original_unit]}`;
}

/** A currentised or adjusted rate in the display unit: the engine's per-m²
 *  figure through `formatRatePence` for area rows, its per-unit/item/lump
 *  figure otherwise; a percentage row prints its percentage. */
function printRate(
  row: ElementalBenchmarkRow, perSqm: number | null, pence: number | null, unit: 'metric' | 'imperial',
): string {
  if (row.measurement_basis === 'area') return perSqm == null ? '—' : formatRatePence(perSqm, unit);
  if (row.measurement_basis === 'percentage') return row.rate_pct == null ? '—' : `${row.rate_pct}%`;
  return pence == null ? '—' : penceToPoundsExact(pence);
}

// ---------------------------------------------------------------------------
// Set header form (manual set, CSV header, and editing the embedded set)
// ---------------------------------------------------------------------------

type HeaderKey = Exclude<keyof ElementalBenchmarkSet, 'id' | 'created_at' | 'content_hash' | 'rates' | 'currency' | 'source_file_sha256'>;

/** §27.5 rules 1–2: the per-tier required header fields, as validation.ts
 *  enforces them; shown with an asterisk. */
const TIER_REQUIRED: Record<ProviderType, readonly HeaderKey[]> = {
  bcis_licensed: [
    'source_title', 'licence_or_permission', 'imported_by', 'building_function', 'source_publication_date',
    'location_factor', 'base_index_name', 'base_index_value',
  ],
  public_benchmark: ['provider_name', 'source_title', 'source_url', 'licence_or_permission', 'source_publication_date', 'retrieved_at'],
  user_qs: ['provider_name', 'source_title'],
};

interface HeaderField { key: HeaderKey; label: string; kind: 'text' | 'date' | 'number' | 'provider' | 'project_type' }
const HEADER_FIELDS: readonly HeaderField[] = [
  { key: 'name', label: 'Set name', kind: 'text' },
  { key: 'provider_type', label: 'Provider type', kind: 'provider' },
  { key: 'provider_name', label: 'Provider name', kind: 'text' },
  { key: 'source_title', label: 'Source title', kind: 'text' },
  { key: 'source_url', label: 'Source URL', kind: 'text' },
  { key: 'source_publication_date', label: 'Source publication date', kind: 'date' },
  { key: 'retrieved_at', label: 'Retrieved at', kind: 'date' },
  { key: 'licence_or_permission', label: 'Licence or permission', kind: 'text' },
  { key: 'dataset_version', label: 'Dataset version', kind: 'text' },
  { key: 'building_function', label: 'Building function', kind: 'text' },
  { key: 'project_type', label: 'Project / work type', kind: 'project_type' },
  { key: 'specification_level', label: 'Specification level', kind: 'text' },
  { key: 'region', label: 'Region', kind: 'text' },
  { key: 'location_factor', label: 'Location factor (100 = national)', kind: 'number' },
  { key: 'location_factor_source', label: 'Location factor source', kind: 'text' },
  { key: 'base_date', label: 'Base date', kind: 'date' },
  { key: 'currentisation_date', label: 'Currentisation date', kind: 'date' },
  { key: 'base_index_name', label: 'Base index name', kind: 'text' },
  { key: 'base_index_value', label: 'Base index value', kind: 'number' },
  { key: 'current_index_name', label: 'Current index name', kind: 'text' },
  { key: 'current_index_value', label: 'Current index value', kind: 'number' },
  { key: 'index_dataset_version', label: 'Index dataset version', kind: 'text' },
  { key: 'imported_by', label: 'Imported by', kind: 'text' },
  { key: 'notes', label: 'Notes', kind: 'text' },
];

function SetHeaderForm({ set, onPatch }: {
  set: ElementalBenchmarkSet;
  onPatch: (patch: Partial<ElementalBenchmarkSet>) => void;
}) {
  const required = TIER_REQUIRED[set.provider_type];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
      {HEADER_FIELDS.map((f) => {
        const value = set[f.key];
        const label = `${f.label}${required.includes(f.key) ? ' *' : ''}`;
        let control;
        if (f.kind === 'provider') {
          control = (
            <select aria-label={f.label} value={set.provider_type} style={inputStyle}
              onChange={(e) => onPatch({ provider_type: e.target.value as ProviderType })}>
              {PROVIDER_TYPES.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
            </select>
          );
        } else if (f.kind === 'project_type') {
          control = (
            <select aria-label={f.label} value={set.project_type} style={inputStyle}
              onChange={(e) => onPatch({ project_type: e.target.value as ElementalBenchmarkSet['project_type'] })}>
              {BENCHMARK_PROJECT_TYPES.map((p) => <option key={p} value={p}>{humanise(p)}</option>)}
            </select>
          );
        } else if (f.kind === 'number') {
          control = (
            <input aria-label={f.label} type="number" style={inputStyle}
              value={typeof value === 'number' ? value : ''}
              onChange={(e) => onPatch({ [f.key]: e.target.value === '' ? null : Number(e.target.value) } as Partial<ElementalBenchmarkSet>)} />
          );
        } else {
          const nullable = f.kind === 'date' || f.key === 'source_url' || f.key === 'location_factor_source'
            || f.key === 'base_index_name' || f.key === 'current_index_name' || f.key === 'index_dataset_version';
          control = (
            <input aria-label={f.label} type={f.kind} style={inputStyle}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onPatch({ [f.key]: nullable && e.target.value === '' ? null : e.target.value } as Partial<ElementalBenchmarkSet>)} />
          );
        }
        return (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, ...mutedStyle }}>
            <span>{label}</span>
            {control}
          </label>
        );
      })}
      {set.provider_type === 'bcis_licensed' && (
        <div style={{ gridColumn: '1 / -1', color: '#fbbf24', fontSize: 12 }}>{BCIS_REDISTRIBUTION_NOTE}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline rate editor (manual set)
// ---------------------------------------------------------------------------

function RateRowsEditor({ rates, onChange }: {
  rates: ElementalBenchmarkRate[];
  onChange: (rates: ElementalBenchmarkRate[]) => void;
}) {
  const patch = (id: string, p: Partial<ElementalBenchmarkRate>) =>
    onChange(rates.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const poundsInput = (r: ElementalBenchmarkRate, key: 'original_rate_pence' | 'lower_quartile_rate_pence' | 'median_rate_pence' | 'upper_quartile_rate_pence', label: string) => (
    <input aria-label={`${label} ${r.element_code}`} type="number" step="0.01" style={{ ...inputStyle, width: 90 }}
      value={r[key] == null ? '' : (r[key] as number) / 100}
      onChange={(e) => patch(r.id, {
        [key]: e.target.value === '' ? (key === 'original_rate_pence' ? 0 : null) : Math.round(Number(e.target.value) * 100),
      })} />
  );
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {['Element', 'Basis', 'Unit', 'Rate (£)', 'Rate %', 'LQ (£)', 'Median (£)', 'UQ (£)', 'Sample', 'Evidence', 'Source ref', ''].map((h) => (
              <th key={h} style={headStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.id}>
              <td style={cellStyle}>
                <select aria-label={`Rate element ${r.element_code}`} value={r.element_code} style={inputStyle}
                  onChange={(e) => {
                    const code = e.target.value as ElementCode;
                    patch(r.id, { element_code: code, element_label: ELEMENT_BY_CODE.get(code)!.label });
                  }}>
                  {ELEMENT_CATALOGUE.map((el) => <option key={el.code} value={el.code}>{el.label}</option>)}
                </select>
              </td>
              <td style={cellStyle}>
                <select aria-label={`Rate basis ${r.element_code}`} value={r.measurement_basis} style={inputStyle}
                  onChange={(e) => {
                    const basis = e.target.value as MeasurementBasis;
                    patch(r.id, {
                      measurement_basis: basis, original_unit: UNITS_FOR_BASIS[basis][0],
                      rate_pct: basis === 'percentage' ? (r.rate_pct ?? 0) : null,
                      original_rate_pence: basis === 'percentage' ? 0 : r.original_rate_pence,
                    });
                  }}>
                  {MEASUREMENT_BASES.map((b) => <option key={b} value={b}>{humanise(b)}</option>)}
                </select>
              </td>
              <td style={cellStyle}>
                <select aria-label={`Rate unit ${r.element_code}`} value={r.original_unit} style={inputStyle}
                  onChange={(e) => patch(r.id, { original_unit: e.target.value as ElementalBenchmarkRate['original_unit'] })}>
                  {UNITS_FOR_BASIS[r.measurement_basis].map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </td>
              <td style={cellStyle}>{r.measurement_basis === 'percentage' ? '—' : poundsInput(r, 'original_rate_pence', 'Rate')}</td>
              <td style={cellStyle}>
                {r.measurement_basis === 'percentage' ? (
                  <input aria-label={`Rate pct ${r.element_code}`} type="number" step="0.01" style={{ ...inputStyle, width: 70 }}
                    value={r.rate_pct ?? 0} onChange={(e) => patch(r.id, { rate_pct: Number(e.target.value) })} />
                ) : '—'}
              </td>
              <td style={cellStyle}>{poundsInput(r, 'lower_quartile_rate_pence', 'LQ')}</td>
              <td style={cellStyle}>{poundsInput(r, 'median_rate_pence', 'Median')}</td>
              <td style={cellStyle}>{poundsInput(r, 'upper_quartile_rate_pence', 'UQ')}</td>
              <td style={cellStyle}>
                <input aria-label={`Sample count ${r.element_code}`} type="number" style={{ ...inputStyle, width: 60 }}
                  value={r.sample_count ?? ''}
                  onChange={(e) => patch(r.id, { sample_count: e.target.value === '' ? null : Number(e.target.value) })} />
              </td>
              <td style={cellStyle}>
                <select aria-label={`Evidence ${r.element_code}`} value={r.evidence_status} style={inputStyle}
                  onChange={(e) => patch(r.id, { evidence_status: e.target.value as ElementalBenchmarkRate['evidence_status'] })}>
                  {RATE_EVIDENCE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td style={cellStyle}>
                <input aria-label={`Source reference ${r.element_code}`} style={{ ...inputStyle, width: 120 }}
                  value={r.source_reference} onChange={(e) => patch(r.id, { source_reference: e.target.value })} />
              </td>
              <td style={cellStyle}>
                <button type="button" style={buttonStyle} aria-label={`Remove rate ${r.element_code}`}
                  onClick={() => onChange(rates.filter((x) => x.id !== r.id))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" style={{ ...buttonStyle, marginTop: 8 }}
        onClick={() => onChange([...rates, newRate(ELEMENT_CATALOGUE[0].code)])}>
        Add rate row
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Currentisation helper
// ---------------------------------------------------------------------------

/** Writes the set's index fields from a library index dataset (two periods
 *  picked) or from an assumed annual rate. */
function CurrentisationHelper({ set, onPatch, onClose }: {
  set: ElementalBenchmarkSet;
  onPatch: (patch: Partial<ElementalBenchmarkSet>) => void;
  onClose: () => void;
}) {
  const [datasets, setDatasets] = useState<IndexDatasetHeader[] | null>(null);
  const [dataset, setDataset] = useState<IndexDataset | null>(null);
  const [basePeriod, setBasePeriod] = useState('');
  const [currentPeriod, setCurrentPeriod] = useState('');
  const [assumedPct, setAssumedPct] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    listIndexDatasets()
      .then((rows) => { if (live) setDatasets(rows); })
      .catch((e) => { if (live) setErrors(errorLines(e)); });
    return () => { live = false; };
  }, []);

  const pick = (id: string) => {
    setDataset(null);
    if (id === '') return;
    getIndexDataset(id).then((d) => {
      setDataset(d);
      setBasePeriod(d.observations[0]?.period ?? '');
      setCurrentPeriod(d.observations[d.observations.length - 1]?.period ?? '');
    }).catch((e) => setErrors(errorLines(e)));
  };

  const applyDataset = () => {
    if (dataset == null) return;
    const base = dataset.observations.find((o) => o.period === basePeriod);
    const current = dataset.observations.find((o) => o.period === currentPeriod);
    if (base == null || current == null) return;
    const name = `${dataset.publisher} ${dataset.series_code}`;
    const currentIso = /^\d{4}-\d{2}$/.test(current.period) ? `${current.period}-01` : current.period;
    onPatch({
      base_index_name: name, base_index_value: base.value,
      current_index_name: name, current_index_value: current.value,
      index_dataset_version: dataset.dataset_version,
      currentisation_date: /^\d{4}-\d{2}-\d{2}$/.test(currentIso) ? currentIso : set.currentisation_date,
    });
    onClose();
  };

  const applyAssumed = () => {
    const r = Number(assumedPct);
    if (!Number.isFinite(r)) return;
    const currentisationDate = set.currentisation_date ?? today();
    // UI input helper, not engine arithmetic: when no index dataset exists,
    // an assumed annual escalation is turned into a current index value so
    // the engine's index-ratio currentisation (§27.3) has a figure to work
    // from. It is labelled 'assumed: r% p.a.' so the audit record shows the
    // origin; the engine itself only ever divides current by base.
    const base = set.base_index_value ?? 100;
    const months = monthsBetween(set.base_date, currentisationDate);
    const current = base * (1 + r / 100) ** (months / 12);
    onPatch({
      base_index_name: set.base_index_name ?? 'assumed base',
      base_index_value: base,
      current_index_name: `assumed: ${r}% p.a.`,
      current_index_value: Math.round(current * 1000) / 1000,
      index_dataset_version: null,
      currentisation_date: currentisationDate,
    });
    onClose();
  };

  return (
    <div style={{ padding: 12, border: '1px solid #1e3a5f', borderRadius: 6, marginTop: 12 }}>
      <div style={{ color: '#e2e8f0', marginBottom: 8 }}>Currentisation helper</div>
      {errors.map((e) => <div key={e} style={{ color: '#f87171', fontSize: 12 }}>{e}</div>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select aria-label="Index dataset" style={inputStyle} defaultValue="" onChange={(e) => pick(e.target.value)}>
          <option value="">Pick an index dataset…</option>
          {(datasets ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.publisher} {d.series_code} {d.dataset_version} ({d.first_period}–{d.last_period})</option>
          ))}
        </select>
        {dataset != null && (
          <>
            <select aria-label="Base period" style={inputStyle} value={basePeriod} onChange={(e) => setBasePeriod(e.target.value)}>
              {dataset.observations.map((o) => <option key={o.period} value={o.period}>{o.period} ({o.value})</option>)}
            </select>
            <select aria-label="Current period" style={inputStyle} value={currentPeriod} onChange={(e) => setCurrentPeriod(e.target.value)}>
              {dataset.observations.map((o) => <option key={o.period} value={o.period}>{o.period} ({o.value})</option>)}
            </select>
            <button type="button" style={buttonStyle} onClick={applyDataset}>Use these periods</button>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <span style={mutedStyle}>Or assume</span>
        <input aria-label="Assumed % p.a." type="number" step="0.1" style={{ ...inputStyle, width: 80 }}
          value={assumedPct} onChange={(e) => setAssumedPct(e.target.value)} />
        <span style={mutedStyle}>% p.a. from the base date to the currentisation date (today if unset)</span>
        <button type="button" style={buttonStyle} onClick={applyAssumed} disabled={assumedPct === ''}>Use assumed rate</button>
      </div>
      <button type="button" style={{ ...buttonStyle, marginTop: 8 }} onClick={onClose}>Close</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export default function ElementalBenchmarkPanel({ inputs, onChange, run }: Props) {
  const { unit } = useAreaUnit();
  const block = inputs.elemental_benchmark;
  const result = run.metrics.elemental_benchmark;
  const packages = inputs.cost_plan.packages;
  const issues = run.validation.filter((i) => fieldRoot(i.field) === 'elemental_benchmark');

  const [mode, setMode] = useState<Mode>('idle');
  const [errors, setErrors] = useState<string[]>([]);
  const [plan, setPlan] = useState<ApplicationPlan | null>(null);
  const [library, setLibrary] = useState<BenchmarkSetHeader[]>([]);
  const [libraryId, setLibraryId] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const { user } = useAuth();
  const actor = user?.display_name || ACTOR;
  const [draft, setDraft] = useState<ElementalBenchmarkSet>(() => newSetDraft(actor));
  const [addCode, setAddCode] = useState<ElementCode | ''>('');

  const openMode = (next: Mode) => { setErrors([]); setMode(next); };

  const updateBlock = (patch: Partial<SchemeElementalBenchmark>) => {
    if (block == null) return;
    onChange({ elemental_benchmark: { ...block, ...patch } });
  };
  const updateSet = (patch: Partial<ElementalBenchmarkSet>) => {
    if (block == null) return;
    updateBlock({ set: withHash({ ...block.set, ...patch }) });
  };
  const updateSelection = (code: ElementCode, patch: Partial<SchemeElementalCostSelection>) => {
    if (block == null) return;
    updateBlock({ selections: block.selections.map((s) => (s.element_code === code ? { ...s, ...patch } : s)) });
  };
  const removeSelection = (code: ElementCode) => {
    if (block == null) return;
    updateBlock({ selections: block.selections.filter((s) => s.element_code !== code) });
  };
  const updateThresholds = (patch: Partial<BenchmarkThresholds>) => {
    if (block == null) return;
    updateBlock({ thresholds: { ...DEFAULT_THRESHOLDS, ...block.thresholds, ...patch } });
  };

  /** Embed a set as the document's benchmark. Selections are reset (they
   *  reference the previous set's rate ids); thresholds and the application
   *  history are kept. */
  const embed = (set: ElementalBenchmarkSet, librarySetId: string | null) => {
    onChange({
      elemental_benchmark: {
        set: withHash(set), selections: [],
        thresholds: block?.thresholds ?? { ...DEFAULT_THRESHOLDS },
        applications: block?.applications ?? [], library_set_id: librarySetId,
      },
    });
    setMode('idle');
  };

  const addElement = () => {
    if (block == null || result == null || addCode === '') return;
    const entry = ELEMENT_BY_CODE.get(addCode)!;
    const rate = block.set.rates.find((r) => r.element_code === addCode) ?? null;
    const basis = rate?.measurement_basis ?? entry.default_basis;
    const quantity = basis === 'area' ? result.area_sqm : basis === 'lump_sum' ? 1 : 0;
    const selection: SchemeElementalCostSelection = {
      element_code: addCode, benchmark_rate_id: rate?.id ?? null, quantity,
      quantity_unit: QUANTITY_UNIT_FOR_BASIS[basis], adjustment_pct: 0, adjustment_reason: '',
      include_in_cost_plan: false, target_cost_package_id: null, selected_by: actor, selected_at: today(),
    };
    updateBlock({ selections: [...block.selections, selection] });
    setAddCode('');
  };

  const openLibrary = () => {
    openMode('library');
    listBenchmarkSets().then(setLibrary).catch((e) => setErrors(errorLines(e)));
  };
  const useLibrarySet = () => {
    if (libraryId === '') return;
    getBenchmarkSet(libraryId).then((set) => embed(set, set.id)).catch((e) => setErrors(errorLines(e)));
  };
  const importJson = () => {
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      setErrors(['The text is not valid JSON.']);
      return;
    }
    importBenchmarkSetJson(doc).then((set) => embed(set, set.id)).catch((e) => setErrors(errorLines(e)));
  };
  const importCsv = () => {
    if (csvFile == null) { setErrors(['Choose a CSV file first.']); return; }
    const header: Record<string, unknown> = { ...draft };
    for (const k of ['rates', 'id', 'created_at', 'content_hash']) delete header[k];
    importBenchmarkSetCsv(csvFile, header).then((set) => embed(set, set.id)).catch((e) => setErrors(errorLines(e)));
  };
  const saveManual = () => embed({ ...draft, created_at: new Date().toISOString() }, null);
  const patchDraft = (patch: Partial<ElementalBenchmarkSet>) => setDraft((d) => withHash({ ...d, ...patch }));

  const applyCodes = block == null ? [] : block.selections.filter((s) => s.include_in_cost_plan).map((s) => s.element_code);
  const startApply = () => {
    setPlan(planApplication(inputs, applyCodes, actor, new Date().toISOString()));
    openMode('confirm');
  };
  const confirmApply = () => {
    if (plan == null || plan.refusal != null) return;
    const next = applyBenchmark(inputs, plan);
    onChange({ cost_plan: next.cost_plan, elemental_benchmark: next.elemental_benchmark });
    setPlan(null);
    setMode('idle');
  };

  const exportTemplate = () => downloadTextFile('benchmark-set-template.csv', templateCsv(), 'text/csv;charset=utf-8');
  const downloadAudit = () => {
    if (block == null || result == null) return;
    const record = auditRecord(result, block.set, block.applications, new Date().toISOString());
    downloadTextFile(`benchmark-audit-${result.content_hash.slice(0, 12)}.json`, JSON.stringify(record, null, 2), 'application/json');
  };
  const clearSelection = () => {
    if (window.confirm('Remove the benchmark set and every selection from this document? Packages already applied stay in the cost plan.')) {
      onChange({ elemental_benchmark: null });
    }
  };

  const importActions = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" style={buttonStyle} onClick={openLibrary}>Import from library</button>
      <button type="button" style={buttonStyle} onClick={() => openMode('json')}>Import JSON</button>
      <button type="button" style={buttonStyle} onClick={() => { setDraft(newSetDraft(actor)); setCsvFile(null); openMode('csv'); }}>Import CSV</button>
      <button type="button" style={buttonStyle} onClick={() => { setDraft(newSetDraft(actor)); openMode('manual'); }}>Add manual benchmark</button>
      <button type="button" style={buttonStyle} onClick={exportTemplate}>Export template</button>
    </div>
  );

  const importPanels = (
    <>
      {errors.length > 0 && (
        <div role="alert" style={{ marginTop: 8, color: '#f87171', fontSize: 12 }}>
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      )}
      {mode === 'library' && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="Library set" style={inputStyle} value={libraryId} onChange={(e) => setLibraryId(e.target.value)}>
            <option value="">Pick a benchmark set…</option>
            {library.map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {PROVIDER_LABEL[s.provider_type]}, {s.dataset_version}, base {s.base_date}</option>
            ))}
          </select>
          <button type="button" style={buttonStyle} onClick={useLibrarySet} disabled={libraryId === ''}>Use this set</button>
          <button type="button" style={buttonStyle} onClick={() => setMode('idle')}>Cancel</button>
        </div>
      )}
      {mode === 'json' && (
        <div style={{ marginTop: 12 }}>
          <textarea aria-label="Benchmark set JSON" rows={8} style={{ ...inputStyle, width: '100%', fontFamily: 'monospace' }}
            value={jsonText} onChange={(e) => setJsonText(e.target.value)} placeholder='{"name": "...", "provider_type": "user_qs", ..., "rates": [...]}' />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={buttonStyle} onClick={importJson}>Import to library and embed</button>
            <button type="button" style={buttonStyle} onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'csv' && (
        <div style={{ marginTop: 12 }}>
          <div style={mutedStyle}>CSV in the template's columns; the set header below is sent with it.</div>
          <input aria-label="Benchmark CSV file" type="file" accept=".csv,text/csv" style={{ margin: '8px 0', color: '#e2e8f0' }}
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
          <SetHeaderForm set={draft} onPatch={patchDraft} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={buttonStyle} onClick={importCsv}>Import CSV to library and embed</button>
            <button type="button" style={buttonStyle} onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}
      {mode === 'manual' && (
        <div style={{ marginTop: 12 }}>
          <SetHeaderForm set={draft} onPatch={patchDraft} />
          <div style={{ ...mutedStyle, margin: '8px 0' }}>Content hash: {draft.content_hash}</div>
          <RateRowsEditor rates={draft.rates} onChange={(rates) => patchDraft({ rates })} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" style={buttonStyle} onClick={saveManual}>Save benchmark to document</button>
            <button type="button" style={buttonStyle} onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );

  if (block == null || result == null) {
    return (
      <section aria-label="Elemental benchmark" style={{ marginTop: 32, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <h3 style={{ color: '#e2e8f0', margin: '0 0 8px', fontSize: 16 }}>Elemental cost benchmark</h3>
        <p style={mutedStyle}>{ADVISORY_SENTENCE}</p>
        <p style={mutedStyle}>{BENCHMARK_LIMITATION_SENTENCE}</p>
        <p style={mutedStyle}>No benchmark set is attached to this document. Import one from the library, paste a JSON export, upload a CSV in the template's columns, or enter a manual benchmark.</p>
        {importActions}
        {importPanels}
      </section>
    );
  }

  const set = block.set;
  const totals = result.totals;
  const selectionByCode = new Map(block.selections.map((s) => [s.element_code, s]));
  const available = ELEMENT_CATALOGUE.filter((e) => !selectionByCode.has(e.code));
  const verified = set.rates.filter((r) => r.evidence_status === 'verified').length;
  const headline = result.cost_plan_mode === 'headline';
  const packageLabel = (id: string | null) => (id == null ? '' : packages.find((p) => p.id === id)?.label ?? id);
  const elementLabel = (code: ElementCode) => ELEMENT_BY_CODE.get(code)?.label ?? code;

  const headerItem = (label: string, value: ReactNode) => (
    <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={mutedStyle}>{label}</span>
      <span style={{ color: '#e2e8f0', fontSize: 13, wordBreak: 'break-all' }}>{value}</span>
    </div>
  );

  return (
    <section aria-label="Elemental benchmark" style={{ marginTop: 32, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ color: '#e2e8f0', margin: 0, fontSize: 16 }}>Elemental cost benchmark</h3>
        <AreaUnitToggle compact />
      </div>
      <p style={{ ...mutedStyle, margin: '0 0 4px' }}>{ADVISORY_SENTENCE}</p>
      <p style={{ ...mutedStyle, margin: '0 0 12px' }}>{BENCHMARK_LIMITATION_SENTENCE}</p>

      {(result.warnings.length > 0 || issues.length > 0) && (
        <div role="status" style={{ marginBottom: 12, padding: 10, border: '1px solid #1e3a5f', borderRadius: 6 }}>
          {result.warnings.map((w) => (
            <div key={w.code} style={{ color: w.severity === 'red' ? '#f87171' : '#fbbf24', fontSize: 12 }}>
              {w.severity === 'red' ? 'Red' : 'Amber'}: {w.message}
            </div>
          ))}
          {issues.map((i) => (
            <div key={`${i.field}:${i.message}`} style={{ color: i.severity === 'error' ? '#f87171' : '#fbbf24', fontSize: 12 }}>
              {i.severity === 'error' ? 'Error' : 'Warning'}: {i.message}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
        {headerItem('Provider', (
          <>
            {result.provider_label}
            {result.provider_type === 'bcis_licensed' && <div style={{ color: '#fbbf24', fontSize: 12 }}>{BCIS_REDISTRIBUTION_NOTE}</div>}
          </>
        ))}
        {headerItem('Building function', result.building_function || '—')}
        {headerItem('Project / work type', humanise(result.project_type))}
        {headerItem('Specification level', result.specification_level || '—')}
        {headerItem('Region', result.region || '—')}
        {headerItem('Base date', result.base_date)}
        {headerItem('Currentisation date', result.currentisation_date ?? 'not set')}
        {headerItem('Source', (
          <>
            {set.source_title || '—'}
            {set.source_url && <> — <a href={set.source_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>{set.source_url}</a></>}
          </>
        ))}
        {headerItem('Dataset version / content hash', `${result.dataset_version || '—'} / ${result.content_hash}`)}
        {headerItem('Evidence / licence', `${verified} of ${set.rates.length} rates verified; ${set.licence_or_permission || 'no licence statement'}`)}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" style={buttonStyle} onClick={() => openMode(mode === 'edit_header' ? 'idle' : 'edit_header')}>Edit set header</button>
        <button type="button" style={buttonStyle} onClick={() => openMode(mode === 'currentise' ? 'idle' : 'currentise')}>Currentisation helper</button>
      </div>
      {mode === 'edit_header' && (
        <div style={{ marginBottom: 12 }}>
          <SetHeaderForm set={set} onPatch={updateSet} />
        </div>
      )}
      {mode === 'currentise' && <CurrentisationHelper set={set} onPatch={updateSet} onClose={() => setMode('idle')} />}

      <div style={{ overflowX: 'auto', marginTop: 12 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['Element', 'Basis', 'Quantity', 'Original rate', 'Currentised rate', 'User adjustment', 'Adjusted rate', 'Benchmark amount', 'QS/developer amount', 'Variance', 'Evidence', 'Cost-plan package', 'Include', ''].map((h) => (
                <th key={h} style={headStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => {
              const sel = selectionByCode.get(row.element_code);
              const code = row.element_code;
              return (
                <tr key={code} data-element={code}>
                  <td style={cellStyle}>{row.element_label}</td>
                  <td style={cellStyle}>{humanise(row.measurement_basis)}</td>
                  <td style={cellStyle}>
                    {row.measurement_basis === 'area' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <input aria-label={`Quantity ${code}`} type="number" step="0.0001" style={{ ...inputStyle, width: 100 }}
                          value={Number(displayArea(row.quantity, unit).toFixed(4))}
                          onChange={(e) => updateSelection(code, { quantity: entryAreaToSqm(Number(e.target.value), unit) })} />
                        <span style={mutedStyle}>{areaUnitLabel(unit)}</span>
                      </span>
                    ) : row.measurement_basis === 'per_unit' || row.measurement_basis === 'per_item' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <input aria-label={`Quantity ${code}`} type="number" step="1" style={{ ...inputStyle, width: 70 }}
                          value={row.quantity} onChange={(e) => updateSelection(code, { quantity: Number(e.target.value) })} />
                        <span style={mutedStyle}>{row.quantity_unit}</span>
                      </span>
                    ) : '—'}
                  </td>
                  <td style={cellStyle}>{printOriginalRate(row)}</td>
                  <td style={cellStyle}>{printRate(row, row.currentised_rate_pence_per_sqm, row.currentised_rate_pence, unit)}</td>
                  <td style={cellStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input aria-label={`Adjustment ${code}`} type="number" step="0.1" style={{ ...inputStyle, width: 60 }}
                        value={row.adjustment_pct} onChange={(e) => updateSelection(code, { adjustment_pct: Number(e.target.value) })} />
                      <span style={mutedStyle}>%</span>
                    </span>
                    <input aria-label={`Adjustment reason ${code}`} placeholder="reason" style={{ ...inputStyle, width: 140, marginTop: 4, display: 'block' }}
                      value={row.adjustment_reason} onChange={(e) => updateSelection(code, { adjustment_reason: e.target.value })} />
                  </td>
                  <td style={cellStyle}>{printRate(row, row.adjusted_rate_pence_per_sqm, row.adjusted_rate_pence, unit)}</td>
                  <td style={cellStyle}>{penceToPoundsExact(row.benchmark_amount_pence)}</td>
                  <td style={cellStyle}>{row.qs_amount_pence == null ? '—' : penceToPoundsExact(row.qs_amount_pence)}</td>
                  <td style={cellStyle}>
                    {row.variance_pence == null ? '—' : signedPenceToPounds(row.variance_pence)}
                    {row.variance_pct != null && <span style={mutedStyle}> ({formatPct(row.variance_pct)})</span>}
                  </td>
                  <td style={cellStyle}>
                    {row.benchmark_rate_id == null ? 'unpriced' : row.evidence_status}
                    {row.outside_range === true && <span style={{ color: '#fbbf24' }}> · outside range</span>}
                    {row.sample_count != null && <span style={mutedStyle}> n={row.sample_count}</span>}
                  </td>
                  <td style={cellStyle}>
                    <select aria-label={`Package ${code}`} style={inputStyle} disabled={headline}
                      value={sel?.target_cost_package_id ?? ''}
                      onChange={(e) => updateSelection(code, { target_cost_package_id: e.target.value === '' ? null : e.target.value })}>
                      <option value="">unmapped</option>
                      {packages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    {headline && <div style={mutedStyle}>headline mode: no packages</div>}
                  </td>
                  <td style={cellStyle}>
                    <input aria-label={`Include ${code}`} type="checkbox" checked={sel?.include_in_cost_plan ?? false}
                      onChange={(e) => updateSelection(code, { include_in_cost_plan: e.target.checked })} />
                  </td>
                  <td style={cellStyle}>
                    <button type="button" style={buttonStyle} aria-label={`Remove ${code}`} onClick={() => removeSelection(code)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <select aria-label="Add element" style={inputStyle} value={addCode} onChange={(e) => setAddCode(e.target.value as ElementCode | '')}>
          <option value="">Pick an element…</option>
          {available.map((e) => <option key={e.code} value={e.code}>{e.label}</option>)}
        </select>
        <button type="button" style={buttonStyle} onClick={addElement} disabled={addCode === ''}>Add element</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginTop: 16, padding: 12, border: '1px solid #1e3a5f', borderRadius: 6 }}>
        {headerItem('Benchmark base construction', penceToPounds(totals.benchmark_base_construction_pence))}
        {headerItem('QS/developer base construction', penceToPounds(totals.qs_base_construction_pence))}
        {headerItem('Difference', (
          <>
            {signedPenceToPounds(totals.difference_pence)}
            {totals.difference_pct != null && <span style={mutedStyle}> ({formatPct(totals.difference_pct)})</span>}
          </>
        ))}
        {headerItem('Benchmark rate', totals.benchmark_rate_pence_per_sqm == null ? '—' : formatRatePence(totals.benchmark_rate_pence_per_sqm, unit))}
        {headerItem('QS rate', totals.qs_rate_pence_per_sqm == null ? '—' : formatRatePence(totals.qs_rate_pence_per_sqm, unit))}
        {headerItem('Unpriced elements', String(totals.unpriced_elements))}
        {headerItem('Without evidence', String(totals.elements_without_evidence))}
        {headerItem('Outside range', String(totals.elements_outside_range))}
        {headerItem('Coverage', totals.coverage_pct == null ? '—' : formatPct(totals.coverage_pct))}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, ...mutedStyle }}>
          <span>Material variance % (flags a row whose variance exceeds it)</span>
          <input aria-label="Material variance %" type="number" style={{ ...inputStyle, width: 90 }}
            value={block.thresholds.material_variance_pct} onChange={(e) => updateThresholds({ material_variance_pct: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, ...mutedStyle }}>
          <span>Stale after months (base date older than this is stale)</span>
          <input aria-label="Stale after months" type="number" style={{ ...inputStyle, width: 90 }}
            value={block.thresholds.stale_after_months} onChange={(e) => updateThresholds({ stale_after_months: Number(e.target.value) })} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, ...mutedStyle }}>
          <span>Minimum coverage % (priced elements over the core catalogue)</span>
          <input aria-label="Minimum coverage %" type="number" style={{ ...inputStyle, width: 90 }}
            value={block.thresholds.min_coverage_pct} onChange={(e) => updateThresholds({ min_coverage_pct: Number(e.target.value) })} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <button type="button" style={buttonStyle} onClick={startApply} disabled={applyCodes.length === 0}>
          Apply selected ({applyCodes.length})
        </button>
        <button type="button" style={buttonStyle} onClick={downloadAudit}>Download audit record</button>
        <button type="button" style={buttonStyle} onClick={clearSelection}>Clear selection</button>
      </div>
      <div style={{ marginTop: 8 }}>{importActions}</div>
      {importPanels}

      {mode === 'confirm' && plan != null && (
        <div role="dialog" aria-label="Confirm apply" style={{ marginTop: 12, padding: 12, border: '1px solid #2b4a75', borderRadius: 6 }}>
          <div style={{ color: '#e2e8f0', marginBottom: 8 }}>Apply benchmark rows to the cost plan</div>
          {plan.refusal != null ? (
            <div style={{ color: '#f87171', fontSize: 13 }}>{plan.refusal}</div>
          ) : (
            <>
              {plan.creates.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={mutedStyle}>Creates</div>
                  {plan.creates.map((c) => (
                    <div key={c.element_code} style={{ color: '#e2e8f0', fontSize: 13 }}>
                      {c.label}: {penceToPoundsExact(c.amount_pence)} as a new {humanise(c.package_code)} estimate package
                    </div>
                  ))}
                </div>
              )}
              {plan.replaces.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={mutedStyle}>Replaces</div>
                  {plan.replaces.map((r) => (
                    <div key={r.element_code} style={{ color: '#e2e8f0', fontSize: 13 }}>
                      {elementLabel(r.element_code)}: {penceToPoundsExact(r.old_amount_pence)} → {penceToPoundsExact(r.new_amount_pence)} ({packageLabel(r.package_id)})
                    </div>
                  ))}
                </div>
              )}
              {plan.blocked.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={mutedStyle}>Blocked</div>
                  {plan.blocked.map((b) => (
                    <div key={`${b.element_code}:${b.package_id ?? ''}`} style={{ color: '#fbbf24', fontSize: 13 }}>
                      {elementLabel(b.element_code)}{b.package_id != null && ` (${packageLabel(b.package_id)})`}: {b.reason}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ ...mutedStyle, marginBottom: 8 }}>
                {plan.seam.will_seed_qs
                  ? `No QS record yet: one will be seeded with base date ${plan.seam.currentisation_date}, so package inflation runs from the benchmark's currentisation date.`
                  : plan.seam.qs_base_date == null
                    ? `The QS base date is blank and will be set to the currentisation date ${plan.seam.currentisation_date}.`
                    : `The QS base date ${plan.seam.qs_base_date} matches the currentisation date ${plan.seam.currentisation_date}; package inflation runs from one date.`}
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" style={buttonStyle} onClick={confirmApply}
              disabled={plan.refusal != null || (plan.creates.length === 0 && plan.replaces.length === 0)}>
              Confirm apply
            </button>
            <button type="button" style={buttonStyle} onClick={() => { setPlan(null); setMode('idle'); }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
