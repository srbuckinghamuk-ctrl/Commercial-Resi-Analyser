"""Alembic chain discovery and upgrade smoke tests (R2a Task A1).

Proves the two migration scripts are discoverable by Alembic's default
version_locations and that `upgrade head` runs end-to-end on an empty
database, producing the governance schema the ORM expects.
"""
import pathlib
import sqlite3

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]

GOVERNANCE_COLUMNS = {
    "outputs",
    "validation",
    "calc_version",
    "inputs_version",
    "status",
    "input_hash",
    "outputs_hash",
}

LEGACY_SUMMARY_COLUMNS = {
    "gdv_pence", "total_cost_pence", "profit_on_cost_pct", "profit_on_gdv_pct",
    "return_on_equity_pct", "irr", "rlv_pence",
}


def make_config(db_url: str) -> Config:
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def test_alembic_discovers_migration_chain():
    cfg = make_config("sqlite+aiosqlite:///:memory:")
    script = ScriptDirectory.from_config(cfg)
    # walk_revisions yields head-first. 003/004 arrived with the R4
    # reconciliation merge and were renumbered to sit after 002, which the
    # financial-model line had already claimed.
    assert [s.revision for s in script.walk_revisions()] == ["007", "006", "005", "004", "003", "002", "001"]


def test_alembic_upgrade_head_on_empty_sqlite(tmp_path):
    db = tmp_path / "alembic_smoke.sqlite"
    cfg = make_config(f"sqlite+aiosqlite:///{db}")
    command.upgrade(cfg, "head")

    conn = sqlite3.connect(db)
    try:
        cols = {
            row[1]
            for row in conn.execute("PRAGMA table_info(financial_appraisals)")
        }
        assert GOVERNANCE_COLUMNS <= cols
        assert cols.isdisjoint(LEGACY_SUMMARY_COLUMNS)

        from app.persistence.database import Base

        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        assert set(Base.metadata.tables) <= tables
    finally:
        conn.close()


def test_alembic_007_downgrade_restores_the_seven_columns_nullable(tmp_path):
    """R16b spec Sec 26.3. Lossy by construction: the columns come back, null."""
    db = tmp_path / "alembic_007.sqlite"
    cfg = make_config(f"sqlite+aiosqlite:///{db}")
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "006")
    conn = sqlite3.connect(db)
    try:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(financial_appraisals)")}
        assert LEGACY_SUMMARY_COLUMNS <= cols
        assert GOVERNANCE_COLUMNS <= cols
    finally:
        conn.close()


def test_alembic_ini_has_no_hardcoded_url():
    """Without an explicit override, get_url() must fall through to settings —
    a stock sqlalchemy.url placeholder in alembic.ini would shadow it."""
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    assert not cfg.get_main_option("sqlalchemy.url")
