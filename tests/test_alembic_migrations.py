"""Alembic chain discovery and upgrade smoke tests (R2a Task A1).

Proves the two migration scripts are discoverable by Alembic's default
version_locations and that `upgrade head` runs end-to-end on an empty
database, producing the governance schema the ORM expects.
"""
import pathlib
import sqlite3

import pytest
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
    assert [s.revision for s in script.walk_revisions()] == [
        "008", "007", "006", "005", "004", "003", "002", "001",
    ]


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

        # Review round 2 recommendation: batch_alter_table (Alembic 007's
        # column drop, spec §26.3) rebuilds the SQLite table under the hood --
        # a real, if unlikely, way for a table's indexes to silently not
        # survive a batch operation. Pin that they do: both the plain lookup
        # index and the uniqueness constraint on `project_id` are present on
        # `head`, and the latter is still unique.
        indexes = {row[1]: row[2] for row in conn.execute("PRAGMA index_list(financial_appraisals)")}
        assert "ix_appraisal_project_id" in indexes
        assert "uq_appraisal_project_id" in indexes
        assert indexes["uq_appraisal_project_id"] == 1  # PRAGMA index_list's `unique` column

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


R17_TABLES = {
    "users", "benchmark_sets", "benchmark_rates", "index_datasets", "index_observations",
    "appraisal_versions",
}
R17_LENDER_CASE_COLUMNS = {
    "version", "created_by_user_id", "submitted_by_user_id", "reviewer_user_id",
    "decided_by_user_id",
}
R17_LENDER_CASE_EVENT_COLUMNS = {
    "actor_user_id", "idempotency_key", "reason", "input_snapshot_hash", "outputs_hash",
    "case_hash_after", "case_version_after",
}


def test_alembic_008_adds_the_r17_schema_and_keeps_the_lender_case_indexes(tmp_path):
    """R17 spec Sec 27.7. Both altered tables go through batch_alter_table
    (a rebuild on SQLite), so pin that their indexes -- the partial unique
    live-case index above all -- survive it, and that the new idempotency
    index is unique."""
    db = tmp_path / "alembic_008.sqlite"
    cfg = make_config(f"sqlite+aiosqlite:///{db}")
    command.upgrade(cfg, "head")
    conn = sqlite3.connect(db)
    try:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert R17_TABLES <= tables
        case_cols = {row[1] for row in conn.execute("PRAGMA table_info(lender_cases)")}
        assert R17_LENDER_CASE_COLUMNS <= case_cols
        event_cols = {row[1] for row in conn.execute("PRAGMA table_info(lender_case_events)")}
        assert R17_LENDER_CASE_EVENT_COLUMNS <= event_cols

        case_indexes = {row[1]: row[2] for row in conn.execute("PRAGMA index_list(lender_cases)")}
        assert "ix_lender_case_project_id" in case_indexes
        assert case_indexes["uq_lender_case_live_project"] == 1
        # The partial WHERE clause itself survived the rebuild.
        sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'uq_lender_case_live_project'"
        ).fetchone()[0]
        assert "superseded" in sql
        event_indexes = {
            row[1]: row[2] for row in conn.execute("PRAGMA index_list(lender_case_events)")
        }
        assert "ix_lender_case_event_case_id" in event_indexes
        assert event_indexes["uq_lender_case_event_idempotency"] == 1

        # NULL idempotency keys are distinct: two keyless events on one case
        # must both insert (every pre-R17 event is keyless).
        conn.execute(
            "INSERT INTO projects (id, address_raw, price_pence, use_class, stage) "
            "VALUES ('p1', 'x', 1, 'office', 'opportunity_identified')"
        )
        conn.execute(
            "INSERT INTO lender_cases (id, project_id, status, locked_inputs_snapshot, "
            "locked_calc_version, locked_inputs_version, locked_input_hash, "
            "locked_outputs_hash, locked_audit_hash, case_hash, created_by) "
            "VALUES ('c1', 'p1', 'draft', '{}', '2.18.0', 16, 'a', 'b', 'c', 'd', 'T')"
        )
        for _ in range(2):
            conn.execute(
                "INSERT INTO lender_case_events (case_id, to_status, actor) "
                "VALUES ('c1', 'draft', 'T')"
            )
        conn.execute(
            "INSERT INTO lender_case_events (case_id, to_status, actor, idempotency_key) "
            "VALUES ('c1', 'draft', 'T', 'k1')"
        )
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO lender_case_events (case_id, to_status, actor, idempotency_key) "
                "VALUES ('c1', 'draft', 'T', 'k1')"
            )
        assert conn.execute("SELECT version FROM lender_cases").fetchone()[0] == 1
    finally:
        conn.close()


def test_alembic_008_downgrade_to_007_removes_everything_it_added(tmp_path):
    db = tmp_path / "alembic_008_down.sqlite"
    cfg = make_config(f"sqlite+aiosqlite:///{db}")
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "007")
    conn = sqlite3.connect(db)
    try:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables.isdisjoint(R17_TABLES)
        assert {"lender_cases", "lender_case_events", "financial_appraisals"} <= tables
        case_cols = {row[1] for row in conn.execute("PRAGMA table_info(lender_cases)")}
        assert case_cols.isdisjoint(R17_LENDER_CASE_COLUMNS)
        assert "case_hash" in case_cols
        event_cols = {row[1] for row in conn.execute("PRAGMA table_info(lender_case_events)")}
        assert event_cols.isdisjoint(R17_LENDER_CASE_EVENT_COLUMNS)
        assert "actor" in event_cols
        case_indexes = {row[1]: row[2] for row in conn.execute("PRAGMA index_list(lender_cases)")}
        assert case_indexes["uq_lender_case_live_project"] == 1
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "007"
    finally:
        conn.close()


def test_alembic_ini_has_no_hardcoded_url():
    """Without an explicit override, get_url() must fall through to settings —
    a stock sqlalchemy.url placeholder in alembic.ini would shadow it."""
    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    assert not cfg.get_main_option("sqlalchemy.url")
