import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

DATASET_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "article4_directions.json"

_dataset: dict | None = None


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
    has_article4: bool
    directions: list[Article4Direction] = field(default_factory=list)
    note: str = ""


def _load_dataset() -> dict:
    global _dataset
    if _dataset is not None:
        return _dataset
    try:
        with open(DATASET_PATH, "r", encoding="utf-8") as f:
            _dataset = json.load(f)
        return _dataset
    except FileNotFoundError:
        logger.warning("Article 4 dataset not found at %s", DATASET_PATH)
        _dataset = {}
        return _dataset


async def lookup_article4(lpa_code: str) -> Article4Result:
    if not lpa_code:
        return Article4Result(
            lpa_code="",
            lpa_name="",
            has_article4=False,
            note="No LPA code provided — verify with the local planning authority.",
        )
    dataset = _load_dataset()
    entry = dataset.get(lpa_code)
    if not entry:
        return Article4Result(
            lpa_code=lpa_code,
            lpa_name="",
            has_article4=False,
            note="No Article 4 direction found in dataset — verify with the local planning authority as dataset may not be exhaustive.",
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
    return Article4Result(
        lpa_code=lpa_code,
        lpa_name=entry.get("lpa_name", ""),
        has_article4=len(directions) > 0,
        directions=directions,
        note="Article 4 direction found — PDR may be restricted. Verify current status with the LPA.",
    )
