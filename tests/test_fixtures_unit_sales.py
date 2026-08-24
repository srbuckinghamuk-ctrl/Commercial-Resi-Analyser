from app.financial_model.validation import validate_inputs
from .fixtures_unit_sales import (
    anchor_resolver, held_twin_doc, no_programme_doc, pc_early_doc, residue_doc, sold_gross, unit_sales_doc,
)


def _errs(doc):
    return [i for i in validate_inputs(doc) if i.severity == "error"]


def test_x_is_v12_and_carries_the_ledger():
    d = unit_sales_doc()
    assert d.inputs_version == 12
    assert d.unit_sales is not None and len(d.unit_sales.units) == 4
    assert sold_gross(d) == [("u1", 26_000_000), ("u2", 30_000_000), ("u3", 17_500_000), ("u4", 21_000_000)]


def test_x_resolves_the_hand_derived_months():
    d = unit_sales_doc()
    r = anchor_resolver(d)
    rows = d.unit_sales.units
    assert r(rows[0].exchange.anchor, rows[0].exchange.month_offset) == 8
    assert r(rows[0].completion.anchor, rows[0].completion.month_offset) == 12
    assert r(rows[1].completion.anchor, rows[1].completion.month_offset) == 13
    assert r(rows[2].completion.anchor, rows[2].completion.month_offset) == 13
    assert r(rows[3].completion.anchor, rows[3].completion.month_offset) == 20


def test_pc_early_moves_practical_completion_to_month_9():
    d = pc_early_doc()
    r = anchor_resolver(d)
    rows = d.unit_sales.units
    assert r(rows[0].completion.anchor, 0) == 9
    assert r(rows[1].completion.anchor, 0) == 10
    assert r(rows[2].completion.anchor, 0) == 10


def test_variants_differ_from_x_by_exactly_their_one_change():
    assert held_twin_doc().unit_sales.deposit_release == "held_to_completion"
    assert no_programme_doc().programme is None
    assert [r.completion.month_offset for r in no_programme_doc().unit_sales.units] == [12, 13, 13, 20]
    rd = residue_doc()
    assert [u.estimated_value_pence for u in rd.unit_mix.units] == [10_000_000] * 3
    assert rd.exit_strategy.selling_legal_fee_pence == 100


def test_every_builder_validates_clean_before_task_5_adds_rules():
    # Task 5 keeps this true for the four valid variants; the controls
    # (sales_phasing_too, drop_row, extra_row) are meant to FAIL there.
    for d in (unit_sales_doc(), held_twin_doc(), no_programme_doc(), pc_early_doc(), residue_doc()):
        assert _errs(d) == []
