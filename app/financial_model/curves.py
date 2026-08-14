"""Port of frontend/src/lib/model/curves.ts (spec Sec 6.1, calc 2.2.0).

Float parity rule: the weight arithmetic must match the TS engine as closely as
two runtimes allow, so every expression below keeps curves.ts's exact operation
order and uses ``money_round`` -- the package's Math.round equivalent -- wherever
curves.ts calls ``Math.round``. Both languages evaluate IEEE-754 doubles, and the
basic operations (+ - * /) are correctly rounded, so identical order gives
identical bits for those. ``cos()`` is the exception: it is not required to be
correctly rounded by IEEE-754, so Python's libm and V8's implementation may
differ by roughly 1 ulp on the same argument. That is a real, if unlikely, source
of a one-pence divergence after ``money_round``.

This is not left to chance: the golden fixtures and the parity matrix are the
tripwire -- any such divergence fails them rather than reaching a user. If it
ever does fire, the remedy is a spec amendment (tabulate the curve weights so
both engines read the same fixed numbers instead of each computing ``cos()``),
not a tolerance -- see docs/financial-model/model-governance.md on spec-first
changes.

Port deviation: ``SpendCurve`` itself lives in types.py rather than here (its
TS home), because declaring it here would create an import cycle -- see the
note above ``SimpleSpendCurve`` in types.py.
"""
from __future__ import annotations

import math

from .engine import money_round
from .types import SpendCurve


def _spread_by_weights(total: int, ideal_weights: list[float]) -> list[int]:
    """Spread by ideal per-month fractions: month k = round_half_up(total*w_k),
    final month absorbs the residue (spec Sec 6.1 invariant)."""
    d = len(ideal_weights)
    if d == 0:
        return []
    out = [0] * d
    allocated = 0
    for i in range(d - 1):
        out[i] = money_round(total * ideal_weights[i])
        allocated += out[i]
    out[d - 1] = total - allocated
    return out


def spread_s_curve(total: int, months: int) -> list[int]:
    """Raised-cosine S-curve: cumulative W(k) = (1 - cos(pi*k/D)) / 2."""
    if months <= 0:
        return []
    weights: list[float] = []
    prev = 0.0
    for k in range(1, months + 1):
        cum = (1 - math.cos((math.pi * k) / months)) / 2
        weights.append(cum - prev)
        prev = cum
    return _spread_by_weights(total, weights)


def spread_back_loaded(total: int, months: int) -> list[int]:
    """Linear ramp: w_k = 2k / (D(D+1))."""
    if months <= 0:
        return []
    weights = [(2 * (i + 1)) / (months * (months + 1)) for i in range(months)]
    return _spread_by_weights(total, weights)


def spread_user_defined(total: int, weights: list[float]) -> list[int]:
    """Normalised explicit weights. Callers validate
    length/non-negativity/sum (validation.py) -- this function assumes valid
    input, exactly as spreadUserDefined does."""
    s = sum(weights)
    return _spread_by_weights(total, [w / s for w in weights])


def spread_by_curve(total: int, duration_months: int, curve: SpendCurve) -> list[int]:
    # Imported inside the function, not at module scope: schedule.py imports
    # spread_by_curve at module scope, so a top-level import back into
    # schedule.py would be a hard cycle in Python (ESM tolerates the same
    # mutual import in curves.ts/schedule.ts through hoisting). Same technique
    # migrate.py already uses for money_round.
    from .schedule import spread_straight_line

    if curve.kind == "straight_line":
        return spread_straight_line(total, duration_months)
    if curve.kind == "s_curve":
        return spread_s_curve(total, duration_months)
    if curve.kind == "back_loaded":
        return spread_back_loaded(total, duration_months)
    return spread_user_defined(total, curve.weights)
