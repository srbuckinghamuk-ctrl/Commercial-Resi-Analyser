import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

/**
 * R9 spec §15.4. The eslint rule is the enforcement; this test is what stops
 * the enforcement being silently removed or hollowed out.
 *
 * Fix round 1 review finding: the first version of this file only pattern-
 * matched substrings in the config source (`property.name='...'` etc.). That
 * proved the *selectors* exist, but never asserted their *severity* — a future
 * edit changing `'no-restricted-syntax': ['error', ...]` to `'warn'` would
 * leave every one of those assertions green while `npm run lint` kept exiting
 * 0, i.e. the guard would go inert while looking healthy. That is exactly the
 * class of defect this whole task exists to prevent.
 *
 * So the enforcement checks below run the real linter (ESLint's Node API)
 * against synthetic in-memory source and assert on the reported message's
 * `severity` (2 = error, 1 = warning, absent = not reported at all) — the
 * guard now has to prove itself on every test run, not just pattern-match its
 * own configuration text.
 */
const FRONTEND_ROOT = resolve(__dirname, '../../..');
const CONFIG_PATH = resolve(FRONTEND_ROOT, 'eslint.config.js');
const CONFIG = readFileSync(CONFIG_PATH, 'utf-8');

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: FRONTEND_ROOT, overrideConfigFile: CONFIG_PATH });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

describe('single-accessor guard enforcement (runs the real linter)', () => {
  it('reports a direct read of total_construction_sqm as an ERROR, not a warning', async () => {
    const messages = await lint(
      'export function illegal(x: any) { return x.total_construction_sqm; }\n',
      // Deliberately not on the allowlist. The path need not exist on disk —
      // ESLint only uses it to select which config block applies.
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /total_construction_sqm/.test(m.message));
    expect(hit, `expected a no-restricted-syntax hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2); // 2 = error, 1 = warning. `npm run lint --max-warnings 0` (package.json) would also
    // now fail on a downgrade to 'warn', but that is a second, independent belt — this assertion is the direct one.
  });

  // R9 fix wave — three read paths the guard could not see. Each is asserted
  // through the real linter, and each asserts that the message is the NEW
  // rule's, so a proof cannot be satisfied by a pre-existing selector.
  it('reports a DESTRUCTURED read of total_construction_sqm as an ERROR', async () => {
    const messages = await lint(
      'export function illegal(costs: { total_construction_sqm: number }) {\n'
      + '  const { total_construction_sqm } = costs;\n'
      + '  return total_construction_sqm;\n'
      + '}\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /destructure/.test(m.message));
    expect(hit, `expected a destructuring hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  });

  it('reports a COMPUTED read of total_construction_sqm as an ERROR', async () => {
    const messages = await lint(
      "export function illegal(costs: Record<string, number>) { return costs['total_construction_sqm']; }\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /computed member access/.test(m.message));
    expect(hit, `expected a computed-access hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  });

  it('does NOT flag an object-literal write of total_construction_sqm', async () => {
    // The counter-example the destructuring selector needs. `ObjectExpression >
    // Property` is a write — the cost page's own editor does exactly this —
    // and the rule has never restricted writes. Scoping the selector to
    // ObjectPattern is what keeps that true.
    const messages = await lint(
      'export const write = (v: number) => ({ total_construction_sqm: v });\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toEqual([]);
  });

  it('reports a reference to selectBandSet as an ERROR', async () => {
    const messages = await lint(
      "import { selectBandSet } from '../tax/acquisition-tax';\n"
      + "export const bands = selectBandSet('england_ni', 'non_residential', null).set;\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /selectBandSet/.test(m.message));
    expect(hit, `expected a selectBandSet hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  });

  it('reports a reference to TAX_TABLES as an ERROR, not a warning', async () => {
    const messages = await lint(
      "import { TAX_TABLES } from '../tax/acquisition-tax';\nexport const illegal = TAX_TABLES;\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /TAX_TABLES/.test(m.message));
    expect(hit, `expected a no-restricted-syntax hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  });

  it('does not flag the same source when the path is on the allowlist', async () => {
    // Pins that the allowlist actually suppresses the rule, not merely that
    // the rule fires elsewhere — the same synthetic source that trips the
    // rule above must lint clean under areas.ts's own path.
    const messages = await lint(
      'export function legal(x: any) { return x.total_construction_sqm; }\n',
      'src/lib/model/areas.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax');
    expect(hit, `expected no hit on the allowlisted path; got: ${JSON.stringify(messages)}`).toBeUndefined();
  });
});

describe('single-accessor guard configuration', () => {
  it('restricts direct reads of the cost-area field', () => {
    expect(CONFIG).toContain("property.name='total_construction_sqm'");
  });

  it('restricts direct reads of the acquisition-tax band table', () => {
    // Identifier, not MemberExpression: TAX_TABLES is imported by name.
    expect(CONFIG).toContain("Identifier[name='TAX_TABLES']");
  });

  it('restricts the destructured and computed spellings of the cost-area read', () => {
    // R9 fix wave. Each is a distinct AST shape the original MemberExpression
    // selector cannot match, so each needs its own selector.
    expect(CONFIG).toContain("ObjectPattern > Property[key.name='total_construction_sqm']");
    expect(CONFIG).toContain("MemberExpression[computed=true][property.value='total_construction_sqm']");
  });

  it('restricts selectBandSet, the other route to the raw band list', () => {
    expect(CONFIG).toContain("Identifier[name='selectBandSet']");
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

  it("exempts validation.ts's selectBandSet use at the call sites, never file-wide", () => {
    // R9 fix wave. validation.ts legitimately calls selectBandSet — to report
    // an unplaceable acquisition date as a ValidationIssue, never to compute
    // tax. eslint's file allowlist is all-or-nothing per rule, so putting
    // validation.ts on it would also switch off the cost-area selectors for
    // the one module most likely to grow a raw read. Two line-scoped disables
    // instead: the import and the call.
    const source = readFileSync(
      resolve(FRONTEND_ROOT, 'src/lib/model/validation.ts'), 'utf-8',
    );
    const scoped = source.match(/eslint-disable-next-line no-restricted-syntax/g) ?? [];
    expect(scoped).toHaveLength(2);
    // A file-wide `/* eslint-disable no-restricted-syntax */` would satisfy the
    // linter and defeat the guard silently.
    expect(source).not.toMatch(/eslint-disable\s+no-restricted-syntax/);
  });
});
