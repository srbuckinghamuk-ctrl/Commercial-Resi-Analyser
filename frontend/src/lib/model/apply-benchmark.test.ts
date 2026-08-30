import { describe, it, expect } from 'vitest';
import { docAB, docABWith } from './__fixtures__/elemental-benchmark-docs';
import {
  planApplication, applyBenchmark, HEADLINE_REFUSAL, NO_BENCHMARK_REFUSAL, NO_CURRENTISATION_DATE_REFUSAL,
  USER_PACKAGE_BLOCK_REASON, FIXED_PRICE_BLOCK_REASON, CONTRACT_SUM_BLOCK_REASON, baseDateRefusal,
} from './apply-benchmark';
import { runAppraisal } from './index';
import { ELEMENT_BY_CODE } from './elemental-benchmark';
import type { CalculatorInputsV17 } from './finance-types';

const NOW = '2026-08-30T10:00:00.000Z';
const ACTOR = 'Test actor';

function withQs(doc: CalculatorInputsV17, patch: Partial<NonNullable<CalculatorInputsV17['cost_plan']['qs']>> | null): CalculatorInputsV17 {
  return {
    ...doc,
    cost_plan: { ...doc.cost_plan, qs: patch == null ? null : { ...doc.cost_plan.qs!, ...patch } },
  };
}

describe('planApplication — refusals (spec §27.3 seam, decision 3)', () => {
  it('refuses when there is no benchmark block', () => {
    const doc = { ...docAB(), elemental_benchmark: null };
    expect(planApplication(doc, ['kitchens'], ACTOR, NOW).refusal).toBe(NO_BENCHMARK_REFUSAL);
  });

  it('refuses headline mode with the stated sentence', () => {
    const doc = docAB();
    const headline = { ...doc, cost_plan: { ...doc.cost_plan, mode: 'headline' as const } };
    expect(planApplication(headline, ['kitchens'], ACTOR, NOW).refusal).toBe(HEADLINE_REFUSAL);
  });

  it('refuses when the set has no currentisation date', () => {
    const doc = docABWith((b) => { b.set.currentisation_date = null; });
    expect(planApplication(withQs(doc, null), ['kitchens'], ACTOR, NOW).refusal).toBe(NO_CURRENTISATION_DATE_REFUSAL);
  });

  it("refuses a QS base date that is the set's base date (2025-06-01), not the currentisation date", () => {
    const doc = withQs(docAB(), { base_date: '2025-06-01' });
    const plan = planApplication(doc, ['kitchens'], ACTOR, NOW);
    expect(plan.refusal).toBe(baseDateRefusal('2025-06-01', '2026-06-01'));
    expect(plan.refusal).toContain('differs from the benchmark currentisation date 2026-06-01');
    expect(plan.seam.aligned).toBe(false);
    expect(() => applyBenchmark(doc, plan)).toThrow(/differs from the benchmark currentisation date/);
  });

  it('treats a blank base date as absent (aligned) rather than as a mismatch', () => {
    const doc = withQs(docAB(), { base_date: '  ' });
    const plan = planApplication(doc, ['kitchens'], ACTOR, NOW);
    expect(plan.refusal).toBeNull();
    expect(plan.seam).toEqual({ qs_base_date: null, currentisation_date: '2026-06-01', aligned: true, will_seed_qs: false });
    // The blank is filled so the seam holds; the rest of the record is kept.
    const applied = applyBenchmark(doc, plan);
    expect(applied.cost_plan.qs).toEqual({ ...doc.cost_plan.qs, base_date: '2026-06-01' });
  });
});

describe('planApplication — creates, replaces, blocked (decision 4)', () => {
  it('re-applying kitchens replaces its own benchmark-derived package (the duplicate guard)', () => {
    const plan = planApplication(docAB(), ['kitchens'], ACTOR, NOW);
    expect(plan.refusal).toBeNull();
    expect(plan.creates).toEqual([]);
    expect(plan.replaces).toEqual([{
      element_code: 'kitchens', package_id: 'pkg-bm-kitchens', old_amount_pence: 3_192_000, new_amount_pence: 3_192_000,
    }]);
    expect(plan.blocked).toEqual([]);
  });

  it('a fresh element creates a draft package coded by the catalogue and lists the user target as blocked', () => {
    const plan = planApplication(docAB(), ['external_works'], ACTOR, NOW);
    expect(plan.refusal).toBeNull();
    // 5,000,000 lump sum x currentisation 126/120 x location 0.95
    expect(plan.creates).toEqual([{
      element_code: 'external_works', label: 'External works (benchmark)', amount_pence: 4_987_500,
      package_code: ELEMENT_BY_CODE.get('external_works')!.default_package,
    }]);
    expect(plan.replaces).toEqual([]);
    expect(plan.blocked).toEqual([{ element_code: 'external_works', package_id: 'pkg-externals', reason: USER_PACKAGE_BLOCK_REASON }]);
  });

  it('a fixed-price target blocks the element entirely (no create)', () => {
    const plan = planApplication(docAB(), ['strip_out'], ACTOR, NOW);
    expect(plan.creates).toEqual([]);
    expect(plan.blocked).toEqual([{ element_code: 'strip_out', package_id: 'pkg-enabling', reason: FIXED_PRICE_BLOCK_REASON }]);
    const applied = applyBenchmark(docAB(), plan);
    expect(applied.cost_plan.packages).toHaveLength(6);
    expect(applied.elemental_benchmark!.applications).toHaveLength(1);
  });

  it('a contract-sum plan blocks every element', () => {
    const doc = withQs(docAB(), { stage: 'contract_sum' });
    const plan = planApplication(doc, ['kitchens', 'external_works'], ACTOR, NOW);
    expect(plan.refusal).toBeNull();
    expect(plan.creates).toEqual([]);
    expect(plan.replaces).toEqual([]);
    expect(plan.blocked.map((b) => b.reason)).toEqual([CONTRACT_SUM_BLOCK_REASON, CONTRACT_SUM_BLOCK_REASON]);
    expect(applyBenchmark(doc, plan)).toBe(doc);
  });
});

describe('applyBenchmark', () => {
  it('creates the package with origin, estimate basis, notes and the catalogue code; never mutates the input', () => {
    const doc = docAB();
    const snapshot = JSON.stringify(doc);
    const plan = planApplication(doc, ['external_works'], ACTOR, NOW);
    const applied = applyBenchmark(doc, plan);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(applied).not.toBe(doc);
    expect(applied.cost_plan.packages).toHaveLength(7);
    const created = applied.cost_plan.packages[6];
    expect(created).toMatchObject({
      code: 'externals', label: 'External works (benchmark)', amount_pence: 4_987_500,
      contingency_class: 'general', lender_eligible: true, vat_override: null, phase_id: null, price_basis: 'estimate',
      notes: 'Created by the benchmark apply action from AB — elemental benchmark, TEST FIXTURE — NOT MARKET DATA (TEST-1)',
      benchmark_origin: {
        kind: 'benchmark', set_id: 'set-ab', set_content_hash: doc.elemental_benchmark!.set.content_hash,
        benchmark_rate_id: 'r-ext', element_code: 'external_works', applied_at: NOW, applied_by: ACTOR,
        currentisation_method: 'index_ratio',
      },
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    const app = applied.elemental_benchmark!.applications.at(-1)!;
    expect(app).toMatchObject({
      applied_at: NOW, applied_by: ACTOR, set_id: 'set-ab', element_codes: ['external_works'],
      created_package_ids: [created.id], replaced_package_ids: [],
    });
    // previous_cost_plan is the plan BEFORE this call, byte-equal, and not the same object.
    expect(JSON.stringify(app.previous_cost_plan)).toBe(JSON.stringify(doc.cost_plan));
    expect(app.previous_cost_plan).not.toBe(doc.cost_plan);
    // The existing packages are untouched (the user target is never edited).
    expect(applied.cost_plan.packages.slice(0, 6)).toEqual(doc.cost_plan.packages);
  });

  it('re-apply does not duplicate: the package count is unchanged and the origin is refreshed', () => {
    const doc = docAB();
    const once = applyBenchmark(doc, planApplication(doc, ['kitchens'], ACTOR, NOW));
    expect(once.cost_plan.packages).toHaveLength(6);
    const twice = applyBenchmark(once, planApplication(once, ['kitchens'], ACTOR, '2026-09-01T00:00:00.000Z'));
    expect(twice.cost_plan.packages).toHaveLength(6);
    const k = twice.cost_plan.packages.find((p) => p.id === 'pkg-bm-kitchens')!;
    expect(k.amount_pence).toBe(3_192_000);
    expect(k.benchmark_origin).toMatchObject({ element_code: 'kitchens', applied_at: '2026-09-01T00:00:00.000Z', applied_by: ACTOR });
    expect(twice.elemental_benchmark!.applications).toHaveLength(3);
    expect(twice.elemental_benchmark!.applications[2].replaced_package_ids).toEqual(['pkg-bm-kitchens']);
    // A fresh element applied twice also stays single.
    const e1 = applyBenchmark(doc, planApplication(doc, ['external_works'], ACTOR, NOW));
    const e2 = applyBenchmark(e1, planApplication(e1, ['external_works'], ACTOR, NOW));
    expect(e2.cost_plan.packages).toHaveLength(7);
    expect(e2.cost_plan.packages.filter((p) => p.benchmark_origin?.element_code === 'external_works')).toHaveLength(1);
  });

  it('seeds qs from the currentisation date when the plan has none', () => {
    const doc = withQs(docAB(), null);
    const plan = planApplication(doc, ['external_works'], ACTOR, NOW);
    expect(plan.seam).toEqual({ qs_base_date: null, currentisation_date: '2026-06-01', aligned: true, will_seed_qs: true });
    const applied = applyBenchmark(doc, plan);
    expect(applied.cost_plan.qs).toEqual({
      source: 'Benchmark-derived (AB — elemental benchmark, TEST FIXTURE — NOT MARKET DATA)',
      stage: 'order_of_cost', date: '2026-08-30', status: 'draft', base_date: '2026-06-01', inflation: null,
    });
  });

  it('single-forward-step guard: the applied package inflates from the currentisation date by §24.3 alone', () => {
    const doc = docAB();
    const applied = applyBenchmark(doc, planApplication(doc, ['external_works', 'kitchens'], ACTOR, NOW));
    const run = runAppraisal(applied);
    const lines = run.metrics.cost_plan.packages;
    const created = lines.find((p) => p.benchmark_origin?.element_code === 'external_works')!;
    // Base 2026-06-01 (= currentisation date) to acquisition month 0 is 2
    // months; an unphased package's midpoint sits at 10.5; 6% p.a.
    expect(created.months_from_base).toBe(12.5);
    const expected = Math.round(4_987_500 * (Math.pow(1.06, (2 + 10.5) / 12) - 1));
    expect(created.inflation_pence).toBe(expected);
    expect(created.amount_pence).toBe(4_987_500);
    // The benchmark row itself is unchanged by the apply: the amount is the
    // currentised figure and forward inflation is a disclosure only.
    const row = run.metrics.elemental_benchmark!.rows.find((r) => r.element_code === 'external_works')!;
    expect(row.benchmark_amount_pence).toBe(4_987_500);
    // Seeding the set's base date instead is refused, so the engine can never
    // inflate a currentised amount from 2025-06-01.
    const wrong = withQs(applied, { base_date: '2025-06-01' });
    expect(planApplication(wrong, ['external_works'], ACTOR, NOW).refusal).toBe(baseDateRefusal('2025-06-01', '2026-06-01'));
  });
});
