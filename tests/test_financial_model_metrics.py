"""Transliteration of frontend/src/lib/model/metrics.test.ts (partial -- only the
Release 2b Task 5 (developer profit break-even, spec Sec 5.12) coverage that has no
existing Python home). Helpers duplicated verbatim from
tests/test_financial_model_engine.py, matching the "tests must be self-contained"
convention already used across both languages' test suites.
"""
from dataclasses import fields

import pytest

from app.financial_model import run_appraisal
from app.financial_model.areas import DEFAULT_AREA_BRIDGE
from app.financial_model.engine import money_round, pct, run_ledger
from app.financial_model.metrics import breakeven_flags, derive_metrics
from app.financial_model.migrate import DEFAULT_FACILITY_TERMS as DEFAULT_FACILITY_TERMS_DICT
from app.financial_model.migrate import (
    default_calculator_inputs_v2,
    migrate_inputs_to_v4,
    migrate_inputs_to_v5,
    migrate_inputs_to_v6,
    migrate_inputs_to_v7,
)
from app.financial_model.schedule import (
    MonthReceipts,
    MonthUses,
    Schedule,
    ScheduleRefinance,
    ScheduleTotals,
)
from app.financial_model.types import (
    AcquisitionInputs,
    AcquisitionInputsV5,
    AreaBridgeInputs,
    CalculatorInputsV2,
    CalculatorInputsV4,
    CalculatorInputsV5,
    CalculatorInputsV6,
    CostPlanInputs,
    EquitySource,
    ExitStrategyInputs,
    FacilityTerms,
    ProposedUnit,
    ProposedUnitV6,
    SalesPhasingInputs,
    SalesPhasingTranche,
    UnitAncillary,
    UnitMixInputs,
    UnitMixInputsV6,
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


def _dev_finance_v4() -> CalculatorInputsV4:
    """Mirrors metrics.test.ts's `devFinanceV4` helper: a dev-finance deal with a real
    committed facility, valued units and a sell_all exit -- on a v4 document with a
    committed facility set (unlike the migrate_inputs_to_v4({}) default, whose finance
    has committed_net_facility_pence None -- no draws, no balance,
    redemption_balance_at_disposal_pence stays None). Zero committed equity
    (default_equity_sources()'s amount_pence is 0) forces essentially the whole cost
    stack through the facility, guaranteeing a large non-null redemption balance at
    disposal for the spec Sec 5.11 phased-regime tests below."""
    v4 = CalculatorInputsV4.model_validate(migrate_inputs_to_v4({}))
    v4.acquisition = AcquisitionInputs(
        purchase_price_pence=40_000_000, legal_fees_pence=500_000, survey_cost_pence=300_000,
        broker_fee_pct=1.0, other_acquisition_costs_pence=0,
    )
    v4.unit_mix = UnitMixInputs(units=[
        ProposedUnit(
            id=f"u{n}", type="1bed", floor_area_sqm=50,
            estimated_value_pence=30_000_000, comparable_notes="",
        )
        for n in (1, 2, 3, 4)
    ])
    v4.conversion_costs.construction_cost_per_sqm_pence = 100_000
    v4.conversion_costs.total_construction_sqm = 400
    v4.conversion_costs.contingency_pct = 10
    v4.finance = FacilityTerms(**{
        **DEFAULT_FACILITY_TERMS_DICT,
        "funding_source": "development_finance",
        "committed_net_facility_pence": 150_000_000,
        "committed_gross_facility_pence": 165_000_000,
        "annual_interest_rate_pct": 8,
        "interest_type": "rolled_up",
        "sales_sweep_pct": 100,
        "term_months": 12,
    })
    v4.exit_strategy = ExitStrategyInputs(
        route="sell_all", selling_agent_fee_pct=1.5, selling_legal_fee_pence=400_000,
        retained_units=[],
    )
    return v4


class TestSec511UnderPhasing:
    """Transliteration of metrics.test.ts's `Sec 5.11 under phasing` describe
    block (Release 3b Task 6)."""

    def test_phased_inputs_produce_a_senior_breakeven_from_the_replay_solver(self):
        v4 = _dev_finance_v4()
        v4.sales_phasing = SalesPhasingInputs(tranches=[
            SalesPhasingTranche(month_offset=10, pct_of_gross_receipts=60),
            SalesPhasingTranche(month_offset=11, pct_of_gross_receipts=40),
        ])
        run = run_appraisal(v4)
        assert run.model.redemption_balance_at_disposal_pence is not None
        assert run.metrics.senior_breakeven_pence is not None
        assert not any(f.code == "breakeven_cap_exhausted" for f in run.metrics.flags)

    def test_structural_unsolvability_flags_senior_breakeven_unsolvable_with_a_reason_not_cap_exhausted(self):
        # sweep 0% with phasing: no price redeems
        v4 = _dev_finance_v4()
        v4.finance.sales_sweep_pct = 0
        v4.sales_phasing = SalesPhasingInputs(
            tranches=[SalesPhasingTranche(month_offset=11, pct_of_gross_receipts=100)],
        )
        run = run_appraisal(v4)
        assert run.metrics.senior_breakeven_pence is None
        f = next(x for x in run.metrics.flags if x.code == "senior_breakeven_unsolvable")
        assert "sales sweep" in f.message
        assert not any(x.code == "breakeven_cap_exhausted" for x in run.metrics.flags)


class TestBreakevenFlagsWithAStructuralReason:
    """Transliteration of metrics.test.ts's `breakevenFlags with a structural
    reason` describe block (Release 3b Task 6)."""

    def test_emits_senior_breakeven_unsolvable_with_the_reason_no_cap_flag_for_that_solver(self):
        out = breakeven_flags(False, False, 2, "no sale price redeems — test reason")
        assert [f.code for f in out] == ["senior_breakeven_unsolvable"]
        assert out[0].message == "no sale price redeems — test reason"


def _default_inputs() -> CalculatorInputsV2:
    return CalculatorInputsV2.model_validate(default_calculator_inputs_v2())


class TestDistributedReturnBasis:
    """Spec Sec 3.16.1 (calc 2.6.0) -- mirrors metrics.test.ts's
    'distributed-return basis' block.

    The discriminator is whether the schedule books a realisation event, not
    whether any cash reached equity. A sale that sweeps entirely to senior debt
    returns 0.00x, which is a real answer; a retain-all case has no answer at
    all, and printing zero there told the second audit's reviewer that the
    sponsor had lost its capital.
    """

    def test_multiple_is_zero_when_a_sale_returns_nothing_to_equity(self):
        schedule = mk_schedule(
            [uses(acquisition_pence=50_000_000), uses()],
            [receipts(), receipts(gross_sale_pence=20_000_000)],
        )
        model = run_ledger(schedule, TERMS, equity(5_000_000))
        r = derive_metrics(_default_inputs(), schedule, model)

        assert schedule.totals.gross_sales_pence > 0
        assert model.totals.distributions_pence == 0
        assert r.has_realisation_event is True
        assert r.equity_multiple == 0

    def test_no_multiple_at_all_when_nothing_is_sold_or_refinanced(self):
        schedule = mk_schedule([uses(acquisition_pence=50_000_000)], [receipts()])
        model = run_ledger(schedule, TERMS, equity(50_000_000))
        r = derive_metrics(_default_inputs(), schedule, model)

        assert schedule.totals.gross_sales_pence == 0
        assert schedule.refinance is None
        assert r.has_realisation_event is False
        assert r.equity_multiple is None
        assert r.return_on_equity_is_unrealised is True

    def test_refinance_counts_as_a_realisation_event(self):
        schedule = mk_schedule([uses(acquisition_pence=50_000_000)], [receipts()])
        schedule.refinance = ScheduleRefinance(month=1, net_proceeds_pence=30_000_000)
        model = run_ledger(schedule, TERMS, equity(50_000_000))
        r = derive_metrics(_default_inputs(), schedule, model)

        assert schedule.totals.gross_sales_pence == 0
        assert r.has_realisation_event is True
        assert r.equity_multiple is not None

    def test_retained_value_in_the_profit_makes_return_on_equity_unrealised(self):
        schedule = mk_schedule(
            [uses(acquisition_pence=50_000_000)],
            [receipts(gross_sale_pence=30_000_000)],
        )
        schedule.totals.retained_value_pence = 40_000_000
        model = run_ledger(schedule, TERMS, equity(50_000_000))
        r = derive_metrics(_default_inputs(), schedule, model)

        assert r.has_realisation_event is True
        assert r.profit_is_unrealised is True
        assert r.return_on_equity_is_unrealised is True


# --- R8 (spec Sec 14): acquisition tax is jurisdiction-aware -----------------
# Mirrors metrics.test.ts's "acquisition tax is jurisdiction-aware (R8)" describe
# block test for test, with the same figures.

# 753,482 pounds. England/NI non-residential: 0% to 150k, 2% on the next 100k
# (2,000), 5% on the 503,482 above 250k (25,174.10) = 27,174.10.
_R8_PRICE_PENCE = 75_348_200


def _english_base() -> CalculatorInputsV5:
    inputs = migrate_inputs_to_v5({"inputs_version": 1})
    inputs.acquisition.purchase_price_pence = _R8_PRICE_PENCE
    return inputs


def _tax_inside_acquisition_cost(acq, metrics) -> int:
    """The acquisition tax actually folded into acquisition_cost_pence, recovered
    by subtracting every other component of spec Sec 3.3's acquisition line."""
    return (
        metrics.acquisition_cost_pence
        - acq.purchase_price_pence
        - acq.legal_fees_pence
        - acq.survey_cost_pence
        - money_round((acq.purchase_price_pence * acq.broker_fee_pct) / 100)
        - acq.other_acquisition_costs_pence
    )


class TestAcquisitionTaxIsJurisdictionAware:
    def test_taxes_an_english_appraisal_identically_to_the_pre_r8_engine(self):
        m = run_appraisal(_english_base()).metrics
        assert m.acquisition_tax_pence == 2_717_410
        # The deprecated alias must carry the same value until R16 removes it.
        assert m.sdlt_pence == m.acquisition_tax_pence
        assert m.acquisition_tax.regime == "SDLT"
        assert m.acquisition_tax.jurisdiction == "england_ni"
        assert m.acquisition_tax.basis == "non_residential"

    def test_taxes_a_welsh_appraisal_on_ltt(self):
        inputs = _english_base()
        inputs.acquisition.jurisdiction = "wales"
        inputs.acquisition.acquisition_date = "2026-08-17"
        m = run_appraisal(inputs).metrics
        assert m.acquisition_tax_pence == 2_542_410
        assert m.sdlt_pence == 2_542_410
        assert m.acquisition_tax.regime == "LTT"
        assert m.acquisition_tax.date_basis == "transaction_date"

    def test_taxes_a_scottish_appraisal_on_lbtt(self):
        inputs = _english_base()
        inputs.acquisition.jurisdiction = "scotland"
        inputs.acquisition.acquisition_date = "2026-08-17"
        m = run_appraisal(inputs).metrics
        # 0% to 150k; 1% on the next 100k (1,000); 5% on 503,482 (25,174.10).
        assert m.acquisition_tax_pence == 2_617_410
        assert m.acquisition_tax.regime == "LBTT"

    def test_reports_an_assumed_current_basis_when_no_acquisition_date_is_recorded(self):
        m = run_appraisal(_english_base()).metrics
        assert m.acquisition_tax.date_basis == "assumed_current"

    # Fix round 1 (R8 Task 5). The brief's original test here asserted that an
    # override *changes* the RLV. That is the opposite of what spec Sec 3.18
    # defines, and it passed only while this engine computed the acquisition tax
    # twice from two different band sets. Sec 3.18: cost excluding land = TDC -
    # purchase price - acquisition tax. Once both sites (derive_metrics and
    # calculate_total_acquisition_cost) use the same figure, the tax cancels out
    # of that expression, so the RLV is invariant to it *by design* -- and Sec
    # 3.18's disclosed limitation records exactly this: "finance and SDLT within
    # 'cost excluding land' are those of the appraised structure, not re-solved
    # for the residual price (a fixed-point refinement is R3)". This has always
    # been true for English documents. R8 makes it true for Welsh and Scottish
    # ones too. Do not "fix" this back. Mirrors metrics.test.ts.
    def test_an_override_moves_acquisition_cost_and_tdc_but_leaves_rlv_unchanged(self):
        base = _english_base()
        with_override = base.model_copy(deep=True)
        with_override.acquisition.acquisition_tax_override_pence = 0
        with_override.acquisition.acquisition_tax_override_reason = "Group relief claimed."

        before = run_appraisal(base).metrics
        after = run_appraisal(with_override).metrics

        assert after.acquisition_tax_pence == 0
        assert after.acquisition_tax.is_override is True
        assert after.acquisition_tax.computed_total_pence == 2_717_410

        # The tax really did leave the cost stack -- both figures fall by exactly it.
        assert before.acquisition_cost_pence - after.acquisition_cost_pence == 2_717_410
        assert (
            before.total_development_cost_pence - after.total_development_cost_pence
        ) == 2_717_410
        # ...and the RLV does not move: the tax cancels in cost-excluding-land.
        assert after.rlv_pence == before.rlv_pence

    # The regression guard for fix round 1: acquisition tax is computed in two
    # places -- derive_metrics (reported as acquisition_tax_pence) and
    # calculate_total_acquisition_cost (folded into acquisition_cost_pence, and
    # from there into TDC, profit and every ratio). Before this fix the second
    # site was hard-wired to England/NI, so a Welsh appraisal reported LTT while
    # charging SDLT. This asserts the two can never drift apart again.
    #
    # COVERAGE LIMIT: this guard varies the jurisdiction and the override, but
    # not the acquisition *date*. A date mismatch between the two sites is
    # currently unobservable, because every (jurisdiction, basis) group in
    # TAX_TABLES holds a single open-ended band set -- any date resolves to the
    # same set. **The first time a second dated band set is added to a group,
    # extend this guard with a date case**, or a date read at one site and not
    # the other will pass silently. Mirrors metrics.test.ts.
    @pytest.mark.parametrize(
        "jurisdiction,regime,expected",
        [("wales", "LTT", 2_542_410), ("scotland", "LBTT", 2_617_410),
         ("england_ni", "SDLT", 2_717_410)],
    )
    def test_the_tax_inside_acquisition_cost_pence_is_the_documents_own_figure(
        self, jurisdiction, regime, expected,
    ):
        inputs = _english_base()
        inputs.acquisition.jurisdiction = jurisdiction
        inputs.acquisition.acquisition_date = "2026-08-17"
        m = run_appraisal(inputs).metrics
        assert m.acquisition_tax.regime == regime
        assert m.acquisition_tax_pence == expected

        assert _tax_inside_acquisition_cost(inputs.acquisition, m) == expected

    # Fix round 1: the COVERAGE LIMIT above named an untested axis -- a *bad*
    # date (malformed, or not covered by any band set) reaching the two sites.
    # Both now route through resolve_acquisition_date instead of calling
    # select_band_set directly, so an unusable date degrades to None
    # (assumed-current) instead of raising -- this extends the drift guard
    # onto that axis. Mirrors metrics.test.ts. (Verified this has teeth by
    # reverting calculate_total_acquisition_cost's site alone to the raw,
    # unresolved date: both cases below then fail.)
    @pytest.mark.parametrize("bad_date", ["1990-01-01", "17/08/2026"])
    def test_a_bad_date_degrades_to_the_assumed_current_band_set_at_both_sites(self, bad_date):
        inputs = _english_base()
        inputs.acquisition.acquisition_date = bad_date
        m = run_appraisal(inputs).metrics
        assert m.acquisition_tax.date_basis == "assumed_current"
        assert m.acquisition_tax_pence == 2_717_410
        assert _tax_inside_acquisition_cost(inputs.acquisition, m) == m.acquisition_tax_pence

    # Fix round 2. Pydantic's default revalidate_instances='never' lets a
    # CalculatorInputsV4 hold an AcquisitionInputsV5 instance, so a gate on the
    # *container* (isinstance(inputs, CalculatorInputsV5)) and a gate on the
    # *block* (isinstance(acq, AcquisitionInputsV5)) disagree: derive_metrics
    # would report SDLT while calculate_total_acquisition_cost charges LTT.
    # Not reachable from JSON or the migration chain, but it is exactly the
    # invariant the guard above exists to make unbreakable, and that guard misses
    # it because it only ever builds v5 containers. Both engines now gate on the
    # block; the TS mirror of this test pins the same document shape.
    def test_a_v4_container_carrying_a_v5_acquisition_block_agrees_at_both_sites(self):
        v5 = _english_base()
        v5.acquisition.jurisdiction = "wales"
        v5.acquisition.acquisition_date = "2026-08-17"
        doc = v5.model_dump(mode="json")
        acq5 = AcquisitionInputsV5.model_validate(doc["acquisition"])
        hybrid = CalculatorInputsV4.model_validate(
            {**doc, "inputs_version": 4, "acquisition": acq5},
        )
        # The container really is v4 and the block really is v5 -- if Pydantic ever
        # starts re-validating (revalidate_instances) these two assertions fail
        # first and say so, rather than the test silently going inert.
        assert type(hybrid) is CalculatorInputsV4
        assert isinstance(hybrid.acquisition, AcquisitionInputsV5)

        m = run_appraisal(hybrid).metrics
        assert m.acquisition_tax.regime == "LTT"
        assert m.acquisition_tax_pence == 2_542_410
        assert _tax_inside_acquisition_cost(hybrid.acquisition, m) == m.acquisition_tax_pence

    def test_migration_to_v5_adds_the_two_new_metrics_and_changes_no_other_figure(self):
        """The load-bearing property of R8 Task 5, asserted on a document built
        here rather than read from fixtures/financial-model/ -- the fixture corpus
        makes the same statement through its own pinned `expected` blocks, and
        this test must not depend on those files staying at any particular
        version. Mirrors metrics.test.ts's test of the same name.

        v2-v4 documents carry no jurisdiction at all. Migrating one to v5 is
        purely additive: it must add acquisition_tax_pence and acquisition_tax
        and move nothing else, to the penny -- total development cost, profit,
        every profit ratio, LTC, LTGDV and the RLV all flow through the figure
        being rerouted."""
        v4 = _dev_finance_v4()
        assert v4.inputs_version == 4
        v5 = migrate_inputs_to_v5(v4.model_dump(mode="json"))
        assert v5.inputs_version == 5

        before = run_appraisal(v4).metrics
        after = run_appraisal(v5).metrics

        new_fields = {"acquisition_tax_pence", "acquisition_tax"}
        carried = [f.name for f in fields(before) if f.name not in new_fields]
        assert len(carried) == len(fields(before)) - 2
        for name in carried:
            assert getattr(after, name) == getattr(before, name), name

        # Negative control: the comparison above is only meaningful if the
        # metrics object it strips down is actually populated with the figures
        # at risk.
        assert before.total_development_cost_pence > 0
        assert before.profit_pence != 0
        assert before.rlv_pence != 0
        # And the new fields really are new: identical value, England/NI, no date.
        assert before.acquisition_tax_pence == after.acquisition_tax_pence
        assert before.acquisition_tax.jurisdiction == "england_ni"
        assert after.acquisition_tax.jurisdiction == "england_ni"
        assert after.acquisition_tax.date_basis == "assumed_current"


# --- R9 Task 9 — area bridge and GDV split on the appraisal result ---


def _make_v6_inputs(
    *,
    areas: dict | None = None,
    units: list[dict] | None = None,
    conversion_costs: dict | None = None,
) -> CalculatorInputsV6:
    """Python twin of metrics.test.ts's makeV6Inputs (Task 9), matching the
    identical helper already established in test_financial_model_validation.py.
    A v6 document built off the migration chain's own defaults; only
    `areas`/`units`/`conversion_costs` are accepted since that is all this
    suite needs. Each unit dict may carry an `ancillary` sub-dict (R9 spec
    Sec 15.5); omitted, it defaults to zero via UnitAncillary()."""
    v6 = migrate_inputs_to_v6({"inputs_version": 1})
    if areas is not None:
        v6.areas = AreaBridgeInputs(**areas)
    if conversion_costs is not None:
        v6.conversion_costs = v6.conversion_costs.model_copy(update=conversion_costs)
    if units is not None:
        v6.unit_mix = UnitMixInputsV6(units=[
            ProposedUnitV6(
                id=u["id"],
                type=u.get("type", "1bed"),
                floor_area_sqm=u["floor_area_sqm"],
                estimated_value_pence=u["estimated_value_pence"],
                comparable_notes=u.get("comparable_notes", ""),
                ancillary=UnitAncillary(**u["ancillary"]) if "ancillary" in u else UnitAncillary(),
            )
            for u in units
        ])
    return v6


class TestAreaBridgeAndGdvSplitOnResult:
    """Python twin of 'R9 — the appraisal result carries the area bridge' in
    metrics.test.ts. Puts area_bridge, developed_area_sqm, gdv_internal_pence
    and gdv_ancillary_pence on the result so the UI (Task 10) and the report
    (Task 11) read them rather than recomputing."""

    def test_emits_every_derived_line_and_ratio(self):
        inputs = _make_v6_inputs(
            areas={
                **DEFAULT_AREA_BRIDGE, "basis": "bridge_derived",
                "existing_gia_sqm": 520, "circulation_common_sqm": 60,
            },
            units=[{"id": "u1", "floor_area_sqm": 380, "estimated_value_pence": 50_000_000}],
        )
        run = run_appraisal(inputs)
        assert run.metrics.area_bridge.developed_gia_sqm == 520
        assert run.metrics.area_bridge.available_for_units_sqm == 460
        assert run.metrics.area_bridge.unallocated_sqm == 80
        assert run.metrics.area_bridge.nia_to_gia_pct == 73.08

    def test_reports_the_cost_area_actually_used(self):
        inputs = _make_v6_inputs(
            areas={**DEFAULT_AREA_BRIDGE, "basis": "manual"},
            conversion_costs={"total_construction_sqm": 480},
        )
        run = run_appraisal(inputs)
        assert run.metrics.developed_area_sqm == 480

    def test_splits_gdv_while_keeping_gdv_pence_as_the_total(self):
        inputs = _make_v6_inputs(units=[{
            "id": "u1", "floor_area_sqm": 50, "estimated_value_pence": 25_000_000,
            "ancillary": {
                "balcony_terrace_sqm": 6, "balcony_terrace_value_pence": 400_000,
                "parking_spaces": 1, "parking_value_pence": 1_200_000,
            },
        }])
        run = run_appraisal(inputs)
        assert run.metrics.gdv_internal_pence == 25_000_000
        assert run.metrics.gdv_ancillary_pence == 1_600_000
        assert run.metrics.gdv_pence == 26_600_000

    def test_keeps_every_gdv_denominated_ratio_on_the_total_unamended(self):
        # profit_on_gdv_pct, ltgdv_developer_pct and the break-even percentages
        # all divide by gdv_pence. Because gdv_pence remains the TOTAL, none of
        # them needed a spec amendment in R9.
        #
        # Fix round 1 (review): the expected denominator below is written as
        # the literal sum of this fixture's own internal (25,000,000) and
        # ancillary (1,600,000) values -- NOT read back off
        # run.metrics.gdv_pence -- and the expected profit is the literal
        # figure this exact fixture produces (pinned once via a probe run,
        # deterministic thereafter: no randomness anywhere in the cost stack
        # or financing defaults, and identical to the TS twin). Reading both
        # sides of the assertion off the same result object would be
        # self-consistent by construction -- if gdv_pence were silently
        # narrowed to internal-only, both operands would narrow together and
        # the assertion would still hold. Hard-coding the denominator
        # independently means a narrowing of gdv_pence moves the actual value
        # away from this fixed expectation, so this test -- not just the
        # sibling "splits GDV" test above -- actually discriminates the
        # total-vs-internal-only regression it claims to guard.
        inputs = _make_v6_inputs(units=[{
            "id": "u1", "floor_area_sqm": 50, "estimated_value_pence": 25_000_000,
            "ancillary": {
                "balcony_terrace_sqm": 6, "balcony_terrace_value_pence": 400_000,
                "parking_spaces": 1, "parking_value_pence": 1_200_000,
            },
        }])
        run = run_appraisal(inputs)
        known_profit_pence = 22_156_972
        known_total_gdv_pence = 25_000_000 + 1_600_000  # internal + ancillary, literal
        assert run.metrics.profit_pence == known_profit_pence
        assert run.metrics.profit_on_gdv_pct == pct(known_profit_pence, known_total_gdv_pence)


class TestCostPlanOnResult:
    def test_the_cost_plan_on_the_result_agrees_with_the_schedule_totals_cross_site(self):
        # R10 spec Sec 3.3, applying the acquisition-tax cross-site check's
        # reasoning to cost: the schedule and derive_metrics each compute the
        # cost plan independently (schedule.py, metrics.py), so a defect that
        # moves one and not the other is invisible to any test that only
        # reads one side. Mirrors metrics.test.ts's identically named test.
        base = migrate_inputs_to_v7({})
        conversion_costs = base.conversion_costs.model_copy(update={
            "fire_safety_pence": 0, "sound_insulation_pence": 0, "part_l_compliance_pence": 0,
        })
        cost_plan = CostPlanInputs.model_validate({
            "mode": "detailed",
            "packages": [
                {"id": "p1", "code": "enabling_strip_out_asbestos", "label": "Strip out",
                 "amount_pence": 1_000_000, "contingency_class": "existing_building",
                 "lender_eligible": True, "notes": ""},
                {"id": "p2", "code": "structure", "label": "Structure", "amount_pence": 3_000_000,
                 "contingency_class": "general", "lender_eligible": True, "notes": ""},
            ],
            "contingency": [
                {"name": "general", "pct": 5, "basis": "all_packages", "package_ids": []},
                {"name": "existing_building", "pct": 15, "basis": "selected_packages", "package_ids": ["p1"]},
                {"name": "abnormal", "pct": 2.5, "basis": "all_packages", "package_ids": []},
            ],
            "fee_lines": [
                {"id": "f1", "code": "architect", "category": "professional", "label": "Architect",
                 "basis": "pct_of_construction_total", "amount_pence": 0, "pct": 6, "per_dwelling": False},
                {"id": "f2", "code": "cil_s106", "category": "statutory", "label": "CIL / S106",
                 "basis": "fixed", "amount_pence": 700_000, "pct": 0, "per_dwelling": False},
            ],
        })
        inputs = base.model_copy(update={"cost_plan": cost_plan, "conversion_costs": conversion_costs})
        run = run_appraisal(inputs)
        assert run.metrics.cost_plan.construction_total_pence == run.schedule.totals.construction_pence
        assert run.metrics.cost_plan.professional_total_pence == run.schedule.totals.professional_pence
        assert run.metrics.cost_plan.statutory_total_pence == run.schedule.totals.statutory_pence
