"""R15b spec Sec 24.8. The migration gate is numeric AND validation-side, and
the validation side is THREE separately falsifiable properties, not one set
equality -- ported wholesale from tests/test_migrate_v13.py with the v14
substitutions (Task 6's brief).

Filter correction carried forward from test_migrate_v13.py's own docstring:
`_stored_version` reads `inputs_version` off `doc["inputs"]`, NOT the top
level of the fixture file -- every fixture in fixtures/financial-model stores
it nested there.

**Controller ruling (ledgered, superseding an earlier draft of this file).**
An earlier version of this gate carried a `<= {"no_inflation_allowance"}`
subset bound on the flag list, with a standalone non-vacuity test claiming
fixture Y proved that bound live. It did not: `no_inflation_allowance` is
result-derived from `qs.inflation`/`?? None`, and `QsProvenance.inflation`
already defaults to `None` on EVERY engine read regardless of the document's
`inputs_version` -- R8's rule (spec Sec 2) is that the engine reads a raw
document's absent key the same way it reads an explicit `None` seed, so this
migration's one write is inert to EVERY output, flags included, on EVERY
fixture, Y included. A subset bound that is always satisfied by an empty set
is a hole, not an invariant, so it is gone: `_metrics_dict` below excludes
only `calc_version` (same as test_migrate_v13.py's own), and the whole
`metrics` object -- flags included -- is compared with strict equality, the
same as `model` and `schedule` already are. The Y-specific test is kept and
reworded to what is actually true: `no_inflation_allowance` fires on fixture
Y on BOTH arms, by name -- proof the flag is a genuine, non-trivial one the
equality above is not passing over vacuously.

A second, related defect this ruling also closes (TypeScript-only; this file
never needed a matching fix): `computeCostPlan` (cost-plan.ts) used to
republish `cost_plan.qs` as a raw passthrough of the input object, so a raw
pre-v14 document's `qs` lacked the `inflation` key its migrated v14 twin's
`qs` carried explicitly -- migrate.test.ts's own twin gate needed a shape
exclusion this file never did, because `QsProvenance.model_dump()` already
publishes every declared field regardless of document version.
`computeCostPlan` now normalises its own republish to match, so neither
engine's gate needs a shape exclusion any more.
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.migrate import (
    _v14_cost_plan,
    is_v14,
    is_v2_or_later,
    migrate_inputs_to_v13,
    migrate_inputs_to_v14,
    migrate_v13_to_v14,
)
from app.financial_model.validation import validate_inputs

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


# Sec 24.8's gates compare the v13 arm against the v14 arm of a document's
# INPUTS. Fixture K (kind "sensitivity") carries no `inputs` of its own, so it
# is excluded the same way test_migrate_v13.py already excludes it.
#
# Unlike test_migrate_v13.py's own `<= 12` filter (which excluded the
# v13-native fixture Y), this file's filter is `<= 13`: Y is a valid "before"
# document for the v13->v14 gate the same way every other corpus fixture is.
# R15b Task 7 adds Z, the corpus's first v14-native fixture, so
# `version_excluded` now names it -- the same position Y held one release
# earlier for the v12->v13 gate.
ALL_FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))
_FIXTURE_DOCS: dict[Path, dict] = {p: _load_fixture(p) for p in ALL_FIXTURES}
FIXTURES = [
    p for p in ALL_FIXTURES
    if _FIXTURE_DOCS[p].get("kind") != "sensitivity"
    and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) <= 13
]


def test_the_migration_corpus_is_not_empty_and_did_not_silently_shrink():
    assert len(FIXTURES) >= 20
    version_excluded = [
        p for p in ALL_FIXTURES
        if _FIXTURE_DOCS[p].get("kind") != "sensitivity"
        and _FIXTURE_DOCS[p]["inputs"].get("inputs_version", 2) > 13
    ]
    assert sorted(p.stem for p in version_excluded) == ["ab-elemental-benchmark", "z-cost-plan-in-time"]


def _metrics_dict(metrics) -> dict:
    """asdict(), minus `calc_version` (constant for the whole engine) -- no
    other exclusion. Flags compare with strict equality, in order, inside
    this same dict: this migration's one write is inert to every output."""
    d = asdict(metrics)
    d.pop("calc_version", None)
    return d


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_numeric_identity_corpus_wide(path):
    """Sec 24.8: no existing appraisal's computed values move. Every figure
    the v13 arm produces, the v14 arm produces identically -- ledger,
    schedule and metrics (flags included) all with no exclusion."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v13_run = run_appraisal(migrate_inputs_to_v13(raw, None))
    v14_run = run_appraisal(migrate_inputs_to_v14(raw, None))
    assert _metrics_dict(v13_run.metrics) == _metrics_dict(v14_run.metrics), f"{path.stem}: metrics moved"
    assert asdict(v13_run.model) == asdict(v14_run.model), f"{path.stem}: a ledger figure moved"
    assert asdict(v13_run.schedule) == asdict(v14_run.schedule), f"{path.stem}: a schedule figure moved"


def test_no_inflation_allowance_fires_on_fixture_y_on_both_arms():
    """Non-vacuity for the strict equality above (R8: an absent key reads
    the same as the seed). Fixture Y's raw v13 document has a real, non-null
    `qs` with no `inflation` key and a base date preceding a package
    midpoint (Sec 24.7's firing condition) -- the v13 arm reads that
    absence exactly as `?? None`, so the SAME amber flag fires on both
    arms, not just the migrated one. Proof the flag list equality above is
    not passing over a vacuous "both arms raise nothing"."""
    raw = _load_fixture(FIXTURE_DIR / "y-due-diligence.json")["inputs"]
    v13_flags = {f.code for f in run_appraisal(migrate_inputs_to_v13(raw, None)).metrics.flags}
    v14_flags = {f.code for f in run_appraisal(migrate_inputs_to_v14(raw, None)).metrics.flags}
    assert "no_inflation_allowance" in v13_flags, "v13 (raw) arm"
    assert "no_inflation_allowance" in v14_flags, "v14 (migrated) arm"


ALIAS: dict[str, str] = {}   # no field renames this release; kept so a future
                             # rename has a declared home rather than a
                             # loosened assertion.


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_property_1_every_v13_issue_has_a_v14_counterpart(path):
    """Property 1 of three. Field strings may be renamed under a stated alias
    map; the SET of issues raised must not grow or shrink."""
    raw = _FIXTURE_DOCS[path]["inputs"]
    v13_issues = {(i.severity, ALIAS.get(i.field, i.field), i.message)
                  for i in validate_inputs(migrate_inputs_to_v13(raw, None))}
    v14_issues = {(i.severity, i.field, i.message)
                  for i in validate_inputs(migrate_inputs_to_v14(raw, None))}
    assert v14_issues == v13_issues


# Properties 2 and 3: the Sec 24.7 tender-price-inflation validation rules are
# silent on a migrated document, and can actually fire. The migration writes
# `inflation: None` only, so a migrated document has nothing for those four
# rules to fire on (every one of them is gated on `inflation is not None`,
# validation.py); property 2 checks that stays true, and property 3 (the
# matched non-vacuity check, R12's Sec 18.7 lesson) proves the rules can
# actually fire once a real allowance is recorded by hand.
def test_property_2_v14_only_rules_are_silent_on_a_migrated_document():
    for p in FIXTURES:
        issues = validate_inputs(migrate_inputs_to_v14(_FIXTURE_DOCS[p]["inputs"], None))
        assert not [
            i for i in issues if i.field.startswith("cost_plan.qs.inflation")
        ], p.stem


def test_property_3_the_v14_only_rules_can_actually_fire():
    # Control: a migrated document with a real (invalid) allowance recorded
    # by hand -- rule 1 (a non-finite/negative rate) fires with field
    # `cost_plan.qs.inflation.annual_pct`. Fixture S is detailed-mode with
    # dated packages, so `latest_midpoint_months_from_base` resolves and the
    # calendar guard (rules 2/3) does not itself suppress rule 1.
    raw = migrate_inputs_to_v14(
        _load_fixture(FIXTURE_DIR / "s-dated-programme.json")["inputs"], None,
    ).model_dump(mode="json")
    raw["cost_plan"]["qs"] = {
        "source": "Gleeds", "stage": "riba_3", "date": "2026-02-15", "status": "issued",
        "base_date": "2026-02-01", "inflation": {"annual_pct": float("inf")},
    }
    fields = {i.field for i in validate_inputs(migrate_inputs_to_v14(raw, None))}
    assert "cost_plan.qs.inflation.annual_pct" in fields


def test_migration_writes_the_seed_inside_a_non_null_qs():
    """Sec 24.8's one write, proven directly at the layer where it is
    observable: `_v14_cost_plan` (the raw-dict builder `migrate_v13_to_v14`
    delegates to, mirroring `_v13_cost_plan`) leaves a null `qs` null and
    writes `inflation: None` onto a non-null one. Pydantic's OWN field
    default makes this invisible again after `.model_validate()` --
    `QsProvenance.inflation` defaults to `None` whether the key was present
    in the raw dict or not -- which is exactly why the numeric identity gate
    above holds and why this test operates on the dict, not the parsed
    model."""
    assert _v14_cost_plan({"qs": None})["qs"] is None
    assert _v14_cost_plan(None)["qs"] is None
    out = _v14_cost_plan({"qs": {"source": "Gleeds", "base_date": "2026-02-01"}})
    assert out["qs"] == {"source": "Gleeds", "base_date": "2026-02-01", "inflation": None}

    # And end to end: fixture Y's RAW stored document has a real, non-null
    # `qs` with NO `inflation` key at all (a genuine v13-native document, not
    # a pydantic round trip) -- migrate_v13_to_v14 must add the key.
    raw = _load_fixture(FIXTURE_DIR / "y-due-diligence.json")["inputs"]
    assert raw["cost_plan"]["qs"] is not None
    assert "inflation" not in raw["cost_plan"]["qs"]
    v14 = migrate_v13_to_v14(migrate_inputs_to_v13(raw, None))
    assert v14.cost_plan.qs.inflation is None
    assert v14.inputs_version == 14
    # Nothing else moved: strip the two touched top-level fields and compare
    # the rest field for field, the same shape test_migrate_v13.py's own
    # "writes the seed" test uses.
    v13 = migrate_inputs_to_v13(raw, None)
    d13 = v13.model_dump(mode="json")
    d14 = v14.model_dump(mode="json")
    d13.pop("inputs_version"), d13.pop("cost_plan")
    d14.pop("inputs_version"), d14.pop("cost_plan")
    assert d13 == d14


def test_boundary_round_trip_qs_present_vs_absent():
    """Sec 24.8 boundary. A v14 document with a `qs` block round-trips
    through the Python model with `inflation: None` PRESENT (not absent);
    one with no `qs` at all has no `inflation` anywhere in the dump."""
    raw_with_qs = _load_fixture(FIXTURE_DIR / "y-due-diligence.json")["inputs"]
    v14_with_qs = migrate_inputs_to_v14(raw_with_qs, None)
    dumped = v14_with_qs.model_dump(mode="json")
    assert dumped["cost_plan"]["qs"] is not None
    assert "inflation" in dumped["cost_plan"]["qs"]
    assert dumped["cost_plan"]["qs"]["inflation"] is None

    raw_no_qs = _load_fixture(FIXTURE_DIR / "l-retain-all.json")["inputs"]
    v14_no_qs = migrate_inputs_to_v14(raw_no_qs, None)
    dumped_no_qs = v14_no_qs.model_dump(mode="json")
    assert dumped_no_qs["cost_plan"]["qs"] is None
    assert "inflation" not in json.dumps(dumped_no_qs)


def test_is_v14_requires_the_inflation_key_on_a_non_null_qs():
    """The structural check (isV14's Python twin): `inputs_version == 14`
    AND `due_diligence` present AND `cost_plan` is a dict AND (`qs` is None,
    OR `qs` carries the `inflation` key). A document relabelled v14 without
    actually carrying the key -- e.g. a v13 payload with the version field
    hand-edited -- must be rejected as NOT structurally v14, the same way a
    document relabelled v13 without a `due_diligence` block is rejected by
    `is_v13`."""
    base = {"inputs_version": 14, "due_diligence": {}, "cost_plan": {"qs": None}}
    assert is_v14(base) is True
    assert is_v14({**base, "cost_plan": {"qs": {"inflation": None}}}) is True
    assert is_v14({**base, "cost_plan": {"qs": {"source": "x"}}}) is False  # spoofed: v13 shape, v14 label
    assert is_v14({**base, "inputs_version": 13}) is False
    assert is_v14({"inputs_version": 14, "cost_plan": {"qs": None}}) is False  # no due_diligence
    assert is_v14({"inputs_version": 14, "due_diligence": {}, "cost_plan": None}) is False


def test_is_v2_or_later_recognises_v14():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v14 = migrate_inputs_to_v14(raw, None).model_dump(mode="json")
    assert is_v2_or_later(v14) is True


def test_migrate_inputs_to_v14_refuses_an_unrecognised_version():
    with pytest.raises(ValueError, match="unrecognised inputs_version 15"):
        migrate_inputs_to_v14({"inputs_version": 15})


def test_migrate_inputs_to_v14_refuses_a_document_tagged_v14_that_fails_the_structural_check():
    with pytest.raises(ValueError, match="fails the v14 structural check"):
        migrate_inputs_to_v14({"inputs_version": 14})


def test_migrate_v13_to_v14_refuses_double_migration():
    raw = _load_fixture(FIXTURE_DIR / "j-blended-refinance.json")["inputs"]
    v14 = migrate_inputs_to_v14(raw, None)
    with pytest.raises(ValueError, match="already a v14 document"):
        migrate_v13_to_v14(v14)
