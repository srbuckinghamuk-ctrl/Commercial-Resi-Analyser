"""R13 spec Sec 19.9. The migration gate is numeric AND validation-side, and the
validation side is THREE separately falsifiable properties, not one set equality
-- R12's Sec 18.7 correction, applied from the start this time.

A single `set(v9_issues) == set(v10_issues)` assertion passes vacuously when the
new rules cannot fire at all, which is exactly how R12 shipped a gate that
proved nothing until it was rewritten mid-release.

Task 5 fix round: the brief's Step 1 code, run verbatim, does not work. Three
corrections applied here, all forced by checking the code against the actual
repo rather than trusting the brief's text (the standing instruction for this
release):

1. `_stored_version` read `inputs_version` off the TOP LEVEL of each fixture
   file. Every fixture in fixtures/financial-model stores it nested under
   `doc["inputs"]["inputs_version"]` (see test_financial_model_fixtures.py's
   `_version_of`, golden-fixtures.test.ts's `versionOf`) -- the top level
   never has the key, so the brief's filter would have silently kept EVERY
   fixture, including a future v10-native one, defeating the exclusion this
   file exists to apply. Fixed to read `doc["inputs"]`.
2. Every test that built `raw` from a fixture file and fed it straight to
   `migrate_inputs_to_v9`/`migrate_inputs_to_v10` was feeding the whole
   fixture wrapper (`{name, kind, inputs, expected_metrics}`), not the
   document those functions expect. Fixed to unwrap `doc["inputs"]`
   everywhere, matching the one established convention in this repo for
   reading this corpus.
3. `derive_metrics(migrate_inputs_to_v9(raw, None))` -- `derive_metrics` takes
   three positional arguments (inputs, schedule, model), not one, and its
   return type `AppraisalResultV2` is a plain `@dataclass`, not a Pydantic
   model: it has no `.model_dump()` method. Fixed to use `run_appraisal(...)`
   (which builds schedule/model/metrics together) and `dataclasses.asdict`,
   exactly the pattern test_migrate_v6.py/v7.py/v8.py already use for this
   same acceptance gate one version back.

Property 2 and Property 3 (below FIXTURES) are NOT implemented in this task --
see the comment above `# Property 2 and Property 3` for why, and Task 5's
report for the full reasoning.
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.migrate import (
    is_v2_or_later,
    migrate_inputs_to_v9,
    migrate_inputs_to_v10,
    migrate_v9_to_v10,
)
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# Sec 19.9's gates compare the v9 arm against the v10 arm of a document's
# INPUTS, so they can only run on a fixture that carries one. Fixture K (kind
# "sensitivity") carries no `inputs` of its own -- it names a `base_fixture`
# instead (governance Sec 2.1) -- so it is excluded here the same way
# test_financial_model_fixtures.py's `APPRAISAL_FIXTURES` and
# golden-fixtures.test.ts's `appraisalFixtures` already exclude it.
#
# `migrate_inputs_to_v9` refuses a v10 document by design (Sec 3.5's
# each-migration-refuses-the-next rule), so the two v10-NATIVE fixtures Task
# 5b authors are excluded here too (via the stored-version filter) and are
# covered by the golden-fixture suite instead.
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
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 9
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    """Guards the filter above. If every fixture became v10-native (or the
    corpus emptied) this file would pass with zero parametrised cases and
    prove nothing.

    The EXCLUSION BOUND is added by Task 5b, not here: Task 5b authors the two
    v10-native fixtures, so at this point the exclusion is legitimately zero.

    Pinned figure does not reconcile, flagged rather than silently matched
    (the standing instruction for this release): the brief pins this bound at
    15, equal to `len(ALL_FIXTURES)`. That number is only reachable if the
    exclusion filter above excludes nothing -- and a filter that can never
    exclude anything cannot do the one job this guard exists to protect
    (catching fixture K, which has no `inputs` block to read a version from
    at all, and catching Task 5b's two v10-native fixtures once they land).
    The corpus holds 15 files today; one (fixture K) is not an inputs
    document. 14 is the correct bound for this task -- see Task 5's report.
    """
    assert len(FIXTURES) >= 14


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 19.9: no existing appraisal's computed values move. Every figure the
    v9 arm produces, the v10 arm produces identically.

    asdict()/run_appraisal(), not the brief's derive_metrics(...).model_dump()
    -- see this module's docstring, correction 3."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v9_run = run_appraisal(migrate_inputs_to_v9(raw, None))
    v10_run = run_appraisal(migrate_inputs_to_v10(raw, None))
    assert asdict(v9_run.metrics) == asdict(v10_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v9_run.model) == asdict(v10_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v9_run.schedule) == asdict(v10_run.schedule), f"{path.stem}: a schedule figure moved"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_1_every_v9_issue_has_a_v10_counterpart(path):
    """Property 1 of three. Field strings may be renamed under a stated alias
    map; the SET of issues raised must not grow or shrink."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v9_issues = {(i.severity, ALIAS.get(i.field, i.field), i.message)
                 for i in validate_inputs(migrate_inputs_to_v9(raw, None))}
    v10_issues = {(i.severity, i.field, i.message)
                  for i in validate_inputs(migrate_inputs_to_v10(raw, None))}
    assert v10_issues == v9_issues


ALIAS: dict[str, str] = {}   # no field renames this release; kept so a future
                             # rename has a declared home rather than a loosened
                             # assertion.


# Property 2 and Property 3 are NOT implemented in this file.
#
# Property 2 ("every Sec 19.7 rule is inert on a migrated document") and
# Property 3 ("a control document that DOES trip a v10-only rule", which is
# what stops Property 2 being vacuously true) are a matched pair by design --
# the brief itself says Property 3 is "the one that stops property 2 being
# vacuous", and that R12 shipped Property 2's shape alone and had to rewrite
# it mid-release once that was noticed.
#
# Checked against both engines before writing anything (`grep -n
# "investment_case" app/financial_model/validation.py
# frontend/src/lib/model/validation.ts`): NEITHER engine has a rule that fires
# when `investment_case` is non-null. validation.ts:945-955 carries only a
# narrowing guard for the nullable refinance pair, with an explicit comment
# that "R13 Task 6 adds the real cross-field rule ... this guard is not that
# rule." Task 6 (frontend/src/lib/model/validation.ts, not yet run as of this
# task) is what adds Sec 19.7's twelve rules, including the
# `stabilised_occupancy_pct` rule this file's brief asks Property 3 to fire.
#
# Writing Property 3 now would mean fabricating a validation rule ahead of
# the task that owns it -- the standing instruction for this release
# forbids inventing behaviour to make a test pass. Writing Property 2 alone,
# without Property 3, would reproduce the exact defect shape this task exists
# to avoid repeating. So both are deferred together to whichever task lands
# after Sec 19.7's rules exist in both engines (Task 6 for TypeScript, plus
# its Python mirror) -- see Task 5's report for this read spelled out.


def test_migration_writes_only_nulls_and_zeroes():
    """Sec 19.9: three additions, all inert."""
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v10 = migrate_inputs_to_v10(raw, None)
    assert v10.investment_case is None
    assert v10.refinance is not None
    assert v10.refinance.arrangement_fee_basis == "fixed_pence"
    assert v10.refinance.arrangement_fee_pct == 0.0
    # The explicit pair survives untouched -- this is the path that stays live.
    assert v10.refinance.investment_value_pence is not None
    assert v10.refinance.ltv_pct is not None


def test_migration_actively_overwrites_stray_or_wrong_v10_fields_rather_than_relying_on_pydantic_defaults():
    """Non-vacuity for the test above -- the Python-specific trap this codebase
    has been bitten by before (test_migrate_v9.py's
    test_adds_anchor_none_to_every_tranche_and_to_refinance): `investment_case`
    defaults to `None` and `arrangement_fee_basis`/`arrangement_fee_pct`
    default to `'fixed_pence'`/`0.0` on `CalculatorInputsV10` itself (Task 4),
    so asserting only against a *validated* model would pass even with
    `migrate_v9_to_v10`'s three writes deleted entirely -- Pydantic would
    silently supply the same values.

    Confirmed empirically before writing this test (see Task 5's report):
    with the writes removed, `CalculatorInputsV10.model_validate` raises on
    the poisoned `investment_case` below (a stray dict from a hand-edited or
    malformed stored row, matching this module's `programme.packages`
    precedent one migration back), which is exactly the failure this test
    exists to produce. Poisoning `refinance` with values that are valid but
    WRONG -- the opposite of the target -- means a no-op migration would
    validate cleanly and still fail these two assertions."""
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v9 = migrate_inputs_to_v9(raw, None)
    doc = v9.model_dump(mode="json")
    # No real v9 document can carry this key -- it does not exist before v10 --
    # but a hand-edited or malformed stored row is not bound by any type
    # checker, so migration must still reset it to null unconditionally.
    doc["investment_case"] = {"poison": True}
    assert doc["refinance"] is not None
    doc["refinance"]["arrangement_fee_basis"] = "pct_of_quantum"
    doc["refinance"]["arrangement_fee_pct"] = 3.5

    v10 = migrate_v9_to_v10(doc)
    assert v10.investment_case is None
    assert v10.refinance.arrangement_fee_basis == "fixed_pence"
    assert v10.refinance.arrangement_fee_pct == 0.0


def test_is_v2_or_later_recognises_v10():
    """R12's Task 18b defect, fourth consecutive release (R10 for v7, R11 for
    v8, R12 for v9, now v10). A v10 raw payload that fell through this check
    would be tagged `legacy_unreconciled` by app.py's `was_v1`, so every
    appraisal saved after this release would carry the red 'Legacy --
    recalculation required' banner on its very first save."""
    raw = _load_fixture(FIXTURE_DIR / "l-retain-all.json")["inputs"]
    v10 = migrate_inputs_to_v10(raw, None).model_dump()
    assert is_v2_or_later(v10) is True
