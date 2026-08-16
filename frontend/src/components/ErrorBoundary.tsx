import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#050d18', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
            <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 20 }}>
              The app hit an unexpected error. Your saved projects and appraisals are safe on the server.
            </p>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.href = '/';
              }}
              style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
            >
              Back to the pipeline
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
