"""Regenerate data/index-datasets/ons-construction-opi-<version>.json from the
ONS Construction Output Price Indices workbook (spec Sec 27.6, design
decision 9).

    python scripts/ons_opi_to_json.py <path-to-bulletindataset9.xlsx> \
        [--version 2026-Q2] [--publication-date 2026-08-13] \
        [--retrieved-at 2026-08-30] [--out data/index-datasets/ons-construction-opi-2026q2.json]

Requires `openpyxl`, which is deliberately NOT a project dependency (the
application never reads the workbook; only this maintenance script does):

    python -m pip install openpyxl

The script reads three sheets ('All construction', 'New work',
'Repair & maintenance'), header row 5, the 'Time period' column written as
'2014 Jan' for January and a bare month name for the rest of the year, and
takes the ten index columns (never the percentage-change columns). The
source-file SHA-256 is computed from the workbook itself and written into the
JSON so a reader can verify which file the numbers came from. Nothing is
downloaded: the workbook is a file a person retrieved (Sec 27.9 limitation 3).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

PUBLISHER = "Office for National Statistics"
TITLE_TEMPLATE = "Construction Output Price Indices (OPIs), {quarter_label}"
SOURCE_URL = (
    "https://www.ons.gov.uk/file?uri=/businessindustryandtrade/constructionindustry/datasets/"
    "interimconstructionoutputpriceindices/current/bulletindataset9.xlsx"
)
LANDING_PAGE = (
    "https://www.ons.gov.uk/businessindustryandtrade/constructionindustry/datasets/"
    "interimconstructionoutputpriceindices/current"
)
LICENCE = "Open Government Licence v3.0 (Crown copyright)"
BASE_PERIOD = "2015=100"
COVERAGE = "Great Britain"
FREQUENCY = "monthly index values, quarterly releases"
PROXY_STATEMENT = (
    "ONS Construction Output Price Index — a public currentisation proxy; "
    "not BCIS TPI and not an elemental-cost dataset."
)
HEADER_ROW = 5

# (series_code, series_name, sheet, a normalised prefix of the column header).
# Headers in the workbook carry stray newlines and double spaces; matching is
# on the whitespace-collapsed, lower-cased header starting with the prefix and
# containing 'index'.
SERIES: tuple[tuple[str, str, str, str], ...] = (
    ("all_new_work", "All new work", "All construction", "all new work"),
    ("all_repair_maintenance", "All repair and maintenance", "All construction",
     "all repair and maintenance"),
    ("all_construction", "All construction (new work and repair and maintenance)",
     "All construction", "all construction"),
    ("new_housing", "New work: housing (public and private)", "New work", "housing"),
    ("new_public_other", "New work: public (other than housing)", "New work", "public"),
    ("new_private_industrial", "New work: private industrial", "New work", "private industrial"),
    ("new_private_commercial", "New work: private commercial", "New work", "private commercial"),
    ("new_infrastructure", "New work: infrastructure", "New work", "infrastructure"),
    ("rm_housing", "Repair and maintenance: housing", "Repair & maintenance", "housing repair"),
    ("rm_non_housing", "Repair and maintenance: non-housing", "Repair & maintenance",
     "non-housing repair"),
)

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

QUARTER_LABELS = {
    "Q1": "Quarter 1 (January to March)",
    "Q2": "Quarter 2 (April to June)",
    "Q3": "Quarter 3 (July to September)",
    "Q4": "Quarter 4 (October to December)",
}


def _norm(header: object) -> str:
    return " ".join(str(header or "").split()).lower()


def _index_column(headers: list[object], prefix: str) -> int:
    for i, h in enumerate(headers):
        n = _norm(h)
        if n.startswith(prefix) and "index" in n and "percentage" not in n:
            return i
    raise SystemExit(f"no index column starting with {prefix!r} in {headers!r}")


def _periods(cells: list[object]) -> list[str]:
    """'2014 Jan', 'Feb', ... -> '2014-01', '2014-02', ... The year is carried
    forward until the next cell that names one."""
    out: list[str] = []
    year: int | None = None
    for cell in cells:
        text = str(cell or "").strip()
        if not text:
            break
        parts = text.split()
        if len(parts) == 2 and parts[0].isdigit():
            year = int(parts[0])
            month_text = parts[1]
        else:
            month_text = parts[0]
        if year is None:
            raise SystemExit(f"period {text!r} before any year")
        month = MONTHS.get(month_text[:3].lower())
        if month is None:
            raise SystemExit(f"unrecognised month {text!r}")
        out.append(f"{year:04d}-{month:02d}")
    return out


def extract(workbook_path: Path) -> list[dict]:
    try:
        import openpyxl  # noqa: PLC0415 -- optional, script-only dependency
    except ImportError:  # pragma: no cover - environment dependent
        raise SystemExit("openpyxl is required: python -m pip install openpyxl") from None

    wb = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    series_out: list[dict] = []
    for code, name, sheet, prefix in SERIES:
        ws = wb[sheet]
        rows = list(ws.iter_rows(min_row=HEADER_ROW, values_only=True))
        headers = list(rows[0])
        time_col = _index_column_named(headers, "time period")
        value_col = _index_column(headers, prefix)
        body = rows[1:]
        periods = _periods([r[time_col] for r in body])
        observations = []
        for period, row in zip(periods, body, strict=False):
            value = row[value_col]
            if value is None:
                raise SystemExit(f"{code}: no value at {period}")
            observations.append({"period": period, "value": float(value)})
        series_out.append({
            "series_code": code,
            "series_name": name,
            "sheet": sheet,
            "column_header": " ".join(str(headers[value_col]).split()),
            "observations": observations,
        })
    return series_out


def _index_column_named(headers: list[object], exact: str) -> int:
    for i, h in enumerate(headers):
        if _norm(h) == exact:
            return i
    raise SystemExit(f"no {exact!r} column in {headers!r}")


def build(workbook_path: Path, *, version: str, publication_date: str, retrieved_at: str) -> dict:
    sha = hashlib.sha256(workbook_path.read_bytes()).hexdigest()
    year, _, quarter = version.partition("-")
    quarter_label = f"{QUARTER_LABELS.get(quarter, quarter)} {year}"
    return {
        "publisher": PUBLISHER,
        "title": TITLE_TEMPLATE.format(quarter_label=quarter_label),
        "dataset_version": version,
        "source_url": SOURCE_URL,
        "landing_page": LANDING_PAGE,
        "publication_date": publication_date,
        "retrieved_at": retrieved_at,
        "source_file_sha256": sha,
        "licence": LICENCE,
        "base_period": BASE_PERIOD,
        "coverage": COVERAGE,
        "frequency": FREQUENCY,
        "proxy_statement": PROXY_STATEMENT,
        "series": extract(workbook_path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--version", default="2026-Q2")
    parser.add_argument("--publication-date", default="2026-08-13")
    parser.add_argument("--retrieved-at", default="2026-08-30")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    out = args.out or Path("data/index-datasets") / f"ons-construction-opi-{args.version.lower().replace('-', '')}.json"
    doc = build(
        args.workbook, version=args.version,
        publication_date=args.publication_date, retrieved_at=args.retrieved_at,
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = ", ".join(f"{s['series_code']}={len(s['observations'])}" for s in doc["series"])
    print(f"wrote {out} (sha256 {doc['source_file_sha256'][:12]}…): {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
