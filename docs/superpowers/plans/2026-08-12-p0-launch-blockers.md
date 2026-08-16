# P0 Launch Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six P0 issues from the second-pass review: Class MA applies repealed law; eligibility answers destroyed on re-run; calculator data-loss paths; production SPA deep-link 404s; API-down states impersonating empty states.

**Architecture:** Backend rules fix in `app/eligibility/criteria.py` with test updates; a typed `ApiError` in the frontend API layer that every durability fix builds on; targeted component fixes in `EligibilityWizard` and `ConversionCalculator`; an SPA-aware static-files class plus JSON API 404s in FastAPI; offline/loading props threaded from `App.tsx` into the four screens that currently lie about failures.

**Tech Stack:** FastAPI + pytest (backend), React 19 + TypeScript + vitest (frontend). Frontend tests run with `npm test` in `frontend/`; backend with `python -m pytest` (or via docker).

## Global Constraints

- Do not commit the pre-existing uncommitted working-tree changes (`frontend/src/lib/export-errors.ts`, `export-errors.test.ts`, `ExportPage.tsx`, `vite.config.ts`) unless a task explicitly modifies them — stage files individually, never `git add -A`.
- Match existing code style: inline styles, no Tailwind classes, existing colour values.
- Keep the API error message format `HTTP {status}: {text}` (export-errors.ts and EligibilityWizard string-match on it until migrated).
- Ruleset version bumps to `gpdo-2026-08.2` when criteria change.

---

### Task 1: Class MA 2024 amendments (backend rules + tests)

**Files:**
- Modify: `app/eligibility/criteria.py`
- Modify: `tests/test_eligibility_engine.py`

**Interfaces:**
- Produces: `FLOOR_AREA_LIMITS` without a `CLASS_MA` entry; `ALL_CRITERIA` without the `vacancy_period` def and with `floor_area_limit` no longer applicable to `CLASS_MA`; `RULESET_VERSION = "gpdo-2026-08.2"`. `detect_pdr_class(UseClass.OFFICE, 1600.0)` returns `PdrClass.CLASS_MA`.

- [ ] **Step 1: Update the tests to the post-March-2024 law** — in `tests/test_eligibility_engine.py`:
  - `test_office_over_1500_sqm_returns_none` → rename `test_office_over_1500_sqm_still_class_ma` asserting `detect_pdr_class(UseClass.OFFICE, floor_area_sqm=1600.0) == PdrClass.CLASS_MA`.
  - In the Class MA criteria-list test: assert `"vacancy_period" not in keys` and `"floor_area_limit" not in keys`; keep `class_e_use_period` assertions.
  - Remove `vacancy_period`/`floor_area_limit` keys from Class MA override dicts (`ALL_PASS_OVERRIDES` etc.); adjust any pending-count assertions accordingly.
  - Add `test_class_ma_has_no_floor_area_cap` asserting `PdrClass.CLASS_MA not in FLOOR_AREA_LIMITS`.
- [ ] **Step 2: Run to verify failures** — `python -m pytest tests/test_eligibility_engine.py -x -q` — expect failures on the new assertions.
- [ ] **Step 3: Implement** — in `app/eligibility/criteria.py`: delete the `PdrClass.CLASS_MA: 1500.0` entry (comment why: GPDO Amendment Order 2024, SI 2024/141, removed the 1,500 m² cap and vacancy test from 5 March 2024); delete the `vacancy_period` CriterionDef; remove `PdrClass.CLASS_MA` from `floor_area_limit.applicable_classes`; bump `RULESET_VERSION` to `"gpdo-2026-08.2"`. Remove the now-dead `vacancy_period` entry from `NEXT_STEPS` in `engine.py` only if tests demand (leave otherwise — harmless).
- [ ] **Step 4: Full backend test run** — `python -m pytest -q` — all pass.
- [ ] **Step 5: Commit** — `git add app/eligibility/criteria.py tests/test_eligibility_engine.py && git commit -m "fix: apply GPDO 2024 amendments to Class MA (remove 1,500 sqm cap and vacancy test)"`

### Task 2: Surface ruleset version + assessment date in the verdict UI

**Files:**
- Modify: `frontend/src/types.ts` (EligibilityAssessment: add `ruleset_version: string | null`)
- Modify: `frontend/src/components/EligibilityVerdict.tsx`

**Interfaces:**
- Consumes: backend `EligibilityAssessment.ruleset_version` (already returned by the API).
- Produces: verdict banner sub-line `Ruleset {ruleset_version} · assessed {formatted updated_at}`.

- [ ] **Step 1:** Add `ruleset_version: string | null;` to `EligibilityAssessment` in `types.ts`.
- [ ] **Step 2:** In `EligibilityVerdict.tsx`, under the counts line add:
```tsx
<div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
  {assessment.ruleset_version && `Ruleset ${assessment.ruleset_version} · `}
  assessed {new Date(assessment.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
</div>
```
- [ ] **Step 3:** `cd frontend && npx tsc -b && npm test` — clean.
- [ ] **Step 4: Commit** — `git commit -m "feat: show ruleset version and assessment date on verdict banner"`

### Task 3: Typed ApiError in the frontend API layer

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/api.test.ts`
- Modify: `frontend/src/lib/export-errors.ts` (use status, keep string fallback)

**Interfaces:**
- Produces: `export class ApiError extends Error { readonly status: number }` and `export function isNotFound(e: unknown): boolean` from `lib/api.ts`. Message stays `HTTP {status}: {text}`.

- [ ] **Step 1: Failing tests** in `api.test.ts`: a 404 response rejects with `ApiError` where `status === 404` and `isNotFound(err) === true`; a 500 rejects with `status === 500`, `isNotFound === false`; a 200 with non-JSON body rejects with a message mentioning `non-JSON`.
- [ ] **Step 2:** Run `npm test` — new tests fail.
- [ ] **Step 3: Implement** in `api.ts`:
```ts
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body}`);
    this.name = 'ApiError';
    this.status = status;
  }
}
export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError ? e.status === 404
    : e instanceof Error && e.message.startsWith('HTTP 404');
}
```
`request()` throws `new ApiError(response.status, text)`; before `response.json()`, if the `content-type` header lacks `json`, throw `new Error('Unexpected non-JSON response from the API')`. Update `deleteProject` to use `ApiError` too. In `export-errors.ts`, accept `ApiError` status (keep the string match as fallback). In `EligibilityWizard.tsx`, replace the local `isNotFound` with the import.
- [ ] **Step 4:** `npm test` + `npx tsc -b` — clean.
- [ ] **Step 5: Commit** — `git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts frontend/src/lib/export-errors.ts frontend/src/components/EligibilityWizard.tsx && git commit -m "feat: typed ApiError with status; JSON guard on API responses"`

### Task 4: Eligibility answer durability

**Files:**
- Create: `frontend/src/lib/eligibility-overrides.ts` + `eligibility-overrides.test.ts`
- Modify: `frontend/src/components/EligibilityWizard.tsx`

**Interfaces:**
- Produces: `overridesFromAssessment(a: EligibilityAssessment): Record<string, boolean>` — extracts `{key: passed}` for criteria with `source === 'user'` and `passed !== null`.

- [ ] **Step 1: Failing test** — `eligibility-overrides.test.ts`: given an assessment whose criteria include `{key:'vacancy', source:'user', passed:true}`, `{key:'auto1', source:'auto', passed:true}`, `{key:'pend', source:'manual', passed:null}` → returns `{vacancy:true}`.
- [ ] **Step 2:** `npm test` — fails.
- [ ] **Step 3: Implement** the helper (filter + reduce).
- [ ] **Step 4: Wire into the wizard** (`EligibilityWizard.tsx`):
  - On successful `getEligibility` load: `setManualOverrides(overridesFromAssessment(existing))`.
  - Add `const runSeq = useRef(0)`; in both `handleRun` and `handleOverride`, capture `const seq = ++runSeq.current` and only `setAssessment` / clear flags when `seq === runSeq.current` (stale responses discarded).
  - `handleOverride` computes the next map via functional update and sends **that** map: build `updated` from the previous state exactly as now (it already spreads `manualOverrides` — now correctly seeded).
  - After every successful run, re-seed overrides from the response: `setManualOverrides(overridesFromAssessment(result.assessment))` (keeps client and stored state identical).
- [ ] **Step 5:** `npm test` + `npx tsc -b`; live check: answer a criterion, reload page, re-run — answer survives.
- [ ] **Step 6: Commit** — `git commit -m "fix: eligibility answers survive reloads and re-runs; stale responses discarded"`

### Task 5: Calculator data-loss fixes

**Files:**
- Modify: `frontend/src/components/ConversionCalculator.tssx` → (`.tsx`)

**Interfaces:**
- Consumes: `isNotFound` from `lib/api.ts` (Task 3).

- [ ] **Step 1:** Load-state machine: add `const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')`. In the load effect: on success or 404 → `'ready'`; on other errors → `'error'` (do NOT fall through to defaults silently).
- [ ] **Step 2:** Key the reset on the id, not the object: keep the latest project in a ref (`projectRef.current = project` each render); effect deps `[project?.id]`; inside, read from the ref. Unsaved inputs now survive background refetches.
- [ ] **Step 3:** Error UI: when `loadState === 'error'`, render (in place of page content) an alert `Could not load the saved appraisal — your saved data is untouched.` with a Retry button re-running the load; the footer Save button is `disabled` while `loadState !== 'ready'` (prevents the destructive create-over-existing upsert).
- [ ] **Step 4:** Autosave from first edit: change the autosave gate from `if (!dirty || !savedId || saving)` to `if (!dirty || saving || loadState !== 'ready')`. (`handleSave` already creates when `savedId` is null.) Mark `setDirty(false)` only when the payload sent matches current inputs: capture `const sent = inputs` before await; after await, only `setDirty(false)` if `sent === inputsRef.current` (add `inputsRef` updated on render) — edits made mid-save stay dirty.
- [ ] **Step 5:** `npx tsc -b && npm test`; live check: edit without saving, wait 3s → autosaved; stop API, trigger refetch, inputs survive.
- [ ] **Step 6: Commit** — `git commit -m "fix: calculator no longer loses edits on refetch or overwrites saved appraisals on transient errors; autosave from first edit"`

### Task 6: Production SPA serving + JSON API 404s (backend)

**Files:**
- Modify: `app/api/app.py`
- Create: `tests/test_spa_serving.py`

**Interfaces:**
- Produces: `SpaStaticFiles(StaticFiles)` — 404s under the mount fall back to `index.html`, except paths beginning `api/` which re-raise; a catch-all `/api/{rest:path}` route returning JSON 404 `{"detail": "Not found"}`.

- [ ] **Step 1: Failing tests** (`tests/test_spa_serving.py`): build a tiny FastAPI app in-test with one real API route, the catch-all, and `SpaStaticFiles` mounted on a `tmp_path` dist containing `index.html`; assert: `GET /projects/abc` → 200 + index.html body; `GET /api/v1/nope` → 404 with JSON content-type; `GET /assets/missing.js` → falls back to index (SPA convention) or 404 for `api/`.
- [ ] **Step 2:** Run — fails (class doesn't exist).
- [ ] **Step 3: Implement** in `app.py`:
```python
from starlette.exceptions import HTTPException as StarletteHTTPException

class SpaStaticFiles(StaticFiles):
    """Serve the built SPA with a history-API fallback to index.html."""
    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except (HTTPException, StarletteHTTPException) as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise
```
Register before the mount: `@app.get("/api/{rest:path}")` (and same for other methods via `app.api_route(..., methods=[...])`) raising `HTTPException(404, "Not found")`; mount `SpaStaticFiles(directory=..., html=True)`.
- [ ] **Step 4:** `python -m pytest tests/test_spa_serving.py -q` then full suite.
- [ ] **Step 5: Commit** — `git commit -m "fix: SPA history-API fallback and JSON 404s for unmatched API routes"`

### Task 7: Error states stop impersonating empty states

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/components/Pipeline.tsx`, `frontend/src/components/PropertyMap.tsx`, `frontend/src/components/ExportPage.tsx`

**Interfaces:**
- Produces: `backendOffline: boolean` and (map/export) `loading: boolean` props threaded from `App`.

- [ ] **Step 1:** `App.tsx`: pass `backendOffline` to `Pipeline` and `ProjectRoute`; pass `loading`+`backendOffline` to `PropertyMap` and `ExportPage`. Fix the creation flash: `handleProjectCreated` does `setProjects((prev) => [project, ...prev])` before navigating (keep the background `loadProjects()`).
- [ ] **Step 2:** `Pipeline.tsx`: new prop `backendOffline`; when `backendOffline && projects.length === 0`, render an error state (heading `Can't reach the server`, body `Your projects are safe — this is a connection problem, not data loss. Retrying automatically…`, button `Retry now` → `onProjectsChanged()`), instead of either the hero or the board.
- [ ] **Step 3:** `ProjectRoute` in `App.tsx`: when `!project && backendOffline`, show the same connection message + retry instead of `Project not found`.
- [ ] **Step 4:** `ExportPage.tsx`: when `loading` → `Loading projects…`; when `backendOffline && projects.length === 0` → connection message; only show `Nothing to export yet` when genuinely loaded-and-empty (and make “New Project page” a `<Link to="/new">`).
- [ ] **Step 5:** `PropertyMap.tsx`: same guard for its `No projects have postcodes yet` hint; when offline show `Can't reach the server — map data unavailable`.
- [ ] **Step 6:** `npx tsc -b && npm test`; live check with API stopped: board shows connection error, project deep link shows connection error, export/map likewise; restart API → recovers.
- [ ] **Step 7: Commit** — `git commit -m "fix: distinguish connection failures from empty states across board, detail, map and export"`

## Self-review notes

- Task 5 file name typo in header corrected in Files line at execution time (`ConversionCalculator.tsx`).
- Type consistency: `ApiError`/`isNotFound` names used in Tasks 3–5 match; `overridesFromAssessment` name matches between create and wire steps.
- Spec coverage: P0 table rows 1–6 map to Tasks 1(+2), 4, 5, 5, 6, 7 respectively; ruleset-version display (row 1 “show ruleset version in UI/exports”) is Task 2 (UI; export stamping is P1 scope).
