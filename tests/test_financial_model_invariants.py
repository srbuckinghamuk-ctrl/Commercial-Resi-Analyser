"""R13 Task 10 (spec Sec 19.5): NOI isolation guards.

Transliteration of the "Sec 19.5 NOI isolation" describe block added to
frontend/src/lib/model/invariants.test.ts. Both implementations must agree
with the spec, not merely with each other -- if Python disagrees, the Python
port is wrong -- never adjust these to make peace.

No Python file previously existed under this name -- the task brief's "Modify:
tests/test_financial_model_invariants.py" does not reconcile with the
repository (git log shows the file was never created on any branch). This
file is new, and deliberately holds only this task's guards rather than a
full transliteration of invariants.test.ts's much larger pre-existing
content, which already has its own Python-side coverage scattered across
test_financial_model_validation.py, test_financial_model_metrics.py and
elsewhere.

NOI is income from an asset, not realisation of one -- the same reason
`vat_reclaim_pence` sits outside `gross_sale_pence` now governs
`net_operating_income_pence` (schedule.py's MonthReceipts). These guards
prove NOI cannot leak into a sale-denominated total, into profit, or into the
realisation flag.

DEVIATION FROM THE TASK BRIEF, checked against the real engine before writing
anything here (per the brief's own "verify the reasoning holds... or pin a
different formulation" instruction) -- identical findings to the TypeScript
file's header note:

1. The brief's Step 1 pseudocode asserts `ltgdv_developer_pct`,
   `ltgdv_lender_pct`, `senior_breakeven_pence` and `profit_on_gdv_pct` are
   bit-identical between `blended_doc('market')` and `blended_doc('zero')`.
   They are not: peak_debt_pence for this pair is 59,434,134 vs 61,661,679
   pence -- already pinned in monthly-engine.test.ts's (and its Python
   transliteration's) "reduces the balance" test as NOI's real, intended
   ledger effect (repaying the facility early). ltgdv_developer_pct and
   senior_breakeven_pence move with it; profit_on_gdv_pct moves for the same
   reason profit_pence itself moves (see the profit guard below). The design
   spec (docs/superpowers/specs/2026-08-23-r13-investment-case-design.md
   Sec 8) is more precise than the brief here: "no GDV-.. denominated metric
   may read it [NOI]" is a claim about the FORMULA never taking NOI as an
   input, not about every downstream ratio staying fixed when NOI legitimately
   moves debt. `gdv_pence` itself is what that sentence actually promises
   stays untouched, and it does -- proved two ways below.
2. The brief's Step 1 pseudocode uses `retain_all_noi_doc()` for the
   has_realisation_event/IRR guard. That document's facility (tens of
   millions, inherited from j-blended-refinance.json) is far larger than
   three retained units' NOI could ever redeem inside a 24-month term --
   confirmed against the real engine: `irr_annual_pct` is None there, not the
   non-null value the guard needs. `noi_redeems_doc()` -- the fixture
   fixtures_investment_case.py built specifically because
   `retain_all_noi_doc()`'s facility is "far too large for NOI alone to ever
   redeem" -- is the document that actually clears this bar (the engine test
   already pins its first full redemption at month 2). Used here instead,
   with `retain_all_noi_doc()`'s null IRR pinned alongside it so this comment
   cannot silently go stale.

Also: `tests/test_financial_model_engine.py` (Task 9's fix round) already
pins the Sec 7 sources/uses exclusion for operating_shortfall_equity_pence
mutation-verified, asserting both the boolean and the numeric identity
(99,071,679 uses total, 2,470,200 shortfall) -- that coverage is not
duplicated here. See this task's report for why.
"""
from app.financial_model import run_appraisal
from app.financial_model.schedule import calculate_gdv

from .fixtures_investment_case import blended_doc, noi_redeems_doc, retain_all_noi_doc


class TestNoiIsolation:
    def test_leaves_gdv_pence_untouched_by_noi(self):
        with_run = run_appraisal(blended_doc("market"))
        without_run = run_appraisal(blended_doc("zero"))
        with_noi = with_run.metrics
        without = without_run.metrics

        # Guard against vacuity: NOI must actually be flowing in the 'market'
        # document, or every assertion below would pass even if gdv_pence
        # read it.
        total_noi = sum(r.net_operating_income_pence for r in with_run.schedule.receipts)
        assert total_noi > 0

        # gdv_pence is calculate_gdv(all units) -- a valuation total with zero
        # structural path through the ledger or the receipts list at all.
        # Re-derived here from the inputs directly (not from the schedule's
        # own output), so a change that made gdv_pence read the ledger in ANY
        # way -- NOI included -- would show up here.
        recomputed_gdv = calculate_gdv(with_run.inputs.unit_mix.units)
        assert with_noi.gdv_pence == recomputed_gdv
        assert with_noi.gdv_pence == without.gdv_pence

    def test_does_not_enter_profit_profit_plus_finance_costs_is_what_stays_equal(self):
        with_noi = run_appraisal(blended_doc("market")).metrics
        without = run_appraisal(blended_doc("zero")).metrics

        # Confirm the premise before relying on it: NOI must actually have
        # moved finance_costs_pence (via lower interest from its own early
        # repayment) and profit_pence, or the summed identity below would
        # hold vacuously even with NOI wrongly added straight to profit.
        assert with_noi.finance_costs_pence != without.finance_costs_pence
        assert with_noi.profit_pence != without.profit_pence

        # Profit is the development residual, GDV - TDC, and TDC includes
        # finance costs -- so with cost-before-finance and gross receipts
        # unchanged (identical sale receipts, identical unit costs; only the
        # retained unit's rent differs), profit + finance_costs_pence is the
        # quantity that survives NOI moving one without the other.
        assert (with_noi.profit_pence + with_noi.finance_costs_pence
                == without.profit_pence + without.finance_costs_pence)

    def test_keeps_has_realisation_event_false_on_a_retain_all_case_that_earns_noi(self):
        r = run_appraisal(noi_redeems_doc()).metrics
        assert r.has_realisation_event is False
        assert r.return_on_equity_is_unrealised is True
        assert r.irr_annual_pct is not None

        # The brief's own fixture choice, pinned alongside it:
        # retain_all_noi_doc() stays unrealised too, but genuinely produces no
        # IRR (see the module header note) -- this is not the deviation being
        # tested, it is why noi_redeems_doc() is used above.
        retained = run_appraisal(retain_all_noi_doc()).metrics
        assert retained.has_realisation_event is False
        assert retained.return_on_equity_is_unrealised is True
        assert retained.irr_annual_pct is None
