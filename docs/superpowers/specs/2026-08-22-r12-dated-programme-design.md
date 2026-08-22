# Release 12 — Dated, dependent programme design

**Date:** 22 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.6 (*"The programme should now be expanded into dated, dependent phases:
acquisition, planning/prior approval, conditions, design, procurement,
strip-out, construction, testing, building control/warranty, practical
completion, marketing, unit completions, sales/refinance and maturity tail.
Current construction/professional/statutory curves are not enough to assess
planning, procurement, PC or exit slippage."*) and §7.9's standard lender
button *"delayed planning/PC"*. §10 roadmap row: *Programme — anchor and cost
curves → dated dependent planning-to-exit programme — P1.*

**Versions:** calc `2.10.0` → `2.11.0`; inputs `v8` → `v9`.
**Specification:** the calculation specification gains **§18**, and **§6.1 is
superseded** for the explicit-programme case (the `programme = null` auto-window
case in §6 is untouched).

---

## 1. The problem this release exists to solve

R3a (calc 2.2.0, spec §6.1) gave the appraisal an explicit programme. It has
exactly three windows:

```
programme.packages = {
  construction:  { start_offset, duration_months, curve },
  professional:  { start_offset, duration_months, curve },
  statutory:     { start_offset, duration_months, curve },
}
```

Three facts about that shape are the whole of this release's motivation.

**The three windows are mutually independent.** Nothing in the model says
construction follows procurement, or that discharging conditions precedes a
start on site. Each `start_offset` is an unconstrained integer. Moving one
window moves one window.

**Therefore slippage is not assessable.** A lender's first programme question is
*"what happens to my exposure if planning takes three months longer than
assumed?"* Today the only honest answer the model can give is *"re-enter every
downstream window by hand and hope you did not miss one."* The audit names four
slippage cases — planning, procurement, PC, exit — and the model can represent
none of them as a single adjustment. §12.1's `timeline` lever adds months to
`finance.term_months`, which lengthens the tail and moves no phase at all; on a
document with an explicit programme it is close to a no-op on the spend profile.

**Eight of the audit's fourteen phases have nowhere to live.** Conditions,
procurement, strip-out, testing, building control/warranty, practical
completion, marketing and unit completions are not modelled, not displayed, and
not schedulable. `strip_out` exists as an R10 *cost package code*
(`enabling_strip_out_asbestos`) with no timing of its own — it spreads on the
construction curve like everything else, so an enabling-works overrun is
invisible.

R12 replaces the three independent windows with a precedence network, binds the
cost lines to it, and makes a single slip propagate.

## 2. Decisions taken at design time

| # | Decision | Chosen | Rejected, and why |
|---|---|---|---|
| 1 | Dependency strength | Precedence network; the engine derives every start | Dated phases without propagation — reproduces today's defect with more rows |
| 2 | Money binding | Cost lines resolve to a phase; spend spreads over that phase's derived window | A timeline layer that does not drive the ledger — R11's dormant-engine shape |
| 3 | Term vs derived finish | `term_months` authoritative; overrun is a **hard error** | Clamping into the final month — the silent-clamping defect R5 exists to remove |
| 4 | Exit boundary | R12 owns exit **timing**; R13 owns exit **economics** | Stopping at PC — leaves the audit's named "exit slippage" unassessable |
| 5 | Slip mechanism | Per-phase `slip_months` **plus** a `phase_slip` sensitivity lever | A lever with no stored field (R14 monitoring has nothing to write); a field with no lever (dormant again) |
| 6 | `programme = null` | Survives as-is; auto windows unchanged | Migrating every stored document to a generated network — puts a derived block on documents that never asked for one, R11's silent-downgrade shape |
| 7 | v8 three-package shape | Migrated away; not retained as a fourth path | Keeping it — three live spend paths to test, and the legacy path would stay the one that actually runs |
| 8 | Dependency types | `FS` and `SS` only | `FF`/`SF` — no realistic construction link needs them, and each is another arm of the derivation to test |
| 9 | Acquisition timing | Stays pinned to month 0 | Re-timing it is deferred consideration/overage — R15 |

---

## 3. §18.1 — The schema

`inputs_version: 9`. `programme` is a two-state field:

| State | Meaning | Spend profile |
|---|---|---|
| `null` | auto windows | §6, **bit-identical to calc 2.10.0** |
| `{ anchor_month, phases[], category_phase_ids }` | precedence network | §18.2–§18.5 |

The v8 `{ packages: {...} }` shape does not survive migration (§18.7). There are
**two** live spend paths, not three.

```
PhaseCode =
  | 'acquisition' | 'planning' | 'conditions' | 'design' | 'procurement'
  | 'strip_out' | 'construction' | 'testing' | 'building_control'
  | 'practical_completion' | 'marketing' | 'unit_completions'
  | 'sales' | 'maturity_tail' | 'other'

DependencyType = 'FS' | 'SS'

Dependency:
  phase_id:   string
  type:       DependencyType
  lag_months: integer >= 0

Phase:
  id:              string          -- identity; unique
  code:            PhaseCode
  label:           string          -- free text
  duration_months: integer >= 0    -- 0 = milestone (§18.3)
  slip_months:     integer         -- SIGNED; default 0; negative = acceleration
  start_offset:    integer >= 0    -- earliest-start floor, default 0
  curve:           SpendCurve
  predecessors:    Dependency[]

ProgrammeNetwork:
  anchor_month:        string | null     -- unchanged from v4; a display label
  phases:              Phase[]
  category_phase_ids:  { construction: string, professional: string, statutory: string }
```

`code` is the audit's own fourteen phase types plus `other`, mirroring R10's
`CostPackage.code` treatment (§16.2): a fixed enum plus a free `label` makes
programmes comparable across appraisals while still admitting the phase a
particular scheme has that the enum does not. **Duplicate `code`s are allowed**
(two `other` phases, three `construction` phases for a phased block release);
**duplicate `id`s are not** — `id` is the identity that dependencies,
`category_phase_ids`, cost lines and sale anchors all reference.

`curve` is the existing `SpendCurve` (`straight_line` | `s_curve` |
`back_loaded` | `user_defined`), unchanged, including the residue-absorption
invariant.

### Why `start_offset` survives alongside `predecessors`

It is an **earliest-start floor**, not an override. This is the single decision
that keeps the schema from having two sources of truth for one date:

- a phase with no predecessors starts at `start_offset` (default 0);
- a phase with predecessors starts at the **later** of its floor and its
  constraints;
- there is no state in which a phase has both a "derived" and an "actual" start
  that can disagree.

It also does the migration's work for free (§18.7): a v8 package becomes a
predecessor-free phase whose floor *is* its old `start_offset`, so the derived
window equals the old window by construction rather than by arithmetic
coincidence.

The alternative considered and rejected was an absolute `start_offset` that
overrides the derived start when set, with a warning where it precedes a
predecessor's finish. That is two dates for one phase, a warning that exists
only to describe an inconsistency the schema permits, and a slip lever whose
effect depends on which of the two is live.

---

## 4. §18.2 — The derivation

One rule, applied over a topological order of `phases`:

```
ref(d)   = finish(d.phase_id)   if d.type = 'FS'
         = start(d.phase_id)    if d.type = 'SS'

start(p) = slip_months(p)
         + max( start_offset(p),
                max over d in predecessors(p) of ( ref(d) + lag_months(d) ) )

finish(p) = start(p) + duration_months(p)
```

The window is **half-open**: `[start, finish)`, occupying months
`start … finish − 1`. This matches §6.1's existing convention, where a package
with `start_offset = 1, duration_months = 4` occupies months 1–4.

`max` over an empty predecessor list is `−infinity`, so a predecessor-free phase
starts at `slip_months + start_offset`.

**Programme finish** = `max over all p of ( finish(p) if duration_months(p) ≥ 1
else start(p) + 1 )` — the first month index no phase occupies. The milestone
arm is inside the same maximum, not a fallback for when only milestones remain:
a `maturity_tail` milestone sitting three months after the last spend-bearing
phase finishes *is* the programme's end, and a formula that took the maximum
over duration ≥ 1 phases alone would report the programme finishing before its
own final milestone.

### Slip is applied to the phase, and inherited by its successors

`slip_months(p)` is added to `p`'s own start *after* its constraints resolve, so
it delays `p` and, through `ref(d)`, everything that depends on `p`. A slip on a
phase is not a slip on the programme: whether the programme finish moves is
determined by `p`'s float (§18.4), and that asymmetry is the release's primary
falsifiable guard (§13).

**Slip is signed.** A negative `slip_months` is acceleration — *"planning comes
through two months early"* is as legitimate a lender question as the delay, and
an unsigned field would make §12.4's tornado one-sided, its low endpoint an
invalid cell on every programme document. Signing it costs one rule: because
`slip_months` is applied outside the `max`, it can drive a start below zero, and
a resolved `start(p) < 0` is a **hard error naming the phase**, not a clamp to
month 0 (§18.8). Clamping here would silently convert an over-acceleration into
a different, valid-looking programme — the R5 defect exactly.

### Cycles

Evaluation is a topological pass. A cycle has no topological order and there is
no defensible default start for a phase inside one, so it is a **hard validation
error naming the cycle** — `planning → conditions → planning` — not a generic
"invalid programme" and not a silently broken edge. Self-references and
dependencies naming an absent `phase_id` are the degenerate cases and are
errored the same way.

---

## 5. §18.3 — Milestones

`duration_months = 0` is a milestone. Practical completion is the obvious one;
so is a funder's first-draw date or a warranty sign-off.

- `finish = start`, so an `FS` successor with `lag_months = 0` starts in the same
  month the milestone falls.
- A milestone **occupies no month** and **may carry no spend**. A cost line
  resolving to a milestone is a **hard error**, not a silent zero — dropping
  money the user entered without saying so is the worse failure (the rule R10
  §16.2 settled for detailed-mode compliance figures).
- `curve` on a milestone is ignored. It is not removed from the record, because
  a milestone that later gains a duration should not need its curve re-entered.

---

## 6. §18.4 — Float and the critical path

A backward pass over the reverse topological order:

```
own_bound(p)   = programme_finish       if duration_months(p) >= 1
               = programme_finish − 1   if duration_months(p) = 0   (milestone)

late_finish(p) = min( own_bound(p),
                      min over successors s of late_ref(p, s) )

late_ref(p, s) = late_start(s) − lag_months(d)                        if d.type = 'FS'
               = late_start(s) + duration_months(p) − lag_months(d)   if d.type = 'SS'

late_start(p)  = late_finish(p) − duration_months(p)

total_float(p) = late_start(p) − start(p)
is_critical(p) = total_float(p) == 0
```

(`d` is the dependency on `s` that names `p`. The inner `min` over an empty
successor list is `+infinity`, so a phase with no successors takes its
`own_bound`.)

### `own_bound` applies to every phase, not only the successorless ones [corrected during R12 implementation]

The textbook formulation bounds late finish by the project end **only** for
activities with no successors, and takes the successor minimum otherwise. That is
wrong here, and this spec carried the error until Task 2's float tests caught it.

**An `SS` edge constrains the successor's *start*. It says nothing about the
predecessor's *finish*.** So a phase can have successors and still be the phase
whose own finish defines the end of the programme:

> `construction` runs 10 months from month 0. `marketing` starts `SS + 6` and runs
> 2 months, finishing at month 8. The programme finishes at month 10 — set by
> construction. The successor-only rule gives
> `late_finish(construction) = late_start(marketing) + 10 − 6 = 12`, hence a total
> float of **2**. Delay construction by one month and the programme finishes at 11.
> Its true float is **0**.

A lender reading that report would see two months of free buffer on the one
activity that has none. Taking the minimum against `own_bound` for every phase is
what standard CPM achieves with an implicit project-end node that every activity
ultimately feeds; stating it as a bound rather than a node is the same rule
without the phantom vertex.

The milestone arm of `own_bound` mirrors §18.2's programme-finish formula: a
zero-duration phase contributes `start + 1` to the finish, so its own bound is
`programme_finish − 1`. Without it a trailing `maturity_tail` milestone — the
phase that *defines* the finish — reports a float of 1.

Neither correction can produce negative float. For `duration >= 1`,
`programme_finish >= finish(p)` by construction of §18.2's maximum, so
`own_bound(p) − duration(p) >= start(p)`; for a milestone,
`programme_finish >= start(p) + 1`, so `own_bound(p) >= start(p)`. Adding a term
to a `min` only lowers `late_finish`, so it cannot mask a negative float arising
elsewhere either. (Negative float **is** still reachable through a negative
`slip_months` on a successor — §18.2 permits acceleration — and that is a
validation matter, not a derivation one.)

`critical_path` is reported as the list of phase ids with zero float, in
topological order.

This is not ornament. It is what makes the slippage analysis answer the lender's
actual question — *does this delay cost me anything?* — and it is what supplies
the non-commutative test fixture §13 requires: slipping a phase with float ≥ 1
must leave the programme finish **unchanged**, while slipping a critical phase
by *n* must move it by **exactly** *n*.

---

## 7. §18.5 — How phases bind to money

### One resolution rule, both cost modes

```
resolved_phase(line) = line.phase_id  ??  programme.category_phase_ids[line.category]
```

- **Headline mode** has no line rows. Its three totals — construction,
  professional, statutory — resolve straight through `category_phase_ids`.
- **Detailed mode** (R10 §16) gives every `CostPackage` and `FeeLine` an optional
  `phase_id` that overrides the category default. A package's category is
  `construction`; a fee line's is its existing `FeeCategory`
  (`professional` | `statutory`).

`category_phase_ids` is **required** whenever `programme` is a network, in both
modes. This is mode-dependent resolution of a *single* rule, which is the shape
R10's contingency base finally settled on (§16.3) — not the two-input-mechanisms
mistake R11 deleted (`basis`/`package_ids`). The distinction that matters: there
is one accessor, and a line's override and the category default can never both
apply.

Each resolved total then spreads over its phase's derived window with **that
phase's** curve, through the existing `spreadByCurve`. The invariant is
unchanged: each month rounds half-up, the final month of the window absorbs the
cumulative residue, Σ = total.

### Spreading is per (phase, category) BUCKET, not per line [corrected during R12 implementation]

Amounts are **bucketed** by their resolved phase and their category, and each
bucket's **total** is spread once over that phase's window with that phase's
curve. Two lines resolving to the same phase in the same category are one spread
of their combined total, not two spreads summed.

This spec previously said the opposite — that each line spreads independently
and residue is absorbed per line, "unchanged from detailed mode's existing
behaviour". **That claim was factually wrong**, and Task 11 implemented it before
the error was found.

The auto-window arm (§6) and the legacy three-package arm (§6.1) both spread the
**category total** exactly once: `spreadByCurve(professionalTotal, …)`, never a
per-line loop. Per-line spreading is therefore not the existing behaviour; it is
a new behaviour, and it differs from the old one by rounding. Each line absorbs
its own residue, so `Σᵢ round(tᵢ · w) ≠ round((Σᵢ tᵢ) · w)` in general — the
category total is preserved, but its **monthly distribution** shifts by pennies.

That is not cosmetic. §18.7's migration identity gate asserts every computed
figure is penny-identical across the v8→v9 boundary, and a v8 document's
professional spend is a single spread of the total while its migrated v9 twin's
would be eight separate spreads of eight synthesised fee lines. The gate would
fail on documents where the amounts do not divide evenly — and pass on those
where they happen to, which is worse, because the defect would then depend on
the fixture rather than on the rule.

Bucketing restores identity **by construction** rather than by arithmetic luck:
when every line in a category resolves to the category default — which is exactly
what migration produces, since it writes no per-line `phase_id` — the bucket
total *is* the category total and the spread is bit-identical to the legacy arm's.
Per-line overrides still work: a line tagged to a different phase simply joins a
different bucket.

**The prior-approval carve-out stays per line**, because it is a placement
decision rather than a rounding one: an untagged `prior_approval` fee is pinned
to month 0 and never enters a bucket, while a tagged one joins its phase's bucket
like any other line. A single category-level lump could not tell those two cases
apart.

### The two month-0 anchors that survive

**Acquisition stays at month 0, unconditionally.** It is the completion date and
the origin of the term. The `acquisition` phase in the catalogue is therefore a
*displayed, zero-spend* phase representing the purchase process; re-timing the
consideration is deferred consideration and overage, which is R15's. Stated as
a limitation (§18.10) rather than left to be discovered.

**The `prior_approval` fee keeps its month-0 pin by default**, and moves only if
it carries an explicit `phase_id` (in practice, `planning`). Today §3.4 pins it
to month 0 while every other statutory line spreads with the professional curve;
`schedule.ts:41-47` already keys this on the fee **code**. Defaulting it to
`category_phase_ids.statutory` instead would move it on every migrated document,
because a migrated statutory phase's window is the old statutory window, which is
not month 0. The default exists to hold migration identity (§18.7) and this
paragraph is the reason it exists.

---

## 8. §18.6 — Exit timing

The R12/R13 seam: **R12 ships *when*, R13 ships *how much*.**

`sales_phasing.tranches[]` and `refinance` each gain:

```
anchor: { phase_id: string, offset_months: integer } | null
```

```
resolved_month = anchor ? start(anchor.phase_id) + anchor.offset_months
                        : month_offset
```

`anchor: null` is the migration default, so every stored document's receipts land
exactly where they land today. `month_offset` is retained and remains the value
used when `anchor` is null; it is not deprecated, because an unanchored disposal
date is a legitimate thing to model.

Where an anchor is set, a construction slip moves the receipts — and therefore
peak debt, interest, IRR, the sources-and-uses profile and cost-to-complete. That
propagation is the audit's "exit slippage", and it is the reason the stop-at-PC
option was rejected: a programme that slips PC while the sale date stays pinned
models a delay with no consequence.

An anchor may only reference a phase that exists. It **may** reference a
milestone — a tranche anchored to `practical_completion + 2` is the canonical
case, and is exactly why milestones carry a start even though they occupy no
month.

---

## 9. §18.7 — Migration and the persistence boundary

```
v8 programme: null           →  v9 null                       (untouched)
v8 programme: { packages }   →  v9 { anchor_month, phases[3], category_phase_ids }
```

For each of the three packages, in the fixed order construction, professional,
statutory:

| v9 field | Value |
|---|---|
| `id` | the package name — `'construction'`, `'professional'`, `'statutory'` |
| `code` | `construction`, `design`, `planning` respectively |
| `label` | `'Construction'`, `'Professional'`, `'Statutory'` |
| `duration_months` | the package's `duration_months` |
| `start_offset` | the package's `start_offset` |
| `slip_months` | `0` |
| `curve` | the package's `curve`, unchanged |
| `predecessors` | `[]` |

`anchor_month` carries across unchanged. `category_phase_ids` becomes
`{ construction: 'construction', professional: 'professional', statutory: 'statutory' }`.
No `CostPackage` or `FeeLine` gains a `phase_id`. `sales_phasing` tranches and
`refinance` gain `anchor: null`.

**All four scenarios** gain `phase_slip_phase_id: null` and
`phase_slip_months: 0` (§18.9). Both are no-ops by construction: `applyScenario`
matches the id against each phase, and `null` matches none.

Every one of these five additions is a written `null` or `0` — the migration
adds no value that any engine reads as live. That is the property the identity
gates below actually test.

Because a predecessor-free phase's start *is* its floor (§18.1), every derived
window equals the old window identically, for every curve and every term.

**The persistence boundary.** R10 and R11 both lost time here. The v9 additions
must round-trip through the Python model, whose config is `extra='ignore'`: a
field the Pydantic model does not declare is dropped silently on the way in, so a
structural assertion of the form `"phase_id" not in row` can hold even with the
migration helper bypassed entirely (R11's third vacuous guard). The boundary
tests therefore assert the **presence and value** of every new field after a full
save/load round trip, not its absence before one.

### The migration must add no validation issue either

R11's central lesson: a migration that moves no number can still downgrade every
short-term appraisal to DRAFT by adding a hard validation error from a block the
engine ignores. The v8→v9 gate is therefore the pair:

1. **Numeric identity** — every fixture, every computed figure, penny-identical
   across migration, both engines.
2. **Validation identity** — `validateInputs` returns the **same issue set**
   before and after migration, over every fixture plus synthetic **term-1** and
   **term-2** documents.

**The one exemption to (2), and how it is bounded.** The v8 sale-tail rule
reports its field as `programme.packages.<name>`; the v9 rule reports
`programme.phases.<id>`. Migration assigns `id = <name>` precisely so these
correspond one-to-one, and the gate compares issue sets under a declared alias
map of exactly three entries. A test asserts the alias map has **three** entries
and that every other issue matches on field and message with no aliasing at all.
The exemption cannot be widened without failing that test, which is the property
R11 required of it: narrow by construction, not narrow by intention.

---

## 10. §18.8 — Validation

New hard errors (input errors, not flags), applying only when `programme` is a
network:

| Rule | Message shape |
|---|---|
| duplicate `id` | names the repeated id |
| dependency names an absent `phase_id` | names the phase and the missing id |
| self-reference | names the phase |
| cycle | names the cycle in order — `planning → conditions → planning` |
| `duration_months` / `lag_months` / `start_offset` negative | names the field |
| any of `duration_months` / `slip_months` / `lag_months` / `start_offset` fractional or non-finite | names the field (`slip_months` may be negative but must be a whole number) |
| resolved `start(p) < 0` — over-acceleration | names the phase and the resolved start |
| `user_defined` weights: length ≠ `duration_months`, non-finite, negative, or summing to ≤ 0 | §6.1's four rules, unchanged, per phase |
| `category_phase_ids` references an absent id, or a **milestone** | names the category |
| a cost line's `phase_id` references an absent phase, or a **milestone** | names the line |
| `phases` is empty | a network with no phases is not a network |
| **`programme.overrun`** | names the offending phase and the overrun in months |
| pre-PC phase breaches the sale tail | §6.1's message, unchanged |
| resolved tranche months not strictly increasing | names the tranche |
| an `anchor` referencing an absent phase | names the tranche or `refinance` |
| a scenario's `phase_slip_phase_id` naming an absent phase, or set while `programme` is `null` | names the scenario |
| a `phase_slip` axis or tornado range with `phase_id` null, or a non-`phase_slip` one with `phase_id` set (§12.6) | names the axis or range |

### The two window rules, stated exactly

Let `term = max(1, floor(finance.term_months))`. The last valid month index is
`term − 1`.

- **Overrun (all phases).** For `duration_months ≥ 1`: `finish(p) ≤ term`. For a
  milestone: `start(p) ≤ term − 1`. A breach is `programme.overrun`, reported
  against the phase, quoting the derived finish, the term and the difference —
  *"Programme finishes month 21; facility term is 18. Phase 'marketing' ends 3
  months after maturity."*

- **Sale tail (the pre-completion codes).** `finish(p) ≤ term − 1` for
  `duration_months ≥ 1`, i.e. the last occupied month index is `term − 2`; for a
  milestone, `start(p) ≤ term − 2`. §6.1's existing rule, with its existing
  message.

  The rule binds by **code-set membership**, not by position in the network:

  ```
  PRE_COMPLETION_CODES = acquisition, planning, conditions, design, procurement,
                         strip_out, construction, testing, building_control,
                         practical_completion
  ```

  `practical_completion` is itself in the set — PC is the boundary and must fall
  inside the tail, not on it. Everything from `marketing` onward is outside.

**Why the tail rule was scoped rather than dropped or widened.** The two-month
tail exists because §4.4 places a disposal the model did not otherwise represent
in the final month. Once marketing, unit completions and sales are explicit
phases, the reservation *is* those phases, and applying a tail reservation to
them would reserve the tail against itself. Scoping it to the pre-completion
codes keeps it binding on exactly the phases it has always bound, which is why a
migrated three-phase network — whose codes are `construction`, `design` and
`planning`, all in the set — produces an identical issue set. `other` is **not**
in the set: an unclassified phase gets the weaker rule, because the alternative
is a hard error nobody can act on.

This is not a convenience. R11's release was defined by a guard that died from
being widened, and the tail rule would have died the same way had it simply been
relaxed to `term` for everything.

### Validation is not the schedule's clamp

`schedule.ts` and `schedule.py` both clamp month indices into range as
belt-and-braces (the documented CRITICAL 1b/1c defence: an unvalidated negative
index is `undefined` in JS and wraps to the end of the list in Python). Those
clamps stay, and they stay **unreachable for any document that passes
validation**. The derivation must never be the thing that decides a phase fits.

---

## 11. §18.9 — Sensitivity: the `phase_slip` lever

§12.1 gains a fifth lever:

| Lever | Unit | Effect on the inputs document |
|---|---|---|
| `phase_slip` | months | adds to `programme.phases[<id>].slip_months` for a named phase |

### The lever needs a target, and that reaches two shapes it must not bypass

The existing four levers are scalars: `SensitivityLever` is a bare string union
and `overridesFor()` maps each to one field of `ScenarioOverrides`. `phase_slip`
is the first lever that needs a **target** as well as a magnitude, and following
that through the existing code changes two shapes. Both changes are required;
neither is optional, and the alternative in each case is worse.

**1. `SensitivityAxis` and `TornadoRange` gain `phase_id: string | null`.**
Required when `lever === 'phase_slip'`, and required to be `null` otherwise —
both hard validation errors under §12.6. Two consequences for existing rules:

- the "rows and cols must differ" check (`sensitivity.ts:168`) compares the pair
  `(lever, phase_id)`, not `lever` alone — two `phase_slip` axes targeting
  different phases are a legitimate matrix and must not be rejected as duplicate;
- the tornado's duplicate-lever check (`sensitivity.ts:184`) keys the same pair,
  so a tornado may carry one bar per slipped phase.

Encoding the target in the lever string instead (`'phase_slip:planning'`) was
rejected: `LEVER_ORDER` is a closed set and the §12.6 membership check is what
stops a misspelled lever reaching the engine. A lever whose name is
user-composed cannot be a member of a closed set, so that check would have to be
loosened into a prefix match — the exact shape R10 caught when a `=== 6`
predicate had been loosened to `!== 5`.

**2. `ScenarioOverrides` gains `phase_slip_phase_id: string | null` and
`phase_slip_months: number`.** Every lever reaches the document through
`applyScenario()`, which takes a `ScenarioOverrides` and is the single point at
which an inputs document is adjusted for *both* the four named scenarios and
every sensitivity cell. A lever that bypassed it would be the only one that did,
and the two adjustment paths would diverge silently.

`ScenarioOverrides` is a **stored** block (`scenarios.{base,upside,downside,
severe}`), so this is a v9 schema addition and part of the migration (§18.7),
not a runtime-only type. That is a gain, not a cost: the four named scenarios can
then express slippage directly — a downside case whose planning slips three
months is the single most common thing a credit paper models, and today it is
inexpressible.

`applyScenario` writes the slip additively onto the named phase and leaves every
other phase untouched:

```
phase.slip_months += (overrides.phase_slip_phase_id === phase.id)
                     ? overrides.phase_slip_months : 0
```

Additive, not assignment, so a base-case slip already recorded on the document is
stressed **from** its recorded position rather than overwritten by it. An
override naming a `phase_id` no phase carries, or naming one while `programme` is
`null`, is a hard validation error (§18.8) — not a silent no-op, which is what
would make the lever look live while doing nothing.

§12.1 requires that any lever added in a later release define its composition
order **at the time it is added**. `phase_slip` writes a field no other lever
touches — `gdv` writes unit values, `construction_cost` writes the rate,
`timeline` writes `finance.term_months`, `interest_rate` writes the rate — so the
five levers still write to disjoint fields and application remains
order-independent. That property is **asserted**, not merely stated: a test
applies all five in several orders to one document and requires identical
results.

§12.2's facility invariance is untouched; `phase_slip` writes nothing under
`finance` or `equity_sources`.

The lever is **signed**, matching `slip_months` (§18.2), so a tornado endpoint
pair of −2 / +2 months is expressible and symmetric. A cell whose slip pushes the
derived finish past maturity raises `programme.overrun`; a cell whose
acceleration drives a start below month 0 raises the over-acceleration error.
§12.7's cell-validity machinery (R5, calc 2.5.0) already turns a hard input error
into an **invalid cell** rather than a plausible wrong number, so no new
mechanism is needed — but the fixtures asserting both directions are new, and
they are the point of the whole lever.

`phase_slip` on a `programme = null` document has no field to write. It is
rejected at validation as a lever misconfiguration rather than silently ignored.

---

## 12. §18.10 — Outputs, reporting and stated limitations

### The result block

`Schedule` gains `programme`:

```
ProgrammeResult:
  finish_month:   integer
  critical_path:  string[]            -- phase ids, topological order
  phases: Array<{
    id, code, label,
    start_month, finish_month,
    duration_months, slip_months,
    total_float_months, is_critical
  }>
```

`programme` is `null` on the auto path, exactly as the input is. It is **not**
synthesised for auto-window documents: a derived block on a document that never
asked for one is decision 6 in reverse, and the auto path genuinely has no
dependency structure to report.

### Reporting

- `ProgrammePage` gains the phase editor and a Gantt with the critical path
  marked and float shown; the three-package editor is replaced.
- The investment memo gains a programme section: the phase table, the critical
  path, the derived finish against the facility term, and any slip recorded on
  the base case.
- `programme.overrun` is a hard error, so it makes `report_safe` false and marks
  the report **DRAFT** through the existing §13.3 mechanism. No new
  `DraftReason` is invented for it — it is an input error like any other.

### Stated limitations

1. **The `programme = null` path can never show slippage.** Auto-window documents
   have no phases, no float and no critical path. This is the price of decision
   6, taken deliberately: the alternative moved a derived block onto every stored
   document.
2. **Acquisition is fixed at month 0** (§18.5). Deferred consideration and
   overage are R15.
3. **No calendar dates.** `anchor_month` remains a display label; the model is
   month-offset throughout, and phases inherit that.
4. **No planned-versus-actual.** `slip_months` records a delay or an
   acceleration as a single signed number; it does not record a reporting date, a
   certified position or a QS forecast. That is R14's monitoring case, which will
   write this same field.
5. **No resource levelling, no calendars, no non-working periods.**
6. **`FF` and `SF` dependency types are not supported** (decision 8).
7. **Rounding residue is absorbed per (phase, category) bucket.** Two lines
   resolving to the same phase in the same category are spread once, as their
   combined total. This matches the auto and legacy arms, which spread the
   category total exactly once, and it is what keeps §18.7's penny-identity gate
   true by construction rather than by arithmetic coincidence (§18.5).
8. **Total float only.** `total_float_months` is float against the programme
   finish. Free float — the delay a phase can absorb without moving its immediate
   successors — is not derived. Total float is what answers the lender's
   question; free float would be a second number readers would have to be taught
   to tell apart from the first.

---

## 13. Guards this release must watch fail

R11 shipped five guards that passed while asserting nothing. Each guard below is
written with the counter-example it must reject.

**1. Float asymmetry.** Slipping a phase with `total_float ≥ 1` leaves the
programme finish **unchanged**; slipping a critical phase by *n* moves it by
**exactly** *n*. Both arms asserted on absolute month numbers. R11's fourth
vacuous guard was an ordering test whose fixture made both arms algebraically
equivalent — float is precisely what breaks the commutativity here, so the
fixture must contain a phase with non-zero float, and a test asserts that it
does.

**2. Propagation, absolutely.** The slip fixture asserts the successor's
**absolute** start month and the resulting **absolute** peak debt and total
interest — not that they moved, and not their direction. R11's fifth vacuous
guard was direction-only and blind to a constant added to both sides.

**3. Cycle negative control.** A cyclic document errors, naming the cycle; its
acyclic twin, differing by **one** dependency, does not. Without the twin, an
over-eager detector that rejected every network would pass.

**4. Anchor liveness.** An anchored tranche and its absolute-month twin produce
**identical** receipts at zero slip and **divergent** receipts at non-zero slip.
Without the second arm, `anchor` is indistinguishable from a no-op.

**5. Category-map liveness.** Two documents identical but for
`category_phase_ids.professional` pointing at a different phase produce different
professional spend profiles. Without this, the map could be read by nothing.

**6. Migration identity, both axes.** §18.7's numeric and validation gates, with
the three-entry alias assertion bounding the one exemption.

**7. Lever order-independence.** All five levers applied in several orders to one
document give identical results (§18.9).

**Guards deliberately not written**, because they would be vacuous by
construction: any assertion that every phase's `code` is in `PhaseCode` (the type
guarantees it — R11's first vacuous guard); any assertion that
`finish = start + duration` (true by construction of the implementation's own
addition — R11's second).

**EOL discipline.** R11 found `golden-fixtures.test.ts` committed as a binary
blob — CRLF plus NUL separators, invisible to every suite. Any file this release
rewrites wholesale gets `git ls-files --eol` checked before commit.

---

## 14. Also in scope

- Spec §18 written; §6.1 marked superseded for the explicit-programme case, with
  §6's auto-window text left intact.
- `docs/financial-model/migration-notes.md` gains the v8 → v9 entry.
- New fixture `s-dated-programme.json`: a full fourteen-phase network with a
  non-zero-float phase, an anchored two-tranche sale, a detailed cost plan with
  per-line `phase_id` overrides, and a levered facility so slippage reaches
  interest and peak debt.
- Fixture `h-programme-scurve.json` migrates to v9 and pins the migrated
  three-phase network.
- Both `migrate.py` blocks' stale `calc … → next` headers corrected (carried from
  R11).

## 15. Out of scope

R13 (exit economics: unit sales, NOI, yield, vacancy, DSCR/ICR, refinance
stress). R14 (monitoring actuals; lender case governance; **C1**, the §5.10
rolled-up-interest defect; `lender_eligible` wiring). R15 (QS source/date/status,
fixed-price coverage, provisional sums, inflation; deferred consideration and
overage). R16 (the *delayed planning/PC* sensitivity **preset** — R12 ships the
lever it needs, not the preset itself; legacy column removal).

Still open from R7: PDF/UA tagging, raster visual regression, the jsPDF
Symbol-font warning. Still open from R11: `MonthUses.lender_ancillary_fees_pence`
is dead; `documentStatus` has no production caller; the cashflow table shows a
reclaim's repayment with no reclaim column; the
`.claude/worktrees/release-3b-exits-ui` tree is still tracked.

## 16. Shape of the work

Roughly: the derivation engine and its float/critical-path pass, mirrored in both
languages; the v9 schema, migration and persistence boundary; the cost-line
resolution rule; the exit anchors; validation; the `phase_slip` lever; the result
block; the Gantt and phase editor; the memo section; fixtures and the seven
guards. The implementation plan is the next artefact.
