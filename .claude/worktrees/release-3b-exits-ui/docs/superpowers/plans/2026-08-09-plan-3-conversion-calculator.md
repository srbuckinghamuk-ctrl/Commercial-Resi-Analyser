# Plan 3: Conversion Financial Calculator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 10-page conversion financial calculator that lets users model the full economics of a commercial-to-residential PDR conversion — from acquisition costs and SDLT through unit mix, construction, finance, cashflow, appraisal metrics (IRR, RLV, profit on cost), scenarios, exit strategy, risk register, and an investor summary — all persisted via the existing `FinancialAppraisal` backend API.

**Architecture:** Five frontend library modules handle all calculations client-side: types, defaults, SDLT engine, core calc engine (GDV, costs, profit metrics, IRR, RLV), and cashflow builder. A `ConversionCalculator` shell component manages state and provides 10-page sub-navigation. Each page is an independent React component receiving shared state via props. On save, the entire inputs snapshot and computed metrics are posted to `POST /api/v1/appraisals`. The calculator tab receives a `selectedProject` prop from `App.tsx` to pre-fill acquisition inputs (price, floor area, use class).

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Tailwind 4, Vitest 4, jsPDF (already installed), xlsx/SheetJS (already installed).

## Global Constraints

- Python >= 3.12, Node >= 20
- All monetary values stored as integer pence (BigInteger in ORM, `number` in TypeScript)
- All UUIDs use `crypto.randomUUID()`
- Frontend: native `fetch` for HTTP, `useState`/`useMemo`/`useCallback` for state (no external state lib)
- API prefix: `/api/v1`
- Existing backend endpoints consumed: `POST /api/v1/appraisals`, `GET /api/v1/appraisals/{project_id}`, `PUT /api/v1/appraisals/{project_id}`
- Existing frontend API functions consumed: `createAppraisal()`, `getAppraisal()`, `updateAppraisal()` from `frontend/src/lib/api.ts`
- Commercial SDLT bands (2024–25): 0% up to £150,000, 2% on £150,001–£250,000, 5% above £250,000

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `frontend/src/lib/conversion-types.ts` | All TypeScript types for calculator inputs, outputs, units, scenarios |
| `frontend/src/lib/conversion-defaults.ts` | Default values, cost rate assumptions, fee percentages |
| `frontend/src/lib/commercial-sdlt.ts` | Commercial/mixed-use SDLT calculation engine |
| `frontend/src/lib/commercial-sdlt.test.ts` | Tests for SDLT engine |
| `frontend/src/lib/conversion-calc-engine.ts` | Core engine: GDV, total costs, profit metrics, IRR, RLV |
| `frontend/src/lib/conversion-calc-engine.test.ts` | Tests for core engine |
| `frontend/src/lib/conversion-cashflow.ts` | Monthly cashflow builder with drawdown and interest accrual |
| `frontend/src/lib/conversion-cashflow.test.ts` | Tests for cashflow builder |
| `frontend/src/components/calculator/AcquisitionPage.tsx` | Page 1: purchase price, SDLT, acquisition costs |
| `frontend/src/components/calculator/UnitMixPage.tsx` | Page 2: unit schedule and GDV |
| `frontend/src/components/calculator/ConversionCostsPage.tsx` | Page 3: construction and professional fees |
| `frontend/src/components/calculator/FinancePage.tsx` | Page 4: funding structure |
| `frontend/src/components/calculator/CashflowPage.tsx` | Page 5: monthly cashflow projection |
| `frontend/src/components/calculator/AppraisalSummaryPage.tsx` | Page 6: key metrics and RLV |
| `frontend/src/components/calculator/ScenariosPage.tsx` | Page 7: multi-scenario comparison |
| `frontend/src/components/calculator/ExitStrategyPage.tsx` | Page 8: sell vs. retain analysis |
| `frontend/src/components/calculator/RiskRegisterPage.tsx` | Page 9: PDR-specific risk register |
| `frontend/src/components/calculator/InvestorSummaryPage.tsx` | Page 10: investor-facing summary |

### Modified files

| File | Change |
|------|--------|
| `frontend/src/components/ConversionCalculator.tsx` | Replace placeholder with full calculator shell, state management, 10-page sub-nav |
| `frontend/src/App.tsx` | Pass `selectedProject` to `ConversionCalculator` |

---

### Task 1: Calculator Types & Defaults

**Files:**
- Create: `frontend/src/lib/conversion-types.ts`
- Create: `frontend/src/lib/conversion-defaults.ts`

**Interfaces:**
- Consumes: `frontend/src/types.ts` — `Project`, `UseClass`
- Produces:
  - Types: `UnitType`, `ProposedUnit`, `AcquisitionInputs`, `UnitMixInputs`, `ConversionCostInputs`, `FinanceInputs`, `ExitStrategyInputs`, `RiskItem`, `ScenarioOverrides`, `CalculatorInputs`, `AppraisalMetrics`, `CashflowMonth`, `CashflowResult`
  - Defaults: `DEFAULT_ACQUISITION`, `DEFAULT_UNIT_MIX`, `DEFAULT_CONVERSION_COSTS`, `DEFAULT_FINANCE`, `DEFAULT_EXIT_STRATEGY`, `DEFAULT_RISK_REGISTER`, `defaultCalculatorInputs(project?: Project): CalculatorInputs`

- [ ] **Step 1: Create `conversion-types.ts`**

Create `frontend/src/lib/conversion-types.ts`:

```typescript
export type UnitType = 'studio' | '1bed' | '2bed' | '3bed';

export interface ProposedUnit {
  id: string;
  type: UnitType;
  floor_area_sqft: number;
  estimated_value_pence: number;
  comparable_notes: string;
}

export interface AcquisitionInputs {
  purchase_price_pence: number;
  legal_fees_pence: number;
  survey_cost_pence: number;
  broker_fee_pct: number;
  other_acquisition_costs_pence: number;
}

export interface UnitMixInputs {
  units: ProposedUnit[];
}

export interface ConversionCostInputs {
  prior_approval_fee_per_dwelling_pence: number;
  cil_s106_pence: number;
  architect_pence: number;
  structural_engineer_pence: number;
  mande_pence: number;
  planning_consultant_pence: number;
  building_control_pence: number;
  other_professional_fees_pence: number;
  construction_cost_per_sqft_pence: number;
  total_construction_sqft: number;
  contingency_pct: number;
  fire_safety_pence: number;
  sound_insulation_pence: number;
  part_l_compliance_pence: number;
}

export type FundingSource = 'cash' | 'bridging' | 'development_finance';
export type InterestType = 'rolled_up' | 'serviced';

export interface FinanceInputs {
  funding_source: FundingSource;
  ltv_pct: number;
  interest_rate_annual_pct: number;
  arrangement_fee_pct: number;
  exit_fee_pct: number;
  loan_term_months: number;
  interest_type: InterestType;
}

export type ExitRoute = 'sell_all' | 'retain_all' | 'blended';

export interface RetainedUnit {
  unit_id: string;
  monthly_rent_pence: number;
}

export interface ExitStrategyInputs {
  route: ExitRoute;
  selling_agent_fee_pct: number;
  selling_legal_fee_pence: number;
  retained_units: RetainedUnit[];
}

export type Likelihood = 'low' | 'medium' | 'high';
export type Impact = 'low' | 'medium' | 'high';

export interface RiskItem {
  id: string;
  description: string;
  likelihood: Likelihood;
  impact: Impact;
  mitigation: string;
}

export interface ScenarioOverrides {
  label: string;
  gdv_adjustment_pct: number;
  construction_cost_adjustment_pct: number;
  timeline_adjustment_months: number;
  interest_rate_adjustment_pct: number;
}

export interface CalculatorInputs {
  project_id: string | null;
  acquisition: AcquisitionInputs;
  unit_mix: UnitMixInputs;
  conversion_costs: ConversionCostInputs;
  finance: FinanceInputs;
  exit_strategy: ExitStrategyInputs;
  risks: RiskItem[];
  scenarios: {
    base: ScenarioOverrides;
    upside: ScenarioOverrides;
    downside: ScenarioOverrides;
  };
}

export interface AppraisalMetrics {
  total_gdv_pence: number;
  total_acquisition_cost_pence: number;
  sdlt_pence: number;
  total_construction_cost_pence: number;
  total_professional_fees_pence: number;
  total_finance_cost_pence: number;
  total_cost_pence: number;
  profit_pence: number;
  profit_on_cost_pct: number;
  profit_on_gdv_pct: number;
  return_on_equity_pct: number;
  development_margin_pct: number;
  irr_monthly: number;
  irr_annual: number;
  rlv_pence: number;
  equity_required_pence: number;
  loan_amount_pence: number;
}

export interface CashflowMonth {
  month: number;
  label: string;
  drawdown_pence: number;
  cumulative_drawdown_pence: number;
  interest_pence: number;
  cumulative_interest_pence: number;
  income_pence: number;
  net_cashflow_pence: number;
  cumulative_cashflow_pence: number;
}

export interface CashflowResult {
  months: CashflowMonth[];
  peak_funding_pence: number;
  total_interest_pence: number;
}
```

- [ ] **Step 2: Create `conversion-defaults.ts`**

Create `frontend/src/lib/conversion-defaults.ts`:

```typescript
import type {
  AcquisitionInputs,
  UnitMixInputs,
  ConversionCostInputs,
  FinanceInputs,
  ExitStrategyInputs,
  RiskItem,
  ScenarioOverrides,
  CalculatorInputs,
} from './conversion-types';

export const DEFAULT_ACQUISITION: AcquisitionInputs = {
  purchase_price_pence: 0,
  legal_fees_pence: 500_000,
  survey_cost_pence: 300_000,
  broker_fee_pct: 1.0,
  other_acquisition_costs_pence: 0,
};

export const DEFAULT_UNIT_MIX: UnitMixInputs = {
  units: [],
};

export const DEFAULT_CONVERSION_COSTS: ConversionCostInputs = {
  prior_approval_fee_per_dwelling_pence: 9_600,
  cil_s106_pence: 0,
  architect_pence: 1_500_000,
  structural_engineer_pence: 500_000,
  mande_pence: 500_000,
  planning_consultant_pence: 300_000,
  building_control_pence: 200_000,
  other_professional_fees_pence: 0,
  construction_cost_per_sqft_pence: 7_500,
  total_construction_sqft: 0,
  contingency_pct: 10.0,
  fire_safety_pence: 0,
  sound_insulation_pence: 0,
  part_l_compliance_pence: 0,
};

export const DEFAULT_FINANCE: FinanceInputs = {
  funding_source: 'bridging',
  ltv_pct: 70.0,
  interest_rate_annual_pct: 8.0,
  arrangement_fee_pct: 2.0,
  exit_fee_pct: 1.0,
  loan_term_months: 12,
  interest_type: 'rolled_up',
};

export const DEFAULT_EXIT_STRATEGY: ExitStrategyInputs = {
  route: 'sell_all',
  selling_agent_fee_pct: 1.5,
  selling_legal_fee_pence: 150_000,
  retained_units: [],
};

export const DEFAULT_RISK_REGISTER: RiskItem[] = [
  {
    id: crypto.randomUUID(),
    description: 'Prior approval refusal',
    likelihood: 'medium',
    impact: 'high',
    mitigation: 'Pre-application consultation with LPA',
  },
  {
    id: crypto.randomUUID(),
    description: 'Article 4 direction introduced mid-project',
    likelihood: 'low',
    impact: 'high',
    mitigation: 'Monitor LPA consultations and planning policy changes',
  },
  {
    id: crypto.randomUUID(),
    description: 'Construction cost overrun',
    likelihood: 'medium',
    impact: 'medium',
    mitigation: 'Fixed-price contract with contingency allowance',
  },
  {
    id: crypto.randomUUID(),
    description: 'GDV falls due to market movement',
    likelihood: 'medium',
    impact: 'high',
    mitigation: 'Conservative comparable evidence, stress test scenarios',
  },
  {
    id: crypto.randomUUID(),
    description: 'Void periods on retained units',
    likelihood: 'medium',
    impact: 'low',
    mitigation: 'Realistic rental assumptions, marketing budget',
  },
];

export const DEFAULT_SCENARIOS: {
  base: ScenarioOverrides;
  upside: ScenarioOverrides;
  downside: ScenarioOverrides;
} = {
  base: {
    label: 'Base Case',
    gdv_adjustment_pct: 0,
    construction_cost_adjustment_pct: 0,
    timeline_adjustment_months: 0,
    interest_rate_adjustment_pct: 0,
  },
  upside: {
    label: 'Upside',
    gdv_adjustment_pct: 10,
    construction_cost_adjustment_pct: -5,
    timeline_adjustment_months: -2,
    interest_rate_adjustment_pct: 0,
  },
  downside: {
    label: 'Downside',
    gdv_adjustment_pct: -10,
    construction_cost_adjustment_pct: 15,
    timeline_adjustment_months: 3,
    interest_rate_adjustment_pct: 1,
  },
};

export function defaultCalculatorInputs(project?: {
  id: string;
  price_pence: number;
  floor_area_sqft: number | null;
}): CalculatorInputs {
  return {
    project_id: project?.id ?? null,
    acquisition: {
      ...DEFAULT_ACQUISITION,
      purchase_price_pence: project?.price_pence ?? 0,
    },
    unit_mix: { ...DEFAULT_UNIT_MIX },
    conversion_costs: {
      ...DEFAULT_CONVERSION_COSTS,
      total_construction_sqft: project?.floor_area_sqft ?? 0,
    },
    finance: { ...DEFAULT_FINANCE },
    exit_strategy: { ...DEFAULT_EXIT_STRATEGY },
    risks: DEFAULT_RISK_REGISTER.map((r) => ({ ...r, id: crypto.randomUUID() })),
    scenarios: {
      base: { ...DEFAULT_SCENARIOS.base },
      upside: { ...DEFAULT_SCENARIOS.upside },
      downside: { ...DEFAULT_SCENARIOS.downside },
    },
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit --pretty`
Expected: No errors related to `conversion-types.ts` or `conversion-defaults.ts`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/conversion-types.ts frontend/src/lib/conversion-defaults.ts
git commit -m "feat: add calculator types and default values"
```

---

### Task 2: Commercial SDLT Engine

**Files:**
- Create: `frontend/src/lib/commercial-sdlt.ts`
- Create: `frontend/src/lib/commercial-sdlt.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `calculateCommercialSdlt(pricePence: number) -> { total_pence: number; effective_rate_pct: number; bands: { threshold_pence: number; rate_pct: number; tax_pence: number }[] }`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/lib/commercial-sdlt.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/commercial-sdlt.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `commercial-sdlt.ts`**

Create `frontend/src/lib/commercial-sdlt.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/commercial-sdlt.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/commercial-sdlt.ts frontend/src/lib/commercial-sdlt.test.ts
git commit -m "feat: add commercial SDLT calculation engine"
```

---

### Task 3: Core Calculation Engine

**Files:**
- Create: `frontend/src/lib/conversion-calc-engine.ts`
- Create: `frontend/src/lib/conversion-calc-engine.test.ts`

**Interfaces:**
- Consumes:
  - `frontend/src/lib/conversion-types.ts` — `CalculatorInputs`, `AppraisalMetrics`
  - `frontend/src/lib/commercial-sdlt.ts` — `calculateCommercialSdlt()`
- Produces:
  - `calculateAppraisal(inputs: CalculatorInputs): AppraisalMetrics`
  - `calculateGdv(units: ProposedUnit[]): number` — sum of all unit values in pence
  - `calculateTotalConstructionCost(costs: ConversionCostInputs): number`
  - `calculateTotalProfessionalFees(costs: ConversionCostInputs): number`
  - `calculateTotalAcquisitionCost(acq: AcquisitionInputs): number`
  - `calculateIrr(cashflows: number[]): number` — Newton-Raphson IRR solver
  - `calculateRlv(metrics: Omit<AppraisalMetrics, 'rlv_pence'>, targetProfitOnCostPct: number): number`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/lib/conversion-calc-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  calculateGdv,
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
  calculateIrr,
  calculateAppraisal,
} from './conversion-calc-engine';
import type { ProposedUnit, AcquisitionInputs, ConversionCostInputs, CalculatorInputs } from './conversion-types';
import { defaultCalculatorInputs } from './conversion-defaults';

describe('calculateGdv', () => {
  it('returns zero for empty units', () => {
    expect(calculateGdv([])).toBe(0);
  });

  it('sums unit values', () => {
    const units: ProposedUnit[] = [
      { id: '1', type: '1bed', floor_area_sqft: 500, estimated_value_pence: 25_000_000, comparable_notes: '' },
      { id: '2', type: '2bed', floor_area_sqft: 700, estimated_value_pence: 35_000_000, comparable_notes: '' },
    ];
    expect(calculateGdv(units)).toBe(60_000_000);
  });
});

describe('calculateTotalAcquisitionCost', () => {
  it('includes purchase price, SDLT, legal, survey, broker fee', () => {
    const acq: AcquisitionInputs = {
      purchase_price_pence: 50_000_000,
      legal_fees_pence: 500_000,
      survey_cost_pence: 300_000,
      broker_fee_pct: 1.0,
      other_acquisition_costs_pence: 0,
    };
    // SDLT on £500k: £14,500 = 1,450,000 pence
    // Broker: 1% of £500k = £5,000 = 500,000 pence
    // Total: 50,000,000 + 1,450,000 + 500,000 + 300,000 + 500,000 = 52,750,000
    const result = calculateTotalAcquisitionCost(acq);
    expect(result).toBe(52_750_000);
  });
});

describe('calculateTotalConstructionCost', () => {
  it('calculates base cost plus contingency plus compliance', () => {
    const costs: ConversionCostInputs = {
      prior_approval_fee_per_dwelling_pence: 0,
      cil_s106_pence: 0,
      architect_pence: 0,
      structural_engineer_pence: 0,
      mande_pence: 0,
      planning_consultant_pence: 0,
      building_control_pence: 0,
      other_professional_fees_pence: 0,
      construction_cost_per_sqft_pence: 10_000,
      total_construction_sqft: 1000,
      contingency_pct: 10,
      fire_safety_pence: 100_000,
      sound_insulation_pence: 50_000,
      part_l_compliance_pence: 50_000,
    };
    // Base: 10,000 * 1000 = 10,000,000
    // Contingency: 10% of 10,000,000 = 1,000,000
    // Compliance: 100,000 + 50,000 + 50,000 = 200,000
    // Total: 11,200,000
    expect(calculateTotalConstructionCost(costs)).toBe(11_200_000);
  });
});

describe('calculateTotalProfessionalFees', () => {
  it('sums all professional fees', () => {
    const costs: ConversionCostInputs = {
      prior_approval_fee_per_dwelling_pence: 9_600,
      cil_s106_pence: 500_000,
      architect_pence: 1_500_000,
      structural_engineer_pence: 500_000,
      mande_pence: 500_000,
      planning_consultant_pence: 300_000,
      building_control_pence: 200_000,
      other_professional_fees_pence: 100_000,
      construction_cost_per_sqft_pence: 0,
      total_construction_sqft: 0,
      contingency_pct: 0,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    };
    // prior_approval excluded from professional fees (it's a statutory fee)
    // Sum: 9_600 + 500_000 + 1_500_000 + 500_000 + 500_000 + 300_000 + 200_000 + 100_000
    expect(calculateTotalProfessionalFees(costs)).toBe(3_609_600);
  });
});

describe('calculateIrr', () => {
  it('returns reasonable IRR for simple cashflow', () => {
    // Invest 100, get 120 back after 12 months
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 120];
    const monthly = calculateIrr(cashflows);
    expect(monthly).toBeGreaterThan(0);
    expect(monthly).toBeLessThan(5);
  });

  it('returns 0 for break-even', () => {
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    const monthly = calculateIrr(cashflows);
    expect(monthly).toBeCloseTo(0, 1);
  });

  it('returns negative for loss-making', () => {
    const cashflows = [-100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80];
    const monthly = calculateIrr(cashflows);
    expect(monthly).toBeLessThan(0);
  });
});

describe('calculateAppraisal', () => {
  it('produces complete metrics for valid inputs', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.unit_mix.units = [
      { id: '1', type: '1bed', floor_area_sqft: 500, estimated_value_pence: 25_000_000, comparable_notes: '' },
      { id: '2', type: '2bed', floor_area_sqft: 700, estimated_value_pence: 35_000_000, comparable_notes: '' },
      { id: '3', type: '1bed', floor_area_sqft: 450, estimated_value_pence: 22_000_000, comparable_notes: '' },
    ];
    inputs.conversion_costs.construction_cost_per_sqft_pence = 7_500;
    inputs.conversion_costs.total_construction_sqft = 5000;

    const metrics = calculateAppraisal(inputs);

    expect(metrics.total_gdv_pence).toBe(82_000_000);
    expect(metrics.sdlt_pence).toBeGreaterThan(0);
    expect(metrics.total_acquisition_cost_pence).toBeGreaterThan(50_000_000);
    expect(metrics.total_construction_cost_pence).toBeGreaterThan(0);
    expect(metrics.total_cost_pence).toBeGreaterThan(0);
    expect(metrics.profit_pence).toBe(metrics.total_gdv_pence - metrics.total_cost_pence);
    expect(metrics.profit_on_cost_pct).toBeGreaterThan(0);
    expect(metrics.profit_on_gdv_pct).toBeGreaterThan(0);
    expect(metrics.loan_amount_pence).toBeGreaterThan(0);
    expect(metrics.equity_required_pence).toBeGreaterThan(0);
  });

  it('returns zero profit metrics when no units', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    const metrics = calculateAppraisal(inputs);
    expect(metrics.total_gdv_pence).toBe(0);
    expect(metrics.profit_pence).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/conversion-calc-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `conversion-calc-engine.ts`**

Create `frontend/src/lib/conversion-calc-engine.ts`:

```typescript
import type {
  AcquisitionInputs,
  AppraisalMetrics,
  CalculatorInputs,
  ConversionCostInputs,
  ProposedUnit,
} from './conversion-types';
import { calculateCommercialSdlt } from './commercial-sdlt';

export function calculateGdv(units: ProposedUnit[]): number {
  return units.reduce((sum, u) => sum + u.estimated_value_pence, 0);
}

export function calculateTotalAcquisitionCost(acq: AcquisitionInputs): number {
  const sdlt = calculateCommercialSdlt(acq.purchase_price_pence).total_pence;
  const brokerFee = Math.round((acq.purchase_price_pence * acq.broker_fee_pct) / 100);
  return (
    acq.purchase_price_pence +
    sdlt +
    acq.legal_fees_pence +
    acq.survey_cost_pence +
    brokerFee +
    acq.other_acquisition_costs_pence
  );
}

export function calculateTotalConstructionCost(costs: ConversionCostInputs): number {
  const baseCost = costs.construction_cost_per_sqft_pence * costs.total_construction_sqft;
  const contingency = Math.round((baseCost * costs.contingency_pct) / 100);
  const compliance = costs.fire_safety_pence + costs.sound_insulation_pence + costs.part_l_compliance_pence;
  return baseCost + contingency + compliance;
}

export function calculateTotalProfessionalFees(costs: ConversionCostInputs): number {
  return (
    costs.prior_approval_fee_per_dwelling_pence +
    costs.cil_s106_pence +
    costs.architect_pence +
    costs.structural_engineer_pence +
    costs.mande_pence +
    costs.planning_consultant_pence +
    costs.building_control_pence +
    costs.other_professional_fees_pence
  );
}

export function calculateIrr(cashflows: number[], maxIterations = 1000, tolerance = 1e-7): number {
  let guess = 0.01;
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const factor = Math.pow(1 + guess, t);
      npv += cashflows[t] / factor;
      if (t > 0) {
        dnpv -= (t * cashflows[t]) / Math.pow(1 + guess, t + 1);
      }
    }
    if (Math.abs(dnpv) < 1e-15) break;
    const newGuess = guess - npv / dnpv;
    if (Math.abs(newGuess - guess) < tolerance) return newGuess * 100;
    guess = newGuess;
  }
  return guess * 100;
}

export function calculateRlv(
  totalCostExLand: number,
  gdv: number,
  targetProfitOnCostPct: number,
): number {
  // RLV = GDV / (1 + target%) - total costs excluding land
  const targetMultiplier = 1 + targetProfitOnCostPct / 100;
  return Math.round(gdv / targetMultiplier - totalCostExLand);
}

export function calculateAppraisal(inputs: CalculatorInputs): AppraisalMetrics {
  const gdv = calculateGdv(inputs.unit_mix.units);
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence).total_pence;
  const totalAcquisition = calculateTotalAcquisitionCost(inputs.acquisition);
  const totalConstruction = calculateTotalConstructionCost(inputs.conversion_costs);
  const totalProfessional = calculateTotalProfessionalFees(inputs.conversion_costs);

  const totalCostBeforeFinance = totalAcquisition + totalConstruction + totalProfessional;
  const loanAmount = Math.round((totalCostBeforeFinance * inputs.finance.ltv_pct) / 100);
  const equityRequired = totalCostBeforeFinance - loanAmount;

  const arrangementFee = Math.round((loanAmount * inputs.finance.arrangement_fee_pct) / 100);
  const exitFee = Math.round((loanAmount * inputs.finance.exit_fee_pct) / 100);
  const monthlyRate = inputs.finance.interest_rate_annual_pct / 100 / 12;
  const totalInterest = Math.round(loanAmount * monthlyRate * inputs.finance.loan_term_months);
  const totalFinanceCost = arrangementFee + exitFee + totalInterest;

  const totalCost = totalCostBeforeFinance + totalFinanceCost;
  const profit = gdv - totalCost;

  const profitOnCost = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const profitOnGdv = gdv > 0 ? (profit / gdv) * 100 : 0;
  const returnOnEquity = equityRequired > 0 ? (profit / equityRequired) * 100 : 0;
  const devMargin = gdv > 0 ? (profit / gdv) * 100 : 0;

  const cashflows: number[] = [];
  cashflows.push(-equityRequired);
  for (let m = 1; m < inputs.finance.loan_term_months; m++) {
    cashflows.push(0);
  }
  cashflows.push(profit + equityRequired);

  const irrMonthly = cashflows.length > 1 ? calculateIrr(cashflows) : 0;
  const irrAnnual = (Math.pow(1 + irrMonthly / 100, 12) - 1) * 100;

  const totalCostExLand = totalCost - inputs.acquisition.purchase_price_pence - sdlt;
  const rlv = calculateRlv(totalCostExLand, gdv, 20);

  return {
    total_gdv_pence: gdv,
    total_acquisition_cost_pence: totalAcquisition,
    sdlt_pence: sdlt,
    total_construction_cost_pence: totalConstruction,
    total_professional_fees_pence: totalProfessional,
    total_finance_cost_pence: totalFinanceCost,
    total_cost_pence: totalCost,
    profit_pence: profit,
    profit_on_cost_pct: Math.round(profitOnCost * 100) / 100,
    profit_on_gdv_pct: Math.round(profitOnGdv * 100) / 100,
    return_on_equity_pct: Math.round(returnOnEquity * 100) / 100,
    development_margin_pct: Math.round(devMargin * 100) / 100,
    irr_monthly: Math.round(irrMonthly * 100) / 100,
    irr_annual: Math.round(irrAnnual * 100) / 100,
    rlv_pence: rlv,
    equity_required_pence: equityRequired,
    loan_amount_pence: loanAmount,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/conversion-calc-engine.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/conversion-calc-engine.ts frontend/src/lib/conversion-calc-engine.test.ts
git commit -m "feat: add core conversion calculation engine with GDV, costs, IRR, RLV"
```

---

### Task 4: Cashflow Builder

**Files:**
- Create: `frontend/src/lib/conversion-cashflow.ts`
- Create: `frontend/src/lib/conversion-cashflow.test.ts`

**Interfaces:**
- Consumes:
  - `frontend/src/lib/conversion-types.ts` — `CalculatorInputs`, `CashflowMonth`, `CashflowResult`
  - `frontend/src/lib/conversion-calc-engine.ts` — `calculateTotalAcquisitionCost()`, `calculateTotalConstructionCost()`, `calculateTotalProfessionalFees()`, `calculateGdv()`
- Produces: `buildCashflow(inputs: CalculatorInputs): CashflowResult`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/lib/conversion-cashflow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildCashflow } from './conversion-cashflow';
import { defaultCalculatorInputs } from './conversion-defaults';

describe('buildCashflow', () => {
  it('returns months array matching loan term', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    expect(result.months).toHaveLength(12);
  });

  it('month 1 has acquisition drawdown', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    expect(result.months[0].drawdown_pence).toBeGreaterThan(0);
    expect(result.months[0].label).toBe('Month 1');
  });

  it('final month has income from sales', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.unit_mix.units = [
      { id: '1', type: '1bed', floor_area_sqft: 500, estimated_value_pence: 30_000_000, comparable_notes: '' },
    ];
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    const lastMonth = result.months[result.months.length - 1];
    expect(lastMonth.income_pence).toBeGreaterThan(0);
  });

  it('tracks cumulative drawdown', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 6;
    const result = buildCashflow(inputs);
    for (let i = 1; i < result.months.length; i++) {
      expect(result.months[i].cumulative_drawdown_pence).toBeGreaterThanOrEqual(
        result.months[i - 1].cumulative_drawdown_pence,
      );
    }
  });

  it('accrues interest each month for rolled-up finance', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.interest_type = 'rolled_up';
    inputs.finance.loan_term_months = 6;
    const result = buildCashflow(inputs);
    expect(result.total_interest_pence).toBeGreaterThan(0);
  });

  it('calculates peak funding', () => {
    const inputs = defaultCalculatorInputs({ id: 'test', price_pence: 50_000_000, floor_area_sqft: 5000 });
    inputs.finance.loan_term_months = 12;
    const result = buildCashflow(inputs);
    expect(result.peak_funding_pence).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/conversion-cashflow.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `conversion-cashflow.ts`**

Create `frontend/src/lib/conversion-cashflow.ts`:

```typescript
import type { CalculatorInputs, CashflowMonth, CashflowResult } from './conversion-types';
import {
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
  calculateGdv,
} from './conversion-calc-engine';

export function buildCashflow(inputs: CalculatorInputs): CashflowResult {
  const totalMonths = inputs.finance.loan_term_months;
  if (totalMonths <= 0) {
    return { months: [], peak_funding_pence: 0, total_interest_pence: 0 };
  }

  const acquisition = calculateTotalAcquisitionCost(inputs.acquisition);
  const construction = calculateTotalConstructionCost(inputs.conversion_costs);
  const professional = calculateTotalProfessionalFees(inputs.conversion_costs);
  const gdv = calculateGdv(inputs.unit_mix.units);

  const monthlyRate = inputs.finance.interest_rate_annual_pct / 100 / 12;
  const constructionMonths = Math.max(1, totalMonths - 2);
  const monthlyConstruction = Math.round(construction / constructionMonths);
  const monthlyProfessional = Math.round(professional / Math.max(1, Math.ceil(constructionMonths / 2)));

  const months: CashflowMonth[] = [];
  let cumulativeDrawdown = 0;
  let cumulativeInterest = 0;
  let cumulativeCashflow = 0;
  let peakFunding = 0;

  for (let m = 0; m < totalMonths; m++) {
    let drawdown = 0;
    let income = 0;

    if (m === 0) {
      drawdown = acquisition;
    }

    if (m >= 1 && m <= constructionMonths) {
      drawdown += monthlyConstruction;
    }

    if (m >= 1 && m <= Math.ceil(constructionMonths / 2)) {
      drawdown += monthlyProfessional;
    }

    if (m === totalMonths - 1) {
      income = gdv;
    }

    cumulativeDrawdown += drawdown;
    const interest = Math.round(cumulativeDrawdown * monthlyRate);
    cumulativeInterest += interest;

    const netCashflow = income - drawdown - interest;
    cumulativeCashflow += netCashflow;

    const fundingPosition = cumulativeDrawdown + cumulativeInterest - income;
    if (fundingPosition > peakFunding) {
      peakFunding = fundingPosition;
    }

    months.push({
      month: m + 1,
      label: `Month ${m + 1}`,
      drawdown_pence: drawdown,
      cumulative_drawdown_pence: cumulativeDrawdown,
      interest_pence: interest,
      cumulative_interest_pence: cumulativeInterest,
      income_pence: income,
      net_cashflow_pence: netCashflow,
      cumulative_cashflow_pence: cumulativeCashflow,
    });
  }

  return {
    months,
    peak_funding_pence: peakFunding,
    total_interest_pence: cumulativeInterest,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run src/lib/conversion-cashflow.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/conversion-cashflow.ts frontend/src/lib/conversion-cashflow.test.ts
git commit -m "feat: add monthly cashflow builder with drawdown and interest accrual"
```

---

### Task 5: Calculator Shell & Page Sub-Navigation

**Files:**
- Modify: `frontend/src/components/ConversionCalculator.tsx` — replace placeholder with calculator shell, state management, 10-page sub-nav
- Modify: `frontend/src/App.tsx` — pass `selectedProject` to `ConversionCalculator`

**Interfaces:**
- Consumes:
  - `frontend/src/lib/conversion-types.ts` — `CalculatorInputs`
  - `frontend/src/lib/conversion-defaults.ts` — `defaultCalculatorInputs()`
  - `frontend/src/lib/conversion-calc-engine.ts` — `calculateAppraisal()`
  - `frontend/src/lib/conversion-cashflow.ts` — `buildCashflow()`
  - `frontend/src/lib/api.ts` — `createAppraisal()`, `getAppraisal()`, `updateAppraisal()`
  - `frontend/src/types.ts` — `Project`, `FinancialAppraisalCreate`
- Produces:
  - `ConversionCalculator` component accepting `props: { project: Project | null }`
  - Calculator state: `inputs: CalculatorInputs`, `metrics: AppraisalMetrics`, `cashflow: CashflowResult`
  - 10-page sub-navigation with page switching
  - Save/load to backend via `FinancialAppraisal` API

- [ ] **Step 1: Update `App.tsx` to pass `selectedProject` to calculator**

In `frontend/src/App.tsx`, change the calculator tab rendering from:

```tsx
{activeTab === 'calculator' && <ConversionCalculator />}
```

to:

```tsx
{activeTab === 'calculator' && <ConversionCalculator project={selectedProject} />}
```

- [ ] **Step 2: Rewrite `ConversionCalculator.tsx` with shell and sub-nav**

Replace `frontend/src/components/ConversionCalculator.tsx` with:

```tsx
import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Project } from '../types';
import type { CalculatorInputs, AppraisalMetrics, CashflowResult } from '../lib/conversion-types';
import { defaultCalculatorInputs } from '../lib/conversion-defaults';
import { calculateAppraisal } from '../lib/conversion-calc-engine';
import { buildCashflow } from '../lib/conversion-cashflow';
import { createAppraisal, getAppraisal, updateAppraisal } from '../lib/api';

import AcquisitionPage from './calculator/AcquisitionPage';
import UnitMixPage from './calculator/UnitMixPage';
import ConversionCostsPage from './calculator/ConversionCostsPage';
import FinancePage from './calculator/FinancePage';
import CashflowPage from './calculator/CashflowPage';
import AppraisalSummaryPage from './calculator/AppraisalSummaryPage';
import ScenariosPage from './calculator/ScenariosPage';
import ExitStrategyPage from './calculator/ExitStrategyPage';
import RiskRegisterPage from './calculator/RiskRegisterPage';
import InvestorSummaryPage from './calculator/InvestorSummaryPage';

type CalcPage =
  | 'acquisition'
  | 'unit_mix'
  | 'conversion_costs'
  | 'finance'
  | 'cashflow'
  | 'appraisal'
  | 'scenarios'
  | 'exit_strategy'
  | 'risk_register'
  | 'investor_summary';

const PAGES: { key: CalcPage; label: string; num: number }[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1 },
  { key: 'unit_mix', label: 'Unit Mix', num: 2 },
  { key: 'conversion_costs', label: 'Costs', num: 3 },
  { key: 'finance', label: 'Finance', num: 4 },
  { key: 'cashflow', label: 'Cashflow', num: 5 },
  { key: 'appraisal', label: 'Appraisal', num: 6 },
  { key: 'scenarios', label: 'Scenarios', num: 7 },
  { key: 'exit_strategy', label: 'Exit', num: 8 },
  { key: 'risk_register', label: 'Risk', num: 9 },
  { key: 'investor_summary', label: 'Investor', num: 10 },
];

interface Props {
  project: Project | null;
}

export default function ConversionCalculator({ project }: Props) {
  const [activePage, setActivePage] = useState<CalcPage>('acquisition');
  const [inputs, setInputs] = useState<CalculatorInputs>(() =>
    defaultCalculatorInputs(project ?? undefined),
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setInputs(defaultCalculatorInputs(project));
      setSavedId(null);
      getAppraisal(project.id)
        .then((appraisal) => {
          if (appraisal.inputs_snapshot && typeof appraisal.inputs_snapshot === 'object') {
            setInputs(appraisal.inputs_snapshot as unknown as CalculatorInputs);
            setSavedId(appraisal.id);
          }
        })
        .catch(() => {});
    }
  }, [project]);

  const metrics: AppraisalMetrics = useMemo(() => calculateAppraisal(inputs), [inputs]);
  const cashflow: CashflowResult = useMemo(() => buildCashflow(inputs), [inputs]);

  const updateInputs = useCallback((partial: Partial<CalculatorInputs>) => {
    setInputs((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    try {
      const payload = {
        project_id: project.id,
        name: `Appraisal — ${project.address_raw}`,
        inputs_snapshot: inputs as unknown as Record<string, unknown>,
        gdv_pence: metrics.total_gdv_pence,
        total_cost_pence: metrics.total_cost_pence,
        profit_on_cost_pct: metrics.profit_on_cost_pct,
        profit_on_gdv_pct: metrics.profit_on_gdv_pct,
        return_on_equity_pct: metrics.return_on_equity_pct,
        irr: metrics.irr_annual,
        rlv_pence: metrics.rlv_pence,
      };
      if (savedId) {
        await updateAppraisal(project.id, payload);
      } else {
        const result = await createAppraisal(payload);
        setSavedId(result.id);
      }
    } finally {
      setSaving(false);
    }
  }, [project, inputs, metrics, savedId]);

  const pageIndex = PAGES.findIndex((p) => p.key === activePage);

  const goNext = useCallback(() => {
    if (pageIndex < PAGES.length - 1) setActivePage(PAGES[pageIndex + 1].key);
  }, [pageIndex]);

  const goPrev = useCallback(() => {
    if (pageIndex > 0) setActivePage(PAGES[pageIndex - 1].key);
  }, [pageIndex]);

  if (!project) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Conversion Calculator</h2>
        <p style={{ color: '#94a3b8' }}>Select a project from the Pipeline tab to start a financial appraisal.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Sub-nav */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #1e3a5f',
          background: '#0d1b2a',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {PAGES.map((page) => (
          <button
            key={page.key}
            onClick={() => setActivePage(page.key)}
            style={{
              padding: '8px 14px',
              border: 'none',
              borderBottom: activePage === page.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activePage === page.key ? '#e2e8f0' : '#64748b',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activePage === page.key ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {page.num}. {page.label}
          </button>
        ))}
      </div>

      {/* Page content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {activePage === 'acquisition' && (
          <AcquisitionPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'unit_mix' && (
          <UnitMixPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'conversion_costs' && (
          <ConversionCostsPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'finance' && (
          <FinancePage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'cashflow' && (
          <CashflowPage inputs={inputs} cashflow={cashflow} />
        )}
        {activePage === 'appraisal' && (
          <AppraisalSummaryPage metrics={metrics} inputs={inputs} />
        )}
        {activePage === 'scenarios' && (
          <ScenariosPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'exit_strategy' && (
          <ExitStrategyPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'risk_register' && (
          <RiskRegisterPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'investor_summary' && (
          <InvestorSummaryPage inputs={inputs} metrics={metrics} cashflow={cashflow} project={project} />
        )}
      </div>

      {/* Footer nav */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderTop: '1px solid #1e3a5f',
          background: '#0d1b2a',
          flexShrink: 0,
        }}
      >
        <button
          onClick={goPrev}
          disabled={pageIndex === 0}
          style={{
            padding: '8px 20px',
            background: pageIndex === 0 ? '#1e293b' : '#1e3a5f',
            color: pageIndex === 0 ? '#475569' : '#e2e8f0',
            border: 'none',
            borderRadius: 6,
            cursor: pageIndex === 0 ? 'default' : 'pointer',
            fontSize: 14,
          }}
        >
          Previous
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 24px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {saving ? 'Saving...' : savedId ? 'Update Appraisal' : 'Save Appraisal'}
        </button>
        <button
          onClick={goNext}
          disabled={pageIndex === PAGES.length - 1}
          style={{
            padding: '8px 20px',
            background: pageIndex === PAGES.length - 1 ? '#1e293b' : '#1e3a5f',
            color: pageIndex === PAGES.length - 1 ? '#475569' : '#e2e8f0',
            border: 'none',
            borderRadius: 6,
            cursor: pageIndex === PAGES.length - 1 ? 'default' : 'pointer',
            fontSize: 14,
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create all 10 page stubs**

Create `frontend/src/components/calculator/` directory with 10 stub files. Each stub renders a heading and accepts the correct props. These stubs will be replaced one-by-one in Tasks 6–10.

Create `frontend/src/components/calculator/AcquisitionPage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

export default function AcquisitionPage({ inputs, onChange, metrics }: Props) {
  return <p style={{ color: '#94a3b8' }}>Acquisition page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/UnitMixPage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

export default function UnitMixPage({ inputs, onChange, metrics }: Props) {
  return <p style={{ color: '#94a3b8' }}>Unit Mix page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/ConversionCostsPage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

export default function ConversionCostsPage({ inputs, onChange, metrics }: Props) {
  return <p style={{ color: '#94a3b8' }}>Conversion Costs page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/FinancePage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

export default function FinancePage({ inputs, onChange, metrics }: Props) {
  return <p style={{ color: '#94a3b8' }}>Finance page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/CashflowPage.tsx`:

```tsx
import type { CalculatorInputs, CashflowResult } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  cashflow: CashflowResult;
}

export default function CashflowPage({ inputs, cashflow }: Props) {
  return <p style={{ color: '#94a3b8' }}>Cashflow page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/AppraisalSummaryPage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  metrics: AppraisalMetrics;
  inputs: CalculatorInputs;
}

export default function AppraisalSummaryPage({ metrics, inputs }: Props) {
  return <p style={{ color: '#94a3b8' }}>Appraisal Summary page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/ScenariosPage.tsx`:

```tsx
import type { CalculatorInputs } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
}

export default function ScenariosPage({ inputs, onChange }: Props) {
  return <p style={{ color: '#94a3b8' }}>Scenarios page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/ExitStrategyPage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

export default function ExitStrategyPage({ inputs, onChange, metrics }: Props) {
  return <p style={{ color: '#94a3b8' }}>Exit Strategy page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/RiskRegisterPage.tsx`:

```tsx
import type { CalculatorInputs } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
}

export default function RiskRegisterPage({ inputs, onChange }: Props) {
  return <p style={{ color: '#94a3b8' }}>Risk Register page — coming next.</p>;
}
```

Create `frontend/src/components/calculator/InvestorSummaryPage.tsx`:

```tsx
import type { Project } from '../../types';
import type { CalculatorInputs, AppraisalMetrics, CashflowResult } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  metrics: AppraisalMetrics;
  cashflow: CashflowResult;
  project: Project;
}

export default function InvestorSummaryPage({ inputs, metrics, cashflow, project }: Props) {
  return <p style={{ color: '#94a3b8' }}>Investor Summary page — coming next.</p>;
}
```

- [ ] **Step 4: Verify TypeScript compiles and dev server starts**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ConversionCalculator.tsx frontend/src/components/calculator/
git commit -m "feat: add calculator shell with 10-page sub-navigation and state management"
```

---

### Task 6: Acquisition, Unit Mix & Conversion Costs Pages

**Files:**
- Modify: `frontend/src/components/calculator/AcquisitionPage.tsx`
- Modify: `frontend/src/components/calculator/UnitMixPage.tsx`
- Modify: `frontend/src/components/calculator/ConversionCostsPage.tsx`

**Interfaces:**
- Consumes:
  - `frontend/src/lib/conversion-types.ts` — `CalculatorInputs`, `AppraisalMetrics`, `AcquisitionInputs`, `ProposedUnit`, `UnitType`, `ConversionCostInputs`
  - `frontend/src/lib/commercial-sdlt.ts` — `calculateCommercialSdlt()`
- Produces: Three form pages that update `inputs` via `onChange`. Each renders labelled number inputs with formatted pence displays, SDLT breakdown, unit cards with add/remove, and cost line items.

- [ ] **Step 1: Implement `AcquisitionPage.tsx`**

Replace `frontend/src/components/calculator/AcquisitionPage.tsx`:

```tsx
import { useMemo } from 'react';
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';
import { calculateCommercialSdlt } from '../../lib/commercial-sdlt';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

function InputRow({ label, value, onChangeValue, suffix }: {
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={{
          width: 160,
          padding: '6px 10px',
          background: '#0f172a',
          border: '1px solid #1e3a5f',
          borderRadius: 4,
          color: '#e2e8f0',
          fontSize: 14,
        }}
      />
      {suffix && <span style={{ color: '#64748b', fontSize: 13 }}>{suffix}</span>}
    </div>
  );
}

export default function AcquisitionPage({ inputs, onChange, metrics }: Props) {
  const acq = inputs.acquisition;
  const sdlt = useMemo(() => calculateCommercialSdlt(acq.purchase_price_pence), [acq.purchase_price_pence]);

  const updateAcq = (partial: Partial<typeof acq>) => {
    onChange({ acquisition: { ...acq, ...partial } });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>1. Acquisition Inputs</h3>

      <InputRow
        label="Purchase price (pence)"
        value={acq.purchase_price_pence}
        onChangeValue={(v) => updateAcq({ purchase_price_pence: v })}
        suffix={penceToPounds(acq.purchase_price_pence)}
      />
      <InputRow
        label="Legal fees (pence)"
        value={acq.legal_fees_pence}
        onChangeValue={(v) => updateAcq({ legal_fees_pence: v })}
        suffix={penceToPounds(acq.legal_fees_pence)}
      />
      <InputRow
        label="Survey cost (pence)"
        value={acq.survey_cost_pence}
        onChangeValue={(v) => updateAcq({ survey_cost_pence: v })}
        suffix={penceToPounds(acq.survey_cost_pence)}
      />
      <InputRow
        label="Broker fee (%)"
        value={acq.broker_fee_pct}
        onChangeValue={(v) => updateAcq({ broker_fee_pct: v })}
        suffix={penceToPounds(Math.round(acq.purchase_price_pence * acq.broker_fee_pct / 100))}
      />
      <InputRow
        label="Other costs (pence)"
        value={acq.other_acquisition_costs_pence}
        onChangeValue={(v) => updateAcq({ other_acquisition_costs_pence: v })}
        suffix={penceToPounds(acq.other_acquisition_costs_pence)}
      />

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <h4 style={{ color: '#e2e8f0', fontSize: 15, marginBottom: 12 }}>SDLT Breakdown</h4>
        {sdlt.bands.map((band, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: '#94a3b8', fontSize: 13 }}>
            <span>{band.rate_pct}% band</span>
            <span>{penceToPounds(band.tax_pence)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e3a5f', color: '#e2e8f0', fontWeight: 600 }}>
          <span>Total SDLT</span>
          <span>{penceToPounds(sdlt.total_pence)} ({sdlt.effective_rate_pct.toFixed(1)}%)</span>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>
          <span>Total Acquisition Cost</span>
          <span>{penceToPounds(metrics.total_acquisition_cost_pence)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `UnitMixPage.tsx`**

Replace `frontend/src/components/calculator/UnitMixPage.tsx`:

```tsx
import { useCallback } from 'react';
import type { CalculatorInputs, AppraisalMetrics, ProposedUnit, UnitType } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

const UNIT_TYPES: { value: UnitType; label: string }[] = [
  { value: 'studio', label: 'Studio' },
  { value: '1bed', label: '1 Bed' },
  { value: '2bed', label: '2 Bed' },
  { value: '3bed', label: '3 Bed' },
];

export default function UnitMixPage({ inputs, onChange, metrics }: Props) {
  const units = inputs.unit_mix.units;

  const updateUnits = useCallback(
    (newUnits: ProposedUnit[]) => {
      onChange({ unit_mix: { units: newUnits } });
    },
    [onChange],
  );

  const addUnit = useCallback(() => {
    updateUnits([
      ...units,
      {
        id: crypto.randomUUID(),
        type: '1bed',
        floor_area_sqft: 500,
        estimated_value_pence: 25_000_000,
        comparable_notes: '',
      },
    ]);
  }, [units, updateUnits]);

  const removeUnit = useCallback(
    (id: string) => {
      updateUnits(units.filter((u) => u.id !== id));
    },
    [units, updateUnits],
  );

  const updateUnit = useCallback(
    (id: string, partial: Partial<ProposedUnit>) => {
      updateUnits(units.map((u) => (u.id === id ? { ...u, ...partial } : u)));
    },
    [units, updateUnits],
  );

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>2. Unit Mix & Schedule</h3>

      {units.map((unit, i) => (
        <div
          key={unit.id}
          style={{
            padding: 16,
            marginBottom: 12,
            background: '#0f172a',
            borderRadius: 8,
            border: '1px solid #1e3a5f',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Unit {i + 1}</span>
            <button
              onClick={() => removeUnit(unit.id)}
              style={{ background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}
            >
              Remove
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Type</label>
              <select
                value={unit.type}
                onChange={(e) => updateUnit(unit.id, { type: e.target.value as UnitType })}
                style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              >
                {UNIT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Floor area (sq ft)</label>
              <input
                type="number"
                value={unit.floor_area_sqft}
                onChange={(e) => updateUnit(unit.id, { floor_area_sqft: Number(e.target.value) })}
                style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              />
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Est. value (pence)</label>
              <input
                type="number"
                value={unit.estimated_value_pence}
                onChange={(e) => updateUnit(unit.id, { estimated_value_pence: Number(e.target.value) })}
                style={{ width: 160, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              />
              <span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>{penceToPounds(unit.estimated_value_pence)}</span>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Comparable notes</label>
              <input
                type="text"
                value={unit.comparable_notes}
                onChange={(e) => updateUnit(unit.id, { comparable_notes: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              />
            </div>
          </div>
        </div>
      ))}

      <button
        onClick={addUnit}
        style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 8 }}
      >
        + Add Unit
      </button>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Units: {units.length}</span>
          <span>Total floor area: {units.reduce((s, u) => s + u.floor_area_sqft, 0).toLocaleString()} sq ft</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>
          <span>Total GDV</span>
          <span>{penceToPounds(metrics.total_gdv_pence)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `ConversionCostsPage.tsx`**

Replace `frontend/src/components/calculator/ConversionCostsPage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

function CostRow({ label, value, onChangeValue, suffix }: {
  label: string;
  value: number;
  onChangeValue: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
      <label style={{ color: '#94a3b8', width: 260, fontSize: 14 }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChangeValue(Number(e.target.value))}
        style={{ width: 140, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
      />
      {suffix && <span style={{ color: '#64748b', fontSize: 13 }}>{suffix}</span>}
    </div>
  );
}

export default function ConversionCostsPage({ inputs, onChange, metrics }: Props) {
  const costs = inputs.conversion_costs;

  const updateCosts = (partial: Partial<typeof costs>) => {
    onChange({ conversion_costs: { ...costs, ...partial } });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>3. Conversion Costs</h3>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Statutory Fees</h4>
      <CostRow label="Prior approval fee / dwelling (p)" value={costs.prior_approval_fee_per_dwelling_pence} onChangeValue={(v) => updateCosts({ prior_approval_fee_per_dwelling_pence: v })} suffix={penceToPounds(costs.prior_approval_fee_per_dwelling_pence)} />
      <CostRow label="CIL / S106 (pence)" value={costs.cil_s106_pence} onChangeValue={(v) => updateCosts({ cil_s106_pence: v })} suffix={penceToPounds(costs.cil_s106_pence)} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Professional Fees</h4>
      <CostRow label="Architect (pence)" value={costs.architect_pence} onChangeValue={(v) => updateCosts({ architect_pence: v })} suffix={penceToPounds(costs.architect_pence)} />
      <CostRow label="Structural engineer (pence)" value={costs.structural_engineer_pence} onChangeValue={(v) => updateCosts({ structural_engineer_pence: v })} suffix={penceToPounds(costs.structural_engineer_pence)} />
      <CostRow label="M&E (pence)" value={costs.mande_pence} onChangeValue={(v) => updateCosts({ mande_pence: v })} suffix={penceToPounds(costs.mande_pence)} />
      <CostRow label="Planning consultant (pence)" value={costs.planning_consultant_pence} onChangeValue={(v) => updateCosts({ planning_consultant_pence: v })} suffix={penceToPounds(costs.planning_consultant_pence)} />
      <CostRow label="Building control (pence)" value={costs.building_control_pence} onChangeValue={(v) => updateCosts({ building_control_pence: v })} suffix={penceToPounds(costs.building_control_pence)} />
      <CostRow label="Other professional fees (pence)" value={costs.other_professional_fees_pence} onChangeValue={(v) => updateCosts({ other_professional_fees_pence: v })} suffix={penceToPounds(costs.other_professional_fees_pence)} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Construction</h4>
      <CostRow label="Cost per sq ft (pence)" value={costs.construction_cost_per_sqft_pence} onChangeValue={(v) => updateCosts({ construction_cost_per_sqft_pence: v })} suffix={penceToPounds(costs.construction_cost_per_sqft_pence) + '/sqft'} />
      <CostRow label="Total construction sq ft" value={costs.total_construction_sqft} onChangeValue={(v) => updateCosts({ total_construction_sqft: v })} />
      <CostRow label="Contingency (%)" value={costs.contingency_pct} onChangeValue={(v) => updateCosts({ contingency_pct: v })} />

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Building Regs Compliance</h4>
      <CostRow label="Fire safety (pence)" value={costs.fire_safety_pence} onChangeValue={(v) => updateCosts({ fire_safety_pence: v })} suffix={penceToPounds(costs.fire_safety_pence)} />
      <CostRow label="Sound insulation (pence)" value={costs.sound_insulation_pence} onChangeValue={(v) => updateCosts({ sound_insulation_pence: v })} suffix={penceToPounds(costs.sound_insulation_pence)} />
      <CostRow label="Part L compliance (pence)" value={costs.part_l_compliance_pence} onChangeValue={(v) => updateCosts({ part_l_compliance_pence: v })} suffix={penceToPounds(costs.part_l_compliance_pence)} />

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Construction cost</span>
          <span>{penceToPounds(metrics.total_construction_cost_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Professional fees</span>
          <span>{penceToPounds(metrics.total_professional_fees_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16, paddingTop: 8, borderTop: '1px solid #1e3a5f' }}>
          <span>Total Conversion Costs</span>
          <span>{penceToPounds(metrics.total_construction_cost_pence + metrics.total_professional_fees_pence)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator/AcquisitionPage.tsx frontend/src/components/calculator/UnitMixPage.tsx frontend/src/components/calculator/ConversionCostsPage.tsx
git commit -m "feat: add Acquisition, Unit Mix, and Conversion Costs calculator pages"
```

---

### Task 7: Finance, Cashflow & Appraisal Summary Pages

**Files:**
- Modify: `frontend/src/components/calculator/FinancePage.tsx`
- Modify: `frontend/src/components/calculator/CashflowPage.tsx`
- Modify: `frontend/src/components/calculator/AppraisalSummaryPage.tsx`

**Interfaces:**
- Consumes:
  - `frontend/src/lib/conversion-types.ts` — `CalculatorInputs`, `AppraisalMetrics`, `FinanceInputs`, `FundingSource`, `InterestType`, `CashflowResult`, `CashflowMonth`
- Produces: Three form/display pages. Finance is a form with selects and number inputs. Cashflow is a scrollable table. Appraisal Summary is a metrics dashboard.

- [ ] **Step 1: Implement `FinancePage.tsx`**

Replace `frontend/src/components/calculator/FinancePage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics, FundingSource, InterestType } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

export default function FinancePage({ inputs, onChange, metrics }: Props) {
  const fin = inputs.finance;

  const updateFinance = (partial: Partial<typeof fin>) => {
    onChange({ finance: { ...fin, ...partial } });
  };

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>4. Finance Structure</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Funding source</label>
          <select
            value={fin.funding_source}
            onChange={(e) => updateFinance({ funding_source: e.target.value as FundingSource })}
            style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
          >
            <option value="cash">Cash</option>
            <option value="bridging">Bridging Loan</option>
            <option value="development_finance">Development Finance</option>
          </select>
        </div>

        {fin.funding_source !== 'cash' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>LTV (%)</label>
              <input type="number" value={fin.ltv_pct} onChange={(e) => updateFinance({ ltv_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Interest rate (% p.a.)</label>
              <input type="number" step="0.1" value={fin.interest_rate_annual_pct} onChange={(e) => updateFinance({ interest_rate_annual_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Arrangement fee (%)</label>
              <input type="number" step="0.1" value={fin.arrangement_fee_pct} onChange={(e) => updateFinance({ arrangement_fee_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Exit fee (%)</label>
              <input type="number" step="0.1" value={fin.exit_fee_pct} onChange={(e) => updateFinance({ exit_fee_pct: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Loan term (months)</label>
              <input type="number" value={fin.loan_term_months} onChange={(e) => updateFinance({ loan_term_months: Number(e.target.value) })} style={{ width: 120, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ color: '#94a3b8', width: 220, fontSize: 14 }}>Interest type</label>
              <select
                value={fin.interest_type}
                onChange={(e) => updateFinance({ interest_type: e.target.value as InterestType })}
                style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
              >
                <option value="rolled_up">Rolled Up</option>
                <option value="serviced">Serviced</option>
              </select>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Loan amount</span>
          <span>{penceToPounds(metrics.loan_amount_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Equity required</span>
          <span>{penceToPounds(metrics.equity_required_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600, fontSize: 16, paddingTop: 8, borderTop: '1px solid #1e3a5f' }}>
          <span>Total Finance Cost</span>
          <span>{penceToPounds(metrics.total_finance_cost_pence)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `CashflowPage.tsx`**

Replace `frontend/src/components/calculator/CashflowPage.tsx`:

```tsx
import type { CalculatorInputs, CashflowResult } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  cashflow: CashflowResult;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

export default function CashflowPage({ cashflow }: Props) {
  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>5. Cashflow Projection</h3>

      <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Peak Funding</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 18 }}>{penceToPounds(cashflow.peak_funding_pence)}</div>
        </div>
        <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f', flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 4 }}>Total Interest</div>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 18 }}>{penceToPounds(cashflow.total_interest_pence)}</div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
              {['Month', 'Drawdown', 'Cum. Drawdown', 'Interest', 'Cum. Interest', 'Income', 'Net Cashflow', 'Cum. Cashflow'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', color: '#94a3b8', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cashflow.months.map((m) => (
              <tr key={m.month} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '6px 12px', color: '#e2e8f0', textAlign: 'right' }}>{m.label}</td>
                <td style={{ padding: '6px 12px', color: '#94a3b8', textAlign: 'right' }}>{penceToPounds(m.drawdown_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#94a3b8', textAlign: 'right' }}>{penceToPounds(m.cumulative_drawdown_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#f59e0b', textAlign: 'right' }}>{penceToPounds(m.interest_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#f59e0b', textAlign: 'right' }}>{penceToPounds(m.cumulative_interest_pence)}</td>
                <td style={{ padding: '6px 12px', color: '#22c55e', textAlign: 'right' }}>{penceToPounds(m.income_pence)}</td>
                <td style={{ padding: '6px 12px', color: m.net_cashflow_pence >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right' }}>{penceToPounds(m.net_cashflow_pence)}</td>
                <td style={{ padding: '6px 12px', color: m.cumulative_cashflow_pence >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right', fontWeight: 600 }}>{penceToPounds(m.cumulative_cashflow_pence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `AppraisalSummaryPage.tsx`**

Replace `frontend/src/components/calculator/AppraisalSummaryPage.tsx`:

```tsx
import type { CalculatorInputs, AppraisalMetrics } from '../../lib/conversion-types';

interface Props {
  metrics: AppraisalMetrics;
  inputs: CalculatorInputs;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: `1px solid ${highlight ? '#2563eb' : '#1e3a5f'}`, minWidth: 180 }}>
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ color: highlight ? '#60a5fa' : '#e2e8f0', fontWeight: 700, fontSize: 20 }}>{value}</div>
    </div>
  );
}

export default function AppraisalSummaryPage({ metrics }: Props) {
  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>6. Appraisal Summary</h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <MetricCard label="Total GDV" value={penceToPounds(metrics.total_gdv_pence)} highlight />
        <MetricCard label="Total Cost" value={penceToPounds(metrics.total_cost_pence)} />
        <MetricCard label="Profit" value={penceToPounds(metrics.profit_pence)} highlight />
        <MetricCard label="Profit on Cost" value={`${metrics.profit_on_cost_pct.toFixed(1)}%`} highlight />
        <MetricCard label="Profit on GDV" value={`${metrics.profit_on_gdv_pct.toFixed(1)}%`} />
        <MetricCard label="Return on Equity" value={`${metrics.return_on_equity_pct.toFixed(1)}%`} />
        <MetricCard label="IRR (Annual)" value={`${metrics.irr_annual.toFixed(1)}%`} highlight />
        <MetricCard label="IRR (Monthly)" value={`${metrics.irr_monthly.toFixed(2)}%`} />
        <MetricCard label="Residual Land Value" value={penceToPounds(metrics.rlv_pence)} />
      </div>

      <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Cost Breakdown</h4>
      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        {[
          { label: 'Acquisition (inc. SDLT)', value: metrics.total_acquisition_cost_pence },
          { label: 'SDLT', value: metrics.sdlt_pence },
          { label: 'Construction', value: metrics.total_construction_cost_pence },
          { label: 'Professional Fees', value: metrics.total_professional_fees_pence },
          { label: 'Finance Costs', value: metrics.total_finance_cost_pence },
        ].map((row) => (
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#94a3b8', fontSize: 14 }}>
            <span>{row.label}</span>
            <span>{penceToPounds(row.value)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 4px', borderTop: '1px solid #1e3a5f', color: '#e2e8f0', fontWeight: 700, fontSize: 16 }}>
          <span>Total Cost</span>
          <span>{penceToPounds(metrics.total_cost_pence)}</span>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Loan amount</span>
          <span>{penceToPounds(metrics.loan_amount_pence)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600 }}>
          <span>Equity required</span>
          <span>{penceToPounds(metrics.equity_required_pence)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator/FinancePage.tsx frontend/src/components/calculator/CashflowPage.tsx frontend/src/components/calculator/AppraisalSummaryPage.tsx
git commit -m "feat: add Finance, Cashflow, and Appraisal Summary calculator pages"
```

---

### Task 8: Scenarios & Exit Strategy Pages

**Files:**
- Modify: `frontend/src/components/calculator/ScenariosPage.tsx`
- Modify: `frontend/src/components/calculator/ExitStrategyPage.tsx`

**Interfaces:**
- Consumes:
  - `frontend/src/lib/conversion-types.ts` — `CalculatorInputs`, `ScenarioOverrides`, `AppraisalMetrics`, `ExitRoute`, `RetainedUnit`
  - `frontend/src/lib/conversion-calc-engine.ts` — `calculateAppraisal()`
- Produces: Scenarios page with 3-column comparison (base/upside/downside). Exit Strategy page with sell/retain/blended radio and rental yield inputs.

- [ ] **Step 1: Implement `ScenariosPage.tsx`**

Replace `frontend/src/components/calculator/ScenariosPage.tsx`:

```tsx
import { useMemo } from 'react';
import type { CalculatorInputs, ScenarioOverrides } from '../../lib/conversion-types';
import { calculateAppraisal } from '../../lib/conversion-calc-engine';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

type ScenarioKey = 'base' | 'upside' | 'downside';

function applyScenario(inputs: CalculatorInputs, overrides: ScenarioOverrides): CalculatorInputs {
  const gdvMultiplier = 1 + overrides.gdv_adjustment_pct / 100;
  const costMultiplier = 1 + overrides.construction_cost_adjustment_pct / 100;
  return {
    ...inputs,
    unit_mix: {
      units: inputs.unit_mix.units.map((u) => ({
        ...u,
        estimated_value_pence: Math.round(u.estimated_value_pence * gdvMultiplier),
      })),
    },
    conversion_costs: {
      ...inputs.conversion_costs,
      construction_cost_per_sqft_pence: Math.round(
        inputs.conversion_costs.construction_cost_per_sqft_pence * costMultiplier,
      ),
    },
    finance: {
      ...inputs.finance,
      loan_term_months: inputs.finance.loan_term_months + overrides.timeline_adjustment_months,
      interest_rate_annual_pct: inputs.finance.interest_rate_annual_pct + overrides.interest_rate_adjustment_pct,
    },
  };
}

export default function ScenariosPage({ inputs, onChange }: Props) {
  const scenarioKeys: ScenarioKey[] = ['base', 'upside', 'downside'];

  const scenarioMetrics = useMemo(
    () =>
      Object.fromEntries(
        scenarioKeys.map((key) => [key, calculateAppraisal(applyScenario(inputs, inputs.scenarios[key]))]),
      ) as Record<ScenarioKey, ReturnType<typeof calculateAppraisal>>,
    [inputs],
  );

  const updateScenario = (key: ScenarioKey, partial: Partial<ScenarioOverrides>) => {
    onChange({
      scenarios: {
        ...inputs.scenarios,
        [key]: { ...inputs.scenarios[key], ...partial },
      },
    });
  };

  const metricRows: { label: string; accessor: (m: ReturnType<typeof calculateAppraisal>) => string }[] = [
    { label: 'GDV', accessor: (m) => penceToPounds(m.total_gdv_pence) },
    { label: 'Total Cost', accessor: (m) => penceToPounds(m.total_cost_pence) },
    { label: 'Profit', accessor: (m) => penceToPounds(m.profit_pence) },
    { label: 'Profit on Cost', accessor: (m) => `${m.profit_on_cost_pct.toFixed(1)}%` },
    { label: 'Profit on GDV', accessor: (m) => `${m.profit_on_gdv_pct.toFixed(1)}%` },
    { label: 'IRR (Annual)', accessor: (m) => `${m.irr_annual.toFixed(1)}%` },
    { label: 'Return on Equity', accessor: (m) => `${m.return_on_equity_pct.toFixed(1)}%` },
  ];

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>7. Scenario Comparison</h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {scenarioKeys.map((key) => (
          <div key={key} style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
            <h4 style={{ color: '#e2e8f0', fontSize: 15, marginBottom: 12 }}>{inputs.scenarios[key].label}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                GDV adjustment (%)
                <input type="number" value={inputs.scenarios[key].gdv_adjustment_pct} onChange={(e) => updateScenario(key, { gdv_adjustment_pct: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                Construction cost adjustment (%)
                <input type="number" value={inputs.scenarios[key].construction_cost_adjustment_pct} onChange={(e) => updateScenario(key, { construction_cost_adjustment_pct: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                Timeline adjustment (months)
                <input type="number" value={inputs.scenarios[key].timeline_adjustment_months} onChange={(e) => updateScenario(key, { timeline_adjustment_months: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
              <label style={{ color: '#94a3b8', fontSize: 13 }}>
                Interest rate adjustment (%)
                <input type="number" step="0.1" value={inputs.scenarios[key].interest_rate_adjustment_pct} onChange={(e) => updateScenario(key, { interest_rate_adjustment_pct: Number(e.target.value) })} style={{ width: '100%', padding: '4px 8px', marginTop: 4, background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f' }}>
              <th style={{ padding: '8px 12px', color: '#94a3b8', textAlign: 'left' }}>Metric</th>
              {scenarioKeys.map((key) => (
                <th key={key} style={{ padding: '8px 12px', color: '#94a3b8', textAlign: 'right' }}>{inputs.scenarios[key].label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '8px 12px', color: '#e2e8f0' }}>{row.label}</td>
                {scenarioKeys.map((key) => (
                  <td key={key} style={{ padding: '8px 12px', color: '#e2e8f0', textAlign: 'right', fontWeight: key === 'base' ? 600 : 400 }}>{row.accessor(scenarioMetrics[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement `ExitStrategyPage.tsx`**

Replace `frontend/src/components/calculator/ExitStrategyPage.tsx`:

```tsx
import { useMemo, useCallback } from 'react';
import type { CalculatorInputs, AppraisalMetrics, ExitRoute, RetainedUnit } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
  metrics: AppraisalMetrics;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

export default function ExitStrategyPage({ inputs, onChange, metrics }: Props) {
  const exit = inputs.exit_strategy;
  const units = inputs.unit_mix.units;

  const updateExit = useCallback(
    (partial: Partial<typeof exit>) => {
      onChange({ exit_strategy: { ...exit, ...partial } });
    },
    [exit, onChange],
  );

  const updateRetained = useCallback(
    (unitId: string, rent: number) => {
      const existing = exit.retained_units.filter((r) => r.unit_id !== unitId);
      if (rent > 0) {
        existing.push({ unit_id: unitId, monthly_rent_pence: rent });
      }
      updateExit({ retained_units: existing });
    },
    [exit, updateExit],
  );

  const totalAnnualRent = useMemo(
    () => exit.retained_units.reduce((s, r) => s + r.monthly_rent_pence * 12, 0),
    [exit.retained_units],
  );

  const retainedCapitalValue = useMemo(
    () =>
      exit.retained_units.reduce((s, r) => {
        const unit = units.find((u) => u.id === r.unit_id);
        return s + (unit?.estimated_value_pence ?? 0);
      }, 0),
    [exit.retained_units, units],
  );

  const grossYield = retainedCapitalValue > 0 ? (totalAnnualRent / retainedCapitalValue) * 100 : 0;

  const sellingCosts = useMemo(() => {
    const soldUnitsValue = metrics.total_gdv_pence - retainedCapitalValue;
    const agentFee = Math.round((soldUnitsValue * exit.selling_agent_fee_pct) / 100);
    return agentFee + exit.selling_legal_fee_pence;
  }, [metrics, retainedCapitalValue, exit]);

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>8. Exit Strategy</h3>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        {(['sell_all', 'retain_all', 'blended'] as ExitRoute[]).map((route) => (
          <button
            key={route}
            onClick={() => updateExit({ route })}
            style={{
              padding: '10px 24px',
              background: exit.route === route ? '#1e3a5f' : '#0f172a',
              border: `1px solid ${exit.route === route ? '#2563eb' : '#1e3a5f'}`,
              borderRadius: 6,
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {route === 'sell_all' ? 'Sell All' : route === 'retain_all' ? 'Retain All (BTL)' : 'Blended'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: '#94a3b8', fontSize: 14 }}>Agent fee (%)</label>
          <input type="number" step="0.1" value={exit.selling_agent_fee_pct} onChange={(e) => updateExit({ selling_agent_fee_pct: Number(e.target.value) })} style={{ width: 100, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: '#94a3b8', fontSize: 14 }}>Legal fee (pence)</label>
          <input type="number" value={exit.selling_legal_fee_pence} onChange={(e) => updateExit({ selling_legal_fee_pence: Number(e.target.value) })} style={{ width: 140, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
        </div>
      </div>

      {(exit.route === 'retain_all' || exit.route === 'blended') && units.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Retained Units — Monthly Rent</h4>
          {units.map((unit, i) => {
            const retained = exit.retained_units.find((r) => r.unit_id === unit.id);
            return (
              <div key={unit.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ color: '#94a3b8', width: 140, fontSize: 14 }}>Unit {i + 1} ({unit.type})</span>
                <input
                  type="number"
                  value={retained?.monthly_rent_pence ?? 0}
                  onChange={(e) => updateRetained(unit.id, Number(e.target.value))}
                  style={{ width: 140, padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }}
                />
                <span style={{ color: '#64748b', fontSize: 13 }}>{penceToPounds(retained?.monthly_rent_pence ?? 0)}/month</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ padding: 16, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
          <span>Selling costs</span><span>{penceToPounds(sellingCosts)}</span>
        </div>
        {exit.retained_units.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: 8 }}>
              <span>Annual rental income</span><span>{penceToPounds(totalAnnualRent)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#e2e8f0', fontWeight: 600 }}>
              <span>Gross yield</span><span>{grossYield.toFixed(1)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/calculator/ScenariosPage.tsx frontend/src/components/calculator/ExitStrategyPage.tsx
git commit -m "feat: add Scenarios and Exit Strategy calculator pages"
```

---

### Task 9: Risk Register & Investor Summary Pages

**Files:**
- Modify: `frontend/src/components/calculator/RiskRegisterPage.tsx`
- Modify: `frontend/src/components/calculator/InvestorSummaryPage.tsx`

**Interfaces:**
- Consumes:
  - `frontend/src/lib/conversion-types.ts` — `CalculatorInputs`, `AppraisalMetrics`, `CashflowResult`, `RiskItem`, `Likelihood`, `Impact`
  - `frontend/src/types.ts` — `Project`
- Produces: Risk Register page with add/remove/edit rows and likelihood/impact scoring. Investor Summary page with one-page deal overview showing key metrics, unit mix, timeline, and risk summary.

- [ ] **Step 1: Implement `RiskRegisterPage.tsx`**

Replace `frontend/src/components/calculator/RiskRegisterPage.tsx`:

```tsx
import { useCallback } from 'react';
import type { CalculatorInputs, RiskItem, Likelihood, Impact } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  onChange: (partial: Partial<CalculatorInputs>) => void;
}

const LIKELIHOOD_OPTIONS: Likelihood[] = ['low', 'medium', 'high'];
const IMPACT_OPTIONS: Impact[] = ['low', 'medium', 'high'];

const SCORE_COLORS: Record<string, string> = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
};

export default function RiskRegisterPage({ inputs, onChange }: Props) {
  const risks = inputs.risks;

  const updateRisks = useCallback(
    (newRisks: RiskItem[]) => {
      onChange({ risks: newRisks });
    },
    [onChange],
  );

  const addRisk = useCallback(() => {
    updateRisks([
      ...risks,
      { id: crypto.randomUUID(), description: '', likelihood: 'medium', impact: 'medium', mitigation: '' },
    ]);
  }, [risks, updateRisks]);

  const removeRisk = useCallback(
    (id: string) => {
      updateRisks(risks.filter((r) => r.id !== id));
    },
    [risks, updateRisks],
  );

  const updateRisk = useCallback(
    (id: string, partial: Partial<RiskItem>) => {
      updateRisks(risks.map((r) => (r.id === id ? { ...r, ...partial } : r)));
    },
    [risks, updateRisks],
  );

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 20 }}>9. Risk Register</h3>

      {risks.map((risk, i) => (
        <div key={risk.id} style={{ padding: 16, marginBottom: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Risk {i + 1}</span>
            <button onClick={() => removeRisk(risk.id)} style={{ background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 13 }}>Remove</button>
          </div>
          <div style={{ marginBottom: 10 }}>
            <input type="text" placeholder="Risk description" value={risk.description} onChange={(e) => updateRisk(risk.id, { description: e.target.value })} style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Likelihood</label>
              <select value={risk.likelihood} onChange={(e) => updateRisk(risk.id, { likelihood: e.target.value as Likelihood })} style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: SCORE_COLORS[risk.likelihood], fontSize: 14 }}>
                {LIKELIHOOD_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 4 }}>Impact</label>
              <select value={risk.impact} onChange={(e) => updateRisk(risk.id, { impact: e.target.value as Impact })} style={{ padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: SCORE_COLORS[risk.impact], fontSize: 14 }}>
                {IMPACT_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <input type="text" placeholder="Mitigation strategy" value={risk.mitigation} onChange={(e) => updateRisk(risk.id, { mitigation: e.target.value })} style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', fontSize: 14 }} />
          </div>
        </div>
      ))}

      <button onClick={addRisk} style={{ padding: '8px 20px', background: '#1e3a5f', color: '#e2e8f0', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginTop: 8 }}>+ Add Risk</button>
    </div>
  );
}
```

- [ ] **Step 2: Implement `InvestorSummaryPage.tsx`**

Replace `frontend/src/components/calculator/InvestorSummaryPage.tsx`:

```tsx
import type { Project } from '../../types';
import type { CalculatorInputs, AppraisalMetrics, CashflowResult } from '../../lib/conversion-types';

interface Props {
  inputs: CalculatorInputs;
  metrics: AppraisalMetrics;
  cashflow: CashflowResult;
  project: Project;
}

function penceToPounds(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
}

export default function InvestorSummaryPage({ inputs, metrics, cashflow, project }: Props) {
  const highRisks = inputs.risks.filter((r) => r.impact === 'high');

  return (
    <div>
      <h3 style={{ color: '#e2e8f0', fontSize: 18, marginBottom: 4 }}>10. Investor Summary</h3>
      <p style={{ color: '#64748b', fontSize: 13, marginBottom: 24 }}>One-page deal overview for investors and JV partners</p>

      <div style={{ padding: 24, background: '#0f172a', borderRadius: 8, border: '1px solid #1e3a5f' }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 4 }}>{project.address_raw}</h2>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>
          {project.use_class.replace('_', ' ')} | {project.floor_area_sqft?.toLocaleString() ?? '—'} sq ft | {project.tenure}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Purchase Price', value: penceToPounds(inputs.acquisition.purchase_price_pence) },
            { label: 'GDV', value: penceToPounds(metrics.total_gdv_pence) },
            { label: 'Total Cost', value: penceToPounds(metrics.total_cost_pence) },
            { label: 'Profit', value: penceToPounds(metrics.profit_pence) },
          ].map((m) => (
            <div key={m.label}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{m.label}</div>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16 }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Profit on Cost', value: `${metrics.profit_on_cost_pct.toFixed(1)}%` },
            { label: 'Profit on GDV', value: `${metrics.profit_on_gdv_pct.toFixed(1)}%` },
            { label: 'IRR (Annual)', value: `${metrics.irr_annual.toFixed(1)}%` },
            { label: 'Return on Equity', value: `${metrics.return_on_equity_pct.toFixed(1)}%` },
          ].map((m) => (
            <div key={m.label}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>{m.label}</div>
              <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 16 }}>{m.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          <div>
            <h4 style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Unit Mix</h4>
            {inputs.unit_mix.units.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: 14 }}>No units defined</p>
            ) : (
              inputs.unit_mix.units.map((u, i) => (
                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#e2e8f0', fontSize: 14 }}>
                  <span>Unit {i + 1} — {u.type} ({u.floor_area_sqft} sqft)</span>
                  <span>{penceToPounds(u.estimated_value_pence)}</span>
                </div>
              ))
            )}
          </div>
          <div>
            <h4 style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Finance & Timeline</h4>
            <div style={{ color: '#e2e8f0', fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Funding</span><span>{inputs.finance.funding_source.replace('_', ' ')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Equity required</span><span>{penceToPounds(metrics.equity_required_pence)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Loan amount</span><span>{penceToPounds(metrics.loan_amount_pence)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Timeline</span><span>{inputs.finance.loan_term_months} months</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Peak funding</span><span>{penceToPounds(cashflow.peak_funding_pence)}</span>
              </div>
            </div>
          </div>
        </div>

        {highRisks.length > 0 && (
          <div>
            <h4 style={{ color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Key Risks</h4>
            {highRisks.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#e2e8f0', fontSize: 14 }}>
                <span style={{ color: '#ef4444' }}>{r.description}</span>
                <span style={{ color: '#94a3b8' }}>{r.mitigation}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 4: Run all frontend tests**

Run: `cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run`
Expected: All PASS (SDLT, calc engine, cashflow, and existing API tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calculator/RiskRegisterPage.tsx frontend/src/components/calculator/InvestorSummaryPage.tsx
git commit -m "feat: add Risk Register and Investor Summary calculator pages"
```

---

### Task 10: Integration Test — End-to-End Calculator Flow

**Files:**
- No new files — this task runs the dev server and manually tests the complete calculator flow

**Interfaces:**
- Consumes: all files from Tasks 1–9
- Produces: verified working calculator with all 10 pages, correct calculations, save/load from backend

- [ ] **Step 1: Start the backend and frontend dev servers**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser
docker compose up -d
cd frontend && npm run dev
```

- [ ] **Step 2: Test the golden path**

1. Navigate to the app at `http://localhost:5173`
2. Create a project via New Project tab (address, price in pence, use class = office, floor area)
3. Go to Pipeline tab, click the project card to select it
4. Go to Calculator tab — verify it loads with pre-filled acquisition price and floor area
5. Page 1 (Acquisition): verify SDLT calculates correctly, total acquisition cost updates
6. Page 2 (Unit Mix): add 3 units, verify GDV updates
7. Page 3 (Costs): adjust construction cost per sqft, verify total updates with contingency
8. Page 4 (Finance): switch between cash/bridging, verify loan amount and equity update
9. Page 5 (Cashflow): verify monthly table renders with correct drawdown and interest
10. Page 6 (Appraisal): verify all metrics display (profit on cost, IRR, RLV)
11. Page 7 (Scenarios): adjust downside GDV -10%, verify metrics change
12. Page 8 (Exit): switch to blended, set rent on one unit, verify yield calculates
13. Page 9 (Risk): add/remove a risk, verify it persists across page navigation
14. Page 10 (Investor): verify one-page summary shows all key data
15. Click "Save Appraisal" — verify it saves without error
16. Refresh the page, select the same project — verify calculator reloads saved inputs

- [ ] **Step 3: Run the full test suite**

```bash
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser\frontend && npx vitest run
cd C:\Users\srbuc\Documents\Github\Commercial-Resi-Analyser && python -m pytest tests/ -v
```
Expected: All PASS

- [ ] **Step 4: Final commit and push**

```bash
git add -A
git commit -m "feat: complete Plan 3 — conversion financial calculator with 10 pages"
git push origin feat/plan-3-conversion-calculator
```
