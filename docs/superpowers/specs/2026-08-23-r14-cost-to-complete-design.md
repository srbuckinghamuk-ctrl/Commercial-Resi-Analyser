# Release 14 — Cost-to-complete design

**Date:** 23 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.7 (*"Cost-to-complete is currently an inception forecast. A monitoring case
needs reporting date, original and current budget, certified/paid/committed cost
to date, QS forecast to complete, remaining contingency, debt drawn, cash equity
injected, remaining committed equity and variances. It must reconcile remaining
uses with undrawn facility plus remaining cash equity."*), the carried defect
**C1** in `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`
(§5.10 charges rolled-up interest against the net facility), and spec §16.9's
stated limitation that `lender_eligible` is *"recorded but not wired to the draw
cap (R14)"*. Release-plan row: **R14**.

**Versions:** calc `2.12.0` → `2.13.0`; inputs `v10` → `v11`.
**Specification:** §5.10 is **rewritten** (the "third counter-example"
paragraph becomes a closed-defect record); the calculation specification gains
**§20**; §4.2(b)'s cap base is amended; §16.2, §16.8 and §16.9 are edited from
"recorded, not wired" to "wired"; §13.3's banner table gains the VAT-basis row
the code has carried since R11; §1.6's inputs-version list gains v11.

---

## 1. The problem this release exists to solve

### 1.1 §5.10 reports a shortfall that does not exist

Spec §5.10 (R2, calc 2.1.0) counts future rolled-up interest in *remaining
cost* and only the undrawn **net** facility in *remaining funding*. But rolled-up
interest never consumes the net facility (§4.2): it capitalises against the
**gross** facility's headroom, which is the interest reserve. A facility
structured the normal way — net sized to the costs, reserve carved out of the
gross — therefore reports a phantom shortfall equal to its forecast interest.
Fixture P (`fixtures/financial-model/p-scotland-levered.json`) pins this at
`cost_to_complete_first_shortfall_month: 1`, `cost_to_complete_max_shortfall_pence: 392483`
against a ledger whose `funding_gap_pence` is 0. R9 found it and deliberately
did not fix it: the correction changes a figure the memo prints on every
levered rolled-up appraisal, so it needs its own hand-derived fixtures and its
own release. That release is this one.

### 1.2 Cost-to-complete is an inception forecast and nothing else

Every figure in §5.10 is read off the ledger the model *forecast* at inception.
Once a scheme is on site a lender's monitoring surveyor asks a different
question — *given what has actually been certified, committed and drawn, do the
remaining sources cover the remaining uses?* — and the model has no place to
put a single actual. The survey for this release found no `reporting_date`, no
cost-to-date, no equity-injected concept anywhere in either engine.

### 1.3 A recorded flag that nothing reads

R10 (calc 2.9.0) gave every cost package a `lender_eligible: bool` and derived
`lender_eligible_base_pence`, and then — on purpose, one live path per release
— left the §4.2(b) draw cap reading the whole construction line. The field has
been captured, displayed and persisted for four releases while the ledger
ignored it. That is R13's `monthly_rent_pence` shape again, and the same rule
applies: a flag that is shown but inert is a defect in waiting.

### 1.4 The three are one piece of work

The monitoring statement's funding side *is* §5.10's funding side — undrawn
facility plus uncontributed cash equity — so it inherits C1 unless C1 is fixed
first, and the draw cap feeds the ledger §5.10 reads. Fixing one and shipping
the others on the old arithmetic would print a monitoring statement with a
phantom shortfall in it.

---

## 2. Scope: the engine axis only

The release plan's R14 row also carried **lender case governance** — a locked
lender snapshot with reviewer, approval state, stale detection and change log
(audit §7.3, §7.10). That is a persistence-and-workflow axis: a new table (one
appraisal per project is a unique index, so a case history cannot be a column),
an API, a Python governance twin that does not exist today, and a change to the
`audit_hash` input set. It shares no arithmetic with anything above. On the
one-new-live-path-per-axis rule, it is split out as **R14b** and scheduled in
the release plan, where a deferral is work rather than a note.

| Release-plan R14 ask | R14 | R14b |
|---|---|---|
| C1 — §5.10 rolled-up interest vs net facility | ✅ | |
| Monitoring cost-to-complete statement | ✅ | |
| `lender_eligible` wired to the draw cap | ✅ | |
| Lender case record, approval, reviewer, stale, change log | | ✅ |

**The split must be recorded in the release plan** by editing the R14 row and
adding an R14b row. R14b remains the release that makes a FINAL document
possible; until it ships, §13.3's "every document is a DRAFT" stays the
intended answer.

---

## 3. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | Scope | Engine axis only; governance → R14b | All four together — two axes, ~25 tasks, one review surface; governance first — leaves the phantom shortfall printing for another release |
| 2 | C1 correction | **Credit gross headroom**: remaining funding gains the unconsumed interest reserve for a rolled-up facility; remaining cost keeps counting future interest | Drop rolled-up interest from remaining cost — equivalent until the reserve is exhausted, then hides a real shortfall; the two are not the same past exhaustion, and the exhausted case is the one a lender cares about |
| 3 | Monitoring architecture | **One statement engine, two modes**: the inception series (corrected) plus, when `monitoring != null`, a single-date statement from entered actuals with the inception ledger as the variance baseline | Re-simulate the ledger from actuals — a second live ledger path; a standalone calculator that ignores the ledger — no variance bridge and no facility reconciliation |
| 4 | Actuals granularity | **Per cost category**: acquisition, construction, professional, statutory, contingency | Per package — couples monitoring to detailed mode and to R15's QS provenance; scheme total — no variance bridge, which the audit asks for by name |
| 5 | Reporting position | `reporting_month` (ledger index) drives the arithmetic; `reporting_date` is a printed label | Deriving the month from a date — the programme is in month offsets with no calendar start (`acquisition_date` is nullable) |
| 6 | Original budget | Read from the inception model, never entered | Entering it — two sources of one fact (§15.4's rule) |
| 7 | Contingency in the statement | Its own category line with drawn-to-date and remaining | Folded into construction — the audit asks for "remaining contingency" as a figure |
| 8 | `lender_eligible` mechanism | A **ratio** on the construction line of monthly uses: `lender_eligible_base_pence / base_build_pence` | Per-package draw timing — needs the per-package programme §16.9 says does not exist; excluding ineligible cost from the *facility* altogether — the flag governs the advance cap, not what the facility may fund (§4.2(b) is a cap, not a source) |
| 9 | Where `monitoring` lives | **Top level**, beside `investment_case` | Under `finance` — the actuals are a scheme fact; under `cost_plan` — the debt and equity actuals are not cost-plan facts |
| 10 | `monitoring = null` | Today's inception-only path, bit-identical | Migrating stored documents to an empty statement — a statement on documents that never asked for one |
| 11 | Shortfall under monitoring | A red flag (`FlagCode`) and a result field | A hard error — the statement exists precisely to report the shortfall |
| 12 | DRAFT gate | Unchanged | Gating FINAL on a clean monitoring statement — a document with no monitoring case is not thereby unsafe |

---

## 4. §5.10 rewritten — the C1 correction

For each month `m` in `1..term`, with `L = model.months[m−1]` (the most recent
ledger month whose draw and contribution have happened by label `m`, the
indexing convention that already holds):

```
remaining_cost(m)    = Σ_{k=m}^{term−1} ( uses[k].acquisition + construction + professional
                                          + statutory + lender_ancillary_fees
                                          + months[k].interest_accrued + months[k].capitalised_fees )
                                                                      — unchanged

remaining_funding(m) = undrawn_net_facility(L)
                     + reserve_headroom(L)                            — NEW
                     + max(0, cash_equity_total − cum_equity_contributed(L))

reserve_headroom(L)  = rolled_up ? max(0, committed_gross − committed_net − cum_interest_capitalised(L)) : 0
```

`committed_gross` and `committed_net` are the ledger's own figures (§2;
`run_ledger` derives gross as `committed_gross_facility_pence` if set, else
`net + interest_reserve_pence`). `cum_interest_capitalised(L)` is the cumulative
`interest_capitalised_pence` through ledger month `m−1`. The engine reports
`reserve_headroom` as a new per-month column `remaining_interest_reserve_headroom_pence`
so the three funding terms are each visible.

**Why this is the right side to correct.** Remaining cost honestly says "finance
to completion is a cost". The defect was that the funding side forgot the
facility component that exists to pay it. Crediting the reserve means: while
the reserve covers the forecast interest the surplus is unaffected by interest
at all (both sides carry it); once forecast interest exceeds the remaining
reserve, the excess is a shortfall — which is §5.8's exhaustion, now a
reconciled number instead of a flag beside a phantom one.

**What does not move.**
- **Serviced interest** (§4.3): `reserve_headroom` is 0. Interest is a
  committed-equity use counted in remaining cost and funded from remaining
  cash equity — identical to today, asserted by a fixture whose serviced
  series is byte-identical before and after.
- **Cash deals**: no facility, both facility terms 0 — identical.
- **A rolled-up facility with `committed_gross_facility_pence == committed_net_facility_pence`**
  (no reserve): `reserve_headroom` is 0 at every `m` — identical, and the
  shortfall it reports is real.

**Fixture P** moves: `cost_to_complete_first_shortfall_month: null`,
`cost_to_complete_max_shortfall_pence: 0`. Its negative controls in
`tests/test_financial_model_fixtures.py` and `golden-fixtures.test.ts` move
with it (the control must still be a value the engine cannot produce — `1` /
`392483` become the controls, i.e. the old wrong answers). The corpus test's
`_SHORTFALL_WITHOUT_GAP_STEMS` / `SHORTFALL_WITHOUT_GAP_STEMS` is emptied and
the `saw_counter_example` guard is **removed** (it would otherwise fail
correctly-forever); the `saw_positive_case` guard stays.

**A new hand-derived fixture `v-exhausted-reserve.json`** (inputs v11): rolled
up, reserve deliberately smaller than the forecast interest, net facility ample.
Under decision 2 it reports a shortfall equal to the interest the reserve cannot
absorb, in the month the series first sees it; under the rejected correction it
would report none. Both engines pin `first_shortfall_month` and
`max_shortfall_pence`, hand-derived in `docs/financial-model/test-cases.md`.

§5.10's "third counter-example" paragraph is rewritten as a closed record:
what the defect was, which release closed it, and the two fixtures that now
pin the correction. The "Known limitation (calc 2.1.0)" paragraph survives
with its first two counter-examples, which are still true.

---

## 5. §4.2(b) amended — the `lender_eligible` draw cap

In `run_ledger` / `runLedger`, the cap base for months ≥ 1 becomes:

```
eligible = round(uses.construction_pence × eligible_construction_ratio)
         + uses.professional_pence + uses.statutory_pence
advance_cap = round(eligible × development_cost_advance_pct / 100)
```

`eligible_construction_ratio` is computed once from the cost plan result:

| Mode | Ratio |
|---|---|
| `headline` | `1` — there are no packages to flag |
| `detailed`, `base_build_pence == 0` | `1` |
| `detailed` | `lender_eligible_base_pence / base_build_pence` (unrounded float; the product is rounded once) |

`base_build_pence` is the package sum before contingency and compliance, which
is the same base `lender_eligible_base_pence` was summed over, so the ratio is
in `[0, 1]` by construction. Contingency and compliance on the construction
line follow the ratio proportionally — stated as a limitation: a per-package
draw profile needs the per-package programme that §16.9 defers.

`uses.vat_pence` stays out of the base (R11 §17.6; that guard is unchanged and
still watched).

The ratio is **reported** on the cost-plan result as
`lender_eligible_ratio` so a reader can see the cap base rather than infer it.

**Guard:** a detailed-mode fixture pair differing only in one package's
`lender_eligible` flag. The ineligible twin must show a strictly smaller
cumulative draw and — with equity held constant — a strictly larger cumulative
`funding_gap_pence`.

**Two existing fixtures are not all-eligible.** Q (`q-detailed-cost-plan.json`,
externals 3,000,000p of a 47,000,000p base build, ratio `44/47`) and S
(`s-dated-programme.json`, externals 6,000,000p) each carry a
`lender_eligible: false` package whose flag has been inert since R10. Wiring
the cap may move their ledger-dependent pins (draws, peak debt, finance costs,
`funding_gap_pence`, the two `cost_to_complete_*` figures) — or may not, if the
smaller cap never binds against an ample facility. Either outcome must be
**shown**, not assumed: where a pin moves, the new figure is hand-derived from
the scaled cap base before it is written (Q's ledger pins were
invariant-cross-checked rather than hand-replayed in R10, so this is the first
time the cap base on Q is derived by hand); where nothing moves, the task
report states which month's cap would have had to bind and why it did not.
Every fixture whose packages are all eligible, and every headline-mode
fixture, is bit-identical.

Spec edits: §4.2(b) gains the ratio; §16.2's "recorded and displayed only"
sentence, §16.8's output note and §16.9's limitation are rewritten to say
wired in calc 2.13.0.

---

## 6. §20.1 — The `monitoring` schema (inputs v11)

Top level, nullable, beside `investment_case`:

```
monitoring: null | {
  reporting_month: int,            // 1..term; ledger label m (Sec 5.10 convention)
  reporting_date: string,          // ISO yyyy-mm-dd, printed only; never drives arithmetic
  lines: MonitoringLine[5],        // exactly one per category, any order, no duplicates
  debt_drawn_to_date_pence: int,   // >= 0: cumulative senior principal + capitalised non-interest fees drawn
  cash_equity_injected_to_date_pence: int,  // >= 0
  author: string, date: string, note: string | null   // provenance, LenderValuation's shape
}

MonitoringLine {
  category: 'acquisition' | 'construction' | 'professional' | 'statutory' | 'contingency',
  current_budget_pence: int,            // >= 0, the QS's current approved budget for the category
  certified_to_date_pence: int,         // >= 0
  paid_to_date_pence: int,              // >= 0, <= certified
  committed_to_date_pence: int,         // >= 0, >= certified (committed includes certified)
  forecast_to_complete_pence: int,      // >= 0, QS forecast of cost NOT yet committed
}
```

`reporting_month` is a ledger label, not a calendar date, for the reason in
decision 5. `reporting_date` is required because a monitoring statement without
a date is not one a lender will accept, but it is a label: the spec states that
changing it changes no number.

The five categories map onto the inception model thus (the **original budget**
column, never entered):

| Category | Original budget source |
|---|---|
| `acquisition` | §3.3 acquisition cost (purchase price + acquisition tax + acquisition fees), i.e. `Σ uses.acquisition_pence` |
| `construction` | `cost_plan.base_build_pence + compliance_pence` — construction **excluding** contingency |
| `professional` | `Σ uses.professional_pence` |
| `statutory` | `Σ uses.statutory_pence` |
| `contingency` | `cost_plan.contingency_total_pence` |

The construction/contingency split is the one place the inception model's
lines and the statement's lines differ: §3.4 carries contingency inside the
construction line, and the statement pulls it out because the audit asks for
remaining contingency as its own figure. The spec states that
`original(construction) + original(contingency) == Σ uses.construction_pence`,
and a test asserts it on every fixture.

**Migration v10 → v11** stamps `monitoring: null`. Every existing document is
bit-identical in every output, asserted across the whole fixture corpus (the
v11 arm of the numeric identity gate, filtering on `doc["inputs"]["inputs_version"]`,
the R13 lesson).

---

## 7. §20.2 — The statement

Computed only when `monitoring != null`, at `m = reporting_month`, from the
entered block and the inception ledger. Nothing here re-runs the ledger.

### Per category, and in total

| Column | Definition |
|---|---|
| `original_budget_pence` | from the table in §6 |
| `current_budget_pence` | entered |
| `certified_to_date_pence` | entered |
| `paid_to_date_pence` | entered |
| `committed_to_date_pence` | entered |
| `committed_not_certified_pence` | `committed − certified` |
| `forecast_to_complete_pence` | entered |
| `estimated_final_cost_pence` | `committed + forecast_to_complete` |
| `variance_vs_original_pence` | `estimated_final − original` (positive = overrun) |
| `variance_vs_current_pence` | `estimated_final − current_budget` |
| `remaining_to_spend_pence` | `estimated_final − certified` = `committed_not_certified + forecast_to_complete` |

`paid_to_date_pence` is recorded and printed (the audit asks for it; a
lender reconciles certificates against payments) but drives no column — the
statement is a cost position, not a cash position, and the spec says so.

Totals are column sums. `contingency_remaining_pence` =
`current_budget(contingency) − certified(contingency)`, floored at 0, reported
on its own because the audit names it.

### The funding side

```
undrawn_net_facility      = max(0, committed_net − debt_drawn_to_date)            (0 for cash deals)
reserve_headroom          = rolled_up ? max(0, committed_gross − committed_net − cum_interest_capitalised(m−1)) : 0
remaining_cash_equity     = max(0, cash_equity_total − cash_equity_injected_to_date)
remaining_funding         = undrawn_net_facility + reserve_headroom + remaining_cash_equity
```

`cum_interest_capitalised(m−1)` is read from the **inception** ledger — the
statement has no actual interest figure and the spec says so: the interest
component is forecast, not monitored (stated limitation). `cash_equity_total`
is §5.10's filter (cash-classified, not rejected).

### The uses side

```
forecast_finance          = Σ_{k=m}^{term−1} months[k].interest_accrued + months[k].capitalised_fees  (inception ledger)
remaining_uses            = total.remaining_to_spend + forecast_finance
surplus                   = remaining_funding − remaining_uses
monitoring_shortfall      = max(0, −surplus)
```

This is the audit's "reconcile remaining uses with undrawn facility plus
remaining cash equity", with the reserve term that §4 adds.

### Variances against the inception plan

- `debt_drawn_variance_pence` = `debt_drawn_to_date − cum(draw + capitalised_fees)(m−1)` from the inception ledger.
- `equity_injected_variance_pence` = `cash_equity_injected_to_date − cum_equity_contributed(m−1)`.
- `cost_to_date_variance_pence` = `total.certified − Σ_{k<m} (uses.acquisition + construction + professional + statutory)`.

Positive means ahead of (more than) plan in every case; the memo prints the
sign convention beside the figure.

### Rounding

Every input is integer pence; every column is a sum or difference of integers.
No rounding occurs in the statement. The only rounded figure R14 introduces is
§5's cap base.

---

## 8. §20.3 — Validation

Hard errors (`report_safe` false):
- `reporting_month` outside `1..term`.
- `lines` not exactly five distinct categories.
- Any line with `paid > certified` or `certified > committed`.
- `debt_drawn_to_date > committed_net` (for a cash deal, `> 0`).
- `cash_equity_injected_to_date > cash_equity_total` is **not** an error — the
  audit's "additional equity injected" case; it is a warning (below).

Input-only warning (a `ValidationIssue`, severity `warning`, field `monitoring`):
- `cash_equity_injected_to_date > cash_equity_total` — "equity injected beyond committed sources".

Result-derived warnings are **flags** (`FlagCode`, raised in metrics the way
`funding_gap` and R13's three flags are — validation runs on inputs only and
cannot see the statement):
- `monitoring_shortfall` (red) — `monitoring_shortfall > 0`; message carries the figure.
- `monitoring_cost_variance` (amber) — any category's `variance_vs_original` exceeding 5% of a non-zero original.
- `monitoring_dated_after_redemption` (amber) — `reporting_month` later than the ledger's redemption month.

Monitoring validation and flags run only when `monitoring != null`; a null
block adds no issue and no flag, so existing documents' `validation.issues`
and `flags` are unchanged.

---

## 9. §20.4 — Outputs and reporting

- `cost_to_complete` keeps its shape; each month gains
  `remaining_interest_reserve_headroom_pence`. Fixture expected-metrics keys
  `cost_to_complete_first_shortfall_month` / `_max_shortfall_pence` are
  unchanged in name.
- `AppraisalResultV2` / `Schedule`-level metrics gain
  `monitoring_statement: MonitoringStatement | null` with the columns of §7,
  plus `reporting_month`, `reporting_date` echoed.
- Cost plan result gains `lender_eligible_ratio: number`.
- Fixture expected-metrics mapping gains `monitoring_shortfall_pence`,
  `monitoring_estimated_final_cost_pence`, `monitoring_surplus_pence`, and
  `lender_eligible_ratio`. A new fixture `w-monitoring-on-site.json` (inputs
  v11, detailed mode, one ineligible package, `monitoring` set at month 6)
  pins all four, hand-derived in `test-cases.md`; it is the release's golden
  case and the cross-engine penny-agreement carrier — R13's lesson that a
  release whose fixtures pin nothing leaves that mechanism empty.
- **Screens.** `CostToCompleteCard` gains the reserve-headroom column.
  A `MonitoringEditor` on the Finance page (five lines, the two cumulative
  figures, provenance; "remove monitoring case" sets null). A
  `MonitoringStatementCard` on the summary page, shown only when present, with
  the per-category table, the funding reconciliation and the three variances.
  No arithmetic in components: every figure printed is a result field.
- **Memo.** Section "Monitoring cost-to-complete" printed only when
  `monitoring_statement != null`, after the existing cost-to-complete section;
  the provenance line prints `reporting_date`, author, date. The report-QA
  suite gains a monitoring fixture and asserts the section is absent on every
  existing fixture.
- **What a report may claim (§13.4):** the statement is a sponsor-entered
  monitoring position; the memo must say the interest component is the
  inception forecast and that certified figures are as entered, not as verified
  by a monitoring surveyor. The DRAFT gate is unchanged (decision 12).

---

## 10. §20.5 — Stated limitations

1. Interest and capitalised fees in the statement are the inception ledger's
   forecast from `reporting_month` onward; there is no actual-interest input.
2. Actuals are per category; per-package actuals and their QS source, date and
   status are R15.
3. `lender_eligible` acts as a ratio on the construction line; a per-package
   draw profile needs a per-package programme (§16.9, §18).
4. The statement is a snapshot, not a re-simulation — the §5.10 "Known
   limitation" still applies to it.
5. No drawdown-request or certificate history; one statement per document.
   R14b's change log is the place a history would live.
6. No lender-case linkage; a monitoring statement does not make a document
   FINAL and an approved case does not require one.

---

## 11. Guards this release must watch fail

1. **Fixture P's pins move** — the old `1` / `392483` become the negative
   controls. Observed failing before the C1 change lands.
2. **`v-exhausted-reserve`** reports a positive shortfall under decision 2.
   A version of the engine implementing the rejected correction (drop interest
   from cost) is run against it during the task and must report 0 — that
   comparison is recorded in the task's report, not committed.
3. **Serviced-interest identity** — a serviced fixture's whole
   `cost_to_complete` series is deep-equal before and after §4.
4. **The ineligible-package pair** — strictly smaller draw, strictly larger
   gap.
5. **The construction split identity** — `original(construction) + original(contingency) == Σ uses.construction_pence`
   on every fixture.
6. **v11 numeric identity** — every pre-v11 fixture migrates to v11 and
   produces identical `expected_metrics`; the filter reads
   `doc["inputs"]["inputs_version"]`.
7. **`reporting_date` is inert** — changing it changes no result field.
8. **Entry-point guard** names `migrate_inputs_to_v11` / `migrateInputsToV11`
   at every production call site, and the governance `inputs_version` still
   derives from the document (no literal to go stale).
9. **Spec-versions pin** — `CALC_VERSION` 2.13.0 in both engines.

For each: name what change it would miss (R11's rule). Guard 3 misses a
constant added to both sides — guard 1's pinned zero catches that. Guard 4's
direction-only comparison misses a wrong ratio that is merely `< 1` — fixture
`w`'s pinned `lender_eligible_ratio` catches that.

---

## 12. Also in scope

- §13.3's banner table gains the `vat_basis_unconfirmed` row the code has
  carried since R11 (`DRAFT - VAT BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE`);
  the four-condition prose becomes five. Spec drift only; no code change.
- The release plan's R14 row is narrowed and R14b is added (§2).
- `app/models.py`'s v1–v10 comment on `FinancialAppraisalCreate` gains v11.
- §1.6's inputs-version list gains v11 and the existing test that reads it is
  extended.
- The `types.py:697` comment "R14 wires it" and `apply_scenario.py:51`'s note
  are rewritten to describe the live behaviour — a comment that lies is a
  defect.

## 13. Out of scope

- Lender case governance — R14b.
- Per-package actuals, QS provenance, provisional sums, inflation — R15.
- Ledger re-simulation from actuals.
- The unit-level sales ledger — R13b.
- PDF/UA tagging, raster visual regression, the jsPDF Symbol-font warning — R7
  carries.

## 14. Shape of the work

Roughly fourteen tasks, in four bands:

1. **C1** — the funding-side correction in both engines, fixture P's pins and
   controls, the corpus-test exclusion list, the new column, fixture `v`, the
   §5.10 rewrite. Failing test first, on fixture P.
2. **The draw cap** — the ratio on the cost-plan result, the cap base in both
   ledgers, the ineligible-package fixture pair, the §4.2/§16 edits.
3. **Schema and migration** — v11 types in both engines, migration, the
   numeric identity gate, validation, `app/models.py` comment.
4. **The statement and its surfaces** — `monitoring` engine in both engines,
   fixture `w`, result plumbing, the editor, the card, the memo section, the
   report-QA assertion, §20, §13.3's row, the release plan.

The entry-point cutover to v11 is its own task, at the end (R12's finding: the
cutover is what finds the boundary bug).
