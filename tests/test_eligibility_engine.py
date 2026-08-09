import pytest

from app.eligibility.criteria import (
    CriterionDef,
    get_criteria_for_class,
    detect_pdr_class,
    ALL_CRITERIA,
)
from app.models import PdrClass, UseClass


class TestCriteriaDefinitions:
    def test_all_criteria_not_empty(self):
        assert len(ALL_CRITERIA) > 0
        assert all(isinstance(c, CriterionDef) for c in ALL_CRITERIA)

    def test_class_ma_has_12_criteria(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_MA)
        assert len(criteria) == 12

    def test_class_ma_criteria_keys(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_MA)
        keys = {c.key for c in criteria}
        assert "use_class_check" in keys
        assert "floor_area_limit" in keys
        assert "vacancy_period" in keys
        assert "conservation_area" in keys
        assert "aonb_national_park" in keys
        assert "article_4" in keys
        assert "flood_zone" in keys
        assert "listed_building" in keys
        assert "natural_light" in keys
        assert "transport_access" in keys
        assert "contamination" in keys
        assert "prior_refusal" in keys

    def test_class_g_has_criteria(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_G)
        assert len(criteria) > 0
        keys = {c.key for c in criteria}
        assert "floor_area_limit" in keys

    def test_class_q_has_criteria(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_Q)
        assert len(criteria) > 0

    def test_each_criterion_has_check_type(self):
        for c in ALL_CRITERIA:
            assert c.check_type in ("auto", "semi_auto", "manual")


class TestPdrClassDetection:
    def test_office_detects_class_ma(self):
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=500.0)
        assert result == PdrClass.CLASS_MA

    def test_office_over_1500_sqm_returns_none(self):
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=1600.0)
        assert result is None

    def test_retail_detects_class_g(self):
        result = detect_pdr_class(UseClass.RETAIL, floor_area_sqm=100.0)
        assert result == PdrClass.CLASS_G

    def test_retail_over_150_sqm_returns_none(self):
        result = detect_pdr_class(UseClass.RETAIL, floor_area_sqm=200.0)
        assert result is None

    def test_agricultural_detects_class_q(self):
        result = detect_pdr_class(UseClass.AGRICULTURAL, floor_area_sqm=300.0)
        assert result == PdrClass.CLASS_Q

    def test_agricultural_over_465_sqm_returns_none(self):
        result = detect_pdr_class(UseClass.AGRICULTURAL, floor_area_sqm=500.0)
        assert result is None

    def test_office_no_area_defaults_class_ma(self):
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=None)
        assert result == PdrClass.CLASS_MA

    def test_sui_generis_returns_none(self):
        result = detect_pdr_class(UseClass.SUI_GENERIS, floor_area_sqm=100.0)
        assert result is None
