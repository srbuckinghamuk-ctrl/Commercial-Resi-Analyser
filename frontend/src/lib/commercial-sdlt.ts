interface SdltBand {
  threshold_pence: number;
  rate_pct: number;
  tax_pence: number;
}

interface SdltResult {
  total_pence: number;
  effective_rate_pct: number;
  bands: SdltBand[];
}

const BANDS: { up_to_pence: number; rate_pct: number }[] = [
  { up_to_pence: 15_000_000, rate_pct: 0 },
  { up_to_pence: 25_000_000, rate_pct: 2 },
  { up_to_pence: Infinity, rate_pct: 5 },
];

export function calculateCommercialSdlt(pricePence: number): SdltResult {
  if (pricePence <= 0) {
    return {
      total_pence: 0,
      effective_rate_pct: 0,
      bands: BANDS.map((b) => ({
        threshold_pence: b.up_to_pence,
        rate_pct: b.rate_pct,
        tax_pence: 0,
      })),
    };
  }

  let remaining = pricePence;
  let prevThreshold = 0;
  let totalTax = 0;
  const bandResults: SdltBand[] = [];

  for (const band of BANDS) {
    const bandWidth = band.up_to_pence - prevThreshold;
    const taxable = Math.min(remaining, bandWidth);
    const tax = Math.round((taxable * band.rate_pct) / 100);
    bandResults.push({
      threshold_pence: band.up_to_pence,
      rate_pct: band.rate_pct,
      tax_pence: tax,
    });
    totalTax += tax;
    remaining -= taxable;
    prevThreshold = band.up_to_pence;
    if (remaining <= 0) break;
  }

  while (bandResults.length < BANDS.length) {
    const idx = bandResults.length;
    bandResults.push({
      threshold_pence: BANDS[idx].up_to_pence,
      rate_pct: BANDS[idx].rate_pct,
      tax_pence: 0,
    });
  }

  return {
    total_pence: totalTax,
    effective_rate_pct: pricePence > 0 ? (totalTax / pricePence) * 100 : 0,
    bands: bandResults,
  };
}
