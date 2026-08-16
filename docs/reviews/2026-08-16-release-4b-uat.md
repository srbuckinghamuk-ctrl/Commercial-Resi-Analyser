# Release 4b — UAT record

**Date:** 16 August 2026
**Build under test:** branch `release-4b-ui-memo` at `11ef103`, cut from `main` at `d7ad919`
**Environment:** Docker compose stack on localhost. `docker restart commercial-resi-analyser-frontend-1` run before testing — Windows bind mounts do not propagate inotify, so the container otherwise serves a stale Vite module graph.
**Subject project:** `da471fca-3901-4c35-9027-2a5c08b2d493` — 9 & 9A Stonegate, York. Chosen because it carries a saved **inputs v3** snapshot (5 units, 12-month term, £527,437 committed net facility), so the page is exercised through the v3→v4 migration path rather than on a v4-native document.

Screenshots: `docs/reviews/assets/2026-08-16-release-4b/`.

**Baseline for the §12.5 identity checks**, read off page 7 (Appraisal) before opening page 9: **Profit on Cost 63.42%**, **Profit £485,094**.

---

## Checklist

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Tab bar reads `… 8. Scenarios │ 9. Sensitivity │ 10. Exit │ 11. Risk │ 12. Deal Spider │ 13. Investor` | **PASS** | `01-page9-tornado.jpg` |
| 2 | Tornado renders four bars, GDV first, base-profit centre line on each | **PASS** | `01-page9-tornado.jpg` — GDV £250,000 › Construction cost £55,000 › Timeline £455 › Interest rate £227 |
| 3 | Two-way matrix renders 5 × 5 with `Cost` row and `GDV` column captions | **PASS** | `01-page9-tornado.jpg` |
| 4 | `(Cost +0%, GDV +0%)` cell is emboldened and equals the Appraisal page's Profit on Cost (spec §12.5) | **PASS** | Cell reads **63.4%**, emboldened, against the page-7 baseline of 63.42%. Tornado header likewise states base profit **£485,094**, matching page 7 exactly. |
| 5 | Metric selector switches all six fields; money renders as currency, percentages as percentages | **PASS** | `02-metric-peak-debt.jpg` — all six options present; Peak Debt renders `£11,424` |
| 6 | A cell breaching a covenant shows its `[FE]` / `[FG]` / `[NR]` code in red | **PASS** | `[NR]` (senior debt not repaid within term) on all 25 cells of this deal, rendered red |
| 7 | Editing **Column steps** to `-20, -10, 0` re-renders three columns immediately | **PASS** | Columns became `GDV -20% / -10% / +0%`; five rows and the tornado unchanged, as intended |
| 8 | Setting both levers to GDV shows the "must use different levers" panel and no matrix | **PASS** | `04-same-lever-guard.jpg` — "The row and column axes must use different levers." Matrix **and** tornado both hidden. |
| 9 | **Reset to defaults** restores the 5 × 5 grid | **PASS** | Axes returned to `-5, 0, 5, 10, 15` / `-15, -10, -5, 0, 5` |
| 10 | Navigating to page 10 and back to page 9 shows spec defaults — the editor is not persisted | **PASS** | Edited columns to `-30, 0, 30`, navigated to Exit and back: axes **and** the metric selector both returned to defaults (the component remounts, discarding all view state) |
| 11 | Nothing entered `inputs` | **PASS — method adapted, see below** | `05-defaults-after-reload.jpg` |
| 12 | Memo §10 has the tornado above the two matrices, and the matrices' numbers are unchanged from `main` | **PASS — split evidence, see below** | Programmatic PDF probe |
| 13 | A timeline step exceeding the deal's term is refused | **PASS** | `03-term-guard.jpg` — "Every timeline step must leave at least one month of term (this deal runs 12 months)." Matrix and tornado both hidden; editor stays on screen above the panel. |

**Defects found: none.** One pre-existing engine behaviour was surfaced — recorded below, not a Release 4b defect.

---

## Deviations from the planned method

**Item 11 — reload substituted for save.** The plan's step was to save the appraisal after editing the axes, then reload. Saving would have migrated this project's stored **v3** snapshot to v4 permanently, which is a real and effectively irreversible change to live project data that the release does not require. A full browser reload was run instead: after editing Column steps to `-25, 0` and reloading, page 9 returned the specification defaults (`05-defaults-after-reload.jpg`).

The claim is not weakened by the substitution. `SensitivityPage` takes exactly one prop, `inputs`, and has no `onChange` — writing to the inputs document is structurally impossible, not merely avoided. That is additionally asserted by the unit test *"never mutates the inputs document"*, which snapshots the inputs object, drives every editor control, and compares.

**Item 12 — split into two pieces of evidence.**

*"Unchanged from `main`"* is discharged by the Task 1 regression pin rather than by diffing two PDFs. The pin asserts all 25 cells and the axis captions as exact literals captured from the pre-refactor build, and it passed **unedited** when Task 2 reimplemented the function on the engine. That is a stronger and less noisy comparison than extracting text from two PDF byte streams. A comparison worktree of `main` at `cac6dcd` was created for a second PDF, then judged redundant and removed.

*"§10 renders correctly"* was verified by generating the memo programmatically for fixture F and inspecting the output:

```
blob bytes: 195349          pdf pages: 12
'Sensitivity & Downside'            present
'Single-Lever Sensitivity (Tornado)' present   ('Swing' column header present)
'Two-Way Sensitivity Matrix'        present
tornado order:  GDV > Construction cost > Timeline > Interest rate
tornado ranges: -10% to +10% | -10% to +10% | -3 to +3 months | -1.0 to +1.0 pp
base cells:     poc 24.4%  ltgdv 48.8%   (engine: 24.4 / 48.84 — §12.5 holds)
first poc row:  Cost -5%   8.6% 14.9% 21.2% 27.4% 33.6%
last poc row:   Cost +15%  -1.0% [FG] 4.7% [FG] 10.5% [FG] 16.2% [FG] 21.9% [FG]
```

The printed rows match the Task 1 pinned literals exactly, so the PDF prints what the pin asserts. The document paginates to 12 pages with no overflow, confirming the third table did not push §10 past a page footer.

Generating the memo this way also avoided triggering a browser file download.

---

## Observation — peak debt does not respond to the cost lever

Selecting **Peak Debt** on this project renders `£11,424` in all 25 cells while Profit on Cost varies correctly across the same grid (`02-metric-peak-debt.jpg`). This was investigated rather than accepted:

```
cost  -5%: peak_debt=1142430  tdc=75115630  profit=49884370
cost   0%: peak_debt=1142430  tdc=76490630  profit=48509370
cost  +5%: peak_debt=1142430  tdc=77865630  profit=47134370
cost +10%: peak_debt=1142430  tdc=79240630  profit=45759370
cost +15%: peak_debt=1142430  tdc=80615630  profit=44384370
```

`runAppraisal` itself returns the identical `peak_debt_pence` at every step, while `total_development_cost_pence` and `profit_pence` both move correctly. **The page is a faithful mirror of the engine — this is not an R4b defect**, and it cannot be one: the release changes no calculation. Had the matrix been mis-wired, Profit on Cost would have been constant too, and it is not.

Whether the underlying behaviour is correct is a separate question. This project has `development_cost_advance_pct: 100` with `equity_draw_rule: fund_as_required`, so it is plausible that equity absorbs the additional cost and the debt draw genuinely does not move. It is recorded here because **the Sensitivity page is the first surface in the product that makes this visible**, which is precisely what a UAT is for. Carried to the R5 list for confirmation against the specification.

---

## Gates at time of UAT

| Gate | Result |
|---|---|
| `npx vitest run` | **827 passed** (44 files) — baseline 776 + 51 new (13 UAT-time, +14 from the final fix wave) |
| `python -m pytest -q` | **750 passed** — unchanged, as required |
| `npx tsc -b` | clean |
| `npx eslint .` | clean |
| `npm run build` | built in 2.65s |
| Scope check | nothing changed outside `frontend/` and `docs/` |
