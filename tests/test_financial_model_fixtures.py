import json
from pathlib import Path

import pytest

from app.financial_model import AppraisalRun, run_appraisal
from app.financial_model.engine import exit_fee_amount, money_round
from app.financial_model.metrics import pct
from app.financial_model.migrate import migrate_inputs, migrate_inputs_to_v4
from app.financial_model.types import (
    AnyCalculatorInputs,
    CalculatorInputsV4,
    ProgrammeInputs,
    ProgrammePackage,
    ProgrammePackages,
    SalesPhasingInputs,
    SalesPhasingTranche,
    SimpleSpendCurve,
    parse_calculator_inputs,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"
FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))

# The corpus is loaded by directory scan, so a fixture file that is deleted, renamed or
# never committed would silently reduce coverage instead of failing. This explicit roster
# is the "fixture list" and mirrors golden-fixtures.test.ts's EXPECTED_FIXTURE_STEMS:
# adding a golden fixture means adding its stem here (and there) too.
EXPECTED_FIXTURE_STEMS = [
    "a-all-cash",
    "f-dev-finance-12mo",
    "g-lender-valuation",
    "h-programme-scurve",
    "i-phased-sales",
    "j-blended-refinance",
]

# Minimal flat-key -> run-structure mapping for the fixture keys that are not direct
# AppraisalResultV2 attributes. Every other expected_metrics key is a real, direct
# AppraisalResultV2 attribute, asserted via getattr below without this indirection.
#
# The mapper takes the whole AppraisalRun (widened in Release 3a from the previous
# cost_to_complete-only signature, mirroring golden-fixtures.test.ts's FLAT_KEYS) so a
# pinnable quantity living outside `metrics` -- like the ledger's funding gap -- can be
# pinned without restructuring the harness.
_FLAT_KEYS = {
    # spec Sec 5.10, Release 2b Task 6
    "cost_to_complete_first_shortfall_month": (
        lambda r: r.metrics.cost_to_complete.first_shortfall_month
        if r.metrics.cost_to_complete else None
    ),
    "cost_to_complete_max_shortfall_pence": (
        lambda r: r.metrics.cost_to_complete.max_shortfall_pence
        if r.metrics.cost_to_complete else None
    ),
    # spec Sec 4.2 step 3 ("cost overruns never create facility"), Release 3a: the
    # accumulated unfunded cost. It is the headline behaviour of fixture H, so it must be
    # pinned, but it is a ledger total rather than a summary metric.
    "funding_gap_pence": lambda r: r.model.totals.funding_gap_pence,
    # spec Sec 4.4.1 (calc 2.3.0), Release 3b: the phased-disposal redemption fields.
    # Like funding_gap_pence above, these are `model` properties rather than summary
    # metrics, so they reach the harness through the same AppraisalRun-wide mapper. The
    # declining schedule is pinned as two parallel flat arrays (months / balances)
    # rather than an array of objects, mirroring golden-fixtures.test.ts's FLAT_KEYS.
    "redemption_balance_at_disposal_pence": lambda r: r.model.redemption_balance_at_disposal_pence,
    "redemption_schedule_months": lambda r: [e.month for e in r.model.redemption_schedule],
    "redemption_schedule_balances_pence": (
        lambda r: [e.balance_pence for e in r.model.redemption_schedule]
    ),
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _assert_expected_metrics(run: AppraisalRun, doc: dict, label: str) -> None:
    for key, expected in doc["expected_metrics"].items():
        mapper = _FLAT_KEYS.get(key)
        actual = mapper(run) if mapper else getattr(run.metrics, key)
        assert actual == expected, f"{label}.{key}: {actual} != {expected}"


def test_every_expected_fixture_file_is_present_in_the_shared_corpus() -> None:
    assert [p.name for p in FIXTURES] == [f"{s}.json" for s in EXPECTED_FIXTURE_STEMS]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    _assert_expected_metrics(run, doc, path.stem)


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_pre_v4_fixtures_reproduce_their_metrics_after_migration_to_v4(path: Path) -> None:
    """Release 3a identity guarantee (spec Sec 6.1 / design Sec 2.4): the v3 -> v4
    migration is purely additive, so running a pre-v4 fixture's inputs through the full
    normalisation chain (exactly what app.py now does on every request) must reproduce
    that fixture's pinned expected_metrics unchanged -- not merely "close", byte-for-byte.
    Fixture H is already v4; migrating it is a no-op merge onto v4 defaults, which is
    itself worth asserting (the merge must not drop its programme block)."""
    doc = _load_fixture(path)
    v4 = parse_calculator_inputs(migrate_inputs_to_v4(doc["inputs"]))
    assert v4.inputs_version == 4
    _assert_expected_metrics(run_appraisal(v4), doc, f"{path.stem}[migrated-to-v4]")


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_invariants(path: Path) -> None:
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    for m in run.model.months:
        assert m.closing_balance_pence == (
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
            + m.interest_capitalised_pence - m.repayment_pence
        )
        assert m.closing_balance_pence >= 0
    assert run.reconciliation.sources_equal_uses


def _programme_for_term(term_months: int) -> ProgrammeInputs:
    """Port of invariants.test.ts's `programmeForTerm`: a generic programme fitted to
    any term_months, sitting well inside the spec Sec 6 window bound (finish by
    term-2) -- every package starts at month 0, so it stays valid even for a short
    term rather than assuming term=12."""
    term = max(1, int(term_months))
    cap = max(1, term - 2)
    return ProgrammeInputs(
        anchor_month=None,
        packages=ProgrammePackages(
            construction=ProgrammePackage(
                start_offset=0, duration_months=min(6, cap), curve=SimpleSpendCurve(kind="s_curve"),
            ),
            professional=ProgrammePackage(
                start_offset=0, duration_months=min(3, cap), curve=SimpleSpendCurve(kind="straight_line"),
            ),
            statutory=ProgrammePackage(
                start_offset=0, duration_months=min(2, cap), curve=SimpleSpendCurve(kind="back_loaded"),
            ),
        ),
    )


def _invariant_variants(inputs: AnyCalculatorInputs) -> list[tuple[str, AnyCalculatorInputs]]:
    """Mirrors invariants.test.ts's `variants()`: derived transformations of each
    fixture, widening coverage without new hand calcs. Each variant is deep-copied off
    the base `inputs` so mutating one never leaks into another (or into the base).

    Release 3a Task 9 adds a fifth, "programme", variant so every ledger invariant
    below also exercises the dated-programme path (spec Sec 6.1), not just fixture
    H's hand-authored one -- mirroring invariants.test.ts's own addition."""
    retained = inputs.model_copy(deep=True)
    retained.exit_strategy.route = "retain_all"
    serviced = inputs.model_copy(deep=True)
    serviced.finance.interest_type = "serviced"
    short_term = inputs.model_copy(deep=True)
    short_term.finance.term_months = 1
    programmed = parse_calculator_inputs(migrate_inputs_to_v4(inputs.model_dump(mode="json")))
    assert isinstance(programmed, CalculatorInputsV4)
    programmed.programme = _programme_for_term(programmed.finance.term_months)
    return [
        ("base", inputs),
        ("retain_all", retained),
        ("serviced", serviced),
        ("term=1", short_term),
        ("programme", programmed),
    ]


def _fixture_variant_matrix() -> list[tuple[str, str, AnyCalculatorInputs]]:
    out: list[tuple[str, str, AnyCalculatorInputs]] = []
    for path in FIXTURES:
        doc = _load_fixture(path)
        base_inputs = parse_calculator_inputs(doc["inputs"])
        for label, variant_inputs in _invariant_variants(base_inputs):
            out.append((path.stem, label, variant_inputs))
    return out


_FIXTURE_VARIANTS = _fixture_variant_matrix()
_FIXTURE_VARIANT_IDS = [f"{stem}[{label}]" for stem, label, _ in _FIXTURE_VARIANTS]


@pytest.mark.parametrize("stem,label,inputs", _FIXTURE_VARIANTS, ids=_FIXTURE_VARIANT_IDS)
class TestInvariantMatrix:
    """Python port of frontend/src/lib/model/invariants.test.ts's top `describe` block
    (spec Sec 4/Sec 8 roll-forward invariant, Sec 5.7 peak debt, Sec 3.9/Sec 9 zero-debt
    cost, Sec 4.4 retained exits, Sec 6 schedule spreads, Sec 3.12/Sec 7 profit identity,
    Sec 7 TDC identity): every golden fixture run through the same 5 derived variants
    (base/retain_all/serviced/term=1/programme -- the last fitting a generic dated
    programme to the variant's term, spec Sec 6.1) TS exercises, giving the same widened
    coverage on the Python side. Closes the gap recorded in docs/financial-model/test-cases.md Sec 4
    and Sec 7. Each TS `it()` in that describe block has a one-to-one Python method
    below (same order), rather than one flat function, so a single invariant's failure
    doesn't mask the others -- the same diagnostic granularity as the TS suite."""

    def test_debt_rollforward_reconciles_and_closing_balance_never_negative(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        for m in run.model.months:
            assert m.closing_balance_pence == (
                m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
                + m.interest_capitalised_pence - m.repayment_pence
            )
            assert m.closing_balance_pence >= 0

    def test_sources_equal_uses_unconditionally(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        """Release 3a Task 9 (spec Sec 7): sources = uses is an unconditional accounting
        identity (validation.reconcile()), not just true "when fully realised" -- this
        closes the gap where only the fully-realised profit-identity test below
        exercised it, and is exactly what surfaces a programme mis-wiring in
        build_schedule."""
        run = run_appraisal(inputs)
        assert run.reconciliation.sources_equal_uses is True

    def test_peak_debt_equals_the_maximum_monthly_pre_repayment_balance(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        max_balance = max(
            [0] + [
                m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
                + m.interest_capitalised_pence
                for m in run.model.months
            ]
        )
        assert run.model.peak_debt_pence == max_balance

    def test_cash_funding_produces_zero_debt_cost(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        if inputs.finance.funding_source == "cash":
            assert run.metrics.finance_costs_pence == 0
            assert run.model.totals.draws_pence == 0

    def test_retained_exits_receive_no_sale_proceeds(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        if inputs.exit_strategy.route == "retain_all":
            assert all(m.gross_receipts_pence == 0 for m in run.model.months)
            assert run.metrics.selling_costs_pence == 0

    def test_monthly_schedule_spreads_sum_exactly_to_cost_totals(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        assert (
            sum(m.construction_pence for m in run.schedule.uses)
            == run.schedule.totals.construction_pence
        )
        assert (
            sum(m.professional_pence for m in run.schedule.uses)
            == run.schedule.totals.professional_pence
        )
        assert (
            sum(m.statutory_pence for m in run.schedule.uses)
            == run.schedule.totals.statutory_pence
        )

    def test_profit_equals_equity_flows_and_sources_equal_uses_when_fully_realised(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        run = run_appraisal(inputs)
        fully_realised = (
            run.model.senior_outstanding_at_maturity_pence == 0
            and run.schedule.totals.retained_value_pence == 0
            and run.model.totals.funding_gap_pence == 0
        )
        if fully_realised:
            assert run.metrics.profit_pence == sum(run.model.equity_cashflows_pence)
            assert run.reconciliation.sources_equal_uses is True

    def test_tdc_equals_the_sum_of_all_monthly_uses_plus_rolled_interest_capitalised_fees_and_exit_fee(
        self, stem: str, label: str, inputs: AnyCalculatorInputs,
    ) -> None:
        # Task 6 correction (spec Sec 7): monthly uses_total_pence includes month-0
        # ancillary fees but NOT the capitalised arrangement fee, while TDC (from
        # metrics) does include it -- so the identity needs an explicit
        # + capitalised_fees_pence term.
        run = run_appraisal(inputs)
        monthly_uses = sum(m.uses_total_pence for m in run.model.months)
        rolled = sum(m.interest_capitalised_pence for m in run.model.months)
        serviced = sum(m.interest_serviced_pence for m in run.model.months)
        assert run.metrics.total_development_cost_pence == (
            monthly_uses + rolled + serviced + run.metrics.selling_costs_pence
            + run.model.totals.exit_fee_pence + run.model.totals.capitalised_fees_pence
        )


# Release 3b Task 10 (spec Sec 4.4.1/Sec 4.5, calc 2.3.0): phased-sale / refinance sweep
# invariants over fixture I (phased sell_all) and J (phased + blended refinance) -shaped
# inputs, plus two "awkward pence" derivatives per fixture (odd gross totals; a 3-tranche
# 33.4/33.3/33.3 split) -- 2 fixtures x 3 variants = 6 runs. Both fixtures, and every
# derivative built here, keep finance.interest_type == "rolled_up" and a non-negative
# refinance net proceeds figure (never touched by these variants) -- that is what makes
# the sweep-conservation identity below an *exact* equality rather than a bound: with
# rolled_up interest, engine.py's interest-serviced branch (the other source that can add
# to additional_equity_pence) never fires, so every pence of additional_equity_pence(m) in
# these runs is attributable to the refinance-shortfall branches alone. Mirrors
# invariants.test.ts's "phased-sale / refinance sweep invariants" describe block
# field-for-field (same variant labels, same 4 checks, same order).
def _to_v4_clone(inputs: AnyCalculatorInputs) -> CalculatorInputsV4:
    if not isinstance(inputs, CalculatorInputsV4):
        raise TypeError("sweep-invariant fixture must be inputs_version 4")
    return inputs.model_copy(deep=True)


def _odd_gross_sweep_variant(inputs: AnyCalculatorInputs) -> CalculatorInputsV4:
    """Nudge each unit's value by a distinct odd pence amount so gross sale totals,
    tranche splits and agent-fee rounding all land on awkward (non-round) pence."""
    v = _to_v4_clone(inputs)
    for i, u in enumerate(v.unit_mix.units):
        u.estimated_value_pence += 2 * i + 1
    return v


def _three_tranche_sweep_variant(inputs: AnyCalculatorInputs) -> CalculatorInputsV4:
    v = _to_v4_clone(inputs)
    last = max(0, int(v.finance.term_months) - 1)
    v.sales_phasing = SalesPhasingInputs(
        tranches=[
            SalesPhasingTranche(month_offset=max(0, last - 2), pct_of_gross_receipts=33.4),
            SalesPhasingTranche(month_offset=max(0, last - 1), pct_of_gross_receipts=33.3),
            SalesPhasingTranche(month_offset=last, pct_of_gross_receipts=33.3),
        ],
    )
    return v


def _sweep_variants(inputs: AnyCalculatorInputs) -> list[tuple[str, CalculatorInputsV4]]:
    return [
        ("base", _to_v4_clone(inputs)),
        ("odd-gross", _odd_gross_sweep_variant(inputs)),
        ("three-tranche", _three_tranche_sweep_variant(inputs)),
    ]


def _sweep_fixture_variant_matrix() -> list[tuple[str, str, CalculatorInputsV4]]:
    out: list[tuple[str, str, CalculatorInputsV4]] = []
    for path in FIXTURES:
        if path.stem not in ("i-phased-sales", "j-blended-refinance"):
            continue
        doc = _load_fixture(path)
        base_inputs = parse_calculator_inputs(doc["inputs"])
        for label, variant_inputs in _sweep_variants(base_inputs):
            out.append((path.stem, label, variant_inputs))
    return out


_SWEEP_FIXTURE_VARIANTS = _sweep_fixture_variant_matrix()
assert len(_SWEEP_FIXTURE_VARIANTS) == 6, "expected fixtures I and J x 3 variants = 6 sweep-invariant runs"
_SWEEP_FIXTURE_VARIANT_IDS = [f"{stem}[{label}]" for stem, label, _ in _SWEEP_FIXTURE_VARIANTS]


@pytest.mark.parametrize("stem,label,inputs", _SWEEP_FIXTURE_VARIANTS, ids=_SWEEP_FIXTURE_VARIANT_IDS)
class TestPhasedSaleRefinanceSweepInvariants:
    """Python port of invariants.test.ts's 'phased-sale / refinance sweep invariants'
    describe block (Release 3b Task 10, spec Sec 4.4.1/Sec 4.5, calc 2.3.0): fixtures I and
    J, each run through 3 derived variants (base / odd-gross / three-tranche), giving the
    same 2 x 3 = 6-way matrix TS exercises. One Python test method per TS `it()` (same
    order), so a single invariant's failure doesn't mask the others."""

    def test_tranche_conservation_gross_agent_legal(
        self, stem: str, label: str, inputs: CalculatorInputsV4,
    ) -> None:
        run = run_appraisal(inputs)
        sum_gross = sum(r.gross_sale_pence for r in run.schedule.receipts)
        sum_agent = sum(r.agent_fee_pence for r in run.schedule.receipts)
        sum_legal = sum(r.selling_legal_pence for r in run.schedule.receipts)
        assert sum_gross == run.schedule.totals.gross_sales_pence
        assert sum_agent == money_round(
            (run.schedule.totals.gross_sales_pence * inputs.exit_strategy.selling_agent_fee_pct) / 100
        )
        assert sum_legal == (
            inputs.exit_strategy.selling_legal_fee_pence
            if run.schedule.totals.gross_sales_pence > 0 else 0
        )

    def test_sweep_conservation_every_month(
        self, stem: str, label: str, inputs: CalculatorInputsV4,
    ) -> None:
        """Pinned identity, derived from engine.py's sweep block (repayment/exit_fee/
        distribution split net_receipts exactly: `distribution = net_receipts - repayment -
        exit_fee`) composed with its refinance block (which either (a) tops up distribution
        by `refi_net - required` when refi_net >= balance+fee, or (b) adds `required -
        refi_net` to additional_equity when it doesn't, or (c) -- balance already 0 -- adds
        the whole refi_net to distribution): in every case the four fields below net to
        exactly zero. Holds every month, not just disposal/refinance months (both sides are
        0 otherwise)."""
        run = run_appraisal(inputs)
        for m in run.model.months:
            assert (
                m.distribution_pence + m.repayment_pence + m.exit_fee_pence
                == m.net_receipts_pence + m.refinance_proceeds_pence + m.additional_equity_pence
            )

    def test_interest_never_accrues_on_repaid_principal(
        self, stem: str, label: str, inputs: CalculatorInputsV4,
    ) -> None:
        run = run_appraisal(inputs)
        monthly_rate = inputs.finance.annual_interest_rate_pct / 100 / 12
        months = run.model.months
        for i in range(len(months) - 1):
            expected = money_round(
                (months[i].closing_balance_pence + months[i + 1].draw_pence
                 + months[i + 1].capitalised_fees_pence) * monthly_rate
            )
            assert months[i + 1].interest_accrued_pence == expected

    def test_redemption_schedule_declines(
        self, stem: str, label: str, inputs: CalculatorInputsV4,
    ) -> None:
        run = run_appraisal(inputs)
        sched = run.model.redemption_schedule
        for i in range(1, len(sched)):
            assert sched[i].month > sched[i - 1].month
            assert sched[i].balance_pence <= sched[i - 1].balance_pence
        if sched:
            assert run.model.redemption_balance_at_disposal_pence == sched[-1].balance_pence


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_lender_gdv_never_defaults_to_developer_gdv(path: Path) -> None:
    """Spec Sec 3.2 / Release 2b Task 3: lender-basis metrics must never default
    to developer GDV -- null is the only representation of "unknown", exactly
    when the block itself is absent, on every fixture."""
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    block_present = inputs.lender_valuation is not None
    assert (run.metrics.lender_gdv_pence is None) == (not block_present)
    if block_present:
        # Recomputed here (not just re-asserted against the pinned fixture value)
        # so this catches a regression where ltgdv_lender_pct is wired to
        # developer GDV instead of lender GDV.
        assert run.metrics.ltgdv_lender_pct == pct(
            run.model.peak_debt_pence, run.metrics.lender_gdv_pence
        )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_null_iff_no_disposal(path: Path) -> None:
    """Release 2b Task 4 (spec Sec 5.11): senior_breakeven_pence is null exactly when
    the ledger recorded no disposal (cash deals, or nothing sold)."""
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert (run.metrics.senior_breakeven_pence is None) == (
        run.model.redemption_balance_at_disposal_pence is None
    )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_covers_redemption_plus_exit_fee(path: Path) -> None:
    """When non-null, senior_breakeven_pence >= redemption balance + exit fee due on
    redeeming it (spec Sec 5.11 invariant)."""
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    redemption = run.model.redemption_balance_at_disposal_pence
    if redemption is not None and run.metrics.senior_breakeven_pence is not None:
        exit_fee = exit_fee_amount(
            inputs.finance, run.model.committed_gross_facility_pence, run.model.peak_debt_pence,
            redemption,
        )
        assert run.metrics.senior_breakeven_pence >= redemption + exit_fee


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_percentages_null_unless_lender_gdv_present(path: Path) -> None:
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    lender_gdv_present = run.metrics.lender_gdv_pence is not None
    if run.metrics.senior_breakeven_pence is None or not lender_gdv_present:
        assert run.metrics.senior_breakeven_pct_of_lender_gdv is None
        assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is None
    else:
        assert run.metrics.senior_breakeven_pct_of_lender_gdv is not None
        assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is not None
        total = (
            run.metrics.senior_breakeven_pct_of_lender_gdv
            + run.metrics.senior_breakeven_fall_from_lender_gdv_pct
        )
        assert round(total, 2) == 100.0


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_developer_breakeven_null_iff_no_disposal(path: Path) -> None:
    """Release 2b Task 5 (spec Sec 5.12): developer_breakeven_pence is null exactly when
    the schedule recorded no disposal at all (gross_sales_pence == 0) -- a strictly wider
    condition than senior_breakeven_pence's redemption-balance guard, since it does not
    depend on a facility existing."""
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert (run.metrics.developer_breakeven_pence is None) == (
        run.schedule.totals.gross_sales_pence == 0
    )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_developer_breakeven_covers_tdc_ex_selling_plus_legal(path: Path) -> None:
    """When non-null, developer_breakeven_pence >= TDC-ex-selling + the flat selling
    legal fee (spec Sec 5.12 invariant -- the fixed-cost floor before the agent's
    percentage fee on P itself)."""
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    if run.metrics.developer_breakeven_pence is not None:
        tdc_ex_selling = run.metrics.total_development_cost_pence - run.metrics.selling_costs_pence
        assert run.metrics.developer_breakeven_pence >= (
            tdc_ex_selling + inputs.exit_strategy.selling_legal_fee_pence
        )


def test_developer_breakeven_non_null_for_cash_fixture_a() -> None:
    """Debt-independence: fixture A is a cash deal with no facility (senior_breakeven_pence
    is null for it), but it still sold every unit, so developer_breakeven_pence must be
    non-null."""
    doc = json.loads((FIXTURE_DIR / "a-all-cash.json").read_text())
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert run.model.redemption_balance_at_disposal_pence is None
    assert run.metrics.senior_breakeven_pence is None
    assert run.metrics.developer_breakeven_pence is not None


def test_developer_breakeven_unsolvable_flag_raised_once_when_agent_fee_at_100_pct() -> None:
    """Release 2b Task 5 (spec Sec 5.12): when the agent fee is >= 100%, the solver
    returns None and derive_metrics raises exactly one developer_breakeven_unsolvable red
    flag on the result, with the exact spec-mandated message -- mirroring Task 4's
    senior_breakeven_unsolvable flag."""
    doc = json.loads((FIXTURE_DIR / "f-dev-finance-12mo.json").read_text())
    doc["inputs"]["exit_strategy"]["selling_agent_fee_pct"] = 100
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)

    assert run.schedule.totals.gross_sales_pence > 0
    assert run.metrics.developer_breakeven_pence is None
    # Deviation from brief (R3a Task 6): derive_metrics no longer mutates model.flags
    # -- the flag now lands on the result's own `flags` list, not model.flags. The
    # assertion content is unchanged.
    flags = [f for f in run.metrics.flags if f.code == "developer_breakeven_unsolvable"]
    assert len(flags) == 1
    assert flags[0].severity == "red"
    assert flags[0].month is None
    assert flags[0].amount_pence is None
    assert flags[0].message == "agent fee ≥ 100% — break-even unsolvable"


def test_senior_breakeven_all_null_for_cash_fixture_a() -> None:
    doc = json.loads((FIXTURE_DIR / "a-all-cash.json").read_text())
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert run.model.redemption_balance_at_disposal_pence is None
    assert run.metrics.senior_breakeven_pence is None
    assert run.metrics.senior_breakeven_pct_of_lender_gdv is None
    assert run.metrics.senior_breakeven_fall_from_lender_gdv_pct is None


def test_senior_breakeven_unsolvable_flag_raised_once_when_agent_fee_at_100_pct() -> None:
    """Release 2b Task 4 (spec Sec 5.11): when the agent fee is >= 100%, the solver
    returns None and derive_metrics raises exactly one senior_breakeven_unsolvable red
    flag on the result, with the exact spec-mandated message."""
    doc = json.loads((FIXTURE_DIR / "f-dev-finance-12mo.json").read_text())
    doc["inputs"]["exit_strategy"]["selling_agent_fee_pct"] = 100
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)

    assert run.model.redemption_balance_at_disposal_pence is not None
    assert run.metrics.senior_breakeven_pence is None
    # Deviation from brief (R3a Task 6): derive_metrics no longer mutates model.flags
    # -- the flag now lands on the result's own `flags` list, not model.flags. The
    # assertion content is unchanged.
    flags = [f for f in run.metrics.flags if f.code == "senior_breakeven_unsolvable"]
    assert len(flags) == 1
    assert flags[0].severity == "red"
    assert flags[0].month is None
    assert flags[0].amount_pence is None
    assert flags[0].message == "agent fee ≥ 100% — break-even unsolvable"


def test_migration_preserves_floors_zero() -> None:
    """conversion-defaults.ts:162 uses `project?.floors ?? DEFAULT_DEAL_SPIDER.storeys`
    -- nullish coalescing, which only falls through on None/absent. A Python port
    using `or` instead of a None-check would wrongly replace a genuine `floors: 0`
    (e.g. a single-storey unit) with the default storeys (2), and cascade into a
    non-zero building_height_m. Both must come out as exactly 0."""
    project = {"id": "p1", "price_pence": 0, "floor_area_sqm": 0, "floors": 0}
    run = migrate_inputs({}, project)
    assert run.deal_spider.storeys == 0
    assert run.deal_spider.building_height_m == 0
