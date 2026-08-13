# Release 2 design — lender metrics and verification hardening

Date: 2026-08-13
Status: approved (brainstorming session, user-approved)
Predecessor: Release 1 (P0 financial correction), merged to local `main` at `0861d48`.
Source backlog: `docs/reviews/2026-08-13-release-1-implementation-report.md` §10–§11.

## Scope decision

Release 2 is split into two sequenced sub-releases, each with its own implementation
plan, executed R2a first:

- **R2a — verification & ops hardening.** No formula or engine changes. Closes the two
  gaps recorded against the already-merged Release 1: the Alembic migration path gap and
  the missing live E2E/UAT pass.
- **R2b — lender metrics + hygiene.** The four `[R2]` spec metrics that do not require
  the dated programme, plus low-risk correctness hygiene.

Explicitly **out of scope** (deferred to R3+): dated programme, fixed-facility
sensitivity suite, pari-passu draw rule, VAT modelling, non-straight-line spend
profiles, area bridge/efficiency metrics, developer/lender mode split, exit-fee band
holdback refinement, equity `timing_month` enforcement.

The only real database is the local Docker volume on the development machine (holding
the York appraisal). There is no deployed instance. R2a's runbook and UAT target that
environment.

## R2a — verification & ops hardening

### A1. Alembic migration path fix

- Move the two existing migration scripts (001, 002) into the canonical
  `migrations/versions/` directory that Alembic's default `version_locations`
  discovers (preferred over pointing `version_locations` at the current non-standard
  path — less config, standard layout).
- Verify `alembic upgrade head` on an empty database produces a schema equivalent to
  `Base.metadata.create_all` (the current boot path). Boot behaviour is unchanged for
  fresh databases.
- Add an automated test: Alembic discovers the chain and upgrades an empty SQLite
  database to head without error.
- Extend `docs/financial-model/migration-notes.md` with an operator runbook for
  the existing database (the Docker volume): back up the volume; because the
  ORM-created schema already matches migration 002 (report §10), the correct step is
  `alembic stamp head` (record the current revision without re-running migrations);
  from then on future releases apply `alembic upgrade head`. Verify row statuses
  afterwards.

### A2. Live E2E/UAT pass

- Scripted checklist executed against the real running app (`docker compose up`,
  frontend :5173, API :8000) and the real database volume:
  1. Load the actual York appraisal in the browser.
  2. Observe the `legacy_unreconciled` red banner and the mismatch list.
  3. Exercise save → server-side recalculation → status/hash transition.
  4. Confirm reports carry the correct watermark for the row's status.
- Results (including screenshots) recorded in a dated review document under
  `docs/reviews/`. This closes the report-§9 verification limitation.
- Any defect found during the pass is fixed inside R2a (systematic-debugging + TDD),
  not deferred.

R2a exit condition: the UAT review document is complete, and all five gates are green
(frontend vitest, tsc, eslint, build; backend pytest).

## R2b — lender metrics + hygiene

Governance rule (unchanged, `docs/financial-model/model-governance.md`): every formula
change amends the spec, adds hand-derived fixtures, and updates BOTH engines
(`frontend/src/lib/model/` and `app/financial_model/`) in one change.

### B1. Data model: `lender_valuation` input block and inputs v3

- New **optional** input block `lender_valuation`:
  - adjustment basis: `global_pct` | `global_per_sqft` | `unit_type` | `per_unit` |
    `fixed_amount` (spec §3.2's enumerated mechanisms);
  - the adjustment value(s) for that basis;
  - required provenance: `reason`, `author`, `date`.
- New input `enforcement_cost_assumption_pence` (§5.11 names it but no such input
  exists yet): optional, default `0`, disclosed as an assumption wherever the senior
  repayment break-even is reported. Added in the same v3 migration.
- Absent block ⇒ `lender_gdv_pence` stays `null` and every lender-basis metric
  (`ltgdv_lender_pct`, break-even % of lender GDV) stays `null`. Never silently
  defaults to developer GDV (spec §3.2).
- Because `input_hash` is a canonical hash of the whole inputs payload, adding the
  field is an **`inputs_version` 2→3 migration**, mirroring the proven v1→v2
  mechanism (migration function in both engines + server-side recalc + re-hash).
  Outputs are unchanged when the block is absent, so migrated rows **keep their
  existing status** (they do not drop to `legacy_unreconciled`).

### B2. Engine metrics (spec markers `[R2]` → implemented)

- **Lender-underwritten GDV (§3.2):** Σ lender unit values per the recorded
  adjustment basis; variance vs developer GDV carried with reason/author/date
  (the variance bridge).
- **Senior repayment break-even (§5.11):** minimum net realised proceeds `P` with
  `P = redemption_balance_at_disposal + exit_fee + disposal_costs(P) +
  enforcement_cost_assumption`, solved by bisection at integer-pence precision with an
  iteration cap; non-convergence ⇒ `null` + red flag, never a substitute formula.
  Reported absolute, as % of lender GDV, and as % fall from lender GDV (both
  percentage forms `null` until lender GDV is set).
- **Developer profit break-even (§5.12):** minimum net proceeds giving zero developer
  profit, selling costs re-solved at break-even receipts. Separate solve; never
  conflated with §5.11.
- **Cost-to-complete (§5.10):** per month — remaining development/fees/statutory
  costs + remaining contingency + forecast finance to completion, versus undrawn
  committed net facility + remaining committed **cash** equity + other committed
  funding. Reports remaining cost, remaining funding, surplus/shortfall, first
  shortfall month, maximum shortfall. Computed from the existing straight-line
  monthly ledger. **Spec amendment:** §5.10's "implemented with the dated programme"
  becomes "implemented on the straight-line schedule; re-derived when the dated
  programme lands (R3)".

### B3. Hygiene

- **Fractional-sqm rounding rule:** spec §1.1 amendment fixing the integer-pence edge
  — the construction base cost `rate × sqm` rounds half-up to integer pence — plus a
  fixture with fractional `total_construction_sqm` pinned in both engines.
- **Python invariant matrix:** port the TS 4-way derived-variant matrix
  (`base`/`retain_all`/`serviced`/`term=1`) to the Python invariant suite.
- **Shared migration-mapping fixtures:** port the 4 hand-derived v1→v2 unit cases to
  Python; add v2→v3 cases in both languages.

### B4. UI and reports

- Lender-valuation entry section with the provenance fields; validation matches the
  developer-value hard-error rules (zero/negative adjustments rejected the same way).
- Variance bridge display: developer GDV vs lender GDV with reason/author/date.
- Metric cards for the two break-evens and cost-to-complete replace today's
  "not available" placeholders **only when computable**; `null` keeps the existing
  "not available" rendering (prohibited-calculation rule intact).
- Reports include the new metrics under the existing status/watermark rules.

### B5. Edge handling

- Break-even solver: bounded bisection with an iteration cap and integer-pence
  convergence; cap exhaustion ⇒ `null` + red flag.
- Cost-to-complete at a fully drawn facility: remaining funding = remaining committed
  cash equity + other committed funding only (undrawn facility term is zero).
- New invariants: senior break-even ≥ redemption balance + exit fee; cost-to-complete
  identity `remaining cost = total cost − cumulative spend` per month. The two
  break-evens are checked independently (no ordering assertion between them — they can
  legitimately cross).

## Testing and gates

- TDD throughout; every fixture value hand-derived before implementation (governance
  doc rules).
- Gates at every commit: `cd frontend && npx vitest run`;
  `npx tsc -p tsconfig.app.json --noEmit`; eslint; build; `python -m pytest -q`.
  (Deps: `npm install --legacy-peer-deps`.)
- R2b exit condition: new metrics live in the app against fixtures pinned in both
  engines; all gates green; spec, fixtures and both engines amended in lockstep.
