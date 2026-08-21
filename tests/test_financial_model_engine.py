"""Transliteration of frontend/src/lib/model/monthly-engine.test.ts fixtures B-F.

Both implementations must agree with the hand-computed ledger (spec Sec 8), not
merely with each other. If Python disagrees with a fixture, the Python port is
wrong -- never adjust these numbers to make peace.
"""
import json
from pathlib import Path

from app.financial_model.engine import run_ledger
from app.financial_model.migrate import DEFAULT_FACILITY_TERMS as DEFAULT_FACILITY_TERMS_DICT
from app.financial_model.migrate import default_calculator_inputs_v2
from app.financial_model.legacy_costs import calculate_total_construction_cost
from app.financial_model.schedule import (
    MonthReceipts,
    MonthUses,
    Schedule,
    ScheduleRefinance,
    ScheduleTotals,
    build_schedule,
)
from app.financial_model.types import (
    CalculatorInputsV2,
    CalculatorInputsV3,
    ConversionCostInputs,
    EquitySource,
    FacilityTerms,
    parse_calculator_inputs,
)
from app.financial_model.validation import reconcile
from app.financial_model.vat import VatMonthLine, VatResult

DEFAULT_FACILITY_TERMS = FacilityTerms(**DEFAULT_FACILITY_TERMS_DICT)
FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def replace(model: FacilityTerms, **overrides) -> FacilityTerms:
    return model.model_copy(update=overrides)


def uses(**partial) -> MonthUses:
    base = dict(
        acquisition_pence=0, construction_pence=0, professional_pence=0,
        statutory_pence=0, lender_ancillary_fees_pence=0, vat_pence=0,
    )
    base.update(partial)
    return MonthUses(**base)


def receipts(**partial) -> MonthReceipts:
    base = dict(
        gross_sale_pence=0, agent_fee_pence=0, selling_legal_pence=0, vat_reclaim_pence=0,
    )
    base.update(partial)
    return MonthReceipts(**base)


# R11: the VAT block itself is never read by the ledger -- the ledger reads only
# uses[m].vat_pence and receipts[m].vat_reclaim_pence, which the VAT engine writes
# back. So every schedule built here carries an inert result of the schedule's own
# length, mirroring vat.py's _inert_vat() shape exactly.
def _empty_vat(term_months: int) -> VatResult:
    return VatResult(
        registered=False, charges=[], periods=[],
        months=[
            VatMonthLine(month=m, incurred_pence=0, reclaimed_pence=0, carry_pence=0)
            for m in range(term_months)
        ],
        total_input_vat_pence=0, total_recoverable_pence=0, total_irrecoverable_pence=0,
        total_reclaimed_pence=0, receivable_at_maturity_pence=0, peak_carry_pence=0,
        peak_carry_month=None, purchase_vat_pence=0,
    )


def mk_schedule(u: list[MonthUses], r: list[MonthReceipts]) -> Schedule:
    def sum_(f):
        return sum(f(x) for x in u)

    gross_sales = sum(x.gross_sale_pence for x in r)
    selling = sum(x.agent_fee_pence + x.selling_legal_pence for x in r)
    return Schedule(
        term_months=len(u), uses=u, receipts=r, vat=_empty_vat(len(u)), refinance=None,
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
            vat_pence=sum_(lambda x: x.vat_pence),
            vat_reclaim_pence=sum(x.vat_reclaim_pence for x in r),
            irrecoverable_vat_pence=0,
        ),
    )


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


def _construction_costs(**overrides) -> ConversionCostInputs:
    base = dict(
        prior_approval_fee_per_dwelling_pence=0, cil_s106_pence=0, architect_pence=0,
        structural_engineer_pence=0, mande_pence=0, planning_consultant_pence=0,
        building_control_pence=0, other_professional_fees_pence=0,
        construction_cost_per_sqm_pence=0, total_construction_sqm=0, contingency_pct=0,
        fire_safety_pence=0, sound_insulation_pence=0, part_l_compliance_pence=0,
    )
    base.update(overrides)
    return ConversionCostInputs(**base)


class TestCalculateTotalConstructionCostFractionalSqmRounding:
    """Spec Sec 1.1 (amended, Release 2b Task 7): fractional-area products round once,
    at source, before contingency -- base = round_half_up(rate x sqm). Mirrors
    conversion-calc-engine.test.ts's matching regressions. Both cases use zero
    contingency/compliance so calculate_total_construction_cost's return value IS the
    rounded base cost, isolating the rounding site."""

    def test_rounds_a_fractional_base_cost_half_up_before_contingency(self):
        costs = _construction_costs(
            construction_cost_per_sqm_pence=50_000, total_construction_sqm=500.5,
        )
        # 50,000 x 500.5 = 25,025,000.0 exactly -- already an integer, but proves the
        # rounding site handles a fractional sqm input without disturbing an exact result.
        assert calculate_total_construction_cost(costs, costs.total_construction_sqm) == 25_025_000

    def test_rounds_an_odd_half_fractional_base_cost_up_not_down(self):
        costs = _construction_costs(
            construction_cost_per_sqm_pence=333, total_construction_sqm=100.5,
        )
        # 333 x 100.5 = 33,466.5 -- round_half_up(33,466.5) = 33,467 (Python's banker's
        # round() would wrongly give 33,466 -- must use money_round, never round()).
        assert calculate_total_construction_cost(costs, costs.total_construction_sqm) == 33_467


class TestFixtureBRolledUpInterest:
    """Fixture B -- rolled-up interest (spec Sec 8)."""

    def model(self):
        return run_ledger(mk_schedule(USES, SALE), TERMS, equity(30_000_000))

    def test_reproduces_hand_computed_ledger_to_the_penny(self):
        m = self.model()
        assert m.months[0].draw_pence == 30_000_000
        assert m.months[0].capitalised_fees_pence == 1_000_000
        assert m.months[0].interest_accrued_pence == 310_000
        assert m.months[0].closing_balance_pence == 31_310_000
        assert m.months[0].equity_contribution_pence == 10_000_000
        assert m.months[1].interest_accrued_pence == 313_100
        assert m.months[1].closing_balance_pence == 31_623_100
        assert m.months[2].draw_pence == 5_000_000
        assert m.months[2].equity_contribution_pence == 5_000_000
        assert m.months[2].interest_accrued_pence == 366_231
        assert m.months[2].closing_balance_pence == 36_989_331
        assert m.months[3].interest_accrued_pence == 369_893
        assert m.months[3].exit_fee_pence == 550_000
        assert m.months[3].repayment_pence == 37_359_224
        assert m.months[3].closing_balance_pence == 0
        assert m.months[3].distribution_pence == 40_490_776

    def test_reports_peak_debt_totals_and_equity_flows_correctly(self):
        m = self.model()
        assert m.peak_debt_pence == 37_359_224
        assert m.peak_debt_month == 3
        assert m.day_one_advance_pence == 30_000_000
        assert m.totals.interest_pence == 1_359_224
        assert m.totals.finance_costs_pence == 1_359_224 + 1_000_000 + 550_000
        assert m.equity_cashflows_pence == [-10_000_000, -15_000_000, -5_000_000, 40_490_776]
        assert m.senior_outstanding_at_maturity_pence == 0

    def test_debt_rollforward_reconciles_every_month(self):
        for mo in self.model().months:
            assert mo.closing_balance_pence == (
                mo.opening_balance_pence + mo.draw_pence + mo.capitalised_fees_pence
                + mo.interest_capitalised_pence - mo.repayment_pence
            )
            assert mo.closing_balance_pence >= 0


class TestFixtureCServicedInterest:
    """Fixture C -- serviced interest differs from rolled-up."""

    def model(self):
        terms = replace(TERMS, interest_type="serviced")
        return run_ledger(mk_schedule(USES, SALE), terms, equity(32_000_000))

    def test_keeps_the_balance_flat_and_funds_interest_from_equity(self):
        m = self.model()
        assert m.months[0].interest_serviced_pence == 310_000
        assert m.months[0].interest_capitalised_pence == 0
        assert m.months[0].closing_balance_pence == 31_000_000
        assert m.months[0].equity_contribution_pence == 10_310_000
        assert m.months[1].closing_balance_pence == 31_000_000
        # m2: committed equity remaining 6,380,000 -> costs part-funded, draw 3,620,000
        assert m.months[2].equity_contribution_pence == 6_380_000
        assert m.months[2].draw_pence == 3_620_000
        assert m.months[2].interest_serviced_pence == 346_200
        assert m.months[2].additional_equity_pence == 346_200
        assert m.months[3].additional_equity_pence == 346_200

    def test_produces_materially_different_peak_debt_and_interest_from_rolled_up(self):
        m = self.model()
        assert m.peak_debt_pence == 34_620_000
        assert m.totals.interest_pence == 1_312_400
        assert m.totals.additional_equity_pence == 692_400
        assert any(f.code == "additional_equity_required" for f in m.flags)
        assert m.months[3].distribution_pence == 43_230_000
        # profit identity: sum equity flows = 80,000,000 - TDC(69,462,400) = 10,537,600
        assert sum(m.equity_cashflows_pence) == 10_537_600


class TestFixtureDRetainAll:
    """Fixture D -- retain_all books no receipts and flags outstanding debt."""

    def model(self):
        return run_ledger(mk_schedule(USES, NO_SALE), TERMS, equity(30_000_000))

    def test_leaves_senior_balance_outstanding_at_maturity_with_no_distributions(self):
        m = self.model()
        assert m.months[3].repayment_pence == 0
        assert m.months[3].closing_balance_pence == 37_359_224
        assert m.senior_outstanding_at_maturity_pence == 37_359_224
        assert m.totals.exit_fee_pence == 0
        assert m.totals.distributions_pence == 0
        assert any(
            f.code == "senior_outstanding_at_maturity" and f.severity == "red"
            for f in m.flags
        )
        assert m.equity_cashflows_pence == [-10_000_000, -15_000_000, -5_000_000, 0]


class TestFixtureEFundingGap:
    """Fixture E -- funding gap: overruns never create facility."""

    def model(self):
        terms = replace(TERMS, committed_net_facility_pence=35_000_000)
        return run_ledger(mk_schedule(USES, SALE), terms, equity(25_000_000))

    def test_caps_the_draw_at_undrawn_net_facility_and_records_the_gap(self):
        m = self.model()
        # Arrangement fee recomputes from its basis: 2% x committed net facility
        # (GBP350,000) = GBP7,000.
        assert m.months[0].capitalised_fees_pence == 700_000
        assert m.months[2].draw_pence == 4_300_000
        assert m.months[2].funding_gap_pence == 5_700_000
        assert m.totals.funding_gap_pence == 5_700_000
        gap = next(f for f in m.flags if f.code == "funding_gap")
        assert gap.severity == "red"
        assert gap.month == 2
        assert m.months[2].closing_balance_pence == 35_973_241
        assert m.months[3].repayment_pence == 36_332_973
        assert m.months[3].distribution_pence == 41_517_027


class TestFixtureFGrossHeadroomCap:
    """Fixture F -- draws are capped by gross facility headroom after
    projected interest (spec Sec 4.2c)."""

    def model(self):
        terms = replace(TERMS, committed_gross_facility_pence=36_500_000)
        return run_ledger(mk_schedule(USES, SALE), terms, equity(30_000_000))

    def test_caps_month_2_draw_so_closing_balance_cannot_exceed_gross_facility(self):
        m = self.model()
        # Months 0-1 identical to Fixture B: gross headroom does not bind while
        # balances are low.
        assert m.months[1].closing_balance_pence == 31_623_100
        # m2: needed draw 5,000,000, but grossHeadroomCap = floor(36,500,000/1.01)
        # - 31,623,100 = 36,138,613 - 31,623,100 = 4,515,513.
        assert m.months[2].draw_pence == 4_515_513
        assert m.months[2].equity_contribution_pence == 5_000_000
        assert m.months[2].funding_gap_pence == 484_487
        assert m.months[2].interest_accrued_pence == 361_386
        assert m.months[2].closing_balance_pence == 36_499_999
        gap = next((f for f in m.flags if f.code == "funding_gap"), None)
        assert gap is not None
        for mo in m.months:
            assert mo.closing_balance_pence <= 36_500_000


class TestCashFunding:
    def test_has_no_draws_interest_or_fees_under_cash(self):
        terms = replace(TERMS, funding_source="cash")
        m = run_ledger(mk_schedule(USES, SALE), terms, equity(65_000_000))
        assert m.totals.draws_pence == 0
        assert m.totals.finance_costs_pence == 0
        assert m.peak_debt_pence == 0
        assert all(mo.closing_balance_pence == 0 for mo in m.months)
        assert m.totals.equity_contributed_pence == 65_000_000


class TestFixtureBVariantExitFeeVanishingBand:
    """Fixture B variant -- exit-fee vanishing band (spec Sec 4.4, I2).

    Fixture B's month-3 pre-repayment balance is 37,359,224 and its exit fee
    is 550,000 (basis = committed_gross_facility, so the fee doesn't depend on
    the receipt amount). agent_fee/selling_legal are zeroed here so
    net_receipt == gross_sale_pence == sweep_available at sales_sweep_pct 100,
    letting the receipt be tuned to land exactly in/at the edge of the
    [balance, balance + fee) band that used to zero the balance while
    silently dropping the fee.
    """

    BALANCE = 37_359_224
    FEE = 550_000

    def sale_of(self, gross_sale: int) -> list[MonthReceipts]:
        return [receipts(), receipts(), receipts(), receipts(gross_sale_pence=gross_sale)]

    def test_band_case_balance_carries_no_exit_fee(self):
        schedule = mk_schedule(USES, self.sale_of(self.BALANCE + self.FEE - 1))
        m = run_ledger(schedule, TERMS, equity(30_000_000))
        assert m.months[3].exit_fee_pence == 0
        assert m.months[3].closing_balance_pence == 1
        assert m.senior_outstanding_at_maturity_pence == 1
        assert m.totals.exit_fee_pence == 0
        assert any(
            f.code == "senior_outstanding_at_maturity" and f.severity == "red"
            for f in m.flags
        )

        # senior_repaid is False (debt outstanding); this is a warning-level
        # issue, so it does not by itself flip report_safe -- matching how
        # retain_all's undischarged balance is treated (spec Sec 4.4).
        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        rec = reconcile(inputs, schedule, m)
        assert rec.senior_repaid is False
        assert rec.funding_complete is True
        assert rec.sources_equal_uses is True
        assert rec.debt_rollforward_ok is True

    def test_boundary_case_full_discharge_with_fee_charged(self):
        schedule = mk_schedule(USES, self.sale_of(self.BALANCE + self.FEE))
        m = run_ledger(schedule, TERMS, equity(30_000_000))
        assert m.months[3].exit_fee_pence == self.FEE
        assert m.months[3].closing_balance_pence == 0
        assert m.senior_outstanding_at_maturity_pence == 0
        assert m.totals.exit_fee_pence == self.FEE
        assert not any(f.code == "senior_outstanding_at_maturity" for f in m.flags)

        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        rec = reconcile(inputs, schedule, m)
        assert rec.senior_repaid is True
        assert rec.funding_complete is True


class TestFixtureGNonCashEquityDoesNotFundWaterfall:
    """Fixture G -- non-cash equity does not fund the waterfall (spec Sec 2, C1).

    The review's exploit: an unconfirmed planning_uplift source large enough
    to cover every cost must not be treated as committed equity. Only
    classification == 'cash' counts -- evidence_status is irrelevant to a
    non-cash source, since it was never eligible to fund in the first place.
    """

    def non_cash_equity(self) -> list[EquitySource]:
        return [EquitySource(
            id="e-uplift", classification="planning_uplift", amount_pence=100_000_000,
            timing_month=0, repayment_priority=1, evidence_status="unconfirmed", notes="",
        )]

    def test_treats_committed_equity_as_zero_producing_a_funding_gap(self):
        m = run_ledger(mk_schedule(USES, SALE), TERMS, self.non_cash_equity())
        assert m.months[0].equity_contribution_pence == 0
        assert m.totals.funding_gap_pence > 0
        assert any(
            f.code == "funding_gap" and f.severity == "red" for f in m.flags
        )

    def test_does_not_fund_costs_even_mixed_with_a_rejected_cash_source(self):
        mixed = self.non_cash_equity() + [EquitySource(
            id="e-cash-rejected", classification="cash", amount_pence=100_000_000,
            timing_month=0, repayment_priority=1, evidence_status="rejected", notes="",
        )]
        m = run_ledger(mk_schedule(USES, SALE), TERMS, mixed)
        assert m.totals.funding_gap_pence > 0


class TestRedemptionBalanceAtDisposal:
    """redemption_balance_at_disposal_pence (spec Sec 5.11, Release 2b Task 4)."""

    def test_captures_fixture_b_month_3_pre_repayment_balance(self):
        # Fixture B (Sec 8): the only month with a sale (month 3) is also the peak-debt
        # month, so the pre-receipt balance equals both peak_debt_pence and
        # repayment_pence -- a useful cross-check that the capture point sits exactly
        # before the repayment block mutates `balance`, not after.
        m = run_ledger(mk_schedule(USES, SALE), TERMS, equity(30_000_000))
        assert m.redemption_balance_at_disposal_pence == 37_359_224
        assert m.redemption_balance_at_disposal_pence == m.peak_debt_pence
        assert m.redemption_balance_at_disposal_pence == m.months[3].repayment_pence

    def test_is_none_for_cash_funding(self):
        terms = replace(TERMS, funding_source="cash")
        m = run_ledger(mk_schedule(USES, SALE), terms, equity(65_000_000))
        assert m.redemption_balance_at_disposal_pence is None

    def test_is_none_when_nothing_is_sold(self):
        m = run_ledger(mk_schedule(USES, NO_SALE), TERMS, equity(30_000_000))
        assert m.redemption_balance_at_disposal_pence is None

    def test_golden_fixture_f_matches_pinned_peak_debt_and_confirmed_exit_fee(self):
        """12-month term: matches its pinned peak_debt_pence of 58,604,953p at month 11,
        and the pinned committed_gross_facility_pence (66,000,000, explicitly set -- not
        derived from net + reserve) drives an exit fee of 660,000p, confirmed against the
        ledger's own totals.exit_fee_pence rather than assumed (Task 4 Step 1
        verification)."""
        doc = json.loads((FIXTURE_DIR / "f-dev-finance-12mo.json").read_text())
        # R8: the shared corpus is v5; parse by version rather than pinning a class.
        inputs = parse_calculator_inputs(doc["inputs"])
        schedule = build_schedule(inputs)
        m = run_ledger(schedule, inputs.finance, inputs.equity_sources)
        assert m.redemption_balance_at_disposal_pence == 58_604_953
        assert m.redemption_balance_at_disposal_pence == m.peak_debt_pence
        assert m.months[11].exit_fee_pence == 660_000
        assert m.totals.exit_fee_pence == 660_000


class TestPhasedSweepMechanics:
    """Transliteration of monthly-engine.test.ts's `phased sweep mechanics
    (spec Sec 4.4.1)` describe block (Release 3b Task 4)."""

    # Facility comfortably covers the toy's month-0 construction draw with headroom to
    # spare, so behaviour below is driven purely by the sweep/redemption mechanics under
    # test, not by facility caps.
    TERMS_ROLLED_UP_NO_CAPS = replace(
        DEFAULT_FACILITY_TERMS,
        funding_source="development_finance",
        day_one_advance_pence=15_000_000,
        committed_net_facility_pence=20_000_000,
        committed_gross_facility_pence=25_000_000,
        annual_interest_rate_pct=12,
        interest_type="rolled_up",
        arrangement_fee_pct=2, arrangement_fee_basis="committed_net_facility",
        exit_fee_pct=1, exit_fee_basis="committed_gross_facility",
        term_months=4, equity_draw_rule="equity_first", sales_sweep_pct=100,
    )

    # 4-month toy: uses only in month 0, receipts in months 2 and 3.
    def schedule(self, r2: MonthReceipts, r3: MonthReceipts) -> Schedule:
        return mk_schedule(
            [uses(construction_pence=10_000_000), uses(), uses(), uses()],
            [receipts(), receipts(), r2, r3],
        )

    def test_captures_a_declining_redemption_schedule_one_entry_per_disposal_month(self):
        m = run_ledger(
            self.schedule(
                receipts(gross_sale_pence=6_000_000), receipts(gross_sale_pence=6_000_000),
            ),
            self.TERMS_ROLLED_UP_NO_CAPS, [],
        )
        assert [e.month for e in m.redemption_schedule] == [2, 3]
        assert m.redemption_schedule[0].balance_pence > m.redemption_schedule[1].balance_pence
        assert m.redemption_balance_at_disposal_pence == m.redemption_schedule[1].balance_pence

    def test_charges_the_exit_fee_once_at_first_full_redemption_and_never_again(self):
        m = run_ledger(
            self.schedule(
                receipts(gross_sale_pence=50_000_000),  # clears everything
                receipts(gross_sale_pence=1_000_000),
            ),
            self.TERMS_ROLLED_UP_NO_CAPS, [],
        )
        assert m.months[2].exit_fee_pence > 0
        assert m.months[3].exit_fee_pence == 0
        assert m.totals.exit_fee_pence == m.months[2].exit_fee_pence
        assert m.months[3].distribution_pence == 1_000_000  # post-redemption tranche distributes whole

    def test_flags_a_facility_re_drawn_after_full_redemption_amber_once(self):
        s = self.schedule(receipts(gross_sale_pence=50_000_000), receipts())
        s.uses[3] = uses(construction_pence=2_000_000)  # spend after redemption
        m = run_ledger(s, self.TERMS_ROLLED_UP_NO_CAPS, [])
        f = [x for x in m.flags if x.code == "facility_redrawn_after_redemption"]
        assert len(f) == 1
        assert f[0].severity == "amber"
        assert f[0].month == 3


class TestRefinanceEvent:
    """Transliteration of monthly-engine.test.ts's `refinance event (spec Sec
    4.5)` describe block, nested under `phased sweep mechanics` (Release 3b
    Task 5)."""

    TERMS_ROLLED_UP_NO_CAPS = TestPhasedSweepMechanics.TERMS_ROLLED_UP_NO_CAPS

    def with_refi(
        self, net: int, month: int, receipts2: MonthReceipts | None = None,
    ) -> Schedule:
        s = mk_schedule(
            [uses(construction_pence=10_000_000), uses(), uses(), uses()],
            [receipts(), receipts(), receipts2 or receipts(), receipts()],
        )
        s.refinance = ScheduleRefinance(month=month, net_proceeds_pence=net)
        return s

    def test_surplus_refinance_redeems_the_facility_and_distributes_the_excess(self):
        m = run_ledger(self.with_refi(50_000_000, 3), self.TERMS_ROLLED_UP_NO_CAPS, [])
        last = m.months[3]
        assert last.closing_balance_pence == 0
        assert last.exit_fee_pence > 0  # fee charged at refinance redemption
        assert last.refinance_proceeds_pence == 50_000_000
        assert last.distribution_pence == 50_000_000 - last.repayment_pence - last.exit_fee_pence
        assert not any(f.code == "senior_outstanding_at_maturity" for f in m.flags)
        assert m.equity_cashflows_pence[3] == last.distribution_pence  # IRR terminal flow

    def test_shortfall_is_absorbed_by_additional_equity_and_red_flagged(self):
        m = run_ledger(self.with_refi(1_000_000, 3), self.TERMS_ROLLED_UP_NO_CAPS, [])
        last = m.months[3]
        assert last.closing_balance_pence == 0  # still fully redeemed
        assert last.additional_equity_pence == last.repayment_pence + last.exit_fee_pence - 1_000_000
        assert last.distribution_pence == 0
        assert any(f.code == "additional_equity_required" for f in m.flags)

    def test_same_month_ordering_the_sales_sweep_runs_first_then_the_refinance(self):
        sale = receipts(gross_sale_pence=4_000_000)
        m = run_ledger(self.with_refi(50_000_000, 2, sale), self.TERMS_ROLLED_UP_NO_CAPS, [])
        mm = m.months[2]
        # sweep repaid 4,000,000 first (partial), refinance repaid the rest -- total
        # repayment exceeds the sweep alone and the redemption_schedule entry is the
        # PRE-receipts balance.
        assert mm.repayment_pence > 4_000_000
        assert m.redemption_schedule[0].balance_pence > mm.repayment_pence - 4_000_000
        assert mm.closing_balance_pence == 0

    def test_negative_net_proceeds_are_funded_by_additional_equity_nothing_distributes(self):
        m = run_ledger(self.with_refi(-500_000, 3), self.TERMS_ROLLED_UP_NO_CAPS, [])
        last = m.months[3]
        assert last.refinance_proceeds_pence == 0
        assert last.additional_equity_pence == 500_000 + last.repayment_pence + last.exit_fee_pence


# ---------------------------------------------------------------------------
# R11 spec Sec 17.6 -- VAT in the ledger: funding, sweep and redemption.
# Mirror of monthly-engine.test.ts's two VAT describes, figure for figure.
# ---------------------------------------------------------------------------


def _vat_document(
    advance_pct: float = 100,
    committed_equity_pence: int = 5_000_000,
    sales_sweep_pct: float = 100,
    reclaim_clears_balance: bool = False,
    same_month_sale_and_reclaim: bool = False,
    cash: bool = False,
):
    """A five-month VAT document, deliberately stripped of everything that is
    not under test: 0% interest, no arrangement fee, no ancillary fees, no
    day-one advance and nothing at all in month 0. What is left is

        m1  25,000,000 construction + 5,000,000 VAT     (the funding question)
        m3  a VAT reclaim                               (the sweep question)
        m4  a 60,000,000 sale                           (the redemption question)

    The eligible base for the development-cost advance is construction +
    professional + statutory = 25,000,000, so at 100% the cap stops the draw at
    the build and the 5,000,000 of VAT must come from equity or from a visible
    gap. The exit fee is 1% of the 100,000,000 committed gross facility =
    1,000,000, independent of which month redeems and of the balance then
    outstanding.

    Ruling R7: the advance-cap guard is built on ZERO committed equity. The
    engine funds equity first, so an equity-rich document simply pays the VAT
    out of equity and proves nothing about eligibility."""
    terms = replace(
        DEFAULT_FACILITY_TERMS,
        funding_source="cash" if cash else "development_finance",
        day_one_advance_pence=0,
        development_cost_advance_pct=advance_pct,
        committed_net_facility_pence=100_000_000,
        committed_gross_facility_pence=100_000_000,
        annual_interest_rate_pct=0,
        interest_type="rolled_up",
        arrangement_fee_pct=0,
        exit_fee_pct=1, exit_fee_basis="committed_gross_facility",
        term_months=5, equity_draw_rule="equity_first",
        sales_sweep_pct=sales_sweep_pct,
    )
    schedule = mk_schedule(
        [
            uses(),
            uses(construction_pence=25_000_000, vat_pence=5_000_000),
            uses(), uses(), uses(),
        ],
        [
            receipts(), receipts(), receipts(),
            receipts(
                vat_reclaim_pence=30_000_000 if reclaim_clears_balance else 10_000_000,
                gross_sale_pence=60_000_000 if same_month_sale_and_reclaim else 0,
            ),
            receipts(gross_sale_pence=0 if same_month_sale_and_reclaim else 60_000_000),
        ],
    )
    return schedule, terms, (equity(committed_equity_pence) if committed_equity_pence > 0 else [])


def _run_vat_ledger(**kwargs):
    schedule, terms, sources = _vat_document(**kwargs)
    return run_ledger(schedule, terms, sources)


def test_funds_the_build_but_never_advances_against_the_vat():
    # THE GUARD (spec Sec 17.6). Advance pct 100, zero committed equity.
    # `eligible` is construction + professional + statutory = 25,000,000, so the
    # cap stops the draw at the build and the VAT falls through to a visible gap.
    #
    # Add u.vat_pence to `eligible` in engine.py and the cap becomes 30,000,000,
    # the draw covers everything and the gap disappears -- this assertion MUST
    # break. Watched failing; see the task report.
    model = _run_vat_ledger(advance_pct=100, committed_equity_pence=0)
    m1 = model.months[1]
    assert m1.uses_total_pence == 30_000_000   # 25,000,000 build + 5,000,000 VAT
    assert m1.draw_pence == 25_000_000         # the build only
    assert m1.funding_gap_pence == 5_000_000   # exactly the VAT


def test_raises_vat_funding_gap_when_neither_equity_nor_headroom_can_fund_the_vat():
    model = _run_vat_ledger(advance_pct=100, committed_equity_pence=0)
    flags = [f for f in model.flags if f.code == "vat_funding_gap"]
    assert len(flags) == 1
    assert flags[0].severity == "red"
    assert flags[0].month == 1
    assert flags[0].amount_pence == 5_000_000
    # The generic gap flag still fires alongside it; the VAT one narrows it.
    assert any(f.code == "funding_gap" for f in model.flags)


def test_funds_the_vat_from_equity_where_equity_is_available():
    # The same document with equity committed: no gap, and the draw is still
    # capped at the build. This is the narrative case; the guard above is the
    # one that fails when eligibility is widened.
    model = _run_vat_ledger(advance_pct=100, committed_equity_pence=5_000_000)
    assert model.months[1].funding_gap_pence == 0
    assert model.months[1].draw_pence == 25_000_000
    assert model.months[1].equity_contribution_pence == 5_000_000
    assert model.totals.equity_contributed_pence > 0
    assert not any(f.code == "vat_funding_gap" for f in model.flags)


def test_discloses_the_gross_vat_cycle_on_the_ledger_totals():
    model = _run_vat_ledger()
    assert model.totals.vat_pence == 5_000_000
    assert model.totals.vat_reclaim_pence == 10_000_000


def test_applies_a_reclaim_wholly_to_senior_debt_ignoring_sales_sweep_pct():
    model = _run_vat_ledger(sales_sweep_pct=50)
    reclaim_month = model.months[3]
    assert reclaim_month.vat_reclaim_pence == 10_000_000
    assert reclaim_month.repayment_pence == 10_000_000   # not 5,000,000
    assert reclaim_month.gross_receipts_pence == 0       # never a sale receipt
    assert reclaim_month.closing_balance_pence == 15_000_000


def test_charges_the_exit_fee_exactly_once_when_a_reclaim_clears_the_balance():
    # The trap (Sec 17.6): the ledger charges the exit fee inside the
    # "balance > 0 and not is_cash" branch at the sales sweep. A reclaim that
    # zeroes the balance without redeeming leaves the sale with nothing to do,
    # and the fee is never charged and never carried -- lost, with every total
    # still reconciling.
    cleared_by_reclaim = _run_vat_ledger(reclaim_clears_balance=True)
    cleared_by_sale = _run_vat_ledger(reclaim_clears_balance=False)
    # Genuinely two different documents: the reclaim redeems in month 3 in one,
    # the sale redeems in month 4 in the other.
    assert cleared_by_reclaim.months[3].closing_balance_pence == 0
    assert cleared_by_sale.months[3].closing_balance_pence == 15_000_000
    assert cleared_by_reclaim.months[3].exit_fee_pence == 1_000_000
    assert cleared_by_sale.months[4].exit_fee_pence == 1_000_000

    assert cleared_by_reclaim.totals.exit_fee_pence > 0
    assert cleared_by_reclaim.totals.exit_fee_pence == cleared_by_sale.totals.exit_fee_pence
    # Charged once, not twice: the month-4 sale finds the facility redeemed.
    assert cleared_by_reclaim.months[4].exit_fee_pence == 0
    # Surplus over balance + fee distributes: 30,000,000 - 25,000,000 - 1,000,000.
    assert cleared_by_reclaim.months[3].distribution_pence == 4_000_000


def test_does_not_redeem_on_a_partial_reclaim():
    model = _run_vat_ledger(reclaim_clears_balance=False)
    reclaim_month = model.months[3]
    assert reclaim_month.exit_fee_pence == 0
    assert reclaim_month.distribution_pence == 0
    assert not any(f.code == "facility_redrawn_after_redemption" for f in model.flags)


def test_withholds_discharge_when_a_reclaim_lands_in_the_exit_fee_band():
    # Spec Sec 17.6: a partial reclaim behaves "exactly like a partial sales
    # sweep", and the sweep's Sec 4.4 clamp exists precisely so a repayment that
    # cannot also cover the fee never zeroes the balance. Balance 25,000,000,
    # fee 1,000,000: a 25,500,000 reclaim must leave 500,000 outstanding rather
    # than clear the facility with the fee uncharged.
    schedule, terms, sources = _vat_document()
    schedule.receipts[3] = receipts(vat_reclaim_pence=25_500_000)
    model = run_ledger(schedule, terms, sources)
    assert model.months[3].exit_fee_pence == 0
    assert model.months[3].repayment_pence == 24_500_000
    assert model.months[3].closing_balance_pence == 500_000
    assert model.months[3].distribution_pence == 1_000_000   # the withheld residue
    # The month-4 sale then redeems properly, and the fee is charged there.
    assert model.months[4].exit_fee_pence == 1_000_000
    assert model.totals.exit_fee_pence == 1_000_000


def test_distributes_the_whole_reclaim_when_the_fee_exceeds_the_balance():
    """The clamp's degenerate case: balance <= vat_reclaim < fee, so
    max(0, vat_reclaim - fee) is 0 -- nothing is repaid, the whole reclaim
    distributes, and the debt stays outstanding. This mirrors the pre-existing
    Sec 4.4 sales-sweep clamp exactly and deliberately: a repayment that cannot
    also cover the exit fee must not discharge the facility, and the ledger
    would rather hand the cash to the developer than clear principal it cannot
    properly redeem. Documented here because neither clamp has ever had a test
    for this corner.

    Balance 500,000, exit fee 1,000,000 (1% of the committed gross facility,
    which does not shrink with the balance), reclaim 600,000."""
    _, terms, sources = _vat_document(committed_equity_pence=0)
    schedule = mk_schedule(
        [uses(), uses(construction_pence=500_000), uses(), uses(), uses()],
        [
            receipts(), receipts(), receipts(),
            receipts(vat_reclaim_pence=600_000),
            receipts(gross_sale_pence=60_000_000),
        ],
    )
    model = run_ledger(schedule, terms, sources)
    assert model.months[1].closing_balance_pence == 500_000
    assert model.months[3].repayment_pence == 0
    assert model.months[3].exit_fee_pence == 0
    assert model.months[3].distribution_pence == 600_000   # the whole reclaim
    assert model.months[3].closing_balance_pence == 500_000
    # The month-4 sale redeems properly and charges the fee once.
    assert model.months[4].exit_fee_pence == 1_000_000
    assert model.months[4].repayment_pence == 500_000
    assert model.totals.exit_fee_pence == 1_000_000
    assert model.senior_outstanding_at_maturity_pence == 0


def test_applies_the_reclaim_before_the_sale():
    # Ordering, not arithmetic: the same 10,000,000 arriving as a reclaim in
    # month 3 leaves the month-4 sale only 15,000,000 to redeem.
    model = _run_vat_ledger()
    assert model.months[4].repayment_pence == 15_000_000
    assert model.months[4].distribution_pence == 60_000_000 - 15_000_000 - 1_000_000
    assert model.senior_outstanding_at_maturity_pence == 0


def test_captures_the_redemption_balance_after_the_reclaim_in_a_shared_month():
    """Ordering consequence worth pinning (spec Sec 5.11 + Sec 17.6): the reclaim
    is applied first, so the balance the disposal actually has to redeem -- and
    therefore redemption_balance_at_disposal_pence and the Sec 4.4.1 redemption
    schedule -- is the post-reclaim 15,000,000, not the pre-reclaim 25,000,000.
    The field's own doc comment says "immediately before sale receipts are
    applied", and a reclaim is not a sale receipt."""
    model = _run_vat_ledger(same_month_sale_and_reclaim=True)
    assert model.months[3].vat_reclaim_pence == 10_000_000
    assert model.redemption_balance_at_disposal_pence == 15_000_000
    assert [(e.month, e.balance_pence) for e in model.redemption_schedule] == [(3, 15_000_000)]
    # Reclaim 10,000,000 + sale repayment 15,000,000, one exit fee.
    assert model.months[3].repayment_pence == 25_000_000
    assert model.months[3].exit_fee_pence == 1_000_000
    assert model.months[3].closing_balance_pence == 0


def test_distributes_a_reclaim_to_equity_on_a_cash_deal():
    model = _run_vat_ledger(cash=True, committed_equity_pence=30_000_000)
    assert model.months[3].distribution_pence == 10_000_000
    assert model.equity_cashflows_pence[3] > 0
    assert model.equity_cashflows_pence[3] == 10_000_000
    assert model.totals.finance_costs_pence == 0


def test_keeps_sources_equal_to_uses_to_the_penny_with_vat_live():
    # All three funding shapes: equity-funded VAT, a VAT funding gap, and a
    # reclaim that redeems. The reclaim appears on neither side of the Sec 7
    # identity, exactly as sale-proceeds repayments do.
    for kwargs in ({}, {"committed_equity_pence": 0}, {"reclaim_clears_balance": True}):
        schedule, terms, sources = _vat_document(**kwargs)
        model = run_ledger(schedule, terms, sources)
        inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
        rec = reconcile(inputs, schedule, model)
        assert rec.sources_equal_uses is True, kwargs
        assert rec.debt_rollforward_ok is True, kwargs
