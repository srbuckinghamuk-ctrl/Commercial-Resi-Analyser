"""Article 4 direction lookup against a small bundled dataset.

The bundled dataset covers only a handful of LPAs, so lookups distinguish
three outcomes:

1. LPA in dataset, with directions      -> possible Article 4 restriction
2. LPA in dataset, no directions        -> no known direction (dataset-backed)
3. LPA NOT in dataset (or no LPA code)  -> unknown; must be checked manually

Only outcome 2 may ever be treated as a dataset-backed "no direction".
The dataset is loaded once at import time (avoids blocking file I/O inside
the async event loop).
"""
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

DATASET_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "article4_directions.json"


def _load_dataset() -> dict:
    try:
        with open(DATASET_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning("Article 4 dataset not found at %s", DATASET_PATH)
        return {}


# Loaded eagerly at import so lookup_article4 never does sync file I/O
# inside the event loop.
_dataset: dict = _load_dataset()


@dataclass(frozen=True)
class Article4Direction:
    name: str
    pdr_classes_restricted: list[str]
    date_made: str | None = None
    coverage: str = ""


@dataclass(frozen=True)
class Article4Result:
    lpa_code: str
    lpa_name: str
    lpa_in_dataset: bool
    has_article4: bool
    directions: list[Article4Direction] = field(default_factory=list)
    note: str = ""


async def lookup_article4(lpa_code: str) -> Article4Result:
    if not lpa_code:
        return Article4Result(
            lpa_code="",
            lpa_name="",
            lpa_in_dataset=False,
            has_article4=False,
            note="No LPA code provided — verify with the local planning authority.",
        )
    entry = _dataset.get(lpa_code)
    if entry is None:
        return Article4Result(
            lpa_code=lpa_code,
            lpa_name="",
            lpa_in_dataset=False,
            has_article4=False,
            note=(
                "This council is not in the bundled Article 4 dataset — "
                "check the LPA's Article 4 register."
            ),
        )
    directions = [
        Article4Direction(
            name=d["name"],
            pdr_classes_restricted=d.get("pdr_classes_restricted", []),
            date_made=d.get("date_made"),
            coverage=d.get("coverage", ""),
        )
        for d in entry.get("directions", [])
    ]
    if directions:
        note = "Article 4 direction found — PDR may be restricted. Verify current status with the LPA."
    else:
        note = "No Article 4 direction recorded for this LPA in the bundled dataset."
    return Article4Result(
        lpa_code=lpa_code,
        lpa_name=entry.get("lpa_name", ""),
        lpa_in_dataset=True,
        has_article4=len(directions) > 0,
        directions=directions,
        note=note,
    )
