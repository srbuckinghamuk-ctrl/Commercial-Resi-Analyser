"""R11 (spec Sec 17.11) -- the inputs v7 -> v8 migration, and the VAT block.

Python twin of the `migrateV7toV8` / `migrateInputsToV8 refusals` /
`migrateInputsToV8 merge-onto-defaults branch` describe blocks in
frontend/src/lib/model/migrate.test.ts, and of the v8 identity gate in
frontend/src/lib/model/golden-fixtures.test.ts.
"""
import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import parse_calculator_inputs, run_appraisal, validate_inputs
from app.financial_model.migrate import (
    _v8_cost_plan,
    is_v2_or_later,
    is_v7,
    is_v8,
    migrate_inputs_to_v7,
    migrate_inputs_to_v8,
    migrate_v7_to_v8,
)
from app.financial_model.types import (
    DEFAULT_VAT,
    VAT_CHARGE_CATEGORIES,
    CalculatorInputsV7,
    CalculatorInputsV8,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


@pytest.fixture
def v1_doc():
    return {"inputs_version": 1}


def _v7(v1_doc):
    return migrate_inputs_to_v7(v1_doc)


# ---------------------------------------------------------------------------
# migrate_v7_to_v8 -- the write itself
# ---------------------------------------------------------------------------

def test_v7_to_v8_stamps_inputs_version_8(v1_doc):
    assert migrate_v7_to_v8(_v7(v1_doc)).inputs_version == 8


def test_v7_to_v8_writes_an_inert_vat_block_so_no_existing_appraisal_moves(v1_doc):
    """Spec Sec 17.11's write, field for field. `registered: false` is what makes
    the whole migration inert: it drives resolve_vat_treatment to INERT and
    chargeable_consideration_pence back to the exclusive price."""
    v8 = migrate_v7_to_v8(_v7(v1_doc))
    assert v8.vat.registered is False
    assert [t.category for t in v8.vat.treatments] == list(VAT_CHARGE_CATEGORIES)
    assert len(v8.vat.treatments) == 6
    assert all(t.rate_pct == 0 and t.recoverable_pct == 0 for t in v8.vat.treatments)
    assert all(t.recovery_basis == "unconfirmed" for t in v8.vat.treatments)
    assert all(t.evidence_status == "unconfirmed" for t in v8.vat.treatments)
    assert v8.vat.purchase.vendor_opted_to_tax is False
    assert v8.vat.purchase.togc_treatment == "unconfirmed"
    assert v8.vat.purchase.evidence_status == "unconfirmed"


def test_the_migration_and_default_vat_write_the_same_block(v1_doc):
    """conversion-defaults.ts:365 claims the two engines' v-defaults re-converge,
    and Sec 17.11 makes DEFAULT_VAT == the migration's write a requirement rather
    than a tidiness. `migrate_inputs_to_v8({})` is the Python side of that claim
    (test_cost_plan.py's `_default_v7()` is the v7 precedent)."""
    assert migrate_v7_to_v8(_v7(v1_doc)).vat.model_dump() == DEFAULT_VAT.model_dump()
    assert migrate_inputs_to_v8({}).vat.model_dump() == DEFAULT_VAT.model_dump()


#: A non-null override, for the non-vacuity halves below. `CostPackage` and
#: `FeeLine` are SHARED between V7 and V8, so a v7-tagged document really can
#: carry one -- which is what makes migrate_v7_to_v8's null-ing branch live code
#: rather than a formality.
_STRAY_OVERRIDE = {"rate_pct": 20.0, "recoverable_pct": 100.0,
                   "recovery_basis": "zero_rated_sale"}


def _detailed_v7(v1_doc) -> dict:
    """A v7 document carrying exactly the shapes R10 persisted: contingency rows
    still holding the two fields Sec 17.8 deletes, plus -- on one package and one
    fee line -- a NON-NULL `vat_override`.

    The override is the load-bearing detail. Fix round 2, Important 3: this
    helper originally built packages with no `vat_override` key at all, so
    `all(p.vat_override is None)` after migration was satisfied by the FIELD
    DEFAULT and held with `_v8_cost_plan` bypassed entirely -- the provably-blind
    gate Sec 17.11 cites R9 for. The TS twin (migrate.test.ts) always set one;
    Python now matches it.
    """
    saved = _v7(v1_doc).model_dump(mode="json")
    saved["cost_plan"]["mode"] = "detailed"
    saved["cost_plan"]["packages"] = [
        {
            "id": "p1", "code": "structure", "label": "Structure",
            "amount_pence": 1_000_000, "contingency_class": "general",
            "lender_eligible": True, "notes": "",
            "vat_override": dict(_STRAY_OVERRIDE),
        },
        {
            "id": "p2", "code": "mech_elec_public_health", "label": "M&E",
            "amount_pence": 2_000_000, "contingency_class": "abnormal",
            "lender_eligible": True, "notes": "",
        },
    ]
    saved["cost_plan"]["fee_lines"][0]["vat_override"] = dict(_STRAY_OVERRIDE)
    for row in saved["cost_plan"]["contingency"]:
        row["basis"] = "whole_build"
        row["package_ids"] = ["p1"]
    return saved


def test_v7_to_v8_nulls_every_line_override_and_drops_the_deleted_contingency_fields(
    v1_doc,
):
    """Fix round 2, Important 3. Both halves of this test were previously
    VACUOUS in Python, and the review proved it rather than inferring it:

    - the override half passed on the FIELD DEFAULT, because the source rows
      carried no `vat_override` key at all;
    - the contingency half asserted against `model_dump()`, and `Model` uses
      pydantic's default `extra="ignore"`, so `basis` / `package_ids` are
      dropped by VALIDATION regardless of what `_v8_cost_plan` does.

    Both now bite: the source carries a real override (asserted non-None
    BEFORE migrating), and the contingency assertion runs against the
    PRE-VALIDATION dict `_v8_cost_plan` produces.
    """
    source = _detailed_v7(v1_doc)

    # Non-vacuity, asserted before the migration runs: the input really does
    # carry the overrides whose removal is under test.
    assert source["cost_plan"]["packages"][0]["vat_override"] is not None
    assert source["cost_plan"]["fee_lines"][0]["vat_override"] is not None
    assert all("basis" in row for row in source["cost_plan"]["contingency"])
    assert all("package_ids" in row for row in source["cost_plan"]["contingency"])

    # The contingency half, against the PRE-VALIDATION dict. `extra="ignore"`
    # means model_dump() would drop these keys even if _v8_cost_plan never
    # touched them, so this is the only assertion that can actually fail.
    rebuilt = _v8_cost_plan(source["cost_plan"])
    assert len(rebuilt["contingency"]) == 3
    for row in rebuilt["contingency"]:
        assert "basis" not in row, row
        assert "package_ids" not in row, row
    assert all(p["vat_override"] is None for p in rebuilt["packages"])
    assert all(f["vat_override"] is None for f in rebuilt["fee_lines"])

    v8 = migrate_v7_to_v8(source)

    assert len(v8.cost_plan.packages) == 2
    assert all(p.vat_override is None for p in v8.cost_plan.packages)
    assert len(v8.cost_plan.fee_lines) == 8
    assert all(f.vat_override is None for f in v8.cost_plan.fee_lines)
    assert len(v8.cost_plan.contingency) == 3

    # The surviving mechanism -- the package's own tag -- is retained.
    assert [p.contingency_class for p in v8.cost_plan.packages] == ["general", "abnormal"]
    assert [c.name for c in v8.cost_plan.contingency] == [
        "general", "existing_building", "abnormal",
    ]


def test_v7_to_v8_keeps_a_vat_block_the_document_already_carries(v1_doc):
    """Fix round 2, Minor 10. migrate_v7_to_v8 mirrors migrate_v6_to_v7's
    `existing_plan`: a block already on the document is KEPT rather than
    overwritten, so a mistagged row does not lose data here.

    That branch bypasses the inert write the identity gate assumes, so it needs
    its own test -- a v7-tagged document carrying a stray, LIVE `vat` block must
    come through with that block intact, not silently reset to DEFAULT_VAT.
    (The document is still refused as v8 by is_v8, which gates on the container:
    see test_is_v8_gates_on_the_container_never_on_the_block.)"""
    source = _v7(v1_doc).model_dump(mode="json")
    stray = DEFAULT_VAT.model_dump(mode="json")
    stray["registered"] = True
    stray["return_frequency"] = "monthly"
    stray["treatments"][1]["rate_pct"] = 20.0
    source["vat"] = stray

    v8 = migrate_v7_to_v8(source)

    assert v8.vat.registered is True
    assert v8.vat.return_frequency == "monthly"
    assert v8.vat.treatments[1].rate_pct == 20.0
    # Non-vacuity: this is NOT what the inert default would have produced.
    assert v8.vat.model_dump() != DEFAULT_VAT.model_dump()


def test_v7_to_v8_refuses_to_double_migrate(v1_doc):
    v8 = migrate_v7_to_v8(_v7(v1_doc))
    with pytest.raises(ValueError, match="already a v8 document"):
        migrate_v7_to_v8(v8)
    # And via the dict path, which takes the other guard branch.
    with pytest.raises(ValueError, match="already a v8 document"):
        migrate_v7_to_v8(v8.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# migrate_inputs_to_v8 -- the two refusals (R8's carry-forward guard)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("version", [9, 99])
def test_unrecognised_inputs_version_is_refused_not_routed_to_the_v1_fallback(version):
    """R8's silent-corruption bug, guarded forward. The version tested is 9 --
    the NEIGHBOUR of the recognised set -- deliberately: R10 shipped a predicate
    loosened from `== 6` to `!= 5`, the literal negation of its own set, which
    could never fail. Only a document tagged one past the top catches that shape.

    The match string names migrate_inputs_to_v8 specifically: a v8 predicate that
    never fires falls through to migrate_v7_to_v8(migrate_inputs_to_v7(...)), and
    migrate_inputs_to_v7's OWN refusal would then raise a message a bare
    /unrecognised inputs_version/ would happily accept."""
    with pytest.raises(
        ValueError, match=f"migrate_inputs_to_v8: unrecognised inputs_version {version}",
    ):
        migrate_inputs_to_v8({"inputs_version": version})


def test_document_tagged_v8_that_fails_the_structural_check_is_refused():
    with pytest.raises(ValueError, match="fails the v8 structural check"):
        migrate_inputs_to_v8({"inputs_version": 8, "finance": "not a dict"})


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_any_earlier_version_normalises_to_v8(version):
    # Stops at 4 for the same reason test_migrate_v7's twin does: a bare
    # {"inputs_version": 5} declares v5 without being structurally v5, and that
    # shape is deliberately refused rather than routed to the v1 fallback.
    v8 = migrate_inputs_to_v8({"inputs_version": version})
    assert v8.inputs_version == 8
    assert v8.vat.registered is False
    assert len(v8.vat.treatments) == 6


def test_a_real_v7_document_normalises_to_v8(v1_doc):
    v8 = migrate_inputs_to_v8(_v7(v1_doc).model_dump(mode="json"))
    assert v8.inputs_version == 8
    assert v8.cost_plan.mode == "headline"
    assert len(v8.vat.treatments) == 6


# ---------------------------------------------------------------------------
# migrate_inputs_to_v8 -- the merge-onto-defaults branch
# ---------------------------------------------------------------------------

def test_already_v8_document_is_merged_onto_defaults_not_re_migrated(v1_doc):
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    saved["project_id"] = "kept"
    assert migrate_inputs_to_v8(saved).project_id == "kept"


def test_v8_merge_branch_deep_merges_a_saved_vat_block_onto_defaults(v1_doc):
    """R10 found a `cost_plan` deep-merge on this path that nobody had ever
    deleted to check; without it a stored row computed ZERO contingency. The
    `vat` line added by Sec 17.11 carries the identical risk and gets the
    identical check.

    Deleting `"vat": {**defaults["vat"], **(snapshot.get("vat") or {})}` from
    migrate_inputs_to_v8 was confirmed to fail this test -- see
    task-10-report.md for the observed output.

    `VatInputs.treatments` defaults to an EMPTY list, so a stored row that
    predates the field (or, as here, one that carries only the flag the user
    toggled) would come back registered but pricing nothing at all."""
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    saved["vat"] = {"registered": True}

    merged = migrate_inputs_to_v8(saved)

    assert merged.vat.registered is True
    assert len(merged.vat.treatments) == 6
    assert [t.category for t in merged.vat.treatments] == list(VAT_CHARGE_CATEGORIES)


def test_v8_merge_branch_default_fills_a_row_that_predates_a_schema_field(v1_doc):
    """Mirrors test_migrate_v7.py's twin, one version on, with `vat` added to the
    list of blocks a stored row may be missing entirely."""
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    del saved["deal_spider"]["weights"]
    del saved["scenarios"]["upside"]
    del saved["areas"]["external_amenity_sqm"]
    del saved["cost_plan"]["contingency"]
    del saved["vat"]["treatments"]

    again = migrate_inputs_to_v8(saved)

    assert again.inputs_version == 8
    assert len(again.deal_spider.weights) == 9
    assert again.scenarios.upside.label == "Upside"
    assert again.areas.external_amenity_sqm == 0.0
    assert [c.name for c in again.cost_plan.contingency] == [
        "general", "existing_building", "abnormal",
    ]
    assert len(again.vat.treatments) == 6


def test_v8_merge_branch_preserves_a_populated_vat_block(v1_doc):
    saved = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    saved["vat"]["registered"] = True
    saved["vat"]["return_frequency"] = "monthly"
    saved["vat"]["treatments"][1]["rate_pct"] = 20.0
    saved["vat"]["treatments"][1]["recoverable_pct"] = 100.0
    saved["vat"]["purchase"]["vendor_opted_to_tax"] = True

    again = migrate_inputs_to_v8(saved)

    assert again.vat.registered is True
    assert again.vat.return_frequency == "monthly"
    assert again.vat.treatments[1].rate_pct == 20.0
    assert again.vat.treatments[1].recoverable_pct == 100.0
    assert again.vat.purchase.vendor_opted_to_tax is True


def test_v8_merge_branch_preserves_a_populated_cost_plan(v1_doc):
    saved = migrate_v7_to_v8(_detailed_v7(v1_doc)).model_dump(mode="json")

    again = migrate_inputs_to_v8(saved)

    assert again.cost_plan.mode == "detailed"
    assert again.cost_plan.packages[0].amount_pence == 1_000_000
    assert all(p.vat_override is None for p in again.cost_plan.packages)


# ---------------------------------------------------------------------------
# Container-level typing (spec Sec 17.11) and the parser (ruling R10)
# ---------------------------------------------------------------------------

def test_is_v8_gates_on_the_container_never_on_the_block(v1_doc):
    """`revalidate_instances='never'` lets a CalculatorInputsV7 hold a v8
    sub-block, so "has a vat key" answers a different question from "is a v8
    document" -- and the two engines would then disagree about the same row."""
    v8 = migrate_v7_to_v8(_v7(v1_doc))
    assert is_v8(v8.model_dump(mode="json")) is True
    assert is_v8(_v7(v1_doc).model_dump(mode="json")) is False
    # A v7 document that has somehow acquired a vat block is still NOT v8.
    mistagged = _v7(v1_doc).model_dump(mode="json")
    mistagged["vat"] = DEFAULT_VAT.model_dump(mode="json")
    assert is_v8(mistagged) is False
    assert is_v7(mistagged) is True
    assert isinstance(v8, CalculatorInputsV8)
    # The subclass relationship is load-bearing: a flat re-declaration would make
    # every `isinstance(x, CalculatorInputsV7)` check in the engine silently
    # False for a v8 document.
    assert isinstance(v8, CalculatorInputsV7)


def test_is_v2_or_later_recognises_a_v8_document(v1_doc):
    """The boundary just moved to v8 (app.py): a v8 raw payload must not be
    misclassified as a v1 document -- that would tag a fully-migrated v8
    appraisal 'legacy_unreconciled'."""
    v8 = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    assert is_v2_or_later(v8) is True


def test_parse_dispatches_on_version_8(v1_doc):
    """Ruling R10. parse_calculator_inputs dispatches on inputs_version and had
    no `== 8` branch, so a v8 document fell through to the CalculatorInputsV2
    default -- silently dropping the VAT block and every other post-v2 field.
    That is R8's silent-corruption class of defect, which returned 201 while
    dropping a confirmed equity source."""
    doc = migrate_v7_to_v8(_v7(v1_doc)).model_dump(mode="json")
    parsed = parse_calculator_inputs(doc)
    assert parsed.inputs_version == 8
    assert type(parsed) is CalculatorInputsV8
    assert len(parsed.vat.treatments) == 6
    assert [t.category for t in parsed.vat.treatments] == list(VAT_CHARGE_CATEGORIES)
    # And the rest of the post-v2 surface survives the round trip.
    assert parsed.cost_plan.mode == "headline"


# ---------------------------------------------------------------------------
# The corpus-wide acceptance gate. Mirrors test_migrate_v7.py's
# test_v7_migration_moves_no_existing_figure and golden-fixtures.test.ts's
# 'migrating %s to v8 moves no computed figure, and writes the specified block'.
#
# R9 recorded that a gate of this shape can be PROVABLY BLIND where the
# migration synthesises a block no engine consumes. Here the numeric half IS
# meaningful -- the VAT engine is live and reads `vat.registered` -- but it
# still cannot tell a block written CORRECTLY from one written merely
# harmlessly, so the structural half asserts Sec 17.11's write directly.
# ---------------------------------------------------------------------------

def _pipeline_fixtures():
    for path in sorted(FIXTURES.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        if doc.get("kind") == "sensitivity":
            continue  # names a base_fixture instead of carrying inputs
        yield path.name, doc


def _assert_structural_write(migrated, name: str):
    assert migrated.inputs_version == 8, name
    assert migrated.vat.registered is False, f"{name}: migration wrote a LIVE VAT block"
    assert [t.category for t in migrated.vat.treatments] == list(VAT_CHARGE_CATEGORIES), name
    assert len(migrated.vat.treatments) == 6, name
    for t in migrated.vat.treatments:
        assert t.rate_pct == 0, name
        assert t.recoverable_pct == 0, name
        assert t.recovery_basis == "unconfirmed", name
        assert t.evidence_status == "unconfirmed", name
    assert migrated.vat.purchase.vendor_opted_to_tax is False, name
    assert migrated.vat.purchase.togc_treatment == "unconfirmed", name
    for p in migrated.cost_plan.packages:
        assert p.vat_override is None, f"{name}: package {p.id} kept a vat_override"
    for f in migrated.cost_plan.fee_lines:
        assert f.vat_override is None, f"{name}: fee line {f.id} kept a vat_override"
    for row in migrated.cost_plan.model_dump()["contingency"]:
        assert "basis" not in row, name
        assert "package_ids" not in row, name


def test_v8_migration_moves_no_existing_figure():
    """The acceptance gate for R11's migration: every fixture in the corpus, run
    before and after migration to v8, must produce identical output -- AND carry
    the block Sec 17.11 specifies."""
    names = []
    for name, doc in _pipeline_fixtures():
        names.append(name)
        migrated = migrate_inputs_to_v8(doc["inputs"])

        _assert_structural_write(migrated, name)

        before = run_appraisal(parse_calculator_inputs(doc["inputs"]))
        after = run_appraisal(migrated)
        # asdict, not model_dump: AppraisalResultV2 is a dataclass on the
        # Python side, not a Pydantic model.
        assert asdict(before.metrics) == asdict(after.metrics), (
            f"{name}: migration to v8 changed a computed figure"
        )
        assert asdict(before.model) == asdict(after.model), (
            f"{name}: migration to v8 changed a ledger figure"
        )
        assert asdict(before.schedule) == asdict(after.schedule), (
            f"{name}: migration to v8 changed a schedule figure"
        )
    # The corpus is loaded by directory scan, so an empty glob would make the
    # loop above vacuously pass.
    assert len(names) == 12, names


# ---------------------------------------------------------------------------
# Ruling R38 (spec Sec 17.11, "The migration must add no validation issue
# either"). Twin of golden-fixtures.test.ts's 'migrating %s to v8 adds and
# removes no validation issue'.
#
# The numeric gate above could never have caught R38's defect, because the
# figures genuinely did not move: the migration wrote `first_period_end_month:
# 2` onto every document while `registered: false` kept the engine dormant, so
# no number changed -- and yet every stored appraisal with `term_months <= 2`
# acquired a HARD ERROR, which makes report_safe false and marks the report
# DRAFT. An "inert" migration would have silently downgraded them all.
#
# The assertion is deliberately "the SAME issues", not "no errors": a document
# that was already invalid must stay invalid in the same way. That is what
# generalises past the specific bug.
#
# ONE exemption, and it is named rather than absorbed into a loose comparison.
# Sec 17.9 SPECIFIES a warning for "`registered: false` with a non-zero
# construction cost -- the engine is inert and the funding need is being
# reported as zero". A pre-v8 document has no `vat` block and therefore no VAT
# issue at all, so that warning can only ever appear AFTER migration. It is
# unavoidable by construction and it is the correct disclosure: this document
# has construction cost and no VAT modelled.
#
# The exemption is confined to WARNINGS on that one field, because severity is
# what carries the consequence R38 is about: an ERROR makes report_safe false
# and marks the report DRAFT; a warning is a disclosure and does not. So the
# ERROR set is compared with no exemption whatsoever, and no issue of either
# severity may be REMOVED.
# ---------------------------------------------------------------------------

def _issue_keys(issues) -> list[tuple[str, str, str]]:
    return sorted((i.severity, i.field, i.message) for i in issues)


#: Sec 17.9's inert-engine disclosure, pinned as the WHOLE issue triple rather
#: than a (severity, field) pair. Keying on the pair and probing with `any`
#: would swallow a SECOND, different warning on `vat.registered` -- the
#: exemption has to name one message, not a field. An ERROR on `vat.registered`
#: (the purchase-VAT-chargeable rule) is not exempt either way.
_MIGRATION_DISCLOSURE = (
    "warning",
    "vat.registered",
    "The VAT engine is switched off (vat.registered: false), but this document has a "
    "non-zero construction cost. Input VAT on construction and fees will be reported as "
    "zero throughout, including any that would otherwise be recoverable.",
)


def _assert_issue_sets_agree(before, after, name: str) -> list:
    """Returns the exempted additions, so callers can assert non-vacuity."""
    added = [i for i in after if i not in before]
    removed = [i for i in before if i not in after]

    assert removed == [], (
        f"{name}: migration to v8 REMOVED a validation issue -- a document that was "
        f"already invalid must stay invalid in the same way\n  removed: {removed}"
    )

    errors_before = [i for i in before if i[0] == "error"]
    errors_after = [i for i in after if i[0] == "error"]
    assert errors_before == errors_after, (
        f"{name}: migration to v8 changed the ERROR set. An error makes report_safe "
        f"false and marks the report DRAFT (ruling R38)\n"
        f"  added:   {[i for i in errors_after if i not in errors_before]}\n"
        f"  removed: {[i for i in errors_before if i not in errors_after]}"
    )

    unexpected = [i for i in added if i != _MIGRATION_DISCLOSURE]
    assert unexpected == [], (
        f"{name}: migration to v8 added a validation issue other than Sec 17.9's "
        f"inert-engine disclosure\n  added: {unexpected}"
    )

    exempted = [i for i in added if i == _MIGRATION_DISCLOSURE]
    assert len(exempted) <= 1, (
        f"{name}: the Sec 17.9 exemption covers at most ONE issue, got {exempted}"
    )
    return exempted


def test_v8_migration_adds_and_removes_no_validation_issue():
    names = []
    disclosed = 0
    for name, doc in _pipeline_fixtures():
        names.append(name)
        before = _issue_keys(validate_inputs(parse_calculator_inputs(doc["inputs"])))
        migrated = migrate_inputs_to_v8(doc["inputs"])
        after = _issue_keys(validate_inputs(migrated))
        exempted = _assert_issue_sets_agree(before, after, name)

        # Cross-check the exemption against Sec 17.9's own condition rather than
        # trusting it: the disclosure must appear exactly where a non-zero
        # construction cost makes it true, and nowhere else.
        got_disclosure = len(exempted) == 1
        has_construction = migrated.conversion_costs.total_construction_sqm > 0
        assert got_disclosure == has_construction, (
            f"{name}: Sec 17.9's inert-engine disclosure fired={got_disclosure} but the "
            f"document's construction cost is non-zero={has_construction}"
        )
        disclosed += int(got_disclosure)

    assert len(names) == 12, names
    # Non-vacuity: the exemption is exercised, so this test is not silently
    # asserting an empty carve-out.
    assert disclosed > 0


@pytest.mark.parametrize("term_months", [1, 2])
def test_v8_migration_adds_no_validation_issue_to_a_short_term_document(term_months):
    """The synthetic case the fixture corpus does not contain, and the exact
    shape R38 was written for: `first_period_end_month` defaults to 2, so a
    short term is the document where an ungated return-cycle bound fires.

    BOTH terms, per spec Sec 17.11 (R39). Term 2 is the `>=`-versus-`>`
    boundary: the migration writes `first_period_end_month: 2`, so a rule
    re-weakened to `> term_months`, or a gate re-narrowed to something like
    `registered or term_months >= 2`, FAILS at term 2 and PASSES at term 1. A
    term-1-only case would let either regression back in.

    Un-gating the rule in validation.py was confirmed to fail this test naming
    `vat.first_period_end_month` -- see task-10-report.md."""
    v7 = migrate_inputs_to_v7({"inputs_version": 1})
    v7.finance = v7.finance.model_copy(update={"term_months": term_months})
    source = v7.model_dump(mode="json")

    before = _issue_keys(validate_inputs(parse_calculator_inputs(source)))
    migrated = migrate_inputs_to_v8(source)
    after = _issue_keys(validate_inputs(migrated))

    # Non-vacuity: the migrated document really does carry the block whose
    # bound would fire, on a term short enough to trip it.
    assert migrated.vat.registered is False
    assert migrated.vat.first_period_end_month == 2
    assert migrated.finance.term_months == term_months
    assert migrated.vat.first_period_end_month >= term_months

    _assert_issue_sets_agree(before, after, f"synthetic {term_months}-month document")
    assert not any(field == "vat.first_period_end_month" for _, field, _ in after)
