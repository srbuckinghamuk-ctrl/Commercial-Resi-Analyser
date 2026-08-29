# Financial Model — Migration Notes (v1 → v2 → v3 … → v15)

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
(7 or earlier), but the report's provenance panel prints the *client's*
current schema — `inputs_version: 8`, as of this release — because the
printed run is the freshly migrated-and-recalculated document, not the stale
stored snapshot. A reader must not assume the printed `inputs_version` on a
freshly-generated report is the one the stored `audit_hash` was computed over
unless the row has actually been re-saved since. (This is a description of
the boundary's shape, not a figure pinned to one release: the "current
schema" is whichever `inputs_version` the client is on when this line is
read, and moves again at the next additive step.)

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

## 11. v7 → v8 (Release 11, calc `2.10.0`)

**What's added.** `CalculatorInputsV8` is `CalculatorInputsV7` plus exactly one
thing: a `vat` block (spec §17.1) — `registered`, `return_frequency`,
`first_period_end_month`, `repayment_lag_months`, exactly six `treatments`
rows (one per `VatChargeCategory`, in the declared order) and a `purchase`
block (`vendor_opted_to_tax`, `togc_treatment`, evidence). Plus an optional
`vat_override` on every `CostPackage` and `FeeLine`, and the version stamp
itself. No existing field changes shape, name or semantics.
`CalculatorInputsV8` subclasses `CalculatorInputsV7`, for the same reason R8,
R9 and R10 extended rather than replaced: the engine dispatches on those
types, and a flat re-declaration would make every `isinstance` check silently
false for a v8 document.

**Defaults, and the one thing the migration deliberately will not do.** A v7
document migrated to v8 gets:

- `vat.registered: false`, so `resolveVatTreatment` drives every charge to
  `INERT` and `chargeableConsiderationPence` collapses back to the exclusive
  price — no existing appraisal's computed values move (§17.11), with the
  one named exception §11.1 qualifies (ruling R46);
- the six treatment rows at `rate_pct: 0`, `recoverable_pct: 0`,
  `recovery_basis: 'unconfirmed'`, `evidence_status: 'unconfirmed'`;
- `purchase`: `vendor_opted_to_tax: false`, `togc_treatment: 'unconfirmed'`,
  `evidence_status: 'unconfirmed'`;
- `vat_override: null` on every package and every fee line;
- the spec §16.3 contingency rework this release also carries: each
  contingency row is rebuilt from `name`/`pct` alone, so the deleted `basis`
  and `package_ids` fields are dropped off a stored R10 row rather than
  spread through untouched — the `contingency_class` tag on each package is
  the surviving mechanism (§17.8) and is retained.

This is the same block `DEFAULT_VAT` gives a brand-new document
(`conversion-defaults.ts:365`), so the two engines' v-defaults re-converge one
version on, exactly as the v6 → v7 boundary did for `cost_plan`.

**No configuration is inferred.** The migration could not have guessed
`vendor_opted_to_tax` or any treatment's rate from anything already stored —
that would be inventing evidence the record never contained, the same
reasoning R8 applied to `acquisition_date`, R9 to the area bridge and R10 to
the package schedule. A migrated document stays VAT-inert until a user
configures it.

**Implementation** (`migrateV7toV8` / `migrate_v7_to_v8`,
`migrateInputsToV8` / `migrate_inputs_to_v8`). The entry point mirrors
`migrateInputsToV7`'s shape exactly, including its two refusals — an
unrecognised `inputs_version` throws, and a document declaring version 8 that
fails the v8 structural check throws rather than falling through to the
permissive v1 path. `migrateInputsToV7` correspondingly **refuses a v8
document** ("use migrateInputsToV8"). The already-v8 merge branch carries
`vat` through untouched — a merge that silently reset it to the inert default
would move a registered document's whole VAT position and every figure
downstream of it.

### 11.1 The numerical-identity claim, and where it is tested

**Claim: the v7 → v8 migration is purely additive. Every existing appraisal
produces byte-identical output either side of it — not "close", identical —
with exactly one named, reachable exception (ruling R46).** §17.8 makes a
detailed-mode package's `contingency_class` tag live: a document carrying a
non-zero percentage on `existing_building` or `abnormal` while no package
carries that tag now resolves that class's contingency base to zero, where
before every class resolved against the whole base build regardless of tag.
This is not caused by the migration step itself — the migration touches
nothing on `cost_plan.packages` or their tags — but by the engine's new
resolution rule (§17.8), which applies the first time such a document is run
under calc `2.10.0`, migrated or not. It is the one figure this release does
move, and it is disclosed rather than left silent: `validate_inputs` (§17.9)
adds a **warning** naming the class and stating its resolved base is zero.
The rule is deliberately a warning, not an error — the same reasoning R38
established: a stored document already in that shape must not acquire a hard
validation error on migration, which would make `report_safe` false and
silently downgrade the report to DRAFT. The rule reads `cost_plan`, which is
identical before and after the v7 → v8 boundary, so it fires identically
either side of it and does not add to the R38/R39 regression gate below (that
gate permits exactly one addition, the `vat.registered` warning, and the
corpus's one detailed-mode fixture already has every non-general class
correctly tagged, so the gate observes no R46 warning on any fixture either).

This is a *tested* claim, mirroring §10.1's pattern one version on:

| What | TypeScript | Python |
|---|---|---|
| Whole-corpus numeric identity, plus the structural write | `golden-fixtures.test.ts`, `migrating %s to v8 moves no computed figure, and writes the specified block` | `tests/test_migrate_v8.py::test_v8_migration_moves_no_existing_figure` |
| Pins reproduce after migration | `golden-fixtures.test.ts`, `reproduces its metrics after migration to v8 (merge branch)` | `tests/test_financial_model_fixtures.py::test_fixture_r_reproduces_its_metrics_after_migration_to_v8` |
| Validation regression gate (R38/R39, below) | `golden-fixtures.test.ts`, `migrating %s to v8 adds and removes no validation issue` | `tests/test_migrate_v8.py::test_v8_migration_adds_and_removes_no_validation_issue`, `test_v8_migration_adds_no_validation_issue_to_a_short_term_document` |
| The v8 version predicate is membership, not a negation | — | `tests/test_migrate_v8.py::test_document_tagged_v8_that_fails_the_structural_check_is_refused`, and a document tagged `9` |

**This gate is numeric *and* structural, for the same reason §9.1's and
§10.1's gates had to be.** A migration that wrote a non-inert default, or
that spread the deleted contingency fields back onto a stored row instead of
rebuilding it, could move no figure at all for a document whose extra fields
happen to be zero or absent — the structural assertion (`registered: false`,
six rows, every override `null`, the two contingency fields gone) is what a
purely numeric gate cannot see. R9 recorded that a numeric-only gate can be
**provably blind** when the migration synthesises a block no engine yet
consumes; here it is meaningful only because the VAT engine is live and reads
`registered`.

**The validation regression gate is not a same-set assertion (R39).** §17.9
specifies a warning for `registered: false` with a non-zero construction cost,
and a pre-v8 document has no `vat` block at all — so that warning can only
ever appear *after* migration. A literal "same issues before and after"
comparison is unsatisfiable by design. The gate is instead the narrowest form
that still bites: the error set is compared with no exemption whatsoever,
nothing may be removed at either severity, and the only permitted addition is
that one warning, cross-checked per fixture against its own firing condition
with a non-vacuity assertion. Both a `term_months: 1` and a `term_months: 2`
synthetic document are required — the return-cycle bounds this gate exists to
catch (`first_period_end_month`, `repayment_lag_months`) are gated on
`registered: true` (§17.9, R38) precisely because migration gives every
document a `vat` block carrying `first_period_end_month: 2`, and an earlier
draft of this release validated that bound unconditionally: a stored
appraisal with `term_months <= 2` acquired a hard validation error the moment
it was migrated, from a block the engine ignores. Measured directly:
`term=1` yielded `errors=[]` at v7 and `errors=["vat.first_period_end_month"]`
at v8, which would have silently downgraded every short-term appraisal in the
database to DRAFT.

**Hash consequence.** As with every previous additive step, `input_hash` is
computed over the full validated document, so it changes for every row the
next time it is saved — every migrated document now carries a `vat` block it
did not before. This is the ordinary re-hash-on-any-change behaviour and is
benign; `status` is preserved by the existing rule and is not reset by the
version bump itself. **`audit_hash` also changes for every migrated
document, and for a different reason** (`app/api/app.py`'s upsert path):
its move is deliberate provenance, tracking that the document was
recalculated under a new `calc_version`/`inputs_version` pair, not a
side-effect of the `vat` block's presence. Neither hash is compared against
its pre-migration value anywhere in the codebase, so nothing flips `status`
on account of either change — but `hashing.py` documents `input_hash` as the
mechanism for detecting a stale client-submitted figure, so a release in
which every stored row's hash changes silently is worth recording rather than
discovering later. No `expected_metrics` value in any golden fixture moved.

No fixture-level York-appraisal case study is added for this boundary: the
Stonegate record (§10.2) carries no VAT configuration and none is inferred,
so its post-R11 behaviour is exactly the R10 row above with one more
inert block attached.

---

## 12. v8 → v9 (Release 12, calc `2.11.0`)

**What's added.** `CalculatorInputsV9` is `CalculatorInputsV8` plus a **changed
`programme` block** and five additive fields. `programme` was three mutually
independent packages (`construction`, `professional`, `statutory`, each with a
`start_offset`, a `duration_months` and a `curve`); from v9 an explicit
`programme` is a **precedence network** — `{ anchor_month, phases[],
category_phase_ids }` — whose phases carry an `id`, a `code`, a `label`, a
`duration_months` (0 = milestone), a **signed** `slip_months`, an
earliest-start floor `start_offset`, a `curve` and `FS`/`SS` `predecessors`
with lags (spec §18.1). `CalculatorInputsV9` subclasses `CalculatorInputsV8`,
for the same reason R8, R9, R10 and R11 extended rather than replaced: the
engine dispatches on those types, and a flat re-declaration would make every
`isinstance` check silently false for a v9 document.

**`programme = null` is untouched.** It stays `null` across the boundary and
keeps the §6 auto-window spend profile, bit-identical to calc `2.10.0`. Twelve
fixtures depend on that, and it is the single decision that keeps this release
from putting a derived block on documents that never asked for one.

### The five additive no-ops

Every one of these is a written `null` or `0`. The migration adds no value that
any engine reads as live — which is the property the identity gates below
actually test.

| Field | Where | Written |
|---|---|---|
| `phase_id` | every `CostPackage` (§16.2) | `null` |
| `phase_id` | every `FeeLine` (§16.4) | `null` |
| `anchor` | every `sales_phasing.tranches[]` entry (§18.6) | `null` |
| `anchor` | `refinance` (§18.6) | `null` |
| `phase_slip_phase_id` / `phase_slip_months` | **all four** scenarios — `base`, `upside`, `downside`, `severe` (§18.9) | `null` / `0` |

`phase_id: null` means "resolve through `category_phase_ids[line.category]`"
(§18.5), and on a migrated document the category default *is* the phase that
carries the old package's window — so nothing moves. `anchor: null` means "use
`month_offset`" (§18.6), so every stored document's receipts land exactly where
they landed before. The two scenario fields are no-ops by construction:
`applyScenario` matches `phase_slip_phase_id` against each phase's `id`, and
`null` matches none.

### The three-package → network conversion

For each of the three packages, in the fixed order construction, professional,
statutory (`PACKAGE_TO_PHASE` in both engines):

| v9 field | Value |
|---|---|
| `id` | **the package name** — `'construction'`, `'professional'`, `'statutory'` |
| `code` | `construction`, `design`, `planning` respectively |
| `label` | `'Construction'`, `'Professional'`, `'Statutory'` |
| `duration_months` | the package's `duration_months`, unchanged |
| `start_offset` | the package's `start_offset`, unchanged |
| `slip_months` | `0` |
| `curve` | the package's `curve`, unchanged |
| `predecessors` | `[]` |

`anchor_month` carries across unchanged. `category_phase_ids` becomes
`{ construction: 'construction', professional: 'professional', statutory: 'statutory' }`.

**`id = <package name>` is load-bearing, not cosmetic.** A predecessor-free
phase's start *is* its floor (spec §18.1), so each derived window equals the old
window **by construction** rather than by arithmetic coincidence — and the
package name as id is what makes the one field-name alias below a one-to-one
correspondence rather than a guess.

### The one field-name alias

`PROGRAMME_FIELD_ALIASES` — exactly **three** entries, one per package:

```
programme.packages.construction  →  programme.phases.construction
programme.packages.professional  →  programme.phases.professional
programme.packages.statutory     →  programme.phases.statutory
```

The v8 sale-tail validation rule reports its issue against
`programme.packages.<name>`; the v9 rule reports the same issue against
`programme.phases.<id>`. Because migration assigns `id = <name>`, the two
correspond exactly, and the alias map is **derived from `PACKAGE_TO_PHASE`**
rather than written out independently, so the two cannot drift apart. It is
asserted to be exactly three entries.

**Implementation** (`migrateV8toV9` / `migrate_v8_to_v9`, `migrateInputsToV9` /
`migrate_inputs_to_v9`). The entry point mirrors `migrateInputsToV8`'s shape,
including its two refusals — an unrecognised `inputs_version` throws, and a
document declaring version 9 that fails the v9 structural check throws rather
than falling through to the permissive v1 path. `RECOGNISED_INPUTS_VERSIONS_V9`
is `[1..9]`, written as membership of the declared tuple. The already-v9 merge
branch carries a **populated network** through untouched — a merge that reset
it to the default `null` would silently downgrade a fully scheduled programme
to auto windows and move every figure downstream of it. `is_v9` gates on the
**container**, never on the `programme` block: `revalidate_instances='never'`
lets a `CalculatorInputsV8` hold a v9 sub-block.

### 12.1 The identity claim, and where it is tested

**Claim: the v8 → v9 migration moves no computed figure and adds no validation
issue that is not a genuinely new rule. Every existing appraisal produces
byte-identical output either side of it — not "close", identical.**

The gate is a pair, and the validation half is **three separately-falsifiable
properties, not one set equality** (spec §18.7). An earlier draft of this
release required the same issue set before and after migration; that is the
wrong assertion once v9 carries a rule v8 never had. §18.8's **overrun** rule
has no v8 counterpart at all — the legacy arm validates window bounds but has
no concept of a programme finishing after maturity — and both programme-bearing
fixtures breach the sale-tail rule at all three synthetic terms, so exact
equality would fail on behaviour that is new *and correct*.

1. **No valid document becomes invalid.** Unconditional — no filter, no
   exemption. This is the silent-DRAFT-downgrade property, and it is the one
   R11 was defined by.
2. **No invalid document becomes valid.** Also unconditional. Not symmetry for
   its own sake: v9 treats a zero-duration phase as a legal milestone where the
   legacy arm rejected `duration_months < 1`, so a migration could silently
   *upgrade* a broken document to report-safe.
3. **Issue sets equal, except issues from a named list of v9-only rules** —
   exactly **one** entry, the overrun rule, asserted as such, with a separate
   control proving the overrun rule still fires. Excluding a rule from the
   comparison must never be able to hide a rule that has stopped working.

**The two exemptions are of different shapes and must not be conflated.** The
three-entry `PROGRAMME_FIELD_ALIASES` map is a **field rename across the
boundary**; the one-entry v9-only-rule list is a **rule with no v8
counterpart**. Both are asserted to their exact sizes, so neither can be
widened without a test failing. **Property 3's exemption is applied to the
post-migration side only**, and that one-sidedness is load-bearing: applying it
symmetrically would let a v9-only-rule issue on the *pre-migration* side be
silently dropped too, which is a hole rather than an exemption. Because the
pre-migration side never carries such an issue today, a symmetric refactor
would be a silent no-op — so the one-sidedness is pinned by its own test.

| What | TypeScript | Python |
|---|---|---|
| Gate scope is non-empty and excludes only v9-born fixtures | `golden-fixtures.test.ts`, `the gate fixture set is non-empty and excludes ONLY v9-born fixtures` | `tests/test_financial_model_fixtures.py::test_migration_v9_gate_fixture_set_is_non_empty_and_excludes_only_v9_born_fixtures` |
| Gate 1 — whole-corpus numeric identity | `golden-fixtures.test.ts`, `%s: every computed figure is penny-identical` | `tests/test_financial_model_fixtures.py::test_v9_migration_gate_1_every_computed_figure_is_penny_identical` |
| Gate 2, property 1 | `%s: property 1 — a valid document never becomes INVALID` | `test_v9_migration_gate_2_property_1_a_valid_document_never_becomes_invalid` |
| Gate 2, property 2 | `%s: property 2 — an invalid document never becomes VALID` | `test_v9_migration_gate_2_property_2_an_invalid_document_never_becomes_valid` |
| Gate 2, property 3 | `%s: property 3 — issue sets equal, except v9-only rules` | `test_v9_migration_gate_2_property_3_issue_sets_equal_except_v9_only_rules` |
| Property 3 is one-sided | `property 3's comparison is ONE-SIDED — a v9-only issue on the BEFORE side fails it` | `test_v9_migration_gate_2_property_3_comparison_is_one_sided` |
| The alias map: exactly three, derived | `the alias map has EXACTLY three entries, and each maps name → same name` | `tests/test_migrate_v9.py::test_programme_field_aliases_is_derived_and_has_exactly_three_entries` |
| The v9-only rule list: exactly one, named | `the v9-only rule list has EXACTLY one entry, named` | `test_v9_only_validation_rule_list_has_exactly_one_entry_named` |
| The exemption cannot hide a dead rule | `the overrun rule really fires — excluding it from gate 2 cannot hide a dead rule` | `test_v9_migration_gate_2_the_overrun_rule_really_fires` |
| The three properties are not vacuous over the corpus | `the three properties are not vacuous over the corpus` | `test_v9_migration_gate_2_the_three_properties_are_not_vacuous_over_the_corpus` |
| Synthetic short-term documents really bite | `a term-2 document from a GATED fixture really does produce a genuine short-term issue` | `test_v9_migration_gate_2_a_term_2_document_from_a_gated_fixture_really_does_produce_a_genuine_short_term_issue` |
| Persistence boundary — every new field survives a round trip | `migrate.test.ts` | `tests/test_migrate_v9.py::test_every_new_field_survives_a_full_round_trip`, `test_a_populated_network_survives_the_round_trip_with_its_dependencies` |
| The merge branch does not reset a saved network | — | `test_merge_branch_carries_a_saved_populated_network_not_the_default_null` |

**The persistence boundary is asserted by presence, never by absence.** The
Python model's config is `extra='ignore'`, so a field the Pydantic model does
not declare is dropped silently on the way in — meaning a structural assertion
of the form `"phase_id" not in row` can hold even with the migration helper
bypassed entirely. Every boundary test therefore asserts the **presence and
value** of each new field after a full save/load round trip.

**Why the numeric gate is not blind here.** R9 recorded that a numeric-identity
gate can be *provably* blind when a migration synthesises a block no engine yet
consumes. That is not the case at this boundary: the programme network is the
live spend path for every migrated programme-bearing document, so the
three-package → network conversion is exercised by the very figures the gate
compares. The identity holds because a predecessor-free phase's start is its
floor and because spreading is per **(phase, category) bucket** rather than per
line (spec §18.5) — per-line spreading would have moved the monthly
distribution by pennies on any document whose amounts do not divide evenly, and
would have *passed* on documents where they happen to, which is worse.

**Hash consequence.** As with every previous step, `input_hash` is computed over
the full validated document, so it changes for every row the next time it is
saved — every migrated document now carries a reshaped `programme` (or the same
`null`) plus five new fields. `audit_hash` also changes for every migrated
document, tracking recalculation under a new `calc_version`/`inputs_version`
pair. Neither hash is compared against its pre-migration value anywhere in the
codebase, so nothing flips `status` on account of either. No `expected_metrics`
value in any golden fixture moved.

### 12.2 The York appraisal after R12

The Stonegate record (§10.2) carries `programme: null` and no `sales_phasing`
or `refinance`, so it takes the untouched arm: its programme stays `null`, its
spend profile stays on §6's auto windows, and it gains only the five additive
no-ops — `phase_id: null` on its fee lines, and the two `phase_slip` fields at
`null`/`0` on all four scenarios. Its post-R12 behaviour is exactly the R11 row
with those written defaults attached. It shows no float and no critical path,
which is limitation 1 of spec §18.10, stated rather than discovered.

---

## 13. v9 → v10 (Release 13, calc `2.12.0`)

**What's added.** `CalculatorInputsV10` is `CalculatorInputsV9` plus a new
top-level `investment_case: InvestmentCase | null` and two narrowings on
`refinance` (spec §19.1). `CalculatorInputsV10` subclasses `CalculatorInputsV9`,
for the same reason every prior version extended rather than replaced.

| v9 field | v10 field | Behaviour |
|---|---|---|
| *(absent)* | `investment_case` | Written `null`. The migration default; `null` is the explicit `investment_value_pence × ltv_pct` path (spec §4.5), unchanged. |
| `refinance` (whole block) | `refinance` | `null` stays `null`. A non-null block carries across with `investment_value_pence` and `ltv_pct` **unchanged and still non-null** — the explicit path survives the boundary exactly, because `investment_case` migrates to `null` alongside it, and §19.1's supersession rule only fires when `investment_case` is non-null. |
| *(absent, non-null `refinance` only)* | `refinance.arrangement_fee_basis` | Written `'fixed_pence'`. |
| *(absent, non-null `refinance` only)* | `refinance.arrangement_fee_pct` | Written `0`. |

**The two written no-ops reproduce today's arithmetic exactly.**
`arrangement_fee_basis: 'fixed_pence'` with `arrangement_fee_pct: 0` means the
fee is read entirely from the unchanged `arrangement_fee_pence` field (spec
§19.4's `arrangement_fee` formula takes the `fixed_pence` arm and ignores the
percentage), so a migrated document's refinance arithmetic is untouched. This
is the same shape as R11's `registered: false` and R12's `phase_slip_months: 0`
— a written value, not an absence, that the engine reads and finds inert.

**Implementation** (`migrateV9toV10` / `migrate_v9_to_v10`, `migrateInputsToV10`
/ `migrate_inputs_to_v10`). The entry point mirrors `migrateInputsToV9`'s shape,
including its two refusals — an unrecognised `inputs_version` throws, and a
document declaring version 10 that fails the v10 structural check throws
rather than falling through to a permissive earlier path.

### 13.1 The identity claim, and where it is tested

**Claim: the v9 → v10 migration moves no computed figure and adds no
validation issue that is not a genuinely new rule. Every existing appraisal
produces byte-identical output either side of it.**

The gate is a pair, and the validation half is **three separately-falsifiable
properties, not one set equality** (spec §19.9) — R12's §18.7 correction,
applied from the start of this release rather than arrived at mid-release:

1. **Every v9 issue has a v10 counterpart.** No live alias map was needed:
   v10 adds no field rename that a pre-existing validation rule reports
   against, so this property holds without a `PROGRAMME_FIELD_ALIASES`-style
   table.
2. **The v10-only rules of spec §19.7 raise no issue on a migrated document.**
   `investment_case` migrates to `null`, so none of §19.7's twelve rules —
   every one of them gated on `investment_case` being non-null, or on
   `refinance` carrying the new arrangement-fee fields whenever it is
   non-null — has anything to fire against on a document that never asked
   for an investment case.
3. **A control document that trips a v10-only rule raises it.** Built by
   taking a migrated `retain_all` fixture and poisoning one field the v10-only
   rules cover (`stabilised_occupancy_pct: 0`, spec §19.7 rule 8), proving the
   new rules can fire at all — property 2 alone, without property 3, would
   pass identically whether the new rules were wired up or silently inert,
   which is the exact shape R12 shipped and had to rewrite mid-release.

Property 1 is asserted alongside the migration/schema work; properties 2 and 3
are asserted alongside spec §19.7's validation rules, because they need those
rules to exist and to fire before they can be written as anything but a
tautology.

Both engines run the numeric gate corpus-wide.

### 13.2 The York appraisal after R13

The Stonegate record (§10.2) carries no `investment_case` and its `refinance`
block is `null`, so it takes the untouched arm on both counts: it gains only
`investment_case: null`, and there is no `refinance` block for the two new
arrangement-fee fields to attach to. Its post-R13 behaviour is exactly the R12
row with that one written default attached. It reports no investment case,
which is expected — it never asked for one.

---

## 14. v10 → v11 (Release 14, calc `2.13.0`)

**What's added.** `CalculatorInputsV11` is `CalculatorInputsV10` plus one new
top-level field, `monitoring: MonitoringInputs | null` (spec §20.1).
`CalculatorInputsV11` subclasses `CalculatorInputsV10`, for the same reason every
prior version extended rather than replaced: the engine dispatches on the class,
and a flat re-declaration would make those `isinstance` checks silently false for
v11 documents.

| v10 field | v11 field | Behaviour |
|---|---|---|
| *(absent)* | `monitoring` | Written `null`. A document that never asked for a monitoring statement does not acquire an empty one; `null` is spec §20's inception-only path, which is what every stored appraisal has always computed. |

**One written null, and nothing else.** This is the smallest boundary the corpus
has crossed: no field is renamed, no field is narrowed, no default is written
that the engine then reads. `monitoring: null` is read by exactly two sites —
`compute_monitoring_statement` / `computeMonitoringStatement`, which returns
`None`/`null` and publishes no statement, and `validate_monitoring` /
`validateMonitoring`, which returns before raising anything. Both are structural
reads (`getattr(inputs, "monitoring", None)` on the Python side, `'monitoring' in
inputs` on the TypeScript side), so a pre-v11 document with no attribute at all
and a v11 document carrying `null` take the identical path.

**Implementation** (`migrateV10toV11` / `migrate_v10_to_v11`, `migrateInputsToV11`
/ `migrate_inputs_to_v11`). The entry point mirrors `migrateInputsToV10`'s shape,
including its version predicate (membership of the declared tuple, not a range
check) and its two refusals — an unrecognised `inputs_version` throws, and a
document declaring version 11 that fails the v11 structural check throws rather
than falling through to a permissive earlier path. `migrate_v10_to_v11` refuses a
document that is already v11, so double-migration raises instead of silently
re-stamping.

### 14.1 The identity claim, and where it is tested

**Claim: the v10 → v11 migration moves no computed figure and adds no validation
issue that is not a genuinely new rule. Every existing appraisal produces
byte-identical output either side of it.**

The gate lives in `tests/test_migrate_v11.py` and its vitest twin. It runs
corpus-wide, and it filters on `doc["inputs"]["inputs_version"]` — the *stored*
version, not the runtime one — which is R13's lesson applied from the start:
a gate that partitions on the wrong axis silently stops testing the thing it
names. A companion test asserts the filtered corpus has not shrunk and names the
one deliberately excluded document (`w-monitoring-on-site`, the first v11-native
fixture), so the gate cannot pass by running over nothing.

The numeric arm compares the v10 run and the v11 run of the same raw document on
all three outputs — metrics, ledger and schedule — not metrics alone. The
validation arm is **three separately-falsifiable properties, not one set
equality** (spec §19.9's shape, carried forward):

1. **Every v10 issue has a v11 counterpart.** v11 renames nothing, so no alias
   map is needed for this property to hold.
2. **The v11-only rules of spec §20.3 raise no issue on a migrated document.**
   Every one of them is gated on `monitoring` being non-null, and the migration
   writes `null`.
3. **A control document that trips a v11-only rule raises it.** Without property
   3, property 2 would pass identically whether the new rules were wired up or
   silently inert.

**The C1 correction is the one computed value that moves, and it is not a
migration effect.** Calc 2.13.0 also corrects spec §5.10's remaining-funding term
to credit a rolled-up facility's unconsumed interest reserve. That changes
`cost_to_complete` — and only `cost_to_complete` — on documents with a **rolled-up
facility carrying an interest reserve**; a serviced-interest document, a cash
deal, and a rolled-up facility whose gross and net commitments are equal are all
bit-identical. The distinction matters for reading the gate: the correction
applies equally to the v10 run and the v11 run of the same document, so it
cancels out of the identity comparison entirely. What moves under calc 2.13.0 is
a *version* difference, recorded in spec §1.6 and pinned on fixtures P and V; what
the migration moves is nothing.

The §4.2(b) `lender_eligible` wiring is the same kind of thing, in the same
release and equally not a migration effect: it moves ledger figures on
detailed-mode documents carrying an ineligible package (`q-detailed-cost-plan`,
`s-dated-programme`), identically on both sides of the boundary.

### 14.2 The York appraisal after R14

The Stonegate record (§10.2, §13.2) gains `monitoring: null` and nothing else.
It is headline-mode with no cost packages, so `lender_eligible_ratio` is `1` and
§4.2(b)'s amended cap base is arithmetically the pre-R14 one — every ledger
figure is unchanged. Its post-R14 behaviour is exactly the R13 row with one
written null attached, plus whatever §5.10's correction does to its
cost-to-complete series on its own interest basis. It reports no monitoring
statement, which is expected — it never asked for one.

## 15. v11 → v12 (Release 13b, calc `2.14.0`)

**What's added.** `CalculatorInputsV12` is `CalculatorInputsV11` plus one new
top-level field, `unit_sales: UnitSalesInputs | null` (spec §22.1), and one new
`ScenarioOverrides` field, `sales_slip_months: integer` (spec §22.8).
`CalculatorInputsV12` subclasses `CalculatorInputsV11`, for the same reason
every prior version extended rather than replaced: the engine dispatches on
the class, and a flat re-declaration would make those `isinstance` checks
silently false for v12 documents.

| v11 field | v12 field | Behaviour |
|---|---|---|
| *(absent)* | `unit_sales` | Written `null`. A document that never asked for a per-unit sales ledger does not acquire an empty one; `null` is spec §22.1's "does not use this path" state, which is what every stored appraisal has always computed under the tranche regime (§4.4.1) or the R1 single-month disposal. |
| *(absent)* | `scenarios.<each>.sales_slip_months` | Written `0`. A months lever at zero is a no-op by §12.1's own multiplication/addition rule, the same discipline `phase_slip_months` was written under at v9. |

**Two written additions, both inert by construction.** No field is renamed, no
field is narrowed, no default is written that the engine then reads as live.
`unit_sales: null` is read by exactly the sites spec §22 names —
`compute_unit_sales` / `computeUnitSales`, which returns `None`/`null` and
contributes nothing to the ledger, and `validate_unit_sales` /
`validateUnitSales`, which returns before raising anything — both structural
reads, so a pre-v12 document with no attribute at all and a v12 document
carrying `null` take the identical path. `sales_slip_months: 0` is read by
`applyScenario`/`apply_scenario`'s `sales_slip` arm, which adds zero to every
row's completion when `unit_sales` is null anyway (a zero-width bar twice
over).

**Implementation** (`migrateV11toV12` / `migrate_v11_to_v12`, `migrateInputsToV12`
/ `migrate_inputs_to_v12`). The entry point mirrors `migrateInputsToV11`'s shape,
including its version predicate (membership of the declared tuple, not a range
check) and its two refusals — an unrecognised `inputs_version` throws, and a
document declaring version 12 that fails the v12 structural check throws rather
than falling through to a permissive earlier path. `migrate_v11_to_v12` refuses a
document that is already v12, so double-migration raises instead of silently
re-stamping.

### 15.1 The identity claim, and where it is tested

**Claim: the v11 → v12 migration moves no computed figure and adds no
validation issue that is not a genuinely new rule. Every existing appraisal
produces byte-identical output either side of it.**

The gate lives in `tests/test_migrate_v12.py` and its vitest twin. It runs
corpus-wide, and it filters on `doc["inputs"]["inputs_version"]` — the
*stored* version, not the runtime one — the same discipline §14.1 names. A
companion test asserts the filtered corpus has not shrunk and names the one
deliberately excluded document (`x-unit-sales-ledger`, the first v12-native
fixture), so the gate cannot pass by running over nothing.

The numeric arm compares the v11 run and the v12 run of the same raw document
on all three outputs — metrics, ledger and schedule — not metrics alone. The
validation arm is **three separately-falsifiable properties, not one set
equality** (spec §19.9's shape, carried forward again):

1. **Every v11 issue has a v12 counterpart.** v12 renames nothing, so no alias
   map is needed for this property to hold.
2. **The v12-only rules of spec §22.7 raise no issue on a migrated document.**
   Every one of them is gated on `unit_sales` being non-null, and the
   migration writes `null`.
3. **A control document that trips a v12-only rule raises it.** Without
   property 3, property 2 would pass identically whether the new rules were
   wired up or silently inert — its control is a document carrying both
   `unit_sales` and `sales_phasing` non-null, which trips §22.7 rule 1
   regardless of which field is read first.

**The §5.11 correction is the one computed value that moves, and it is not a
migration effect.** Calc 2.14.0 also corrects spec §5.11's phased break-even
replay to place each anchored tranche at its **resolved** month rather than
its entered `month_offset`. That changes `senior_breakeven_pence` — and only
that figure — on documents whose sale tranches carry a live `anchor` on a
programme where the resolved month differs from the offset; fixture S is the
corpus's one instance (90,971,520 → 88,720,089). The distinction matters for
reading the gate the same way it did at §14.1: the correction applies equally
to the v11 run and the v12 run of the same document, so it cancels out of the
identity comparison entirely. What moves under calc 2.14.0 is a *version*
difference, recorded in spec §1.6 and pinned on fixture S; what the migration
moves is nothing.

### 15.2 The York appraisal after R13b

The Stonegate record (§10.2, §13.2, §14.2) gains `unit_sales: null` and
`sales_slip_months: 0` on each scenario, and nothing else. It has never
carried `sales_phasing`, an `anchor`, or a `programme` network with the
`practical_completion` code, so no §5.11 or §22 code path is reachable for
it — its post-R13b behaviour is exactly the R14 row with two written no-ops
attached. It reports no unit sales ledger, which is expected — it never
asked for one.

## 16. v12 → v13 (Release 15, calc `2.15.0`)

**What's added.** `CalculatorInputsV13` is `CalculatorInputsV12` plus one new
**non-nullable** top-level field, `due_diligence: DueDiligenceInputs` (spec
§23.1), one new nullable `CostPlanInputs` field, `qs: QsProvenance | None`
(spec §23.6), and one new nullable `CostPackage` field, `price_basis`.
`CalculatorInputsV13` subclasses `CalculatorInputsV12`, for the same reason
every prior version extended rather than replaced: the engine dispatches on the
class, and a flat re-declaration would make those `isinstance` checks silently
false for v13 documents.

| v12 field | v13 field | Behaviour |
|---|---|---|
| *(absent)* | `due_diligence.source_record` | Written `null`. A stored document has no project record in hand at migration time, and inventing one would be inventing evidence. The memo prints the absence — "No listing record captured; source-conflict checks did not run" — rather than hiding it, and spec §23.5's two conflict rules are evaluated only when the record is non-null, so a migrated document raises neither. |
| *(absent)* | `due_diligence.items` | Written as spec §23.10's **seed**: the 23 entered catalogue items, in catalogue order, each with `id: 'dd-<code>'`, `status: 'unknown'`, `evidence: null`, `expiry_date: null`, `owner: ''`, `due_date: null`, `cost_impact_pence: null`, `programme_impact_months: null`, `action: ''`, `notes: ''`. The five **derived** codes are never written — they exist only on the result block (spec §23.3), so no stored document can carry a status for a fact another field owns. The ids are deterministic, so the migration is reproducible and a re-migration writes the same document. |
| *(absent)* | `cost_plan.qs` | Written `null`. Spec §23.6's "no QS provenance recorded" state, which is what every stored appraisal has always been. |
| *(absent)* | `cost_plan.packages[].price_basis` | Written `null` on **every** package. Spec §23.6's "not classified", which counts against fixed-price coverage rather than for it: a migrated detailed plan reports 0% coverage and an `unclassified_pence` equal to its whole base build — the honest statement of what was recorded. |

**Four written additions, all inert to every money figure.** No field is
renamed, no field is narrowed, and no default is written that the engine then
reads as a live figure. `price_basis: null` and `qs: null` are read only by
spec §23.6's summary block, which sums by basis and divides through the shared
`pct()`; neither enters `base_build_pence`, a contingency base, a fee base or
the uses schedule. The seeded `items` enter no ledger at all: spec §23.4's
derivation is computed once in `derive_metrics`/`deriveMetrics` beside
`monitoring_statement`, publishes a result block nothing downstream reads
except the provenance gate and the flags, and takes no ledger balance as input.

**The seed is also what a *pre*-v13 document computes.** Spec §23.4 reads a
document with no `due_diligence` attribute as this exact seed rather than as an
empty schedule, so the schedule an unmigrated v12 document reports and the one
its migrated v13 twin reports are the same object, field for field. That is why
§16.1's identity gate needs no exclusion for the new block — it is not excluded
from the comparison, it is compared and found equal.

**Implementation** (`migrateV12toV13` / `migrate_v12_to_v13`,
`migrateInputsToV13` / `migrate_inputs_to_v13`). The entry point mirrors
`migrateInputsToV12`'s shape, including its version predicate (membership of
the declared tuple, not a range check) and its two refusals — an unrecognised
`inputs_version` throws, and a document declaring version 13 that fails the
v13 structural check (`inputs_version == 13` **and** a `due_diligence` key)
throws rather than falling through to a permissive earlier path.
`migrate_v12_to_v13` refuses a document that is already v13, so double
migration raises instead of silently re-stamping.

### 16.1 The identity claim, and where it is tested

**Claim: the v12 → v13 migration moves no computed figure and adds no
validation issue that is not a genuinely new rule. Every existing appraisal
produces byte-identical output either side of it — including the new
`due_diligence` result block, which is compared rather than excluded.**

The gate lives in `tests/test_migrate_v13.py` and its vitest twin. It runs
corpus-wide and filters on `doc["inputs"]["inputs_version"]` — the *stored*
version, not the runtime one — the same discipline §14.1 and §15.1 name. A
companion test asserts the filtered corpus has not shrunk and names the
deliberately excluded document (the v13-native fixture), so the gate cannot
pass by running over nothing.

The numeric arm compares the v12 run and the v13 run of the same raw document
on all three outputs — metrics, ledger and schedule — **with no carve-out for
`due_diligence`**. The flag arm is the sharper one: every pre-existing flag
must be equal, and `due_diligence_unknown` is asserted **by name** as the gate's
sole expected addition. The other three §23.9 flags cannot fire on a migrated
document, and that is a property of the migration rather than a coincidence of
the corpus — `source_conflict` needs a source record (written `null`),
`consent_expires_before_start` needs an `expiry_date` on the `planning_route`
item (seeded `null`), and `provisional_sums_present` needs a package classified
`provisional_sum` (every `price_basis` written `null`).

The validation arm is **three separately-falsifiable properties, not one set
equality** (spec §19.9's shape, carried forward again):

1. **Every v12 issue has a v13 counterpart.** v13 renames nothing, so no alias
   map is needed for this property to hold.
2. **The v13-only rules of spec §23.9 raise no issue on a migrated document.**
   The seed satisfies every one of them: `unknown` owes no evidence, no action
   and no reason; every catalogue code is present exactly once; no date is
   present to be malformed; both impacts are null; there is no source record
   and no QS block to check.
3. **A control document that trips a v13-only rule raises it.** Without
   property 3, property 2 would pass identically whether the new rules were
   wired up or silently inert. The control removes one catalogue item from a
   migrated document, which trips §23.9 rule 1's missing-code message.

**No computed value moves under calc 2.15.0 either.** Unlike the v11 → v12
boundary, where §5.11's phased break-even correction moved fixture S's
`senior_breakeven_pence` as a *version* difference beside a migration that moved
nothing, R15 changes no formula at all. Every pre-existing golden pin stands
unaltered, and the separate claim — calc 2.15.0 reproduces 2.14.0 on every
document — carries no named exception.

### 16.2 The consequence a reader must not mistake for a defect

**Every stored appraisal's `input_hash` moves on its next save**, as it does at
every inputs-version boundary (spec §13.2's disclosure). The document being
hashed genuinely gained four fields, so the hash genuinely differs.

The consequence that follows is the one worth stating plainly: **an approved
lender case goes stale on that save** (spec §21.3), because staleness is derived
by comparing the live row's `input_hash` against the one the case locked. That
is the correct answer, not a fault in the case or in the migration. The snapshot
the case was approved against carried no evidence position at all; the re-saved
one carries 23 unknown due-diligence items. A reviewer looking at the approval
alone would otherwise read it as though the evidence question had been asked and
answered, which is exactly what spec §21.3 exists to prevent. The remedy is a
deliberate refresh or reapproval, as it is for any other input change.

The second consequence is spec §23.7's, and it was accepted rather than worked
around, on §14.6's precedent: **a migrated document shows
`DRAFT - DUE DILIGENCE INCOMPLETE - NOT FOR LENDER RELIANCE` as soon as its tax
and VAT bases are confirmed**, and keeps showing it until every entered item is
evidenced or marked not applicable with a reason. There is no grandfathering,
because a migrated document genuinely is unevidenced.

### 16.3 The York appraisal after R15

The Stonegate record (§10.2, §13.2, §14.2, §15.2) gains the seeded
`due_diligence` block, `cost_plan.qs: null` and `price_basis: null` on its
packages, and nothing else. No money figure moves, so its R14 and R13b rows
stand exactly as recorded.

What changes is what it *says about itself*. It reports **23 unknown entered
due-diligence items** and an `addressed_pct` of 0, `due_diligence_unknown` fires
naming that count, and the memo's Appendix B lists the first six unknown items
by name and counts the rest. Its `source_record` is `null` — the migration
captures none — so neither §23.5 conflict rule runs, and the memo prints the
not-captured sentence in their place. That is the honest position for this
document: the listing describes upper parts sold off on a long lease and
operated as short-term lets, the appraisal converts a vacant office to five
flats, and until R15 nothing in the record asked whether vacant possession was
obtainable. It is now asked, seeded `unknown`, and the document cannot reach
FINAL while it stays that way.

Its derived rows read from the fields it already carried: `facility_terms` is
`unknown` while `finance.requires_confirmation` remains true, `lender_valuation`
is `unknown` while none is provided, and `tax_basis` is `unknown` while the
jurisdiction is `migrated_default`/`unconfirmed` with a null acquisition date.
Once its tax and VAT bases are confirmed the banner it shows becomes the
due-diligence one rather than the tax-basis one — the same document, one
condition further down spec §13.3's list.

---

## 17. v13 → v14 (Release 15b, calc `2.16.0`)

**What's added.** `CalculatorInputsV14` is `CalculatorInputsV13` plus **one**
new field, nested rather than top-level: `cost_plan.qs.inflation:
InflationAllowance | None`, where `InflationAllowance` is `{ annual_pct:
float }` (spec §24.1). `CalculatorInputsV14` subclasses `CalculatorInputsV13`,
for the same reason every prior version extended rather than replaced: the
engine dispatches on the class, and a flat re-declaration would make those
`isinstance` checks silently false for v14 documents.

| v13 field | v14 field | Behaviour |
|---|---|---|
| *(absent)* | `cost_plan.qs.inflation` | Written `null`, and **only inside a non-null `qs`** — a document whose `qs` is null stays `null`, since there is nothing to write the key onto. Spec §24.1's "no allowance modelled" state, which is what every stored appraisal has always been. |

**One written addition, and it is inert.** No field is renamed, no field is
narrowed, and the one new key's default is not a value the engine reads as a
live figure. `QsProvenance.inflation` already defaults to `null` on every
engine read (`qs.inflation ?? null` in `computeCostPlan` — Python's own
default field does the same), so this migration changes what a stored
document's JSON *contains*, never what the engine *computes* from it. Every
other §24 field — `resolved_phase_id`, `months_from_base`, the per-package
timing block, `uses[m].lender_eligible_construction_pence` — is a **result**
field, computed fresh on every run from `cost_plan.packages`, `programme` and
`qs.base_date`, none of which this migration touches; there is nothing for
the migration to write onto any of them.

**Implementation** (`migrateV13toV14` / `migrate_v13_to_v14`,
`migrateInputsToV14` / `migrate_inputs_to_v14`, `isV14` / `is_v14`). The
entry point mirrors `migrateInputsToV13`'s shape, including its version
predicate (membership of the declared tuple, not a range check) and its two
refusals — an unrecognised `inputs_version` throws, and a document declaring
version 14 that fails the v14 structural check throws rather than falling
through to a permissive earlier path. `migrate_v13_to_v14` refuses a document
that is already v14, so double migration raises instead of silently
re-stamping — the same idempotence guard every prior migration in this file
carries. `isV14` / `is_v14` discriminate on `inputs_version == 14` **and**
the `due_diligence` key **and** either `cost_plan.qs` is `null` or it carries
the `inflation` key **present** — not merely equal to `null`. That distinction
matters here in a way it did not for `qs`/`price_basis` at the v12 → v13
boundary: an absent key and an explicit `null` are the same fact to every
engine read, but only the explicit key is proof that *this* migration ran,
which is what the structural check exists to certify.

### 17.1 The identity claim, and why the flag is not an exclusion

**Claim: the v13 → v14 migration moves no computed figure and adds no
validation issue that is not a genuinely new rule. Every existing appraisal
produces byte-identical output either side of it.**

The gate lives in `migrate.test.ts` and `tests/test_migrate_v14.py`. It runs
corpus-wide and filters on the *stored* `inputs_version`, not the runtime
one, and a companion test names the one deliberately excluded document
(`z-cost-plan-in-time`, v14-native with no v13 arm to compare against) so the
gate cannot pass by silently running over nothing.

The numeric arm compares the v13 run and the v14 run of the same raw document
on all three outputs — metrics, ledger and schedule — **with no carve-out**:
`package_timing`, `uses[m].lender_eligible_construction_pence` and every new
cost-plan field are compared exactly like every pre-existing one. This holds
because both arms execute the identical calc 2.16.0 code over documents that
differ only by the presence of an inert `null` — §16's identity gate needed
no exclusion for the same reason.

**The flag list is compared with strict equality, not with a named
exclusion.** This is the distinction worth stating plainly, because it is
easy to write a gate that reads as strict but is not: a gate that excludes
`no_inflation_allowance` from the comparison and then separately asserts it
fires *somewhere* cannot tell a working flag from a broken one, because
excluding it from the equality check is exactly what would let a silently
broken flag pass. This gate instead compares the **whole** flag set for
equality and then asserts, as an **addition** to that equal set,
`no_inflation_allowance` on the v14 side alone — so the assertion fails if
the flag is missing on v14, and the equality check fails if it is (wrongly)
present on the v13 side too. It is proven to fire on **both** arms of
fixture Y — the raw v13 document and its migrated v14 twin — because Y
carries a `qs` block dated before its construction; asserting it on one arm
only would leave the other arm's behaviour unchecked.

### 17.2 S's re-pin is an engine change, not a migration effect

**The one behaviour change under this boundary belongs to calc 2.16.0, not
to the migration.** Fixture S's `funding_gap_pence` moves from 6,300,000 to
6,330,000 (spec §24.4, `test-cases.md` §24.2), and every dependent
debt-denominated metric moves with it. This is **not** part of the v13 → v14
identity gate's claim, and is not asserted by it: S is stored at
`inputs_version: 9` and is read **directly** by `runAppraisal` under calc
2.16.0 without migrating first, exactly as every golden fixture in this
corpus is (§16.7's precedent) — it is not a v13 document at all, so it
cannot be an instance of this boundary's identity claim. The number moves
because the **formula** §4.2(b) reads changed — a per-month lender-eligible
share in place of R14's single ratio — not because any document was
migrated. S carries the change whatever `inputs_version` it is stored at,
because the engine computes calc 2.16.0 over any pre-v14 document via the
same structural reads every prior version boundary has used
(`costPlanFromLegacyCosts` and its like), not via a migration step.

The distinction matters for a reader checking "did the migration lose or
change money": it did not. `inflation: null` is unconditionally inert (§17
above); the whole of the arithmetic movement recorded in this release
belongs to §24.4's per-month share, and the migration boundary is the wrong
place to look for it.

### 17.3 The boundary round trip and the entry-point cutover

The persistence-boundary test asserts the **presence and value** of
`inflation: null` after a full save/load round trip on a document carrying a
non-null `qs` block (the same `extra='ignore'` discipline §13's snapshot
uses), and its absence — no key written — on a document whose `qs` is null.

**Entry-point cutover.** `migrateInputsToV14` / `migrate_inputs_to_v14`
replaces `migrateInputsToV13` / `migrate_inputs_to_v13` at every production
call site (the appraisal read path, the report generators, the sensitivity
suite, the lender-case snapshot builder); the governance `inputs_version`
stays derived from the document itself, never asserted independently (R13's
finding, carried forward again); and the Costs page's `DEFAULT_QS` — the
record a user seeds by unchecking "No QS recorded" — carries `inflation:
null` from the moment it is created, never an implicit zero.

**The consequence a reader must not mistake for a defect** is the same one
every inputs-version boundary carries (spec §13.2's disclosure, §16.2's
statement of it for v13): **every stored appraisal's `input_hash` moves on
its next save**, because the document genuinely gained a field even though
that field is `null`, and an approved lender case therefore goes stale on
that save (spec §21.3). There is no due-diligence-style re-grading
consequence at this boundary — §24 adds no FINAL condition and no banner —
so the only consequence to disclose is the hash move itself.
---

## 18. v14 → v15 (Release 16, calc `2.17.0`)

**What's added.** `CalculatorInputsV15` is `CalculatorInputsV14` plus **four**
fields, none of them top-level: `saleable_area_adjustment_pct`,
`abnormal_cost_adjustment_pct`, `programme_slip_months` and
`refi_ltv_adjustment_pct` on `ScenarioOverrides`, which is the shape stored
at `scenarios.{base, upside, downside, severe}` (spec §25.1). They are the
four levers spec §25's standard lender stress pack needs and the Scenarios
page now writes. `CalculatorInputsV15` subclasses `CalculatorInputsV14`, for
the reason every prior version extended rather than replaced: the engine
dispatches on the class, and a flat re-declaration would make those
`isinstance` checks silently false for v15 documents.

| v14 field | v15 field | Behaviour |
|---|---|---|
| *(absent)* | `scenarios.<name>.saleable_area_adjustment_pct` | Written `0.0` on all four named scenarios — §25.1's identity for a percent lever |
| *(absent)* | `scenarios.<name>.abnormal_cost_adjustment_pct` | Written `0.0` on all four — identity for a percentage-point lever |
| *(absent)* | `scenarios.<name>.programme_slip_months` | Written `0` (an integer, matching `phase_slip_months`) on all four |
| *(absent)* | `scenarios.<name>.refi_ltv_adjustment_pct` | Written `0.0` on all four |

**Four written additions, and all four are inert.** No field is renamed, no
field is narrowed, and none of the four defaults is a value the engine reads
as a live figure: each new lever arm in `apply_scenario` / `applyScenario`
multiplies by `(1 + 0/100)` or adds `0`, which is the identity on the field
it writes. The write is nevertheless **explicit**, on every one of the four
scenarios, exactly as v12 wrote `sales_slip_months`: `ScenarioOverrides`
already defaults all four to the same zero, so a migration that relied on the
default would leave the identity gate testing nothing — a written value is
what makes "the migrated document computes what the raw one computes" a
claim that could fail.

Nothing else in §25 is a document field. `StressPackResult`, `StressResult`
and the `derivation` block are **result** shapes, computed fresh on every run
from `unit_mix`, `cost_plan`, `programme`, `unit_sales`, `investment_case`
and `due_diligence` — none of which this migration touches — so there is
nothing for the migration to write onto any of them, and no stored appraisal
gains a stress-pack figure at rest.

**Implementation** (`migrateV14toV15` / `migrate_v14_to_v15`,
`migrateInputsToV15` / `migrate_inputs_to_v15`, `isV15` / `is_v15`). The
entry point mirrors `migrateInputsToV14`'s shape, including its version
predicate (membership of the declared tuple, not a range check) and its two
refusals — an unrecognised `inputs_version` throws, and a document declaring
version 15 that fails the v15 structural check throws rather than falling
through to a permissive earlier path. `migrate_v14_to_v15` refuses a document
that is already v15, so double migration raises instead of silently
re-stamping — the idempotence guard every prior migration in this file
carries. `isV15` / `is_v15` discriminate on `inputs_version == 15` **and**
the `due_diligence` key **and** all four new keys being **present** on
`scenarios.base`. Presence, not value: every one of the four is `0` on a
correctly migrated document *and* on a document whose author has simply not
stressed anything, so only the key itself is proof that this migration ran.

### 18.1 The identity claim, and why it grew a sensitivity arm

**Claim: the v14 → v15 migration moves no computed figure, raises no new
validation issue on any existing document, and changes no sensitivity
result. Every existing appraisal produces byte-identical output either side
of it.**

The gate lives in `migrate.test.ts` and `tests/test_migrate_v15.py`. It runs
corpus-wide over every fixture carrying its own `inputs` — the filter is
`"inputs" in doc`, not `kind != "sensitivity"`, because fixture AA (spec §25)
is a `kind: sensitivity` fixture with no `inputs` of its own and the older
filter would have excluded it for the wrong reason — and a companion test
asserts the corpus it walks is non-empty and has not silently shrunk, so the
gate cannot pass by running over nothing.

The numeric arm compares the v14 run and the v15 run of the same raw document
on all three outputs — metrics, ledger and schedule — **with no carve-out
and no tolerance**, and the **flag list with strict equality**. Unlike R15b's
boundary there is no new flag to name as an addition: §25 adds no flag at
all, so strict equality on the whole set is the entire claim.

**The arm that is new to this gate: the default sensitivity suite.** On four
named fixtures — `f-dev-finance-12mo`, `u-investment-case-ltv-binds`,
`y-due-diligence` and `z-cost-plan-in-time` — the gate additionally compares
the whole default-config `SensitivityResult` on both arms. It is here rather
than in the numeric arm because this release changes something the numeric
arm cannot see: `_measure` / `measure` now applies a cell's settings sorted
into descending `LEVER_ORDER` rather than in caller order (spec §25.1), and
an appraisal of an unlevered document exercises none of it. The four
fixtures are named rather than run corpus-wide because a default suite is
eighty-one appraisals per fixture; between them they carry a cost plan, a
network programme, a unit-sales ledger, an investment case and an inflation
allowance, which is every block a lever can reach.

The validation side is three separately falsifiable properties, §18.7's
corrected shape as every boundary since has used: every issue a v14 document
raises has a v15 counterpart; no migrated document raises the one genuinely
new rule (§12.6's `programme_slip` whole-months check); and a control
document that *does* trip it raises it, so the second property is not
vacuously true.

### 18.2 An absent key is not a distinct state

The migration writes the four fields, but **nothing depends on their having
been written**. Both engines read them defensively — `?? 0` in TypeScript,
the pydantic field default in Python — because a raw pre-v15 document can
reach `applyScenario` unmigrated on paths that genuinely exist: `runAppraisal`
echoes the inputs document it was handed, the memo's scenario comparison
reads `overrides` off whatever document it was given, and golden fixture O is
applied unmigrated in a test on purpose.

This is R8's rule (spec §1.5's absent-versus-zero distinction, as applied to
scenario fields from v9 on) restated for these four: an absent key reads as
its **seed** — the same zero the migration writes — so a document behaves
identically before and after migration. That is what makes §18.1's identity
claim a statement about the migration rather than about a code path only new
documents reach, and it is why the numeric arm can compare a *raw* v14 arm
against a *migrated* v15 arm at all.

### 18.3 The boundary round trip and the entry-point cutover

The persistence-boundary test asserts the **presence and value** of all four
keys on all four scenarios after a full save/load round trip (the same
`extra='ignore'` discipline §13's snapshot uses), and the API test posts
fixture Z through `POST /appraisals` to prove the boundary is exercised by a
real request rather than by a unit test alone.

**Entry-point cutover.** `migrateInputsToV15` / `migrate_inputs_to_v15`
replaces `migrateInputsToV14` / `migrate_inputs_to_v14` at every production
call site (the appraisal read path, the report generators, the sensitivity
suite and the stress pack, the lender-case snapshot builder), in **one
commit** with the migration itself, and the entry-point guards' `EXEMPT` sets
and `spec-versions.test.ts` move with it; the governance `inputs_version`
stays derived from the document itself, never asserted independently (R13's
finding, carried forward again).

**The consequence a reader must not mistake for a defect** is the same one
every inputs-version boundary carries (spec §13.2's disclosure): **every
stored appraisal's `input_hash` moves on its next save**, because the
document genuinely gained four fields even though all four are zero, and an
approved lender case therefore goes stale on that save (spec §21.3). §25 adds
no FINAL condition and no banner, so the hash move is the only consequence to
disclose — and, unlike R15b's boundary, there is no accompanying engine
change: **no fixture pin moves at this release at all**.
