import { describe, it, expect } from 'vitest';
import { PAGES, PAGE_SLUG, pageForSlug, calculatorPath, FIRST_PAGE, STAGES } from './pages';

describe('calculator pages (spec §26.5)', () => {
  it('is the five-stage order of spec §26.5, numbered 1..16', () => {
    expect(PAGES.map((p) => `${p.num} ${p.stage} ${p.key}`)).toEqual([
      '1 Inputs acquisition', '2 Inputs areas', '3 Inputs unit_mix', '4 Inputs conversion_costs', '5 Inputs vat',
      '6 Funding finance', '7 Funding programme', '8 Funding cashflow',
      '9 Exit exit_strategy',
      '10 Underwriting appraisal', '11 Underwriting scenarios', '12 Underwriting sensitivity', '13 Underwriting risk_register',
      '14 Output deal_spider', '15 Output investor_summary', '16 Output lender_case',
    ]);
  });
  it('every stage is contiguous and non-empty, in STAGES order', () => {
    const seen = PAGES.map((p) => p.stage).filter((s, i, a) => i === 0 || a[i - 1] !== s);
    expect(seen).toEqual([...STAGES]);
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
