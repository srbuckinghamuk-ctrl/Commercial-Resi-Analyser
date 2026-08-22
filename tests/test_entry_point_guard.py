"""R12 Task 18b, spec Sec 18.7. The Python half of THE guard that would have
caught R12 shipping inert.

Every arm this release built -- validation, the schedule wiring in both
engines, the exit anchors, the phase_slip lever, the phase editor and Gantt,
the memo's programme section -- is reachable only from a v9 document. If
``app/api/app.py`` keeps calling the v8 migration, no user ever holds a v9
document, none of that code is reachable in production, and roughly four
thousand tests stay green while proving it all works in a world nobody
inhabits. That is not hypothetical: R10 shipped exactly this split in the other
direction (server on v7, client on v6) and made every saved appraisal
unloadable; R9 and R11 each recorded a version of it.

**If this test failed and you are looking for what to do**: a production module
calls ``migrate_inputs_to_v{N}`` for an N that is not the newest migration
``app/financial_model/migrate.py`` offers. Either move that call site to the
newest one, or -- if you are deliberately adding a new version -- move ALL of
them, in ONE commit, together with the TypeScript half
(``frontend/src/lib/model/entry-point-guard.test.ts``) and both client entry
points. The persistence boundary is one thing with several halves; each
``migrate_inputs_to_v{N}`` refuses a v{N+1} document by design (spec Sec 3.5),
so a boundary split across two versions is not a degraded state, it is a broken
one.

The rule is written as "every production call site names the NEWEST migration",
derived from the migration module itself, rather than as "nobody names v8". A
hand-written "not v8" rule goes vacuous the moment v10 exists -- it would pass
a release that left every entry point on v9 -- and a guard that silently stops
guarding is the failure mode this file exists to prevent.
"""
import re
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1] / "app"

#: The migration module defines the versions, so it is exempt from its own
#: rule, as is the package __init__ that re-exports them for the tests and
#: gates that call the older entry points deliberately (the migration identity
#: gates use the v8 entry point as the "before" side of a before/after
#: comparison, which is the whole point of keeping it exported).
EXEMPT = {
    "financial_model/migrate.py",
    "financial_model/__init__.py",
}

MIGRATE_SOURCE = (APP_ROOT / "financial_model" / "migrate.py").read_text(encoding="utf-8")

_ENTRY_POINT_DEF = re.compile(r"^def migrate_inputs_to_v(\d+)\s*\(", re.MULTILINE)
_CALL = re.compile(r"\bmigrate_inputs_to_v(\d+)\s*\(")
_NAME = re.compile(r"\bmigrate_inputs_to_v(\d+)\b")


def _exported_entry_point_versions() -> list[int]:
    """Every ``migrate_inputs_to_v{N}`` the module actually defines, ascending."""
    return sorted({int(m) for m in _ENTRY_POINT_DEF.findall(MIGRATE_SOURCE)})


VERSIONS = _exported_entry_point_versions()
NEWEST = VERSIONS[-1] if VERSIONS else None


def _production_files() -> list[str]:
    out = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        rel = path.relative_to(APP_ROOT).as_posix()
        if rel in EXEMPT:
            continue
        if "/tests/" in f"/{rel}" or rel.startswith("tests/"):
            continue
        out.append(rel)
    return out


def _used_versions(source: str) -> set[int]:
    """The versions a module actually USES, as opposed to mentions.

    A call or an import of the name is a use. This repo's comments narrate the
    boundary's history by name across several releases and that prose is worth
    keeping, so a bare mention in a comment is not counted.
    """
    used = {int(m) for m in _CALL.findall(source)}
    for line in source.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(("import ", "from ")) or (
            stripped.startswith("migrate_inputs_to_v") and stripped.endswith(",")
        ):
            used.update(int(m) for m in _NAME.findall(line))
    return used


def test_migrate_module_exports_the_version_chain_this_guard_is_derived_from():
    """Non-vacuity, part 1: if the regex stopped matching, ``VERSIONS`` would be
    empty and every assertion below would pass over nothing."""
    assert len(VERSIONS) > 1
    assert NEWEST == 9
    assert 8 in VERSIONS


def test_guard_enumerates_the_production_module_that_holds_the_entry_point():
    """Non-vacuity, part 2: a guard that enumerated an empty file list, or lost
    the module the server boundary lives in, would pass while guarding
    nothing."""
    files = _production_files()
    assert len(files) > 10
    with_uses = [
        rel for rel in files
        if _used_versions((APP_ROOT / rel).read_text(encoding="utf-8"))
    ]
    assert with_uses == ["api/app.py"]


def test_no_production_module_calls_anything_but_the_newest_migration():
    offenders = []
    for rel in _production_files():
        source = (APP_ROOT / rel).read_text(encoding="utf-8")
        for version in sorted(_used_versions(source)):
            if version != NEWEST:
                offenders.append(f"{rel}: migrate_inputs_to_v{version}")
    assert offenders == []


def test_the_guard_proves_itself_on_a_stale_call_site():
    """Without this, a ``_used_versions`` that quietly stopped matching would
    make the assertion above pass on every file in the tree."""
    assert _used_versions("from app.financial_model.migrate import migrate_inputs_to_v8") == {8}
    assert _used_versions("    inputs = migrate_inputs_to_v8(raw)") == {8}
    assert _used_versions("# R11 Task 10 moved this to migrate_inputs_to_v8, one version back") == set()
