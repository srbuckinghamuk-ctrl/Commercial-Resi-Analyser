import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CalculatorErrorBoundary from './CalculatorErrorBoundary';

function Bomb(): never {
  throw new Error('boom');
}

describe('CalculatorErrorBoundary', () => {
  // React logs the error to the console (and jsdom logs the "uncaught" event
  // during the throwing render); silence both so the test output stays clean
  // without masking a genuinely unexpected error from a different test.
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterEach(() => consoleErrorSpy.mockClear());

  it('renders children when nothing throws', () => {
    render(
      <CalculatorErrorBoundary>
        <div>Calculator content</div>
      </CalculatorErrorBoundary>,
    );
    expect(screen.getByText('Calculator content')).toBeInTheDocument();
  });

  it('renders the dark-theme fallback panel instead of unmounting when a child throws', () => {
    render(
      <CalculatorErrorBoundary>
        <Bomb />
      </CalculatorErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong rendering the calculator')).toBeInTheDocument();
    expect(screen.getByText(/your last saved appraisal is unaffected/i)).toBeInTheDocument();
  });

  it('does not tell the user to edit a field the fallback has replaced', () => {
    render(
      <CalculatorErrorBoundary>
        <Bomb />
      </CalculatorErrorBoundary>,
    );
    // The thrown page body is gone, so its inputs are not on screen to adjust —
    // the copy must only offer recovery routes that actually work.
    expect(screen.queryByText(/adjust the last-edited field/i)).not.toBeInTheDocument();
    expect(screen.getByText(/switch to another page/i)).toBeInTheDocument();
  });

  it('recovers when a resetKey changes (e.g. the user switches calculator page)', () => {
    const { rerender } = render(
      <CalculatorErrorBoundary resetKeys={['programme']}>
        <Bomb />
      </CalculatorErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong rendering the calculator')).toBeInTheDocument();

    rerender(
      <CalculatorErrorBoundary resetKeys={['cashflow']}>
        <div>Cashflow content</div>
      </CalculatorErrorBoundary>,
    );
    expect(screen.getByText('Cashflow content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong rendering the calculator')).not.toBeInTheDocument();
  });

  it('stays in the fallback while the resetKeys are unchanged', () => {
    const { rerender } = render(
      <CalculatorErrorBoundary resetKeys={['programme']}>
        <Bomb />
      </CalculatorErrorBoundary>,
    );
    // Re-rendering with healthy children but the same keys must NOT auto-retry:
    // a persistently-throwing child would otherwise loop between throw and reset.
    rerender(
      <CalculatorErrorBoundary resetKeys={['programme']}>
        <div>Programme content</div>
      </CalculatorErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong rendering the calculator')).toBeInTheDocument();
    expect(screen.queryByText('Programme content')).not.toBeInTheDocument();
  });

  it('retries the render when the user clicks Try again', () => {
    function Flaky({ throws }: { throws: boolean }) {
      if (throws) throw new Error('boom');
      return <div>Recovered content</div>;
    }
    const { rerender } = render(
      <CalculatorErrorBoundary resetKeys={['programme']}>
        <Flaky throws />
      </CalculatorErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong rendering the calculator')).toBeInTheDocument();

    // The cause is fixed elsewhere (e.g. state edited from the surviving chrome),
    // but the keys have not changed — the explicit retry is the only way back.
    rerender(
      <CalculatorErrorBoundary resetKeys={['programme']}>
        <Flaky throws={false} />
      </CalculatorErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });
});
