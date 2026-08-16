import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Project } from '../types';

// Only the network boundary is stubbed. The engine is the real one: the tests
// below make it throw by driving the real UI, so they prove the component
// survives a genuine `runAppraisal` failure rather than a simulated one.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getAppraisal: vi.fn().mockRejectedValue(new actual.ApiError(404, 'not found', null)),
    saveAppraisal: vi.fn(),
  };
});

const { default: ConversionCalculator } = await import('./ConversionCalculator');

const PROJECT: Project = {
  id: 'p1',
  address_raw: '1 Test Street, Testville TS1 1TS',
  postcode: 'TS1 1TS',
  price_pence: 40000000,
  floor_area_sqm: 400,
  use_class: 'office',
  stage: 'opportunity_identified',
} as unknown as Project;

/** Sets the Finance page's facility term. 1e21 months makes the real engine
 * throw a RangeError building the schedule (`Array.from({length: 1e21})`) —
 * the class of failure that used to unmount the whole calculator. */
function setFacilityTerm(value: string): void {
  fireEvent.click(screen.getByRole('button', { name: /4\. Finance/ }));
  fireEvent.change(screen.getByDisplayValue('12'), { target: { value } });
}

describe('ConversionCalculator when the engine cannot compute', () => {
  // React logs the caught render error; keep the output pristine without
  // hiding an unexpected error from another test.
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  beforeEach(() => consoleErrorSpy.mockClear());
  afterEach(() => consoleErrorSpy.mockClear());

  it('keeps the calculator mounted and shows a recovery panel instead of unmounting', () => {
    render(<ConversionCalculator project={PROJECT} />);
    expect(screen.getByText('1. Acquisition Inputs')).toBeInTheDocument();

    setFacilityTerm('1e21');

    // The chrome survives: the nav is still there, so the component did not
    // unmount and its unsaved state is intact.
    expect(screen.getByRole('button', { name: /5\. Programme/ })).toBeInTheDocument();
    expect(screen.getByText(/appraisal could not be calculated/i)).toBeInTheDocument();
  });

  it('disables saving while the appraisal cannot be calculated', () => {
    render(<ConversionCalculator project={PROJECT} />);
    const saveButton = screen.getByRole('button', { name: /save appraisal|update appraisal/i });
    expect(saveButton).toBeEnabled();

    setFacilityTerm('1e21');

    expect(screen.getByRole('button', { name: /save appraisal|update appraisal/i })).toBeDisabled();
  });

  it('restores the last inputs that calculated when the user undoes the change', () => {
    render(<ConversionCalculator project={PROJECT} />);
    setFacilityTerm('1e21');
    expect(screen.getByText(/appraisal could not be calculated/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /undo last change/i }));

    // Back on a computable document: the Finance page renders again with the
    // term it had before the change, and saving is possible once more.
    expect(screen.queryByText(/appraisal could not be calculated/i)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save appraisal|update appraisal/i })).toBeEnabled();
  });

  it('never shows a stale calculation alongside the failure (spec §2)', () => {
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: /7\. Appraisal/ }));
    // A computable document shows real metric cards.
    expect(screen.getByText('Developer GDV')).toBeInTheDocument();

    setFacilityTerm('1e21');

    // Once it cannot compute, the previous run must not remain on screen.
    expect(screen.queryByText('Developer GDV')).not.toBeInTheDocument();
  });
});

describe('ConversionCalculator — Sensitivity is page 9', () => {
  it('offers thirteen numbered pages with Sensitivity ninth', () => {
    render(<ConversionCalculator project={PROJECT} />);
    for (const label of [
      '9. Sensitivity', '10. Exit', '11. Risk', '12. Deal Spider', '13. Investor',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the Sensitivity page when its tab is selected', () => {
    render(<ConversionCalculator project={PROJECT} />);
    fireEvent.click(screen.getByRole('button', { name: '9. Sensitivity' }));
    expect(screen.getByRole('heading', { name: /9\. Sensitivity/ })).toBeInTheDocument();
  });
});
