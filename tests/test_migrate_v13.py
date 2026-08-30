"""R15 spec Sec 23.10. The migration gate is numeric AND validation-side, and
the validation side is THREE separately falsifiable properties, not one set
equality -- ported wholesale from tests/test_migrate_v12.py with the v13
substitutions (Task 2's brief).

A single `set(v12_issues) == set(v13_issues)` assertion passes vacuously when
the new rules cannot fire at all, which is exactly how R12 shipped a gate that
proved nothing until it was rewritten mid-release -- R13 avoided the trap by
building all three properties from the start, and this file follows suit.
Properties 2 and 3 were written here in Task 2, before Sec 23.9's
due-diligence validation rules existed to exercise them -- against field
prefixes rather than specific rule names, and red until Task 6 implemented
`validate_due_diligence`, which is what turned them green.

Filter correction carried forward from test_migrate_v11.py's own docstring:
`_stored_version` reads `inputs_version` off `doc["inputs"]`, NOT the top
level of the fixture file -- every fixture in fixtures/financial-model stores
it nested there (see test_financial_model_fixtures.py's `_version_of`,
golden-fixtures.test.ts's `versionOf`), and a top-level read would silently
keep every fixture, including a future v13-native one, defeating the
exclusion this file exists to apply.
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.due_diligence import ENTERED_CODES
from app.financial_model.migrate import (
    is_v2_or_later,
    migrate_inputs_to_v12,
    migrate_inputs_to_v13,
    migrate_v12_to_v13,
)
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# Sec 23.10's gates compare the v12 arm against the v13 arm of a document's
# INPUTS, so they can only run on a fixture that carries one. Fixture K (kind
# "sensitivity") carries no `inputs` of its own -- it names a `base_fixture`
# instead (governance Sec 2.1) -- so it is excluded here the same way
# test_financial_model_fixtures.py's `APPRAISAL_FIXTURES` and
# golden-fixtures.test.ts's `appraisalFixtures` already exclude it.
#
# `migrate_inputs_to_v12` refuses a v13 document by design (Sec 3.5's
# each-migration-refuses-the-next rule), so any v13-NATIVE fixture would be
# excluded here too (via the stored-version filter) and covered by the
# golden-fixture suite instead. No v13-native fixture exists yet (Task 3
# adds the first one, Y), so this exclusion is currently empty.
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
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 12
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    assert len(FIXTURES) >= 19
    version_excluded = [
        p for p in ALL_FIXTURES
        if _FIXTURE_DOCS[p].get("kind") != "sensitivity"
        and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 12
    ]
    # R15 Task 3 adds the v13-native fixture Y. R15b Task 7 adds the
    # v14-native fixture Z, above this gate's `<= 12` filter for the same
    # reason Y is.
    assert sorted(p.stem for p in version_excluded) == ["ab-elemental-benchmark", "y-due-diligence", "z-cost-plan-in-time"]


def _metrics_dict(metrics) -> dict:
    """asdict(), minus `calc_version` (constant for the whole engine, not
    version-dependent). Unlike test_migrate_v12.py's own `_metrics_dict`,
    `due_diligence` and `monitoring_statement` are BOTH compared: design Sec
    7 says the engine seeds the catalogue for a pre-v13 document too, so both
    arms agree and there is nothing to exclude."""
    d = asdict(metrics)
    d.pop("calc_version", None)
    return d


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 23.10: no existing appraisal's computed values move. Every figure
    the v12 arm produces, the v13 arm produces identically."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v12_run = run_appraisal(migrate_inputs_to_v12(raw, None))
    v13_run = run_appraisal(migrate_inputs_to_v13(raw, None))
    assert _metrics_dict(v12_run.metrics) == _metrics_dict(v13_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v12_run.model) == asdict(v13_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v12_run.schedule) == asdict(v13_run.schedule), f"{path.stem}: a schedule figure moved"
    # R15 fix wave (I3). The gate's expected ADDITION, asserted by name rather
    # than described in prose: every migrated document reads Sec 23.10's seed,
    # so all 23 entered items are `unknown` and Sec 23.9's amber flag fires. An
    # emptied or silently narrowed seed would leave the equality assertions
    # above green (both arms would agree on nothing) and fail here. Mirrors
    # migrate.test.ts's assertion in the v13 numeric-identity block.
    assert "due_diligence_unknown" in {f.code for f in v13_run.metrics.flags}, (
        f"{path.stem}: the migration seed no longer raises due_diligence_unknown"
    )


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_1_every_v12_issue_has_a_v13_counterpart(path):
    """Property 1 of three. Field strings may be renamed under a stated alias
    map; the SET of issues raised must not grow or shrink."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v12_issues = {(i.severity, ALIAS.get(i.field, i.field), i.message)
                  for i in validate_inputs(migrate_inputs_to_v12(raw, None))}
    v13_issues = {(i.severity, i.field, i.message)
                  for i in validate_inputs(migrate_inputs_to_v13(raw, None))}
    assert v13_issues == v12_issues


ALIAS: dict[str, str] = {}   # no field renames this release; kept so a future
                             # rename has a declared home rather than a
                             # loosened assertion.


# Properties 2 and 3: the v13-only validation rules are silent on a migrated
# document, and can actually fire. The seed writes every entered item
# `unknown` with no evidence, so a migrated document has nothing for Sec
# 23.9's rules to fire on; property 2 checks that stays true, and property 3
# (the matched non-vacuity check -- R12's Sec 18.7 lesson) proves the rules
# can actually fire when a document's due-diligence block is incomplete.
# Written in Task 2 against field prefixes rather than named rules, since the
# rules themselves did not exist until Task 6.


def test_property_2_v13_only_rules_are_silent_on_a_migrated_document():
    for p in FIXTURES:
        issues = validate_inputs(migrate_inputs_to_v13(_FIXTURE_DOCS[p]["inputs"], None))
        assert not [
            i for i in issues
            if i.field.startswith("due_diligence")
            or i.field.startswith("cost_plan.qs")
            or i.field.startswith("cost_plan.packages[")
        ], p.stem


def test_property_3_the_v13_only_rules_can_actually_fire():
    # Control: a migrated document whose due-diligence items list has its
    # first item deleted -- rule 1 (an incomplete catalogue) fires with field
    # `due_diligence`.
    raw = migrate_inputs_to_v13(_load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"], None).model_dump(mode="json")
    del raw["due_diligence"]["items"][0]
    fields = {i.field for i in validate_inputs(migrate_inputs_to_v13(raw, None))}
    assert "due_diligence" in fields


def test_migration_writes_the_seed():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v12 = migrate_inputs_to_v12(raw, None)
    v13 = migrate_v12_to_v13(v12)
    assert v13.inputs_version == 13
    assert v13.due_diligence.source_record is None
    assert [i.code for i in v13.due_diligence.items] == list(ENTERED_CODES)
    for item in v13.due_diligence.items:
        assert item.status == "unknown"
        assert item.evidence is None
        assert item.id == f"dd-{item.code}"
        assert item.label == ""
    assert v13.cost_plan.qs is None
    for package in v13.cost_plan.packages:
        assert package.price_basis is None
    dumped = v13.model_dump(mode="json")
    assert "qs" in dumped["cost_plan"]  # WRITTEN, not defaulted
    # j-blended-refinance's cost plan is headline-mode with no packages, so
    # `price_basis` WRITTEN (vs merely defaulted) on a package can only be
    # shown against a fixture that actually carries one.
    raw_q = _load_fixture(FIXTURE_DIR / "q-detailed-cost-plan.json")["inputs"]
    v13_q = migrate_v12_to_v13(migrate_inputs_to_v12(raw_q, None))
    dumped_q = v13_q.model_dump(mode="json")
    assert dumped_q["cost_plan"]["packages"]
    assert "price_basis" in dumped_q["cost_plan"]["packages"][0]  # WRITTEN, not defaulted


def test_migration_actively_overwrites_a_stray_due_diligence_block():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    doc = migrate_inputs_to_v12(raw, None).model_dump(mode="json")
    doc["due_diligence"] = {"poison": True}
    seeded = migrate_v12_to_v13(doc)
    assert [i.code for i in seeded.due_diligence.items] == list(ENTERED_CODES)


def test_is_v2_or_later_recognises_v13():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v13 = migrate_inputs_to_v13(raw, None).model_dump(mode="json")
    assert is_v2_or_later(v13) is True


def test_migrate_inputs_to_v13_refuses_an_unrecognised_version():
    with pytest.raises(ValueError, match="unrecognised inputs_version 14"):
        migrate_inputs_to_v13({"inputs_version": 14})


def test_migrate_inputs_to_v13_refuses_a_document_tagged_v13_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v13 structural check"):
        migrate_inputs_to_v13({"inputs_version": 13})


def test_migrate_v12_to_v13_refuses_double_migration():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v13 = migrate_inputs_to_v13(raw, None)
    with pytest.raises(ValueError, match="already a v13 document"):
        migrate_v12_to_v13(v13)
