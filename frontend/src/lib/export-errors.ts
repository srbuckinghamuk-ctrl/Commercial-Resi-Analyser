/**
 * Thrown when a saved appraisal's inputs_snapshot cannot be normalised into
 * calculator inputs (e.g. it predates the calculator or was saved empty).
 */
export class SnapshotMissingError extends Error {
  constructor() {
    super('No calculator data found in appraisal snapshot');
    this.name = 'SnapshotMissingError';
  }
}

import { isNotFound } from './api';

/**
 * Map an export failure to a user-facing message that distinguishes the three
 * real failure modes: the prerequisite record doesn't exist (HTTP 404), the
 * saved snapshot has no calculator data, or generation itself blew up.
 */
export function exportErrorMessage(docLabel: string, missingPrereq: string, err: unknown): string {
  if (err instanceof SnapshotMissingError) {
    return `Could not generate the ${docLabel} — the saved appraisal has no calculator data. Open the Conversion Calculator and re-save the appraisal.`;
  }
  if (isNotFound(err)) {
    return `Could not generate the ${docLabel} — ${missingPrereq}.`;
  }
  return `Could not generate the ${docLabel} — something went wrong while building it. Try again; if it keeps failing, check the browser console for details.`;
}
