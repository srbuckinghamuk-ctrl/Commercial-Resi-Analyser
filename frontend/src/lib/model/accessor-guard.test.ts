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

/** The `files` array of the allowlist block — the LAST `files: [...]` before the
 *  block that switches `no-restricted-syntax` off. Parsed rather than asserted
 *  as a substring so the test can pin the array's EXACT contents (R10: a
 *  `toContain`-only assertion cannot see a widening). */
function allowlistFiles(): string[] {
  const marker = "rules: { 'no-restricted-syntax': 'off' }";
  const off = CONFIG.indexOf(marker);
  expect(off, 'no allowlist block found in eslint.config.js').toBeGreaterThan(-1);
  const before = CONFIG.slice(0, off);
  const start = before.lastIndexOf('files: [');
  expect(start, 'no files array found in the allowlist block').toBeGreaterThan(-1);
  const end = before.indexOf(']', start);
  const body = before.slice(start + 'files: ['.length, end);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: FRONTEND_ROOT, overrideConfigFile: CONFIG_PATH });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

// R11 "also in scope". Every test below spawns a brand-new ESLint instance
// (`new ESLint(...)` in `lint()` above) and runs its Node API in-process --
// there is no shared/cached instance, so each of the 24 real-linter tests
// independently pays ESLint's config resolution and TypeScript-parser
// start-up cost. That cost is fine in isolation (2-3s) but is load-sensitive:
// under the full suite's parallel workers this has timed out intermittently
// against vitest's 30s global `testTimeout` (observed three times in R11
// alone, and in each of the two releases before it), never against a
// standalone run of this file. An explicit, longer per-test timeout is given
// to every real-linter test rather than picking one, because the flake has
// never been the same test twice -- whichever instantiation lands under the
// load spike is the one that times out.
const REAL_LINTER_TIMEOUT_MS = 60_000;

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
  }, REAL_LINTER_TIMEOUT_MS);

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
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a COMPUTED read of total_construction_sqm as an ERROR', async () => {
    const messages = await lint(
      "export function illegal(costs: Record<string, number>) { return costs['total_construction_sqm']; }\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /computed member access/.test(m.message));
    expect(hit, `expected a computed-access hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

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
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a reference to selectBandSet as an ERROR', async () => {
    const messages = await lint(
      "import { selectBandSet } from '../tax/acquisition-tax';\n"
      + "export const bands = selectBandSet('england_ni', 'non_residential', null).set;\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /selectBandSet/.test(m.message));
    expect(hit, `expected a selectBandSet hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a reference to TAX_TABLES as an ERROR, not a warning', async () => {
    const messages = await lint(
      "import { TAX_TABLES } from '../tax/acquisition-tax';\nexport const illegal = TAX_TABLES;\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /TAX_TABLES/.test(m.message));
    expect(hit, `expected a no-restricted-syntax hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

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
  }, REAL_LINTER_TIMEOUT_MS);

  // R10 Task 9 — the same three read shapes, applied to contingency_pct, now
  // that cost_plan supersedes it (spec §16).
  it('reports a direct read of contingency_pct as an ERROR, not a warning', async () => {
    const messages = await lint(
      'export function illegal(x: any) { return x.contingency_pct; }\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /contingency_pct/.test(m.message));
    expect(hit, `expected a no-restricted-syntax hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a DESTRUCTURED read of contingency_pct as an ERROR', async () => {
    const messages = await lint(
      'export function illegal(costs: { contingency_pct: number }) {\n'
      + '  const { contingency_pct } = costs;\n'
      + '  return contingency_pct;\n'
      + '}\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /destructure/.test(m.message));
    expect(hit, `expected a destructuring hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a COMPUTED read of contingency_pct as an ERROR', async () => {
    const messages = await lint(
      "export function illegal(costs: Record<string, number>) { return costs['contingency_pct']; }\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /computed member access/.test(m.message));
    expect(hit, `expected a computed-access hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('does NOT flag an object-literal write of contingency_pct', async () => {
    // The counter-example the destructuring selector needs, mirroring the
    // total_construction_sqm write test above. `updateCosts({ contingency_pct: v })`
    // is an ObjectExpression property — a write — and the rule has never
    // restricted writes.
    const messages = await lint(
      'export const write = (v: number) => ({ contingency_pct: v });\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toEqual([]);
  }, REAL_LINTER_TIMEOUT_MS);

  it('does not flag a contingency_pct read on the allowlisted cost-plan.ts path', async () => {
    const messages = await lint(
      'export function legal(x: any) { return x.contingency_pct; }\n',
      'src/lib/model/cost-plan.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax');
    expect(hit, `expected no hit on the allowlisted path; got: ${JSON.stringify(messages)}`).toBeUndefined();
  }, REAL_LINTER_TIMEOUT_MS);
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

  it('restricts direct reads of contingency_pct (R10 spec §16)', () => {
    expect(CONFIG).toContain("property.name='contingency_pct'");
  });

  it('restricts the destructured and computed spellings of the contingency_pct read', () => {
    // Same reasoning as the cost-area trio above, applied to R10's field.
    expect(CONFIG).toContain("ObjectPattern > Property[key.name='contingency_pct']");
    expect(CONFIG).toContain("MemberExpression[computed=true][property.value='contingency_pct']");
  });

  it('restricts all three read shapes of vat.treatments and vat_override (R11 spec 17.2)', () => {
    // Same reasoning as the cost-area and contingency trios above, applied to
    // R11's two fields. Each shape is a distinct AST node the others cannot see.
    expect(CONFIG).toContain("MemberExpression[property.name='treatments']");
    expect(CONFIG).toContain("ObjectPattern > Property[key.name='treatments']");
    expect(CONFIG).toContain("MemberExpression[computed=true][property.value='treatments']");
    expect(CONFIG).toContain("MemberExpression[property.name='vat_override']");
    expect(CONFIG).toContain("ObjectPattern > Property[key.name='vat_override']");
    expect(CONFIG).toContain("MemberExpression[computed=true][property.value='vat_override']");
  });

  it('restricts asChargeableConsideration as an Identifier, not a MemberExpression (R11 spec 17.7)', () => {
    // The R9 defect, written down so it cannot ship again: the escape hatch is
    // a bare imported function name, so a MemberExpression selector against it
    // lints clean and never fires. Identifier is the verified-correct shape --
    // the same one TAX_TABLES and selectBandSet use.
    expect(CONFIG).toContain("Identifier[name='asChargeableConsideration']");
    expect(CONFIG).not.toContain("MemberExpression[property.name='asChargeableConsideration']");
  });

  it('pins the allowlist array to EXACTLY these files (R11 spec 17.2 rule 2)', () => {
    // R10 found that widening this array un-guarded three unrelated fields, and
    // the guard's own test pinned the hole. `toContain` cannot catch a widening;
    // exact equality can. A future task adding a file must change this list
    // deliberately, and say why in the config comment above it.
    expect(allowlistFiles()).toEqual([
      'src/lib/model/areas.ts',
      'src/lib/tax/acquisition-tax.ts',
      'src/lib/model/cost-plan.ts',
      'src/lib/model/vat.ts',
      'src/lib/conversion-types.ts',
      'src/lib/model/finance-types.ts',
      'src/lib/model/migrate.ts',
      'src/lib/conversion-defaults.ts',
      'src/lib/report-qa/memo-fixtures.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ]);
  });

  it('keeps the allowlist to the modules that own, declare, write or build fixtures for the values', () => {
    for (const allowed of [
      'src/lib/model/areas.ts',
      'src/lib/tax/acquisition-tax.ts',
      'src/lib/model/cost-plan.ts',
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

  it("exempts validation.ts's selectBandSet use and its contingency_pct check at the call sites, never file-wide", () => {
    // R9 fix wave. validation.ts legitimately calls selectBandSet — to report
    // an unplaceable acquisition date as a ValidationIssue, never to compute
    // tax. eslint's file allowlist is all-or-nothing per rule, so putting
    // validation.ts on it would also switch off the cost-area selectors for
    // the one module most likely to grow a raw read. Two line-scoped disables
    // for that (the import and the call), plus a third (R10 Task 9) for the
    // raw contingency_pct negative-value check, which is real user input
    // until Task 12 rebuilds the cost page around cost_plan.
    //
    // R11 Task 9 adds three more, for the VAT §17.9 validation block: one
    // structural read of `vat.treatments` (shape/bounds checks only — never
    // resolves a charge, so it does not re-implement resolveVatTreatment's
    // override-over-category precedence), reused by every check in that
    // block, and one per `vat_override` extraction (one for packages, one for
    // fee lines) — each read into a local exactly once and worked with from
    // there, rather than re-reading `.vat_override` at every call site.
    const source = readFileSync(
      resolve(FRONTEND_ROOT, 'src/lib/model/validation.ts'), 'utf-8',
    );
    const scoped = source.match(/eslint-disable-next-line no-restricted-syntax/g) ?? [];
    expect(scoped).toHaveLength(6);
    // A file-wide `/* eslint-disable no-restricted-syntax */` would satisfy the
    // linter and defeat the guard silently.
    expect(source).not.toMatch(/eslint-disable\s+no-restricted-syntax/);
  });

  it('does not exempt ConversionCostsPage.tsx file-wide (R10 Task 9/12)', () => {
    // Before R10 this file was on the blanket allowlist for its one
    // legitimate total_construction_sqm read. A file-wide exemption would now
    // also hide its (then-illegitimate, pending Task 12) contingency_pct read,
    // so R10 Task 9 took the file OFF the allowlist and exempted both reads at
    // their own lines instead — the legitimate one permanently, the
    // contingency_pct one with a "Task 12 replaces this" reason. Task 12
    // rebuilt the page around run.metrics.cost_plan.contingency, so the
    // contingency_pct read (and its disable comment) is gone entirely; only
    // the one permanent total_construction_sqm exemption remained until R11.
    //
    // R11 Task 14 (spec §17.2 rule 3) adds two more: the per-line VAT override
    // control's own read of `pkg.vat_override` and `fee.vat_override`, to
    // populate the editor with the row's current value. Neither compares the
    // override against the category row to decide which figure is charged —
    // that decision stays resolveVatTreatment's alone — so each is a legitimate
    // write-side read, exempted at its own call site rather than file-wide,
    // exactly like the total_construction_sqm exemption above it.
    expect(CONFIG).not.toContain('src/components/calculator/ConversionCostsPage.tsx');
    const source = readFileSync(
      resolve(FRONTEND_ROOT, 'src/components/calculator/ConversionCostsPage.tsx'), 'utf-8',
    );
    const scoped = source.match(/eslint-disable-next-line no-restricted-syntax/g) ?? [];
    expect(scoped).toHaveLength(3);
    expect(source).not.toMatch(/eslint-disable\s+no-restricted-syntax/);
    expect(source).not.toMatch(/\.contingency_pct\b/);
  });

  it('does not exempt conversion-calc-engine.ts file-wide (R10 Task 9 fix round 1, C1)', () => {
    // A file-wide exemption for calculateTotalConstructionCost's one
    // legitimate contingency_pct read would also have un-guarded
    // total_construction_sqm, TAX_TABLES and selectBandSet in this file —
    // which also holds calculateTotalAcquisitionCost, R8's first defect site.
    // One line-scoped disable instead.
    expect(CONFIG).not.toContain('src/lib/conversion-calc-engine.ts');
    const source = readFileSync(
      resolve(FRONTEND_ROOT, 'src/lib/conversion-calc-engine.ts'), 'utf-8',
    );
    const scoped = source.match(/eslint-disable-next-line no-restricted-syntax/g) ?? [];
    expect(scoped).toHaveLength(1);
    expect(source).not.toMatch(/eslint-disable\s+no-restricted-syntax/);
  });

  // R11 Task 7 (spec 17.2 rule 2) -- the VAT block's single accessor. The same
  // three read shapes again, for `vat.treatments` and for `vat_override`, each
  // asserted through the REAL linter at severity 2.
  it('reports a direct read of vat.treatments as an ERROR, not a warning', async () => {
    const messages = await lint(
      'export function illegal(vat: any) { return vat.treatments; }\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /vat\.treatments directly/.test(m.message));
    expect(hit, `expected a vat.treatments hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
    expect(hit!.message).toMatch(/resolveVatTreatment\(\)/);
    expect(hit!.message).toMatch(/17\.2/);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a DESTRUCTURED read of vat.treatments as an ERROR', async () => {
    const messages = await lint(
      'export function illegal(vat: { treatments: unknown[] }) {\n'
      + '  const { treatments } = vat;\n'
      + '  return treatments;\n'
      + '}\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /destructure treatments/.test(m.message));
    expect(hit, `expected a destructuring hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a COMPUTED read of vat.treatments as an ERROR', async () => {
    const messages = await lint(
      "export function illegal(vat: Record<string, unknown>) { return vat['treatments']; }\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /treatments through a computed/.test(m.message));
    expect(hit, `expected a computed-access hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('does NOT flag an object-literal write of treatments', async () => {
    // The counter-example the destructuring selector needs. `defaultVatTreatments()`
    // output and the migration both WRITE this key; the rule has never
    // restricted writes, and scoping to ObjectPattern is what keeps that true.
    const messages = await lint(
      'export const write = (v: unknown[]) => ({ treatments: v });\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toEqual([]);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a direct read of a vat_override as an ERROR, not a warning', async () => {
    const messages = await lint(
      'export function illegal(p: any) { return p.vat_override; }\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /vat_override directly/.test(m.message));
    expect(hit, `expected a vat_override hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
    expect(hit!.message).toMatch(/resolveVatTreatment\(\)/);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a DESTRUCTURED read of a vat_override as an ERROR', async () => {
    const messages = await lint(
      'export function illegal(p: { vat_override: unknown }) {\n'
      + '  const { vat_override } = p;\n'
      + '  return vat_override;\n'
      + '}\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /destructure vat_override/.test(m.message));
    expect(hit, `expected a destructuring hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('reports a COMPUTED read of a vat_override as an ERROR', async () => {
    const messages = await lint(
      "export function illegal(p: Record<string, unknown>) { return p['vat_override']; }\n",
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /vat_override through a computed/.test(m.message));
    expect(hit, `expected a computed-access hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);

  it('does NOT flag an object-literal write of vat_override', async () => {
    // cost-plan.ts's defaults and ConversionCostsPage.tsx's package editor both
    // write `vat_override: null`. Writes are not reads.
    const messages = await lint(
      'export const write = () => ({ vat_override: null });\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-syntax')).toEqual([]);
  }, REAL_LINTER_TIMEOUT_MS);

  it('does not flag a vat.treatments read on the allowlisted vat.ts path', async () => {
    const messages = await lint(
      'export function legal(vat: any) { return vat.treatments; }\n',
      'src/lib/model/vat.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax');
    expect(hit, `expected no hit on the allowlisted path; got: ${JSON.stringify(messages)}`).toBeUndefined();
  }, REAL_LINTER_TIMEOUT_MS);

  // R11 Task 7 (spec 17.7) -- the brand's escape hatch.
  it('reports a reference to asChargeableConsideration as an ERROR, not a warning', async () => {
    const messages = await lint(
      "import { asChargeableConsideration } from '../tax/acquisition-tax';\n"
      + 'export const illegal = (n: number) => asChargeableConsideration(n);\n',
      'src/lib/model/__synthetic-consumer.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /asChargeableConsideration/.test(m.message));
    expect(hit, `expected an asChargeableConsideration hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
    expect(hit!.message).toMatch(/chargeableConsiderationPence\(inputs\)/);
    expect(hit!.message).toMatch(/17\.7/);
  }, REAL_LINTER_TIMEOUT_MS);

  it('does not flag asChargeableConsideration on the two paths that own the brand', async () => {
    for (const owner of ['src/lib/tax/acquisition-tax.ts', 'src/lib/model/vat.ts']) {
      const messages = await lint(
        "import { asChargeableConsideration } from '../tax/acquisition-tax';\n"
        + 'export const legal = (n: number) => asChargeableConsideration(n);\n',
        owner,
      );
      const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax');
      expect(hit, `expected no hit on ${owner}; got: ${JSON.stringify(messages)}`).toBeUndefined();
    }
  }, REAL_LINTER_TIMEOUT_MS);

  it('the guard now bites a planted total_construction_sqm read in conversion-calc-engine.ts (C1 restoration proof)', async () => {
    // Before the fix, this file was on the file-wide allowlist, so this same
    // read would have linted clean. Proves the guard is actually restored,
    // not merely that the allowlist entry text is gone.
    const messages = await lint(
      'export function illegal(x: any) { return x.total_construction_sqm; }\n',
      'src/lib/conversion-calc-engine.ts',
    );
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax' && /total_construction_sqm/.test(m.message));
    expect(hit, `expected a no-restricted-syntax hit; got: ${JSON.stringify(messages)}`).toBeDefined();
    expect(hit!.severity).toBe(2);
  }, REAL_LINTER_TIMEOUT_MS);
});
