"""Transliteration of frontend/src/lib/model/metrics.test.ts (partial -- only the
Release 2b Task 5 (developer profit break-even, spec Sec 5.12) coverage that has no
existing Python home). Helpers duplicated verbatim from
tests/test_financial_model_engine.py, matching the "tests must be self-contained"
convention already used across both languages' test suites.
"""
from app.financial_model import run_appraisal
from app.financial_model.engine import run_ledger
from app.financial_model.metrics import breakeven_flags, derive_metrics
from app.financial_model.migrate import DEFAULT_FACILITY_TERMS as DEFAULT_FACILITY_TERMS_DICT
from app.financial_model.migrate import default_calculator_inputs_v2, migrate_inputs_to_v4
from app.financial_model.schedule import MonthReceipts, MonthUses, Schedule, ScheduleTotals
from app.financial_model.types import (
    CalculatorInputsV2,
    CalculatorInputsV4,
    EquitySource,
    FacilityTerms,
)

# --- helpers copied verbatim from test_financial_model_engine.py ---


def replace(model: FacilityTerms, **overrides) -> FacilityTerms:
    return model.model_copy(update=overrides)


def uses(**partial) -> MonthUses:
    base = dict(
        acquisition_pence=0, construction_pence=0, professional_pence=0,
        statutory_pence=0, lender_ancillary_fees_pence=0,
    )
    base.update(partial)
    return MonthUses(**base)


def receipts(**partial) -> MonthReceipts:
    base = dict(gross_sale_pence=0, agent_fee_pence=0, selling_legal_pence=0)
    base.update(partial)
    return MonthReceipts(**base)


def mk_schedule(u: list[MonthUses], r: list[MonthReceipts]) -> Schedule:
    def sum_(f):
        return sum(f(x) for x in u)

    gross_sales = sum(x.gross_sale_pence for x in r)
    selling = sum(x.agent_fee_pence + x.selling_legal_pence for x in r)
    return Schedule(
        term_months=len(u), uses=u, receipts=r,
        totals=ScheduleTotals(
            acquisition_pence=sum_(lambda x: x.acquisition_pence),
            construction_pence=sum_(lambda x: x.construction_pence),
            professional_pence=sum_(lambda x: x.professional_pence),
            statutory_pence=sum_(lambda x: x.statutory_pence),
            selling_costs_pence=selling,
            gross_sales_pence=gross_sales,
            gdv_pence=gross_sales,
            retained_value_pence=0,
            cost_before_finance_ex_selling_pence=sum_(
                lambda x: x.acquisition_pence + x.construction_pence
                + x.professional_pence + x.statutory_pence
            ),
        ),
    )


DEFAULT_FACILITY_TERMS = FacilityTerms(**DEFAULT_FACILITY_TERMS_DICT)

TERMS = replace(
    DEFAULT_FACILITY_TERMS,
    funding_source="development_finance",
    day_one_advance_pence=30_000_000,
    committed_net_facility_pence=50_000_000,
    committed_gross_facility_pence=55_000_000,
    annual_interest_rate_pct=12,
    interest_type="rolled_up",
    arrangement_fee_pct=2, arrangement_fee_basis="committed_net_facility",
    exit_fee_pct=1, exit_fee_basis="committed_gross_facility",
    term_months=4, equity_draw_rule="equity_first", sales_sweep_pct=100,
)


def equity(amount: int) -> list[EquitySource]:
    return [EquitySource(
        id="e1", classification="cash", amount_pence=amount, timing_month=0,
        repayment_priority=1, evidence_status="confirmed", notes="",
    )]


USES = [
    uses(acquisition_pence=40_000_000),
    uses(construction_pence=15_000_000),
    uses(construction_pence=10_000_000),
    uses(),
]
SALE = [
    receipts(), receipts(), receipts(),
    receipts(gross_sale_pence=80_000_000, agent_fee_pence=1_600_000),
]
NO_SALE = [receipts(), receipts(), receipts(), receipts()]

# --- end copied helpers ---


class TestDeriveMetricsDeveloperBreakeven:
    """Release 2b Task 5 (spec Sec 5.12): developer_breakeven_pence and the
    developer_breakeven_unsolvable flag."""

    def test_null_when_no_disposal_retain_all_shape(self):
        """Mirrors metrics.test.ts's 'deriveMetrics on retain_all (Fixture D shape)':
        zero gross sales -- no sale price to solve for -- must null the result, even
        though the facility itself is fully drawn and could in principle support a
        senior-breakeven-style computation."""
        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        inputs.finance = TERMS
        inputs.equity_sources = equity(30_000_000)
        schedule = mk_schedule(USES, NO_SALE)
        schedule.totals.retained_value_pence = 80_000_000
        schedule.totals.gdv_pence = 80_000_000
        model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
        r = derive_metrics(inputs, schedule, model)
        assert schedule.totals.gross_sales_pence == 0
        assert r.developer_breakeven_pence is None

    def test_non_null_under_cash_funding_when_a_disposal_exists(self):
        """Debt-independence: developer_breakeven_pence must be computable even when
        there is no facility at all (funding_source == 'cash', peak debt 0), as long as
        the schedule recorded a disposal -- unlike senior_breakeven_pence, which is null
        for every cash deal (fixture A, spec Sec 5.11)."""
        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        inputs.finance = replace(DEFAULT_FACILITY_TERMS, funding_source="cash", term_months=4)
        inputs.equity_sources = equity(65_000_000)
        inputs.acquisition.purchase_price_pence = 40_000_000
        schedule = mk_schedule(USES, SALE)
        model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
        r = derive_metrics(inputs, schedule, model)
        assert model.redemption_balance_at_disposal_pence is None
        assert r.senior_breakeven_pence is None
        assert r.developer_breakeven_pence is not None

    def test_unsolvable_flag_raised_once_when_agent_fee_at_100_pct(self):
        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        inputs.finance = TERMS
        inputs.equity_sources = equity(30_000_000)
        inputs.acquisition.purchase_price_pence = 40_000_000
        inputs.exit_strategy.selling_agent_fee_pct = 100
        schedule = mk_schedule(USES, SALE)  # month 3 disposal -- gross_sales_pence > 0
        model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
        r = derive_metrics(inputs, schedule, model)

        assert schedule.totals.gross_sales_pence > 0
        assert r.developer_breakeven_pence is None
        # Deviation from brief (R3a Task 6): derive_metrics no longer mutates model.flags --
        # the flag now lands on the result's own `flags` list (r.flags), not model.flags.
        # Updated to match the new contract; the assertion content is unchanged.
        flags = [f for f in r.flags if f.code == "developer_breakeven_unsolvable"]
        assert len(flags) == 1
        assert flags[0].severity == "red"
        assert flags[0].month is None
        assert flags[0].amount_pence is None
        assert flags[0].message == "agent fee ≥ 100% — break-even unsolvable"


class TestFlagsOnResult:
    """Transliteration of metrics.test.ts's `flags on result (R3a refactor)`
    describe block (Release 3a Task 6)."""

    def test_derive_metrics_does_not_mutate_model_flags_and_returns_ledger_plus_metric_flags(self):
        run = run_appraisal(CalculatorInputsV4.model_validate(migrate_inputs_to_v4({})))
        before = len(run.model.flags)
        metrics = derive_metrics(run.inputs, run.schedule, run.model)
        assert len(run.model.flags) == before  # purity
        assert metrics.flags[:before] == run.model.flags

    def test_agent_fee_at_100_pct_raises_the_unsolvable_flags_on_the_result_not_the_model(self):
        doc = migrate_inputs_to_v4({})
        # migrate_inputs_to_v4({}) defaults to an empty unit_mix, so no disposal is ever
        # booked and the developer break-even branch (guarded on gross_sales_pence > 0)
        # never runs regardless of fee. Give the fixture one sellable unit --
        # exit_strategy.route defaults to 'sell_all' -- so a solve is actually attempted
        # and can be observed as None.
        doc["unit_mix"] = {"units": [{
            "id": "u1", "type": "1bed", "floor_area_sqm": 50,
            "estimated_value_pence": 30_000_000, "comparable_notes": "",
        }]}
        doc["exit_strategy"]["selling_agent_fee_pct"] = 100
        run = run_appraisal(CalculatorInputsV4.model_validate(doc))
        assert not any(f.code == "developer_breakeven_unsolvable" for f in run.model.flags)
        assert any(f.code == "developer_breakeven_unsolvable" for f in run.metrics.flags)


class TestBreakevenFlags:
    """Transliteration of metrics.test.ts's `breakevenFlags` describe block."""

    def test_fee_at_100_gives_unsolvable_flags_below_100_with_a_null_solve_gives_cap_exhausted(self):
        assert [f.code for f in breakeven_flags(True, False, 100)] == ["senior_breakeven_unsolvable"]
        assert [f.code for f in breakeven_flags(True, False, 2)] == ["breakeven_cap_exhausted"]
        assert [f.code for f in breakeven_flags(False, True, 2)] == ["breakeven_cap_exhausted"]
        assert breakeven_flags(False, False, 2) == []
