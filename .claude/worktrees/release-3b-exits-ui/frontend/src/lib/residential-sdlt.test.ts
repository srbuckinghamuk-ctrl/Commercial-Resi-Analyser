import { describe, it, expect } from 'vitest';
import { calculateResidentialSdlt } from './residential-sdlt';

describe('calculateResidentialSdlt', () => {
  it('returns zero for zero or negative price', () => {
    expect(calculateResidentialSdlt(0).total_pence).toBe(0);
    expect(calculateResidentialSdlt(-100).total_pence).toBe(0);
  });

  it('calculates standard rates on a £500,000 purchase', () => {
    // 0% to £125k, 2% on £125k–£250k = £2,500, 5% on £250k–£500k = £12,500
    const result = calculateResidentialSdlt(50_000_000, { surcharge: false });
    expect(result.total_pence).toBe(1_500_000);
  });

  it('adds the 5% additional-dwelling surcharge on the whole price by default', () => {
    // £15,000 standard + 5% × £500,000 = £25,000 → £40,000
    const result = calculateResidentialSdlt(50_000_000);
    expect(result.total_pence).toBe(4_000_000);
  });

  it('applies the top bands on a £2m purchase without surcharge', () => {
    // 2% × 125k + 5% × 675k + 10% × 575k + 12% × 500k = 2,500 + 33,750 + 57,500 + 60,000 = £153,750
    const result = calculateResidentialSdlt(200_000_000, { surcharge: false });
    expect(result.total_pence).toBe(15_375_000);
  });
});
