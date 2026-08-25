import { useCallback } from 'react';
import type { Project } from '../../types';
import type {
  AppraisalRun, CalculatorInputsV12, CalculatorInputsV13, ValidationIssue,
} from '../../lib/model';
import type {
  DdCategory, DdItem, DdRow, DdSourceConflict, DdStatus, DueDiligenceInputs, SourceRecord,
} from '../../lib/model';
import { DD_CATALOGUE, DD_CATEGORIES, DD_STATUSES } from '../../lib/model';
import { captureSourceRecord } from '../../lib/conversion-defaults';
import { PenceInput } from './form-rows';
import RiskRegisterPage from './RiskRegisterPage';

/**
 * R15 Task 9, spec §23.8. Page 13: the due-diligence evidence schedule, the
 * captured listing record it is checked against, and — below both, as the
 * project log — the free-form risk register that used to own this page.
 *
 * NO ARITHMETIC. Every count, percentage and conflict statement on this page
 * is read verbatim from `run.metrics.due_diligence`; every rule message is
 * read verbatim from `run.validation`. The only expression resembling a sum
 * is the coverage label's `entered_total - entered_unknown_count`, and that
 * composes two ALREADY-PUBLISHED counts into a sentence rather than deriving
 * anything (see `coverageLine` below).
 *
 * Every write goes through `onChange({ due_diligence: … })`.
 */
interface Props {
  /**
   * R15 Task 13 removes the union. Until the cutover the calculator's state is
   * still a `CalculatorInputsV12`, which carries no `due_diligence` block at
   * all — so the schedule editor sits behind the `'due_diligence' in inputs`
   * guard below and only the register renders. Task 13 narrows this to
   * `CalculatorInputsV13` and deletes the guard.
   */
  inputs: CalculatorInputsV12 | CalculatorInputsV13;
  onChange: (partial: Partial<CalculatorInputsV13>) => void;
  run: AppraisalRun;
  project: Project | null;
  /** Injected so the re-capture timestamp is reproducible in tests. */
  now?: () => Date;
}

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const FAINT = '#64748b';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED_TEXT = '#fca5a5';

const STATUS_COLORS: Record<DdStatus, string> = {
  red: '#ef4444',
  amber: '#f59e0b',
  green: '#22c55e',
  unknown: MUTED,
  not_applicable: FAINT,
};

const STATUS_LABELS: Record<DdStatus, string> = {
  red: 'red', amber: 'amber', green: 'green', unknown: 'unknown', not_applicable: 'n/a',
};

const CATEGORY_LABELS: Record<DdCategory, string> = {
  planning: 'Planning',
  title_occupation: 'Title and occupation',
  existing_building: 'Existing building',
  construction: 'Construction',
  finance: 'Finance',
  exit: 'Exit',
};

/** §23.2's editor help text, by code. UI only — never part of the document. */
const PROMPTS: Map<string, string> = new Map(DD_CATALOGUE.map((e) => [e.code, e.prompt]));

const textInput: React.CSSProperties = {
  padding: '5px 8px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13, width: '100%',
};
const fieldLabel: React.CSSProperties = { color: MUTED, fontSize: 12, display: 'block', marginBottom: 3 };
const cardStyle: React.CSSProperties = {
  padding: 14, marginBottom: 12, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`,
};

function emptyCustomItem(category: DdCategory): DdItem {
  return {
    id: crypto.randomUUID(),
    code: 'custom',
    category,
    label: '',
    status: 'unknown',
    evidence: null,
    expiry_date: null,
    owner: '',
    due_date: null,
    cost_impact_pence: null,
    programme_impact_months: null,
    action: '',
    notes: '',
  };
}

function occupationLine(isVacant: boolean | null): string {
  if (isVacant === null) return 'Listing: occupation not recorded';
  return isVacant ? 'Listing: vacant' : 'Listing: occupied';
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {issues.map((issue, i) => (
        <div key={`${issue.field}-${i}`} style={{ color: RED_TEXT, fontSize: 12 }}>{issue.message}</div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 150, flex: '1 1 150px' }}>
      <label style={fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

/** A derived row (§23.2): the model owns its status, so nothing here is editable. */
function DerivedRow({ row }: { row: DdRow }) {
  return (
    <div data-testid={`dd-row-${row.id}`} style={{ ...cardStyle, borderStyle: 'dashed' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>{row.label}</span>
        <span style={{ color: STATUS_COLORS[row.status], fontSize: 13, fontWeight: 600 }}>
          {STATUS_LABELS[row.status]}
        </span>
        <span style={{ color: FAINT, fontSize: 12 }}>{`from ${row.source ?? ''}`}</span>
      </div>
      <div style={{ color: MUTED, fontSize: 12 }}>{PROMPTS.get(row.code) ?? ''}</div>
      {row.evidence != null && (
        <div style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
          {`${row.evidence.source} — ${row.evidence.reference}${row.evidence.date === '' ? '' : ` (${row.evidence.date})`}`}
        </div>
      )}
    </div>
  );
}

interface EnteredRowProps {
  row: DdRow;
  /** Disambiguates every control's accessible name; stable per row. */
  rowName: string;
  issues: ValidationIssue[];
  onUpdate: (id: string, partial: Partial<DdItem>) => void;
  onRemove: (id: string) => void;
}

function EnteredRow({ row, rowName, issues, onUpdate, onRemove }: EnteredRowProps) {
  const setEvidence = (field: 'source' | 'reference' | 'date', value: string) => {
    // §1.5: an absent evidence record is `null`; the first keystroke creates it.
    const base = row.evidence ?? { source: '', reference: '', date: '' };
    onUpdate(row.id, { evidence: { ...base, [field]: value } });
  };

  return (
    <div data-testid={`dd-row-${row.id}`} style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {row.kind === 'custom' ? (
          <input
            type="text"
            aria-label={`${rowName} label`}
            placeholder="Custom item label"
            value={row.label}
            onChange={(e) => onUpdate(row.id, { label: e.target.value })}
            style={{ ...textInput, width: 280 }}
          />
        ) : (
          <span style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>{row.label}</span>
        )}
        <select
          aria-label={`${rowName} status`}
          value={row.status}
          onChange={(e) => onUpdate(row.id, { status: e.target.value as DdStatus })}
          style={{
            padding: '5px 8px', background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 4,
            color: STATUS_COLORS[row.status], fontSize: 13, fontWeight: 600,
          }}
        >
          {DD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        {row.kind === 'custom' && (
          <button
            onClick={() => onRemove(row.id)}
            style={{ marginLeft: 'auto', background: '#7f1d1d', color: RED_TEXT, border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}
          >
            Remove
          </button>
        )}
      </div>

      {row.kind !== 'custom' && (
        <div style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>{PROMPTS.get(row.code) ?? ''}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <Field label="Evidence source">
          <input
            type="text" aria-label={`${rowName} evidence source`} style={textInput}
            value={row.evidence?.source ?? ''}
            onChange={(e) => setEvidence('source', e.target.value)}
          />
        </Field>
        <Field label="Evidence reference">
          <input
            type="text" aria-label={`${rowName} evidence reference`} style={textInput}
            value={row.evidence?.reference ?? ''}
            onChange={(e) => setEvidence('reference', e.target.value)}
          />
        </Field>
        <Field label="Evidence date">
          <input
            type="date" aria-label={`${rowName} evidence date`} style={textInput}
            value={row.evidence?.date ?? ''}
            onChange={(e) => setEvidence('date', e.target.value)}
          />
        </Field>
        <Field label="Expiry date">
          <input
            type="date" aria-label={`${rowName} expiry date`} style={textInput}
            value={row.expiry_date ?? ''}
            onChange={(e) => onUpdate(row.id, { expiry_date: e.target.value === '' ? null : e.target.value })}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
        <Field label="Owner">
          <input
            type="text" aria-label={`${rowName} owner`} style={textInput}
            value={row.owner}
            onChange={(e) => onUpdate(row.id, { owner: e.target.value })}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date" aria-label={`${rowName} due date`} style={textInput}
            value={row.due_date ?? ''}
            onChange={(e) => onUpdate(row.id, { due_date: e.target.value === '' ? null : e.target.value })}
          />
        </Field>
        <Field label="Cost impact (£)">
          <PenceInput
            penceValue={row.cost_impact_pence}
            onChangePence={(v) => onUpdate(row.id, { cost_impact_pence: v })}
            nullable
            ariaLabel={`${rowName} cost impact`}
            style={{ width: '100%' }}
          />
        </Field>
        <Field label="Programme impact (months)">
          <input
            type="number" min={0} step="1" placeholder="unset" style={textInput}
            aria-label={`${rowName} programme impact months`}
            value={row.programme_impact_months ?? ''}
            onChange={(e) => onUpdate(row.id, {
              programme_impact_months: e.target.value === '' ? null : Number(e.target.value),
            })}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <Field label="Action">
          <input
            type="text" aria-label={`${rowName} action`} style={textInput}
            value={row.action}
            onChange={(e) => onUpdate(row.id, { action: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <input
            type="text" aria-label={`${rowName} notes`} style={textInput}
            value={row.notes}
            onChange={(e) => onUpdate(row.id, { notes: e.target.value })}
          />
        </Field>
        <button
          onClick={() => onUpdate(row.id, { evidence: null })}
          disabled={row.evidence == null}
          style={{ background: BORDER, color: TEXT, border: 'none', borderRadius: 4, padding: '6px 12px', cursor: row.evidence == null ? 'default' : 'pointer', fontSize: 12, opacity: row.evidence == null ? 0.5 : 1 }}
        >
          {`Clear evidence on ${rowName}`}
        </button>
      </div>

      <IssueList issues={issues} />
    </div>
  );
}

/** §23.5's captured listing record and the conflicts the engine found against it. */
function SourceRecordCard({ record, conflicts, issues, canCapture, onCapture }: {
  record: SourceRecord | null;
  conflicts: readonly DdSourceConflict[];
  issues: ValidationIssue[];
  canCapture: boolean;
  onCapture: () => void;
}) {
  return (
    <div data-testid="dd-source-record" style={{ ...cardStyle, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>Captured listing record</span>
        <button
          onClick={onCapture}
          disabled={!canCapture}
          style={{ background: BORDER, color: TEXT, border: 'none', borderRadius: 4, padding: '5px 12px', cursor: canCapture ? 'pointer' : 'default', fontSize: 12, opacity: canCapture ? 1 : 0.5 }}
        >
          Re-capture from listing
        </button>
      </div>
      {record == null ? (
        <div style={{ color: MUTED, fontSize: 13 }}>
          No listing record captured — nothing to check the schedule against.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: MUTED, fontSize: 13 }}>
          <span>{`Captured ${record.captured_at}`}</span>
          <span>{record.source_name == null ? 'source not recorded' : record.source_name}</span>
          <span>{occupationLine(record.is_vacant)}</span>
          <span>{record.floor_area_sqm == null ? 'floor area not recorded' : `${record.floor_area_sqm} m²`}</span>
          <span>{`Tenure: ${record.tenure ?? 'not recorded'}`}</span>
          <span>{`Use class: ${record.use_class ?? 'not recorded'}`}</span>
          <span>{`EPC: ${record.epc_rating ?? 'not recorded'}`}</span>
        </div>
      )}
      {conflicts.map((c) => (
        <div key={c.rule} style={{ color: RED_TEXT, fontSize: 12, marginTop: 8 }}>{c.statement}</div>
      ))}
      <IssueList issues={issues} />
    </div>
  );
}

/** The listing prose, read-only: it is evidence about the property, not an
 *  input on this page. Sits under Title and occupation, where a reader
 *  weighing vacant possession is already looking. */
function ListingProse({ project }: { project: Project }) {
  return (
    <div style={{ ...cardStyle, borderStyle: 'dashed' }}>
      <div style={{ color: TEXT, fontWeight: 600, fontSize: 13, marginBottom: 6 }}>From the listing</div>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 2 }}>Current use</div>
      <div style={{ color: TEXT, fontSize: 13, marginBottom: 8 }}>
        {project.current_use_description ?? 'not recorded'}
      </div>
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 2 }}>Description</div>
      <div style={{ color: TEXT, fontSize: 13 }}>{project.description ?? 'not recorded'}</div>
    </div>
  );
}

export default function DueDiligencePage({ inputs, onChange, run, project, now }: Props) {
  // Task 13 removes this guard along with the V12 arm of `Props['inputs']`.
  const dd: DueDiligenceInputs | null = 'due_diligence' in inputs ? inputs.due_diligence : null;
  const result = run.metrics.due_diligence;
  const totals = result.totals;

  const writeItems = useCallback((items: DdItem[]) => {
    if (dd == null) return;
    onChange({ due_diligence: { ...dd, items } });
  }, [dd, onChange]);

  const updateItem = useCallback((id: string, partial: Partial<DdItem>) => {
    if (dd == null) return;
    writeItems(dd.items.map((item) => (item.id === id ? { ...item, ...partial } : item)));
  }, [dd, writeItems]);

  const removeItem = useCallback((id: string) => {
    if (dd == null) return;
    writeItems(dd.items.filter((item) => item.id !== id));
  }, [dd, writeItems]);

  const addCustom = useCallback((category: DdCategory) => {
    if (dd == null) return;
    writeItems([...dd.items, emptyCustomItem(category)]);
  }, [dd, writeItems]);

  const recapture = useCallback(() => {
    if (dd == null || project == null) return;
    const at = (now == null ? new Date() : now()).toISOString();
    onChange({ due_diligence: { ...dd, source_record: captureSourceRecord(project, at) } });
  }, [dd, project, onChange, now]);

  // Validation rules are keyed by the item's INDEX in the document, so the
  // lookup goes row id -> index -> field prefix. `=== prefix` catches nothing
  // today but keeps the filter honest if a rule is ever raised on the item
  // itself; the `.` on the startsWith is what stops `items[1]` swallowing
  // `items[10]`.
  const indexById = new Map((dd?.items ?? []).map((item, i) => [item.id, i]));
  const issuesForRow = (rowId: string): ValidationIssue[] => {
    const index = indexById.get(rowId);
    if (index === undefined) return [];
    const prefix = `due_diligence.items[${index}]`;
    return run.validation.filter((v) => v.field === prefix || v.field.startsWith(`${prefix}.`));
  };
  // Rule 1a's "catalogue item is missing" belongs with the coverage figure it
  // makes wrong; rule 7's belong with the record they are about.
  const coverageIssues = run.validation.filter((v) => v.field === 'due_diligence');
  const recordIssues = run.validation.filter(
    (v) => v.field.startsWith('due_diligence.source_record'),
  );

  // Every figure on this line is a published field of
  // `run.metrics.due_diligence.totals`, read verbatim. `entered_addressed_count`
  // exists so this is a read and not a `entered_total - entered_unknown_count`
  // subtraction here (Task 9 fix round 1) -- a count computed in a component is
  // a second implementation of the engine's own count (spec §11.9).
  const coverageLine = `${totals.entered_addressed_count} of ${totals.entered_total} addressed `
    + `(${totals.addressed_pct == null ? 'n/a' : `${totals.addressed_pct}%`})`;

  /**
   * The prefix on every control's accessible name. A catalogue row uses its
   * catalogue label, which is unique by construction. A custom row uses an
   * ORDINAL rather than its own label: the label starts blank (that is rule
   * 1c's error), a user may type the same words twice, and a name that changed
   * on every keystroke would move under a screen reader mid-edit. The visible
   * label input sits in the same card, so the row is still identifiable.
   */
  const customOrdinal = new Map<string, number>();
  let nextCustom = 0;
  for (const row of result.rows) {
    if (row.kind === 'custom') {
      nextCustom += 1;
      customOrdinal.set(row.id, nextCustom);
    }
  }
  const nameFor = (row: DdRow): string =>
    (row.kind === 'custom' ? `Custom item ${customOrdinal.get(row.id) ?? 0}` : row.label);

  return (
    <div>
      <h3 style={{ color: TEXT, fontSize: 18, marginBottom: 20 }}>13. Due Diligence</h3>

      {dd != null && (
        <>
          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <div style={{ color: TEXT, fontSize: 15, fontWeight: 600 }}>{coverageLine}</div>
            <div style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>
              Addressed means evidenced, or marked not applicable with a reason. An unknown item is
              never treated as green.
            </div>
            <IssueList issues={coverageIssues} />
          </div>

          <SourceRecordCard
            record={result.source_record}
            conflicts={result.source_conflicts}
            issues={recordIssues}
            canCapture={project != null}
            onCapture={recapture}
          />

          {DD_CATEGORIES.map((category) => {
            const summary = result.categories.find((c) => c.category === category)!;
            const counts = `red ${summary.red} · amber ${summary.amber} · green ${summary.green} `
              + `· unknown ${summary.unknown} · n/a ${summary.not_applicable}`;
            return (
              <section
                key={category}
                data-testid={`dd-category-${category}`}
                style={{ marginBottom: 24 }}
              >
                <h4 style={{ color: TEXT, fontSize: 15, marginBottom: 4 }}>{CATEGORY_LABELS[category]}</h4>
                <div style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>{counts}</div>

                {category === 'title_occupation' && project != null && <ListingProse project={project} />}

                {result.rows.filter((r) => r.category === category).map((row) => (
                  row.kind === 'derived'
                    ? <DerivedRow key={row.id} row={row} />
                    : (
                      <EnteredRow
                        key={row.id}
                        row={row}
                        rowName={nameFor(row)}
                        issues={issuesForRow(row.id)}
                        onUpdate={updateItem}
                        onRemove={removeItem}
                      />
                    )
                ))}

                <button
                  aria-label={`Add custom item to ${CATEGORY_LABELS[category]}`}
                  onClick={() => addCustom(category)}
                  style={{ padding: '6px 16px', background: BORDER, color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                >
                  + Add custom item
                </button>
              </section>
            );
          })}
        </>
      )}

      <section data-testid="dd-project-log">
        <RiskRegisterPage inputs={inputs} onChange={onChange} />
      </section>
    </div>
  );
}
