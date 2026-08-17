"""Every adapter's description extraction must not glue block children together.

The second lender-readiness audit reported "DescriptionThe..." appearing without
a separating space in the exported investment memorandum, and recorded it as a
report defect. It was not. The report printed the stored value faithfully; the
value was glued at scrape time, because BeautifulSoup's `get_text(strip=True)`
concatenates every descendant with no separator:

    <div class="description"><h3>Description</h3><p>The property...</p></div>
        -> "DescriptionThe property..."

The live 9 & 9A Stonegate record still holds exactly that string, which is how
the cause was found.

Each adapter is exercised through its real listing parser with a description
container shaped the way the affected sites shape theirs -- a heading followed by
paragraphs -- so the assertion covers the code path the scraper actually takes,
not a direct call to BeautifulSoup.
"""
import pytest

from app.adapters.allsop import _parse_listing as parse_allsop
from app.adapters.eig import _parse_listing as parse_eig
from app.adapters.rightmove_commercial import _parse_listing as parse_rightmove
from app.adapters.savills import _parse_listing as parse_savills

DESCRIPTION_BLOCK = """
<div class="{cls}">
  <h3>Description</h3>
  <p>The property comprises a three storey building arranged as ground floor
     and basement retail accommodation.</p>
  <p>The upper parts are sold off on long lease.</p>
</div>
"""


def page(description_class: str, title_class: str = "") -> str:
    heading = (
        f'<h1 class="{title_class}">1 Test Street, York, YO1 8AN</h1>'
        if title_class
        else "<h1>1 Test Street, York, YO1 8AN</h1>"
    )
    return f"""
    <html><body>
      {heading}
      <div class="price"><span class="price-value">&pound;425,000</span></div>
      {DESCRIPTION_BLOCK.format(cls=description_class)}
    </body></html>
    """


CASES = [
    pytest.param(parse_allsop, "lot-description", "lot-title", id="allsop"),
    pytest.param(parse_eig, "lot-description", "", id="eig"),
    pytest.param(parse_rightmove, "property-description", "", id="rightmove"),
    pytest.param(parse_savills, "property-description", "", id="savills"),
]


@pytest.mark.parametrize("parse,description_class,title_class", CASES)
def test_description_words_are_separated(parse, description_class, title_class):
    listing = parse(page(description_class, title_class), "https://example.test/listing/1")
    assert listing is not None
    description = listing.description or ""

    # The defect, stated exactly: the heading's last word glued to the body's
    # first word. Asserting the absence of this substring is the whole point --
    # a test that merely checked the description contained "The property" passed
    # both before and after the fix.
    assert "DescriptionThe" not in description
    assert "accommodation.The" not in description
    # And the content survives the separator.
    assert "three storey building" in description
    assert "long lease" in description


@pytest.mark.parametrize("parse,description_class,title_class", CASES)
def test_no_two_words_are_run_together_anywhere_in_the_description(
    parse, description_class, title_class
):
    """A lowercase letter immediately followed by an uppercase one is the
    signature of two text nodes joined without a separator. Ordinary English
    prose in these listings does not produce it; "DescriptionThe" and
    "accommodation.The" both do."""
    listing = parse(page(description_class, title_class), "https://example.test/listing/1")
    description = listing.description or ""
    run_together = [
        description[i - 1 : i + 1]
        for i in range(1, len(description))
        if description[i - 1].islower() and description[i].isupper()
    ]
    assert run_together == []
