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
    late_finish: dict[str, int] = {}
    for pid in reversed(order):
        p = by_id[pid]
        succs = successors[pid]
        # Spec Sec 18.4, as amended. The own_bound applies to EVERY phase, not
        # only the successorless ones. An SS edge constrains the SUCCESSOR'S
        # START and says nothing about the predecessor's FINISH, so a phase can
        # have successors and still be the phase whose own finish sets the
        # programme end. Bounding only the successorless phases reports free
        # float on a critical phase -- e.g. construction(10) with marketing at
        # SS+6 for 2 shows float 2 when its true float is 0.
        #
        # The milestone arm mirrors Sec 18.2's finish formula: a zero-duration
        # phase contributes start+1 to the finish, so its own bound is
        # finish_month - 1. Without it a trailing maturity_tail milestone --
        # the phase that DEFINES the finish -- reports float 1.
        own_bound = finish_month if p.duration_months >= 1 else finish_month - 1
        lf = min(
            [own_bound] + [
                late_start[sid] - d.lag_months if d.type == "FS"
                else late_start[sid] + p.duration_months - d.lag_months
                for sid, d in succs
            ]
        )
        late_finish[pid] = lf
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
