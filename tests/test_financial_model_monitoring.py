"""Port of frontend/src/lib/model/monitoring.test.ts (R14 spec Sec 20.2), test for
test and assertion for assertion.

Two additions the TS twin also carries (R14 Task 8, carried from Task 7's review):
the construction/contingency SPLIT POINT is pinned to two hand-derived integers on
``l-retain-all`` (test 4), and the ``reporting_date`` inertness sweep runs on the
levered, rolled-up ``f-dev-finance-12mo`` as well as on ``l-retain-all`` (test 7).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.financial_model.areas import developed_area_sqm
from app.financial_model.cost_plan import CostPlanResult, compute_cost_plan
from app.financial_model.engine import MonthlyModel, run_ledger
from app.financial_model.migrate import migrate_inputs_to_v11
from app.financial_model.monitoring import compute_monitoring_statement, original_budgets
from app.financial_model.schedule import Schedule, build_schedule
from app.financial_model.types import (
    MONITORING_CATEGORIES,
    AnyCalculatorInputs,
    CalculatorInputsV11,
    MonitoringCategory,
    MonitoringInputs,
    MonitoringLineInputs,
    parse_calculator_inputs,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_v11(stem: str) -> CalculatorInputsV11:
    """The corpus document, normalised to v11 (which stamps ``monitoring: None``)."""
    doc = json.loads((FIXTURE_DIR / f"{stem}.json").read_text(encoding="utf-8"))
    return migrate_inputs_to_v11(doc["inputs"])


def _run_doc(inputs: AnyCalculatorInputs) -> tuple[Schedule, MonthlyModel, CostPlanResult]:
    """Exactly what schedule.py does to reach the cost plan, so the split identity
    below is asserted against the same cost plan the schedule's ``uses`` were built
    from. Mirrors monitoring.test.ts's ``runDoc``."""
    schedule = build_schedule(inputs)
    model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
    cost_plan = compute_cost_plan(
        inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units),
    )
    return schedule, model, cost_plan


def _mk_line(
    category: MonitoringCategory,
    current: int, certified: int, paid: int, committed: int, forecast: int,
) -> MonitoringLineInputs:
    return MonitoringLineInputs(
        category=category,
        current_budget_pence=current,
        certified_to_date_pence=certified,
        paid_to_date_pence=paid,
        committed_to_date_pence=committed,
        forecast_to_complete_pence=forecast,
    )


# A hand-written block at ``reporting_month: 3``. Every line satisfies Sec 20.3's
# ``paid <= certified <= committed``; the figures are deliberately all different so a
# column read off the wrong field cannot pass by coincidence.
BASE_LINES: list[MonitoringLineInputs] = [
    #        category        current    certified   paid       committed  forecast
    _mk_line("acquisition", 40_000_000, 40_000_000, 40_000_000, 40_000_000, 0),
    _mk_line("construction", 60_000_000, 25_000_000, 22_000_000, 33_000_000, 27_000_000),
    _mk_line("professional", 8_000_000, 3_000_000, 2_500_000, 4_000_000, 4_500_000),
    _mk_line("statutory", 2_000_000, 900_000, 900_000, 1_200_000, 700_000),
    _mk_line("contingency", 5_000_000, 1_000_000, 1_000_000, 1_500_000, 2_000_000),
]


def _mk_monitoring(**overrides) -> MonitoringInputs:
    base = dict(
        reporting_month=3,
        reporting_date="2026-06-30",
        lines=[line.model_copy(deep=True) for line in BASE_LINES],
        debt_drawn_to_date_pence=0,
        cash_equity_injected_to_date_pence=60_000_000,
        author="A. Surveyor MRICS",
        date="2026-07-02",
        note=None,
    )
    base.update(overrides)
    return MonitoringInputs(**base)


def _with_monitoring(
    inputs: CalculatorInputsV11, monitoring: MonitoringInputs | None,
) -> CalculatorInputsV11:
    out = inputs.model_copy(deep=True)
    out.monitoring = monitoring
    return out


class TestComputeMonitoringStatement:
    """R14 spec Sec 20.2."""

    def test_returns_none_when_monitoring_is_none(self) -> None:
        inputs = _load_v11("l-retain-all")
        assert inputs.monitoring is None
        schedule, model, cost_plan = _run_doc(inputs)
        assert compute_monitoring_statement(schedule, model, inputs, cost_plan) is None

    def test_returns_none_when_the_document_predates_v11(self) -> None:
        """The pre-migration corpus document, parsed as the version it really is:
        ``monitoring`` is ABSENT, not None, and the statement must still be None.
        ``getattr(inputs, "monitoring", None)`` is this engine's structural read,
        standing in for the TS side's ``'monitoring' in inputs``."""
        raw = json.loads((FIXTURE_DIR / "l-retain-all.json").read_text(encoding="utf-8"))
        inputs = parse_calculator_inputs(raw["inputs"])
        assert not hasattr(inputs, "monitoring")
        schedule, model, cost_plan = _run_doc(inputs)
        assert compute_monitoring_statement(schedule, model, inputs, cost_plan) is None

    def test_emits_five_lines_in_category_order_from_a_reversed_input(self) -> None:
        base = _load_v11("l-retain-all")
        reversed_doc = _with_monitoring(
            base, _mk_monitoring(lines=[line.model_copy(deep=True) for line in reversed(BASE_LINES)]),
        )
        schedule, model, cost_plan = _run_doc(reversed_doc)
        statement = compute_monitoring_statement(schedule, model, reversed_doc, cost_plan)
        assert statement is not None
        assert len(statement.lines) == 5
        assert [line.category for line in statement.lines] == list(MONITORING_CATEGORIES)

        # Order is the ONLY difference: the in-order document produces the identical
        # statement.
        in_order = _with_monitoring(base, _mk_monitoring())
        straight = compute_monitoring_statement(schedule, model, in_order, cost_plan)
        assert statement == straight

    def test_holds_the_per_line_column_identities_on_every_category(self) -> None:
        inputs = _with_monitoring(_load_v11("l-retain-all"), _mk_monitoring())
        schedule, model, cost_plan = _run_doc(inputs)
        statement = compute_monitoring_statement(schedule, model, inputs, cost_plan)
        assert statement is not None
        originals = original_budgets(schedule, cost_plan)

        for line in statement.lines:
            entered = next(e for e in BASE_LINES if e.category == line.category)
            assert line.current_budget_pence == entered.current_budget_pence, line.category
            assert line.certified_to_date_pence == entered.certified_to_date_pence, line.category
            assert line.paid_to_date_pence == entered.paid_to_date_pence, line.category
            assert line.committed_to_date_pence == entered.committed_to_date_pence, line.category
            assert line.forecast_to_complete_pence == entered.forecast_to_complete_pence, line.category
            assert line.original_budget_pence == originals[line.category], line.category

            assert line.committed_not_certified_pence == (
                line.committed_to_date_pence - line.certified_to_date_pence
            ), line.category
            assert line.estimated_final_cost_pence == (
                line.committed_to_date_pence + line.forecast_to_complete_pence
            ), line.category
            assert line.variance_vs_original_pence == (
                line.estimated_final_cost_pence - line.original_budget_pence
            ), line.category
            assert line.variance_vs_current_pence == (
                line.estimated_final_cost_pence - line.current_budget_pence
            ), line.category
            # Both of Sec 7's two equivalent forms of the same column.
            assert line.remaining_to_spend_pence == (
                line.estimated_final_cost_pence - line.certified_to_date_pence
            ), line.category
            assert line.remaining_to_spend_pence == (
                line.committed_not_certified_pence + line.forecast_to_complete_pence
            ), line.category

        # The hand-derived construction line, so the identities above cannot pass on
        # all-zeros.
        construction = statement.lines[1]
        assert construction.category == "construction"
        assert construction.committed_not_certified_pence == 8_000_000
        assert construction.estimated_final_cost_pence == 60_000_000
        assert construction.variance_vs_current_pence == 0
        assert construction.remaining_to_spend_pence == 35_000_000

        # R14 Task 8 (carried from Task 7's review): the construction/contingency SPLIT
        # POINT itself, as two hand-derived integers rather than only as the sum
        # identity swept in the corpus test below. `l-retain-all` is a v5 document, so
        # `migrate_inputs_to_v11` builds it a HEADLINE cost plan from the legacy fields:
        #   base_build  = construction_cost_per_sqm_pence x developed_area_sqm
        #               = 100,000 x 400            = 40,000,000
        #   compliance  = fire_safety + sound_insulation + part_l = 0 + 0 + 0 = 0
        #   construction original = base_build + compliance       = 40,000,000
        #   contingency original  = contingency_pct x base_build
        #               = 10% x 40,000,000                        =  4,000,000
        # and 40,000,000 + 4,000,000 is the 44,000,000 the fixture already pins as
        # `construction_cost_pence`. Without these two, an engine that put the WHOLE
        # 44,000,000 on the construction line and 0 on contingency (or split it any
        # other way) would still satisfy the sum identity.
        assert statement.lines[1].original_budget_pence == 40_000_000
        assert statement.lines[4].category == "contingency"
        assert statement.lines[4].original_budget_pence == 4_000_000

    def test_totals_are_the_column_sums_and_contingency_remaining_floors_at_zero(self) -> None:
        inputs = _with_monitoring(_load_v11("l-retain-all"), _mk_monitoring())
        schedule, model, cost_plan = _run_doc(inputs)
        statement = compute_monitoring_statement(schedule, model, inputs, cost_plan)
        assert statement is not None

        assert statement.totals.original_budget_pence == sum(
            line.original_budget_pence for line in statement.lines
        )
        assert statement.totals.current_budget_pence == 115_000_000
        assert statement.totals.certified_to_date_pence == 69_900_000
        assert statement.totals.paid_to_date_pence == 66_400_000
        assert statement.totals.committed_to_date_pence == 79_700_000
        assert statement.totals.committed_not_certified_pence == 9_800_000
        assert statement.totals.forecast_to_complete_pence == 34_200_000
        assert statement.totals.estimated_final_cost_pence == 113_900_000
        assert statement.totals.remaining_to_spend_pence == 44_000_000
        assert statement.totals.variance_vs_original_pence == sum(
            line.variance_vs_original_pence for line in statement.lines
        )
        assert statement.totals.variance_vs_current_pence == -1_100_000

        # 5,000,000 current - 1,000,000 certified.
        assert statement.contingency_remaining_pence == 4_000_000

        # Certified past the current budget floors at 0 rather than reporting negative
        # remaining contingency.
        overspent = _with_monitoring(_load_v11("l-retain-all"), _mk_monitoring(
            lines=[
                _mk_line("contingency", 5_000_000, 6_000_000, 6_000_000, 6_000_000, 0)
                if line.category == "contingency" else line.model_copy(deep=True)
                for line in BASE_LINES
            ],
        ))
        over = compute_monitoring_statement(schedule, model, overspent, cost_plan)
        assert over is not None
        assert over.contingency_remaining_pence == 0

    def test_splits_construction_and_contingency_on_every_corpus_fixture(self) -> None:
        checked = 0
        for path in sorted(FIXTURE_DIR.glob("*.json")):
            doc = json.loads(path.read_text(encoding="utf-8"))
            # Fixture K ('sensitivity') names a `base_fixture` and carries no `inputs`
            # (governance Sec 2.1), so it has no schedule or cost plan of its own.
            if doc.get("kind") == "sensitivity" or doc.get("inputs") is None:
                continue
            inputs = parse_calculator_inputs(doc["inputs"])
            schedule = build_schedule(inputs)
            cost_plan = compute_cost_plan(
                inputs, developed_area_sqm(inputs), len(inputs.unit_mix.units),
            )
            originals = original_budgets(schedule, cost_plan)
            uses_construction = sum(u.construction_pence for u in schedule.uses)
            assert originals["construction"] + originals["contingency"] == uses_construction, path.name
            # The other three columns against their own inception source, same sweep.
            assert originals["acquisition"] == sum(u.acquisition_pence for u in schedule.uses), path.name
            assert originals["professional"] == sum(u.professional_pence for u in schedule.uses), path.name
            assert originals["statutory"] == sum(u.statutory_pence for u in schedule.uses), path.name
            checked += 1
        assert checked > 10

    @pytest.mark.parametrize("stem", ["l-retain-all", "f-dev-finance-12mo"])
    def test_is_inert_to_reporting_date(self, stem: str) -> None:
        """Statements differing only in ``reporting_date`` agree everywhere else.

        Three dates, not two. Every well-formed ISO ``yyyy-mm-dd`` is ten characters
        long, so a pair of them cannot catch an engine that reads only the string's
        LENGTH -- the exact way the TS twin was watched fail (its engine temporarily
        added ``reporting_date.length`` to ``surplus_pence``). The third is a
        timestamp-shaped value: not what Sec 20.1 asks for, but nothing in this module
        validates the field, and it is what a caller stamping an ISO timestamp would
        store. Its length differs, so the sweep is sensitive to both the value and the
        length of the string.

        R14 Task 8 (carried from Task 7's review) runs the sweep on the LEVERED,
        rolled-up ``f-dev-finance-12mo`` as well as on the all-cash ``l-retain-all``:
        on a cash deal the reserve-headroom and undrawn-facility terms are structurally
        0, so a date-dependent break hiding in either of them has nothing to move.
        """
        dates = ["2026-06-30", "2031-12-31", "2026-06-30T09:15:00.000Z"]
        assert len({len(d) for d in dates}) > 1

        base = _load_v11(stem)
        schedule, model, cost_plan = _run_doc(base)
        statements = []
        for reporting_date in dates:
            inputs = _with_monitoring(base, _mk_monitoring(reporting_date=reporting_date))
            statement = compute_monitoring_statement(schedule, model, inputs, cost_plan)
            assert statement is not None
            assert statement.reporting_date == reporting_date
            statements.append(statement)
        for statement in statements[1:]:
            assert _blank_date(statement) == _blank_date(statements[0])

    def test_reconciles_the_funding_side_on_a_serviced_document(self) -> None:
        """f-dev-finance-12mo is a levered, rolled-up document: net 60,000,000 against
        gross 66,000,000, i.e. a 6,000,000 reserve. Flipping ``interest_type`` to
        ``serviced`` is the one change -- Sec 4.3 makes serviced interest an equity use,
        so the reserve earns no credit and ``reserve_headroom_pence`` must be 0 on a
        facility that plainly has one."""
        levered = _load_v11("f-dev-finance-12mo")
        serviced = levered.model_copy(deep=True)
        serviced.finance.interest_type = "serviced"
        block = _mk_monitoring(
            debt_drawn_to_date_pence=20_000_000,
            cash_equity_injected_to_date_pence=20_000_000,
        )
        serviced = _with_monitoring(serviced, block)
        schedule, model, cost_plan = _run_doc(serviced)
        assert model.committed_gross_facility_pence - model.committed_net_facility_pence > 0
        statement = compute_monitoring_statement(schedule, model, serviced, cost_plan)
        assert statement is not None

        assert statement.reserve_headroom_pence == 0
        assert statement.undrawn_net_facility_pence == 40_000_000   # 60,000,000 - 20,000,000
        assert statement.remaining_cash_equity_pence == 15_000_000  # 35,000,000 - 20,000,000
        assert statement.remaining_funding_pence == (
            statement.undrawn_net_facility_pence + statement.remaining_cash_equity_pence
        )

        # The same document left rolled-up DOES credit the reserve -- otherwise the
        # assertion above would pass on an engine that never computes a reserve at all.
        rolled_up = _with_monitoring(levered, block)
        ru_schedule, ru_model, ru_cost_plan = _run_doc(rolled_up)
        rolled_statement = compute_monitoring_statement(
            ru_schedule, ru_model, rolled_up, ru_cost_plan,
        )
        assert rolled_statement is not None
        assert rolled_statement.reserve_headroom_pence > 0
        assert rolled_statement.remaining_funding_pence == (
            rolled_statement.undrawn_net_facility_pence
            + rolled_statement.reserve_headroom_pence
            + rolled_statement.remaining_cash_equity_pence
        )

    def test_reports_a_shortfall_of_exactly_max_zero_minus_surplus(self) -> None:
        """A forecast-to-complete of ten times the scheme's whole value cannot be funded
        by any document: remaining funding is bounded above by the committed facility
        plus committed cash equity, and no viable scheme commits ten scheme-values of
        funding. That makes the sign of ``surplus_pence`` certain here without pinning
        the fixture's own figures."""
        base = _load_v11("l-retain-all")
        probe = build_schedule(base)
        scheme_value = probe.totals.gdv_pence + probe.totals.retained_value_pence
        assert scheme_value > 0
        stressed = []
        for line in BASE_LINES:
            copy = line.model_copy(deep=True)
            if copy.category == "construction":
                copy.forecast_to_complete_pence = 10 * scheme_value
            stressed.append(copy)
        inputs = _with_monitoring(base, _mk_monitoring(lines=stressed))
        schedule, model, cost_plan = _run_doc(inputs)
        statement = compute_monitoring_statement(schedule, model, inputs, cost_plan)
        assert statement is not None

        assert statement.surplus_pence < 0
        assert statement.shortfall_pence == max(0, -statement.surplus_pence)
        assert statement.remaining_uses_pence == (
            statement.totals.remaining_to_spend_pence + statement.forecast_finance_pence
        )
        assert statement.surplus_pence == (
            statement.remaining_funding_pence - statement.remaining_uses_pence
        )

        # An unstressed block on the same document has a positive surplus and therefore
        # a zero shortfall -- max(0, -surplus) is exercised on both of its branches.
        # `l-retain-all` is an all-cash scheme with 90,000,000 of committed cash equity,
        # so this needs the equity still un-injected: the base block's 60,000,000
        # already drawn down leaves only 30,000,000 against 44,000,000 of remaining
        # spend, which is itself a real shortfall.
        healthy = _with_monitoring(base, _mk_monitoring(cash_equity_injected_to_date_pence=0))
        ok = compute_monitoring_statement(schedule, model, healthy, cost_plan)
        assert ok is not None
        assert ok.surplus_pence >= 0
        assert ok.shortfall_pence == 0

    def test_measures_the_three_variances_against_the_inception_ledger(self) -> None:
        base = _load_v11("f-dev-finance-12mo")
        inputs = _with_monitoring(base, _mk_monitoring(
            debt_drawn_to_date_pence=20_000_000,
            cash_equity_injected_to_date_pence=20_000_000,
        ))
        schedule, model, cost_plan = _run_doc(inputs)
        statement = compute_monitoring_statement(schedule, model, inputs, cost_plan)
        assert statement is not None
        m = 3

        planned_draw = planned_equity = planned_cost = 0
        for k in range(m):
            planned_draw += model.months[k].draw_pence + model.months[k].capitalised_fees_pence
            planned_equity += model.months[k].equity_contribution_pence
            u = schedule.uses[k]
            planned_cost += (
                u.acquisition_pence + u.construction_pence
                + u.professional_pence + u.statutory_pence
            )
        assert statement.debt_drawn_variance_pence == 20_000_000 - planned_draw
        assert statement.equity_injected_variance_pence == 20_000_000 - planned_equity
        assert statement.cost_to_date_variance_pence == (
            statement.totals.certified_to_date_pence - planned_cost
        )

        # Forecast finance covers ledger months m..term-1 only.
        forecast_finance = 0
        for k in range(m, schedule.term_months):
            forecast_finance += (
                model.months[k].interest_accrued_pence + model.months[k].capitalised_fees_pence
            )
        assert statement.forecast_finance_pence == forecast_finance
        assert statement.reporting_month == m


def _blank_date(statement):
    """The statement with ``reporting_date`` neutralised, so two statements can be
    compared on every OTHER field at once -- the TS twin's
    ``{ ...s, reporting_date: '' }`` spread."""
    from dataclasses import replace

    return replace(statement, reporting_date="")
