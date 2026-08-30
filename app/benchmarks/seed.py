"""Seed the index-dataset library from the repository's data files
(spec Sec 27.6, design decision 9, Sec 27.9 limitation 3).

    python -m app.benchmarks.seed [--dir data/index-datasets]

Reads every `*.json` in the directory -- each one a publisher's release with
a `series` list -- and inserts one `index_datasets` row per series, keyed by
`(publisher, series_code, dataset_version)`. A key that already exists is
skipped, so the command is idempotent: a second run inserts nothing. Nothing
is downloaded; refreshing a series means a person retrieving the source file,
regenerating the JSON (scripts/ons_opi_to_json.py) and running this again
with the new dataset_version. Elemental benchmark sets are never seeded
(decision 10): the library ships empty of rates.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.benchmarks.index_import import index_content_hash, validate_observations
from app.persistence.repositories import IndexDatasetRepository

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "data" / "index-datasets"


@dataclass
class SeedReport:
    inserted: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    @property
    def inserted_count(self) -> int:
        return len(self.inserted)

    @property
    def skipped_count(self) -> int:
        return len(self.skipped)


def _series_header(release: dict[str, Any], series: dict[str, Any]) -> dict[str, Any]:
    """The `index_datasets` header for one series of a release document."""
    notes_parts = [release.get("title") or "", release.get("proxy_statement") or ""]
    if series.get("sheet") or series.get("column_header"):
        notes_parts.append(
            f"Source sheet '{series.get('sheet', '')}', column '{series.get('column_header', '')}'."
        )
    return {
        "publisher": release["publisher"],
        "series_code": series["series_code"],
        "series_name": series.get("series_name") or series["series_code"],
        "dataset_version": release["dataset_version"],
        "source_url": release.get("source_url") or "",
        "licence": release.get("licence") or "",
        "publication_date": release.get("publication_date"),
        "retrieved_at": release.get("retrieved_at"),
        "base_period": release.get("base_period") or "",
        "notes": " ".join(p for p in notes_parts if p),
    }


async def seed_file(db: AsyncSession, path: Path, report: SeedReport | None = None) -> SeedReport:
    """Insert every series in one release file that is not already present.
    Flushes only; the caller commits."""
    report = report or SeedReport()
    release = json.loads(path.read_text(encoding="utf-8"))
    repo = IndexDatasetRepository(db)
    for series in release.get("series") or []:
        header = _series_header(release, series)
        key = f"{header['publisher']} / {header['series_code']} / {header['dataset_version']}"
        existing = await repo.find_version(
            header["publisher"], header["series_code"], header["dataset_version"]
        )
        if existing is not None:
            report.skipped.append(key)
            continue
        observations = validate_observations(series.get("observations") or [])
        await repo.create(
            header,
            observations,
            content_hash=index_content_hash(header, observations),
            imported_by=f"seed: {path.name}",
            source_file_sha256=release.get("source_file_sha256"),
        )
        report.inserted.append(key)
    return report


async def seed_directory(db: AsyncSession, directory: Path = DEFAULT_DIR) -> SeedReport:
    """Seed every `*.json` in `directory`, in name order. Flushes only."""
    report = SeedReport()
    for path in sorted(directory.glob("*.json")):
        await seed_file(db, path, report)
    return report


async def _run(directory: Path) -> SeedReport:
    from app.persistence.database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        report = await seed_directory(session, directory)
        await session.commit()
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    args = parser.parse_args(argv)
    report = asyncio.run(_run(args.dir))
    for key in report.inserted:
        print(f"inserted  {key}")
    for key in report.skipped:
        print(f"skipped   {key} (already present)")
    print(f"{report.inserted_count} inserted, {report.skipped_count} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
