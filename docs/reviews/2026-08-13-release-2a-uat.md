# Release 2a live E2E/UAT — York appraisal

Date: 2026-08-13. Environment: docker compose (frontend :5173, API :8000, postgres 16
`commercial-resi-analyser_postgres_data` volume — the only real database).
Closes the verification limitation in
`docs/reviews/2026-08-13-release-1-implementation-report.md` §9.

Method note: Alembic commands were executed with `docker compose run --rm api ...`
from the R2a worktree with `COMPOSE_PROJECT_NAME=commercial-resi-analyser`, so the
one-off container bind-mounted the R2a branch's `migrations/versions/` layout while
the running application containers were left untouched. Browser-visual checks could
not be captured this session (Claude-in-Chrome extension not connected); every check
below marked "API/DB-verified" was confirmed at the API and SQL layer, which is the
layer that drives those UI states. The visual pass is listed as the one remaining
follow-up.

## Checklist results

| # | Check | Expected | Observed | Verdict |
|---|-------|----------|----------|---------|
| 1 | Alembic runbook executed on real DB | stamp + current = 002 (head) | Live DB was pre-002 with stale foreign revision `003`; path taken: backup → `stamp --purge 001` → `upgrade head` → `current` = `002 (head)` → api restarted | PASS (with defects D1, D2 found and fixed) |
| 2 | York appraisal loads | project + appraisal render, no errors | **Before migration: GET 500** (`column financial_appraisals.outputs does not exist`, D1). After: GET 200 with full snapshot; SPA deep-link `/projects/da471…` serves index (history fallback OK). Visual render: pending browser pass | PASS (API/DB-verified) |
| 3 | Status banner | red `legacy_unreconciled` banner | Row status = `legacy_unreconciled` after migration 002 (server_default applied to the pre-existing row exactly as designed) | PASS (API/DB-verified; visual pending) |
| 4 | Mismatch list | reconciliation mismatch data present | `outputs.reconciliation` populated on re-save: `report_safe: false`, `senior_repaid: false`, warning "Senior debt not repaid within the modelled term" (retain_all refinance not modelled — known R2 limitation). Legacy stored TDC 80,179,574p vs recalculated 76,490,630p | PASS (API/DB-verified; visual pending) |
| 5 | Save → server recalc | status/hash transition per governance | Bare re-save correctly **422-rejected** (stored v1 snapshot has `part_l_compliance_pence: -100`; negative components are hard errors — no silent recalc from invalid input). After correcting that field to 0: PUT 200, v1→v2 migration ran, `inputs_version` 2, `calc_version` 2.0.0, `input_hash`/`outputs_hash` set, status held at `legacy_unreconciled` (was_v1 → visibly unconfirmed, never silently reconciled). DB row matches API response | PASS |
| 6 | Report watermark | report watermarked per row status | Driving data verified: `status = legacy_unreconciled` and `outputs.reconciliation.report_safe = false` — both watermark conditions active. Visual confirmation of the rendered watermark: pending browser pass | PASS (API/DB-verified; visual pending) |

## Command transcripts (abridged; full outputs in session log)

```
$ curl http://localhost:8000/api/v1/appraisals/da471fca-…   # before migration
HTTP 500  — sqlalchemy ProgrammingError: column financial_appraisals.outputs does not exist

$ docker exec …postgres psql -c "SELECT version_num FROM alembic_version"
 003            # ← not a revision in this repo's chain (001, 002 only)

$ docker compose stop api
$ docker compose exec -T postgres pg_dump -U postgres commercial_resi > backup-2026-08-13.sql   # 25,561 bytes, verified
$ docker compose run --rm api alembic current
FAILED: Can't locate revision identified by '003'
$ docker compose run --rm api alembic stamp --purge 001
Running stamp_revision  -> 001
$ docker compose run --rm api alembic upgrade head
Running upgrade 001 -> 002, Appraisal governance columns …
$ docker compose run --rm api alembic current
002 (head)
$ psql: SELECT id, status, inputs_version FROM financial_appraisals
 ee9b67f4-… | legacy_unreconciled | 1
$ docker compose start api

$ curl http://localhost:8000/api/v1/appraisals/da471fca-…   # after migration
HTTP 200  — status legacy_unreconciled, outputs null, inputs_version 1

$ curl -X PUT -d '{}' …/appraisals/da471fca-…               # bare re-save
HTTP 422  — part_l_compliance_pence: Input should be greater than or equal to 0 (input -100)

$ PUT with inputs_snapshot.conversion_costs.part_l_compliance_pence = 0
HTTP 200  — status legacy_unreconciled, inputs_version 2, calc_version 2.0.0,
            input_hash e50004f5…, outputs_hash 2146531c…,
            TDC 76,490,630p (legacy column had 80,179,574p), report_safe false

$ psql: SELECT status, inputs_version, calc_version FROM financial_appraisals
 legacy_unreconciled | 2 | 2.0.0
```

## Defects found (fixed in R2a)

- **D1 — Production database was never migrated; appraisal API was live-broken.**
  The live `financial_appraisals` table had no governance columns, so every
  appraisal GET/PUT returned 500 once the Release 1 code was picked up by
  uvicorn `--reload`. Root cause chain: (a) migrations were undiscoverable by
  Alembic before this release (fixed, Task 1, `4527b83`); (b) the api boot
  command swallows migration failure (`alembic upgrade head || echo WARNING`),
  so the failure was invisible; (c) `Base.metadata.create_all` creates missing
  tables but never adds columns to existing ones. Resolution: runbook executed
  live (transcript above); endpoint verified healthy after.
- **D2 — Runbook prescribed the wrong path for the real database.** It assumed
  the schema already matched 002 (`stamp head`); the live DB was pre-002 and
  carried a stale foreign `alembic_version` of `003`, on which plain
  `stamp`/`current` fail. Fixed in this release: `migration-notes.md` §4 now
  opens with a diagnosis step and covers all three states, including
  `stamp --purge`.
- **Data correction (recorded, not a code defect):** the stored v1 snapshot
  contained `part_l_compliance_pence: -100` (invalid, −£1). Corrected to `0`
  via the API as the UAT's "trivial permitted edit"; the pre-correction state
  is preserved in `backup-2026-08-13.sql`.

## Recommendations (not fixed in R2a — R2b/ops triage)

- The api boot command's `|| echo 'WARNING: migrations failed, starting anyway'`
  is what let D1 go unnoticed. Changing boot semantics is outside R2a's
  no-behaviour-change scope, but R2b should either fail fast or surface the
  failure prominently (health endpoint flag), so a schema/code mismatch can
  never again run silent.
- The remaining browser-visual pass (banner, mismatch list, watermark as
  rendered) should be completed when a Claude-in-Chrome session is available;
  all driving data is verified and recorded above.

## Verdict

The Release 1 governance mechanism works end-to-end against the real production
row: legacy flagging via migration 002's server_default, refusal to recalculate
from invalid legacy input, v1→v2 migration on save, server-authoritative
recalculation with hashes, and status held at `legacy_unreconciled` pending
explicit confirmation. The UAT also caught a genuine production outage (D1) and
a wrong runbook assumption (D2), both fixed within this release. R2a's exit
condition is met, with the browser-visual confirmation carried as the single
open follow-up.
