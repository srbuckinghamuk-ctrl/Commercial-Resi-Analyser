"""R14 spec Sec 20.1. The migration gate is numeric AND validation-side, and
the validation side is THREE separately falsifiable properties, not one set
equality -- ported wholesale from tests/test_migrate_v10.py with the v11
substitutions (Task 6's brief).

A single `set(v10_issues) == set(v11_issues)` assertion passes vacuously when
the new rules cannot fire at all, which is exactly how R12 shipped a gate that
proved nothing until it was rewritten mid-release -- R13 avoided the trap by
building all three properties from the start, and this file does the same.

Filter correction carried forward from test_migrate_v10.py's own docstring:
`_stored_version` reads `inputs_version` off `doc["inputs"]`, NOT the top
level of the fixture file -- every fixture in fixtures/financial-model stores
it nested there (see test_financial_model_fixtures.py's `_version_of`,
golden-fixtures.test.ts's `versionOf`), and a top-level read would silently
keep every fixture, including a future v11-native one, defeating the
exclusion this file exists to apply.
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.migrate import (
    is_v2_or_later,
    migrate_inputs_to_v10,
    migrate_inputs_to_v11,
    migrate_v10_to_v11,
)
from app.financial_model.types import CalculatorInputsV11
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# Sec 20.1's gates compare the v10 arm against the v11 arm of a document's
# INPUTS, so they can only run on a fixture that carries one. Fixture K (kind
# "sensitivity") carries no `inputs` of its own -- it names a `base_fixture`
# instead (governance Sec 2.1) -- so it is excluded here the same way
# test_financial_model_fixtures.py's `APPRAISAL_FIXTURES` and
# golden-fixtures.test.ts's `appraisalFixtures` already exclude it.
#
# `migrate_inputs_to_v10` refuses a v11 document by design (Sec 3.5's
# each-migration-refuses-the-next rule), so any v11-NATIVE fixture is excluded
# here too (via the stored-version filter) and would be covered by the
# golden-fixture suite instead.
#
# Both exclusions are derived from each fixture's own content, never
# hard-coded to filenames: a hand-written skip list goes stale the moment a
# fixture is added, and a gate that silently stops covering a fixture is the
# failure mode this whole file exists to prevent.
ALL_FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))
_FIXTURE_DOCS: dict[Path, dict] = {p: _load_fixture(p) for p in ALL_FIXTURES}
FIXTURES = [
    p for p in ALL_FIXTURES
    if _FIXTURE_DOCS[p].get("kind") != "sensitivity"
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 10
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    """Guards the filter above. If every fixture became v11-native (or the
    corpus emptied) this file would pass with zero parametrised cases and
    prove nothing.

    The EXCLUSION BOUND was zero at Task 6: no v11-native fixture existed yet.
    Task 8 authors fixture W (w-monitoring-on-site.json, spec Sec 20.2), the
    first one, so the bound is now exactly 1 -- the v11-native fixture is
    covered by the golden suite instead. This mirrors how test_migrate_v10.py
    phrased its own T/U exclusion bound growing from two to three (and, this
    task, to four).

    The corpus holds 19 files now (Task 2's v-exhausted-reserve.json, stored at
    v10, is INCLUDED by the `<= 10` filter above, not excluded); one (fixture
    K) is not an inputs document and one (fixture W) is v11-native, leaving 17
    in `FIXTURES`.

    R15b Task 7: z-cost-plan-in-time.json is v14-native, also excluded by this
    `<= 10` filter, so the exclusion bound moves from three to four.
    `len(FIXTURES)` is unchanged -- Z was never inside this gate either.
    """
    assert len(FIXTURES) >= 17
    version_excluded = [
        p for p in ALL_FIXTURES
        if _FIXTURE_DOCS[p].get("kind") != "sensitivity"
        and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 10
    ]
    assert len(version_excluded) == 4, (
        "the v11-native fixture count changed -- confirm the new fixture is meant "
        "to be outside the migration gate, then update this bound deliberately"
    )
    assert sorted(p.stem for p in version_excluded) == [
        "w-monitoring-on-site", "x-unit-sales-ledger", "y-due-diligence",
        "z-cost-plan-in-time",
    ]


def _metrics_dict(metrics) -> dict:
    """asdict(), minus `calc_version` (constant for the whole engine, not
    version-dependent) and `monitoring_statement`.

    `monitoring_statement` DOES exist on `AppraisalResultV2` -- the dataclass
    `metrics` is an instance of, defined in metrics.py (Task 9 landed the field,
    spec Sec 20.4). It is excluded because it is `None` on every document this
    gate runs over: the migration writes `monitoring: None`, and the one
    v11-native fixture that carries a real block (W, w-monitoring-on-site) is
    filtered out of `FIXTURES` above and pinned by the golden suite instead.
    Comparing a field that is `None` on both arms by construction would add
    nothing; excluding it keeps the gate's diff readable and states, here, why
    it is not a hole."""
    d = asdict(metrics)
    d.pop("calc_version", None)
    d.pop("monitoring_statement", None)
    return d


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 20.1: no existing appraisal's computed values move. Every figure the
    v10 arm produces, the v11 arm produces identically.

    Numeric identity must also hold on V (stored v10, Task 2) -- it is in the
    corpus (the `<= 10` filter above includes it), so this parametrisation
    covers it."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v10_run = run_appraisal(migrate_inputs_to_v10(raw, None))
    v11_run = run_appraisal(migrate_inputs_to_v11(raw, None))
    assert _metrics_dict(v10_run.metrics) == _metrics_dict(v11_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v10_run.model) == asdict(v11_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v10_run.schedule) == asdict(v11_run.schedule), f"{path.stem}: a schedule figure moved"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_1_every_v10_issue_has_a_v11_counterpart(path):
    """Property 1 of three. Field strings may be renamed under a stated alias
    map; the SET of issues raised must not grow or shrink."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v10_issues = {(i.severity, ALIAS.get(i.field, i.field), i.message)
                  for i in validate_inputs(migrate_inputs_to_v10(raw, None))}
    v11_issues = {(i.severity, i.field, i.message)
                  for i in validate_inputs(migrate_inputs_to_v11(raw, None))}
    assert v11_issues == v10_issues


ALIAS: dict[str, str] = {}   # no field renames this release; kept so a future
                             # rename has a declared home rather than a
                             # loosened assertion.


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_2_v11_only_rules_are_silent_on_a_migrated_document(path):
    """Property 2 of three. Migration writes `monitoring: null`, so every
    Sec 20.3 monitoring rule is inert on a migrated document."""
    doc = _load_fixture(path)["inputs"]
    issues = validate_inputs(migrate_inputs_to_v11(doc, None))
    assert not [i for i in issues if i.field.startswith("monitoring")]


def test_property_3_the_v11_only_rules_can_actually_fire():
    """Property 3 of three, and the one that stops Property 2 being vacuous.

    Without this, a release that wired the new rules to nothing would pass
    Property 2 perfectly. R12 shipped exactly that shape and had to rewrite
    the gate mid-release.

    Pydantic's own `reporting_month: int = Field(ge=1)` pre-empts a
    non-positive value before validate_inputs ever sees it, so the violation
    here is `reporting_month` greater than the term instead -- a rule
    Pydantic does not enforce (l-retain-all.json's term is 12 months)."""
    doc = _load_fixture(FIXTURE_DIR / "l-retain-all.json")["inputs"]
    v11 = migrate_inputs_to_v11(doc, None).model_dump()
    v11["monitoring"] = {
        "reporting_month": 999,  # <- exceeds the 12-month term
        "reporting_date": "2026-01-01",
        "lines": [
            {
                "category": category,
                "current_budget_pence": 0,
                "certified_to_date_pence": 0,
                "paid_to_date_pence": 0,
                "committed_to_date_pence": 0,
                "forecast_to_complete_pence": 0,
            }
            for category in (
                "acquisition", "construction", "professional", "statutory", "contingency",
            )
        ],
        "debt_drawn_to_date_pence": 0,
        "cash_equity_injected_to_date_pence": 0,
        "author": "QS",
        "date": "2026-01-01",
        "note": None,
    }
    issues = validate_inputs(CalculatorInputsV11.model_validate(v11))
    assert "monitoring.reporting_month" in {i.field for i in issues}


def test_migration_writes_only_null():
    """Sec 20.1: one addition, and it is inert."""
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v11 = migrate_inputs_to_v11(raw, None)
    assert v11.monitoring is None


def test_migration_actively_overwrites_a_stray_monitoring_block_rather_than_relying_on_pydantic_defaults():
    """Non-vacuity for the test above -- the same Python-specific trap this
    codebase has been bitten by before (test_migrate_v10.py's own twin):
    `monitoring` defaults to `None` on `CalculatorInputsV11` itself (Task 4),
    so asserting only against a *validated* model would pass even with
    `migrate_v10_to_v11`'s write deleted entirely -- Pydantic would silently
    supply the same value.

    Poisoning `monitoring` with a stray, otherwise-valid dict on the v10
    document (a hand-edited or malformed stored row) is what proves
    `migrate_v10_to_v11` resets it to null unconditionally, rather than
    passing a poisoned value through."""
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v10 = migrate_inputs_to_v10(raw, None)
    doc = v10.model_dump(mode="json")
    # No real v10 document can carry this key -- it does not exist before
    # v11 -- but a hand-edited or malformed stored row is not bound by any
    # type checker, so migration must still reset it to null unconditionally.
    doc["monitoring"] = {"poison": True}

    v11 = migrate_v10_to_v11(doc)
    assert v11.monitoring is None


def test_is_v2_or_later_recognises_v11():
    """R13's Task 6 defect, fifth consecutive release (R10 for v7, R11 for v8,
    R12 for v9, R13 for v10, now v11). A v11 raw payload that fell through
    this check would be tagged `legacy_unreconciled` by app.py's `was_v1`, so
    every appraisal saved after this release would carry the red 'Legacy --
    recalculation required' banner on its very first save."""
    raw = _load_fixture(FIXTURE_DIR / "l-retain-all.json")["inputs"]
    v11 = migrate_inputs_to_v11(raw, None).model_dump()
    assert is_v2_or_later(v11) is True


def test_migrate_inputs_to_v11_refuses_an_unrecognised_version():
    """Tested with a document tagged 12, the neighbour that catches a
    predicate loosened the way R10 found `== 6` loosened to `!= 5`."""
    with pytest.raises(ValueError, match="unrecognised inputs_version 12"):
        migrate_inputs_to_v11({"inputs_version": 12})


def test_migrate_inputs_to_v11_refuses_a_document_tagged_v11_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v11 structural check"):
        migrate_inputs_to_v11({"inputs_version": 11})
