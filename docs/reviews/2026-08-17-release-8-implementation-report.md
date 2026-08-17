# Release 8 — Jurisdiction and acquisition tax (SDLT / LBTT / LTT)

**Date:** 17 August 2026
**Branch:** `release-8-jurisdiction-tax` · merge base `6811976` (R7 merge on main)
**Calc version:** 2.6.0 → **2.7.0** · **Inputs schema:** v4 → **v5** · **Tax table:** 1.0.0 (new)
**Design:** `docs/superpowers/specs/2026-08-17-r8-jurisdiction-acquisition-tax-design.md`
**Plan:** `docs/superpowers/plans/2026-08-17-r8-jurisdiction-acquisition-tax.md`
**Specification:** `docs/financial-model/calculation-specification.md` §14 (new), §1.6, §3.3, §3.18, §13.1, §13.3
**Audit source:** `docs/reviews/2026-08-17-lender-readiness-second-audit.md` (lines 25, 196, 297, 315)

---

## 1. The defect this release closes

The product is marketed UK-wide and charged **England/NI non-residential SDLT on every
acquisition**, wherever the property was. The bands sat in two modules
(`frontend/src/lib/commercial-sdlt.ts`, `app/financial_model/sdlt.py`) as undated,
uncited module constants.

The product *disclosed* the defect in prose. `export-investment-memo.ts:1894` told the
reader that "a property in Scotland (LBTT) or Wales (LTT) is not correctly taxed by this
version". A disclosed wrong number is still a wrong number, and this one flows into
acquisition cost, TDC, profit, every profit ratio, LTC, the residual land value and the
deal spider.

The error is **bidirectional**, so no single correction factor would have covered it —
Wales is cheaper than England below £1m and dearer above it.

The location data needed to fix it already existed and was unused by the calculator:
`PostcodeLookupResponse` (`app/models.py:134`) carries `region` and `country`.

---

## 2. What shipped

Acquisition tax is now jurisdiction-aware end to end, computed from a dated, sourced and
versioned band table rather than from hard-coded institutional knowledge.

| # | Task | Landed |
|---|---|---|
| 1 | Band table + evaluator (TS) + normative JSON | `86fa677..579cd58` |
| 2 | Python mirror | `579cd58..e612bf3` |
| 3 | Inputs v5 types, defaults, migration (TS) | `e612bf3..a7f0679` |
| 4 | Inputs v5 (Python) — *merge branch ported from TS, see §6(c)* | `ccb98fc..af20731` |
| 5 | Both tax call sites rerouted | `af20731..148bb92` |
| 6 | Validation rules, both engines | `148bb92..1e4a2e9` |
| 7 | Deal spider compares within one regime | `1e4a2e9..21df0eb` |
| 8 | Report provenance, regime disclosure, draft gate | `21df0eb..695dd9b` |
| 9 | Report-QA corpus: Welsh / Scottish / unconfirmed routes — *rescoped, see §6(d)* | `695dd9b..ed57afa` |
| 10 | Server boundary, postcode derivation, version guard | `ed57afa..d1f4cf9` |
| 11 | Calculator UI: jurisdiction, date, override | `d1f4cf9..5f13fe5` |
| 12 | Spec §14, calc 2.7.0, Welsh golden fixture, this report | this commit |

`commercial-sdlt.ts`, `residential-sdlt.ts` and `sdlt.py` were **absorbed and deleted**.
Deprecated wrappers would have preserved exactly the ambiguity the release removes.
`metrics.sdlt_pence` is retained as a deprecated alias of `acquisition_tax_pence` so no
consumer breaks in one step; R16 removes it with the other legacy columns.

---

## 3. The verified band tables

Every band set was read from the statutory authority on **17 August 2026**, not from
memory. The implementer transcribed them; the Task 1 reviewer then **independently
re-checked all six sets against the live gov.uk / gov.scot / gov.wales pages** and found
an exact match. The Task 2 reviewer diffed both engines band-for-band: exact agreement.

`fixtures/tax/acquisition-tax-tables.json` is the normative record; both engines assert
their native tables against it, in both directions, so a post-Budget edit fails both gates
until both engines are updated.

### Non-residential / mixed, freehold — the basis every acquisition uses

| Regime | Jurisdiction | Bands (slice) | In force from | Source |
|---|---|---|---|---|
| SDLT | England & N. Ireland | 0% to £150,000 · 2% to £250,000 · 5% above | 17 Mar 2016 | [GOV.UK](https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates) |
| LBTT | Scotland | 0% to £150,000 · **1%** to £250,000 · 5% above | 25 Jan 2019 | [gov.scot](https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/) |
| LTT | Wales | 0% to **£225,000** · 1% to £250,000 · 5% to £1,000,000 · **6%** above | 22 Dec 2020 | [gov.wales](https://www.gov.wales/land-transaction-tax-rates-and-bands) |

Scottish Budget 2026–27 confirms all LBTT rates and bands, including ADS, hold at current
levels.

### Residential higher rates — deal-spider comparison only, never an acquisition

| Regime | Bands (slice) | Supplement | From |
|---|---|---|---|
| SDLT | 0% to £125k · 2% to £250k · 5% to £925k · 10% to £1.5m · 12% above | +5% on whole consideration | bands 1 Apr 2025; supplement 31 Oct 2024 |
| LBTT | 0% to £145k · 2% to £250k · 5% to £325k · 10% to £750k · 12% above | +8% ADS on whole consideration | 5 Dec 2024 |
| LTT | 5% to £180k · 8.5% to £250k · 10% to £400k · 12.5% to £750k · 15% to £1.5m · 17% above | none — embedded in the bands | 11 Dec 2024 |

Note the structural difference the table has to carry: England and Scotland charge a flat
supplement on the whole consideration; Wales embeds the uplift in a separate band set and
charges no supplement.

### Worked figures — the audited York consideration, £753,482

| Regime | Total | vs LTT |
|---|---|---|
| SDLT (England/NI) | 2,717,410p (£27,174.10) | +175,000p |
| LBTT (Scotland) | 2,617,410p (£26,174.10) | +75,000p |
| LTT (Wales) | **2,542,410p (£25,424.10)** | — |

```
LTT slice working:
  0%  on the first £225,000                =        0p
  1%  on £225,000..£250,000   (£25,000)    =   25,000p
  5%  on £250,000..£753,482   (£503,482)   = 2,517,410p
                                     total = 2,542,410p
```

All three are hand-derived and pinned. At £2,000,000 the ordering reverses —
SDLT £89,500, LBTT £88,500, **LTT £97,750** — which is the bidirectionality above.

---

## 4. The release-day behaviour change

> **Every existing appraisal will show a `DRAFT — TAX BASIS UNCONFIRMED — NOT FOR LENDER
> RELIANCE` watermark until both its jurisdiction is confirmed and an acquisition date is
> recorded.**

This is the single most visible consequence of the release and it is deliberate.

It was surfaced to the product owner during Task 8 as an open flag day: `ExportPage.tsx`
and `ConversionCalculator.tsx` load every stored appraisal through the migration chain,
and `migrateV4toV5` stamps every migrated document `england_ni` / `migrated_default` /
`unconfirmed` with a null acquisition date. Once Tasks 10 and 11 pointed those call sites
at v5, the tax gate fires on every pre-R8 document.

**The product owner was asked and decided: accept it.** Migrated documents are genuinely
unverified — nobody ever recorded where those properties were, the system merely assumed
England. There is **no grandfathering and no England-first exemption**. Tasks 10 and 11
implemented the decision rather than softening it; the Task 10 reviewer specifically
confirmed that every changed test expectation changed *because behaviour changed*, and
that the v1-snapshot test gained four assertions rather than losing any.

Recorded plainly, because the final review flagged it: the decision put to the product
owner was described as "confirm the jurisdiction" — a single action — not as "confirm the
jurisdiction and enter an acquisition date". §13.3's FINAL condition needs both halves
(`jurisdiction_evidence_status == 'confirmed'` *and* `date_basis == 'transaction_date'`,
spec §14.6), and migration leaves the date null, so a migrated document does not reach
FINAL on jurisdiction confirmation alone. The shipped gate is correct and matches the
code and the UI; what was recorded against the product owner's sign-off understated it.

What this does and does not mean:

- **No stored figure moves.** Migration is purely additive, legacy documents were all
  implicitly English, and the England/NI non-residential bands have not changed since
  17 March 2016. The additive property was confirmed empirically across all seven
  pre-existing fixtures: byte-identical metrics v4 vs v5.
- **`report_safe` stays true.** An unconfirmed jurisdiction does not assert the figures
  are wrong — see §7 below on why this is a draft reason and not a validation error.
- **Confirmation is two actions, once per appraisal**, on the acquisition page: confirming
  the jurisdiction and entering an acquisition date. Migration leaves the date null, so
  confirming the jurisdiction alone does not clear the watermark — `AcquisitionPage.tsx`'s
  amber banner names the missing date explicitly, and a migrated fixture walked through the
  UI stays `DRAFT / tax_basis_unconfirmed` after the jurisdiction is confirmed, only
  reaching `DRAFT / not_approved` once a date is also entered.

---

## 5. What the rendered memoranda actually show

The gate and the rendered page catch different defects — R7's hard-won lesson. Four
memoranda were generated and their extracted text read, not merely asserted against.

| Case | Acquisition tax | Provenance panel | Assumption schedule | Watermark |
|---|---|---|---|---|
| England/NI, confirmed | £10,750 (1,075,000p) | `England & Northern Ireland (SDLT)` · table `1.0.0` | "SDLT non-residential bands for England & Northern Ireland in force from 17 Mar 2016" | `DRAFT - NOT APPROVED FOR LENDER RELIANCE` |
| Scotland, confirmed | £9,750 (975,000p) | `Scotland (LBTT)` · table `1.0.0` | "LBTT non-residential bands for Scotland in force from 25 Jan 2019" | `DRAFT - NOT APPROVED FOR LENDER RELIANCE` |
| Wales, confirmed | £9,000 (900,000p) | `Wales (LTT)` · table `1.0.0` | "LTT non-residential bands for Wales in force from 22 Dec 2020" | `DRAFT - NOT APPROVED FOR LENDER RELIANCE` |
| England/NI, **unconfirmed** | £10,750 | `England & Northern Ireland (SDLT) — basis unconfirmed` | as England above | **`DRAFT - TAX BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE`** |

Read by eye, and worth recording:

- **The acquisition-tax line names the regime, the jurisdiction, the basis, the band-set
  date and the table version** in the assumption schedule's basis column, e.g.
  `LTT — Wales, non-residential, bands in force from 22 Dec 2020 (table 1.0.0)`.
- **The Use of Funds heading now reads "Acquisition (inc. tax)"**, not "inc. SDLT".
- **The three regimes' acquisition costs differ by exactly the tax difference** —
  44,787,500p / 44,687,500p / 44,612,500p against 1,075,000p / 975,000p / 900,000p. The
  100,000p and 175,000p gaps agree to the penny, which is the two-call-site property of
  §6(a) below observed in the rendered document rather than only in a unit test.
- **The unconfirmed memo's prose names the reason**, replacing the generic approval
  sentence: *"It is a draft because the acquisition tax jurisdiction has not been
  confirmed."* The confirmed cases instead say *"No lender case has been submitted for
  credit approval, which is why it remains a draft."* The two claims are distinct and are
  printed distinctly.
- **The audit-hash caption is unchanged and still names six fields**, correctly — see §8.
- **The old false sentences are gone.** Neither "England/NI only" nor "not correctly taxed
  by this version" appears in any of the four documents.

---

## 6. Plan defects found mid-release

Four, all of them defects in **my plan** rather than in the implementation of it — and the
first of them recurred three times, at every layer it could. Each was found by an
implementer or a reviewer and verified independently by the controller; (a) and (b) were
recorded as formal controller adjudications, (c) as an adjudication on Task 4, and (d) as a
controller scope correction. They are listed together because they share a cause: a plan
author writing confidently about code they had read too quickly.

### (a) Acquisition tax was computed at more sites than the plan named — three times

This is the release's most instructive defect, because it **recurred at every layer it
could**. The plan's mental model was "there is one place that computes acquisition tax".
There were three, and the plan named one of them each time.

**Instance 1 — the cost stack (Task 5, found by the implementer).**
`calculateTotalAcquisitionCost` / `calculate_total_acquisition_cost`
(`conversion-calc-engine.ts:18`, `schedule.py`) feeds `acquisition_cost_pence` and hence
TDC, and was still hard-wired to `england_ni`, while `metrics.ts:120`'s `costExLand` used
the new jurisdiction-aware figure. On a Welsh document the two disagreed by £1,750 on the
York price, and the memo's headline "Acquisition (inc. SDLT)" line would have printed
**English SDLT on a Welsh property** — the precise defect this release exists to remove,
reintroduced one layer up.

Ruled: route the second site as well, and add a cross-site agreement guard parametrised
over all three jurisdictions. English behaviour is unchanged; the fix makes Wales and
Scotland behave as England already did. The Task 5 reviewer mutated **both** engines to
prove the drift guard has teeth (two failures each, Wales and Scotland).

**Instance 2 — the same defect surviving the fix (Task 5 fix round 2).** After instance 1
was closed, the two Python gates still used different predicates, so the sites could drift
apart again on a constructed object. Recorded in full as §7(6), because it was a review
finding rather than a plan defect.

**Instance 3 — the calculator UI (Task 11, carried forward from the Task 5 review).**
`AcquisitionPage.tsx`'s SDLT breakdown panel was hard-wired to `england_ni` while the
**Total Acquisition Cost figure directly beneath it** was already jurisdiction-aware. A
user opening a Welsh appraisal would have seen **two contradicting tax figures on one
screen**, inches apart — a breakdown that did not add up to the total printed under it.

My Task 11 brief named only the heading. The Task 5 reviewer caught the panel while
reviewing a different task and wrote it into the ledger as an explicit carry-forward
("Task 11 must fix BOTH, not just the heading"), which is the only reason it was fixed.
**No test failed on it** — there was no assertion tying the panel to the card. Task 11
owned it as its defect A and closed it at `08c5d1a`; the reviewer verified the panel and
the cost card now agree **pence-exact** on a Welsh document.

**The lesson.** Two instances would suggest a slip. Three, at the engine and then at the
UI, say the plan was wrong about the shape of the system rather than about one line of it
— and that each fix reached only as far as the layer the task's brief was looking at. The
cross-site agreement guard now pins the engine layer; the UI layer is pinned by Task 11's
panel-equals-card assertion. What is still unpinned is the *general* property, that no
third site can appear: nothing structurally prevents a fourth consumer from computing its
own figure. Worth a lint rule or a single exported accessor in a later release.

### (b) A plan test asserted the opposite of spec §3.18

**Found in the same task.** My brief specified a test asserting that a tax override moves
the RLV. Spec §3.18 defines cost-excluding-land as `TDC − purchase price − acquisition
tax`, so the RLV is **invariant** to acquisition tax by design.

The test passed — but only *because* the two call sites disagreed. Once (a) was fixed it
would have failed. A test that encodes a plan author's misreading, and is kept green by an
unrelated bug, is worse than no test.

Ruled: delete the wrong test, replace it with the §3.18 invariance property, and record
the invariance in the specification (done in this task). §3.18 now states it explicitly,
along with the fact that it holds only because both sites use the same figure.

### (c) The plan told Python to do something different from TypeScript

**Found by the Task 4 implementer, adjudicated by the controller.** My Task 4 brief
specified a bare `model_validate` for the already-v5 branch of `migrate_inputs_to_v5`,
where the TypeScript does a **field-by-field merge onto v5 defaults**. That is a
plan-internal contradiction: the plan's own standing Global Constraint says *both engines
mirror*, and a snippet in one task cannot override a constraint that binds every task.

It is not a stylistic difference. A v5 row saved before a schema field existed would
**raise in Python and default-fill in TypeScript** — the same stored document accepted by
one engine and rejected by the other. And a `deal_spider` block missing its `weights` key
collapsed to `{}`, which moves spider scoring rather than merely failing loudly.

Ruled: the Global Constraints govern over the brief snippet; port the merge. The additive
property was then confirmed empirically across all seven fixtures — byte-identical metrics
v4 vs v5.

### (d) Half of Task 9 was unbuildable as planned

**Found by the implementer, corrected in scope by the controller.** The plan gave Task 9
four halves' worth of work, two of which could not be done because they described code
that does not do what the plan assumed: `export-excel.ts` exports the **projects**
pipeline and carries no tax figure at all, and `export-pdf.ts` prints no acquisition tax.
There was nothing in either to make jurisdiction-aware.

The real gap was elsewhere and the plan had missed it: all five standing report-QA routes
were **English pre-R8 v4 documents**, so the QA corpus could not observe a non-English
memo at all. Task 9 was rescoped to add Welsh, Scottish and unconfirmed v5 fixtures to the
iterated `ROUTES` plus a reusable `checkAcquisitionTaxDisclosure`. The reviewer confirmed
the new helper is a strict **superset** of the assertions it replaced, including all three
load-bearing zero-counts.

§2's table lists Task 9 by what it delivered, not by what the plan asked for; this is the
difference.

---

## 7. Defects the reviews caught that the tests did not

These are the release's real lesson: eight defects that a fully green suite did not see.
Several were introduced *by fixes*, and two turned working features into dead code without
failing a single test. A ninth belongs to this class but is told in §6(a) instead, because
it is the third instance of that section's pattern: the calculator's SDLT panel contradicting
the total printed directly beneath it on a Welsh appraisal, caught by a carry-forward from
another task's review rather than by any test.

1. **A v5 document silently corrupted by the v4 migration path** *(Task 4, Critical)*.
   `migrate_inputs_to_v4` had no `is_v5` guard, so a v5 document fell through to the v1
   fallback via `app.py:400` and was silently rebuilt — R8 fields dropped, the confirmed
   equity source replaced, the facility reconstructed from `ltv_pct`. Not reachable at the
   time (nothing emitted v5 yet), which is exactly why no test failed. The same class of
   hole reappeared at Task 10 for *unrecognised* versions (6, 99) and for a structurally
   invalid v5; both now return 422 in both engines, reproduced against the real ASGI app.

2. **Two validation rules that were unreachable dead code** *(Task 6, Important)*.
   `runAppraisal` calls `buildSchedule` **before** `validateInputs`, and the tax call sites
   called `selectBandSet` unwrapped — so a bad `acquisition_date` threw a crash panel
   before the new field-level error could ever fire. Task 6 shipped two rules that could
   not run, and its own suite was green. The fix introduced one shared
   `resolveAcquisitionDate` / `resolve_acquisition_date` helper rather than four
   try/catches, so identical degradation is structural rather than repeated; the
   re-reviewer mutated all four call sites and each fails four tests loudly.

3. **A release-gate test that was itself pinning the false sentence** *(Task 8)*. The memo
   release gate asserted the presence of the England-only copy it was supposed to be
   protecting against. The gate was **corrected, not weakened**: the zero-counts it now
   carries are the only thing that would catch the old false sentence being re-added
   *alongside* the true one.

4. **A draft-reason ordering whose inversion survived the entire suite** *(Task 8,
   Important)*. Inverting the order of `tax_basis_unconfirmed` and `not_approved` passed
   all 1,070 tests. It was production-reachable: `ExportPage` passes no
   `lenderCaseStatus`, so `not_approved` would have won every time and the tax gate would
   have been permanently dead code. Now pinned diagonally, and recorded in spec §13.3 as
   load-bearing.

5. **A silent data-loss path introduced by a fix** *(Task 11, Important)*. The adoption fix
   made `handleSave` close over `inputs` and unconditionally overwrite state after the
   await — but `saving` disables only the Save button, so an edit made mid-flight was
   silently reverted with no message. The repo's own audit history flags this class as P0.
   The reviewer reproduced the failure by removing the guard.

6. **The two Python tax gates used different predicates, so the sites could drift again**
   *(Task 5 fix round 2, Important)*. After the §6(a) fix, `metrics.py` gated on the
   **container** while `schedule.py` gated on the **acquisition block**. Pydantic's
   `revalidate_instances='never'` means a constructed object can hold a v4 container with a
   v5 acquisition block — and on exactly that hybrid document the two tax sites disagreed
   again. The §6(a) fix had closed the path through parsed input and left the constructed
   one open. The re-reviewer verified this hands-on: reverting `metrics.py` to the container
   gate fails precisely the new hybrid-document guard.

7. **The client displayed and posted English SDLT on a non-English property**
   *(Task 10 carry-forward to Task 11)*. On the **first save** of a non-English project the
   calculator state started from `defaultCalculatorInputsV4` on `england_ni`, so the client
   showed and posted SDLT while the server derived the real jurisdiction and stored
   LTT/LBTT. Measured on fixture A: **91,388,400 shown against 91,213,400 stored**, plus a
   spurious `client_mismatch` recorded on every such first save, because `handleSave` never
   adopted the server snapshot. This was a user-visible wrong tax figure on a non-English
   property — precisely the defect this release exists to remove, surviving into the release
   that removes it. Task 11 made `handleSave` adopt the server snapshot; what remains is
   §10 item 6's residue, one audit row, not a stored wrong figure.

8. **A timeout set in a fix round would have made jurisdiction derivation never fire**
   *(Task 10 fix round 2)*. My 2.0s cap on the postcode lookup was set against ~2s measured
   `postcodes.io` latency. It would have turned a working feature into dead code —
   derivation silently timing out on essentially every real request, the field left at its
   `england_ni` default, and **every test still green**, because the suite is hermetic and
   never pays real latency. Raised to 5.0s. Worth stating plainly: this is the failure mode
   the whole release is about — a plausible default standing in for an unknown — reproduced
   inside the fix for it.

Three further findings are worth recording for their shape rather than their severity. The
Task 7 implementer caught that my brief's spider fixture had `gdv_pence = 0`, which
short-circuits `taxAdvantagePct` to 0 on **both** sides — the test would have passed for
the wrong reason. The Task 10 report claimed frontend test coverage that did not exist
(`ConversionCalculator.test.tsx` mocks `getAppraisal` to always 404; `ExportPage` had no
test file at all); the coverage was then actually written, and mutation-checked at 14
failing tests. And the Task 10 version guard shipped **Python-only**, breaking the standing
both-engines-mirror constraint — `migrateInputsToV5` carried the identical hole on the path
every existing appraisal now loads through, which is the worst possible place for it. Both
were flagged by the implementer, not by a test.

---

## 8. Two documented corrections to the design

Both were made deliberately and are recorded in the specification, because in each case
implementing the design as written would have been wrong.

**The audit hash gains no new components.** The design doc (§3.2, §5) reads as though
`tax_table_version` and jurisdiction are added to `audit_hash`. They are not, and must not
be: `audit_hash()` hashes `input_hash` and `outputs_hash`, which already commit to the
full input and output documents — the jurisdiction lives in the input document, the table
version and applied regime in the output document. Both are therefore **already bound
transitively**. Adding them as named components would rewrite every stored hash while
binding nothing new. `app/financial_model/hashing.py` is byte-identical to `main` on this
branch (empty `git diff`), and the memoranda still print the six-field caption unchanged.
Spec §13.1 now states this explicitly so the next reader does not "fix" it.

**The report gate is a new `DraftReason`, not a hard validation error.** Making an
unconfirmed jurisdiction set `report_safe: false` would print "one or more hard validations
fail" — a claim that the *figures* are wrong, when only the basis is unverified. The
existing module is emphatic about not conflating those three claims, so
`tax_basis_unconfirmed` joins the enum instead, ordered third: below the two conditions
that say the arithmetic may be wrong, above approval. Both engines confirmed the severity
split empirically.

---

## 9. Final gate

Run on the committed tree.

| Gate | Baseline (R7) | This release |
|---|---|---|
| `npx tsc -b` | clean | **clean** |
| `npx eslint .` | clean | **clean** |
| `npx vitest run` | 1136 | **1186 passed**, 51 files |
| `npm run build` | ok | **ok** (2.45s) |
| `python -m pytest tests/ -q` | 914 | **969 passed** |

Both engines' fixture corpora are pence-exact, and the two York pin files were **never
edited on the whole branch** (empty diff against `main`) — verified by the Task 5 reviewer
and again here.

---

## 10. Open and deferred items

Carried from the ledger's `minor (deferred)` lines. None blocks the release.

| # | Item | Where |
|---|---|---|
| 1 | `_REGIME_BY_JURISDICTION` is typed `dict[str, Regime]`, not `dict[Jurisdiction, Regime]`. Inherited from the task brief; no runtime effect. | `app/financial_model/acquisition_tax.py` |
| 2 | `is_v5` is shape-gated, so `{"inputs_version": 5}` with no finance block still falls to the v1 path. This **mirrors TS `isV5` exactly** — a mirrored limitation, not a new one. | both engines |
| 3 | `app/financial_model/__init__.py` re-exports `migrate_inputs_to_v5`, `calculate_acquisition_tax`, `derive_jurisdiction`, `regime_for`, `AcquisitionTaxResult` and `TAX_TABLE_VERSION`, but not `CalculatorInputsV5`, `AcquisitionInputsV5`, `is_v5` or `migrate_v4_to_v5` — asymmetric with V2/V3/V4, whose `is_v4` and `migrate_v3_to_v4` are both exported. | Python |
| 4 | `.claude/worktrees/release-3b-exits-ui/.../export-investment-memo.ts:1387` still carries the old false England/NI-only string. Tracked but never compiled (outside `tsconfig.app.json`) and **predates this branch** — repo hygiene, not this release. | worktree |
| 5 | Task 9's write-up says mutation 3 failed one test; it actually fails two. The write-up **understates** its own coverage. No code change. | doc only |
| 6 | Residue of §7(7). The original defect — the client displaying and posting English SDLT on a non-English property, 91,388,400 shown against 91,213,400 stored — is **fixed**: `handleSave` now adopts the server snapshot. What remains is that the first such save still writes one audit row recording a `client_mismatch`. That is a spurious audit entry, not a stored wrong figure. Reviewed and accepted. | UI |

Process note from Task 1, recorded rather than actioned: the implementer transcribed the
band values without independently re-checking the sources. The reviewer did re-check and
found no slips, but the ordering should be reversed next time a statutory table is touched
— verify at transcription, not only at review.

**Still unmodelled and stated in spec §14.8**, not oversights: reliefs (MDR, group,
sub-sale), linked transactions, the non-resident surcharge, leasehold premium and the
NPV-of-rent charge, and the "6 or more dwellings" rule (noted as the *reason* the basis is
non-residential, not implemented as a branch). VAT/TOGC is R11; disposal taxes are out of
scope for this plan. §14.5's reasoned override is the honest escape hatch for all of them.

Carried forward from R7 and still open: raster visual regression of report pages, and
PDF/UA structure tagging.

---

## 11. Files a reviewer should look at closely

- `frontend/src/lib/tax/acquisition-tax.ts` and `app/financial_model/acquisition_tax.py` —
  the table, and the `resolveAcquisitionDate` degradation contract with its deliberately
  narrow catch.
- `frontend/src/lib/model/metrics.ts` and `frontend/src/lib/conversion-calc-engine.ts` —
  the two engine tax call sites of §6(a), and the cross-site drift guard that holds them
  together.
- `frontend/src/components/calculator/AcquisitionPage.tsx` — §6(a)'s third instance: the SDLT breakdown
  panel and the Total Acquisition Cost card beneath it must agree pence-exact on a
  non-English document. This is the layer the engine's drift guard does not reach; the
  assertion that holds it is `AcquisitionPage.test.tsx` › *"the tax on screen is the tax
  inside Total Acquisition Cost, not a second calculation"* (900,000p inside 44,612,500p on
  a Welsh document).
- `fixtures/financial-model/m-wales-jurisdiction.json` — the new fixture, and the
  England/NI-vs-Wales assertions that replace the pre-R8 loop for it
  (`golden-fixtures.test.ts`, `tests/test_financial_model_fixtures.py`).
- `frontend/src/lib/report-provenance.ts` — `draftReason`'s ordering, which is
  load-bearing and was invisible to 1,070 tests.
- `docs/financial-model/calculation-specification.md` §14, and §13.1's statement about
  transitive hashing.
