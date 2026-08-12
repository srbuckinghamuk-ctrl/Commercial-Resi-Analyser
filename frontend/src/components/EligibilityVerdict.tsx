import type { EligibilityAssessment } from '../types';
import CriterionRow from './CriterionRow';

interface EligibilityVerdictDisplayProps {
  assessment: EligibilityAssessment;
  onOverride?: (key: string, value: boolean | null) => void;
  overrides?: Record<string, boolean | null>;
}

const VERDICT_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  green: { bg: '#052e16', border: '#14532d', text: '#22c55e', label: 'ELIGIBLE' },
  amber: { bg: '#3b2f1e', border: '#854d0e', text: '#fbbf24', label: 'LIKELY ELIGIBLE — CHECKS OUTSTANDING' },
  red: { bg: '#450a0a', border: '#7f1d1d', text: '#ef4444', label: 'NOT ELIGIBLE' },
};

export default function EligibilityVerdictDisplay({
  assessment,
  onOverride,
  overrides,
}: EligibilityVerdictDisplayProps) {
  const style = VERDICT_STYLES[assessment.verdict] || VERDICT_STYLES.amber;

  const passedCount = assessment.criteria.filter((c) => c.passed === true).length;
  const failedCount = assessment.criteria.filter((c) => c.passed === false).length;
  const pendingCount = assessment.criteria.filter((c) => c.passed === null).length;

  return (
    <div>
      <div
        style={{
          padding: '16px 20px',
          background: style.bg,
          border: `2px solid ${style.border}`,
          borderRadius: 8,
          marginBottom: 16,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, color: style.text }}>{style.label}</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
          PDR Class: {assessment.pdr_class.replace(/_/g, ' ').toUpperCase()} · {passedCount} passed · {failedCount} failed · {pendingCount} pending
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {assessment.criteria.map((c) => (
          <CriterionRow key={c.key} criterion={c} onOverride={onOverride} overrideValue={overrides?.[c.key]} />
        ))}
      </div>

      {assessment.suggested_next_steps.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ color: '#e2e8f0', fontSize: 16, marginBottom: 8 }}>Suggested Next Steps</h3>
          <ul style={{ color: '#94a3b8', fontSize: 13, paddingLeft: 20, lineHeight: 1.8 }}>
            {assessment.suggested_next_steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
