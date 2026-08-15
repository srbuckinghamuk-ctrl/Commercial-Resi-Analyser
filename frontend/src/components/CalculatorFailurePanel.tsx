import type { ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * The calculator's two failure surfaces share this panel so they look and read
 * the same: CalculatorErrorBoundary (a page component threw while rendering)
 * and ConversionCalculator's engine-failure branch (runAppraisal threw, which
 * happens above the boundary in the tree and so cannot be caught by it).
 */
export default function CalculatorFailurePanel({ title, children, actionLabel, onAction }: Props) {
  return (
    <div
      style={{
        padding: 24,
        margin: 24,
        background: '#1e1b2e',
        border: '1px solid #ef4444',
        borderRadius: 8,
        color: '#e2e8f0',
      }}
    >
      <h3 style={{ color: '#f87171', fontSize: 16, marginBottom: 8 }}>{title}</h3>
      <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: actionLabel ? 12 : 0 }}>{children}</p>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={{
            padding: '8px 16px',
            background: '#1e3a5f',
            border: '1px solid #2563eb',
            borderRadius: 6,
            color: '#e2e8f0',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
