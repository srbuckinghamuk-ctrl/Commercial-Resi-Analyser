# Financial Model — Governance

**Status:** Authoritative. Describes how the calculation model in
`docs/financial-model/calculation-specification.md` (calc version `2.13.0`, inputs `v11`) is owned, changed,
versioned and gated for release. This document is the answer to the audit's P0 finding
("Model governance, calculation versioning and release gates" — score 3/5 under "Overall Product
Quality") and to prohibited-calculation #9 in the spec (§11): *"Any report/export/page recomputing
a formula instead of consuming the engine result"*.

---

## 1. Dual-implementation policy

There are two independent implementations of the same specification:

- **TypeScript** (`frontend/src/lib/model/`) — the interactive engine. It runs in the browser on
  every keystroke so the calculator pages, scenario comparisons, deal spider and PDF exports can
  be instant. It is *not* the authority for what gets persisted.
- **Python** (`app/financial_model/`) — the authority. Every value that reaches the database goes
  through `run_appraisal()` server-side (`app/api/app.py::calculate_authoritative`), regardless of
  what the client submitted. The Python module's docstrings and structure explicitly mirror the TS
  module file-for-file (`engine.py` ↔ `monthly-engine.ts`, `schedule.py` ↔ `schedule.ts`,
  `migrate.py` ↔ `migrate.ts`, `metrics.py` ↔ `metrics.ts`, `validation.py` ↔ `validation.ts`,
  `types.py` ↔ `finance-types.ts`) so a reviewer can read one against the other line by line.
  **[R14b]** The roster gains a pair that is not an engine module:
  `app/financial_model/provenance.py` ↔ `frontend/src/lib/report-provenance.ts`, the
  document-governance core (spec §21.2's transition table, `APPROVED_STATUSES`, the
  six-member `DraftReason` and its ordering, `document_status`, `is_stale`). It is pinned by
  `tests/test_provenance.py` ↔ `frontend/src/lib/report-provenance.test.ts`, written
  case-for-case, with both languages restating §21.2's table *literally* rather than deriving
  it from the module under test. Until R14b this governance existed in TypeScript alone —
  `test_appraisal_governance.py` said so in as many words — which was tolerable while it was
  pure presentation. R14b makes it *server state with server-enforced transitions*, so the
  authority for "what may this document claim" can no longer be client-only: the API cannot
  validate a state machine that exists only in the browser. Only the governance core is
  ported; `buildProvenance`, the tax/VAT gate helpers and the memo's presentation stay
  TypeScript-only, because nothing server-side consumes them.

**Golden fixtures are the contract**, not either language's source code. The fixture JSON files
in `fixtures/financial-model/` are hand-derived from the specification (see
`docs/financial-model/test-cases.md` §2 for the arithmetic), not extracted from whatever either
engine currently outputs. Both engines are required to match the fixtures, not each other directly
— this is a deliberate asymmetry: it means a bug present in *both* implementations (e.g. both
copying the same wrong interpretation of a spec clause) is still caught, because the fixture
numbers were derived independently of both.

### Why two implementations instead of one (e.g. WASM-shared)

Recorded here rather than re-litigated per change: the interactive TS engine and the
server-authoritative Python engine solve different problems (client responsiveness vs. tamper
resistance and a single source of truth for persisted data). A shared WASM/compiled-core approach
was considered out of scope for Release 1 — the dual-implementation-plus-shared-fixtures approach
was judged to deliver the audit's required guarantee ("stored derived outputs must match a server
recalculation", audit §6 validation rule 15) at materially lower implementation risk for this
release. Revisiting this is a legitimate Release 2+ discussion, not a defect.

## 2. Formula-change procedure

Any change to a formula in this codebase — however small — follows this order, in one change
(one PR / one set of commits), never split across releases with one language lagging:

1. **Edit the specification** (`docs/financial-model/calculation-specification.md`). The spec is
   authoritative; code changes that aren't reflected in the spec are themselves defects.
2. **Update the affected fixture(s) with a hand derivation.** If the change alters a fixture's
   expected output, the new expected value must be re-derived by hand (or by an independent
   calculation, e.g. a spreadsheet cross-check) and the derivation recorded — either inline as a
   code comment (as in `monthly-engine.test.ts`, e.g. Fixture F-grosscap's
   `grossHeadroomCap = floor(...) − ...` comment) or in `docs/financial-model/test-cases.md`. A
   fixture update whose new number is simply "whatever the code now produces" is not acceptable —
   that would silently convert the fixture from a contract into a snapshot test.
3. **Update both engines in the same change.** TS and Python are edited together; a PR that
   changes one without the other must fail CI (golden-fixture parity — §6.3 below) rather than
   merge and drift.

This procedure is itself demonstrated in the implementation history of this release: the Fixture E
arrangement fee (recomputed to 2% × £350,000 = £7,000 after a brief error was caught mid-task) and
the Fixture F gross-headroom cap (added because spec §4.2(c) wasn't originally reflected in the
ledger) both went through spec → fixture (with hand derivation) → both engines, recorded in
`.superpowers/sdd/2026-08-12-release-1-p0-financial-correction/progress.md` (Task 4 entries).

### 2.1 Recorded exception — Fixture K's derivation split (R4, 2026-08-16)

Fixture K (`k-sensitivity.json`, spec §12) does not hand-derive all thirty-four of its
appraisals. Read literally, §2 step 2 would require that; it is disproportionate, and it
is not what the rule protects.

What §12 adds over the existing engine is **composition, not new arithmetic** — lever
application, grid enumeration and ordering, the reduction to the compact record, and the
tornado span-and-sort. Fixture K therefore hand-derives:

- every derived input, per axis (§12.1's disjointness makes these per axis, not per cell);
- the base cell, reused verbatim from Fixture F;
- two corner cells, worked through on a worksheet the way Fixture F was;
- every tornado span and the resulting order.

and *identity-asserts* the remaining cells against
`runAppraisal(applyScenario(base, overrides))` — the expression §12.3 defines a cell as.
That assertion is the contract itself, not a snapshot: a wrong cell can only come from
wrong lever composition or wrong enumeration, and the hand-derived items above pin both.

This exception was put to the product owner and approved during the Release 4
brainstorming session; see `docs/superpowers/specs/2026-08-16-release-4-design.md` §4.
It licenses no other fixture: a change to appraisal *arithmetic* still hand-derives in
full.

The worksheet is in `test-cases.md` ("Fixture K — sensitivity suite"). It tabulates the
full twelve-month ledger of each corner month by month; for the tornado it gives each
endpoint's interest lines and totals, except the two `gdv` endpoints, whose ledgers are
Fixture F's unchanged and which are derived by that identity instead. It opens by
re-deriving Fixture F from scratch and reproducing all eight of F's pinned figures — the
method check that licenses everything after it. Every figure was derived and written
down before either engine was run; both engines then agreed with all
of them at the first attempt, which is the outcome §1's asymmetry is designed to make
meaningful rather than tautological.

### 2.2 The golden fixture corpus

The shared corpus (`fixtures/financial-model/`) both engines run identically, per §1.
Its membership is asserted directly — `EXPECTED_FIXTURE_STEMS` (`golden-fixtures.test.ts`)
and its Python mirror both fail if a fixture file is added or removed without the roster
being told — so this list and the code cannot silently drift apart:

| Fixture | Inputs version | What it exercises |
|---|---|---|
| A — all-cash | v5 | The baseline case: no debt, no interest, `funding_gap_pence` structurally 0. |
| F — dev finance, 12mo | v5 | Rolled-up interest, gross-headroom draw cap (spec §4.2(c)). |
| G — lender valuation | v5 | The disclosed lender-GDV adjustment (spec §3.2). |
| H — dated programme, s-curve | v5 | Explicit programme, spend curves, shifted windows (spec §6.1). |
| I — phased sell_all | v5 | Three-tranche sales sweep, declining redemption schedule. |
| J — blended, same-month refinance | v5 | Blended exit plus a refinance event landing the same month as a sale tranche. |
| K — sensitivity | n/a — no own `inputs`; runs `f-dev-finance-12mo` (`base_fixture`) through §12's levers | The two-way matrix and tornado (spec §12); derivation split per §2.1 above. |
| L — retain-all | v5 | No disposal, no refinance — `equity_multiple` unrealised (spec §3.16.1, R7). |
| M — Wales, jurisdiction | v5 | LTT, a confirmed jurisdiction and acquisition date (spec §14, R8). |
| N — area bridge, all-cash | v6 | The full entered area bridge, bridge-derived construction area (spec §15, R9). |
| O — ancillary value, blended exit | v6 | Parking/balcony value split between GDV and gross sale receipts under a blended exit. |
| P — Scotland, levered | v6 | LBTT; the §5.10 cost-to-complete counter-example (test-cases §14.9) — C1, **closed in R14**: now pins `null` / `0` with the old `1` / `392483` as negative controls. |
| Q — detailed cost plan, levered | v7 | The detailed cost-plan mode, three contingency classes on different bases, two fee bases — added R10 (Task 11); test-cases §16.8. Its ineligible externals package became live in R14; test-cases §20.2. |
| R — VAT quarterly, levered | v8 | The pinned VAT return cycle plus chargeable purchase VAT and its acquisition-tax uplift — added R11; test-cases §17.1. |
| S — fourteen-phase dated programme, slack phases, anchored two-tranche sale, tagged package | v9 | R12 §18's flagship: a fourteen-phase precedence network, duration-0 milestones, float and the critical path, an SS edge with a lag, anchored sale tranches and per-line `phase_id` overrides — added R12; test-cases §18, and §20.3 for its R14 re-derivation under the wired advance cap. |
| T — retain-all with an investment case, DSCR binds | v10 | R13 §19: hold-period NOI, operating lines on both bases, a net-initial-yield valuation and a take-out where **DSCR** is the binding constraint — added R13. |
| U — retain-all with an investment case, LTV binds | v10 | T's twin, identical but for `cap_yield_pct` and `takeout.ltv_cap_pct`, so the binding constraint flips to **LTV** — added R13. |
| V — exhausted interest reserve, rolled-up development finance | v10 | R14 §5.10's positive case for the C1 correction: a rolled-up facility whose interest reserve is far smaller than the interest accrued, so a **real** shortfall survives the correction alongside a real `funding_gap_pence` — added R14; test-cases §20.1. |
| **W — monitoring statement on site, detailed cost plan, one ineligible package** | **v11** | **R14 §20: the first v11-native document and the release's cross-engine penny-agreement carrier — a `monitoring` block at reporting month 6, a lender-ineligible package driving `lender_eligible_ratio`, and the corpus's only detailed-mode fixture still reaching §7's fully-realised profit identity — added R14; test-cases §20.4.** |

(A, F–M carry `inputs_version: 5` in their stored JSON regardless of which release originally
authored them — every fixture below v6 was brought up to the then-current schema rather than
frozen at the version it was written under, so this column records what is actually on disk
today, not a fixture's release of origin.)

Letters B–E are not missing from this table — they belong to a **separate** fixture
family, the hand-built four-month ledger fixtures (`test-cases.md` §3) that call
`runLedger`/`run_ledger` directly rather than the whole pipeline, and are not loaded
from a JSON file at all. This table lists only the whole-pipeline corpus §2 of
`test-cases.md` describes, which is where `EXPECTED_FIXTURE_STEMS` and its Python
mirror apply. A fixture whose `kind` is `"sensitivity"` (K alone, at present) carries
no standalone `inputs` document and is asserted separately, as its own describe block,
rather than through the whole-corpus loops every other fixture runs through.

## 3. Versioning

Two independent version numbers travel with every appraisal document:

- **`calc_version`** — semver of the specification's implementation. Currently `"2.13.0"`
  (single source of truth `CALC_VERSION` in `app/financial_model/types.py`, re-exported by
  `app/financial_model/__init__.py`; TS mirror `frontend/src/lib/model/finance-types.ts`).
  Outputs are only comparable within one `calc_version` — a report or comparison spanning two
  calc versions must say so, never silently blend them (spec §1.6).
- **`inputs_version`** — schema version of the *input document*: `1` = legacy pre-spec snapshot
  (the shape the product used before Release 1); `2` = Release 1's `CalculatorInputsV2` shape;
  `3` = Release 2b's `CalculatorInputsV3` shape (adds the optional `lender_valuation` block and
  `finance.enforcement_cost_assumption_pence`, see `migration-notes.md` §5); `4` = Release 3a's
  `CalculatorInputsV4` shape (adds the optional `programme`, `sales_phasing` and `refinance`
  blocks, spec §6.1); `5` = Release 8's `CalculatorInputsV5` shape (adds the acquisition block's
  `jurisdiction`, `jurisdiction_source`, `jurisdiction_evidence_status`, `acquisition_date` and
  the two acquisition-tax override fields, spec §14); `6` = Release 9's `CalculatorInputsV6` shape
  (adds the entered `areas` block and a per-unit `ancillary` block, spec §15); `7` = Release 10's
  `CalculatorInputsV7` shape (adds the `cost_plan` block — mode, package schedule, three
  contingency classes, fee lines, spec §16); `8` = Release 11's `CalculatorInputsV8` shape (adds
  the `vat` block — registration, return cycle, six per-category treatment rows, the
  purchase/TOGC block, and an optional `vat_override` on each cost package and fee line, spec
  §17); `9` = Release 12's `CalculatorInputsV9` shape (turns `programme` into a precedence
  network and adds `phase_id` on packages and fee lines, `anchor` on sale tranches and
  `refinance`, and the two `phase_slip` scenario fields, spec §18); `10` = Release 13's
  `CalculatorInputsV10` shape (adds the top-level `investment_case` block, narrows
  `refinance.investment_value_pence`/`ltv_pct` to nullable and adds the
  `arrangement_fee_basis`/`arrangement_fee_pct` pair, spec §19); `11` = Release 14's
  `CalculatorInputsV11` shape (adds the top-level nullable `monitoring` block, spec §20). Every
  new save persists `inputs_version: 11` — the migration chain
  v1→v2→v3→v4→v5→v6→v7→v8→v9→v10→v11 is applied in-place before persistence, so the stored
  document is never left in an older shape after a save. An *unrecognised* `inputs_version` (12,
  99) is rejected with a 422 by both engines rather than falling through to the v1 fallback
  path, which would silently rebuild the finance block.

`calc_version` and `inputs_version` are independent axes. Calc `2.13.0` consumes v2 through v11
input documents directly (`run_appraisal` takes the union; a v2 document's lender-basis metrics
are null, a document with `programme: null` produces a byte-identical schedule to its v3 source,
and a document with no `cost_plan` at all is read through `costPlanFromLegacyCosts`/
`cost_plan_from_legacy_costs`, spec §16.7), but **v11 is canonical server-side** [R14, following
the same rule since R10's v7]: `calculate_authoritative` migrates whatever arrives to v11 before
validating, calculating and persisting it, so no older-shaped input reaches the engines without
migration and no older-shaped document is ever stored.

### 3.1 Version record, release by release

Kept current at every release, because a governance document stating a version the code left
behind is the same defect as a spec stating a formula the code left behind. `Migration` is the
Alembic revision the release shipped, where it moved the persistence schema at all.

| Release | `calc_version` | `inputs_version` | Migration | What moved | Spec |
|---|---|---|---|---|---|
| R10 | 2.9.0 | v7 | — | Cost-plan modes: headline/detailed, three contingency classes, fee bases | §16 |
| R11 | 2.10.0 | v8 | — | VAT and TOGC: the return cycle, per-category treatments, purchase VAT | §17 |
| R12 | 2.11.0 | v9 | — | The dated, dependent programme: a precedence network, float and the critical path | §18 |
| R13 | 2.12.0 | v10 | — | The investment case: hold-period NOI, a yield valuation, an LTV/DSCR/ICR-sized take-out | §19 |
| R14 | 2.13.0 | v11 | — | §5.10's C1 correction, the monitoring statement, `lender_eligible` wired into §4.2(b) | §20 |
| **R14b** | **2.13.0 — unchanged** | **v11 — unchanged** | **006** | **Lender case governance: `lender_cases` + `lender_case_events`, the state machine, `case_hash`, derived staleness, the Python governance twin. No engine change, no schema change, no fixture pin moved — the release is versioned by the migration and by the spec section alone** | **§21** |
| R13b | 2.14.0 | v12 | — | The unit-level sales ledger: per-unit timing, deposits, cost overrides, pre-sales coverage, `sales_slip`; §5.11 replays anchored tranches at resolved months | §22 |
| R15 | 2.15.0 | v13 | — | The due-diligence evidence schedule: 28-item catalogue, RAG/unknown, derived rows, source-conflict flags, QS provenance and price basis, the seventh FINAL condition | §23 |

**Why R14b bumps neither number.** Nothing inside `inputs_snapshot` moves and no arithmetic
changes, so an inputs bump would be a lie and a calc bump would be worse than one: `calc_version`
drives the memo's "recomputed since save" disclosure (spec §13.1), so a courtesy 2.14.0 would
stamp every stored result as a re-computation for no figure change at all. R6 set the precedent —
it shipped on calc 2.5.0 unchanged. What a release with no version bump still owes is a spec
section and a migration, and R14b has both.

## 4. Status lifecycle

Every persisted appraisal carries a `status` (`frontend/src/types.ts:154`; backend
`app/models.py:357`, a plain string mirroring the same three values, not yet a DB-level enum):

| Status | Meaning | Set when |
|---|---|---|
| `draft` | v2 inputs, recalculated, but not currently report-safe | incoming snapshot is already v2 (`inputs_version == 2`) and `run.reconciliation.report_safe` is `False` |
| `reconciled` | v2 inputs, recalculated, and fully reconciled | incoming snapshot is already v2 and `report_safe` is `True` |
| `legacy_unreconciled` | v1-shaped snapshot (pre-migration) | incoming snapshot's `inputs_version != 2` — **unconditional**, regardless of what `report_safe` would otherwise say |

The transition logic is the single `if/elif` in `calculate_authoritative()`
(`app/api/app.py:316-320`):
```python
status = (
    "legacy_unreconciled" if was_v1
    else "reconciled" if run.reconciliation.report_safe
    else "draft"
)
```
This is the *only* place status is decided — there is no client-settable status field, no separate
state machine, and no "transition" that isn't a full recalculation. Both `POST /appraisals`
(create) and `PUT /appraisals/{project_id}` (update) call this same function, so every save
re-derives status from first principles. A `legacy_unreconciled` row can only leave that status
via a save, because that is the only path where `migrate_inputs()` runs and stamps
`inputs_version: 2` into the stored snapshot — after which the *next* save (not the same one,
since `was_v1` is evaluated on the *incoming* snapshot for *that* request) is evaluated as v2 and
can reach `reconciled`/`draft`. In practice the migrating save and the first v2-evaluated save
coincide, because `calculate_authoritative` computes `was_v1` before migration on each individual
call — see `migration-notes.md` §3 for the exact request-by-request walk-through on the York
appraisal.

## 5. Hashes

`app/financial_model/hashing.py` defines `canonical_hash()`: SHA-256 over a canonical JSON
encoding (`sort_keys=True`, compact separators, `ensure_ascii=False`) — deterministic regardless
of key insertion order or whitespace.

- **`input_hash`** — hash of the full validated v2 `CalculatorInputsV2` document
  (`inputs.model_dump(mode="json")`): every acquisition, unit, cost, finance, equity, exit, risk,
  scenario and deal-spider field. Two saves with byte-identical inputs produce identical
  `input_hash`, which is asserted directly by
  `tests/test_appraisal_governance.py::test_input_hash_and_outputs_hash_persisted`.
- **`outputs_hash`** — persisted as `canonical_hash(outputs)` at the call site
  (`app/api/app.py:333`), where `outputs = {"metrics": ..., "reconciliation": ...}` — i.e. it
  covers **both** the metrics dataclass and the reconciliation dataclass, not metrics alone. (The
  standalone `outputs_hash()` helper in `hashing.py`, which hashes only `asdict(metrics)`, exists
  in the module but is not the function actually called at the persistence site — a minor internal
  inconsistency worth tidying in Release 2, not a governance risk, since the persisted value is
  what matters and it is the wider, more conservative hash.)

- **`audit_hash`** — spec §13.2, added R7 (migration 005). SHA-256 over the six-part string
  `project_id | calc_version | inputs_version | status | input_hash | outputs_hash`, joined by a
  literal `|`. A hash *of the other hashes*, so a reviewer holding a printed provenance panel can
  recompute it from the six fields beside it. Record identity is `project_id`, not the appraisal
  row id, because migration 003 made the appraisal unique per project. Pre-R7 rows carry `null`
  and are deliberately not backfilled.
- **`case_hash`** — spec §13.2.1, added R14b (migration 006). SHA-256 over the eight-part string
  `case_id | project_id | status | submitted_by | reviewer | decided_by | decided_at |
  locked_audit_hash`, same join and encoding; absent parts are empty strings and `decided_at` is
  rendered in one canonical UTC ISO-8601 form (microseconds, literal `Z`, naive-as-UTC) so a
  write-time hash and a re-read recomputation agree byte for byte. Stored on `lender_cases`,
  recomputed on every transition. It is **chained onto** the locked `audit_hash` rather than
  folded into it: `audit_hash`'s formula gains no new parts, because extending it would rewrite
  every stored hash on the next save, and because a case transition happens without an appraisal
  re-save and would otherwise invalidate hashes on rows nobody touched.

**Purpose:** these hashes let a client or auditor detect staleness — "have the inputs I'm looking
at actually produced the outputs I'm looking at, under this calc version?" — without re-running the
model. They are not used to reject a save: the server always recalculates regardless of any
client-supplied hash.

**[R14b] One of them is now compared, and this note used to say none of them were.** Until R14b
the hashes were recorded and exposed but never read back for a decision, which is worth stating
plainly because `hashing.py`'s own module docstring promises stale-appraisal detection.
Spec §21.3 makes good on it for one pair: every read of a lender case compares the live
appraisal row's `input_hash` against the case's `locked_input_hash` and returns the derived
`stale` flag, and that flag defeats FINAL through spec §13.3 condition 6. The comparison is
derived at read time and stored nowhere. The other hashes remain provenance-only:
`outputs_hash` and `audit_hash` are still never compared by any code path, and no save is
rejected on a hash mismatch.

## 6. What blocks `report_safe`

`report_safe` (`app/financial_model/validation.py`, `ReconciliationStatus.report_safe`, computed
lines 224-229; TS mirror `frontend/src/lib/model/validation.ts:9-18`) is the single boolean that
governs both the persisted `status` (§4) and the PDF draft watermark (§7). It is `True` only when
**every** one of the following holds:

1. No hard input-validation errors (`validate_inputs`/`validateInputs` severity `error`).
2. `sources_equal_uses` — sources total equals uses total to the penny (spec §7 invariant).
3. `rollforward_ok` — the debt ledger's roll-forward identity holds every month (spec §4).
4. `never_negative` — no month's closing senior balance is negative.
5. `facility_within_limit` — no `facility_exceeded` flag was raised by the engine.
6. `funding_complete` — `funding_gap_pence == 0` **and** `additional_equity_pence == 0` (no
   unfunded cost, and no equity shortfall from servicing interest).
7. `not inputs.finance.requires_confirmation` — a migrated legacy facility (§3, `migrate.py`) can
   **never** be report-safe until a human explicitly confirms the proposed facility terms; this is
   the mechanism that keeps a migrated-but-untouched appraisal permanently gated even if every
   other condition above happens to hold.

Any one of these seven conditions failing means `report_safe = False`, which means `status` is at
best `draft` (or `legacy_unreconciled` if the inputs were v1) and the exported PDF carries the
DRAFT watermark (§7). There is no partial-credit or override path from the UI or API — the
condition list above is exhaustive and evaluated fresh on every save.

## 7. The DRAFT watermark rule

`frontend/src/lib/export-investment-memo.ts`: `const draft = !run.reconciliation.report_safe;`
(line 140). When `draft` is true, `DRAFT_WATERMARK_TEXT = 'DRAFT - UNRECONCILED - NOT FOR LENDER
RELIANCE'` (line 31) is drawn diagonally across every page.

**Coverage fix (Task 10):** the watermark must appear on *every physical page* of the exported
PDF, including pages that `jspdf-autotable` creates internally when a table spans more than one
page (those pages never pass through the module's own `newPage()` helper, because autoTable calls
`doc.addPage()` itself mid-table). The fix wraps every `autoTable(...)` call site in a local
`table()` function that injects a `didDrawPage` callback calling `ensureWatermark()` — which fires
once per physical page the table touches, including the first, deduplicated via
`lastWatermarkedPage` so an already-watermarked page is never redrawn. Every table in the memo
generator goes through this `table()` wrapper, never `autoTable(doc, ...)` directly, specifically
so this guarantee cannot be silently bypassed by a future table added without going through it.
Regression coverage: `frontend/src/lib/export-investment-memo.test.ts` asserts the watermark
appears on all pages of a forced-multi-page table, and that zero watermark calls occur on a fully
reconciled run.

This closes the audit's specific complaint under "Reporting review": *"Export must be blocked or
watermarked DRAFT — UNRECONCILED whenever hard validations fail"* — the mechanism is watermarking
(not blocking), and it is now proven page-complete rather than only applying to the first page or
to pages reached via the module's own pagination.

## 8. Known asymmetries between the two engines (recorded, not hidden)

- **Percentage-field validation is stricter in Pydantic than in the TS runtime validator.**
  `app/financial_model/types.py` enforces `broker_fee_pct: float = Field(ge=0)` and
  `selling_agent_fee_pct: float = Field(ge=0)` unconditionally at the API boundary. The TS
  `validateInputs()` (`frontend/src/lib/model/validation.ts:20-38`) has an explicit
  `NON_NEGATIVE_MONEY` list covering only `*_pence` fields — `acquisition.broker_fee_pct` and
  `exit_strategy.selling_agent_fee_pct` are not checked client-side. Net effect: a negative broker
  or agent fee percentage would pass the frontend silently but is rejected with HTTP 422 by the
  backend on save. This is safe by construction (the server is authoritative and always
  recalculates/validates), but it means the client can display a wrong number for one render cycle
  before a save is attempted. Recorded as a deferred minor for Release 2 UI validation
  tightening, not a governance risk.
- **Ledger fixtures B–F ARE pinned in both languages** (correcting an earlier, wrong statement in
  an initial draft of this document — see `test-cases.md` §3/§7): `tests/test_financial_model_engine.py`
  is an explicit, reviewed transliteration of `frontend/src/lib/model/monthly-engine.test.ts`,
  asserting the same pence values for fixtures B–F including both mid-implementation corrections
  (Fixture E's £7,000 arrangement fee, Fixture F's gross-headroom-cap numbers). The two remaining,
  narrower cross-language gaps are: (1) the invariant suite's variant matrix is lighter in
  Python — it checks 2 of the 7 invariants (roll-forward, sources-equal-uses) across the 2 base
  golden fixtures only, without TS's `retain_all`/`serviced`/`term=1` derived-variant generation;
  and (2) there is no shared migration-mapping fixture — TS has a dedicated hand-derived unit-test
  file for v1→v2 migration (`migrate.test.ts`, 4 cases) with no direct Python counterpart (Python's
  migration coverage is a narrow floors-zero regression plus an end-to-end API test, not a
  case-for-case port). Both are recorded as Release 2 scope in `test-cases.md` §7.

---

## 9. Single-accessor rules [R9 — calc 2.8.0]

### 9.1 Why the rule exists

R8 ended with a recorded pattern: the same "moved the computation, missed a
consumer" defect occurred **three times in one release**. When acquisition tax
became jurisdiction-aware, `calculateTotalAcquisitionCost` was updated;
`deal-spider.ts` and `AcquisitionPage.tsx` were not. Each site was individually
self-consistent, so each site's tests passed, and the whole suite stayed green
while the deal spider scored a Welsh acquisition on English SDLT and the
acquisition page displayed a figure the server did not store.

A test cannot catch that class of defect, because the defect is *the absence of a
call*. Nothing in a test file names a call site that does not exist. The only
thing that catches it is a rule that makes the raw read itself illegal.

### 9.2 What is covered

Two values are derived once and consumed everywhere. Each has exactly one **owning
module**, and reading its underlying data outside that module is a build failure:

| Value | The one accessor | The raw thing that is off-limits |
|---|---|---|
| Construction cost area (spec §15.3/§15.4) | `developedAreaSqm(inputs)` / `developed_area_sqm(inputs)` in `areas.ts` / `areas.py` — or `areaBridge`/`area_bridge` from the same module where the caller needs the whole reconciliation rather than the scalar (only `derive_metrics` and `validate_inputs` do; see spec §15.4) | the `total_construction_sqm` field |
| Acquisition tax (spec §14) | `calculateAcquisitionTax()` / `calculate_acquisition_tax()` in `acquisition-tax.ts` / `acquisition_tax.py` | the `TAX_TABLES` band table, **and** `selectBandSet` / `select_band_set` |

[R9 fix round 2 — the whole-branch review. `selectBandSet`/`select_band_set` was
added to the second row's off-limits column because it was a read path the guard
could not see: it is an exported function that hands back the very `.bands` list
`TAX_TABLES` holds, so a consumer could evaluate its own acquisition tax through
it and trip **neither** half of the guard. One legitimate caller exists in each
engine — `validation.ts` / `validation.py`, asking whether an acquisition date can
be placed in a band set at all and reporting the answer as a `ValidationIssue`.
It never reads `.bands` and never computes tax; §9.4 records how it is exempted.]

The cost area is the harder of the two, and the reason the rule was written for
R9 rather than left as convention: after §15.3 the answer to "what area is
construction charged on?" depends on `areas.basis`, so a site that reads
`conversion_costs.total_construction_sqm` directly is not merely inelegant — it
is **wrong for every document on the `bridge_derived` basis**, and wrong
silently, because the field it read still holds a plausible number.

### 9.3 How each language enforces it

**TypeScript — eslint, at build time.** `frontend/eslint.config.js` carries five
`no-restricted-syntax` selectors. `npm run lint` runs with `--max-warnings 0`, so
a violation fails the build, not just a test run.

The selectors are deliberately *different shapes*, and that difference is the
point. The cost area is read as a property, so it is matched as
`MemberExpression[property.name='total_construction_sqm']`. `TAX_TABLES` is an
exported top-level const imported by name, so it appears as a bare `Identifier`,
not a `MemberExpression` — matching it with the selector that is correct for the
other rule would have linted cleanly and never fired. A guard that cannot fire is
the same defect as a wrong number: it reports success it has not earned. Every
selector was verified against the real symbol before being written.

[R9 fix round 2 — the whole-branch review found three more read paths the first
two selectors could not see, each closed by a selector of its own rather than by
loosening an existing one:
`ObjectPattern > Property[key.name='total_construction_sqm']` for
`const { total_construction_sqm } = costs` (there is no member access to match,
so the first selector was blind to it); scoped to `ObjectPattern` deliberately,
because the same property on an `ObjectExpression` is a **write** —
`updateCosts({ total_construction_sqm: v })` — which this rule has never
restricted. `MemberExpression[computed=true][property.value='total_construction_sqm']`
for `costs['total_construction_sqm']`, where the field name lives on
`property.value` (a `Literal`) rather than `property.name`. And
`Identifier[name='selectBandSet']` for the band-set accessor described in §9.2.]

**Python — an AST scan, as a test.** Python has no eslint, so
`tests/test_accessor_guard.py` walks every module under `app/` with the `ast`
module and flags only the node shapes that are an actual read:
`ast.Attribute` nodes whose `.attr` is `total_construction_sqm` (catching
`inputs.conversion_costs.total_construction_sqm` and `cc.total_construction_sqm`
at any depth), and `ast.Name`/`ast.Attribute` references to `TAX_TABLES`.

[R9 fix round 2 — the same three gaps, mirrored. `getattr(x, "total_construction_sqm")`
is the dynamic spelling of the attribute read, invisible to the attribute walk
because the field name is a string argument; only a *literal* second argument is
matched, since a computed one is not a shape this guard can decide.
`x["total_construction_sqm"]` is a dict-key read of a raw, still-unparsed
snapshot — stored appraisals round-trip through JSON, so a consumer reading the
dict before it is parsed into a model bypasses the accessor exactly as an
attribute read would. Only an `ast.Subscript` *slice* is matched, so a dict
**literal** key of the same name (`{"total_construction_sqm": 0}`, which
`migrate.py` writes) is untouched: that is an `ast.Dict` key, and it is a write,
not a read. `test_the_guard_does_not_flag_a_dict_literal_key` is the counter-
example that pins it. Finally `ast.Name`/`ast.Attribute` references to
`select_band_set` get their own scan and their own allowlist.]

The AST walk rather than a substring search is load-bearing. This tree already
contains three shapes a substring scan would flag and must not: a doc comment in
`app/api/app.py` naming the field, the module docstrings in `areas.py` and
`migrate.py`, and `validation.py` passing `"conversion_costs.total_construction_sqm"`
as an issue's *field name* — data, not a read. A guard that cries wolf gets
weakened until it is useless, so the scan is written to be precise, and two of its
tests assert that it stays silent on exactly those shapes.

**Both guards have been watched to fail.** `test_the_guard_itself_detects_a_planted_attribute_read`
and `test_the_guard_itself_detects_a_planted_tax_table_reference` write a probe
module containing a real violation, assert the scan flags it, and delete it in a
`finally`. The TypeScript rules were likewise confirmed against a planted
violation before the allowlist was finalised. A guard nobody has watched fail is
not a guard.

[R9 fix round 2 — every new shape earned the same proof.
`test_the_guard_itself_detects_a_planted_getattr_read`,
`..._planted_dict_key_read` and `..._planted_band_set_selection` plant their own
violation, and each first asserts that the *pre-existing* finder does **not** see
it — otherwise the proof would be re-testing the old rule and reporting a
success it had not earned. On the TypeScript side `accessor-guard.test.ts` runs
the real linter (ESLint's Node API) against synthetic sources for the
destructured, computed and `selectBandSet` shapes and asserts `severity === 2`,
plus a negative control proving an object-literal *write* is still not flagged.]

### 9.4 The allowlist, and what it means

A short list of files may read the raw values: the modules that **own** them
(`areas.ts`/`areas.py`, `acquisition-tax.ts`/`acquisition_tax.py`), the modules
that **declare** them (`conversion-types.ts`, `finance-types.ts`, `types.py`),
the migration and defaults modules that **construct documents where no accessor
yet applies** (`migrate.ts`/`migrate.py`, `conversion-defaults.ts`), and
`ConversionCostsPage.tsx`, which is the editor that **captures** the manual field
as the user's own input.

Adding a file to the allowlist is a governance decision, not a convenience: it
should be accompanied by a reason in the config, and the list should be read as
the complete answer to "who is allowed to know how this value is stored".

[R9 fix round 2 — `validation.ts` / `validation.py` are the one legitimate
caller of `selectBandSet` / `select_band_set`, and the two engines exempt them
differently *on purpose*. `tests/test_accessor_guard.py` runs a separate scan
per symbol, so `validation.py` sits on the band-set allowlist alone and remains
fully covered by the cost-area and `TAX_TABLES` scans. eslint's file allowlist is
all-or-nothing **per rule**, so putting `validation.ts` on it would switch off the
cost-area selectors for the one module most likely to grow a raw read. Its two
references are therefore exempted at the **call sites**, with
`// eslint-disable-next-line no-restricted-syntax` on the import and on the call.
`accessor-guard.test.ts` pins both halves: that `validation.ts` never appears in
the config, and that the file carries exactly two line-scoped disables and no
file-wide `/* eslint-disable no-restricted-syntax */`.]

### 9.5 Recorded limitation — test files are exempt

**Test files are excluded from both guards**, and this is a real gap, recorded
rather than glossed.

`**/*.test.ts`, `**/*.test.tsx` and `src/lib/report-qa/memo-fixtures.ts` are on
the TypeScript allowlist, and the Python scan covers `app/` only, not `tests/`.
The exemption is necessary — a fixture must construct the raw `conversion_costs`
block, and a tax parity test must read the band table it is testing against — but
it means **a consumer defect written inside a test file is not caught by this
rule**. A test helper that computed a cost area from `total_construction_sqm` and
then asserted against it would lint cleanly and pass, pinning the wrong behaviour.

Nothing currently does this. The mitigation is that the golden fixtures
(`fixtures/financial-model/*.json`) are pure data consumed by both engines and
contain no computation at all, so the one place where a wrong area would do the
most damage cannot express one. Widening the Python scan to `tests/` with a
narrower allowlist is a candidate for a future release; it is not done here
because the exemption list would need to be large enough that the guard's meaning
would be unclear.

### 9.6 The cross-engine message-drift guard [R15 — calc 2.15.0]

`tests/test_financial_model_validation.py::test_validation_messages_match_the_typescript_engine`
reads `validation.ts` and requires each in-window `err()` message to appear in
`validation.py` verbatim. Until R15 its window covered the spec §19.7
investment-case block alone. It now runs from the §22.7 unit-sales block (so
§22.7 and §19.7 are both inside it) and reads `validateDueDiligence`'s body as a
**second window**, because that function — like `validateMonitoring` — sits
below `validateInputs` and no start anchor inside `validateInputs` can reach it.
Each window is bounded at both ends and its blocks are asserted to appear in the
expected order, so a block cannot silently fall out of a widened window.

Widening it did what a widened guard is supposed to do: it found **three §22.7
messages that had drifted since R13b** — the TypeScript text used an em-dash
where the Python text used an ASCII hyphen. The **Python** strings were moved to
the TypeScript text verbatim. That is a wording change with no behaviour change,
so the identity gate is untouched, and it is recorded here rather than only in a
commit message because "the two engines said the same thing in two ways" is
exactly the class of asymmetry this section exists to surface.

---

## 12. Report governance [R7 — calc 2.6.0]

The engine's authority stops at the number. §13 of the specification governs the
document that carries it.

### 12.1 Where the rules live

`frontend/src/lib/report-provenance.ts` owns the governance decisions —
`draftReason`, `documentStatus`, `buildProvenance` — so neither the report
generator nor a React component decides them. This is the same rule as
prohibited-calculation #9: a report consumes decisions, it does not make them.

`frontend/src/lib/report-layout.ts` owns page geometry shared by every generated
PDF. Before R7 the draft watermark existed twice, with a comment on the second
copy explaining why it could not be shared; both copies were wrong in the same
two ways.

### 12.2 The FINAL gate

Spec §13.3. **Seven** conditions, tested in order, each with its own banner:
reconciled, senior repaid, tax basis confirmed (R8), VAT basis confirmed (R11),
due diligence complete (R15), lender case approved (R14b), and that approval not
stale (R14b). `report_safe`
deliberately does not include senior repayment (§7) — an appraisal that intends
to refinance later is valid — so the document gate tests it separately. No
document showing an unrepaid senior balance at maturity can be issued as final.

[R14b. This read "Three conditions" and "Until a lender case exists (R14),
condition 3 cannot be met and every document is a DRAFT" — true when written at
R7, and left behind twice as R8 and R11 added their gates. R14b adds the last
two and, more importantly, makes the approval condition *meetable*: spec §21
supplies the case record, the state machine and the approval, so a document that
reconciles, repays, evidences both bases and carries a current approved case now
renders FINAL. The release gate asserts exactly that document — the first FINAL
one it has ever been able to assert.]

[R15. A seventh condition sits between the VAT gate and the approval gate: no
*entered* due-diligence item may be `unknown` (spec §23.7). It is placed there
for the reason R8 and R11 placed theirs — an unknown does not make a figure
wrong, so it must not displace a reason that says the figures themselves may be,
but a reader must know the evidence is missing before they read an approval. The
release-gate FINAL document consequently carries a fully addressed schedule. A
document with no `due_diligence` key at all is not re-graded, on R8's rule, and
every production entry point migrates to v13 before running, so every *stored*
document is graded.]

### 12.3 The audit hash

Computed once, server-side, in `calculate_authoritative` alongside the other two
hashes; stored on `financial_appraisals.audit_hash` (migration 005); printed in
the provenance panel. Recomputable by a reviewer from the six printed fields.
Pre-existing rows are not backfilled — see spec §13.2.

### 12.4 Release gate

`docs/financial-model/test-cases.md` §12. A report change is not releasable until
the page-bounds, sparse-page, provenance, watermark and figure-reconciliation
assertions pass over all five representative documents.
