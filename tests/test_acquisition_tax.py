import json
import math
from pathlib import Path

import pytest

from app.financial_model.acquisition_tax import (
    TAX_TABLE_VERSION,
    TAX_TABLES,
    calculate_acquisition_tax,
    derive_jurisdiction,
    regime_for,
    select_band_set,
)

YORK = 75_348_200
TWO_MILLION = 200_000_000
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "tax" / "acquisition-tax-tables.json"


@pytest.mark.parametrize(
    "jurisdiction,price,expected",
    [
        ("england_ni", YORK, 2_717_410),
        ("scotland", YORK, 2_617_410),
        ("wales", YORK, 2_542_410),
        ("england_ni", TWO_MILLION, 8_950_000),
        ("scotland", TWO_MILLION, 8_850_000),
        ("wales", TWO_MILLION, 9_775_000),
    ],
)
def test_non_residential_by_jurisdiction(jurisdiction, price, expected):
    r = calculate_acquisition_tax(
        consideration_pence=price, jurisdiction=jurisdiction,
        basis="non_residential", date="2026-08-17",
    )
    assert r.total_pence == expected


def test_gov_uk_worked_example():
    r = calculate_acquisition_tax(
        consideration_pence=27_500_000, jurisdiction="england_ni",
        basis="non_residential", date="2026-08-17",
    )
    assert r.total_pence == 325_000


@pytest.mark.parametrize("price", [0, -1])
def test_zero_and_negative_consideration(price):
    r = calculate_acquisition_tax(
        consideration_pence=price, jurisdiction="england_ni",
        basis="non_residential", date="2026-08-17",
    )
    assert r.total_pence == 0
    assert r.effective_rate_pct == 0


def test_england_supplement_and_welsh_absence():
    eng = calculate_acquisition_tax(
        consideration_pence=YORK, jurisdiction="england_ni",
        basis="residential_higher", date="2026-08-17",
    )
    assert eng.surcharge_pence == 3_767_410
    assert eng.total_pence == 6_534_820

    wal = calculate_acquisition_tax(
        consideration_pence=YORK, jurisdiction="wales",
        basis="residential_higher", date="2026-08-17",
    )
    assert wal.surcharge_pence == 0


def test_regime_names():
    assert regime_for("england_ni") == "SDLT"
    assert regime_for("scotland") == "LBTT"
    assert regime_for("wales") == "LTT"


def test_null_date_is_assumed_current():
    band_set, date_basis = select_band_set("scotland", "non_residential", None)
    assert date_basis == "assumed_current"
    assert band_set.effective_to is None


def test_uncovered_date_raises_naming_the_earliest():
    with pytest.raises(ValueError, match=r"1990-01-01.*2020-12-22"):
        select_band_set("wales", "non_residential", "1990-01-01")


def test_windows_are_contiguous_and_end_open():
    groups: dict[tuple[str, str], list] = {}
    for s in TAX_TABLES:
        groups.setdefault((s.jurisdiction, s.basis), []).append(s)
    assert len(groups) == 6
    for key, sets in groups.items():
        ordered = sorted(sets, key=lambda s: s.effective_from)
        for a, b in zip(ordered, ordered[1:]):
            assert a.effective_to == b.effective_from, key
        assert ordered[-1].effective_to is None, key


def test_bands_ascend_and_top_is_unbounded():
    for s in TAX_TABLES:
        tops = [b.up_to_pence for b in s.bands]
        assert tops == sorted(tops)
        assert tops[-1] == math.inf


def test_override_replaces_total_and_preserves_computed():
    r = calculate_acquisition_tax(
        consideration_pence=YORK, jurisdiction="england_ni",
        basis="non_residential", date="2026-08-17",
        override_pence=1_000_000, override_reason="Group relief claimed (FA2003 Sch 7).",
    )
    assert r.total_pence == 1_000_000
    assert r.is_override is True
    assert r.computed_total_pence == 2_717_410
    assert r.override_reason == "Group relief claimed (FA2003 Sch 7)."


@pytest.mark.parametrize(
    "country,expected",
    [
        ("England", "england_ni"), ("Northern Ireland", "england_ni"),
        ("Scotland", "scotland"), ("Wales", "wales"),
    ],
)
def test_derive_jurisdiction(country, expected):
    assert derive_jurisdiction(country) == expected


@pytest.mark.parametrize("country", ["Isle of Man", "", None])
def test_derive_jurisdiction_unknown(country):
    assert derive_jurisdiction(country) is None


def test_parity_with_normative_table():
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert raw["table_version"] == TAX_TABLE_VERSION
    assert len(raw["band_sets"]) == len(TAX_TABLES)
    for spec, actual in zip(raw["band_sets"], TAX_TABLES):
        assert spec["regime"] == actual.regime
        assert spec["jurisdiction"] == actual.jurisdiction
        assert spec["basis"] == actual.basis
        assert spec["effective_from"] == actual.effective_from
        assert spec["effective_to"] == actual.effective_to
        assert spec["surcharge_pct"] == actual.surcharge_pct
        assert spec["source_url"] == actual.source_url
        assert spec["source_note"] == actual.source_note
        # JSON encodes the unbounded top band as null; map one way only, and
        # require exactly one such band, so a missing value cannot pass as
        # unbounded.
        assert sum(1 for b in spec["bands"] if b["up_to_pence"] is None) == 1
        expected_bands = [
            (math.inf if b["up_to_pence"] is None else b["up_to_pence"], b["rate_pct"])
            for b in spec["bands"]
        ]
        assert expected_bands == [(b.up_to_pence, b.rate_pct) for b in actual.bands]
