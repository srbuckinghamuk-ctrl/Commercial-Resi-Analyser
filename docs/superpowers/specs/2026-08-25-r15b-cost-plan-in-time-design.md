# Release 15b — The cost plan in time design

**Date:** 25 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.5 (*"Include QS source/date/status, fixed-price coverage, provisional sums,
**inflation** and package exclusions"*; *"Allow eligibility bases per package
and show the base"*), together with the three spec limitations that have waited
on one missing mechanism: §16.9 limitation 1 (*"No per-package programme"*,
open since R10, unowned since R12), §16.9 limitation 2 / §20.5 limitation 3
(*"`lender_eligible` acts as a uniform ratio on the construction line, not a
per-package draw profile"*), and §16.9's / §23.11 limitation 6's inflation
deferral (*"a package has no spend midpoint until it has its own
programme"*). Release-plan row: **R15b — The cost plan in time: per-package
programme (§16.9 limitation 1), tender-price inflation from `qs.base_date` to
each package's spend midpoint (§7.5's inflation ask), per-package draw
eligibility (§16.9 limitation 2, §20.5 limitation 3) — P1 — inputs v14, calc
minor.**

**Versions:** calc `2.15.0` → `2.16.0`; inputs `v13` → `v14`.
**Specification:** the calculation specification gains **§24**; **§4.2(b)**'s
cap base is restated per month; **§6** gains the package-window rule for the
auto path; **§16.8** gains the inflation line and the per-package timing
fields; **§16.9** limitations 1, 2 and the inflation line become historical
notes; **§18.5** gains the per-month eligible share beside the bucket rule;
**§20.1**'s original construction budget gains the inflation line and
**§20.5** limitation 3 becomes a historical note; **§23.6** names the
inflation block and **§23.11** limitation 6 becomes a historical note;
**§1.6**'s inputs-version list gains v14.

---

## 1. The problem this release exists to solve

### 1.1 A package has a phase but no identity in time

R12 (§18.5) gave every `CostPackage` an optional `phase_id`, so a package can
already be bound to any phase in the network — including a phase created for
it alone — and take that phase's window and curve. §16.9 limitation 1 (*"no
per-package start offset, duration or curve"*) is therefore only literally
true. What a package genuinely lacks is **identity inside the monthly uses**:
`schedule.ts` / `schedule.py` bucket packages by (resolved phase, category)
and spread each bucket's total once, so by the time the ledger reads
`uses[m].construction_pence` nothing records which package's pounds they are.
That single gap is what all three R15b components share — inflation needs
each package's spend midpoint, draw eligibility needs each package's spend
months — and it is why they were scheduled together.

There is also no surface on which a package *can* be tagged: `phase_id` has
been engine-complete and UI-less since R12. The `ConversionCostsPage` package
row has no phase control and the `ProgrammePage` edits phases, not lines. That
is the §18.10-limitation-9 shape (an anchor the engine honoured but nothing
could write) a fourth release on.

### 1.2 The cost plan is priced at one instant and spent over a programme

R15 recorded `cost_plan.qs.base_date` — the pricing base date — so a detailed
plan states *when* its prices are from. Nothing bridges that date and the
months the money is spent. A plan priced in March and spending its finishes
package eighteen months later carries no tender-price allowance, and the memo
says nothing about it: the limitation is stated in §16.9 and §23.11, not
disclosed against the figure it affects.

### 1.3 Eligibility is a ratio, not a profile

R14 wired `lender_eligible` as one ratio — eligible base build over base build
— applied to every month's construction line. On a programme where the
ineligible package spends in different months from the eligible ones, the cap
is wrong in both directions: too tight in the months only eligible packages
spend, too loose in the months the ineligible one does. §20.5 limitation 3
records exactly that: *"an ineligible package's own spend months are not
distinguished"*. Fixture S (`s-dated-programme`) is the corpus's live example —
its eligible enabling package is tagged to `strip_out` and its ineligible
externals package sits in the main construction window, and its
`funding_gap_pence` of 6,300,000 is computed with one ratio across both.

---

## 2. Scope

| Ask | Owned by | Notes |
|---|---|---|
| §16.9 lim 1 — per-package programme | **R15b** | resolved by construction: a package's programme is its resolved phase (decision 1); the UI gains the phase picker the engine has lacked a writer for |
| §7.5 inflation — from `qs.base_date` to each package's spend midpoint | **R15b** | `cost_plan.qs.inflation`, §24.3 |
| §16.9 lim 2 / §20.5 lim 3 — per-package draw eligibility | **R15b** | per-month eligible share, §24.4; the ledger's §4.2(b) reads a per-month figure |
| §7.5 "show the base" for eligibility | **R15b** | the per-month eligible construction figure is published on the schedule and printed |
| R15 backlog: raw enum keys in memo §9; Appendix B ordering; a gate on derived rows | **R16** | evidence-schedule polish, not timing |
| R16 UX debt (R12/R13 override fields on ScenariosPage) | **R16** | stands |

**Arithmetic changes, stated.** Calc 2.16.0 changes two computed things and
nothing else: (a) a detailed plan carrying an inflation allowance gains an
inflation line inside `construction_total_pence`; (b) the §4.2(b) cap base
reads lender-eligible construction spend **per month**. (a) touches no
existing document — every stored document migrates with `inflation: null`.
(b) touches no document on the auto path and no network document whose
packages share one window, because the per-month share then equals the
uniform ratio in every month (§24.4, asserted). It touches fixture S, whose
pins move and are re-derived by hand (§13).

---

## 3. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | The per-package programme | **Timing stays phase-only.** A package's window is its resolved phase's window — `phase_id ?? category_phase_ids.construction`, §18.5's existing rule — and "give a package its own programme" means "give it its own phase". R15b makes package identity survive into the schedule and adds the phase picker | Per-package `start_offset` / `duration_months` / `curve` beside `phase_id` — two mechanisms for one fact (R10's seam defect by construction); a package with both has two windows, and §18's float, critical path and `phase_slip` would not see the override at all |
| 2 | Where inflation lives | **`cost_plan.qs.inflation: { annual_pct } \| null`** — inside `qs`, because it is meaningless without `base_date`, and `qs` is already detailed-mode-only. `null` = no allowance modelled (§1.5: unknown, not zero); the migration writes `null` | A top-level or `cost_plan`-level block — needs a cross-block "requires qs" rule that the shape gives for free; a `0` default — a zero nobody entered would print as an assessed nil allowance |
| 3 | The calendar | **`inflation` non-null with `acquisition_date: null` is a hard validation error** ("no calendar to inflate against"). Months from base to a midpoint = `monthsBetween(base_date, acquisition_date) + midpoint_month`, floored at 0 | A silent zero — a live-looking allowance that does nothing, the pattern every release here rejects; expressing the origin as a month offset — `base_date` is already the recorded field and is a date |
| 4 | The index | **One flat annual rate, compounded pro-rata:** `factor = (1 + annual_pct/100)^(months/12)`, one rounding on the pence per package, total = Σ rounded lines (§16.3's rule) | A dated BCIS-style table — a second input series with no evidence mechanism behind it; a credit paper states "x% p.a. to the spend midpoint" |
| 5 | The midpoint | **Curve-weighted mean month** of the package's spread, from the curve's weight vector — independent of the amount | The window's centre — a `back_loaded` package spends later than its centre and would be under-inflated |
| 6 | Where inflation sits in the stack | **A separate line:** `construction_total = base_build + inflation_total + contingency_total + compliance`. Contingency bases stay on the **uninflated** base build; `pct_of_base_build` fees exclude it, `pct_of_construction_total` fees include it — both by their existing definitions | Contingency on base + inflation — the general class would silently grow with the programme, R15's "indistinguishable from contingency" objection in reverse; NRM1 orders risk before inflation |
| 7 | Per-package eligibility | **Uses stay bucket-spread, byte-identical.** A per-package spread with the same weights (needed for the midpoint anyway) gives a per-month eligible share; the schedule publishes `uses[m].lender_eligible_construction_pence = round(construction(m) × share(m))` and §4.2(b) reads it | Spreading each package into the uses — §18.5's rounding argument: per-line spreads disagree with a bucket spread by pennies, and the identity gate would fail corpus-wide, or worse, only on fixtures whose amounts do not divide evenly |
| 8 | Contingency and compliance under the share | They follow **the month's** share — "proportionally" as §16.9 has always said, now per month rather than uniformly; a remainder-only month (no package spend) falls back to the uniform ratio | A separate eligibility rule for contingency — a third figure nobody asked for |
| 9 | Disclosure with no allowance | **One amber flag, `no_inflation_allowance`**, when a detailed plan has a `qs` block and no allowance and at least one package's midpoint falls after `base_date`; printed in the memo's cost section and on the Costs page. **No FINAL condition** | An eighth FINAL condition — every existing detailed-mode FINAL route becomes DRAFT on migration, and the memo gate's FINAL fixture would need an allowance it has no evidence for; no flag — a null printed as a sentence only |
| 10 | Sensitivity | **No new lever.** The cost lever scales package amounts, hence inflation; `phase_slip` and `timeline` move midpoints; §12.2 untouched | An inflation lever — a tenth lever with no audit ask |
| 11 | VAT | An overridden package's VAT line, and its subtraction from the construction category base, use **`amount + inflation`** — the inflation follows the package's own treatment | Leaving the line on `amount_pence` — the overridden package's inflation would silently take the category treatment |
| 12 | Monitoring | `original(construction)` becomes `base_build + inflation_total + compliance`, so §20.1's split identity `original(construction) + original(contingency) == Σ uses.construction` keeps holding and keeps being asserted | Leaving it — the identity would fail on any document with an allowance |
| 13 | The phase picker's reach | **Packages and fee lines** — the same control, and §18.5 already gives both the field | Packages only — leaves fee-line `phase_id` engine-only for a fourth release, the limitation-9 shape |
| 14 | Version | calc **2.16.0** (a result field the ledger reads changes meaning, and outputs gain fields), inputs **v14** | No bump — an arithmetic change to a reported metric on fixture S without a version is exactly what §1.6 forbids |

---

## 4. §24.1 — The schema (inputs v14)

```
cost_plan.qs: null | {
  source, stage, date, status, base_date     -- R15, unchanged
  inflation: null | {                        -- NEW; null = no allowance modelled
    annual_pct: number >= 0                  -- tender-price inflation, % per annum
  }
}
```

That is the whole input change. `CostPackage.phase_id` (R12) is the
per-package programme; `CostPackage.lender_eligible` (R10, wired R14) is the
per-package eligibility. Both already exist and neither changes shape.

- `inflation` is nullable and inside `qs`, so it cannot exist without a
  pricing base date by construction. `qs` is hard-rejected in headline mode
  (§23.1), so inflation is detailed-mode-only by the same rule.
- `annual_pct` is `>= 0` at the model boundary. There is no deflation: a base
  date after a package's midpoint gives `months = 0` and a factor of 1
  (§24.3), never a factor below 1.
- Migration v13 → v14 writes `inflation: null` on every document carrying a
  `qs` block, and touches nothing on a document whose `qs` is null.

---

## 5. §24.2 — Package timing

One pure function, `computePackageTiming(inputs)` / `compute_package_timing`,
runs before the cost plan and the schedule and is the only place a package's
window is resolved. Both consumers read it; neither re-derives it.

```
PackageTiming:
  phase_id:        string | null     -- resolved phase in a network; null on the auto/legacy arms
  start_month:     integer
  finish_month:    integer           -- half-open, §18.2
  duration_months: integer >= 1
  curve:           SpendCurve
  weights:         number[]          -- length duration_months; Σ = 1
  midpoint_month:  number            -- Σ_k weights[k] × (start_month + k), k from 0
```

**Resolution, by spend path** (the three arms §18 already has):

| Path | Window | Curve |
|---|---|---|
| network | `derivePhases(network).byId[resolvedPhaseId(pkg.phase_id, 'construction', network)]` — its `start_month`, `duration_months` | the phase's |
| auto (`programme = null`) | §6's construction window: months `1 .. max(1, term − 2)`; term 1 → month 0, one month | `straight_line` |
| legacy three-package (raw v4–v8 only) | the construction package's `[start_offset, start_offset + duration)` | the construction package's |

Every package on the auto path and on the legacy arm shares one window, so
every package there has the same midpoint. A package resolving to a milestone
is already a hard error (§18.8); the timing function is never reached by a
document that fails validation.

**Weights, not spreads.** `curves.ts` / `curves.py` gain `curveWeights(duration,
curve): number[]` — the fraction vector `w_k` of §6.1, from which `spreadByCurve`
is `round_half_up(total × w_k)` with the final month absorbing the residue.
The midpoint is computed from the weights so that it is **independent of the
amount**: doubling a package leaves its midpoint unchanged, and the inflation
that depends on it cannot feed back into the timing that produced it.

**The midpoint is a float** (4 dp when printed; unrounded in the engine). On a
straight-line window of 6 months from month 5 it is 7.5; on a `back_loaded`
window of the same shape it is 8.3333… (weights 1/21 … 6/21 over months
5–10); on `user_defined` weights it is
whatever the weights say. Months and fractions of months are both meaningful
here because the index below compounds pro-rata.

---

## 6. §24.3 — Tender-price inflation

Detailed mode, `qs.inflation` non-null, `acquisition_date` non-null (else a
hard error, §24.7). Per package:

```
months_from_base = max(0, monthsBetween(qs.base_date, acquisition.acquisition_date) + midpoint_month)
inflation_factor = (1 + annual_pct / 100) ^ (months_from_base / 12)
inflation_pence  = round_half_up(amount_pence × (inflation_factor − 1))
```

```
inflation_total_pence    = Σ inflation_pence            -- sum of rounded lines, not a rounding of the sum
construction_total_pence = base_build_pence + inflation_total_pence
                         + contingency_total_pence + compliance_pence
```

- `monthsBetween` is R15's §23.9 helper (whole months, floored on the day) —
  reused, not re-implemented. `months_from_base` is a **float**: the whole
  months from the base date to month 0, plus the fractional midpoint. The
  floor at zero is the "no deflation" rule: a base date later than a package's
  midpoint means the price already reflects that month.
- The one rounding is on the pence, per package, half-up (`money_round` — not
  Python's builtin `round`, R9's lesson). The factor and the months are never
  rounded.
- **What is and is not inflated.** Packages only. Contingency classes keep
  their uninflated bases (§16.3 unchanged: `general` on base build, the other
  two on tagged packages). Compliance is 0 in detailed mode. Fee lines: a
  `pct_of_base_build` line excludes inflation because base build excludes it;
  a `pct_of_construction_total` line includes it because that base is defined
  as everything in the construction line (§16.4 unchanged — the definitions
  already say this). `lender_eligible_base_pence` and `implied_rate_pence_per_sqm`
  are base-date figures and stay uninflated; `price_basis` coverage is
  against base build and is unchanged.
- With `inflation: null` every figure above is `0` or `null` exactly as §24.6
  states, and `construction_total_pence` is calc 2.15.0's to the penny.

**Why a separate line and not a scaled package amount.** Scaling
`amount_pence` in place would move the price-basis coverage, the contingency
bases, the eligible base and the implied rate — every base-date figure — and
would make the QS's priced sum unrecoverable from the result. The allowance
is a dated, disclosed line beside the priced sum, which is how a QS reports it.

---

## 7. §24.4 — Per-package draw eligibility

The uses are built exactly as §18.5 and §6 build them today — bucket-spread,
byte-identical. Beside them, from the same weights:

```
pkg_spend(p, m)  = spreadByCurve(amount_p + inflation_p, duration_p, curve_p)[m − start_p]
                   (0 outside the package's window)              -- for the SHARE only; never added to uses
share(m)         = Σ_{p eligible} pkg_spend(p, m)  ÷  Σ_{all p} pkg_spend(p, m)
                 = lender_eligible_ratio            when the denominator is 0
uses[m].lender_eligible_construction_pence = round_half_up(uses[m].construction_pence × share(m))
```

and §4.2(b)'s cap base becomes

```
uses[m].lender_eligible_construction_pence + uses[m].professional_pence + uses[m].statutory_pence
```

- **Headline mode:** no packages, `share(m)` is the uniform ratio (1) in every
  month — calc 2.15.0's figure.
- **The denominator-zero arm** is a month whose construction spend is only
  remainder — contingency in a default phase no package resolves to. It falls
  back to the uniform ratio rather than to 0 (which would make contingency
  un-advanceable in exactly the months it is spent) or to 1 (which would
  advance an ineligible plan's contingency in full).
- **Contingency and compliance follow the month's share.** They are in
  `uses[m].construction_pence` and not in any `pkg_spend`, so the share is
  applied to them as it is to the packages of that month — "proportionally",
  as §16.9 has said since R14, now month by month.
- **The recovery claim, asserted not argued.** When every package shares one
  window (the auto path, the legacy arm, and any network where every package
  resolves to the same phase), `share(m)` equals `lender_eligible_ratio` in
  every month up to the per-line rounding of `pkg_spend`, and
  `lender_eligible_construction_pence(m) == round(construction(m) × lender_eligible_ratio)`
  — the R14 formula recovered by construction. When every package is
  eligible the share is 1 and so is the ratio, whatever the windows. This is
  asserted on every auto-path detailed fixture for every month, and it is the
  reason `q-detailed-cost-plan` and `w-monitoring-on-site` (auto path, one
  ineligible package each) and `x-unit-sales-ledger` and `y-due-diligence`
  (network, every package eligible and untagged) do not move. If the per-line rounding ever breaks that equality on some month, the
  test names the month and the release does not ship the shortcut.
- **Fixture S moves, by hand.** S's eligible enabling package (6,000,000) is
  tagged to `strip_out`; its main-window packages are structure 24,000,000,
  envelope 18,000,000, M&E 12,000,000 (eligible) and externals 6,000,000
  (ineligible), with the 3,300,000 general contingency as remainder. Uniform
  ratio 60/66 = 0.9090…; per-month share is **1** across the strip-out months
  and **54/60 = 0.9** across the main window. The strip-out months become
  fully advanceable and the main window slightly less so; the ledger,
  `funding_gap_pence` (6,300,000 today) and every debt-denominated metric are
  re-pinned from a hand derivation in `test-cases.md` §24.
- `lender_eligible_ratio` stays on `CostPlanResult` and on `Schedule` as the
  disclosure figure and the fallback; the ledger no longer reads it directly.

---

## 8. §24.5 — Downstream consequences, each stated

- **VAT (§17.6).** An overridden package's charge line is on
  `amount_pence + inflation_pence`, and the construction category base is
  `construction_total_pence − Σ (amount + inflation) of overridden packages`.
  The inflation follows the package's own treatment. Every existing document
  has `inflation_pence = 0` on every package, so the VAT ledger is unchanged
  corpus-wide.
- **Monitoring (§20.1).** `original(construction) = base_build + inflation_total + compliance`.
  The split identity `original(construction) + original(contingency) == Σ uses.construction_pence`
  keeps holding by construction of the new `construction_total_pence`, and keeps
  being asserted corpus-wide.
- **Cost-to-complete (§5.10)** reads the ledger; it moves where the ledger moves
  (S) and nowhere else.
- **Sensitivity (§12).** The cost lever scales `amount_pence` and therefore
  `inflation_pence` (the midpoint is amount-independent, so the factor is
  unchanged and the pence scale linearly to within rounding). `phase_slip`
  moves the tagged phase's window and every package resolving to it, hence
  their midpoints and inflation. `timeline` moves the auto window. No lever
  writes `qs`; §12.2's facility invariance is untouched. Lever
  order-independence is re-asserted with the inflation fields present.
- **The DD `cost_plan_qs` derived row (§23.3)** is unchanged; the allowance is
  a cost-plan figure, not an evidence status.
- **The lender case hash (§13.2.1)** is a hash over the inputs; `inflation`
  is inside it because `qs` is. Editing the rate makes an approved case
  stale, as editing `base_date` already does.

---

## 9. §24.6 — Outputs and reporting

### The result block

`CostPlanResult` (§16.8) gains, per package and in total. Types are listed in
the order they appear on the shape; both engines mirror field for field.

```
packages[].phase_id                    resolved; null on the auto and legacy arms
packages[].start_month, finish_month   the package's window
packages[].midpoint_month              float
packages[].months_from_base            float | null   -- null when inflation is null
packages[].inflation_factor            float | null   -- null when inflation is null
packages[].inflation_pence             integer; 0 when inflation is null
inflation_total_pence                  integer; 0 when inflation is null
construction_total_pence               = base_build + inflation_total + contingency_total + compliance
qs                                     the input block republished (R15) — now carries `inflation`, so
                                       no separate result field is added for it
```

`Schedule.uses[m]` gains `lender_eligible_construction_pence`. `Schedule`
gains `package_timing: PackageTiming[]` (§24.2's block, one per package, in
package order; `[]` in headline mode) so the Costs page and the memo print a
window rather than derive one.

`AppraisalResultV2.metrics.cost_plan` remains the only shape a surface may read
cost from; no component and no generator computes a midpoint, a factor or a
share.

### Surfaces

- **Costs page** (`ConversionCostsPage`). Each package row gains a **phase
  picker**: "Category default — *[the construction default phase's label]*"
  or any non-milestone phase, writing `phase_id` (`null` for the default).
  Disabled, with a one-line hint, when `programme` is null or legacy. Each
  row gains three read-only cells off the result: window (`start–finish`),
  midpoint, inflation. Fee-line rows gain the same picker (decision 13). The
  QS card gains the inflation control — "Tender-price inflation: none
  recorded / *x* % p.a." with the rate input — and the coverage line gains
  "Inflation to spend midpoints £*x* (*y* % of base build)", `y` through
  `pct()`. No arithmetic in JSX.
- **Programme page.** No change. A package's window is its phase's bar.
- **Memo.** The cost section prints an "Inflation to spend midpoint" line
  between base build and contingency, or — when `no_inflation_allowance`
  fires — "No tender-price inflation allowance recorded: priced at
  *[base_date]*; package spend midpoints fall up to *n* months later". The
  package table gains phase / midpoint / inflation columns. §13.4's cost-basis
  sentence names the allowance and rate where recorded. The finance section's
  §4.2(b) sentence becomes "development advances are capped against
  lender-eligible construction spend month by month, professional and
  statutory in full". The memo's limitations list loses §16.9 1–2 and §23.11 6.
- **Cash-flow page.** No change. It prints the ledger's `uses_total_pence`
  only and has no per-category column to hang an eligibility figure on; the
  per-month figure is published on the schedule for the ledger and the tests,
  and a cash-flow column for it is recorded as out of scope (§16).

---

## 10. §24.7 — Validation and flags

**Hard errors** (detailed mode; a null `inflation` adds nothing):

| Field | Condition |
|---|---|
| `cost_plan.qs.inflation.annual_pct` | negative, non-finite |
| `cost_plan.qs.inflation` | non-null while `acquisition.acquisition_date` is null — *"Tender-price inflation needs a calendar: set the acquisition date, or record no allowance"* |
| `cost_plan.qs.inflation` | non-null while `qs.base_date` is blank or whitespace — R15 requires the QS dates, and this is the engine-side guard matched to that rule so a blank never reaches `monthsBetween` |

**Warning:** `annual_pct > 15` — a rate a credit committee would query. No
clamp.

**One flag**, raised in `deriveMetrics` / `derive_metrics` beside R15's four,
dated with the month of the latest package midpoint (floored to an integer
month index):

| Flag | Severity | Condition |
|---|---|---|
| `no_inflation_allowance` | amber | detailed mode, `qs` non-null, `inflation` null, `acquisition_date` non-null, and `monthsBetween(base_date, acquisition_date) + max midpoint > 0`; the message carries that number of months and the base date |

It is skipped when `acquisition_date` is null (there is no calendar to
measure against — the consent flag's rule) and when no midpoint falls after
the base date (there is nothing to inflate). `inflation_applied` is **not** a
flag: an allowance is a line, not a warning.

Cross-engine message drift: the §19.7/§22.7/§23.9 window widens to cover the
three §24.7 messages, bounded and order-asserted as before.

---

## 11. §24.8 — Migration and the persistence boundary

```
v13 cost_plan.qs: null          →  v14 unchanged
v13 cost_plan.qs: { ... }       →  v14 { ..., inflation: null }
```

`migrateV13toV14` / `migrate_v13_to_v14` mirror the v12 → v13 helper,
including the already-v14 merge branch and the two refusals. The boundary
test asserts the **presence and value** of `inflation: null` after a full
save/load round trip on a document with a `qs` block (the `extra='ignore'`
rule), and its absence on one without.

**The identity gate compares metrics, ledger and schedule with no exclusion**
— `package_timing`, `lender_eligible_construction_pence` and the new cost-plan
fields included — because both arms run the same calc 2.16.0 code and the
migration writes only a null. `no_inflation_allowance` is asserted by name as
the sole flag addition, **and** asserted to fire on at least one migrated
fixture (Y carries a `qs` block dated before its construction), so the named
exclusion cannot hide a flag that has stopped working.

**Pins that move under calc 2.16.0, all by hand:** fixture S's ledger-derived
metrics (per §24.4). Every other golden pin is asserted unchanged; the
recovery claim of §24.4 is the reason, and its test is the proof.

**Entry-point cutover.** `migrateInputsToV14` / `migrate_inputs_to_v14` at
every production call site; the governance `inputs_version` stays derived
from the document (R13's finding); the client default builder writes
`inflation: null` inside `DEFAULT_QS`.

---

## 12. §24.9 — Stated limitations

Recorded so they are not read as oversights.

1. **One rate, flat.** A single annual tender-price rate for the whole plan;
   no dated index table, no per-package rate. A plan whose packages carry
   different indices records one.
2. **Inflation is on packages only.** Fee lines are not inflated (an
   appointment is priced at appointment); contingency bases are uninflated
   by decision 6. A `pct_of_construction_total` fee follows the inflated base
   by its own definition.
3. **The per-month share is a ratio over per-package spreads, not a
   per-package ledger.** The uses remain bucket-spread (§18.5); the share is
   computed beside them and can differ from a true per-package spread by the
   per-line rounding of `spreadByCurve`. The recovery test bounds that
   difference to zero where all packages share a window; elsewhere it is at
   most a penny per package per month and is not a reported figure.
4. **Contingency and compliance follow the month's share.** No separate
   eligibility for the contingency allowance.
5. **A package's programme is its phase.** A package with its own timing needs
   its own phase, which then participates in float, the critical path and
   `phase_slip` like any other. There is no per-package offset inside a phase.
6. **The auto path has one window.** Every package on `programme = null`
   shares §6's construction window and midpoint; per-package timing needs a
   network, as §18.10 limitation 1 already says of slippage.
7. **No calendar beyond month 0.** `months_from_base` bridges `base_date` to
   month 0 through `acquisition_date`; every later month is an offset.
   §18.10 limitation 3 stands.
8. **The share is not re-simulated by the monitoring statement** (§20.5
   limitation 4 unchanged).

Three limitations recorded in earlier printings become historical notes
rather than being deleted (this project's rule): §16.9 limitations 1 and 2,
§16.9's inflation line, §20.5 limitation 3 and §23.11 limitation 6.

---

## 13. Fixture Z — `z-cost-plan-in-time`

Fixture S's network and detailed plan — the strip-out-tagged eligible package
and the ineligible externals package are already there — plus:

- `acquisition.acquisition_date: '2026-08-01'` (S already carries it; kept);
- `cost_plan.qs` with `base_date: '2026-02-01'` (six months before month 0),
  `date: '2026-02-15'`, `stage: 'riba_3'`, `status: 'issued'`, and
  `inflation: { annual_pct: 6 }`;
- the M&E package on a **`back_loaded`** phase of its own (`mande_fitout`:
  `SS` on `construction` with a 3-month lag, 3 months long — inside the
  6-month construction window, so the programme finish, the sale tail and
  every other phase's window are unchanged from S), so one midpoint ≠ its
  window centre;
- the externals package carrying `vat_override` so one overridden package
  carries inflation;
- `price_basis` set on every package (coverage is R15's figure and must not
  move).

**Every figure hand-derived in `test-cases.md` §24**, presented as the
derivation, not the answer: each package's window, weight vector, midpoint,
`months_from_base`, factor and pence; `inflation_total_pence`;
`construction_total_pence`; the per-month share on every month where it
differs from the uniform ratio; the eligible construction figure and the
ledger's draw on those months; `funding_gap_pence`; the overridden package's
VAT line; the `general` contingency base (equal to base build, exactly);
`pct_of_construction_total` fee lines if any (S has fixed fees; Z adds one
percentage line so the inclusion is pinned). Its twin with `inflation: null`
pins `no_inflation_allowance` (message months = 6 + max midpoint) and the
eligibility-only movement against S.

Z is the cross-engine penny-agreement carrier for the release and pins
`inflation_total_pence`, `construction_total_pence`, `funding_gap_pence`,
`peak_debt_pence` and `lender_eligible_ratio` in its expected metrics.

---

## 14. Guards this release must watch fail

| Guard | What must fail first |
|---|---|
| Midpoint is curve-aware | Z's `back_loaded` package: `midpoint_month` ≠ window centre; a straight-line twin equals it |
| Midpoint is amount-independent | doubling a package's `amount_pence` leaves its `midpoint_month` bit-identical |
| Floor at zero | a `base_date` after a package's midpoint → `months_from_base` 0, factor 1, pence 0; the unfloored value is negative on that twin (proving the floor is reached) |
| Rounded lines, not a rounded sum | a three-package plan whose per-line roundings sum differently from the rounded sum: `inflation_total_pence` equals the former |
| Per-month share on S, absolute | strip-out months at share 1; main-window months at 54/60; the eligible construction figure pinned on one month of each |
| R14 recovery | on every auto-path detailed fixture, every month: `lender_eligible_construction_pence == round(construction × lender_eligible_ratio)`; a companion asserts the set of such fixtures is non-empty |
| Denominator-zero arm | a network whose default construction phase carries only contingency: those months at the uniform ratio, not 0 and not 1 |
| Inflation follows the override | Z's overridden package: VAT line = (amount + inflation) × rate; category base net of the same; `total_irrecoverable_pence` by hand |
| Monitoring split identity | corpus-wide, Z included, with inflation inside `original(construction)` |
| Contingency uninflated | Z's `general` base == `base_build_pence`; a `pct_of_base_build` fee excludes inflation and a `pct_of_construction_total` fee includes it — both pinned |
| Migration identity, no exclusion | v13 → v14 corpus-wide in both engines; `no_inflation_allowance` the named sole addition and proven to fire on Y |
| S re-pinned, everything else still | S's new pins by hand; every other golden pin unchanged |
| Calendar rule | `inflation` with `acquisition_date: null` errors naming both fields; blank `base_date` errors and never reaches `monthsBetween` (a spy/raise guard) |
| Flag boundary | `no_inflation_allowance` skipped when the max midpoint is at or before the base date; fires at one month after |
| Lever order-independence | all five levers in several orders on Z give identical results, inflation fields included |
| Cost lever scales inflation | Z under `construction_cost_adjustment_pct: +10`: every `inflation_pence` within a penny of 1.1× base; every `midpoint_month` unchanged |
| Phase picker is live | tagging a package to another phase on the Costs page moves its `start_month` in the result; the picker is disabled on an auto-path document |
| Message drift | the cross-engine window covers §24.7, bounded and order-asserted |
| Spec-versions pin | `CALC_VERSION` 2.16.0 and the §1.6 list with v14, both engines; entry-point guards pass only once every call site names v14 |

**Guards deliberately not written:** that `finish == start + duration` (true
by construction); that `Σ weights == 1` (true by construction of every curve
function — instead the *spread* invariant Σ = total is what is already
asserted).

---

## 15. Amendments to other sections

- **§1.6** — inputs-version list gains v14; changelog entry for 2.16.0.
- **§4.2(b)** — the cap base reads `uses[m].lender_eligible_construction_pence`;
  the R14 sentence about the uniform ratio becomes the historical note.
- **§6** — a sentence stating the auto path's package window (every package
  shares the construction window) for §24.2.
- **§16.8** — the inflation line, the per-package timing fields, the
  republished `inflation` block; `construction_total_pence`'s definition.
- **§16.9** — limitations 1, 2 and the inflation line → historical notes
  naming §24.
- **§18.5** — the per-month eligible share stated beside the bucket rule,
  with the rounding argument for why it is a share and not a second spread.
- **§20.1** — `original(construction)` gains `inflation_total_pence`; **§20.5**
  limitation 3 → historical note.
- **§23.6** — names `qs.inflation`; **§23.11** limitation 6 → historical note.
- **`migration-notes.md` §17**, **`test-cases.md` §24**, **`model-governance.md`**
  §3.1 row `| R15b | 2.16.0 | v14 | — | The cost plan in time: per-package
  timing from the phase, tender-price inflation to the spend midpoint,
  per-month lender-eligible construction | §24 |`, and the release plan's
  R15b row marked **DONE** with a status paragraph in the established form.

---

## 16. Out of scope

A dated index table; per-package rates; inflating fees or contingency; a
per-package ledger (the uses stay bucketed); a per-package offset inside a
phase; an inflation lever; any change to the FINAL gate; a per-month
lender-eligible column on the Cash-flow page (it has no per-category columns
today); the R15 backlog minors (memo §9 enum keys, Appendix B ordering, a gate on derived rows); R16's
UX debt.

---

## 17. Shape of the work

Roughly fourteen tasks, subagent-driven as R9–R15 were, each with its review:

1. Types and defaults (both engines): `inflation` on `QsProvenance`;
   `PackageTiming`; the new result fields; `lender_eligible_construction_pence`
   on `MonthUses`; `no_inflation_allowance` on `FlagCode`.
2. `curveWeights` in both curve modules, with the weight/spread agreement test.
3. `computePackageTiming` in both engines, all three arms, with the midpoint
   guards.
4. `computeCostPlan`: inflation per package and in total; the new
   `construction_total_pence`; contingency/fee-base pins.
5. Schedule: `package_timing`, the per-month share and
   `lender_eligible_construction_pence`; the recovery test; the denominator-zero
   arm.
6. Ledger: §4.2(b) reads the per-month figure; S re-pinned by hand.
7. VAT and monitoring follow-through, with their identities.
8. Validation and the flag, both engines, message-drift window widened.
9. Migration v13 → v14, the identity gate, the boundary test, entry-point
   cutover.
10. Fixture Z and `test-cases.md` §24 (the hand derivation is written before
    the fixture's expected metrics, per R10's "reachable literals" rule).
11. Costs page: phase picker, timing cells, inflation control.
12. Memo changes; memo release gate.
13. Sensitivity assertions (lever order, cost lever scaling, `phase_slip`
    moving a midpoint).
14. Spec §24 and the amendments; migration notes; governance; release plan.

---

## 18. Refinements at implementation

Rulings made while building Tasks 1–10 that supersede this design document
where they differ, carried into spec §24 as the normative statement:

1. `CostPackageLine.phase_id` keeps its raw-input meaning; the resolved phase
   is a new result field, `resolved_phase_id`, null on the auto and legacy
   arms.
2. `months_from_base` is published whenever `qs.base_date` is non-blank and
   `acquisition_date` is non-null, regardless of whether an allowance is
   recorded; only `inflation_factor`/`inflation_pence` are gated on the
   allowance itself.
3. `CostPlanResult` also publishes `inflation_pct_of_base_build` and
   `latest_midpoint_whole_months_from_base` beside `latest_midpoint_month`
   and `latest_midpoint_months_from_base`, so the flag message and the memo
   sentence read a published integer rather than re-flooring a float
   themselves.
4. `midpoint_month = start_month + round12(Σ_k weights[k] × k)`, with `k`
   folded in only once outside the accumulation and the fractional part
   rounded to 12 dp, so a straight-line window's midpoint is exact and a
   downstream whole-month floor cannot be defeated by an accumulated ulp.
5. The per-month eligible share is computed from **unrounded** per-package
   spend, `(amount + inflation) × w_k` as a float, never from
   `spreadByCurve`'s rounded pence — so on any single-window plan the share
   equals the packages' own eligible fraction exactly, whatever the
   amounts, and R14's uniform ratio is recovered exactly rather than only up
   to rounding; §24.9 limitation 3 narrows accordingly, to "a ratio over
   per-package weights, not a per-package ledger."
6. In the network arm, each package's `inflation_pence` joins its own
   resolved phase's bucket; the default bucket's remainder — contingency and
   compliance — is never itself a package line and always resolves through
   the category default. A package's inflation spreads with the package. A
   no-op on every pre-R15b document.
7. A non-finite or negative `annual_pct` degrades in the engine to no
   allowance (factor null, pence 0) rather than raising or propagating a
   `NaN`/`Infinity`; §24.7 rule 1 owns raising the validation error.
8. The flag `no_inflation_allowance` fires on a raw pre-v14 document exactly
   as on its migrated twin (the engine reads the absent key as null, R8's
   rule), so the v13 → v14 identity gate compares metrics — including the
   flag list — with strict equality and no exclusion. The TS engine
   republishes `qs` normalised (`inflation: qs.inflation ?? null`) so the
   result shape is identical on both arms.
9. The memo prints a package's timing as "midpoint x" always, "phase
   [label]" only when a phase is resolved, and "inflation £x" only when an
   allowance is recorded — never a placeholder for a fact the document does
   not carry; the memo's advance-cap sentence under "Senior Debt Position" is
   new, with no prior equivalent.
