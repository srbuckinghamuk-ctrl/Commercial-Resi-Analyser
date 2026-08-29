import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import LazyLoadBoundary from './LazyLoadBoundary';

function Thrower(): never {
  throw new Error('chunk failed to load');
}

describe('LazyLoadBoundary (R16b parked minors)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the fallback, keeps the caller\'s chrome, and logs the cause', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <div>
        <nav>chrome</nav>
        <LazyLoadBoundary resetKey="/map"><Thrower /></LazyLoadBoundary>
      </div>,
    );
    expect(screen.getByText('This page could not be displayed.')).toBeInTheDocument();
    expect(screen.getByText('chrome')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    // componentDidCatch logs with our own prefix; React logs the throw too.
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('LazyLoadBoundary caught'))).toBe(true);
  });

  it('recovers when the route changes while errored -- the copy\'s "use the navigation" is true', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<LazyLoadBoundary resetKey="/map"><Thrower /></LazyLoadBoundary>);
    expect(screen.getByText('This page could not be displayed.')).toBeInTheDocument();
    // Same route, healthy child: still errored (no reset without a route change).
    rerender(<LazyLoadBoundary resetKey="/map"><p>page</p></LazyLoadBoundary>);
    expect(screen.queryByText('page')).not.toBeInTheDocument();
    // Route change: the error clears and the new page renders.
    rerender(<LazyLoadBoundary resetKey="/export"><p>page</p></LazyLoadBoundary>);
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  it('does not remount a healthy child when the route changes (unsaved state survives)', () => {
    const stats = { mounts: 0 };
    function Counter() {
      useEffect(() => { stats.mounts += 1; }, []); // runs once per MOUNT, not per render
      return <p>page</p>;
    }
    const { rerender } = render(<LazyLoadBoundary resetKey="/a"><Counter /></LazyLoadBoundary>);
    rerender(<LazyLoadBoundary resetKey="/b"><Counter /></LazyLoadBoundary>);
    expect(stats.mounts).toBe(1); // the same instance survived the route change
    expect(screen.getByText('page')).toBeInTheDocument();
  });
});
