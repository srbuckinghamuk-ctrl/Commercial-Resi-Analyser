"""R9 spec Sec 15.4 -- the Python half of the single-accessor guard.

Python has no eslint, so the enforcement here is a source scan. It is built on
the ``ast`` module rather than a substring search: a substring scan would
false-positive on shapes that exist in this tree right now and are not reads --
a doc comment naming the field (``app/api/app.py``, and the module docstrings
in ``areas.py``/``migrate.py``), and an error-message field-name string literal
(``validation.py`` passes ``"conversion_costs.total_construction_sqm"`` as an
issue's field name -- that is data, not a read). A guard that cries wolf on
those gets weakened until it is useless, so this scan walks each module's AST
and flags only the two node shapes that are an actual read:

* ``ast.Attribute`` nodes whose ``.attr`` is ``total_construction_sqm`` --
  catches ``inputs.conversion_costs.total_construction_sqm`` and
  ``cc.total_construction_sqm`` however deep the attribute chain, but not the
  field name spelled out inside a string.
* ``ast.Name`` or ``ast.Attribute`` nodes referencing ``TAX_TABLES`` -- catches
  both the bare name (``from acquisition_tax import TAX_TABLES; TAX_TABLES[0]``)
  and a qualified reference (``acquisition_tax.TAX_TABLES``).
"""
from __future__ import annotations

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"

AREA_FIELD = "total_construction_sqm"
TAX_SYMBOL = "TAX_TABLES"

# Files that OWN the value, DECLARE it, or construct documents where no
# accessor exists yet. Everything else must go through developed_area_sqm().
AREA_ALLOWLIST = {
    "app/financial_model/areas.py",
    "app/financial_model/types.py",
    "app/financial_model/migrate.py",
}
# TAX_TABLES is the real symbol (acquisition_tax.py:47). Verified against the
# source before being written here -- a needle that matches nothing would make
# this test pass forever while guarding nothing.
TAX_ALLOWLIST = {"app/financial_model/acquisition_tax.py"}


def _iter_py_files():
    """Every .py file under app/, compiled caches excluded. Scanning the whole
    package (not just financial_model) is deliberate: app/api/app.py carries a
    doc comment naming the cost-area field (a known false-positive shape for a
    substring scan), and walking the AST there too proves the point rather than
    just asserting it."""
    for path in sorted(APP_DIR.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        yield path


def _rel(path: Path) -> str:
    return path.relative_to(APP_DIR.parent).as_posix()


def _attribute_reads(tree: ast.AST, attr_name: str) -> list[int]:
    """Line numbers of every ast.Attribute node whose `.attr` matches -- a real
    read of that field, at any depth of attribute chain."""
    return sorted(
        node.lineno for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr == attr_name
    )


def _name_references(tree: ast.AST, name: str) -> list[int]:
    """Line numbers of every ast.Name or ast.Attribute node referencing `name`
    -- covers both the bare identifier and a qualified `module.NAME` access."""
    lines = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == name:
            lines.append(node.lineno)
        elif isinstance(node, ast.Attribute) and node.attr == name:
            lines.append(node.lineno)
    return sorted(lines)


def _offenders(finder, allowlist: set[str]) -> list[str]:
    out = []
    for path in _iter_py_files():
        rel = _rel(path)
        if rel in allowlist:
            continue
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=rel)
        source_lines = source.splitlines()
        for lineno in finder(tree):
            out.append(f"{rel}:{lineno}: {source_lines[lineno - 1].strip()}")
    return out


def test_no_unauthorised_reader_of_the_cost_area():
    """R8's lesson: the same 'moved the computation, missed a consumer' defect
    recurred three times in one release, every site individually
    self-consistent and therefore invisible to a green suite. Resolve the
    construction area with developed_area_sqm(inputs) from areas.py."""
    offenders = _offenders(lambda t: _attribute_reads(t, AREA_FIELD), AREA_ALLOWLIST)
    assert offenders == [], (
        "These files read the raw cost-area field instead of calling "
        "developed_area_sqm(inputs) from app/financial_model/areas.py:\n  "
        + "\n  ".join(offenders)
    )


def test_no_unauthorised_evaluator_of_the_tax_bands():
    """The other half of the same class (spec Sec 14): the acquisition-tax band
    table is evaluated only inside acquisition_tax.py."""
    offenders = _offenders(lambda t: _name_references(t, TAX_SYMBOL), TAX_ALLOWLIST)
    assert offenders == [], (
        "These files reference the tax band table directly instead of calling "
        "calculate_acquisition_tax() from app/financial_model/acquisition_tax.py:\n  "
        + "\n  ".join(offenders)
    )


def test_the_guard_ignores_a_comment_naming_the_field():
    """app/api/app.py:411 carries a doc comment mentioning
    `conversion_costs.total_construction_sqm`, and validation.py passes the
    field name as a string literal to `err()`. Neither is a read. A substring
    scan would flag both; the AST walk must flag neither."""
    offenders = _offenders(lambda t: _attribute_reads(t, AREA_FIELD), AREA_ALLOWLIST)
    flagged_files = {o.split(":", 1)[0] for o in offenders}
    assert "app/api/app.py" not in flagged_files
    assert "app/financial_model/validation.py" not in flagged_files


def test_the_guard_itself_detects_a_planted_attribute_read():
    """A guard nobody has watched fail is not a guard."""
    probe = APP_DIR / "financial_model" / "__guard_probe.py"
    probe.write_text(
        "x = inputs.conversion_costs.total_construction_sqm\n", encoding="utf-8"
    )
    try:
        offenders = _offenders(lambda t: _attribute_reads(t, AREA_FIELD), AREA_ALLOWLIST)
        assert any("__guard_probe.py" in o for o in offenders)
    finally:
        probe.unlink()


def test_the_guard_itself_detects_a_planted_tax_table_reference():
    """The tax half needs its own planted-violation proof -- it is a different
    node shape (Name/Attribute reference, not a field read)."""
    probe = APP_DIR / "financial_model" / "__guard_probe.py"
    probe.write_text(
        "from app.financial_model.acquisition_tax import TAX_TABLES\n"
        "x = TAX_TABLES[0]\n",
        encoding="utf-8",
    )
    try:
        offenders = _offenders(lambda t: _name_references(t, TAX_SYMBOL), TAX_ALLOWLIST)
        assert any("__guard_probe.py" in o for o in offenders)
    finally:
        probe.unlink()
