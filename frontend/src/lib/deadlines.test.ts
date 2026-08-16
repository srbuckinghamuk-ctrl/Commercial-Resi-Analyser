import { describe, it, expect } from 'vitest';
import { activeDeadline } from './deadlines';
import type { Project } from '../types';

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: 'p1',
    address_raw: '1 Test St',
    address_line1: null,
    address_line2: null,
    address_town: null,
    address_county: null,
    address_postcode: null,
    address_postcode_district: null,
    price_pence: 10_000_000,
    price_qualifier: null,
    use_class: 'office',
    floor_area_sqft: null,
    floor_area_sqm: null,
    floors: null,
    tenure: 'unknown',
    lease_years_remaining: null,
    current_use_description: null,
    epc_rating: null,
    is_vacant: null,
    vacancy_date: null,
    source_url: null,
    source_name: null,
    description: null,
    image_urls: [],
    stage: 'opportunity_identified',
    pa_submitted_date: null,
    pa_decision_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('activeDeadline', () => {
  it('returns null when no dates are set', () => {
    expect(activeDeadline(makeProject({ stage: 'prior_approval_submitted' }))).toBeNull();
    expect(activeDeadline(makeProject({ stage: 'approved' }))).toBeNull();
  });

  it('computes the 56-day determination window', () => {
    const project = makeProject({
      stage: 'prior_approval_submitted',
      pa_submitted_date: '2026-08-01',
    });
    const d = activeDeadline(project, new Date('2026-08-31T12:00:00'));
    expect(d).not.toBeNull();
    expect(d!.due).toBe('2026-09-26');
    expect(d!.daysRemaining).toBe(26);
    expect(d!.status).toBe('ok');
    expect(d!.chip).toBe('PA day 30 of 56');
  });

  it('warns inside the last two weeks and flags overdue', () => {
    const project = makeProject({
      stage: 'prior_approval_submitted',
      pa_submitted_date: '2026-08-01',
    });
    const warning = activeDeadline(project, new Date('2026-09-20T09:00:00'));
    expect(warning!.status).toBe('warning');

    const overdue = activeDeadline(project, new Date('2026-10-01T09:00:00'));
    expect(overdue!.status).toBe('overdue');
    expect(overdue!.chip).toContain('overdue');
  });

  it('computes the 3-year completion window from the decision date', () => {
    const project = makeProject({
      stage: 'approved',
      pa_decision_date: '2026-06-01',
    });
    const d = activeDeadline(project, new Date('2026-08-12T09:00:00'));
    expect(d).not.toBeNull();
    expect(d!.due).toBe('2029-06-01');
    expect(d!.status).toBe('ok');
    expect(d!.chip).toBe('Complete by 2029-06-01');
  });

  it('flags the completion window inside the final six months', () => {
    const project = makeProject({
      stage: 'in_conversion',
      pa_decision_date: '2026-06-01',
    });
    const d = activeDeadline(project, new Date('2029-03-01T09:00:00'));
    expect(d!.status).toBe('warning');
    expect(d!.chip).toMatch(/days to complete/);
  });

  it('ignores dates on stages where they are not relevant', () => {
    const project = makeProject({
      stage: 'complete',
      pa_submitted_date: '2026-08-01',
      pa_decision_date: '2026-09-01',
    });
    expect(activeDeadline(project)).toBeNull();
  });
});
