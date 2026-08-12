import { describe, it, expect } from 'vitest';
import { overridesFromAssessment } from './eligibility-overrides';
import type { EligibilityAssessment } from '../types';

function makeAssessment(criteria: EligibilityAssessment['criteria']): EligibilityAssessment {
  return {
    id: 'a1',
    project_id: 'p1',
    pdr_class: 'class_ma',
    criteria,
    verdict: 'amber',
    suggested_next_steps: [],
    notes: null,
    ruleset_version: 'gpdo-2026-08.2',
    created_at: '2026-08-12T00:00:00Z',
    updated_at: '2026-08-12T00:00:00Z',
  };
}

describe('overridesFromAssessment', () => {
  it('extracts only user-answered criteria', () => {
    const assessment = makeAssessment([
      { key: 'class_e_use_period', label: '', passed: true, source: 'user', auto_checked: false, value: null, risk_flag: null },
      { key: 'listed_building', label: '', passed: false, source: 'user', auto_checked: false, value: null, risk_flag: null },
      { key: 'article_4', label: '', passed: true, source: 'semi_auto', auto_checked: true, value: null, risk_flag: null },
      { key: 'natural_light', label: '', passed: null, source: 'manual', auto_checked: false, value: null, risk_flag: null },
    ]);
    expect(overridesFromAssessment(assessment)).toEqual({
      class_e_use_period: true,
      listed_building: false,
    });
  });

  it('returns an empty map when nothing was user-answered', () => {
    const assessment = makeAssessment([
      { key: 'article_4', label: '', passed: true, source: 'auto', auto_checked: true, value: null, risk_flag: null },
    ]);
    expect(overridesFromAssessment(assessment)).toEqual({});
  });

  it('ignores user rows whose passed is null', () => {
    const assessment = makeAssessment([
      { key: 'weird', label: '', passed: null, source: 'user', auto_checked: false, value: null, risk_flag: null },
    ]);
    expect(overridesFromAssessment(assessment)).toEqual({});
  });
});
