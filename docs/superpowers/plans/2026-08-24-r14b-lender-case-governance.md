# R14b — Lender Case Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a locked lender case (snapshot, reviewer, approval state, derived staleness, append-only change log) with a server-enforced state machine, a chained `case_hash`, a Python governance twin of `report-provenance.ts`, and the UI/memo wiring that makes the product's first FINAL document possible.

**Architecture:** Two new tables (`lender_cases` + append-only `lender_case_events`, migration 006) keyed by `project_id`; a `/lender-cases` FastAPI router whose transition endpoint validates against a normative `ALLOWED_TRANSITIONS` table defined once per language (`app/financial_model/provenance.py`, new — the first Python governance module — and `report-provenance.ts`); staleness derived at read time (`input_hash != locked_input_hash`), never stored; `audit_hash` untouched, with a new `case_hash` chained onto it; new calculator page 16 owns its own data; `ExportPage` finally passes a real lender case into `buildProvenance`.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic (Python 3.12, pytest asyncio_mode=auto), React 19 + TypeScript + vitest (jsdom), jsPDF memo.

**Spec:** `docs/superpowers/specs/2026-08-24-r14b-lender-case-governance-design.md` (the design doc; the calculation spec's §13/§21 edits are Task 10). Read it before starting.

## Global Constraints

- Branch: create `r14b-lender-case-governance` off `main` before Task 1; every task commits there. Commit prefixes: `feat(r14b):`, `test(r14b):`, `docs(r14b):`.
- **No `CALC_VERSION` bump** (stays `2.13.0`) and **no inputs-version bump** (stays v11). `frontend/src/lib/model/spec-versions.test.ts` must stay green **untouched** — if it goes red you have moved a constant this release promised not to move.
- **`audit_hash` (§13.2) gains no new parts.** Its six-part formula, `app/financial_model/hashing.py:audit_hash`, and every existing test pinning it are untouched.
- **No golden-fixture or corpus change.** `fixtures/financial-model/` and both corpus-walk rosters are untouched; both corpus suites must pass unmodified.
- The engine (`run_appraisal` / `runAppraisal`, `deriveMetrics`, `FlagCode`) is untouched — this release has no arithmetic.
- Staleness is **derived, never stored**. No `stale` column anywhere.
- Free-text actor fields follow the `LenderValuation.author` idiom (`Field(min_length=1)` server-side).
- Repositories `flush()`; **endpoints** commit — the house rule.
- Comments that lie are defects: any comment your change makes false gets rewritten in the same commit.
- Python: run tests from repo root with `python -m pytest tests/<file> -q`. Frontend: from `frontend/`, `npm test` (all) or `npx vitest run <path>` (one file); `npm run lint` is `eslint . --max-warnings 0`; `npm run build` is `tsc -b && vite build`.

---

### Task 1: Python governance twin — `app/financial_model/provenance.py`

**Files:**
- Create: `app/financial_model/provenance.py`
- Create: `tests/test_provenance.py`
- Modify: `tests/test_appraisal_governance.py` (~line 371 — the docstring sentence "Python has no DraftReason union -- that governance (spec Sec 13/Sec 14) lives entirely in report-provenance.ts on the frontend")

**Interfaces:**
- Consumes: nothing (leaf module; no imports from the engine).
- Produces (Tasks 4, 5 import these): `LenderCaseStatus` (Literal), `APPROVED_STATUSES: tuple`, `ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]]`, `DraftReason` (Literal, six members), `draft_reason(...) -> str | None`, `document_status(...) -> str`, `is_stale(current_input_hash: str | None, locked_input_hash: str) -> bool`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_provenance.py`:

```python
"""R14b: the Python governance twin of frontend/src/lib/report-provenance.ts.

Every case here mirrors a case in report-provenance.test.ts (and the R14b
additions Task 6 makes there) so the two engines' governance answers are
pinned against each other case-for-case, the same discipline the metric
engines use. The ordering diagonals matter most: each is a case where a
wrong order would silently produce a *plausible* wrong banner.
"""
from app.financial_model.provenance import (
    ALLOWED_TRANSITIONS,
    APPROVED_STATUSES,
    document_status,
    draft_reason,
    is_stale,
)


class TestDraftReasonOrdering:
    def test_unreconciled_wins_over_everything(self):
        assert draft_reason(
            report_safe=False, senior_repaid=False, lender_case_status=None,
            tax_basis_confirmed=False, vat_basis_confirmed=False,
            lender_case_stale=True,
        ) == "unreconciled"

    def test_senior_not_repaid_is_second(self):
        assert draft_reason(
            report_safe=True, senior_repaid=False, lender_case_status=None,
        ) == "senior_not_repaid"

    def test_tax_gate_sits_above_not_approved(self):
        # The R8 diagonal, now pinned in Python too: with no lender case in
        # existence, not_approved would otherwise win every time and the tax
        # gate would be unreachable dead code.
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status=None,
            tax_basis_confirmed=False,
        ) == "tax_basis_unconfirmed"

    def test_vat_gate_sits_between_tax_and_approval(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status=None,
            vat_basis_confirmed=False,
        ) == "vat_basis_unconfirmed"

    def test_no_case_is_not_approved(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status=None,
        ) == "not_approved"

    def test_unapproved_case_is_not_approved(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True, lender_case_status="under_review",
        ) == "not_approved"

    def test_approved_and_current_is_final(self):
        for status in APPROVED_STATUSES:
            assert draft_reason(
                report_safe=True, senior_repaid=True, lender_case_status=status,
            ) is None

    def test_approved_but_stale_is_lender_case_stale(self):
        # The R14b diagonal: an approved case whose document has moved must
        # not print FINAL over figures the lender never saw (spec Sec 21.3).
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved", lender_case_stale=True,
        ) == "lender_case_stale"

    def test_stale_never_outranks_not_approved(self):
        # Mutually exclusive by construction: an UNapproved stale case reports
        # not_approved -- staleness only qualifies an approval that exists.
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="declined", lender_case_stale=True,
        ) == "not_approved"

    def test_stale_never_outranks_the_basis_gates(self):
        assert draft_reason(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved", lender_case_stale=True,
            tax_basis_confirmed=False,
        ) == "tax_basis_unconfirmed"


class TestDocumentStatus:
    def test_final_only_when_no_reason(self):
        assert document_status(
            report_safe=True, senior_repaid=True,
            lender_case_status="approved_with_conditions",
        ) == "FINAL"

    def test_draft_otherwise(self):
        assert document_status(
            report_safe=True, senior_repaid=True,
            lender_case_status="credit_approved", lender_case_stale=True,
        ) == "DRAFT"


class TestStale:
    def test_matching_hash_is_current(self):
        assert is_stale("a" * 64, "a" * 64) is False

    def test_differing_hash_is_stale(self):
        assert is_stale("a" * 64, "b" * 64) is True

    def test_absent_current_hash_is_stale(self):
        # A row stripped of its hash cannot demonstrate it is the approved one.
        assert is_stale(None, "a" * 64) is True


class TestAllowedTransitions:
    def test_the_table_is_exactly_the_spec_sec_21_2_table(self):
        # Restated literally rather than derived, and mirrored literally in
        # report-provenance.test.ts -- the point is that a drive-by edit to
        # either language's table fails a test naming the whole machine.
        assert ALLOWED_TRANSITIONS == {
            "draft": ("submitted", "superseded"),
            "submitted": ("under_review", "superseded"),
            "under_review": (
                "information_required", "credit_approved",
                "approved_with_conditions", "declined", "superseded",
            ),
            "information_required": ("under_review", "superseded"),
            "credit_approved": ("superseded",),
            "approved_with_conditions": ("superseded",),
            "declined": ("superseded",),
            "superseded": (),
        }

    def test_superseded_is_terminal_and_universal(self):
        for status, allowed in ALLOWED_TRANSITIONS.items():
            if status == "superseded":
                assert allowed == ()
            else:
                assert "superseded" in allowed
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_provenance.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.financial_model.provenance'`

- [ ] **Step 3: Write the module**

Create `app/financial_model/provenance.py`:

```python
"""Lender-case governance (spec Sec 13.3, Sec 21) -- the Python twin.

Port of the governance core of frontend/src/lib/report-provenance.ts (R14b),
line for line where the languages allow, under the same parity contract as
monitoring.py: a change to either side's rules is made to both in one change,
and tests/test_provenance.py mirrors report-provenance.test.ts case-for-case.

Until R14b this governance lived in TypeScript only; making the lender case
server state with server-enforced transitions is what forced the twin into
existence -- the API cannot validate a state machine that exists only in the
client.
"""
from __future__ import annotations

from typing import Literal

LenderCaseStatus = Literal[
    "draft", "submitted", "under_review", "information_required",
    "credit_approved", "approved_with_conditions", "declined", "superseded",
]

#: The lender-case statuses that permit a FINAL document (spec Sec 13.3).
APPROVED_STATUSES: tuple[str, ...] = ("credit_approved", "approved_with_conditions")

#: Spec Sec 21.2, normative. Keys are the current status; values are every
#: status a transition may move to. `superseded` is the universal exit and is
#: itself terminal. Mirrored literally in report-provenance.ts.
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "draft": ("submitted", "superseded"),
    "submitted": ("under_review", "superseded"),
    "under_review": (
        "information_required", "credit_approved",
        "approved_with_conditions", "declined", "superseded",
    ),
    "information_required": ("under_review", "superseded"),
    "credit_approved": ("superseded",),
    "approved_with_conditions": ("superseded",),
    "declined": ("superseded",),
    "superseded": (),
}

DraftReason = Literal[
    "unreconciled", "senior_not_repaid", "tax_basis_unconfirmed",
    "vat_basis_unconfirmed", "not_approved", "lender_case_stale",
]


def is_stale(current_input_hash: str | None, locked_input_hash: str) -> bool:
    """Spec Sec 21.3. Derived at read time, never stored: the live appraisal
    row's input hash no longer matches the one the case locked. A row with no
    hash at all cannot demonstrate it is the approved document, so it is
    stale too."""
    return current_input_hash != locked_input_hash


def draft_reason(
    *,
    report_safe: bool,
    senior_repaid: bool,
    lender_case_status: str | None,
    tax_basis_confirmed: bool = True,
    vat_basis_confirmed: bool = True,
    lender_case_stale: bool = False,
) -> str | None:
    """Spec Sec 13.3's six conditions, in their load-bearing order -- the port
    of report-provenance.ts's draftReason. See that function's comments for
    why each gate sits where it does; the R14b addition is the last: an
    approved case whose document has moved must not print FINAL over figures
    the lender never saw, and it fires only when an approval exists, so it is
    mutually exclusive with not_approved by construction."""
    if not report_safe:
        return "unreconciled"
    if not senior_repaid:
        return "senior_not_repaid"
    if not tax_basis_confirmed:
        return "tax_basis_unconfirmed"
    if not vat_basis_confirmed:
        return "vat_basis_unconfirmed"
    if lender_case_status is None or lender_case_status not in APPROVED_STATUSES:
        return "not_approved"
    if lender_case_stale:
        return "lender_case_stale"
    return None


def document_status(
    *,
    report_safe: bool,
    senior_repaid: bool,
    lender_case_status: str | None,
    tax_basis_confirmed: bool = True,
    vat_basis_confirmed: bool = True,
    lender_case_stale: bool = False,
) -> str:
    """'FINAL' only when every Sec 13.3 condition holds; 'DRAFT' otherwise."""
    reason = draft_reason(
        report_safe=report_safe,
        senior_repaid=senior_repaid,
        lender_case_status=lender_case_status,
        tax_basis_confirmed=tax_basis_confirmed,
        vat_basis_confirmed=vat_basis_confirmed,
        lender_case_stale=lender_case_stale,
    )
    return "FINAL" if reason is None else "DRAFT"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_provenance.py -q`
Expected: PASS (all)

- [ ] **Step 5: Kill the comment the twin makes false**

In `tests/test_appraisal_governance.py` (~line 371), the docstring of `test_area_bridge_large_unallocated_balance_stays_reconciled` says "Python has no DraftReason union -- that governance (spec Sec 13/Sec 14) lives entirely in report-provenance.ts on the frontend." Replace that sentence (keep the rest of the docstring) with:

```
    R14b gave Python its own DraftReason twin (app/financial_model/
    provenance.py), but the area-bridge rule is unchanged: the Python-
    observable mirror of "does not gate the document" is that the persisted
    `status` stays 'reconciled' ...
```

(splice so the following sentence still reads naturally). Run `python -m pytest tests/test_appraisal_governance.py -q` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/provenance.py tests/test_provenance.py tests/test_appraisal_governance.py
git commit -m "feat(r14b): Python governance twin - provenance.py (spec 13.3, 21.2)"
```

---

### Task 2: `case_hash` in `hashing.py`, plus two lying comments

**Files:**
- Modify: `app/financial_model/hashing.py`
- Modify: `tests/test_provenance.py` (append hash tests)
- Modify: `app/api/app.py` (~line 592: comment "migration 004 adds the unique constraint" — it is **003**; see `migrations/versions/003_unique_project_refs_and_ruleset_version.py:57-62`)

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 4, 5): `case_hash(*, case_id: str, project_id: str, status: str, submitted_by: str | None, reviewer: str | None, decided_by: str | None, decided_at: datetime | None, locked_audit_hash: str) -> str` and `_utc_iso(dt: datetime | None) -> str`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_provenance.py`)

```python
from datetime import datetime, timezone
import hashlib

from app.financial_model.hashing import case_hash, _utc_iso


class TestCaseHash:
    def test_recomputable_from_the_printed_parts(self):
        # Spec Sec 21.4: derived here independently -- sha256 over the joined
        # tuple -- rather than by calling the helper's own internals, the
        # same discipline test_audit_hash_binds_inputs_outputs_and_status
        # uses for the audit hash.
        decided = datetime(2026, 8, 24, 12, 30, 45, 123456, tzinfo=timezone.utc)
        value = case_hash(
            case_id="c1", project_id="p1", status="credit_approved",
            submitted_by="S. Sponsor", reviewer="R. Reviewer",
            decided_by="D. Director", decided_at=decided,
            locked_audit_hash="e" * 64,
        )
        expected = hashlib.sha256("|".join([
            "c1", "p1", "credit_approved", "S. Sponsor", "R. Reviewer",
            "D. Director", "2026-08-24T12:30:45.123456Z", "e" * 64,
        ]).encode()).hexdigest()
        assert value == expected

    def test_absent_parts_encode_as_empty_strings(self):
        value = case_hash(
            case_id="c1", project_id="p1", status="draft",
            submitted_by=None, reviewer=None, decided_by=None,
            decided_at=None, locked_audit_hash="e" * 64,
        )
        expected = hashlib.sha256(
            ("c1|p1|draft||||" + "|" + "e" * 64).encode()
        ).hexdigest()
        assert value == expected

    def test_moves_with_status_alone(self):
        common = dict(
            case_id="c1", project_id="p1", submitted_by=None, reviewer=None,
            decided_by=None, decided_at=None, locked_audit_hash="e" * 64,
        )
        assert case_hash(status="draft", **common) != case_hash(status="submitted", **common)

    def test_naive_and_aware_utc_datetimes_hash_identically(self):
        # sqlite hands back naive datetimes for DateTime(timezone=True)
        # columns; the write path hashes the aware value it just built. The
        # canonicaliser treats naive as UTC so a re-read recomputation agrees
        # byte for byte with the write-time value.
        aware = datetime(2026, 8, 24, 12, 30, 45, 123456, tzinfo=timezone.utc)
        naive = datetime(2026, 8, 24, 12, 30, 45, 123456)
        assert _utc_iso(aware) == _utc_iso(naive) == "2026-08-24T12:30:45.123456Z"
        assert _utc_iso(None) == ""
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_provenance.py -q`
Expected: FAIL — `ImportError: cannot import name 'case_hash'`

- [ ] **Step 3: Implement** (append to `app/financial_model/hashing.py`)

```python
def _utc_iso(dt) -> str:
    """Canonical UTC ISO-8601 for hashing (spec Sec 21.4): naive datetimes are
    treated as UTC (sqlite returns rows naive that were written aware), always
    rendered with microseconds and a literal 'Z', so a write-time hash and a
    re-read recomputation agree byte for byte."""
    from datetime import timezone

    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def case_hash(
    *,
    case_id: str,
    project_id: str,
    status: str,
    submitted_by: str | None,
    reviewer: str | None,
    decided_by: str | None,
    decided_at,
    locked_audit_hash: str,
) -> str:
    """Spec Sec 21.4 -- the lender case's own hash, chained onto the audit
    hash rather than extending it: audit_hash's Sec 13.2 formula "gains no
    new parts", and a case transition happens without an appraisal re-save,
    so folding case state into audit_hash would silently invalidate stored
    hashes. Every component is printed on the provenance panel; absent parts
    are the empty string; decided_at is canonical UTC ISO-8601 (_utc_iso).
    `locked_audit_hash` is what binds the case to the exact document the
    lender reviewed."""
    parts = [
        case_id,
        project_id,
        status,
        submitted_by or "",
        reviewer or "",
        decided_by or "",
        _utc_iso(decided_at),
        locked_audit_hash,
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()
```

Also in this file's `audit_hash` docstring (~line 44), fix "migration 004 made the appraisal unique per project" → "migration 003 made the appraisal unique per project", and in `app/api/app.py` (~line 592) fix "(migration 004 adds the unique constraint)" → "(migration 003 adds the unique constraint)".

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_provenance.py tests/test_appraisal_governance.py -q`
Expected: PASS (the governance suite proves the audit-hash edit broke nothing)

- [ ] **Step 5: Commit**

```bash
git add app/financial_model/hashing.py tests/test_provenance.py app/api/app.py
git commit -m "feat(r14b): case_hash chained onto the audit hash (spec 21.4); fix two 004-for-003 comments"
```

---

### Task 3: ORM tables, migration 006, schema tests

**Files:**
- Modify: `app/persistence/database.py` (two new ORM classes + `ProjectORM.lender_cases` relationship; add `text` to the `sqlalchemy` import list)
- Create: `migrations/versions/006_lender_case_governance.py`
- Modify: `tests/test_orm_tables.py`, `tests/test_alembic_migrations.py`
- Create: `tests/test_lender_case_governance.py` (starts with the DB-level partial-index test; Tasks 4–5 extend it)

**Interfaces:**
- Consumes: nothing new.
- Produces (Tasks 4, 5): `LenderCaseORM` (table `lender_cases`), `LenderCaseEventORM` (table `lender_case_events`, **integer autoincrement PK** — a deliberate deviation from `StageTransitionORM`'s UUID so same-second events keep a deterministic order; say so in a comment).

- [ ] **Step 1: Write the failing schema tests**

Append to `tests/test_orm_tables.py` (extend the existing imports with `LenderCaseORM, LenderCaseEventORM`):

```python
class TestLenderCaseORM:
    def test_table_name(self):
        assert LenderCaseORM.__tablename__ == "lender_cases"

    def test_has_required_columns(self):
        col_names = {c.name for c in LenderCaseORM.__table__.columns}
        required = {
            "id", "project_id", "status",
            "locked_inputs_snapshot", "locked_calc_version", "locked_inputs_version",
            "locked_input_hash", "locked_outputs_hash", "locked_audit_hash",
            "case_hash", "created_by", "submitted_by", "reviewer", "decided_by",
            "conditions", "submitted_at", "decided_at", "created_at", "updated_at",
        }
        assert required.issubset(col_names)

    def test_live_case_index_is_partial_and_unique(self):
        idx = next(i for i in LenderCaseORM.__table__.indexes
                   if i.name == "uq_lender_case_live_project")
        assert idx.unique
        # Declared for BOTH dialects so Alembic and the create_all boot path
        # agree on every backend the app runs on. (`sqlite_where=`/`
        # `postgresql_where=` kwargs surface as the "where" dialect option.)
        assert idx.dialect_options["sqlite"]["where"] is not None
        assert idx.dialect_options["postgresql"]["where"] is not None


class TestLenderCaseEventORM:
    def test_table_name(self):
        assert LenderCaseEventORM.__tablename__ == "lender_case_events"

    def test_has_required_columns(self):
        col_names = {c.name for c in LenderCaseEventORM.__table__.columns}
        required = {"id", "case_id", "from_status", "to_status", "actor", "note", "occurred_at"}
        assert required.issubset(col_names)
```

In `TestCascadeRelationships.test_project_has_relationships` add `assert "lender_cases" in rel_names`. In `TestBaseMetadata.test_all_tables_registered` add `"lender_cases", "lender_case_events"` to `expected`.

In `tests/test_alembic_migrations.py:40` change the walk assertion to `["006", "005", "004", "003", "002", "001"]`. (`GOVERNANCE_COLUMNS` is unchanged — no appraisal columns this release.)

Create `tests/test_lender_case_governance.py` with the DB-level invariant test (the endpoint fixtures arrive in Task 4 — keep this file self-contained from the start):

```python
"""R14b: lender case governance (spec Sec 21) -- persistence invariants and,
from Task 4 on, the /lender-cases endpoints end-to-end against in-memory
sqlite, the test_appraisal_governance.py pattern."""
import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.persistence.database import Base, LenderCaseORM


@pytest.fixture
async def db_engine():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


def _case_row(project_id, status: str) -> LenderCaseORM:
    return LenderCaseORM(
        project_id=project_id, status=status,
        locked_inputs_snapshot={}, locked_calc_version="2.13.0",
        locked_inputs_version=11, locked_input_hash="a" * 64,
        locked_outputs_hash="b" * 64, locked_audit_hash="c" * 64,
        case_hash="d" * 64, created_by="T. Test",
    )


async def test_second_live_case_is_refused_by_the_database(db_engine):
    """The partial unique index itself, not the endpoint's 409 twin: two
    non-superseded cases for one project must be an IntegrityError."""
    from uuid import uuid4
    from app.persistence.database import ProjectORM

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        project = ProjectORM(
            id=uuid4(), address_raw="1 Test Street", price_pence=1, use_class="office",
        )
        session.add(project)
        await session.flush()
        session.add(_case_row(project.id, "superseded"))
        session.add(_case_row(project.id, "draft"))
        await session.flush()  # superseded + one live: fine
        session.add(_case_row(project.id, "submitted"))
        with pytest.raises(IntegrityError):
            await session.flush()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_orm_tables.py tests/test_alembic_migrations.py tests/test_lender_case_governance.py -q`
Expected: FAIL — `ImportError: cannot import name 'LenderCaseORM'` and the walk-list mismatch.

- [ ] **Step 3: Add the ORM classes**

In `app/persistence/database.py`: add `text` to the `from sqlalchemy import (...)` list, then append after `StageTransitionORM`:

```python
class LenderCaseORM(Base):
    """R14b (spec Sec 21). A locked lender snapshot with governance state.
    Keyed by project (the Sec 13.2 record-identity reasoning); superseded
    rows remain as history, and at most one live case may exist per project
    -- enforced by the partial unique index below, declared for both dialects
    so Alembic and the lifespan create_all agree everywhere."""

    __tablename__ = "lender_cases"
    __table_args__ = (
        Index("ix_lender_case_project_id", "project_id"),
        Index(
            "uq_lender_case_live_project", "project_id", unique=True,
            postgresql_where=text("status != 'superseded'"),
            sqlite_where=text("status != 'superseded'"),
        ),
    )

    id: Mapped[uuid4] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    # -- the lock, copied from the stored appraisal at creation; never rewritten --
    locked_inputs_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    locked_calc_version: Mapped[str] = mapped_column(String(32), nullable=False)
    locked_inputs_version: Mapped[int] = mapped_column(Integer, nullable=False)
    locked_input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    locked_outputs_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Not-null enforces spec Sec 21.1: no case on a pre-provenance appraisal.
    locked_audit_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Spec Sec 21.4 -- recomputed on every transition.
    case_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[str] = mapped_column(String(256), nullable=False)
    submitted_by: Mapped[str | None] = mapped_column(String(256))
    reviewer: Mapped[str | None] = mapped_column(String(256))
    decided_by: Mapped[str | None] = mapped_column(String(256))
    conditions: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["ProjectORM"] = relationship(back_populates="lender_cases")
    events: Mapped[list["LenderCaseEventORM"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )


class LenderCaseEventORM(Base):
    """Append-only change log (spec Sec 21.5), the stage_transitions shape --
    with an integer autoincrement key instead of a UUID, deliberately: events
    written by fast successive requests share a same-second occurred_at, and
    the id is what keeps newest-first deterministic."""

    __tablename__ = "lender_case_events"
    __table_args__ = (
        Index("ix_lender_case_event_case_id", "case_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[uuid4] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("lender_cases.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor: Mapped[str] = mapped_column(String(256), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    case: Mapped["LenderCaseORM"] = relationship(back_populates="events")
```

And on `ProjectORM`, after `stage_transitions`:

```python
    lender_cases: Mapped[list["LenderCaseORM"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )
```

- [ ] **Step 4: Write migration 006**

Create `migrations/versions/006_lender_case_governance.py`:

```python
"""Lender case governance: lender_cases + lender_case_events (spec Sec 21).

The case is a sibling of the one-appraisal-per-project row, keyed by
project_id (the Sec 13.2 record-identity reasoning). At most one live
(non-superseded) case per project, enforced by a partial unique index so the
schema works on both Postgres and SQLite. The event table is append-only --
the stage_transitions shape with an integer key so same-second events keep a
deterministic order. No existing table changes: staleness is derived at read
time and stored nowhere, and audit_hash's composition is untouched.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lender_cases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("locked_inputs_snapshot", sa.JSON, nullable=False),
        sa.Column("locked_calc_version", sa.String(32), nullable=False),
        sa.Column("locked_inputs_version", sa.Integer, nullable=False),
        sa.Column("locked_input_hash", sa.String(64), nullable=False),
        sa.Column("locked_outputs_hash", sa.String(64), nullable=False),
        sa.Column("locked_audit_hash", sa.String(64), nullable=False),
        sa.Column("case_hash", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(256), nullable=False),
        sa.Column("submitted_by", sa.String(256)),
        sa.Column("reviewer", sa.String(256)),
        sa.Column("decided_by", sa.String(256)),
        sa.Column("conditions", sa.Text),
        sa.Column("submitted_at", sa.DateTime(timezone=True)),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lender_case_project_id", "lender_cases", ["project_id"])
    op.create_index(
        "uq_lender_case_live_project", "lender_cases", ["project_id"], unique=True,
        postgresql_where=sa.text("status != 'superseded'"),
        sqlite_where=sa.text("status != 'superseded'"),
    )
    op.create_table(
        "lender_case_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("case_id", UUID(as_uuid=True), sa.ForeignKey("lender_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(32)),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("actor", sa.String(256), nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_lender_case_event_case_id", "lender_case_events", ["case_id"])


def downgrade() -> None:
    op.drop_index("ix_lender_case_event_case_id", table_name="lender_case_events")
    op.drop_table("lender_case_events")
    op.drop_index("uq_lender_case_live_project", table_name="lender_cases")
    op.drop_index("ix_lender_case_project_id", table_name="lender_cases")
    op.drop_table("lender_cases")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_orm_tables.py tests/test_alembic_migrations.py tests/test_lender_case_governance.py tests/test_health_migrations.py -q`
Expected: PASS — including `test_alembic_upgrade_head_on_empty_sqlite` (metadata ⊆ migrated tables catches ORM/migration drift) and the health head-revision check.

- [ ] **Step 6: Commit**

```bash
git add app/persistence/database.py migrations/versions/006_lender_case_governance.py tests/test_orm_tables.py tests/test_alembic_migrations.py tests/test_lender_case_governance.py
git commit -m "feat(r14b): lender_cases + lender_case_events tables, migration 006 (spec 21.1, 21.5)"
```

---

### Task 4: Pydantic models, repositories, create + read endpoints

**Files:**
- Modify: `app/models.py` (new section after `FinancialAppraisal`, ~line 424)
- Modify: `app/persistence/repositories.py`
- Modify: `app/api/app.py` (new router; register in `create_app`)
- Modify: `tests/test_lender_case_governance.py`, `tests/test_api_endpoints.py`

**Interfaces:**
- Consumes: Task 1's `is_stale`; Task 2's `case_hash`; Task 3's ORMs.
- Produces: models `LenderCaseCreate {project_id: UUID, created_by: str(min 1)}`, `LenderCase` (full read shape, `from_attributes`), `LenderCaseRead(LenderCase) {stale: bool}`, `LenderCaseEvent`; `LenderCaseRepository` with `create(data: dict) -> LenderCase`, `get_live_by_project_id(project_id) -> LenderCase | None`, `list_by_project_id(project_id) -> list[LenderCase]` (newest first), `update(case_id: UUID, values: dict) -> LenderCase | None`; `LenderCaseEventRepository` with `create(data: dict) -> LenderCaseEvent`, `list_by_project_id(project_id) -> list[LenderCaseEvent]` (id desc, across all the project's cases); endpoints `POST /api/v1/lender-cases` (201), `GET /api/v1/lender-cases/{project_id}` (200, `LenderCaseRead | None`).

- [ ] **Step 1: Write the failing endpoint tests** (append to `tests/test_lender_case_governance.py`)

Add the client/project fixtures and a save helper (the `test_appraisal_governance.py` pattern — same file-local style, plus fixture A):

```python
import copy
import json
from pathlib import Path

from httpx import ASGITransport, AsyncClient

from app.api.app import app
from app.persistence.database import get_db

FIXTURE_A_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "financial-model" / "a-all-cash.json"
)
FIXTURE_A_INPUTS = json.loads(FIXTURE_A_PATH.read_text())["inputs"]


def fixture_a_inputs() -> dict:
    return copy.deepcopy(FIXTURE_A_INPUTS)


@pytest.fixture
async def client(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def project(client):
    resp = await client.post("/api/v1/projects", json={
        "address_raw": "1 Test Street, London, E1 1AA",
        "price_pence": 40_000_000,
        "use_class": "office",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def save_appraisal(client, project, inputs: dict | None = None) -> dict:
    resp = await client.post("/api/v1/appraisals", json={
        "project_id": project["id"],
        "name": "Appraisal",
        "inputs_snapshot": inputs or fixture_a_inputs(),
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def create_case(client, project) -> dict:
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S. Sponsor",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_create_locks_the_stored_snapshot_and_hashes(client, project):
    appraisal = await save_appraisal(client, project)
    case = await create_case(client, project)
    assert case["status"] == "draft"
    assert case["stale"] is False
    assert case["created_by"] == "S. Sponsor"
    assert case["locked_inputs_snapshot"] == appraisal["inputs_snapshot"]
    assert case["locked_calc_version"] == appraisal["calc_version"]
    assert case["locked_inputs_version"] == appraisal["inputs_version"]
    assert case["locked_input_hash"] == appraisal["input_hash"]
    assert case["locked_outputs_hash"] == appraisal["outputs_hash"]
    assert case["locked_audit_hash"] == appraisal["audit_hash"]
    assert len(case["case_hash"]) == 64


async def test_create_requires_a_project(client):
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": "00000000-0000-4000-8000-000000000000", "created_by": "S",
    })
    assert resp.status_code == 404


async def test_create_requires_a_saved_appraisal(client, project):
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S",
    })
    assert resp.status_code == 404
    assert "appraisal" in resp.json()["detail"].lower()


async def test_create_refuses_a_pre_provenance_appraisal(client, project, db_engine):
    """Spec Sec 21.1 / design decision 10: a row with no audit_hash cannot be
    bound by the case-hash chain, so re-saving it is the fix, not locking it."""
    from sqlalchemy import update as sa_update
    from app.persistence.database import FinancialAppraisalORM

    await save_appraisal(client, project)
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        await session.execute(
            sa_update(FinancialAppraisalORM).values(audit_hash=None)
        )
        await session.commit()

    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S",
    })
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert any(d.get("field") == "appraisal" for d in detail), detail


async def test_create_refuses_a_second_live_case(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)
    resp = await client.post("/api/v1/lender-cases", json={
        "project_id": project["id"], "created_by": "S",
    })
    assert resp.status_code == 409


async def test_get_returns_null_when_no_case(client, project):
    resp = await client.get(f"/api/v1/lender-cases/{project['id']}")
    assert resp.status_code == 200
    assert resp.json() is None


async def test_get_unknown_project_404s(client):
    resp = await client.get("/api/v1/lender-cases/00000000-0000-4000-8000-000000000000")
    assert resp.status_code == 404


async def test_creation_writes_the_creation_event(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)
    resp = await client.get(f"/api/v1/lender-cases/{project['id']}/events")
    assert resp.status_code == 200
    events = resp.json()
    assert len(events) == 1
    assert events[0]["from_status"] is None
    assert events[0]["to_status"] == "draft"
    assert events[0]["actor"] == "S. Sponsor"
```

(The events endpoint lands in Task 5, so the last test stays red until then — that is expected; note it in the Task 4 commit by running only the earlier tests.)

In `tests/test_api_endpoints.py` add:

```python
    def test_lender_case_routes_exist(self):
        assert "/api/v1/lender-cases" in PATHS
        assert "/api/v1/lender-cases/{project_id}" in PATHS
        assert "/api/v1/lender-cases/{project_id}/transition" in PATHS
        assert "/api/v1/lender-cases/{project_id}/history" in PATHS
        assert "/api/v1/lender-cases/{project_id}/events" in PATHS
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_lender_case_governance.py tests/test_api_endpoints.py -q`
Expected: FAIL — 404s from the missing router (the api-fallback answers), and the paths test fails.

- [ ] **Step 3: Add the Pydantic models** (in `app/models.py`, after `FinancialAppraisal`, before the Stage Transition section)

```python
# --- Lender Case (R14b, spec Sec 21) ---


class LenderCaseCreate(BaseModel):
    project_id: uuid.UUID
    # Free-text actor names, the LenderValuation.author idiom -- the product
    # has no auth (design decision 4), so the record says who claims to have
    # acted and the change log says when.
    created_by: str = Field(min_length=1)


class LenderCaseTransition(BaseModel):
    to_status: str
    actor: str = Field(min_length=1)
    note: str | None = None
    # Required for approved_with_conditions, forbidden otherwise (Sec 21.2).
    conditions: str | None = None


class LenderCase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    status: str
    locked_inputs_snapshot: dict
    locked_calc_version: str
    locked_inputs_version: int
    locked_input_hash: str
    locked_outputs_hash: str
    locked_audit_hash: str
    case_hash: str                         # spec Sec 21.4
    created_by: str
    submitted_by: str | None = None
    reviewer: str | None = None
    decided_by: str | None = None
    conditions: str | None = None
    submitted_at: datetime | None = None
    decided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LenderCaseRead(LenderCase):
    """The API read shape: the stored case plus the derived staleness --
    computed at read time against the live appraisal row, never stored
    (spec Sec 21.3)."""

    stale: bool


class LenderCaseEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    case_id: uuid.UUID
    from_status: str | None = None
    to_status: str
    actor: str
    note: str | None = None
    occurred_at: datetime
```

- [ ] **Step 4: Add the repositories** (append to `app/persistence/repositories.py`; extend its `app.models` import with `LenderCase, LenderCaseEvent` and the `app.persistence.database` import with `LenderCaseORM, LenderCaseEventORM`)

```python
class LenderCaseRepository:
    """R14b (spec Sec 21). Like FinancialAppraisalRepository, `create`/`update`
    take a plain dict built by the endpoint: the server is the sole author of
    the locked snapshot and case_hash, so there is no 1:1 request/column
    mapping to type."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: LenderCaseORM) -> LenderCase:
        return LenderCase(
            id=row.id,
            project_id=row.project_id,
            status=row.status,
            locked_inputs_snapshot=row.locked_inputs_snapshot,
            locked_calc_version=row.locked_calc_version,
            locked_inputs_version=row.locked_inputs_version,
            locked_input_hash=row.locked_input_hash,
            locked_outputs_hash=row.locked_outputs_hash,
            locked_audit_hash=row.locked_audit_hash,
            case_hash=row.case_hash,
            created_by=row.created_by,
            submitted_by=row.submitted_by,
            reviewer=row.reviewer,
            decided_by=row.decided_by,
            conditions=row.conditions,
            submitted_at=row.submitted_at,
            decided_at=row.decided_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def create(self, data: dict) -> LenderCase:
        orm = LenderCaseORM(**data)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def get_live_by_project_id(self, project_id: UUID) -> LenderCase | None:
        stmt = (
            select(LenderCaseORM)
            .where(
                LenderCaseORM.project_id == project_id,
                LenderCaseORM.status != "superseded",
            )
            .order_by(LenderCaseORM.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        row = result.scalars().first()
        return self._to_domain(row) if row else None

    async def list_by_project_id(self, project_id: UUID) -> list[LenderCase]:
        # Newest first, superseded included -- this is the case history.
        stmt = (
            select(LenderCaseORM)
            .where(LenderCaseORM.project_id == project_id)
            .order_by(LenderCaseORM.created_at.desc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]

    async def update(self, case_id: UUID, values: dict) -> LenderCase | None:
        stmt = (
            update(LenderCaseORM)
            .where(LenderCaseORM.id == case_id)
            .values(**values)
            .returning(LenderCaseORM)
        )
        result = await self.db.execute(stmt)
        row = result.scalar_one_or_none()
        if not row:
            return None
        await self.db.flush()
        return self._to_domain(row)


class LenderCaseEventRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _to_domain(self, row: LenderCaseEventORM) -> LenderCaseEvent:
        return LenderCaseEvent(
            id=row.id,
            case_id=row.case_id,
            from_status=row.from_status,
            to_status=row.to_status,
            actor=row.actor,
            note=row.note,
            occurred_at=row.occurred_at,
        )

    async def create(self, data: dict) -> LenderCaseEvent:
        orm = LenderCaseEventORM(**data)
        self.db.add(orm)
        await self.db.flush()
        await self.db.refresh(orm)
        return self._to_domain(orm)

    async def list_by_project_id(self, project_id: UUID) -> list[LenderCaseEvent]:
        # Newest first across ALL the project's cases (history included).
        # id desc, not occurred_at desc: same-second writes are routine and
        # the integer key is what keeps the order deterministic.
        stmt = (
            select(LenderCaseEventORM)
            .where(
                LenderCaseEventORM.case_id.in_(
                    select(LenderCaseORM.id).where(LenderCaseORM.project_id == project_id)
                )
            )
            .order_by(LenderCaseEventORM.id.desc())
        )
        result = await self.db.execute(stmt)
        return [self._to_domain(row) for row in result.scalars().all()]
```

- [ ] **Step 5: Add the router with create + read** (in `app/api/app.py`, after the Appraisals router section)

Extend the `app.models` import with `LenderCase, LenderCaseCreate, LenderCaseEvent, LenderCaseRead, LenderCaseTransition`; the repositories import with `LenderCaseEventRepository, LenderCaseRepository`; add `from uuid import uuid4` to the `uuid` import line (`from uuid import UUID, uuid4`); and add:

```python
from app.financial_model.hashing import case_hash
from app.financial_model.provenance import ALLOWED_TRANSITIONS, is_stale
```

(merge `case_hash` into the existing `hashing` import at the top of the file). Then:

```python
# --- Lender Cases Router (R14b, spec Sec 21) ---

lender_cases_router = APIRouter(prefix="/lender-cases")


def _read_shape(case, appraisal) -> LenderCaseRead:
    """The stored case plus derived staleness (spec Sec 21.3): the live
    appraisal row's input hash no longer matching the locked one. Derived on
    every read, stored nowhere."""
    return LenderCaseRead(
        **case.model_dump(),
        stale=is_stale(appraisal.input_hash if appraisal else None, case.locked_input_hash),
    )


@lender_cases_router.post("", response_model=LenderCaseRead, status_code=201)
async def create_lender_case(body: LenderCaseCreate, db: DbDep):
    project = await ProjectRepository(db).get_by_id(body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    appraisal = await FinancialAppraisalRepository(db).get_by_project_id(body.project_id)
    if not appraisal:
        raise HTTPException(
            status_code=404,
            detail="Financial appraisal not found — save an appraisal before opening a lender case",
        )
    if not (appraisal.audit_hash and appraisal.input_hash and appraisal.outputs_hash):
        # Spec Sec 21.1: a pre-provenance row cannot be bound by the case-hash
        # chain. Re-saving recomputes the hashes; locking without them would
        # assert a binding no run produced.
        raise HTTPException(status_code=422, detail=[{
            "severity": "error", "field": "appraisal",
            "message": "the stored appraisal predates provenance hashing — re-save it before opening a lender case",
        }])
    repo = LenderCaseRepository(db)
    live = await repo.get_live_by_project_id(body.project_id)
    if live:
        raise HTTPException(
            status_code=409,
            detail=f"A live lender case already exists (status '{live.status}') — supersede it first",
        )
    case_id = uuid4()
    case = await repo.create({
        "id": case_id,
        "project_id": body.project_id,
        "status": "draft",
        "locked_inputs_snapshot": appraisal.inputs_snapshot,
        "locked_calc_version": appraisal.calc_version,
        "locked_inputs_version": appraisal.inputs_version,
        "locked_input_hash": appraisal.input_hash,
        "locked_outputs_hash": appraisal.outputs_hash,
        "locked_audit_hash": appraisal.audit_hash,
        "case_hash": case_hash(
            case_id=str(case_id), project_id=str(body.project_id), status="draft",
            submitted_by=None, reviewer=None, decided_by=None, decided_at=None,
            locked_audit_hash=appraisal.audit_hash,
        ),
        "created_by": body.created_by,
    })
    await LenderCaseEventRepository(db).create({
        "case_id": case.id, "from_status": None, "to_status": "draft",
        "actor": body.created_by, "note": None,
    })
    await db.commit()
    return _read_shape(case, appraisal)


@lender_cases_router.get("/{project_id}", response_model=LenderCaseRead | None)
async def get_lender_case(project_id: UUID, db: DbDep):
    """The live case with derived staleness, or JSON null when none exists —
    'no case yet' is a normal state, not an error (spec Sec 21.5)."""
    project = await ProjectRepository(db).get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    case = await LenderCaseRepository(db).get_live_by_project_id(project_id)
    if case is None:
        return None
    appraisal = await FinancialAppraisalRepository(db).get_by_project_id(project_id)
    return _read_shape(case, appraisal)
```

Register it in `create_app()` beside the others:

```python
    app.include_router(lender_cases_router, prefix=settings.api_prefix, tags=["lender-cases"])
```

- [ ] **Step 6: Run the Task-4 tests to verify they pass**

Run: `python -m pytest tests/test_lender_case_governance.py -q -k "not creation_writes"` and `python -m pytest tests/test_api_endpoints.py -q`
Expected: Task-4 tests PASS; `test_api_endpoints.py` still FAILS on the three Task-5 paths (transition/history/events) — that is the next task's red state. If the whole paths test is one function, expect it red until Task 5; commit anyway with the note below.

- [ ] **Step 7: Commit**

```bash
git add app/models.py app/persistence/repositories.py app/api/app.py tests/test_lender_case_governance.py tests/test_api_endpoints.py
git commit -m "feat(r14b): lender-case create + read endpoints, locking and derived staleness (spec 21.1, 21.3) [transition endpoints red until next commit]"
```

---

### Task 5: Transition, history and events endpoints — the state machine goes live

**Files:**
- Modify: `app/api/app.py` (extend the lender-cases router)
- Modify: `tests/test_lender_case_governance.py`

**Interfaces:**
- Consumes: Task 1's `ALLOWED_TRANSITIONS`, Task 2's `case_hash`, Task 4's repos/models.
- Produces: `POST /api/v1/lender-cases/{project_id}/transition` (200 `LenderCaseRead`; 404 no live case; 409 illegal move; 422 unknown status / conditions rule), `GET .../history` (200 `list[LenderCaseRead]`), `GET .../events` (200 `list[LenderCaseEvent]`).

- [ ] **Step 1: Write the failing tests** (append to `tests/test_lender_case_governance.py`)

```python
async def transition(client, project, to_status, actor="R. Reviewer", **extra):
    return await client.post(
        f"/api/v1/lender-cases/{project['id']}/transition",
        json={"to_status": to_status, "actor": actor, **extra},
    )


async def test_full_legal_walk_records_each_side_effect(client, project):
    """draft -> submitted -> under_review -> information_required ->
    under_review -> approved_with_conditions, asserting the Sec 21.2
    side-effect table at every step."""
    await save_appraisal(client, project)
    await create_case(client, project)

    r = await transition(client, project, "submitted", actor="S. Sponsor")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["submitted_by"] == "S. Sponsor" and body["submitted_at"] is not None

    r = await transition(client, project, "under_review", actor="First Reviewer")
    assert r.json()["reviewer"] == "First Reviewer"

    r = await transition(client, project, "information_required", actor="First Reviewer",
                         note="Send the QS report")
    assert r.status_code == 200

    r = await transition(client, project, "under_review", actor="Second Reviewer")
    # Resubmission overwrites the reviewer of record; the event log keeps both.
    assert r.json()["reviewer"] == "Second Reviewer"

    r = await transition(client, project, "approved_with_conditions",
                         actor="D. Director", conditions="Max LTC 85%")
    body = r.json()
    assert body["status"] == "approved_with_conditions"
    assert body["decided_by"] == "D. Director" and body["decided_at"] is not None
    assert body["conditions"] == "Max LTC 85%"

    events = (await client.get(f"/api/v1/lender-cases/{project['id']}/events")).json()
    assert [e["to_status"] for e in events] == [
        "approved_with_conditions", "under_review", "information_required",
        "under_review", "submitted", "draft",
    ]
    assert events[1]["actor"] == "Second Reviewer"
    assert events[2]["note"] == "Send the QS report"


async def case_at(client, project, target: str):
    """Drive a fresh case to `target` along the shortest legal path,
    superseding any live case first."""
    live = (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()
    if live is not None:
        assert (await transition(client, project, "superseded")).status_code == 200
    await create_case(client, project)
    walks = {
        "draft": [],
        "submitted": ["submitted"],
        "under_review": ["submitted", "under_review"],
        "information_required": ["submitted", "under_review", "information_required"],
        "credit_approved": ["submitted", "under_review", "credit_approved"],
        "approved_with_conditions": ["submitted", "under_review", "approved_with_conditions"],
        "declined": ["submitted", "under_review", "declined"],
        "superseded": ["superseded"],
    }
    for step in walks[target]:
        extra = {"conditions": "Cond"} if step == "approved_with_conditions" else {}
        r = await transition(client, project, step, **extra)
        assert r.status_code == 200, r.text


async def test_every_illegal_transition_409s(client, project):
    """The whole complement of ALLOWED_TRANSITIONS, driven through the real
    endpoint. Slow but exhaustive -- the state machine is the release."""
    from app.financial_model.provenance import ALLOWED_TRANSITIONS

    await save_appraisal(client, project)
    statuses = list(ALLOWED_TRANSITIONS)
    for from_status, allowed in ALLOWED_TRANSITIONS.items():
        for to_status in statuses:
            if to_status in allowed:
                continue
            if from_status == "superseded":
                continue  # no live case to address; covered below
            await case_at(client, project, from_status)
            extra = {"conditions": "Cond"} if to_status == "approved_with_conditions" else {}
            r = await transition(client, project, to_status, **extra)
            assert r.status_code == 409, (from_status, to_status, r.text)


async def test_transition_with_no_live_case_404s(client, project):
    await save_appraisal(client, project)
    r = await transition(client, project, "submitted")
    assert r.status_code == 404


async def test_unknown_to_status_is_422(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)
    r = await transition(client, project, "signed_off")
    assert r.status_code == 422


async def test_conditions_required_and_forbidden(client, project):
    await save_appraisal(client, project)
    await case_at(client, project, "under_review")
    r = await transition(client, project, "approved_with_conditions")
    assert r.status_code == 422
    assert any(d.get("field") == "conditions" for d in r.json()["detail"])
    r = await transition(client, project, "credit_approved", conditions="Cond")
    assert r.status_code == 422


async def test_case_hash_recomputed_and_independently_derivable(client, project):
    """Spec Sec 21.4. Re-derived here by hand -- sha256 over the eight joined
    parts, decided_at re-canonicalised from the response -- the same
    independence discipline as the audit-hash test."""
    import hashlib
    from datetime import datetime, timezone

    await save_appraisal(client, project)
    created = await create_case(client, project)
    await case_at(client, project, "credit_approved")
    body = (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()
    assert body["case_hash"] != created["case_hash"]

    decided = datetime.fromisoformat(body["decided_at"])
    if decided.tzinfo is None:
        decided = decided.replace(tzinfo=timezone.utc)
    decided_str = decided.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    expected = hashlib.sha256("|".join([
        body["id"], body["project_id"], "credit_approved",
        body["submitted_by"], body["reviewer"], body["decided_by"],
        decided_str, body["locked_audit_hash"],
    ]).encode()).hexdigest()
    assert body["case_hash"] == expected


async def test_stale_flips_on_a_changed_resave_only(client, project):
    await save_appraisal(client, project)
    await create_case(client, project)

    resp = await client.put(f"/api/v1/appraisals/{project['id']}",
                            json={"inputs_snapshot": fixture_a_inputs()})
    assert resp.status_code == 200
    assert (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()["stale"] is False

    changed = fixture_a_inputs()
    changed["acquisition"]["purchase_price_pence"] += 100_000
    resp = await client.put(f"/api/v1/appraisals/{project['id']}",
                            json={"inputs_snapshot": changed})
    assert resp.status_code == 200
    assert (await client.get(f"/api/v1/lender-cases/{project['id']}")).json()["stale"] is True


async def test_superseded_case_keeps_its_record_and_history_lists_both(client, project):
    await save_appraisal(client, project)
    await case_at(client, project, "credit_approved")
    assert (await transition(client, project, "superseded")).status_code == 200
    await create_case(client, project)

    history = (await client.get(f"/api/v1/lender-cases/{project['id']}/history")).json()
    assert len(history) == 2
    assert history[0]["status"] == "draft"
    assert history[1]["status"] == "superseded"
    # The dead case kept the decision it carried when it died.
    assert history[1]["decided_by"] is not None


async def test_project_delete_cascades_cases_and_events(client, project, db_engine):
    from sqlalchemy import func as sa_func, select as sa_select
    from app.persistence.database import LenderCaseEventORM

    await save_appraisal(client, project)
    await create_case(client, project)
    resp = await client.delete(f"/api/v1/projects/{project['id']}")
    assert resp.status_code == 204

    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        cases = (await session.execute(sa_select(sa_func.count()).select_from(LenderCaseORM))).scalar_one()
        events = (await session.execute(sa_select(sa_func.count()).select_from(LenderCaseEventORM))).scalar_one()
    assert cases == 0 and events == 0
```

Note on the cascade test: sqlite enforces `ON DELETE CASCADE` only with `PRAGMA foreign_keys=ON`; the SQLAlchemy ORM cascade (`cascade="all, delete-orphan"` on the relationships) is what does the work through `ProjectRepository.delete` — if the count comes back non-zero, `delete` is bulk-SQL (`delete(ProjectORM)`), which bypasses ORM cascades on sqlite without the pragma. In that event the correct fix is to assert through Postgres-shaped behaviour differently: relax this test to assert cases are deleted when run against the ORM-relationship path (session.delete on the loaded project) instead — do NOT change `ProjectRepository.delete`.

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_lender_case_governance.py -q`
Expected: FAIL — transition/history/events endpoints 404 via the api-fallback.

- [ ] **Step 3: Implement the three endpoints** (append to the lender-cases router in `app/api/app.py`; add `from datetime import datetime, timezone` at module top if not present — check first, `system_health` imports it locally)

```python
@lender_cases_router.post("/{project_id}/transition", response_model=LenderCaseRead)
async def transition_lender_case(project_id: UUID, body: LenderCaseTransition, db: DbDep):
    from datetime import datetime, timezone

    repo = LenderCaseRepository(db)
    case = await repo.get_live_by_project_id(project_id)
    if not case:
        raise HTTPException(status_code=404, detail="No live lender case for this project")
    if body.to_status not in ALLOWED_TRANSITIONS:
        raise HTTPException(status_code=422, detail=[{
            "severity": "error", "field": "to_status",
            "message": f"unknown lender-case status '{body.to_status}'",
        }])
    allowed = ALLOWED_TRANSITIONS[case.status]
    if body.to_status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot move a lender case from '{case.status}' to '{body.to_status}'"
                   f" — allowed: {list(allowed)}",
        )
    # One field, one meaning (spec Sec 21.2): conditions belong to
    # approved_with_conditions and nothing else.
    if body.to_status == "approved_with_conditions":
        if not (body.conditions and body.conditions.strip()):
            raise HTTPException(status_code=422, detail=[{
                "severity": "error", "field": "conditions",
                "message": "conditions are required for approved_with_conditions",
            }])
    elif body.conditions is not None:
        raise HTTPException(status_code=422, detail=[{
            "severity": "error", "field": "conditions",
            "message": "conditions may only accompany approved_with_conditions",
        }])

    now = datetime.now(timezone.utc)
    values: dict = {"status": body.to_status}
    if body.to_status == "submitted":
        values |= {"submitted_by": body.actor, "submitted_at": now}
    elif body.to_status == "under_review":
        # A resubmission overwrites the reviewer of record; the event log
        # keeps the history (spec Sec 21.2).
        values |= {"reviewer": body.actor}
    elif body.to_status in ("credit_approved", "approved_with_conditions", "declined"):
        values |= {"decided_by": body.actor, "decided_at": now}
        if body.to_status == "approved_with_conditions":
            values |= {"conditions": body.conditions}
    # A supersede records its actor in the event only: the case columns keep
    # the state the case died in, so history shows what was approved.

    merged = case.model_dump() | values
    values["case_hash"] = case_hash(
        case_id=str(case.id),
        project_id=str(case.project_id),
        status=merged["status"],
        submitted_by=merged["submitted_by"],
        reviewer=merged["reviewer"],
        decided_by=merged["decided_by"],
        decided_at=merged["decided_at"],
        locked_audit_hash=case.locked_audit_hash,
    )
    updated = await repo.update(case.id, values)
    await LenderCaseEventRepository(db).create({
        "case_id": case.id, "from_status": case.status,
        "to_status": body.to_status, "actor": body.actor, "note": body.note,
    })
    await db.commit()
    appraisal = await FinancialAppraisalRepository(db).get_by_project_id(project_id)
    return _read_shape(updated, appraisal)


@lender_cases_router.get("/{project_id}/history", response_model=list[LenderCaseRead])
async def lender_case_history(project_id: UUID, db: DbDep):
    """All the project's cases, newest first, superseded included."""
    project = await ProjectRepository(db).get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    appraisal = await FinancialAppraisalRepository(db).get_by_project_id(project_id)
    cases = await LenderCaseRepository(db).list_by_project_id(project_id)
    return [_read_shape(c, appraisal) for c in cases]


@lender_cases_router.get("/{project_id}/events", response_model=list[LenderCaseEvent])
async def lender_case_events(project_id: UUID, db: DbDep):
    """The change log across all the project's cases, newest first."""
    project = await ProjectRepository(db).get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await LenderCaseEventRepository(db).list_by_project_id(project_id)
```

- [ ] **Step 4: Run the whole backend suite**

Run: `python -m pytest tests/test_lender_case_governance.py tests/test_api_endpoints.py -q` then `python -m pytest -q`
Expected: PASS everywhere (the full run proves no regression; expect it to take a few minutes).

- [ ] **Step 5: Commit**

```bash
git add app/api/app.py tests/test_lender_case_governance.py
git commit -m "feat(r14b): server-enforced state machine, change log, case_hash recompute (spec 21.2, 21.4, 21.5)"
```

---

### Task 6: TypeScript governance core — types, api client, `report-provenance.ts`

**Files:**
- Modify: `frontend/src/types.ts` (canonical `LenderCaseStatus` moves here; new `LenderCase`, `LenderCaseEvent`)
- Modify: `frontend/src/lib/api.ts` (five client functions)
- Modify: `frontend/src/lib/report-provenance.ts`
- Modify: `frontend/src/lib/report-provenance.test.ts`

**Interfaces:**
- Consumes: the Task 4/5 API shapes.
- Produces (Tasks 7–9): `types.ts`: `LenderCaseStatus` (same 8-member union), `LenderCase` (snake_case API shape incl. `stale: boolean`, timestamps as `string | null`, `id: string`), `LenderCaseEvent` (`id: number`); `api.ts`: `getLenderCase(projectId): Promise<LenderCase | null>`, `createLenderCase(projectId, createdBy): Promise<LenderCase>`, `transitionLenderCase(projectId, data: {to_status: LenderCaseStatus; actor: string; note?: string; conditions?: string}): Promise<LenderCase>`, `listLenderCaseHistory(projectId): Promise<LenderCase[]>`, `listLenderCaseEvents(projectId): Promise<LenderCaseEvent[]>`; `report-provenance.ts`: `DraftReason` gains `'lender_case_stale'`, `ALLOWED_TRANSITIONS: Record<LenderCaseStatus, readonly LenderCaseStatus[]>`, `CaseStaleGate {lenderCaseStale: boolean}` as new defaulted 5th param of `draftReason`/`documentStatus`, `ProvenanceOptions.lenderCase?: LenderCase | null`, `ReportProvenance.lenderCase: LenderCase | null` + `.lenderCaseStale: boolean`, `structurallyEqual(a, b): boolean`.

- [ ] **Step 1: Write the failing tests** (in `frontend/src/lib/report-provenance.test.ts`)

First **update** the R9 guard at ~line 288 ("leaves the DraftReason union at its five R11 members"): read its body and extend the expected membership to the six members including `'lender_case_stale'`, renaming it "leaves the DraftReason union at its six R14b members". **Run it and watch it fail before touching the source** — this is the release's guard 1.

Then add a new describe (mirror the local helpers the existing describes use for building `reconciliation` picks):

```ts
import { ALLOWED_TRANSITIONS, structurallyEqual } from './report-provenance';

describe('R14b — lender case staleness (spec §21.3)', () => {
  const ok = { report_safe: true, senior_repaid: true };

  it('reports lender_case_stale for an approved case whose document moved', () => {
    expect(draftReason(ok, 'credit_approved', undefined, undefined, { lenderCaseStale: true }))
      .toBe('lender_case_stale');
    expect(draftReason(ok, 'approved_with_conditions', undefined, undefined, { lenderCaseStale: true }))
      .toBe('lender_case_stale');
  });

  it('never fires for an unapproved case — not_approved wins', () => {
    expect(draftReason(ok, 'declined', undefined, undefined, { lenderCaseStale: true }))
      .toBe('not_approved');
    expect(draftReason(ok, null, undefined, undefined, { lenderCaseStale: true }))
      .toBe('not_approved');
  });

  it('never displaces conditions 1–4', () => {
    expect(draftReason({ report_safe: false, senior_repaid: true }, 'credit_approved',
      undefined, undefined, { lenderCaseStale: true })).toBe('unreconciled');
    expect(draftReason(ok, 'credit_approved', { taxBasisConfirmed: false },
      undefined, { lenderCaseStale: true })).toBe('tax_basis_unconfirmed');
  });

  it('keeps four-argument callers behaving exactly as before', () => {
    expect(draftReason(ok, 'credit_approved')).toBeNull();
  });

  it('carries through documentStatus', () => {
    expect(documentStatus(ok, 'credit_approved', undefined, undefined,
      { lenderCaseStale: true })).toBe('DRAFT');
  });
});

describe('R14b — the transition table mirror (spec §21.2)', () => {
  it('is exactly the Python table', () => {
    // Mirrors tests/test_provenance.py::test_the_table_is_exactly_the_spec_sec_21_2_table.
    expect(ALLOWED_TRANSITIONS).toEqual({
      draft: ['submitted', 'superseded'],
      submitted: ['under_review', 'superseded'],
      under_review: ['information_required', 'credit_approved',
        'approved_with_conditions', 'declined', 'superseded'],
      information_required: ['under_review', 'superseded'],
      credit_approved: ['superseded'],
      approved_with_conditions: ['superseded'],
      declined: ['superseded'],
      superseded: [],
    });
  });
});

describe('R14b — structurallyEqual (the unsaved-edit staleness check)', () => {
  it('ignores key order', () => {
    expect(structurallyEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
  });
  it('sees a changed nested value', () => {
    expect(structurallyEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 3] } })).toBe(false);
  });
  it('treats array order as meaningful', () => {
    expect(structurallyEqual([1, 2], [2, 1])).toBe(false);
  });
  it('distinguishes null from absent', () => {
    expect(structurallyEqual({ a: null }, {})).toBe(false);
  });
});
```

Also add `buildProvenance` cases (mirroring the existing "buildProvenance derives ..." describes' run-construction helpers — reuse whatever run factory that file already has):

```ts
// with a lenderCase option {status: 'credit_approved', stale: true, ...}:
//   provenance.lenderCaseStatus === 'credit_approved'
//   provenance.lenderCaseStale === true
//   provenance.draftReason === 'lender_case_stale'  (given confirmed bases + repaying run)
// with stale: false and the same run: documentStatus 'FINAL'
// with no lenderCase and no lenderCaseStatus: lenderCase null, stale false, reason not_approved
```

Write these as real `it` blocks against the file's existing run fixtures (the FINAL-reaching run already exists in the R8 describe at line 21).

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/report-provenance.test.ts`
Expected: FAIL — the union-membership guard (five ≠ six), missing exports.

- [ ] **Step 3: Implement**

`types.ts` — add near `FinancialAppraisal`:

```ts
/** Where a lender case has reached (R14b, spec §21). Canonical here;
 *  report-provenance.ts re-exports it so existing importers are unmoved. */
export type LenderCaseStatus =
  | 'draft' | 'submitted' | 'under_review' | 'information_required'
  | 'credit_approved' | 'approved_with_conditions' | 'declined' | 'superseded';

/** A lender case as the API returns it: the locked snapshot, its hashes, the
 *  governance fields, and `stale` — derived server-side on every read (spec
 *  §21.3), never stored. */
export interface LenderCase {
  id: string;
  project_id: string;
  status: LenderCaseStatus;
  locked_inputs_snapshot: Record<string, unknown>;
  locked_calc_version: string;
  locked_inputs_version: number;
  locked_input_hash: string;
  locked_outputs_hash: string;
  locked_audit_hash: string;
  case_hash: string;
  created_by: string;
  submitted_by: string | null;
  reviewer: string | null;
  decided_by: string | null;
  conditions: string | null;
  submitted_at: string | null;
  decided_at: string | null;
  stale: boolean;
  created_at: string;
  updated_at: string;
}

/** One row of the append-only change log (spec §21.5). Integer id — the
 *  server's deterministic newest-first order key. */
export interface LenderCaseEvent {
  id: number;
  case_id: string;
  from_status: LenderCaseStatus | null;
  to_status: LenderCaseStatus;
  actor: string;
  note: string | null;
  occurred_at: string;
}
```

`api.ts` — extend the type import and add after the Appraisals section:

```ts
// --- Lender Cases (R14b, spec §21) ---

export async function getLenderCase(projectId: string): Promise<LenderCase | null> {
  return request<LenderCase | null>(`/api/v1/lender-cases/${projectId}`, { headers: HEADERS });
}

export async function createLenderCase(
  projectId: string,
  createdBy: string,
): Promise<LenderCase> {
  return request<LenderCase>('/api/v1/lender-cases', {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ project_id: projectId, created_by: createdBy }),
  });
}

export async function transitionLenderCase(
  projectId: string,
  data: { to_status: LenderCaseStatus; actor: string; note?: string; conditions?: string },
): Promise<LenderCase> {
  return request<LenderCase>(`/api/v1/lender-cases/${projectId}/transition`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(data),
  });
}

export async function listLenderCaseHistory(projectId: string): Promise<LenderCase[]> {
  return request<LenderCase[]>(`/api/v1/lender-cases/${projectId}/history`, { headers: HEADERS });
}

export async function listLenderCaseEvents(projectId: string): Promise<LenderCaseEvent[]> {
  return request<LenderCaseEvent[]>(`/api/v1/lender-cases/${projectId}/events`, { headers: HEADERS });
}
```

`report-provenance.ts`:

1. Replace the local `LenderCaseStatus` declaration (lines 21–24) with an import + re-export from `../types` (extend the existing `import type { FinancialAppraisal }` line with `LenderCase, LenderCaseStatus`; add `export type { LenderCaseStatus };`). Keep the doc comment, updated: "Populated from R14b; was null-only until then."
2. Add after `APPROVED_STATUSES`:

```ts
/** Spec §21.2, normative — mirrored literally in app/financial_model/
 *  provenance.py, and pinned against it by mirrored tests. The UI derives its
 *  transition buttons from this table; it never keeps its own list. */
export const ALLOWED_TRANSITIONS: Record<LenderCaseStatus, readonly LenderCaseStatus[]> = {
  draft: ['submitted', 'superseded'],
  submitted: ['under_review', 'superseded'],
  under_review: ['information_required', 'credit_approved',
    'approved_with_conditions', 'declined', 'superseded'],
  information_required: ['under_review', 'superseded'],
  credit_approved: ['superseded'],
  approved_with_conditions: ['superseded'],
  declined: ['superseded'],
  superseded: [],
};
```

3. `DraftReason` gains `| 'lender_case_stale'`.
4. Add the gate (beside `VatBasisGate`):

```ts
/** R14b, spec §21.3. What draftReason needs to know about the approved
 *  case's currency. Defaulted exactly as TaxBasisGate and VatBasisGate were,
 *  so no existing four-argument caller changes behaviour. */
export interface CaseStaleGate {
  lenderCaseStale: boolean;
}

const CASE_ASSUMED_CURRENT: CaseStaleGate = { lenderCaseStale: false };
```

5. `draftReason` and `documentStatus` gain the 5th param `caseStale: CaseStaleGate = CASE_ASSUMED_CURRENT`; in `draftReason`, after the `not_approved` return:

```ts
  // R14b (spec §21.3). Fires only when an approval exists — an unapproved
  // stale case reports not_approved — so the two are mutually exclusive by
  // construction, and a FINAL banner can never print over figures the lender
  // never saw.
  if (caseStale.lenderCaseStale) return 'lender_case_stale';
```

6. `ProvenanceOptions` gains `lenderCase?: LenderCase | null;`. `ReportProvenance` gains `lenderCase: LenderCase | null;` and `lenderCaseStale: boolean;` (doc-comment both). In `buildProvenance`:

```ts
    lenderCaseStatus = null,
    lenderCase = null,
  } = options;
  // The full case object wins over the bare status when both are supplied —
  // the status option survives for the tests and callers that predate R14b.
  const caseStatus = lenderCase?.status ?? lenderCaseStatus;
  const lenderCaseStale = lenderCase?.stale ?? false;
```

pass `{ lenderCaseStale }` as `draftReason`'s 5th argument, use `caseStatus` where `lenderCaseStatus` was used, and add `lenderCase` / `lenderCaseStale` to the returned object (with `lenderCaseStatus: caseStatus`).
7. Add at the end of the file:

```ts
/**
 * R14b (spec §21.3) — the client half of staleness: deep structural equality
 * of the in-session inputs against a case's locked snapshot. An unsaved edit
 * moves no stored hash, so this is the only check that can see one. It drives
 * the Lender Case page's live warning and nothing else — the memo always
 * prints from the stored record, so it consumes the server-derived `stale`
 * flag instead. Key order is irrelevant; array order is meaningful.
 */
export function structurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => structurallyEqual(v, b[i]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra).sort();
    const kb = Object.keys(rb).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => structurallyEqual(ra[k], rb[k]));
  }
  return false;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/report-provenance.test.ts && npx tsc -b`
Expected: PASS, clean build. (`tsc -b` here catches the `DraftReason` widening breaking `export-investment-memo.ts`'s two `Record<DraftReason, string>` maps — they now MISS a key. **Expected**: `tsc` fails on those two maps. That red is Task 7's job; if you want a green commit, add the two `lender_case_stale` entries now with the exact strings from Task 7 Step 3 and say so in the commit message.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/lib/api.ts frontend/src/lib/report-provenance.ts frontend/src/lib/report-provenance.test.ts
git commit -m "feat(r14b): TS governance core - lender_case_stale, transition table, structural staleness (spec 21.2, 21.3)"
```

---

### Task 7: The memo — banner, provenance rows, stale disclosure, FINAL path

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`
- Modify: `frontend/src/lib/report-qa/memo-release-gate.test.ts`

**Interfaces:**
- Consumes: Task 6's `ReportProvenance.lenderCase/.lenderCaseStale`, `DraftReason` sixth member, `LenderCase` type.
- Produces: `DRAFT_REASON_SENTENCE.lender_case_stale`, `WATERMARK_TEXT.lender_case_stale = 'DRAFT - LENDER CASE STALE - NOT FOR LENDER RELIANCE'`, case rows on the provenance panel, a stale `infoRequired` paragraph, the case-hash caption sentence.

- [ ] **Step 1: Write the failing release-gate tests** (append to `memo-release-gate.test.ts`; import `LenderCase` from `../../types`)

```ts
/** R14b (spec §21). An approved, current lender case — the shape that makes
 *  the product's first FINAL document possible. */
const approvedCase: LenderCase = {
  id: 'ca5e0001-2222-4333-8444-555566667777',
  project_id: qaProject.id,
  status: 'credit_approved',
  locked_inputs_snapshot: {},
  locked_calc_version: '2.11.0',
  locked_inputs_version: 4,
  locked_input_hash: 'a'.repeat(64),
  locked_outputs_hash: 'b'.repeat(64),
  locked_audit_hash: 'c'.repeat(64),
  case_hash: 'd'.repeat(64),
  created_by: 'S. Sponsor',
  submitted_by: 'S. Sponsor',
  reviewer: 'R. Reviewer',
  decided_by: 'D. Director',
  conditions: null,
  submitted_at: '2026-08-20T09:00:00Z',
  decided_at: '2026-08-23T17:45:00.000000Z',
  stale: false,
  created_at: '2026-08-20T09:00:00Z',
  updated_at: '2026-08-23T17:45:00Z',
};

describe('R14b — the lender case on the memo (spec §21)', () => {
  it('renders the first FINAL document for an approved, current case', async () => {
    const run = runAppraisal(sellAllInputs());
    const prov = provenanceFor(run, { lenderCase: approvedCase });
    expect(prov.documentStatus).toBe('FINAL');
    const { info } = await report(sellAllInputs(), { provenance: prov });
    // No DRAFT watermark anywhere on a FINAL document.
    expect(watermarkTexts(info)).toEqual([]);
    const text = documentText(info);
    expect(text).toContain('It is a final lender report.');
    expect(text).toContain(approvedCase.id);
    expect(text).toContain(approvedCase.case_hash);
    expect(text).toContain('R. Reviewer');
    expect(text).toContain('D. Director');
    // The FINAL page still obeys the layout gate.
    expect(overflowingItems(info)).toEqual([]);
    expect(sparsePages(info)).toEqual([]);
  });

  it('watermarks an approved-but-stale case as LENDER CASE STALE', async () => {
    const run = runAppraisal(sellAllInputs());
    const prov = provenanceFor(run, { lenderCase: { ...approvedCase, stale: true } });
    expect(prov.draftReason).toBe('lender_case_stale');
    const { info } = await report(sellAllInputs(), { provenance: prov });
    expect(watermarkTexts(info)).toContain('DRAFT - LENDER CASE STALE - NOT FOR LENDER RELIANCE');
    const text = documentText(info);
    expect(text).toContain('has changed since this lender case locked its snapshot');
    expect(overflowingItems(info)).toEqual([]);
    expect(sparsePages(info)).toEqual([]);
  });

  it('shows approval conditions when the case carries them', async () => {
    const run = runAppraisal(sellAllInputs());
    const prov = provenanceFor(run, {
      lenderCase: { ...approvedCase, status: 'approved_with_conditions', conditions: 'Max LTC 85%' },
    });
    const { info } = await report(sellAllInputs(), { provenance: prov });
    expect(documentText(info)).toContain('Max LTC 85%');
  });
});
```

(`watermarkTexts`' exact return shape: read `report-checks.ts` before writing assertions; if it returns per-page strings, adjust `toContain` accordingly — the assertion intents above are normative, the helper call shape is not.) If `sellAllInputs()` turns out not to reach FINAL because its run is not senior-repaid, use the fixture this file already uses for a repaying route (check `prov.draftReason` in the first test and pick the ROUTES fixture whose reconciliation repays — the FINAL assertion is the requirement, the carrier fixture is free).

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/report-qa/memo-release-gate.test.ts`
Expected: the three new tests FAIL (missing map keys → likely a TS build error first; then missing panel rows). **This is guard 2: watch the FINAL test fail before the memo knows about cases.**

- [ ] **Step 3: Implement in `export-investment-memo.ts`**

1. The two maps gain their sixth rows:

```ts
  lender_case_stale: 'the lender case was approved against an earlier version of this document, which has since changed',
```

```ts
  lender_case_stale: 'DRAFT - LENDER CASE STALE - NOT FOR LENDER RELIANCE',
```

2. Provenance panel: after the `['Lender case', lenderCaseLabel(prov.lenderCaseStatus)]` row, insert (spread into the `body` array):

```ts
      // R14b (spec §21.4): every case_hash component is printed so a reviewer
      // can recompute it, the same property §13.2 gives the audit hash. The
      // decided timestamp is printed raw (canonical UTC ISO-8601) because it
      // is a hash component; the reader-friendly date is in the narrative.
      ...(prov.lenderCase ? ([
        ['Lender case id', prov.lenderCase.id],
        ['Case submitted by', prov.lenderCase.submitted_by ?? 'not yet submitted'],
        ['Case reviewer', prov.lenderCase.reviewer ?? 'not yet assigned'],
        ['Case decided', prov.lenderCase.decided_by === null
          ? 'not yet decided'
          : `${prov.lenderCase.decided_by} — ${prov.lenderCase.decided_at ?? 'no timestamp recorded'}`],
        ...(prov.lenderCase.conditions ? [['Approval conditions', prov.lenderCase.conditions]] : []),
        ['Case hash', prov.lenderCase.case_hash],
      ] as [string, string][]) : []),
```

3. After the `recomputedSinceSave` block:

```ts
  if (prov.lenderCaseStale) {
    y = infoRequired(
      y,
      `A refreshed lender case. The developer case has changed since this lender case locked its snapshot — the stored input hash no longer matches the locked ${prov.lenderCase?.locked_input_hash ?? 'value'} — so the approval above does not cover the figures printed here. Supersede the case and open a new one against the current appraisal.`,
    );
  }
```

4. The §13.2 caption gains a sentence (append inside the same `captionText` string):

```
 Where a lender case is printed, its case hash is sha256 over case id, project id, status, submitted-by, reviewer, decided-by, decided-at (canonical UTC ISO-8601) and the locked audit hash, joined by "|" (spec §21.4).
```

5. Narrative (Basis of Preparation): in the `lenderCaseLabel` branch, extend the template:

```ts
            prov.lenderCaseStatus === null
              ? 'No lender case has been submitted for credit approval.'
              : `The lender case is at "${lenderCaseLabel(prov.lenderCaseStatus)}"${
                  prov.lenderCase?.decided_by
                    ? `, decided by ${prov.lenderCase.decided_by}`
                    : prov.lenderCase?.reviewer
                      ? `, with reviewer ${prov.lenderCase.reviewer}`
                      : ''
                }.`,
```

- [ ] **Step 4: Run the report suites**

Run: `cd frontend && npx vitest run src/lib/report-qa/ src/lib/export-investment-memo.test.ts && npx tsc -b`
Expected: PASS — new tests green, every existing ROUTES sweep green (null-case documents gained no rows), build clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/report-qa/memo-release-gate.test.ts
git commit -m "feat(r14b): memo prints the lender case - stale banner, case rows, first FINAL document (spec 13.1, 21.4)"
```

---

### Task 8: `LenderCasePage` — calculator page 16

**Files:**
- Create: `frontend/src/components/calculator/LenderCasePage.tsx`
- Create: `frontend/src/components/calculator/LenderCasePage.test.tsx`

**Interfaces:**
- Consumes: Task 6's api functions + `ALLOWED_TRANSITIONS` + `structurallyEqual`; `LenderCase`/`LenderCaseEvent` types.
- Produces: `export default function LenderCasePage({ project, appraisalRecord, inputs }: { project: Project; appraisalRecord: FinancialAppraisal | null; inputs: CalculatorInputsV11 })` — Task 9 mounts exactly this signature.

- [ ] **Step 1: Write the failing tests**

`LenderCasePage.test.tsx` — mock the api module (`vi.mock('../../lib/api', ...)`), then:

- "explains the lock and disables creation with no saved appraisal": render with `appraisalRecord={null}`; expect the create button disabled and the text `Save the appraisal first` present.
- "disables creation for a pre-provenance record": `appraisalRecord={{...record, audit_hash: null}}`; expect disabled + `re-save` in the hint.
- "creates a case with the entered name": `getLenderCase` resolves `null`; type a name, click create; expect `createLenderCase` called with `(project.id, 'S. Sponsor')`.
- "renders the live case card": `getLenderCase` resolves a draft case; expect status label, both `locked_audit_hash` and `case_hash` substrings, `created_by`.
- "offers exactly the ALLOWED_TRANSITIONS buttons": for a `draft` case expect buttons for `submitted` and `superseded` only; for a `credit_approved` case expect `superseded` only. Derive expectations from the imported `ALLOWED_TRANSITIONS`, not a hand list.
- "requires conditions only for approved_with_conditions": with an `under_review` case, clicking the approve-with-conditions button reveals a conditions field; clicking `credit_approved` does not.
- "shows the stale warning when the server says stale": case with `stale: true` → text `has changed since this case locked its snapshot`.
- "shows the unsaved-edits warning when live inputs differ": case `stale: false`, `locked_inputs_snapshot` ≠ `inputs` → text `Unsaved edits differ from the locked snapshot`.
- "renders the event log newest first": `listLenderCaseEvents` resolves two events; expect both actors on the page.

Use the async patterns the existing page tests use (`findByText` after mocked fetches resolve). Read `MonitoringEditor.test.tsx` first and copy its setup idioms.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/calculator/LenderCasePage.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `LenderCasePage.tsx`**

Structure (inline `React.CSSProperties`, the calculator's dark palette `#0f172a`/`#1e3a5f`/`#e2e8f0`/`#94a3b8`; no arithmetic — this page reads and mutates governance state only):

```tsx
/**
 * Calculator page 16 — the lender case (R14b, spec §21).
 *
 * Owns its own data: pages mount on tab entry (ConversionCalculator renders
 * the active page only), so the mount-time fetch is always current, including
 * after a save flips staleness. Transition buttons are derived from
 * ALLOWED_TRANSITIONS — this component never keeps its own list, so it cannot
 * drift from the server's state machine (same table, both languages).
 */
import { useCallback, useEffect, useState } from 'react';
import type { FinancialAppraisal, LenderCase, LenderCaseEvent, LenderCaseStatus, Project } from '../../types';
import type { CalculatorInputsV11 } from '../../lib/model';
import {
  createLenderCase, getLenderCase, listLenderCaseEvents, listLenderCaseHistory,
  transitionLenderCase, ApiError, formatApiErrorDetail,
} from '../../lib/api';
import { ALLOWED_TRANSITIONS, structurallyEqual } from '../../lib/report-provenance';
```

State: `caseRecord: LenderCase | null`, `events: LenderCaseEvent[]`, `history: LenderCase[]`, `loaded: boolean`, `error: string | null`, `actor: string`, `note: string`, `conditions: string`, `pendingTo: LenderCaseStatus | null`.

`reload = useCallback` fetching all three endpoints (`Promise.all`), `useEffect(() => { void reload(); }, [project.id])`.

Behaviour:
- No case + no `appraisalRecord` → dashed panel: title "No lender case", body explaining the lock ("Creating a case locks the saved appraisal — inputs, hashes and calculation version — as the document a lender reviews; later edits mark the case stale rather than silently updating it."), create button `disabled` with hint "Save the appraisal first."
- No case + `appraisalRecord.audit_hash == null` → same panel, hint "This record predates provenance hashing — re-save the appraisal first."
- No case + provenance-hashed record → name input (labelled "Your name") + "Create lender case" button → `createLenderCase(project.id, actor)` → `reload()`.
- Live case → card with: status (humanised via the same `replace` idiom as `lenderCaseLabel`), `created_by/submitted_by/reviewer/decided_by/conditions`, `submitted_at/decided_at`, `locked_audit_hash`, `case_hash`, `locked_calc_version`/`locked_inputs_version`.
- Warnings: if `caseRecord.stale` → red-bordered box "The saved appraisal has changed since this case locked its snapshot. An approved case in this state no longer makes the document FINAL — supersede it and open a new case."; else if `!structurallyEqual(inputs as unknown, caseRecord.locked_inputs_snapshot)` → amber box "Unsaved edits differ from the locked snapshot — saving the appraisal will mark this case stale."
- Buttons: `ALLOWED_TRANSITIONS[caseRecord.status].map(...)`; clicking sets `pendingTo`; a small form appears with the actor input (required), note input, and — only when `pendingTo === 'approved_with_conditions'` — a conditions textarea; Confirm calls `transitionLenderCase(project.id, { to_status: pendingTo, actor, note: note || undefined, conditions: pendingTo === 'approved_with_conditions' ? conditions : undefined })`, then `reload()` and clears the form. Errors through `formatApiErrorDetail` into `error`.
- Change log: `events` newest-first list — `from_status → to_status`, actor, note, `occurred_at`.
- History: superseded cases (filter `history` for `status === 'superseded'`) as a compact list (status at death, decided_by, locked_audit_hash prefix).

Write the full component; keep it under ~300 lines.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/calculator/LenderCasePage.test.tsx && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator/LenderCasePage.tsx frontend/src/components/calculator/LenderCasePage.test.tsx
git commit -m "feat(r14b): LenderCasePage - case card, transitions, change log (spec 21.5)"
```

---

### Task 9: Wire the page and the export path

**Files:**
- Modify: `frontend/src/components/ConversionCalculator.tsx` (`CalcPage` union + `PAGES` entry `{ key: 'lender_case', label: 'Lender Case', num: 16 }` appended last + import + mount line)
- Modify: `frontend/src/components/ConversionCalculator.test.tsx` (mount coverage)
- Modify: `frontend/src/components/ExportPage.tsx` (fetch the case; pass into `buildProvenance`)
- Modify: `frontend/src/components/ExportPage.test.tsx`

- [ ] **Step 1: Write the failing mount test**

Read `ConversionCalculator.test.tsx` first and follow its mocking/rendering idioms. Add: "mounts the Lender Case page on its tab" — render with a project, mock `getLenderCase`/`listLenderCaseEvents`/`listLenderCaseHistory` (null/[]/[]), click the `16. Lender Case` tab button, expect the no-case panel text. This is the R14 fix-wave lesson: a page exists only if a test fails when it is unmounted.

Add to `ExportPage.test.tsx` (following its existing mocks): "passes the stored lender case into the memo's provenance" — mock `getLenderCase` to resolve an approved case and assert the generated memo call received a provenance whose `lenderCaseStatus === 'credit_approved'` (spy on `generateInvestmentMemo` the way the file already spies/mocks, or assert indirectly per its established pattern); and "still exports with no lender case" — `getLenderCase` rejects → memo still generated with `lenderCase` null.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/components/ConversionCalculator.test.tsx src/components/ExportPage.test.tsx`
Expected: FAIL — no tab; provenance lacks the case.

- [ ] **Step 3: Implement**

`ConversionCalculator.tsx`: extend the `CalcPage` union with `'lender_case'`; append the `PAGES` entry (appending last needs no renumbering — extend the R9/R11 renumbering comment with one line saying R14b appends at 16); import `LenderCasePage`; add the mount line inside the error boundary:

```tsx
        {activePage === 'lender_case' && (
          <LenderCasePage project={project} appraisalRecord={appraisalRecord} inputs={inputs} />
        )}
```

`ExportPage.tsx` (`handleInvestmentMemo`): after the eligibility fetch, add:

```ts
      // R14b (spec §21): the lender case rides into the provenance panel and
      // the FINAL gate. Optional like eligibility — a project with no case
      // prints the standing "No lender case" row and stays not_approved.
      let lenderCase: LenderCase | null = null;
      try {
        lenderCase = await getLenderCase(selectedProject.id);
      } catch {
        // optional for the memo
      }
```

and change the provenance line to `buildProvenance(run, appraisal, { lenderCase });` (import `getLenderCase` and the `LenderCase` type).

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/components/ && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ConversionCalculator.tsx frontend/src/components/ConversionCalculator.test.tsx frontend/src/components/ExportPage.tsx frontend/src/components/ExportPage.test.tsx
git commit -m "feat(r14b): mount page 16 and end the always-null provenance era (spec 13.1)"
```

---

### Task 10: Specification and documentation

**Files:**
- Modify: `docs/financial-model/calculation-specification.md`
- Modify: `docs/financial-model/model-governance.md`
- Modify: `docs/financial-model/test-cases.md`
- Modify: `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`

- [ ] **Step 1: Spec §13 edits**

1. §13.1 provenance table: after the "Lender-case approval status" row add rows `Lender case id / reviewer / decided / approval conditions / case hash | lender case, when one exists | — (rows omitted when no case exists)` matching Task 7's panel.
2. §13.2: add subsection **"13.2.1 The case hash [R14b]"** — the formula

```
case_hash = sha256( case_id | project_id | status | submitted_by | reviewer | decided_by | decided_at | locked_audit_hash )
```

joined by literal `|`, UTF-8, lower-case hex, absent parts empty strings, `decided_at` canonical UTC ISO-8601 (microseconds, literal `Z`, naive-as-UTC). State: recomputed on every transition; chained, not extending — "the audit hash gains no new parts" is restated, and the reviewer-recompute property holds for the case hash because every component is printed (§13.1).
3. §13.3: condition 5 becomes "An approved lender case: status `credit_approved` or `approved_with_conditions`, **that is not stale (§21.3)**." Banner table gains the row `| approved case is stale | DRAFT - LENDER CASE STALE - NOT FOR LENDER RELIANCE |`. The "five conditions" prose becomes six with a sentence on mutual exclusivity (stale fires only when an approval exists). Rewrite the closing bullet: "**Until R14b, with no lender case capable of existing, every document was a DRAFT — the intended answer of R7–R14, not a gap. R14b (§21) is the release that made an approved case, and therefore a FINAL document, possible.**"
4. Add **§21 Lender case governance [R14b]** at the end, with subsections: 21.1 The case record and the lock (whole-document lock table, creation preconditions incl. the pre-provenance refusal, project as record identity, one-live-case invariant + partial index); 21.2 The state machine (the transition table from the design doc §5 verbatim, per-transition side effects, conditions rule, 409/422 semantics); 21.3 Staleness (derived-never-stored, server hash-compare is authoritative and feeds the memo, client structural-equality drives the calculator's unsaved-edit warning only, the boundary-bump stated limitation mirroring §13.2's); 21.4 The case hash (cross-reference 13.2.1); 21.5 API and change log (five endpoints, append-only events, integer-key ordering note); 21.6 Stated limitations (no auth — free-text actors; no drawdown/certificate history; supersede-and-recreate is the only refresh). Source the exact content from the design doc §§4–7 — transcribe, do not re-derive.
5. Top-of-file dated changelog list gains one R14b bullet. **Do not touch §1.6 or any version constant** (`spec-versions.test.ts` must pass untouched — guard 3).

- [ ] **Step 2: `model-governance.md`**

1. §3's version table: currently stale at calc 2.10.0 / inputs v8 — bring it to 2.13.0 / v11 (R11→R14 rows) and add an R14b row (no calc/inputs bump; migration 006; spec §21).
2. The hash inventory (~lines 215–238): add `case_hash`; amend the "hashes are not currently compared anywhere" note — R14b's staleness derivation now compares `input_hash` against `lender_cases.locked_input_hash` on every case read.
3. The parity-pair roster (top of file): add `app/financial_model/provenance.py` ↔ `frontend/src/lib/report-provenance.ts` with `tests/test_provenance.py` ↔ `report-provenance.test.ts` as the pinning pair.

- [ ] **Step 3: `test-cases.md`** — add a §13 (or next free number; check the file) "Lender case governance (R14b)" briefly listing: the Python/TS mirrored governance suites, the state-machine walk + illegal-complement test, the independent case-hash re-derivations (both languages' conventions), the DB-level partial-index test, and the release gate's FINAL + stale documents.

- [ ] **Step 4: Release plan** — edit the R14b row to `**R14b** — **DONE, shipped**` and add an "R14b status" paragraph below the table (match the R13/R14 paragraphs' voice): what shipped, no calc/inputs bump, migration 006, spec §21, and that §13.3's "every document is a DRAFT" era ended.

- [ ] **Step 5: Verify the doc-reading tests**

Run: `cd frontend && npx vitest run src/lib/model/spec-versions.test.ts` and `python -m pytest tests/test_entry_point_guard.py -q`
Expected: PASS untouched.

- [ ] **Step 6: Commit**

```bash
git add docs/financial-model/calculation-specification.md docs/financial-model/model-governance.md docs/financial-model/test-cases.md docs/superpowers/plans/2026-08-17-second-audit-release-plan.md
git commit -m "docs(r14b): spec 13.2.1/13.3/21, governance doc refresh through 2.13.0, release plan row"
```

---

### Task 11: Full gates

- [ ] **Step 1: Backend** — `python -m pytest -q` → all pass, zero skips introduced.
- [ ] **Step 2: Frontend** — from `frontend/`: `npm test` → all pass; `npx tsc -b` → clean; `npm run lint` → zero warnings; `npm run build` → clean.
- [ ] **Step 3: Guard audit** — confirm, and note in the commit message of any fix: (1) the DraftReason-union test was seen red before Task 6's implementation; (2) the FINAL release-gate test was seen red before Task 7's implementation; (3) `spec-versions.test.ts` never changed; (4) the DB-level partial-index test passes.
- [ ] **Step 4: Fix any fallout** (each fix its own commit, `fix(r14b): ...`), re-run the full gates until green.
- [ ] **Step 5: Commit anything outstanding** — the branch is now ready for review (superpowers:requesting-code-review), then merge per superpowers:finishing-a-development-branch (`--no-ff`, as every release before it).
