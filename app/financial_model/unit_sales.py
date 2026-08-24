"""R13b spec Sec 22. The unit-level sales ledger: per-unit exchange and
completion timing, deposits held or released, per-unit selling-cost overrides,
and the pre-sales coverage figure.

Port of frontend/src/lib/model/unit-sales.ts. This module runs STRICTLY
BEFORE the ledger and reads nothing from it (Sec 17.5's one-direction rule).
It must never import `schedule` or `metrics` -- `schedule.py` imports this
module and hands it the sold set, so the dependency runs one way.
"""
from __future__ import annotations

import math
from typing import Any, Literal, TypedDict

from .engine import money_round, pct
from .programme import derive_phases, is_programme_network

PreSoldBasis = Literal["practical_completion", "first_completion"]


class UnitSaleRow(TypedDict):
    unit_id: str
    gross_pence: int
    exchange_month: int | None
    completion_month: int
    deposit_pence: int
    deposit_released_pence: int
    agent_fee_pence: int
    legal_fee_pence: int
    net_pence: int


class UnitSalesMonth(TypedDict):
    month: int
    exchanged_value_pence: int   # cumulative
    completed_value_pence: int   # cumulative
    deposits_received_pence: int  # released deposits landing this month


class UnitSalesResult(TypedDict):
    deposit_release: str
    units: list[UnitSaleRow]
    months: list[UnitSalesMonth]
    totals: dict[str, int]
    pre_sold: dict[str, Any]


def _clamp_month(m: float, term_months: int) -> int:
    # Belt-and-braces, mirroring schedule.py's tranche placement: validation.py
    # owns the real [0, term-1] rule (Sec 22.7 rule 4).
    return min(max(0, math.floor(m)), term_months - 1)


def _practical_completion_starts(inputs: Any) -> list[int]:
    programme = getattr(inputs, "programme", None)
    if programme is None or not is_programme_network(programme):
        return []
    derivation = derive_phases(programme)
    if derivation.cycle is not None:
        return []
    return [
        derivation.by_id[p.id].start_month
        for p in programme.phases
        if p.code == "practical_completion" and p.id in derivation.by_id
    ]


def compute_unit_sales(
    inputs: Any,
    term_months: int,
    resolve_anchor_month: Any,
    sold_gross: list[tuple[str, int]],
) -> UnitSalesResult | None:
    """Sec 22.2-22.4. `sold_gross` is the schedule's (unit_id, gross) list over
    the SOLD set -- value plus ancillary, the same figure gross_sales sums --
    so `gdv_pence` and `gross_sales_pence` stay equal by construction.
    `resolve_anchor_month` is schedule.py's single resolver. Returns None
    exactly when the input block is None."""
    us = getattr(inputs, "unit_sales", None)
    if us is None:
        return None

    gross_by_id = dict(sold_gross)
    rows = [r for r in us.units if r.unit_id in gross_by_id]  # coverage is validation's (rule 3)
    total_gross = sum(gross_by_id[r.unit_id] for r in rows)
    scheme_agent = inputs.exit_strategy.selling_agent_fee_pct
    scheme_legal = inputs.exit_strategy.selling_legal_fee_pence
    released = us.deposit_release == "released_on_exchange"

    null_legal_ids = [r.unit_id for r in rows if r.legal_fee_pence is None]
    null_legal_base = sum(gross_by_id[u] for u in null_legal_ids)
    legal_allocated = 0

    out_rows: list[UnitSaleRow] = []
    for r in rows:
        g = gross_by_id[r.unit_id]
        deposit = money_round((g * r.deposit_pct) / 100)
        agent_pct = scheme_agent if r.agent_fee_pct is None else r.agent_fee_pct
        agent = money_round((g * agent_pct) / 100)
        if r.legal_fee_pence is not None:
            legal = r.legal_fee_pence
        elif r.unit_id == null_legal_ids[-1]:
            legal = scheme_legal - legal_allocated  # the LAST null-legal row absorbs the residue
        else:
            legal = money_round((scheme_legal * g) / null_legal_base) if null_legal_base > 0 else 0
            legal_allocated += legal
        completion_m = _clamp_month(
            resolve_anchor_month(r.completion.anchor, r.completion.month_offset), term_months,
        )
        exchange_m = (
            None if r.exchange is None
            else _clamp_month(resolve_anchor_month(r.exchange.anchor, r.exchange.month_offset), term_months)
        )
        out_rows.append(UnitSaleRow(
            unit_id=r.unit_id, gross_pence=g, exchange_month=exchange_m, completion_month=completion_m,
            deposit_pence=deposit,
            deposit_released_pence=deposit if (released and exchange_m is not None) else 0,
            agent_fee_pence=agent, legal_fee_pence=legal, net_pence=g - agent - legal,
        ))

    def effective_exchange(row: UnitSaleRow) -> int:
        return row["completion_month"] if row["exchange_month"] is None else row["exchange_month"]

    months: list[UnitSalesMonth] = []
    for m in range(term_months):
        months.append(UnitSalesMonth(
            month=m,
            exchanged_value_pence=sum(x["gross_pence"] for x in out_rows if effective_exchange(x) <= m),
            completed_value_pence=sum(x["gross_pence"] for x in out_rows if x["completion_month"] <= m),
            deposits_received_pence=sum(
                x["deposit_released_pence"] for x in out_rows if x["exchange_month"] == m
            ),
        ))

    pc_starts = _practical_completion_starts(inputs)
    if pc_starts:
        reference_month = min(pc_starts)
        basis: PreSoldBasis = "practical_completion"
    else:
        reference_month = min((x["completion_month"] for x in out_rows), default=0)
        basis = "first_completion"
    exchanged_at_ref = sum(x["gross_pence"] for x in out_rows if effective_exchange(x) <= reference_month)

    return UnitSalesResult(
        deposit_release=us.deposit_release,
        units=out_rows,
        months=months,
        totals={
            "gross_pence": total_gross,
            "deposits_pence": sum(x["deposit_pence"] for x in out_rows),
            "deposits_released_pence": sum(x["deposit_released_pence"] for x in out_rows),
            "agent_fees_pence": sum(x["agent_fee_pence"] for x in out_rows),
            "legal_fees_pence": sum(x["legal_fee_pence"] for x in out_rows),
            "net_pence": sum(x["net_pence"] for x in out_rows),
        },
        pre_sold={
            "reference_month": reference_month,
            "basis": basis,
            "exchanged_value_pence": exchanged_at_ref,
            "pct": pct(exchanged_at_ref, total_gross),
        },
    )
