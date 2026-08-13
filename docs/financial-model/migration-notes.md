# Financial Model — Migration Notes (v1 → v2)

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

## 2. DB migration 002 (`migrations/002_appraisal_governance.py`)

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
