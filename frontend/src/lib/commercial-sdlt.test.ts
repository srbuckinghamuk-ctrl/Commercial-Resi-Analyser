import { describe, it, expect } from 'vitest';
import { calculateCommercialSdlt } from './commercial-sdlt';

describe('calculateCommercialSdlt', () => {
  it('returns zero for zero price', () => {
    const result = calculateCommercialSdlt(0);
    expect(result.total_pence).toBe(0);
    expect(result.effective_rate_pct).toBe(0);
  });

  it('returns zero for price within nil band (£150,000)', () => {
    const result = calculateCommercialSdlt(15_000_000);
    expect(result.total_pence).toBe(0);
    expect(result.effective_rate_pct).toBe(0);
  });

  it('calculates 2% band correctly (£200,000)', () => {
    // £150k at 0% = £0, £50k at 2% = £1,000
    const result = calculateCommercialSdlt(20_000_000);
    expect(result.total_pence).toBe(100_000);
    expect(result.effective_rate_pct).toBeCloseTo(0.5, 1);
  });

  it('calculates all bands correctly (£500,000)', () => {
    // £150k at 0% = £0, £100k at 2% = £2,000, £250k at 5% = £12,500
    // Total = £14,500 = 1,450,000 pence
    const result = calculateCommercialSdlt(50_000_000);
    expect(result.total_pence).toBe(1_450_000);
    expect(result.effective_rate_pct).toBeCloseTo(2.9, 1);
  });

  it('calculates correctly at £250,000 boundary', () => {
    // £150k at 0% = £0, £100k at 2% = £2,000
    const result = calculateCommercialSdlt(25_000_000);
    expect(result.total_pence).toBe(200_000);
  });

  it('calculates high value correctly (£1,000,000)', () => {
    // £150k at 0% = £0, £100k at 2% = £2,000, £750k at 5% = £37,500
    // Total = £39,500 = 3,950,000 pence
    const result = calculateCommercialSdlt(100_000_000);
    expect(result.total_pence).toBe(3_950_000);
    expect(result.effective_rate_pct).toBeCloseTo(3.95, 1);
  });

  it('returns three bands', () => {
    const result = calculateCommercialSdlt(50_000_000);
    expect(result.bands).toHaveLength(3);
    expect(result.bands[0].rate_pct).toBe(0);
    expect(result.bands[1].rate_pct).toBe(2);
    expect(result.bands[2].rate_pct).toBe(5);
  });
});
