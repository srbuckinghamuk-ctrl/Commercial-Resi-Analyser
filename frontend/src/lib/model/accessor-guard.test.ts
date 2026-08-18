import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * R9 spec §15.4. The eslint rule is the enforcement; this test is what stops
 * the enforcement being silently removed or hollowed out.
 *
 * Task 5 verified by hand (twice — the two selectors have different AST
 * shapes) that the rule actually fires on a planted violation. That check is
 * manual and one-off; this test is the standing guard on the guard's own
 * configuration.
 */
const CONFIG = readFileSync(resolve(__dirname, '../../../eslint.config.js'), 'utf-8');

describe('single-accessor guard configuration', () => {
  it('restricts direct reads of the cost-area field', () => {
    expect(CONFIG).toContain("property.name='total_construction_sqm'");
  });

  it('restricts direct reads of the acquisition-tax band table', () => {
    // Identifier, not MemberExpression: TAX_TABLES is imported by name.
    expect(CONFIG).toContain("Identifier[name='TAX_TABLES']");
  });

  it('keeps the allowlist to the modules that own, declare, write or build fixtures for the values', () => {
    for (const allowed of [
      'src/lib/model/areas.ts',
      'src/lib/tax/acquisition-tax.ts',
      'src/components/calculator/ConversionCostsPage.tsx',
      'src/lib/report-qa/memo-fixtures.ts',
    ]) {
      expect(CONFIG).toContain(allowed);
    }
  });

  it('does not exempt the consumer modules R8 was bitten by', () => {
    // metrics.ts, schedule.ts, deal-spider.ts and AcquisitionPage.tsx are the
    // exact files where R8's three instances lived. If any of them ever appears
    // in the allowlist, the guard has been defeated rather than satisfied.
    for (const forbidden of [
      'src/lib/model/metrics.ts',
      'src/lib/model/schedule.ts',
      'src/lib/deal-spider.ts',
      'src/components/calculator/AcquisitionPage.tsx',
    ]) {
      expect(CONFIG).not.toContain(forbidden);
    }
  });

  it('does not exempt validation.ts, which reads the raw field only through bridge.manual_area_sqm', () => {
    // R9 Task 5 binding correction 3: validation.ts stays off the allowlist
    // because it now reads the manual figure through the bridge accessor
    // (`bridge.manual_area_sqm`), not the raw field.
    expect(CONFIG).not.toContain('src/lib/model/validation.ts');
  });
});
