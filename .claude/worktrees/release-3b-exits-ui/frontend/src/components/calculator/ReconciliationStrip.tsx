import type { AppraisalRun } from '../../lib/model';

interface Props {
  run: AppraisalRun;
}

const GREEN = '#16a34a';
const RED = '#dc2626';
const AMBER = '#d97706';

function Chip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: '#f8fafc',
        background: ok ? GREEN : RED,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function AmberChip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: '#f8fafc',
        background: AMBER,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

type Entry = { key: string; message: string; color: string; rank: number };

export default function ReconciliationStrip({ run }: Props) {
  const rec = run.reconciliation;

  const chips: { label: string; ok: boolean }[] = [
    { label: 'Sources = Uses', ok: rec.sources_equal_uses },
    { label: 'Debt ledger', ok: rec.debt_rollforward_ok },
    { label: 'Facility', ok: rec.facility_within_limit },
    { label: 'Senior repaid', ok: rec.senior_repaid },
    { label: 'Fully funded', ok: rec.funding_complete },
    { label: 'Report safe', ok: rec.report_safe },
  ];

  const validationEntries: Entry[] = run.validation.map((v, i) => ({
    key: `val-${i}`,
    message: v.message,
    color: v.severity === 'error' ? RED : AMBER,
    rank: v.severity === 'error' ? 0 : 1,
  }));

  const flagEntries: Entry[] = run.metrics.flags.map((f, i) => ({
    key: `flag-${i}`,
    message: f.message,
    color: f.severity === 'red' ? RED : f.severity === 'amber' ? AMBER : '#94a3b8',
    rank: f.severity === 'red' ? 0 : f.severity === 'amber' ? 1 : 2,
  }));

  const entries = [...validationEntries, ...flagEntries].sort((a, b) => a.rank - b.rank);

  return (
    <div style={{ padding: '12px 16px', background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 8, marginBottom: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {chips.map((c) => <Chip key={c.label} label={c.label} ok={c.ok} />)}
        {run.inputs.finance.requires_confirmation && (
          <AmberChip label="Legacy — confirm facility terms" />
        )}
      </div>
      {entries.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map((e) => (
            <div key={e.key} style={{ fontSize: 12, color: e.color }}>
              {e.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
