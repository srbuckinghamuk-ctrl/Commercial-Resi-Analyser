# Release 14b — Lender case governance design

**Date:** 24 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.10 (*"Create distinct developer and lender snapshots. The lender case should
lock lender GDV, cost/programme adjustments, approved facility and credit
conditions; changes to the developer case should make it stale rather than
silently updating it. Add reviewer, approval state, timestamp and change
log."*) and §7.3 (*"An edit to the developer case should mark the lender case
stale and require a deliberate refresh or reapproval."*). Release-plan row:
**R14b** — the governance axis split out of R14 by that release's decision 1.

**Versions:** calc `2.13.0` unchanged; inputs `v11` unchanged (§3, decision 9).
The release is versioned by **Alembic migration 006** and the specification's
new **§21**.
**Specification:** §13.1's provenance panel gains the case rows; §13.2 gains a
`case_hash` subsection (the "gains no new parts" ruling is restated, not
repealed); §13.3's condition 5 becomes "an approved lender case that is not
stale" and the banner table gains a sixth row; §13.3's closing "with no lender
case in existence, every document is a DRAFT" bullet is rewritten as history;
the specification gains **§21 Lender case governance**.

---

## 1. The problem this release exists to solve

### 1.1 The spec has been waiting for this release since R7

§13.3's FINAL gate (R7, calc 2.6.0) requires, as condition 5, "an approved
lender case: status `credit_approved` or `approved_with_conditions`". §13.1's
provenance panel prints a lender-case approval row whose absent value is "No
lender case — not submitted for credit approval". `report-provenance.ts`
carries the full eight-state `LenderCaseStatus` union, `APPROVED_STATUSES`,
and a `not_approved` draft reason ordered deliberately last — with the comment
"Populated from R14; null until then."

Nothing populates it. There is no table, no API, no way to create a case, and
`buildProvenance` receives `null` as its lender-case argument at every
production call site (`ExportPage.tsx`, `export-investment-memo.ts`). Every
document the product has ever generated is a DRAFT, which §13.3 states is "the
intended answer, not a gap" — intended *until the governance release ships*.
This is that release: the one that makes a FINAL document possible.

### 1.2 An approval that nothing can go stale against is not an approval

Audit §7.10's second demand is the sharper one: a lender case must **lock**
what was approved, and an edit to the developer case must mark the lender case
**stale** rather than silently updating it. The repo's nearest concepts are
thin: `recomputedSinceSave` compares `calc_version` only, and
`model-governance.md` records that the stored hashes, whose module docstring
promises stale-appraisal detection, are never actually compared anywhere. A
lender reading today's memo has no way to know whether the figures in front of
them are the ones anybody reviewed.

### 1.3 Governance lives in one language

`report-provenance.ts` has no Python counterpart —
`test_appraisal_governance.py` says so in as many words ("Python has no
DraftReason union — that governance lives entirely in report-provenance.ts on
the frontend"). While governance was pure presentation that was tolerable.
R14b makes governance *server state* with server-enforced transitions, so the
authority for "what may this document claim" cannot remain client-only: the
release creates `app/financial_model/provenance.py`, the first member of a new
dual-implemented pair, under the same line-for-line porting contract as
`monitoring.py`.

---

## 2. Scope

The R14 design's split table, restated:

| Release-plan R14 ask | R14 (shipped) | R14b (this) |
|---|---|---|
| C1, monitoring statement, `lender_eligible` wired | ✅ | |
| Lender case record, approval, reviewer, stale, change log | | ✅ |

R14b is a persistence-and-workflow release. **It contains no arithmetic**: no
engine change, no input-schema change, no fixture pin moves. Its live path is
the lender-case table, API, and the governance functions both languages will
now share.

---

## 3. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | Snapshot scope | **Whole document**: the case copies the stored appraisal's full `inputs_snapshot` plus `calc_version`, `inputs_version`, `input_hash`, `outputs_hash`, `audit_hash` at creation | Lender-fields-only lock — needs a per-field lock list every future release must re-litigate; hashes-only — cannot print or diff what was approved after the developer case moves on |
| 2 | Hash chain | **Chained `case_hash`**: `audit_hash`'s six-part formula is untouched; the case gets its own hash whose last component is the locked `audit_hash` | Extending `audit_hash` itself — changes every stored hash on next save, breaks §13.2's reviewer-recompute claim and its twice-stated "gains no new parts" ruling, and a case transition (which happens without an appraisal re-save) would silently invalidate stored hashes |
| 3 | Staleness | **Derived, never stored**, and it **defeats FINAL**: §13.3 condition 5 becomes "approved and not stale", new banner `DRAFT - LENDER CASE STALE - NOT FOR LENDER RELIANCE` | Warning-only — lets a FINAL banner print over figures the lender never saw, the exact fault §7.10 names; writing `superseded` on developer save — a stored status flip that destroys the record that the case *was* approved and entangles the appraisal write path with governance writes |
| 4 | Reviewer identity | **Free-text actor names** on transitions (`created_by`, `submitted_by`, `reviewer`, `decided_by`), the `LenderValuation.author` idiom | Real auth — a users table, sessions and attribution of every write path is its own release; a single-user product gains almost nothing today (`api_secret_key` stays "reserved for future auth") |
| 5 | Persistence shape | **Case rows + append-only event table**; superseded cases remain as history; at most one non-superseded case per project via partial unique index | Change log as a JSON column — a mutable log on a mutable row; event-sourced-only — nothing else in the repo derives state by folding events |
| 6 | Case identity | `project_id` FK, the §13.2 reasoning: the appraisal is unique per project, so the project is the stable identity | FK to the appraisal row id — survives only as long as no legacy dedupe touches the row, and the appraisal repo deliberately tolerates legacy duplicates |
| 7 | Refresh after stale | **Supersede + create a new case**; a locked snapshot is never rewritten | An in-place "re-lock" — mutates the thing whose immutability is the feature |
| 8 | Client staleness check | **Deep structural equality** of the live canonical inputs against `locked_inputs_snapshot` | Client-side hashing — hashes are the server's, never the client's (§13.1); server-hash-only — misses unsaved in-session edits, and the memo prints the live run |
| 9 | Versioning | **No calc bump, no inputs bump**: nothing inside `inputs_snapshot` or the engines' arithmetic moves (R6 precedent — shipped on calc 2.5.0) | A courtesy 2.14.0 — would stamp every stored result "recomputed since save" in the memo's disclosure paragraph for no figure change |
| 10 | Case creation precondition | Requires a saved appraisal row carrying an `audit_hash` | Allowing a case on a pre-provenance or unsaved result — locks a snapshot the hash chain cannot bind |

---

## 4. Persistence (migration 006)

Two new tables in `app/persistence/database.py`, beside the existing four. The
`financial_appraisals` table is untouched — no new columns, so
`test_alembic_migrations.py`'s `GOVERNANCE_COLUMNS` list is unchanged; its
hard-coded revision walk gains `"006"`.

### 4.1 `lender_cases`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `project_id` | FK → `projects.id`, CASCADE | decision 6 |
| `status` | String(32), not null | the eight-state enum, §5 |
| `locked_inputs_snapshot` | JSON, not null | full copy at creation |
| `locked_calc_version` | String, not null | |
| `locked_inputs_version` | Integer, not null | |
| `locked_input_hash` | String(64), not null | |
| `locked_outputs_hash` | String(64), not null | |
| `locked_audit_hash` | String(64), not null | not-null enforces decision 10 |
| `case_hash` | String(64), not null | recomputed on every write, §6.1 |
| `created_by` | String, not null | free text, min length 1 |
| `submitted_by` | String, nullable | set by `→ submitted` |
| `reviewer` | String, nullable | set by `→ under_review` |
| `decided_by` | String, nullable | set by a decision transition |
| `conditions` | Text, nullable | required iff `approved_with_conditions` |
| `submitted_at` | DateTime(tz), nullable | |
| `decided_at` | DateTime(tz), nullable | |
| `created_at` / `updated_at` | DateTime(tz) | `server_default=func.now()` / `onupdate`, the house pattern |

**One live case per project:** a partial unique index on `project_id` with
`WHERE status != 'superseded'` (declared once on the ORM `Index` with both
`postgresql_where` and `sqlite_where`, so Alembic's migration and the
`lifespan` `create_all` boot path agree — the empty-sqlite migration test
asserts metadata ⊆ migrated tables and will catch drift).

### 4.2 `lender_case_events`

Append-only, the `StageTransitionORM` shape copied deliberately:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `case_id` | FK → `lender_cases.id`, CASCADE | |
| `from_status` | String(32), nullable | null exactly once per case: the creation event |
| `to_status` | String(32), not null | |
| `actor` | String, not null | |
| `note` | Text, nullable | |
| `occurred_at` | DateTime(tz), `server_default=func.now()` | |

Every case write — creation included — writes its event **in the same
transaction** (repository flushes, endpoint commits, the house rule). Events
are listed newest-first, mirroring stage transitions.

---

## 5. The state machine

Statuses are the union `report-provenance.ts` has carried since R7:
`draft | submitted | under_review | information_required | credit_approved |
approved_with_conditions | declined | superseded`.

Allowed transitions — this table is normative and lives once per language
(§8):

| From | To |
|---|---|
| `draft` | `submitted`, `superseded` |
| `submitted` | `under_review`, `superseded` |
| `under_review` | `information_required`, `credit_approved`, `approved_with_conditions`, `declined`, `superseded` |
| `information_required` | `under_review`, `superseded` |
| `credit_approved` | `superseded` |
| `approved_with_conditions` | `superseded` |
| `declined` | `superseded` |
| `superseded` | — (terminal) |

Per-transition side effects, enforced server-side:

- `→ submitted`: actor recorded as `submitted_by`, `submitted_at` stamped.
- `→ under_review`: actor recorded as `reviewer` (a resubmission via
  `information_required → under_review` overwrites it — the reviewer of
  record is the current one; the event log keeps the history).
- `→ credit_approved | approved_with_conditions | declined`: actor recorded
  as `decided_by`, `decided_at` stamped. `conditions` is **required** for
  `approved_with_conditions` and **must be absent** for every other
  transition (422 either way) — one field, one meaning.
- `→ superseded`: actor recorded in the event only; the case columns keep
  the state they had, so history shows what the case was when it died.
- Every transition writes its event and recomputes `case_hash`.

An illegal transition is a **409** whose detail names the current status and
the allowed set. A transition on a project with no live case is a 404.

---

## 6. Hashes and staleness

### 6.1 `case_hash`

```
case_hash = sha256( case_id | project_id | status | submitted_by | reviewer
                    | decided_by | decided_at | locked_audit_hash )
```

joined by the literal `|`, over UTF-8, lower-case hex. Absent parts are the
empty string; `decided_at` is ISO-8601 UTC. Computed **in Python only**
(`app/financial_model/hashing.py`), stored on the case row, computed at
creation and recomputed on every transition — the hashes-are-the-server's
rule holds.

Every component is printed on the provenance panel (§7), so the property
§13.2 claims for the audit hash — a reviewer holding the printed panel can
recompute the hash and detect after-the-fact alteration of any field beside
it — holds for the case hash too. The chain is: `case_hash` binds the case's
governance state to `locked_audit_hash`; `locked_audit_hash` binds (via
§13.2) the project, versions, status, inputs and outputs the lender actually
reviewed. `audit_hash` itself gains no new parts — §13.2's ruling is restated
in the new subsection, not repealed.

### 6.2 Staleness

Staleness is **derived at read time in both languages and stored nowhere**:

- **Server** (authoritative for saved state): the live appraisal row's
  `input_hash != locked_input_hash`. Returned as `stale` on every case read.
- **Client** (what the memo uses): deep structural equality of the live
  canonical inputs document against `locked_inputs_snapshot`. The memo prints
  the *live* run, and an unsaved in-session edit moves no stored hash — the
  deep-equal is the only check that can see it. Key order is irrelevant;
  the test reorders keys to pin that.

Staleness is a property of **any** live case and the UI warns on all of them;
it defeats FINAL only through condition 5 (an approved case that is stale).

**Stated limitation (mirrors §13.2's boundary-bump limitation):** a future
`inputs_version` boundary migrates the stored snapshot server-side on next
save, which moves `input_hash` without any user edit — every live case goes
stale at that boundary. This is correct behaviour, not a defect: the document
is no longer byte-for-byte the one approved. The next migration release's
notes must say so.

### 6.3 §13.3 after this release

Condition 5 becomes: *an approved lender case (`credit_approved` or
`approved_with_conditions`) **that is not stale***. The banner table gains a
sixth row:

| Failing condition | Banner |
|---|---|
| approved case is stale | `DRAFT - LENDER CASE STALE - NOT FOR LENDER RELIANCE` |

`DraftReason` gains `lender_case_stale` in both languages. The two new
outcomes are mutually exclusive by construction: no approved live case →
`not_approved`; approved live case whose document has moved →
`lender_case_stale`. Ordering stays 1–4 as shipped, then these two. The
closing "with no lender case in existence, every document is a DRAFT" bullet
is rewritten as a historical note — it described R7–R14, and stops being the
intended answer the moment this release ships.

---

## 7. API

A new `lender_cases_router` in `app/api/app.py`, prefix `/lender-cases`,
mounted with the others under `/api/v1`. Conventions as everywhere: `DbDep`,
`HTTPException` details in the two shapes `formatApiErrorDetail` reads,
repository flushes / endpoint commits.

| Endpoint | Behaviour |
|---|---|
| `POST /lender-cases` `{project_id, created_by}` | Creates the case at `draft`, locking the snapshot from the stored appraisal row. 404 no project or no appraisal; **409** a live case already exists (the partial index's application-level twin); **422** the appraisal carries no `audit_hash` (pre-provenance row — re-save it first). Writes the creation event (`from_status: null`). |
| `GET /lender-cases/{project_id}` | The live case with derived `stale`, or JSON `null` when none exists (200 either way — "no case yet" is a normal state, not an error). |
| `POST /lender-cases/{project_id}/transition` `{to_status, actor, note?, conditions?}` | Validates against §5, applies side effects, writes the event, recomputes `case_hash`. 404 no live case; 409 illegal transition; 422 conditions rule. |
| `GET /lender-cases/{project_id}/history` | All cases, newest first (superseded included). |
| `GET /lender-cases/{project_id}/events` | The change log across all of the project's cases, newest first. |

Pydantic models in `app/models.py`: `LenderCaseCreate`, `LenderCaseTransition`,
`LenderCaseRead` (includes `stale: bool`), `LenderCaseEventRead`. Repository
`LenderCaseRepository` in `app/persistence/repositories.py` with the house
`_to_domain` shape.

The appraisal write path is untouched: a developer save neither reads nor
writes the case tables (decision 3's rejected branch). Staleness emerges at
the next case read.

---

## 8. The Python governance twin

New module `app/financial_model/provenance.py`: a line-for-line port of
`report-provenance.ts`'s governance core, under the `monitoring.py` porting
contract (header names the source file and spec section):

- `LenderCaseStatus` literal, `APPROVED_STATUSES`.
- `ALLOWED_TRANSITIONS` — §5's table, the single Python source the API
  validates against. `report-provenance.ts` gains the same table for the UI's
  button-enabling; the two are pinned against each other by mirrored tests
  exercising identical (from, to) cases, legal and illegal.
- `DraftReason` (now six members), `draft_reason()`, `document_status()`.
- `is_stale(current_input_hash, locked_input_hash)`.

The existing TS diagonal pin (tax gate ordered above `not_approved`, which
would otherwise be unreachable) gets its Python mirror, and both languages
gain the new diagonal: an approved-but-stale case yields `lender_case_stale`,
not `not_approved`, and never outranks conditions 1–4. The
`test_appraisal_governance.py` comment asserting Python has no `DraftReason`
is deleted with the reality it described.

---

## 9. UI

- **New calculator page 16 — "Lender Case"** (`LenderCasePage.tsx` +
  `LenderCasePage.test.tsx`), one `PAGES` entry following the renumbering
  comment's convention, mounted in `ConversionCalculator`'s page block, with
  mount coverage (the R14 fix-wave lesson — an editor exists only if a test
  fails when it is unmounted). The page shows:
  - the live case card: status, all four actor fields, timestamps, the locked
    hashes and `case_hash`, a stale warning when `stale`;
  - transition buttons derived from `ALLOWED_TRANSITIONS` (never a hand-kept
    list), each opening actor/note (and conditions, where required) fields;
  - the event log, newest first; superseded-case history beneath.
  - No case → an explanation panel of what creating a case locks, with the
    create action; disabled with the reason when the appraisal is unsaved or
    pre-provenance.
- **`ConversionCalculator`** loads the case beside the appraisal on project
  change and after every save (a save can flip staleness), holding it in
  state alongside `appraisalRecord`.
- **Provenance wiring** — the release's point: `ExportPage` and the memo pass
  the real `lenderCaseStatus` and the client-derived staleness into
  `buildProvenance`, ending the production-always-`null` era. `buildProvenance`
  gains the staleness input; `draftReason` consumes it per §6.3.
- **Memo:** `DRAFT_REASON_SENTENCE` and `WATERMARK_TEXT` gain the
  `lender_case_stale` row; the provenance panel gains case id, reviewer,
  decided timestamp, case hash and a staleness disclosure; the already-written
  "lender case at status X" narrative branch goes live, extended with the
  reviewer/decided sentence and, when stale, a sentence stating the document
  has changed since approval.

Styling follows the calculator's inline-`CSSProperties` dark-palette idiom.

---

## 10. Testing

- **`tests/test_lender_case_governance.py`** (modelled on
  `test_appraisal_governance.py`'s local-fixture pattern): creation locks the
  exact stored snapshot and hashes; creation refused without appraisal /
  without `audit_hash` / with a live case; the full legal walk
  draft→submitted→under_review→information_required→under_review→approved_with_conditions
  with side-effect assertions at each step; every illegal (from, to) pair
  409s; conditions required/forbidden 422s; supersede-and-recreate; stale
  flips on a changed-inputs re-save and does **not** flip on an identical
  re-save; `case_hash` re-derived independently by the test (sha256 by hand,
  the governance-test convention) and shown to move on every transition;
  event log completeness including the creation event; project-delete
  cascade.
- **Schema/infra:** `test_orm_tables.py` classes for both tables (name +
  required columns); `test_alembic_migrations.py` walk gains `"006"`;
  `test_api_endpoints.py` gains the five paths; the partial-index invariant
  (second live case refused at the DB layer) pinned on sqlite.
- **Python twin:** `tests/test_provenance.py` mirroring
  `report-provenance.test.ts` case-for-case — ordering diagonals, transition
  table, stale.
- **TS:** `report-provenance.test.ts` gains `lender_case_stale` ordering and
  the deep-equal staleness (including reordered-keys); `LenderCasePage.test.tsx`
  (no-case panel, populated card, buttons follow `ALLOWED_TRANSITIONS`,
  conditions field appears only where required); `ConversionCalculator` mount
  + load coverage; `api.ts` client functions typed and exercised through the
  page tests.
- **Memo release gate:** a fixture document with an approved case renders
  **FINAL** (the first FINAL document the gate has ever asserted), a second
  with an approved-but-stale case renders the stale banner, and the case
  provenance rows appear in the extracted PDF text.
- **No golden fixture and no corpus changes** — the corpus pins arithmetic
  and this release has none. The rosters are untouched; the corpus-walk
  tests must pass unmodified, and that is itself the no-arithmetic guard.

---

## 11. Guards this release must watch fail

1. The **TS ordering diagonal** must fail while `lender_case_stale` is
   mis-ordered (written first against the unmodified `draftReason`, watched
   red, then the implementation lands).
2. The **memo release gate's FINAL document**: watched failing (still DRAFT)
   before the provenance wiring lands — proving the wiring, not the enum, is
   what flips it.
3. **`spec-versions.test.ts` must stay green untouched** — if it goes red the
   release has accidentally moved a version constant it promised not to move.
4. The **partial unique index** test: two concurrent live cases must be
   refused by the database, not only by the endpoint's 409 check.

---

## 12. Also in scope

- `docs/financial-model/model-governance.md` §3 is stale at calc 2.10.0 /
  inputs v8 — updated through 2.13.0 / v11 (and now §21); its "hashes are
  never compared anywhere" note is amended — stale detection now compares
  `input_hash`, and the parity-pair roster gains
  `provenance.py`/`report-provenance.ts`.
- Two comments claiming "migration 004 adds the unique constraint"
  (`app/api/app.py`, `app/financial_model/hashing.py`) are corrected to 003 —
  a comment that lies is a defect (R12's lesson).
- The release-plan R14b row is marked shipped on completion, as every
  release does.

## 13. Out of scope

- Evidence-led RAG risk categories with red/amber/green/unknown — audit
  §7.10's first paragraph, R15's evidence axis.
- Unit- or type-level lender valuation overlay with valuer/date/basis/status —
  audit §7.3's first ask, unscheduled.
- Authentication and real user identity (decision 4).
- Drawdown-request / certificate history — R14 spec §20.5 limitation 5 names
  the change log as where a history would live; the *case* change log ships
  here, the drawdown history does not.
- Any change to `audit_hash`, the engines, the input schema, or the fixture
  corpus.
- UX stage grouping (R16).

## 14. Shape of the work

Roughly thirteen tasks in four bands: **schema and hashes** (ORM tables,
migration 006, `case_hash`, repository), **governance core** (Python twin +
TS transition table + staleness, the dual test pair), **API** (five
endpoints, models, backend suite), **surface** (page 16, calculator wiring,
provenance/memo wiring, release gate documents, doc debt). Bands one to three
are backend-sequential; the surface band fans out once the API exists.
