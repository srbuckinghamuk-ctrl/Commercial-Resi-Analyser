# Release 2b live UAT — lender metrics on the real stack

Date: 2026-08-14. Environment: docker compose (frontend :5173, API :8000, postgres 16
`commercial-resi-analyser_postgres_data` — the only real database), running merged `main`
at `afa04b2` (api and frontend containers restarted post-merge; bind mounts pick up main).
Backup taken before any mutation: `backup-commercial_resi-2026-08-14-pre-r2b.sql`
(29,456 bytes, kept beside the 13 Aug backups in `C:\Users\srbuc\Documents`).

Browser-visual checks could not run (Claude-in-Chrome extension not connected this
session, as in R2a) — every check below is API/SQL-verified at the layer that drives the
UI. The visual pass (lender entry card, variance bridge, metric cards, memo PDF as
rendered) is the single open follow-up, carried from R2a's UAT.

## Checklist results

| # | Check | Expected | Observed | Verdict |
|---|-------|----------|----------|---------|
| 1 | Health flag on real DB | `migrations_current: true` (stamped 002 = head) | `GET /health` → `{"status":"ok", …, "migrations_current": true}` | PASS |
| 2 | v2→v3 migration on real York row | bare re-save migrates, status per governance | PUT `{}` → `inputs_version 3`, `calc_version 2.1.0`, status `legacy_unreconciled` → **`draft`** (raw was v2 so `was_v1` false; `report_safe` false keeps it from `reconciled`) — the R1 two-step (migrate-and-flag, then confirm) completed as designed | PASS |
| 3 | New metrics null-discipline without lender block | all lender-basis metrics null, never substituted | `lender_gdv_pence`, `senior_breakeven_pence`, `developer_breakeven_pence` all null (retain_all: no disposal ⇒ break-evens null by design); `cost_to_complete` computed (12 months, no shortfall) | PASS |
| 4 | Live lender valuation round-trip | metrics computed, provenance carried | PUT with `{basis: global_pct, global_value: -10, reason/author/date}` → `lender_gdv_pence 112,500,000` (= 0.9 × dev GDV 125,000,000), variance −12,500,000 (−10.00%), `ltgdv_lender_pct 1.02`; then reverted to `null` → all lender metrics null again; DB row `draft / 3 / 2.1.0` | PASS |
| 5 | Browser-visual pass | banner/cards/PDF as rendered | Pending — extension unavailable; all driving data verified above | OPEN |

## Notes

- The status transition in check 2 is the intended completion of Release 1's two-step
  legacy handling: `legacy_unreconciled` marks the row only until its first
  post-migration save; this save was that step (the row had been re-saved as v2 during
  R2a's UAT). `draft` (not `reconciled`) is correct while `report_safe` is false
  (`requires_confirmation` from the v1 facility migration, senior not repaid under
  retain_all — both unchanged by R2b).
- Check 4's `ltgdv_lender_pct 1.02` reflects the York deal's very small peak debt under
  its migrated `fund_as_required` draw rule — the ratio arithmetic is pinned by fixture
  G's parity tests; the live check verifies wiring, not new arithmetic.
- No defects found in this pass. The R2a recommendation (boot-failure surfacing) is now
  shipped and verified live (check 1).

## Verdict

Release 2b's server path is verified live end-to-end on the real database: v3 migration,
status governance, lender-valuation round-trip with correct arithmetic and reversion,
null-discipline for non-computable metrics, and the migrations health flag. Open item:
the browser-visual pass, to be completed when a Claude-in-Chrome session is available.
