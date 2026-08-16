import pytest

from app.eligibility.criteria import (
    CriterionDef,
    get_criteria_for_class,
    detect_pdr_class,
    ALL_CRITERIA,
)
from app.models import PdrClass, UseClass

import httpx
import respx

from app.eligibility.engine import run_eligibility, EligibilityEngineResult
from app.models import (
    EligibilityCriterion,
    EligibilityVerdict,
    Project,
    PipelineStage,
    Tenure,
)
from datetime import datetime
from uuid import uuid4


def _make_project(**overrides) -> Project:
    defaults = dict(
        id=uuid4(),
        address_raw="10 Test Office, London, SW1A 1AA",
        address_line1="10 Test Office",
        address_town="London",
        address_postcode="SW1A 1AA",
        address_postcode_district="SW1A",
        price_pence=50000000,
        use_class="office",
        floor_area_sqft=5000.0,
        floor_area_sqm=464.5,
        floors=2,
        tenure=Tenure.FREEHOLD,
        is_vacant=True,
        stage=PipelineStage.OPPORTUNITY_IDENTIFIED,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        image_urls=[],
    )
    defaults.update(overrides)
    return Project(**defaults)


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
        # GPDO Amendment Order 2024 (SI 2024/141, in force 5 March 2024)
        # removed the 1,500 sqm floorspace cap and the 3-month vacancy
        # requirement from Class MA.
        assert "floor_area_limit" not in keys
        assert "vacancy_period" not in keys
        assert "class_e_use_period" in keys
        assert "conservation_area" in keys
        assert "aonb_national_park" in keys
        assert "article_4" in keys
        assert "flood_zone" in keys
        assert "listed_building" in keys
        assert "natural_light" in keys
        assert "transport_access" in keys
        assert "contamination" in keys
        assert "noise_impact" in keys
        assert "prior_refusal" in keys

    def test_class_e_use_period_is_manual_and_statutory(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_MA)
        crit = next(c for c in criteria if c.key == "class_e_use_period")
        assert crit.check_type == "manual"
        assert crit.category == "statutory"

    def test_class_ma_conservation_area_is_prior_approval(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_MA)
        crit = next(c for c in criteria if c.key == "conservation_area")
        assert crit.category == "prior_approval"

    def test_class_m_conservation_area_stays_statutory(self):
        criteria = get_criteria_for_class(PdrClass.CLASS_M)
        crit = next(c for c in criteria if c.key == "conservation_area")
        assert crit.category == "statutory"

    def test_each_criterion_has_valid_category(self):
        for c in ALL_CRITERIA:
            assert c.category in ("statutory", "prior_approval")

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

    def test_office_over_1500_sqm_still_class_ma(self):
        # The 1,500 sqm Class MA cap was removed in March 2024 — large
        # offices remain eligible.
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=1600.0)
        assert result == PdrClass.CLASS_MA

    def test_class_ma_has_no_floor_area_cap(self):
        from app.eligibility.criteria import FLOOR_AREA_LIMITS

        assert PdrClass.CLASS_MA not in FLOOR_AREA_LIMITS

    def test_retail_detects_class_ma(self):
        # Retail is Class E since Sept 2020 — routes to Class MA, not Class G.
        result = detect_pdr_class(UseClass.RETAIL, floor_area_sqm=100.0)
        assert result == PdrClass.CLASS_MA

    def test_retail_over_150_sqm_still_class_ma(self):
        # The obsolete 150 sqm Class G cap no longer applies to retail.
        result = detect_pdr_class(UseClass.RETAIL, floor_area_sqm=200.0)
        assert result == PdrClass.CLASS_MA

    def test_restaurant_cafe_detects_class_ma(self):
        # A3 is within Class E since Sept 2020 (Class M's A3 element removed Aug 2021).
        result = detect_pdr_class(UseClass.RESTAURANT_CAFE, floor_area_sqm=100.0)
        assert result == PdrClass.CLASS_MA

    def test_light_industrial_detects_class_ma(self):
        # E(g)(iii) is within Class E — previously fell through to "no route".
        result = detect_pdr_class(UseClass.LIGHT_INDUSTRIAL, floor_area_sqm=400.0)
        assert result == PdrClass.CLASS_MA

    def test_takeaway_stays_class_m(self):
        result = detect_pdr_class(UseClass.TAKEAWAY, floor_area_sqm=100.0)
        assert result == PdrClass.CLASS_M

    def test_agricultural_detects_class_q(self):
        result = detect_pdr_class(UseClass.AGRICULTURAL, floor_area_sqm=300.0)
        assert result == PdrClass.CLASS_Q

    def test_class_q_limit_is_1000(self):
        from app.eligibility.criteria import FLOOR_AREA_LIMITS

        assert FLOOR_AREA_LIMITS[PdrClass.CLASS_Q] == 1000.0

    def test_agricultural_under_1000_sqm_allowed(self):
        result = detect_pdr_class(UseClass.AGRICULTURAL, floor_area_sqm=900.0)
        assert result == PdrClass.CLASS_Q

    def test_agricultural_over_1000_sqm_returns_none(self):
        result = detect_pdr_class(UseClass.AGRICULTURAL, floor_area_sqm=1100.0)
        assert result is None

    def test_office_no_area_defaults_class_ma(self):
        result = detect_pdr_class(UseClass.OFFICE, floor_area_sqm=None)
        assert result == PdrClass.CLASS_MA

    def test_sui_generis_returns_none(self):
        result = detect_pdr_class(UseClass.SUI_GENERIS, floor_area_sqm=100.0)
        assert result is None


class TestEligibilityEngine:
    @respx.mock
    @pytest.mark.asyncio
    async def test_eligible_office_returns_amber(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Westminster",
                        "region": "London",
                        "country": "England",
                        "codes": {"admin_district": "E09000033"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        project = _make_project()
        result = await run_eligibility(project)

        assert isinstance(result, EligibilityEngineResult)
        assert result.pdr_class == PdrClass.CLASS_MA
        assert result.verdict == EligibilityVerdict.AMBER
        assert len(result.criteria) == 12
        # No floor-area criterion for Class MA since the 2024 amendments.
        assert all(c.key != "floor_area_limit" for c in result.criteria)
        manual_pending = [c for c in result.criteria if not c.auto_checked and c.passed is None]
        assert len(manual_pending) >= 1

    @respx.mock
    @pytest.mark.asyncio
    async def test_all_manual_overrides_pass_returns_green(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        overrides = {
            "use_class_check": True,
            "class_e_use_period": True,
            "conservation_area": True,
            "aonb_national_park": True,
            "article_4": True,
            # flood_zone is never auto-passed (the EA warnings feed cannot
            # answer the flood-zone question) so it must be manually confirmed
            "flood_zone": True,
            "listed_building": True,
            "natural_light": True,
            "transport_access": True,
            "contamination": True,
            "noise_impact": True,
            "prior_refusal": True,
        }
        project = _make_project()
        result = await run_eligibility(project, manual_overrides=overrides)

        assert result.verdict == EligibilityVerdict.GREEN

    @respx.mock
    @pytest.mark.asyncio
    async def test_manual_override_fail_returns_red(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        overrides = {"listed_building": False}
        project = _make_project()
        result = await run_eligibility(project, manual_overrides=overrides)

        assert result.verdict == EligibilityVerdict.RED

    @respx.mock
    @pytest.mark.asyncio
    async def test_floor_area_over_limit_auto_fails(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        # Class MA no longer has a floorspace cap, so the auto-fail path is
        # exercised through Class Q's 1,000 sqm cumulative limit instead.
        project = _make_project(use_class="agricultural", floor_area_sqm=1100.0)
        result = await run_eligibility(project)

        floor_criterion = next(c for c in result.criteria if c.key == "floor_area_limit")
        assert floor_criterion.passed is False
        assert result.verdict == EligibilityVerdict.RED

    @respx.mock
    @pytest.mark.asyncio
    async def test_suggested_next_steps_not_empty(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501,
                        "longitude": -0.142,
                        "admin_district": "Somewhere",
                        "region": "South East",
                        "country": "England",
                        "codes": {"admin_district": "E07000100"},
                    },
                },
            )
        )
        respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
            return_value=httpx.Response(200, json={"items": []})
        )

        project = _make_project()
        result = await run_eligibility(project)

        assert len(result.suggested_next_steps) > 0

    def test_no_postcode_project_cannot_auto_check(self):
        project = _make_project(address_postcode=None)
        # Should not crash — just can't auto-check location-based criteria


def _mock_postcode(lpa_code: str = "E09000033") -> None:
    respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
        return_value=httpx.Response(
            200,
            json={
                "status": 200,
                "result": {
                    "postcode": "SW1A 1AA",
                    "latitude": 51.501,
                    "longitude": -0.142,
                    "admin_district": "Somewhere",
                    "region": "London",
                    "country": "England",
                    "codes": {"admin_district": lpa_code},
                },
            },
        )
    )


def _mock_flood(items: list | None = None) -> None:
    respx.get("https://environment.data.gov.uk/flood-monitoring/id/floods").mock(
        return_value=httpx.Response(200, json={"items": items or []})
    )


class TestEngineHonesty:
    """The engine must never auto-pass criteria its data sources cannot answer."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_flood_criterion_never_auto_passed_with_no_warnings(self):
        _mock_postcode()
        _mock_flood([])
        result = await run_eligibility(_make_project())
        flood = next(c for c in result.criteria if c.key == "flood_zone")
        assert flood.passed is None
        assert flood.auto_checked is False
        assert "Flood Map for Planning" in flood.value

    @respx.mock
    @pytest.mark.asyncio
    async def test_flood_criterion_never_auto_failed_with_active_warning(self):
        _mock_postcode()
        _mock_flood([{"severityLevel": 1, "description": "Severe flood warning"}])
        result = await run_eligibility(_make_project())
        flood = next(c for c in result.criteria if c.key == "flood_zone")
        assert flood.passed is None
        assert flood.auto_checked is False
        assert flood.risk_flag is not None
        assert "flood alert" in flood.risk_flag.lower() or "flood alert/warning" in flood.risk_flag.lower()

    @respx.mock
    @pytest.mark.asyncio
    async def test_flood_next_step_suggested(self):
        _mock_postcode()
        _mock_flood([])
        result = await run_eligibility(_make_project())
        assert any("Flood Map for Planning" in s for s in result.suggested_next_steps)

    @respx.mock
    @pytest.mark.asyncio
    async def test_unknown_lpa_article4_is_pending_not_pass(self):
        _mock_postcode(lpa_code="E07000100")  # not in the bundled dataset
        _mock_flood([])
        result = await run_eligibility(_make_project())
        art4 = next(c for c in result.criteria if c.key == "article_4")
        assert art4.passed is None
        assert art4.auto_checked is False
        assert "not in the bundled Article 4 dataset" in art4.value

    @respx.mock
    @pytest.mark.asyncio
    async def test_known_lpa_without_relevant_direction_auto_passes(self, monkeypatch):
        import app.integrations.article4 as article4_mod

        monkeypatch.setattr(
            article4_mod,
            "_dataset",
            {"E07000100": {"lpa_name": "Testshire", "directions": []}},
        )
        _mock_postcode(lpa_code="E07000100")
        _mock_flood([])
        result = await run_eligibility(_make_project())
        art4 = next(c for c in result.criteria if c.key == "article_4")
        assert art4.passed is True
        assert art4.auto_checked is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_unmatched_epc_floor_area_does_not_drive_floorspace(self):
        _mock_postcode()
        _mock_flood([])
        respx.get("https://epc.opendatacommunities.org/api/v1/non-domestic/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "999 Completely Different Road, LONDON",
                            "postcode": "SW1A 1AA",
                            "asset-rating-band": "D",
                            "asset-rating": "55",
                            "lodgement-date": "2022-06-01",
                            "lmk-key": "DEF456",
                            "property-type": "Office",
                            "floor-area": "90",
                        }
                    ],
                    "column-names": [],
                },
            )
        )
        # Uses Class Q — the only route with a floorspace cap that also has
        # realistic EPC coverage (Class MA lost its cap in March 2024).
        project = _make_project(use_class="agricultural", floor_area_sqm=None, floor_area_sqft=None)
        result = await run_eligibility(project, epc_api_key="test-key")
        floor = next(c for c in result.criteria if c.key == "floor_area_limit")
        assert floor.passed is None
        assert floor.auto_checked is False
        assert floor.value == "Floor area unknown — add it to the project"

    @respx.mock
    @pytest.mark.asyncio
    async def test_matched_epc_floor_area_may_be_used(self):
        _mock_postcode()
        _mock_flood([])
        respx.get("https://epc.opendatacommunities.org/api/v1/non-domestic/search").mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            # Contains the full project address fragment
                            "address": "10 Test Office, London, SW1A 1AA",
                            "postcode": "SW1A 1AA",
                            "asset-rating-band": "C",
                            "asset-rating": "68",
                            "lodgement-date": "2023-01-15",
                            "lmk-key": "ABC123",
                            "property-type": "Office",
                            "floor-area": "400",
                        }
                    ],
                    "column-names": [],
                },
            )
        )
        project = _make_project(use_class="agricultural", floor_area_sqm=None, floor_area_sqft=None)
        result = await run_eligibility(project, epc_api_key="test-key")
        floor = next(c for c in result.criteria if c.key == "floor_area_limit")
        assert floor.passed is True
        assert floor.auto_checked is True
        assert "address-matched" in floor.value

    @respx.mock
    @pytest.mark.asyncio
    async def test_result_carries_ruleset_version(self):
        from app.eligibility.criteria import RULESET_VERSION

        _mock_postcode()
        _mock_flood([])
        result = await run_eligibility(_make_project())
        assert result.ruleset_version == RULESET_VERSION
        assert result.ruleset_version == "gpdo-2026-08.2"


class TestTwoTierVerdict:
    """Statutory failures are red (route unavailable); prior-approval
    failures are amber (approvability risk, not ineligibility)."""

    ALL_PASS_OVERRIDES = {
        "use_class_check": True,
        "class_e_use_period": True,
        "conservation_area": True,
        "aonb_national_park": True,
        "article_4": True,
        "flood_zone": True,
        "listed_building": True,
        "natural_light": True,
        "transport_access": True,
        "contamination": True,
        "noise_impact": True,
        "prior_refusal": True,
    }

    @respx.mock
    @pytest.mark.asyncio
    async def test_failed_prior_approval_criterion_yields_amber_not_red(self):
        _mock_postcode()
        _mock_flood([])
        overrides = dict(self.ALL_PASS_OVERRIDES, transport_access=False)
        result = await run_eligibility(_make_project(), manual_overrides=overrides)
        assert result.verdict == EligibilityVerdict.AMBER

    @respx.mock
    @pytest.mark.asyncio
    async def test_failed_statutory_criterion_yields_red(self):
        _mock_postcode()
        _mock_flood([])
        overrides = dict(self.ALL_PASS_OVERRIDES, natural_light=False)
        result = await run_eligibility(_make_project(), manual_overrides=overrides)
        assert result.verdict == EligibilityVerdict.RED

    @respx.mock
    @pytest.mark.asyncio
    async def test_failed_class_e_use_period_yields_red(self):
        _mock_postcode()
        _mock_flood([])
        overrides = dict(self.ALL_PASS_OVERRIDES, class_e_use_period=False)
        result = await run_eligibility(_make_project(), manual_overrides=overrides)
        assert result.verdict == EligibilityVerdict.RED

    @respx.mock
    @pytest.mark.asyncio
    async def test_failed_prior_approval_suggests_mitigation(self):
        _mock_postcode()
        _mock_flood([])
        overrides = dict(self.ALL_PASS_OVERRIDES, contamination=False)
        result = await run_eligibility(_make_project(), manual_overrides=overrides)
        assert result.verdict == EligibilityVerdict.AMBER
        assert any("contamination" in s.lower() for s in result.suggested_next_steps)

    @respx.mock
    @pytest.mark.asyncio
    async def test_criteria_carry_categories(self):
        _mock_postcode()
        _mock_flood([])
        result = await run_eligibility(_make_project())
        by_key = {c.key: c for c in result.criteria}
        assert by_key["natural_light"].category == "statutory"
        assert by_key["article_4"].category == "statutory"
        assert by_key["flood_zone"].category == "prior_approval"
        assert by_key["transport_access"].category == "prior_approval"
        assert by_key["noise_impact"].category == "prior_approval"
        assert by_key["conservation_area"].category == "prior_approval"
