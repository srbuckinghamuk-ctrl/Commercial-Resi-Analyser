import { describe, it, expect } from 'vitest';
import { defaultCalculatorInputs, defaultCalculatorInputsV3, defaultCalculatorInputsV4, DEFAULT_SCENARIOS } from './conversion-defaults';
import { migrateInputs } from './model';
import { CLASS_MA_AXES } from './deal-spider';

describe('defaultCalculatorInputs', () => {
  it('includes a severe scenario matching the ported preset (-15% GDV, +20% cost, +6mo)', () => {
    const inputs = defaultCalculatorInputs();
    expect(inputs.scenarios.severe.gdv_adjustment_pct).toBe(-15);
    expect(inputs.scenarios.severe.construction_cost_adjustment_pct).toBe(20);
    expect(inputs.scenarios.severe.timeline_adjustment_months).toBe(6);
  });

  it('includes deal_spider defaults with a weight of 1 for every Class MA axis', () => {
    const inputs = defaultCalculatorInputs();
    expect(inputs.deal_spider).toBeDefined();
    for (const axis of CLASS_MA_AXES) {
      expect(inputs.deal_spider.weights[axis.id]).toBe(1);
    }
    expect(inputs.deal_spider.target_profit_on_cost_pct).toBe(20);
    expect(inputs.deal_spider.daylight_pass_pct).toBe(100);
  });

  it('seeds storeys from the project floors when available', () => {
    const inputs = defaultCalculatorInputs({ id: 'p', price_pence: 0, floor_area_sqm: null, floors: 4 });
    expect(inputs.deal_spider.storeys).toBe(4);
  });
});

describe('migrateInputs (legacy v1 snapshot merge)', () => {
  it('fills severe scenario and deal_spider on a legacy snapshot without losing saved values', () => {
    const legacy = defaultCalculatorInputs();
    legacy.acquisition.purchase_price_pence = 42_000_000;
    legacy.scenarios.downside.gdv_adjustment_pct = -12;
    // Simulate a snapshot saved before the spider existed
    const snapshot = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
    delete (snapshot as { scenarios?: { severe?: unknown } }).scenarios!.severe;
    delete (snapshot as { deal_spider?: unknown }).deal_spider;

    const merged = migrateInputs(snapshot);
    expect(merged.acquisition.purchase_price_pence).toBe(42_000_000);
    expect(merged.scenarios.downside.gdv_adjustment_pct).toBe(-12);
    expect(merged.scenarios.severe).toEqual(DEFAULT_SCENARIOS.severe);
    expect(merged.deal_spider.absorption_months).toBeGreaterThan(0);
  });

  it('preserves saved deal_spider values and merges missing weight keys', () => {
    const saved = defaultCalculatorInputs();
    saved.deal_spider.absorption_months = 14;
    const snapshot = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
    (snapshot as { deal_spider: { weights: Record<string, number> } }).deal_spider.weights = {
      margin_resilience: 2,
    };

    const merged = migrateInputs(snapshot);
    expect(merged.deal_spider.absorption_months).toBe(14);
    expect(merged.deal_spider.weights.margin_resilience).toBe(2);
    expect(merged.deal_spider.weights.tax_advantage).toBe(1);
  });
});

describe('defaultCalculatorInputsV4', () => {
  it('is v3 defaults plus the three null blocks', () => {
    const v4 = defaultCalculatorInputsV4();
    expect(v4.inputs_version).toBe(4);
    expect(v4.programme).toBeNull();
    expect(v4.sales_phasing).toBeNull();
    expect(v4.refinance).toBeNull();
    expect(v4.finance).toEqual(defaultCalculatorInputsV3().finance);
  });
});
