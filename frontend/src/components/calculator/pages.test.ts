import { describe, it, expect } from 'vitest';
import { PAGES, PAGE_SLUG, pageForSlug, calculatorPath, FIRST_PAGE } from './pages';

describe('calculator pages (spec §26.5)', () => {
  it('has sixteen pages numbered 1..16 in table order', () => {
    expect(PAGES.map((p) => p.num)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
  it('slugs are unique and round-trip', () => {
    const slugs = PAGES.map((p) => PAGE_SLUG[p.key]);
    expect(new Set(slugs).size).toBe(16);
    for (const p of PAGES) expect(pageForSlug(PAGE_SLUG[p.key])).toBe(p.key);
    expect(slugs.every((s) => /^[a-z-]+$/.test(s))).toBe(true);
  });
  it('rejects an unknown or absent slug', () => {
    expect(pageForSlug('nonsense')).toBeNull();
    expect(pageForSlug(undefined)).toBeNull();
    expect(pageForSlug('unit_mix')).toBeNull(); // the key is not the slug
  });
  it('builds the address', () => {
    expect(calculatorPath('p1', 'unit_mix')).toBe('/projects/p1/calculator/unit-mix');
    expect(calculatorPath('p1', FIRST_PAGE)).toBe('/projects/p1/calculator/acquisition');
  });
});
