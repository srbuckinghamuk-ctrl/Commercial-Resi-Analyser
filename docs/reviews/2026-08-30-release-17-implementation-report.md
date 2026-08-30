# Release 17 — Elemental benchmark, area units, authenticated governance, York resave

**Date:** 30 August 2026
**Branch:** `r17-benchmark-governance` · merge base `85311ab` (R16b on main)
**Calc version:** 2.18.0 → **2.19.0** · **Inputs schema:** v16 → **v17** · **Alembic:** 007 → **008**
**Design:** `docs/superpowers/specs/2026-08-30-r17-benchmark-governance-design.md`
**Plan:** `docs/superpowers/plans/2026-08-30-r17-benchmark-governance.md`
**Specification:** `docs/financial-model/calculation-specification.md` §27 (new); §1.6, §5.7, §13.1, §13.5, §16.9, §21, §23.5, §24.9, §26.6 amended
**Audit source:** `docs/reviews/2026-08-30-lender-readiness-third-audit.md` §7.2, §8.2, §8.4, §8.8, §9, §10, §11, §12 (both P0 rows, the BCIS and index P1 rows, four P2 rows)

---

## 1. Summary of implemented changes

1. **Elemental cost benchmark layer** (spec §27.1–§27.6): a versioned `ElementalBenchmarkSet` (three provider tiers — `bcis_licensed` for a user-supplied licensed import, `public_benchmark` naming a real publisher, `user_qs`) embedded in the appraisal document with its rates, per-element `SchemeElementalCostSelection`s, a 39-element conversion catalogue with per-element measurement bases (£/m², £/ft², £/unit, £/item, percentage, lump sum), index-ratio currentisation with an evidenced location multiplier, per-row and total comparison against the cost plan, twelve warning codes with configurable thresholds, and a content hash over the normalised set. The result is **advisory**: `enters_tdc: false` is a pinned literal and the identity of every ledger figure with the block removed is asserted (fixture AB).
2. **Global m²/ft² toggle** on Areas, Unit Mix, Costs, the benchmark panel, Investor summary, Project detail and the memo, on one canonical basis (m², pence/m²), exact factor 10.7639104167097, display-time conversion only; the memo prints the report unit and the factor.
3. **Currentisation separated from forward inflation**: `current = original × (current_index ÷ base_index) × (location_factor ÷ 100)`; apply-to-cost-plan requires `qs.base_date == currentisation_date` (refused otherwise) so §24.3's package inflation remains the single forward step.
4. **Comparison of QS/developer costs against benchmark** on the Costs page (element table, summary, warnings) and in memo §12C.
5. **Authenticated lender-case governance**: users, five roles, stdlib PBKDF2 passwords and HMAC bearer tokens, server-side role matrix, maker-checker by user id, versioned compare-and-swap, idempotency keys, locked-snapshot integrity check, append-only events carrying actor id, hashes and version; `created_by`/`actor` bodies are refused (422).
6. **Existing-project migration and source reconciliation**: governed resave endpoint with retained `appraisal_versions`, stale-row listing, structured `source_records`/`source_resolutions` with engine-derived per-field conflicts that defeat FINAL until evidenced; York reconciled on the live database (§9 below).
7. **Terminology and report corrections**: "Unrealised Return on Equity", the refinance stress cell wording, one ledger-month convention, PDF/UA limitation stated accurately.

## 2. Files changed

Four commits on the branch (`ea5fbc2`, `3694af3`, `3540ed7`, `0c1cc1f`) after the docs commit `3288baa`; `git diff --stat 85311ab..HEAD` is the authoritative list. New modules: `frontend/src/lib/model/elemental-benchmark.ts`, `apply-benchmark.ts`, `area-units.ts`, `sha256.ts`, `area-unit-context.tsx`, `auth.tsx`, `benchmark-api.ts`; `components/AreaUnitToggle.tsx`, `LoginPage.tsx`, `calculator/ElementalBenchmarkPanel.tsx`, `SourceRecordsEditor.tsx`; `app/financial_model/elemental_benchmark.py`, `area_units.py`; `app/auth/*`; `app/benchmarks/*`; `migrations/versions/008_benchmark_library_and_users.py`; `scripts/york_reconcile.py`, `scripts/ons_opi_to_json.py`; `data/index-datasets/ons-construction-opi-2026q2.json`; `fixtures/financial-model/ab-elemental-benchmark.json`; `fixtures/benchmarks/*`; `docs/data-sources-and-licensing.md`.

## 3. Input and calculation version changes

Inputs **v17** adds `elemental_benchmark: null | SchemeElementalBenchmark`, `cost_plan.packages[].benchmark_origin: null | BenchmarkOrigin`, and `due_diligence.source_records` / `source_resolutions` (`[]`). Calc **2.19.0** adds `AppraisalResultV2.elemental_benchmark` (null on every migrated document) and three flag codes. The v16 → v17 identity gate (`migrate.test.ts`, `tests/test_migrate_v17.py`) compares metrics, ledger and schedule corpus-wide with no exclusion; both exception lists are empty and asserted empty. `outputs_hash`/`audit_hash` move on the next save of every stored row because the result shape changed (§13.2's comparability rule), and every live lender case goes stale at that save (§21.3).

## 4. Database migrations

Alembic **008**: `users`, `benchmark_sets`, `benchmark_rates` (incl. `rate_key`, the import document's rate id so a read-back reproduces its content hash), `index_datasets`, `index_observations`, `appraisal_versions`; `lender_cases` + `version` and four `*_user_id` columns; `lender_case_events` + `actor_user_id`, `idempotency_key`, `reason`, `input_snapshot_hash`, `outputs_hash`, `case_hash_after`, `case_version_after`, unique `(case_id, idempotency_key)`. Downgrade functional on SQLite. Applied to the live Postgres after a backup (`backups/commercial_resi-20260830-150029-pre-r17-alembic007.dump`); the hot-reloaded API's boot-time `create_all` had pre-created the six new tables without 008's column additions (the race recorded in memory), so the six empty tables were dropped and `alembic upgrade head` run; `/health` reports `migrations_current: true`.

## 5. Data sources and licence status

- **BCIS** (`bcis.co.uk/products`, `/packages-and-services`, `/bcis-capx-indices`, read 30 Aug 2026): subscription products; nothing bundled; the `bcis_licensed` tier accepts only a user's authorised manual import and is labelled "User-supplied BCIS licensed benchmark — verify redistribution rights".
- **ONS Construction Output Price Indices, Quarter 2 2026** (released 13 Aug 2026, retrieved 30 Aug 2026, source SHA-256 `ea0cbfe6…6edde`, Open Government Licence v3.0, Crown copyright): ten monthly series Jan 2014 – Jun 2026, 2015 = 100, shipped as `data/index-datasets/ons-construction-opi-2026q2.json` and seeded as ten immutable dataset versions; labelled everywhere as a public currentisation proxy — not BCIS TPI, not elemental.
- **Elemental rates:** none ship. No lawful reusable elemental-rate source with quartiles and sample counts was found; the library is empty until a user imports. The only rates in the repository are fixture AB's, named `TEST FIXTURE — NOT MARKET DATA`, under `fixtures/`, never seeded.

## 6. Currentisation methodology

`currentisation_factor = current_index_value ÷ base_index_value` (null when either is missing or ≤ 0 → method `none`, warning `rates_not_currentised`); `location_multiplier = location_factor ÷ 100` (1.0 and "No evidenced location adjustment applied." when null; a per-rate factor overrides the set's); `canonical_rate_pence_per_sqm` = the per-m² pence, or per-ft² pence × 10.7639104167097; `adjusted = canonical × factor × multiplier × (1 + adjustment_pct/100)`; `benchmark_amount_pence = round_half_up(adjusted × quantity)` — the one rounding. Percentage elements take the rounded non-percentage subtotal. Index ratio whenever two dated observations exist; the UI's annual-% fallback writes a derived `current_index_value` with `current_index_name = 'assumed: N% p.a.'` so the assumption is visible in the stored document.

## 7. How double counting is prevented

Apply copies `benchmark_amount_pence` (currentised to `currentisation_date`) into a draft package and requires `cost_plan.qs.base_date == currentisation_date` (seeding `qs` when null, refusing otherwise); §24.3 then inflates every package from that base date to its spend midpoint — the only forward step. The result row's `forward_inflated_benchmark_amount_pence` is a disclosure of the mapped package's §24.3 factor and enters nothing. Pinned by the single-forward-step test (`apply-benchmark.test.ts`): the applied package's `inflation_pence` equals amount × (1.06^(12.5/12) − 1) half-up, and seeding the set's base date is refused. Re-applying an element replaces its own benchmark-derived package rather than adding a second; user-entered, fixed-price and contract-sum packages are never overwritten.

## 8. Authentication and lender-governance changes

Spec §21 amended. Routes: `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `GET/POST /users`, `PATCH /users/{id}`. Every lender-case route requires a bearer token; create requires developer/broker/administrator; `under_review`/`information_required` underwriter or credit approver; decisions credit approver only; supersede any role. Maker-checker refuses a decision by the case's creator or submitter and a review by its submitter (403); a legacy case with no authenticated submitter cannot be decided (409). Transitions carry `expected_version`, `expected_case_hash`, `idempotency_key`; stale version, hash mismatch and a tampered locked snapshot are 409; a replayed key returns the current case without a second event. `case_hash` and `audit_hash` formulas are unchanged. Negative tests: unauthenticated 401; wrong role 403; maker 403 then a different approver 200; stale version 409; tampered hash 409; DB-edited snapshot 409; replay 200 with no new event; `created_by`/`actor` bodies 422. No cosmetic role selector exists: the page offers only what the server allows and says "Lender governance unavailable" when no user can sign in.

## 9. York case migration result (live database, `scripts/york_reconcile.py`, 30 Aug 2026)

- Five project rows carried the glued `Description` label (York, Wakefield, Bradford, Middlesbrough, Alfreton); each was repaired by the narrow rule (label removed, before/after printed) and written back.
- York (`da471fca…`): stored `draft / inputs v3 / calc 2.1.0 / audit_hash empty` → resaved **`draft / inputs v17 / calc 2.19.0`** with `audit_hash` recorded; the original v3 snapshot retained as `appraisal_versions` row `a5619559-29d2-4858-8371-2cffded93898` (reason `governed_resave`). Every metric identical before and after (asserted by the script and `tests/test_york_audit_case.py`).
- Two `source_records` written with no resolution: `listing_structured` (`existing_use: office`, from `projects.use_class`) and `listing_narrative` (retail below, upper parts sold off on a 999-year lease and operated as Airbnb; `upper_parts_included: false`). The engine raised `source_conflict_unresolved` on `existing_use`; no winner was chosen.
- Blockers surfaced: VAT engine off against a non-zero build (6/6 treatments unconfirmed, purchase VAT unconfirmed); facility terms migrated and unconfirmed; jurisdiction unconfirmed; single migrated cash-equity source unconfirmed; no lender valuation, investment case or unit sales; senior debt outstanding at maturity; 23/23 entered due-diligence items unknown; 1 unresolved source conflict; `report_safe: false`. **The case remains DRAFT.**
- A latent Postgres-only defect was found and fixed en route: the acquisition-tax table's open-ended top band (`math.inf`) reached the `outputs`/`validation` JSON columns and Postgres rejects `Infinity` (SQLite, the test target, does not). `calculate_authoritative` now canonicalises non-finite floats to `null` before hashing and persisting, matching the TypeScript engine's JSON; regression test `test_persisted_outputs_carry_no_non_finite_float`.

## 10. Test, lint and build results (final integration run)

| Gate | Result |
|---|---|
| Backend `python -m pytest -q` | **3,343 passed** (baseline 3,061) |
| Frontend `npx vitest run` | **97 files, 4,028 passed** (baseline 86 / 3,728) |
| `npx tsc -b` | exit 0 |
| `npm run lint --max-warnings 0` | exit 0 |
| `npm run build` + bundle gate | entry static closure **306.4 kB** / 500.0 kB ceiling (ExportPage and LoginPage made lazy; ceiling untouched) |
| Migration tests (`test_health_migrations`, `test_alembic_migrations`) | 9 passed; chain 008 → 001 |
| Live `/health` | `migrations_current: true` |
| Ruff | 45 pre-existing findings in files R17 did not author (listed by the integration pass); none introduced |

No test assertion was weakened; the only changed pins are version constants and the fixture rosters/exclusion lists gaining AB.

## 11. Changed financial outputs

**None.** The v16 → v17 identity gate passes corpus-wide with no exclusion; fixture AB is the only new fixture; no existing fixture pin's value moved. The only figures that change on a stored row are `outputs_hash` and `audit_hash` (result shape), and — for a row saved on Postgres — the top band ceiling of the acquisition-tax breakdown is stored as `null` rather than failing to persist at all.

## 12. Memo visual-QA result

Geometric gates (`memo-release-gate.test.ts`: page bounds, sparse pages, orphaned headings, footer, layout determinism) ran over every route including the new AB route (19 pages) on both metric and imperial renders and passed. The page-by-page visual inspection of the live York memorandum in Chrome was delegated to a browser agent; its result is recorded in the final session report (see the closing note below).

## 13. Remaining limitations

Spec §27.9: no elemental rates ship; ONS OPI is an output-price proxy; no automatic download; single tenant; stateless tokens (logout is client-side; rotating `API_SECRET_KEY` invalidates all); `global_per_sqft` keeps its stored 10.7639 convention; headline mode compares a total only; a percentage element's base is the benchmark subtotal; PDF/UA is not achievable with jsPDF 4.2.1; source-conflict detection is per structured field (the narrative is stored, not parsed). Also: raster memo regression remains manual; the York case is still DRAFT with the blockers above.

## 14. BCIS confirmation

No BCIS dataset, page or service was scraped, bypassed, reproduced or redistributed. The only BCIS content consulted was the three public product/index description pages, read to confirm licensing status; no rate, factor or index value from BCIS exists anywhere in the repository or the live database.
