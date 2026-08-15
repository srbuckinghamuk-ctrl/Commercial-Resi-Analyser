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


def make_config(db_url: str) -> Config:
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def test_alembic_discovers_migration_chain():
    cfg = make_config("sqlite+aiosqlite:///:memory:")
    script = ScriptDirectory.from_config(cfg)
    # walk_revisions yields head-first
    assert [s.revision for s in script.walk_revisions()] == ["002", "001"]


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


def test_alembic_ini_has_no_hardcoded_url():
    """Without an explicit override, get_url() must fall through to settings —
    a stock sqlalchemy.url placeholder in alembic.ini would shadow it."""
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    assert not cfg.get_main_option("sqlalchemy.url")
