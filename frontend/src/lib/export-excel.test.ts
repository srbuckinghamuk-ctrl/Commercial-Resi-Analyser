import { describe, it, expect } from 'vitest';
import { formatProjectRow } from './export-excel';
import type { Project } from '../types';

const mockProject: Project = {
  id: 'test-id',
  address_raw: '1 Test Street, London',
  address_line1: null,
  address_line2: null,
  address_town: 'London',
  address_county: null,
  address_postcode: 'SW1A 1AA',
  address_postcode_district: 'SW1A',
  price_pence: 50000000,
  price_qualifier: 'Guide',
  use_class: 'office',
  floor_area_sqft: 2000,
  floor_area_sqm: 185.8,
  floors: 2,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: 'Office',
  epc_rating: 'C',
  is_vacant: true,
  vacancy_date: '2026-01-01',
  source_url: 'https://example.com/prop/1',
  source_name: 'Test Source',
  description: null,
  image_urls: [],
  stage: 'opportunity_identified',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('formatProjectRow', () => {
  it('includes address', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Address']).toBe('1 Test Street, London');
  });

  it('converts price to pounds', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Price (£)']).toBe(500000);
  });

  it('includes postcode', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Postcode']).toBe('SW1A 1AA');
  });

  it('includes stage as readable text', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Stage']).toBe('Opportunity Identified');
  });

  it('includes use class', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Use Class']).toBe('Office');
  });

  it('includes floor area', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Floor Area (m²)']).toBe(185.8);
  });

  it('includes tenure', () => {
    const row = formatProjectRow(mockProject);
    expect(row['Tenure']).toBe('Freehold');
  });
});
