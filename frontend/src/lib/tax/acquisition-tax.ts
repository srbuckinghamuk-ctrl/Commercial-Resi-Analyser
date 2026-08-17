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

/**
 * R8 Fix round 1. `runAppraisal` computes the acquisition cost stack — both
 * `deriveMetrics` and `calculateTotalAcquisitionCost` — *before* `validateInputs`
 * runs, so a date `selectBandSet` cannot place (malformed, or not covered by any
 * band set) must not throw and crash the whole appraisal here; it must degrade.
 * `null` is already defined as "use the currently open-ended set" and reports
 * `date_basis: 'assumed_current'`, so degrading to it is self-describing rather
 * than a silent substitute value (spec §1.5 is about *figures*, not about which
 * band set a bad date resolves to). `validateInputs` independently re-derives
 * the exact same unusable-date condition as a hard `acquisition.acquisition_date`
 * `ValidationIssue`, so the failure is never silent — just never fatal. This is
 * the same pattern as the `computeLenderGdv` catch in `metrics.ts` (see the
 * comment there).
 *
 * Both tax call sites (`deriveMetrics` and `calculateTotalAcquisitionCost`) call
 * this instead of passing their raw date straight to `calculateAcquisitionTax`,
 * so they can never drift apart on how a bad date degrades — see the
 * `taxInsideAcquisitionCost` drift guard in `metrics.test.ts`.
 *
 * Deliberately narrow: this only ever catches `selectBandSet`'s own throw (there
 * is nothing else in the try block that can throw). Any other failure must keep
 * propagating.
 */
export function resolveAcquisitionDate(
  jurisdiction: Jurisdiction, basis: TaxBasis, date: string | null,
): string | null {
  if (date === null) return null;
  try {
    selectBandSet(jurisdiction, basis, date);
    return date;
  } catch {
    return null;
  }
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
