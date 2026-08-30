import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAppraisal } from '../../lib/model';
import { defaultCalculatorInputsV17 } from '../../lib/conversion-defaults';
import { PAGES } from './pages';
import { PAGE_OWNERSHIP, fieldRoot, pageStatus } from './page-status';

describe('page ownership (spec §26.5)', () => {
  const src = readFileSync(resolve(__dirname, '../../lib/model/validation.ts'), 'utf-8');

  it('every root validation.ts can emit is owned by exactly one page', () => {
    // Review finding (fix round 2): a call site can pass a COMPUTED field, not
    // a literal -- e.g. `err(field, 'Monetary values cannot be negative.')` in
    // the NON_NEGATIVE_MONEY loop. Harvest 1 alone (below) contributes nothing
    // for that call, and the test used to pass only because its nine field
    // roots (acquisition x4, conversion_costs x4, exit_strategy x1) also
    // happen to appear as SOME OTHER literal err()/warn() call's first
    // argument elsewhere in the file -- coincidental redundancy, not a real
    // guarantee. Harvest 2 removes the coincidence: it reads the field-path
    // literal directly, wherever it sits in the source.
    //
    // Fix round 3 (final review, minor 4): both harvests used to capture only
    // the ROOT (`[a-z_]+`, stopping at the first `.`/`[`), and the exclusion
    // list below matched by that same bare root. That meant a future real
    // validation field whose root happened to be `sensitivity`, `run`, `qs`,
    // `seen`, `datetime`, `consideration` or `category_phase_ids` would be
    // silently absorbed into the exclusion list instead of failing the test.
    // Both harvests now capture the FULL matched literal -- the root plus one
    // more segment after the `.`/`[`, up to the next non-identifier
    // character (e.g. `sensitivity.test`, `run.validation`) -- and the
    // exclusion list is keyed by that full literal. Roots are derived from
    // the SURVIVING literals only, via `fieldRoot`.
    //
    // 1) err('literal...' / warn(`literal...`: the direct-literal-argument
    //    call sites.
    const literalCallLiterals = new Set(
      [...src.matchAll(/\b(?:err|warn)\(\s*['`]([a-z_]+(?:[.[][a-z0-9_]*)?)/g)].map((m) => m[1]),
    );

    // 2) Every path-shaped string literal in the file: single- or
    //    back-quoted, starting with a lowercase identifier immediately
    //    followed by `.` or `[`. This catches NON_NEGATIVE_MONEY's array
    //    entries (`'acquisition.purchase_price_pence'`, ...) and every
    //    `field = '...'` / `field = \`...\`` template literal that feeds a
    //    dynamic err()/warn() call (e.g. `` `programme.phases.${id}` ``)
    //    directly, without needing to trace which call it eventually reaches.
    const pathLiteralMatches = [...src.matchAll(/['`]([a-z][a-z_]*[.[][a-z0-9_]*)/g)].map((m) => m[1]);

    // The wider harvest over-catches: a handful of comment/JSDoc references
    // and one wrapped-message tail also match the shape and are NOT
    // validation field roots. Each is inspected and named here, per the
    // review ruling, rather than filtered by a cleverer regex that would hide
    // a future false positive (or a future genuine field) the same way the
    // old, narrower regex hid the NON_NEGATIVE_MONEY gap. Keyed by the FULL
    // literal (not the bare root) so a future genuine field sharing one of
    // these roots under a DIFFERENT literal is not silently swallowed too.
    const NOT_FIELD_ROOTS: Record<string, string> = {
      'category_phase_ids.': 'message text quoting the `field` variable\'s VALUE ("category_phase_ids.${cat} references phase..."), truncated at the `$` of the interpolation; the field literal itself is `programme.category_phase_ids.${cat}`, already harvested under `programme`',
      'consideration.': 'the tail of a wrapped message string ("...VAT-inclusive consideration.") that happens to start with a quote immediately before "consideration." at its own line-continuation boundary',
      'datetime.date': 'JSDoc comment referencing Python\'s `datetime.date(y, m, d)`',
      'qs.inflation': 'JSDoc comment: `` `qs.inflation ?? null` non-null ``',
      'run.validation': 'JSDoc comment: `` `run.validation` (this function\'s return) ``',
      'seen.add': 'JSDoc comment: `` `seen.add(l.id)` used to run unconditionally ``',
      'sensitivity.test': 'JSDoc comment naming the test file `sensitivity.test.ts:157-171`, truncated at the second `.`',
    };
    // Pin the exclusion list itself: every named false positive must still be
    // present in the wider harvest, or the source moved and the entry is
    // stale (in which case it must be removed, not left as dead cover).
    for (const fp of Object.keys(NOT_FIELD_ROOTS)) {
      expect(pathLiteralMatches).toContain(fp);
    }

    const literals = new Set([...literalCallLiterals, ...pathLiteralMatches]);
    for (const fp of Object.keys(NOT_FIELD_ROOTS)) literals.delete(fp);
    const roots = new Set([...literals].map(fieldRoot));

    expect(roots.size).toBeGreaterThan(10); // non-vacuity: the regex matches the file
    const owners = (root: string) => PAGES.filter((p) => (PAGE_OWNERSHIP[p.key] as readonly string[]).includes(root)).map((p) => p.key);
    const problems = [...roots].map((r) => [r, owners(r)] as const).filter(([, o]) => o.length !== 1);
    expect(problems).toEqual([]);
  });

  it('pins the count of err()/warn() calls whose field is computed, not a literal', () => {
    // Every one of these resolves to a field root already reachable through
    // harvest 2 above (via its own `field = ...` literal, or NON_NEGATIVE_MONEY's
    // array literal) -- named here so a NEW dynamic call site fails this pin
    // until its root is confirmed reachable, rather than silently relying on
    // some unrelated literal call elsewhere in the file to cover it by
    // coincidence (the defect this pin exists to catch):
    //   - NON_NEGATIVE_MONEY loop (1 call; the 9 literal field paths sit in the
    //     array above it)
    //   - the v9 phase network's `phaseField(id)` -> `programme.phases.${id}`
    //     (17 calls: the phase loop's structural/dependency/user_defined-weight
    //     checks, plus the derivation loop's start/overrun/sale-tail checks)
    //   - the `category_phase_ids` loop -> `programme.category_phase_ids.${cat}`
    //     (2 calls)
    //   - the cost_plan packages/fee_lines `phase_id` tagging loop ->
    //     `cost_plan.packages[idx].phase_id` / `cost_plan.fee_lines[idx].phase_id`
    //     (4 calls)
    //   - the legacy (v4-v8) programme packages loop ->
    //     `programme.packages.${name}` (9 calls)
    //   - the sales_phasing tranches loop -> `sales_phasing.tranches[${i}]`
    //     (3 calls)
    //   - the unit_sales.units loop and its checkEvent helper ->
    //     `unit_sales.units[${i}]` (6 calls)
    //   - the scenarios loop -> `scenarios.${name}.phase_slip_phase_id` (2 calls)
    const dynamicCallCount = [...src.matchAll(/\b(?:err|warn)\(\s*[A-Za-z_]/g)].length;
    expect(dynamicCallCount).toBe(44);
  });

  it('no root is owned twice, even one validation.ts does not emit yet', () => {
    const all = PAGES.flatMap((p) => [...PAGE_OWNERSHIP[p.key]]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('fieldRoot takes the segment before the first dot or bracket', () => {
    expect(fieldRoot('acquisition.purchase_price_pence')).toBe('acquisition');
    expect(fieldRoot('equity_sources[0].amount_pence')).toBe('equity_sources');
    expect(fieldRoot('cost_plan')).toBe('cost_plan');
  });
});

describe('pageStatus', () => {
  const run = runAppraisal(defaultCalculatorInputsV17());

  it('counts owned errors per page and nothing on output pages', () => {
    const spiked = {
      ...run,
      validation: [
        { severity: 'error' as const, field: 'cost_plan.packages[0].amount_pence', message: 'x' },
        { severity: 'error' as const, field: 'conversion_costs.fire_safety_pence', message: 'x' },
        { severity: 'warning' as const, field: 'cost_plan.contingency[1].pct', message: 'not counted' },
        { severity: 'error' as const, field: 'equity_sources[0].amount_pence', message: 'x' },
      ],
    };
    const status = pageStatus(spiked);
    expect(status.conversion_costs.errors).toBe(2);
    expect(status.finance.errors).toBe(1);
    expect(status.cashflow.errors).toBe(0);
    expect(PAGES.reduce((s, p) => s + status[p.key].errors, 0)).toBe(3);
  });

  it('reports evidence on Due Diligence only, read from the engine totals', () => {
    const status = pageStatus(run);
    expect(status.risk_register.evidence).toEqual({
      assessed: run.metrics.due_diligence.totals.assessed_count,
      total: run.metrics.due_diligence.totals.entered_total,
    });
    expect(status.risk_register.evidence!.total).toBeGreaterThan(0);
    expect(PAGES.filter((p) => p.key !== 'risk_register').every((p) => status[p.key].evidence === null)).toBe(true);
  });
});
