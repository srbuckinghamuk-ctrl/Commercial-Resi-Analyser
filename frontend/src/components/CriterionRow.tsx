import type { EligibilityCriterion } from '../types';

interface CriterionRowProps {
  criterion: EligibilityCriterion;
  onOverride?: (key: string, value: boolean | null) => void;
  /** Current session override for this criterion, if any. */
  overrideValue?: boolean | null;
}

function StatusIcon({ passed }: { passed: boolean | null }) {
  const config =
    passed === true
      ? { bg: '#14532d', fg: '#22c55e', glyph: '✓', label: 'Passed' }
      : passed === false
        ? { bg: '#450a0a', fg: '#ef4444', glyph: '✕', label: 'Failed' }
        : { bg: '#1e3a5f', fg: '#93c5fd', glyph: '?', label: 'Needs checking' };
  return (
    <span
      role="img"
      aria-label={config.label}
      style={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        background: config.bg,
        color: config.fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
        marginTop: 2,
      }}
    >
      {config.glyph}
    </span>
  );
}

export default function CriterionRow({ criterion, onOverride, overrideValue }: CriterionRowProps) {
  const isManual = !criterion.auto_checked;
  const answered = overrideValue !== undefined && overrideValue !== null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 12px',
        background: '#0f1d32',
        borderRadius: 6,
        border: `1px solid ${criterion.passed === false ? '#7f1d1d' : '#1e3a5f'}`,
      }}
    >
      <StatusIcon passed={criterion.passed} />
      <div style={{ flex: 1 }}>
        <div style={{ color: '#e2e8f0', fontWeight: 500, fontSize: 14 }}>{criterion.label}</div>
        {criterion.value && (
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{criterion.value}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 4,
              background: criterion.auto_checked ? '#1e3a5f' : '#3b2f1e',
              color: criterion.auto_checked ? '#60a5fa' : '#fbbf24',
            }}
          >
            {criterion.auto_checked ? 'Verified automatically' : criterion.source === 'user' ? 'Your answer' : 'Needs your answer'}
          </span>
          {criterion.category && (
            <span
              style={{
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                background: '#111a26',
                color: criterion.category === 'statutory' ? '#c4b5fd' : '#7dd3fc',
                border: '1px solid #1e3a5f',
              }}
              title={
                criterion.category === 'statutory'
                  ? 'Failing this removes the permitted development right entirely'
                  : 'A matter the council weighs at prior-approval stage — failing is a risk, not automatic ineligibility'
              }
            >
              {criterion.category === 'statutory' ? 'Statutory requirement' : 'Prior-approval matter'}
            </span>
          )}
          {criterion.risk_flag && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>{criterion.risk_flag}</span>
          )}
        </div>
      </div>
      {onOverride && isManual && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} role="group" aria-label={`Answer for: ${criterion.label}`}>
          <button
            onClick={() => onOverride(criterion.key, true)}
            aria-pressed={criterion.passed === true}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: criterion.passed === true ? '#14532d' : 'transparent',
              color: '#22c55e',
              border: '1px solid #166534',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Pass
          </button>
          <button
            onClick={() => onOverride(criterion.key, false)}
            aria-pressed={criterion.passed === false}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: criterion.passed === false ? '#450a0a' : 'transparent',
              color: '#ef4444',
              border: '1px solid #7f1d1d',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Fail
          </button>
          {(answered || criterion.passed !== null) && (
            <button
              onClick={() => onOverride(criterion.key, null)}
              aria-label={`Clear answer for: ${criterion.label}`}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                background: 'transparent',
                color: '#94a3b8',
                border: '1px solid #1e3a5f',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
