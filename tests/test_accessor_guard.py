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
import re
from pathlib import Path
from typing import get_args

from app.financial_model.types import FlagCode

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
    # calculate_total_construction_cost -- compute_cost_plan's predecessor,
    # same reasoning as cost_plan_from_legacy_costs above, still the live cost
    # estimate migrate.py's v1->v2 bootstrap uses (there is no cost_plan yet
    # that early in the migration chain). R10 Task 9 fix round 1 (I3): split
    # out of schedule.py into its own module specifically so this allowlist
    # entry does not also un-guard schedule.py's build_schedule -- mirrors the
    # TS guard, which isolates the same calculator in
    # conversion-calc-engine.ts and leaves schedule.ts fully policed.
    "app/financial_model/legacy_costs.py",
    # The raw field's own negative-value validation (mirrors the
    # total_construction_sqm/manual-basis check immediately above it in
    # validation.py) -- validates the pre-v7/manual-basis raw input, which
    # still exists and is still user-editable until R10 Task 12 rebuilds the
    # cost page. TS's twin (model/validation.ts) is exempted at the call site
    # instead (eslint's file allowlist is per-rule, not per-selector); Python
    # has no line-scoped equivalent, so this is file-scoped -- but scoped to
    # THIS field's allowlist only, not the area/tax allowlists above.
    "app/financial_model/validation.py",
    # NOT allowlisted: migrate.py. It constructs a dict-literal default
    # ({"contingency_pct": 10.0}, an ast.Dict key, not a read) but has no
    # actual read of this field -- unlike total_construction_sqm, where
    # migrate.py genuinely does read the raw field to bootstrap v1 documents.
    # R10 Task 9 fix round 1 (I2): allowlisting it anyway was YAGNI; if a
    # future read needs it, the guard firing is the correct prompt to add it
    # back deliberately.
}


# R11 Task 7 (spec Sec 17.2 rule 1). `resolve_vat_treatment` is the ONLY
# function that may read `vat.treatments` or a `vat_override`; it applies the
# line-override-then-category precedence and keeps evidence_status a category
# fact. A second reader is a second implementation of that precedence, which is
# the R10 "two mechanisms for one fact" defect exactly.
#
# vat.py carries the resolver's own `vat.treatments` read AND compute_vat's
# four collect-and-forward `vat_override` reads, which hand the value straight
# to the resolver without interpreting it -- correct code the guard would
# otherwise fail on retroactively.
#
# validation.py joins it in R11 Task 9, for the same reason it is already in
# BAND_SELECTOR_ALLOWLIST and CONTINGENCY_ALLOWLIST above: its TS twin
# (model/validation.ts) exempts each individual structural read with its own
# `eslint-disable-next-line`, because a raw shape/bounds check is not a
# resolved charge and does not re-implement resolve_vat_treatment's
# override-over-category precedence -- but Python has no line-scoped
# equivalent, so the same narrow, legitimate use is exempted file-wide here
# instead.
VAT_TREATMENTS_FIELD = "treatments"
VAT_OVERRIDE_FIELD = "vat_override"
VAT_ACCESSOR_ALLOWLIST = {"app/financial_model/vat.py", "app/financial_model/validation.py"}

# R11 Task 7 (spec Sec 17.7). The Python half of the TS `ChargeableConsideration`
# brand. TypeScript makes `tsc` reject a raw purchase_price_pence at the tax
# boundary; Python has no nominal types, so the equivalent is this scan: every
# `consideration_pence=` keyword argument in app/ must be a CALL to
# chargeable_consideration_pence. calculate_acquisition_tax's parameter is
# keyword-only (acquisition_tax.py), so there is no positional spelling that
# could evade this.
#
# Ruling R29: the allowlist is EMPTY, and deliberately so. Task 7's brief
# named acquisition_tax.py (which declares the parameter) and vat.py (which owns
# the accessor), but neither file contains a `consideration_pence=` keyword at
# all -- declaring a parameter is an `arg` node and owning the accessor is a
# `FunctionDef`, so neither is a shape this finder can see. Allowlisting them
# would be YAGNI, and it would contradict this module's own recorded policy:
# CONTINGENCY_ALLOWLIST dropped migrate.py for exactly this reason, noting that
# "if a future read needs it, the guard firing is the correct prompt to add it
# back deliberately". Kept as a named empty set rather than inlined, so a future
# entry has an obvious and commented home.
CONSIDERATION_KEYWORD = "consideration_pence"
CONSIDERATION_ACCESSOR = "chargeable_consideration_pence"
CONSIDERATION_ALLOWLIST: set[str] = set()


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


def _vat_treatments_reads(tree: ast.AST) -> list[int]:
    """Every shape that is an actual read of `vat.treatments` -- the same three
    the cost-area finder checks (R11 spec Sec 17.2). A pydantic FIELD
    DECLARATION (`treatments: list[VatTreatment] = Field(...)`) is an AnnAssign,
    not an Attribute, and a keyword argument (`VatInputs(treatments=...)`) is an
    ast.keyword -- neither is a read, and neither is flagged, which is what
    keeps types.py off the allowlist."""
    return sorted(
        _attribute_reads(tree, VAT_TREATMENTS_FIELD)
        + _getattr_reads(tree, VAT_TREATMENTS_FIELD)
        + _subscript_reads(tree, VAT_TREATMENTS_FIELD)
    )


def _vat_override_reads(tree: ast.AST) -> list[int]:
    """Every shape that is an actual read of a `vat_override` (R11 spec
    Sec 17.2). Same three shapes, same declaration/write exclusions."""
    return sorted(
        _attribute_reads(tree, VAT_OVERRIDE_FIELD)
        + _getattr_reads(tree, VAT_OVERRIDE_FIELD)
        + _subscript_reads(tree, VAT_OVERRIDE_FIELD)
    )


def _called_name(func: ast.AST) -> str | None:
    """The bare name of a called function, whether written `f(...)` or
    `module.f(...)`. Anything else (a call on a subscript, a lambda) is not a
    shape this guard can decide, and it abstains rather than guesses."""
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _unguarded_considerations(tree: ast.AST) -> list[int]:
    """Line numbers of every ``consideration_pence=<x>`` keyword argument whose
    value is NOT a call to ``chargeable_consideration_pence`` (R11 spec
    Sec 17.7).

    This is the Python half of the TS branded type. An intermediate variable
    does not launder it here either: a bare Name is not an ast.Call, so
    ``consideration_pence=price`` is flagged exactly as
    ``consideration_pence=acq.purchase_price_pence`` is."""
    lines = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        for kw in node.keywords:
            if kw.arg != CONSIDERATION_KEYWORD:
                continue
            value = kw.value
            if (
                isinstance(value, ast.Call)
                and _called_name(value.func) == CONSIDERATION_ACCESSOR
            ):
                continue
            lines.append(kw.value.lineno)
    return sorted(lines)


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


def test_no_unauthorised_reader_of_the_vat_treatments():
    """R11 spec Sec 17.2 rule 1. resolve_vat_treatment is the only function that
    may read vat.treatments -- it applies the line-override-then-category
    precedence and the not-registered inert case. A second reader is a second
    implementation of that precedence."""
    offenders = _offenders(_vat_treatments_reads, VAT_ACCESSOR_ALLOWLIST)
    assert offenders == [], (
        "These files read vat.treatments directly instead of calling "
        "resolve_vat_treatment() from app/financial_model/vat.py:\n  "
        + "\n  ".join(offenders)
    )


def test_no_unauthorised_reader_of_a_vat_override():
    """The other half of Sec 17.2 rule 1: the per-line override. Reading it
    outside the resolver is how the override-over-category precedence gets
    re-implemented."""
    offenders = _offenders(_vat_override_reads, VAT_ACCESSOR_ALLOWLIST)
    assert offenders == [], (
        "These files read a vat_override directly instead of passing it to "
        "resolve_vat_treatment() from app/financial_model/vat.py:\n  "
        + "\n  ".join(offenders)
    )


def test_vat_accessor_allowlist_pins_exactly_these_two_files():
    """Fix round 1, minor 1. TypeScript's twin allowlist (eslint.config.js) is
    pinned by exact equality ("pins the allowlist array to EXACTLY these
    files", accessor-guard.test.ts) precisely because R10 found that widening
    it un-guarded three unrelated fields, and only exact equality -- not
    membership -- catches a widening. Python's three allowlists (this one,
    BAND_SELECTOR_ALLOWLIST and CONTINGENCY_ALLOWLIST below) had no equivalent
    pin; a future third file added to any of them would pass every test above
    silently. This is the same guard, applied to the same set."""
    assert VAT_ACCESSOR_ALLOWLIST == {
        "app/financial_model/vat.py",
        "app/financial_model/validation.py",
    }


def test_band_selector_allowlist_pins_exactly_these_two_files():
    """See test_vat_accessor_allowlist_pins_exactly_these_two_files above."""
    assert BAND_SELECTOR_ALLOWLIST == {
        "app/financial_model/acquisition_tax.py",
        "app/financial_model/validation.py",
    }


def test_contingency_allowlist_pins_exactly_these_three_files():
    """See test_vat_accessor_allowlist_pins_exactly_these_two_files above."""
    assert CONTINGENCY_ALLOWLIST == {
        "app/financial_model/types.py",
        "app/financial_model/legacy_costs.py",
        "app/financial_model/validation.py",
    }


def test_the_vat_guard_does_not_flag_a_pydantic_field_declaration():
    """types.py DECLARES both fields and CONSTRUCTS the default block
    (`VatInputs(treatments=default_vat_treatments())`). Neither is a read: an
    annotated assignment is an AnnAssign and a keyword argument is an
    ast.keyword, and flagging either would be the false positive that gets a
    guard weakened until it is useless. This is why types.py is NOT on the
    allowlist -- it does not need to be."""
    flagged = {
        o.split(":", 1)[0]
        for o in _offenders(_vat_treatments_reads, VAT_ACCESSOR_ALLOWLIST)
        + _offenders(_vat_override_reads, VAT_ACCESSOR_ALLOWLIST)
    }
    assert "app/financial_model/types.py" not in flagged


def test_every_acquisition_tax_base_is_the_chargeable_consideration():
    """R11 spec Sec 17.7. SDLT, LBTT and LTT are all charged on the
    VAT-INCLUSIVE consideration, and every pre-R11 call site passed
    acquisition.purchase_price_pence straight in -- under-reporting a PERMANENT
    cost, not a timing one.

    The TS engine makes this a `tsc` error via the branded ChargeableConsideration
    type. Python has no equivalent, so this scan is the guard: every
    `consideration_pence=` keyword argument must be a CALL to the accessor.
    purchase_price_pence has 10 legitimate readers in this package, so the guard
    restricts the USE, not the field."""
    offenders = _offenders(_unguarded_considerations, CONSIDERATION_ALLOWLIST)
    assert offenders == [], (
        "These acquisition-tax call sites are charged on something other than "
        "chargeable_consideration_pence(inputs) from app/financial_model/vat.py "
        "(spec Sec 17.7 -- the tax base is the VAT-INCLUSIVE consideration):\n  "
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


def test_the_vat_treatments_guard_itself_detects_a_planted_attribute_read():
    """A guard nobody has watched fail is not a guard (R11 spec Sec 17.2)."""
    offenders = _probe_offenders(
        "x = inputs.vat.treatments\n", _vat_treatments_reads, VAT_ACCESSOR_ALLOWLIST,
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_vat_treatments_guard_itself_detects_planted_getattr_and_dict_reads():
    for source in (
        'x = getattr(inputs.vat, "treatments")\n',
        'x = snapshot["vat"]["treatments"]\n',
    ):
        attr_only = _probe_offenders(
            source,
            lambda t: _attribute_reads(t, VAT_TREATMENTS_FIELD),
            VAT_ACCESSOR_ALLOWLIST,
        )
        assert not any("__guard_probe.py" in o for o in attr_only), (
            "the attribute-only finder must NOT see " + source.strip()
        )
        offenders = _probe_offenders(
            source, _vat_treatments_reads, VAT_ACCESSOR_ALLOWLIST,
        )
        assert any("__guard_probe.py" in o for o in offenders)


def test_the_vat_override_guard_itself_detects_a_planted_attribute_read():
    offenders = _probe_offenders(
        "x = package.vat_override\n", _vat_override_reads, VAT_ACCESSOR_ALLOWLIST,
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_vat_guard_does_not_flag_a_dict_literal_key():
    """The counter-example both dict-key shapes need: constructing a block with
    `{"treatments": [], "vat_override": None}` is a write, not a read."""
    offenders = _probe_offenders(
        'doc = {"vat": {"treatments": []}, "package": {"vat_override": None}}\n',
        lambda t: _vat_treatments_reads(t) + _vat_override_reads(t),
        VAT_ACCESSOR_ALLOWLIST,
    )
    assert not any("__guard_probe.py" in o for o in offenders)


def test_the_consideration_guard_itself_detects_a_planted_raw_price():
    """The exact reversion the guard exists to catch: an acquisition-tax call
    charged on the VAT-exclusive price (R11 spec Sec 17.7)."""
    offenders = _probe_offenders(
        "t = calculate_acquisition_tax(\n"
        "    consideration_pence=acq.purchase_price_pence,\n"
        '    jurisdiction="england_ni", basis="non_residential", date=None,\n'
        ")\n",
        _unguarded_considerations,
        CONSIDERATION_ALLOWLIST,
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_consideration_guard_is_not_laundered_by_an_intermediate_variable():
    """deal-spider.ts passed the price through an intermediate `price` variable,
    which is why the TS guard is a branded type and not a shape-based lint
    selector. The Python scan must not be fooled by the same shape: a bare Name
    is not an ast.Call, so it is flagged."""
    offenders = _probe_offenders(
        "price = acq.purchase_price_pence\n"
        "t = calculate_acquisition_tax(consideration_pence=price)\n",
        _unguarded_considerations,
        CONSIDERATION_ALLOWLIST,
    )
    assert any("__guard_probe.py" in o for o in offenders)


def test_the_consideration_guard_accepts_the_accessor_call():
    """The counter-example: the correct spelling must lint clean, or the guard
    would be unsatisfiable and would simply be switched off. Both the bare and
    the module-qualified call are accepted."""
    for source in (
        "t = calculate_acquisition_tax(\n"
        "    consideration_pence=chargeable_consideration_pence(inputs),\n"
        ")\n",
        "t = calculate_acquisition_tax(\n"
        "    consideration_pence=vat.chargeable_consideration_pence(inputs),\n"
        ")\n",
    ):
        offenders = _probe_offenders(
            source, _unguarded_considerations, CONSIDERATION_ALLOWLIST,
        )
        assert not any("__guard_probe.py" in o for o in offenders), source


# ---------------------------------------------------------------------------
# Ruling R26 -- FlagCode parity across the two engines.
#
# Task 6 added 'vat_funding_gap' to the TypeScript FlagCode union and NOT to the
# Python Literal. Nothing failed: ModelFlag.code is a plain `str`, and the
# Python FlagCode has no consumer at all -- it is documentation until something
# reads it. The omission was caught by review, not by a test, and nothing
# prevented the next release repeating it exactly. This is that something.
# ---------------------------------------------------------------------------

FLAG_CODE_TS = (
    Path(__file__).resolve().parents[1]
    / "frontend" / "src" / "lib" / "model" / "finance-types.ts"
)


def _ts_flag_codes() -> set[str]:
    """The members of the TypeScript `FlagCode` union.

    Comments are stripped BEFORE the string literals are extracted: the union's
    own doc comment contains an apostrophe ("a month's VAT"), which a naive
    quote-pair scan would read as the start of a member."""
    source = FLAG_CODE_TS.read_text(encoding="utf-8")
    start = source.index("export type FlagCode =")
    end = source.index(";", start)
    body = source[start:end]
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    body = re.sub(r"//[^\n]*", "", body)
    return set(re.findall(r"'([a-z_]+)'", body))


def _flag_code_drift(ts: set[str], py: set[str]) -> str | None:
    """None when the two engines agree; otherwise a report naming which members
    are missing from WHICH side. A parity failure that does not say which side
    is short is a puzzle, not a report."""
    if ts == py:
        return None
    return (
        "FlagCode has drifted between the engines.\n"
        f"  missing from Python (app/financial_model/types.py): {sorted(ts - py)}\n"
        "  missing from TypeScript (frontend/src/lib/model/finance-types.ts): "
        f"{sorted(py - ts)}"
    )


def test_the_flag_code_union_is_identical_in_both_engines():
    """Ruling R26. The two engines must agree on the vocabulary of flags they
    can emit, or one of them can produce a code the other's type says is
    impossible -- silently, because ModelFlag.code is a plain str on both
    sides."""
    ts = _ts_flag_codes()
    py = set(get_args(FlagCode))
    assert ts, "parsed no members out of the TypeScript FlagCode union"
    drift = _flag_code_drift(ts, py)
    assert drift is None, drift


def test_the_flag_code_parity_guard_names_the_side_that_is_short():
    """Watch it fail, in both directions. A parity test that passes when the two
    lists differ is worse than none; one that fails without naming the member is
    a puzzle. Planted against the REAL parsed sets, so it cannot pass by
    comparing two hand-written constants."""
    ts = _ts_flag_codes()
    py = set(get_args(FlagCode))
    victim = "vat_funding_gap"
    assert victim in ts and victim in py, (
        "the planted victim must exist on both sides before it is removed"
    )

    dropped_from_python = _flag_code_drift(ts, py - {victim})
    assert dropped_from_python is not None
    assert f"missing from Python (app/financial_model/types.py): ['{victim}']" in dropped_from_python

    dropped_from_ts = _flag_code_drift(ts - {victim}, py)
    assert dropped_from_ts is not None
    assert f"finance-types.ts): ['{victim}']" in dropped_from_ts
