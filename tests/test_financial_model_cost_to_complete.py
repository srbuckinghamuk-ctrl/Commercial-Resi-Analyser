"""Transliteration of frontend/src/lib/model/cost-to-complete.test.ts (spec Sec 5.10,
Release 2b Task 6).

Both implementations must agree with the hand-derived worksheet (docs/financial-model/
test-cases.md), not merely with each other.
"""
import json
from pathlib import Path

from app.financial_model.cost_to_complete import compute_cost_to_complete
from app.financial_model.engine import run_ledger
from app.financial_model.migrate import DEFAULT_FACILITY_TERMS as DEFAULT_FACILITY_TERMS_DICT
from app.financial_model.migrate import default_calculator_inputs_v2
from app.financial_model.schedule import (
    MonthReceipts, MonthUses, Schedule, ScheduleTotals, build_schedule,
)
from app.financial_model.types import (
    CalculatorInputsV2,
    EquitySource,
    FacilityTerms,
    parse_calculator_inputs,
)
from app.financial_model.vat import VatMonthLine, VatResult

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


# R11: no test in this file exercises VAT -- an inert result of the schedule's
# own length, mirroring vat.py's _inert_vat() shape exactly.
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
        purchase_vat_chargeable=False, purchase_evidence_status="unconfirmed",
    )


def mk_schedule(u: list[MonthUses], r: list[MonthReceipts]) -> Schedule:
    def sum_(f):
        return sum(f(x) for x in u)

    gross_sales = sum(x.gross_sale_pence for x in r)
    selling = sum(x.agent_fee_pence + x.selling_legal_pence for x in r)
    return Schedule(
        term_months=len(u), uses=u, receipts=r, vat=_empty_vat(len(u)),
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
    FacilityTerms(**DEFAULT_FACILITY_TERMS_DICT),
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


def cash_equity(amount: int) -> list[EquitySource]:
    return [EquitySource(
        id="e1", classification="cash", amount_pence=amount, timing_month=0,
        repayment_priority=1, evidence_status="confirmed", notes="",
    )]


def inputs_with_equity(equity_sources: list[EquitySource]) -> CalculatorInputsV2:
    inputs = CalculatorInputsV2.model_validate(default_calculator_inputs_v2())
    return inputs.model_copy(update={"equity_sources": equity_sources})


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


class TestFixtureBWorksheet:
    """Hand-derived (docs/financial-model/test-cases.md) from
    test_financial_model_engine.py's Fixture B pinned ledger columns. Independently
    cross-checked with a scratch script reproducing this exact formula before being
    written here (see task-6-report.md)."""

    def schedule(self):
        return mk_schedule(USES, SALE)

    def model(self):
        return run_ledger(self.schedule(), TERMS, cash_equity(30_000_000))

    def ctc(self):
        schedule = self.schedule()
        model = run_ledger(schedule, TERMS, cash_equity(30_000_000))
        return compute_cost_to_complete(schedule, model, inputs_with_equity(cash_equity(30_000_000)))

    def test_reproduces_the_hand_derived_month_series_to_the_penny(self):
        ctc = self.ctc()
        got = [
            (m.month, m.remaining_cost_pence, m.remaining_funding_pence, m.surplus_pence)
            for m in ctc.months
        ]
        assert got == [
            (1, 26_049_224, 39_000_000, 12_950_776),
            (2, 10_736_124, 24_000_000, 13_263_876),
            (3, 369_893, 14_000_000, 13_630_107),
            (4, 0, 14_000_000, 14_000_000),
        ]

    def test_is_fully_funded_throughout_no_shortfall(self):
        ctc = self.ctc()
        assert ctc.first_shortfall_month is None
        assert ctc.max_shortfall_pence == 0

    def test_telescoping_identity(self):
        """remaining_cost(m) == remaining_cost(m + 1) + cost(month m + 1)."""
        schedule = self.schedule()
        model = self.model()
        ctc = compute_cost_to_complete(schedule, model, inputs_with_equity(cash_equity(30_000_000)))

        def cost_of_label(m: int) -> int:
            u = schedule.uses[m - 1]
            lm = model.months[m - 1]
            return (
                u.acquisition_pence + u.construction_pence + u.professional_pence
                + u.statutory_pence + u.lender_ancillary_fees_pence
                + lm.interest_accrued_pence + lm.capitalised_fees_pence
            )

        for m in range(1, len(ctc.months)):
            assert ctc.months[m - 1].remaining_cost_pence == (
                ctc.months[m].remaining_cost_pence + cost_of_label(m + 1)
            )

    def test_boundary_identity_month_1_equals_total_cost_minus_month_0_spend(self):
        schedule = self.schedule()
        model = self.model()
        ctc = compute_cost_to_complete(schedule, model, inputs_with_equity(cash_equity(30_000_000)))
        total_cost = sum(
            u.acquisition_pence + u.construction_pence + u.professional_pence
            + u.statutory_pence + u.lender_ancillary_fees_pence
            for u in schedule.uses
        ) + sum(m.interest_accrued_pence + m.capitalised_fees_pence for m in model.months)
        u0 = schedule.uses[0]
        m0 = model.months[0]
        month_0_spend = (
            u0.acquisition_pence + u0.construction_pence + u0.professional_pence
            + u0.statutory_pence + u0.lender_ancillary_fees_pence
            + m0.interest_accrued_pence + m0.capitalised_fees_pence
        )
        assert ctc.months[0].remaining_cost_pence == total_cost - month_0_spend


class TestCashDealPath:
    """Same USES/SALE as Fixture B, funding_source 'cash', equity exactly equal to
    total cost (65,000,000): every month's surplus is exactly 0, pinning the strict
    `surplus < 0` shortfall test on a cash deal where undrawn_net_facility_pence is
    None throughout (no facility at all, not merely undrawn)."""

    def build(self):
        schedule = mk_schedule(USES, SALE)
        cash_terms = replace(TERMS, funding_source="cash")
        model = run_ledger(schedule, cash_terms, cash_equity(65_000_000))
        ctc = compute_cost_to_complete(schedule, model, inputs_with_equity(cash_equity(65_000_000)))
        return schedule, model, ctc

    def test_reproduces_the_hand_derived_month_series_to_the_penny(self):
        _, _, ctc = self.build()
        got = [
            (m.month, m.remaining_cost_pence, m.remaining_funding_pence, m.surplus_pence)
            for m in ctc.months
        ]
        assert got == [
            (1, 25_000_000, 25_000_000, 0),
            (2, 10_000_000, 10_000_000, 0),
            (3, 0, 0, 0),
            (4, 0, 0, 0),
        ]

    def test_none_undrawn_net_facility_pence_contributes_0_not_a_crash_or_shortfall(self):
        _, model, ctc = self.build()
        assert all(m.undrawn_net_facility_pence is None for m in model.months)
        assert ctc.first_shortfall_month is None
        assert ctc.max_shortfall_pence == 0


class TestShortfallDirectionAgainstFundingGap:
    """Spec Sec 5.10 note: only 'shortfall => some ledger funding_gap_pence > 0' is
    asserted, never the reverse and never a full iff."""

    def test_fixture_e_real_funding_gap_series_also_reports_a_genuine_shortfall(self):
        terms = replace(TERMS, committed_net_facility_pence=35_000_000)
        schedule = mk_schedule(USES, SALE)
        model = run_ledger(schedule, terms, cash_equity(25_000_000))
        ctc = compute_cost_to_complete(schedule, model, inputs_with_equity(cash_equity(25_000_000)))
        assert model.totals.funding_gap_pence > 0
        assert ctc.first_shortfall_month is not None
        assert ctc.max_shortfall_pence > 0

    def test_fixture_f_grosscap_gap_can_exist_with_no_shortfall_proving_no_full_iff(self):
        """test_financial_model_engine.py's TestFixtureFGrossHeadroomCap has a real,
        pinned funding_gap_pence of 484,487 (month 2's draw throttled by the gross-
        headroom cap, spec Sec 4.2(c)). compute_cost_to_complete's snapshot-based
        remaining_funding does not re-simulate that future throttling -- it just reads
        the actual (already-computed) undrawn_net_facility_pence at each past month
        boundary -- so it never sees the month-2 shortfall coming: this is the
        documented, deliberate scope limit (spec Sec 5.10 "Known limitation"), not a
        bug."""
        terms = replace(TERMS, committed_gross_facility_pence=36_500_000)
        schedule = mk_schedule(USES, SALE)
        model = run_ledger(schedule, terms, cash_equity(30_000_000))
        ctc = compute_cost_to_complete(schedule, model, inputs_with_equity(cash_equity(30_000_000)))
        assert model.totals.funding_gap_pence == 484_487  # pinned in test_financial_model_engine.py
        assert ctc.first_shortfall_month is None
        assert ctc.max_shortfall_pence == 0

    # R9 Task 12. Fixture P is a natural counter-example to the remaining direction, and
    # it is named here rather than tuned away. Spec Sec 5.10 already says the implication
    # is verified across the current corpus, not proved as a law; fixture P is the first
    # fixture that structures its facility the way a real rolled-up development facility
    # is structured -- a net facility sized to the COSTS (70,000,000p against 66,688,400p
    # of draws and fees) with the interest reserve carved out of the gross facility
    # (8,000,000p of headroom against 3,913,416p of rolled-up interest). Sec 5.10's
    # snapshot charges that interest against the NET facility, so it reports a
    # 392,483p shortfall in month 1 while the ledger records no funding gap at all,
    # because the interest capitalised into gross headroom exactly as intended.
    #
    # That is a real, reportable limitation of Sec 5.10 for rolled-up facilities (see the
    # R9 Task 12 report and spec Sec 5.10's Known limitation) -- not a defect in the
    # fixture, and not something to hide by widening the facility until the metric agrees.
    _SHORTFALL_WITHOUT_GAP_STEMS = {"p-scotland-levered"}

    def test_holds_across_every_golden_fixture(self):
        # Release 3a Task 8: the whole corpus is in scope again -- `parse_calculator_inputs`
        # dispatches on inputs_version, so the inputs_version 4 documents (fixture H, spec
        # Sec 6.1 / calc 2.2.0) are covered here too. Fixture H is a genuine positive case
        # for this implication (shortfall AND funding gap both present), so it strengthens
        # this test rather than just widening it.
        saw_positive_case = False
        saw_counter_example = False
        for path in sorted(FIXTURE_DIR.glob("*.json")):
            doc = json.loads(path.read_text())
            # Release 4a: Fixture K (kind "sensitivity", spec Sec 12) carries no `inputs`
            # of its own -- it names a `base_fixture` instead (model-governance.md
            # Sec 2.1) -- so it has no ledger of its own to check this implication against.
            if doc.get("kind") == "sensitivity":
                continue
            inputs = parse_calculator_inputs(doc["inputs"])
            schedule = build_schedule(inputs)
            model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
            ctc = compute_cost_to_complete(schedule, model, inputs)
            if path.stem in self._SHORTFALL_WITHOUT_GAP_STEMS:
                # Asserted, not merely skipped: if a future change made the metric agree
                # with the ledger here, this fixture must be taken off the list
                # deliberately rather than drift off it in silence.
                assert ctc.first_shortfall_month is not None, path.stem
                assert model.totals.funding_gap_pence == 0, path.stem
                saw_counter_example = True
                continue
            if ctc.first_shortfall_month is not None:
                assert model.totals.funding_gap_pence > 0, path.stem
                saw_positive_case = True
        # Guards against the implication holding only vacuously across the corpus.
        assert saw_positive_case
        assert saw_counter_example
