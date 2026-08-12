import pytest
import httpx
import respx

from app.integrations.postcodes import lookup_postcode, PostcodeLookupResult
from app.integrations.flood import lookup_flood_warnings, FloodWarningsResult
from app.integrations.epc import lookup_epc, EpcResult
from app.integrations.article4 import lookup_article4, Article4Result, Article4Direction


class TestPostcodesLookup:
    @respx.mock
    @pytest.mark.asyncio
    async def test_valid_postcode_returns_result(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(
                200,
                json={
                    "status": 200,
                    "result": {
                        "postcode": "SW1A 1AA",
                        "latitude": 51.501009,
                        "longitude": -0.141588,
                        "admin_district": "Westminster",
                        "region": "London",
                        "country": "England",
                        "codes": {
                            "admin_district": "E09000033",
                            "lau2": "E09000033",
                        },
                    },
                },
            )
        )
        result = await lookup_postcode("SW1A 1AA")
        assert result is not None
        assert isinstance(result, PostcodeLookupResult)
        assert result.postcode == "SW1A 1AA"
        assert result.latitude == pytest.approx(51.501009)
        assert result.longitude == pytest.approx(-0.141588)
        assert result.admin_district == "Westminster"
        assert result.region == "London"
        assert result.country == "England"
        assert result.lpa_code == "E09000033"
        assert result.lpa_name == "Westminster"

    @respx.mock
    @pytest.mark.asyncio
    async def test_invalid_postcode_returns_none(self):
        respx.get("https://api.postcodes.io/postcodes/INVALID").mock(
            return_value=httpx.Response(404, json={"status": 404, "error": "Postcode not found"})
        )
        result = await lookup_postcode("INVALID")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get("https://api.postcodes.io/postcodes/SW1A1AA").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )
        result = await lookup_postcode("SW1A 1AA")
        assert result is None


class TestFloodWarningsLookup:
    @respx.mock
    @pytest.mark.asyncio
    async def test_no_items_means_no_active_warnings(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={"items": []},
            )
        )
        result = await lookup_flood_warnings("SW1A 1AA", 51.501, -0.142)
        assert result is not None
        assert isinstance(result, FloodWarningsResult)
        assert result.has_active_warnings is False
        assert result.warning_count == 0
        assert result.max_severity_level is None
        # The source must be explicit that this is warnings data, not zones
        assert "not flood zones" in result.source

    @respx.mock
    @pytest.mark.asyncio
    async def test_active_warning_reported(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "floodArea": {"notation": "ABC123"},
                            "severityLevel": 2,
                            "description": "Flood warning for River Thames",
                        }
                    ]
                },
            )
        )
        result = await lookup_flood_warnings("SW1A 1AA", 51.501, -0.142)
        assert result is not None
        assert result.has_active_warnings is True
        assert result.warning_count == 1
        assert result.max_severity_level == 2

    @respx.mock
    @pytest.mark.asyncio
    async def test_expired_warning_not_counted_as_active(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={"items": [{"severityLevel": 4, "description": "No longer in force"}]},
            )
        )
        result = await lookup_flood_warnings("SW1A 1AA", 51.501, -0.142)
        assert result is not None
        assert result.has_active_warnings is False
        assert result.warning_count == 0
        assert result.max_severity_level == 4

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(return_value=httpx.Response(500, text="Server Error"))
        result = await lookup_flood_warnings("SW1A 1AA", 51.501, -0.142)
        assert result is None


class TestEpcLookup:
    """The EPC lookup targets the NON-DOMESTIC (commercial) register."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_valid_epc_returns_result(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/non-domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "1 Test Street, LONDON",
                            "postcode": "SW1A 1AA",
                            "asset-rating-band": "C",
                            "asset-rating": "68",
                            "lodgement-date": "2023-01-15",
                            "lmk-key": "ABC123",
                            "property-type": "Office",
                            "floor-area": "85",
                        }
                    ],
                    "column-names": [],
                },
            )
        )
        result = await lookup_epc("SW1A 1AA", api_key="test-key")
        assert result is not None
        assert isinstance(result, EpcResult)
        assert result.rating == "C"
        assert result.score == 68
        assert result.floor_area_sqm == 85.0
        # No address fragment supplied — row cannot be treated as matched
        assert result.matched_address is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_results_returns_none(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/non-domestic/search",
            params={"postcode": "XX1 1XX", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={"rows": [], "column-names": []},
            )
        )
        result = await lookup_epc("XX1 1XX", api_key="test-key")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_address_fragment_filters(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/non-domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "2 Other Road, LONDON",
                            "postcode": "SW1A 1AA",
                            "asset-rating-band": "D",
                            "asset-rating": "55",
                            "lodgement-date": "2022-06-01",
                            "lmk-key": "DEF456",
                            "property-type": "Retail",
                            "floor-area": "120",
                        },
                        {
                            "address": "1 Test Street, LONDON",
                            "postcode": "SW1A 1AA",
                            "asset-rating-band": "B",
                            "asset-rating": "82",
                            "lodgement-date": "2023-03-20",
                            "lmk-key": "GHI789",
                            "property-type": "Office",
                            "floor-area": "90",
                        },
                    ],
                    "column-names": [],
                },
            )
        )
        result = await lookup_epc("SW1A 1AA", address_fragment="1 Test", api_key="test-key")
        assert result is not None
        assert result.rating == "B"
        assert result.address == "1 Test Street, LONDON"
        assert result.matched_address is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_unmatched_fragment_flags_row_as_unmatched(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/non-domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "2 Other Road, LONDON",
                            "postcode": "SW1A 1AA",
                            "asset-rating-band": "D",
                            "asset-rating": "55",
                            "lodgement-date": "2022-06-01",
                            "lmk-key": "DEF456",
                            "property-type": "Retail",
                            "floor-area": "120",
                        },
                    ],
                    "column-names": [],
                },
            )
        )
        result = await lookup_epc("SW1A 1AA", address_fragment="99 Nowhere", api_key="test-key")
        assert result is not None
        assert result.matched_address is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_api_key_returns_none(self):
        result = await lookup_epc("SW1A 1AA", api_key="")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/non-domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(return_value=httpx.Response(403, text="Forbidden"))
        result = await lookup_epc("SW1A 1AA", api_key="bad-key")
        assert result is None


class TestArticle4Lookup:
    @pytest.mark.asyncio
    async def test_known_lpa_with_article4(self):
        result = await lookup_article4("E09000033")
        assert result is not None
        assert isinstance(result, Article4Result)
        assert result.lpa_code == "E09000033"
        assert result.lpa_in_dataset is True
        assert result.has_article4 is True
        assert len(result.directions) > 0
        assert isinstance(result.directions[0], Article4Direction)
        assert "class_ma" in result.directions[0].pdr_classes_restricted

    @pytest.mark.asyncio
    async def test_lpa_not_in_dataset_is_unknown_not_clear(self):
        result = await lookup_article4("E07000999")
        assert result is not None
        assert result.lpa_in_dataset is False
        assert result.has_article4 is False
        assert result.directions == []
        assert "not in the bundled article 4 dataset" in result.note.lower()

    @pytest.mark.asyncio
    async def test_lpa_in_dataset_without_directions(self, monkeypatch):
        import app.integrations.article4 as article4_mod

        monkeypatch.setattr(
            article4_mod,
            "_dataset",
            {"E07000042": {"lpa_name": "Testshire", "directions": []}},
        )
        result = await lookup_article4("E07000042")
        assert result.lpa_in_dataset is True
        assert result.has_article4 is False
        assert result.directions == []

    @pytest.mark.asyncio
    async def test_empty_lpa_code(self):
        result = await lookup_article4("")
        assert result is not None
        assert result.lpa_in_dataset is False
        assert result.has_article4 is False
