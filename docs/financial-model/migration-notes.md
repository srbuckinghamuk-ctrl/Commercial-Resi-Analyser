# Financial Model — Migration Notes (v1 → v2 → v3 … → v7)

**Status:** Authoritative. Describes how pre-Release-1 ("v1") appraisal snapshots are migrated to
the `2.0.0` calculation specification's input shape ("v2"), the database schema change that makes
this legible, and the concrete before/after behaviour of the one appraisal known to be affected in
the live database — 9 & 9A Stonegate, York, YO1 8AN (audited in
`docs/reviews/2026-08-12-lender-readiness-audit.md` §4).

---

## 1. v1 → v2 field mapping

Implemented identically in `app/financial_model/migrate.py` (Python, authority) and
`frontend/src/lib/model/migrate.ts` (TypeScript, per the dual-implementation policy in
`model-governance.md` §1 — `migrate.py`'s own docstring records it as an explicit port).

| v1 field | v2 field(s) | Behaviour |
|---|---|---|
| `finance.ltv_pct` | `finance.legacy_leverage_pct` | Preserved verbatim for audit — never discarded, never itself treated as an approved lender metric (spec §2, "Legacy leverage"). |
| `finance.ltv_pct` (+ v1 cost-before-finance) | `finance.committed_net_facility_pence` | **Proposed, unconfirmed.** `committed_net_facility_pence = round(cost_before_finance × ltv_pct / 100)` — computed via `money_round()`, the same integer-pence rounding used everywhere else in the engine. This is a *proposal*, not an approved facility: it exists only so the migrated document has a facility number to display, and it is exactly reproducing the pre-Release-1 defect the audit identified ("A field labelled LTV is actually applied to cost before finance") — deliberately, transparently, and flagged `requires_confirmation: true`, rather than silently perpetuated as if it were a real lender commitment. |
| *(no v1 equivalent)* | `finance.day_one_advance_pence` | Always `None`/`null` — v1 had no day-one-advance concept, so this is genuinely unknown, not defaulted to zero or to the facility total (spec §1.5: unknown ≠ zero). |
| *(no v1 equivalent)* | `finance.day_one_market_value_pence`, `finance.committed_gross_facility_pence`, `finance.interest_reserve_pence` | Also `None` — same reasoning. |
| `finance.interest_rate_annual_pct`, `interest_type`, `arrangement_fee_pct`, `exit_fee_pct`, `loan_term_months` | `finance.annual_interest_rate_pct`, `interest_type`, `arrangement_fee_pct`, `exit_fee_basis`/`arrangement_fee_basis` (defaulted to `committed_net_facility`/`committed_gross_facility`), `exit_fee_pct`, `term_months` | Carried across 1:1 (renamed where the v2 schema renamed the field); fee bases are defaulted since v1 had no basis concept. |
| *(v1 equity was a single derived residual, not a typed source)* | `equity_sources: [{ classification: "cash", amount_pence: cost_before_finance − proposed_facility, timing_month: 0, evidence_status: "unconfirmed", ... }]` | A single synthetic `cash` equity source is created, sized as the residual of cost-before-finance less the proposed facility (i.e. what v1's residual-arithmetic equity would have been), explicitly marked `unconfirmed` and annotated with a migration note. |
| *(no v1 draw-priority concept)* | `finance.equity_draw_rule = "fund_as_required"` | The legacy draw rule (spec §4.2): equity absorbs any residual month's cost with **no cap**, so a migrated appraisal's sources always balance by construction — but it is only permitted while `requires_confirmation` is true, so the case remains visibly unconfirmed rather than looking like a normal `equity_first` deal. |
| *(none)* | `finance.requires_confirmation = true` | Set unconditionally on every migrated document. This is what keeps a migrated appraisal out of `report_safe` (`model-governance.md` §6, condition 7) regardless of whether every other reconciliation check happens to pass. |
| *(implicit — no version field)* | `inputs_version: 2` | Stamped on the migrated document; this is also the flag `calculate_authoritative()` checks (`was_v1 = raw.get("inputs_version") != 2`) to decide whether migration is needed and whether `status` becomes `legacy_unreconciled` (`model-governance.md` §4). |

The exact Python migration function (`migrate_finance_v1`, `app/financial_model/migrate.py:230-275`):

```python
is_cash = v1["funding_source"] == "cash"
proposed_facility = 0 if is_cash else money_round((cost_before_finance * v1["ltv_pct"]) / 100)
finance = {
    "funding_source": v1["funding_source"],
    "day_one_advance_pence": None,
    "day_one_market_value_pence": None,
    "development_cost_advance_pct": 100,
    "committed_net_facility_pence": proposed_facility,
    "committed_gross_facility_pence": None,
    "annual_interest_rate_pct": v1["interest_rate_annual_pct"],
    "interest_type": v1["interest_type"],
    "arrangement_fee_pct": v1["arrangement_fee_pct"],
    "arrangement_fee_basis": "committed_net_facility",
    "exit_fee_pct": v1["exit_fee_pct"],
    "exit_fee_basis": "committed_gross_facility",
    ...
    "interest_reserve_pence": None,
    "term_months": v1["loan_term_months"],
    "equity_draw_rule": "fund_as_required",
    "sales_sweep_pct": 100,
    "legacy_leverage_pct": v1["ltv_pct"],
    "requires_confirmation": True,
}
equity = [{
    "id": "migrated-cash-equity",
    "classification": "cash",
    "amount_pence": cost_before_finance - proposed_facility,
    "timing_month": 0,
    "repayment_priority": 1,
    "evidence_status": "unconfirmed",
    "notes": (
        "Migrated from v1 snapshot: residual of cost before finance less "
        "proposed facility. Confirm before lender use."
    ),
}]
```

A dedicated regression test (`tests/test_financial_model_fixtures.py::test_migration_preserves_floors_zero`)
guards a specific porting bug: the original TS `??` (nullish coalescing) vs. a naive Python `or`
would silently turn a genuine `0` value into a fallback default, because Python's `or` treats `0`
as falsy. The Task 11 review caught this drift (progress ledger: "migrate.py:177 or-vs-?? floors:0
drift") and it is now pinned by a dedicated test — spec §1.5's "unknown vs zero" distinction
depends on this being right.

## 2. DB migration 002 (`migrations/versions/002_appraisal_governance.py`)

Adds seven columns to `financial_appraisals` (revision `002`, `down_revision = "001"`):

```python
op.add_column("financial_appraisals", sa.Column("outputs", sa.JSON))
op.add_column("financial_appraisals", sa.Column("validation", sa.JSON))
op.add_column("financial_appraisals", sa.Column("calc_version", sa.String(32)))
op.add_column("financial_appraisals", sa.Column(
    "inputs_version", sa.Integer, nullable=False, server_default="1"))
op.add_column("financial_appraisals", sa.Column(
    "status", sa.String(32), nullable=False, server_default="legacy_unreconciled"))
op.add_column("financial_appraisals", sa.Column("input_hash", sa.String(64)))
op.add_column("financial_appraisals", sa.Column("outputs_hash", sa.String(64)))
```

**No data backfill is performed.** The `status` column's `server_default = "legacy_unreconciled"`
is what marks every pre-existing row — including the live York appraisal — as unmigrated, purely
by virtue of the column not existing in their row before this migration ran. `inputs_version`
defaults to `1` for the same reason (the pre-existing rows' stored `inputs_snapshot` genuinely *is*
v1-shaped; the default is honest, not a placeholder). No row's `inputs_snapshot`, `outputs`,
`calc_version` or hashes are touched by the migration itself — every one of those is only ever
written by the server-side recalculation path (`calculate_authoritative`) the next time that row
is saved.

## 3. The York appraisal's expected post-migration behaviour

Walking the exact request sequence against `app/api/app.py`'s `calculate_authoritative`,
`create_appraisal` and `update_appraisal`:

1. **Before this release:** the York row was created via the pre-Release-1 API. Its
   `inputs_snapshot` is v1-shaped (has `ltv_pct`, no `inputs_version` key at all), and it has no
   `outputs`, `calc_version`, `status`, or hash columns (they didn't exist yet).
2. **After migration 002 runs, before any save:** the row now has those columns, all populated by
   `server_default` — `status = "legacy_unreconciled"`, `inputs_version = 1`. `GET
   /appraisals/{project_id}` returns exactly this: **`status: "legacy_unreconciled"`**, with
   `outputs`/`calc_version`/hashes all null/absent, because nothing has recalculated the row yet.
3. **Loading it in the UI:** `ConversionCalculator.tsx` reads the returned `status` and, per the
   `STATUS_BANNER` map (lines 61-70), renders the `legacy_unreconciled` case in **red**
   (`color: '#ef4444'`) with the label *"Legacy — recalculation required, save to migrate"*. The
   calculator itself always displays the live `runAppraisal(migrateInputs(...))` result (never the
   stale stored legacy columns), so the numbers on screen are already the migrated/recalculated
   ones even before the user saves — the banner is what signals that this is a proposal pending
   confirmation, not yet what is persisted as authoritative.
4. **Saving (PUT):** the client submits (whatever inputs are currently in the form, itself already
   the migrated shape) to `update_appraisal`, which calls `calculate_authoritative`. Inside that
   call: `raw = payload.inputs_snapshot`; if the client is submitting a v1-shaped payload directly
   (e.g. a raw re-PUT of the stored legacy snapshot without having gone through the UI's own
   migration), `was_v1` is `True`, `migrate_inputs()` runs, and the response is a **freshly
   recalculated v2 run**: `calc_version: "2.0.0"`, `inputs_version: 2` in the stored snapshot,
   `finance.requires_confirmation: true`, and — because `was_v1` forces it regardless of whether
   the recalculated case would otherwise reconcile — **`status` stays `"legacy_unreconciled"`**
   for this same save. This exact path is what
   `tests/test_appraisal_governance.py::test_v1_snapshot_migrates_to_legacy_unreconciled` asserts
   end-to-end (POST, not PUT, but the same `calculate_authoritative` code path).
5. **Mismatches against stale stored outputs:** whatever `gdv_pence`, `total_cost_pence`, etc. the
   client submits alongside `inputs_snapshot` (which, for a real save of the York record, would
   reflect the old stored/legacy numbers still cached on the client, or values the user is
   confirming) are compared field-by-field against the server's freshly computed metrics
   (`CLIENT_METRIC_MAP`, `app/api/app.py:270-277`); every disagreement is recorded as an explicit
   `{"field", "client", "server"}` entry in `validation.client_mismatches`, never silently
   overwritten or discarded. For the York record specifically, the audit's independently
   recalculated TDC (£811,499.04, using the *pre-Release-1* engine rules) already disagreed with
   the stored TDC (£801,795.74) — under the *v2* engine the numbers will differ again, and by
   design that difference is what gets surfaced as a mismatch record rather than papered over.
6. **A subsequent save** (once the user has confirmed the facility terms via the "Facility terms
   require confirmation" banner in `FinancePage.tsx`, which flips `requires_confirmation` to
   `false`) is evaluated with `was_v1 = False` (the stored snapshot is now v2-shaped) and can reach
   `status: "reconciled"` if `report_safe` holds, or `"draft"` otherwise — the same lifecycle as
   any freshly created v2 appraisal.

**Net summary:** the York appraisal loads with the red legacy banner; the first save migrates its
snapshot in place, recalculates under `calc_version 2.0.0`, records mismatches against its stale
stored figures, and leaves `status` at `legacy_unreconciled` until a human confirms the proposed
facility — at which point the *next* save can become `reconciled`. This is deliberately a
two-step process (migrate-and-flag, then confirm-and-reconcile), never a one-step silent adoption
of a proposed facility as if it were underwritten.

## 4. Alembic operations (resolved in R2a)

The migration scripts live in `migrations/versions/` and are discoverable by
Alembic's defaults (`alembic.ini` sets `script_location = migrations`). The app
still boots fresh databases via `Base.metadata.create_all`; Alembic is the
upgrade path for existing databases.

### Runbook — adopting Alembic on the existing Docker database

The only production database is the local docker compose Postgres volume
(`postgres_data`). **Diagnose its actual state before choosing a path** — the
2026-08-13 R2a UAT found the live database in neither of the states this
runbook originally assumed: `create_all` had built only the *pre-002* schema
(no governance columns — `create_all` creates missing tables but never adds
columns to existing ones), and `alembic_version` contained a stale revision
`003` from an earlier, unrelated migration chain.

0. Diagnose:
   - `docker compose exec -T postgres psql -U postgres -d commercial_resi -c "SELECT version_num FROM alembic_version"`
     (a revision not present in `migrations/versions/` is a stale/foreign stamp);
   - `docker compose exec -T postgres psql -U postgres -d commercial_resi -c "\d financial_appraisals"`
     (governance columns present = schema matches 002; absent = pre-002).
1. Back up the database (postgres stays up; only the api is stopped):
   `docker compose stop api && docker compose exec -T postgres pg_dump -U postgres commercial_resi > backup-$(date +%F).sql`
   (or snapshot the `postgres_data` volume).
2. Bring the Alembic stamp in line with reality
   (`docker compose run --rm api alembic ...` — the api container carries
   `alembic.ini` and `migrations/`; `DATABASE_URL` in compose points at the
   postgres service):
   - schema matches 002 → `alembic stamp head` (record only, run nothing);
   - pre-002 schema → `alembic stamp 001` then `alembic upgrade head`
     (applies 002's column additions);
   - stale/foreign `alembic_version` (as found in the live DB) → add
     `--purge` to the stamp, e.g. `alembic stamp --purge 001`, since plain
     `stamp`/`current` fail with "Can't locate revision" on an unknown
     revision.
3. Verify: `docker compose run --rm api alembic current` reports `002 (head)`.
4. Restart the api service:
   `docker compose start api`

**If something goes wrong:** Restore from the backup taken in step 1. First, drop and recreate the database:
   ```
   docker compose exec -T postgres psql -U postgres -c "DROP DATABASE commercial_resi WITH (FORCE)"
   docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE commercial_resi"
   ```
   Then restore the backup and re-run the diagnosis step before retrying:
   ```
   docker compose exec -T postgres psql -U postgres -d commercial_resi < backup-<date>.sql
   ```

From now on, schema changes ship as new scripts in `migrations/versions/`
and are applied with `docker compose run --rm api alembic upgrade head`.

Executed against the live database on 2026-08-13 (path: backup →
`stamp --purge 001` → `upgrade head` → verify → restart); see
`docs/reviews/2026-08-13-release-2a-uat.md` for the full transcript.

**Staleness is now surfaced, not just diagnosable (Release 2b Task 9).** Because the compose boot
command tolerates `alembic upgrade` failing (availability is preserved even on a broken migration
run), `GET /health` now reports a `migrations_current: bool` field — comparing the DB's stamped
`alembic_version` against the repo's Alembic head — and logs at `ERROR` when they disagree, so
operators no longer have to run the diagnose step above blind: check `/health` first.

## 5. v2 → v3 (Release 2b Task 2, calc `2.1.0`)

**What's added.** `CalculatorInputsV3` (`app/financial_model/types.py`, `frontend/src/lib/model/finance-types.ts`)
is `CalculatorInputsV2` plus exactly two things: `inputs_version: 3` (was `2`) and
`lender_valuation: LenderValuation | null` — the disclosed lender GDV adjustment, spec §2/§3.2,
wired into calculations by Task 3. `FacilityTerms.enforcement_cost_assumption_pence` was already
added to `FacilityTerms` in Task 1 (default `0`); v2 documents already carry it (it's a `FacilityTerms`
field, not new to v3), Task 2 just makes sure every migration path — v1→v2 and v2→v3 — stamps it
explicitly rather than relying solely on the pydantic default. No other field changes shape, name,
or semantics. This migration is purely additive.

**Defaults.** A v2 document migrated to v3 gets `lender_valuation: null` (spec §1.5: unknown lender
valuation ≠ a valuation of zero — `null` means "not yet disclosed", exactly as `day_one_advance_pence`
etc. use `null` for the v1→v2 step). `finance.enforcement_cost_assumption_pence` defaults to `0`
(spec: no enforcement-cost assumption disclosed = none applied). Both defaults are additive — no
existing field's value or the arithmetic that depends on it changes.

**Implementation** (`migrateV2toV3` / `migrate_v2_to_v3`, `app/financial_model/migrate.py` and
`frontend/src/lib/model/migrate.ts`): every field of the input v2 document is carried across
unchanged; `inputs_version` is overwritten to `3`; `lender_valuation` is set from the input if the
(illegal, for a true v2 doc) key is already present, else `null`. The function refuses to migrate a
document that is already v3 (`is_v3`/`isV3` precondition) — this is an idempotence guard, not a
merge/upsert. `is_v2_or_later` (Python; used by `app/api/app.py`) is `is_v2(doc) or is_v3(doc)`.

**Server acceptance** (`app/api/app.py::calculate_authoritative`): the chain is now v1 → v2 → v3 —
an already-v3 payload passes straight through (validated, not re-migrated); a v2 or v1 payload runs
the existing v1→v2 step (`migrate_inputs`, unchanged) followed by `migrate_v2_to_v3`. The
**status rule is unchanged**: `legacy_unreconciled` applies only when the *original* document was
v1-shaped (`was_v1 = not is_v2_or_later(raw)`) — a v2 document migrating to v3 on save is not treated
as a legacy migration and reaches the normal `reconciled`/`draft` outcome exactly as before. The
persisted `inputs_snapshot` is always the v3-validated document (`inputs_version: 3`); the engine
(`run_appraisal`) now runs directly off that v3 document (Release 2b Task 3 — the earlier
downcast-to-v2 adapter that dropped `lender_valuation` before the engine call is gone from both
`app/api/app.py::calculate_authoritative` and `tests/test_financial_model_fixtures.py`). Every
result field Task 1 null-wired (`lender_gdv_pence` etc.) is now genuinely computed from the block
when present, and stays `null` exactly when the block is absent — design §B1's "outputs unchanged
while the block is absent" still holds, but it now holds because the engine itself null-wires the
absent case, not because the block was stripped upstream of it.

**Hash consequence.** `input_hash` is computed over the full validated document (`hashing.py::input_hash`
→ `inputs.model_dump(mode="json")`). Because every migrated document now carries two fields it
didn't before (`lender_valuation`, and `enforcement_cost_assumption_pence` made explicit rather than
implicit), **`input_hash` changes for every row the next time it is saved**, even if nothing the user
edited actually changed. This is expected and benign: it is the same re-hash-on-any-change behaviour
that already applies to every ordinary edit, `status` is preserved by the rule above (not reset by
the version bump itself), and no `expected_metrics` value in the golden fixtures moved (see
`docs/financial-model/test-cases.md` "additive-only proof").

**Golden fixtures.** Both `fixtures/financial-model/a-all-cash.json` and `f-dev-finance-12mo.json`
were updated to `inputs_version: 3` with `lender_valuation: null` and
`finance.enforcement_cost_assumption_pence: 0`, and both `expected_metrics` blocks are byte-identical
to before this change — the full TS and Python suites (`npx vitest run`, `python -m pytest -q`) stay
green with the same pinned numbers, which is the additive-only proof for this migration.

---

## 8. Release 7 — no input-schema move; one output change and one column [calc 2.6.0]

R7 is a report release. The input schema stays at **v4** and no migration of
stored `inputs_snapshot` documents is required or performed.

### 8.1 Output change: `equity_multiple`

Spec §3.16.1. For a schedule with no realisation event — no sale receipts and no
refinance — `equity_multiple` moves from `0` to `null`. Two new outputs carry the
condition: `has_realisation_event` and `return_on_equity_is_unrealised`.

- **Effect on stored results.** None until a record is next saved. Stored
  `outputs` blobs are preserved verbatim with the `calc_version` they were
  computed under, as they always have been; §13.1's provenance panel discloses a
  recomputation when the printed run's version differs from the stored one.
- **Effect on recalculation.** A retain-all appraisal re-saved after this release
  will show `equity_multiple: null` where it previously showed `0`. This is the
  correction the second audit asked for: `0.00x` beside a positive return on
  equity read as a total loss of capital rather than as a case with no exit
  modelled.
- **Cases unaffected.** Any schedule that books a disposal or a refinance —
  including one whose receipts sweep entirely to senior debt, which keeps its
  genuine `0.00`.

### 8.2 New column: `financial_appraisals.audit_hash`

Migration **005**, nullable `String(64)`. Populated by the server on every
recalculation; see spec §13.2 for the composition.

Existing rows are left `NULL`. The value is derivable from columns a row already
holds, so a backfill would be *computable* — but a row that has not been
recalculated since this release is a pre-provenance result, and stamping it with
a hash would assert a binding no run ever produced. Reports print "not recorded —
result predates provenance hashing" until the row is next saved.

### 8.3 The York appraisal after R7

The saved Stonegate record is a migrated v1 snapshot: `requires_confirmation` is
true, so it is not report-safe, and it is a retain-all case with no refinance, so
it has no realisation event.

| Field | Before R7 | After R7 | Why |
|---|---|---|---|
| `equity_multiple` | `0` | `null` | §3.16.1 — no realisation event |
| `return_on_equity_pct` | unchanged | unchanged | still an accounting return; now *labelled* unrealised |
| every cost, finance and profit figure | unchanged | unchanged | no formula moved |
| exported memo | DRAFT (unreconciled) | DRAFT (unreconciled) | `requires_confirmation` still fails condition 1 of §13.3 |

The audit's independently reconciled figures for this case therefore remain
reproducible line for line.

---

## 9. v5 → v6 (Release 9, calc `2.8.0`)

**Note on this document's coverage.** §5 records v2 → v3; the v3 → v4 (R3a
programme/phasing/refinance) and v4 → v5 (R8 jurisdiction) steps were never
written up here, and are recorded in their release reports and in spec §6.1/§14
instead. That gap is pre-existing and is noted rather than silently continued.

**What's added.** `CalculatorInputsV6` is `CalculatorInputsV5` plus exactly two
things:

- an `areas` block — the entered area bridge (spec §15.1): `basis`, and the ten
  entered area lines;
- an `ancillary` block on **every** unit (`ProposedUnitV6`): `balcony_terrace_sqm`,
  `balcony_terrace_value_pence`, `parking_spaces`, `parking_value_pence`
  (spec §15.5).

Plus the version stamp itself. No existing field changes shape, name or
semantics. `ProposedUnitV6` **extends** `ProposedUnit` rather than replacing it,
and `CalculatorInputsV6` subclasses `CalculatorInputsV5`, for the same reason R8
extended `AcquisitionInputsV5`: the engine dispatches on those types, and a flat
re-declaration would make every `isinstance` check silently false for a v6
document.

**Defaults, and the one thing the migration deliberately will not do.** A v5
document migrated to v6 gets `basis: 'manual'` with **every** area line at `0`,
and a zeroed `ancillary` block on every unit.

`basis: 'manual'` means the construction cost area stays
`conversion_costs.total_construction_sqm` — the exact number the document already
used — so no migrated appraisal's computed values move. What the migration
refuses to do is **synthesise a bridge**: it could have written
`existing_gia_sqm = total_construction_sqm` and produced a document that looked
reconciled, and that would have been inventing evidence the record never
contained. It is the same reasoning that leaves R8's `acquisition_date` null
rather than stamping today's date, and the same reasoning behind spec §1.5's rule
that an unknown is never a plausible substitute value. A zeroed bridge is
self-describing: spec §15.6's warnings and §15.2's efficiencies are all guarded on
`developed_gia_sqm > 0`, so a document with no entered geometry is treated as one
that is not using the bridge, not as a 0 m² building.

**Implementation** (`migrateV5toV6` / `migrate_v5_to_v6`,
`migrateInputsToV6` / `migrate_inputs_to_v6`). The entry point mirrors
`migrateInputsToV5`'s shape exactly, including its two refusals — an unrecognised
`inputs_version` throws, and a document declaring version 6 that fails the v6
structural check throws rather than falling through to the permissive v1 path.
That guard is R8's hardest-won lesson carried forward: R8 shipped
`migrateInputsToV4` without a v5 guard, and a v5 document satisfied none of the
`isVN` checks, fell all the way to the v1 fallback, and was silently corrupted —
fields dropped, a *confirmed* equity source replaced by an unconfirmed stub with a
different amount, the facility rebuilt from `ltv_pct` — while the API returned
201.

`migrateInputsToV5` correspondingly **refuses a v6 document** ("use
migrateInputsToV6"). Downgrading would mean dropping `areas` and every unit's
`ancillary` block; a silent downgrade is precisely the failure mode above, in the
other direction.

Two details in the already-v6 **merge** branch are worth naming because both were
found in review rather than by construction:

1. The merge default-fills `ancillary` **per unit**, not by taking
   `saved.unit_mix` verbatim. A stored v6 unit that predates the ancillary block,
   or a hand-edited row, would otherwise keep a type-required field absent in
   TypeScript where Python's `model_validate` fills it — a silent cross-engine
   divergence on the same document.
2. `areas` is merged onto the defaults field by field, so a partial stored block
   cannot blank out a sibling line.

### 9.1 The numerical-identity claim, and where it is tested

**Claim: the v5 → v6 migration is purely additive. Every existing appraisal
produces byte-identical output either side of it — not "close", identical.**

This is a *tested* claim, not an assertion in a document. It is asserted three
ways, in both languages:

| What | TypeScript | Python |
|---|---|---|
| Whole-corpus numeric identity | `golden-fixtures.test.ts`, `migrating %s to v6 moves no computed figure` | `tests/test_migrate_v6.py::test_v6_migration_moves_no_existing_figure` |
| Pins reproduce after migration | `golden-fixtures.test.ts`, `reproduces its metrics after migration to v6` | `tests/test_financial_model_fixtures.py::test_fixtures_reproduce_their_metrics_after_migration_to_v6` |
| Structural: nothing synthesised | same test, the zeroed-blocks branch | `_assert_zeroed_r9_blocks` |

The numeric gate compares the **whole** `metrics`, `model` and `schedule` objects
before and after, not just the pinned headline figures — a migration defect could
move a ledger or schedule figure that no metric surfaces.

The structural half exists because the numeric half could not see the defect it
guards against. Until the cost stack read `areas`, a migration that wrongly
synthesised a bridge would have moved no figure at all and sailed through a purely
numeric gate — then silently changed every appraisal the moment the wiring landed.
So the zeroed blocks are asserted directly, and **by value** rather than against
`DEFAULT_AREA_BRIDGE`: comparing the migration's output to the same constant it
was built from could not catch that constant itself becoming non-zero.

Since R9 Task 12 the corpus contains v6 fixtures as well, so the same gate carries
the mirror-image assertion for the merge branch: an already-v6 document's `areas`
and per-unit `ancillary` must come back out **unchanged**. Zeroing them there
would be equally wrong, and the numeric comparison would not catch it for a
fixture on the manual basis, whose figures are the same either way. Non-vacuity
guards pin the corpus size at 11 in both languages.

**Hash consequence.** As with every previous additive step, `input_hash` is
computed over the full validated document, so it changes for every row the next
time it is saved — every migrated document now carries an `areas` block and a
per-unit `ancillary` block it did not before. This is the ordinary
re-hash-on-any-change behaviour; `status` is preserved by the existing rule and is
not reset by the version bump itself. No `expected_metrics` value in any golden
fixture moved.

### 9.2 The York appraisal after R9

The saved Stonegate record is a migrated v1 snapshot. After R9 it carries a
`manual` basis with a zeroed bridge and zeroed ancillary on every unit.

| Field | Before R9 | After R9 | Why |
|---|---|---|---|
| `construction_cost_pence` | unchanged | unchanged | `manual` basis — the cost area is still `total_construction_sqm` |
| `gdv_pence` | unchanged | unchanged | zeroed ancillary contributes nothing |
| `gdv_internal_pence` | — | equal to `gdv_pence` | new field, §3.1 |
| `gdv_ancillary_pence` | — | `0` | no ancillary recorded |
| `area_bridge.nia_to_gia_pct` | — | `null` | §1.5 — not computable, not `0%` |
| every cost, finance and profit figure | unchanged | unchanged | no formula moved |

The audit's independently reconciled figures for this case therefore remain
reproducible line for line, as they did through R7 and R8.

---

## 10. v6 → v7 (Release 10, calc `2.9.0`)

**What's added.** `CalculatorInputsV7` is `CalculatorInputsV6` plus exactly one
thing: a `cost_plan` block (spec §16) — `mode` (`'headline'` or `'detailed'`), a
package schedule, exactly three named contingency classes, and professional/
statutory fee lines each carrying a fixed or percentage basis. Plus the version
stamp itself. No existing field changes shape, name or semantics.
`CalculatorInputsV7` subclasses `CalculatorInputsV6`, for the same reason R8 and
R9 extended rather than replaced: the engine dispatches on those types, and a
flat re-declaration would make every `isinstance` check silently false for a v7
document.

**Defaults, and the one thing the migration deliberately will not do.** A v6
document migrated to v7 gets:

- `mode: 'headline'`, `packages: []`;
- `contingency`: the `general` class at the source `conversion_costs.contingency_pct`
  on the `all_packages` basis; `existing_building` and `abnormal` both at `0`;
- `fee_lines`: the eight existing flat fee fields (`architect_pence`,
  `structural_engineer_pence`, `mande_pence`, `planning_consultant_pence`,
  `other_professional_fees_pence`, `prior_approval_fee_per_dwelling_pence`,
  `cil_s106_pence`, `building_control_pence`) as `fixed` lines, `prior_approval`
  carrying `per_dwelling: true` — the same construction `costPlanFromLegacyCosts`
  / `cost_plan_from_legacy_costs` uses for a pre-v7 document that has no
  `cost_plan` at all, so the migration and the engine's own fallback cannot
  diverge (spec §16.7).

**No package schedule is synthesised.** The migration could have split the
headline base build into a single invented package and produced a document that
looked like a detailed cost plan — that would have been inventing evidence the
record never contained, the same reasoning that left R8's `acquisition_date`
null and R9's bridge zeroed rather than back-derived. A migrated document stays
in `headline` mode, exactly as it was before this release, in substance if not
in name.

**Implementation** (`migrateV6toV7` / `migrate_v6_to_v7`,
`migrateInputsToV7` / `migrate_inputs_to_v7`). The entry point mirrors
`migrateInputsToV6`'s shape exactly, including its two refusals — an
unrecognised `inputs_version` throws, and a document declaring version 7 that
fails the v7 structural check throws rather than falling through to the
permissive v1 path. `migrateInputsToV6` correspondingly **refuses a v7
document** ("use migrateInputsToV7"). Downgrading would mean dropping
`cost_plan`; a silent downgrade is R8's silent-corruption failure mode in the
other direction.

The already-v7 **merge** branch carries `cost_plan` through untouched — a merge
that silently reset it to the empty-headline default would move a detailed-mode
document's construction cost by its whole contingency total, since only the base
build survives via the legacy fallback's arithmetic.

### 10.1 The numerical-identity claim, and where it is tested

**Claim: the v6 → v7 migration is purely additive. Every existing appraisal
produces byte-identical output either side of it — not "close", identical.**

This is a *tested* claim, mirroring §9.1's pattern one version on:

| What | TypeScript | Python |
|---|---|---|
| Whole-corpus numeric identity | `golden-fixtures.test.ts`, `migrating %s to v7 moves no computed figure` | `tests/test_migrate_v7.py::test_v7_migration_moves_no_existing_figure` — the same before/after comparison over `metrics`, `model` and `schedule` |
| Pins reproduce after migration | `golden-fixtures.test.ts`, `reproduces its metrics after migration to v7` | `tests/test_financial_model_fixtures.py::test_fixtures_reproduce_their_metrics_after_migration_to_v7` |
| Structural: nothing synthesised | same test, the empty-packages / three-class / eight-fee-line branch | mirror assertion |

**This gate is numeric *and* structural, for the same reason §9.1's R9 gate had
to be both.** A migration that wrongly derived the general contingency class
against the wrong base, or miscategorised a fee line's professional/statutory
split, could move no figure at all for a document whose extra classes and
non-migrated fee categories happen to be zero or agree by coincidence — the
structural assertion (mode, empty packages, exactly three classes, eight fee
lines, the general class carrying the source percentage) is what a purely
numeric gate cannot see.

**Hash consequence.** As with every previous additive step, `input_hash` is
computed over the full validated document, so it changes for every row the next
time it is saved — every migrated document now carries a `cost_plan` block it
did not before. This is the ordinary re-hash-on-any-change behaviour; `status`
is preserved by the existing rule and is not reset by the version bump itself.
No `expected_metrics` value in any golden fixture moved. **This boundary move
is also where spec §13.2's audit-hash disclosure applies for the first time in
practice**: a row saved before this release and not yet re-saved has a stored
`audit_hash` computed under whatever `inputs_version` it was last saved at
(6 or earlier), but the report's provenance panel prints the *client's*
current schema — `inputs_version: 7` — because the printed run is the freshly
migrated-and-recalculated document, not the stale stored snapshot. A reader
must not assume the printed `inputs_version` on a freshly-generated report is
the one the stored `audit_hash` was computed over unless the row has actually
been re-saved since.

### 10.2 The York appraisal after R10

The saved Stonegate record is a migrated v1 snapshot, headline mode throughout
(it has never carried a `cost_plan` block). After R10 it carries `mode:
'headline'`, no packages, `general` contingency at its existing
`contingency_pct`, and its eight existing fee fields as `fixed` fee lines.

| Field | Before R10 | After R10 | Why |
|---|---|---|---|
| `cost_plan.mode` | — | `'headline'` | new field, §16.7 |
| `cost_plan.construction_total_pence` | — | equal to `construction_cost_pence` | headline arithmetic is unchanged, only re-expressed |
| `cost_plan.conversion_total_pence` | — | `construction_total + professional_total + statutory_total` | new field, §16.8 — no prior figure to compare against |
| `construction_cost_pence` | unchanged | unchanged | one contingency class carrying the old percentage on the old base reproduces the old formula exactly |
| `professional_fees_pence`, `statutory_costs_pence` | unchanged | unchanged | eight fixed fee lines reproduce the eight flat fields exactly |
| every cost, finance and profit figure | unchanged | unchanged | no formula moved |

The audit's independently reconciled figures for this case therefore remain
reproducible line for line, as they did through R7, R8 and R9.
