import pytest
import httpx
import respx

from app.integrations.postcodes import lookup_postcode, PostcodeLookupResult


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
