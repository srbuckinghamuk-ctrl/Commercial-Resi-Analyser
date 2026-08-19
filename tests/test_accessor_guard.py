"""R9 spec Sec 15.4 -- the Python half of the single-accessor guard.

Python has no eslint, so the enforcement here is a source scan. It is built on
the ``ast`` module rather than a substring search: a substring scan would
false-positive on shapes that exist in this tree right now and are not reads --
a doc comment naming the field (``app/api/app.py``, and the module docstrings
in ``areas.py``/``migrate.py``), and an error-message field-name string literal
(``validation.py`` passes ``"conversion_costs.total_construction_sqm"`` as an
issue's field name -- that is data, not a read). A guard that cries wolf on
those gets weakened until it is useless, so this scan walks each module's AST
and flags only the node shapes that are an actual read:

* ``ast.Attribute`` nodes whose ``.attr`` is ``total_construction_sqm`` --
  catches ``inputs.conversion_costs.total_construction_sqm`` and
  ``cc.total_construction_sqm`` however deep the attribute chain, but not the
  field name spelled out inside a string.
* ``getattr(x, "total_construction_sqm")`` (R9 fix wave) -- the dynamic form of
  the same read. The attribute walk above cannot see it: the field name is a
  string argument, not an ``.attr``. Only a literal second argument is matched;
  a computed one is not a shape this guard can decide.
* ``x["total_construction_sqm"]`` (R9 fix wave) -- a dict-key read of a raw
  snapshot, e.g. ``snapshot["conversion_costs"]["total_construction_sqm"]``.
  Stored appraisals round-trip through JSON, so a consumer reading the dict
  before it is parsed into a model bypasses the accessor exactly as an
  attribute read would. Only a literal string subscript is matched, so a dict
  *literal* key (``{"total_construction_sqm": 0}`` in migrate.py, which is a
  write, not a read) is untouched -- that is an ``ast.Dict`` key, not an
  ``ast.Subscript`` slice.
* ``ast.Name`` or ``ast.Attribute`` nodes referencing ``TAX_TABLES`` -- catches
  both the bare name (``from acquisition_tax import TAX_TABLES; TAX_TABLES[0]``)
  and a qualified reference (``acquisition_tax.TAX_TABLES``).
* ``ast.Name`` or ``ast.Attribute`` nodes referencing ``select_band_set``
  (R9 fix wave) -- the hole the ``TAX_TABLES`` rule left open. It is an
  exported function handing back the very ``.bands`` list ``TAX_TABLES``
  holds, so a consumer could evaluate its own acquisition tax through it and
  trip neither half of the guard.
* ``ast.Attribute``/``getattr``/subscript nodes for ``contingency_pct`` (R10
  Task 9) -- the same three shapes as the cost-area field above, applied to
  the now-legacy conversion-cost field ``compute_cost_plan`` superseded.
  ``run.metrics.cost_plan.contingency`` is the resolved figure once a
  document carries a ``cost_plan`` block.
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

# The other half of the tax accessor (R9 fix wave). select_band_set is the real
# symbol (acquisition_tax.py:126) -- verified against the source, like
# TAX_TABLES above. validation.py is allowlisted because its use is narrow and
# legitimate: it asks "can this acquisition date be placed in a band set at
# all?" and reports the answer as a ValidationIssue (validation.py:452). It
# never touches `.bands` and never computes tax. Its TypeScript twin
# (model/validation.ts) is allowlisted the same way, but at the call sites
# rather than the file, because eslint's file allowlist is all-or-nothing per
# rule and would have switched the cost-area selectors off too.
BAND_SELECTOR = "select_band_set"
BAND_SELECTOR_ALLOWLIST = {
    "app/financial_model/acquisition_tax.py",
    "app/financial_model/validation.py",
}

# R10 Task 9. contingency_pct is now legacy: a document with a `cost_plan`
# block (every v7 document) ignores it entirely -- compute_cost_plan reads the
# resolved figure from cost_plan.contingency, not from this field. It survives
# on ConversionCostInputs only because a pre-v7 document, and the manual/
# headline-mode editor, still carry it as raw user input.
CONTINGENCY_FIELD = "contingency_pct"
CONTINGENCY_ALLOWLIST = {
    # cost_plan_from_legacy_costs -- the one correct reader (spec Sec 4): folds
    # the raw field into a cost_plan's general contingency class.
    "app/financial_model/types.py",
    # Constructs pre-v7 documents where no cost_plan accessor exists yet. No
    # direct read today (only a dict-literal default, an ast.Dict key rather
    # than a read), allowlisted for symmetry with the TS guard and to stay
    # inert if a future default construction reads the field back.
    "app/financial_model/migrate.py",
    # calculate_total_construction_cost -- compute_cost_plan's predecessor,
    # same reasoning as cost_plan_from_legacy_costs above, still the live cost
    # estimate migrate.py's v1->v2 bootstrap uses (there is no cost_plan yet
    # that early in the migration chain). Known limitation, recorded rather
    # than glossed: unlike the TS guard, which isolates this function in its
    # own file (conversion-calc-engine.ts) and leaves schedule.ts fully
    # policed, Python keeps the legacy calculator inside schedule.py itself,
    # so this allowlist entry also stops the guard seeing a NEW illegitimate
    # contingency_pct read anywhere else in schedule.py (e.g. inside
    # build_schedule). build_schedule currently reads cost only through
    # compute_cost_plan, so the current tree is clean; a future regression
    # there would not be caught by this scan.
    "app/financial_model/schedule.py",
    # The raw field's own negative-value validation (mirrors the
    # total_construction_sqm/manual-basis check immediately above it in
    # validation.py) -- validates the pre-v7/manual-basis raw input, which
    # still exists and is still user-editable until R10 Task 12 rebuilds the
    # cost page. TS's twin (model/validation.ts) is exempted at the call site
    # instead (eslint's file allowlist is per-rule, not per-selector); Python
    # has no line-scoped equivalent, so this is file-scoped -- but scoped to
    # THIS field's allowlist only, not the area/tax allowlists above.
    "app/financial_model/validation.py",
}


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


def _getattr_reads(tree: ast.AST, attr_name: str) -> list[int]:
    """Line numbers of every ``getattr(x, "<attr_name>")`` call -- the dynamic
    spelling of the same read, invisible to `_attribute_reads` because the field
    name is a string argument rather than an `.attr`. A non-literal second
    argument is deliberately not matched: the guard cannot decide it, and a
    guard that guesses is worse than one that abstains."""
    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name):
            called = func.id
        elif isinstance(func, ast.Attribute):
            called = func.attr
        else:
            continue
        if called != "getattr" or len(node.args) < 2:
            continue
        key = node.args[1]
        if isinstance(key, ast.Constant) and key.value == attr_name:
            lines.append(node.lineno)
    return sorted(lines)


def _subscript_reads(tree: ast.AST, key_name: str) -> list[int]:
    """Line numbers of every ``x["<key_name>"]`` subscript -- a dict-key read of
    a raw, still-unparsed snapshot (stored appraisals round-trip through JSON).
    A dict *literal* key of the same name is an ``ast.Dict`` key, not a
    ``Subscript`` slice, so migrate.py's document construction is untouched."""
    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Subscript):
            continue
        key = node.slice
        if isinstance(key, ast.Constant) and key.value == key_name:
            lines.append(node.lineno)
    return sorted(lines)


def _area_reads(tree: ast.AST) -> list[int]:
    """Every shape that is an actual read of the cost-area field. One finder so
    a new shape closes the hole for the real scan and the planted-violation
    proofs at the same time."""
    return sorted(
        _attribute_reads(tree, AREA_FIELD)
        + _getattr_reads(tree, AREA_FIELD)
        + _subscript_reads(tree, AREA_FIELD)
    )


def _contingency_reads(tree: ast.AST) -> list[int]:
    """Every shape that is an actual read of contingency_pct -- the same three
    shapes _area_reads checks, applied to the now-legacy field (R10 Task 9)."""
    return sorted(
        _attribute_reads(tree, CONTINGENCY_FIELD)
        + _getattr_reads(tree, CONTINGENCY_FIELD)
        + _subscript_reads(tree, CONTINGENCY_FIELD)
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
    offenders = _offenders(_area_reads, AREA_ALLOWLIST)
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
    scan would flag both; the AST walk must flag neither.

    The R9 fix wave widened the scan to getattr and dict-key reads, so this also
    pins that the two new shapes added no false positives: migrate.py's
    ``{"total_construction_sqm": 0}`` dict literals are ast.Dict keys, not
    Subscript slices, and nothing in the tree calls getattr with that name."""
    offenders = _offenders(_area_reads, AREA_ALLOWLIST)
    flagged_files = {o.split(":", 1)[0] for o in offenders}
    assert "app/api/app.py" not in flagged_files
    assert "app/financial_model/validation.py" not in flagged_files


def test_no_unauthorised_reader_of_contingency_pct():
    """R10 Task 9 (spec Sec 16): contingency_pct is superseded by cost_plan.
    Resolve it through run.metrics.cost_plan.contingency (compute_cost_plan),
    never by reading the raw ConversionCostInputs field."""
    offenders = _offenders(_contingency_reads, CONTINGENCY_ALLOWLIST)
    assert offenders == [], (
        "These files read the raw contingency_pct field instead of reading "
        "cost_plan.contingency from app/financial_model/cost_plan.py "
        "(compute_cost_plan):\n  " + "\n  ".join(offenders)
    )


def test_no_unauthorised_selector_of_the_tax_band_sets():
    """R9 fix wave. select_band_set hands back the raw band list, so a consumer
    could compute its own acquisition tax through it while referencing neither
    TAX_TABLES nor the cost-area field -- tripping neither existing half of the
    guard. validation.py is allowlisted (it asks whether a date is placeable and
    reports the answer; it never reads `.bands`)."""
    offenders = _offenders(
        lambda t: _name_references(t, BAND_SELECTOR), BAND_SELECTOR_ALLOWLIST
    )
    assert offenders == [], (
        "These files select acquisition-tax band sets directly instead of calling "
        "calculate_acquisition_tax() from app/financial_model/acquisition_tax.py:\n  "
        + "\n  ".join(offenders)
    )


def _probe_offenders(source: str, finder, allowlist: set[str]) -> list[str]:
    """Plant `source` as a module under app/, run `finder` over the tree, and
    remove it again -- the shared body of every watch-it-fail proof below. The
    probe file is removed in a `finally`, so a failing assertion still leaves
    the tree clean."""
    probe = APP_DIR / "financial_model" / "__guard_probe.py"
    probe.write_text(source, encoding="utf-8")
    try:
        return _offenders(finder, allowlist)
    finally:
        probe.unlink()


def test_the_guard_itself_detects_a_planted_attribute_read():
    """A guard nobody has watched fail is not a guard."""
    offenders = _probe_offenders(
        "x = inputs.conversion_costs.total_construction_sqm\n",
        _area_reads,
        AREA_ALLOWLIST,
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_guard_itself_detects_a_planted_getattr_read():
    """R9 fix wave: the dynamic spelling of the same read. The attribute walk
    alone is blind to it -- asserted directly below, so this proof cannot be
    satisfied by the pre-existing shape."""
    source = 'x = getattr(inputs.conversion_costs, "total_construction_sqm")\n'
    attr_only = _probe_offenders(
        source, lambda t: _attribute_reads(t, AREA_FIELD), AREA_ALLOWLIST
    )
    assert not any("__guard_probe.py" in o for o in attr_only), (
        "the attribute-only finder must NOT see the getattr shape -- if it does, "
        "this proof is testing the old rule, not the new one"
    )
    offenders = _probe_offenders(source, _area_reads, AREA_ALLOWLIST)
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_guard_itself_detects_a_planted_dict_key_read():
    """R9 fix wave: a dict-key read of a raw, still-unparsed snapshot."""
    source = 'x = snapshot["conversion_costs"]["total_construction_sqm"]\n'
    attr_only = _probe_offenders(
        source, lambda t: _attribute_reads(t, AREA_FIELD), AREA_ALLOWLIST
    )
    assert not any("__guard_probe.py" in o for o in attr_only), (
        "the attribute-only finder must NOT see the dict-key shape"
    )
    offenders = _probe_offenders(source, _area_reads, AREA_ALLOWLIST)
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_guard_does_not_flag_a_dict_literal_key():
    """The counter-example the dict-key shape needs: constructing a document
    with `{"total_construction_sqm": 0}` is a write, not a read, and migrate.py
    does exactly that. Flagging it would be the false positive that gets a guard
    weakened until it is useless."""
    offenders = _probe_offenders(
        'doc = {"conversion_costs": {"total_construction_sqm": 0}}\n',
        _area_reads,
        AREA_ALLOWLIST,
    )
    assert not any("__guard_probe.py" in o for o in offenders)


def test_the_guard_itself_detects_a_planted_tax_table_reference():
    """The tax half needs its own planted-violation proof -- it is a different
    node shape (Name/Attribute reference, not a field read)."""
    offenders = _probe_offenders(
        "from app.financial_model.acquisition_tax import TAX_TABLES\n"
        "x = TAX_TABLES[0]\n",
        lambda t: _name_references(t, TAX_SYMBOL),
        TAX_ALLOWLIST,
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_guard_itself_detects_a_planted_band_set_selection():
    """R9 fix wave: and so does the band-set selector -- a third symbol, needing
    its own planted violation. The TAX_TABLES finder must not see it, or this
    proof would be re-testing the existing rule."""
    source = (
        "from app.financial_model.acquisition_tax import select_band_set\n"
        'bands, _ = select_band_set("england_ni", "non_residential", None)\n'
    )
    tax_only = _probe_offenders(
        source, lambda t: _name_references(t, TAX_SYMBOL), TAX_ALLOWLIST
    )
    assert not any("__guard_probe.py" in o for o in tax_only), (
        "the TAX_TABLES finder must NOT see the select_band_set shape"
    )
    offenders = _probe_offenders(
        source, lambda t: _name_references(t, BAND_SELECTOR), BAND_SELECTOR_ALLOWLIST
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_contingency_guard_itself_detects_a_planted_attribute_read():
    """A guard nobody has watched fail is not a guard (R10 Task 9)."""
    offenders = _probe_offenders(
        "x = inputs.conversion_costs.contingency_pct\n",
        _contingency_reads,
        CONTINGENCY_ALLOWLIST,
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_contingency_guard_itself_detects_a_planted_getattr_read():
    source = 'x = getattr(inputs.conversion_costs, "contingency_pct")\n'
    attr_only = _probe_offenders(
        source, lambda t: _attribute_reads(t, CONTINGENCY_FIELD), CONTINGENCY_ALLOWLIST
    )
    assert not any("__guard_probe.py" in o for o in attr_only), (
        "the attribute-only finder must NOT see the getattr shape -- if it does, "
        "this proof is testing the old rule, not the new one"
    )
    offenders = _probe_offenders(source, _contingency_reads, CONTINGENCY_ALLOWLIST)
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_contingency_guard_itself_detects_a_planted_dict_key_read():
    source = 'x = snapshot["conversion_costs"]["contingency_pct"]\n'
    attr_only = _probe_offenders(
        source, lambda t: _attribute_reads(t, CONTINGENCY_FIELD), CONTINGENCY_ALLOWLIST
    )
    assert not any("__guard_probe.py" in o for o in attr_only), (
        "the attribute-only finder must NOT see the dict-key shape"
    )
    offenders = _probe_offenders(source, _contingency_reads, CONTINGENCY_ALLOWLIST)
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_contingency_guard_does_not_flag_a_dict_literal_key():
    """The counter-example the dict-key shape needs: constructing a document
    with `{"contingency_pct": 0}` is a write, not a read -- migrate.py's own
    default dict does exactly that (line 82)."""
    offenders = _probe_offenders(
        'doc = {"conversion_costs": {"contingency_pct": 0}}\n',
        _contingency_reads,
        CONTINGENCY_ALLOWLIST,
    )
    assert not any("__guard_probe.py" in o for o in offenders)
