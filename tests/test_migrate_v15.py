"""R16 spec Sec 25.7. Port of tests/test_migrate_v14.py with the v15
substitutions (this task's brief): v13->v14 becomes v14->v15; the corpus
filter is `"inputs" in _FIXTURE_DOCS[p]` (replacing `kind != "sensitivity"` --
fixture AA arrives in a later task with `kind: sensitivity` and no `inputs`,
and the older gates' filters still skip it by kind) and `<= 14`; no v15-native
golden fixture exists yet, so `version_excluded` is `[]`.

Filter correction carried forward from test_migrate_v13.py's/test_migrate_v14.py's
own docstrings: `_stored_version` reads `inputs_version` off `doc["inputs"]`, NOT
the top level of the fixture file -- every fixture in fixtures/financial-model
stores it nested there.

Unlike v14's migration (which carried an inert flag-non-vacuity lesson about
`no_inflation_allowance`), this migration's one write -- the four Sec 25.1
lever fields at their identity zero on every scenario -- is inert for a much
simpler reason: `ScenarioOverrides` already defaults every one of them to the
same zero (Task 1), so the write changes nothing any flag or figure reads.
There is no flag-shaped non-vacuity lesson to port here; the non-vacuity this
file needs is instead that the WRITE happened at the raw-dict layer (proven by
`test_migration_writes_the_four_zeros_on_every_scenario`, operating on
`_v15_scenarios` directly, mirroring `_v14_cost_plan`'s own raw-dict test) and
that the whole default sensitivity suite -- now touching four disjoint levers
under the Task 3 sort change -- is unmoved (guard 5, new this release).
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.financial_model import run_appraisal
from app.financial_model.migrate import (
    _v15_scenarios,
    is_v15,
    is_v2_or_later,
    migrate_inputs_to_v14,
    migrate_inputs_to_v15,
    migrate_v14_to_v15,
)
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# Sec 25.7's gates compare the v14 arm against the v15 arm of a document's
# INPUTS. Filtered on `"inputs" in doc`, NOT `kind != "sensitivity"` -- a
# later task adds a fixture with `kind: sensitivity` and no `inputs` at all,
# which this filter must skip by content rather than by a `kind` label the
# older gates happen to also use. `<= 14`: every corpus fixture up to and
# including v14 is a valid "before" document for this gate; no v15-native
# fixture exists yet.
ALL_FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))
_FIXTURE_DOCS: dict[Path, dict] = {p: _load_fixture(p) for p in ALL_FIXTURES}
FIXTURES = [
    p for p in ALL_FIXTURES
    if "inputs" in _FIXTURE_DOCS[p]
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 14
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    assert len(FIXTURES) >= 20
    version_excluded = [
        p for p in ALL_FIXTURES
        if "inputs" in _FIXTURE_DOCS[p]
        and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 14
    ]
    assert sorted(p.stem for p in version_excluded) == ["ab-elemental-benchmark"]


def _metrics_dict(metrics) -> dict:
    """asdict(), minus `calc_version` (constant for the whole engine) -- no
    other exclusion. This migration's one write is inert to every output."""
    d = asdict(metrics)
    d.pop("calc_version", None)
    return d


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 25.7: no existing appraisal's computed values move. Every figure
    the v14 arm produces, the v15 arm produces identically -- ledger,
    schedule and metrics (flags included) all with no exclusion."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v14_run = run_appraisal(migrate_inputs_to_v14(raw, None))
    v15_run = run_appraisal(migrate_inputs_to_v15(raw, None))
    assert _metrics_dict(v14_run.metrics) == _metrics_dict(v15_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v14_run.model) == asdict(v15_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v14_run.schedule) == asdict(v15_run.schedule), f"{path.stem}: a schedule figure moved"


def test_migration_writes_the_four_zeros_on_every_scenario():
    """Sec 25.7's one write, at the layer where it is observable: the raw
    dict. Pydantic's own defaults make it invisible again after
    model_validate -- which is exactly why the identity gate holds."""
    out = _v15_scenarios({"base": {"label": "b"}, "upside": None, "downside": {}, "severe": {"sales_slip_months": 1}})
    for key in ("base", "upside", "downside", "severe"):
        for f in ("saleable_area_adjustment_pct", "abnormal_cost_adjustment_pct", "refi_ltv_adjustment_pct"):
            assert out[key][f] == 0.0
        assert out[key]["programme_slip_months"] == 0
    assert out["severe"]["sales_slip_months"] == 1
    raw = _load_fixture(FIXTURE_DIR / "z-cost-plan-in-time.json")["inputs"]
    v15 = migrate_v14_to_v15(migrate_inputs_to_v14(raw, None))
    dumped = v15.model_dump(mode="json")
    assert dumped["inputs_version"] == 15
    assert dumped["scenarios"]["base"]["programme_slip_months"] == 0  # WRITTEN, not defaulted
    d14 = migrate_inputs_to_v14(raw, None).model_dump(mode="json")
    d14.pop("inputs_version"), d14.pop("scenarios"); dumped.pop("inputs_version"), dumped.pop("scenarios")
    assert d14 == dumped


ALIAS: dict[str, str] = {}   # no field renames this release; kept so a future
                             # rename has a declared home rather than a
                             # loosened assertion.


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_1_every_v14_issue_has_a_v15_counterpart(path):
    """Property 1 of three. Field strings may be renamed under a stated alias
    map; the SET of issues raised must not grow or shrink."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v14_issues = {(i.severity, ALIAS.get(i.field, i.field), i.message)
                  for i in validate_inputs(migrate_inputs_to_v14(raw, None))}
    v15_issues = {(i.severity, i.field, i.message)
                  for i in validate_inputs(migrate_inputs_to_v15(raw, None))}
    assert v15_issues == v14_issues


# Properties 2 and 3: the Sec 25.1 programme-slip whole-months rule
# (validation.py, immediately after the sales_slip_months rule) is silent on
# a migrated document, and can actually fire once a fractional value is
# recorded. Property 3 is structurally unreachable in Python -- see its own
# docstring below, which states the asymmetry the same way validation.py's own
# sales_slip_months comment does.
def test_property_2_no_migrated_document_raises_a_programme_slip_issue():
    for p in FIXTURES:
        issues = validate_inputs(migrate_inputs_to_v15(_FIXTURE_DOCS[p]["inputs"], None))
        assert not [
            i for i in issues if i.field.endswith(".programme_slip_months")
        ], p.stem


def test_property_3_a_fractional_programme_slip_is_structurally_unreachable_in_python():
    """Property 3 of three -- structurally unreachable in Python.
    `programme_slip_months: int` is a Pydantic field, so a fractional value
    never survives parsing to reach validate_inputs's rule at all: it is
    refused earlier, at the model boundary, as a pydantic ValidationError.
    Kept as a test of THAT boundary (not of validate_inputs) so the two
    engines' rule lists still match line for line -- validateInputs's TS twin
    CAN reach its own version of this branch (a JSON payload with 1.5 parses
    as a plain number with no int coercion) and asserts the spec-worded
    message there; Python asserts the ValidationError instead."""
    raw = migrate_inputs_to_v15(
        _load_fixture(FIXTURE_DIR / "s-dated-programme.json")["inputs"], None,
    ).model_dump(mode="json")
    raw["scenarios"]["downside"]["programme_slip_months"] = 1.5
    with pytest.raises(ValidationError):
        migrate_inputs_to_v15(raw, None)


SENSITIVITY_FIXTURES = ["f-dev-finance-12mo", "u-investment-case-ltv-binds", "y-due-diligence", "z-cost-plan-in-time"]


@pytest.mark.parametrize("stem", SENSITIVITY_FIXTURES)
def test_the_default_sensitivity_suite_is_identical_on_both_arms(stem):
    """Guard 5. Sorted application in _measure (the Task 3 sort change) must
    move nothing on the nine disjoint levers: the default-config suite -- 34
    appraisals -- compared with strict equality on four documents spanning
    the corpus's blocks (no blocks; investment case; ledger + DD; cost plan
    in time)."""
    from app.financial_model.sensitivity import run_sensitivity
    raw = _load_fixture(FIXTURE_DIR / f"{stem}.json")["inputs"]
    v14 = asdict(run_sensitivity(migrate_inputs_to_v14(raw, None)))
    v15 = asdict(run_sensitivity(migrate_inputs_to_v15(raw, None)))
    assert v14 == v15


def test_is_v15_requires_all_four_lever_fields_on_scenarios_base():
    """The structural check (isV15's Python twin): `inputs_version == 15` AND
    `due_diligence` present AND `scenarios.base` is a dict carrying all four
    Sec 25.1 lever keys. A document relabelled v15 without actually writing
    them -- e.g. a v14 payload with the version field hand-edited -- must be
    rejected as NOT structurally v15, the same way a document relabelled v14
    without `qs.inflation` is rejected by `is_v14`."""
    lever_fields = {
        "saleable_area_adjustment_pct": 0.0, "abnormal_cost_adjustment_pct": 0.0,
        "programme_slip_months": 0, "refi_ltv_adjustment_pct": 0.0,
    }
    base = {"inputs_version": 15, "due_diligence": {}, "scenarios": {"base": dict(lever_fields)}}
    assert is_v15(base) is True
    assert is_v15({**base, "scenarios": {"base": {"saleable_area_adjustment_pct": 0.0}}}) is False  # missing 3 keys
    assert is_v15({**base, "inputs_version": 14}) is False  # spoofed: v14 label
    assert is_v15({"inputs_version": 15, "scenarios": {"base": dict(lever_fields)}}) is False  # no due_diligence
    assert is_v15({"inputs_version": 15, "due_diligence": {}, "scenarios": None}) is False


def test_is_v2_or_later_recognises_v15():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v15 = migrate_inputs_to_v15(raw, None).model_dump(mode="json")
    assert is_v2_or_later(v15) is True


def test_migrate_inputs_to_v15_refuses_an_unrecognised_version():
    with pytest.raises(ValueError, match="unrecognised inputs_version 16"):
        migrate_inputs_to_v15({"inputs_version": 16})


def test_migrate_inputs_to_v15_refuses_a_document_tagged_v15_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v15 structural check"):
        migrate_inputs_to_v15({"inputs_version": 15})


def test_migrate_v14_to_v15_refuses_double_migration():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v15 = migrate_inputs_to_v15(raw, None)
    with pytest.raises(ValueError, match="already a v15 document"):
        migrate_v14_to_v15(v15)
