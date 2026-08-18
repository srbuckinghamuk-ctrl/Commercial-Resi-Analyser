# R9 — Area bridge and efficiency reconciliation

Date: 2026-08-18
Release: R9 of the second lender-readiness audit remediation
Audit source: `docs/reviews/2026-08-17-lender-readiness-second-audit.md` §7.2 (lines 19, 70, 184–186, 292, 307)
Release plan: `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`
Schema: inputs v5 → **v6** · Calc: 2.7.0 → **2.8.0** (minor)

---

## 1. The defect

The appraisal holds two unrelated areas and no relationship between them.

- `unit_mix.units[].floor_area_sqm` — residential net internal area, per unit.
- `conversion_costs.total_construction_sqm` — the sole construction cost driver
  (`conversion-calc-engine.ts:74`, `schedule.py:75`: `base = rate × total_construction_sqm`).

Nothing connects them but a ±25% ratio warning
(`validation.ts:100`, `validation.py:142`). On the audited York case that warning fires —
252 m² of unit NIA against a 500 m² construction area — and the audit's judgement is that
the warning "is useful, but it does not replace an area bridge" (§7.2).

What is absent:

- **No gross area anywhere.** The building's existing GIA is never recorded in the
  appraisal. `project.floor_area_sqm` seeds `total_construction_sqm` at document creation
  (`conversion-defaults.ts:175`) and is then never referenced again by the model.
- **No common parts, plant, circulation, storage or amenity.** The 248 m² gap between unit
  NIA and construction area on the York case is unexplained and unexplainable — the schema
  has nowhere to put the explanation.
- **No efficiency.** Neither NIA/GIA nor saleable/developed is computed or displayed.
- **No external areas.** Balconies, terraces, parking and external amenity have no
  representation, so they are silently either inside NIA or nowhere.
- **An unpaid promise.** Spec §3.1 has stated since R1 that parking and external space are
  excluded from GDV "until valued separately in R3". R3 shipped without it. Three releases
  later the sentence still points at R3.

The cost consequence is direct: an area no one can reconcile multiplies a rate to produce
the single largest line in the cost stack.

---

## 2. Non-goals

Stated so the plan cannot quietly grow into them.

- **Scheme-level ancillary disposal.** Ancillary value in R9 attaches to a unit and sells
  with it. Surplus parking sold separately from any unit needs its own disposal routing in
  the exit engine and is **out of scope**, recorded as a stated limitation rather than
  silently absent.
- **Retained commercial value and rent.** The bridge records retained commercial *area*.
  Giving it a value and a rent roll is investment-value and NOI work — R13.
- **Area sensitivity presets.** "Saleable-area reduction" as a standard lender stress is
  R16 (audit line 314).
- **Measurement-standard enforcement.** The model does not police RICS IPMS against the
  older Code of Measuring Practice. It records the areas it is given and reconciles them.
- **Unit-of-measure choice.** Storage stays m² throughout. Sq ft continues to be a display
  and lender-basis conversion only, via the existing `SQFT_PER_SQM` constant.
- **No DRAFT gate.** See §7.

---

## 3. Design

### 3.1 One block, one fact per line

New `areas` block on `CalculatorInputsV6`. Every line is **entered** or **derived**, never
both. That rule is the whole point: two independently-entered numbers describing one fact is
precisely the condition the ±25% warning exists to detect, and adding ten more area
fields on the current pattern would multiply that condition rather than resolve it.

**Entered**

| Field | Meaning |
|---|---|
| `existing_gia_sqm` | Gross internal area of the building as it stands. |
| `demolished_gia_sqm` | Existing GIA removed by the works. |
| `extension_gia_sqm` | New-build or extension GIA added by the works. |
| `retained_commercial_gia_sqm` | Proposed GIA remaining in commercial use. |
| `untouched_gia_sqm` | Proposed GIA outside the works (already residential, or out of scope). |
| `circulation_common_sqm` | Corridors, cores, stairs, lift lobbies, common parts. |
| `plant_riser_sqm` | Plant rooms, risers, tank rooms, substation. |
| `store_bin_cycle_sqm` | Refuse, cycle and resident storage. |
| `amenity_sqm` | Internal resident amenity. |
| `external_amenity_sqm` | External amenity and landscape. **Not GIA** — recorded outside the reconciliation and never deducted from it. |

**Derived**

```
proposed_gia         = existing_gia − demolished_gia + extension_gia
developed_gia        = proposed_gia − retained_commercial_gia − untouched_gia
available_for_units  = developed_gia − circulation_common − plant_riser
                                     − store_bin_cycle − amenity
unallocated          = available_for_units − Σ unit.floor_area_sqm
```

`developed_gia` is **the construction cost area**. `unallocated` is displayed, never hidden
— a non-zero balance is the reconciliation signal, and on a screening-stage appraisal it is
frequently and legitimately large.

**`proposed_gia` is derived, not entered.** A QS or architect schedule usually states
proposed GIA directly, so this deliberately does not mirror the source document. The
alternative — entering it and cross-checking against existing − demolished + extension —
reintroduces the two-numbers-one-fact drift this design exists to remove. A pure conversion
enters `existing_gia_sqm` alone and leaves demolition and extension at zero, which is the
common case and the minimal one.

### 3.2 Efficiencies

Three ratios, each answering a different question, all `null` when their denominator is
zero (the codebase's existing `pct()` convention — never a division by zero, never a
misleading `0`).

| Ratio | Formula | Question it answers |
|---|---|---|
| `nia_to_gia_pct` | Σ unit NIA ÷ `developed_gia` | Net-to-gross of the works. **The policy ratio** — the one the efficiency warning is set on. |
| `nia_to_proposed_gia_pct` | Σ unit NIA ÷ `proposed_gia` | How much of the whole building becomes residential net area. |
| `saleable_to_developed_pct` | Σ NIA of **sold** units ÷ `developed_gia` | What proportion of the area being funded is being sold. |

`saleable_to_developed_pct` is deliberately **exit-coupled**: it reads the exit route and
the retained-unit list. Under `retain_all` it is 0%, which is the true and useful answer to
a lender's question, not a defect. The coupling is stated here because a derived area figure
that changes when the exit route changes will otherwise look like a bug.

### 3.3 The basis switch

```ts
export type AreaBasis = 'bridge_derived' | 'manual';
```

- `bridge_derived` — construction cost area is `developed_gia`.
- `manual` — construction cost area is `conversion_costs.total_construction_sqm`, unchanged.

This mirrors R8's `jurisdiction_source: 'derived' | 'user' | 'migrated_default'`: a derived
value with a deliberate, recorded escape hatch. The escape hatch is not decoration — a QS
may have priced an area that legitimately does not tie to the bridge, and a model with no
way to express that invites the user to corrupt the bridge until it produces the number the
QS gave.

### 3.4 The accessor and the guard

New module, one per language: `frontend/src/lib/model/areas.ts` and
`app/financial_model/areas.py`. Public surface:

```
developedAreaSqm(inputs)  -> number              // THE cost area, every consumer
areaBridge(inputs)        -> AreaBridgeResult    // all derived lines + efficiencies
```

Consumers rewired to `developedAreaSqm`: the cost stack (`conversion-calc-engine.ts:74`,
`schedule.py:75`), validation, the deal spider, the UI cost page, the memo.

**The guard closes R8's open class.** R8's implementation report records three separate
instances of one pattern — `metrics.ts` rerouted while `calculateTotalAcquisitionCost`,
then `deal-spider.ts`, then `AcquisitionPage.tsx` each kept computing tax England-only.
Each site was individually correct before the move and individually self-consistent after
it, so a green suite could not detect any of them; all three were caught by carry-forward
from the previous task's review. The instances were closed and **the class was left open**.

R9 introduces a second value of exactly that shape, so it ships the structural remedy once,
covering both:

- **TypeScript** — eslint `no-restricted-syntax` on member access to
  `total_construction_sqm` and to the acquisition-tax band table outside their owning
  modules. A violation fails the build, not a review.
- **Python** — a source-scan test over `app/` asserting the same two restrictions.

Allowlist, by path: the type definitions, `migrate`, `conversion-defaults` (which seeds the
field at document creation), and `ConversionCostsPage.tsx` — the one editor that
legitimately *writes* the raw manual field.

**Recorded limitation:** `*.test.*` and `test_*.py` are exempt, because fixtures must
construct the raw field. A consumer defect written inside a test file is therefore not
caught by the guard. This is a real weakening and is recorded rather than glossed.

### 3.5 Ancillary areas and value

```ts
export interface UnitAncillary {
  balcony_terrace_sqm: number;          // external — never inside NIA
  balcony_terrace_value_pence: number;
  parking_spaces: number;               // count
  parking_value_pence: number;
}

export interface ProposedUnitV6 extends ProposedUnit {
  ancillary: UnitAncillary;
}
```

`ProposedUnit` is extended rather than edited, because it is shared with the v1 document
shape — the same reasoning R8 applied to `AcquisitionInputsV5`. Structural subtyping means
every existing consumer typed on `ProposedUnit` keeps working, and the accessor treats a
missing `ancillary` as zeros.

GDV becomes a two-part figure, both parts reported:

```
gdv = Σ unit.estimated_value_pence          (internal saleable)
    + Σ unit.ancillary.parking_value_pence
    + Σ unit.ancillary.balcony_terrace_value_pence
```

Balcony, terrace and parking areas sit **outside NIA** and outside the GIA reconciliation.
They are not deducted from `available_for_units`, because they were never inside it.

This pays off spec §3.1's R3 promise. The sentence is **deleted and replaced**, not
repointed at a later release.

### 3.6 Three consumers that must move with it

Each is a defect the moment a unit has more than one area or more than one value. All three
are in scope and each gets its own pinning test.

1. **`lender-valuation.ts:59`** — the `global_per_sqft` basis computes
   `global_value × u.floor_area_sqm × SQFT_PER_SQM`. Spec §3.2 describes this as "pence per
   sq ft applied to every unit's area". Once a unit has an internal area *and* a balcony
   area, "the unit's area" is ambiguous. Bound explicitly to **internal NIA**, in the spec
   and in a test. Left unbound, adding a balcony area silently moves lender GDV.
2. **`schedule.ts:93`** — `grossSales` sums `estimated_value_pence` over sold units.
   Ancillary value must flow into it, or a scheme's GDV and its sale receipts disagree by
   the ancillary total and the model no longer reconciles.
3. **`apply-scenario.ts:38`** — `gdv_adjustment_pct` multiplies `estimated_value_pence`
   only. Unmoved, every GDV sensitivity, every scenario and the whole tornado understate
   the stress by the ancillary share.

### 3.7 Inputs v6

```ts
export interface CalculatorInputsV6
  extends Omit<CalculatorInputsV5, 'inputs_version' | 'unit_mix'> {
  inputs_version: 6;
  unit_mix: UnitMixInputsV6;
  areas: AreaBridgeInputs;
}
```

Both engines mirror. Python gains `AreaBridgeInputs`, `UnitMixInputsV6`,
`CalculatorInputsV6`, `is_v6`, `migrate_v5_to_v6`, `migrate_inputs_to_v6` — and, correcting
the asymmetry R8 left open, all of the V5 **and** V6 symbols are added to `__all__`.

### 3.8 Outputs

The bridge is not an input-only concern: the UI, the memo and any consumer of the API
result all need the derived figures, and none of them may recompute one. The appraisal
result therefore gains an `area_bridge` block carrying every derived line from §3.1 and
every ratio from §3.2, alongside `Σ unit NIA` and the ancillary areas.

`AppraisalMetrics` gains three fields, and no more — metrics is a flat ratio surface and the
bridge belongs beside it, not inside it:

| Field | Meaning |
|---|---|
| `developed_area_sqm` | The cost area actually used, whichever basis produced it. |
| `gdv_internal_pence` | GDV excluding ancillary — the pre-R9 figure, preserved so a variance against it is expressible. |
| `gdv_ancillary_pence` | Parking plus balcony/terrace value. |

`gdv_pence` remains the **total** of the two, so every existing ratio built on it
(profit on GDV, LTGDV, senior break-even) keeps its current meaning without amendment.
`metrics.sdlt_pence` stays as R8 left it — a deprecated alias, retired in R16.

---

## 4. Migration

`v5 → v6` sets `basis: 'manual'`, every bridge field `0`, every `ancillary` block zeroed.

**Every existing appraisal is numerically identical after migration.** No cost area moves,
no GDV moves, no golden fixture moves. The grandfathering question R8 had to answer does
not arise here, because nothing changes until a user populates the bridge and selects it.

`migrate_inputs_to_v6` carries forward R8's hardest-won guard: an unrecognised
`inputs_version` — including a future v7 — returns **422 in both engines**. R8 shipped
`migrate_inputs_to_v4` without a v5 guard, and a v5 document fell through to the v1 fallback
and was silently corrupted (fields dropped, a confirmed equity source replaced by an
unconfirmed stub with a different amount, the facility rebuilt from `ltv_pct`) while
returning 201.

Pydantic's `revalidate_instances='never'` is the second R8 carry-forward: it permits a
`CalculatorInputsV5` container to hold a `ProposedUnitV6`. Any two sites gating on the
version must gate on the **same** predicate — container or block, chosen once and applied
consistently.

---

## 5. Validation

| Severity | Rule |
|---|---|
| **hard** | `basis === 'bridge_derived'` and `developed_gia <= 0` |
| **hard** | any derived line negative, named individually rather than as one collapsed rule: `demolished > existing` (negative `proposed_gia`); `retained_commercial + untouched > proposed_gia` (negative `developed_gia`); `circulation + plant + store_bin_cycle + amenity > developed_gia` (negative `available_for_units`) |
| **hard** | `Σ unit NIA > available_for_units` — over-allocating the building is impossible, not questionable |
| **hard** | any entered area negative |
| **warn** | `unallocated > 10%` of `developed_gia` |
| **warn** | `nia_to_gia_pct` outside 65–90% |
| **warn** | `basis === 'manual'` while a populated bridge differs from `total_construction_sqm` by more than 5% |

**The ±25% warning is deleted.** Not softened, not left alongside the new rules — its
message string is removed from both engines and both suites assert a **zero count** on the
retired string.

R8 supplies the reason this matters. `memo-release-gate.test.ts` asserted the memo
*contained* "England and Northern Ireland non-residential SDLT bands"; the suite was
defending a false statement, and a positive `toContain` sails straight past the old sentence
being re-added *alongside* the true one. Zero-counts on retired strings are load-bearing.

---

## 6. UI

- **New `AreasPage`** in the calculator wizard: the bridge as a visible reconciliation
  running existing GIA → proposed → developed → available → unallocated, with each derived
  line shown as derived and the three efficiencies beside it. The unallocated balance is
  displayed with its sign and never suppressed.
- **`ConversionCostsPage`** gains the basis selector. Under `bridge_derived` the
  construction area is shown as derived and read-only, with the bridge line that produced
  it; under `manual` the existing editable field remains.
- **`UnitMixPage`** gains the per-unit ancillary fields, visually separated from internal
  area so a balcony cannot be typed into NIA.
- **NDSS** (`space-standards.ts`, `deal-spider.ts:73`) tests **internal NIA only**. It
  already does, structurally; R9 adds a test that pins it, because a balcony area silently
  entering the NDSS test would turn undeliverable units into passing ones.

Every displayed figure comes from `areaBridge()`. No component recomputes an area — that is
the guard's purpose, and `AcquisitionPage.tsx` is R8's proof that it is needed at this layer
too, where a Welsh document would have shown two contradicting tax figures on one screen.

---

## 7. Governance — warnings, not a DRAFT gate

The `DraftReason` union is **unchanged**: `'unreconciled' | 'senior_not_repaid' |
'tax_basis_unconfirmed' | 'not_approved'`. `report_safe` is unaffected.

R8 gated on the tax basis because an unconfirmed jurisdiction is a fact the user simply has
not stated — it is knowable on day one. An unallocated area balance is different in kind: at
appraisal stage it is frequently and legitimately unknown, and gating on it would put every
existing appraisal into permanent DRAFT for a number nobody can yet supply.

The basis conflict remains a **hard error**: selecting `bridge_derived` with no bridge is a
contradiction the user *can* resolve, and hard validation failure already produces
`unreconciled`.

The DRAFT gate is not abandoned. It belongs with R15, where evidence RAG and an explicit
`unknown` state make "this area is genuinely not yet known" a recorded position rather than
an absence.

---

## 8. Testing

- **Unit** — bridge derivation, each efficiency including its `null` denominators, the
  basis switch, the ancillary GDV split, and every validation rule at both sides of its
  threshold.
- **Parity** — the same fixtures through both engines, pence- and area-exact.
- **Guard** — a test asserting the eslint rule and the Python source scan actually fail on a
  planted violation. A guard nobody has watched fail is not a guard.
- **Pinning tests** for the three §3.6 consumers, each written to fail against today's code.
- **Golden fixtures** (whole-pipeline, cross-language):
  1. **Bridge-derived** — full bridge, `developed_gia` driving construction cost.
  2. **Ancillary** — parking and balcony value in GDV, flowing through sale receipts and a
     GDV scenario adjustment.
  3. **Levered non-English** — R8's own open carry-forward: no existing non-English fixture
     exercises a levered path, leaving the jurisdiction-aware tax → TDC → `peak_debt`
     interaction unpinned.
- **Regression** — every existing golden fixture holds unchanged, which puts the migration's
  numerical-identity claim under test rather than under assertion.
- **Full gate set:** vitest, pytest, eslint, `tsc -b`, production build.

---

## 9. Spec changes

| Document | Change |
|---|---|
| `calculation-specification.md` | New **§15 Area bridge and efficiency** — the entered/derived model, the three efficiencies, the basis switch, ancillary value, and the stated limitations. |
| `calculation-specification.md` §2 | New basis definitions: developed area, available-for-units, unallocated balance, ancillary value. |
| `calculation-specification.md` §3.1 | The "until valued separately in R3" exclusion is **removed and replaced** by the ancillary GDV component. The old sentence is quoted in the amendment note, as §3.3 does for R8, so the record shows what changed rather than only what is now true. |
| `calculation-specification.md` §3.2 | `global_per_sqft` bound explicitly to internal NIA. |
| `model-governance.md` | The single-accessor rule and its enforcement, plus the test-file exemption as a known limitation. |
| `test-cases.md` | New **§14** — area bridge fixtures and the guard tests. |
| `migration-notes.md` | v5 → v6, and the numerical-identity claim. |

---

## 10. R8 carry-forward housekeeping

Small, parked in R8's implementation report, cheap to clear while the files are open:

1. The release report's §7 cross-reference should read §8.
2. `apply_scenario.py`'s docstring still says "v2, v3 or v4" where its TS twin says v5 — a
   mirrored-pair desync R8's final fix wave created.
3. `CalculatorInputsV5`, `AcquisitionInputsV5`, `is_v5`, `migrate_v4_to_v5` are missing from
   Python's `__all__`, asymmetric with V2–V4 (§3.7 folds this in).
4. Date validation is regex-only, so `2026-02-31` validates. API-only — `<input type="date">`
   cannot produce it — but a real hole.

Still open and **not** claimed by R9: PDF/UA tagging, raster visual regression, the jsPDF
Symbol-font warning (all R7).
