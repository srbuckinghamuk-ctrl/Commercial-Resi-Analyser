import pytest
import httpx
import respx

from app.integrations.postcodes import lookup_postcode, PostcodeLookupResult
from app.integrations.flood import lookup_flood_risk, FloodRiskResult
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


class TestFloodRiskLookup:
    @respx.mock
    @pytest.mark.asyncio
    async def test_flood_zone_1_returns_safe(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={"items": []},
            )
        )
        result = await lookup_flood_risk("SW1A 1AA", 51.501, -0.142)
        assert result is not None
        assert isinstance(result, FloodRiskResult)
        assert result.in_flood_zone_2_or_3 is False

    @respx.mock
    @pytest.mark.asyncio
    async def test_flood_zone_with_warnings_returns_at_risk(self):
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
        result = await lookup_flood_risk("SW1A 1AA", 51.501, -0.142)
        assert result is not None
        assert result.in_flood_zone_2_or_3 is True

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get(
            "https://environment.data.gov.uk/flood-monitoring/id/floods",
            params={"lat": "51.501", "long": "-0.142", "dist": "1"},
        ).mock(return_value=httpx.Response(500, text="Server Error"))
        result = await lookup_flood_risk("SW1A 1AA", 51.501, -0.142)
        assert result is None


class TestEpcLookup:
    @respx.mock
    @pytest.mark.asyncio
    async def test_valid_epc_returns_result(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "1 Test Street, LONDON",
                            "postcode": "SW1A 1AA",
                            "current-energy-rating": "C",
                            "current-energy-efficiency": "68",
                            "lodgement-date": "2023-01-15",
                            "lmk-key": "ABC123",
                            "property-type": "Flat",
                            "total-floor-area": "85",
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

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_results_returns_none(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
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
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
            params={"postcode": "SW1A 1AA", "size": "5"},
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "rows": [
                        {
                            "address": "2 Other Road, LONDON",
                            "postcode": "SW1A 1AA",
                            "current-energy-rating": "D",
                            "current-energy-efficiency": "55",
                            "lodgement-date": "2022-06-01",
                            "lmk-key": "DEF456",
                            "property-type": "House",
                            "total-floor-area": "120",
                        },
                        {
                            "address": "1 Test Street, LONDON",
                            "postcode": "SW1A 1AA",
                            "current-energy-rating": "B",
                            "current-energy-efficiency": "82",
                            "lodgement-date": "2023-03-20",
                            "lmk-key": "GHI789",
                            "property-type": "Flat",
                            "total-floor-area": "90",
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

    @respx.mock
    @pytest.mark.asyncio
    async def test_no_api_key_returns_none(self):
        result = await lookup_epc("SW1A 1AA", api_key="")
        assert result is None

    @respx.mock
    @pytest.mark.asyncio
    async def test_api_error_returns_none(self):
        respx.get(
            "https://epc.opendatacommunities.org/api/v1/domestic/search",
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
        assert result.has_article4 is True
        assert len(result.directions) > 0
        assert isinstance(result.directions[0], Article4Direction)
        assert "class_ma" in result.directions[0].pdr_classes_restricted

    @pytest.mark.asyncio
    async def test_lpa_without_article4(self):
        result = await lookup_article4("E07000999")
        assert result is not None
        assert result.has_article4 is False
        assert result.directions == []
        assert "verify" in result.note.lower()

    @pytest.mark.asyncio
    async def test_empty_lpa_code(self):
        result = await lookup_article4("")
        assert result is not None
        assert result.has_article4 is False
