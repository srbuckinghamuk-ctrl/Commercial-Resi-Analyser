# R8 — Jurisdiction and acquisition tax (SDLT / LBTT / LTT)

Date: 2026-08-17
Release: R8 of the second lender-readiness audit remediation
Audit source: `docs/reviews/2026-08-17-lender-readiness-second-audit.md` (lines 25, 196, 297, 315)
Release plan: `docs/superpowers/plans/2026-08-17-second-audit-release-plan.md`
Schema: inputs v4 → **v5** · Calc: 2.6.0 → **2.7.0** (minor)

---

## 1. The defect

The product is marketed UK-wide and taxes every acquisition on the England and Northern
Ireland non-residential SDLT bands.

- `frontend/src/lib/commercial-sdlt.ts` and `app/financial_model/sdlt.py` hold the bands as
  module constants. No effective date, no citation, no jurisdiction.
- `frontend/src/lib/model/metrics.ts:78` (and its Python mirror) applies them unconditionally.
- `frontend/src/lib/export-investment-memo.ts:1894` *discloses* the defect in prose:
  "A property in Scotland (LBTT) or Wales (LTT) is not correctly taxed by this version."

A disclosed wrong number is still a wrong number. It flows into acquisition cost, TDC,
profit, every profit ratio, LTC, the residual land value and the deal spider.

The location data needed to fix it already exists and is unused by the calculator:
`PostcodeLookupResponse` (`app/models.py:134`) carries `region` and `country`.

### 1.1 Verified rates

Every band set below was read from the statutory authority on 17 Aug 2026, not from memory.

**Non-residential / mixed, freehold consideration — slice basis, all three regimes.**

| Regime | Jurisdiction | Bands | In force from | Source |
|---|---|---|---|---|
| SDLT | England & N. Ireland | 0% to £150,000 · 2% to £250,000 · 5% above | 17 Mar 2016 | [GOV.UK](https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates) |
| LBTT | Scotland | 0% to £150,000 · **1%** to £250,000 · 5% above | 25 Jan 2019 | [gov.scot ready reckoner](https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/) |
| LTT | Wales | 0% to **£225,000** · 1% to £250,000 · 5% to £1,000,000 · **6%** above | 22 Dec 2020 | [gov.wales](https://www.gov.wales/land-transaction-tax-rates-and-bands) |

Scottish Budget 2026–27 confirms all LBTT rates and bands, including ADS, hold at current
levels.

**The error is bidirectional.** Wales is cheaper than England below £1m and dearer above it,
so no single correction factor covers it:

| Consideration | SDLT (Eng/NI) | LBTT (Scotland) | LTT (Wales) |
|---|---|---|---|
| £753,482 (the audited York case) | £27,174.10 | £26,174.10 | £25,424.10 |
| £2,000,000 | £89,500.00 | £88,500.00 | **£97,750.00** |

**Residential higher rates** — needed only by the deal spider's tax-advantage comparison
(§6). Note the structural difference: England and Scotland charge a flat supplement on the
whole consideration; Wales embeds the uplift in a separate band table with no supplement.

| Regime | Bands | Supplement | From |
|---|---|---|---|
| SDLT | 0% to £125k · 2% to £250k · 5% to £925k · 10% to £1.5m · 12% above | +5% on whole consideration | bands 1 Apr 2025; supplement 31 Oct 2024 |
| LBTT | 0% to £145k · 2% to £250k · 5% to £325k · 10% to £750k · 12% above | +8% ADS on whole consideration | ADS 5 Dec 2024 |
| LTT | 5% to £180k · 8.5% to £250k · 10% to £400k · 12.5% to £750k · 15% to £1.5m · 17% above | none — embedded | 11 Dec 2024 |

---

## 2. Non-goals

Stated so they are not read as oversights.

- **Reliefs and linked transactions.** Multiple dwellings relief, group relief, sub-sale
  relief, linked-transaction aggregation and the non-resident surcharge are not modelled.
  The manual override (§3.4) is the honest escape hatch for these.
- **The "6 or more dwellings" rule.** Non-residential rates already apply by nature to this
  product's acquisitions — a commercial building bought for conversion. The rule is noted in
  the spec as a reason the basis is non-residential, not implemented as a branch.
- **Leasehold premium and NPV-of-rent charges.** Freehold consideration only.
- **VAT and TOGC.** R11.
- **Disposal taxes.** Out of scope for every release in this plan.

---

## 3. Design

### 3.1 One module, replacing both SDLT files

New, mirrored per project convention (no calculation logic in components or report
generators):

- `frontend/src/lib/tax/acquisition-tax.ts`
- `app/financial_model/acquisition_tax.py`

`commercial-sdlt.ts`, `residential-sdlt.ts` and `sdlt.py` are absorbed and **deleted**. There
are five call sites; deprecated wrappers would preserve exactly the ambiguity this release
removes.

The output field `metrics.sdlt_pence` is retained as a deprecated alias of the new
`acquisition_tax_pence` so no consumer breaks in a single step. R16 removes it with the other
legacy columns.

### 3.2 The table

```
Jurisdiction = 'england_ni' | 'scotland' | 'wales'
Regime       = 'SDLT' | 'LBTT' | 'LTT'
TaxBasis     = 'non_residential' | 'residential_higher'

BandSet {
  regime, jurisdiction, basis
  effective_from : ISO date
  effective_to   : ISO date | null      // null = open-ended, the current set
  bands          : [{ up_to_pence, rate_pct }]   // slice basis, ascending, last is unbounded
  surcharge_pct  : number | null        // flat charge on whole consideration; null where none
  source_url, source_note
}
```

The final band's `up_to_pence` is `Infinity` in TypeScript and `math.inf` in Python, matching
the current implementation. JSON cannot represent either, so the normative file encodes an
unbounded top band as `"up_to_pence": null`; each engine's parity test maps null to its own
infinity before comparing. The mapping is asserted in both directions so a table with a
genuinely missing value cannot pass as unbounded.

A module constant `TAX_TABLE_VERSION` (semver) versions the whole table. It is stamped into
every result, printed in the report's provenance panel and included in the audit hash, so a
figure can always be traced to the band set that produced it. This is the audit's "versioned
tax assumptions rather than hard-coded institutional knowledge" made literal.

### 3.3 Selection

`selectBandSet(jurisdiction, basis, date)` returns the single set whose
`[effective_from, effective_to)` window contains `date`.

- Windows within a `(jurisdiction, basis)` group must be contiguous and non-overlapping.
  A unit test asserts this over the whole table rather than trusting the author.
- **A date no set covers is a hard error**, not a clamp to the nearest set. Spec §1.5:
  unknown is not zero, and it is not "probably the oldest one" either. The error names the
  date and the earliest covered date.
- A null `acquisition_date` is a distinct case, handled in §3.5 — not an error, but not
  silent either.

### 3.4 Evaluation

`calculateAcquisitionTax({ consideration_pence, jurisdiction, basis, date })` →

```
AcquisitionTaxResult {
  total_pence, effective_rate_pct
  bands: [{ threshold_pence, rate_pct, tax_pence }]   // per-band working, as today
  surcharge_pence
  regime, jurisdiction, basis
  band_set_effective_from, table_version, source_url
  date_basis : 'transaction_date' | 'assumed_current'
  is_override : boolean
  override_reason : string | null
  computed_total_pence : number | null   // what the bands gave, when overridden
}
```

Slice arithmetic and `money_round` half-up rounding are unchanged from the current
implementation — the England/NI path must reproduce every existing golden figure to the
penny, including the audited York case.

**Override.** When `acquisition_tax_override_pence` is non-null it becomes `total_pence`,
`is_override` is true, and the band-derived figure is preserved in `computed_total_pence` so
the report can show both. An override with an empty reason is a hard validation error — the
same rule shape as R5's cell validity (spec §12.7). The report prints the override, the
computed figure it replaced, and the reason.

### 3.5 Inputs v5

`AcquisitionInputs` gains six fields:

| Field | Type | New-appraisal default |
|---|---|---|
| `jurisdiction` | `Jurisdiction` | derived from postcode, else `england_ni` |
| `jurisdiction_source` | `'derived' \| 'user' \| 'migrated_default'` | `derived` |
| `jurisdiction_evidence_status` | `'unconfirmed' \| 'confirmed'` | `unconfirmed` |
| `acquisition_date` | ISO date \| null | today |
| `acquisition_tax_override_pence` | number \| null | null |
| `acquisition_tax_override_reason` | string | `''` |

`jurisdiction_evidence_status` deliberately reuses the vocabulary of the existing
`EquitySource.evidence_status` so the report's evidence handling is one mechanism, not two.

**Migration `migrateV4toV5`** stamps `england_ni` / `migrated_default` / `unconfirmed` and a
null `acquisition_date`. It is purely additive and **no existing appraisal's computed values
move**: legacy documents were all implicitly English, and the England/NI non-residential
bands have not changed since 2016. This preserves the property v2→v3 and v3→v4 both held.

`migrateInputsToV5` follows the established chain shape exactly — an `isV5` guard, a
field-by-field merge onto v5 defaults for an already-v5 document, and delegation to
`migrateV4toV5(migrateInputsToV4(...))` otherwise. `migrateInputsToV4` gains the same refusal
of a v5 document that `migrateInputsToV3` gives a v4 one.

**A null `acquisition_date`** uses the current (open-ended) band set and marks the result
`date_basis: 'assumed_current'`. Not an error — but it surfaces in the report (§5) rather
than passing silently, because a re-run after a Budget would return a different number.

### 3.6 Derivation from postcode

`deriveJurisdiction(country)` maps the existing `PostcodeLookupResponse.country` — the
postcodes.io values `England`, `Scotland`, `Wales`, `Northern Ireland` — onto the three
jurisdictions, with England and Northern Ireland both mapping to `england_ni`. An
unrecognised or absent country returns null and leaves the field at its default, unconfirmed.

Derivation only ever *proposes*. The result is `unconfirmed` until a user accepts it, and
accepting sets `jurisdiction_source: 'user'` and `jurisdiction_evidence_status: 'confirmed'`.

---

## 4. Parity between engines

`fixtures/tax/acquisition-tax-tables.json` at the repo root — the directory both engines
already read for golden fixtures — is the **normative** record of every band set.

Each engine holds its own table as a native module (the established mirroring pattern; keeps
production code free of any filesystem dependency) and a test in each engine asserts that its
table equals the JSON, field for field. Two implementations, one artifact, and drift is
caught by the gate rather than by a reader noticing.

The JSON is also what a future maintainer edits after a Budget: change the JSON, then both
parity tests fail until both engines are updated.

---

## 5. Report and governance

- **The acquisition-tax line is renamed** from "SDLT" to "Acquisition tax" with the regime
  named in the detail column: e.g. `Acquisition tax (LBTT — Scotland, non-residential, bands
  in force from 25 Jan 2019)`.
- **The false assumption at `export-investment-memo.ts:1894` is deleted** and replaced by a
  true statement of the regime actually applied, its band-set date and its source.
- **Provenance panel (spec §13.1)** gains `tax_table_version` and the applied jurisdiction.
- **Audit hash (spec §13.2)** needs no structural change. `audit_hash()` is a hash of
  `input_hash` and `outputs_hash`, which already commit to the whole input and output
  documents — jurisdiction lands in inputs and `table_version` lands in metrics, so both
  flow in transitively and a memo produced before and after a Budget cannot collide. Adding
  them as separate hash parts would rewrite every stored hash for no gain.
- **`[Information Required]`** lines for: unconfirmed jurisdiction; a `date_basis` of
  `assumed_current`; an override in force.
- **Draft gate.** An unconfirmed jurisdiction or an assumed date holds the memo in DRAFT via
  a new `DraftReason` of `tax_basis_unconfirmed`, ordered immediately before `not_approved`
  so it displaces no more fundamental reason. It is deliberately *not* a hard validation
  error: `report_safe: false` makes the report state that the figures themselves may be
  wrong, whereas here the arithmetic is sound and the basis is unverified. `report-provenance.ts`
  is emphatic about not conflating those two, and this respects that line.
- **Excel export** carries the regime, band-set date and table version alongside the figure.

---

## 6. Deal spider

`deal-spider.ts:185` scores tax advantage as
`(residential SDLT − commercial SDLT + VAT saving + CIL offset) / GDV`. Outside England that
compares English residential rates against Scottish or Welsh commercial rates — incoherent.

Both sides of the comparison move to the appraisal's own jurisdiction, using the
`residential_higher` and `non_residential` bases of one regime. This needs no new code path:
it is three more rows in the table and a basis argument at the call site.

---

## 7. UI

`AcquisitionPage.tsx` gains a jurisdiction control above the existing SDLT breakdown:

- The derived jurisdiction shown with its source ("from postcode YO1 8AW — England"), a
  confirm action, and a manual selector that overrides it.
- An unconfirmed jurisdiction is visually flagged, consistent with existing unconfirmed-field
  treatment.
- An acquisition date field, defaulting to today.
- The band breakdown panel is relabelled to the applied regime and shows the band-set
  effective date and a source link.
- An override field with its mandatory reason, collapsed by default.

No calculation moves into the component; it calls the engine.

---

## 8. Server

Input documents are stored as JSON snapshots, so **no Alembic migration is expected**. The
plan's first task verifies this against `app/persistence/` rather than assuming it; if any
column or index projects an inputs field, a migration is added and the R7 lesson applies
(check the database's actual revision before stamping).

`app/models.py` gains the v5 fields; the API accepts v4 and v5 and normalises to v5 on read,
matching how v3 and v4 are handled today.

---

## 9. Testing

1. **Band tables** — each regime's every band boundary, at the threshold, one penny below and
   one penny above. Zero and negative consideration. Slice arithmetic verified against the
   GOV.UK worked example (£275,000 freehold commercial → £3,250).
2. **The three-regime table in §1.1** as golden values, both engines, tied to the audited
   York consideration of £753,482 so it joins the case R7 already verified externally.
3. **Selection** — window contiguity across the whole table; a date before the earliest set
   raises; a date inside a superseded window returns the historic set, not the current one.
4. **Migration** — v1→v5, v2→v5, v3→v5, v4→v5 chains; idempotence guards; and the
   load-bearing assertion that **every existing golden fixture returns identical metrics
   after migration to v5**.
5. **Override** — replaces the total, preserves the computed figure, empty reason rejected.
6. **Parity** — both engines against `fixtures/tax/acquisition-tax-tables.json`.
7. **Spider** — tax advantage computed within one regime for all three jurisdictions.
8. **Report QA** (R7's `report-qa/` harness) — the regime line is present and positioned, the
   deleted assumption string is absent, the provenance panel carries the table version, and
   an unconfirmed jurisdiction produces both the DRAFT mark and the information-required line.
   Occurrence counts, not `toContain` — R6's lesson, now for a fourth release.
9. **Full gate** — vitest, pytest, eslint, `tsc -b`, production build, plus rendered
   memoranda for an English, a Scottish and a Welsh case, read rather than only asserted.

---

## 10. Spec changes

- **§1.6** — `inputs_version: 5`; calc 2.7.0 described as adding jurisdiction-aware
  acquisition tax and changing no existing computed value.
- **§3.3** — rewritten. The England/NI-only sentence and its R1 scope note are replaced by
  the jurisdiction rule, the basis rule and a pointer to §14.
- **§13.1 / §13.2** — provenance panel and audit hash gain the table version and jurisdiction.
- **New §14 — Acquisition tax** — the regimes, the band sets with sources and effective
  dates, the selection rule, the null-date rule, the override rule and its validity
  condition, and the non-goals of §2 recorded as stated limitations.
