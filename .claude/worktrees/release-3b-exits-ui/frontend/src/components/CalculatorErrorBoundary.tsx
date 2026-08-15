import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * CRITICAL 1d: an invalid Programme-page value (e.g. a negative or fractional
 * start_offset/duration_months that slips past the editor's own clamp) can
 * still throw inside a render-time useMemo (buildSchedule/spreadByCurve) —
 * with no boundary, that unmounts the entire calculator and any unsaved
 * edits with it. This boundary is scoped to the page-body + run-derived UI
 * in ConversionCalculator.tsx, not the whole component, so the surrounding
 * nav/save/status chrome — and the component's own state — survive a thrown
 * render.
 */
export default class CalculatorErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CalculatorErrorBoundary caught a render error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
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
          <h3 style={{ color: '#f87171', fontSize: 16, marginBottom: 8 }}>
            Something went wrong rendering the calculator
          </h3>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            Your last saved appraisal is unaffected. Adjust the last-edited field or reload.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
