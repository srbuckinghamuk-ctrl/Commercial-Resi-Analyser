import copy
import json
from pathlib import Path

import pytest

from app.financial_model import AppraisalRun, run_appraisal
from app.financial_model.engine import exit_fee_amount, money_round
from app.financial_model.metrics import pct
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.migrate import (
    migrate_inputs,
    migrate_inputs_to_v5,
    migrate_inputs_to_v6,
)
from app.financial_model.schedule import build_schedule
from app.financial_model.sensitivity import (
    DEFAULT_SENSITIVITY_CONFIG,
    SensitivityAxis,
    SensitivityConfig,
    TornadoRange,
    run_sensitivity,
)
from app.financial_model.types import (
    AnyCalculatorInputs,
    CalculatorInputsV5,
    CalculatorInputsV6,
    ProgrammeInputs,
    ProgrammePackage,
    ProgrammePackages,
    SalesPhasingInputs,
    ScenarioOverrides,
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
    "k-sensitivity",
    "l-retain-all",
    "m-wales-jurisdiction",
    "n-area-bridge",
    "o-ancillary-value",
    "p-scotland-levered",
]

# Every fixture that carries its own `inputs` document, i.e. everything the run_appraisal
# parametrisations below can run. Fixture K (kind "sensitivity", spec Sec 12) names a
# `base_fixture` instead of carrying inputs -- see model-governance.md Sec 2.1 -- so it is
# asserted by TestFixtureKSensitivity at the end of this module instead. Mirrors
# golden-fixtures.test.ts's `appraisalFixtures`.
APPRAISAL_FIXTURES = [
    p for p in FIXTURES
    if json.loads(p.read_text(encoding="utf-8")).get("kind") != "sensitivity"
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
    # R9 spec Sec 15.5, fixture O: gross sale receipts. GDV counts every unit's
    # ancillary, receipts count only the SOLD units' -- under a blended exit the two
    # figures must differ by exactly the retained units' ancillary, and neither number
    # alone can prove that. A schedule total rather than a summary metric, hence the
    # mapper. Mirrors golden-fixtures.test.ts's FLAT_KEYS.
    "gross_sales_pence": lambda r: r.schedule.totals.gross_sales_pence,
}


def _resolve_path(root, path: str):
    """Resolves a dotted expected_metrics key (R9: ``area_bridge.<field>``) against the
    metrics object. A plain key is just a one-segment path. Mirrors
    golden-fixtures.test.ts's ``resolvePath``: AreaBridgeResult has 23 fields, and
    pinning them individually keeps the fixture JSON language-neutral -- pinning the
    whole object would compare this dataclass against a JSON dict and never pass."""
    for part in path.split("."):
        root = getattr(root, part)
    return root


def _version_of(doc: dict) -> int:
    return doc["inputs"].get("inputs_version", 2)


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _assert_pins(run: AppraisalRun, pins: dict, label: str) -> None:
    for key, expected in pins.items():
        mapper = _FLAT_KEYS.get(key)
        actual = mapper(run) if mapper else _resolve_path(run.metrics, key)
        assert actual == expected, f"{label}.{key}: {actual} != {expected}"


def _assert_expected_metrics(run: AppraisalRun, doc: dict, label: str) -> None:
    _assert_pins(run, doc["expected_metrics"], label)


def test_every_expected_fixture_file_is_present_in_the_shared_corpus() -> None:
    assert [p.name for p in FIXTURES] == [f"{s}.json" for s in EXPECTED_FIXTURE_STEMS]


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    run = run_appraisal(inputs)
    _assert_expected_metrics(run, doc, path.stem)


# R9: the corpus now mixes v5 and v6 documents. migrate_inputs_to_v5 refuses a v6 one by
# design -- producing a v5 document would mean dropping ``areas`` and every unit's
# ``ancillary`` block -- so the migration-to-v5 identity is asserted over the v5 fixtures
# and the (stronger, corpus-wide) migration-to-v6 identity below covers everything.
_V5_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 5]
_V6_FIXTURES = [p for p in APPRAISAL_FIXTURES if _version_of(_load_fixture(p)) == 6]


def test_every_fixture_is_v5_or_v6_and_both_groups_are_non_empty() -> None:
    """Mirrors golden-fixtures.test.ts. Without this, a fixture whose inputs_version
    was mistyped would drop out of both parametrisations rather than fail."""
    assert len(_V5_FIXTURES) + len(_V6_FIXTURES) == len(APPRAISAL_FIXTURES)
    assert len(_V5_FIXTURES) > 0
    assert [p.stem for p in _V6_FIXTURES] == [
        "n-area-bridge", "o-ancillary-value", "p-scotland-levered",
    ]


@pytest.mark.parametrize("path", _V5_FIXTURES, ids=lambda p: p.stem)
def test_fixtures_reproduce_their_metrics_after_migration_to_v5(path: Path) -> None:
    """Release 3a identity guarantee (spec Sec 6.1 / design Sec 2.4), carried to v5
    by R8: the migration chain is purely additive, so running a fixture's inputs
    through the full normalisation chain (exactly what app.py does on every request)
    must reproduce that fixture's pinned expected_metrics unchanged -- not merely
    "close", byte-for-byte. These fixtures are already v5, so migrating one is a merge
    onto v5 defaults, which is itself worth asserting (the merge must not drop the
    programme block, nor the R8 acquisition block)."""
    doc = _load_fixture(path)
    # migrate_inputs_to_v5 returns a validated CalculatorInputsV5 directly
    # (unlike migrate_inputs_to_v4, which returns a plain dict).
    v5 = migrate_inputs_to_v5(doc["inputs"])
    assert v5.inputs_version == 5
    _assert_expected_metrics(run_appraisal(v5), doc, f"{path.stem}[migrated-to-v5]")


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_fixtures_reproduce_their_metrics_after_migration_to_v6(path: Path) -> None:
    """R9: the same identity guarantee at the head of the chain, and the one that now
    covers the WHOLE corpus -- migrate_inputs_to_v6 accepts a v5 document (upgrade path)
    and a v6 one (merge branch) alike. The merge branch is the one that matters for the
    new fixtures: it must carry ``areas`` and every unit's ``ancillary`` through
    untouched, and a merge that silently reset either to the zeroed default would move
    fixture N's construction cost by 16,170,000p and fixture O's GDV by 4,500,000p
    rather than pass."""
    doc = _load_fixture(path)
    v6 = migrate_inputs_to_v6(doc["inputs"])
    assert v6.inputs_version == 6
    _assert_expected_metrics(run_appraisal(v6), doc, f"{path.stem}[migrated-to-v6]")


# R9 Task 12. A fixture may pin the appraisal produced by one of its OWN named scenarios
# (spec Sec 12.1). Fixture O uses this to carry the ancillary split all the way through a
# -10% GDV stress: the stressed ancillary values are hand-derived, so a scenario binding
# that stressed internal value alone -- the pre-Task-7 behaviour -- fails here rather than
# passing on the internal figures. Mirrors golden-fixtures.test.ts's scenario loop.
_SCENARIO_CASES = [
    (path, name)
    for path in APPRAISAL_FIXTURES
    for name in _load_fixture(path).get("expected_scenarios", {})
]


def test_at_least_one_fixture_pins_a_scenario_appraisal() -> None:
    """Non-vacuity: an ``expected_scenarios`` block dropped by an edit would otherwise
    shrink the parametrisation below to nothing rather than fail."""
    assert [(p.stem, n) for p, n in _SCENARIO_CASES] == [("o-ancillary-value", "downside")]


@pytest.mark.parametrize(
    "path,scenario", _SCENARIO_CASES, ids=lambda x: x if isinstance(x, str) else x.stem,
)
def test_fixture_reproduces_its_hand_derived_scenario(path: Path, scenario: str) -> None:
    doc = _load_fixture(path)
    inputs = parse_calculator_inputs(doc["inputs"])
    overrides = getattr(inputs.scenarios, scenario)
    run = run_appraisal(apply_scenario(inputs, overrides))
    _assert_pins(run, doc["expected_scenarios"][scenario], f"{path.stem}[{scenario}]")


# Fix round 2 (R8 Task 5). Every fixture in the corpus is now v5, so the test above
# proves only that "a v5 document merged onto v5 defaults reproduces its pins". The
# property that matters for real data is the other one: *an old stored document still
# reproduces its pins after normalisation* -- every persisted row in the database is
# v3 or v4, and nothing writes v5 yet. This reverses the R8 additions and re-runs the
# whole corpus through the migration chain from where it actually was before this
# release. Mirrors golden-fixtures.test.ts.
_R8_ACQUISITION_KEYS = (
    "jurisdiction", "jurisdiction_source", "jurisdiction_evidence_status",
    "acquisition_date", "acquisition_tax_override_pence",
    "acquisition_tax_override_reason",
)


def _as_pre_r8_document(inputs: dict) -> dict:
    doc = copy.deepcopy(inputs)
    for key in _R8_ACQUISITION_KEYS:
        doc["acquisition"].pop(key, None)
    # The pre-R8 version, derived structurally rather than hard-coded per stem: the
    # three v4 blocks arrived together in Release 3a, so a fixture carrying
    # `programme` was v4 and one without it was v3.
    doc["inputs_version"] = 4 if "programme" in doc else 3
    return doc


# R8 Task 12. The property below ("a pre-R8 document reproduces its pins") is only
# well-defined for a fixture whose pinned figures are England/NI ones: the migration
# stamps `england_ni` *by definition*, because that is what every legacy document
# implicitly was. A non-English fixture has no pre-R8 form -- stripping the R8 fields
# does not recover an older document, it asserts a different property. So the
# parametrisation runs over the England/NI fixtures, and the excluded ones are covered
# by the stronger assertion below rather than by silence. Mirrors
# golden-fixtures.test.ts's preR8Fixtures / nonEnglishFixtures split.
def _jurisdiction_of(path: Path) -> str:
    return _load_fixture(path)["inputs"]["acquisition"].get("jurisdiction", "england_ni")


# R9 narrows it further: a v6 fixture has no pre-R8 form either. ``_as_pre_r8_document``
# stamps v3/v4, and migrating that back up would leave the R9 ``areas`` and ``ancillary``
# blocks at their zeroed defaults -- a different document, not an older one.
_PRE_R8_FIXTURES = [
    p for p in APPRAISAL_FIXTURES
    if _jurisdiction_of(p) == "england_ni" and _version_of(_load_fixture(p)) == 5
]
_NON_ENGLISH_FIXTURES = [p for p in APPRAISAL_FIXTURES if _jurisdiction_of(p) != "england_ni"]


def test_the_pre_r8_parametrisation_covers_every_england_ni_v5_fixture() -> None:
    """Without this, deleting a fixture's `jurisdiction` field -- or mistyping it --
    would quietly move it out of the parametrisation below and reduce coverage
    without failing. Mirrors golden-fixtures.test.ts."""
    assert [_jurisdiction_of(p) for p in _NON_ENGLISH_FIXTURES] == ["wales", "scotland"]
    excluded = [p for p in APPRAISAL_FIXTURES if p not in _PRE_R8_FIXTURES]
    assert [p.stem for p in excluded] == [
        "m-wales-jurisdiction", "n-area-bridge", "o-ancillary-value", "p-scotland-levered",
    ]
    # Every exclusion is justified by one of the two stated reasons, not by silence.
    for path in excluded:
        assert (
            _jurisdiction_of(path) != "england_ni"
            or _version_of(_load_fixture(path)) == 6
        ), f"{path.stem} is excluded from the pre-R8 parametrisation for no stated reason"


@pytest.mark.parametrize("path", _PRE_R8_FIXTURES, ids=lambda p: p.stem)
def test_pre_r8_fixture_form_reproduces_its_metrics_after_migration(path: Path) -> None:
    doc = _load_fixture(path)
    pre = _as_pre_r8_document(doc["inputs"])
    assert pre["inputs_version"] != 5
    assert not any(k in pre["acquisition"] for k in _R8_ACQUISITION_KEYS)

    v5 = migrate_inputs_to_v5(pre)
    assert v5.inputs_version == 5
    # The migration stamps what a legacy document honestly is: England/NI by
    # default, unconfirmed, no transaction date (spec Sec 14).
    assert v5.acquisition.jurisdiction == "england_ni"
    assert v5.acquisition.jurisdiction_source == "migrated_default"
    assert v5.acquisition.jurisdiction_evidence_status == "unconfirmed"
    assert v5.acquisition.acquisition_date is None
    _assert_expected_metrics(run_appraisal(v5), doc, f"{path.stem}[pre-R8 -> v5]")


def _as_england_ni_document(inputs: dict) -> dict:
    doc = copy.deepcopy(inputs)
    doc["acquisition"]["jurisdiction"] = "england_ni"
    return doc


@pytest.mark.parametrize("path", _NON_ENGLISH_FIXTURES, ids=lambda p: p.stem)
def test_a_non_english_fixtures_england_ni_twin_is_a_different_appraisal(path: Path) -> None:
    """R9 Task 12. The non-English fixtures get the *stronger* statement: switching the
    document's jurisdiction to England/NI must change the acquisition tax, and change it
    to precisely the England/NI figure on the same consideration. That is what makes the
    fixture's jurisdiction load-bearing -- a table edit, or a mis-wired call site that
    quietly reverted to SDLT, fails here rather than passing because the two regimes
    happened to agree. Mirrors golden-fixtures.test.ts.

    R8 wrote this with fixture M's figures hard-coded inside a parametrisation over every
    non-English fixture, and left a MAINTENANCE note saying that adding a second one meant
    rewriting it. Fixture P is that second one, so it is rewritten: the expected pair and
    the three deltas now come from each fixture's own hand-derived
    ``jurisdiction_contrast`` block.

    It also matters that the deltas are pinned SEPARATELY rather than asserted equal to
    each other. Fixture M is all-cash, so its tax difference reaches TDC unchanged and
    never touches peak debt. Fixture P is levered, so the extra tax exhausts committed
    equity a month earlier and then compounds: its TDC delta (106,161p) is strictly larger
    than its acquisition delta (100,000p). An engine that computed the right tax but
    funded it wrongly would satisfy the first and fail the second -- the interaction R8's
    implementation report recorded as unpinned."""
    doc = _load_fixture(path)
    contrast = doc["jurisdiction_contrast"]
    native = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    english = run_appraisal(parse_calculator_inputs(_as_england_ni_document(doc["inputs"])))

    assert native.metrics.acquisition_tax.regime == contrast["regime"]
    assert english.metrics.acquisition_tax.regime == contrast["england_ni_regime"]
    assert english.metrics.acquisition_tax_pence == contrast["england_ni_acquisition_tax_pence"]
    # Non-vacuity: the two regimes must actually disagree on this consideration.
    assert contrast["acquisition_cost_delta_pence"] > 0
    # The difference must reach the headline cost stack, not stop at the metrics object --
    # this is the two-call-site defect R8 Task 5 found, pinned.
    assert (
        english.metrics.acquisition_cost_pence - native.metrics.acquisition_cost_pence
    ) == contrast["acquisition_cost_delta_pence"]
    assert (
        english.metrics.total_development_cost_pence
        - native.metrics.total_development_cost_pence
    ) == contrast["total_development_cost_delta_pence"]
    assert (
        english.metrics.peak_debt_pence - native.metrics.peak_debt_pence
    ) == contrast["peak_debt_delta_pence"]


@pytest.mark.parametrize(
    "path", [p for p in _NON_ENGLISH_FIXTURES if _version_of(_load_fixture(p)) == 5],
    ids=lambda p: p.stem,
)
def test_a_non_english_fixtures_pre_r8_form_is_a_different_england_ni_appraisal(
    path: Path,
) -> None:
    """R8's original route to the same statement, kept for the v5 non-English fixtures
    because it additionally proves the migration stamps ``england_ni`` on a document that
    never said otherwise. Now driven off the contrast block rather than hard-coded, so it
    survives the next non-English fixture unchanged."""
    doc = _load_fixture(path)
    contrast = doc["jurisdiction_contrast"]
    v5 = migrate_inputs_to_v5(_as_pre_r8_document(doc["inputs"]))
    assert v5.acquisition.jurisdiction == "england_ni"
    english = run_appraisal(v5)
    native = run_appraisal(parse_calculator_inputs(doc["inputs"]))

    assert english.metrics.acquisition_tax_pence == contrast["england_ni_acquisition_tax_pence"]
    assert native.metrics.acquisition_tax_pence == doc["expected_metrics"]["acquisition_tax_pence"]
    assert english.metrics.acquisition_tax.regime == contrast["england_ni_regime"]
    assert native.metrics.acquisition_tax.regime == contrast["regime"]
    assert (
        english.metrics.acquisition_cost_pence - native.metrics.acquisition_cost_pence
    ) == contrast["acquisition_cost_delta_pence"]
    assert (
        english.metrics.total_development_cost_pence
        - native.metrics.total_development_cost_pence
    ) == contrast["total_development_cost_delta_pence"]


# R9 Task 12 fix round 1. Python twin of golden-fixtures.test.ts's negative-control block,
# which had no mirror here -- an asymmetry that predates R9 but that R9 widened by adding
# three mapped pins (`gross_sales_pence` and the two `cost_to_complete_*` keys on fixture P).
#
# The point is the one fixture H established in Release 3a: a pinned key that no assertion
# actually reaches is a copy-paste false pass, not coverage. Every key in _FLAT_KEYS reaches
# the run through a mapper rather than through getattr, so a typo in a mapper -- or a key
# silently absent from the mapper table -- could compare None against None and pass. This
# flips each mapped key to a deliberately wrong value and asserts _assert_pins RAISES.
#
# THE CONVENTION: every key in _FLAT_KEYS is negative-controlled by at least one fixture
# here. Adding a mapper means adding an entry below.
_NEGATIVE_CONTROLS = [
    # Fixtures I and J exercise opposite sides of the same redemption mappers: I's
    # redemption balance is 0 and its three-entry schedule ends at 0, while J's is non-zero
    # and its two-entry schedule ends non-zero. A mapper that returned a constant, or
    # dropped the final entry, could satisfy one fixture's control while failing the other's.
    ("i-phased-sales", {
        "redemption_balance_at_disposal_pence": 1,
        "redemption_schedule_months": [9, 10],
        "redemption_schedule_balances_pence": [53431299, 10782708, 1],
        "funding_gap_pence": 1,
    }),
    ("j-blended-refinance", {
        "redemption_balance_at_disposal_pence": 4946601,
        "redemption_schedule_months": [9, 10],
        "redemption_schedule_balances_pence": [53431299, 4946601],
        "funding_gap_pence": 1,
    }),
    # Fixture O is the one that matters for `gross_sales_pence`: under a blended exit GDV
    # and receipts are DIFFERENT numbers (74,500,000 vs 32,000,000), so a mapper wired to
    # the wrong total is caught. A control on a sell_all fixture could not tell them apart.
    ("o-ancillary-value", {"gross_sales_pence": 74_500_000}),
    # Fixture P holds spec Sec 5.10's deferred-defect figures. They are documented in the
    # spec and in test-cases Sec 14.9, so they must be pinned by something that fails when
    # the behaviour changes -- otherwise the deferral relies on someone remembering to
    # re-read the prose.
    ("p-scotland-levered", {
        "gross_sales_pence": 143_999_999,
        "cost_to_complete_first_shortfall_month": 2,
        "cost_to_complete_max_shortfall_pence": 392_484,
        "funding_gap_pence": 1,
    }),
]


def test_every_flat_key_is_negative_controlled() -> None:
    """The convention above, asserted rather than trusted."""
    controlled = {key for _, wrong in _NEGATIVE_CONTROLS for key in wrong}
    assert set(_FLAT_KEYS) - controlled == set(), (
        "these _FLAT_KEYS mappers have no negative control: "
        f"{sorted(set(_FLAT_KEYS) - controlled)}"
    )


@pytest.mark.parametrize("stem,wrong_values", _NEGATIVE_CONTROLS, ids=[c[0] for c in _NEGATIVE_CONTROLS])
def test_negative_control_a_wrong_value_for_each_mapped_key_fails(
    stem: str, wrong_values: dict,
) -> None:
    path = next(p for p in APPRAISAL_FIXTURES if p.stem == stem)
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    # The run itself must be correct first, or "the poisoned pin failed" would prove nothing.
    _assert_expected_metrics(run, doc, stem)
    for key, wrong in wrong_values.items():
        with pytest.raises(AssertionError):
            _assert_pins(run, {key: wrong}, f"negative-control[{stem}]")


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
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
    # R9: normalised to v6, not v5. The corpus now mixes v5 and v6 documents, and
    # migrate_inputs_to_v5 refuses a v6 one by design -- producing a v5 document would
    # mean dropping ``areas`` and every unit's ``ancillary`` block, which is exactly the
    # silent downgrade that guard exists to prevent.
    programmed = migrate_inputs_to_v6(inputs.model_dump(mode="json"))
    assert isinstance(programmed, CalculatorInputsV6)
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
    for path in APPRAISAL_FIXTURES:
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
# R8: the shared corpus moved to inputs v5. The check stays exact (isinstance
# alone would pass for a v4 document too, since V5 subclasses V4, letting a
# fixture drift out of this matrix without failing), mirroring
# invariants.test.ts's toV5Clone.
def _to_v5_clone(inputs: AnyCalculatorInputs) -> CalculatorInputsV5:
    if inputs.inputs_version != 5 or not isinstance(inputs, CalculatorInputsV5):
        raise TypeError("sweep-invariant fixture must be inputs_version 5")
    return inputs.model_copy(deep=True)


def _odd_gross_sweep_variant(inputs: AnyCalculatorInputs) -> CalculatorInputsV5:
    """Nudge each unit's value by a distinct odd pence amount so gross sale totals,
    tranche splits and agent-fee rounding all land on awkward (non-round) pence."""
    v = _to_v5_clone(inputs)
    for i, u in enumerate(v.unit_mix.units):
        u.estimated_value_pence += 2 * i + 1
    return v


def _three_tranche_sweep_variant(inputs: AnyCalculatorInputs) -> CalculatorInputsV5:
    v = _to_v5_clone(inputs)
    last = max(0, int(v.finance.term_months) - 1)
    v.sales_phasing = SalesPhasingInputs(
        tranches=[
            SalesPhasingTranche(month_offset=max(0, last - 2), pct_of_gross_receipts=33.4),
            SalesPhasingTranche(month_offset=max(0, last - 1), pct_of_gross_receipts=33.3),
            SalesPhasingTranche(month_offset=last, pct_of_gross_receipts=33.3),
        ],
    )
    return v


def _sweep_variants(inputs: AnyCalculatorInputs) -> list[tuple[str, CalculatorInputsV5]]:
    return [
        ("base", _to_v5_clone(inputs)),
        ("odd-gross", _odd_gross_sweep_variant(inputs)),
        ("three-tranche", _three_tranche_sweep_variant(inputs)),
    ]


def _sweep_fixture_variant_matrix() -> list[tuple[str, str, CalculatorInputsV5]]:
    out: list[tuple[str, str, CalculatorInputsV5]] = []
    for path in APPRAISAL_FIXTURES:
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
        self, stem: str, label: str, inputs: CalculatorInputsV5,
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
        self, stem: str, label: str, inputs: CalculatorInputsV5,
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
        self, stem: str, label: str, inputs: CalculatorInputsV5,
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
        self, stem: str, label: str, inputs: CalculatorInputsV5,
    ) -> None:
        run = run_appraisal(inputs)
        sched = run.model.redemption_schedule
        for i in range(1, len(sched)):
            assert sched[i].month > sched[i - 1].month
            assert sched[i].balance_pence <= sched[i - 1].balance_pence
        if sched:
            assert run.model.redemption_balance_at_disposal_pence == sched[-1].balance_pence


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
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


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
def test_senior_breakeven_null_iff_no_disposal(path: Path) -> None:
    """Release 2b Task 4 (spec Sec 5.11): senior_breakeven_pence is null exactly when
    the ledger recorded no disposal (cash deals, or nothing sold)."""
    doc = _load_fixture(path)
    run = run_appraisal(parse_calculator_inputs(doc["inputs"]))
    assert (run.metrics.senior_breakeven_pence is None) == (
        run.model.redemption_balance_at_disposal_pence is None
    )


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
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


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
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


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
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


@pytest.mark.parametrize("path", APPRAISAL_FIXTURES, ids=lambda p: p.stem)
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


# ---------------------------------------------------------------------------
# Fixture K -- the sensitivity suite (spec Sec 12, calc 2.4.0)
#
# Mirror of golden-fixtures.test.ts's `describe('Fixture K - sensitivity suite')`
# block: the same five tests, in the same order, reading the same hand-derived
# expectations out of the same JSON document.
#
# Fixture K carries no `inputs` of its own -- it names `base_fixture`, so Fixture F's
# document cannot drift away from the contract built on it -- which is why it is
# excluded from APPRAISAL_FIXTURES above and asserted here instead.
#
# WHICH ASSERTIONS ARE WHICH (the distinction is the point -- see
# docs/financial-model/model-governance.md Sec 2.1). The derived inputs, the base cell,
# the two corner cells and every tornado span are HAND-DERIVED on the worksheet in
# docs/financial-model/test-cases.md ("Fixture K -- sensitivity suite"), independently
# of both engines. The final test is IDENTITY-ASSERTED, not a snapshot: Sec 12.3 *defines*
# a cell as run_appraisal(apply_scenario(base, overrides)), so asserting that equality
# is asserting the contract itself. A future reader must not mistake it for a snapshot,
# and must not "fix" a hand-derived number by copying what the engine printed.
# ---------------------------------------------------------------------------

K_DOC = _load_fixture(FIXTURE_DIR / "k-sensitivity.json")
K_BASE_INPUTS = parse_calculator_inputs(
    _load_fixture(FIXTURE_DIR / f"{K_DOC['base_fixture']}.json")["inputs"]
)


def _config_from(c: dict) -> SensitivityConfig:
    return SensitivityConfig(
        rows=SensitivityAxis(lever=c["rows"]["lever"], steps=list(c["rows"]["steps"])),
        cols=SensitivityAxis(lever=c["cols"]["lever"], steps=list(c["cols"]["steps"])),
        tornado=[TornadoRange(lever=t["lever"], low=t["low"], high=t["high"]) for t in c["tornado"]],
    )


def _k_config() -> SensitivityConfig:
    return _config_from(K_DOC["config"])


def _levered(**levers: float) -> AnyCalculatorInputs:
    return apply_scenario(K_BASE_INPUTS, ScenarioOverrides(
        label="",
        gdv_adjustment_pct=levers.get("gdv", 0),
        construction_cost_adjustment_pct=levers.get("construction_cost", 0),
        timeline_adjustment_months=levers.get("timeline", 0),
        interest_rate_adjustment_pct=levers.get("interest_rate", 0),
    ))


K_RESULT = run_sensitivity(K_BASE_INPUTS, _k_config())


def test_fixture_k_applies_each_lever_to_the_hand_derived_value() -> None:
    """Hand-derived: the per-axis derived inputs (Sec 12.1 disjointness makes these per
    axis, not per cell). A lever-composition bug shows up here first."""
    for step, expected in K_DOC["expected_derived_inputs"]["gdv"].items():
        levered = _levered(gdv=float(step))
        assert all(u.estimated_value_pence == expected for u in levered.unit_mix.units)
    for step, expected in K_DOC["expected_derived_inputs"]["construction_cost"].items():
        levered = _levered(construction_cost=float(step))
        assert levered.conversion_costs.construction_cost_per_sqm_pence == expected
    for step, expected in K_DOC["expected_derived_inputs"]["timeline"].items():
        assert _levered(timeline=float(step)).finance.term_months == expected
    for step, expected in K_DOC["expected_derived_inputs"]["interest_rate"].items():
        assert _levered(interest_rate=float(step)).finance.annual_interest_rate_pct == expected


def test_fixture_k_reports_the_hand_derived_base_case() -> None:
    """Hand-derived: reused verbatim from Fixture F (Sec 12.5)."""
    for key, expected in K_DOC["expected_base"].items():
        assert getattr(K_RESULT.base, key) == expected, key


def test_fixture_k_reports_the_hand_derived_corner_cells() -> None:
    """Hand-derived: two corners worked through on a worksheet, the way Fixture F was."""
    cells = [c for row in K_RESULT.matrix for c in row]
    for corner in K_DOC["expected_corner_cells"]:
        match = [
            c for c in cells
            if c.row_step == corner["row_step"] and c.col_step == corner["col_step"]
        ]
        assert len(match) == 1, f"corner {corner['row_step']}/{corner['col_step']}"
        cell = match[0]
        for key, expected in corner.items():
            if key in ("row_step", "col_step"):
                continue
            actual = getattr(cell, key)
            assert actual == expected, (
                f"corner {corner['row_step']}/{corner['col_step']}.{key}: {actual} != {expected}"
            )


def test_fixture_k_reports_the_hand_derived_tornado_spans_and_order() -> None:
    """Hand-derived: spans and the resulting order."""
    assert [b.lever for b in K_RESULT.tornado] == K_DOC["expected_tornado_order"]
    for bar in K_RESULT.tornado:
        assert bar.span_pence == K_DOC["expected_tornado_spans_pence"][bar.lever], bar.lever


def test_fixture_k_defines_every_remaining_cell_as_the_levered_appraisal() -> None:
    """Identity-asserted, NOT snapshotted: Sec 12.3 *defines* a cell as this expression,
    so the assertion is the contract. Wrong composition or enumeration is already caught
    by the hand-derived derived-inputs and corners above."""
    for ri, row_step in enumerate(K_RESULT.config.rows.steps):
        for ci, col_step in enumerate(K_RESULT.config.cols.steps):
            expected = run_appraisal(
                _levered(construction_cost=row_step, gdv=col_step)
            ).metrics
            cell = K_RESULT.matrix[ri][ci]
            assert cell.profit_pence == expected.profit_pence
            assert cell.profit_on_cost_pct == expected.profit_on_cost_pct
            assert cell.ltgdv_developer_pct == expected.ltgdv_developer_pct
            assert cell.peak_debt_pence == expected.peak_debt_pence
            assert cell.flags == [f.code for f in expected.flags]


def test_fixture_k_invalid_case_matches_spec_12_7():
    """Hand-derived: 12 + (-12) = 0 < 1 -> unmeasured; 12 + (-11) = 1 -> measured."""
    ic = K_DOC["invalid_case"]
    result = run_sensitivity(K_BASE_INPUTS, _config_from(ic["config"]))
    expected_error = ic["expected_unmeasured_error"]

    for step in ic["expected_unmeasured_rows"]:
        row = next(cells for cells in result.matrix if cells[0].row_step == step)
        for cell in row:
            assert cell.profit_pence is None
            assert cell.peak_debt_pence is None
            assert cell.flags == []
            assert any(
                e.severity == expected_error["severity"]
                and e.field == expected_error["field"]
                and e.message == expected_error["message"]
                for e in cell.validation_errors
            )

    for step in ic["expected_measured_rows"]:
        row = next(cells for cells in result.matrix if cells[0].row_step == step)
        for cell in row:
            assert cell.validation_errors == []
            assert cell.profit_pence is not None


# ---------------------------------------------------------------------------
# Release 4a Task 8 (spec Sec 12, calc 2.4.0): sensitivity suite invariants,
# asserted across the whole fixture corpus rather than pinned to one document.
#
# Fixture K (above) pins exact numbers for a single document (Fixture F levered).
# These assert Sec 12's *properties* hold for every document in the corpus -- the
# base-case identity (Sec 12.5), facility-and-equity invariance in every cell
# (Sec 12.2), total tornado ordering (Sec 12.4), and reproducibility (Sec 1.4) --
# which is what would catch a regression on a deal shaped unlike Fixture F, that
# Fixture K alone cannot. Mirrors invariants.test.ts's "sensitivity suite
# invariants" describe block field-for-field (same four checks, same order).
# ---------------------------------------------------------------------------

def _sensitivity_corpus() -> list[AnyCalculatorInputs]:
    """Every pipeline-shaped fixture in the corpus, not just Fixture F. Includes
    fixture A (all-cash, no debt at all) -- every invariant below must therefore hold
    for a zero-facility document too, not only for financed deals."""
    return [parse_calculator_inputs(_load_fixture(p)["inputs"]) for p in APPRAISAL_FIXTURES]


_SENSITIVITY_CORPUS = _sensitivity_corpus()
_SENSITIVITY_CORPUS_IDS = [p.stem for p in APPRAISAL_FIXTURES]


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_base_case_identical_to_unadjusted_appraisal(inputs: AnyCalculatorInputs) -> None:
    """Spec Sec 12.5: the measurement taken with every lever at zero must equal the
    unadjusted appraisal of the base document exactly, in every reported quantity."""
    plain = run_appraisal(inputs).metrics
    base = run_sensitivity(inputs).base
    assert base.profit_pence == plain.profit_pence
    assert base.peak_debt_pence == plain.peak_debt_pence
    assert base.flags == [f.code for f in plain.flags]


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_holds_committed_facility_and_equity_invariant_in_every_cell(
    inputs: AnyCalculatorInputs,
) -> None:
    """Spec Sec 12.2: the committed facility and equity sources are held at their
    base-document values in every cell of the default grid -- no lever may write to
    them, directly or indirectly."""
    config = DEFAULT_SENSITIVITY_CONFIG
    for row_step in config.rows.steps:
        for col_step in config.cols.steps:
            levered = apply_scenario(inputs, ScenarioOverrides(
                label="",
                gdv_adjustment_pct=col_step,
                construction_cost_adjustment_pct=row_step,
                timeline_adjustment_months=0,
                interest_rate_adjustment_pct=0,
            ))
            assert (
                levered.finance.committed_net_facility_pence
                == inputs.finance.committed_net_facility_pence
            )
            assert (
                levered.finance.committed_gross_facility_pence
                == inputs.finance.committed_gross_facility_pence
            )
            assert levered.finance.day_one_advance_pence == inputs.finance.day_one_advance_pence
            assert (
                [e.amount_pence for e in levered.equity_sources]
                == [e.amount_pence for e in inputs.equity_sources]
            )


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_sorts_the_tornado_totally_and_deterministically(inputs: AnyCalculatorInputs) -> None:
    """Spec Sec 12.4: bars are ordered by span descending, ties broken by the fixed
    lever order -- total, and therefore independent of the order ranges were supplied
    in (Sec 1.4)."""
    forward = run_sensitivity(inputs)
    shuffled_config = SensitivityConfig(
        rows=DEFAULT_SENSITIVITY_CONFIG.rows,
        cols=DEFAULT_SENSITIVITY_CONFIG.cols,
        tornado=list(reversed(DEFAULT_SENSITIVITY_CONFIG.tornado)),
    )
    shuffled = run_sensitivity(inputs, shuffled_config)
    assert [b.lever for b in shuffled.tornado] == [b.lever for b in forward.tornado]
    spans = [b.span_pence for b in forward.tornado]
    # Sec 12.7: a null span (an unmeasured endpoint, e.g. fixtures I/J's timeline bar)
    # always sorts last already, and treating None as 0 here (mirroring the TS sibling
    # test's null-to-0 coercion) is <= every real span here (a magnitude) -- so this
    # numeric re-sort still agrees with the engine's actual placement. This asserts
    # total order, not nullness.
    assert sorted(spans, key=lambda s: -(s or 0)) == spans


@pytest.mark.parametrize("inputs", _SENSITIVITY_CORPUS, ids=_SENSITIVITY_CORPUS_IDS)
def test_sensitivity_is_reproducible(inputs: AnyCalculatorInputs) -> None:
    """Spec Sec 1.4: two runs of one document agree exactly."""
    assert run_sensitivity(inputs) == run_sensitivity(inputs)


def test_odd_construction_window_derives_a_4_month_professional_statutory_window() -> None:
    """Not in the original Task 8 brief -- a confirmed coverage gap found during
    Task 7. Every pre-existing fixture in the corpus runs term_months: 12, an even
    (10-month) construction window, so ceil and floor agree there and nothing in the
    whole corpus can ever exercise Sec 6's "odd windows round up" rule (professional /
    statutory window = ceil(construction_window / 2), not floor). A -3 month timeline
    lever on Fixture F (a plain v3 document with no explicit `programme`, so
    build_schedule takes the auto-window branch at schedule.py:158) turns its 12-month
    term into 9 months, so construction_window = max(1, 9 - 2) = 7 (odd) and, per
    Sec 6, professional_window = ceil(7 / 2) = 4 -- derived here from the rule itself,
    not read off the engine and copied back in. Guarded inside this sensitivity-suite
    module, rather than the general schedule tests, because the timeline lever is what
    the corpus needed to reach an odd window in the first place."""
    f_doc = _load_fixture(FIXTURE_DIR / "f-dev-finance-12mo.json")
    f_inputs = parse_calculator_inputs(f_doc["inputs"])
    assert getattr(f_inputs, "programme", None) is None  # must take the auto-window branch

    levered = apply_scenario(f_inputs, ScenarioOverrides(
        label="",
        gdv_adjustment_pct=0,
        construction_cost_adjustment_pct=0,
        timeline_adjustment_months=-3,
        interest_rate_adjustment_pct=0,
    ))
    assert levered.finance.term_months == 9

    schedule = build_schedule(levered)
    assert schedule.term_months == 9

    # construction_window = max(1, term - 2) = 7 (odd); professional_window =
    # ceil(7 / 2) = 4, per Sec 6's "odd windows round up" rule. Both spreads are
    # placed starting at month index 1, so the professional window occupies exactly
    # indices 1..4 of a 9-month schedule.
    professional_presence = [m.professional_pence > 0 for m in schedule.uses]
    assert professional_presence == [False, True, True, True, True, False, False, False, False]

    # Statutory month 0 also always carries the flat prior-approval fee
    # (unconditional, schedule.py), so the window check excludes it and looks only
    # at the spread that starts at month 1 -- the same 4-month window as professional.
    statutory_window_months = sum(1 for m in schedule.uses[1:] if m.statutory_pence > 0)
    assert statutory_window_months == 4
