# Release 3b UAT — live browser pass (calc 2.3.0)

Date: 2026-08-15. Branch merged to local `main` at `3c32239` before this pass
(fast-forward from `33eba7b`; the R3b worktree branch was deleted after the
merged tree re-verified green). Design gate: `docs/superpowers/specs/2026-08-14-release-3-design.md`
§5.3 — "live browser UAT on the real York row with a dated review doc +
screenshots under `docs/reviews/`, and `/health` `migrations_current` verified".
Implementation report: `docs/reviews/2026-08-15-release-3b-implementation-report.md`.

## Environment

- Docker compose stack, containers `commercial-resi-analyser-{api,frontend,postgres,redis,temporal,temporal-ui}-1`.
- API `http://localhost:8000`, frontend dev server `http://localhost:5173`, Postgres `commercial_resi` on 5432.
- Browser: Chrome via the Claude-in-Chrome extension, viewport 1506×816.
- **Pre-mutation DB backup**: `pg_dump -U postgres commercial_resi` → `backup-pre-r3b-uat-2026-08-15.sql`, **34,922 bytes** (session scratchpad).
- Subject row: project `da471fca-3901-4c35-9027-2a5c08b2d493` — "9 & 9A Stonegate, York, North Yorkshire YO1 8AN"; appraisal `ee9b67f4-7aea-499c-9e5f-e0b8809ded06`.
- Pre-UAT appraisal state captured to JSON for exact restore: `inputs_version 3`, `calc_version 2.1.0`, `status draft`, `route retain_all`, all three v4 blocks null, `committed_net_facility_pence 52,743,740`.

**Operational note (not a defect):** the frontend container had been running 29
hours and Docker-on-Windows bind mounts do not propagate inotify events, so the
Vite dev server was serving a stale module graph (nav still showed the pre-R3b
11-page set). `docker restart commercial-resi-analyser-frontend-1` picked up the
merged code. Worth remembering for future UATs on this stack.

## Checklist

| # | Check | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | `/health` migrations state | `migrations_current: true` | `{"status":"ok",…,"migrations_current":true}` | PASS |
| 2 | Page renumbering (Task 11) | 1–12 with Programme inserted at 5 | `1. Acquisition … 4. Finance, 5. Programme, 6. Cashflow, 7. Appraisal, 8. Scenarios, 9. Exit, 10. Risk, 11. Deal Spider, 12. Investor` | PASS |
| 3 | **v4 hydration fidelity** (Task 2 — the R3a data-loss hazard) | Stored v3 doc migrates to v4 on load with finance terms intact | Finance page shows committed net facility **£527,437.4** = stored `52,743,740p` exactly; funding source Development Finance, 8% p.a. rolled up, legacy "LTV 70%" confirmation banner all intact. No v1-fallback garbling. | PASS |
| 4 | Programme page, auto-window state | Explanation + seed button + engine-sourced spend preview | "Auto windows: straight-line construction over months 1–10, professional/statutory over the first half — spec §6"; preview shows construction £27,500 × months 1–10, professional £5,600 × 1–5, statutory £400 × 1–5 + £480 prior-approval at month 0 — exactly §6 for a 12-month term | PASS |
| 5 | Seeding an explicit programme is identity-preserving | Seeded windows reproduce the auto schedule | Seed produced construction {1, 10}, professional/statutory {1, 5}, all straight-line; spend preview **unchanged** | PASS |
| 6 | Spend curve dispatch (§6.1) | s_curve = raised cosine, hand-checkable | Construction switched to S-curve → `£6,730 / £19,531 / £30,420 / £38,331 / £42,490 / £42,490 …`; verified against `W(k) = (1 − cos(πk/10))/2` to the penny (k=1: 6,729.6→6,730; k=2: 19,530.5→19,531 half-up; symmetric from k=5) | PASS |
| 7 | `anchor_month` calendar labels (display-only) | Month N → calendar, year rolls | Anchor `2026-10` → `Oct 2026, Nov 2026, Dec 2026, **Jan 2027**, Feb 2027 …`; prior-approval fee still at month 0 | PASS |
| 8 | Cashflow page programme-awareness (Task 13) | Note reflects explicit programme; labels calendar-dated | "Explicit dated programme (spec §6.1); disposal in month 11; see calculation specification §4.4–§6.1"; table + peak-debt KPI both calendar-labelled ("£11,424 (Sep 2027)") | PASS |
| 9 | Exit page route gating — `retain_all` | Refinance shown, phasing hidden | REFINANCE section with "Add refinance"; no phasing section | PASS |
| 10 | Refinance seed values (Task 12) | month = term−1, value = retained capital value, LTV 65 | Month **11**, investment value **£1,250,000** (5 units × £250,000), LTV **65**, fees 0; net proceeds preview **£812,500** = 1,250,000 × 65% | PASS |
| 11 | **§4.5 refinance redeems the facility** | `senior_outstanding_at_maturity` clears; "Senior repaid" green | Red flag gone from the strip; chip green | PASS |
| 12 | **§3.12 correction live** (Task 8 fix round) | Profit keeps retained *valuation* + unrealised label; refinance cash does NOT enter profit | Banner: "Profit includes £1,250,000 of unrealised value from retained units — not yet cash."; profit £479,819 (not inflated by the £812,500 refinance) | PASS |
| 13 | **§3.17 IRR gains a terminal flow for retained exits** (design §4.2) | Previously `n/a` for retain_all; now real | IRR (annual) **7.65%**, equity multiple **1.06x** | PASS |
| 14 | Break-evens on a no-sale deal | Both `n/a` (no disposal, no gross sales) | Senior break-even n/a, developer break-even n/a | PASS |
| 15 | **Server persistence of v4 blocks** | Save stores v4 with all blocks; authoritative engine stamps 2.3.0 | `inputs_version 4`, `calc_version **2.3.0**`, programme (anchor + s_curve) and refinance both round-tripped; facility unchanged | PASS |
| 16 | **Cross-engine parity on a live document** | Python (authoritative) == TS (UI) | IRR 7.65 == 7.65; profit 47,981,933p == £479,819; TDC 77,018,067p == £770,181; peak debt 1,142,430p == £11,424; equity multiple 1.06 == 1.06x; construction 27,500,200p == £275,002; both break-evens null == n/a; flags `[requires_confirmation]` only | PASS |
| 17 | **Reload round-trip of a v4 doc** (the R3a hazard scenario) | Blocks survive a full page reload | After reload: anchor October, construction {1, 10, S-curve}, professional/statutory {1, 5}, refinance {11, £1,250,000, 65%} all intact | PASS |
| 18 | Route switch clears orphaned blocks (final-review Important #3) | retain_all → sell_all clears refinance | Refinance section gone, phasing section appeared, no orphaned block | PASS |
| 19 | Sales-phasing editor (Task 12) | Seeds single 100% tranche at term−1; Σ badge; add/edit | Seeded {month 11, 100%}, Σ neutral; "Add tranche" appended; Σ turned **red at 60%**, back to neutral at 100% | PASS |
| 20 | **§4.4.1 tranche split + pro-rata costs, live** | 60/40 of £1,250,000 with pro-rata agent/legal and final-tranche residue | m9 net **£737,850** = 750,000 − 11,250 agent − 900 legal; m11 net **£491,900** = 500,000 − 7,500 − 600 (residues); total receipts £1,229,750 = 1,250,000 − 18,750 − 1,500 | PASS |
| 21 | **§4.4.1 sweep + fee-once** | First tranche redeems; fee charged once | m9 (Jul 2027): repayment £11,273, closing **£0**, distribution £721,302; m11: repayment **£0**, whole £491,900 distributes; total repayments £16,548 = principal + the single 1% exit fee | PASS |
| 22 | Exit page route gating — `blended` | Both sections shown | Sales phasing **and** refinance both rendered | PASS |
| 23 | Refinance seed on a blend | value = retained portion only | 3 units sold / 2 retained → investment value seeded **£500,000** (2 × £250,000) | PASS |
| 24 | **Conditional "Refi proceeds" column** (Task 13) | Appears only when a month has refinance proceeds | Column rendered between "Receipts (net)" and "Repayment"; m11 shows £325,000 refi + £294,900 receipts = £619,900 distribution | PASS |
| 25 | Cashflow note names all active blocks | programme + tranches + refinance | "Explicit dated programme (spec §6.1); sales tranches in months 9, 11; refinance in month 11; see calculation specification §4.4–§6.1" | PASS |
| 26 | **§5.11 phased fee-reserve solver on a live doc** | Returns a real break-even (post-monotonicity fix) | Python engine returned `senior_breakeven_pence` **2,372,393** (£23,723.93) for the blended phased deal | PASS |
| 27 | **Investment memo PDF** (Task 13) | Generates; carries the new sections | `investment-memo-YO1 8AN (6).pdf`, **219,285 bytes** (pre-R3b build was 210,023). Contains "6. Programme", "Sale Tranches" table, "Redemption Schedule" table, calendar labels (Oct 2026 … Aug 2027), DRAFT watermark on **13** pages | PASS |
| 28 | Memo provenance lines | One per v4 block, calendar-labelled | `Programme: explicit (anchored 2026-10).` · `Sales phasing: 2 tranches (months Jul 2027, Sep 2027).` · `Refinance: modelled (Sep 2027).` — no doubled "month Month" | PASS |
| 29 | Stale memo §10 text removed (final-review Important #4) | "not yet available (Release 2)" must be absent | Zero occurrences in the generated PDF | PASS |
| 30 | Browser console | No errors/warnings | No console messages captured across the session | PASS |
| 31 | **York row restored** | Byte-exact pre-UAT state | `inputs_snapshot` match **True**, `outputs` match **True**, `input_hash`/`outputs_hash` match **True**; `inputs_version 3`, `calc_version 2.1.0`, `status draft`, `route retain_all`, 5 retained units, all three blocks null | PASS |

**31 / 31 PASS. No defects found.**

## Not exercised

- Quick Reports PDFs and the Excel export (unchanged by R3b; covered by their own unit tests).
- `user_defined` spend curve via the UI weights input (covered by engine tests and the invariant matrix; the other three curve kinds were exercised here).
- Validation error surfacing for out-of-range tranche/refinance months (the Σ-badge path was exercised; the engine-level rules are pinned by 9 TS + mirrored Python tests).
- Multi-user/concurrent save behaviour (out of scope for this release).

## Observations (non-blocking, no action taken)

1. **Appraisal Summary peak-debt tile still prints "Month 11"** while the Cashflow page's equivalent tile prints "Sep 2027" for the same figure. Task 13's scope was the Cashflow page and the memo; `AppraisalSummaryPage` was not in scope. Cosmetic label inconsistency, worth a small follow-up.
2. **Memo §6 programme narrative** still says "Peak senior debt … is reached in month 10 of the programme" in prose while the tables alongside it are calendar-labelled — same pre-existing narrative sentence, same follow-up candidate.
3. **`CalculatorErrorBoundary` does not reset until reload** — carried forward from the final whole-branch review as a parked, non-blocking finding (the crash sources it guards were eliminated upstream by the Task-11 clamps and validation; no data loss; reload recovers). Its fallback copy overstates recovery options. Fix candidate: `key={activePage}` reset plus honest copy.

## Conclusion

Release 3b's design §5.3 UAT gate is **met**: the dated programme, phased-sales
sweep, refinance event, declining redemption schedule, §5.11 phased solver, the
v4 persistence round-trip, and the memo extensions all behave correctly against
the real York row, with live cross-engine parity between the TypeScript
interactive engine and the authoritative Python engine. The York row was
restored byte-exactly and `/health` reports `migrations_current: true` after the
pass.

Screenshots: `docs/reviews/assets/2026-08-15-release-3b/`.
