"""Port of frontend/src/lib/model/package-timing.ts (R15b spec Sec 24.2).

A package's place in time, resolved once and read by both compute_cost_plan
(midpoint -> inflation) and build_schedule (per-month share). Pure: knows
nothing about money.

Port deviation: ``resolved_phase_id`` is imported from ``schedule.py``
LAZILY, inside ``compute_package_timing``, not at module scope --
``schedule.py`` will (a later task) import ``compute_package_timing`` at
module scope, and a top-level import back into schedule.py would be a hard
cycle in Python (ESM tolerates the same mutual import in
curves.ts/schedule.ts/package-timing.ts through hoisting). Same technique
curves.py's ``spread_by_curve`` already uses for ``spread_straight_line``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .curves import curve_weights
from .programme import derive_phases, is_legacy_programme, is_programme_network
from .types import AnyCalculatorInputs, SimpleSpendCurve, SpendCurve


@dataclass
class PackageTiming:
    """Mirrors PackageTiming in package-timing.ts, field for field and in order."""

    id: str
    # The resolved phase in a network; None on the auto and legacy arms.
    phase_id: str | None
    start_month: int
    finish_month: int      # half-open, Sec 18.2
    duration_months: int   # >= 1
    curve: SpendCurve
    weights: list[float]   # curve_weights(duration_months, curve)
    midpoint_month: float  # Sum_k weights[k] * (start_month + k)


def compute_package_timing(inputs: AnyCalculatorInputs) -> list[PackageTiming]:
    """R15b spec Sec 24.2. One entry per ``cost_plan.packages[]``, in order --
    the only place a package's window is resolved. ``[]`` when the document
    has no ``cost_plan`` or no packages (headline mode). Mirrors
    computePackageTiming in package-timing.ts."""
    from .schedule import resolved_phase_id

    cost_plan = getattr(inputs, "cost_plan", None)
    packages = cost_plan.packages if cost_plan is not None else []
    if not packages:
        return []
    term = max(1, math.floor(inputs.finance.term_months))
    raw_programme = getattr(inputs, "programme", None)
    network = (
        raw_programme if raw_programme is not None and is_programme_network(raw_programme) else None
    )
    legacy = (
        raw_programme if raw_programme is not None and is_legacy_programme(raw_programme) else None
    )
    derivation = derive_phases(network) if network is not None else None
    phase_by_id = {p.id: p for p in network.phases} if network is not None else None

    out: list[PackageTiming] = []
    for pkg in packages:
        phase_id: str | None = None
        if network is not None:
            phase_id = resolved_phase_id(pkg.phase_id, "construction", network)
            # Mirrors schedule.py's place_in_phase degrade: unreachable post-validation.
            derived = (
                derivation.by_id.get(phase_id)
                if derivation is not None and derivation.cycle is None
                else None
            )
            start = derived.start_month if derived is not None else 0
            duration = max(1, derived.duration_months if derived is not None else 1)
            phase = phase_by_id.get(phase_id) if phase_by_id is not None else None
            curve = phase.curve if phase is not None else SimpleSpendCurve(kind="straight_line")
        elif legacy is not None:
            start = legacy.packages.construction.start_offset
            duration = max(1, legacy.packages.construction.duration_months)
            curve = legacy.packages.construction.curve
        elif term == 1:
            start = 0
            duration = 1
            curve = SimpleSpendCurve(kind="straight_line")
        else:
            start = 1
            duration = max(1, term - 2)
            curve = SimpleSpendCurve(kind="straight_line")
        weights = curve_weights(duration, curve)
        midpoint = 0.0
        for k, w in enumerate(weights):
            midpoint = midpoint + w * (start + k)
        out.append(PackageTiming(
            id=pkg.id, phase_id=phase_id, start_month=start, finish_month=start + duration,
            duration_months=duration, curve=curve, weights=weights, midpoint_month=midpoint,
        ))
    return out
