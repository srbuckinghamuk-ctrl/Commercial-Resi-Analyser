/**
 * Calculator page 16 — the lender case (R14b, spec §21; R17, design §10.6).
 *
 * Owns its own data: pages mount on tab entry (ConversionCalculator renders
 * the active page only), so the mount-time fetch is normally already current,
 * including after a save flips staleness. But the effect is keyed on
 * `project.id`, not on mount, so the component can stay mounted while the
 * project switches under it (the user sits on this tab and changes project);
 * `reloadSeq` guards that case — and the ordinary case of a transition or
 * create firing a newer reload before an older one has resolved — by
 * discarding any fetch whose sequence number is no longer the latest one
 * issued, so a stale response can never overwrite fresher state.
 *
 * R17: the actor is the signed-in user (AuthProvider), never a typed name.
 * Every lender-case route is authenticated, so a signed-out visitor sees a
 * link to /login and nothing is fetched. Transition buttons are derived from
 * ALLOWED_TRANSITIONS filtered by ROLE_TRANSITIONS (`canTransition`) — the
 * same tables the server enforces; maker-checker and legacy-case rules are
 * the server's alone and its refusal is printed verbatim. Each confirmation
 * sends the last GET's `version` and `case_hash` and an idempotency key
 * minted when the transition was chosen: a retry of the same confirmation
 * reuses it (the server replays as a no-op 200), a new choice mints a new one.
 *
 * NO ARITHMETIC — this page reads and mutates governance state only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FinancialAppraisal, LenderCase, LenderCaseEvent, LenderCaseStatus, Project } from '../../types';
import type { CalculatorInputsV17 } from '../../lib/model';
import {
  createLenderCase, getLenderCase, listLenderCaseEvents, listLenderCaseHistory,
  transitionLenderCase, ApiError, formatApiErrorDetail,
} from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ALLOWED_TRANSITIONS, CREATE_ROLES, canTransition, structurallyEqual } from '../../lib/report-provenance';
import { calculatorPath } from './pages';

interface Props {
  project: Project;
  appraisalRecord: FinancialAppraisal | null;
  inputs: CalculatorInputsV17;
}

const SIGN_IN_PROMPT = 'Sign in to open or move a lender case';

const TEXT = '#e2e8f0';
const MUTED = '#94a3b8';
const BORDER = '#1e3a5f';
const PANEL = '#0f172a';
const RED_BG = '#450a0a';
const RED = '#ef4444';
const RED_TEXT = '#fca5a5';
const AMBER_BG = '#451a03';
const AMBER = '#f59e0b';
const AMBER_TEXT = '#fbbf24';

const textInputStyle: React.CSSProperties = {
  padding: '6px 10px', background: PANEL, border: `1px solid ${BORDER}`,
  borderRadius: 4, color: TEXT, fontSize: 13, width: 260,
};
const rowLabel: React.CSSProperties = { color: MUTED, width: 140, fontSize: 13 };
const panelStyle: React.CSSProperties = { padding: 16, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}`, marginBottom: 20 };

function humanise(status: string): string {
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** A fresh idempotency key. `crypto.randomUUID` everywhere this app runs;
 *  the fallback only covers a test environment without it. Never contains
 *  `|` or a control character (the server's field-boundary rule). */
function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
      <span style={{ color: MUTED, fontSize: 12, width: 160, flexShrink: 0 }}>{label}</span>
      <span style={{ color: TEXT, fontSize: 12, wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

/** "Note" / "Reason" / "Conditions" text field on the confirmation form. */
function Field({ label, value, onChange, textarea }: {
  label: string; value: string; onChange: (v: string) => void; textarea?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: textarea ? 'flex-start' : 'center', gap: 12, marginBottom: 10 }}>
      <label style={rowLabel}>{label}</label>
      {textarea ? (
        <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ ...textInputStyle, height: 70 }} />
      ) : (
        <input type="text" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={textInputStyle} />
      )}
    </div>
  );
}

interface Pending {
  to: LenderCaseStatus;
  /** Minted when `to` was chosen; reused on a retry of this confirmation. */
  key: string;
}

export default function LenderCasePage({ project, appraisalRecord, inputs }: Props) {
  const { user, loading: authLoading } = useAuth();
  const [caseRecord, setCaseRecord] = useState<LenderCase | null>(null);
  const [events, setEvents] = useState<LenderCaseEvent[]>([]);
  const [history, setHistory] = useState<LenderCase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [conditions, setConditions] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  // Monotonic reload token (fix round 1) -- see the header docstring.
  const reloadSeq = useRef(0);

  const signedIn = user != null;

  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? formatApiErrorDetail(e.detail).join('; ') || e.message : String(e));

  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current;
    try {
      const [c, ev, h] = await Promise.all([
        getLenderCase(project.id), listLenderCaseEvents(project.id), listLenderCaseHistory(project.id),
      ]);
      if (seq !== reloadSeq.current) return; // a newer reload has already started -- discard this one
      setCaseRecord(c);
      setEvents(ev);
      setHistory(h);
      setError(null);
    } catch (e) {
      if (seq !== reloadSeq.current) return;
      fail(e);
    } finally {
      if (seq === reloadSeq.current) setLoaded(true);
    }
  }, [project.id]);

  // Every lender-case route needs a bearer token: nothing is fetched until
  // there is one, and a sign-in (user flipping null -> set) triggers the load.
  useEffect(() => {
    if (!signedIn) return;
    void reload();
  }, [project.id, reload, signedIn]);

  const choose = (to: LenderCaseStatus) => {
    // A new choice mints a new key; re-choosing the same pending transition
    // keeps the key so a retry replays rather than double-applies.
    setPending((prev) => (prev != null && prev.to === to ? prev : { to, key: newIdempotencyKey() }));
    setError(null);
  };

  const handleCreate = useCallback(async () => {
    try {
      await createLenderCase(project.id);
      await reload();
    } catch (e) {
      fail(e);
    }
  }, [project.id, reload]);

  const handleConfirmTransition = useCallback(async () => {
    if (pending == null || caseRecord == null) return;
    try {
      await transitionLenderCase(project.id, {
        to_status: pending.to,
        note: note || undefined,
        reason: reason || undefined,
        conditions: pending.to === 'approved_with_conditions' ? conditions : undefined,
        // The server always sends `version`; the type is optional only for
        // pre-R17 fixtures, and a pre-R17 row is at version 1 server-side.
        expected_version: caseRecord.version ?? 1,
        expected_case_hash: caseRecord.case_hash,
        idempotency_key: pending.key,
      });
      setNote(''); setReason(''); setConditions(''); setPending(null);
      await reload();
    } catch (e) {
      // The pending choice (and its key) survives so a retry of THIS
      // confirmation carries the same idempotency key.
      fail(e);
    }
  }, [project.id, pending, caseRecord, note, reason, conditions, reload]);

  if (authLoading) return <div style={{ color: MUTED, fontSize: 13 }}>Checking sign-in…</div>;

  if (!signedIn) {
    return (
      <div style={{ ...panelStyle, border: `1px dashed ${BORDER}` }}>
        <div style={{ color: TEXT, fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Lender case</div>
        <div style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
          {SIGN_IN_PROMPT}. Cases are read and moved by authenticated users only; the role of the
          signed-in user decides which actions are offered.
        </div>
        <Link
          to="/login"
          state={{ from: calculatorPath(project.id, 'lender_case') }}
          style={{ display: 'inline-block', padding: '8px 18px', background: '#1e3a5f', color: '#93c5fd', borderRadius: 6, fontSize: 13, textDecoration: 'none' }}
        >
          Sign in
        </Link>
      </div>
    );
  }

  const signedInLine = (
    <div style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>
      Signed in as <span style={{ color: TEXT }}>{user.display_name}</span> · role <span style={{ color: TEXT }}>{user.role}</span>
    </div>
  );

  if (!loaded) return <div style={{ color: MUTED, fontSize: 13 }}>Loading lender case…</div>;

  if (caseRecord == null) {
    const noRecord = appraisalRecord == null;
    const preProvenance = !noRecord && appraisalRecord.audit_hash == null;
    const mayCreate = (CREATE_ROLES as readonly string[]).includes(user.role);
    const disabled = noRecord || preProvenance || !mayCreate;
    const hint = noRecord
      ? 'Save the appraisal first.'
      : preProvenance
        ? 'This record predates provenance hashing — re-save the appraisal first.'
        : !mayCreate
          ? `Your role (${user.role}) may not open a lender case — that is for ${CREATE_ROLES.join(', ')}.`
          : null;

    return (
      <div style={{ ...panelStyle, border: `1px dashed ${BORDER}` }}>
        <div style={{ color: TEXT, fontWeight: 600, fontSize: 14, marginBottom: 6 }}>No lender case</div>
        {signedInLine}
        <div style={{ color: MUTED, fontSize: 13, marginBottom: 12 }}>
          Creating a case locks the saved appraisal — inputs, hashes and calculation version — as
          the document a lender reviews; later edits mark the case stale rather than silently
          updating it.
        </div>
        {mayCreate && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleCreate()}
            style={{
              padding: '8px 18px', background: disabled ? '#334155' : '#1e3a5f', color: TEXT,
              border: 'none', borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13,
            }}
          >
            Create lender case
          </button>
        )}
        {hint != null && <div style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>{hint}</div>}
        {error != null && <div role="alert" style={{ color: RED_TEXT, fontSize: 12, marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  const superseded = history.filter((h) => h.status === 'superseded');
  const inputsMatchSnapshot = structurallyEqual(inputs as unknown, caseRecord.locked_inputs_snapshot);
  const legal = ALLOWED_TRANSITIONS[caseRecord.status];
  const transitions = legal.filter((to) => canTransition(user.role, to));
  const withheld = legal.filter((to) => !canTransition(user.role, to));
  const optionalDetails: [string, string | null][] = [
    ['Submitted by', caseRecord.submitted_by], ['Reviewer', caseRecord.reviewer],
    ['Decided by', caseRecord.decided_by], ['Conditions', caseRecord.conditions],
    ['Submitted at', caseRecord.submitted_at], ['Decided at', caseRecord.decided_at],
  ];

  return (
    <div>
      <div style={panelStyle}>
        <span style={{ color: TEXT, fontWeight: 600, fontSize: 14 }}>Lender case — {humanise(caseRecord.status)}</span>
        <div style={{ marginTop: 8 }}>{signedInLine}</div>

        <div style={{ marginTop: 6 }}>
          <DetailRow label="Created by" value={caseRecord.created_by} />
          {optionalDetails.map(([label, value]) => value != null && <DetailRow key={label} label={label} value={value} />)}
          <DetailRow label="Locked audit hash" value={caseRecord.locked_audit_hash} />
          <DetailRow label="Case hash" value={caseRecord.case_hash} />
          <DetailRow label="Case version" value={String(caseRecord.version ?? 1)} />
          <DetailRow label="Locked calc version" value={caseRecord.locked_calc_version} />
          <DetailRow label="Locked inputs version" value={String(caseRecord.locked_inputs_version)} />
        </div>

        {caseRecord.stale ? (
          <div style={{ marginTop: 12, padding: '10px 14px', background: RED_BG, border: `1px solid ${RED}`, borderRadius: 6 }}>
            <div style={{ color: RED_TEXT, fontSize: 12 }}>
              The saved appraisal has changed since this case locked its snapshot. An approved case
              in this state no longer makes the document FINAL — supersede it and open a new case.
            </div>
          </div>
        ) : !inputsMatchSnapshot ? (
          <div style={{ marginTop: 12, padding: '10px 14px', background: AMBER_BG, border: `1px solid ${AMBER}`, borderRadius: 6 }}>
            <div style={{ color: AMBER_TEXT, fontSize: 12 }}>
              Unsaved edits differ from the locked snapshot — saving the appraisal will mark this
              case stale.
            </div>
          </div>
        ) : null}

        {legal.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {transitions.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {transitions.map((to) => (
                  <button
                    key={to}
                    type="button"
                    onClick={() => choose(to)}
                    style={{
                      padding: '6px 14px', background: pending?.to === to ? '#2563eb' : '#1e3a5f', color: TEXT,
                      border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    {humanise(to)}
                  </button>
                ))}
              </div>
            )}
            {withheld.length > 0 && (
              <div style={{ color: MUTED, fontSize: 12, marginBottom: 10 }}>
                Not offered to role {user.role}: {withheld.map(humanise).join(', ')}.
              </div>
            )}

            {pending != null && (
              <div style={{ padding: 12, background: '#132339', borderRadius: 6, border: `1px solid ${BORDER}` }}>
                <div style={{ color: TEXT, fontSize: 13, marginBottom: 10 }}>
                  Move to <strong>{humanise(pending.to)}</strong> as {user.display_name}
                </div>
                <Field label="Note" value={note} onChange={setNote} />
                <Field label="Reason" value={reason} onChange={setReason} />
                {pending.to === 'approved_with_conditions' && <Field label="Conditions" value={conditions} onChange={setConditions} textarea />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => void handleConfirmTransition()}
                    style={{ padding: '6px 14px', background: '#1e3a5f', color: TEXT, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPending(null); setNote(''); setReason(''); setConditions(''); setError(null); }}
                    style={{ padding: '6px 14px', background: 'none', color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error != null && <div role="alert" style={{ color: RED_TEXT, fontSize: 12, marginTop: 12 }}>{error}</div>}
      </div>

      <div style={panelStyle}>
        <div style={{ color: TEXT, fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Change log</div>
        {events.length === 0 ? (
          <div style={{ color: MUTED, fontSize: 12 }}>No events recorded.</div>
        ) : events.map((ev) => (
          <div key={ev.id} style={{ padding: '6px 0', borderBottom: `1px solid ${PANEL}`, fontSize: 12 }}>
            <span style={{ color: TEXT }}>
              {ev.from_status != null ? `${humanise(ev.from_status)} → ${humanise(ev.to_status)}` : humanise(ev.to_status)}
            </span>
            {' — '}
            <span style={{ color: MUTED }}>{ev.actor}</span>
            {ev.reason != null && ev.reason !== '' && <span style={{ color: MUTED }}> · reason: {ev.reason}</span>}
            {ev.note != null && ev.note !== '' && <span style={{ color: MUTED }}> · {ev.note}</span>}
            {ev.case_version_after != null && <span style={{ color: '#64748b' }}> · v{ev.case_version_after}</span>}
            <span style={{ color: '#64748b' }}> · {ev.occurred_at}</span>
          </div>
        ))}
      </div>

      {superseded.length > 0 && (
        <div style={{ padding: 16, background: PANEL, borderRadius: 8, border: `1px solid ${BORDER}` }}>
          <div style={{ color: TEXT, fontWeight: 600, fontSize: 14, marginBottom: 10 }}>History</div>
          {superseded.map((h) => (
            <div key={h.id} style={{ padding: '6px 0', borderBottom: `1px solid ${PANEL}`, fontSize: 12 }}>
              <span style={{ color: TEXT }}>{humanise(h.status)}</span>
              {' — '}
              <span style={{ color: MUTED }}>{h.decided_by ?? h.created_by}</span>
              <span style={{ color: '#64748b' }}> · {h.locked_audit_hash.slice(0, 12)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
