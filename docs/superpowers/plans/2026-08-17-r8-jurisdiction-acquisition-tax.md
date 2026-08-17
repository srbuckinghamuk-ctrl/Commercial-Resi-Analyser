# R8 — Jurisdiction and Acquisition Tax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make acquisition tax jurisdiction-aware — SDLT for England/NI, LBTT for Scotland, LTT for Wales — computed from a dated, versioned, externally-sourced band table instead of hard-coded England-only constants.

**Architecture:** One new mirrored module per engine (`acquisition-tax.ts` / `acquisition_tax.py`) holds every band set as dated records and evaluates them on a slice basis. A normative JSON file at the repo root is the single source both engines are tested against. Inputs move to v5 with a jurisdiction, an acquisition date and a manual override; the migration is purely additive and moves no existing computed value. The report names the regime it applied and holds a memo in DRAFT while the tax basis is unconfirmed.

**Tech Stack:** TypeScript + Vitest (frontend engine), Python 3.11 + Pydantic + pytest (backend engine), jsPDF (report), React (calculator UI).

**Design spec:** `docs/superpowers/specs/2026-08-17-r8-jurisdiction-acquisition-tax-design.md`

## Global Constraints

- **Both engines mirror.** Every calculation added to `frontend/src/lib/` gets an identical-result port in `app/financial_model/`. No calculation logic in React components or report generators (spec §11).
- **Money is integer pence.** Rounding is half-up via `Math.round` (TS) / `money_round` (Python). Percentages are numbers like `2` for 2%, never `0.02`.
- **Unknown is not zero** (spec §1.5). A missing value is `null` and is reported as unknown; it never degrades to `0`.
- **Calc version moves 2.6.0 → 2.7.0.** Inputs version moves 4 → 5.
- **No existing computed value may change.** Every pre-existing golden fixture must return identical metrics after migration to v5. This is asserted, not assumed (Task 5).
- **Test assertions on report text count occurrences**, never `toContain` alone — a substring assertion cannot see a duplicate (R6/R7 lesson).
- **`TAX_TABLE_VERSION` starts at `'1.0.0'`** and is a plain semver string constant.
- Dates are ISO `YYYY-MM-DD` strings throughout. Comparison is lexicographic, which is correct for this format.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `fixtures/tax/acquisition-tax-tables.json` | Normative record of every band set. Both engines tested against it. |
| `frontend/src/lib/tax/acquisition-tax.ts` | Types, band table, selection, evaluation, jurisdiction derivation (TS). |
| `frontend/src/lib/tax/acquisition-tax.test.ts` | Boundary, golden, selection and parity tests (TS). |
| `app/financial_model/acquisition_tax.py` | Python mirror of the above. |
| `tests/test_acquisition_tax.py` | Python boundary, golden, selection and parity tests. |
| `tests/test_migrate_v5.py` | v1→v5 … v4→v5 migration chain tests. |
| `fixtures/financial-model/m-wales-jurisdiction.json` | Golden fixture exercising a non-English regime end to end. |

**Deleted:** `frontend/src/lib/commercial-sdlt.ts`, `frontend/src/lib/commercial-sdlt.test.ts`, `frontend/src/lib/residential-sdlt.ts`, `frontend/src/lib/residential-sdlt.test.ts`, `app/financial_model/sdlt.py`.

**Modified:** `frontend/src/lib/model/finance-types.ts`, `migrate.ts`, `metrics.ts`, `validation.ts`, `index.ts`; `frontend/src/lib/conversion-defaults.ts`, `deal-spider.ts`, `report-provenance.ts`, `export-investment-memo.ts`, `export-excel.ts`; `frontend/src/components/calculator/AcquisitionPage.tsx`; `frontend/src/lib/report-qa/report-checks.ts`, `memo-release-gate.test.ts`; `app/financial_model/types.py`, `migrate.py`, `metrics.py`, `validation.py`, `__init__.py`; `app/models.py`, `app/api/app.py`; `docs/financial-model/calculation-specification.md`.

---

## Task 1: The band table, the evaluator, and the normative JSON

**Files:**
- Create: `fixtures/tax/acquisition-tax-tables.json`
- Create: `frontend/src/lib/tax/acquisition-tax.ts`
- Test: `frontend/src/lib/tax/acquisition-tax.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Jurisdiction`, `Regime`, `TaxBasis`, `TaxBand`, `BandSet`, `AcquisitionTaxResult`, `TAX_TABLE_VERSION`, `TAX_TABLES`, `selectBandSet()`, `calculateAcquisitionTax()`, `deriveJurisdiction()`, `regimeFor()`. Every later TS task imports from `../tax/acquisition-tax`.

**Background the implementer needs:** the tax is charged on a *slice* basis — each portion of the price is taxed at its own band's rate, exactly like income tax, not a single rate on the whole sum. The existing `commercial-sdlt.ts` already does this correctly; the loop below is that loop generalised over a table. Wales's higher residential rates are baked into its band table and carry no separate supplement, while England and Scotland add a flat supplement on the whole consideration — hence `surcharge_pct` being nullable.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/tax/acquisition-tax.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TAX_TABLES, TAX_TABLE_VERSION, calculateAcquisitionTax, selectBandSet,
  deriveJurisdiction, regimeFor,
} from './acquisition-tax';
import type { Jurisdiction, TaxBasis } from './acquisition-tax';

// The audited York consideration (R7: 9 & 9A Stonegate, £753,482) and a price
// above Wales's £1m 6% threshold, so the table is exercised on both sides of
// the point where LTT overtakes SDLT.
const YORK = 75_348_200;
const TWO_MILLION = 200_000_000;

describe('non-residential acquisition tax by jurisdiction', () => {
  const cases: Array<[Jurisdiction, number, number]> = [
    ['england_ni', YORK, 2_717_410],
    ['scotland', YORK, 2_617_410],
    ['wales', YORK, 2_542_410],
    ['england_ni', TWO_MILLION, 8_950_000],
    ['scotland', TWO_MILLION, 8_850_000],
    ['wales', TWO_MILLION, 9_775_000],
  ];

  it.each(cases)('%s at %ip is %ip', (jurisdiction, price, expected) => {
    const r = calculateAcquisitionTax({
      consideration_pence: price, jurisdiction,
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(r.total_pence).toBe(expected);
  });

  // GOV.UK's own worked example: £275,000 freehold commercial → £3,250.
  it('reproduces the GOV.UK worked example', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: 27_500_000, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(r.total_pence).toBe(325_000);
  });

  it('taxes nothing at or below the nil-rate threshold and one penny above it', () => {
    const at = calculateAcquisitionTax({
      consideration_pence: 15_000_000, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(at.total_pence).toBe(0);
    const above = calculateAcquisitionTax({
      consideration_pence: 15_000_001, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(above.total_pence).toBe(0); // 1p at 2% rounds to 0p
    const clear = calculateAcquisitionTax({
      consideration_pence: 15_002_500, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(clear.total_pence).toBe(50);
  });

  it('returns zero for zero and negative consideration', () => {
    for (const p of [0, -1]) {
      const r = calculateAcquisitionTax({
        consideration_pence: p, jurisdiction: 'england_ni',
        basis: 'non_residential', date: '2026-08-17',
      });
      expect(r.total_pence).toBe(0);
      expect(r.effective_rate_pct).toBe(0);
    }
  });
});

describe('residential higher rates', () => {
  // England: bands to 2,767,410p plus a 5% supplement on the whole 75,348,200p.
  it('adds England’s flat supplement on the whole consideration', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'england_ni',
      basis: 'residential_higher', date: '2026-08-17',
    });
    expect(r.surcharge_pence).toBe(3_767_410);
    expect(r.total_pence).toBe(6_534_820);
  });

  it('applies no supplement in Wales — the uplift is inside the bands', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'wales',
      basis: 'residential_higher', date: '2026-08-17',
    });
    expect(r.surcharge_pence).toBe(0);
  });
});

describe('band set selection', () => {
  it('names the regime for each jurisdiction', () => {
    expect(regimeFor('england_ni')).toBe('SDLT');
    expect(regimeFor('scotland')).toBe('LBTT');
    expect(regimeFor('wales')).toBe('LTT');
  });

  it('marks a null date as an assumed-current basis rather than failing', () => {
    const { dateBasis, set } = selectBandSet('scotland', 'non_residential', null);
    expect(dateBasis).toBe('assumed_current');
    expect(set.effective_to).toBeNull();
  });

  it('throws for a date no band set covers, naming the earliest covered date', () => {
    expect(() => selectBandSet('wales', 'non_residential', '1990-01-01'))
      .toThrow(/1990-01-01.*2020-12-22/);
  });

  it('has contiguous, non-overlapping windows in every group', () => {
    const groups = new Map<string, typeof TAX_TABLES>();
    for (const s of TAX_TABLES) {
      const key = `${s.jurisdiction}|${s.basis}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    expect(groups.size).toBe(6); // 3 jurisdictions x 2 bases
    for (const [key, sets] of groups) {
      const sorted = [...sets].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
      for (let i = 0; i < sorted.length - 1; i++) {
        expect(sorted[i].effective_to, `${key} set ${i} must close`).toBe(sorted[i + 1].effective_from);
      }
      expect(sorted[sorted.length - 1].effective_to, `${key} must end open`).toBeNull();
    }
  });

  it('orders every band set ascending and leaves the top band unbounded', () => {
    for (const s of TAX_TABLES) {
      const tops = s.bands.map((b) => b.up_to_pence);
      expect([...tops].sort((a, b) => a - b)).toEqual(tops);
      expect(tops[tops.length - 1]).toBe(Infinity);
    }
  });
});

describe('override', () => {
  it('replaces the total, preserves the computed figure, and records the reason', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
      override_pence: 1_000_000, override_reason: 'Group relief claimed (FA2003 Sch 7).',
    });
    expect(r.total_pence).toBe(1_000_000);
    expect(r.is_override).toBe(true);
    expect(r.computed_total_pence).toBe(2_717_410);
    expect(r.override_reason).toBe('Group relief claimed (FA2003 Sch 7).');
  });

  it('reports no override when none is supplied', () => {
    const r = calculateAcquisitionTax({
      consideration_pence: YORK, jurisdiction: 'england_ni',
      basis: 'non_residential', date: '2026-08-17',
    });
    expect(r.is_override).toBe(false);
    expect(r.computed_total_pence).toBeNull();
  });
});

describe('jurisdiction derivation', () => {
  it.each([
    ['England', 'england_ni'], ['Northern Ireland', 'england_ni'],
    ['Scotland', 'scotland'], ['Wales', 'wales'],
  ])('maps %s to %s', (country, expected) => {
    expect(deriveJurisdiction(country)).toBe(expected);
  });

  it('returns null for an unknown, empty or absent country', () => {
    for (const c of ['Isle of Man', '', null, undefined]) {
      expect(deriveJurisdiction(c)).toBeNull();
    }
  });
});

describe('parity with the normative table', () => {
  it('matches fixtures/tax/acquisition-tax-tables.json field for field', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/tax/acquisition-tax-tables.json'), 'utf-8'),
    );
    expect(raw.table_version).toBe(TAX_TABLE_VERSION);
    // JSON cannot hold Infinity, so an unbounded top band is encoded as null.
    // Map in one direction only, and assert the count, so a genuinely missing
    // value cannot pass as unbounded.
    const normalised = raw.band_sets.map((s: Record<string, unknown>) => ({
      ...s,
      bands: (s.bands as Array<{ up_to_pence: number | null; rate_pct: number }>).map((b) => ({
        up_to_pence: b.up_to_pence === null ? Infinity : b.up_to_pence,
        rate_pct: b.rate_pct,
      })),
    }));
    expect(normalised).toEqual(TAX_TABLES);
    const nullTops = raw.band_sets.filter(
      (s: { bands: Array<{ up_to_pence: number | null }> }) =>
        s.bands.filter((b) => b.up_to_pence === null).length === 1,
    );
    expect(nullTops.length).toBe(raw.band_sets.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/tax/acquisition-tax.test.ts`
Expected: FAIL — "Failed to resolve import ./acquisition-tax".

- [ ] **Step 3: Write the module**

Create `frontend/src/lib/tax/acquisition-tax.ts`:

```ts
/**
 * Acquisition tax (spec §14) — SDLT in England and Northern Ireland, LBTT in
 * Scotland, LTT in Wales.
 *
 * The second lender-readiness audit found a UK-wide product charging England/NI
 * SDLT on every acquisition, with the bands as undated module constants. This
 * module replaces `commercial-sdlt.ts` and `residential-sdlt.ts` with a dated,
 * versioned and sourced table so that a figure can always be traced to the band
 * set that produced it, and so that re-running a historic appraisal after a
 * Budget returns the same number it did before.
 *
 * `fixtures/tax/acquisition-tax-tables.json` is the normative record of this
 * table; both engines are tested against it (see the parity tests).
 */

export type Jurisdiction = 'england_ni' | 'scotland' | 'wales';
export type Regime = 'SDLT' | 'LBTT' | 'LTT';
export type TaxBasis = 'non_residential' | 'residential_higher';

export interface TaxBand {
  /** Top of this slice. The final band is `Infinity`. */
  up_to_pence: number;
  rate_pct: number;
}

export interface BandSet {
  regime: Regime;
  jurisdiction: Jurisdiction;
  basis: TaxBasis;
  effective_from: string;
  /** Exclusive upper bound; null means this is the set currently in force. */
  effective_to: string | null;
  bands: TaxBand[];
  /** Flat charge on the whole consideration. Null where the regime has none. */
  surcharge_pct: number | null;
  source_url: string;
  source_note: string;
}

/** Semver of the whole table. Bump on any change to any band set. */
export const TAX_TABLE_VERSION = '1.0.0';

const GOV_UK_NONRES = 'https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates';
const GOV_UK_RES = 'https://www.gov.uk/stamp-duty-land-tax/residential-property-rates';
const GOV_SCOT = 'https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/';
const GOV_WALES = 'https://www.gov.wales/land-transaction-tax-rates-and-bands';

export const TAX_TABLES: BandSet[] = [
  {
    regime: 'SDLT', jurisdiction: 'england_ni', basis: 'non_residential',
    effective_from: '2016-03-17', effective_to: null,
    bands: [
      { up_to_pence: 15_000_000, rate_pct: 0 },
      { up_to_pence: 25_000_000, rate_pct: 2 },
      { up_to_pence: Infinity, rate_pct: 5 },
    ],
    surcharge_pct: null,
    source_url: GOV_UK_NONRES,
    source_note: 'Non-residential and mixed freehold rates, unchanged since 17 March 2016.',
  },
  {
    regime: 'LBTT', jurisdiction: 'scotland', basis: 'non_residential',
    effective_from: '2019-01-25', effective_to: null,
    bands: [
      { up_to_pence: 15_000_000, rate_pct: 0 },
      { up_to_pence: 25_000_000, rate_pct: 1 },
      { up_to_pence: Infinity, rate_pct: 5 },
    ],
    surcharge_pct: null,
    source_url: GOV_SCOT,
    source_note: 'Non-residential conveyance rates from 25 January 2019; held at current levels by Scottish Budget 2026-27.',
  },
  {
    regime: 'LTT', jurisdiction: 'wales', basis: 'non_residential',
    effective_from: '2020-12-22', effective_to: null,
    bands: [
      { up_to_pence: 22_500_000, rate_pct: 0 },
      { up_to_pence: 25_000_000, rate_pct: 1 },
      { up_to_pence: 100_000_000, rate_pct: 5 },
      { up_to_pence: Infinity, rate_pct: 6 },
    ],
    surcharge_pct: null,
    source_url: GOV_WALES,
    source_note: 'Non-residential rates from 22 December 2020.',
  },
  {
    regime: 'SDLT', jurisdiction: 'england_ni', basis: 'residential_higher',
    effective_from: '2025-04-01', effective_to: null,
    bands: [
      { up_to_pence: 12_500_000, rate_pct: 0 },
      { up_to_pence: 25_000_000, rate_pct: 2 },
      { up_to_pence: 92_500_000, rate_pct: 5 },
      { up_to_pence: 150_000_000, rate_pct: 10 },
      { up_to_pence: Infinity, rate_pct: 12 },
    ],
    surcharge_pct: 5,
    source_url: GOV_UK_RES,
    source_note: 'Residential bands from 1 April 2025 with the 5% higher-rates supplement in force from 31 October 2024.',
  },
  {
    regime: 'LBTT', jurisdiction: 'scotland', basis: 'residential_higher',
    effective_from: '2024-12-05', effective_to: null,
    bands: [
      { up_to_pence: 14_500_000, rate_pct: 0 },
      { up_to_pence: 25_000_000, rate_pct: 2 },
      { up_to_pence: 32_500_000, rate_pct: 5 },
      { up_to_pence: 75_000_000, rate_pct: 10 },
      { up_to_pence: Infinity, rate_pct: 12 },
    ],
    surcharge_pct: 8,
    source_url: GOV_SCOT,
    source_note: 'Residential conveyance bands with the 8% Additional Dwelling Supplement in force from 5 December 2024.',
  },
  {
    regime: 'LTT', jurisdiction: 'wales', basis: 'residential_higher',
    effective_from: '2024-12-11', effective_to: null,
    bands: [
      { up_to_pence: 18_000_000, rate_pct: 5 },
      { up_to_pence: 25_000_000, rate_pct: 8.5 },
      { up_to_pence: 40_000_000, rate_pct: 10 },
      { up_to_pence: 75_000_000, rate_pct: 12.5 },
      { up_to_pence: 150_000_000, rate_pct: 15 },
      { up_to_pence: Infinity, rate_pct: 17 },
    ],
    // Wales carries no separate supplement: the uplift is inside these bands.
    surcharge_pct: null,
    source_url: GOV_WALES,
    source_note: 'Higher residential rates from 11 December 2024. The uplift is embedded in the bands, not charged as a supplement.',
  },
];

const REGIME_BY_JURISDICTION: Record<Jurisdiction, Regime> = {
  england_ni: 'SDLT', scotland: 'LBTT', wales: 'LTT',
};

export function regimeFor(jurisdiction: Jurisdiction): Regime {
  return REGIME_BY_JURISDICTION[jurisdiction];
}

export type DateBasis = 'transaction_date' | 'assumed_current';

/**
 * The band set in force for a jurisdiction and basis on a given date.
 *
 * A null date is not an error — legacy documents carry no acquisition date —
 * but it is not silent either: the caller is told the basis was assumed, and
 * the report says so, because a re-run after a Budget would return a different
 * number. A date no set covers *is* an error: spec §1.5 forbids substituting a
 * plausible value for an unknown one, and clamping to the earliest set would do
 * exactly that.
 */
export function selectBandSet(
  jurisdiction: Jurisdiction, basis: TaxBasis, date: string | null,
): { set: BandSet; dateBasis: DateBasis } {
  const group = TAX_TABLES.filter((s) => s.jurisdiction === jurisdiction && s.basis === basis);
  if (group.length === 0) {
    throw new Error(`No band sets for ${jurisdiction}/${basis}`);
  }
  const current = group.find((s) => s.effective_to === null);
  if (current === undefined) {
    throw new Error(`No open-ended band set for ${jurisdiction}/${basis}`);
  }
  if (date === null) return { set: current, dateBasis: 'assumed_current' };

  const match = group.find(
    (s) => date >= s.effective_from && (s.effective_to === null || date < s.effective_to),
  );
  if (match === undefined) {
    const earliest = group
      .map((s) => s.effective_from)
      .sort((a, b) => a.localeCompare(b))[0];
    throw new Error(
      `No ${regimeFor(jurisdiction)} band set covers ${date} for ${jurisdiction}/${basis}; `
      + `the earliest covered date is ${earliest}.`,
    );
  }
  return { set: match, dateBasis: 'transaction_date' };
}

export interface AcquisitionTaxBandResult {
  threshold_pence: number;
  rate_pct: number;
  tax_pence: number;
}

export interface AcquisitionTaxResult {
  total_pence: number;
  effective_rate_pct: number;
  bands: AcquisitionTaxBandResult[];
  surcharge_pence: number;
  regime: Regime;
  jurisdiction: Jurisdiction;
  basis: TaxBasis;
  band_set_effective_from: string;
  table_version: string;
  source_url: string;
  date_basis: DateBasis;
  is_override: boolean;
  override_reason: string | null;
  /** The band-derived figure the override replaced; null when not overridden. */
  computed_total_pence: number | null;
}

export interface AcquisitionTaxArgs {
  consideration_pence: number;
  jurisdiction: Jurisdiction;
  basis: TaxBasis;
  date: string | null;
  override_pence?: number | null;
  override_reason?: string | null;
}

export function calculateAcquisitionTax(args: AcquisitionTaxArgs): AcquisitionTaxResult {
  const { consideration_pence, jurisdiction, basis, date } = args;
  const { set, dateBasis } = selectBandSet(jurisdiction, basis, date);
  const override = args.override_pence ?? null;

  const bandResults: AcquisitionTaxBandResult[] = [];
  let bandTax = 0;
  let surcharge = 0;

  if (consideration_pence > 0) {
    let remaining = consideration_pence;
    let prevThreshold = 0;
    for (const band of set.bands) {
      const width = band.up_to_pence - prevThreshold;
      const taxable = Math.min(remaining, width);
      const tax = taxable > 0 ? Math.round((taxable * band.rate_pct) / 100) : 0;
      bandResults.push({ threshold_pence: band.up_to_pence, rate_pct: band.rate_pct, tax_pence: tax });
      bandTax += tax;
      remaining -= taxable;
      prevThreshold = band.up_to_pence;
      if (remaining <= 0) break;
    }
    surcharge = set.surcharge_pct === null
      ? 0
      : Math.round((consideration_pence * set.surcharge_pct) / 100);
  }

  // Bands the consideration never reached are still reported, at zero, so the
  // breakdown shown to a reader always has the same shape as the statute's.
  while (bandResults.length < set.bands.length) {
    const b = set.bands[bandResults.length];
    bandResults.push({ threshold_pence: b.up_to_pence, rate_pct: b.rate_pct, tax_pence: 0 });
  }

  const computed = bandTax + surcharge;
  const total = override ?? computed;

  return {
    total_pence: total,
    effective_rate_pct: consideration_pence > 0 ? (total / consideration_pence) * 100 : 0,
    bands: bandResults,
    surcharge_pence: surcharge,
    regime: set.regime,
    jurisdiction,
    basis,
    band_set_effective_from: set.effective_from,
    table_version: TAX_TABLE_VERSION,
    source_url: set.source_url,
    date_basis: dateBasis,
    is_override: override !== null,
    override_reason: override === null ? null : (args.override_reason ?? null),
    computed_total_pence: override === null ? null : computed,
  };
}

const COUNTRY_TO_JURISDICTION: Record<string, Jurisdiction> = {
  england: 'england_ni',
  'northern ireland': 'england_ni',
  scotland: 'scotland',
  wales: 'wales',
};

/**
 * Map a postcode-lookup country onto a tax jurisdiction. Returns null for an
 * absent or unrecognised country — the caller leaves the field at its default
 * and unconfirmed rather than guessing.
 */
export function deriveJurisdiction(country: string | null | undefined): Jurisdiction | null {
  if (country === null || country === undefined) return null;
  return COUNTRY_TO_JURISDICTION[country.trim().toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Create the normative JSON**

Create `fixtures/tax/acquisition-tax-tables.json`. It mirrors `TAX_TABLES` exactly, with the unbounded top band encoded as `null`:

```json
{
  "table_version": "1.0.0",
  "note": "Normative record of every acquisition-tax band set (spec §14). Both engines are tested against this file. An unbounded top band is encoded as null because JSON cannot represent infinity. Edit this file first when a Budget changes a rate; both engines' parity tests will then fail until they are updated to match.",
  "band_sets": [
    {
      "regime": "SDLT", "jurisdiction": "england_ni", "basis": "non_residential",
      "effective_from": "2016-03-17", "effective_to": null,
      "bands": [
        { "up_to_pence": 15000000, "rate_pct": 0 },
        { "up_to_pence": 25000000, "rate_pct": 2 },
        { "up_to_pence": null, "rate_pct": 5 }
      ],
      "surcharge_pct": null,
      "source_url": "https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates",
      "source_note": "Non-residential and mixed freehold rates, unchanged since 17 March 2016."
    },
    {
      "regime": "LBTT", "jurisdiction": "scotland", "basis": "non_residential",
      "effective_from": "2019-01-25", "effective_to": null,
      "bands": [
        { "up_to_pence": 15000000, "rate_pct": 0 },
        { "up_to_pence": 25000000, "rate_pct": 1 },
        { "up_to_pence": null, "rate_pct": 5 }
      ],
      "surcharge_pct": null,
      "source_url": "https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/",
      "source_note": "Non-residential conveyance rates from 25 January 2019; held at current levels by Scottish Budget 2026-27."
    },
    {
      "regime": "LTT", "jurisdiction": "wales", "basis": "non_residential",
      "effective_from": "2020-12-22", "effective_to": null,
      "bands": [
        { "up_to_pence": 22500000, "rate_pct": 0 },
        { "up_to_pence": 25000000, "rate_pct": 1 },
        { "up_to_pence": 100000000, "rate_pct": 5 },
        { "up_to_pence": null, "rate_pct": 6 }
      ],
      "surcharge_pct": null,
      "source_url": "https://www.gov.wales/land-transaction-tax-rates-and-bands",
      "source_note": "Non-residential rates from 22 December 2020."
    },
    {
      "regime": "SDLT", "jurisdiction": "england_ni", "basis": "residential_higher",
      "effective_from": "2025-04-01", "effective_to": null,
      "bands": [
        { "up_to_pence": 12500000, "rate_pct": 0 },
        { "up_to_pence": 25000000, "rate_pct": 2 },
        { "up_to_pence": 92500000, "rate_pct": 5 },
        { "up_to_pence": 150000000, "rate_pct": 10 },
        { "up_to_pence": null, "rate_pct": 12 }
      ],
      "surcharge_pct": 5,
      "source_url": "https://www.gov.uk/stamp-duty-land-tax/residential-property-rates",
      "source_note": "Residential bands from 1 April 2025 with the 5% higher-rates supplement in force from 31 October 2024."
    },
    {
      "regime": "LBTT", "jurisdiction": "scotland", "basis": "residential_higher",
      "effective_from": "2024-12-05", "effective_to": null,
      "bands": [
        { "up_to_pence": 14500000, "rate_pct": 0 },
        { "up_to_pence": 25000000, "rate_pct": 2 },
        { "up_to_pence": 32500000, "rate_pct": 5 },
        { "up_to_pence": 75000000, "rate_pct": 10 },
        { "up_to_pence": null, "rate_pct": 12 }
      ],
      "surcharge_pct": 8,
      "source_url": "https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/",
      "source_note": "Residential conveyance bands with the 8% Additional Dwelling Supplement in force from 5 December 2024."
    },
    {
      "regime": "LTT", "jurisdiction": "wales", "basis": "residential_higher",
      "effective_from": "2024-12-11", "effective_to": null,
      "bands": [
        { "up_to_pence": 18000000, "rate_pct": 5 },
        { "up_to_pence": 25000000, "rate_pct": 8.5 },
        { "up_to_pence": 40000000, "rate_pct": 10 },
        { "up_to_pence": 75000000, "rate_pct": 12.5 },
        { "up_to_pence": 150000000, "rate_pct": 15 },
        { "up_to_pence": null, "rate_pct": 17 }
      ],
      "surcharge_pct": null,
      "source_url": "https://www.gov.wales/land-transaction-tax-rates-and-bands",
      "source_note": "Higher residential rates from 11 December 2024. The uplift is embedded in the bands, not charged as a supplement."
    }
  ]
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/tax/acquisition-tax.test.ts`
Expected: PASS, all cases.

If the parity test fails on `source_note` or key ordering, note that `toEqual` compares structurally, not by key order — a genuine value mismatch is the only way it can fail.

- [ ] **Step 6: Commit**

```bash
git add fixtures/tax/acquisition-tax-tables.json frontend/src/lib/tax/
git commit -m "feat(tax): dated, sourced band table for SDLT, LBTT and LTT"
```

---

## Task 2: Python mirror of the tax module

**Files:**
- Create: `app/financial_model/acquisition_tax.py`
- Test: `tests/test_acquisition_tax.py`
- Modify: `app/financial_model/__init__.py` (export the new names)

**Interfaces:**
- Consumes: `fixtures/tax/acquisition-tax-tables.json` (parity test only); `money_round` from `app.financial_model.engine`.
- Produces: `Jurisdiction`, `TaxBasis`, `BandSet`, `AcquisitionTaxResult`, `TAX_TABLE_VERSION`, `TAX_TABLES`, `select_band_set()`, `calculate_acquisition_tax()`, `derive_jurisdiction()`, `regime_for()`.

**Port rule:** every value, name and behaviour mirrors Task 1. `Infinity` becomes `math.inf`; `Math.round` becomes `money_round` (the existing half-up helper, already used by `sdlt.py`). Keyword-only arguments mirror the TS object argument.

- [ ] **Step 1: Write the failing test**

Create `tests/test_acquisition_tax.py`:

```python
import json
import math
from pathlib import Path

import pytest

from app.financial_model.acquisition_tax import (
    TAX_TABLE_VERSION,
    TAX_TABLES,
    calculate_acquisition_tax,
    derive_jurisdiction,
    regime_for,
    select_band_set,
)

YORK = 75_348_200
TWO_MILLION = 200_000_000
FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "tax" / "acquisition-tax-tables.json"


@pytest.mark.parametrize(
    "jurisdiction,price,expected",
    [
        ("england_ni", YORK, 2_717_410),
        ("scotland", YORK, 2_617_410),
        ("wales", YORK, 2_542_410),
        ("england_ni", TWO_MILLION, 8_950_000),
        ("scotland", TWO_MILLION, 8_850_000),
        ("wales", TWO_MILLION, 9_775_000),
    ],
)
def test_non_residential_by_jurisdiction(jurisdiction, price, expected):
    r = calculate_acquisition_tax(
        consideration_pence=price, jurisdiction=jurisdiction,
        basis="non_residential", date="2026-08-17",
    )
    assert r.total_pence == expected


def test_gov_uk_worked_example():
    r = calculate_acquisition_tax(
        consideration_pence=27_500_000, jurisdiction="england_ni",
        basis="non_residential", date="2026-08-17",
    )
    assert r.total_pence == 325_000


@pytest.mark.parametrize("price", [0, -1])
def test_zero_and_negative_consideration(price):
    r = calculate_acquisition_tax(
        consideration_pence=price, jurisdiction="england_ni",
        basis="non_residential", date="2026-08-17",
    )
    assert r.total_pence == 0
    assert r.effective_rate_pct == 0


def test_england_supplement_and_welsh_absence():
    eng = calculate_acquisition_tax(
        consideration_pence=YORK, jurisdiction="england_ni",
        basis="residential_higher", date="2026-08-17",
    )
    assert eng.surcharge_pence == 3_767_410
    assert eng.total_pence == 6_534_820

    wal = calculate_acquisition_tax(
        consideration_pence=YORK, jurisdiction="wales",
        basis="residential_higher", date="2026-08-17",
    )
    assert wal.surcharge_pence == 0


def test_regime_names():
    assert regime_for("england_ni") == "SDLT"
    assert regime_for("scotland") == "LBTT"
    assert regime_for("wales") == "LTT"


def test_null_date_is_assumed_current():
    band_set, date_basis = select_band_set("scotland", "non_residential", None)
    assert date_basis == "assumed_current"
    assert band_set.effective_to is None


def test_uncovered_date_raises_naming_the_earliest():
    with pytest.raises(ValueError, match=r"1990-01-01.*2020-12-22"):
        select_band_set("wales", "non_residential", "1990-01-01")


def test_windows_are_contiguous_and_end_open():
    groups: dict[tuple[str, str], list] = {}
    for s in TAX_TABLES:
        groups.setdefault((s.jurisdiction, s.basis), []).append(s)
    assert len(groups) == 6
    for key, sets in groups.items():
        ordered = sorted(sets, key=lambda s: s.effective_from)
        for a, b in zip(ordered, ordered[1:]):
            assert a.effective_to == b.effective_from, key
        assert ordered[-1].effective_to is None, key


def test_bands_ascend_and_top_is_unbounded():
    for s in TAX_TABLES:
        tops = [b.up_to_pence for b in s.bands]
        assert tops == sorted(tops)
        assert tops[-1] == math.inf


def test_override_replaces_total_and_preserves_computed():
    r = calculate_acquisition_tax(
        consideration_pence=YORK, jurisdiction="england_ni",
        basis="non_residential", date="2026-08-17",
        override_pence=1_000_000, override_reason="Group relief claimed (FA2003 Sch 7).",
    )
    assert r.total_pence == 1_000_000
    assert r.is_override is True
    assert r.computed_total_pence == 2_717_410
    assert r.override_reason == "Group relief claimed (FA2003 Sch 7)."


@pytest.mark.parametrize(
    "country,expected",
    [
        ("England", "england_ni"), ("Northern Ireland", "england_ni"),
        ("Scotland", "scotland"), ("Wales", "wales"),
    ],
)
def test_derive_jurisdiction(country, expected):
    assert derive_jurisdiction(country) == expected


@pytest.mark.parametrize("country", ["Isle of Man", "", None])
def test_derive_jurisdiction_unknown(country):
    assert derive_jurisdiction(country) is None


def test_parity_with_normative_table():
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert raw["table_version"] == TAX_TABLE_VERSION
    assert len(raw["band_sets"]) == len(TAX_TABLES)
    for spec, actual in zip(raw["band_sets"], TAX_TABLES):
        assert spec["regime"] == actual.regime
        assert spec["jurisdiction"] == actual.jurisdiction
        assert spec["basis"] == actual.basis
        assert spec["effective_from"] == actual.effective_from
        assert spec["effective_to"] == actual.effective_to
        assert spec["surcharge_pct"] == actual.surcharge_pct
        assert spec["source_url"] == actual.source_url
        assert spec["source_note"] == actual.source_note
        # JSON encodes the unbounded top band as null; map one way only, and
        # require exactly one such band, so a missing value cannot pass as
        # unbounded.
        assert sum(1 for b in spec["bands"] if b["up_to_pence"] is None) == 1
        expected_bands = [
            (math.inf if b["up_to_pence"] is None else b["up_to_pence"], b["rate_pct"])
            for b in spec["bands"]
        ]
        assert expected_bands == [(b.up_to_pence, b.rate_pct) for b in actual.bands]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_acquisition_tax.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.financial_model.acquisition_tax'`.

- [ ] **Step 3: Write the module**

Create `app/financial_model/acquisition_tax.py`. Port Task 1 exactly:

```python
"""Port of frontend/src/lib/tax/acquisition-tax.ts -- band for band, slice basis.

Replaces sdlt.py. Spec Sec 14. The normative record of every band set is
fixtures/tax/acquisition-tax-tables.json; test_acquisition_tax.py asserts this
module against it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

from .engine import money_round

Jurisdiction = Literal["england_ni", "scotland", "wales"]
Regime = Literal["SDLT", "LBTT", "LTT"]
TaxBasis = Literal["non_residential", "residential_higher"]
DateBasis = Literal["transaction_date", "assumed_current"]

TAX_TABLE_VERSION = "1.0.0"

GOV_UK_NONRES = "https://www.gov.uk/stamp-duty-land-tax/nonresidential-and-mixed-rates"
GOV_UK_RES = "https://www.gov.uk/stamp-duty-land-tax/residential-property-rates"
GOV_SCOT = "https://www.gov.scot/publications/scottish-budget-2026-2027-scottish-tax-ready-reckoners/pages/4/"
GOV_WALES = "https://www.gov.wales/land-transaction-tax-rates-and-bands"


@dataclass(frozen=True)
class TaxBand:
    up_to_pence: float
    rate_pct: float


@dataclass(frozen=True)
class BandSet:
    regime: Regime
    jurisdiction: Jurisdiction
    basis: TaxBasis
    effective_from: str
    effective_to: str | None
    bands: list[TaxBand]
    surcharge_pct: float | None
    source_url: str
    source_note: str


TAX_TABLES: list[BandSet] = [
    BandSet(
        regime="SDLT", jurisdiction="england_ni", basis="non_residential",
        effective_from="2016-03-17", effective_to=None,
        bands=[TaxBand(15_000_000, 0), TaxBand(25_000_000, 2), TaxBand(math.inf, 5)],
        surcharge_pct=None, source_url=GOV_UK_NONRES,
        source_note="Non-residential and mixed freehold rates, unchanged since 17 March 2016.",
    ),
    BandSet(
        regime="LBTT", jurisdiction="scotland", basis="non_residential",
        effective_from="2019-01-25", effective_to=None,
        bands=[TaxBand(15_000_000, 0), TaxBand(25_000_000, 1), TaxBand(math.inf, 5)],
        surcharge_pct=None, source_url=GOV_SCOT,
        source_note=(
            "Non-residential conveyance rates from 25 January 2019; held at current "
            "levels by Scottish Budget 2026-27."
        ),
    ),
    BandSet(
        regime="LTT", jurisdiction="wales", basis="non_residential",
        effective_from="2020-12-22", effective_to=None,
        bands=[
            TaxBand(22_500_000, 0), TaxBand(25_000_000, 1),
            TaxBand(100_000_000, 5), TaxBand(math.inf, 6),
        ],
        surcharge_pct=None, source_url=GOV_WALES,
        source_note="Non-residential rates from 22 December 2020.",
    ),
    BandSet(
        regime="SDLT", jurisdiction="england_ni", basis="residential_higher",
        effective_from="2025-04-01", effective_to=None,
        bands=[
            TaxBand(12_500_000, 0), TaxBand(25_000_000, 2), TaxBand(92_500_000, 5),
            TaxBand(150_000_000, 10), TaxBand(math.inf, 12),
        ],
        surcharge_pct=5, source_url=GOV_UK_RES,
        source_note=(
            "Residential bands from 1 April 2025 with the 5% higher-rates supplement "
            "in force from 31 October 2024."
        ),
    ),
    BandSet(
        regime="LBTT", jurisdiction="scotland", basis="residential_higher",
        effective_from="2024-12-05", effective_to=None,
        bands=[
            TaxBand(14_500_000, 0), TaxBand(25_000_000, 2), TaxBand(32_500_000, 5),
            TaxBand(75_000_000, 10), TaxBand(math.inf, 12),
        ],
        surcharge_pct=8, source_url=GOV_SCOT,
        source_note=(
            "Residential conveyance bands with the 8% Additional Dwelling Supplement "
            "in force from 5 December 2024."
        ),
    ),
    BandSet(
        regime="LTT", jurisdiction="wales", basis="residential_higher",
        effective_from="2024-12-11", effective_to=None,
        bands=[
            TaxBand(18_000_000, 5), TaxBand(25_000_000, 8.5), TaxBand(40_000_000, 10),
            TaxBand(75_000_000, 12.5), TaxBand(150_000_000, 15), TaxBand(math.inf, 17),
        ],
        # Wales carries no separate supplement: the uplift is inside these bands.
        surcharge_pct=None, source_url=GOV_WALES,
        source_note=(
            "Higher residential rates from 11 December 2024. The uplift is embedded "
            "in the bands, not charged as a supplement."
        ),
    ),
]

_REGIME_BY_JURISDICTION: dict[str, Regime] = {
    "england_ni": "SDLT", "scotland": "LBTT", "wales": "LTT",
}


def regime_for(jurisdiction: Jurisdiction) -> Regime:
    return _REGIME_BY_JURISDICTION[jurisdiction]


def select_band_set(
    jurisdiction: Jurisdiction, basis: TaxBasis, date: str | None,
) -> tuple[BandSet, DateBasis]:
    """The band set in force on `date`. See the TS docstring for why a null date
    is tolerated (and flagged) while an uncovered date is an error."""
    group = [s for s in TAX_TABLES if s.jurisdiction == jurisdiction and s.basis == basis]
    if not group:
        raise ValueError(f"No band sets for {jurisdiction}/{basis}")
    current = next((s for s in group if s.effective_to is None), None)
    if current is None:
        raise ValueError(f"No open-ended band set for {jurisdiction}/{basis}")
    if date is None:
        return current, "assumed_current"

    for s in group:
        if date >= s.effective_from and (s.effective_to is None or date < s.effective_to):
            return s, "transaction_date"

    earliest = min(s.effective_from for s in group)
    raise ValueError(
        f"No {regime_for(jurisdiction)} band set covers {date} for {jurisdiction}/{basis}; "
        f"the earliest covered date is {earliest}."
    )


@dataclass
class AcquisitionTaxBandResult:
    threshold_pence: float
    rate_pct: float
    tax_pence: int


@dataclass
class AcquisitionTaxResult:
    total_pence: int
    effective_rate_pct: float
    bands: list[AcquisitionTaxBandResult] = field(default_factory=list)
    surcharge_pence: int = 0
    regime: Regime = "SDLT"
    jurisdiction: Jurisdiction = "england_ni"
    basis: TaxBasis = "non_residential"
    band_set_effective_from: str = ""
    table_version: str = TAX_TABLE_VERSION
    source_url: str = ""
    date_basis: DateBasis = "transaction_date"
    is_override: bool = False
    override_reason: str | None = None
    computed_total_pence: int | None = None


def calculate_acquisition_tax(
    *,
    consideration_pence: int,
    jurisdiction: Jurisdiction,
    basis: TaxBasis,
    date: str | None,
    override_pence: int | None = None,
    override_reason: str | None = None,
) -> AcquisitionTaxResult:
    band_set, date_basis = select_band_set(jurisdiction, basis, date)

    band_results: list[AcquisitionTaxBandResult] = []
    band_tax = 0
    surcharge = 0

    if consideration_pence > 0:
        remaining = consideration_pence
        prev_threshold: float = 0
        for band in band_set.bands:
            width = band.up_to_pence - prev_threshold
            taxable = min(remaining, width)
            tax = money_round((taxable * band.rate_pct) / 100) if taxable > 0 else 0
            band_results.append(
                AcquisitionTaxBandResult(band.up_to_pence, band.rate_pct, tax)
            )
            band_tax += tax
            remaining -= taxable
            prev_threshold = band.up_to_pence
            if remaining <= 0:
                break
        if band_set.surcharge_pct is not None:
            surcharge = money_round((consideration_pence * band_set.surcharge_pct) / 100)

    while len(band_results) < len(band_set.bands):
        b = band_set.bands[len(band_results)]
        band_results.append(AcquisitionTaxBandResult(b.up_to_pence, b.rate_pct, 0))

    computed = band_tax + surcharge
    total = computed if override_pence is None else override_pence

    return AcquisitionTaxResult(
        total_pence=total,
        effective_rate_pct=(total / consideration_pence) * 100 if consideration_pence > 0 else 0,
        bands=band_results,
        surcharge_pence=surcharge,
        regime=band_set.regime,
        jurisdiction=jurisdiction,
        basis=basis,
        band_set_effective_from=band_set.effective_from,
        table_version=TAX_TABLE_VERSION,
        source_url=band_set.source_url,
        date_basis=date_basis,
        is_override=override_pence is not None,
        override_reason=None if override_pence is None else override_reason,
        computed_total_pence=None if override_pence is None else computed,
    )


_COUNTRY_TO_JURISDICTION: dict[str, Jurisdiction] = {
    "england": "england_ni",
    "northern ireland": "england_ni",
    "scotland": "scotland",
    "wales": "wales",
}


def derive_jurisdiction(country: str | None) -> Jurisdiction | None:
    if country is None:
        return None
    return _COUNTRY_TO_JURISDICTION.get(country.strip().lower())
```

- [ ] **Step 4: Export from the package**

In `app/financial_model/__init__.py`, add to the imports and to `__all__`: `TAX_TABLE_VERSION`, `calculate_acquisition_tax`, `derive_jurisdiction`, `regime_for`, `AcquisitionTaxResult`. Follow the existing import/`__all__` style in that file exactly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_acquisition_tax.py -q`
Expected: PASS, all cases. The six golden totals must match Task 1's to the penny — if any differs, the two ports have diverged and that is the bug, not the test.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/acquisition_tax.py app/financial_model/__init__.py tests/test_acquisition_tax.py
git commit -m "feat(tax): Python mirror of the acquisition-tax band table"
```

---

## Task 3: Inputs v5 — TypeScript types, defaults and migration

**Files:**
- Modify: `frontend/src/lib/model/finance-types.ts`
- Modify: `frontend/src/lib/model/migrate.ts`
- Modify: `frontend/src/lib/conversion-defaults.ts`
- Test: `frontend/src/lib/model/migrate.test.ts`

**Interfaces:**
- Consumes: `Jurisdiction` from `../tax/acquisition-tax`.
- Produces: `AcquisitionInputsV5`, `CalculatorInputsV5`, `isV5()`, `migrateV4toV5()`, `migrateInputsToV5()`, `DEFAULT_ACQUISITION_V5_FIELDS`. `AnyCalculatorInputs` gains `CalculatorInputsV5`.

**Why the acquisition type is extended rather than edited:** `AcquisitionInputs` in `conversion-types.ts` is shared by the v1 document shape. Adding required fields there would break v1 typing and every v1 fixture. Extending it in `finance-types.ts` leaves v1–v4 untouched, and consumers read the new fields with the `'field' in obj` guard the codebase already uses for `lender_valuation`, `programme`, `sales_phasing` and `refinance`.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/model/migrate.test.ts`:

```ts
describe('v5 migration (R8 — jurisdiction and acquisition tax)', () => {
  it('stamps a migrated default jurisdiction, unconfirmed, with no date', () => {
    const v4 = migrateInputsToV4({ inputs_version: 1 } as Record<string, unknown>);
    const v5 = migrateV4toV5(v4);
    expect(v5.inputs_version).toBe(5);
    expect(v5.acquisition.jurisdiction).toBe('england_ni');
    expect(v5.acquisition.jurisdiction_source).toBe('migrated_default');
    expect(v5.acquisition.jurisdiction_evidence_status).toBe('unconfirmed');
    expect(v5.acquisition.acquisition_date).toBeNull();
    expect(v5.acquisition.acquisition_tax_override_pence).toBeNull();
    expect(v5.acquisition.acquisition_tax_override_reason).toBe('');
  });

  it('carries every other field across unchanged', () => {
    const v4 = migrateInputsToV4({ inputs_version: 1 } as Record<string, unknown>);
    const v5 = migrateV4toV5(v4);
    const { inputs_version: _iv, acquisition: a5, ...rest5 } = v5;
    const { inputs_version: _iv4, acquisition: a4, ...rest4 } = v4;
    expect(rest5).toEqual(rest4);
    // The v4 acquisition fields survive verbatim alongside the five new ones.
    expect(a5.purchase_price_pence).toBe(a4.purchase_price_pence);
    expect(a5.legal_fees_pence).toBe(a4.legal_fees_pence);
    expect(a5.broker_fee_pct).toBe(a4.broker_fee_pct);
  });

  it('refuses to double-migrate', () => {
    const v5 = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    expect(() => migrateV4toV5(v5 as unknown as CalculatorInputsV4))
      .toThrow('migrateV4toV5: input is already a v5 document');
  });

  it('refuses to downgrade a v5 document through the v4 entry point', () => {
    const v5 = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    expect(() => migrateInputsToV4(v5 as unknown as Record<string, unknown>))
      .toThrow('migrateInputsToV4: input is a v5 document — use migrateInputsToV5');
  });

  it.each([1, 2, 3, 4])('normalises a v%i snapshot to v5', (version) => {
    const v5 = migrateInputsToV5({ inputs_version: version } as Record<string, unknown>);
    expect(v5.inputs_version).toBe(5);
    expect(v5.acquisition.jurisdiction).toBe('england_ni');
  });

  it('preserves a saved v5 document’s confirmed jurisdiction', () => {
    const saved = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    saved.acquisition.jurisdiction = 'wales';
    saved.acquisition.jurisdiction_source = 'user';
    saved.acquisition.jurisdiction_evidence_status = 'confirmed';
    saved.acquisition.acquisition_date = '2026-05-01';
    const round = migrateInputsToV5(saved as unknown as Record<string, unknown>);
    expect(round.acquisition.jurisdiction).toBe('wales');
    expect(round.acquisition.jurisdiction_source).toBe('user');
    expect(round.acquisition.jurisdiction_evidence_status).toBe('confirmed');
    expect(round.acquisition.acquisition_date).toBe('2026-05-01');
  });
});
```

Add `migrateV4toV5`, `migrateInputsToV5` to the file's existing import from `./migrate`, and `CalculatorInputsV4` to its import from `./finance-types`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: FAIL — `migrateV4toV5 is not exported`.

- [ ] **Step 3: Add the types**

In `frontend/src/lib/model/finance-types.ts`, after `CalculatorInputsV4`:

```ts
import type { Jurisdiction } from '../tax/acquisition-tax';

/** How the jurisdiction on a document came to be set. */
export type JurisdictionSource = 'derived' | 'user' | 'migrated_default';

/**
 * R8 (spec §14). The acquisition block gains the tax basis the appraisal is
 * charged on. Extended rather than edited because `AcquisitionInputs` is shared
 * with the v1 document shape.
 */
export interface AcquisitionInputsV5 extends AcquisitionInputs {
  jurisdiction: Jurisdiction;
  jurisdiction_source: JurisdictionSource;
  /** Reuses the vocabulary of EquitySource.evidence_status deliberately: the
   *  report handles evidence with one mechanism, not two. */
  jurisdiction_evidence_status: 'unconfirmed' | 'confirmed';
  /** Effective date of the transaction; selects the band set. Null on migrated
   *  documents, which then use the current set and say so. */
  acquisition_date: string | null;
  /** Set only where a relief, linked transaction or other rule no band table
   *  models applies. Requires a reason (validation, Task 6). */
  acquisition_tax_override_pence: number | null;
  acquisition_tax_override_reason: string;
}

export interface CalculatorInputsV5 extends Omit<CalculatorInputsV4, 'inputs_version' | 'acquisition'> {
  inputs_version: 5;
  acquisition: AcquisitionInputsV5;
}
```

Then widen the union:

```ts
export type AnyCalculatorInputs =
  CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4 | CalculatorInputsV5;
```

`AcquisitionInputs` must be imported into `finance-types.ts` from `../conversion-types` if it is not already.

- [ ] **Step 4: Add the defaults**

In `frontend/src/lib/conversion-defaults.ts`, add and export:

```ts
import type { AcquisitionInputsV5 } from './model/finance-types';

/** The v5 acquisition fields for a *new* appraisal: jurisdiction derived where a
 *  postcode is known (set by the caller), date defaulting to today. */
export function defaultAcquisitionV5Fields(
  today: string,
): Omit<AcquisitionInputsV5, keyof AcquisitionInputs> {
  return {
    jurisdiction: 'england_ni',
    jurisdiction_source: 'derived',
    jurisdiction_evidence_status: 'unconfirmed',
    acquisition_date: today,
    acquisition_tax_override_pence: null,
    acquisition_tax_override_reason: '',
  };
}
```

- [ ] **Step 5: Add the migration**

In `frontend/src/lib/model/migrate.ts`:

```ts
/** A v5 document has the same finance shape as v2–v4, discriminated by inputs_version === 5. */
export function isV5(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV5 {
  return snapshot.inputs_version === 5 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/**
 * Upgrades a v4 document to v5 by stamping `inputs_version: 5` and adding the
 * acquisition block's six R8 fields. Purely additive, and deliberately so:
 * `england_ni` with unchanged bands means **no existing appraisal's computed
 * values move**. The jurisdiction is stamped `migrated_default` and
 * `unconfirmed` — a legacy document never told us where the property is, and
 * saying otherwise would be a claim the record does not support.
 *
 * `acquisition_date` is null rather than today's date: stamping a date the
 * transaction did not have would be inventing evidence, and a null is handled
 * explicitly downstream (`date_basis: 'assumed_current'`).
 */
export function migrateV4toV5(v4: CalculatorInputsV4): CalculatorInputsV5 {
  if (isV5(v4 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV4toV5: input is already a v5 document');
  }
  const { inputs_version: _v4Version, acquisition, ...rest } = v4;
  const existing = acquisition as Partial<AcquisitionInputsV5>;
  return {
    ...rest,
    inputs_version: 5,
    acquisition: {
      ...acquisition,
      jurisdiction: existing.jurisdiction ?? 'england_ni',
      jurisdiction_source: existing.jurisdiction_source ?? 'migrated_default',
      jurisdiction_evidence_status: existing.jurisdiction_evidence_status ?? 'unconfirmed',
      acquisition_date: existing.acquisition_date ?? null,
      acquisition_tax_override_pence: existing.acquisition_tax_override_pence ?? null,
      acquisition_tax_override_reason: existing.acquisition_tax_override_reason ?? '',
    },
  };
}

/**
 * Normalises any stored snapshot (v1–v5) to v5. Mirrors migrateInputsToV4's
 * shape exactly: an already-v5 document is merged field-by-field onto v5
 * defaults so fields added after it was saved get sane values rather than
 * `undefined`; anything older routes through the existing chain.
 */
export function migrateInputsToV5(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV5 {
  if (isV5(snapshot)) {
    const defaults = migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project))));
    const saved = snapshot as unknown as Partial<CalculatorInputsV5>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 5,
      acquisition: { ...defaults.acquisition, ...(saved.acquisition ?? {}) },
      unit_mix: saved.unit_mix ?? defaults.unit_mix,
      conversion_costs: { ...defaults.conversion_costs, ...(saved.conversion_costs ?? {}) },
      finance: { ...defaults.finance, ...(saved.finance ?? {}) },
      equity_sources: saved.equity_sources ?? defaults.equity_sources,
      exit_strategy: { ...defaults.exit_strategy, ...(saved.exit_strategy ?? {}) },
      risks: saved.risks ?? defaults.risks,
      scenarios: {
        base: { ...defaults.scenarios.base, ...(saved.scenarios?.base ?? {}) },
        upside: { ...defaults.scenarios.upside, ...(saved.scenarios?.upside ?? {}) },
        downside: { ...defaults.scenarios.downside, ...(saved.scenarios?.downside ?? {}) },
        severe: { ...defaults.scenarios.severe, ...(saved.scenarios?.severe ?? {}) },
      },
      deal_spider: {
        ...defaults.deal_spider,
        ...(saved.deal_spider ?? {}),
        weights: { ...defaults.deal_spider.weights, ...(saved.deal_spider?.weights ?? {}) },
      },
      lender_valuation: saved.lender_valuation ?? null,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
    };
  }
  return migrateV4toV5(migrateInputsToV4(snapshot, project));
}
```

And add the refusal guard at the top of the existing `migrateInputsToV4`, mirroring the one `migrateInputsToV3` already has for v4:

```ts
  if (isV5(snapshot)) {
    throw new Error('migrateInputsToV4: input is a v5 document — use migrateInputsToV5');
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/model/finance-types.ts frontend/src/lib/model/migrate.ts frontend/src/lib/conversion-defaults.ts frontend/src/lib/model/migrate.test.ts
git commit -m "feat(model): inputs v5 — jurisdiction, acquisition date and tax override"
```

---

## Task 4: Inputs v5 — Python types, migration and parse dispatch

**Files:**
- Modify: `app/financial_model/types.py`
- Modify: `app/financial_model/migrate.py`
- Create: `tests/test_migrate_v5.py`

**Interfaces:**
- Consumes: `Jurisdiction` from `.acquisition_tax`.
- Produces: `AcquisitionInputsV5`, `CalculatorInputsV5`, `migrate_v4_to_v5()`, `migrate_inputs_to_v5()`. `AnyCalculatorInputs` and `parse_calculator_inputs()` gain v5.

- [ ] **Step 1: Write the failing test**

Create `tests/test_migrate_v5.py`:

```python
import pytest

from app.financial_model.migrate import (
    migrate_inputs_to_v4, migrate_inputs_to_v5, migrate_v4_to_v5,
)
from app.financial_model.types import parse_calculator_inputs


@pytest.fixture
def v1_doc():
    return {"inputs_version": 1}


def test_v4_to_v5_stamps_migrated_default(v1_doc):
    v5 = migrate_v4_to_v5(migrate_inputs_to_v4(v1_doc))
    assert v5.inputs_version == 5
    assert v5.acquisition.jurisdiction == "england_ni"
    assert v5.acquisition.jurisdiction_source == "migrated_default"
    assert v5.acquisition.jurisdiction_evidence_status == "unconfirmed"
    assert v5.acquisition.acquisition_date is None
    assert v5.acquisition.acquisition_tax_override_pence is None
    assert v5.acquisition.acquisition_tax_override_reason == ""


def test_v4_to_v5_carries_other_fields_unchanged(v1_doc):
    v4 = migrate_inputs_to_v4(v1_doc)
    v5 = migrate_v4_to_v5(v4)
    assert v5.acquisition.purchase_price_pence == v4.acquisition.purchase_price_pence
    assert v5.acquisition.legal_fees_pence == v4.acquisition.legal_fees_pence
    assert v5.finance == v4.finance
    assert v5.unit_mix == v4.unit_mix


@pytest.mark.parametrize("version", [1, 2, 3, 4])
def test_any_version_normalises_to_v5(version):
    v5 = migrate_inputs_to_v5({"inputs_version": version})
    assert v5.inputs_version == 5


def test_double_migration_is_refused(v1_doc):
    v5 = migrate_inputs_to_v5(v1_doc)
    with pytest.raises(ValueError, match="already a v5 document"):
        migrate_v4_to_v5(v5)


def test_saved_v5_round_trips_confirmed_jurisdiction(v1_doc):
    v5 = migrate_inputs_to_v5(v1_doc)
    doc = v5.model_dump(mode="json")
    doc["acquisition"]["jurisdiction"] = "scotland"
    doc["acquisition"]["jurisdiction_source"] = "user"
    doc["acquisition"]["jurisdiction_evidence_status"] = "confirmed"
    doc["acquisition"]["acquisition_date"] = "2026-05-01"
    again = migrate_inputs_to_v5(doc)
    assert again.acquisition.jurisdiction == "scotland"
    assert again.acquisition.jurisdiction_source == "user"
    assert again.acquisition.jurisdiction_evidence_status == "confirmed"
    assert again.acquisition.acquisition_date == "2026-05-01"


def test_parse_dispatches_on_version_5(v1_doc):
    doc = migrate_inputs_to_v5(v1_doc).model_dump(mode="json")
    parsed = parse_calculator_inputs(doc)
    assert parsed.inputs_version == 5
    assert parsed.acquisition.jurisdiction == "england_ni"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_migrate_v5.py -q`
Expected: FAIL — `ImportError: cannot import name 'migrate_v4_to_v5'`.

- [ ] **Step 3: Add the types**

In `app/financial_model/types.py`, after `CalculatorInputsV4`:

```python
class AcquisitionInputsV5(AcquisitionInputs):
    """R8 (spec Sec 14). Mirrors frontend AcquisitionInputsV5."""

    jurisdiction: Literal["england_ni", "scotland", "wales"] = "england_ni"
    jurisdiction_source: Literal["derived", "user", "migrated_default"] = "migrated_default"
    jurisdiction_evidence_status: Literal["unconfirmed", "confirmed"] = "unconfirmed"
    acquisition_date: str | None = None
    acquisition_tax_override_pence: int | None = Field(default=None, ge=0)
    acquisition_tax_override_reason: str = ""


class CalculatorInputsV5(CalculatorInputsV4):
    """Mirrors CalculatorInputsV4 with the R8 acquisition block. Subclasses V4
    for the same reason V4 subclasses V3: the engine dispatches on it."""

    inputs_version: Literal[5] = 5
    acquisition: AcquisitionInputsV5
```

Widen the union and the parse dispatch:

```python
AnyCalculatorInputs = (
    CalculatorInputsV2 | CalculatorInputsV3 | CalculatorInputsV4 | CalculatorInputsV5
)
```

In `parse_calculator_inputs`, add a `5` branch returning `CalculatorInputsV5.model_validate(doc)`, following the existing branch style exactly.

- [ ] **Step 4: Add the migration**

In `app/financial_model/migrate.py`, mirroring Task 3:

```python
def migrate_v4_to_v5(v4: CalculatorInputsV4) -> CalculatorInputsV5:
    """Port of migrateV4toV5. Purely additive: england_ni with unchanged bands
    means no existing appraisal's computed values move. See the TS docstring for
    why the jurisdiction is stamped migrated_default/unconfirmed and the date
    left null."""
    if isinstance(v4, CalculatorInputsV5) or getattr(v4, "inputs_version", None) == 5:
        raise ValueError("migrate_v4_to_v5: input is already a v5 document")
    doc = v4.model_dump(mode="json")
    acq = doc["acquisition"]
    acq.setdefault("jurisdiction", "england_ni")
    acq.setdefault("jurisdiction_source", "migrated_default")
    acq.setdefault("jurisdiction_evidence_status", "unconfirmed")
    acq.setdefault("acquisition_date", None)
    acq.setdefault("acquisition_tax_override_pence", None)
    acq.setdefault("acquisition_tax_override_reason", "")
    doc["inputs_version"] = 5
    return CalculatorInputsV5.model_validate(doc)


def migrate_inputs_to_v5(snapshot: dict) -> CalculatorInputsV5:
    """Normalises any stored snapshot (v1-v5) to v5."""
    if snapshot.get("inputs_version") == 5:
        return CalculatorInputsV5.model_validate(snapshot)
    return migrate_v4_to_v5(migrate_inputs_to_v4(snapshot))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_migrate_v5.py tests/test_migrate_v4.py -q`
Expected: PASS. The v4 tests must be unaffected.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model/types.py app/financial_model/migrate.py tests/test_migrate_v5.py
git commit -m "feat(model): Python inputs v5 with jurisdiction and acquisition date"
```

---

## Task 5: Wire the engines, delete the legacy SDLT modules, prove nothing moved

**Files:**
- Modify: `frontend/src/lib/model/metrics.ts:78`, `frontend/src/lib/model/finance-types.ts` (metrics output)
- Modify: `app/financial_model/metrics.py:21,232,391`
- Delete: `frontend/src/lib/commercial-sdlt.ts`, `frontend/src/lib/commercial-sdlt.test.ts`, `frontend/src/lib/residential-sdlt.ts`, `frontend/src/lib/residential-sdlt.test.ts`, `app/financial_model/sdlt.py`
- Modify: `fixtures/financial-model/*.json` (add confirmed v5 acquisition fields)
- Test: `frontend/src/lib/model/golden-fixtures.test.ts`, `tests/test_financial_model_fixtures.py`

**Interfaces:**
- Consumes: `calculateAcquisitionTax()` / `calculate_acquisition_tax()` from Tasks 1–2; `AcquisitionInputsV5` from Tasks 3–4.
- Produces: `metrics.acquisition_tax_pence` (number) and `metrics.acquisition_tax` (`AcquisitionTaxResult`). `metrics.sdlt_pence` is retained as a deprecated alias with the identical value.

**This is the task where the release either preserves every existing number or does not.** The fixture assertion in Step 4 is the one that proves it.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/model/metrics.test.ts`:

```ts
import { migrateInputsToV5 } from './migrate';

describe('acquisition tax is jurisdiction-aware (R8)', () => {
  it('taxes an English appraisal identically to the pre-R8 engine', () => {
    const inputs = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    inputs.acquisition.purchase_price_pence = 75_348_200;
    const m = runAppraisal(inputs).metrics;
    expect(m.acquisition_tax_pence).toBe(2_717_410);
    // The deprecated alias must carry the same value until R16 removes it.
    expect(m.sdlt_pence).toBe(m.acquisition_tax_pence);
    expect(m.acquisition_tax.regime).toBe('SDLT');
  });

  it('taxes a Welsh appraisal on LTT', () => {
    const inputs = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    inputs.acquisition.purchase_price_pence = 75_348_200;
    inputs.acquisition.jurisdiction = 'wales';
    inputs.acquisition.acquisition_date = '2026-08-17';
    const m = runAppraisal(inputs).metrics;
    expect(m.acquisition_tax_pence).toBe(2_542_410);
    expect(m.acquisition_tax.regime).toBe('LTT');
    expect(m.acquisition_tax.date_basis).toBe('transaction_date');
  });

  it('reports an assumed-current basis when no acquisition date is recorded', () => {
    const inputs = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    inputs.acquisition.purchase_price_pence = 75_348_200;
    const m = runAppraisal(inputs).metrics;
    expect(m.acquisition_tax.date_basis).toBe('assumed_current');
  });

  it('feeds the override into RLV via cost-excluding-land', () => {
    const base = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    base.acquisition.purchase_price_pence = 75_348_200;
    const withOverride = migrateInputsToV5(
      JSON.parse(JSON.stringify(base)) as Record<string, unknown>,
    );
    withOverride.acquisition.acquisition_tax_override_pence = 0;
    withOverride.acquisition.acquisition_tax_override_reason = 'Group relief claimed.';
    expect(runAppraisal(withOverride).metrics.acquisition_tax_pence).toBe(0);
    expect(runAppraisal(withOverride).metrics.rlv_pence)
      .not.toBe(runAppraisal(base).metrics.rlv_pence);
  });
});
```

And the load-bearing one, in `frontend/src/lib/model/golden-fixtures.test.ts`:

```ts
it('returns identical metrics before and after migration to v5', () => {
  for (const f of fixtures) {
    if (f.kind === 'sensitivity') continue;
    const v4 = migrateInputsToV4(JSON.parse(JSON.stringify(f.inputs)));
    const v5 = migrateInputsToV5(JSON.parse(JSON.stringify(f.inputs)));
    const a = runAppraisal(v4).metrics;
    const b = runAppraisal(v5).metrics;
    // acquisition_tax is new output, not a changed one; every pre-existing
    // metric must be untouched.
    const { acquisition_tax: _at, acquisition_tax_pence: _atp, ...rest } = b;
    const { acquisition_tax: _a2, acquisition_tax_pence: _a3, ...prior } = a;
    expect(rest).toEqual(prior);
  }
});
```

Note: `migrateInputsToV4` now refuses a v5 document, so a fixture already carrying `inputs_version: 5` must be excluded from the v4 half of this comparison. Fixtures are updated to v5 in Step 4; run this assertion *before* that update, then adapt it to compare against committed expected values.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/model/metrics.test.ts`
Expected: FAIL — `acquisition_tax_pence` does not exist on the metrics type.

- [ ] **Step 3: Wire the TS engine**

In `frontend/src/lib/model/metrics.ts`, replace the `calculateCommercialSdlt` import with the new module and replace line 78:

```ts
// R8 (spec §14). v2–v4 documents carry no jurisdiction at all, exactly as they
// carry no lender_valuation: read through the same `in` guard rather than
// assuming a shape. england_ni is what those documents always implicitly were,
// so this preserves their figures to the penny.
const acq = inputs.acquisition as Partial<AcquisitionInputsV5> & AcquisitionInputs;
const acquisitionTax = calculateAcquisitionTax({
  consideration_pence: acq.purchase_price_pence,
  jurisdiction: acq.jurisdiction ?? 'england_ni',
  basis: 'non_residential',
  date: acq.acquisition_date ?? null,
  override_pence: acq.acquisition_tax_override_pence ?? null,
  override_reason: acq.acquisition_tax_override_reason ?? null,
});
const sdlt = acquisitionTax.total_pence;
```

Leave every downstream use of `sdlt` (lines 103, 228 and the RLV at line ~104) exactly as it is — that is what keeps existing figures identical. In the returned metrics object add:

```ts
    acquisition_tax_pence: sdlt,
    acquisition_tax: acquisitionTax,
    /** @deprecated R8 — use acquisition_tax_pence. Removed in R16. */
    sdlt_pence: sdlt,
```

Add both fields to the metrics interface in `finance-types.ts`, marking `sdlt_pence` deprecated in a doc comment.

- [ ] **Step 4: Wire the Python engine and update fixtures**

Mirror the same change in `app/financial_model/metrics.py` (import at line 21, computation at line 232, output at line 391, plus the two new dataclass fields).

Then update every file in `fixtures/financial-model/` to `"inputs_version": 5` with an explicit, **confirmed** acquisition block, so existing fixtures do not all flip to a draft state:

```json
      "jurisdiction": "england_ni",
      "jurisdiction_source": "user",
      "jurisdiction_evidence_status": "confirmed",
      "acquisition_date": "2026-01-15",
      "acquisition_tax_override_pence": null,
      "acquisition_tax_override_reason": ""
```

`k-sensitivity.json` names a `base_fixture` and carries no `inputs` of its own — leave its inputs block alone.

Then delete the legacy modules:

```bash
git rm frontend/src/lib/commercial-sdlt.ts frontend/src/lib/commercial-sdlt.test.ts \
       frontend/src/lib/residential-sdlt.ts frontend/src/lib/residential-sdlt.test.ts \
       app/financial_model/sdlt.py
```

Fix the resulting import errors: `deal-spider.ts` is handled in Task 7 — until then point it at `calculateAcquisitionTax` with `jurisdiction: 'england_ni'` so the build stays green. Remove `from .sdlt import calculate_commercial_sdlt` from `app/financial_model/metrics.py` and any `sdlt` re-export in `app/financial_model/__init__.py`.

- [ ] **Step 5: Run the full engine suites**

Run: `cd frontend && npx vitest run src/lib/model/ && cd .. && python -m pytest tests/ -q`
Expected: PASS. Every pre-existing golden figure unchanged — in particular `york-audit-case.test.ts` and `test_york_audit_case.py`, which pin the externally-verified case. If either moves by a penny, stop: the wiring is wrong, not the test.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/lib app/financial_model fixtures/financial-model
git commit -m "feat(model): route acquisition tax through the jurisdiction table"
```

---

## Task 6: Validation

**Files:**
- Modify: `frontend/src/lib/model/validation.ts`
- Modify: `app/financial_model/validation.py`
- Test: `frontend/src/lib/model/validation.test.ts`, `tests/test_financial_model_validation.py`

**Interfaces:**
- Consumes: `AcquisitionInputsV5`, `selectBandSet()`.
- Produces: three new `ValidationIssue` field codes: `acquisition.acquisition_tax_override_reason` (error), `acquisition.acquisition_date` (error), `acquisition.jurisdiction_evidence_status` (warning).

**Why the override reason is an error but the unconfirmed jurisdiction is only a warning:** a hard error sets `report_safe: false`, which the report states as "one or more hard validations fail" — a claim that the *figures may be wrong*. An unconfirmed jurisdiction does not make the arithmetic wrong; it makes the basis unverified. That distinction is held by a separate draft reason in Task 8, not by overloading `report_safe`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/model/validation.test.ts`:

```ts
describe('acquisition tax validation (R8)', () => {
  const v5 = () => migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);

  it('rejects an override with no reason', () => {
    const inputs = v5();
    inputs.acquisition.acquisition_tax_override_pence = 500_000;
    inputs.acquisition.acquisition_tax_override_reason = '   ';
    const issues = validateInputs(inputs);
    const issue = issues.find((i) => i.field === 'acquisition.acquisition_tax_override_reason');
    expect(issue?.severity).toBe('error');
  });

  it('accepts an override with a reason', () => {
    const inputs = v5();
    inputs.acquisition.acquisition_tax_override_pence = 500_000;
    inputs.acquisition.acquisition_tax_override_reason = 'Group relief claimed.';
    expect(validateInputs(inputs).some(
      (i) => i.field === 'acquisition.acquisition_tax_override_reason',
    )).toBe(false);
  });

  it('rejects an acquisition date no band set covers', () => {
    const inputs = v5();
    inputs.acquisition.jurisdiction = 'wales';
    inputs.acquisition.acquisition_date = '1990-01-01';
    const issue = validateInputs(inputs).find((i) => i.field === 'acquisition.acquisition_date');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('2020-12-22');
  });

  it('rejects a malformed acquisition date', () => {
    const inputs = v5();
    inputs.acquisition.acquisition_date = '17/08/2026';
    const issue = validateInputs(inputs).find((i) => i.field === 'acquisition.acquisition_date');
    expect(issue?.severity).toBe('error');
  });

  it('warns — but does not error — on an unconfirmed jurisdiction', () => {
    const inputs = v5();
    const issue = validateInputs(inputs).find(
      (i) => i.field === 'acquisition.jurisdiction_evidence_status',
    );
    expect(issue?.severity).toBe('warning');
    expect(validateInputs(inputs).some((i) => i.severity === 'error')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts`
Expected: FAIL — no issue found for those fields.

- [ ] **Step 3: Implement**

In `validateInputs` in `frontend/src/lib/model/validation.ts`, before the return:

```ts
  // R8 (spec §14). Read through an `in` guard: v2–v4 documents carry none of
  // these fields and must not be reported as failing rules that did not exist
  // when they were saved.
  if ('jurisdiction' in inputs.acquisition) {
    const acq = inputs.acquisition as AcquisitionInputsV5;

    if (acq.acquisition_tax_override_pence !== null && acq.acquisition_tax_override_reason.trim() === '') {
      err(
        'acquisition.acquisition_tax_override_reason',
        'An acquisition tax override must state why the band calculation does not apply '
        + '(for example a relief or a linked transaction).',
      );
    }

    if (acq.acquisition_date !== null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(acq.acquisition_date)) {
        err('acquisition.acquisition_date', 'Acquisition date must be an ISO date (YYYY-MM-DD).');
      } else {
        try {
          selectBandSet(acq.jurisdiction, 'non_residential', acq.acquisition_date);
        } catch (e) {
          err('acquisition.acquisition_date', (e as Error).message);
        }
      }
    }

    if (acq.jurisdiction_evidence_status === 'unconfirmed') {
      warn(
        'acquisition.jurisdiction_evidence_status',
        'The tax jurisdiction has not been confirmed. Acquisition tax is computed on '
        + `${regimeFor(acq.jurisdiction)} and the report will remain a draft until it is confirmed.`,
      );
    }
  }
```

Mirror all four rules in `app/financial_model/validation.py` with the same field codes, severities and messages.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/model/validation.test.ts && cd .. && python -m pytest tests/test_financial_model_validation.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/validation.ts frontend/src/lib/model/validation.test.ts app/financial_model/validation.py tests/test_financial_model_validation.py
git commit -m "feat(model): validate acquisition date, override reason and jurisdiction evidence"
```

---

## Task 7: Deal spider — compare within one regime

**Files:**
- Modify: `frontend/src/lib/deal-spider.ts:185`
- Test: `frontend/src/lib/deal-spider.test.ts`

**Interfaces:**
- Consumes: `calculateAcquisitionTax()`, `AcquisitionInputsV5`.
- Produces: no new exports; `SpiderResult` is unchanged in shape.

- [ ] **Step 1: Write the failing test**

Replace the `calculateResidentialSdlt` import in `deal-spider.test.ts` and add:

```ts
describe('tax advantage is computed within one regime (R8)', () => {
  it('is unchanged for an English appraisal', () => {
    const inputs = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    inputs.acquisition.purchase_price_pence = 75_348_200;
    const residential = calculateAcquisitionTax({
      consideration_pence: 75_348_200, jurisdiction: 'england_ni',
      basis: 'residential_higher', date: null,
    }).total_pence;
    expect(residential).toBe(6_534_820); // the pre-R8 residential-sdlt figure
    expect(() => runSpider(inputs, null)).not.toThrow();
  });

  it('uses Welsh bands on both sides for a Welsh appraisal', () => {
    const eng = migrateInputsToV5({ inputs_version: 1 } as Record<string, unknown>);
    eng.acquisition.purchase_price_pence = 75_348_200;
    const wal = migrateInputsToV5(
      JSON.parse(JSON.stringify(eng)) as Record<string, unknown>,
    );
    wal.acquisition.jurisdiction = 'wales';
    // Wales's residential-higher and non-residential bands both differ from
    // England's, so the axis must move. If it does not, the jurisdiction is
    // not reaching the comparison.
    expect(runSpider(wal, null).axes.tax_advantage)
      .not.toBe(runSpider(eng, null).axes.tax_advantage);
  });
});
```

Check the actual axis accessor name in `deal-spider.ts` before writing the assertion and use the real one.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/deal-spider.test.ts`
Expected: FAIL — the two scores are equal, because the jurisdiction is ignored.

- [ ] **Step 3: Implement**

```ts
  // R8: both sides of this comparison must be the same regime, or the score
  // compares English residential rates against Welsh commercial ones.
  const acq = inputs.acquisition as Partial<AcquisitionInputsV5> & AcquisitionInputs;
  const jurisdiction = acq.jurisdiction ?? 'england_ni';
  const date = acq.acquisition_date ?? null;
  const residentialTax = calculateAcquisitionTax({
    consideration_pence: price, jurisdiction, basis: 'residential_higher', date,
  }).total_pence;
  const commercialTax = calculateAcquisitionTax({
    consideration_pence: price, jurisdiction, basis: 'non_residential', date,
  }).total_pence;
```

Then use `residentialTax` / `commercialTax` in the existing `taxAdvantagePct` expression, unchanged otherwise.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/deal-spider.test.ts`
Expected: PASS, and the pre-existing English spider assertions unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/deal-spider.ts frontend/src/lib/deal-spider.test.ts
git commit -m "fix(spider): compare acquisition tax within the appraisal's own regime"
```

---

## Task 8: Provenance, the draft gate, and honest report copy

**Files:**
- Modify: `frontend/src/lib/report-provenance.ts`
- Modify: `frontend/src/lib/export-investment-memo.ts` (lines ~63–73, ~725, ~1001, ~1791, ~1894)
- Test: `frontend/src/lib/report-provenance.test.ts`

**Interfaces:**
- Consumes: `metrics.acquisition_tax` from Task 5.
- Produces: `DraftReason` gains `'tax_basis_unconfirmed'`; `ReportProvenance` gains `taxTableVersion: string`, `jurisdiction: Jurisdiction`, `taxBasisConfirmed: boolean`.

**Ordering matters.** `draftReason()` returns the first condition that holds. Insert `tax_basis_unconfirmed` **immediately before** `not_approved` and nowhere else: every run that today reports `unreconciled` or `senior_not_repaid` must keep reporting it, or existing R7 report tests change meaning.

**The audit hash needs no structural change.** `audit_hash()` in `app/financial_model/hashing.py` is a hash of `input_hash` and `outputs_hash`, which already commit to the full input and output documents. Jurisdiction lands in inputs and `table_version` lands in metrics, so both flow into the audit hash transitively. Do not add them as separate hash parts — that would change every stored hash for no gain. (This corrects the design doc's §5, which reads as though the hash gains new fields directly.)

- [ ] **Step 1: Write the failing test**

```ts
describe('tax basis in provenance (R8)', () => {
  const reconciled = { report_safe: true, senior_repaid: true };

  it('holds a document in DRAFT while the jurisdiction is unconfirmed', () => {
    expect(draftReason(reconciled, 'credit_approved', { taxBasisConfirmed: false }))
      .toBe('tax_basis_unconfirmed');
  });

  it('reaches FINAL once the basis is confirmed and the case approved', () => {
    expect(draftReason(reconciled, 'credit_approved', { taxBasisConfirmed: true })).toBeNull();
  });

  it('does not displace a more fundamental reason', () => {
    expect(draftReason({ report_safe: false, senior_repaid: true }, 'credit_approved',
      { taxBasisConfirmed: false })).toBe('unreconciled');
    expect(draftReason({ report_safe: true, senior_repaid: false }, 'credit_approved',
      { taxBasisConfirmed: false })).toBe('senior_not_repaid');
  });

  it('still reports not_approved when the basis is confirmed', () => {
    expect(draftReason(reconciled, null, { taxBasisConfirmed: true })).toBe('not_approved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/report-provenance.test.ts`
Expected: FAIL — `draftReason` takes two arguments.

- [ ] **Step 3: Implement**

Extend the type and the function:

```ts
export type DraftReason =
  | 'unreconciled' | 'senior_not_repaid' | 'tax_basis_unconfirmed' | 'not_approved';

export function draftReason(
  reconciliation: Pick<ReconciliationStatus, 'report_safe' | 'senior_repaid'>,
  lenderCaseStatus: LenderCaseStatus | null,
  taxBasis: { taxBasisConfirmed: boolean } = { taxBasisConfirmed: true },
): DraftReason | null {
  if (!reconciliation.report_safe) return 'unreconciled';
  if (!reconciliation.senior_repaid) return 'senior_not_repaid';
  // R8 (spec §14). Ordered here, not earlier: an unconfirmed jurisdiction does
  // not make the arithmetic wrong, so it must not displace a reason that says
  // the figures themselves may be. It sits above `not_approved` because a
  // reader needs to know the basis is unverified before they read an approval.
  if (!taxBasis.taxBasisConfirmed) return 'tax_basis_unconfirmed';
  if (lenderCaseStatus === null || !APPROVED_STATUSES.includes(lenderCaseStatus)) return 'not_approved';
  return null;
}
```

The default argument keeps every existing two-argument caller compiling and behaving identically. In `buildProvenance`, derive `taxBasisConfirmed` from the run's inputs (`jurisdiction_evidence_status === 'confirmed' && date_basis === 'transaction_date'`) and populate the three new `ReportProvenance` fields. Update `documentStatus` to take and forward the same third argument.

- [ ] **Step 4: Update the memo copy**

In `export-investment-memo.ts`:

```ts
const DRAFT_REASON_SENTENCE: Record<DraftReason, string> = {
  unreconciled: 'one or more hard validations fail',
  senior_not_repaid: 'the senior facility is not repaid within the modelled term',
  tax_basis_unconfirmed: 'the acquisition tax jurisdiction has not been confirmed',
  not_approved: 'no lender case has been credit approved',
};

const WATERMARK_TEXT: Record<DraftReason, string> = {
  unreconciled: 'DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE',
  senior_not_repaid: 'DRAFT - SENIOR DEBT NOT REPAID - NOT FOR LENDER RELIANCE',
  tax_basis_unconfirmed: 'DRAFT - TAX BASIS UNCONFIRMED - NOT FOR LENDER RELIANCE',
  not_approved: 'DRAFT - NOT APPROVED FOR LENDER RELIANCE',
};
```

Then, at the four sites that name SDLT:

- **line ~1001** — relabel the cost-breakdown row from `'  SDLT'` to `'  Acquisition tax'`.
- **line ~779 / ~1232** — `'Acquisition (inc. SDLT)'` becomes `'Acquisition (inc. tax)'`.
- **line ~1791** — replace the England-only detail string with the applied regime, built from `metrics.acquisition_tax`:

```ts
['Acquisition tax', fmt(metrics.acquisition_tax_pence),
  `${tax.regime} — ${JURISDICTION_LABEL[tax.jurisdiction]}, non-residential, `
  + `bands in force from ${formatBandDate(tax.band_set_effective_from)} `
  + `(table ${tax.table_version})`],
```

with `const JURISDICTION_LABEL: Record<Jurisdiction, string> = { england_ni: 'England & Northern Ireland', scotland: 'Scotland', wales: 'Wales' };` and `formatBandDate` rendering `2019-01-25` as `25 Jan 2019`.

- **line ~1894** — **delete** the sentence "Acquisition tax is calculated on the England and Northern Ireland non-residential SDLT bands. A property in Scotland (LBTT) or Wales (LTT) is not correctly taxed by this version." Replace it with a true statement:

```ts
`Acquisition tax is calculated on the ${tax.regime} non-residential bands for `
+ `${JURISDICTION_LABEL[tax.jurisdiction]} in force from ${formatBandDate(tax.band_set_effective_from)} `
+ `(assumption table version ${tax.table_version}). Reliefs, linked transactions and multiple `
+ `dwellings relief are not modelled.`
```

Add `[Information Required]` lines, via the existing `infoRequired` helper, for: an unconfirmed jurisdiction; a `date_basis` of `assumed_current`; and an override in force (stating the computed figure it replaced and the reason).

Add the two provenance rows near line ~725: the applied jurisdiction and the tax table version.

- [ ] **Step 5: Run the report tests**

Run: `cd frontend && npx vitest run src/lib/report-provenance.test.ts src/lib/report-qa/`
Expected: PASS. Existing R7 gate tests must be unaffected — the fixtures carry a confirmed jurisdiction (Task 5), so no existing case flips to `tax_basis_unconfirmed`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/report-provenance.ts frontend/src/lib/report-provenance.test.ts frontend/src/lib/export-investment-memo.ts
git commit -m "feat(report): name the tax regime applied and gate on an unconfirmed basis"
```

---

## Task 9: Report QA gate and Excel export

**Files:**
- Modify: `frontend/src/lib/report-qa/report-checks.ts`, `memo-fixtures.ts`, `memo-release-gate.test.ts`
- Modify: `frontend/src/lib/export-excel.ts`

**Interfaces:**
- Consumes: R7's `pdf-inspect.ts` positioned-text-item API and the existing check helpers.
- Produces: `checkAcquisitionTaxDisclosure(pages, expected)`.

**R7's lesson applies directly:** assert *counts* and *positions*, not substrings. A regime line printed twice, or printed off the page, passes any `toContain`.

- [ ] **Step 1: Write the failing test**

Add to `memo-release-gate.test.ts`:

```ts
describe('acquisition tax disclosure (R8)', () => {
  it('names the applied regime exactly once, inside the page box', () => {
    const pages = inspect(generateInvestmentMemo(welshRun, welshInputs));
    const hits = allTextItems(pages).filter((t) => /LTT — Wales, non-residential/.test(t.text));
    expect(hits).toHaveLength(1);
    expect(hits[0].x).toBeGreaterThanOrEqual(0);
    expect(hits[0].x + hits[0].width).toBeLessThanOrEqual(PAGE_W);
    expect(hits[0].y).toBeLessThanOrEqual(CONTENT_BOTTOM);
  });

  it('no longer claims Scotland and Wales are mistaxed', () => {
    const text = allTextItems(inspect(generateInvestmentMemo(englishRun, englishInputs)))
      .map((t) => t.text).join(' ');
    expect(text).not.toMatch(/not correctly taxed by this version/);
  });

  it('states the tax table version in the provenance panel exactly once', () => {
    const pages = inspect(generateInvestmentMemo(englishRun, englishInputs));
    const hits = allTextItems(pages).filter((t) => t.text.includes(TAX_TABLE_VERSION));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.filter((t) => /Tax table/.test(t.text))).toHaveLength(1);
  });

  it('marks an unconfirmed jurisdiction as DRAFT with one information line', () => {
    const pages = inspect(generateInvestmentMemo(unconfirmedRun, unconfirmedInputs));
    const text = allTextItems(pages).map((t) => t.text).join(' ');
    expect(text).toContain('DRAFT - TAX BASIS UNCONFIRMED');
    const info = allTextItems(pages)
      .filter((t) => /Information Required.*jurisdiction/i.test(t.text));
    expect(info).toHaveLength(1);
  });
});
```

Add `welshRun`/`welshInputs` and `unconfirmedRun`/`unconfirmedInputs` to `memo-fixtures.ts`, built the same way the existing fixtures are. Use the real helper names from `report-checks.ts` and `pdf-inspect.ts` rather than the illustrative `inspect`/`allTextItems` above — read those modules first.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/report-qa/`
Expected: FAIL — the regime line is absent.

- [ ] **Step 3: Implement**

Task 8 supplies the memo content; this step adds the reusable check to `report-checks.ts` and the Excel columns. In `export-excel.ts`, relabel the SDLT row to "Acquisition tax" and add three cells: regime, band-set effective date, table version.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/report-qa/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/report-qa/ frontend/src/lib/export-excel.ts
git commit -m "test(report-qa): assert the tax regime line's presence, count and position"
```

---

## Task 10: Postcode derivation and the server

**Files:**
- Modify: `app/api/app.py:400` and the appraisal upsert path
- Modify: `app/models.py`
- Test: `tests/test_api_endpoints.py`, `tests/test_upsert_endpoints.py`

**Interfaces:**
- Consumes: `migrate_inputs_to_v5()`, `derive_jurisdiction()`.
- Produces: no new endpoints. `AppraisalInputs`-shaped models gain the v5 acquisition fields.

- [ ] **Step 1: Verify no Alembic migration is needed**

Run: `grep -rn "acquisition\|inputs_version" app/persistence/*.py alembic/versions/*.py | head -30`

Inputs are expected to be stored as a JSON snapshot. **If any column or index projects an inputs field, stop and add a migration** — and check the database's actual revision with `alembic current` before stamping anything (R7 found the dev DB two revisions behind its own schema). Record the finding either way in the commit message.

- [ ] **Step 2: Write the failing test**

```python
def test_appraisal_upsert_normalises_v4_to_v5(client, project):
    doc = {"inputs_version": 4, ...}  # reuse the existing v4 upsert fixture
    r = client.put(f"/api/projects/{project.id}/appraisal", json={"inputs": doc})
    assert r.status_code == 200
    acq = r.json()["inputs"]["acquisition"]
    assert r.json()["inputs"]["inputs_version"] == 5
    assert acq["jurisdiction"] == "england_ni"
    assert acq["jurisdiction_evidence_status"] == "unconfirmed"


def test_appraisal_upsert_preserves_a_confirmed_welsh_jurisdiction(client, project):
    doc = {...}  # a v5 document with jurisdiction wales, confirmed
    r = client.put(f"/api/projects/{project.id}/appraisal", json={"inputs": doc})
    assert r.json()["inputs"]["acquisition"]["jurisdiction"] == "wales"
    assert r.json()["metrics"]["acquisition_tax"]["regime"] == "LTT"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python -m pytest tests/test_upsert_endpoints.py -q`
Expected: FAIL — response carries `inputs_version: 4`.

- [ ] **Step 4: Implement**

At `app/api/app.py:400`, replace `migrate_inputs_to_v4(raw)` with `migrate_inputs_to_v5(raw)` and rename the local `v4_dict`. Add the v5 acquisition fields to the corresponding models in `app/models.py`. Where a project has a known postcode country, call `derive_jurisdiction` to set `jurisdiction` and `jurisdiction_source: 'derived'` on a *new* appraisal only — never overwrite a stored one, and never set `confirmed`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/app.py app/models.py tests/
git commit -m "feat(api): normalise appraisal inputs to v5 and derive jurisdiction from postcode"
```

---

## Task 11: Calculator UI

**Files:**
- Modify: `frontend/src/components/calculator/AcquisitionPage.tsx`
- Modify: `frontend/src/components/calculator/AppraisalSummaryPage.tsx` (SDLT label)
- Test: `frontend/src/components/calculator/AcquisitionPage.test.tsx`

**Interfaces:**
- Consumes: `calculateAcquisitionTax()`, `deriveJurisdiction()`, `Jurisdiction`.
- Produces: no exports beyond the component.

**Constraint:** no calculation in the component. It calls `calculateAcquisitionTax` and renders the result, exactly as it currently calls `calculateCommercialSdlt` at line 72.

- [ ] **Step 1: Write the failing test**

```tsx
describe('AcquisitionPage jurisdiction control (R8)', () => {
  it('shows the derived jurisdiction as unconfirmed with a confirm action', () => {
    render(<AcquisitionPage {...propsWithDerivedWales} />);
    expect(screen.getByText(/Wales/)).toBeInTheDocument();
    expect(screen.getByText(/unconfirmed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
  });

  it('relabels the band panel to the applied regime', () => {
    render(<AcquisitionPage {...propsWithDerivedWales} />);
    expect(screen.getByRole('heading', { name: /LTT Breakdown/ })).toBeInTheDocument();
  });

  it('marks the jurisdiction confirmed and user-sourced on confirm', async () => {
    const onChange = vi.fn();
    render(<AcquisitionPage {...propsWithDerivedWales} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      jurisdiction_evidence_status: 'confirmed', jurisdiction_source: 'user',
    }));
  });
});
```

Match the component's real prop names and change-handler signature before writing this — read the file first.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/calculator/AcquisitionPage.test.tsx`
Expected: FAIL — no such control.

- [ ] **Step 3: Implement**

Replace the `calculateCommercialSdlt` call at line 72 with `calculateAcquisitionTax` (basis `'non_residential'`, jurisdiction and date from the inputs). Add above the breakdown panel: a jurisdiction `<select>` of the three options, a source/status line, a Confirm button, an acquisition date `<input type="date">`, and a collapsed override group (amount + reason) that shows the validation error inline when the reason is blank. Relabel the `SDLT Breakdown` heading to `` `${tax.regime} Breakdown` `` and add the band-set effective date and a source link beneath it. Follow the file's existing inline-style conventions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/calculator/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator/
git commit -m "feat(ui): jurisdiction, acquisition date and tax override on the acquisition page"
```

---

## Task 12: Spec, calc version, the non-English golden fixture, and the release report

**Files:**
- Modify: `docs/financial-model/calculation-specification.md` (§1.6, §3.3, §13.1, new §14)
- Modify: `frontend/src/lib/model/index.ts` and `app/financial_model/engine.py` — `CALC_VERSION` to `'2.7.0'`
- Create: `fixtures/financial-model/m-wales-jurisdiction.json`
- Create: `docs/reviews/2026-08-17-release-8-implementation-report.md`

- [ ] **Step 1: Write the failing fixture test**

Create `fixtures/financial-model/m-wales-jurisdiction.json` — a `"kind": "pipeline"` v5 fixture with `jurisdiction: "wales"`, `jurisdiction_evidence_status: "confirmed"`, `acquisition_date: "2026-08-17"` and `purchase_price_pence: 75348200`, whose `expected` block carries `acquisition_tax_pence: 2542410`. Both engines' fixture suites pick it up automatically from the directory.

- [ ] **Step 2: Run both fixture suites to verify they fail**

Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts && cd .. && python -m pytest tests/test_financial_model_fixtures.py -q`
Expected: FAIL until the `expected` block's remaining figures are filled from a first run — derive them from the engine output and check them by hand against the design doc's §1.1 table before committing.

- [ ] **Step 3: Bump the calc version**

`CALC_VERSION` becomes `'2.7.0'` in both engines. Update any test that pins the version string.

- [ ] **Step 4: Write the spec sections**

- **§1.6** — add `5` to the inputs-version list: "`5` = calc 2.7.0+ (adds jurisdiction, acquisition date and acquisition tax override)". State that calc 2.7.0 changes no existing computed value.
- **§3.3** — replace the SDLT bullet. The formula line becomes `purchase_price + acquisition_tax + legal_fees + …`. Point to §14.
- **§13.1** — add the tax table version and jurisdiction to the provenance panel's field list. Note that the audit hash picks both up transitively via the input and output hashes.
- **New §14 — Acquisition tax.** The three regimes with their band sets, sources and effective dates (copy §1.1 of the design doc); the selection rule; the null-date rule; the override rule and its validity condition; and the design doc's §2 non-goals recorded as stated limitations.

- [ ] **Step 5: Run the full gate**

```bash
cd frontend && npx vitest run && npx eslint . && npx tsc -b && npm run build
cd .. && python -m pytest tests/ -q
```

Expected: all green. Then render memoranda for an English, a Scottish and a Welsh case and **read them** — R7's lesson is that the gate and the rendered page catch different defects. Check the regime line, the provenance panel, the assumption paragraph and the draft watermark by eye.

- [ ] **Step 6: Write the release report**

`docs/reviews/2026-08-17-release-8-implementation-report.md`: what changed, the verified band tables with their sources and retrieval date, the three-regime worked figures, gate counts, and anything left open.

- [ ] **Step 7: Commit**

```bash
git add docs/ fixtures/ frontend/src/lib/model/index.ts app/financial_model/engine.py
git commit -m "docs+test: spec §14, calc 2.7.0, and a Welsh golden fixture"
```

---

## Self-Review

**Spec coverage.** Design §1 → Tasks 1, 2, 5. §2 non-goals → Task 12 spec text. §3.1 module + deletions → Tasks 1, 2, 5. §3.2 table → Task 1. §3.3 selection → Tasks 1, 2, 6. §3.4 evaluation and override → Tasks 1, 2, 6. §3.5 inputs v5 → Tasks 3, 4. §3.6 derivation → Tasks 1, 2, 10. §4 parity → Tasks 1, 2. §5 report → Tasks 8, 9. §6 spider → Task 7. §7 UI → Task 11. §8 server → Task 10. §9 testing → distributed, with the full gate in Task 12. §10 spec → Task 12. No gaps.

**Corrections made against the design doc.** Two, both recorded in the tasks that carry them:
1. **The audit hash does not gain fields** (Task 8). `audit_hash()` hashes `input_hash` and `outputs_hash`, which already commit to the whole documents — jurisdiction and table version flow in transitively. The design doc's §5 reads as though they are added directly; doing that would rewrite every stored hash for nothing.
2. **The report gate is a new `DraftReason`, not a hard validation error** (Tasks 6, 8). Making an unconfirmed jurisdiction set `report_safe: false` would print "one or more hard validations fail" — a claim the *figures* are wrong, when only the basis is unverified. The existing module is emphatic about not conflating those, so `tax_basis_unconfirmed` joins the enum instead.

**Placeholder scan.** No TBD/TODO. Three tasks direct the implementer to read a file before writing an assertion (Task 7's axis name, Task 9's inspector helpers, Task 11's prop names) — that is a real instruction to check an existing signature, not a deferred decision.

**Type consistency.** `calculateAcquisitionTax` / `calculate_acquisition_tax` take the same six named arguments throughout. `AcquisitionTaxResult` field names are identical in both engines and are the names Tasks 5, 8, 9 and 11 read. `migrateV4toV5` / `migrate_v4_to_v5` and `migrateInputsToV5` / `migrate_inputs_to_v5` are used consistently. `metrics.acquisition_tax_pence` (scalar) and `metrics.acquisition_tax` (object) are distinct and used correctly in Tasks 5, 8, 9, 12.
