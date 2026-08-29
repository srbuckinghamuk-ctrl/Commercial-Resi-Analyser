import { Component, type ReactNode } from 'react';

/**
 * R16b (review round 2, Important 2b). PropertyMap and ConversionCalculator are
 * React.lazy route elements, so a failed chunk load throws during render and
 * would fall through to main.tsx's root ErrorBoundary -- which replaces the
 * WHOLE app, header and nav included, with "Something went wrong". This
 * boundary sits just inside <Suspense> so the header/nav above it stay
 * mounted and only the routed content area is replaced.
 *
 * It catches every render error in the routed content, not only chunk loads
 * (a boundary cannot tell them apart), so the copy is generic and the cause
 * is logged in componentDidCatch -- a production build otherwise leaves no
 * trace, since neither boundary logged before this file existed.
 *
 * Recovery: `resetKey` is the current pathname. While errored, a change of
 * route clears the error so the navigation genuinely works as the copy says;
 * while healthy, a change of `resetKey` does nothing -- this is deliberately
 * NOT `key={pathname}`, which would remount the calculator on every `:page`
 * change and lose unsaved inputs (the data-loss path spec §26.5 guards).
 */
interface Props {
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class LazyLoadBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('LazyLoadBoundary caught a render error', error, info.componentStack ?? '');
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 8 }}>
            This page could not be displayed.
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>
            It may be a network problem loading part of the app. Use the navigation
            above to go elsewhere, or reload to try this page again.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
