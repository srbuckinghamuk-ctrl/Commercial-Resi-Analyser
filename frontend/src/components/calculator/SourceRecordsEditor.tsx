import type { Project } from '../../types';
import type { AppraisalRun, CalculatorInputsV17 } from '../../lib/model';
import type {
  DdSourceFieldConflict, SourceClaimField, SourceClaims, SourceConflictResolution,
  SourceEvidenceRecord, SourceRecordKind,
} from '../../lib/model/due-diligence';
import { SOURCE_RECORD_KINDS, emptyClaims } from '../../lib/model/due-diligence';

/**
 * R17 spec §4.3 / §11. The source-evidence editor: one row per
 * `due_diligence.source_records` entry (which document said what), the
 * per-field conflicts the ENGINE derived from them
 * (`run.metrics.due_diligence.source_field_conflicts`), and a resolution
 * form per unresolved field. The engine never picks a winner: a conflict is
 * resolved only when a person names the value, the evidence and themselves.
 *
 * Nothing here is computed. Every write goes through
 * `onChange({ due_diligence: { ...inputs.due_diligence, … } })`; every
 * conflict fact is read verbatim from the run.
 */
interface Props {
  inputs: CalculatorInputsV17;
  onChange: (partial: Partial<CalculatorInputsV17>) => void;
  run: AppraisalRun;
  project: Project | null;
}

// Mirrors DueDiligencePage's palette (module-private there; importing it
// would make the page and this editor import each other).
const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const FAINT = '#64748b';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED_TEXT = '#fca5a5';
const GREEN_TEXT = '#86efac';

const textInput: React.CSSProperties = {
  padding: '5px 8px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13, width: '100%',
};
const fieldLabel: React.CSSProperties = { color: MUTED, fontSize: 12, display: 'block', marginBottom: 3 };
const cardStyle: React.CSSProperties = {
  padding: 14, marginBottom: 12, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`,
};
const buttonStyle: React.CSSProperties = {
  padding: '5px 10px', background: 'transparent', border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 12, cursor: 'pointer',
};

const KIND_LABELS: Record<SourceRecordKind, string> = {
  listing_narrative: 'Listing (narrative)',
  listing_structured: 'Listing (structured)',
  measured_survey: 'Measured survey',
  valuation: 'Valuation',
  title: 'Title',
  planning: 'Planning',
  appraisal_inputs: 'Appraisal inputs',
  other: 'Other',
};

const FIELD_LABELS: Record<SourceClaimField, string> = {
  existing_use: 'Existing use',
  proposed_use: 'Proposed use',
  floor_area_sqm: 'Floor area (sqm)',
  tenure: 'Tenure',
  upper_parts_included: 'Upper parts included',
  vacant_possession: 'Vacant possession',
};

const TENURES = ['freehold', 'leasehold', 'unknown'] as const;

function printClaim(value: string | number | boolean | null): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 150, flex: '1 1 150px' }}>
      <label style={fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

function TriStateSelect({ value, onChange, ariaLabel }: {
  value: boolean | null; onChange: (v: boolean | null) => void; ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel} style={textInput}
      value={value == null ? '' : value ? 'yes' : 'no'}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
    >
      <option value="">not stated</option>
      <option value="yes">yes</option>
      <option value="no">no</option>
    </select>
  );
}

function RecordRow({ record, onUpdate, onRemove }: {
  record: SourceEvidenceRecord;
  onUpdate: (next: SourceEvidenceRecord) => void;
  onRemove: () => void;
}) {
  const setClaim = <K extends SourceClaimField>(field: K, value: SourceClaims[K]) =>
    onUpdate({ ...record, claims: { ...record.claims, [field]: value } });
  const name = `${KIND_LABELS[record.kind]} record`;
  return (
    <div data-testid="source-record-row" role="group" aria-label={name} style={{ ...cardStyle, marginBottom: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Field label="Source">
          <select
            aria-label="Source kind" style={textInput} value={record.kind}
            onChange={(e) => onUpdate({ ...record, kind: e.target.value as SourceRecordKind })}
          >
            {SOURCE_RECORD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Captured at">
          <input
            aria-label="Captured at" type="date" style={textInput} value={record.captured_at}
            onChange={(e) => onUpdate({ ...record, captured_at: e.target.value })}
          />
        </Field>
        <Field label="Reference">
          <input
            aria-label="Reference" style={textInput} value={record.reference}
            onChange={(e) => onUpdate({ ...record, reference: e.target.value })}
          />
        </Field>
        <Field label="Captured by">
          <input
            aria-label="Captured by" style={textInput} value={record.captured_by}
            onChange={(e) => onUpdate({ ...record, captured_by: e.target.value })}
          />
        </Field>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        <Field label={FIELD_LABELS.existing_use}>
          <input
            aria-label="Existing use" style={textInput} value={record.claims.existing_use ?? ''}
            onChange={(e) => setClaim('existing_use', e.target.value === '' ? null : e.target.value)}
          />
        </Field>
        <Field label={FIELD_LABELS.proposed_use}>
          <input
            aria-label="Proposed use" style={textInput} value={record.claims.proposed_use ?? ''}
            onChange={(e) => setClaim('proposed_use', e.target.value === '' ? null : e.target.value)}
          />
        </Field>
        <Field label={FIELD_LABELS.floor_area_sqm}>
          <input
            aria-label="Floor area (sqm)" type="number" style={textInput}
            value={record.claims.floor_area_sqm ?? ''}
            onChange={(e) => setClaim('floor_area_sqm', e.target.value === '' ? null : Number(e.target.value))}
          />
        </Field>
        <Field label={FIELD_LABELS.tenure}>
          <select
            aria-label="Tenure" style={textInput} value={record.claims.tenure ?? ''}
            onChange={(e) => setClaim('tenure', e.target.value === '' ? null : e.target.value as SourceClaims['tenure'])}
          >
            <option value="">not stated</option>
            {TENURES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label={FIELD_LABELS.upper_parts_included}>
          <TriStateSelect
            ariaLabel="Upper parts included" value={record.claims.upper_parts_included}
            onChange={(v) => setClaim('upper_parts_included', v)}
          />
        </Field>
        <Field label={FIELD_LABELS.vacant_possession}>
          <TriStateSelect
            ariaLabel="Vacant possession" value={record.claims.vacant_possession}
            onChange={(v) => setClaim('vacant_possession', v)}
          />
        </Field>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={fieldLabel}>Narrative excerpt (stored verbatim, never parsed)</label>
        <textarea
          aria-label="Narrative excerpt" style={{ ...textInput, minHeight: 48 }} rows={2}
          value={record.narrative_excerpt ?? ''}
          onChange={(e) => onUpdate({ ...record, narrative_excerpt: e.target.value === '' ? null : e.target.value })}
        />
      </div>
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <button type="button" style={{ ...buttonStyle, color: RED_TEXT }} onClick={onRemove}>Remove record</button>
      </div>
    </div>
  );
}

function ConflictCard({ conflict, records, onResolve }: {
  conflict: DdSourceFieldConflict;
  records: readonly SourceEvidenceRecord[];
  onResolve: (resolution: SourceConflictResolution) => void;
}) {
  const label = FIELD_LABELS[conflict.field];
  return (
    <div data-testid="source-field-conflict" role="group" aria-label={`${label} conflict`}
      style={{ ...cardStyle, marginBottom: 8, borderColor: conflict.resolved ? BORDER : RED_TEXT }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ color: TEXT, fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ color: conflict.resolved ? GREEN_TEXT : RED_TEXT, fontSize: 12 }}>
          {conflict.resolved ? 'resolved' : 'unresolved'}
        </div>
      </div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: MUTED, fontSize: 12 }}>
        {conflict.values.map((v) => (
          <li key={v.record_id}>{KIND_LABELS[v.kind]}: <span style={{ color: TEXT }}>{printClaim(v.value)}</span></li>
        ))}
      </ul>
      {!conflict.resolved && <ResolutionForm conflict={conflict} records={records} onResolve={onResolve} />}
    </div>
  );
}

function ResolutionForm({ conflict, records, onResolve }: {
  conflict: DdSourceFieldConflict;
  records: readonly SourceEvidenceRecord[];
  onResolve: (resolution: SourceConflictResolution) => void;
}) {
  const label = FIELD_LABELS[conflict.field];
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const text = (k: string) => String(form.get(k) ?? '');
    const chosen = text('chosen_record_id');
    onResolve({
      id: crypto.randomUUID(),
      field: conflict.field,
      resolved_value: text('resolved_value') === '' ? null : text('resolved_value'),
      chosen_record_id: chosen === '' ? null : chosen,
      evidence_reference: text('evidence_reference'),
      resolved_by: text('resolved_by'),
      resolved_at: text('resolved_at'),
      reason: text('reason'),
    });
    e.currentTarget.reset();
  };
  const candidates = records.filter((r) => conflict.values.some((v) => v.record_id === r.id));
  return (
    <form aria-label={`Resolve ${label}`} onSubmit={submit} style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <Field label="Resolved value">
          <input name="resolved_value" aria-label="Resolved value" style={textInput} />
        </Field>
        <Field label="Chosen record">
          <select name="chosen_record_id" aria-label="Chosen record" style={textInput} defaultValue="">
            <option value="">none</option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>{KIND_LABELS[r.kind]}{r.reference ? ` — ${r.reference}` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Evidence reference">
          <input name="evidence_reference" aria-label="Evidence reference" style={textInput} />
        </Field>
        <Field label="Resolved by">
          <input name="resolved_by" aria-label="Resolved by" style={textInput} />
        </Field>
        <Field label="Resolved at">
          <input name="resolved_at" aria-label="Resolved at" type="date" style={textInput} />
        </Field>
        <Field label="Reason">
          <input name="reason" aria-label="Reason" style={textInput} />
        </Field>
      </div>
      <div style={{ marginTop: 8, color: FAINT, fontSize: 11 }}>
        A resolution counts only with an evidence reference and a name; the engine never picks a winner.
      </div>
      <div style={{ marginTop: 6 }}>
        <button type="submit" style={buttonStyle}>Record resolution</button>
      </div>
    </form>
  );
}

export default function SourceRecordsEditor({ inputs, onChange, run, project }: Props) {
  const dd = inputs.due_diligence;
  const records = dd.source_records;
  const resolutions = dd.source_resolutions;
  const result = run.metrics.due_diligence;
  const conflicts = result.source_field_conflicts;

  const writeRecords = (source_records: SourceEvidenceRecord[]) =>
    onChange({ due_diligence: { ...dd, source_records } });
  const writeResolutions = (source_resolutions: SourceConflictResolution[]) =>
    onChange({ due_diligence: { ...dd, source_resolutions } });

  const addRecord = () => writeRecords([...records, {
    id: crypto.randomUUID(), kind: 'listing_narrative', captured_at: '', reference: '',
    captured_by: '', narrative_excerpt: null, claims: emptyClaims(),
  }]);

  // The appraisal's own position, entered as a record like any other source:
  // the existing GIA is read from the run, the use from the project.
  const captureFromInputs = () => writeRecords([...records, {
    id: crypto.randomUUID(), kind: 'appraisal_inputs', captured_at: '', reference: 'appraisal inputs',
    captured_by: '', narrative_excerpt: null,
    claims: {
      ...emptyClaims(),
      floor_area_sqm: run.metrics.area_bridge.existing_gia_sqm,
      existing_use: project?.use_class ?? null,
    },
  }]);

  return (
    <section data-testid="source-records-editor" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ color: TEXT, fontSize: 14, margin: 0 }}>Source records</h3>
        <div style={{ color: result.unresolved_source_conflicts > 0 ? RED_TEXT : MUTED, fontSize: 12 }}>
          {conflicts.length} conflicting field{conflicts.length === 1 ? '' : 's'} · {result.unresolved_source_conflicts} unresolved
        </div>
      </div>
      <div style={{ color: FAINT, fontSize: 12, marginBottom: 8 }}>
        One record per document that made a claim; a blank claim means the source says nothing about it.
        Conflicts between records are derived by the model and listed below.
      </div>

      {records.length === 0 && <div style={{ color: FAINT, fontSize: 12, marginBottom: 8 }}>No source records.</div>}
      {records.map((r) => (
        <RecordRow
          key={r.id} record={r}
          onUpdate={(next) => writeRecords(records.map((x) => (x.id === r.id ? next : x)))}
          onRemove={() => writeRecords(records.filter((x) => x.id !== r.id))}
        />
      ))}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" style={buttonStyle} onClick={addRecord}>Add source record</button>
        <button type="button" style={buttonStyle} onClick={captureFromInputs}>Capture from appraisal inputs</button>
      </div>

      <h4 style={{ color: TEXT, fontSize: 13, margin: '0 0 6px' }}>Field conflicts</h4>
      {conflicts.length === 0 && <div style={{ color: FAINT, fontSize: 12, marginBottom: 8 }}>No conflicting fields.</div>}
      {conflicts.map((c) => (
        <ConflictCard
          key={c.field} conflict={c} records={records}
          onResolve={(res) => writeResolutions([...resolutions, res])}
        />
      ))}

      <h4 style={{ color: TEXT, fontSize: 13, margin: '8px 0 6px' }}>Resolutions</h4>
      {resolutions.length === 0 && <div style={{ color: FAINT, fontSize: 12 }}>No resolutions recorded.</div>}
      {resolutions.map((res) => (
        <div key={res.id} data-testid="source-resolution" style={{ ...cardStyle, marginBottom: 8, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ color: MUTED, fontSize: 12 }}>
            <span style={{ color: TEXT }}>{FIELD_LABELS[res.field]}</span> → {printClaim(res.resolved_value)}
            {' · '}evidence: {res.evidence_reference || <span style={{ color: RED_TEXT }}>none</span>}
            {' · '}by: {res.resolved_by || <span style={{ color: RED_TEXT }}>none</span>}
            {res.resolved_at ? ` · ${res.resolved_at}` : ''}
            {res.reason ? ` · ${res.reason}` : ''}
          </div>
          <button
            type="button" style={{ ...buttonStyle, color: RED_TEXT, flexShrink: 0 }}
            onClick={() => writeResolutions(resolutions.filter((x) => x.id !== res.id))}
          >
            Remove resolution
          </button>
        </div>
      ))}
    </section>
  );
}
