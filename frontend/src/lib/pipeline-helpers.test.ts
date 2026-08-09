import { describe, it, expect } from 'vitest';
import { filterProjects, sortProjects } from './pipeline-helpers';
import type { Project } from '../types';

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: crypto.randomUUID(),
  address_raw: '1 Test St',
  address_line1: null,
  address_line2: null,
  address_town: null,
  address_county: null,
  address_postcode: null,
  address_postcode_district: null,
  price_pence: 50000000,
  price_qualifier: null,
  use_class: 'office',
  floor_area_sqft: null,
  floor_area_sqm: null,
  floors: null,
  tenure: 'freehold',
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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('filterProjects', () => {
  it('returns all projects when all filters are "all"', () => {
    const projects = [makeProject(), makeProject()];
    const result = filterProjects(projects, { stage: 'all', useClass: 'all' });
    expect(result).toHaveLength(2);
  });

  it('filters by stage', () => {
    const projects = [
      makeProject({ stage: 'opportunity_identified' }),
      makeProject({ stage: 'approved' }),
      makeProject({ stage: 'opportunity_identified' }),
    ];
    const result = filterProjects(projects, { stage: 'opportunity_identified', useClass: 'all' });
    expect(result).toHaveLength(2);
  });

  it('filters by use class', () => {
    const projects = [
      makeProject({ use_class: 'office' }),
      makeProject({ use_class: 'retail' }),
    ];
    const result = filterProjects(projects, { stage: 'all', useClass: 'office' });
    expect(result).toHaveLength(1);
    expect(result[0].use_class).toBe('office');
  });
});

describe('sortProjects', () => {
  it('sorts by created_at ascending', () => {
    const projects = [
      makeProject({ created_at: '2026-03-01T00:00:00Z' }),
      makeProject({ created_at: '2026-01-01T00:00:00Z' }),
      makeProject({ created_at: '2026-02-01T00:00:00Z' }),
    ];
    const result = sortProjects(projects, 'created_at', 'asc');
    expect(result[0].created_at).toBe('2026-01-01T00:00:00Z');
    expect(result[2].created_at).toBe('2026-03-01T00:00:00Z');
  });

  it('sorts by price_pence descending', () => {
    const projects = [
      makeProject({ price_pence: 10000000 }),
      makeProject({ price_pence: 50000000 }),
      makeProject({ price_pence: 25000000 }),
    ];
    const result = sortProjects(projects, 'price_pence', 'desc');
    expect(result[0].price_pence).toBe(50000000);
    expect(result[2].price_pence).toBe(10000000);
  });

  it('sorts by created_at descending', () => {
    const projects = [
      makeProject({ created_at: '2026-01-01T00:00:00Z' }),
      makeProject({ created_at: '2026-03-01T00:00:00Z' }),
    ];
    const result = sortProjects(projects, 'created_at', 'desc');
    expect(result[0].created_at).toBe('2026-03-01T00:00:00Z');
  });
});
