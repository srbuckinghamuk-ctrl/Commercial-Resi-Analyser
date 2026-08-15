import type { EligibilityCriterion } from '../types';

interface CriterionRowProps {
  criterion: EligibilityCriterion;
  onOverride?: (key: string, value: boolean | null) => void;
}

export default function CriterionRow({ criterion, onOverride }: CriterionRowProps) {
  const statusIcon = criterion.passed === true
    ? '✅'
    : criterion.passed === false
      ? '❌'
      : '❓';

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
      <span style={{ fontSize: 18, flexShrink: 0, marginTop: 2 }}>{statusIcon}</span>
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
            {criterion.auto_checked ? 'Auto-checked' : criterion.source === 'user' ? 'User confirmed' : 'Manual check needed'}
          </span>
          {criterion.risk_flag && (
            <span style={{ fontSize: 11, color: '#f59e0b' }}>{criterion.risk_flag}</span>
          )}
        </div>
      </div>
      {onOverride && !criterion.auto_checked && criterion.passed === null && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            onClick={() => onOverride(criterion.key, true)}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: '#14532d',
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
            style={{
              padding: '4px 10px',
              fontSize: 12,
              background: '#450a0a',
              color: '#ef4444',
              border: '1px solid #7f1d1d',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Fail
          </button>
        </div>
      )}
    </div>
  );
}
