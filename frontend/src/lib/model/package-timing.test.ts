import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computePackageTiming } from './package-timing';
import { curveWeights } from './curves';
import { migrateInputsToV13, migrateInputsToV8 } from './migrate';
import type { AnyCalculatorInputs, CalculatorInputsV8 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const raw = (stem: string) => JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${stem}.json`), 'utf-8')).inputs;
const load = (stem: string) => migrateInputsToV13(raw(stem));

describe('computePackageTiming (R15b spec §24.2)', () => {
  it('network: a tagged package takes its phase window; an untagged one the category default (fixture S)', () => {
    const t = computePackageTiming(load('s-dated-programme'));
    const byId = Object.fromEntries(t.map((x) => [x.id, x]));
    expect(byId['pkg-enabling']).toMatchObject({ phase_id: 'strip_out', start_month: 6, finish_month: 8, duration_months: 2, midpoint_month: 6.5 });
    expect(byId['pkg-structure']).toMatchObject({ phase_id: 'construction', start_month: 8, finish_month: 14 });
    // Not a plain toMatchObject on midpoint_month: with equal 1/6 weights summed
    // ascending (s + w × (start + k), spec §24.2's fixed order — ties the TS and
    // Python doubles bit-for-bit), the accumulated 1/6 rounding error lands one ULP
    // below the mathematically-exact 10.5, exactly as curves.py's module docstring
    // describes for this class of float divergence.
    expect(byId['pkg-structure'].midpoint_month).toBeCloseTo(10.5, 10);
    expect(byId['pkg-structure'].weights).toEqual([1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]);
  });

  it("the midpoint is curve-aware: a back_loaded 3-month phase from month 11 gives 74/6, not 12", () => {
    const doc = load('s-dated-programme');
    doc.programme!.phases.push({
      id: 'mande_fitout', code: 'other', label: 'M&E fit-out', duration_months: 3, slip_months: 0, start_offset: 0,
      curve: { kind: 'back_loaded' }, predecessors: [{ phase_id: 'construction', type: 'SS', lag_months: 3 }],
    });
    doc.cost_plan.packages.find((p) => p.id === 'pkg-mande')!.phase_id = 'mande_fitout';
    const m = computePackageTiming(doc).find((x) => x.id === 'pkg-mande')!;
    expect(m).toMatchObject({ phase_id: 'mande_fitout', start_month: 11, finish_month: 14 });
    expect(m.midpoint_month).toBeCloseTo(74 / 6, 10);
    expect(m.midpoint_month).not.toBe(12);
  });

  it("auto path: every package shares §6's construction window, months 1..term-2 (fixture Q, term from the document)", () => {
    const doc = load('q-detailed-cost-plan');
    const term = Math.max(1, Math.floor(doc.finance.term_months));
    const t = computePackageTiming(doc);
    expect(t).toHaveLength(doc.cost_plan.packages.length);
    for (const x of t) expect(x).toMatchObject({ phase_id: null, start_month: 1, finish_month: 1 + Math.max(1, term - 2) });
    expect(new Set(t.map((x) => x.midpoint_month)).size).toBe(1);
  });

  it('auto path, term 1: month 0, one month', () => {
    const doc = load('q-detailed-cost-plan');
    doc.finance.term_months = 1;
    expect(computePackageTiming(doc)[0]).toMatchObject({ start_month: 0, finish_month: 1, midpoint_month: 0 });
  });

  it('legacy three-package arm (raw v8 shape, unreachable from a stored document): the construction package window', () => {
    // Built by hand: a raw v8-shaped document (Q's cost plan, migrated to v8, then
    // given the legacy `programme.packages` shape a v9 migration would have deleted)
    // with programme.packages.construction { start_offset: 2, duration_months: 4, curve: s_curve }.
    const base = migrateInputsToV8(raw('q-detailed-cost-plan'));
    const doc: CalculatorInputsV8 = {
      ...base,
      programme: {
        anchor_month: null,
        packages: {
          construction: { start_offset: 2, duration_months: 4, curve: { kind: 's_curve' } },
          professional: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' } },
          statutory: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' } },
        },
      },
    };
    const t = computePackageTiming(doc);
    expect(t.length).toBe(doc.cost_plan.packages.length);
    expect(t.length).toBeGreaterThan(0);
    const w = curveWeights(4, { kind: 's_curve' });
    const expectedMidpoint = w.reduce((s, wk, k) => s + wk * (2 + k), 0);
    for (const x of t) {
      expect(x).toMatchObject({
        phase_id: null, start_month: 2, finish_month: 6, duration_months: 4, curve: { kind: 's_curve' },
      });
      expect(x.midpoint_month).toBeCloseTo(expectedMidpoint, 10);
    }
  });

  it('no cost_plan → []; headline mode with no packages → []', () => {
    // a-all-cash carries no `cost_plan` key at all (pre-v7, unmigrated).
    const noCostPlan = raw('a-all-cash') as AnyCalculatorInputs;
    expect(computePackageTiming(noCostPlan)).toEqual([]);
    // t-investment-case is headline mode: cost_plan exists but packages is empty.
    expect(computePackageTiming(load('t-investment-case'))).toEqual([]);
  });
});
