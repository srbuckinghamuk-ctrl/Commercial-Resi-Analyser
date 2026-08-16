import type { EligibilityAssessment } from '../types';

/**
 * Rebuild the manual-override map from a stored assessment.
 *
 * Criteria the user answered are persisted with source === 'user'. Seeding
 * the wizard's override state from them means a re-run (or a single new
 * answer after a page reload) re-sends every previous answer instead of
 * silently reverting them to pending.
 */
export function overridesFromAssessment(
  assessment: EligibilityAssessment,
): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  for (const criterion of assessment.criteria) {
    if (criterion.source === 'user' && criterion.passed !== null) {
      overrides[criterion.key] = criterion.passed;
    }
  }
  return overrides;
}
