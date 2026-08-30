# Release 17 — Elemental benchmark, area units, authenticated governance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the third audit's P0/P1 remediation in one release: the elemental cost benchmark layer (three provider tiers, empty licensed shelf, index-ratio currentisation separated from §24.3's forward inflation, advisory until applied), a global m²/ft² display toggle on one canonical basis, authenticated lender-case governance with maker-checker separation and idempotent versioned transitions, the governed resave of the York appraisal with its original snapshot retained and its narrative/structured-use conflict recorded, and the four presentation corrections — inputs v17, calc 2.19.0, Alembic 008, spec §27.

**Architecture:** Two engines (`frontend/src/lib/model`, `app/financial_model`) that must stay penny-identical; every schema move is an `inputs_version` bump with a migration in each engine and a corpus-wide identity gate on both arms. The benchmark set is embedded in the document so both engines compute from the document alone. Persistence is FastAPI + SQLAlchemy + Alembic; authentication is stdlib PBKDF2 + HMAC tokens over the reserved `api_secret_key`.

**Tech Stack:** TypeScript 5.9 / React 19 / react-router-dom 7 / Vite 8 / vitest; Python 3.11+ / pydantic v2 / SQLAlchemy 2 / Alembic / pytest; jsPDF 4.2.1.

**Spec:** `docs/superpowers/specs/2026-08-30-r17-benchmark-governance-design.md` (read it first — every task cites its section).

## Global Constraints

- `CALC_VERSION` becomes `'2.19.0'` / `"2.19.0"` in Task 1 and never changes again. Inputs version becomes `17` in Task 3.
- **No computed figure moves.** The v16 → v17 identity gate compares `metrics` (with `elemental_benchmark` null on both arms), `model` and `schedule` with no exclusion. If a pinned value has to change to make a test pass, stop and report.
- Fixture corpus: `fixtures/financial-model/*.json` — 23 files today, 24 after Task 9 (AB). Corpus loops filter on `'inputs' in doc`.
- The three engines' guards stay as they are: `frontend/eslint.config.js` accessor selectors, `accessor-guard.test.ts`'s exact allowlist (a new model file that reads a raw guarded field must be added there with a reason), `entry-point-guard.test.ts` (`NEWEST` moves to 17 in Task 3; only `ConversionCalculator.tsx`, `ExportPage.tsx` call a migration), `page-status.ts`'s `PAGE_OWNERSHIP` (new validation field roots `elemental_benchmark` → `conversion_costs` page, `due_diligence.source_records` → `due_diligence`).
- `ConversionCostsPage.tsx` is pinned to exactly three `eslint-disable-next-line no-restricted-syntax` comments. The benchmark panel is a **separate component file** and reads only `run.metrics.elemental_benchmark` and `inputs.elemental_benchmark` — never a guarded raw field.
- The PDF generator performs no benchmark arithmetic; every printed figure is a result field.
- Gates before every commit, from the repo root: `python -m pytest -q`; from `frontend/`: `npx vitest run`, `npx tsc -b`, `npm run lint`, `npm run build`.
- Commit messages: `<type>(r17): <what, and the reason>` plus the two trailer lines the session requires.
- Branch: `r17-benchmark-governance` off `main` (`85311ab`), already created.
- The Python `Model` base ignores unknown keys: assert a key's *absence* on `model_dump(mode="json")` or stored JSON, never on a parsed model.
- Locate code by content, not line number.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `frontend/src/lib/model/finance-types.ts`, `app/financial_model/types.py`, `frontend/src/lib/model/metrics.ts`, `app/financial_model/metrics.py` | `CALC_VERSION`, `AppraisalResultV2.elemental_benchmark`, `CalculatorInputsV17` | 1, 3 |
| `frontend/src/lib/area-units.ts` (new), `app/financial_model/area_units.py` (new) + tests | exact conversion module | 2 |
| `frontend/src/lib/model/elemental-benchmark.ts` (new), `app/financial_model/elemental_benchmark.py` (new) + tests | catalogue, types, `computeElementalBenchmark`, warnings, `contentHash` | 4 |
| `frontend/src/lib/model/migrate.ts`, `app/financial_model/migrate.py`, `conversion-defaults.ts`, `index.ts`, `tests/test_migrate_v17.py` (new), `migrate.test.ts` | v17 migration + identity gate | 3 |
| `frontend/src/lib/model/validation.ts`, `app/financial_model/validation.py` | §27.5 rules 1–15 | 5 |
| `frontend/src/lib/model/due-diligence.ts`, `app/financial_model/due_diligence.py` | source records, conflicts, resolutions | 6 |
| `frontend/src/lib/model/apply-benchmark.ts` (new) + test | apply-to-cost-plan document transform | 7 |
| every `components/calculator/*Page.tsx` + tests, `ConversionCalculator.tsx`, `ExportPage.tsx`, `app/api/app.py` | v17 entry-point cutover | 3 |
| `fixtures/financial-model/ab-elemental-benchmark.json` (new), `fixtures/benchmarks/*` (new), `golden-fixtures.test.ts`, `tests/test_financial_model_fixtures.py`, `test-cases.md` §27 | fixture AB, import fixtures | 9 |
| `migrations/versions/008_benchmark_library_and_users.py` (new), `app/persistence/database.py`, `app/persistence/repositories.py`, `tests/test_alembic_migrations.py`, `tests/test_orm_tables.py` | Alembic 008 | 10 |
| `app/auth/` (new: `passwords.py`, `tokens.py`, `deps.py`, `cli.py`), `app/models.py`, `app/api/app.py`, `config/settings.py`, `tests/test_auth.py` (new) | authentication, users | 11 |
| `app/api/app.py` (lender-cases), `app/financial_model/provenance.py`, `frontend/src/lib/report-provenance.ts`, `tests/test_lender_case_governance.py` | authenticated governance, maker-checker, idempotency, version CAS | 12 |
| `app/api/app.py` (benchmark + index routers), `app/benchmarks/` (new: `library.py`, `index_import.py`, `seed.py`), `data/index-datasets/ons-construction-opi-2026q2.json` (new), `scripts/ons_opi_to_json.py` (new), `tests/test_benchmark_api.py` (new) | library and index datasets | 13 |
| `app/api/app.py` (appraisals resave/versions/stale), `tests/test_appraisal_governance.py`, `scripts/york_reconcile.py` (new) | governed resave, York | 14 |
| `frontend/src/lib/api.ts`, `frontend/src/lib/auth.tsx` (new), `frontend/src/components/LoginPage.tsx` (new), `LenderCasePage.tsx`, `App.tsx` | client auth | 15 |
| `frontend/src/lib/area-unit-context.tsx` (new), `AreaUnitToggle.tsx` (new), `AreasPage.tsx`, `UnitMixPage.tsx`, `ConversionCostsPage.tsx`, `InvestorSummaryPage.tsx`, `ProjectDetail.tsx`, `ExportPage.tsx` | the toggle | 16 |
| `frontend/src/components/calculator/ElementalBenchmarkPanel.tsx` (new) + test, `ConversionCostsPage.tsx`, `DueDiligencePage.tsx` (source records) | the panel, the reconciliation UI | 17 |
| `frontend/src/lib/export-investment-memo.ts`, `report-provenance.ts`, `export-pdf.ts`, `programme-months.ts`, `sensitivity-format.ts`, `ProjectDetail.tsx`, `InvestorSummaryPage.tsx`, `ScenariosPage.tsx`, `AppraisalSummaryPage.tsx` + tests | memo §12C, provenance rows, the four corrections | 18 |
| `docs/financial-model/*.md`, `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`, `README.md`, `docs/data-sources-and-licensing.md` (new), `docs/reviews/2026-08-30-release-17-implementation-report.md` (new) | docs | 19 |

---

### Task 1: calc 2.19.0 and the result field

**Files:** `finance-types.ts` (`CALC_VERSION`, `AppraisalResultV2.elemental_benchmark: ElementalBenchmarkResult | null`), `types.py` (`CALC_VERSION`), `metrics.ts`/`metrics.py` (`elemental_benchmark: null` until Task 4 wires the engine), `tests/test_financial_model_types.py` (`test_calc_version_is_2_19_0` + the missing v16 dispatch test backfilled), `spec §1.6` status line and clause placeholder, 15 fixtures do **not** change (the null field is not pinned).

- [ ] Failing tests: calc pin in both languages; `'elemental_benchmark' in m && m.elemental_benchmark === null` on fixture A.
- [ ] Implement; spec line 3 `2.19.0`; §1.6 changelog bullet.
- [ ] Gates; commit `feat(r17): calc 2.19.0 - the result gains elemental_benchmark (null everywhere until Task 4) and a shape change is a version change`.

### Task 2: area units

**Files:** `frontend/src/lib/area-units.ts`, `app/financial_model/area_units.py`, tests both sides.

**Interfaces:** `SQFT_PER_SQM = 10.7639104167097`; `sqmToSqft`, `sqftToSqm`, `ratePerSqmToPerSqft`, `ratePerSqftToPerSqm`, `AreaUnit = 'metric' | 'imperial'`, `formatAreaValue(sqm, unit, dp)`, `formatRatePence(pencePerSqm, unit)`, `areaUnitLabel(unit)` (`'m²'`/`'ft²'`), `rateUnitLabel(unit)` (`'£/m²'`/`'£/ft²'`), `formatAreaBoth(sqm, unit)` (primary + secondary).

- [ ] Tests: exact 620 → 6673.62445835… (toBeCloseTo 8 dp), 1 ft² → 0.09290304 m², rate 125,000 p/m² → 11,612.8125… p/ft², `620 × 125000` vs `sqmToSqft(620) × ratePerSqmToPerSqft(125000)` equal to within 1e-6 pence before rounding and equal after `Math.round`; 1,000 alternating toggles on a display value leave the canonical unchanged (the canonical never passes through the converter); no `toBe` on floats.
- [ ] Python twin with `math.isclose`.
- [ ] Gates; commit.

### Task 3: inputs v17 — types, migration, defaults, entry-point cutover, identity gate

**Files:** `finance-types.ts` (`CalculatorInputsV17`, `SchemeElementalBenchmark` & friends imported from `elemental-benchmark.ts` types — declare the *input* types in `elemental-benchmark.ts` in this task, the engine in Task 4), `types.py` (pydantic twins, `parse_calculator_inputs` branch), `cost-plan.ts`/`types.py` (`CostPackage.benchmark_origin`), `due-diligence.ts`/`types.py` (`source_records`, `source_resolutions` on `DueDiligenceInputs`), `migrate.ts`/`migrate.py` (`isV17`, `migrateV16toV17`, `RECOGNISED_INPUTS_VERSIONS_V17`, `migrateInputsToV17` with the merge branch gaining `elemental_benchmark`), `conversion-defaults.ts` (`defaultCalculatorInputsV17`), `index.ts`, every page's prop type, `ConversionCalculator.tsx`, `ExportPage.tsx`, `app/api/app.py` (`migrate_inputs_to_v17`), `entry-point-guard` both sides (`NEWEST 17`), `__fixtures__/*-docs.ts` + `memo-fixtures.ts`, `tests/test_migrate_v17.py`, `migrate.test.ts` two blocks, `page-status.ts` ownership.

- [ ] Failing tests first: shape block (Q raw → v17 carries `elemental_benchmark: null`, every package `benchmark_origin: null`, `due_diligence.source_records: []`; `isV17` refuses relabels; merge branch preserves a saved benchmark block; refusals with exact messages), identity gate (corpus, sensitivity F/U/Y/Z, three validation properties with both lists empty).
- [ ] Python twin, same test names.
- [ ] Implement; §1.6 clause `17 (**inputs v17**) = calc 2.19.0+ (adds the nullable elemental_benchmark block, CostPackage.benchmark_origin and the due-diligence source records — §27.1)`.
- [ ] Gates; commit.

### Task 4: the benchmark engine

**Files:** `elemental-benchmark.ts` / `elemental_benchmark.py`: `ELEMENT_CATALOGUE` (39 rows, §4.2), `ELEMENT_CODES`, `PROVIDER_LABEL`, `MEASUREMENT_BASES`, `ORIGINAL_UNITS`, `UNIT_FOR_BASIS`, `DEFAULT_THRESHOLDS`, `computeElementalBenchmark(inputs, costPlan: CostPlanResult, areaSqm): ElementalBenchmarkResult | null`, `benchmarkFlags(result): ModelFlag[]`, `benchmarkContentHash(set)` (TS: a small sha256 — use the Web Crypto-free deterministic implementation already available? None exists in TS; add `frontend/src/lib/sha256.ts`, a 60-line pure implementation, tested against known vectors and against Python's hashlib on the fixture set). `metrics.ts`/`metrics.py` wire it after `due_diligence`. `finance-types.ts` `FlagCode` gains `benchmark_warning` and `benchmark_material_variance`.

- [ ] Failing tests from the spec's worked figures: the 620 m² × £1,250 area invariant across `gbp_per_sqm`/`gbp_per_sqft`; factor 126/120 = 1.05; location 95 → 0.95; adjusted −10%; `benchmark_amount_pence` one rounding; percentage row on the subtotal; headline vs detailed `qs_amount`; `forward_inflated_benchmark_amount_pence` from Z's package factor; each warning code fires and is silent; `enters_tdc === false`; the advisory proof (metrics equal with the block nulled); `currentisation_method 'none'` when an index is missing; zero/negative index handled by Task 5's validation but the engine degrades to `null` factor without throwing.
- [ ] Python twin, then the parity pin: the fixture-shaped document produces identical `asdict` / JSON on both sides (a JSON dump compared in `test_financial_model_fixtures.py` after Task 9).
- [ ] Gates; commit.

### Task 5: validation rules 1–15

Both validators, same message text, keyed `elemental_benchmark.*` / `cost_plan.packages[i].benchmark_origin` / `due_diligence.source_records[i].*`; the §9.6 message-drift guard passes. Tests: each rule present-and-absent, both languages, the Python boundary variants where pydantic refuses first (documented per the R16b precedent).

### Task 6: source records and reconciliation in the engine

`due-diligence.ts`/`due_diligence.py`: `SourceEvidenceRecord`, `SourceConflictResolution`, `deriveSourceConflicts(records, resolutions)` → `DdSourceFieldConflict[] { field, values: [{record_id, kind, value}], resolved: boolean, resolution_id }`; result gains `source_field_conflicts`; flag `source_conflict_unresolved` (red) per unresolved field; `DueDiligenceResult.totals.unresolved_source_conflicts`. The FINAL gate: `dueDiligenceGateFor` additionally requires zero unresolved field conflicts (both provenance twins; `draft_reason` unchanged in shape). Tests: two records with `office` vs `retail…` conflict; area within 5% no conflict; a resolution with blank evidence does not resolve; the gate flips.

### Task 7: apply-to-cost-plan transform

`apply-benchmark.ts` (frontend-only document transform; Python does not need it — it is a UI edit, and the engine prices the result): `planApplication(inputs, elementCodes, actor, now): { preview: {creates:[…], replaces:[…], blocked:[{package, reason}]}, refusal: string | null }` and `applyBenchmark(inputs, plan): CalculatorInputsV17`. Rules of design decision 4; the seam check (`qs.base_date` must equal `currentisation_date` or `qs` null → seeded); headline mode refused; `applications[]` entry with `previous_cost_plan`. Tests: creates draft packages with origin and `price_basis 'estimate'`; re-apply replaces not duplicates; fixed-price / contract-sum / non-origin packages untouched and listed as blocked; refusal message on base-date mismatch; the single-forward-step guard (applied package's `inflation_pence` equals §24.3's from the currentisation date, and seeding the set's base date instead is refused).

### Task 8: `sha256.ts` + hash parity

If not already done in Task 4: pure TS SHA-256 with NIST vectors; `benchmarkContentHash` parity against Python on the fixture set (pin the hex in both tests).

### Task 9: fixture AB and the import fixtures

`ab-elemental-benchmark.json` per spec §15, hand-derived in `test-cases.md` §27 **before** running either engine; both `EXPECTED_FIXTURE_STEMS`; `fixtures/benchmarks/*`; governance §2.2 rows for X, Y, Z, AA, AB.

### Task 10: Alembic 008

Tables per spec §9/§10/§11; ORM classes; `test_alembic_migrations.py` chain list `["008", …]`; `test_orm_tables.py`; downgrade functional on SQLite (batch mode for the added columns).

### Task 11: authentication

`app/auth/passwords.py` (PBKDF2), `tokens.py` (HMAC token `base64url(user_id.issued.expires).sig`), `deps.py` (`CurrentUser`, `require_roles(...)`, `OptionalUser`), `cli.py` (`create-user`), settings (`auth_token_ttl_seconds`, `admin_bootstrap_email/password`, `environment`), routes `/auth/login|me|logout`, `/users`; bootstrap at lifespan; negative tests: wrong password 401, inactive 401, expired token 401, tampered signature 401, non-admin listing users 403, last-admin demotion 409, default secret in production refuses startup.

### Task 12: authenticated governance

Per spec §10.2–10.6 server side: models drop `created_by`/`actor` (422 if present via `extra='forbid'` on these two request models), `expected_version`/`expected_case_hash`/`idempotency_key` required; `ROLE_TRANSITIONS`; maker-checker; CAS on version; integrity recompute; idempotent replay; events enriched. `provenance.py`/`report-provenance.ts` gain `ROLE_TRANSITIONS`, `canTransition(role, to)`. Rewrite `tests/test_lender_case_governance.py`'s fixtures to log in as four seeded users (`sponsor`/developer, `broker`, `uw`/underwriter, `cc`/credit_approver, `admin`) and add the six negative tests the brief names. `test_api_endpoints.py` route pins gain the new routes. Spec §21 amended in place with `[R17 — calc 2.19.0]` tags.

### Task 13: the library and index datasets

`app/benchmarks/library.py` (normalise + `content_hash`, validation reuse from the engine's pydantic models), `index_import.py` (CSV/JSON parse, period regex `^\d{4}-(0[1-9]|1[0-2])$`, strictly increasing, unique, finite > 0, the five exact 422 messages), `seed.py` (`python -m app.benchmarks.seed` loads `data/index-datasets/*.json`, idempotent by `(publisher, series_code, dataset_version)`), routers, `GET /benchmark-sets/template.csv`, the derived read (`?currentisation_date&current_index_value`) computed by `elemental_benchmark.py`'s helper. `scripts/ons_opi_to_json.py` (needs `openpyxl` — optional dev tool, documented; the JSON it produced on 30 Aug 2026 is committed). Tests per the spec's guard table.

### Task 14: governed resave and York

`POST /appraisals/{project_id}/resave`, `GET …/versions`, `GET /appraisals/stale`; every PUT writes the pre-save row to `appraisal_versions`; `scripts/york_reconcile.py` (login → resave → repair description via the same narrow rule, for every project row that carries it, printing before/after → PUT the two source records into the document via the ordinary appraisal PUT (an evidence edit, not a financial one; the script asserts every metric identical to the resave's output before it writes) → print the blocker list). Tests: resave keeps metrics identical to a direct `PUT {}`; the version row holds the original v3 snapshot byte-for-byte; a York-shaped v3 row resaves to v17/2.19.0 with `status 'draft'`, `audit_hash` non-empty and `source_conflict_unresolved` raised once the two records are present. Then **run the script against the live database** and record its output in the implementation report.

### Task 15: client auth

`auth.tsx` (`AuthProvider`, `useAuth`, `sessionStorage` token), `LoginPage.tsx`, `api.ts` bearer header + `login/me/logout` + new lender-case request shapes + benchmark/index/resave/versions/stale functions, `App.tsx` route, `LenderCasePage.tsx` per spec §10.6 with its test rewritten (no "Your name"; role-filtered buttons; sends version/hash/key; unavailable state).

### Task 16: the toggle

`area-unit-context.tsx` (`AreaUnitProvider` reading/writing `localStorage['cra.area_unit']` in try/catch, default metric), `AreaUnitToggle.tsx` (two-segment control, `aria-label="Area unit"`), wired on Areas, Unit Mix, Costs, Investor summary, Project detail, Export page (memo option). Every `m²` literal on those pages becomes `areaUnitLabel(unit)` with the secondary unit in a `title`/muted span; inputs in imperial convert on change via `sqftToSqm` (areas to 4 dp). Tests: toggle flips labels; typing 1076.39 ft² stores 100.0000 m²; 1,000 toggles leave `inputs` referentially equal; per-unit/lump-sum rows unaffected.

### Task 17: the panel and the reconciliation UI

`ElementalBenchmarkPanel.tsx` per spec §E: header, element table (unit-aware), summary, actions (Import from library / Import file (JSON/CSV → POST → embed) / Add manual set / Apply selected (confirmation modal listing creates/replaces/blocked and the seam statement) / Export template (CSV download) / Download audit record (JSON of `metrics.elemental_benchmark` + provenance) / Clear), thresholds editor with explanations, the warning banner with the standing sentence. Currentisation helper: pick an index dataset + base period + current period → writes the four index fields and `index_dataset_version`; the annual-% fallback writes `current_index_name = 'assumed: N% p.a.'`. `DueDiligencePage.tsx` gains the source-records table (add record, per-kind claims, narrative excerpt), the conflicts list, and the resolution form. Tests: renders rows from `run.metrics.elemental_benchmark` only; apply confirmation content; refusal states; template download content; source-record add/resolve round trips through `onChange`.

### Task 18: memo, provenance, the four corrections

Memo §12C (spec §12), provenance rows, unit option, methodology sentences, `formatStressSetting` special case, `roeLabel` words, `formatProgrammeMonth` single labeller in the memo (drop `+ 1`; CTC rows), `ProjectDetail`/`InvestorSummary`/`Scenarios`/`AppraisalSummary`/`export-pdf` ROE labels, the PDF/UA sentence. Tests per the guard table; `memo-release-gate` route with fixture AB.

### Task 19: docs and the implementation report

Spec §27 (from design §§4–17 in normative voice), §21 amendments, §13.1 rows, §23.5 amendment, §5.7/§13.5 month note, §1.6; migration-notes title + §20; governance header/§3/§3.1 (R16b and R17 rows)/§9.2 row/§12 PDF-UA note/§2.2 corpus rows; test-cases status + §27; release-plan row + status + deploy note; `docs/data-sources-and-licensing.md`; README sections (API routes, auth, benchmark, unit toggle, data sources); `docs/reviews/2026-08-30-release-17-implementation-report.md` with the completion report's fourteen items.

---

## Self-review against the spec

Spec §4 → Tasks 3, 4, 6; §5 → 2, 16; §6 → 4, 7; §7 → 4; §8 → 4, 5; §9 → 10, 13; §10 → 10, 11, 12, 15; §11 → 14; §12 → 18; §13 → 18; §14 → 3; §15 → 9; §17 → 19; §18 guards → the task each names. Type names used consistently: `SchemeElementalBenchmark`, `ElementalBenchmarkSet`, `ElementalBenchmarkRate`, `SchemeElementalCostSelection`, `BenchmarkOrigin`, `BenchmarkApplication`, `ElementalBenchmarkResult`, `ElementalBenchmarkRow`, `BenchmarkWarning`, `SourceEvidenceRecord`, `SourceConflictResolution`.
