import { describe, it, expect } from 'vitest';
import { exportErrorMessage, SnapshotMissingError } from './export-errors';

describe('exportErrorMessage', () => {
  it('explains the missing prerequisite when the fetch returned HTTP 404', () => {
    const err = new Error('HTTP 404: {"detail":"Financial appraisal not found"}');
    const msg = exportErrorMessage(
      'Investment Memorandum',
      'no financial appraisal is saved for this project yet — open the Conversion Calculator and save one first',
      err,
    );
    expect(msg).toBe(
      'Could not generate the Investment Memorandum — no financial appraisal is saved for this project yet — open the Conversion Calculator and save one first.',
    );
  });

  it('explains missing calculator data for a SnapshotMissingError', () => {
    const err = new SnapshotMissingError();
    const msg = exportErrorMessage('Investment Memorandum', 'unused for this case', err);
    expect(msg).toBe(
      'Could not generate the Investment Memorandum — the saved appraisal has no calculator data. Open the Conversion Calculator and re-save the appraisal.',
    );
  });

  it('reports an unexpected failure for any other error', () => {
    const err = new Error('jsPDF exploded');
    const msg = exportErrorMessage('appraisal workbook', 'unused for this case', err);
    expect(msg).toBe(
      'Could not generate the appraisal workbook — something went wrong while building it. Try again; if it keeps failing, check the browser console for details.',
    );
  });

  it('does not treat other HTTP statuses as a missing prerequisite', () => {
    const err = new Error('HTTP 500: internal server error');
    const msg = exportErrorMessage('appraisal PDF', 'unused for this case', err);
    expect(msg).toBe(
      'Could not generate the appraisal PDF — something went wrong while building it. Try again; if it keeps failing, check the browser console for details.',
    );
  });

  it('handles non-Error throwables as unexpected failures', () => {
    const msg = exportErrorMessage('appraisal PDF', 'unused for this case', 'a string');
    expect(msg).toBe(
      'Could not generate the appraisal PDF — something went wrong while building it. Try again; if it keeps failing, check the browser console for details.',
    );
  });
});
