"""R13b spec Sec 22.9. The migration gate is numeric AND validation-side, and
the validation side is THREE separately falsifiable properties, not one set
equality -- ported wholesale from tests/test_migrate_v11.py with the v12
substitutions (Task 1's brief).

A single `set(v11_issues) == set(v12_issues)` assertion passes vacuously when
the new rules cannot fire at all, which is exactly how R12 shipped a gate that
proved nothing until it was rewritten mid-release -- R13 avoided the trap by
building all three properties from the start, and this file follows suit.
Properties 2 and 3 are Task 5's, though: Sec 22.7's unit-sales-only
validation rules do not exist yet, so there is nothing for them to exercise
until then.

Filter correction carried forward from test_migrate_v11.py's own docstring:
`_stored_version` reads `inputs_version` off `doc["inputs"]`, NOT the top
level of the fixture file -- every fixture in fixtures/financial-model stores
it nested there (see test_financial_model_fixtures.py's `_version_of`,
golden-fixtures.test.ts's `versionOf`), and a top-level read would silently
keep every fixture, including a future v12-native one, defeating the
exclusion this file exists to apply.
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.migrate import (
    is_v2_or_later,
    migrate_inputs_to_v11,
    migrate_inputs_to_v12,
    migrate_v11_to_v12,
)
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# Sec 22.9's gates compare the v11 arm against the v12 arm of a document's
# INPUTS, so they can only run on a fixture that carries one. Fixture K (kind
# "sensitivity") carries no `inputs` of its own -- it names a `base_fixture`
# instead (governance Sec 2.1) -- so it is excluded here the same way
# test_financial_model_fixtures.py's `APPRAISAL_FIXTURES` and
# golden-fixtures.test.ts's `appraisalFixtures` already exclude it.
#
# `migrate_inputs_to_v11` refuses a v12 document by design (Sec 3.5's
# each-migration-refuses-the-next rule), so any v12-NATIVE fixture would be
# excluded here too (via the stored-version filter) and covered by the
# golden-fixture suite instead. No v12-native fixture exists yet (Task 2
# adds the first one, X), so this exclusion is currently empty.
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
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 11
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    assert len(FIXTURES) >= 18
    version_excluded = [
        p for p in ALL_FIXTURES
        if _FIXTURE_DOCS[p].get("kind") != "sensitivity"
        and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 11
    ]
    # R13b Task 2 adds the v12-native fixture X; R15 Task 3 adds the
    # v13-native fixture Y, above this gate's `<= 11` filter for the same
    # reason X is. R15b Task 7 adds the v14-native fixture Z, above the same
    # filter for the same reason.
    assert sorted(p.stem for p in version_excluded) == [
        "x-unit-sales-ledger", "y-due-diligence", "z-cost-plan-in-time",
    ]


def _metrics_dict(metrics) -> dict:
    """asdict(), minus `calc_version` (constant for the whole engine, not
    version-dependent) and `monitoring_statement` -- exactly the exclusions
    test_migrate_v11.py's own `_metrics_dict` applies. `monitoring_statement`
    is `None` on every document this gate runs over regardless of arm, so
    excluding it keeps the gate's diff readable without hiding anything."""
    d = asdict(metrics)
    d.pop("calc_version", None)
    d.pop("monitoring_statement", None)
    return d


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 22.9: no existing appraisal's computed values move. Every figure the
    v11 arm produces, the v12 arm produces identically."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v11_run = run_appraisal(migrate_inputs_to_v11(raw, None))
    v12_run = run_appraisal(migrate_inputs_to_v12(raw, None))
    assert _metrics_dict(v11_run.metrics) == _metrics_dict(v12_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v11_run.model) == asdict(v12_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v11_run.schedule) == asdict(v12_run.schedule), f"{path.stem}: a schedule figure moved"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_1_every_v11_issue_has_a_v12_counterpart(path):
    """Property 1 of three. Field strings may be renamed under a stated alias
    map; the SET of issues raised must not grow or shrink."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v11_issues = {(i.severity, ALIAS.get(i.field, i.field), i.message)
                  for i in validate_inputs(migrate_inputs_to_v11(raw, None))}
    v12_issues = {(i.severity, i.field, i.message)
                  for i in validate_inputs(migrate_inputs_to_v12(raw, None))}
    assert v12_issues == v11_issues


ALIAS: dict[str, str] = {}   # no field renames this release; kept so a future
                             # rename has a declared home rather than a
                             # loosened assertion.


# Properties 2 and 3 (v12-only validation rules are silent on a migrated
# document, and can actually fire) are Task 5's. `unit_sales` is written
# `None` by the migration, so a migrated document has nothing for Sec 22.7's
# unit-sales rules to fire on; property 2 checks that stays true, and
# property 3 (the matched non-vacuity check -- R12's Sec 18.7 lesson) proves
# the rules can actually fire when a document does carry the block.


def test_property_2_v12_only_rules_are_silent_on_a_migrated_document():
    for p in FIXTURES:
        issues = validate_inputs(migrate_inputs_to_v12(_FIXTURE_DOCS[p]["inputs"], None))
        assert not [i for i in issues if i.field.startswith("unit_sales") or i.field.endswith("sales_slip_months")], p.stem


def test_property_3_the_v12_only_rules_can_actually_fire():
    # Control: fixture I carries sales_phasing; giving it a unit_sales block trips rule 1.
    raw = migrate_inputs_to_v12(_load_fixture(FIXTURE_DIR / "i-phased-sales.json")["inputs"], None).model_dump(mode="json")
    raw["unit_sales"] = {"deposit_release": "held_to_completion", "units": []}
    fields = {i.field for i in validate_inputs(migrate_inputs_to_v12(raw, None))}
    assert "unit_sales" in fields and "sales_phasing" in fields


def test_migration_writes_only_null_and_zero():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v11 = migrate_inputs_to_v11(raw, None)
    v12 = migrate_v11_to_v12(v11)
    assert v12.inputs_version == 12
    assert v12.unit_sales is None
    for name in ("base", "upside", "downside", "severe"):
        assert getattr(v12.scenarios, name).sales_slip_months == 0
    dumped = v12.model_dump(mode="json")
    assert "sales_slip_months" in dumped["scenarios"]["base"]  # WRITTEN, not defaulted


def test_migration_actively_overwrites_a_stray_unit_sales_block():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    doc = migrate_inputs_to_v11(raw, None).model_dump(mode="json")
    doc["unit_sales"] = {"poison": True}
    assert migrate_v11_to_v12(doc).unit_sales is None


def test_is_v2_or_later_recognises_v12():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v12 = migrate_inputs_to_v12(raw, None).model_dump(mode="json")
    assert is_v2_or_later(v12) is True


def test_migrate_inputs_to_v12_refuses_an_unrecognised_version():
    with pytest.raises(ValueError, match="unrecognised inputs_version 13"):
        migrate_inputs_to_v12({"inputs_version": 13})


def test_migrate_inputs_to_v12_refuses_a_document_tagged_v12_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v12 structural check"):
        migrate_inputs_to_v12({"inputs_version": 12})


def test_migrate_v11_to_v12_refuses_double_migration():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v12 = migrate_inputs_to_v12(raw, None)
    with pytest.raises(ValueError, match="already a v12 document"):
        migrate_v11_to_v12(v12)
