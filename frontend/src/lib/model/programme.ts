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
    // Every phase is itself a candidate in the finishMonth max (§18.2's
    // comment on the milestone arm applies symmetrically here): an SS-only
    // successor constrains this phase's START, never its FINISH, so a phase
    // with such a successor can still be the one whose own finish sets the
    // programme end. The finishMonth bound must therefore apply to every
    // phase's late finish, not only to phases with zero successors — else an
    // SS successor's late-start can push this phase's late finish past the
    // programme's own finish, manufacturing float that isn't real.
    const own = p.duration_months >= 1 ? finishMonth : finishMonth - 1;
    const succBounds = succs.map(({ id: sid, dep }) => (
      dep.type === 'FS'
        ? lateStart.get(sid)! - dep.lag_months
        : lateStart.get(sid)! + p.duration_months - dep.lag_months
    ));
    const lf = Math.min(own, ...succBounds);
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
