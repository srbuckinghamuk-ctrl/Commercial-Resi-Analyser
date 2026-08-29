import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAppraisal } from '../../lib/model';
import { defaultCalculatorInputsV16 } from '../../lib/conversion-defaults';
import { PAGES } from './pages';
import { PAGE_OWNERSHIP, fieldRoot, pageStatus } from './page-status';

describe('page ownership (spec §26.5)', () => {
  it('every root validation.ts can emit is owned by exactly one page', () => {
    const src = readFileSync(resolve(__dirname, '../../lib/model/validation.ts'), 'utf-8');
    // err('acquisition.x', ...) / warn(`cost_plan.packages[${i}]...`, ...): the
    // root is the leading identifier of the first argument, whichever quote.
    const roots = new Set([...src.matchAll(/\b(?:err|warn)\(\s*['`]([a-z_]+)/g)].map((m) => m[1]));
    expect(roots.size).toBeGreaterThan(10); // non-vacuity: the regex matches the file
    const owners = (root: string) => PAGES.filter((p) => (PAGE_OWNERSHIP[p.key] as readonly string[]).includes(root)).map((p) => p.key);
    const problems = [...roots].map((r) => [r, owners(r)] as const).filter(([, o]) => o.length !== 1);
    expect(problems).toEqual([]);
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
  const run = runAppraisal(defaultCalculatorInputsV16());

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
