import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import CalculatorFailurePanel from './CalculatorFailurePanel';

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
        <CalculatorFailurePanel
          title="Something went wrong rendering the calculator"
          actionLabel="Try again"
          onAction={this.retry}
        >
          Your last saved appraisal is unaffected, and nothing has been sent to the server.
          Switch to another page to carry on, or try again below. If it keeps failing, reload.
        </CalculatorFailurePanel>
      );
    }
    return this.props.children;
  }
}
