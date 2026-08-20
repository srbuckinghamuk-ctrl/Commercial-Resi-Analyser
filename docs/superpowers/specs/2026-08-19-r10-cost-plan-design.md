# R10 — Cost-plan modes, contingency separation and fee bases

Date: 2026-08-19
Release: R10 of the second lender-readiness audit remediation
Audit source: `docs/reviews/2026-08-17-lender-readiness-second-audit.md` §7.5 (lines 22, 200–206)
Release plan: `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`
Schema: inputs v6 → **v7** · Calc: 2.8.0 → **2.9.0** (minor)

---

## 1. The defect

The whole construction cost stack is one rate, one percentage and three flat
figures (`conversion-calc-engine.ts:107`, `schedule.py:100`):

```
base        = round_half_up(construction_cost_per_sqm_pence × developed_area_sqm)
contingency = round_half_up(base × contingency_pct / 100)
compliance  = fire_safety_pence + sound_insulation_pence + part_l_compliance_pence
total       = base + contingency + compliance
```

Professional and statutory fees are eight further flat pence fields on the same
block (`conversion-types.ts:23`, `types.py:108`).

Four consequences, in ascending order of severity.

**No package schedule.** A QS cost plan cannot be entered at all. There is
nowhere to record enabling works, structure, envelope, M&E or externals as
priced lines, so the appraisal cannot carry the document a lender's monitoring
surveyor actually works from. The audit's word for the present model is
"screening-level".

**One contingency, on an implicit base.** General design development shares a
single percentage with existing-building risk (asbestos, opening up, unknown
structure) and abnormal risk — the three things a *conversion* lender most wants
separated, because they have different probabilities and different evidence.
The base is prose, not data: `export-investment-memo.ts:2046` prints the string
`'On base build cost only'` beside the rate, and nothing computes or displays
the base figure that sentence describes.

**Fees cannot be percentages.** An architect engaged at 6% of construction has
to be typed in as a pence figure. It then does not move when construction moves
— under a cost stress, under a scenario, or when the cost plan is revised. The
fee is frozen against the thing it is defined as a proportion of.

**The cost lever does not reach a package.** `applyScenario`
(`apply-scenario.ts:52`, `apply_scenario.py:39`) implements
`construction_cost_adjustment_pct` as, and only as:

```ts
construction_cost_per_sqm_pence: Math.round(
  inputs.conversion_costs.construction_cost_per_sqm_pence * costMultiplier,
)
```

Every scenario (base/upside/downside/severe), every tornado bar, both two-way
matrix axes and every sensitivity cell routes its cost stress through that one
field. A detailed-mode appraisal whose cost lived in packages would be **immune
to every cost stress in the product** while still rendering a tornado chart
showing it responding.

This is the release's principal hazard. It is not a downstream consequence to be
cleaned up afterwards — it is created by the feature itself, on the day the
feature lands, and it fails silently and confidently. §3.5 and §8 exist for it.

---

## 2. Non-goals

Stated so the plan cannot quietly grow into them.

- **VAT by cost line.** Rate, recoverable proportion, reclaim timing and
  adviser-confirmed status are **R11**. R10 does not change the existing
  disclosure that entered figures are net of recoverable VAT.
- **Per-package programme.** Packages aggregate into the existing single
  `programme.packages.construction` window and curve. Per-package
  start/duration/curve is **R12**, which owns dated dependent phases and can
  then attach dates to packages that already exist.
- **Draw eligibility in the ledger.** `lender_eligible` is recorded, and the
  eligible base is computed and displayed, but the monthly draw cap
  (`development_cost_advance_pct` of eligible development costs) keeps using the
  construction total. Wiring it is **R14**, with its own hand-derived levered
  fixtures. See §3.2.
- **QS provenance.** Source, date, status, fixed-price coverage, provisional
  sums, package exclusions and inflation allowance are **R15**, where the
  evidence vocabulary (`EvidenceStatus`, RAG+unknown) already lives.
- **Cost sensitivity presets.** "Abnormal cost" as a standard lender button is
  **R16** (audit line 314). R10 makes the existing generic cost lever work in
  both modes; it adds no new lever.
- **No benchmark rate library.** The model prices what it is given. It does not
  ship BCIS or any other cost index, and it does not judge a rate as high or low.
- **No cost-plan approval state.** Locking a cost plan into a lender case is
  **R14**.

---

## 3. Design

### 3.1 The mode switch

`ConversionCostInputs` is shared with the v1 document shape, so — exactly as
`AcquisitionInputsV5` in R8 and `UnitMixInputsV6` in R9 — R10 **extends rather
than edits**. A new `cost_plan` block lands on `CalculatorInputsV7`:

```ts
export type CostPlanMode = 'headline' | 'detailed';
```

The two modes are **mutually exclusive**, and that is enforced rather than
assumed: headline mode carrying packages is a hard validation error, and so is
detailed mode carrying none (§5). A mutual exclusion that is only documented is
a comment.

**Headline stays rate × area; detailed is priced lump sums.** Packages
deliberately do *not* each carry their own rate and area. Doing so would
reintroduce precisely the two-numbers-one-fact condition R9's area bridge exists
to remove — the model would then hold package areas with no stated relationship
to `developed_gia_sqm`, and would need a second area reconciliation nobody has
asked for. A QS prices a package; the rate is the QS's working, not the
appraisal's input.

### 3.2 Packages

```ts
export type CostPackageCode =
  | 'enabling_strip_out_asbestos' | 'structure' | 'envelope' | 'roof_windows'
  | 'fire_acoustic_thermal' | 'mech_elec_public_health' | 'drainage_utilities'
  | 'lift' | 'partitions' | 'finishes' | 'common_parts' | 'externals' | 'other';

export interface CostPackage {
  id: string;
  code: CostPackageCode;
  label: string;
  amount_pence: number;
  contingency_class: ContingencyClassName;
  lender_eligible: boolean;
  notes: string;
}
```

The twelve codes are the audit's own list (§7.5), plus `other`. A fixed enum
plus a free `label` makes it a *schedule* — groupable, comparable across
appraisals, reportable — rather than free text, while still admitting the line a
particular scheme has that the enum does not.

**Duplicate `code`s are allowed; duplicate `id`s are not.** Real cost plans
carry two externals lines or three finishes lines with different labels, and
forbidding that would push users into `other`, destroying the grouping the enum
exists for. Ids are the identity contingency classes reference (§3.3), so a
duplicate id is a hard error.

`lender_eligible` and the derived `lender_eligible_base_pence` are **recorded
and displayed only in R10**. The ledger's draw cap is untouched. The spec text
defining the field must say so at the point of definition, so that a reader
cannot reasonably infer the figure is live — a recorded-but-inert eligibility
flag that *looks* live is worse than none.

#### 3.2.1 Compliance allowances, and the double count they would otherwise cause

`fire_safety_pence`, `sound_insulation_pence` and `part_l_compliance_pence` are
today a third component of the construction total, added after contingency. The
detailed-mode package enum contains `fire_acoustic_thermal` — which is the same
money. A document carrying both would double-count it, and would do so
invisibly, because both figures are legitimate in isolation.

The resolution:

- **Headline mode** keeps the three compliance fields exactly as they are.
  `compliance_pence` is their sum, added after contingency, unchanged.
- **Detailed mode** expects compliance to be priced inside the packages —
  `fire_acoustic_thermal` exists for precisely that. `compliance_pence` is
  **0**, and a detailed-mode document carrying any non-zero compliance field is
  a **hard validation error** (§5).

A hard error rather than a silent zeroing because silently dropping money the
user entered is the worse failure. To keep that from being merely obstructive,
the UI's mode switch offers a one-click conversion of the three compliance
figures into a single `fire_acoustic_thermal` package (§6) — so the normal path
through the error is one click, and the money is visibly moved rather than
quietly lost.

**Compliance responds differently to a cost stress in the two modes, and must.**
In headline mode `compliance_pence` is a fixed allowance the cost lever does not
scale — pre-R10 behaviour, which R10 must not change. In detailed mode the same
money sits inside a package, and packages *are* scaled (§3.5). So the two modes
agree on the construction total at rest and diverge under stress once compliance
is non-zero.

This is a real behavioural consequence of moving compliance into the priced
works, not an inconsistency to engineer away. Scaling headline compliance too
would move existing documents' scenario figures, which this release forbids;
exempting a compliance package from the stress would make it the one package the
cost lever cannot reach, recreating §1's defect in miniature. It is recorded as a
stated limitation in §16 rather than hidden.

It has one direct consequence for testing: the §8 cross-mode equivalence pair
carries **zero compliance**, so that it tests the cost lever rather than this
known asymmetry.

### 3.3 Contingency — one engine, three classes, a named base

```ts
export type ContingencyClassName = 'general' | 'existing_building' | 'abnormal';

export interface ContingencyClass {
  name: ContingencyClassName;
  pct: number;
  /** 'all_packages' — the whole base build (and, in headline mode, the only
   *  option, since there are no packages to name).
   *  'selected_packages' — the named subset. */
  basis: 'all_packages' | 'selected_packages';
  package_ids: string[];
}
```

Each class rounds **half-up independently** per §1.1; the contingency total is
the sum of the three rounded figures, not a rounding of the sum. Three classes
at 5% each on the same base is deliberately not identical to one class at 15% —
they are three separate allowances, each computed and each reportable, and
collapsing them for rounding purposes would obscure which one moved.

The `selected_packages` basis is the audit's "allow eligibility bases per
package and show the base": existing-building contingency belongs on
enabling/strip-out/structure, not on externals, and the base it lands on has to
be visible to be arguable.

**The structural decision: `cost_plan.contingency` is the only contingency input
from v7 onward, in both modes.** `conversion_costs.contingency_pct` is
deprecated exactly as `sdlt_pence` was in R8 — retained so pre-R10 readers keep
working, removed in R16, and placed behind the same eslint single-accessor guard
that `total_construction_sqm` sits behind (`frontend/eslint.config.js`, proven
by `accessor-guard.test.ts` through ESLint's Node API at `severity === 2`).

The reason is R9's hardest-won lesson, applied before rather than after the
fact. The easy alternative — headline mode keeps reading `contingency_pct`,
detailed mode uses the new classes — would make the migration identity gate
**provably blind**: all twelve golden fixtures would come out penny-identical
because the old code path would still be the one running for all of them. That
is the same defect as R9's synthesised-bridge gate, which passed while consuming
nothing.

Routing **both** modes through one contingency engine means migration copies
`contingency_pct` into `general.pct` on the `all_packages` basis, the new code
computes every existing appraisal's contingency, and "all twelve fixtures
identical to the penny" becomes an assertion that could actually fail.

### 3.4 Fee bases

Same shape, same reasoning.

```ts
export type FeeBasis = 'fixed' | 'pct_of_base_build' | 'pct_of_construction_total';

export interface FeeLine {
  id: string;
  code: FeeCode;
  category: 'professional' | 'statutory';
  label: string;
  basis: FeeBasis;
  /** basis 'fixed' → the amount. Hard-validated to 0 on a 'pct_*' basis. */
  amount_pence: number;
  /** basis 'pct_*' → the percentage. Hard-validated to 0 on 'fixed'. */
  pct: number;
  /** Preserves §3.6's `prior_approval_fee_per_dwelling × max(1, unit_count)`.
   *  Hard-validated false on any 'pct_*' basis — a percentage per dwelling is
   *  not a meaningful quantity. */
  per_dwelling: boolean;
}
```

**The category mapping is fixed, not a user choice, and it is not what the field
names suggest.** §3.5 and §3.6 already classify these eight figures, and R10
must not reclassify them — professional and statutory totals are separately
reported, separately spread across the programme, and separately reconciled:

| `code` | `category` | Migrated from |
|---|---|---|
| `architect` | professional | `architect_pence` |
| `structural_engineer` | professional | `structural_engineer_pence` |
| `mande` | professional | `mande_pence` |
| `planning_consultant` | professional | `planning_consultant_pence` |
| `other_professional` | professional | `other_professional_fees_pence` |
| `prior_approval` | **statutory** | `prior_approval_fee_per_dwelling_pence`, `per_dwelling: true` |
| `cil_s106` | **statutory** | `cil_s106_pence` |
| `building_control` | **statutory** | `building_control_pence` |

`building_control` is the one to get wrong: it sits in the middle of the
professional-fee block in `ConversionCostInputs` and reads like a consultant
fee, but `schedule.ts` and `schedule.py` both count it in the **statutory**
total (§3.6). A migration that classified it as professional would move money
between two separately-reported lines while leaving every total correct.

`other` is available for user-added lines and must carry an explicit category.

**Double counting is prevented by the base definitions, not by a check.**

- `pct_of_base_build` — the base build alone: Σ packages in detailed mode, or
  `rate × developed_area_sqm` in headline mode. Excludes contingency, compliance
  and all fees.
- `pct_of_construction_total` — base build + contingency + compliance. Excludes
  all fees.

No fee basis includes fees, so no fee can feed its own base or another fee's,
and the resolution needs no ordering, no iteration and no cycle detection. A
check that *detected* double counting would be strictly worse than a base
definition that cannot express it.

The actual double-count trap is keeping the eight old fee fields live alongside
new fixed lines carrying the same money. So the old fields are **deprecated on
the same terms as `contingency_pct`**: migration converts all eight into `fixed`
lines, the cost engine reads only `fee_lines`, and R16 removes them.

**Statutory timing must survive the move.** `schedule.ts` / `schedule.py` do not
spread the statutory total evenly: prior approval lands in month 0 in full, and
CIL/S106 plus building control spread with the professional curve (§3.6). When
statutory fees become `fee_lines`, that split is preserved by the rule **the
line with `code: 'prior_approval'` lands in month 0; every other statutory line
spreads** — the same behaviour, keyed on the code rather than on a hard-coded
field name. R12 generalises fee timing; R10 must not change it. A cross-mode or
migration test that only checks *totals* will not notice this moving, so the
month-0 statutory figure is pinned explicitly (§8).

**One carve-out, stated so an implementer does not "fix" it.**
`calculateTotalProfessionalFees` (`conversion-calc-engine.ts:120`) and
`calculate_total_professional_fees` (`schedule.py:114`) are called from exactly
one place each — the v1 legacy-facility-sizing path in `migrate.ts:138` /
`migrate.py:435`. That path runs on a **pre-v7 document**, before any
`cost_plan` exists. It keeps reading the old fields, and it is correct to.

### 3.5 The scenario fix

`applyScenario` applies `construction_cost_adjustment_pct` to whatever the
document's mode makes the cost driver:

- **headline** — scales `construction_cost_per_sqm_pence`. Byte-identical to
  calc 2.8.0 for every existing document.
- **detailed** — scales every package's `amount_pence`.

Both engines. Compliance allowances and fee lines are untouched by the cost
lever in both modes, which is the existing behaviour and is preserved
deliberately: a percentage fee moves *because its base moved*, which is the
point of §3.4, and scaling the fee as well would double-apply the stress.

The test that makes this real is described in §8 and is a **cross-mode
equivalence pair**, not an assertion that a number changed.

### 3.6 Outputs

`AppraisalResultV2` gains `cost_plan: CostPlanResult`:

```
mode
packages[]                  id, code, label, amount_pence, contingency_class,
                            lender_eligible
base_build_pence
contingency[]               name, pct, basis, base_pence, amount_pence
contingency_total_pence
compliance_pence
construction_total_pence    = base_build + contingency_total + compliance
fees[]                      id, code, category, basis, base_pence, amount_pence
professional_total_pence
statutory_total_pence
lender_eligible_base_pence
implied_rate_pence_per_sqm  base_build ÷ developed_area_sqm; null when area is 0
```

`implied_rate_pence_per_sqm` exists so the rate does not simply vanish from the
appraisal when the mode changes. In headline mode it is the entered rate
(recovered by division, so it is a check on the arithmetic rather than an echo
of the input); in detailed mode it is the figure a reader compares against a
benchmark they hold themselves. It is display-only and enters no calculation.

Every contingency and fee line reports **its base as well as its amount**, which
is the audit's "show the base" discharged as data rather than prose.

This is the **only** shape the UI and the memo may read cost from, and neither
recomputes a figure from it — R9's precedent, and the reason its UI carries no
arithmetic in JSX.

`Schedule.totals.construction_pence`, `professional_pence` and
`statutory_pence` remain the single point the ledger sees, so the monthly model,
sources-and-uses (§7) and reconciliation are structurally untouched by this
release.

---

## 4. Migration

`migrateV6toV7` / `migrate_v6_to_v7`, mirroring `migrateV5toV6` exactly,
including the already-v7 merge branch in `migrateInputsToV7` and the two
refusals (unrecognised version; version-7-but-fails-structural-check) carried
forward from R8's silent-corruption defect. `_RECOGNISED_VERSIONS_V7` /
`RECOGNISED_INPUTS_VERSIONS_V7` = 1–7.

A migrated document gets:

- `mode: 'headline'`
- `packages: []`
- `contingency`: `general` at `contingency_pct` on `all_packages`;
  `existing_building` and `abnormal` at 0
- `fee_lines`: the eight existing fee fields as `fixed` lines, with
  `prior_approval` carrying `per_dwelling: true`

**No package schedule is synthesised.** Splitting a headline figure into
invented packages would be inventing evidence — the same reasoning that left
R8's `acquisition_date` null and R9's bridge zeroed rather than back-derived.

**The gate is numeric *and* structural.** All twelve golden fixtures must be
identical to the penny across every reported metric — a gate that can now fail,
per §3.3 — *and* the migration's structural output must be asserted directly
(mode, empty packages, exactly three contingency classes, eight fee lines, the
general class carrying the source percentage). R9 shipped a numeric-only gate
that was blind; a structural assertion is what catches a migration that produces
the right total by the wrong construction.

---

## 5. Validation

**Hard errors**

- `mode: 'headline'` with a non-empty `packages` (mutual exclusion, §3.1).
- `mode: 'detailed'` with an empty `packages` — a detailed plan with nothing in
  it is not a plan.
- `mode: 'detailed'` with Σ `amount_pence` of 0.
- Any negative `amount_pence` or `pct`, on a package, contingency class or fee
  line (existing pattern, `validation.ts:106`).
- Duplicate package `id`, or duplicate fee-line `id`.
- A contingency class on the `selected_packages` basis naming a `package_id`
  that no package carries — a dangling reference silently narrows the base.
- A contingency class on `selected_packages` with an empty `package_ids` and a
  non-zero `pct`.
- Not exactly three contingency classes, or a repeated `name` — the three
  classes are the schema, not a user-managed list.
- `mode: 'detailed'` with any non-zero `fire_safety_pence`,
  `sound_insulation_pence` or `part_l_compliance_pence` (§3.2.1 double count).
- A fee line with `basis: 'fixed'` and non-zero `pct`, or with a `pct_*` basis
  and non-zero `amount_pence` — the unused field must be zero, so that a basis
  change cannot silently resurrect a stale figure.
- A fee line with `per_dwelling: true` on a `pct_*` basis.
- A fee line whose `code` is one of the eight migrated codes but whose
  `category` contradicts the §3.4 mapping.

**Warnings**

- Contingency total above 50% of base build.
- A `pct_of_*` fee line resolving against a zero base.
- `mode: 'headline'` on a document that also carries `cost_plan` fee lines with
  a `pct_of_*` basis is **not** a warning — percentage fees are legitimate in
  both modes.

The existing `contingency_pct < 0` check stays for as long as the field exists,
but stops being the live path.

---

## 6. UI

`ConversionCostsPage` gains a mode radio at the top. Headline mode is visually
unchanged from calc 2.8.0.

Detailed mode adds a **compact package grid** (audit UX point 4: "compact grids
for unit, cost, evidence and risk schedules") — code select, label, amount,
contingency class, lender-eligible checkbox, remove; plus add-row.

Switching **to** detailed mode on a document carrying compliance allowances
offers a one-click conversion of the three figures into a single
`fire_acoustic_thermal` package, zeroing the source fields (§3.2.1). The user
can decline and move them by hand; what they cannot do is proceed with both
populated, because validation rejects it. The conversion is a UI affordance over
the schema rule, not a second code path — it writes ordinary inputs and the
engine sees nothing special.

Both modes show the contingency block as three rows, each displaying pct, the
**resolved base** and the **computed amount**, read from
`run.metrics.cost_plan.contingency`. Fee lines get a basis selector; on a
`pct_of_*` basis the row shows the resolved base and amount alongside the
percentage.

Every displayed figure comes from `run.metrics.cost_plan`. No component computes
a total, a base or a contingency amount.

---

## 7. Governance

Warnings, not a DRAFT gate — consistent with R9.

A detailed cost plan carrying no QS source, date or status is exactly the
condition that would justify a gate, and it is deliberately **not** gated here,
because the fields that would carry the evidence do not exist until R15. Gating
on absence of a field the schema cannot express would make every detailed-mode
appraisal permanently draft. R15 owns the gate; R10 owns the structure.

The memo's cost section prints the package schedule, the three contingency lines
with their bases, and the fee lines with their bases. R7's "headline cost
estimate" copy becomes mode-dependent: it stays for headline mode and becomes
"detailed cost plan — QS evidence not recorded" for detailed mode, which is
accurate on both counts and remains conservative.

---

## 8. Testing

- **Migration identity + structure.** All twelve golden fixtures penny-identical
  across every reported metric, plus direct structural assertions on the
  migration's output (§4).
- **Cross-mode equivalence.** Two documents with identical construction totals —
  one headline, one detailed, **both with zero compliance** (§3.2.1) — produce
  identical cost stacks **and identical responses to a −10% and a +10% cost
  stress**. This is the §3.5 guard. Both halves assert against hand-derived
  literals, not merely against each other: asserting only that the two modes
  agree would pass with both inert, which is precisely the defect being guarded
  against.
- **Contingency class rounding.** Independently-derived literals, not
  recomputation of the engine's own formula. Three classes at 5% on the same
  base must be pinned as three separate roundings.
- **Fee base isolation.** A fixture with a `pct_of_construction_total` fee and a
  large second fee, pinned to a literal that would differ if fees entered the
  base. Falsifiable by construction.
- **Statutory month-0 timing.** `uses[0].statutory_pence` pinned to a literal on
  a fixture with a non-zero prior-approval fee and a non-zero CIL/S106, so that
  prior approval landing in month 0 and the rest spreading survives the move to
  fee lines (§3.4). A totals-only assertion cannot see this change.
- **Compliance double count.** A detailed-mode document carrying a non-zero
  compliance field is rejected (§3.2.1), and the UI conversion produces a
  package whose amount equals the three fields' sum.
- **Accessor guard.** `contingency_pct` added to `accessor-guard.test.ts`,
  asserted through the real linter at `severity === 2`, with the direct,
  destructured and computed-access forms all covered (R9's three-read-path fix).
- **Cross-engine parity.** TS and Python agree to the penny on a detailed-mode
  fixture, including contingency classes and percentage fees.
- **New golden fixture** `q-detailed-cost-plan.json` in detailed mode, with all
  three contingency classes non-zero and at least one percentage fee.
- **Validation negatives.** One test per hard error in §5.

---

## 9. Spec changes

- **New §16 — Cost plan modes.** Modes, packages, contingency classes and
  bases, fee bases, the outputs shape, the stated limitations (no VAT, no
  per-package programme, eligibility recorded not live, and the mode-dependent
  compliance stress behaviour of §3.2.1).
- **§3.4 Construction cost** — amended: contingency is three classes on named
  bases, and the base build is Σ packages under the detailed mode. The existing
  R9 annotation stays; a new R10 annotation records what changed and why the
  single blended percentage was insufficient.
- **§3.5 Professional fees / §3.6 Statutory costs** — amended: fee lines with
  fixed and percentage bases, the two base definitions, and the statement that
  no fee basis includes fees.
- **§1.6 Versioning** — inputs v7, calc 2.9.0.
- **`docs/financial-model/test-cases.md` §16** — the cases above.
- **`docs/financial-model/migration-notes.md`** — v6 → v7.

---

## 10. Carried items

- **Defect C1** (§5.10 rolled-up interest against the net facility) is untouched
  and remains owned by R14. R10 does not change the cost-to-complete series.
- The `.claude/worktrees/release-3b-exits-ui` tree is still tracked in git
  despite `.gitignore`; `git rm -r --cached` when convenient. Not R10's job, but
  it is still true.
