# Release 11 — VAT and TOGC design

**Date:** 21 August 2026
**Audit provenance:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md`
§7.4 (purchase VAT/TOGC, recoverability and timing) and §7.5 (VAT as a
cash-flow input by cost line, with rate, recoverable proportion, reclaim timing
and adviser-confirmed status). Roadmap row P1: *"VAT and TOGC are
disclosure-only → line-level VAT/recovery/timing plus adviser confirmation →
prevents a tax-driven funding shortfall."*
**External reference:** [HMRC VAT Notice 708](https://www.gov.uk/guidance/buildings-and-construction-vat-notice-708).

**Versions:** calc `2.9.0` → `2.10.0`; inputs `v7` → `v8`.
**Specification:** the calculation specification gains **§17**.

---

## 1. The problem this release exists to solve

VAT is currently disclosure-only, in exactly three places:

| Site | What it says today |
|---|---|
| `export-investment-memo.ts:2141-2142` | Two tax-table rows: construction VAT "Treatment unconfirmed", purchase VAT/TOGC "Unconfirmed" |
| `export-investment-memo.ts:2241` | *"VAT is not modelled as a cash flow… An adverse VAT position would increase the funding requirement."* |
| `spider-axes.ts:79` / `deal-spider.ts:208` | An **illustrative** axis folding in `construction_cost_pence × 0.15` as a notional reduced-rate saving, flagged UNCONFIRMED and excluded from every lender metric |

The audit's complaint is precise and correct: *"the app is right not to assume a
saving, but disclosure alone does not calculate the funding need."*

The funding need is real and it is not a rounding item. On a levered conversion,
input VAT on construction is paid out month by month and returns on the HMRC
return cycle — up to four months later where the scheme is quarterly and spend
lands early in a period. That carry is funded, and funding it costs interest.
Separately, where the vendor has opted to tax and TOGC does not apply, VAT on
the purchase price is not merely a timing item: **SDLT is charged on the
VAT-inclusive consideration**, and that portion never comes back.

Today the model reports both of those as zero.

## 2. Decisions taken at design time

| # | Decision | Chosen |
|---|---|---|
| 1 | Scope | Purchase VAT/TOGC **and** cost-line VAT, as one subsystem sharing one reclaim cycle and one evidence gate |
| 2 | Schema shape | Category spine + optional per-line override, resolved by a single guarded accessor |
| 3 | Reclaim timing | HMRC return cycle (frequency, first period end, repayment lag) |
| 4 | Funding | Main facility; VAT **ineligible** for the development-cost advance cap; a separate VAT facility deferred to R14 |
| 5 | Purchase VAT | Treatment + cash flow + **SDLT on the VAT-inclusive consideration** |
| 6 | R10 carry-over | Keep `CostPackage.contingency_class`, delete `ContingencyClass.basis`/`package_ids` |
| 7 | Spider axis | Driven from the model, not from a hard-coded 15% |
| 8 | Evidence | A new `DraftReason`, reusing R8 §14.6's mechanism rather than inventing a second |

---

## 3. §17.1 — The schema

A new `vat` block on `CalculatorInputsV8`, additive in the mould of
`AcquisitionInputsV5` (R8), `UnitMixInputsV6` (R9) and `CostPlanInputs` (R10):

```
VatChargeCategory =
  'acquisition' | 'construction' | 'professional' | 'statutory'
  | 'selling' | 'lender_ancillary'

RecoveryBasis = 'zero_rated_sale' | 'partial_exemption' | 'blocked' | 'unconfirmed'

TogcTreatment = 'applies' | 'does_not_apply' | 'unconfirmed'

VatTreatment {
  category: VatChargeCategory
  rate_pct: number             // 0 | 5 | 20 in practice; validated 0..100
  recoverable_pct: number      // 0..100
  recovery_basis: RecoveryBasis
  evidence_status: EvidenceStatus   // reuses the existing vocabulary, R8 precedent
  notes: string
}

PurchaseVatInputs {
  vendor_opted_to_tax: boolean
  togc_treatment: TogcTreatment
  evidence_status: EvidenceStatus
  notes: string
}

VatInputs {
  registered: boolean
  return_frequency: 'monthly' | 'quarterly'
  first_period_end_month: number
  repayment_lag_months: number
  treatments: VatTreatment[]   // exactly six, one per category, in a fixed order
  purchase: PurchaseVatInputs
}
```

`treatments` is **schema, not a user-managed list** — exactly the rule
`CostPlanInputs.contingency` follows: exactly one row per category, in the
declared order, enforced by hard validation. A user edits rows; a user never
adds or removes one.

`registered: false` makes the entire engine inert: every VAT figure is zero and
no reclaim is scheduled, whatever the treatment rows say. This is the migrated
default and the new-document default (§13).

Detailed-mode lines gain an optional override:

```
VatOverride { rate_pct: number, recoverable_pct: number, recovery_basis: RecoveryBasis }
```

`CostPackage.vat_override` and `FeeLine.vat_override`, both `null` unless the
user sets one, both hard-rejected in headline mode.

## 4. §17.2 — One resolver, and why that is not optional

The R10 post-mortem records a schema that carried two mechanisms for one fact,
where the engines read one and the product wrote the other. The category-plus-
override shape is structurally capable of repeating that defect. Three rules
prevent it, and all three are load-bearing:

1. **One read site.** `resolveVatTreatment(charge)` is the only function that
   may read `vat.treatments` or any `vat_override`. It returns the resolved
   `{ rate_pct, recoverable_pct, recovery_basis, evidence_status }` for one
   charge. Precedence is: line override if present, else the category row.
2. **The eslint single-accessor guard covers it**, the same mechanism that
   restricts `developedAreaSqm` (spec §15.4) and `selectBandSet` (R8). The guard
   test must run ESLint's Node API and assert `severity === 2`, per R9's finding
   that a guard downgradeable to `'warn'` with every test still green is not a
   guard. The allowlist gains exactly one file, and the guard test asserts the
   allowlist's contents — R10 found a guard whose test *pinned* the hole a
   widening had opened.
3. **The override must be written by the product**, not only by the schema. If
   no UI writes `vat_override`, it is R10's `contingency_class` again and it
   should not ship. The UI task is not optional scope.

## 5. §17.3 — What is a fixed rule, not an input

Two facts are properties of the tax, not choices, and are encoded as constants
in the mould of `FEE_CODE_CATEGORY`:

- **Interest and the arrangement, exit, non-utilisation and extension fees are
  exempt financial services and never bear VAT.** Only the `lender_ancillary`
  charges — broker, lender legal, valuation, monitoring surveyor — are standard
  rated. A `lender_ancillary` treatment row therefore applies to the ancillary
  fee block and to nothing else in the finance stack.
- **Where TOGC applies, purchase VAT is nil regardless of the option to tax.**
  That is the whole effect of a TOGC, and it must not be expressible as
  "TOGC applies *and* VAT is chargeable".

`FEE_CODE_CATEGORY` carries a comment explaining that `building_control` is
statutory despite sitting in the professional-fee block. The same trap exists
here: `lender_ancillary` VAT is a **finance-side** charge that must not be swept
into the professional-fee total. Misclassifying it moves money between two
separately-reported, separately-spread lines while every grand total stays
correct — invisible to any totals-based assertion.

## 6. §17.4 — The return cycle

The first return period covers months `0 .. first_period_end_month` inclusive.
Subsequent periods are one month (`monthly`) or three months (`quarterly`).
Input VAT incurred anywhere in a period is reclaimed in a single amount at
`period_end + repayment_lag_months`.

This produces the saw-tooth that a flat per-month lag cannot: with quarterly
returns, VAT on spend landing at the start of a period carries for the rest of
the period plus the lag. That stagger is the peak a lender sizes a VAT facility
against, and understating it would defeat the purpose of the release.

**Reclaims falling after the final month are not received.** They are reported
as `vat.receivable_at_maturity_pence` and are *not* credited to the ledger.
Clamping them into the final month would flatter the deal by manufacturing a
receipt the borrower has not had. This follows the codebase's standing
principle: a funding gap is visible, never plugged.

### Worked cycle (normative, to be pinned as a fixture)

Quarterly returns, `first_period_end_month = 2`, `repayment_lag_months = 1`.
Construction £1,000,000 at 20% recoverable in full, spread £250,000 in each of
months 1–4, so £50,000 of VAT is incurred in each of months 1–4.

| Period | Months | VAT incurred | Reclaimed in month |
|---|---|--:|--:|
| 1 | 0–2 | £100,000 | 3 |
| 2 | 3–5 | £100,000 | 6 |

Month-end VAT carry (cumulative paid − cumulative reclaimed):

| m | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|--:|--:|--:|--:|--:|--:|--:|
| carry (£000) | 0 | 50 | 100 | 50 | 100 | 100 | 0 |

Peak carry £100,000. Profit falls by the interest on that carry and by nothing
else — see §17.5 below.

**The implementation plan must re-derive these figures against the document it
actually constructs**, not transcribe them. R10 shipped two plan tests asserting
figures their own documents could never produce, because defaults the plan never
mentioned were non-zero.

## 7. §17.5 — The engine runs in one direction only

`computeVat(inputs, costPlan, schedule)` reads the cost plan and the schedule.
**No part of the cost plan reads VAT.** No fee basis, no contingency base and no
construction total includes VAT.

This is R10's argument reused verbatim. R10 made fee double-counting impossible
*by construction* rather than detecting it, so there is no ordering to get
wrong, no iteration and no cycle detection. The same holds here: because VAT is
computed strictly downstream of the cost plan, a VAT figure can never feed a
base that feeds VAT.

The direct consequence is that **irrecoverable VAT cannot be folded back into
`construction_cost_pence`**, however natural that reads. It becomes its own
line, `irrecoverable_vat_pence`, added to cost-before-finance and so to TDC and
to profit.

### The invariant worth pinning above all others

**Fully recoverable VAT changes no cost line. Profit moves only by the carry
interest.** Stated as a test: take any fixture, set `registered: true` with
every category at 20% and 100% recoverable, and

- `construction_cost_pence`, `professional_fees_pence`, `statutory_costs_pence`,
  `selling_costs_pence` and `cost_plan` are **byte-identical** to the same
  document with `registered: false`;
- `irrecoverable_vat_pence` is exactly `0`;
- `profit_pence` differs **only** by the increase in `finance_costs_pence`.

That assertion fails if VAT leaks into any cost base, if irrecoverable VAT is
computed off a rounding error, or if a reclaim goes missing. It is the release's
primary guard and it is falsifiable in all three directions.

## 8. §17.6 — The ledger

`MonthUses` gains `vat_pence`, which joins the month's `cashUses` alongside
acquisition, construction, professional and statutory.

**VAT is not eligible for the development-cost advance.** The cap's eligible
base at `monthly-engine.ts:139` stays `construction + professional + statutory`.
Lenders do not advance against reclaimable VAT on the same terms as against
build cost, so VAT falls to equity or to gross headroom, and a new
`vat_funding_gap` flag fires where neither can meet it. A test must **watch this
guard fail** by adding `vat_pence` to the eligible base and confirming the
assertion breaks; a guard nobody has watched fail is not a guard.

Reclaims are a new inflow, `vat_reclaim_pence`, on `MonthReceipts` and on
`LedgerMonth`. It is deliberately **not** a sale receipt:

- **100% swept to senior debt**, ignoring `sales_sweep_pct`. It returns a
  specific advance rather than realising an asset.
- **Applied first in the month**, before the sales sweep and before the §4.5
  refinance event, because it reduces the balance those two then have to clear.
- **Is not part of `gross_receipts_pence`**, so no GDV-, LTGDV- or
  break-even-denominated metric moves.
- Where there is no facility, it flows to distribution and into
  `equity_cashflows_pence`, exactly as sale receipts already do for a cash deal.

**A reclaim that fully clears the balance redeems the facility on exactly the
same terms as any other full redemption** — the exit fee is charged once and the
redemption state is set.

This is not the intuitive answer and it is worth stating why the intuitive one
is wrong. A reclaim is not a realisation, so "a reclaim never redeems" reads
correctly. But the ledger charges the exit fee inside `if (balance > 0 &&
!isCash)` at the sales sweep. If a reclaim zeroes the balance while leaving the
redemption state unset, the later sale finds `balance === 0`, takes neither
branch, and **the exit fee is never charged and never carried** — silently lost,
with every total still reconciling. The fee is contractually due on redemption
whoever funds it, so the reclaim must redeem properly or not at all.

The consequence is accepted deliberately: a later draw that re-opens a balance
the reclaim had cleared raises `facility_redrawn_after_redemption`. The facility
genuinely was redeemed, so the flag is honest rather than spurious.

A **partial** reclaim charges no fee and sets no redemption state, exactly like
a partial sales sweep.

### The sources-and-uses identity (calculation specification §7)

`reconcile()` needs **no structural change**. The VAT outflow enters
`uses_total_pence` and is funded through the existing per-month loop by draws,
equity or a visible gap. The reclaim repays. Like sale-proceeds repayments and
like refinance-shortfall equity before it, the reclaim appears on **neither
side** of the identity.

Over the term, sources therefore fund the **gross** VAT outflow even though most
of it returns — which is correct, and is the same treatment sale proceeds
already receive. `reconcile()`'s existing comment block explains why matched
pairs are kept explicit; the VAT reclaim is the third exclusion and must be
documented in the same place, in the same terms.

## 9. §17.7 — Purchase VAT, TOGC, and the chargeable consideration

Purchase VAT is chargeable **iff `vendor_opted_to_tax` is true and
`togc_treatment` is not `'applies'`.** Stated that way rather than as a
three-branch rule, it covers `'unconfirmed'` without a separate clause: an
unconfirmed TOGC is charged, which is the prudent case, and the document is
gated as unconfirmed (§12). Where the vendor has not opted to tax there is no
VAT to charge, whatever the TOGC position.

Where chargeable, the VAT is an outflow in month 0 and reclaims on the cycle
like any other input VAT, subject to the `acquisition` category's
`recoverable_pct`.

### The unregistered buyer, and why `registered: false` cannot express it

**Chargeability is a fact about the vendor. Recovery is a fact about the buyer.**
A vendor who has opted to tax charges VAT on the price whatever the buyer's VAT
status; whether the buyer gets it back is a separate question.

`vat.registered: false` makes the whole engine inert (§17.1) — it is the migrated
and new-document default, the switch that keeps this release additive. It is
**not** a statement that the buyer is unregistered, and it must not be read as
one.

Those two facts collide in one state: `vendor_opted_to_tax: true`,
`togc_treatment: 'does_not_apply'`, `registered: false`. Chargeability says VAT
is due; the inert engine resolves the acquisition rate to 0; and the chargeable
consideration collapses back to the exclusive price. The model would then decide
VAT *is* chargeable and charge tax on a base that excludes it — the exact
under-report this section exists to remove, in the case where it costs most,
because an unregistered buyer recovers none of that VAT.

**That state is therefore a hard validation error** (§17.9). It is not a case the
model may silently approximate.

The real position is already expressible, and expressible exactly: set
`registered: true`, the `acquisition` row to the applicable rate,
`recoverable_pct: 0` and `recovery_basis: 'blocked'`. VAT is charged, none of it
comes back, the consideration is VAT-inclusive, the acquisition tax is charged on
that inclusive base, and the whole amount lands in `irrecoverable_vat_pence`.
Every figure is right, and the schema needed nothing new to say it.

The rejected alternative was sourcing `rate_pct` independently of `registered`,
so an inert document could still charge purchase VAT. It is identity-safe (every
migrated rate is 0), but it makes `registered` mean two different things in two
places, and this release exists partly to stop one field carrying two meanings.

**And the acquisition tax base moves.** SDLT, LBTT and LTT are all charged on
the VAT-inclusive consideration. Today six call sites pass
`acquisition.purchase_price_pence` straight in as `consideration_pence`:

| File | Line |
|---|---|
| `frontend/src/lib/conversion-calc-engine.ts` | 78 |
| `frontend/src/lib/model/metrics.ts` | 110 |
| `frontend/src/lib/deal-spider.ts` | 201, 205 |
| `app/financial_model/metrics.py` | 295 |
| `app/financial_model/schedule.py` | 98 |

All six are replaced by a new accessor, `chargeableConsiderationPence(inputs)` /
`chargeable_consideration_pence(inputs)`, added to the eslint and Python AST
single-accessor guards alongside `developedAreaSqm`. Any seventh site added
later fails the lint, not review. **Line numbers drift as earlier tasks land —
implementers must locate these by content, not by line.**

This is a **permanent** cost, not a timing one, and the app currently reports it
as zero. The migration default (`vendor_opted_to_tax: false`) keeps every
existing document's consideration identical to its price, so no fixture moves.

**Out of scope:** a TOGC conditions checklist — buyer VAT-registered, own option
to tax, notification before completion, property let as a business. Those are
legal due diligence with their own evidence trail, they belong to R15, and they
would not change a single number in R11.

## 10. §17.8 — Contingency: one mechanism (R10 carry-over)

R10 shipped `CostPackage.contingency_class` recorded but not live, and
`ContingencyClass.basis` / `package_ids` read but written by nothing in the
product. R10 assigned R11 the decision. R11 keeps the tag and deletes the
id-list.

**The resolution rule is mode-dependent, and it has to be.**

- **Headline mode: every class's base is the whole base build.** There are no
  packages, so scoping is not expressible — you cannot scope what you have not
  scheduled.
- **Detailed mode:** `general` takes the whole base build; `existing_building`
  and `abnormal` take the sum of packages tagged with that class, as an
  *additional* allowance on top of general.

A package tagged `existing_building` therefore carries both general and
existing-building contingency. That is the honest reading of the audit's
"separate general contingency from existing-building and abnormal-risk
contingency" — the second is an addition for elevated risk, not a substitution.

### Why the headline branch is not a convenience

`ConversionCostsPage.tsx` renders all three contingency percentages as editable
in **both** modes, and `defaultContingencyClasses()` gives all three
`basis: 'all_packages'`. A headline-mode user can therefore set
`existing_building` to 15% today and receive 15% of the base build.

A rule of "tagged packages only, in all modes" would silently zero that user's
contingency — a live, reachable, shipped input path, reduced to nothing with
every total still reconciling. The mode-dependent rule reproduces headline
behaviour exactly.

**The result shape is unchanged.** `ContingencyLine.basis` survives on the
*result* as `'all_packages' | 'selected_packages'`, now derived from mode and
class rather than read from the input. `q-detailed-cost-plan.json` therefore
keeps even its basis strings, and the identity claim covers the whole result
object rather than just its figures. Only the *input* fields `basis` and
`package_ids` are deleted.

### Why this lands byte-identical, and why that is a trap

`q-detailed-cost-plan.json` today holds:

```
general           pct 5   basis all_packages      package_ids []
existing_building pct 15  basis selected_packages package_ids ["pkg-enabling","pkg-structure"]
abnormal          pct 8   basis selected_packages package_ids ["pkg-externals"]
```

and tags `pkg-enabling` and `pkg-structure` as `existing_building`,
`pkg-externals` as `abnormal`. **The two mechanisms agree exactly.** The
resolution rule above reproduces every figure, so the fixture stays
byte-identical.

That agreement is precisely R10's stated failure mode: *"every test used
documents where both code paths agreed, so reverting the refactor kept the suite
green."* A re-pin of this fixture proves nothing.

**The plan must therefore carry a planted-divergence test**: a document whose
`contingency_class` tags and whose (pre-migration) `package_ids` disagree,
asserting that the resolved base follows the **tag**. Without it the swap is
untested by construction, and the deletion of `basis`/`package_ids` would be
indistinguishable from a no-op.

## 11. §17.9 — Validation

**Hard errors** (input errors, not flags):

- a `vat_override` set on any package or fee line while `cost_plan.mode` is
  `'headline'` — mode exclusivity, mirroring R10 §16.1;
- `rate_pct` or `recoverable_pct` outside `0..100`, on a treatment row or an
  override;
- `treatments` that is not exactly the six `VatChargeCategory` values, each once,
  in the declared order;
- `first_period_end_month` negative or ≥ `term_months`, **and**
  `repayment_lag_months` negative or greater than 6 — **both gated on
  `registered: true`** (R38, below);
- `togc_treatment: 'applies'` together with a non-zero `acquisition` rate — the
  fixed rule in §5 must be unrepresentable, not merely unlikely.
- **`vat.registered: false` while purchase VAT is chargeable** (the vendor has
  opted to tax and TOGC does not apply). The inert engine would resolve the
  acquisition rate to 0 and charge acquisition tax on the exclusive price while
  the model holds that VAT is due — §17.7. The error message must name the
  correct modelling: `registered: true` with `recoverable_pct: 0` and
  `recovery_basis: 'blocked'`.

Each of these rules is specified for a **set** of fields. R10 twice specified a
rule for three fields and shipped a test named for one. Every rule above needs a
case per field it governs, and the plan's test names must say which.

**Warnings** (each carries real domain content, not a restatement of the schema):

- `recovery_basis: 'zero_rated_sale'` while `exit_strategy` retains any unit.
  The zero-rated first grant is what makes input VAT recoverable; retained
  residential letting is **exempt**, so full recovery is unsafe and the
  recoverable proportion should be restricted. This is the single most likely
  real-world error the model can catch.
- `togc_treatment: 'applies'` with `vendor_opted_to_tax: false` — possible, but
  then the TOGC changes nothing and the finding is probably mis-entered.
- `registered: false` with a non-zero construction cost — the engine is inert
  and the funding need is being reported as zero.
- `vat.receivable_at_maturity_pence > 0` — a reclaim falls outside the modelled
  term and is not in the cash flow.

Note for implementers: `reconcile().issues` carries only errors (bar one
`'model'` warning); input warnings live on `run.validation`. The warnings above
belong to the latter.

## 12. §17.10 — Evidence, the draft gate and reporting

`DraftReason` gains `'vat_basis_unconfirmed'`, ordered immediately after
`'tax_basis_unconfirmed'` in `draftReason()`. The ordering rationale already
written into that function applies unchanged: an unconfirmed VAT basis does not
make the arithmetic wrong, so it must not displace a reason saying the figures
themselves may be; but a reader must know the basis is unverified before they
read an approval.

**Material means the category actually bears VAT** — that is, a treatment row
whose `evidence_status` is `'unconfirmed'` while its resolved charge is non-zero,
or a `purchase.evidence_status` of `'unconfirmed'` while purchase VAT is
chargeable. No threshold constant is invented. An unconfirmed row charging
nothing gates nothing, and `registered: false` can never gate.

`DRAFT_REASON_SENTENCE` and `WATERMARK_TEXT` in `export-investment-memo.ts` are
both `Record<DraftReason, string>`, so adding the union member makes `tsc`
require both — a compile-time guard, not a test that could be forgotten. R9
recorded that a `DraftReason[]` with a length assertion does **not** pin
exhaustiveness; the `Record` shape does.

**The memo** gains a VAT section: treatment by category with rate, recoverable
proportion, basis and evidence status; the return cycle; the month-by-month VAT
carry with its peak; the carry interest; irrecoverable VAT; and any
`vat.receivable_at_maturity_pence`.

**Three existing memo sites must be rewritten, not appended to:**

- `:2141` construction VAT row — now the modelled treatment;
- `:2142` purchase VAT / TOGC row — now the modelled treatment;
- `:2241` the limitation *"VAT is not modelled as a cash flow"* — false the
  moment this release lands.

`memo-release-gate.test.ts:206` pins that sentence and **will fail**. That is
the guard working. This limitations list has carried a disclosure outliving its
feature in R8, R9 and R10, which makes reviewing the whole list — not only this
sentence — a required step rather than a courtesy.

**The deal spider.** `deal-spider.ts:208`'s `construction_cost_pence × 0.15` is
replaced by the modelled figure: the VAT actually saved relative to a
standard-rated counterfactual, less irrecoverable VAT and carry interest. The
`illustrative: true` flag and the help text at `spider-axes.ts:79` change with
it — the "assumes 15% of construction cost" sentence becomes false, and the
UNCONFIRMED caveat becomes evidence-driven rather than permanent. Shipping the
new engine while leaving a hard-coded 15% in the spider would put two VAT
numbers in one report that disagree.

## 13. §17.11 — Migration and the persistence boundary

`migrateV7toV8` / `migrate_v7_to_v8` writes:

- `vat.registered: false`, so the engine is inert and **no existing appraisal's
  computed values move**;
- the six treatment rows at `rate_pct: 0`, `recoverable_pct: 0`,
  `recovery_basis: 'unconfirmed'`, `evidence_status: 'unconfirmed'`;
- `purchase`: `vendor_opted_to_tax: false`, `togc_treatment: 'unconfirmed'`,
  `evidence_status: 'unconfirmed'` — so the chargeable consideration equals the
  price and no acquisition tax moves;
- `vat_override: null` on every package and every fee line;
- the §10 contingency rework: `basis` and `package_ids` dropped, tags retained.

`DEFAULT_VAT` matches the migration exactly, so the feature ships opt-in as
detailed cost-plan mode did, and `conversion-defaults.ts:365`'s statement that
the two engines' v-defaults re-converge stays true.

`RECOGNISED_INPUTS_VERSIONS_V8` is `[1..8]`. R10 found a version predicate
loosened from `=== 6` to `!== 5` — the literal negation of the set's own
definition, so it could never fail. The v8 predicate must be written as
membership of the declared tuple and tested with a document tagged `9`.

There is a `cost_plan` deep-merge on the server upsert path that R10 found
nobody had deleted to check; without it a stored row computes zero contingency.
The v8 work adds a `vat` block to the same merge, and the same "delete it and
watch a test fail" check applies.

### The migration must add no validation issue either (R38)

§17.11 promises the migration is inert. That promise was stated numerically —
*no existing appraisal's computed values move* — and numerically it held. It was
**not** true of validation, and that gap shipped as a defect.

The return-cycle bounds were written unconditionally, gated only on a `vat` block
existing. Migration gives **every** document a `vat` block carrying
`first_period_end_month: 2`. So the moment a stored appraisal with
`term_months <= 2` was migrated, it acquired a hard validation error — from a
block the engine ignores, because `registered` is false and the cycle is never
computed. Measured directly: `term=1` yields `errors=[]` at v7 and
`errors=["vat.first_period_end_month"]` at v8.

A hard error makes `report_safe` false, which marks the report DRAFT. So an
inert migration would have silently downgraded every short-term appraisal in the
database.

**The rule: a field that parameterises a dormant engine is not validated.** The
two return-cycle bounds are gated on `registered: true`. You cannot validate a
return cycle that does not exist, and a document that later registers gets the
error then, which is the right moment for it.

The bounds that stay unconditional are the ones that are nonsense in any state —
a negative rate, a negative recoverable proportion, a treatments array that is
not the six categories. Migration writes zeroes and exactly six rows, so none of
them can fire on a migrated document.

**Both engines carry a regression gate for the general case**, because the
specific bug is less important than the class: migrate every fixture, plus a
synthetic `term_months: 1` document, and assert `validateInputs` returns **the
same issues after migration as before it**. That assertion is what would have
caught this, and it catches the next one too — the numeric identity gate never
could, because the figures genuinely did not move.

### The boundary that broke R10, in full

R10 moved the server to v7 while the client still called `migrateInputsToV6`,
breaking every saved appraisal. The boundary has these halves, and **one task
moves all of them in one commit and runs both suites**:

| Half | Site |
|---|---|
| Server | `app/api/app.py:24` and the upsert path |
| Client — calculator | `frontend/src/components/ConversionCalculator.tsx:3, 131, 227` |
| Client — export | `frontend/src/components/ExportPage.tsx:9, 101, 128` |

A Python-scoped task that never runs vitest is exactly how R10 broke this.
`ConversionCalculator.tsx:115` already carries the comment saying so.

`memo-fixtures.ts` remains v6-typed and bridges through `migrateV5toV6` and
`migrateV6toV7` (lines 16, 283, 449). It gains a third wrapper, which throws
loudly if the fixture set is widened rather than silently migrating a shape
nobody checked.

**Both engines carry the numeric-identity gate**, corpus-wide over all thirteen
fixtures: the v8 twin of `test_v7_migration_moves_no_existing_figure` and of its
counterpart in `golden-fixtures.test.ts`. R9 recorded that such a gate can be
**provably blind** when the migration synthesises a block no engine yet consumes;
here the gate is meaningful only because the VAT engine is live and reads
`registered`. The gate must therefore also assert the migration's **structural**
output — `registered: false`, six rows, every override `null` — not only that
the figures did not move.

Container-level typing still matters: `revalidate_instances='never'` lets a
`CalculatorInputsV7` hold a v8 sub-block. Gate on the container, never on the
block.

## 14. §17.12 — Outputs

`AppraisalResultV2` gains:

- `vat: VatResult` — per-category resolved treatment, per-month VAT out, per-
  month reclaim, the carry vector, peak carry and its month, total input VAT,
  total reclaimed, total irrecoverable, and `receivable_at_maturity_pence`;
- `irrecoverable_vat_pence` — included in `cost_before_finance_pence`;
- `vat_carry_interest_pence` — the **interest** attributable to carrying VAT.
  It is a **disclosure of a slice of `finance_costs_pence`, not an addition to
  it**: the interest is already there, charged by the ledger on a balance the
  VAT outflow raised. Its value is defined by an explicit counterfactual — total
  interest with the document as given, less total interest from the same
  document with `vat.registered` forced false.

### The counterfactual must hold the acquisition tax fixed (R33)

VAT imposes **two** costs, and only one of them is carry:

- a **timing** cost — money out, money back later, interest on the gap;
- a **permanent** cost — acquisition tax charged on the VAT-inclusive
  consideration (§17.7), which never comes back.

A counterfactual that simply forces `registered: false` removes both. Forcing it
drives `resolveVatTreatment` to `INERT`, the acquisition rate to 0, and the
chargeable consideration back to the exclusive price — so the counterfactual run
carries a smaller month-0 outflow, draws less and pays less interest **for a
reason that is not the VAT cash cycle**.

Two things break. `vat_carry_interest_pence` is overstated by the interest on the
SDLT-on-VAT uplift. And §17.5's `Δprofit === Δfinance_costs` identity fails,
because the counterfactual's `cost_before_finance_pence` also falls by the tax
delta. Both occur on any `vendor_opted_to_tax` document — which is precisely the
shape §17.7 blesses for an unregistered buyer, not a hypothetical.

**The counterfactual therefore holds the acquisition tax at the as-given
figure.** It forces `registered: false` *and* pins the counterfactual document's
acquisition tax to the tax the real document was charged, using the existing
`acquisition_tax_override_pence` mechanism with a reason naming the
counterfactual. Acquisition cost is then identical on both sides and the
difference is exactly the VAT cash cycle — including the carry on purchase VAT
itself, which *is* a timing cost and does belong in the figure.

The permanent cost is not hidden by this: it is disclosed by
`chargeable_consideration_pence` and by the acquisition tax itself, which is
where a reader looks for a cost that never comes back.

### Carry interest and profit impact are two quantities, not one (R31)

The field measures **interest**. §17.5's primary invariant measures **profit**,
which moves by the change in `finance_costs_pence`. On most documents these
coincide and the two pin each other, which is why the counterfactual definition
was chosen over an apportionment.

They diverge whenever a **fee base is itself VAT-dependent**. With
`exit_fee_basis: 'peak_debt'`, carrying VAT raises peak debt, which raises the
exit fee — so finance costs rise by more than interest alone, and profit falls by
more than `vat_carry_interest_pence` reports.

Both figures are correct; they answer different questions. The specification
therefore requires **both** to be pinned:

- on a document whose fee bases are VAT-independent, `Δprofit === Δfinance_costs
  === vat_carry_interest_pence`;
- on a document with `exit_fee_basis: 'peak_debt'`, `Δprofit === Δfinance_costs`
  **and** `Δfinance_costs > vat_carry_interest_pence`.

The second test is what stops the divergence being latent. Without it, a later
change that quietly redefined one of the two would be invisible.

### The carry can be negative, and must not be clamped (R32)

Where equity funds the VAT outflow but the reclaim sweeps 100% to senior debt
(§17.6), the reclaim repays borrowing that funded *other* costs. The facility is
then smaller than it would have been without VAT, and
`vat_carry_interest_pence` is **negative** — carrying VAT saved interest.

That is faithful to the ledger and it is not an artefact to tidy away. It is
reported with its sign, never clamped to zero, and the report must read it as a
saving rather than a cost when negative. This follows the codebase's standing
principle that a figure is shown as it falls out, never adjusted to look
sensible — the same rule that keeps a funding gap visible.

The alternative — repaying whichever source actually funded each month's VAT —
was considered and rejected for R11: it requires tracking VAT funding provenance
month by month, and the money is not lost either way, since a smaller facility
reaches the developer as a smaller redemption at exit.
- `chargeable_consideration_pence` — the base the acquisition tax was charged
  on, so the VAT-on-price uplift is visible rather than buried in a tax figure.

`FlagCode` gains `'vat_funding_gap'`.

### VAT under sensitivity

`computeVat` reads the cost plan, so a sensitivity cell that moves construction
cost moves its VAT with it, automatically and with no special-casing. VAT is
**not** a sensitivity lever of its own in R11, and it is **not** invariant across
cells the way the facility is (§12.2). No cell-validity rule changes.

## 15. §17.13 — Stated limitations

The specification must state, and the memo must disclose:

- **No output VAT engine.** Recovery is an input proportion with a declared
  basis, not a computed partial-exemption calculation. A scheme with a genuine
  partial-exemption position needs adviser input to set `recoverable_pct`.
- **No separate VAT facility.** VAT draws on the main facility and is ineligible
  for the development-cost advance; a dedicated VAT bridge with its own limit,
  rate and fee is R14.
- **No capital goods scheme, no option-to-tax revocation, no self-supply
  charge.**
- **No TOGC conditions assessment** — the treatment is recorded and evidenced,
  not tested (R15).
- Reclaims falling after the modelled term are reported as receivable and are
  **not** in the cash flow.
- **`net_ltc_pct` and `gross_ltc_pct` treat VAT differently, deliberately
  (R34).** Gross LTC measures against total development cost, so it moves with
  irrecoverable VAT. Net LTC measures against the cost the lender advances
  against, and VAT is not advance-eligible (§17.6), so it does not. The two are
  internally coherent but will read as a bug if printed side by side unexplained,
  so the report must state which denominator each uses.

## 16. Guards this release must watch fail

Per the standing rule that every guard be planted against and watched failing
before it is trusted:

| Guard | Watched by |
|---|---|
| VAT ineligible for the advance cap | Add `vat_pence` to the eligible base at `monthly-engine.ts:139`; the assertion must break |
| Recoverable VAT is profit-neutral | Leak VAT into any cost base; §7's invariant must break |
| Contingency follows the tag | The planted-divergence document of §10 |
| The single-accessor eslint rule | Downgrade to `'warn'`; the guard test must still fail, and the allowlist contents are asserted |
| The v8 version predicate | A document tagged `9` |
| Migration identity | Corpus-wide, plus the structural assertion, in both engines |
| A full reclaim redeems properly | Build a document whose reclaim clears the balance before any sale; the exit fee must still be charged exactly once, and total exit fee must equal the same document's fee when the sale redeems instead |
| A partial reclaim does not redeem | A reclaim smaller than the balance charges no exit fee and sets no redemption state |
| The server-side `vat` deep-merge | Delete it; a stored-row test must fail |

## 17. Also in scope

`accessor-guard.test.ts`'s real-linter test has timed out intermittently under
full-suite load for two releases. It spawns ESLint's Node API in-process and is
load-sensitive against a 30s global `testTimeout` in `vite.config.ts`. It gets
an explicit per-test timeout.

## 18. Out of scope

Carried defect **C1** (spec §5.10, rolled-up interest charged against the net
facility while the ledger capitalises against the gross) remains owned by R14
and is untouched here. `lender_eligible` remains recorded and unwired, also R14.
The R15 deferrals from R10 — QS source/date/status, fixed-price coverage,
provisional sums, inflation — are unchanged. PDF/UA tagging, raster visual
regression and the jsPDF Symbol-font warning remain open from R7.

## 19. Shape of the work

Roughly fourteen tasks, both engines in lockstep, executed subagent-driven with
a review after each task and a whole-branch review at the end. The seams between
tasks — the persistence boundary, the accessor swap across six call sites, and
the contingency mechanism deletion — are where R10's two worst defects lived, so
review effort is budgeted there and not only inside tasks.

Environment note for every task: `npm install` and `npm ci` both fail on this
repo (`@tailwindcss/vite@4.2.1` wants vite ≤7, project is on vite 8). Use
`npm ci --legacy-peer-deps`.
