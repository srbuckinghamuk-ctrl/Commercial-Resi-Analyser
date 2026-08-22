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

  it('reports a three-node cycle in forward dependency order', () => {
    // a depends on c, c depends on b, b depends on a.
    // Forward (dependency) order must read a → b → c → a, NOT the reverse.
    // A 2-node cycle is a palindrome and cannot catch a missing reversal;
    // this one can. (Task 1 review, minor finding.)
    const d = derivePhases(net([
      phase('a', 'planning', 2, [{ phase_id: 'c', type: 'FS', lag_months: 0 }]),
      phase('b', 'design', 2, [{ phase_id: 'a', type: 'FS', lag_months: 0 }]),
      phase('c', 'procurement', 2, [{ phase_id: 'b', type: 'FS', lag_months: 0 }]),
    ]));
    expect('cycle' in d).toBe(true);
    if (!('cycle' in d)) return;
    expect(d.cycle[0]).toBe(d.cycle[d.cycle.length - 1]);
    expect(d.cycle).toEqual(['a', 'b', 'c', 'a']);
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

  // Task 16 falsifiability audit. Single-line change that kills GUARD 1a and
  // GUARD 1b together: programme.ts's forward pass, `floor = Math.max(floor,
  // ref + d.lag_months)` -> `Math.min(...)`. Verified by actually making the
  // change: 1a's finish_month becomes 9 (not 13), 1b's becomes 9 (not 16),
  // and "the fixture used by GUARD 1 really does contain a phase with
  // non-zero float" fails too (every phase becomes equally critical) —
  // reverted after confirming both guards, and every other test in this
  // file, pass again clean.
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
    // Task 2's carried gap (Task 16): the regression this test guards
    // corrupted the critical_path SHAPE, not only the float number, and the
    // float assertions above would not have caught that on their own.
    expect(d.critical_path).toEqual(['a']);
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
