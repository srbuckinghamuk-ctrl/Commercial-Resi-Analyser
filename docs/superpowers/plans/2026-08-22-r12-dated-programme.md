# R12 — Dated, dependent programme: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three independent programme windows with a precedence network whose derived dates drive the ledger, so a single slip propagates through cost, receipts, interest and peak debt.

**Architecture:** A new `programme` module in each engine derives every phase's start from a topological pass over `predecessors`, then computes total float and the critical path with a backward pass. `buildSchedule` stops reading three fixed windows and instead resolves each cost line to a phase (`line.phase_id ?? category_phase_ids[line.category]`) and spreads it over that phase's derived window. Sale tranches and refinance may anchor to a phase. A fifth sensitivity lever, `phase_slip`, writes a signed `slip_months` through `applyScenario`, which stays the single point at which an inputs document is adjusted.

**Tech Stack:** TypeScript (Vitest) in `frontend/src/lib/model/`; Python 3 + Pydantic v2 (pytest) in `app/financial_model/`. The two engines mirror each other function-for-function; no calculation logic lives in React components or report generators.

**Spec:** `docs/superpowers/specs/2026-08-22-r12-dated-programme-design.md` — read it before Task 1 and keep it open. Every task below cites the §18.x it implements. Where this plan and the spec disagree, the spec wins and the plan is the defect.

## Global Constraints

- **Versions:** `CALC_VERSION` `'2.10.0'` → `'2.11.0'` in **both** `frontend/src/lib/model/finance-types.ts:515` and `app/financial_model/types.py:759`. Inputs `v8` → `v9`.
- **Money is integer pence.** Every spread rounds half-up per month; the final month of a window absorbs the cumulative residue so `Σ = total`. Never introduce a float pence value.
- **Both engines mirror.** Every rule added to `validation.ts` is added to `validation.py` with the **same field string and the same message text**. Every derivation added to `programme.ts` is added to `programme.py`.
- **No silent clamping.** A programme that does not fit is a hard `ValidationIssue` with `severity: 'error'`, never a value quietly moved into range. The existing defensive clamps in `schedule.ts:87-92` and `schedule.py:289-296` stay, and stay unreachable for any document that passes validation.
- **No calculation logic in React or in `export-investment-memo.ts`.** Those read the result block only.
- **Migration adds only written `null`/`0`.** Five additions (§18.7): `phase_id` on cost lines is *not* written; `anchor: null`, `phase_slip_phase_id: null`, `phase_slip_months: 0`, the three-phase network, `category_phase_ids`.
- **EOL discipline.** Before every commit that rewrites a file wholesale, run `git ls-files --eol <path>` and confirm `i/lf`. R11 shipped a test file as a binary blob that no suite could see.
- **Gate set, run before any merge:** `npx vitest run`, `pytest`, `npx tsc -b`, `npm run lint -- --max-warnings 0`, `npm run build`. Baselines to beat: **pytest 1607**, **vitest 1942**.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `frontend/src/lib/model/programme.ts` | Network types, topological order, cycle detection, start/finish derivation, float, critical path. Pure — knows nothing about money. |
| `frontend/src/lib/model/programme.test.ts` | Derivation and float unit tests. |
| `app/financial_model/programme.py` | Python mirror of the above. |
| `tests/test_financial_model_programme.py` | Python mirror of the tests. |
| `tests/test_migrate_v9.py` | v8 → v9 migration, both identity gates, the alias-map bound. |
| `fixtures/financial-model/s-dated-programme.json` | Fourteen-phase network, non-zero-float phase, anchored two-tranche sale, detailed cost plan with per-line overrides, levered facility. |
| `frontend/src/components/calculator/PhaseEditor.tsx` | Phase list editing: add/remove/reorder, duration, slip, predecessors. |
| `frontend/src/components/calculator/ProgrammeGantt.tsx` | Bar chart of derived windows with critical path and float. |

**Modified:**

| File | Change |
|---|---|
| `frontend/src/lib/model/finance-types.ts` | `ProgrammeInputs` → network shape; `CalculatorInputsV9`; `Schedule.programme`; `CALC_VERSION`. |
| `frontend/src/lib/conversion-types.ts:78-84` | `ScenarioOverrides` gains two fields. |
| `frontend/src/lib/model/cost-plan.ts` | `CostPackage`/`FeeLine` gain `phase_id: string \| null`. |
| `frontend/src/lib/model/schedule.ts:31-93` | Programme arm replaced by phase resolution + spread. |
| `frontend/src/lib/model/validation.ts:659-691` | Programme block replaced by §18.8's rules. |
| `frontend/src/lib/model/migrate.ts` | `migrateV8toV9`, `migrateInputsToV9`, `isV9`. |
| `frontend/src/lib/model/sensitivity.ts:19-23,138-205` | `phase_slip` lever, `phase_id` on axis/range, paired dedupe. |
| `frontend/src/lib/model/apply-scenario.ts:27-90` | Phase-slip arm. |
| `app/financial_model/types.py:264-300,703-760` | Mirrors of the above; `CalculatorInputsV9`; parse dispatch. |
| `app/financial_model/{schedule,validation,migrate,sensitivity,apply_scenario}.py` | Mirrors. |
| `frontend/src/components/calculator/ProgrammePage.tsx` | Three-package editor replaced. |
| `frontend/src/lib/export-investment-memo.ts` | Programme section. |
| `docs/financial-model/calculation-specification.md` | §18; §6.1 marked superseded. |
| `docs/financial-model/migration-notes.md` | v8 → v9 entry. |

---

## Task 1: The derivation engine (TypeScript)

Implements **§18.1, §18.2**.

**Files:**
- Create: `frontend/src/lib/model/programme.ts`
- Create: `frontend/src/lib/model/programme.test.ts`

**Interfaces:**
- Consumes: `SpendCurve` from `./curves`.
- Produces: `PhaseCode`, `PRE_COMPLETION_CODES`, `DependencyType`, `Dependency`, `Phase`, `ProgrammeNetwork`, `DerivedPhase`, `ProgrammeDerivation`, `topologicalOrder(phases): string[] | { cycle: string[] }`, `derivePhases(network): ProgrammeDerivation | { cycle: string[] }`.

- [ ] **Step 1: Write the failing tests for the derivation**

```ts
// frontend/src/lib/model/programme.test.ts
import { describe, it, expect } from 'vitest';
import { derivePhases, topologicalOrder, PRE_COMPLETION_CODES } from './programme';
import type { Phase, ProgrammeNetwork } from './programme';

const sl = { kind: 'straight_line' } as const;

function phase(id: string, code: string, duration: number, preds: Phase['predecessors'] = [], extra: Partial<Phase> = {}): Phase {
  return {
    id, code: code as Phase['code'], label: id,
    duration_months: duration, slip_months: 0, start_offset: 0,
    curve: sl, predecessors: preds, ...extra,
  };
}
function net(phases: Phase[]): ProgrammeNetwork {
  return {
    anchor_month: null,
    phases,
    category_phase_ids: { construction: phases[0].id, professional: phases[0].id, statutory: phases[0].id },
  };
}

describe('derivePhases — §18.2', () => {
  it('a predecessor-free phase starts at its start_offset floor', () => {
    const d = derivePhases(net([phase('a', 'planning', 4, [], { start_offset: 2 })]));
    expect('cycle' in d).toBe(false);
    if ('cycle' in d) return;
    expect(d.byId.a.start_month).toBe(2);
    expect(d.byId.a.finish_month).toBe(6);
  });

  it('FS with lag starts after the predecessor finishes plus the lag', () => {
    const d = derivePhases(net([
      phase('a', 'planning', 4),
      phase('b', 'construction', 9, [{ phase_id: 'a', type: 'FS', lag_months: 1 }]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.b.start_month).toBe(5); // a finishes at 4, +1 lag
    expect(d.byId.b.finish_month).toBe(14);
  });

  it('SS with lag starts after the predecessor STARTS plus the lag', () => {
    const d = derivePhases(net([
      phase('a', 'design', 6, [], { start_offset: 3 }),
      phase('b', 'procurement', 2, [{ phase_id: 'a', type: 'SS', lag_months: 2 }]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.b.start_month).toBe(5); // a starts at 3, +2
  });

  it('start_offset is a FLOOR, not an override — the later of the two wins', () => {
    const d = derivePhases(net([
      phase('a', 'planning', 4),
      // floor of 10 is later than a's finish of 4
      phase('b', 'construction', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }], { start_offset: 10 }),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.b.start_month).toBe(10);
  });

  it('takes the LATEST of several predecessors', () => {
    const d = derivePhases(net([
      phase('a', 'planning', 4),
      phase('b', 'design', 7),
      phase('c', 'construction', 2, [
        { phase_id: 'a', type: 'FS', lag_months: 0 },
        { phase_id: 'b', type: 'FS', lag_months: 0 },
      ]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.c.start_month).toBe(7);
  });

  it('slip is applied OUTSIDE the max and propagates to successors', () => {
    const d = derivePhases(net([
      phase('a', 'planning', 4, [], { slip_months: 3 }),
      phase('b', 'construction', 9, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.a.start_month).toBe(3);
    expect(d.byId.b.start_month).toBe(7);
  });

  it('slip is signed — negative slip accelerates, and may go below zero', () => {
    const d = derivePhases(net([
      phase('a', 'planning', 4, [], { start_offset: 1, slip_months: -3 }),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    // NOT clamped — validation rejects it (§18.8); the engine reports what it derived
    expect(d.byId.a.start_month).toBe(-2);
  });

  it('a milestone finishes where it starts and its FS successor starts there too', () => {
    const d = derivePhases(net([
      phase('c', 'construction', 9),
      phase('pc', 'practical_completion', 0, [{ phase_id: 'c', type: 'FS', lag_months: 0 }]),
      phase('m', 'marketing', 3, [{ phase_id: 'pc', type: 'FS', lag_months: 0 }]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.pc.start_month).toBe(9);
    expect(d.byId.pc.finish_month).toBe(9);
    expect(d.byId.m.start_month).toBe(9);
  });

  it('programme finish counts a trailing MILESTONE, not only spend-bearing phases', () => {
    // The defect the spec self-review caught: a maturity_tail milestone after
    // the last window must extend the finish.
    const d = derivePhases(net([
      phase('c', 'construction', 9),
      phase('t', 'maturity_tail', 0, [{ phase_id: 'c', type: 'FS', lag_months: 3 }]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.t.start_month).toBe(12);
    expect(d.finish_month).toBe(13); // first month index no phase occupies
  });

  it('detects a cycle and names it in order', () => {
    const d = derivePhases(net([
      phase('a', 'planning', 4, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
      phase('b', 'conditions', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
    ]));
    expect('cycle' in d).toBe(true);
    if (!('cycle' in d)) return;
    expect(d.cycle[0]).toBe(d.cycle[d.cycle.length - 1]); // closed loop
    expect(new Set(d.cycle)).toEqual(new Set(['a', 'b']));
  });

  it('detects a self-reference as a one-phase cycle', () => {
    const d = derivePhases(net([phase('a', 'planning', 4, [{ phase_id: 'a', type: 'FS', lag_months: 0 }])]));
    expect('cycle' in d).toBe(true);
  });

  it('ignores a dependency naming an absent phase rather than throwing', () => {
    // validation.ts rejects it; the engine must degrade to a defined answer.
    const d = derivePhases(net([phase('a', 'planning', 4, [{ phase_id: 'ghost', type: 'FS', lag_months: 0 }])]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.a.start_month).toBe(0);
  });

  it('PRE_COMPLETION_CODES contains practical_completion and excludes marketing', () => {
    expect(PRE_COMPLETION_CODES.includes('practical_completion')).toBe(true);
    expect(PRE_COMPLETION_CODES.includes('marketing')).toBe(false);
    expect(PRE_COMPLETION_CODES.includes('other')).toBe(false);
  });

  it('topologicalOrder returns every phase exactly once for an acyclic network', () => {
    const order = topologicalOrder([
      phase('c', 'construction', 2, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
      phase('a', 'planning', 2),
      phase('b', 'design', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/model/programme.test.ts`
Expected: FAIL — `Failed to resolve import "./programme"`.

- [ ] **Step 3: Write `programme.ts`**

```ts
// frontend/src/lib/model/programme.ts
import type { SpendCurve } from './curves';

/** §18.1. The audit's fourteen phase types plus `other`. */
export type PhaseCode =
  | 'acquisition' | 'planning' | 'conditions' | 'design' | 'procurement'
  | 'strip_out' | 'construction' | 'testing' | 'building_control'
  | 'practical_completion' | 'marketing' | 'unit_completions'
  | 'sales' | 'maturity_tail' | 'other';

export const PHASE_CODES: readonly PhaseCode[] = [
  'acquisition', 'planning', 'conditions', 'design', 'procurement',
  'strip_out', 'construction', 'testing', 'building_control',
  'practical_completion', 'marketing', 'unit_completions',
  'sales', 'maturity_tail', 'other',
];

/**
 * §18.8. The sale-tail rule binds by CODE-SET MEMBERSHIP, not by position in the
 * network. `practical_completion` is IN the set — PC is the boundary and must
 * fall inside the tail, not on it. `other` is NOT in the set: an unclassified
 * phase gets the weaker overrun rule, because a hard error nobody can act on is
 * worse than a looser rule they can.
 */
export const PRE_COMPLETION_CODES: readonly PhaseCode[] = [
  'acquisition', 'planning', 'conditions', 'design', 'procurement',
  'strip_out', 'construction', 'testing', 'building_control',
  'practical_completion',
];

export type DependencyType = 'FS' | 'SS';

export interface Dependency {
  phase_id: string;
  type: DependencyType;
  lag_months: number;
}

export interface Phase {
  id: string;
  code: PhaseCode;
  label: string;
  /** 0 = milestone (§18.3). */
  duration_months: number;
  /** SIGNED (§18.2). Negative is acceleration. */
  slip_months: number;
  /** Earliest-start FLOOR, never an override (§18.1). */
  start_offset: number;
  curve: SpendCurve;
  predecessors: Dependency[];
}

export interface ProgrammeNetwork {
  anchor_month: string | null;
  phases: Phase[];
  category_phase_ids: {
    construction: string;
    professional: string;
    statutory: string;
  };
}

export interface DerivedPhase {
  id: string;
  code: PhaseCode;
  label: string;
  start_month: number;
  finish_month: number;
  duration_months: number;
  slip_months: number;
  total_float_months: number;
  is_critical: boolean;
}

export interface ProgrammeDerivation {
  finish_month: number;
  critical_path: string[];
  order: string[];
  byId: Record<string, DerivedPhase>;
  phases: DerivedPhase[];
}

/** A closed loop, first id repeated at the end: ['a','b','a']. */
export interface CycleResult { cycle: string[] }

/**
 * Kahn's algorithm. Returns the ids in dependency order, or the cycle that
 * prevents one. A dependency naming an absent phase is IGNORED here (it
 * constrains nothing); validation.ts rejects it as a hard error — the engine's
 * job is to degrade to a defined answer, not to be the rule.
 */
export function topologicalOrder(phases: Phase[]): string[] | CycleResult {
  const ids = new Set(phases.map((p) => p.id));
  const indegree = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const p of phases) {
    indegree.set(p.id, 0);
    successors.set(p.id, []);
  }
  for (const p of phases) {
    for (const d of p.predecessors) {
      if (!ids.has(d.phase_id)) continue;
      indegree.set(p.id, (indegree.get(p.id) ?? 0) + 1);
      successors.get(d.phase_id)!.push(p.id);
    }
  }
  // Deterministic: ties break on the phases[] order, not on Map insertion luck.
  const position = new Map(phases.map((p, i) => [p.id, i]));
  const ready = phases.filter((p) => indegree.get(p.id) === 0).map((p) => p.id);
  const out: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => position.get(a)! - position.get(b)!);
    const id = ready.shift()!;
    out.push(id);
    for (const s of successors.get(id)!) {
      const next = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, next);
      if (next === 0) ready.push(s);
    }
  }
  if (out.length === phases.length) return out;
  return { cycle: findCycle(phases, ids) };
}

/** Depth-first walk over the phases Kahn could not place, returning the first
 *  closed loop found with its opening id repeated at the end. */
function findCycle(phases: Phase[], ids: Set<string>): string[] {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const state = new Map<string, 0 | 1 | 2>(); // 0 unseen, 1 on stack, 2 done
  const stack: string[] = [];
  let found: string[] | null = null;

  const visit = (id: string): void => {
    if (found) return;
    if (state.get(id) === 1) {
      found = [...stack.slice(stack.indexOf(id)), id];
      return;
    }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    stack.push(id);
    for (const d of byId.get(id)?.predecessors ?? []) {
      if (!ids.has(d.phase_id)) continue;
      visit(d.phase_id);
      if (found) return;
    }
    stack.pop();
    state.set(id, 2);
  };

  for (const p of phases) {
    visit(p.id);
    if (found) break;
  }
  // `found` holds predecessor-direction ids; reverse to read forwards.
  return found ? [...(found as string[])].reverse() : [];
}

/**
 * §18.2 forward pass, §18.4 backward pass.
 *
 * start(p) = slip(p) + max( start_offset(p), max over preds( ref(d) + lag ) )
 * finish(p) = start(p) + duration(p)
 */
export function derivePhases(network: ProgrammeNetwork): ProgrammeDerivation | CycleResult {
  const phases = network.phases;
  const order = topologicalOrder(phases);
  if (!Array.isArray(order)) return order;

  const byId = new Map(phases.map((p) => [p.id, p]));
  const start = new Map<string, number>();
  const finish = new Map<string, number>();

  for (const id of order) {
    const p = byId.get(id)!;
    let floor = p.start_offset;
    for (const d of p.predecessors) {
      const pred = byId.get(d.phase_id);
      if (pred === undefined) continue; // validation owns this
      const ref = d.type === 'FS' ? finish.get(d.phase_id)! : start.get(d.phase_id)!;
      floor = Math.max(floor, ref + d.lag_months);
    }
    const s = p.slip_months + floor;
    start.set(id, s);
    finish.set(id, s + p.duration_months);
  }

  // §18.2: the milestone arm sits INSIDE the same maximum. A maturity_tail
  // milestone three months past the last window IS the programme's end; a
  // maximum over duration>=1 phases alone would report the programme finishing
  // before its own final milestone, and the overrun check reads this number.
  const finishMonth = phases.length === 0 ? 0 : Math.max(
    ...phases.map((p) => (p.duration_months >= 1 ? finish.get(p.id)! : start.get(p.id)! + 1)),
  );

  // §18.4 backward pass.
  const successors = new Map<string, Array<{ id: string; dep: Dependency }>>();
  for (const p of phases) successors.set(p.id, []);
  for (const p of phases) {
    for (const d of p.predecessors) {
      if (!byId.has(d.phase_id)) continue;
      successors.get(d.phase_id)!.push({ id: p.id, dep: d });
    }
  }
  const lateStart = new Map<string, number>();
  const lateFinish = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const p = byId.get(id)!;
    const succs = successors.get(id)!;
    let lf: number;
    if (succs.length === 0) {
      lf = p.duration_months >= 1 ? finishMonth : finishMonth - 1;
    } else {
      lf = Math.min(...succs.map(({ id: sid, dep }) => (
        dep.type === 'FS'
          ? lateStart.get(sid)! - dep.lag_months
          : lateStart.get(sid)! + p.duration_months - dep.lag_months
      )));
    }
    lateFinish.set(id, lf);
    lateStart.set(id, lf - p.duration_months);
  }

  const derived: DerivedPhase[] = phases.map((p) => {
    const totalFloat = lateStart.get(p.id)! - start.get(p.id)!;
    return {
      id: p.id, code: p.code, label: p.label,
      start_month: start.get(p.id)!,
      finish_month: finish.get(p.id)!,
      duration_months: p.duration_months,
      slip_months: p.slip_months,
      total_float_months: totalFloat,
      is_critical: totalFloat === 0,
    };
  });

  const map: Record<string, DerivedPhase> = {};
  for (const d of derived) map[d.id] = d;

  return {
    finish_month: finishMonth,
    critical_path: order.filter((id) => map[id].is_critical),
    order,
    byId: map,
    phases: derived,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/model/programme.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/programme.ts frontend/src/lib/model/programme.test.ts
git commit -m "feat(r12): programme precedence network derivation (spec 18.1, 18.2)"
```

---

## Task 2: Float and the critical path, tested for asymmetry (TypeScript)

Implements **§18.4** and sets up **guard 1 of §13**. The backward pass is already written in Task 1; this task is where it earns its keep, because a float derivation that is subtly wrong still produces plausible numbers.

**Files:**
- Modify: `frontend/src/lib/model/programme.test.ts`
- Modify (only if a test fails): `frontend/src/lib/model/programme.ts`

**Interfaces:**
- Consumes: `derivePhases` from Task 1.
- Produces: nothing new — this task hardens an existing surface.

- [ ] **Step 1: Write the failing float tests**

Append to `programme.test.ts`:

```ts
describe('float and the critical path — §18.4', () => {
  // a(4) -> c(9); b(2) runs alongside a with 2 months of slack.
  const slackNet = () => net([
    phase('a', 'planning', 4),
    phase('b', 'design', 2),
    phase('c', 'construction', 9, [
      { phase_id: 'a', type: 'FS', lag_months: 0 },
      { phase_id: 'b', type: 'FS', lag_months: 0 },
    ]),
  ]);

  it('the driving chain has zero float and the slack phase has positive float', () => {
    const d = derivePhases(slackNet());
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.a.total_float_months).toBe(0);
    expect(d.byId.c.total_float_months).toBe(0);
    expect(d.byId.b.total_float_months).toBe(2);
    expect(d.critical_path).toEqual(['a', 'c']);
    expect(d.finish_month).toBe(13);
  });

  it('GUARD 1a: slipping a phase WITH float does not move the programme finish', () => {
    const n = slackNet();
    n.phases[1].slip_months = 2; // b has exactly 2 months of float
    const d = derivePhases(n);
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.finish_month).toBe(13);          // absolute, not a direction
    expect(d.byId.b.start_month).toBe(2);     // b did move
    expect(d.byId.c.start_month).toBe(4);     // c did not
    expect(d.byId.b.total_float_months).toBe(0); // float consumed exactly
  });

  it('GUARD 1b: slipping a CRITICAL phase by n moves the finish by exactly n', () => {
    const n = slackNet();
    n.phases[0].slip_months = 3; // a is critical
    const d = derivePhases(n);
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.finish_month).toBe(16);       // 13 + 3, absolute
    expect(d.byId.c.start_month).toBe(7);  // 4 + 3, absolute
  });

  it('the fixture used by GUARD 1 really does contain a phase with non-zero float', () => {
    // Without this, GUARD 1a passes vacuously on a network where every phase is
    // critical — both arms would then be the same arm. R11's fourth vacuous
    // guard was exactly this shape.
    const d = derivePhases(slackNet());
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.phases.some((p) => p.total_float_months > 0)).toBe(true);
  });

  it('an SS link carries float correctly', () => {
    const d = derivePhases(net([
      phase('a', 'construction', 10),
      phase('b', 'marketing', 2, [{ phase_id: 'a', type: 'SS', lag_months: 6 }]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.b.start_month).toBe(6);
    expect(d.finish_month).toBe(10);
    expect(d.byId.b.total_float_months).toBe(2); // b could start at 8
    expect(d.byId.a.total_float_months).toBe(0);
  });

  it('a trailing milestone is on the critical path', () => {
    const d = derivePhases(net([
      phase('c', 'construction', 9),
      phase('t', 'maturity_tail', 0, [{ phase_id: 'c', type: 'FS', lag_months: 3 }]),
    ]));
    if ('cycle' in d) throw new Error('unexpected cycle');
    expect(d.byId.t.total_float_months).toBe(0);
    expect(d.critical_path).toEqual(['c', 't']);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd frontend && npx vitest run src/lib/model/programme.test.ts`
Expected: PASS. If any float assertion fails, the backward pass in Task 1 is wrong — fix `derivePhases`, not the test. In particular, if the trailing-milestone float is non-zero, the `succs.length === 0` branch's `finishMonth - 1` for milestones is the line to check.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/model/programme.test.ts frontend/src/lib/model/programme.ts
git commit -m "test(r12): float asymmetry guard -- slipping slack must not move the finish (spec 18.4, guard 1)"
```

---

## Task 3: The Python mirror of the derivation

Implements **§18.1, §18.2, §18.4** in `app/financial_model/`.

**Files:**
- Create: `app/financial_model/programme.py`
- Create: `tests/test_financial_model_programme.py`
- Modify: `app/financial_model/types.py` — add the network models beside `ProgrammePackage` (line 264).

**Interfaces:**
- Consumes: `SpendCurve` from `types.py` (declared there, not in `curves.py` — see the port-deviation note at `types.py:234`).
- Produces: `PhaseCode`, `PRE_COMPLETION_CODES`, `Dependency`, `Phase`, `ProgrammeNetwork` (in `types.py`); `topological_order`, `derive_phases`, `DerivedPhase`, `ProgrammeDerivation` (in `programme.py`).

- [ ] **Step 1: Add the Pydantic models to `types.py`**

Insert after `ProgrammePackages` (around line 293), keeping `ProgrammePackage`/`ProgrammePackages` in place for now — Task 7's migration is the only thing that still reads them, and Task 5 removes them from `CalculatorInputsV9`.

```python
# --- Release 12 (calc 2.11.0): the dated, dependent programme (spec Sec 18) ---

PhaseCode = Literal[
    "acquisition", "planning", "conditions", "design", "procurement",
    "strip_out", "construction", "testing", "building_control",
    "practical_completion", "marketing", "unit_completions",
    "sales", "maturity_tail", "other",
]

#: Spec Sec 18.8. The sale-tail rule binds by CODE-SET MEMBERSHIP.
#: ``practical_completion`` is IN the set (PC is the boundary and must fall
#: inside the tail); ``other`` is NOT (an unclassified phase gets the weaker
#: overrun rule rather than a hard error nobody can act on).
PRE_COMPLETION_CODES: tuple[str, ...] = (
    "acquisition", "planning", "conditions", "design", "procurement",
    "strip_out", "construction", "testing", "building_control",
    "practical_completion",
)

DependencyType = Literal["FS", "SS"]


class Dependency(Model):
    """Port rule #7 exception, mirroring ProgrammePackage: ``lag_months`` carries
    no *lower* Pydantic bound. Spec Sec 18.8's rules are hard *validation*
    errors owned by validation.py, so that a negative lag surfaces as the
    spec-worded ValidationIssue rather than a 422 Pydantic parse failure -- and
    so the negative cases stay constructible in the validation tests."""

    phase_id: str
    type: DependencyType
    lag_months: int = Field(le=1200)


class Phase(Model):
    """``slip_months`` is SIGNED (spec Sec 18.2) -- negative is acceleration --
    and carries the same resource-exhaustion ceilings, not spec rules, as
    ProgrammePackage's."""

    id: str
    code: PhaseCode
    label: str
    duration_months: int = Field(le=1200)
    slip_months: int = Field(ge=-1200, le=1200)
    start_offset: int = Field(le=1200)
    curve: SpendCurve
    predecessors: list[Dependency] = Field(default_factory=list, max_length=1200)


class CategoryPhaseIds(Model):
    construction: str
    professional: str
    statutory: str


class ProgrammeNetwork(Model):
    anchor_month: str | None = None
    phases: list[Phase] = Field(default_factory=list, max_length=1200)
    category_phase_ids: CategoryPhaseIds
```

- [ ] **Step 2: Write the failing Python tests**

```python
# tests/test_financial_model_programme.py
"""Spec Sec 18.2/18.4 -- mirror of frontend/src/lib/model/programme.test.ts."""
import pytest

from app.financial_model.programme import derive_phases, topological_order
from app.financial_model.types import (
    CategoryPhaseIds, Dependency, Phase, ProgrammeNetwork, SimpleSpendCurve,
    PRE_COMPLETION_CODES,
)

SL = SimpleSpendCurve(kind="straight_line")


def phase(pid, code, duration, preds=(), *, start_offset=0, slip=0):
    return Phase(
        id=pid, code=code, label=pid, duration_months=duration,
        slip_months=slip, start_offset=start_offset, curve=SL,
        predecessors=list(preds),
    )


def net(phases):
    first = phases[0].id
    return ProgrammeNetwork(
        anchor_month=None, phases=phases,
        category_phase_ids=CategoryPhaseIds(
            construction=first, professional=first, statutory=first,
        ),
    )


def dep(pid, type_="FS", lag=0):
    return Dependency(phase_id=pid, type=type_, lag_months=lag)


def test_predecessor_free_phase_starts_at_its_floor():
    d = derive_phases(net([phase("a", "planning", 4, start_offset=2)]))
    assert d.cycle is None
    assert d.by_id["a"].start_month == 2
    assert d.by_id["a"].finish_month == 6


def test_fs_with_lag():
    d = derive_phases(net([
        phase("a", "planning", 4),
        phase("b", "construction", 9, [dep("a", "FS", 1)]),
    ]))
    assert d.by_id["b"].start_month == 5
    assert d.by_id["b"].finish_month == 14


def test_ss_with_lag_references_the_predecessor_start():
    d = derive_phases(net([
        phase("a", "design", 6, start_offset=3),
        phase("b", "procurement", 2, [dep("a", "SS", 2)]),
    ]))
    assert d.by_id["b"].start_month == 5


def test_start_offset_is_a_floor_not_an_override():
    d = derive_phases(net([
        phase("a", "planning", 4),
        phase("b", "construction", 2, [dep("a")], start_offset=10),
    ]))
    assert d.by_id["b"].start_month == 10


def test_latest_of_several_predecessors_wins():
    d = derive_phases(net([
        phase("a", "planning", 4),
        phase("b", "design", 7),
        phase("c", "construction", 2, [dep("a"), dep("b")]),
    ]))
    assert d.by_id["c"].start_month == 7


def test_slip_propagates_to_successors():
    d = derive_phases(net([
        phase("a", "planning", 4, slip=3),
        phase("b", "construction", 9, [dep("a")]),
    ]))
    assert d.by_id["a"].start_month == 3
    assert d.by_id["b"].start_month == 7


def test_negative_slip_is_not_clamped():
    d = derive_phases(net([phase("a", "planning", 4, start_offset=1, slip=-3)]))
    assert d.by_id["a"].start_month == -2


def test_milestone_finishes_where_it_starts():
    d = derive_phases(net([
        phase("c", "construction", 9),
        phase("pc", "practical_completion", 0, [dep("c")]),
        phase("m", "marketing", 3, [dep("pc")]),
    ]))
    assert d.by_id["pc"].start_month == 9
    assert d.by_id["pc"].finish_month == 9
    assert d.by_id["m"].start_month == 9


def test_programme_finish_counts_a_trailing_milestone():
    d = derive_phases(net([
        phase("c", "construction", 9),
        phase("t", "maturity_tail", 0, [dep("c", "FS", 3)]),
    ]))
    assert d.by_id["t"].start_month == 12
    assert d.finish_month == 13


def test_cycle_is_detected_and_named():
    d = derive_phases(net([
        phase("a", "planning", 4, [dep("b")]),
        phase("b", "conditions", 2, [dep("a")]),
    ]))
    assert d.cycle is not None
    assert d.cycle[0] == d.cycle[-1]
    assert set(d.cycle) == {"a", "b"}


def test_self_reference_is_a_cycle():
    d = derive_phases(net([phase("a", "planning", 4, [dep("a")])]))
    assert d.cycle is not None


def test_absent_predecessor_is_ignored_by_the_engine():
    d = derive_phases(net([phase("a", "planning", 4, [dep("ghost")])]))
    assert d.cycle is None
    assert d.by_id["a"].start_month == 0


def test_pre_completion_codes_membership():
    assert "practical_completion" in PRE_COMPLETION_CODES
    assert "marketing" not in PRE_COMPLETION_CODES
    assert "other" not in PRE_COMPLETION_CODES


def test_topological_order_places_every_phase_once():
    order, cycle = topological_order([
        phase("c", "construction", 2, [dep("b")]),
        phase("a", "planning", 2),
        phase("b", "design", 2, [dep("a")]),
    ])
    assert cycle is None
    assert order == ["a", "b", "c"]


# --- Sec 18.4 float, mirroring the TS guard tests ---

def slack_net():
    return net([
        phase("a", "planning", 4),
        phase("b", "design", 2),
        phase("c", "construction", 9, [dep("a"), dep("b")]),
    ])


def test_float_and_critical_path():
    d = derive_phases(slack_net())
    assert d.by_id["a"].total_float_months == 0
    assert d.by_id["c"].total_float_months == 0
    assert d.by_id["b"].total_float_months == 2
    assert d.critical_path == ["a", "c"]
    assert d.finish_month == 13


def test_guard_1a_slipping_slack_does_not_move_the_finish():
    n = slack_net()
    n.phases[1].slip_months = 2
    d = derive_phases(n)
    assert d.finish_month == 13
    assert d.by_id["b"].start_month == 2
    assert d.by_id["c"].start_month == 4
    assert d.by_id["b"].total_float_months == 0


def test_guard_1b_slipping_a_critical_phase_moves_the_finish_by_exactly_n():
    n = slack_net()
    n.phases[0].slip_months = 3
    d = derive_phases(n)
    assert d.finish_month == 16
    assert d.by_id["c"].start_month == 7


def test_guard_1_fixture_really_contains_a_slack_phase():
    d = derive_phases(slack_net())
    assert any(p.total_float_months > 0 for p in d.phases)


def test_ss_link_carries_float():
    d = derive_phases(net([
        phase("a", "construction", 10),
        phase("b", "marketing", 2, [dep("a", "SS", 6)]),
    ]))
    assert d.by_id["b"].start_month == 6
    assert d.finish_month == 10
    assert d.by_id["b"].total_float_months == 2
    assert d.by_id["a"].total_float_months == 0


def test_trailing_milestone_is_critical():
    d = derive_phases(net([
        phase("c", "construction", 9),
        phase("t", "maturity_tail", 0, [dep("c", "FS", 3)]),
    ]))
    assert d.by_id["t"].total_float_months == 0
    assert d.critical_path == ["c", "t"]
```

- [ ] **Step 3: Run to verify they fail**

Run: `pytest tests/test_financial_model_programme.py -x -q`
Expected: FAIL — `ModuleNotFoundError: app.financial_model.programme`.

- [ ] **Step 4: Write `programme.py`**

Port `programme.ts` function-for-function. The Python return shape differs in one documented way: TypeScript uses a `ProgrammeDerivation | CycleResult` union, which Python expresses as one dataclass carrying `cycle: list[str] | None` — the same information, in the idiom the rest of this package already uses.

```python
"""Spec Sec 18.1/18.2/18.4 -- the dated, dependent programme derivation.

Mirror of frontend/src/lib/model/programme.ts. Pure: knows nothing about money.

Port deviation (documented, deliberate): programme.ts returns the union
``ProgrammeDerivation | CycleResult``. Python returns a single
``ProgrammeDerivation`` whose ``cycle`` is None on success and the closed loop
on failure -- the same information, in the idiom this package already uses for
optional results. Callers MUST check ``cycle is None`` before reading dates;
on a cycle the date maps are empty, never partially filled.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .types import Dependency, Phase, ProgrammeNetwork


@dataclass
class DerivedPhase:
    id: str
    code: str
    label: str
    start_month: int
    finish_month: int
    duration_months: int
    slip_months: int
    total_float_months: int
    is_critical: bool


@dataclass
class ProgrammeDerivation:
    finish_month: int = 0
    critical_path: list[str] = field(default_factory=list)
    order: list[str] = field(default_factory=list)
    by_id: dict[str, DerivedPhase] = field(default_factory=dict)
    phases: list[DerivedPhase] = field(default_factory=list)
    cycle: list[str] | None = None


def topological_order(phases: list[Phase]) -> tuple[list[str], list[str] | None]:
    """Kahn's algorithm. Returns ``(order, None)`` or ``([], cycle)``.

    A dependency naming an absent phase is IGNORED (it constrains nothing);
    validation.py rejects it as a hard error. The engine's job is to degrade to
    a defined answer, not to be the rule.
    """
    ids = {p.id for p in phases}
    indegree = {p.id: 0 for p in phases}
    successors: dict[str, list[str]] = {p.id: [] for p in phases}
    for p in phases:
        for d in p.predecessors:
            if d.phase_id not in ids:
                continue
            indegree[p.id] += 1
            successors[d.phase_id].append(p.id)

    # Deterministic: ties break on the phases[] order, mirroring programme.ts.
    position = {p.id: i for i, p in enumerate(phases)}
    ready = [p.id for p in phases if indegree[p.id] == 0]
    out: list[str] = []
    while ready:
        ready.sort(key=lambda i: position[i])
        pid = ready.pop(0)
        out.append(pid)
        for s in successors[pid]:
            indegree[s] -= 1
            if indegree[s] == 0:
                ready.append(s)
    if len(out) == len(phases):
        return out, None
    return [], _find_cycle(phases, ids)


def _find_cycle(phases: list[Phase], ids: set[str]) -> list[str]:
    by_id = {p.id: p for p in phases}
    state: dict[str, int] = {}  # 0 unseen, 1 on stack, 2 done
    stack: list[str] = []
    found: list[str] | None = None

    def visit(pid: str) -> None:
        nonlocal found
        if found is not None:
            return
        if state.get(pid) == 1:
            found = [*stack[stack.index(pid):], pid]
            return
        if state.get(pid) == 2:
            return
        state[pid] = 1
        stack.append(pid)
        for d in by_id[pid].predecessors if pid in by_id else []:
            if d.phase_id not in ids:
                continue
            visit(d.phase_id)
            if found is not None:
                return
        stack.pop()
        state[pid] = 2

    for p in phases:
        visit(p.id)
        if found is not None:
            break
    return list(reversed(found)) if found else []


def _ref(d: Dependency, start: dict[str, int], finish: dict[str, int]) -> int:
    return finish[d.phase_id] if d.type == "FS" else start[d.phase_id]


def derive_phases(network: ProgrammeNetwork) -> ProgrammeDerivation:
    phases = list(network.phases)
    order, cycle = topological_order(phases)
    if cycle is not None:
        return ProgrammeDerivation(cycle=cycle)

    by_id = {p.id: p for p in phases}
    start: dict[str, int] = {}
    finish: dict[str, int] = {}

    for pid in order:
        p = by_id[pid]
        floor = p.start_offset
        for d in p.predecessors:
            if d.phase_id not in by_id:
                continue  # validation owns this
            floor = max(floor, _ref(d, start, finish) + d.lag_months)
        s = p.slip_months + floor
        start[pid] = s
        finish[pid] = s + p.duration_months

    # Sec 18.2: the milestone arm sits INSIDE the same maximum -- a trailing
    # maturity_tail milestone IS the programme's end, and the overrun check
    # reads this number.
    finish_month = 0 if not phases else max(
        finish[p.id] if p.duration_months >= 1 else start[p.id] + 1
        for p in phases
    )

    # Sec 18.4 backward pass.
    successors: dict[str, list[tuple[str, Dependency]]] = {p.id: [] for p in phases}
    for p in phases:
        for d in p.predecessors:
            if d.phase_id in by_id:
                successors[d.phase_id].append((p.id, d))

    late_start: dict[str, int] = {}
    for pid in reversed(order):
        p = by_id[pid]
        succs = successors[pid]
        if not succs:
            lf = finish_month if p.duration_months >= 1 else finish_month - 1
        else:
            lf = min(
                late_start[sid] - d.lag_months if d.type == "FS"
                else late_start[sid] + p.duration_months - d.lag_months
                for sid, d in succs
            )
        late_start[pid] = lf - p.duration_months

    derived: list[DerivedPhase] = []
    for p in phases:
        total_float = late_start[p.id] - start[p.id]
        derived.append(DerivedPhase(
            id=p.id, code=p.code, label=p.label,
            start_month=start[p.id], finish_month=finish[p.id],
            duration_months=p.duration_months, slip_months=p.slip_months,
            total_float_months=total_float, is_critical=total_float == 0,
        ))

    index = {d.id: d for d in derived}
    return ProgrammeDerivation(
        finish_month=finish_month,
        critical_path=[pid for pid in order if index[pid].is_critical],
        order=order,
        by_id=index,
        phases=derived,
        cycle=None,
    )
```

- [ ] **Step 5: Run the Python tests**

Run: `pytest tests/test_financial_model_programme.py -q`
Expected: PASS, 21 tests.

- [ ] **Step 6: Cross-engine parity check**

Both suites assert the same absolute month numbers on the same networks. Confirm by eye that every `expect(...).toBe(N)` in `programme.test.ts` has an `assert ... == N` twin with the same N. Any divergence is a port bug, not a test difference.

- [ ] **Step 7: Commit**

```bash
git add app/financial_model/programme.py app/financial_model/types.py tests/test_financial_model_programme.py
git commit -m "feat(r12): python mirror of the programme derivation and float pass (spec 18.2, 18.4)"
```

---

## Task 4: The v9 document schema (TypeScript)

Implements **§18.1, §18.5, §18.6, §18.9** at the type level. No behaviour changes yet — this task makes the shapes exist so later tasks can fill them.

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts:124-137` (replace `ProgrammePackage`/`ProgrammeInputs`), `:167` (v4 keeps its old shape), and add `CalculatorInputsV9` after `CalculatorInputsV8`
- Modify: `frontend/src/lib/conversion-types.ts:78-84` (`ScenarioOverrides`)
- Modify: `frontend/src/lib/model/cost-plan.ts` (`CostPackage`, `FeeLine`)
- Modify: `frontend/src/lib/model/finance-types.ts:515` (`CALC_VERSION`)

**Interfaces:**
- Consumes: `Phase`, `ProgrammeNetwork` from Task 1's `programme.ts`.
- Produces: `CalculatorInputsV9`, `PhaseAnchor`, `ScenarioOverrides` (extended), `CostPackage.phase_id`, `FeeLine.phase_id`, `Schedule.programme`.

- [ ] **Step 1: Re-export the network types and keep the legacy shape**

In `finance-types.ts`, keep `ProgrammePackage` and `ProgrammeInputs` exactly as they are — `CalculatorInputsV4` through `V8` still reference them and migration reads them. Add below:

```ts
export type {
  PhaseCode, DependencyType, Dependency, Phase, ProgrammeNetwork,
  DerivedPhase, ProgrammeDerivation,
} from './programme';
export { PHASE_CODES, PRE_COMPLETION_CODES } from './programme';

/** R12 spec §18.6. A month expressed relative to a phase's derived start. */
export interface PhaseAnchor {
  phase_id: string;
  offset_months: number;
}

export interface SalesPhasingTrancheV9 {
  month_offset: number;
  pct_of_gross_receipts: number;
  /** null = use `month_offset` (the migration default, §18.7). */
  anchor: PhaseAnchor | null;
}

export interface SalesPhasingInputsV9 {
  tranches: SalesPhasingTrancheV9[];
}

export interface RefinanceInputsV9 extends RefinanceInputs {
  anchor: PhaseAnchor | null;
}

/**
 * R12 spec §18.1. `programme` is a two-state field: `null` = §6 auto windows
 * (bit-identical to calc 2.10.0), or a precedence network. The v8
 * `{ packages: {...} }` shape does NOT survive migration — there are two live
 * spend paths, not three.
 */
export interface CalculatorInputsV9 extends Omit<CalculatorInputsV8,
  'inputs_version' | 'programme' | 'sales_phasing' | 'refinance'> {
  inputs_version: 9;
  programme: ProgrammeNetwork | null;
  sales_phasing: SalesPhasingInputsV9 | null;
  refinance: RefinanceInputsV9 | null;
}
```

Add `CalculatorInputsV9` to the `AnyCalculatorInputs` union wherever `CalculatorInputsV8` appears in it.

- [ ] **Step 2: Extend `ScenarioOverrides`**

`frontend/src/lib/conversion-types.ts:78-84`:

```ts
export interface ScenarioOverrides {
  label: string;
  gdv_adjustment_pct: number;
  construction_cost_adjustment_pct: number;
  timeline_adjustment_months: number;
  interest_rate_adjustment_pct: number;
  /** R12 spec §18.9. null = no slip; matches no phase, so it is a no-op by
   *  construction. This is what makes the v9 migration a written-null. */
  phase_slip_phase_id: string | null;
  /** SIGNED months, added to the named phase's `slip_months` ADDITIVELY, so a
   *  base-case slip already on the document is stressed FROM its recorded
   *  position rather than overwritten by it. */
  phase_slip_months: number;
}
```

- [ ] **Step 3: Add `phase_id` to the cost lines**

In `cost-plan.ts`, add to both `CostPackage` and `FeeLine`:

```ts
  /** R12 spec §18.5. Overrides the category default for this line's spend
   *  window. null on every migrated row and on every line the user has not
   *  re-tagged; resolved ONLY through `resolvedPhaseId()` (Task 11). */
  phase_id: string | null;
```

- [ ] **Step 4: Add the result block to `Schedule`**

In `finance-types.ts`, inside `Schedule` (after `vat`):

```ts
  /** R12 spec §18.10. null on the auto-window path, exactly as the INPUT is —
   *  a derived block is never synthesised for a document that never asked for
   *  one, and the auto path has no dependency structure to report. */
  programme: {
    finish_month: number;
    critical_path: string[];
    phases: DerivedPhase[];
  } | null;
```

- [ ] **Step 5: Bump the calc version**

`finance-types.ts:515`: `export const CALC_VERSION = '2.11.0';`

- [ ] **Step 6: Compile**

Run: `cd frontend && npx tsc -b`
Expected: errors at every site that constructs a `ScenarioOverrides`, a `CostPackage`, a `FeeLine` or a `Schedule` literal. **This is the point of the task** — the compiler is enumerating the call sites later tasks must visit. Fix them all now by adding the new fields at their migration defaults (`phase_slip_phase_id: null`, `phase_slip_months: 0`, `phase_id: null`, `programme: null`). Do not change any behaviour.

Two files will need care:
- `frontend/src/lib/conversion-defaults.ts` — the default document; add the two scenario fields to all four scenarios.
- `frontend/src/lib/model/schedule.ts` — add `programme: null` to the returned literal; Task 11 replaces it.

- [ ] **Step 7: Run the full suite**

Run: `cd frontend && npx vitest run`
Expected: PASS at the 1942 baseline. **If any test fails here, a default is wrong** — the schema additions are inert by construction and must move nothing.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib frontend/src/components
git commit -m "feat(r12): v9 document schema -- network programme, phase_id, scenario slip (spec 18.1, 18.5, 18.6, 18.9)"
```

---

## Task 5: The v9 document schema (Python)

Mirror of Task 4.

**Files:**
- Modify: `app/financial_model/types.py` — `ScenarioOverrides` (line 145), `CostPackage`/`FeeLine`, `CalculatorInputsV9`, `AnyCalculatorInputs`, `parse_calculator_inputs`, `CALC_VERSION` (line 759)

**Interfaces:**
- Consumes: `Phase`, `ProgrammeNetwork` from Task 3.
- Produces: `CalculatorInputsV9`, `PhaseAnchor`, `SalesPhasingTrancheV9`, `SalesPhasingInputsV9`, `RefinanceInputsV9`.

- [ ] **Step 1: Extend `ScenarioOverrides` (line 145)**

```python
class ScenarioOverrides(Model):
    label: str
    gdv_adjustment_pct: float
    construction_cost_adjustment_pct: float
    timeline_adjustment_months: float
    interest_rate_adjustment_pct: float
    # R12 spec Sec 18.9. Defaulted so every existing construction site and
    # fixture keeps parsing; the v9 MIGRATION writes them explicitly anyway
    # (Sec 18.7), which is what the identity gate actually asserts.
    phase_slip_phase_id: str | None = None
    phase_slip_months: int = 0
```

- [ ] **Step 2: Add the anchor and v9 blocks**

```python
class PhaseAnchor(Model):
    """Spec Sec 18.6. ``offset_months`` carries no lower bound for the same
    reason SalesPhasingTranche.month_offset does not: validation.py owns the
    window rule and the spec-worded message."""

    phase_id: str
    offset_months: int = Field(ge=-1200, le=1200)


class SalesPhasingTrancheV9(SalesPhasingTranche):
    anchor: PhaseAnchor | None = None


class SalesPhasingInputsV9(Model):
    tranches: list[SalesPhasingTrancheV9] = Field(default_factory=list, max_length=1200)


class RefinanceInputsV9(RefinanceInputs):
    anchor: PhaseAnchor | None = None


class CalculatorInputsV9(CalculatorInputsV8):
    """Mirrors CalculatorInputsV8 with the Sec 18 programme network. Subclasses
    V8 for the same reason V8 subclasses V7: the engine dispatches on it, and a
    flat re-declaration would make those isinstance checks silently False for
    v9 documents.

    ``programme`` NARROWS from ``ProgrammeInputs | None`` to
    ``ProgrammeNetwork | None`` -- the v8 three-package shape does not survive
    migration (Sec 18.7). A v8 document therefore fails
    ``CalculatorInputsV9.model_validate`` on its programme block, which is the
    intended mutual exclusion, not an accident."""

    inputs_version: Literal[9] = 9  # type: ignore[assignment]
    programme: ProgrammeNetwork | None = None  # type: ignore[assignment]
    sales_phasing: SalesPhasingInputsV9 | None = None  # type: ignore[assignment]
    refinance: RefinanceInputsV9 | None = None  # type: ignore[assignment]
```

- [ ] **Step 3: Add `phase_id` to `CostPackage` and `FeeLine`**

```python
    # R12 spec Sec 18.5. Overrides the category default; None on every migrated
    # row. Read ONLY through resolved_phase_id() (Task 12).
    phase_id: str | None = None
```

- [ ] **Step 4: Extend the union and the parse dispatch**

Add `CalculatorInputsV9` to `AnyCalculatorInputs`, and add the branch to `parse_calculator_inputs` **above** the `version == 8` branch:

```python
    # R11 ruling R10, applied one version on: without this branch a v9 document
    # falls through to the CalculatorInputsV2 default, silently dropping the
    # programme network and every other post-v2 field -- R8's silent-corruption
    # defect, which returned 201 while dropping a confirmed equity source.
    if version == 9:
        return CalculatorInputsV9.model_validate(doc)
```

- [ ] **Step 5: Bump `CALC_VERSION` (line 759)**

```python
CALC_VERSION = "2.11.0"
```

- [ ] **Step 6: Run the Python suite**

Run: `pytest -q`
Expected: PASS at the 1607 baseline. Failures here mean a default is wrong, not that behaviour changed.

- [ ] **Step 7: Commit**

```bash
git add app/financial_model/types.py
git commit -m "feat(r12): python v9 document schema (spec 18.1, 18.5, 18.6, 18.9)"
```

---

## Task 6: `migrateV8toV9` (TypeScript)

Implements **§18.7**.

**Files:**
- Modify: `frontend/src/lib/model/migrate.ts` — add `isV9`, `migrateV8toV9`, `migrateInputsToV9` following `migrateV7toV8`/`migrateInputsToV8` (lines 700-826) exactly
- Modify: `frontend/src/lib/model/migrate.test.ts`

**Interfaces:**
- Consumes: `CalculatorInputsV8`, `CalculatorInputsV9`, `ProgrammeInputs`, `ProgrammeNetwork`.
- Produces: `migrateV8toV9(v8): CalculatorInputsV9`, `migrateInputsToV9(snapshot, project?): CalculatorInputsV9`, `PACKAGE_TO_PHASE`.

- [ ] **Step 1: Write the failing migration tests**

```ts
// append to frontend/src/lib/model/migrate.test.ts
import { migrateV8toV9, migrateInputsToV9, PACKAGE_TO_PHASE } from './migrate';

describe('migrateV8toV9 — spec §18.7', () => {
  const v8WithProgramme = () => ({
    ...defaultV8Document(),  // existing helper in this file
    programme: {
      anchor_month: '2026-03',
      packages: {
        construction: { start_offset: 2, duration_months: 9, curve: { kind: 's_curve' as const } },
        professional: { start_offset: 0, duration_months: 5, curve: { kind: 'straight_line' as const } },
        statutory: { start_offset: 1, duration_months: 4, curve: { kind: 'back_loaded' as const } },
      },
    },
  });

  it('leaves a null programme null', () => {
    const v9 = migrateV8toV9({ ...defaultV8Document(), programme: null } as never);
    expect(v9.programme).toBeNull();
    expect(v9.inputs_version).toBe(9);
  });

  it('converts the three packages to predecessor-free phases with identical windows', () => {
    const v9 = migrateV8toV9(v8WithProgramme() as never);
    const net = v9.programme!;
    expect(net.anchor_month).toBe('2026-03');
    expect(net.phases.map((p) => p.id)).toEqual(['construction', 'professional', 'statutory']);
    expect(net.phases.map((p) => p.code)).toEqual(['construction', 'design', 'planning']);
    expect(net.phases.every((p) => p.predecessors.length === 0)).toBe(true);
    expect(net.phases.every((p) => p.slip_months === 0)).toBe(true);
    const c = net.phases[0];
    expect(c.start_offset).toBe(2);
    expect(c.duration_months).toBe(9);
    expect(c.curve).toEqual({ kind: 's_curve' });
  });

  it('points category_phase_ids at the three migrated phases', () => {
    const v9 = migrateV8toV9(v8WithProgramme() as never);
    expect(v9.programme!.category_phase_ids).toEqual({
      construction: 'construction', professional: 'professional', statutory: 'statutory',
    });
  });

  it('writes the id equal to the package name — the alias map depends on it', () => {
    // §18.7's one exemption to the validation-identity gate is bounded by this
    // equality. If migration ever renames these ids, Task 8's alias assertion
    // must fail, so this is asserted at the source too.
    const v9 = migrateV8toV9(v8WithProgramme() as never);
    expect(new Set(v9.programme!.phases.map((p) => p.id)))
      .toEqual(new Set(Object.keys(PACKAGE_TO_PHASE)));
  });

  it('adds anchor: null to every tranche and to refinance', () => {
    const v8 = {
      ...defaultV8Document(),
      sales_phasing: { tranches: [{ month_offset: 10, pct_of_gross_receipts: 100 }] },
      refinance: { month_offset: 11, investment_value_pence: 1, ltv_pct: 60, arrangement_fee_pence: 0, legal_costs_pence: 0 },
    };
    const v9 = migrateV8toV9(v8 as never);
    expect(v9.sales_phasing!.tranches[0].anchor).toBeNull();
    expect(v9.sales_phasing!.tranches[0].month_offset).toBe(10);
    expect(v9.refinance!.anchor).toBeNull();
  });

  it('adds the two slip fields, at no-op values, to all four scenarios', () => {
    const v9 = migrateV8toV9(defaultV8Document() as never);
    for (const k of ['base', 'upside', 'downside', 'severe'] as const) {
      expect(v9.scenarios[k].phase_slip_phase_id).toBeNull();
      expect(v9.scenarios[k].phase_slip_months).toBe(0);
    }
  });

  it('writes phase_id: null on every package and fee line', () => {
    const v9 = migrateV8toV9(defaultV8DocumentWithDetailedCostPlan() as never);
    expect(v9.cost_plan.packages.every((p) => p.phase_id === null)).toBe(true);
    expect(v9.cost_plan.fee_lines.every((f) => f.phase_id === null)).toBe(true);
  });

  it('refuses to double-migrate', () => {
    const v9 = migrateV8toV9(defaultV8Document() as never);
    expect(() => migrateV8toV9(v9 as never)).toThrow(/already a v9 document/);
  });

  it('refuses an unrecognised version — tested with 10, the neighbour', () => {
    // R10 found a version predicate loosened from `=== 6` to `!== 5`, the literal
    // negation of the set's own definition, which could never fail. Testing the
    // NEIGHBOUR is what catches that shape.
    expect(() => migrateInputsToV9({ inputs_version: 10 } as never))
      .toThrow(/unrecognised inputs_version/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: FAIL — `migrateV8toV9 is not exported`.

- [ ] **Step 3: Implement**

```ts
/** §18.7. The three v8 packages, in fixed order, and the phase code each becomes.
 *  The KEY is also the phase `id` the migration writes — Task 8's validation-identity
 *  alias map is bounded by that equality, and asserts this object has exactly three
 *  entries. Do not add a fourth. */
export const PACKAGE_TO_PHASE: Readonly<Record<'construction' | 'professional' | 'statutory',
  { code: PhaseCode; label: string }>> = {
  construction: { code: 'construction', label: 'Construction' },
  professional: { code: 'design', label: 'Professional' },
  statutory: { code: 'planning', label: 'Statutory' },
};

/**
 * §18.7's ONE exemption to the validation-identity gate, DERIVED from the map
 * above rather than written out beside it. The v8 sale-tail rule reports its
 * field as `programme.packages.<name>`; the v9 rule reports
 * `programme.phases.<id>`; migration assigns `id = <name>`, which is the only
 * reason they correspond.
 *
 * Deriving it is the bound. A hand-written second list could gain a fourth
 * entry without anything failing; this one cannot have an entry that
 * `PACKAGE_TO_PHASE` does not license, and Task 8's three-entry assertion
 * therefore constrains both objects at once.
 */
export const PROGRAMME_FIELD_ALIASES: Readonly<Record<string, string>> =
  Object.fromEntries(Object.keys(PACKAGE_TO_PHASE).map(
    (name) => [`programme.packages.${name}`, `programme.phases.${name}`],
  ));

function isV9(snapshot: Record<string, unknown>): snapshot is CalculatorInputsV9 {
  return snapshot.inputs_version === 9 && typeof snapshot.finance === 'object'
    && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/**
 * R12 (spec §18.7). Converts the v8 three-package programme to a precedence
 * network, and writes five additive no-ops. Purely additive by construction:
 * every new value is a written `null` or `0`, and each migrated phase is
 * PREDECESSOR-FREE, so its derived start IS its `start_offset` floor (§18.1)
 * and every window is identical to the v8 window for every curve and every term.
 *
 * Precondition: `v8` must not already be a v9 document (idempotence guard,
 * same as migrateV7toV8).
 */
export function migrateV8toV9(v8: CalculatorInputsV8): CalculatorInputsV9 {
  if (isV9(v8 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV8toV9: input is already a v9 document');
  }
  const { inputs_version: _v8Version, cost_plan, programme, sales_phasing, refinance, scenarios, ...rest } = v8;

  const network: ProgrammeNetwork | null = programme == null ? null : {
    anchor_month: programme.anchor_month,
    phases: (Object.keys(PACKAGE_TO_PHASE) as Array<keyof typeof PACKAGE_TO_PHASE>).map((name) => {
      const pkg = programme.packages[name];
      return {
        id: name,
        code: PACKAGE_TO_PHASE[name].code,
        label: PACKAGE_TO_PHASE[name].label,
        duration_months: pkg.duration_months,
        slip_months: 0,
        start_offset: pkg.start_offset,
        curve: pkg.curve,
        predecessors: [],
      };
    }),
    category_phase_ids: {
      construction: 'construction', professional: 'professional', statutory: 'statutory',
    },
  };

  const withSlip = (s: ScenarioOverrides): ScenarioOverrides => ({
    ...s, phase_slip_phase_id: null, phase_slip_months: 0,
  });

  return {
    ...rest,
    inputs_version: 9,
    cost_plan: {
      ...cost_plan,
      packages: cost_plan.packages.map((p) => ({ ...p, phase_id: null })),
      fee_lines: cost_plan.fee_lines.map((f) => ({ ...f, phase_id: null })),
    },
    programme: network,
    sales_phasing: sales_phasing == null ? null : {
      tranches: sales_phasing.tranches.map((t) => ({ ...t, anchor: null })),
    },
    refinance: refinance == null ? null : { ...refinance, anchor: null },
    scenarios: {
      base: withSlip(scenarios.base), upside: withSlip(scenarios.upside),
      downside: withSlip(scenarios.downside), severe: withSlip(scenarios.severe),
    },
  };
}
```

Then add `migrateInputsToV9`, copied from `migrateInputsToV8` (lines 745-826) with:
- `RECOGNISED_INPUTS_VERSIONS_V9 = [1,2,3,4,5,6,7,8,9]` — **membership of the declared tuple**, never a negation;
- the `version === 9 && !isV9(snapshot)` structural refusal;
- `defaults = migrateV8toV9(migrateV7toV8(...))`;
- the saved-block merges carried through unchanged, plus:

```ts
      // Mirrors the `cost_plan`/`vat` merges above and carries the same risk:
      // without this line a saved network would come back as the default
      // document's `null` and every phase would be lost.
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
      scenarios: {
        base: { ...defaults.scenarios.base, ...(saved.scenarios?.base ?? {}) },
        upside: { ...defaults.scenarios.upside, ...(saved.scenarios?.upside ?? {}) },
        downside: { ...defaults.scenarios.downside, ...(saved.scenarios?.downside ?? {}) },
        severe: { ...defaults.scenarios.severe, ...(saved.scenarios?.severe ?? {}) },
      },
```

Update every production caller of `migrateInputsToV8` to `migrateInputsToV9` (`npx tsc -b` will not catch these — grep for the name).

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/migrate.ts frontend/src/lib/model/migrate.test.ts
git commit -m "feat(r12): migrateV8toV9 -- three packages become predecessor-free phases (spec 18.7)"
```

---

## Task 7: `migrate_v8_to_v9` and the persistence boundary (Python)

Mirror of Task 6, plus the boundary that cost R10 and R11 time.

**Files:**
- Modify: `app/financial_model/migrate.py` (follow `migrate_v7_to_v8`, line 1076)
- Create: `tests/test_migrate_v9.py`
- Modify: `app/api/app.py` — the persistence path, wherever `migrate_inputs_to_v8` is called

**Interfaces:**
- Consumes: `CalculatorInputsV8`, `CalculatorInputsV9`, `PACKAGE_TO_PHASE` (Python copy).
- Produces: `migrate_v8_to_v9`, `migrate_inputs_to_v9`, `PACKAGE_TO_PHASE`.

- [ ] **Step 1: Write the failing boundary tests**

```python
# tests/test_migrate_v9.py
"""Spec Sec 18.7 -- the v8 -> v9 migration and the persistence boundary."""
import json
from pathlib import Path

import pytest

from app.financial_model.migrate import PACKAGE_TO_PHASE, migrate_inputs_to_v9, migrate_v8_to_v9
from app.financial_model.types import CalculatorInputsV9, parse_calculator_inputs


def test_null_programme_stays_null(v8_document):
    v9 = migrate_v8_to_v9(v8_document(programme=None))
    assert v9.programme is None
    assert v9.inputs_version == 9


def test_three_packages_become_predecessor_free_phases(v8_document_with_programme):
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    net = v9.programme
    assert [p.id for p in net.phases] == ["construction", "professional", "statutory"]
    assert [p.code for p in net.phases] == ["construction", "design", "planning"]
    assert all(p.predecessors == [] for p in net.phases)
    assert all(p.slip_months == 0 for p in net.phases)


def test_ids_equal_the_package_names_the_alias_map_depends_on_it(v8_document_with_programme):
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    assert {p.id for p in v9.programme.phases} == set(PACKAGE_TO_PHASE)


def test_double_migration_refused(v8_document):
    v9 = migrate_v8_to_v9(v8_document())
    with pytest.raises(ValueError, match="already a v9 document"):
        migrate_v8_to_v9(v9)


def test_unrecognised_version_refused():
    # The NEIGHBOUR, 10 -- the value that catches a predicate loosened from
    # `== 9` to `!= 8` (R10's finding, one version on).
    with pytest.raises(ValueError, match="unrecognised inputs_version"):
        migrate_inputs_to_v9({"inputs_version": 10})


# --- The persistence boundary (Sec 18.7) ---

def test_every_new_field_survives_a_full_round_trip(v8_document_with_programme):
    """Sec 18.7. Pydantic's extra='ignore' DROPS an undeclared field silently, so
    a structural assertion of the form `"phase_id" not in row` can hold even with
    the migration helper bypassed entirely (R11's third vacuous guard). This
    asserts PRESENCE AND VALUE after a round trip, not absence before one."""
    v9 = migrate_v8_to_v9(v8_document_with_programme)
    reloaded = parse_calculator_inputs(json.loads(v9.model_dump_json()))

    assert isinstance(reloaded, CalculatorInputsV9)
    assert reloaded.programme is not None
    assert [p.id for p in reloaded.programme.phases] == ["construction", "professional", "statutory"]
    assert reloaded.programme.category_phase_ids.construction == "construction"
    for s in (reloaded.scenarios.base, reloaded.scenarios.upside,
              reloaded.scenarios.downside, reloaded.scenarios.severe):
        assert s.phase_slip_phase_id is None
        assert s.phase_slip_months == 0
    for p in reloaded.cost_plan.packages:
        assert p.phase_id is None
    for f in reloaded.cost_plan.fee_lines:
        assert f.phase_id is None


def test_a_populated_network_survives_the_round_trip_with_its_dependencies(v9_network_document):
    """The negative control for the test above: a written null surviving proves
    nothing about a written VALUE surviving. A predecessor list is the field most
    likely to be dropped by a missing model declaration."""
    reloaded = parse_calculator_inputs(json.loads(v9_network_document.model_dump_json()))
    phases = {p.id: p for p in reloaded.programme.phases}
    assert phases["construction"].predecessors[0].phase_id == "procurement"
    assert phases["construction"].predecessors[0].type == "FS"
    assert phases["construction"].predecessors[0].lag_months == 1
    assert phases["marketing"].slip_months == 2
```

Add the three fixtures (`v8_document`, `v8_document_with_programme`, `v9_network_document`) to `tests/conftest.py`, following the existing v8 fixture helpers there.

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_migrate_v9.py -x -q`
Expected: FAIL — `ImportError: cannot import name 'migrate_v8_to_v9'`.

- [ ] **Step 3: Implement `migrate_v8_to_v9` and `migrate_inputs_to_v9`**

Port Task 6's TypeScript exactly, following `migrate_v7_to_v8`'s existing structure (it accepts `dict | CalculatorInputsV7` and has two `already a v8 document` guards — mirror both). Declare:

```python
#: Spec Sec 18.7. Mirror of migrate.ts's PACKAGE_TO_PHASE. The KEY is also the
#: phase id written, which is what bounds the validation-identity alias map --
#: exactly three entries, asserted in tests/test_migrate_v9.py.
PACKAGE_TO_PHASE: dict[str, tuple[str, str]] = {
    "construction": ("construction", "Construction"),
    "professional": ("design", "Professional"),
    "statutory": ("planning", "Statutory"),
}
```

Also correct the stale `calc ... -> next` headers in both `migrate.py` blocks (carried from R11, §14 of the spec).

- [ ] **Step 4: Update the API persistence path**

Run: `grep -rn "migrate_inputs_to_v8" app/` and change every production call site to `migrate_inputs_to_v9`.

- [ ] **Step 5: Run**

Run: `pytest tests/test_migrate_v9.py -q && pytest -q`
Expected: PASS, baseline + the new tests.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/migrate.py app/api/app.py tests/test_migrate_v9.py tests/conftest.py
git commit -m "feat(r12): python v8->v9 migration and persistence boundary (spec 18.7)"
```

---

## Task 8: The two migration identity gates

Implements **§18.7**'s gate pair and **guard 6 of §13**. This is the task most likely to catch a real defect — run it before Task 9 changes any validation rule, so it measures the migration alone.

**Files:**
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts`
- Modify: `tests/test_financial_model_fixtures.py`
- Modify: `tests/test_migrate_v9.py`

**Interfaces:**
- Consumes: `migrateInputsToV9` / `migrate_inputs_to_v9`, `runAppraisal`, `validateInputs`.
- Produces: `PROGRAMME_FIELD_ALIASES` (exported from the test module so the three-entry assertion can read it).

- [ ] **Step 1: Check the file's EOL before touching it**

Run: `git ls-files --eol frontend/src/lib/model/golden-fixtures.test.ts`
Expected: `i/lf`. R11 found this exact file committed as a binary blob — CRLF plus six NUL bytes — which no suite could see and ripgrep refused to read. If it is not `i/lf`, fix the file's encoding before adding anything to it.

- [ ] **Step 2: Write the numeric identity gate**

```ts
// frontend/src/lib/model/golden-fixtures.test.ts
describe('v8 → v9 migration identity — spec §18.7 gate 1 (numeric)', () => {
  it.each(FIXTURE_NAMES)('%s: every computed figure is penny-identical', (name) => {
    const raw = loadFixture(name);
    const before = runAppraisal(migrateInputsToV8(raw.inputs));
    const after = runAppraisal(migrateInputsToV9(raw.inputs));
    // Compare the whole result, not a chosen list of metrics — a hand-picked
    // list is a guard that only watches what its author remembered.
    expect(stripVersionFields(after)).toEqual(stripVersionFields(before));
  });
});
```

`stripVersionFields` removes `calc_version` and the new `schedule.programme` block, which legitimately differ (2.10.0 vs 2.11.0; `null` vs the migrated network's derivation). Everything else must match exactly.

- [ ] **Step 3: Write the validation identity gate with its bounded alias**

`PROGRAMME_FIELD_ALIASES` is imported from `migrate.ts` (Task 6), where it is
**derived** from `PACKAGE_TO_PHASE`. It is not redefined here: a second
hand-written copy could gain a fourth entry without anything failing, which is
exactly the property the exemption must not have.

```ts
import { PROGRAMME_FIELD_ALIASES } from './migrate';

const canonical = (i: ValidationIssue) => ({
  severity: i.severity,
  field: PROGRAMME_FIELD_ALIASES[i.field] ?? i.field,
  message: i.message,
});
const sortIssues = (xs: ValidationIssue[]) =>
  xs.map(canonical).sort((a, b) => (a.field + a.message).localeCompare(b.field + b.message));

describe('v8 → v9 migration identity — spec §18.7 gate 2 (validation)', () => {
  it('the alias map has EXACTLY three entries, and each maps name → same name', () => {
    // The bound. R11's lesson was that an exemption must be narrow BY
    // CONSTRUCTION, not by intention — this test is the construction, and
    // because the map is derived from PACKAGE_TO_PHASE it constrains the
    // migration's phase ids at the same time.
    expect(Object.keys(PROGRAMME_FIELD_ALIASES)).toHaveLength(3);
    expect(Object.keys(PROGRAMME_FIELD_ALIASES).sort())
      .toEqual(['programme.packages.construction', 'programme.packages.professional',
                'programme.packages.statutory']);
    for (const [from, to] of Object.entries(PROGRAMME_FIELD_ALIASES)) {
      // The alias is legitimate ONLY because migration writes id = package name.
      expect(to).toBe(from.replace('.packages.', '.phases.'));
    }
  });

  it.each(FIXTURE_NAMES)('%s: the same issue set before and after', (name) => {
    const raw = loadFixture(name);
    expect(sortIssues(validateInputs(migrateInputsToV9(raw.inputs))))
      .toEqual(sortIssues(validateInputs(migrateInputsToV8(raw.inputs))));
  });

  // R11's actual failure: the v8 migration gave every document a block whose
  // default made every term<=2 appraisal a hard error, so the migration
  // silently downgraded them to DRAFT while the numeric gate stayed green.
  it.each([1, 2, 3])('term-%i synthetic documents keep their issue set', (term) => {
    for (const name of FIXTURE_NAMES) {
      const raw = loadFixture(name);
      const shortened = withTermMonths(raw.inputs, term);
      expect(sortIssues(validateInputs(migrateInputsToV9(shortened))))
        .toEqual(sortIssues(validateInputs(migrateInputsToV8(shortened))));
    }
  });

  it('a term-2 document WITH a programme really does produce issues', () => {
    // Negative control: if the synthetic documents happened to be valid, the
    // test above would pass while asserting nothing. This proves the term-2
    // case is the hard case — exactly where R11's defect lived.
    const shortened = withTermMonths(loadFixture('h-programme-scurve').inputs, 2);
    expect(validateInputs(migrateInputsToV9(shortened)).some((i) => i.severity === 'error')).toBe(true);
  });
});
```

- [ ] **Step 4: Mirror both gates in Python**

Add the same two gates to `tests/test_financial_model_fixtures.py`, with `PROGRAMME_FIELD_ALIASES` and the three-entry assertion. The Python `validate_inputs` returns the same `(severity, field, message)` triples, so the canonicalisation is identical.

- [ ] **Step 5: Run both**

Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts` then `pytest tests/test_financial_model_fixtures.py -q`
Expected: PASS.

**If the term-1/term-2 gate fails, stop and read the diff before changing anything.** A new issue appearing post-migration means the v9 shape is not inert — that is R11's defect reproduced, and the fix belongs in `migrateV8toV9` or in the phase model's defaults, never in the gate.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/model/golden-fixtures.test.ts tests/test_financial_model_fixtures.py tests/test_migrate_v9.py
git commit -m "test(r12): v8->v9 numeric and validation identity gates, alias bounded to three (spec 18.7, guard 6)"
```

---

## Task 9: Validation rules (TypeScript)

Implements **§18.8**.

**Files:**
- Modify: `frontend/src/lib/model/validation.ts:659-691` — replace the programme block
- Modify: `frontend/src/lib/model/validation.test.ts`

**Interfaces:**
- Consumes: `derivePhases`, `PRE_COMPLETION_CODES` from `programme.ts`.
- Produces: no new exports; `validateInputs` gains rules.

- [ ] **Step 1: Write the failing validation tests**

One test per row of §18.8's table. Each asserts the **field** and a distinctive fragment of the **message** — the Python mirror in Task 10 asserts the same strings, and that is the parity check.

```ts
describe('programme network validation — spec §18.8', () => {
  const docWith = (phases: Phase[], term = 24, extra: Partial<ProgrammeNetwork> = {}) => ({
    ...v9Document(),
    finance: { ...v9Document().finance, term_months: term },
    programme: { anchor_month: null, phases,
      category_phase_ids: { construction: phases[0]?.id ?? 'x', professional: phases[0]?.id ?? 'x', statutory: phases[0]?.id ?? 'x' },
      ...extra },
  });
  const errs = (d: unknown) => validateInputs(d as never).filter((i) => i.severity === 'error');

  it('rejects a duplicate phase id', () => {
    const e = errs(docWith([phase('a', 'planning', 2), phase('a', 'design', 2)]));
    expect(e.some((i) => i.field === 'programme.phases.a' && /Duplicate phase id/.test(i.message))).toBe(true);
  });

  it('rejects a dependency naming an absent phase', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [{ phase_id: 'ghost', type: 'FS', lag_months: 0 }])]));
    expect(e.some((i) => /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects a self-reference', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }])]));
    expect(e.some((i) => /cannot depend on itself/.test(i.message))).toBe(true);
  });

  it('names the cycle in order', () => {
    const e = errs(docWith([
      phase('a', 'planning', 2, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
      phase('b', 'conditions', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
    ]));
    expect(e.some((i) => i.field === 'programme.phases' && /→/.test(i.message))).toBe(true);
  });

  it('rejects a negative duration, lag or start_offset but ALLOWS a negative slip', () => {
    expect(errs(docWith([phase('a', 'planning', -1)])).length).toBeGreaterThan(0);
    expect(errs(docWith([phase('a', 'planning', 2, [], { start_offset: -1 })])).length).toBeGreaterThan(0);
    expect(errs(docWith([phase('a', 'planning', 2, [{ phase_id: 'a2', type: 'FS', lag_months: -1 }]),
                         phase('a2', 'design', 1)])).length).toBeGreaterThan(0);
    // signed slip is legal (§18.2) as long as the resolved start stays >= 0
    expect(errs(docWith([phase('a', 'planning', 2, [], { start_offset: 3, slip_months: -1 })]))).toEqual([]);
  });

  it('rejects a fractional slip', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [], { slip_months: 1.5 })]));
    expect(e.some((i) => /whole number of months/.test(i.message))).toBe(true);
  });

  it('rejects over-acceleration below month 0 rather than clamping it', () => {
    const e = errs(docWith([phase('a', 'planning', 2, [], { start_offset: 1, slip_months: -3 })]));
    expect(e.some((i) => i.field === 'programme.phases.a' && /before month 0/.test(i.message))).toBe(true);
  });

  it('rejects category_phase_ids pointing at an absent phase or a milestone', () => {
    const ms = [phase('a', 'construction', 4), phase('pc', 'practical_completion', 0)];
    expect(errs(docWith(ms, 24, { category_phase_ids: { construction: 'ghost', professional: 'a', statutory: 'a' } }))
      .some((i) => i.field === 'programme.category_phase_ids.construction')).toBe(true);
    expect(errs(docWith(ms, 24, { category_phase_ids: { construction: 'pc', professional: 'a', statutory: 'a' } }))
      .some((i) => /milestone/.test(i.message))).toBe(true);
  });

  it('rejects a cost line tagged to a milestone or an absent phase', () => {
    const d = docWith([phase('a', 'construction', 4), phase('pc', 'practical_completion', 0)]);
    d.cost_plan = { ...detailedCostPlan(), packages: [{ ...detailedCostPlan().packages[0], phase_id: 'pc' }] };
    expect(errs(d).some((i) => /milestone/.test(i.message))).toBe(true);
  });

  it('rejects an empty phases array', () => {
    expect(errs(docWith([])).some((i) => i.field === 'programme.phases')).toBe(true);
  });

  it('§18.8 OVERRUN: names the phase and the overrun in months', () => {
    const e = errs(docWith([
      phase('c', 'construction', 9),
      phase('m', 'marketing', 15, [{ phase_id: 'c', type: 'FS', lag_months: 0 }]),
    ], 18));
    const overrun = e.find((i) => /after maturity/.test(i.message));
    expect(overrun).toBeDefined();
    expect(overrun!.message).toContain("Phase 'm'");
    expect(overrun!.message).toContain('6 months');  // finish 24 vs term 18
  });

  it('§18.8 TAIL: binds pre-completion codes and NOT marketing', () => {
    // construction finishing at term-1 breaches the tail...
    expect(errs(docWith([phase('c', 'construction', 23)], 24))
      .some((i) => /sale tail/.test(i.message))).toBe(true);
    // ...but marketing finishing there does not
    expect(errs(docWith([phase('m', 'marketing', 23)], 24))
      .some((i) => /sale tail/.test(i.message))).toBe(false);
  });

  it('§18.8 TAIL: `other` gets the weaker overrun rule, not the tail rule', () => {
    expect(errs(docWith([phase('o', 'other', 23)], 24))
      .some((i) => /sale tail/.test(i.message))).toBe(false);
  });

  it('a migrated three-phase network produces the SAME tail issue as its v8 twin', () => {
    // This is the property Task 8's alias map depends on. Asserted here too,
    // at the rule, so a scope change to PRE_COMPLETION_CODES fails twice.
    const v8 = { ...v8Document(), finance: { ...v8Document().finance, term_months: 6 },
      programme: { anchor_month: null, packages: {
        construction: { start_offset: 0, duration_months: 6, curve: { kind: 'straight_line' as const } },
        professional: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' as const } },
        statutory: { start_offset: 0, duration_months: 1, curve: { kind: 'straight_line' as const } } } } };
    const beforeFields = validateInputs(v8 as never).map((i) => i.field).sort();
    const afterFields = validateInputs(migrateV8toV9(v8 as never)).map((i) => i.field).sort();
    expect(afterFields).toEqual(beforeFields.map((f) => PROGRAMME_FIELD_ALIASES[f] ?? f).sort());
  });
});
```

Plus the anchor and scenario-slip rules:

```ts
describe('anchors and scenario slip — §18.6/§18.8/§18.9', () => {
  it('rejects an anchor naming an absent phase', () => {
    const d = docWithTranche({ anchor: { phase_id: 'ghost', offset_months: 0 }, month_offset: 0 });
    expect(errs(d).some((i) => i.field === 'sales_phasing.tranches[0].anchor'
      && /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects RESOLVED tranche months that are not strictly increasing', () => {
    // Two tranches anchored to DIFFERENT phases can cross when one slips. The
    // rule reads the resolved months, not the entered ones — a document whose
    // entered offsets ascend can still resolve out of order.
    const d = docWithTranches([
      { anchor: { phase_id: 'unit_completions', offset_months: 0 }, month_offset: 0, pct_of_gross_receipts: 40 },
      { anchor: { phase_id: 'sales', offset_months: 0 }, month_offset: 0, pct_of_gross_receipts: 60 },
    ]);
    const crossed = withSlip(d, 'unit_completions', 9); // pushes tranche 0 past tranche 1
    expect(errs(crossed).some((i) => i.field === 'sales_phasing.tranches[1]'
      && /strictly increasing/.test(i.message))).toBe(true);
    // Negative control: unslipped, the same document is clean.
    expect(errs(d)).toEqual([]);
  });

  it('rejects a scenario phase_slip_phase_id naming an absent phase', () => {
    const d = { ...networkDoc() };
    d.scenarios.downside = { ...d.scenarios.downside, phase_slip_phase_id: 'ghost', phase_slip_months: 3 };
    expect(errs(d).some((i) => i.field === 'scenarios.downside.phase_slip_phase_id'
      && /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects a scenario phase_slip_phase_id set while programme is null', () => {
    // A slip with nothing to slip must not be a silent no-op — that is what
    // would make the lever look live while doing nothing (§18.9).
    const d = { ...v9Document(), programme: null };
    d.scenarios.downside = { ...d.scenarios.downside, phase_slip_phase_id: 'planning', phase_slip_months: 3 };
    expect(errs(d).some((i) => i.field === 'scenarios.downside.phase_slip_phase_id'
      && /has no programme network/.test(i.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: FAIL on every new test.

- [ ] **Step 3: Replace the programme block in `validation.ts`**

Replace lines 659-691. Keep the existing `ProgrammePackage` arm reachable for v4–v8 documents (dispatch on whether `programme` has `packages` or `phases`), because `validateInputs` is called on pre-migration documents by Task 8's gate.

Key implementation notes:
- Run the id/dependency/scalar rules **first**. Only call `derivePhases` once they pass — a network with a dangling reference has already produced its error, and deriving it would report a second, confusing one.
- On a cycle, emit **only** the cycle error and skip every window rule. Dates do not exist.
- The overrun message is exactly: `` `Programme finishes month ${finish}; facility term is ${term}. Phase '${label}' ends ${overrun} months after maturity.` ``
- The tail message is §6.1's existing string, unchanged, so the alias map's message comparison holds.

- [ ] **Step 4: Run**

Run: `cd frontend && npx vitest run`
Expected: PASS. The Task 8 gates must still be green — if the tail-rule scope broke them, `PRE_COMPLETION_CODES` is wrong.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/validation.ts frontend/src/lib/model/validation.test.ts
git commit -m "feat(r12): programme network validation, overrun and scoped sale tail (spec 18.8)"
```

---

## Task 10: Validation rules (Python mirror)

**Files:**
- Modify: `app/financial_model/validation.py:736-780`
- Modify: `tests/test_financial_model_validation.py`

- [ ] **Step 1: Port every test from Task 9**, asserting the **same field strings and the same message text**.

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_financial_model_validation.py -x -q`

- [ ] **Step 3: Port the rules**, keeping the existing `programme.packages` arm for v4–v8 documents (the Python arm dispatches on `getattr(programme, "phases", None) is not None`).

- [ ] **Step 4: Run**

Run: `pytest -q`
Expected: PASS.

- [ ] **Step 5: Parity check**

Run: `grep -o "'[^']*sale tail[^']*'" frontend/src/lib/model/validation.ts` and the Python equivalent; confirm the message strings are byte-identical. Do the same for the overrun message. A drifted message silently breaks Task 8's cross-engine comparison.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/validation.py tests/test_financial_model_validation.py
git commit -m "feat(r12): python mirror of the programme network validation (spec 18.8)"
```

---

## Task 11: Wire the schedule to the phases (TypeScript)

Implements **§18.5**. This is where the programme stops being decorative.

**Files:**
- Modify: `frontend/src/lib/model/schedule.ts:31-93`
- Modify: `frontend/src/lib/model/schedule.test.ts`

**Interfaces:**
- Consumes: `derivePhases` (Task 1), `CostPlanResult` (unchanged).
- Produces: `resolvedPhaseId(line, network): string`.

- [ ] **Step 1: Write the failing wiring tests**

```ts
describe('phase-driven spend — §18.5', () => {
  it('headline totals spread over the phases category_phase_ids names', () => {
    // construction phase [4,8) with straight_line; assert uses[4..7] carry the
    // construction total and uses[0..3] carry none of it — ABSOLUTE months.
  });

  it('GUARD 5: repointing category_phase_ids.professional changes the spend profile', () => {
    // Two documents identical but for the map. Without this, the map could be
    // read by nothing and every test would still pass.
    const a = docWithMap({ professional: 'design' });
    const b = docWithMap({ professional: 'construction' });
    expect(buildSchedule(a).uses.map((u) => u.professional_pence))
      .not.toEqual(buildSchedule(b).uses.map((u) => u.professional_pence));
  });

  it('a per-line phase_id overrides the category default', () => {
    // detailed mode: tag one package to `strip_out`, assert its money lands in
    // the strip_out window and NOT in the construction window.
  });

  it('acquisition stays at month 0 regardless of the acquisition phase window', () => {
    // §18.5's first surviving anchor.
  });

  it('prior_approval stays at month 0 by default and moves only when tagged', () => {
    // §18.5's second surviving anchor — the one that holds migration identity.
    expect(buildSchedule(untagged).uses[0].statutory_pence).toBeGreaterThan(0);
    expect(buildSchedule(taggedToPlanning).uses[0].statutory_pence).toBe(0);
  });

  it('every window still sums to its total exactly (the residue invariant)', () => {
    const s = buildSchedule(networkDoc);
    expect(s.uses.reduce((t, u) => t + u.construction_pence, 0)).toBe(s.totals.construction_pence);
    expect(s.uses.reduce((t, u) => t + u.professional_pence, 0)).toBe(s.totals.professional_pence);
  });

  it('GUARD 2: slipping a critical phase moves the successor start AND peak debt, absolutely', () => {
    const base = runAppraisal(networkDoc);
    const slipped = runAppraisal(withSlip(networkDoc, 'planning', 3));
    // Absolute, not directional — R11's fifth vacuous guard was blind to a
    // constant added to both sides.
    const start = (r: typeof base, id: string) =>
      r.schedule.programme!.phases.find((p) => p.id === id)!.start_month;
    expect(start(slipped, 'construction')).toBe(EXPECTED_ABSOLUTE_START);
    expect(slipped.metrics.peak_debt_pence).toBe(EXPECTED_ABSOLUTE_PEAK_DEBT);
    expect(slipped.metrics.peak_debt_pence).not.toBe(base.metrics.peak_debt_pence);
  });

  it('the auto path is untouched when programme is null', () => {
    // Byte-identical to calc 2.10.0 — this is decision 6's whole point.
  });
});
```

Derive `EXPECTED_ABSOLUTE_START` and `EXPECTED_ABSOLUTE_PEAK_DEBT` **by hand from the spec**, not by running the code and pasting the output. A pinned figure copied from the implementation asserts only that the implementation has not changed, which is R9's self-referential trap.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/schedule.test.ts`

- [ ] **Step 3: Implement**

Replace the `else` arm at `schedule.ts:79-93`:

```ts
/** §18.5. The ONE resolution rule, both cost modes. A line's override and the
 *  category default can never both apply. */
export function resolvedPhaseId(
  phaseId: string | null,
  category: 'construction' | 'professional' | 'statutory',
  network: ProgrammeNetwork,
): string {
  return phaseId ?? network.category_phase_ids[category];
}
```

and place each total through it. Detailed mode iterates `costPlan.packages` and `costPlan.fees` so each line lands in its own window; headline mode has no rows and routes the three totals through the map directly. `prior_approval` keeps its month-0 pin unless `phase_id` is set — the existing code-keyed split at `schedule.ts:41-47` becomes the *default*, not the rule.

Set the `programme` result block on the returned `Schedule` from the derivation.

- [ ] **Step 4: Run the full suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, including Task 8's identity gates. **The gates are the real check here**: if a fixture's figures moved, the migrated three-phase network is not reproducing the v8 windows.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/schedule.ts frontend/src/lib/model/schedule.test.ts
git commit -m "feat(r12): cost lines resolve to phases and spread over derived windows (spec 18.5, guards 2 and 5)"
```

---

## Task 12: Wire the schedule to the phases (Python mirror)

**Files:**
- Modify: `app/financial_model/schedule.py:256-296`
- Modify: `tests/test_financial_model_schedule.py`

- [ ] **Step 1: Port every test from Task 11**, with the same absolute expected figures.
- [ ] **Step 2: Run to verify failure** — `pytest tests/test_financial_model_schedule.py -x -q`
- [ ] **Step 3: Port `resolved_phase_id` and the placement loop.** Keep the documented lower clamp (`max(0, ...)`) — Python's negative indexing would silently wrap to the end of the list, which is why it exists.
- [ ] **Step 4: Run** — `pytest -q`. Expected: PASS, gates green.
- [ ] **Step 5: Commit**

```bash
git add app/financial_model/schedule.py tests/test_financial_model_schedule.py
git commit -m "feat(r12): python mirror of phase-driven spend (spec 18.5)"
```

---

## Task 13: Exit anchors (both engines)

Implements **§18.6** and **guard 4 of §13**.

**Files:**
- Modify: `frontend/src/lib/model/schedule.ts:112-160` (sales phasing), `:145-152` (refinance)
- Modify: `app/financial_model/schedule.py` (mirrors)
- Modify: both `schedule.test.ts` / `test_financial_model_schedule.py`

- [ ] **Step 1: Write the failing anchor tests, both arms**

```ts
describe('exit anchors — §18.6, guard 4', () => {
  it('an anchored tranche and its absolute twin are IDENTICAL at zero slip', () => {
    const anchored = docWithTranche({ anchor: { phase_id: 'unit_completions', offset_months: 0 }, month_offset: 0 });
    const absolute = docWithTranche({ anchor: null, month_offset: 14 }); // = unit_completions start
    expect(buildSchedule(anchored).receipts).toEqual(buildSchedule(absolute).receipts);
  });

  it('and DIVERGE at non-zero slip — without this, anchor is a no-op', () => {
    const anchored = withSlip(docWithTranche({ anchor: { phase_id: 'unit_completions', offset_months: 0 }, month_offset: 0 }), 'planning', 3);
    const absolute = withSlip(docWithTranche({ anchor: null, month_offset: 14 }), 'planning', 3);
    expect(buildSchedule(anchored).receipts).not.toEqual(buildSchedule(absolute).receipts);
    // absolute, not directional:
    expect(buildSchedule(anchored).receipts[17].gross_sale_pence).toBeGreaterThan(0);
    expect(buildSchedule(absolute).receipts[14].gross_sale_pence).toBeGreaterThan(0);
  });

  it('a tranche may anchor to a MILESTONE', () => {
    // practical_completion + 2 — the canonical case, and why milestones carry a
    // start even though they occupy no month.
    const doc = docWithTranche({ anchor: { phase_id: 'practical_completion', offset_months: 2 }, month_offset: 0 });
    const pc = derivePhases(doc.programme!) as ProgrammeDerivation;
    const s = buildSchedule(doc);
    expect(s.receipts[pc.byId.practical_completion.start_month + 2].gross_sale_pence).toBeGreaterThan(0);
    expect(validateInputs(doc).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refinance anchors the same way', () => {
    const anchored = docWithRefinance({ anchor: { phase_id: 'unit_completions', offset_months: 1 }, month_offset: 0 });
    const uc = (derivePhases(anchored.programme!) as ProgrammeDerivation).byId.unit_completions;
    expect(buildSchedule(anchored).refinance!.month).toBe(uc.start_month + 1);
  });

  it('two anchored tranches that CROSS when one slips are a hard error', () => {
    // §18.8's resolved-order rule. A slip that reorders tranches is a finding,
    // not something to sort silently — the receipts would otherwise reorder
    // without anyone being told.
    const doc = withSlip(docWithTwoAnchoredTranches(), 'unit_completions', 9);
    expect(validateInputs(doc).some((i) => i.severity === 'error' && /strictly increasing/.test(i.message)))
      .toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**, both engines.
- [ ] **Step 3: Implement** `resolvedTrancheMonth` / `resolved_tranche_month` in both engines and route `sales_phasing` and `refinance` through it. Validation (Tasks 9/10) already owns the strictly-increasing rule on the **resolved** months.
- [ ] **Step 4: Run both suites.** Expected: PASS, gates green (every fixture migrates to `anchor: null`, so nothing moves).
- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/schedule.ts app/financial_model/schedule.py frontend/src/lib/model/schedule.test.ts tests/test_financial_model_schedule.py
git commit -m "feat(r12): sale tranches and refinance anchor to phases (spec 18.6, guard 4)"
```

---

## Task 14: The `phase_slip` lever (both engines)

Implements **§18.9** and **guard 7 of §13**.

**Files:**
- Modify: `frontend/src/lib/model/apply-scenario.ts:27-90`, `frontend/src/lib/model/sensitivity.ts:19-23,138-205`
- Modify: `app/financial_model/apply_scenario.py`, `app/financial_model/sensitivity.py`
- Modify: `frontend/src/lib/model/sensitivity.test.ts`, `tests/test_financial_model_sensitivity.py`, `tests/test_financial_model_apply_scenario.py`

- [ ] **Step 1: Write the failing tests**

```ts
describe('phase_slip lever — §18.9', () => {
  it('applyScenario adds the slip ADDITIVELY to the named phase only', () => {
    const doc = networkDocWithBaseSlip('planning', 1);
    const out = applyScenario(doc, { ...zeroOverrides, phase_slip_phase_id: 'planning', phase_slip_months: 3 });
    expect(out.programme!.phases.find((p) => p.id === 'planning')!.slip_months).toBe(4); // 1 + 3
    expect(out.programme!.phases.find((p) => p.id === 'construction')!.slip_months).toBe(0);
  });

  it('a null phase_slip_phase_id matches no phase — the migration no-op', () => {
    const doc = networkDoc();
    expect(applyScenario(doc, zeroOverrides).programme).toEqual(doc.programme);
  });

  it('GUARD 7: all FIVE levers compose order-independently', () => {
    const levers = { gdv: 5, construction_cost: -3, timeline: 2, interest_rate: 1, phase_slip: 2 };
    const orders = [/* several permutations */];
    const results = orders.map((o) => runAppraisal(applyInOrder(networkDoc(), o, levers)).metrics);
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it('rows and cols may both be phase_slip when they target DIFFERENT phases', () => {
    expect(validateSensitivityConfig({
      rows: { lever: 'phase_slip', phase_id: 'planning', steps: [0, 3] },
      cols: { lever: 'phase_slip', phase_id: 'construction', steps: [0, 3] },
      tornado: [],
    }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects a phase_slip axis with a null phase_id, and a non-phase_slip axis with one set', () => {
    const bad1 = validateSensitivityConfig({
      rows: { lever: 'phase_slip', phase_id: null, steps: [0, 3] },
      cols: { lever: 'gdv', phase_id: null, steps: [0, 5] }, tornado: [],
    });
    expect(bad1.some((i) => i.field === 'sensitivity.rows.phase_id')).toBe(true);

    const bad2 = validateSensitivityConfig({
      rows: { lever: 'gdv', phase_id: 'planning', steps: [0, 5] },
      cols: { lever: 'construction_cost', phase_id: null, steps: [0, 5] }, tornado: [],
    });
    expect(bad2.some((i) => i.field === 'sensitivity.rows.phase_id')).toBe(true);
  });

  it('rejects a phase_slip axis naming a phase the document does not carry', () => {
    const e = validateSensitivityConfig({
      rows: { lever: 'phase_slip', phase_id: 'ghost', steps: [0, 3] },
      cols: { lever: 'gdv', phase_id: null, steps: [0, 5] }, tornado: [],
    }, networkDoc());
    expect(e.some((i) => /no phase with id "ghost"/.test(i.message))).toBe(true);
  });

  it('rejects a fractional phase_slip step, as timeline already does', () => {
    const e = validateSensitivityConfig({
      rows: { lever: 'phase_slip', phase_id: 'planning', steps: [0, 1.5] },
      cols: { lever: 'gdv', phase_id: null, steps: [0, 5] }, tornado: [],
    }, networkDoc());
    expect(e.some((i) => i.field === 'sensitivity.rows.lever')).toBe(true);
  });

  it('an overrunning slip produces an INVALID CELL, not a wrong number', () => {
    // §12.7's machinery, unchanged — but the fixture is new.
    const cell = measureAt({ phase_slip: 24 });
    expect(cell.profit_pence).toBeNull();
    expect(cell.validation_errors.some((e) => /after maturity/.test(e.message))).toBe(true);
  });

  it('an over-accelerating slip also produces an invalid cell', () => {
    const cell = measureAt({ phase_slip: -24 });
    expect(cell.profit_pence).toBeNull();
    expect(cell.validation_errors.some((e) => /before month 0/.test(e.message))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**, both engines.

- [ ] **Step 3: Implement**

`apply-scenario.ts` — add to the returned literal:

```ts
    // §18.9. ADDITIVE, not assignment: a base-case slip already recorded on the
    // document is stressed FROM its recorded position rather than overwritten.
    ...(('programme' in inputs) && inputs.programme != null && 'phases' in inputs.programme ? {
      programme: {
        ...inputs.programme,
        phases: inputs.programme.phases.map((p) => (
          p.id === overrides.phase_slip_phase_id
            ? { ...p, slip_months: p.slip_months + overrides.phase_slip_months }
            : p
        )),
      },
    } : {}),
```

`sensitivity.ts` — add `'phase_slip'` to `SensitivityLever` and `LEVER_ORDER`; add `phase_id: string | null` to the axis and tornado-range types; change the rows/cols comparison and the tornado dedupe to key `${lever}:${phase_id ?? ''}`; add the integer-steps rule that `timeline` already has (line 163) to `phase_slip`; extend `overridesFor` to carry the target.

- [ ] **Step 4: Run both suites** — Expected: PASS, all gates green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model app/financial_model tests frontend/src/lib/model/sensitivity.test.ts
git commit -m "feat(r12): phase_slip sensitivity lever, targeted and order-independent (spec 18.9, guard 7)"
```

---

## Task 15: Fixture `s-dated-programme.json` and the corpus

Implements **§14** of the spec.

**Files:**
- Create: `fixtures/financial-model/s-dated-programme.json`
- Modify: `fixtures/financial-model/h-programme-scurve.json` (v5 → keep as v5; it migrates through to v9 — **do not** hand-edit its programme block, the migration is what must produce the network)
- Modify: `frontend/src/lib/model/golden-fixtures.test.ts`, `tests/test_financial_model_fixtures.py` (add `s` to `FIXTURE_NAMES`)

- [ ] **Step 1: Build the fixture by hand.** It must carry, all at once:
  - a fourteen-phase network covering acquisition → maturity_tail, with `practical_completion` and `maturity_tail` as duration-0 milestones;
  - **at least one phase with `total_float_months >= 1`** (guard 1's fixture requirement);
  - an anchored two-tranche sale (`unit_completions + 0`, `unit_completions + 3`);
  - `cost_plan.mode: 'detailed'` with at least one package carrying a `phase_id` override (`enabling_strip_out_asbestos` → `strip_out`);
  - a levered facility with rolled-up interest, so a slip reaches interest and peak debt;
  - `inputs_version: 9`.

- [ ] **Step 2: Hand-derive the expected figures from the spec** and pin them in the fixture's `expected` block — GDV, construction total, peak debt, total interest, profit, the derived `finish_month`, and the `critical_path`. Derive them from §18.2/§18.4/§6.1's arithmetic on paper. **Do not run the engine and paste its output.**

- [ ] **Step 3: Run both corpora**

Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts` and `pytest tests/test_financial_model_fixtures.py -q`
Expected: PASS. A mismatch here is either a hand-derivation error or a real engine defect — **read the difference before changing either side**, and if the engine is right, say so in the commit message.

- [ ] **Step 4: Check the fixture's EOL**

Run: `git ls-files --eol fixtures/financial-model/s-dated-programme.json`
Expected: `i/lf`.

- [ ] **Step 5: Commit**

```bash
git add fixtures/financial-model/s-dated-programme.json frontend/src/lib/model/golden-fixtures.test.ts tests/test_financial_model_fixtures.py
git commit -m "test(r12): fixture S -- fourteen-phase network, slack phase, anchored sale, tagged package"
```

---

## Task 16: The remaining guards, written to fail

Implements **§13**. Guards 1, 2, 4, 5, 6 and 7 landed with their tasks. This task adds **guard 3** and audits the rest.

**Files:**
- Modify: `frontend/src/lib/model/validation.test.ts`, `tests/test_financial_model_validation.py`
- Modify: `frontend/src/lib/model/programme.test.ts`, `tests/test_financial_model_programme.py`

- [ ] **Step 1: Write guard 3 — the cycle negative control**

```ts
it('GUARD 3: a cyclic document errors; its acyclic twin, differing by ONE dependency, does not', () => {
  const cyclic = docWith([
    phase('a', 'planning', 2, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
    phase('b', 'conditions', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
  ]);
  const acyclic = docWith([
    phase('a', 'planning', 2, []),                                          // <- the one difference
    phase('b', 'conditions', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
  ]);
  expect(errs(cyclic).some((i) => /→/.test(i.message))).toBe(true);
  // Without this arm, an over-eager detector that rejected EVERY network passes.
  expect(errs(acyclic)).toEqual([]);
});
```

Mirror it in Python.

- [ ] **Step 2: Audit every guard against R11's five vacuous shapes.** For each of guards 1–7, answer in a comment on the test: *what single-line change to the implementation would make this test fail?* If the honest answer is "none", the guard is vacuous — rewrite it.

Check specifically for R11's five shapes:
1. **type-guaranteed membership** — do not assert `PHASE_CODES.includes(p.code)`; the type guarantees it;
2. **identity true by construction** — do not assert `finish === start + duration`;
3. **`extra='ignore'` defeat** — Task 7's boundary tests assert presence and value, never absence;
4. **algebraic commutativity** — guard 1's fixture must contain a slack phase, asserted;
5. **direction-only blindness** — guards 1, 2 and 4 assert absolute months and absolute money.

- [ ] **Step 3: Confirm the deliberately-omitted guards are absent**

Run: `grep -n "PHASE_CODES.includes\|start_month + .*duration_months ===" frontend/src/lib/model/*.test.ts`
Expected: no matches. These are §13's two named vacuous guards; if they crept in, delete them.

- [ ] **Step 4: Run both suites** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model tests
git commit -m "test(r12): cycle negative control and the vacuous-guard audit (spec 13, guard 3)"
```

---

## Task 17: The phase editor and the Gantt

Implements **§18.10**'s reporting bullet 1. No calculation logic in these components — they read the derivation.

**Files:**
- Create: `frontend/src/components/calculator/PhaseEditor.tsx`, `ProgrammeGantt.tsx`, and a test file for each
- Modify: `frontend/src/components/calculator/ProgrammePage.tsx`, `ProgrammePage.test.tsx`

- [ ] **Step 1: Write the failing component tests** — the phase list renders one row per phase with its derived start/finish and float; the critical path is marked; a cycle renders the validation error and no bars; adding a phase writes a new `Phase` with `slip_months: 0`, `start_offset: 0`, `predecessors: []`; the mode switch from `null` to a network offers a default template and does not fire on cancel.
- [ ] **Step 2: Run to verify failure** — `cd frontend && npx vitest run src/components/calculator/`
- [ ] **Step 3: Implement.** `ProgrammePage.tsx` calls `derivePhases` once and passes the result down; neither child derives anything. The Gantt is CSS grid, one row per phase, bar offset/width from `start_month`/`duration_months`, float shown as a lighter trailing segment, `is_critical` given a distinct token — and a `duration_months: 0` milestone rendered as a marker, not a zero-width bar.
- [ ] **Step 4: Run** — `npx vitest run` and `npx tsc -b` and `npm run lint -- --max-warnings 0`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator
git commit -m "feat(r12): phase editor and programme Gantt with critical path and float (spec 18.10)"
```

---

## Task 18: The memo's programme section

Implements **§18.10**'s reporting bullets 2 and 3.

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`, `export-investment-memo.test.ts`

- [ ] **Step 1: Write the failing memo tests** — the section renders the phase table, the critical path, the derived finish against the facility term, and any base-case slip; a `programme: null` document renders the existing §6 auto-window disclosure and **no** phase table; an overrunning document is DRAFT (via the existing §13.3 `report_safe` path, with no new `DraftReason`).
- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/export-investment-memo.test.ts`
- [ ] **Step 3: Implement**, using `ensureSpace` for the table (R7's keep-together primitive) and `withTextStyle` for every style change. The section reads `schedule.programme` only — no derivation in the generator.
- [ ] **Step 4: Run the report QA suite too** — `npx vitest run src/lib/report-qa` — page-bounds and sparse-page assertions must still hold with the new section.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-investment-memo.test.ts
git commit -m "feat(r12): memo programme section -- phase table, critical path, finish vs maturity (spec 18.10)"
```

---

## Task 19: Specification §18, migration notes, and the gate set

**Files:**
- Modify: `docs/financial-model/calculation-specification.md` — add §18; mark §6.1 superseded for the explicit-programme case; add `phase_slip` to §12.1's lever table; note the `phase_id` resolution in §16
- Modify: `docs/financial-model/migration-notes.md` — the v8 → v9 entry

- [ ] **Step 1: Write §18** into the calculation specification, from the design doc's §18.1–§18.10. The specification is normative and the design doc is the argument — §18 states the rules; it does not repeat the rejected alternatives.

- [ ] **Step 2: Mark §6.1 superseded.** Add at the head of §6.1: *"Superseded for the explicit-programme case by §18 (calc 2.11.0). The `programme = null` auto-window rules in §6 above are unchanged and remain live."* Leave §6's text intact.

- [ ] **Step 3: Add `phase_slip` to §12.1's lever table** with its composition-order statement, and update "There are four" to "There are five".

- [ ] **Step 4: Add the v8 → v9 migration-notes entry**, listing the five additive no-ops and the one field-name alias.

- [ ] **Step 5: Run the whole gate set**

```bash
cd frontend && npx vitest run && npx tsc -b && npm run lint -- --max-warnings 0 && npm run build
cd .. && pytest -q
```

Expected: pytest **above 1607**, vitest **above 1942**, and vitest run **three times** to catch order-dependence (R11's practice). Record the actual counts in the commit message — do not write "all tests pass" without them.

- [ ] **Step 6: EOL sweep over everything this release rewrote**

```bash
git diff --name-only main... | xargs git ls-files --eol | grep -v "i/lf" || echo "all LF"
```

Expected: `all LF`.

- [ ] **Step 7: Commit**

```bash
git add docs/financial-model
git commit -m "docs(r12): calculation specification 18, calc 2.11.0, v8->v9 migration notes"
```

---

## Self-Review

**Spec coverage.** §18.1 → Tasks 1, 4, 5. §18.2 → Tasks 1, 3. §18.3 → Tasks 1, 3, 9. §18.4 → Tasks 2, 3. §18.5 → Tasks 4, 5, 11, 12. §18.6 → Tasks 4, 5, 13. §18.7 → Tasks 6, 7, 8. §18.8 → Tasks 9, 10. §18.9 → Tasks 4, 5, 14. §18.10 → Tasks 4, 17, 18. §13's seven guards → guard 1 Task 2, guard 2 Task 11, guard 3 Task 16, guard 4 Task 13, guard 5 Task 11, guard 6 Task 8, guard 7 Task 14. §14's also-in-scope → Tasks 15, 19, and the stale `migrate.py` headers in Task 7.

**Known thin spots, stated rather than hidden.** Tasks 10, 12, 13, 17 and 18 give test *names and assertions* rather than full test bodies, because each is a port of, or a direct analogue of, code written out in full in its sibling task — Task 10 mirrors Task 9, Task 12 mirrors Task 11. An executor working those tasks reads the sibling first. Tasks 17 and 18 are UI and report work whose exact assertions depend on the existing component and generator structure, which the executor will have open.

**One figure is deliberately unresolved:** `EXPECTED_ABSOLUTE_START` and `EXPECTED_ABSOLUTE_PEAK_DEBT` in Task 11, and fixture S's `expected` block in Task 15. These must be **hand-derived from the spec** at execution time. Writing a number here that I obtained by running the engine would convert an independent check into a self-referential one — R9's trap — so the plan names the derivation, not the answer.
