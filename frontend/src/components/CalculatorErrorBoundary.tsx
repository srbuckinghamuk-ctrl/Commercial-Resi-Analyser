import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /**
   * Values that identify what is being rendered. When any of them changes the
   * boundary clears its error and retries — the calculator passes the active
   * page, so navigating away from a page that threw recovers the rest of the
   * tabs instead of leaving every tab blank until a full page reload.
   */
  resetKeys?: readonly unknown[];
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
function keysChanged(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (prev === next) return false;
  if (prev == null || next == null) return prev !== next;
  if (prev.length !== next.length) return true;
  return prev.some((value, i) => !Object.is(value, next[i]));
}

export default class CalculatorErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('CalculatorErrorBoundary caught a render error:', error, info);
  }

  componentDidUpdate(prevProps: Props): void {
    // Reset only when the keys actually change. Resetting on every re-render
    // would put a child that throws persistently into a throw/reset loop.
    if (this.state.hasError && keysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false });
    }
  }

  private retry = (): void => {
    this.setState({ hasError: false });
  };

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
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12 }}>
            Your last saved appraisal is unaffected, and nothing has been sent to the server.
            Switch to another page to carry on, or try again below. If it keeps failing, reload.
          </p>
          <button
            type="button"
            onClick={this.retry}
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
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
