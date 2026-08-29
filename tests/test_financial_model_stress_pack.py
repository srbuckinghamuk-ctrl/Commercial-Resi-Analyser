import json
from dataclasses import asdict
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.apply_scenario import apply_scenario
from app.financial_model.migrate import migrate_inputs_to_v15
from app.financial_model.sensitivity import InvalidBaseDocumentError
from app.financial_model.stress_pack import STRESS_PACK, StressDefinition, resolve_stress, run_stress_pack
from app.financial_model.types import ScenarioOverrides

from .fixtures_due_diligence import dd_doc
from .fixtures_investment_case import ic_doc

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"


def _load(stem):
    return migrate_inputs_to_v15(json.loads((FIXTURE_DIR / f"{stem}.json").read_text(encoding="utf-8"))["inputs"], None)


def test_the_pack_is_nine_entries_in_the_normative_order():
    """Fix round 1, Finding 2: pins every key, label AND settings tuple, not
    just the key order -- so a magnitude or label drift (e.g. sales_slip 6 ->
    5) fails here rather than passing the whole suite silently."""
    assert STRESS_PACK == (
        StressDefinition("unit_loss", "One unit lost", (("saleable_area", None),)),
        StressDefinition("area_reduction", "Saleable area -5%", (("saleable_area", -5.0),)),
        StressDefinition("abnormal_cost", "Abnormal cost +10%", (("abnormal_cost", 10.0),)),
        StressDefinition("slower_absorption", "Sales six months slower", (("sales_slip", 6.0),)),
        StressDefinition("delayed_start", "Start / PC six months late", (("programme_slip", 6.0),)),
        StressDefinition("yield_expansion", "Exit yield +100 bp", (("exit_yield", 1.0),)),
        StressDefinition("lower_refi_ltv", "Refinance LTV -10 pp", (("refi_ltv", 10.0),)),
        StressDefinition("opex_vacancy", "Opex +10%, vacancy +5 pp", (("operating_cost", 10.0), ("vacancy", 5.0))),
        StressDefinition("risks_crystallise", "Recorded risks crystallise",
                         (("construction_cost", None), ("programme_slip", None))),
    )


def test_fixture_y_derivations_and_applicability():
    """Plan table 'Base Y', hand-derived."""
    y = _load("y-due-diligence")
    by_key = {d.key: resolve_stress(y, d) for d in STRESS_PACK}
    assert by_key["unit_loss"].settings[0].value == -25
    assert by_key["unit_loss"].applicable is True
    rc = by_key["risks_crystallise"]
    assert rc.applicable is True and rc.note is None
    assert rc.derivation.cost_impact_pence == 2_550_000
    assert rc.derivation.base_build_pence == 26_000_000
    assert rc.derivation.cost_pct == 9.807692307692
    assert rc.derivation.programme_impact_months == 7
    assert rc.derivation.programme_impact_max_months == 3
    assert rc.derivation.stated_item_count == 4
    assert [(s.lever, s.value) for s in rc.settings] == [("construction_cost", 9.807692307692), ("programme_slip", 7.0)]
    assert by_key["abnormal_cost"].applicable is False
    assert by_key["abnormal_cost"].note == "No package carries the abnormal contingency class, so the stress has nothing to attach to."
    for k in ("yield_expansion", "lower_refi_ltv", "opex_vacancy"):
        assert by_key[k].applicable is False
        assert by_key[k].note == "No investment case is modelled, so there is no take-out to stress."
    for k in ("area_reduction", "slower_absorption", "delayed_start"):
        assert by_key[k].applicable is True


def test_fixture_u_derivations_and_applicability():
    u = _load("u-investment-case-ltv-binds")
    by_key = {d.key: resolve_stress(u, d) for d in STRESS_PACK}
    assert by_key["unit_loss"].settings[0].value == -20
    assert by_key["abnormal_cost"].applicable is True
    assert by_key["slower_absorption"].applicable is False
    rc = by_key["risks_crystallise"]
    assert rc.applicable is False
    assert rc.note == ("No assessed due-diligence item states a cost impact. "
                       "No assessed due-diligence item states a programme impact.")
    assert [(s.lever, s.value) for s in rc.settings] == [("construction_cost", 0.0), ("programme_slip", 0.0)]


def test_risks_crystallise_levered_build_on_y_is_within_the_stated_bound():
    """Sec 25.3: detailed mode, per-package rounding -> |levered - (base + sum)| <= packages."""
    y = _load("y-due-diligence")
    rc = resolve_stress(y, STRESS_PACK[-1])
    levered = apply_scenario(y, ScenarioOverrides(
        label="", gdv_adjustment_pct=0, construction_cost_adjustment_pct=rc.derivation.cost_pct,
        timeline_adjustment_months=0, interest_rate_adjustment_pct=0))
    amounts = [p.amount_pence for p in levered.cost_plan.packages]
    assert amounts == [13_176_923, 8_784_615, 6_588_462]        # hand-derived
    assert abs(sum(amounts) - (26_000_000 + 2_550_000)) <= len(amounts)


def test_risks_crystallise_headline_bound():
    """Sec 25.3 headline arm: the lever rounds the RATE, so the bound is
    ceil(area/2) + 1 pence. Built from ic_doc (headline) with two DD items
    given impacts by hand."""
    import math
    doc = migrate_inputs_to_v15(ic_doc().model_dump(mode="json"), None)
    items = doc.due_diligence.items
    items[0].status, items[0].cost_impact_pence = "amber", 1_234_567
    items[1].status, items[1].cost_impact_pence = "red", 765_433
    rc = resolve_stress(doc, STRESS_PACK[-1])
    assert rc.derivation.cost_impact_pence == 2_000_000
    levered = apply_scenario(doc, ScenarioOverrides(
        label="", gdv_adjustment_pct=0, construction_cost_adjustment_pct=rc.derivation.cost_pct,
        timeline_adjustment_months=0, interest_rate_adjustment_pct=0))
    from app.financial_model import compute_cost_plan, developed_area_sqm
    area = developed_area_sqm(doc)
    before = compute_cost_plan(doc, area, len(doc.unit_mix.units)).base_build_pence
    after = compute_cost_plan(levered, area, len(doc.unit_mix.units)).base_build_pence
    assert abs(after - (before + 2_000_000)) <= math.ceil(area / 2) + 1


def test_inapplicable_implies_equal_to_base_corpus_wide():
    """Design decision 11 / guard 3, and the identity every measured stress
    is defined by (Sec 25.2): a stress cell IS run_appraisal(apply_scenario(base, its settings)).

    Fix round 1, Finding 3: the corpus stems whose base document fails
    validation are collected and asserted against the known set (currently
    empty), not skipped one-by-one -- a fixture newly going invalid now fails
    this test instead of quietly dropping out of coverage."""
    invalid_base_stems: set[str] = set()
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        if "inputs" not in doc:
            continue  # suite fixture, no inputs of its own
        inputs = migrate_inputs_to_v15(doc["inputs"], None)
        try:
            result = run_stress_pack(inputs)
        except InvalidBaseDocumentError:
            invalid_base_stems.add(path.stem)
            continue
        for s in result.stresses:
            if not s.applicable:
                assert asdict(s.metrics) == asdict(result.base), (path.stem, s.key)
    assert invalid_base_stems == set()


def test_every_stress_is_the_levered_appraisal_on_y_and_u():
    """Fix round 1, Finding 3: the (stem, key) pairs skipped because the
    levered position is unmeasured are collected and asserted against the
    known set, rather than `continue`d unconditionally -- a widening of that
    set now fails this test instead of silently reducing its assertion
    count."""
    skipped: set[tuple[str, str]] = set()
    for stem in ("y-due-diligence", "u-investment-case-ltv-binds"):
        inputs = _load(stem)
        result = run_stress_pack(inputs)
        for s in result.stresses:
            levered = inputs
            for setting in s.settings:
                levered = apply_scenario(levered, _single(setting.lever, setting.value))
            if s.metrics.validation_errors:
                # The levered position is unmeasured (Sec 12.7): _measure never
                # calls run_appraisal for it, so there is nothing to compare
                # against. Same pattern as
                # test_sales_slip_cells_go_invalid_not_clamped_at_both_ends in
                # test_financial_model_sensitivity.py -- fixture Y's
                # slower_absorption slip (sales_slip +6) pushes unit_sales
                # row 3's completion to month 26 against a 24-month term,
                # which validate_inputs rejects but a raw run_appraisal call
                # does not (it silently computes on the out-of-range month).
                # The set below has TWO members, and the second has its own
                # cause: fixture U's delayed_start slip (programme_slip +6)
                # adds six months to every predecessor-free phase, pushing U's
                # programme finish from month 21 to month 27 against the same
                # 24-month term -- so the levered network no longer fits the
                # facility financing it ("Phase 'Maturity' ends 3 months after
                # maturity"), and validate_inputs rejects that document too.
                skipped.add((stem, s.key))
                continue
            expected = run_appraisal(levered).metrics
            assert s.metrics.profit_pence == expected.profit_pence, (stem, s.key)
            assert s.metrics.peak_debt_pence == expected.peak_debt_pence, (stem, s.key)
            assert s.delta_profit_pence == expected.profit_pence - result.base.profit_pence
    assert skipped == {
        ("y-due-diligence", "slower_absorption"),
        ("u-investment-case-ltv-binds", "delayed_start"),
    }


def _single(lever, value):
    field = {"saleable_area": "saleable_area_adjustment_pct", "abnormal_cost": "abnormal_cost_adjustment_pct",
             "programme_slip": "programme_slip_months", "refi_ltv": "refi_ltv_adjustment_pct",
             "sales_slip": "sales_slip_months", "exit_yield": "exit_yield_adjustment_pct",
             "operating_cost": "operating_cost_adjustment_pct", "vacancy": "vacancy_adjustment_pct",
             "construction_cost": "construction_cost_adjustment_pct"}[lever]
    # Built as a dict-merge, not literal kwargs: the brief's literal kwargs
    # form (`construction_cost_adjustment_pct=0, **{field: value}`) raises
    # "got multiple values for keyword argument" whenever lever ==
    # "construction_cost" (the risks_crystallise stress), because that field
    # is also one of the four hardcoded base kwargs. Same values, no duplicate.
    kwargs = dict(label="", gdv_adjustment_pct=0, construction_cost_adjustment_pct=0,
                  timeline_adjustment_months=0, interest_rate_adjustment_pct=0)
    kwargs[field] = int(value) if field.endswith("_months") else value
    return ScenarioOverrides(**kwargs)


def test_u_abnormal_cost_and_refi_ltv_by_hand():
    """Plan table 'Base U': +3,500,000 contingency on an unlevered headline
    document moves profit by exactly -3,500,000; the LTV cap at 45% is
    floor(32,407,082 x 45 / 100) = 14,583,186 and still binds."""
    u = _load("u-investment-case-ltv-binds")
    result = run_stress_pack(u)
    by_key = {s.key: s for s in result.stresses}
    assert by_key["abnormal_cost"].delta_profit_pence == -3_500_000
    levered = apply_scenario(u, _single("refi_ltv", 10))
    ic = run_appraisal(levered).metrics.investment_case
    assert ic["takeout"]["ltv_cap_pence"] == 14_583_186      # verify the result's shape (dict vs dataclass) before asserting
    assert ic["takeout"]["quantum_pence"] == 14_583_186
    assert ic["takeout"]["binding_constraint"] == "ltv"


def test_an_invalid_base_document_is_refused():
    doc = dd_doc()
    doc.finance.term_months = 0
    with pytest.raises(InvalidBaseDocumentError):
        run_stress_pack(doc)
