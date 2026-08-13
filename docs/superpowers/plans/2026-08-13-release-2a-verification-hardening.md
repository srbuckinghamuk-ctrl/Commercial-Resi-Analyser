# Release 2a — Verification & Ops Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two Alembic migrations discoverable and runnable, document the operator runbook for the real Docker database, and perform the live E2E/UAT pass on the York appraisal that Release 1 deferred.

**Architecture:** No formula or engine changes. Move the migration scripts into Alembic's default `migrations/versions/` discovery path, let tests inject a database URL through the Alembic config, and prove the chain runs on an empty database. Then execute a scripted browser UAT against `docker compose up` and record the results as a dated review doc.

**Tech Stack:** Python 3.12, Alembic (async SQLAlchemy env), pytest, FastAPI backend, React frontend, docker compose (Postgres 16), claude-in-chrome for the browser walkthrough.

## Global Constraints

- No calculation/engine file may change in R2a (spec: "No formula or engine changes").
- Gates at every commit: `python -m pytest -q` (repo root); frontend gates (`cd frontend && npx vitest run`, `npx tsc -p tsconfig.app.json --noEmit`, eslint, build) must pass before the release is called done — frontend deps need `npm install --legacy-peer-deps`.
- Never use bare `git stash` (shared stack).
- Design source: `docs/superpowers/specs/2026-08-13-release-2-design.md` §R2a.
- UAT prohibition: any defect found during UAT is fixed inside R2a (systematic-debugging + TDD), not deferred.

---

### Task 1: Alembic discovery — move migrations into `versions/` with a pinned test

**Files:**
- Create: `migrations/versions/` (via `git mv` of the two scripts)
- Move: `migrations/001_initial.py` → `migrations/versions/001_initial.py`
- Move: `migrations/002_appraisal_governance.py` → `migrations/versions/002_appraisal_governance.py`
- Modify: `migrations/env.py:20-22` (`get_url`)
- Test: `tests/test_alembic_migrations.py`

**Interfaces:**
- Consumes: `alembic.ini` (`script_location = migrations`), `app.persistence.database.Base`.
- Produces: `migrations/env.py::get_url()` that prefers a `sqlalchemy.url` set on the Alembic config over `get_settings().database_url` — Task 2's runbook and any future test rely on this override path.

- [ ] **Step 1: Write the failing test**

Create `tests/test_alembic_migrations.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/test_alembic_migrations.py -v`
Expected: both tests FAIL — `walk_revisions()` returns `[]` (scripts are not in `versions/`), and `command.upgrade` reports it cannot locate revision `head` (or upgrades nothing).

- [ ] **Step 3: Move the two migration scripts into `migrations/versions/`**

```bash
mkdir migrations/versions
git mv migrations/001_initial.py migrations/versions/001_initial.py
git mv migrations/002_appraisal_governance.py migrations/versions/002_appraisal_governance.py
```

Do not edit the scripts' contents — revision ids `001`/`002` and the `down_revision` chain stay exactly as they are.

- [ ] **Step 4: Let the Alembic config override the database URL**

In `migrations/env.py`, replace the current `get_url` (lines 20–22):

```python
def get_url() -> str:
    override = config.get_main_option("sqlalchemy.url")
    if override:
        return override
    settings = get_settings()
    return settings.database_url
```

(There is no `sqlalchemy.url` key in `alembic.ini`, so normal CLI use still resolves through `get_settings()` — only a caller that sets the option, like the test or an operator passing `-x`-style config, takes the override.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest tests/test_alembic_migrations.py -v`
Expected: PASS (2 tests). The upgrade test runs env.py's async path (`sqlite+aiosqlite`) — `aiosqlite` is already a test dependency.

- [ ] **Step 6: Run the full backend suite**

Run: `python -m pytest -q`
Expected: 155 passed (153 existing + 2 new), 0 failures.

- [ ] **Step 7: Commit**

```bash
git add migrations/versions tests/test_alembic_migrations.py migrations/env.py
git commit -m "fix: make Alembic migrations discoverable under migrations/versions"
```

---

### Task 2: Operator runbook for the existing Docker database

**Files:**
- Modify: `docs/financial-model/migration-notes.md` (§4 — the section that currently records the path gap)

**Interfaces:**
- Consumes: Task 1's layout (`migrations/versions/`) and env.py URL override.
- Produces: a runbook section other docs may link to as `migration-notes.md §4`.

- [ ] **Step 1: Rewrite §4 of `docs/financial-model/migration-notes.md`**

Replace the §4 text that records "scripts are not discoverable by Alembic's default version_locations" with a resolved status and this runbook (adjust the section heading to keep the doc's numbering):

```markdown
## 4. Alembic operations (resolved in R2a)

The migration scripts live in `migrations/versions/` and are discoverable by
Alembic's defaults (`alembic.ini` sets `script_location = migrations`). The app
still boots fresh databases via `Base.metadata.create_all`; Alembic is the
upgrade path for existing databases.

### Runbook — adopting Alembic on the existing Docker database

The only production database is the local docker compose Postgres volume
(`postgres_data`). Its schema was created by `create_all` and already matches
migration 002, so it must be *stamped*, not upgraded:

1. Back up the volume while the stack is stopped:
   `docker compose stop api && docker compose exec -T postgres pg_dump -U postgres commercial_resi > backup-$(date +%F).sql`
   (or snapshot the `postgres_data` volume).
2. Stamp the current revision without running any migration:
   `docker compose run --rm api alembic stamp head`
   (the api image contains `alembic.ini` and `migrations/`; `DATABASE_URL`
   in compose points at the postgres service).
3. Verify: `docker compose run --rm api alembic current` reports `002 (head)`.
4. From now on, schema changes ship as new scripts in `migrations/versions/`
   and are applied with `docker compose run --rm api alembic upgrade head`.

A database that predates migration 002 (does not have the governance columns
on `financial_appraisals`) must instead run
`alembic stamp 001` then `alembic upgrade head`.
```

If `docker compose run --rm api alembic ...` turns out not to work in Step 1 of the UAT (e.g. the api image lacks `alembic.ini`), fix the image (add the files in `Dockerfile`) inside this release and keep the runbook as written.

- [ ] **Step 2: Verify the doc builds no broken references**

Run: `git grep -n "not discoverable" docs/`
Expected: no remaining claims that the migrations are undiscoverable (update any other doc that repeats the old §4 claim, e.g. the Release 1 implementation report is historical and stays as-is — only forward-looking docs change).

- [ ] **Step 3: Commit**

```bash
git add docs/financial-model/migration-notes.md
git commit -m "docs: Alembic adoption runbook for the existing Docker database"
```

---

### Task 3: Live E2E/UAT pass on the York appraisal

**Files:**
- Create: `docs/reviews/2026-08-13-release-2a-uat.md`
- Create: `docs/reviews/assets/2026-08-13-release-2a/` (screenshots)

**Interfaces:**
- Consumes: the running stack (`docker compose up`, frontend :5173, API :8000), the real `postgres_data` volume holding the York appraisal, Task 2's runbook.
- Produces: the completed UAT review doc — R2a's exit artifact.

- [ ] **Step 1: Start the stack and confirm health**

```bash
docker compose up -d
docker compose ps
```

Expected: postgres healthy, api and frontend up. API answers: `curl -s http://localhost:8000/api/projects | head -c 200`.

- [ ] **Step 2: Execute the Alembic runbook against the real database**

Follow Task 2's runbook exactly: backup → `alembic stamp head` → `alembic current` shows `002 (head)`. Record each command and its output verbatim in the UAT doc. If any step fails, STOP and fix inside R2a (this is the runbook's live validation).

- [ ] **Step 3: Create the UAT doc skeleton**

Create `docs/reviews/2026-08-13-release-2a-uat.md`:

```markdown
# Release 2a live E2E/UAT — York appraisal

Date: 2026-08-13. Environment: docker compose (frontend :5173, API :8000,
postgres 16 `postgres_data` volume — the only real database).
Closes the verification limitation in
`docs/reviews/2026-08-13-release-1-implementation-report.md` §9.

## Checklist results

| # | Check | Expected | Observed | Verdict |
|---|-------|----------|----------|---------|
| 1 | Alembic runbook executed on real DB | stamp + current = 002 (head) | | |
| 2 | York appraisal loads in browser | project detail renders, no console errors | | |
| 3 | Status banner | red `legacy_unreconciled` banner visible | | |
| 4 | Mismatch list | reconciliation mismatch list rendered | | |
| 5 | Save → server recalc | status/hash transition per governance rules | | |
| 6 | Report watermark | report output watermarked per row status | | |

## Command transcripts

## Screenshots

## Defects found (fixed in R2a)

## Verdict
```

- [ ] **Step 4: Browser walkthrough — load the York appraisal**

Using claude-in-chrome against `http://localhost:5173`: find the York project in the project list, open its appraisal, screenshot the loaded page to `docs/reviews/assets/2026-08-13-release-2a/01-york-loaded.png`. Check the browser console for errors (`read_console_messages`). Fill checklist row 2.

- [ ] **Step 5: Verify the legacy banner and mismatch list**

On the York appraisal: confirm the red `legacy_unreconciled` banner and the reconciliation mismatch list are visible. Screenshots `02-legacy-banner.png`, `03-mismatch-list.png`. Fill rows 3–4. (If the row was already reconciled by earlier local testing, record the observed status honestly and verify the banner logic instead on a copy: flip the row's `status` to `legacy_unreconciled` via SQL in a transaction, observe, roll back — and note this in the doc.)

- [ ] **Step 6: Exercise save → server-side recalculation**

Make a trivial permitted edit (or re-save unchanged inputs), observe: the save round-trips, the server recalculates, and the status/hash transition follows the governance rules (`reconciled`/`draft` per migration-notes; hashes update). Verify via the API response and a direct SQL read of `status`, `input_hash`, `outputs_hash`, `calc_version`. Screenshot `04-post-save-status.png`. Fill row 5.

- [ ] **Step 7: Verify report watermarking**

Generate/preview the report for the York appraisal and confirm the watermark matches the row's status (per Release 1's safe-reports behaviour). Screenshot `05-report-watermark.png`. Fill row 6.

- [ ] **Step 8: Record defects and verdict**

Any defect found: fix it inside R2a using superpowers:systematic-debugging + TDD (failing test → fix → gates green → commit), then re-run the affected UAT step and record both the defect and fixing commit in the doc. Complete the Verdict section (pass/fail per check, overall statement).

- [ ] **Step 9: Run all gates**

```bash
python -m pytest -q
cd frontend && npx vitest run && npx tsc -p tsconfig.app.json --noEmit && npx eslint . && npm run build
```

Expected: all green (deps via `npm install --legacy-peer-deps` if node_modules is stale).

- [ ] **Step 10: Commit the UAT record**

```bash
git add docs/reviews/2026-08-13-release-2a-uat.md docs/reviews/assets/2026-08-13-release-2a
git commit -m "docs: Release 2a live E2E/UAT record — York appraisal walkthrough"
```

---

## Self-review notes

- Spec coverage: A1 (discovery fix + test + unchanged fresh-boot path) → Task 1; A1 runbook → Task 2; A2 (live UAT, screenshots, defects fixed in-release) → Task 3; R2a exit condition (UAT doc + all gates) → Task 3 Steps 8–10.
- The `docker compose run --rm api alembic ...` form is validated live in Task 3 Step 2; Task 2 records the contingency if the image lacks the files.
- No engine/calculation file is touched by any task, honouring the R2a constraint.
