import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText(/adjust the last-edited field or reload/i)).toBeInTheDocument();
  });
});
