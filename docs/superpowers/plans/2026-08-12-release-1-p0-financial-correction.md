# Release 1 — P0 Financial Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two conflicting finance engines with one authoritative monthly debt/equity/cash-flow engine, correct all P0 lender-metric defects, enforce validation, make the backend the authority for persisted outputs, and remove unsafe report metrics — all pinned by hand-computed golden tests.

**Architecture:** A new pure-TypeScript model package `frontend/src/lib/model/` (types → schedule → ledger → metrics → validation → orchestrator) becomes the only calculation path; every UI page, scenario, and export consumes its result. A Python mirror `app/financial_model/` recalculates on save; both implementations must pass the same golden fixtures in `fixtures/financial-model/`. Legacy v1 snapshots migrate explicitly and are marked `legacy_unreconciled` — never silently converted.

**Tech Stack:** React 19 + TypeScript 5.9 + Vitest 4 (frontend, `cd frontend && npm test`); FastAPI + Pydantic v2 + SQLAlchemy 2 + pytest (backend, `pytest` from repo root); Alembic-style migration files in `migrations/`.

## Global Constraints

- **The normative document is `docs/financial-model/calculation-specification.md` (calc version `2.0.0`).** Where this plan and that spec disagree, the spec wins; flag the discrepancy.
- All money is **integer pence**; rounding is **half-up toward +∞** (`Math.round` in TS; `math.floor(x + 0.5)` in Python — never Python's `round()`).
- Percentages: inputs are floats where `70.0` = 70%; outputs displayed to 2 dp.
- Monthly rate = `annual_rate_pct / 100 / 12`. Month 0 = acquisition month. Draws at month start, interest on `opening + draws + capitalised fees`, receipts/repayments at month end.
- All model code must be **pure and deterministic**: no `Date.now()`, no `Math.random()`, no locale-dependent formatting inside `frontend/src/lib/model/` or `app/financial_model/`.
- `null` = unknown; `0` = known zero. Never default a missing lender-critical input; dependent metrics return `null`.
- No formula may exist outside `frontend/src/lib/model/` (TS) / `app/financial_model/` (Python). Cost helpers in `conversion-calc-engine.ts` (GDV, SDLT, acquisition, construction, professional fees) remain and are consumed *by* the model package; its loan/interest/profit logic is removed.
- Commit style: existing repo uses short lower-case messages (`report update`); use conventional short messages, one commit per task step block as directed.
- Run frontend tests: `cd frontend && npm test`. Run backend tests: `pytest` (repo root). Type check: `cd frontend && npx tsc --noEmit`. Build: `cd frontend && npm run build`. Lint: `cd frontend && npm run lint`.
- Do not modify `deal-spider.ts` scoring, eligibility code, pipeline, maps, or scraping code except where a task explicitly says so.

## File map (what exists → what changes)

**Create (frontend model package):**
- `frontend/src/lib/model/finance-types.ts` — v2 finance/equity/result types
- `frontend/src/lib/model/migrate.ts` — v1 snapshot → v2 inputs
- `frontend/src/lib/model/schedule.ts` — monthly uses & receipts (spend profiles, exit routes, selling costs)
- `frontend/src/lib/model/irr.ts` — Newton + bisection IRR, null on no solution
- `frontend/src/lib/model/monthly-engine.ts` — debt ledger, draw priority, equity flows
- `frontend/src/lib/model/metrics.ts` — all summary/lender metrics from the ledger
- `frontend/src/lib/model/validation.ts` — hard errors, warnings, reconciliation status
- `frontend/src/lib/model/index.ts` — `runAppraisal(inputs)` orchestrator
- matching `*.test.ts` files beside each
- `fixtures/financial-model/*.json` — golden fixtures (repo root, shared with Python)

**Create (backend):**
- `app/financial_model/{__init__,types,schedule,engine,metrics,validation,migrate,hashing}.py` + `tests/test_financial_model_*.py`
- `migrations/002_appraisal_governance.py`

**Modify:** `frontend/src/lib/conversion-types.ts`, `conversion-defaults.ts`, `apply-scenario.ts`, `conversion-calc-engine.ts` (strip loan logic), `deal-spider.ts` (VAT labelling only), `export-investment-memo.ts`, `export-pdf.ts`, `frontend/src/components/ConversionCalculator.tsx`, `components/calculator/{FinancePage,CashflowPage,AppraisalSummaryPage,ScenariosPage,ExitStrategyPage,InvestorSummaryPage}.tsx`, `components/ExportPage.tsx`, `frontend/src/lib/api.ts`, `frontend/src/types.ts`, `app/models.py`, `app/api/app.py`, `app/persistence/database.py`, `app/persistence/repositories.py`.

**Delete:** `frontend/src/lib/conversion-cashflow.ts` + its test (replaced by the model package).

---

### Task 1: v2 finance data model, defaults and v1→v2 migration

**Files:**
- Create: `frontend/src/lib/model/finance-types.ts`
- Create: `frontend/src/lib/model/migrate.ts`
- Create: `frontend/src/lib/model/migrate.test.ts`
- Modify: `frontend/src/lib/conversion-types.ts` (add `CalculatorInputsV2` re-export shim comment only — v1 types stay for migration)
- Modify: `frontend/src/lib/conversion-defaults.ts`

**Interfaces:**
- Consumes: v1 `CalculatorInputs`, `FinanceInputs` from `conversion-types.ts`; `defaultCalculatorInputs` from `conversion-defaults.ts`.
- Produces: `FacilityTerms`, `EquitySource`, `CalculatorInputsV2`, `ModelFlag`, `LedgerMonth`, `MonthlyModel`, `AppraisalResultV2` (types); `defaultFacilityTerms()`, `defaultCalculatorInputsV2(project?)` (defaults); `migrateInputs(snapshot, project?): CalculatorInputsV2` (accepts v1 or v2, always returns v2).

- [ ] **Step 1: Write `frontend/src/lib/model/finance-types.ts`** (types only — no test needed until behaviour exists):

```typescript
import type {
  AcquisitionInputs, UnitMixInputs, ConversionCostInputs, ExitStrategyInputs,
  RiskItem, ScenarioOverrides, DealSpiderInputs,
} from '../conversion-types';

export type FundingSource = 'cash' | 'bridging' | 'development_finance';
export type InterestType = 'rolled_up' | 'serviced';
export type ArrangementFeeBasis = 'committed_net_facility' | 'committed_gross_facility';
export type ExitFeeBasis = 'committed_gross_facility' | 'peak_debt' | 'redemption_balance';
export type EquityDrawRule = 'equity_first' | 'pari_passu' | 'fund_as_required';
export type EvidenceStatus = 'confirmed' | 'unconfirmed' | 'rejected';

export interface FacilityTerms {
  funding_source: FundingSource;
  /** Senior tranche drawn at acquisition. null = unknown / no separate tranche. */
  day_one_advance_pence: number | null;
  day_one_market_value_pence: number | null;
  /** Caps monthly development draws at this % of that month's eligible dev costs. */
  development_cost_advance_pct: number;
  committed_net_facility_pence: number | null;
  /** null → derived as net + interest_reserve. */
  committed_gross_facility_pence: number | null;
  annual_interest_rate_pct: number;
  interest_type: InterestType;
  arrangement_fee_pct: number;
  arrangement_fee_basis: ArrangementFeeBasis;
  exit_fee_pct: number;
  exit_fee_basis: ExitFeeBasis;
  broker_fee_pence: number;
  lender_legal_fee_pence: number;
  valuation_fee_pence: number;
  monitoring_surveyor_fee_pence: number;
  interest_reserve_pence: number | null;
  term_months: number;
  equity_draw_rule: EquityDrawRule;
  /** % of net sale receipts applied to senior debt. */
  sales_sweep_pct: number;
  /** Migrated v1 ltv_pct, display-only; never used in calculation. */
  legacy_leverage_pct: number | null;
  /** True until a user confirms migrated/unevidenced facility terms. */
  requires_confirmation: boolean;
}

export type EquityClassification =
  | 'cash' | 'land' | 'planning_uplift' | 'vendor_finance'
  | 'deferred_consideration' | 'other_subordinated';

export interface EquitySource {
  id: string;
  classification: EquityClassification;
  amount_pence: number;
  /** Earliest month the money is available (0 = acquisition month). */
  timing_month: number;
  /** 1 = repaid first among subordinated capital. */
  repayment_priority: number;
  evidence_status: EvidenceStatus;
  notes: string;
}

export interface CalculatorInputsV2 {
  inputs_version: 2;
  project_id: string | null;
  acquisition: AcquisitionInputs;
  unit_mix: UnitMixInputs;
  conversion_costs: ConversionCostInputs;
  finance: FacilityTerms;
  equity_sources: EquitySource[];
  exit_strategy: ExitStrategyInputs;
  risks: RiskItem[];
  scenarios: {
    base: ScenarioOverrides; upside: ScenarioOverrides;
    downside: ScenarioOverrides; severe: ScenarioOverrides;
  };
  deal_spider: DealSpiderInputs;
}

export type FlagCode =
  | 'facility_exceeded' | 'funding_gap' | 'interest_reserve_exhausted'
  | 'senior_outstanding_at_maturity' | 'additional_equity_required'
  | 'negative_profit' | 'requires_confirmation' | 'irr_unavailable'
  | 'unrealised_profit_basis' | 'exit_fee_not_charged';

export interface ModelFlag {
  code: FlagCode;
  severity: 'red' | 'amber' | 'info';
  month: number | null;
  amount_pence: number | null;
  message: string;
}

export interface MonthUses {
  acquisition_pence: number;
  construction_pence: number;
  professional_pence: number;
  statutory_pence: number;
  lender_ancillary_fees_pence: number;
}

export interface MonthReceipts {
  gross_sale_pence: number;
  agent_fee_pence: number;
  selling_legal_pence: number;
}

export interface Schedule {
  term_months: number;
  uses: MonthUses[];
  receipts: MonthReceipts[];
  totals: {
    acquisition_pence: number; construction_pence: number;
    professional_pence: number; statutory_pence: number;
    selling_costs_pence: number; gross_sales_pence: number;
    gdv_pence: number; retained_value_pence: number;
    cost_before_finance_ex_selling_pence: number;
  };
}

export interface LedgerMonth {
  month: number;
  uses_total_pence: number;
  opening_balance_pence: number;
  draw_pence: number;
  capitalised_fees_pence: number;
  interest_accrued_pence: number;
  interest_capitalised_pence: number;
  interest_serviced_pence: number;
  exit_fee_pence: number;
  repayment_pence: number;
  closing_balance_pence: number;
  undrawn_net_facility_pence: number | null;
  facility_headroom_pence: number | null;
  interest_reserve_remaining_pence: number | null;
  equity_contribution_pence: number;
  additional_equity_pence: number;
  funding_gap_pence: number;
  gross_receipts_pence: number;
  net_receipts_pence: number;
  distribution_pence: number;
}

export interface MonthlyModel {
  months: LedgerMonth[];
  totals: {
    interest_pence: number;
    arrangement_fee_pence: number;
    exit_fee_pence: number;
    ancillary_fees_pence: number;
    finance_costs_pence: number;
    draws_pence: number;
    capitalised_fees_pence: number;
    equity_contributed_pence: number;
    additional_equity_pence: number;
    funding_gap_pence: number;
    distributions_pence: number;
    repayments_pence: number;
  };
  peak_debt_pence: number;
  peak_debt_month: number | null;
  day_one_advance_pence: number;
  committed_net_facility_pence: number;
  committed_gross_facility_pence: number;
  senior_outstanding_at_maturity_pence: number;
  flags: ModelFlag[];
  /** Developer equity cash-flow vector, one entry per month (− out, + in). */
  equity_cashflows_pence: number[];
}

export interface AppraisalResultV2 {
  calc_version: string;
  gdv_pence: number;
  lender_gdv_pence: number | null;
  acquisition_cost_pence: number;
  sdlt_pence: number;
  construction_cost_pence: number;
  professional_fees_pence: number;
  statutory_costs_pence: number;
  selling_costs_pence: number;
  cost_before_finance_pence: number;
  finance_costs_pence: number;
  total_development_cost_pence: number;
  profit_pence: number;
  profit_is_unrealised: boolean;
  unrealised_value_pence: number;
  profit_on_cost_pct: number | null;
  profit_on_gdv_pct: number | null;
  equity_contributed_pence: number;
  equity_multiple: number | null;
  irr_monthly_pct: number | null;
  irr_annual_pct: number | null;
  rlv_pence: number;
  day_one_advance_pence: number;
  day_one_ltv_on_price_pct: number | null;
  day_one_ltv_on_value_pct: number | null;
  development_advances_pence: number;
  net_ltc_pct: number | null;
  gross_ltc_pct: number | null;
  ltgdv_developer_pct: number | null;
  ltgdv_lender_pct: number | null;
  peak_debt_pence: number;
  peak_debt_month: number | null;
  facility_headroom_pence: number | null;
  interest_reserve_remaining_pence: number | null;
  return_on_equity_pct: number | null;
}

export const CALC_VERSION = '2.0.0';
```

- [ ] **Step 2: Write the failing migration test** `frontend/src/lib/model/migrate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { migrateInputs } from './migrate';

const V1_SNAPSHOT = {
  project_id: 'p1',
  acquisition: {
    purchase_price_pence: 42_500_000, legal_fees_pence: 500_000,
    survey_cost_pence: 300_000, broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
  },
  unit_mix: { units: [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' }] },
  conversion_costs: {
    prior_approval_fee_per_dwelling_pence: 9_600, cil_s106_pence: 0, architect_pence: 1_500_000,
    structural_engineer_pence: 500_000, mande_pence: 500_000, planning_consultant_pence: 300_000,
    building_control_pence: 200_000, other_professional_fees_pence: 0,
    construction_cost_per_sqm_pence: 50_000, total_construction_sqm: 500,
    contingency_pct: 10, fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
  },
  finance: {
    funding_source: 'development_finance', ltv_pct: 70, interest_rate_annual_pct: 8,
    arrangement_fee_pct: 2, exit_fee_pct: 1, loan_term_months: 12, interest_type: 'rolled_up',
  },
  exit_strategy: { route: 'retain_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 150_000, retained_units: [] },
};

describe('migrateInputs', () => {
  it('passes a v2 document through unchanged', () => {
    const v2 = migrateInputs({ ...V1_SNAPSHOT, inputs_version: 2, finance: undefined } as never);
    // a malformed "v2" without finance still normalises — but a real v2 round-trips:
    const again = migrateInputs(v2 as unknown as Record<string, unknown>);
    expect(again).toEqual(v2);
  });

  it('migrates v1 ltv_pct to an unconfirmed proposed facility, never an approved metric', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    expect(v2.inputs_version).toBe(2);
    expect(v2.finance.legacy_leverage_pct).toBe(70);
    expect(v2.finance.requires_confirmation).toBe(true);
    expect(v2.finance.day_one_advance_pence).toBeNull();
    expect(v2.finance.equity_draw_rule).toBe('fund_as_required');
    // proposed net facility = round(v1 cost-before-finance × 70%)
    // v1 cost before finance for this snapshot:
    //   acquisition 42,500,000 + SDLT 1,075,000 + 500,000 + 300,000 + broker 425,000 = 44,800,000
    //   construction 50,000×500 = 25,000,000 + 10% cont 2,500,000 = 27,500,000 (+£0.01... compliance 0)
    //   professional+statutory 9,600 + 1,500,000+500,000+500,000+300,000+200,000 = 3,009,600
    //   total 75,309,600 → 70% = 52,716,670
    expect(v2.finance.committed_net_facility_pence).toBe(52_716_670);
    expect(v2.finance.term_months).toBe(12);
    expect(v2.finance.interest_type).toBe('rolled_up');
  });

  it('creates a single unconfirmed cash equity source for v1 snapshots', () => {
    const v2 = migrateInputs(V1_SNAPSHOT);
    expect(v2.equity_sources).toHaveLength(1);
    expect(v2.equity_sources[0].classification).toBe('cash');
    expect(v2.equity_sources[0].evidence_status).toBe('unconfirmed');
    // residual equity = 75,309,600 − 52,716,670
    expect(v2.equity_sources[0].amount_pence).toBe(22_592_930);
  });

  it('forces zero facility for v1 cash funding', () => {
    const v2 = migrateInputs({ ...V1_SNAPSHOT, finance: { ...V1_SNAPSHOT.finance, funding_source: 'cash' } });
    expect(v2.finance.committed_net_facility_pence).toBe(0);
    expect(v2.finance.legacy_leverage_pct).toBe(70);
    expect(v2.equity_sources[0].amount_pence).toBe(75_309_600);
  });
});
```

Note on the expected SDLT figure inside the comment: purchase £425,000 → 2% × £100,000 + 5% × £175,000 = £10,750 = 1,075,000p (matches the audit's York recalculation, `docs/reviews/2026-08-12-lender-readiness-audit.md:102`).

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: FAIL — cannot resolve `./migrate`.

- [ ] **Step 4: Implement `frontend/src/lib/model/migrate.ts`:**

```typescript
import type { CalculatorInputs, FinanceInputs } from '../conversion-types';
import type { CalculatorInputsV2, EquitySource, FacilityTerms } from './finance-types';
import {
  calculateTotalAcquisitionCost, calculateTotalConstructionCost, calculateTotalProfessionalFees,
} from '../conversion-calc-engine';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';

function isV2(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV2 {
  return snapshot.inputs_version === 2 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

function migrateFinanceV1(v1: FinanceInputs, costBeforeFinance: number): {
  finance: FacilityTerms; equity: EquitySource[];
} {
  const isCash = v1.funding_source === 'cash';
  const proposedFacility = isCash ? 0 : Math.round((costBeforeFinance * v1.ltv_pct) / 100);
  const finance: FacilityTerms = {
    funding_source: v1.funding_source,
    day_one_advance_pence: null,
    day_one_market_value_pence: null,
    development_cost_advance_pct: 100,
    committed_net_facility_pence: proposedFacility,
    committed_gross_facility_pence: null,
    annual_interest_rate_pct: v1.interest_rate_annual_pct,
    interest_type: v1.interest_type,
    arrangement_fee_pct: v1.arrangement_fee_pct,
    arrangement_fee_basis: 'committed_net_facility',
    exit_fee_pct: v1.exit_fee_pct,
    exit_fee_basis: 'committed_gross_facility',
    broker_fee_pence: 0,
    lender_legal_fee_pence: 0,
    valuation_fee_pence: 0,
    monitoring_surveyor_fee_pence: 0,
    interest_reserve_pence: null,
    term_months: v1.loan_term_months,
    equity_draw_rule: 'fund_as_required',
    sales_sweep_pct: 100,
    legacy_leverage_pct: v1.ltv_pct,
    requires_confirmation: true,
  };
  const equity: EquitySource[] = [{
    id: 'migrated-cash-equity',
    classification: 'cash',
    amount_pence: costBeforeFinance - proposedFacility,
    timing_month: 0,
    repayment_priority: 1,
    evidence_status: 'unconfirmed',
    notes: 'Migrated from v1 snapshot: residual of cost before finance less proposed facility. Confirm before lender use.',
  }];
  return { finance, equity };
}

/** Accepts a v1 or v2 snapshot (or partial) and returns a normalised v2 document. */
export function migrateInputs(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV2 {
  const defaults = defaultCalculatorInputsV2(project);
  if (isV2(snapshot)) {
    const saved = snapshot as unknown as Partial<CalculatorInputsV2>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 2,
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
    };
  }

  // v1 path: merge onto v1-shaped defaults first, then translate finance.
  const v1 = snapshot as Partial<CalculatorInputs>;
  const acquisition = { ...defaults.acquisition, ...(v1.acquisition ?? {}) };
  const conversion_costs = { ...defaults.conversion_costs, ...(v1.conversion_costs ?? {}) };
  const unit_mix = v1.unit_mix ?? defaults.unit_mix;
  const v1Finance: FinanceInputs = {
    funding_source: 'bridging', ltv_pct: 70, interest_rate_annual_pct: 8,
    arrangement_fee_pct: 2, exit_fee_pct: 1, loan_term_months: 12, interest_type: 'rolled_up',
    ...((v1.finance ?? {}) as Partial<FinanceInputs>),
  };
  const costBeforeFinance =
    calculateTotalAcquisitionCost(acquisition) +
    calculateTotalConstructionCost(conversion_costs) +
    calculateTotalProfessionalFees(conversion_costs, unit_mix.units.length);
  const { finance, equity } = migrateFinanceV1(v1Finance, costBeforeFinance);

  return {
    ...defaults,
    inputs_version: 2,
    project_id: (v1.project_id as string | null) ?? defaults.project_id,
    acquisition,
    unit_mix,
    conversion_costs,
    finance,
    equity_sources: equity,
    exit_strategy: { ...defaults.exit_strategy, ...(v1.exit_strategy ?? {}) },
    risks: v1.risks ?? defaults.risks,
    scenarios: {
      base: { ...defaults.scenarios.base, ...(v1.scenarios?.base ?? {}) },
      upside: { ...defaults.scenarios.upside, ...(v1.scenarios?.upside ?? {}) },
      downside: { ...defaults.scenarios.downside, ...(v1.scenarios?.downside ?? {}) },
      severe: { ...defaults.scenarios.severe, ...(v1.scenarios?.severe ?? {}) },
    },
    deal_spider: {
      ...defaults.deal_spider,
      ...(v1.deal_spider ?? {}),
      weights: { ...defaults.deal_spider.weights, ...(v1.deal_spider?.weights ?? {}) },
    },
  };
}
```

- [ ] **Step 5: Add v2 defaults to `frontend/src/lib/conversion-defaults.ts`** (append after `defaultCalculatorInputs`; do not remove the v1 exports — migration still uses them):

```typescript
import type { CalculatorInputsV2, EquitySource, FacilityTerms } from './model/finance-types';

export const DEFAULT_FACILITY_TERMS: FacilityTerms = {
  funding_source: 'development_finance',
  day_one_advance_pence: null,
  day_one_market_value_pence: null,
  development_cost_advance_pct: 100,
  committed_net_facility_pence: null,
  committed_gross_facility_pence: null,
  annual_interest_rate_pct: 8.0,
  interest_type: 'rolled_up',
  arrangement_fee_pct: 2.0,
  arrangement_fee_basis: 'committed_net_facility',
  exit_fee_pct: 1.0,
  exit_fee_basis: 'committed_gross_facility',
  broker_fee_pence: 0,
  lender_legal_fee_pence: 0,
  valuation_fee_pence: 0,
  monitoring_surveyor_fee_pence: 0,
  interest_reserve_pence: null,
  term_months: 12,
  equity_draw_rule: 'equity_first',
  sales_sweep_pct: 100,
  legacy_leverage_pct: null,
  requires_confirmation: false,
};

export function defaultEquitySources(): EquitySource[] {
  return [{
    id: crypto.randomUUID(),
    classification: 'cash',
    amount_pence: 0,
    timing_month: 0,
    repayment_priority: 1,
    evidence_status: 'unconfirmed',
    notes: '',
  }];
}

export function defaultCalculatorInputsV2(project?: {
  id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null;
}): CalculatorInputsV2 {
  const v1 = defaultCalculatorInputs(project);
  return {
    inputs_version: 2,
    project_id: v1.project_id,
    acquisition: v1.acquisition,
    unit_mix: v1.unit_mix,
    conversion_costs: v1.conversion_costs,
    finance: { ...DEFAULT_FACILITY_TERMS },
    equity_sources: defaultEquitySources(),
    exit_strategy: v1.exit_strategy,
    risks: v1.risks,
    scenarios: v1.scenarios,
    deal_spider: v1.deal_spider,
  };
}
```

(The import at the top of the file joins the existing import block; keep `mergeCalculatorInputs` untouched for now — it is deleted in Task 8 when the last caller switches to `migrateInputs`.)

- [ ] **Step 6: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/model/migrate.test.ts`
Expected: PASS (4 tests). Also run `npx tsc --noEmit` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/model/finance-types.ts frontend/src/lib/model/migrate.ts frontend/src/lib/model/migrate.test.ts frontend/src/lib/conversion-defaults.ts
git commit -m "feat(model): v2 finance data model and v1 snapshot migration"
```

---

### Task 2: Monthly schedule builder (uses, receipts, exit routes, selling costs)

**Files:**
- Create: `frontend/src/lib/model/schedule.ts`
- Create: `frontend/src/lib/model/schedule.test.ts`

**Interfaces:**
- Consumes: `CalculatorInputsV2`, `Schedule`, `MonthUses`, `MonthReceipts` from `./finance-types`; cost helpers from `../conversion-calc-engine` (`calculateTotalAcquisitionCost`, `calculateGdv`); `calculateCommercialSdlt` from `../commercial-sdlt`.
- Produces: `buildSchedule(inputs: CalculatorInputsV2): Schedule`; `spreadStraightLine(total: number, months: number): number[]`.

- [ ] **Step 1: Write the failing tests** `frontend/src/lib/model/schedule.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSchedule, spreadStraightLine } from './schedule';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import type { CalculatorInputsV2 } from './finance-types';

function baseInputs(): CalculatorInputsV2 {
  const inputs = defaultCalculatorInputsV2();
  inputs.acquisition = {
    purchase_price_pence: 40_000_000, legal_fees_pence: 500_000, survey_cost_pence: 300_000,
    broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
  };
  inputs.unit_mix = {
    units: [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    })),
  };
  inputs.conversion_costs = {
    ...inputs.conversion_costs,
    construction_cost_per_sqm_pence: 100_000, total_construction_sqm: 400, contingency_pct: 10,
    fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
    prior_approval_fee_per_dwelling_pence: 9_600, cil_s106_pence: 0,
    architect_pence: 1_500_000, structural_engineer_pence: 500_000, mande_pence: 500_000,
    planning_consultant_pence: 300_000, building_control_pence: 200_000, other_professional_fees_pence: 0,
  };
  inputs.finance.term_months = 12;
  inputs.exit_strategy = {
    route: 'sell_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 400_000, retained_units: [],
  };
  return inputs;
}

describe('spreadStraightLine', () => {
  it('sums exactly to the total (final month absorbs residue)', () => {
    const spread = spreadStraightLine(10_000_001, 3);
    expect(spread).toHaveLength(3);
    expect(spread.reduce((a, b) => a + b, 0)).toBe(10_000_001);
    expect(spread[0]).toBe(3_333_334); // round(10,000,001/3) half-up
    expect(spread[2]).toBe(10_000_001 - 2 * 3_333_334);
  });
});

describe('buildSchedule', () => {
  it('places acquisition, prior approval and ancillary totals in month 0', () => {
    const s = buildSchedule(baseInputs());
    // acquisition = 40,000,000 + SDLT 950,000 + 500,000 + 300,000 + broker 400,000 = 42,150,000
    expect(s.uses[0].acquisition_pence).toBe(42_150_000);
    expect(s.uses[0].statutory_pence).toBe(4 * 9_600); // prior approval month 0
  });

  it('spreads construction over months 1..term-2 and sums exactly', () => {
    const s = buildSchedule(baseInputs());
    const constructionByMonth = s.uses.map((u) => u.construction_pence);
    expect(constructionByMonth[0]).toBe(0);
    expect(constructionByMonth[11]).toBe(0);
    // 400 sqm × 100,000 = 40,000,000 base + 10% = 44,000,000 over months 1..10
    expect(constructionByMonth.reduce((a, b) => a + b, 0)).toBe(44_000_000);
    expect(constructionByMonth[1]).toBe(4_400_000);
  });

  it('books all sale receipts net-of-fee data in the final month for sell_all', () => {
    const s = buildSchedule(baseInputs());
    expect(s.receipts[11].gross_sale_pence).toBe(120_000_000);
    expect(s.receipts[11].agent_fee_pence).toBe(1_800_000);
    expect(s.receipts[11].selling_legal_pence).toBe(400_000);
    expect(s.totals.selling_costs_pence).toBe(2_200_000);
  });

  it('books zero receipts and zero selling costs for retain_all', () => {
    const inputs = baseInputs();
    inputs.exit_strategy.route = 'retain_all';
    const s = buildSchedule(inputs);
    expect(s.receipts.every((r) => r.gross_sale_pence === 0)).toBe(true);
    expect(s.totals.selling_costs_pence).toBe(0);
    expect(s.totals.retained_value_pence).toBe(120_000_000);
    expect(s.totals.gdv_pence).toBe(120_000_000);
  });

  it('splits blended: sold units get receipts, retained units do not', () => {
    const inputs = baseInputs();
    inputs.exit_strategy.route = 'blended';
    inputs.exit_strategy.retained_units = [{ unit_id: 'u1', monthly_rent_pence: 100_000 }];
    const s = buildSchedule(inputs);
    expect(s.receipts[11].gross_sale_pence).toBe(90_000_000);
    expect(s.totals.retained_value_pence).toBe(30_000_000);
    // agent fee on sold only: 1.5% × 90,000,000
    expect(s.receipts[11].agent_fee_pence).toBe(1_350_000);
  });

  it('handles term_months = 1 with everything in month 0', () => {
    const inputs = baseInputs();
    inputs.finance.term_months = 1;
    const s = buildSchedule(inputs);
    expect(s.uses).toHaveLength(1);
    expect(s.receipts[0].gross_sale_pence).toBe(120_000_000);
    const totalUses = s.uses[0].acquisition_pence + s.uses[0].construction_pence
      + s.uses[0].professional_pence + s.uses[0].statutory_pence;
    expect(totalUses).toBe(s.totals.acquisition_pence + s.totals.construction_pence
      + s.totals.professional_pence + s.totals.statutory_pence);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/schedule.test.ts`
Expected: FAIL — cannot resolve `./schedule`.

- [ ] **Step 3: Implement `frontend/src/lib/model/schedule.ts`:**

```typescript
import type { CalculatorInputsV2, MonthReceipts, MonthUses, Schedule } from './finance-types';
import {
  calculateGdv, calculateTotalAcquisitionCost, calculateTotalConstructionCost,
} from '../conversion-calc-engine';

/** Straight-line spread in integer pence; the final month absorbs the rounding residue. */
export function spreadStraightLine(total: number, months: number): number[] {
  if (months <= 0) return [];
  const per = Math.round(total / months);
  const out: number[] = new Array(months).fill(per);
  out[months - 1] = total - per * (months - 1);
  return out;
}

function emptyUses(): MonthUses {
  return {
    acquisition_pence: 0, construction_pence: 0, professional_pence: 0,
    statutory_pence: 0, lender_ancillary_fees_pence: 0,
  };
}

function emptyReceipts(): MonthReceipts {
  return { gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0 };
}

export function buildSchedule(inputs: CalculatorInputsV2): Schedule {
  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  const cc = inputs.conversion_costs;
  const units = inputs.unit_mix.units;

  const acquisitionTotal = calculateTotalAcquisitionCost(inputs.acquisition);
  const constructionTotal = calculateTotalConstructionCost(cc);
  // Reclassification per spec §3.5/§3.6: professional excludes statutory items.
  const professionalTotal =
    cc.architect_pence + cc.structural_engineer_pence + cc.mande_pence +
    cc.planning_consultant_pence + cc.other_professional_fees_pence;
  const priorApproval = cc.prior_approval_fee_per_dwelling_pence * Math.max(1, units.length);
  const statutorySpreadTotal = cc.cil_s106_pence + cc.building_control_pence;
  const statutoryTotal = priorApproval + statutorySpreadTotal;

  const uses: MonthUses[] = Array.from({ length: term }, emptyUses);
  const receipts: MonthReceipts[] = Array.from({ length: term }, emptyReceipts);

  uses[0].acquisition_pence = acquisitionTotal;
  uses[0].statutory_pence += priorApproval;

  if (term === 1) {
    uses[0].construction_pence = constructionTotal;
    uses[0].professional_pence = professionalTotal;
    uses[0].statutory_pence += statutorySpreadTotal;
  } else {
    const constructionWindow = Math.max(1, term - 2); // months 1..constructionWindow
    const professionalWindow = Math.max(1, Math.ceil(constructionWindow / 2));
    const constructionSpread = spreadStraightLine(constructionTotal, constructionWindow);
    const professionalSpread = spreadStraightLine(professionalTotal, professionalWindow);
    const statutorySpread = spreadStraightLine(statutorySpreadTotal, professionalWindow);
    constructionSpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].construction_pence += v; });
    professionalSpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].professional_pence += v; });
    statutorySpread.forEach((v, i) => { uses[Math.min(i + 1, term - 1)].statutory_pence += v; });
  }

  // Exit: which units sell?
  const route = inputs.exit_strategy.route;
  const retainedIds = new Set(inputs.exit_strategy.retained_units.map((r) => r.unit_id));
  const soldUnits =
    route === 'retain_all' ? [] :
    route === 'sell_all' ? units :
    units.filter((u) => !retainedIds.has(u.id));
  const grossSales = soldUnits.reduce((s, u) => s + u.estimated_value_pence, 0);
  const gdv = calculateGdv(units);
  const retainedValue = gdv - grossSales;

  const saleMonth = term - 1;
  const agentFee = Math.round((grossSales * inputs.exit_strategy.selling_agent_fee_pct) / 100);
  const sellingLegal = soldUnits.length > 0 ? inputs.exit_strategy.selling_legal_fee_pence : 0;
  if (grossSales > 0) {
    receipts[saleMonth] = {
      gross_sale_pence: grossSales,
      agent_fee_pence: agentFee,
      selling_legal_pence: sellingLegal,
    };
  }

  const sellingCosts = grossSales > 0 ? agentFee + sellingLegal : 0;
  return {
    term_months: term,
    uses,
    receipts,
    totals: {
      acquisition_pence: acquisitionTotal,
      construction_pence: constructionTotal,
      professional_pence: professionalTotal,
      statutory_pence: statutoryTotal,
      selling_costs_pence: sellingCosts,
      gross_sales_pence: grossSales,
      gdv_pence: gdv,
      retained_value_pence: retainedValue,
      cost_before_finance_ex_selling_pence:
        acquisitionTotal + constructionTotal + professionalTotal + statutoryTotal,
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/model/schedule.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/schedule.ts frontend/src/lib/model/schedule.test.ts
git commit -m "feat(model): monthly uses/receipts schedule with exit routes and exact spreads"
```

---

### Task 3: IRR solver with honest failure modes

**Files:**
- Create: `frontend/src/lib/model/irr.ts`
- Create: `frontend/src/lib/model/irr.test.ts`

**Interfaces:**
- Consumes: nothing internal.
- Produces: `solveIrr(cashflows: number[]): number | null` — periodic (monthly) rate as a decimal (0.01 = 1%), `null` when no solution exists; `npvAt(cashflows: number[], rate: number): number`.

- [ ] **Step 1: Write the failing tests** `frontend/src/lib/model/irr.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { solveIrr, npvAt } from './irr';

describe('solveIrr', () => {
  it('solves a simple two-flow case exactly', () => {
    // -100 now, +110 in one period → 10%
    const irr = solveIrr([-100, 110]);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(0.10, 8);
  });

  it('solves multi-contribution flows and NPV at the root is ~0', () => {
    const flows = [-10_000_000, -15_000_000, -5_000_000, 40_490_776];
    const irr = solveIrr(flows);
    expect(irr).not.toBeNull();
    expect(Math.abs(npvAt(flows, irr!))).toBeLessThan(1); // < 1 penny
  });

  it('returns null when all flows are negative (retain_all, no distributions)', () => {
    expect(solveIrr([-100, -50, -25])).toBeNull();
  });

  it('returns null when all flows are positive', () => {
    expect(solveIrr([100, 50])).toBeNull();
  });

  it('returns null for empty or single-entry vectors', () => {
    expect(solveIrr([])).toBeNull();
    expect(solveIrr([-100])).toBeNull();
  });

  it('falls back to bisection when Newton diverges and still finds a root', () => {
    // Steep, ill-conditioned flow that defeats a naive Newton start
    const flows = [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1_000_000];
    const irr = solveIrr(flows);
    expect(irr).not.toBeNull();
    expect(Math.abs(npvAt(flows, irr!))).toBeLessThan(1e-6);
  });

  it('handles a deeply negative but valid IRR', () => {
    const irr = solveIrr([-100, 10]); // −90% per period
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(-0.9, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/irr.test.ts`
Expected: FAIL — cannot resolve `./irr`.

- [ ] **Step 3: Implement `frontend/src/lib/model/irr.ts`:**

```typescript
export function npvAt(cashflows: number[], rate: number): number {
  let npv = 0;
  for (let t = 0; t < cashflows.length; t++) {
    npv += cashflows[t] / Math.pow(1 + rate, t);
  }
  return npv;
}

const LOWER = -0.99;
const UPPER = 10; // 1000% per period — beyond any sane monthly equity return

/**
 * Periodic IRR of a cash-flow vector (index = period). Returns a decimal rate
 * (0.01 = 1% per period) or null when no root exists in (−99%, 1000%].
 * Newton–Raphson first; bisection fallback. Spec §3.17.
 */
export function solveIrr(cashflows: number[]): number | null {
  if (cashflows.length < 2) return null;
  const hasNegative = cashflows.some((c) => c < 0);
  const hasPositive = cashflows.some((c) => c > 0);
  if (!hasNegative || !hasPositive) return null;

  // Newton–Raphson
  let guess = 0.01;
  for (let i = 0; i < 1000; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const factor = Math.pow(1 + guess, t);
      npv += cashflows[t] / factor;
      if (t > 0) dnpv -= (t * cashflows[t]) / Math.pow(1 + guess, t + 1);
    }
    if (Math.abs(dnpv) < 1e-15) break;
    const next = guess - npv / dnpv;
    if (!Number.isFinite(next) || next <= LOWER || next > UPPER) break;
    if (Math.abs(next - guess) < 1e-9) {
      return Math.abs(npvAt(cashflows, next)) < 1e-3 ? next : null;
    }
    guess = next;
  }

  // Bisection fallback over (LOWER, UPPER]
  let lo = LOWER + 1e-9;
  let hi = UPPER;
  let fLo = npvAt(cashflows, lo);
  const fHi = npvAt(cashflows, hi);
  if (fLo * fHi > 0) return null; // no sign change — no root in bracket
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(cashflows, mid);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (fLo * fMid <= 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/model/irr.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/irr.ts frontend/src/lib/model/irr.test.ts
git commit -m "feat(model): IRR solver with bisection fallback and null on no solution"
```

---

### Task 4: Monthly debt ledger engine (the core)

**Files:**
- Create: `frontend/src/lib/model/monthly-engine.ts`
- Create: `frontend/src/lib/model/monthly-engine.test.ts`

**Interfaces:**
- Consumes: `Schedule`, `FacilityTerms`, `EquitySource`, `LedgerMonth`, `MonthlyModel`, `ModelFlag` from `./finance-types`.
- Produces: `runLedger(schedule: Schedule, finance: FacilityTerms, equitySources: EquitySource[]): MonthlyModel`.

All four test fixtures below are **hand-computed** (see spec §8 for Fixture B's derivation). Shared terms unless stated: net facility £500,000 (50,000,000p), gross £550,000, day-one advance £300,000, 12% p.a. (1%/month), arrangement 2% of net = £10,000 capitalised month 0, exit fee 1% of committed gross = £5,500 at redemption, equity-first, 100% sweep, term 4 months. Uses: m0 acquisition 40,000,000p; m1 construction 15,000,000p; m2 construction 10,000,000p. Receipts (where selling): m3 gross 80,000,000p, agent fee 1,600,000p.

- [ ] **Step 1: Write the failing tests** `frontend/src/lib/model/monthly-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runLedger } from './monthly-engine';
import { DEFAULT_FACILITY_TERMS } from '../conversion-defaults';
import type { EquitySource, FacilityTerms, MonthReceipts, MonthUses, Schedule } from './finance-types';

function uses(partial: Partial<MonthUses>): MonthUses {
  return {
    acquisition_pence: 0, construction_pence: 0, professional_pence: 0,
    statutory_pence: 0, lender_ancillary_fees_pence: 0, ...partial,
  };
}
function receipts(partial: Partial<MonthReceipts>): MonthReceipts {
  return { gross_sale_pence: 0, agent_fee_pence: 0, selling_legal_pence: 0, ...partial };
}
function mkSchedule(u: MonthUses[], r: MonthReceipts[]): Schedule {
  const sum = (f: (x: MonthUses) => number) => u.reduce((a, x) => a + f(x), 0);
  const grossSales = r.reduce((a, x) => a + x.gross_sale_pence, 0);
  const selling = r.reduce((a, x) => a + x.agent_fee_pence + x.selling_legal_pence, 0);
  return {
    term_months: u.length, uses: u, receipts: r,
    totals: {
      acquisition_pence: sum((x) => x.acquisition_pence),
      construction_pence: sum((x) => x.construction_pence),
      professional_pence: sum((x) => x.professional_pence),
      statutory_pence: sum((x) => x.statutory_pence),
      selling_costs_pence: selling, gross_sales_pence: grossSales,
      gdv_pence: grossSales, retained_value_pence: 0,
      cost_before_finance_ex_selling_pence:
        sum((x) => x.acquisition_pence + x.construction_pence + x.professional_pence + x.statutory_pence),
    },
  };
}

const TERMS: FacilityTerms = {
  ...DEFAULT_FACILITY_TERMS,
  funding_source: 'development_finance',
  day_one_advance_pence: 30_000_000,
  committed_net_facility_pence: 50_000_000,
  committed_gross_facility_pence: 55_000_000,
  annual_interest_rate_pct: 12,
  interest_type: 'rolled_up',
  arrangement_fee_pct: 2, arrangement_fee_basis: 'committed_net_facility',
  exit_fee_pct: 1, exit_fee_basis: 'committed_gross_facility',
  term_months: 4, equity_draw_rule: 'equity_first', sales_sweep_pct: 100,
};

function equity(amount: number): EquitySource[] {
  return [{
    id: 'e1', classification: 'cash', amount_pence: amount, timing_month: 0,
    repayment_priority: 1, evidence_status: 'confirmed', notes: '',
  }];
}

const USES = [
  uses({ acquisition_pence: 40_000_000 }),
  uses({ construction_pence: 15_000_000 }),
  uses({ construction_pence: 10_000_000 }),
  uses({}),
];
const SALE = [
  receipts({}), receipts({}), receipts({}),
  receipts({ gross_sale_pence: 80_000_000, agent_fee_pence: 1_600_000 }),
];
const NO_SALE = [receipts({}), receipts({}), receipts({}), receipts({})];

describe('Fixture B — rolled-up interest (spec §8)', () => {
  const model = () => runLedger(mkSchedule(USES, SALE), TERMS, equity(30_000_000));

  it('reproduces the hand-computed ledger to the penny', () => {
    const m = model();
    expect(m.months[0].draw_pence).toBe(30_000_000);
    expect(m.months[0].capitalised_fees_pence).toBe(1_000_000);
    expect(m.months[0].interest_accrued_pence).toBe(310_000);
    expect(m.months[0].closing_balance_pence).toBe(31_310_000);
    expect(m.months[0].equity_contribution_pence).toBe(10_000_000);
    expect(m.months[1].interest_accrued_pence).toBe(313_100);
    expect(m.months[1].closing_balance_pence).toBe(31_623_100);
    expect(m.months[2].draw_pence).toBe(5_000_000);
    expect(m.months[2].equity_contribution_pence).toBe(5_000_000);
    expect(m.months[2].interest_accrued_pence).toBe(366_231);
    expect(m.months[2].closing_balance_pence).toBe(36_989_331);
    expect(m.months[3].interest_accrued_pence).toBe(369_893);
    expect(m.months[3].exit_fee_pence).toBe(550_000);
    expect(m.months[3].repayment_pence).toBe(37_359_224);
    expect(m.months[3].closing_balance_pence).toBe(0);
    expect(m.months[3].distribution_pence).toBe(40_490_776);
  });

  it('reports peak debt, totals and equity flows correctly', () => {
    const m = model();
    expect(m.peak_debt_pence).toBe(37_359_224);
    expect(m.peak_debt_month).toBe(3);
    expect(m.day_one_advance_pence).toBe(30_000_000);
    expect(m.totals.interest_pence).toBe(1_359_224);
    expect(m.totals.finance_costs_pence).toBe(1_359_224 + 1_000_000 + 550_000);
    expect(m.equity_cashflows_pence).toEqual([-10_000_000, -15_000_000, -5_000_000, 40_490_776]);
    expect(m.senior_outstanding_at_maturity_pence).toBe(0);
  });

  it('debt roll-forward reconciles every month', () => {
    for (const mo of model().months) {
      expect(mo.closing_balance_pence).toBe(
        mo.opening_balance_pence + mo.draw_pence + mo.capitalised_fees_pence
        + mo.interest_capitalised_pence - mo.repayment_pence,
      );
      expect(mo.closing_balance_pence).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Fixture C — serviced interest differs from rolled-up', () => {
  const terms: FacilityTerms = { ...TERMS, interest_type: 'serviced' };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(32_000_000));

  it('keeps the balance flat and funds interest from equity', () => {
    const m = model();
    expect(m.months[0].interest_serviced_pence).toBe(310_000);
    expect(m.months[0].interest_capitalised_pence).toBe(0);
    expect(m.months[0].closing_balance_pence).toBe(31_000_000);
    expect(m.months[0].equity_contribution_pence).toBe(10_310_000);
    expect(m.months[1].closing_balance_pence).toBe(31_000_000);
    // m2: committed equity remaining 6,380,000 → costs part-funded, draw 3,620,000
    expect(m.months[2].equity_contribution_pence).toBe(6_380_000);
    expect(m.months[2].draw_pence).toBe(3_620_000);
    expect(m.months[2].interest_serviced_pence).toBe(346_200);
    expect(m.months[2].additional_equity_pence).toBe(346_200);
    expect(m.months[3].additional_equity_pence).toBe(346_200);
  });

  it('produces materially different peak debt and interest from rolled-up', () => {
    const m = model();
    expect(m.peak_debt_pence).toBe(34_620_000);
    expect(m.totals.interest_pence).toBe(1_312_400);
    expect(m.totals.additional_equity_pence).toBe(692_400);
    expect(m.flags.some((f) => f.code === 'additional_equity_required')).toBe(true);
    expect(m.months[3].distribution_pence).toBe(43_230_000);
    // profit identity: Σ equity flows = 80,000,000 − TDC(69,462,400) = 10,537,600
    expect(m.equity_cashflows_pence.reduce((a, b) => a + b, 0)).toBe(10_537_600);
  });
});

describe('Fixture D — retain_all books no receipts and flags outstanding debt', () => {
  const model = () => runLedger(mkSchedule(USES, NO_SALE), TERMS, equity(30_000_000));

  it('leaves the senior balance outstanding at maturity with no distributions', () => {
    const m = model();
    expect(m.months[3].repayment_pence).toBe(0);
    expect(m.months[3].closing_balance_pence).toBe(37_359_224);
    expect(m.senior_outstanding_at_maturity_pence).toBe(37_359_224);
    expect(m.totals.exit_fee_pence).toBe(0);
    expect(m.totals.distributions_pence).toBe(0);
    expect(m.flags.some((f) => f.code === 'senior_outstanding_at_maturity' && f.severity === 'red')).toBe(true);
    expect(m.equity_cashflows_pence).toEqual([-10_000_000, -15_000_000, -5_000_000, 0]);
  });
});

describe('Fixture E — funding gap: overruns never create facility', () => {
  const terms: FacilityTerms = { ...TERMS, committed_net_facility_pence: 35_000_000 };
  const model = () => runLedger(mkSchedule(USES, SALE), terms, equity(25_000_000));

  it('caps the draw at undrawn net facility and records the gap', () => {
    const m = model();
    expect(m.months[2].draw_pence).toBe(4_000_000);
    expect(m.months[2].funding_gap_pence).toBe(6_000_000);
    expect(m.totals.funding_gap_pence).toBe(6_000_000);
    const gap = m.flags.find((f) => f.code === 'funding_gap');
    expect(gap?.severity).toBe('red');
    expect(gap?.month).toBe(2);
    expect(m.months[2].closing_balance_pence).toBe(35_979_331);
    expect(m.months[3].repayment_pence).toBe(36_339_124);
    expect(m.months[3].distribution_pence).toBe(41_510_876);
  });
});

describe('Cash funding produces exactly zero debt cost', () => {
  it('has no draws, interest, or fees under cash', () => {
    const terms: FacilityTerms = { ...TERMS, funding_source: 'cash' };
    const m = runLedger(mkSchedule(USES, SALE), terms, equity(65_000_000));
    expect(m.totals.draws_pence).toBe(0);
    expect(m.totals.finance_costs_pence).toBe(0);
    expect(m.peak_debt_pence).toBe(0);
    expect(m.months.every((mo) => mo.closing_balance_pence === 0)).toBe(true);
    expect(m.totals.equity_contributed_pence).toBe(65_000_000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/model/monthly-engine.test.ts`
Expected: FAIL — cannot resolve `./monthly-engine`.

- [ ] **Step 3: Implement `frontend/src/lib/model/monthly-engine.ts`:**

```typescript
import type {
  EquitySource, FacilityTerms, LedgerMonth, ModelFlag, MonthlyModel, Schedule,
} from './finance-types';

function exitFeeAmount(
  finance: FacilityTerms, grossFacility: number, peakDebt: number, redemptionBalance: number,
): number {
  const base =
    finance.exit_fee_basis === 'peak_debt' ? peakDebt :
    finance.exit_fee_basis === 'redemption_balance' ? redemptionBalance :
    grossFacility;
  return Math.round((base * finance.exit_fee_pct) / 100);
}

export function runLedger(
  schedule: Schedule, finance: FacilityTerms, equitySources: EquitySource[],
): MonthlyModel {
  const term = schedule.term_months;
  const isCash = finance.funding_source === 'cash';
  const netFacility = isCash ? 0 : (finance.committed_net_facility_pence ?? 0);
  const interestReserve = finance.interest_reserve_pence;
  const grossFacility = isCash ? 0
    : (finance.committed_gross_facility_pence ?? netFacility + (interestReserve ?? 0));
  const monthlyRate = finance.annual_interest_rate_pct / 100 / 12;
  const rolledUp = finance.interest_type === 'rolled_up';
  const fundAsRequired = finance.equity_draw_rule === 'fund_as_required';
  const committedEquity = equitySources
    .filter((s) => s.evidence_status !== 'rejected')
    .reduce((sum, s) => sum + s.amount_pence, 0);
  const hasFacility = !isCash && netFacility > 0;

  // Arrangement fee: charged on commitment, capitalised in month 0 (spec §3.9).
  const arrangementBase =
    finance.arrangement_fee_basis === 'committed_gross_facility' ? grossFacility : netFacility;
  const arrangementFee = hasFacility
    ? Math.round((arrangementBase * finance.arrangement_fee_pct) / 100) : 0;
  const ancillaryFees = hasFacility
    ? finance.broker_fee_pence + finance.lender_legal_fee_pence
      + finance.valuation_fee_pence + finance.monitoring_surveyor_fee_pence
    : 0;

  const flags: ModelFlag[] = [];
  const months: LedgerMonth[] = [];
  const equityCashflows: number[] = [];

  let opening = 0;
  let cumNetUsed = 0;
  let equityUsed = 0;
  let cumCapitalisedInterest = 0;
  let peakDebt = 0;
  let peakDebtMonth: number | null = null;
  let dayOneAdvance = 0;
  let totalInterest = 0;
  let totalExitFee = 0;
  let totalDraws = 0;
  let totalCapFees = 0;
  let totalEquity = 0;
  let totalAdditionalEquity = 0;
  let totalGap = 0;
  let totalDistributions = 0;
  let totalRepayments = 0;
  let reserveExhaustedFlagged = false;
  let facilityExceededFlagged = false;

  for (let m = 0; m < term; m++) {
    const u = schedule.uses[m];
    const cashUses =
      u.acquisition_pence + u.construction_pence + u.professional_pence + u.statutory_pence
      + (m === 0 ? ancillaryFees : 0);

    let draw = 0;
    let capFees = 0;
    let equityContribution = 0;
    let additionalEquity = 0;
    let fundingGap = 0;

    const equityAvailable = () => (fundAsRequired
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, committedEquity - equityUsed - equityContribution));

    if (m === 0) {
      if (hasFacility) {
        capFees = arrangementFee;
        cumNetUsed += capFees;
        if (finance.day_one_advance_pence != null) {
          draw = Math.max(0, Math.min(
            finance.day_one_advance_pence, netFacility - cumNetUsed, cashUses));
          cumNetUsed += draw;
        }
      }
      dayOneAdvance = draw;
      const needed = cashUses - draw;
      const fromEquity = Math.min(needed, equityAvailable());
      equityContribution += fromEquity;
      fundingGap += needed - fromEquity;
    } else {
      const fromEquity = Math.min(cashUses, equityAvailable());
      equityContribution += fromEquity;
      let remainder = cashUses - fromEquity;
      if (remainder > 0 && hasFacility) {
        const eligible = u.construction_pence + u.professional_pence + u.statutory_pence;
        const advanceCap = Math.round((eligible * finance.development_cost_advance_pct) / 100);
        const undrawnNet = Math.max(0, netFacility - cumNetUsed);
        draw = Math.max(0, Math.min(remainder, advanceCap, undrawnNet));
        cumNetUsed += draw;
        remainder -= draw;
      }
      fundingGap += remainder;
    }

    const interestAccrued = isCash ? 0
      : Math.round((opening + draw + capFees) * monthlyRate);
    totalInterest += interestAccrued;
    let interestCapitalised = 0;
    let interestServiced = 0;
    if (rolledUp) {
      interestCapitalised = interestAccrued;
      cumCapitalisedInterest += interestCapitalised;
    } else if (interestAccrued > 0) {
      interestServiced = interestAccrued;
      // Serviced interest: committed equity first, then flagged additional equity (§4.3).
      const fromEquity = Math.min(interestServiced, equityAvailable());
      equityContribution += fromEquity;
      additionalEquity += interestServiced - fromEquity;
    }

    let balance = opening + draw + capFees + interestCapitalised;
    if (balance > peakDebt) { peakDebt = balance; peakDebtMonth = m; }

    const r = schedule.receipts[m];
    const netReceipts = r.gross_sale_pence - r.agent_fee_pence - r.selling_legal_pence;
    let repayment = 0;
    let exitFee = 0;
    let distribution = 0;
    if (netReceipts > 0) {
      const sweepAvailable = Math.round((netReceipts * finance.sales_sweep_pct) / 100);
      if (balance > 0 && !isCash) {
        const fee = exitFeeAmount(finance, grossFacility, peakDebt, balance);
        if (sweepAvailable >= balance + fee) {
          repayment = balance;
          exitFee = fee;
          totalExitFee += fee;
          balance = 0;
        } else {
          repayment = Math.min(sweepAvailable, balance);
          balance -= repayment;
        }
      }
      distribution = netReceipts - repayment - exitFee;
    }

    equityUsed += equityContribution;
    totalDraws += draw;
    totalCapFees += capFees;
    totalEquity += equityContribution;
    totalAdditionalEquity += additionalEquity;
    totalGap += fundingGap;
    totalDistributions += distribution;
    totalRepayments += repayment + exitFee;

    if (fundingGap > 0 && !flags.some((f) => f.code === 'funding_gap')) {
      flags.push({
        code: 'funding_gap', severity: 'red', month: m, amount_pence: fundingGap,
        message: `Funding gap from month ${m}: committed equity and facility cannot fund all costs. Overruns do not create facility.`,
      });
    }
    if (interestReserve != null && !reserveExhaustedFlagged
      && cumCapitalisedInterest > interestReserve) {
      reserveExhaustedFlagged = true;
      flags.push({
        code: 'interest_reserve_exhausted', severity: 'amber', month: m,
        amount_pence: cumCapitalisedInterest - interestReserve,
        message: `Interest reserve exhausted in month ${m}.`,
      });
    }
    if (grossFacility > 0 && balance > grossFacility && !facilityExceededFlagged) {
      facilityExceededFlagged = true;
      flags.push({
        code: 'facility_exceeded', severity: 'red', month: m,
        amount_pence: balance - grossFacility,
        message: `Closing balance exceeds committed gross facility in month ${m}.`,
      });
    }

    months.push({
      month: m,
      uses_total_pence: cashUses,
      opening_balance_pence: opening,
      draw_pence: draw,
      capitalised_fees_pence: capFees,
      interest_accrued_pence: interestAccrued,
      interest_capitalised_pence: interestCapitalised,
      interest_serviced_pence: interestServiced,
      exit_fee_pence: exitFee,
      repayment_pence: repayment,
      closing_balance_pence: balance,
      undrawn_net_facility_pence: hasFacility ? netFacility - cumNetUsed : null,
      facility_headroom_pence: grossFacility > 0 ? grossFacility - balance : null,
      interest_reserve_remaining_pence:
        interestReserve != null ? interestReserve - cumCapitalisedInterest : null,
      equity_contribution_pence: equityContribution,
      additional_equity_pence: additionalEquity,
      funding_gap_pence: fundingGap,
      gross_receipts_pence: r.gross_sale_pence,
      net_receipts_pence: netReceipts,
      distribution_pence: distribution,
    });
    equityCashflows.push(-(equityContribution + additionalEquity) + distribution);
    opening = balance;
  }

  if (totalAdditionalEquity > 0) {
    flags.push({
      code: 'additional_equity_required', severity: 'red', month: null,
      amount_pence: totalAdditionalEquity,
      message: `Additional uncommitted equity of ${totalAdditionalEquity} pence required (e.g. to service interest).`,
    });
  }
  if (opening > 0) {
    flags.push({
      code: 'senior_outstanding_at_maturity', severity: 'red', month: term - 1,
      amount_pence: opening,
      message: 'Senior debt outstanding at maturity — repayment source (sale/refinance) not modelled.',
    });
    flags.push({
      code: 'exit_fee_not_charged', severity: 'info', month: term - 1, amount_pence: null,
      message: 'Exit fee excluded: the facility is not redeemed within the modelled term.',
    });
  }
  if (finance.requires_confirmation) {
    flags.push({
      code: 'requires_confirmation', severity: 'amber', month: null, amount_pence: null,
      message: 'Facility terms migrated from a legacy appraisal — confirm before lender use.',
    });
  }

  return {
    months,
    totals: {
      interest_pence: totalInterest,
      arrangement_fee_pence: arrangementFee,
      exit_fee_pence: totalExitFee,
      ancillary_fees_pence: ancillaryFees,
      finance_costs_pence: totalInterest + arrangementFee + totalExitFee + ancillaryFees,
      draws_pence: totalDraws,
      capitalised_fees_pence: totalCapFees,
      equity_contributed_pence: totalEquity,
      additional_equity_pence: totalAdditionalEquity,
      funding_gap_pence: totalGap,
      distributions_pence: totalDistributions,
      repayments_pence: totalRepayments,
    },
    peak_debt_pence: peakDebt,
    peak_debt_month: peakDebt > 0 ? peakDebtMonth : null,
    day_one_advance_pence: dayOneAdvance,
    committed_net_facility_pence: netFacility,
    committed_gross_facility_pence: grossFacility,
    senior_outstanding_at_maturity_pence: opening,
    flags,
    equity_cashflows_pence: equityCashflows,
  };
}
```

Note: ancillary (non-capitalised) lender fees are month-0 cash uses funded through the same waterfall, and they count inside `finance_costs_pence`. `uses_total_pence` includes them in month 0.

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run src/lib/model/monthly-engine.test.ts`
Expected: PASS (9 tests). If any pence figure differs, re-derive by hand against spec §8 before touching the expected values — the fixtures are normative.

- [ ] **Step 5: Also update the spec if needed and commit**

The engine charges the arrangement fee on commitment in month 0 (not on first utilisation). Spec §3.9 already says "Charged and capitalised at first drawdown (month 0 if drawn)" — edit that sentence in `docs/financial-model/calculation-specification.md` to: "Charged on commitment and capitalised in month 0 whenever a facility is committed."

```bash
git add frontend/src/lib/model/monthly-engine.ts frontend/src/lib/model/monthly-engine.test.ts docs/financial-model/calculation-specification.md
git commit -m "feat(model): monthly senior debt ledger with draw priority, serviced/rolled interest and sweep"
```

---

### Task 5: Metrics derivation (all lender metrics from the ledger)

**Files:**
- Create: `frontend/src/lib/model/metrics.ts`
- Create: `frontend/src/lib/model/metrics.test.ts`

**Interfaces:**
- Consumes: `CalculatorInputsV2`, `Schedule`, `MonthlyModel`, `AppraisalResultV2`, `CALC_VERSION` from `./finance-types`; `solveIrr` from `./irr`; `calculateCommercialSdlt` from `../commercial-sdlt`.
- Produces: `deriveMetrics(inputs: CalculatorInputsV2, schedule: Schedule, model: MonthlyModel): AppraisalResultV2`; helper `pct(numerator: number, denominator: number): number | null` (returns 2-dp percentage or null on zero denominator).

- [ ] **Step 1: Write the failing tests** `frontend/src/lib/model/metrics.test.ts`. Reuse Fixture B by construction: build the same schedule/terms as in `monthly-engine.test.ts` (copy the `mkSchedule`/`TERMS`/`USES`/`SALE`/`equity` helpers verbatim into this file — tests must be self-contained), plus a minimal `CalculatorInputsV2` whose `acquisition.purchase_price_pence = 40_000_000` and 0 for the other acquisition fields is NOT possible (SDLT would be added), so for ledger-level metric tests build inputs with `defaultCalculatorInputsV2()` and pass the hand-built schedule directly:

```typescript
import { describe, it, expect } from 'vitest';
import { deriveMetrics, pct } from './metrics';
import { runLedger } from './monthly-engine';
import { defaultCalculatorInputsV2, DEFAULT_FACILITY_TERMS } from '../conversion-defaults';
// ... copy mkSchedule/uses/receipts/TERMS/USES/SALE/NO_SALE/equity helpers from monthly-engine.test.ts

describe('pct', () => {
  it('rounds to 2 dp and nulls zero denominators', () => {
    expect(pct(1, 3)).toBe(33.33);
    expect(pct(1, 0)).toBeNull();
  });
});

describe('deriveMetrics on Fixture B', () => {
  function fixtureB() {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...TERMS };
    inputs.equity_sources = equity(30_000_000);
    inputs.acquisition.purchase_price_pence = 40_000_000;
    const schedule = mkSchedule(USES, SALE);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    return deriveMetrics(inputs, schedule, model);
  }

  it('reproduces spec §8 headline figures', () => {
    const r = fixtureB();
    expect(r.finance_costs_pence).toBe(2_909_224);
    expect(r.total_development_cost_pence).toBe(69_509_224);
    expect(r.profit_pence).toBe(10_490_776);
    expect(r.profit_is_unrealised).toBe(false);
    expect(r.peak_debt_pence).toBe(37_359_224);
    expect(r.gross_ltc_pct).toBe(53.75);
    expect(r.net_ltc_pct).toBe(55.38);
    expect(r.ltgdv_developer_pct).toBe(46.7);
    expect(r.ltgdv_lender_pct).toBeNull(); // no lender GDV in R1 — never defaults to developer GDV
    expect(r.day_one_advance_pence).toBe(30_000_000);
    expect(r.day_one_ltv_on_price_pct).toBe(75);
    expect(r.day_one_ltv_on_value_pct).toBeNull();
    expect(r.facility_headroom_pence).toBe(55_000_000 - 37_359_224);
  });

  it('profit identity: profit equals the sum of equity cash flows', () => {
    const r = fixtureB();
    expect(r.profit_pence).toBe(-10_000_000 - 15_000_000 - 5_000_000 + 40_490_776);
    expect(r.equity_multiple).toBe(Math.round((40_490_776 / 30_000_000) * 100) / 100);
  });

  it('IRR comes from actual equity flows and annualises correctly', () => {
    const r = fixtureB();
    expect(r.irr_monthly_pct).not.toBeNull();
    const monthly = r.irr_monthly_pct! / 100;
    expect(r.irr_annual_pct).toBeCloseTo((Math.pow(1 + monthly, 12) - 1) * 100, 1);
  });
});

describe('deriveMetrics on retain_all (Fixture D shape)', () => {
  it('marks profit unrealised, nulls IRR, and books no receipts', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...TERMS };
    inputs.equity_sources = equity(30_000_000);
    const schedule = mkSchedule(USES, NO_SALE);
    schedule.totals.retained_value_pence = 80_000_000;
    schedule.totals.gdv_pence = 80_000_000;
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const r = deriveMetrics(inputs, schedule, model);
    expect(r.profit_is_unrealised).toBe(true);
    expect(r.irr_monthly_pct).toBeNull();
    expect(r.irr_annual_pct).toBeNull();
    // unrealised profit = 80,000,000 − TDC(65,000,000 + 0 selling + 2,359,224 finance)
    expect(r.finance_costs_pence).toBe(2_359_224);
    expect(r.profit_pence).toBe(80_000_000 - 67_359_224);
  });
});

describe('deriveMetrics under cash funding', () => {
  it('zeroes every debt metric', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.finance = { ...DEFAULT_FACILITY_TERMS, funding_source: 'cash', term_months: 4 };
    inputs.equity_sources = equity(65_000_000);
    const schedule = mkSchedule(USES, SALE);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const r = deriveMetrics(inputs, schedule, model);
    expect(r.finance_costs_pence).toBe(0);
    expect(r.peak_debt_pence).toBe(0);
    expect(r.gross_ltc_pct).toBe(0);
    expect(r.day_one_ltv_on_price_pct).toBe(0);
    expect(r.facility_headroom_pence).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd frontend && npx vitest run src/lib/model/metrics.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `frontend/src/lib/model/metrics.ts`:**

```typescript
import type { AppraisalResultV2, CalculatorInputsV2, MonthlyModel, Schedule } from './finance-types';
import { CALC_VERSION } from './finance-types';
import { solveIrr } from './irr';
import { calculateCommercialSdlt } from '../commercial-sdlt';

/** Percentage to 2 dp; null when the denominator is zero (spec §1.5). */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function deriveMetrics(
  inputs: CalculatorInputsV2, schedule: Schedule, model: MonthlyModel,
): AppraisalResultV2 {
  const t = schedule.totals;
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence).total_pence;
  const costBeforeFinance = t.cost_before_finance_ex_selling_pence + t.selling_costs_pence;
  const financeCosts = model.totals.finance_costs_pence;
  const tdc = costBeforeFinance + financeCosts;
  const grossReceipts = t.gross_sales_pence;
  const profit = grossReceipts + t.retained_value_pence - tdc;
  const profitIsUnrealised = t.retained_value_pence > 0;

  const equityContributed = model.totals.equity_contributed_pence + model.totals.additional_equity_pence;
  const equityMultiple = equityContributed > 0
    ? Math.round((model.totals.distributions_pence / equityContributed) * 100) / 100
    : null;

  const irr = solveIrr(model.equity_cashflows_pence);
  const irrMonthly = irr === null ? null : Math.round(irr * 10000) / 100;
  const irrAnnual = irr === null ? null : Math.round((Math.pow(1 + irr, 12) - 1) * 10000) / 100;

  const target = inputs.deal_spider.target_profit_on_cost_pct;
  const costExLand = tdc - inputs.acquisition.purchase_price_pence - sdlt;
  const rlv = Math.round(t.gdv_pence / (1 + target / 100) - costExLand);

  const netAdvances = model.totals.draws_pence + model.totals.capitalised_fees_pence;
  const isCash = inputs.finance.funding_source === 'cash';
  const price = inputs.acquisition.purchase_price_pence;
  const dayOneValue = inputs.finance.day_one_market_value_pence;

  return {
    calc_version: CALC_VERSION,
    gdv_pence: t.gdv_pence,
    lender_gdv_pence: null, // Release 2: lender-underwritten GDV
    acquisition_cost_pence: t.acquisition_pence,
    sdlt_pence: sdlt,
    construction_cost_pence: t.construction_pence,
    professional_fees_pence: t.professional_pence,
    statutory_costs_pence: t.statutory_pence,
    selling_costs_pence: t.selling_costs_pence,
    cost_before_finance_pence: costBeforeFinance,
    finance_costs_pence: financeCosts,
    total_development_cost_pence: tdc,
    profit_pence: profit,
    profit_is_unrealised: profitIsUnrealised,
    unrealised_value_pence: t.retained_value_pence,
    profit_on_cost_pct: pct(profit, tdc),
    profit_on_gdv_pct: pct(profit, t.gdv_pence),
    equity_contributed_pence: equityContributed,
    equity_multiple: equityMultiple,
    irr_monthly_pct: irrMonthly,
    irr_annual_pct: irrAnnual,
    rlv_pence: rlv,
    day_one_advance_pence: model.day_one_advance_pence,
    day_one_ltv_on_price_pct: isCash && price === 0 ? null : pct(model.day_one_advance_pence, price) ?? (price === 0 ? null : 0),
    day_one_ltv_on_value_pct: dayOneValue == null ? null : pct(model.day_one_advance_pence, dayOneValue),
    development_advances_pence: model.totals.draws_pence - model.day_one_advance_pence,
    net_ltc_pct: t.cost_before_finance_ex_selling_pence === 0 ? null : pct(netAdvances, t.cost_before_finance_ex_selling_pence),
    gross_ltc_pct: tdc === 0 ? null : pct(model.peak_debt_pence, tdc),
    ltgdv_developer_pct: pct(model.peak_debt_pence, t.gdv_pence),
    ltgdv_lender_pct: null, // Release 2
    peak_debt_pence: model.peak_debt_pence,
    peak_debt_month: model.peak_debt_month,
    facility_headroom_pence: model.committed_gross_facility_pence > 0
      ? model.committed_gross_facility_pence - model.peak_debt_pence : null,
    interest_reserve_remaining_pence:
      model.months.length > 0
        ? model.months[model.months.length - 1].interest_reserve_remaining_pence
        : null,
    return_on_equity_pct: equityContributed > 0 ? pct(profit, equityContributed) : null,
  };
}
```

Simplify the `day_one_ltv_on_price_pct` line during implementation to exactly: `price === 0 ? null : pct(model.day_one_advance_pence, price)` — a zero advance over a positive price is 0%, which `pct` already returns.

- [ ] **Step 4: Run to verify pass** — `cd frontend && npx vitest run src/lib/model/metrics.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/metrics.ts frontend/src/lib/model/metrics.test.ts
git commit -m "feat(model): lender metrics derived solely from the monthly ledger"
```

---

### Task 6: Validation and reconciliation status

**Files:**
- Create: `frontend/src/lib/model/validation.ts`
- Create: `frontend/src/lib/model/validation.test.ts`

**Interfaces:**
- Consumes: `CalculatorInputsV2`, `Schedule`, `MonthlyModel` from `./finance-types`.
- Produces:
  - `validateInputs(inputs: CalculatorInputsV2): ValidationIssue[]` — pre-model hard errors/warnings.
  - `reconcile(inputs, schedule, model): ReconciliationStatus` — post-model invariant checks.
  - Types: `ValidationIssue { severity: 'error' | 'warning'; field: string; message: string }`; `ReconciliationStatus { sources_equal_uses: boolean; debt_rollforward_ok: boolean; closing_never_negative: boolean; facility_within_limit: boolean; senior_repaid: boolean; funding_complete: boolean; report_safe: boolean; issues: ValidationIssue[] }`.

- [ ] **Step 1: Write the failing tests** `frontend/src/lib/model/validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateInputs, reconcile } from './validation';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';

function errorsFor(mutate: (i: ReturnType<typeof defaultCalculatorInputsV2>) => void) {
  const inputs = defaultCalculatorInputsV2();
  inputs.unit_mix.units = [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 25_000_000, comparable_notes: '' }];
  inputs.acquisition.purchase_price_pence = 10_000_000;
  mutate(inputs);
  return validateInputs(inputs);
}

describe('validateInputs — hard errors', () => {
  it('rejects negative money values (the York Part L −£1 case)', () => {
    const issues = errorsFor((i) => { i.conversion_costs.part_l_compliance_pence = -1; });
    expect(issues.some((x) => x.severity === 'error' && x.field.includes('part_l'))).toBe(true);
  });

  it('rejects zero-value units (zero GDV where units exist)', () => {
    const issues = errorsFor((i) => { i.unit_mix.units[0].estimated_value_pence = 0; });
    expect(issues.some((x) => x.severity === 'error' && x.field.includes('unit'))).toBe(true);
  });

  it('rejects cash funding with a non-zero committed facility', () => {
    const issues = errorsFor((i) => {
      i.finance.funding_source = 'cash';
      i.finance.committed_net_facility_pence = 1_000_000;
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.committed_net_facility_pence')).toBe(true);
  });

  it('rejects day-one advance above the net facility', () => {
    const issues = errorsFor((i) => {
      i.finance.committed_net_facility_pence = 10_000_000;
      i.finance.day_one_advance_pence = 20_000_000;
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.day_one_advance_pence')).toBe(true);
  });

  it('rejects gross facility below net facility', () => {
    const issues = errorsFor((i) => {
      i.finance.committed_net_facility_pence = 10_000_000;
      i.finance.committed_gross_facility_pence = 5_000_000;
    });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.committed_gross_facility_pence')).toBe(true);
  });

  it('rejects pari_passu as not yet supported', () => {
    const issues = errorsFor((i) => { i.finance.equity_draw_rule = 'pari_passu'; });
    expect(issues.some((x) => x.severity === 'error' && x.field === 'finance.equity_draw_rule')).toBe(true);
  });

  it('rejects term_months < 1 and invalid share percentages', () => {
    expect(errorsFor((i) => { i.finance.term_months = 0; })
      .some((x) => x.severity === 'error' && x.field === 'finance.term_months')).toBe(true);
    expect(errorsFor((i) => { i.finance.sales_sweep_pct = 130; })
      .some((x) => x.severity === 'error' && x.field === 'finance.sales_sweep_pct')).toBe(true);
  });

  it('warns (not errors) on unreconciled construction area vs unit areas', () => {
    const issues = errorsFor((i) => {
      i.conversion_costs.total_construction_sqm = 500; // units total 50 sqm
    });
    const area = issues.find((x) => x.field === 'conversion_costs.total_construction_sqm');
    expect(area?.severity).toBe('warning');
  });

  it('warns on blended exit with no retained units', () => {
    const issues = errorsFor((i) => { i.exit_strategy.route = 'blended'; i.exit_strategy.retained_units = []; });
    expect(issues.some((x) => x.severity === 'warning' && x.field === 'exit_strategy.retained_units')).toBe(true);
  });
});

describe('reconcile', () => {
  it('reports a fully reconciled clean case as report_safe', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.unit_mix.units = [1, 2, 3, 4].map((n) => ({
      id: `u${n}`, type: '1bed' as const, floor_area_sqm: 50,
      estimated_value_pence: 30_000_000, comparable_notes: '',
    }));
    inputs.conversion_costs.total_construction_sqm = 200;
    inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000;
    inputs.finance.committed_net_facility_pence = 50_000_000;
    inputs.finance.day_one_advance_pence = 30_000_000;
    inputs.equity_sources[0].amount_pence = 40_000_000;
    const schedule = buildSchedule(inputs);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const rec = reconcile(inputs, schedule, model);
    expect(rec.sources_equal_uses).toBe(true);
    expect(rec.debt_rollforward_ok).toBe(true);
    expect(rec.closing_never_negative).toBe(true);
    expect(rec.facility_within_limit).toBe(true);
    expect(rec.senior_repaid).toBe(true);
    expect(rec.funding_complete).toBe(true);
    expect(rec.report_safe).toBe(true);
  });

  it('fails report_safe when a funding gap exists', () => {
    const inputs = defaultCalculatorInputsV2();
    inputs.acquisition.purchase_price_pence = 40_000_000;
    inputs.unit_mix.units = [{ id: 'u1', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 120_000_000, comparable_notes: '' }];
    inputs.conversion_costs.total_construction_sqm = 400;
    inputs.conversion_costs.construction_cost_per_sqm_pence = 100_000;
    inputs.finance.committed_net_facility_pence = 10_000_000;
    inputs.equity_sources[0].amount_pence = 10_000_000;
    const schedule = buildSchedule(inputs);
    const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
    const rec = reconcile(inputs, schedule, model);
    expect(rec.funding_complete).toBe(false);
    expect(rec.report_safe).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd frontend && npx vitest run src/lib/model/validation.test.ts` → FAIL.

- [ ] **Step 3: Implement `frontend/src/lib/model/validation.ts`:**

```typescript
import type { CalculatorInputsV2, MonthlyModel, Schedule } from './finance-types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface ReconciliationStatus {
  sources_equal_uses: boolean;
  debt_rollforward_ok: boolean;
  closing_never_negative: boolean;
  facility_within_limit: boolean;
  senior_repaid: boolean;
  funding_complete: boolean;
  report_safe: boolean;
  issues: ValidationIssue[];
}

const NON_NEGATIVE_MONEY: Array<[string, (i: CalculatorInputsV2) => number]> = [
  ['acquisition.purchase_price_pence', (i) => i.acquisition.purchase_price_pence],
  ['acquisition.legal_fees_pence', (i) => i.acquisition.legal_fees_pence],
  ['acquisition.survey_cost_pence', (i) => i.acquisition.survey_cost_pence],
  ['acquisition.other_acquisition_costs_pence', (i) => i.acquisition.other_acquisition_costs_pence],
  ['conversion_costs.prior_approval_fee_per_dwelling_pence', (i) => i.conversion_costs.prior_approval_fee_per_dwelling_pence],
  ['conversion_costs.cil_s106_pence', (i) => i.conversion_costs.cil_s106_pence],
  ['conversion_costs.architect_pence', (i) => i.conversion_costs.architect_pence],
  ['conversion_costs.structural_engineer_pence', (i) => i.conversion_costs.structural_engineer_pence],
  ['conversion_costs.mande_pence', (i) => i.conversion_costs.mande_pence],
  ['conversion_costs.planning_consultant_pence', (i) => i.conversion_costs.planning_consultant_pence],
  ['conversion_costs.building_control_pence', (i) => i.conversion_costs.building_control_pence],
  ['conversion_costs.other_professional_fees_pence', (i) => i.conversion_costs.other_professional_fees_pence],
  ['conversion_costs.construction_cost_per_sqm_pence', (i) => i.conversion_costs.construction_cost_per_sqm_pence],
  ['conversion_costs.fire_safety_pence', (i) => i.conversion_costs.fire_safety_pence],
  ['conversion_costs.sound_insulation_pence', (i) => i.conversion_costs.sound_insulation_pence],
  ['conversion_costs.part_l_compliance_pence', (i) => i.conversion_costs.part_l_compliance_pence],
  ['exit_strategy.selling_legal_fee_pence', (i) => i.exit_strategy.selling_legal_fee_pence],
];

export function validateInputs(inputs: CalculatorInputsV2): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ severity: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ severity: 'warning', field, message });

  for (const [field, get] of NON_NEGATIVE_MONEY) {
    if (get(inputs) < 0) err(field, 'Monetary values cannot be negative.');
  }
  if (inputs.conversion_costs.total_construction_sqm < 0) {
    err('conversion_costs.total_construction_sqm', 'Area cannot be negative.');
  }
  if (inputs.conversion_costs.contingency_pct < 0) {
    err('conversion_costs.contingency_pct', 'Contingency cannot be negative.');
  }
  for (const [idx, u] of inputs.unit_mix.units.entries()) {
    if (u.floor_area_sqm < 0) err(`unit_mix.units[${idx}].floor_area_sqm`, 'Unit area cannot be negative.');
    if (u.estimated_value_pence <= 0) err(`unit_mix.units[${idx}].estimated_value_pence`, 'Every unit needs a positive value — zero GDV with units present is invalid.');
  }

  const f = inputs.finance;
  if (!Number.isInteger(f.term_months) || f.term_months < 1) {
    err('finance.term_months', 'Term must be a whole number of months, at least 1.');
  }
  if (f.annual_interest_rate_pct < 0) err('finance.annual_interest_rate_pct', 'Rate cannot be negative.');
  if (f.arrangement_fee_pct < 0 || f.exit_fee_pct < 0) err('finance.fees', 'Fees cannot be negative.');
  if (f.sales_sweep_pct < 0 || f.sales_sweep_pct > 100) err('finance.sales_sweep_pct', 'Sweep must be between 0 and 100%.');
  if (f.development_cost_advance_pct < 0 || f.development_cost_advance_pct > 100) {
    err('finance.development_cost_advance_pct', 'Development advance rate must be between 0 and 100%.');
  }
  if (f.equity_draw_rule === 'pari_passu') {
    err('finance.equity_draw_rule', 'Pari-passu draws are not yet supported — use equity-first.');
  }
  if (f.funding_source === 'cash') {
    if ((f.committed_net_facility_pence ?? 0) !== 0 || (f.committed_gross_facility_pence ?? 0) !== 0) {
      err('finance.committed_net_facility_pence', 'Cash funding must have a zero senior facility.');
    }
  } else {
    const net = f.committed_net_facility_pence;
    if (net != null && f.day_one_advance_pence != null && f.day_one_advance_pence > net) {
      err('finance.day_one_advance_pence', 'Day-one advance cannot exceed the committed net facility.');
    }
    if (net != null && f.committed_gross_facility_pence != null && f.committed_gross_facility_pence < net) {
      err('finance.committed_gross_facility_pence', 'Gross facility cannot be below the net facility.');
    }
    if (net == null) warn('finance.committed_net_facility_pence', 'No committed facility entered — debt metrics will be unavailable.');
  }

  for (const [idx, e] of inputs.equity_sources.entries()) {
    if (e.amount_pence < 0) err(`equity_sources[${idx}].amount_pence`, 'Equity amounts cannot be negative.');
    if (e.classification === 'planning_uplift' && e.evidence_status !== 'confirmed') {
      warn(`equity_sources[${idx}]`, 'Planning/revaluation uplift is not cash equity — evidence required.');
    }
  }

  const unitArea = inputs.unit_mix.units.reduce((s, u) => s + u.floor_area_sqm, 0);
  const constArea = inputs.conversion_costs.total_construction_sqm;
  if (unitArea > 0 && constArea > 0) {
    const ratio = unitArea / constArea;
    if (ratio < 0.75 || ratio > 1.25) {
      warn('conversion_costs.total_construction_sqm',
        `Unit NIA (${unitArea} m²) and construction area (${constArea} m²) differ by more than 25% — check the area basis.`);
    }
  }
  if (inputs.exit_strategy.route === 'blended' && inputs.exit_strategy.retained_units.length === 0) {
    warn('exit_strategy.retained_units', 'Blended exit selected but no units are marked as retained.');
  }
  if (f.requires_confirmation) {
    warn('finance', 'Facility terms were migrated from a legacy appraisal and require confirmation.');
  }
  return issues;
}

export function reconcile(
  inputs: CalculatorInputsV2, schedule: Schedule, model: MonthlyModel,
): ReconciliationStatus {
  const issues: ValidationIssue[] = [];

  let rollforwardOk = true;
  let neverNegative = true;
  for (const mo of model.months) {
    if (mo.closing_balance_pence !== mo.opening_balance_pence + mo.draw_pence
      + mo.capitalised_fees_pence + mo.interest_capitalised_pence - mo.repayment_pence) {
      rollforwardOk = false;
    }
    if (mo.closing_balance_pence < 0) neverNegative = false;
  }

  // Sources = uses, cumulatively, to the penny (spec §7):
  // uses: all cost lines + serviced interest + selling costs + exit fee
  // sources: equity (incl. additional) + draws + capitalised fees + rolled interest + receipts applied
  const servicedInterest = model.months.reduce((s, m) => s + m.interest_serviced_pence, 0);
  const rolledInterest = model.months.reduce((s, m) => s + m.interest_capitalised_pence, 0);
  const usesTotal = model.months.reduce((s, m) => s + m.uses_total_pence, 0)
    + servicedInterest + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence;
  const sourcesTotal =
    model.totals.equity_contributed_pence + model.totals.additional_equity_pence
    + model.totals.funding_gap_pence // shown explicitly, never hidden
    + model.totals.draws_pence + model.totals.capitalised_fees_pence + rolledInterest
    + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence; // proceeds applied at source
  const sourcesEqualUses = usesTotal + rolledInterest === sourcesTotal
    // rolled interest is both a use (finance cost) and self-funding source within the gross facility
    ;

  const facilityWithinLimit = !model.flags.some((f) => f.code === 'facility_exceeded');
  const seniorRepaid = model.senior_outstanding_at_maturity_pence === 0;
  const fundingComplete = model.totals.funding_gap_pence === 0
    && model.totals.additional_equity_pence === 0;

  if (!sourcesEqualUses) issues.push({ severity: 'error', field: 'model', message: 'Sources and uses do not balance.' });
  if (!rollforwardOk) issues.push({ severity: 'error', field: 'model', message: 'Debt ledger roll-forward mismatch.' });
  if (!fundingComplete) issues.push({ severity: 'error', field: 'model', message: 'Funding gap or uncommitted equity requirement present.' });
  if (!seniorRepaid) issues.push({ severity: 'warning', field: 'model', message: 'Senior debt not repaid within the modelled term.' });

  const inputErrors = validateInputs(inputs).filter((i) => i.severity === 'error');
  const reportSafe = inputErrors.length === 0 && sourcesEqualUses && rollforwardOk
    && neverNegative && facilityWithinLimit && fundingComplete
    && !inputs.finance.requires_confirmation;

  return {
    sources_equal_uses: sourcesEqualUses,
    debt_rollforward_ok: rollforwardOk,
    closing_never_negative: neverNegative,
    facility_within_limit: facilityWithinLimit,
    senior_repaid: seniorRepaid,
    funding_complete: fundingComplete,
    report_safe: reportSafe,
    issues: [...inputErrors, ...issues],
  };
}
```

During implementation simplify the sources-equal-uses expression to a plain equality with a clarifying comment; the invariant is: `uses (costs + serviced interest + selling + exit fee) + rolled interest == sources (equity + additional equity + gap + draws + cap fees + rolled interest + proceeds applied)` — i.e. cancel `rolledInterest` on both sides and assert `usesTotal === sourcesTotal − rolledInterest`. Keep whichever form reads clearest but the test must pass to the penny.

- [ ] **Step 4: Run to verify pass** — `cd frontend && npx vitest run src/lib/model/validation.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/model/validation.ts frontend/src/lib/model/validation.test.ts
git commit -m "feat(model): hard validation and penny-exact reconciliation status"
```

---

### Task 7: Orchestrator, golden fixture files and invariant suite

**Files:**
- Create: `frontend/src/lib/model/index.ts`
- Create: `fixtures/financial-model/a-all-cash.json`
- Create: `fixtures/financial-model/f-dev-finance-12mo.json`
- Create: `frontend/src/lib/model/golden-fixtures.test.ts`
- Create: `frontend/src/lib/model/invariants.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `runAppraisal(inputs: CalculatorInputsV2): AppraisalRun` where `AppraisalRun = { inputs: CalculatorInputsV2; schedule: Schedule; model: MonthlyModel; metrics: AppraisalResultV2; validation: ValidationIssue[]; reconciliation: ReconciliationStatus }`. This is the ONLY entry point UI/report/backend-parity code may use.

- [ ] **Step 1: Implement `frontend/src/lib/model/index.ts`** (thin composition — write directly, it is exercised by every following test):

```typescript
import type { AppraisalResultV2, CalculatorInputsV2, MonthlyModel, Schedule } from './finance-types';
import { buildSchedule } from './schedule';
import { runLedger } from './monthly-engine';
import { deriveMetrics } from './metrics';
import { reconcile, validateInputs } from './validation';
import type { ReconciliationStatus, ValidationIssue } from './validation';

export interface AppraisalRun {
  inputs: CalculatorInputsV2;
  schedule: Schedule;
  model: MonthlyModel;
  metrics: AppraisalResultV2;
  validation: ValidationIssue[];
  reconciliation: ReconciliationStatus;
}

export function runAppraisal(inputs: CalculatorInputsV2): AppraisalRun {
  const schedule = buildSchedule(inputs);
  const model = runLedger(schedule, inputs.finance, inputs.equity_sources);
  const metrics = deriveMetrics(inputs, schedule, model);
  const validation = validateInputs(inputs);
  const reconciliation = reconcile(inputs, schedule, model);
  return { inputs, schedule, model, metrics, validation, reconciliation };
}

export { migrateInputs } from './migrate';
export { validateInputs, reconcile } from './validation';
export type { ReconciliationStatus, ValidationIssue } from './validation';
export * from './finance-types';
```

- [ ] **Step 2: Create `fixtures/financial-model/a-all-cash.json`** — hand-computed golden case (derivation: SDLT £9,500 on £400,000; acquisition 42,150,000p; construction 44,000,000p; professional 2,800,000p; statutory 238,400p; selling 2,200,000p; TDC 91,388,400p; profit 28,611,600p):

```json
{
  "name": "A — all-cash conversion, sell all",
  "kind": "pipeline",
  "inputs": {
    "inputs_version": 2,
    "project_id": null,
    "acquisition": {
      "purchase_price_pence": 40000000, "legal_fees_pence": 500000,
      "survey_cost_pence": 300000, "broker_fee_pct": 1.0, "other_acquisition_costs_pence": 0
    },
    "unit_mix": { "units": [
      { "id": "u1", "type": "1bed", "floor_area_sqm": 50, "estimated_value_pence": 30000000, "comparable_notes": "" },
      { "id": "u2", "type": "1bed", "floor_area_sqm": 50, "estimated_value_pence": 30000000, "comparable_notes": "" },
      { "id": "u3", "type": "1bed", "floor_area_sqm": 50, "estimated_value_pence": 30000000, "comparable_notes": "" },
      { "id": "u4", "type": "1bed", "floor_area_sqm": 50, "estimated_value_pence": 30000000, "comparable_notes": "" }
    ] },
    "conversion_costs": {
      "prior_approval_fee_per_dwelling_pence": 9600, "cil_s106_pence": 0,
      "architect_pence": 1500000, "structural_engineer_pence": 500000, "mande_pence": 500000,
      "planning_consultant_pence": 300000, "building_control_pence": 200000,
      "other_professional_fees_pence": 0, "construction_cost_per_sqm_pence": 100000,
      "total_construction_sqm": 400, "contingency_pct": 10.0,
      "fire_safety_pence": 0, "sound_insulation_pence": 0, "part_l_compliance_pence": 0
    },
    "finance": {
      "funding_source": "cash", "day_one_advance_pence": null, "day_one_market_value_pence": null,
      "development_cost_advance_pct": 100, "committed_net_facility_pence": 0,
      "committed_gross_facility_pence": 0, "annual_interest_rate_pct": 8.0,
      "interest_type": "rolled_up", "arrangement_fee_pct": 2.0,
      "arrangement_fee_basis": "committed_net_facility", "exit_fee_pct": 1.0,
      "exit_fee_basis": "committed_gross_facility", "broker_fee_pence": 0,
      "lender_legal_fee_pence": 0, "valuation_fee_pence": 0, "monitoring_surveyor_fee_pence": 0,
      "interest_reserve_pence": null, "term_months": 12, "equity_draw_rule": "equity_first",
      "sales_sweep_pct": 100, "legacy_leverage_pct": null, "requires_confirmation": false
    },
    "equity_sources": [{
      "id": "e1", "classification": "cash", "amount_pence": 90000000, "timing_month": 0,
      "repayment_priority": 1, "evidence_status": "confirmed", "notes": ""
    }],
    "exit_strategy": {
      "route": "sell_all", "selling_agent_fee_pct": 1.5,
      "selling_legal_fee_pence": 400000, "retained_units": []
    },
    "risks": [],
    "scenarios": {
      "base": { "label": "Base Case", "gdv_adjustment_pct": 0, "construction_cost_adjustment_pct": 0, "timeline_adjustment_months": 0, "interest_rate_adjustment_pct": 0 },
      "upside": { "label": "Upside", "gdv_adjustment_pct": 10, "construction_cost_adjustment_pct": -5, "timeline_adjustment_months": -2, "interest_rate_adjustment_pct": 0 },
      "downside": { "label": "Downside", "gdv_adjustment_pct": -10, "construction_cost_adjustment_pct": 15, "timeline_adjustment_months": 3, "interest_rate_adjustment_pct": 1 },
      "severe": { "label": "Severe", "gdv_adjustment_pct": -15, "construction_cost_adjustment_pct": 20, "timeline_adjustment_months": 6, "interest_rate_adjustment_pct": 2 }
    },
    "deal_spider": {
      "storeys": 2, "building_height_m": 7, "bsa_higher_risk": false, "daylight_pass_pct": 100,
      "absorption_months": 9, "exit_sell": true, "exit_refinance": true, "exit_hold": false,
      "exit_part_sale": false, "prior_approval_window_months": 2, "programme_contingency_months": 1,
      "cil_offset_pence": 0, "target_profit_on_cost_pct": 20, "weights": {}
    }
  },
  "expected_metrics": {
    "gdv_pence": 120000000,
    "acquisition_cost_pence": 42150000,
    "sdlt_pence": 950000,
    "construction_cost_pence": 44000000,
    "professional_fees_pence": 2800000,
    "statutory_costs_pence": 238400,
    "selling_costs_pence": 2200000,
    "cost_before_finance_pence": 91388400,
    "finance_costs_pence": 0,
    "total_development_cost_pence": 91388400,
    "profit_pence": 28611600,
    "profit_is_unrealised": false,
    "profit_on_cost_pct": 31.31,
    "profit_on_gdv_pct": 23.84,
    "peak_debt_pence": 0,
    "day_one_advance_pence": 0,
    "gross_ltc_pct": 0,
    "equity_contributed_pence": 89188400
  }
}
```

- [ ] **Step 3: Write `frontend/src/lib/model/golden-fixtures.test.ts`:**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import type { AppraisalResultV2, CalculatorInputsV2 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');

interface Fixture {
  name: string;
  kind: 'pipeline';
  inputs: CalculatorInputsV2;
  expected_metrics: Partial<AppraisalResultV2>;
}

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as Fixture);

describe('golden fixtures (shared with the Python engine)', () => {
  for (const fx of fixtures) {
    it(fx.name, () => {
      const run = runAppraisal(fx.inputs);
      for (const [key, expected] of Object.entries(fx.expected_metrics)) {
        expect(run.metrics[key as keyof AppraisalResultV2], key).toEqual(expected);
      }
    });
  }
});
```

- [ ] **Step 4: Run — fixture A must pass**

Run: `cd frontend && npx vitest run src/lib/model/golden-fixtures.test.ts`
Expected: PASS. If any figure differs, re-derive by hand before changing the fixture — the JSON numbers above are hand-computed and normative.

- [ ] **Step 5: Create `fixtures/financial-model/f-dev-finance-12mo.json`** — the 12-month development-finance parity fixture. Copy fixture A's JSON, rename to `"F — development finance 12 months, sell all"`, and change: `finance.funding_source` to `"development_finance"`, `committed_net_facility_pence` to `60000000`, `committed_gross_facility_pence` to `66000000`, `day_one_advance_pence` to `28000000`, `equity_sources[0].amount_pence` to `35000000`. Leave `expected_metrics` as `{}` for now. Then:
  1. Run `runAppraisal` over it in a scratch vitest (`it.only` inside golden-fixtures.test.ts with `console.log(JSON.stringify(run.metrics))`).
  2. Verify by hand: (a) month-0 draw = 28,000,000 and equity = month-0 uses − 28,000,000; (b) roll-forward for months 0–2 by calculator; (c) `profit_pence === sum(equity_cashflows)`; (d) peak debt equals the maximum pre-repayment balance.
  3. Freeze the logged metrics into `expected_metrics` (all keys used in fixture A plus `net_ltc_pct`, `ltgdv_developer_pct`, `irr_annual_pct`). This fixture's role is **cross-implementation parity** (TS ↔ Python); correctness is anchored by the hand-computed fixtures.
  4. Remove the `it.only` and re-run the suite: both fixtures PASS.

- [ ] **Step 6: Write `frontend/src/lib/model/invariants.test.ts`** — property checks across every fixture and the Task 4 ledger cases:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runAppraisal } from './index';
import type { CalculatorInputsV2 } from './finance-types';

const FIXTURE_DIR = resolve(__dirname, '../../../../fixtures/financial-model');
const fixtures = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as { name: string; inputs: CalculatorInputsV2 });

// Variants derived from each fixture to widen coverage without new hand calcs.
function variants(inputs: CalculatorInputsV2): Array<{ label: string; inputs: CalculatorInputsV2 }> {
  const clone = () => JSON.parse(JSON.stringify(inputs)) as CalculatorInputsV2;
  const retained = clone();
  retained.exit_strategy.route = 'retain_all';
  const serviced = clone();
  serviced.finance.interest_type = 'serviced';
  const shortTerm = clone();
  shortTerm.finance.term_months = 1;
  return [
    { label: 'base', inputs },
    { label: 'retain_all', inputs: retained },
    { label: 'serviced', inputs: serviced },
    { label: 'term=1', inputs: shortTerm },
  ];
}

describe('model invariants hold for every fixture and variant', () => {
  for (const fx of fixtures) {
    for (const v of variants(fx.inputs)) {
      describe(`${fx.name} [${v.label}]`, () => {
        const run = runAppraisal(v.inputs);

        it('debt roll-forward reconciles and closing balance is never negative', () => {
          for (const m of run.model.months) {
            expect(m.closing_balance_pence).toBe(
              m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
              + m.interest_capitalised_pence - m.repayment_pence);
            expect(m.closing_balance_pence).toBeGreaterThanOrEqual(0);
          }
        });

        it('peak debt equals the maximum monthly pre-repayment balance', () => {
          const maxBalance = Math.max(0, ...run.model.months.map((m) =>
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence + m.interest_capitalised_pence));
          expect(run.model.peak_debt_pence).toBe(maxBalance);
        });

        it('cash funding produces zero debt cost', () => {
          if (v.inputs.finance.funding_source === 'cash') {
            expect(run.metrics.finance_costs_pence).toBe(0);
            expect(run.model.totals.draws_pence).toBe(0);
          }
        });

        it('retained exits receive no sale proceeds', () => {
          if (v.inputs.exit_strategy.route === 'retain_all') {
            expect(run.model.months.every((m) => m.gross_receipts_pence === 0)).toBe(true);
            expect(run.metrics.selling_costs_pence).toBe(0);
          }
        });

        it('monthly schedule spreads sum exactly to cost totals', () => {
          const sum = (f: (m: typeof run.schedule.uses[number]) => number) =>
            run.schedule.uses.reduce((a, m) => a + f(m), 0);
          expect(sum((m) => m.construction_pence)).toBe(run.schedule.totals.construction_pence);
          expect(sum((m) => m.professional_pence)).toBe(run.schedule.totals.professional_pence);
          expect(sum((m) => m.statutory_pence)).toBe(run.schedule.totals.statutory_pence);
        });

        it('when debt fully repaid and nothing retained, profit equals Σ equity flows and sources equal uses', () => {
          const fullyRealised = run.model.senior_outstanding_at_maturity_pence === 0
            && run.schedule.totals.retained_value_pence === 0
            && run.model.totals.funding_gap_pence === 0;
          if (fullyRealised) {
            expect(run.metrics.profit_pence)
              .toBe(run.model.equity_cashflows_pence.reduce((a, b) => a + b, 0));
            expect(run.reconciliation.sources_equal_uses).toBe(true);
          }
        });

        it('TDC equals the sum of all monthly uses plus rolled interest and exit fee', () => {
          const monthlyUses = run.model.months.reduce((a, m) => a + m.uses_total_pence, 0);
          const rolled = run.model.months.reduce((a, m) => a + m.interest_capitalised_pence, 0);
          const serviced2 = run.model.months.reduce((a, m) => a + m.interest_serviced_pence, 0);
          expect(run.metrics.total_development_cost_pence).toBe(
            monthlyUses + rolled + serviced2 + run.metrics.selling_costs_pence
            + run.model.totals.exit_fee_pence);
        });
      });
    }
  }
});
```

- [ ] **Step 7: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all new model tests PASS; the pre-existing 96 tests still pass (nothing they cover has changed yet).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/model/index.ts frontend/src/lib/model/golden-fixtures.test.ts frontend/src/lib/model/invariants.test.ts fixtures/financial-model/
git commit -m "feat(model): runAppraisal orchestrator, shared golden fixtures and invariant suite"
```

---

### Task 8: Switch the calculation spine (every consumer uses `runAppraisal`)

**Files:**
- Modify: `frontend/src/lib/apply-scenario.ts`, `frontend/src/lib/apply-scenario.test.ts`
- Modify: `frontend/src/lib/conversion-calc-engine.ts` (delete `calculateAppraisal`, `calculateIrr`; keep cost helpers + `calculateRlv`)
- Delete: `frontend/src/lib/conversion-cashflow.ts`, `frontend/src/lib/conversion-cashflow.test.ts`
- Modify: `frontend/src/lib/conversion-calc-engine.test.ts` (drop `calculateAppraisal`/`calculateIrr` tests; keep helper tests)
- Modify: `frontend/src/lib/conversion-defaults.ts` (delete `mergeCalculatorInputs` once unreferenced), `frontend/src/lib/conversion-defaults.test.ts`
- Modify: `frontend/src/lib/deal-spider.ts` (accept `CalculatorInputsV2`, compute internal metrics via `runAppraisal`), `frontend/src/lib/deal-spider.test.ts`
- Modify: `frontend/src/components/ConversionCalculator.tsx` and ALL 11 pages under `frontend/src/components/calculator/` to consume `AppraisalRun`

**Interfaces:**
- Consumes: `runAppraisal`, `migrateInputs`, `AppraisalRun`, `CalculatorInputsV2`, `AppraisalResultV2`, `MonthlyModel` from `../lib/model` (Task 7).
- Produces: `applyScenario(inputs: CalculatorInputsV2, overrides: ScenarioOverrides): CalculatorInputsV2`; every calculator page's props become `{ run: AppraisalRun; inputs: CalculatorInputsV2; onChange(partial: Partial<CalculatorInputsV2>): void }` (pages that only display take `run` alone).

- [ ] **Step 1: Update `apply-scenario.ts` for v2 with the facility held fixed** — the function keeps its four adjustments (unit values ×(1+gdv%); `construction_cost_per_sqm_pence` ×(1+cost%); `term_months` += timeline; `annual_interest_rate_pct` += rate) and **must not touch** `committed_net_facility_pence`, `committed_gross_facility_pence`, `day_one_advance_pence` or `equity_sources`. Update its test: add

```typescript
it('holds the committed facility and equity fixed under downside overrides', () => {
  const out = applyScenario(v2Inputs, { label: 'Downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 15, timeline_adjustment_months: 3, interest_rate_adjustment_pct: 1 });
  expect(out.finance.committed_net_facility_pence).toBe(v2Inputs.finance.committed_net_facility_pence);
  expect(out.finance.day_one_advance_pence).toBe(v2Inputs.finance.day_one_advance_pence);
  expect(out.equity_sources).toEqual(v2Inputs.equity_sources);
});
```

- [ ] **Step 2: Strip the prohibited formulas.** In `conversion-calc-engine.ts` delete `calculateAppraisal` and `calculateIrr` (spec §11 items 1, 2, 7). Keep and export unchanged: `calculateGdv`, `calculateTotalAcquisitionCost`, `calculateTotalConstructionCost`, `calculateTotalProfessionalFees`, `calculateRlv`. Delete `conversion-cashflow.ts` and its test (spec §11 item 3). Fix the resulting compile errors by completing Steps 3–5 — the app must not build in a state where both engines exist.

- [ ] **Step 3: Rewire `ConversionCalculator.tsx`.** Replace state and memoisation (lines 54–78):

```typescript
import { runAppraisal, migrateInputs } from '../lib/model';
import type { AppraisalRun, CalculatorInputsV2 } from '../lib/model';
import { defaultCalculatorInputsV2 } from '../lib/conversion-defaults';

const [inputs, setInputs] = useState<CalculatorInputsV2>(() =>
  defaultCalculatorInputsV2(project ?? undefined));
// in the load effect, replace mergeCalculatorInputs with:
setInputs(migrateInputs(appraisal.inputs_snapshot, project));
const run: AppraisalRun = useMemo(() => runAppraisal(inputs), [inputs]);
```

Pass `run` (not `metrics`/`cashflow`) to every page. The save handler is finished in Task 13 — for now send `gdv_pence: run.metrics.gdv_pence`, `total_cost_pence: run.metrics.total_development_cost_pence`, `profit_on_cost_pct: run.metrics.profit_on_cost_pct ?? 0`, `profit_on_gdv_pct: run.metrics.profit_on_gdv_pct ?? 0`, `return_on_equity_pct: run.metrics.return_on_equity_pct ?? 0`, `irr: run.metrics.irr_annual_pct ?? 0`, `rlv_pence: run.metrics.rlv_pence`.

- [ ] **Step 4: Update every calculator page to the new field names.** Mechanical mapping (old `AppraisalMetrics` → new `run.metrics`): `total_gdv_pence→gdv_pence`, `total_acquisition_cost_pence→acquisition_cost_pence`, `total_construction_cost_pence→construction_cost_pence`, `total_professional_fees_pence→professional_fees_pence` (add `statutory_costs_pence` where cost breakdowns are shown), `total_finance_cost_pence→finance_costs_pence`, `total_cost_pence→total_development_cost_pence`, `loan_amount_pence→peak_debt_pence` (label "Peak debt", never "Loan"), `equity_required_pence→equity_contributed_pence`, `irr_annual→irr_annual_pct` (render `null` as "n/a — no realised equity flows"). Nullable percentages render "n/a", never 0. `ScenariosPage` runs `runAppraisal(applyScenario(inputs, o))` per scenario and additionally lists each scenario's red flags (`run.model.flags`). `ExitStrategyPage` keeps its editing UI but deletes its local agent-fee/valuation maths where the equivalent now exists on `run.schedule.totals` / `run.metrics` (component-local disposal formulas are prohibited — spec §11 item 9). `DealSpiderPage`/`computeSpider`: change `computeSpider` to take `CalculatorInputsV2` and derive its internal metrics from `runAppraisal(inputs).metrics` (axis logic unchanged; its tests update mechanically to v2 input construction via `defaultCalculatorInputsV2()`).

- [ ] **Step 5: Update `conversion-defaults.test.ts`** — replace `mergeCalculatorInputs` assertions with `migrateInputs` equivalents (legacy snapshot loads, severe scenario/deal-spider defaults still merge), then delete `mergeCalculatorInputs` from `conversion-defaults.ts`.

- [ ] **Step 6: Verify**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: clean compile; full suite passes (old engine tests removed, new suites green).

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "refactor: all pages consume runAppraisal; legacy engines removed"
```

---

### Task 9: Rebuild the three finance-critical pages

**Files:**
- Modify: `frontend/src/components/calculator/FinancePage.tsx` (full rewrite)
- Modify: `frontend/src/components/calculator/CashflowPage.tsx` (full rewrite)
- Modify: `frontend/src/components/calculator/AppraisalSummaryPage.tsx` (full rewrite)

**Interfaces:**
- Consumes: `AppraisalRun`, `CalculatorInputsV2` from `../../lib/model`; existing `formatPence`-style helper from `../../lib/format`.
- Produces: page components with props `{ inputs: CalculatorInputsV2; onChange(partial: Partial<CalculatorInputsV2>): void; run: AppraisalRun }`; a shared `ReconciliationStrip` component exported from `frontend/src/components/calculator/ReconciliationStrip.tsx` used by all three (and available to every page).

Keep the existing visual idiom (inline styles, dark palette `#0d1b2a`/`#1e3a5f`/`#e2e8f0`, cards, 13px controls). Pounds-in/pence-stored conversion at the boundary exactly as today (`Math.round(Number(value) * 100)`).

- [ ] **Step 1: Create `ReconciliationStrip.tsx`** — a persistent status bar taking `run: AppraisalRun`, rendering one chip per `ReconciliationStatus` boolean (`sources_equal_uses` "Sources = Uses", `debt_rollforward_ok` "Debt ledger", `facility_within_limit` "Facility", `senior_repaid` "Senior repaid", `funding_complete` "Fully funded", `report_safe` "Report safe") — green `#16a34a` when true, red `#dc2626` when false — plus an amber `#d97706` chip "Legacy — confirm facility terms" when `inputs.finance.requires_confirmation`. Below the chips, list `run.validation` errors/warnings and `run.model.flags` (red/amber first) as one-line entries.

- [ ] **Step 2: Rewrite `FinancePage.tsx`** with three sections:
  1. **Funding source** — the existing three-way selector. Selecting `cash` disables and zeroes the facility inputs (`onChange` writes `committed_net_facility_pence: 0, committed_gross_facility_pence: 0, day_one_advance_pence: null`).
  2. **Facility terms** (hidden for `cash`): pounds inputs for `committed_net_facility_pence`, `committed_gross_facility_pence` (placeholder "net + interest reserve" when blank), `day_one_advance_pence` (blank = "not agreed — no day-one tranche"), `interest_reserve_pence`; percent inputs for `annual_interest_rate_pct`, `development_cost_advance_pct`, `arrangement_fee_pct` (+ basis select), `exit_fee_pct` (+ basis select), `sales_sweep_pct`; number input `term_months`; selects for `interest_type` and `equity_draw_rule` (pari_passu option disabled with title "not yet supported"); pounds inputs for the four ancillary fees. If `legacy_leverage_pct` is non-null show a read-only amber note: "Migrated from legacy 'LTV {x}%' — the proposed facility below requires confirmation" with a **Confirm terms** button that sets `requires_confirmation: false`.
  3. **Equity sources** — table of `equity_sources` rows (classification select, amount £, timing month, evidence status select, notes) with add/remove; a footer shows committed cash equity total.
  Derived metric cards on the right (all from `run.metrics`, each with a definition tooltip from spec §5): day-one advance, day-one LTV on price, net LTC, gross LTC, LTGDV (developer), peak debt + month, facility headroom, finance costs. Render `null` as "n/a".

- [ ] **Step 3: Rewrite `CashflowPage.tsx`** as the debt-ledger table — one row per `run.model.months` entry with columns: Month, Costs (`uses_total_pence`), Equity in, Draw, Cap. fees, Interest, Opening, Closing, Undrawn net, Headroom, Receipts (net), Repayment, Distribution, Gap (red when > 0). Footer totals from `run.model.totals`. Above the table, the `ReconciliationStrip` and an assumptions note: "Straight-line spend over months 1–{n}; disposal in month {term}; see calculation specification §6."

- [ ] **Step 4: Rewrite `AppraisalSummaryPage.tsx`** — cards strictly from `run.metrics`, grouped: **Value** (GDV, lender GDV "n/a — Release 2"); **Cost** (acquisition, construction, professional, statutory, selling, cost before finance, finance costs, TDC); **Returns** (profit — suffixed "(unrealised)" when `profit_is_unrealised`, PoC, PoGDV, equity multiple, IRR annual, RoE, RLV with its configurable target shown); **Debt** (day-one advance & LTV, net/gross LTC, LTGDV, peak debt + month, headroom, interest reserve remaining). Every ratio card's tooltip states numerator and denominator verbatim from the spec. `ReconciliationStrip` pinned at the top.

- [ ] **Step 5: Verify** — `cd frontend && npx tsc --noEmit && npm test && npm run build`. Manually exercise via `npm run dev`: enter a cash scheme (facility inputs disabled, zero finance cost), a development-finance scheme (ledger visible, flags react), and confirm blank vs zero behave differently in the facility inputs.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/calculator
git commit -m "feat(ui): lender-grade finance, debt ledger and appraisal pages with reconciliation strip"
```

---

### Task 10: Make reports safe (remove prohibited metrics, consume the engine)

**Files:**
- Modify: `frontend/src/lib/export-investment-memo.ts`
- Modify: `frontend/src/lib/export-investment-memo.test.ts`
- Modify: `frontend/src/components/ExportPage.tsx`
- Modify: `frontend/src/lib/export-pdf.ts` (only if it references removed fields)
- Modify: `frontend/src/lib/deal-spider.ts` + `deal-spider.test.ts` (VAT labelling)

**Interfaces:**
- Consumes: `AppraisalRun` from `../lib/model`.
- Produces: `generateInvestmentMemo(project: Project, run: AppraisalRun, eligibility?: EligibilityAssessment): Blob` — the memo receives the finished run and performs **zero** recalculation.

- [ ] **Step 1: Change the memo signature** to take `run: AppraisalRun` and delete from `export-investment-memo.ts`: the local `applyScenario` copy (line ~140), the fee/cost re-derivations (lines ~502–517), the LTC/LTGDV/day-one-LTV computations (lines ~677–821), the equity multiple (784), and `findImpairmentPoint` (~1188). Every table now reads `run.metrics`, `run.model` and `run.schedule.totals`.
- [ ] **Step 2: Replace the removed lender sections**: day-one LTV table uses `metrics.day_one_advance_pence` / `metrics.day_one_ltv_on_price_pct`; leverage section shows net LTC and gross LTC each with a footnote naming numerator and denominator (spec §5.4–§5.5); the "senior debt impairment" section is **removed entirely** and replaced by a single line: "Senior repayment and developer break-even analysis: not yet available (Release 2). Do not rely on prior versions' impairment figures." A "peak funding" label anywhere becomes "Peak senior debt" sourced from `metrics.peak_debt_pence`. Sources-and-uses table is generated from `run.model.totals` (equity + additional equity + draws + capitalised fees + rolled interest + proceeds applied vs monthly uses + serviced interest + selling costs + exit fee) and must total identically on both sides — add a test asserting the two printed totals are equal.
- [ ] **Step 3: Sensitivity grids** call `runAppraisal(applyScenario(run.inputs, o))` (facility fixed) and additionally print a flag column (facility exceeded / funding gap / not repaid).
- [ ] **Step 4: Watermark**: when `!run.reconciliation.report_safe`, every page renders a diagonal grey "DRAFT — UNRECONCILED — NOT FOR LENDER RELIANCE" (jsPDF: `doc.setTextColor(200); doc.setFontSize(40); doc.text(..., { angle: 35 })` before content on each page). Assumptions table: replace the hard-coded `'RLV target profit', '20% on cost'` row with the actual `deal_spider.target_profit_on_cost_pct`, replace the `'LTV / LTC'` row with "Committed net facility" / "requires confirmation" status, and add rows: "Construction VAT: treatment unconfirmed — no reduced-rate saving assumed" and "Purchase VAT/TOGC: unconfirmed".
- [ ] **Step 5: `ExportPage.tsx`** builds one `AppraisalRun` via `runAppraisal(migrateInputs(snapshot, project))` and passes it everywhere; delete its independent `calculateAppraisal`/`buildCashflow`/`computeSpider` calls (lines ~65, 104–105) and its ad-hoc sqft conversion if duplicated.
- [ ] **Step 6: Deal Spider VAT** — in `deal-spider.ts` rename the axis help text (line ~110) to state: "Illustrative only: assumes 15% of construction cost as potential reduced-rate VAT saving. UNCONFIRMED — obtain specific tax advice; excluded from the appraisal and all lender metrics." Add `illustrative: true` to that axis def and render an "unconfirmed" badge in `DealSpiderPage`. Update `deal-spider.test.ts:245` accordingly.
- [ ] **Step 7: Update memo tests**: keep Blob smoke tests; add content assertions that (a) the strings "Day-one LTV" appears only with the new definition footnote, (b) "impairment" does not appear, (c) the watermark text appears when reconciliation fails, (d) sources total equals uses total.
- [ ] **Step 8: Verify & commit**

Run: `cd frontend && npx tsc --noEmit && npm test && npm run build` — all green.

```bash
git add frontend/src/lib/export-investment-memo.ts frontend/src/lib/export-pdf.ts frontend/src/lib/deal-spider.ts frontend/src/components/ExportPage.tsx frontend/src/lib/*.test.ts frontend/src/components/calculator/DealSpiderPage.tsx
git commit -m "fix(reports): memo consumes authoritative model; unsafe lender metrics removed; draft watermark"
```

---

### Task 11: Python mirror of the financial model (fixture parity)

**Files:**
- Create: `app/financial_model/__init__.py`, `app/financial_model/types.py`, `app/financial_model/schedule.py`, `app/financial_model/engine.py`, `app/financial_model/metrics.py`, `app/financial_model/validation.py`, `app/financial_model/migrate.py`, `app/financial_model/hashing.py`, `app/financial_model/sdlt.py`
- Create: `tests/test_financial_model_fixtures.py`, `tests/test_financial_model_engine.py`

**Interfaces:**
- Consumes: `fixtures/financial-model/*.json` (Task 7).
- Produces: `run_appraisal(inputs: CalculatorInputsV2) -> AppraisalRun` (dataclasses mirroring the TS types with snake_case field names — the TS names already are snake_case, so names match exactly); `migrate_inputs(snapshot: dict) -> CalculatorInputsV2`; `input_hash(inputs) -> str`, `outputs_hash(metrics) -> str`.

**Port rules (mandatory):**
1. One Python module per TS module, same order of functions, same variable names. This is a disciplined transliteration, not a redesign — divergence is the failure mode the golden fixtures exist to catch.
2. Money rounding: define once in `engine.py` and use everywhere money is rounded:

```python
import math

def money_round(x: float) -> int:
    """Half-up toward +inf, matching JS Math.round. Never use Python round()."""
    return math.floor(x + 0.5)
```

3. Percent output rounding mirrors `pct()`: `None` on zero denominator, else `round half-up to 2 dp` implemented as `money_round(n / d * 10000) / 100`.
4. `null` ↔ `None`; TS `number | null` fields become `int | None` / `float | None`.
5. `sdlt.py` ports `commercial-sdlt.ts` band-for-band (0% to 15_000_000p, 2% to 25_000_000p, 5% above, slice basis).
6. IRR: port `irr.ts` exactly (same Newton constants, same bisection bracket [−0.99, 10], same tolerances).
7. `types.py` uses Pydantic v2 models (they double as the API schema in Task 12) with constraints: every `*_pence` field `ge=0` except none (negatives rejected), every share pct `ge=0, le=100`, `term_months: int = Field(ge=1)`, enums as `Literal[...]`. `CalculatorInputsV2` has `inputs_version: Literal[2]`.

- [ ] **Step 1: Write the failing parity test** `tests/test_financial_model_fixtures.py`:

```python
import json
from pathlib import Path

import pytest

from app.financial_model import run_appraisal
from app.financial_model.types import CalculatorInputsV2

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "financial-model"
FIXTURES = sorted(FIXTURE_DIR.glob("*.json"))


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_golden_fixture_parity(path: Path) -> None:
    doc = json.loads(path.read_text())
    inputs = CalculatorInputsV2.model_validate(doc["inputs"])
    run = run_appraisal(inputs)
    for key, expected in doc["expected_metrics"].items():
        actual = getattr(run.metrics, key)
        assert actual == expected, f"{path.stem}.{key}: {actual} != {expected}"


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_invariants(path: Path) -> None:
    doc = json.loads(path.read_text())
    run = run_appraisal(CalculatorInputsV2.model_validate(doc["inputs"]))
    for m in run.model.months:
        assert m.closing_balance_pence == (
            m.opening_balance_pence + m.draw_pence + m.capitalised_fees_pence
            + m.interest_capitalised_pence - m.repayment_pence
        )
        assert m.closing_balance_pence >= 0
    assert run.reconciliation.sources_equal_uses
```

- [ ] **Step 2: Write `tests/test_financial_model_engine.py`** — transliterate the four hand-computed ledger fixtures (B, C, D, E) from `frontend/src/lib/model/monthly-engine.test.ts` with identical pence assertions (both implementations must agree with the hand calculation, not merely with each other).

- [ ] **Step 3: Run to verify failure** — `pytest tests/test_financial_model_fixtures.py` → import error.

- [ ] **Step 4: Port the modules** per the port rules. Signatures:

```python
# app/financial_model/__init__.py
from .engine import run_ledger
from .metrics import derive_metrics
from .migrate import migrate_inputs
from .schedule import build_schedule
from .validation import reconcile, validate_inputs

CALC_VERSION = "2.0.0"

def run_appraisal(inputs):  # -> AppraisalRun
    schedule = build_schedule(inputs)
    model = run_ledger(schedule, inputs.finance, inputs.equity_sources)
    return AppraisalRun(
        inputs=inputs, schedule=schedule, model=model,
        metrics=derive_metrics(inputs, schedule, model),
        validation=validate_inputs(inputs),
        reconciliation=reconcile(inputs, schedule, model),
    )
```

`hashing.py`:

```python
import hashlib, json

def canonical_hash(payload: dict) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode()).hexdigest()

def input_hash(inputs) -> str:
    return canonical_hash(inputs.model_dump(mode="json"))

def outputs_hash(metrics) -> str:
    return canonical_hash(metrics_to_dict(metrics))
```

- [ ] **Step 5: Run to verify pass** — `pytest tests/test_financial_model_fixtures.py tests/test_financial_model_engine.py -v`. Every fixture and every hand-computed pence figure passes in both languages. If Python disagrees with TS on fixture F, the bug is a port divergence — fix Python (or, if TS violated a hand-computed fixture, fix TS); never adjust fixture numbers to make peace.

- [ ] **Step 6: Commit**

```bash
git add app/financial_model tests/test_financial_model_fixtures.py tests/test_financial_model_engine.py
git commit -m "feat(backend): Python financial model mirroring TS engine, pinned by shared golden fixtures"
```

---

### Task 12: Backend becomes the authority (typed schema, recalculation, governance columns)

**Files:**
- Modify: `app/models.py` (replace the appraisal schemas at lines 325–365)
- Modify: `app/persistence/database.py` (`FinancialAppraisalORM`, line ~126)
- Create: `migrations/002_appraisal_governance.py` (follow the structure of `migrations/001_initial.py`)
- Modify: `app/persistence/repositories.py` (appraisal repository, lines ~172–226)
- Modify: `app/api/app.py` (appraisal endpoints, lines ~262–292)
- Create: `tests/test_appraisal_governance.py`

**Interfaces:**
- Consumes: `app.financial_model` (Task 11).
- Produces: API contract — `POST /api/v1/appraisals` and `PUT /api/v1/appraisals/{project_id}` accept `{ project_id, name, inputs_snapshot }` (client-supplied outputs are OPTIONAL and used only for mismatch recording); responses carry server-calculated `outputs`, `calc_version`, `inputs_version`, `status`, `input_hash`, `outputs_hash`, `validation`.

- [ ] **Step 1: Write the failing tests** `tests/test_appraisal_governance.py` (follow the existing test style in `tests/test_api_endpoints.py` for app/client setup):

```python
# Key cases — write all of these:

async def test_save_recalculates_outputs_server_side(client, project):
    """POST with fixture A inputs and DELIBERATELY WRONG client outputs
    (gdv_pence=1) → stored/ returned gdv_pence == 120_000_000 (server wins),
    and validation payload records a client_mismatch entry."""

async def test_negative_costs_rejected(client, project):
    """POST with part_l_compliance_pence = -1 (the York defect) → 422."""

async def test_v1_snapshot_migrates_to_legacy_unreconciled(client, project):
    """POST with a v1-shaped inputs_snapshot (ltv_pct present) → 200,
    response status == 'legacy_unreconciled',
    outputs['finance'] recalculated under calc_version 2,
    finance requires_confirmation True in the stored snapshot."""

async def test_input_hash_and_outputs_hash_persisted(client, project):
    """Saved record has non-empty input_hash/outputs_hash; PUT with identical
    inputs produces identical hashes (determinism)."""

async def test_status_reconciled_only_when_report_safe(client, project):
    """Fixture A (clean) → status 'reconciled'. A case with a funding gap
    (net facility 100_000p, tiny equity) → status 'draft' with issues listed."""

async def test_get_returns_authoritative_outputs(client, project):
    """GET returns the server-stored outputs and calc_version — no client fields."""
```

- [ ] **Step 2: Run to verify failure** — `pytest tests/test_appraisal_governance.py` → failures/errors.

- [ ] **Step 3: Replace the Pydantic schemas** in `app/models.py`:

```python
from app.financial_model.types import CalculatorInputsV2

class FinancialAppraisalCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    inputs_snapshot: dict  # validated/migrated in the endpoint; may be v1 or v2
    # optional client-computed values, used ONLY for mismatch recording:
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None

class FinancialAppraisalUpdate(FinancialAppraisalCreate):
    project_id: uuid.UUID | None = None
    name: str | None = None
    inputs_snapshot: dict | None = None

class FinancialAppraisal(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    inputs_snapshot: dict
    outputs: dict | None = None            # authoritative AppraisalResultV2 + reconciliation
    validation: dict | None = None         # {errors, warnings, client_mismatches}
    calc_version: str | None = None
    inputs_version: int = 1
    status: str = "draft"                  # draft | reconciled | legacy_unreconciled
    input_hash: str | None = None
    outputs_hash: str | None = None
    # legacy columns retained, now always server-computed:
    gdv_pence: int | None = None
    total_cost_pence: int | None = None
    profit_on_cost_pct: float | None = None
    profit_on_gdv_pct: float | None = None
    return_on_equity_pct: float | None = None
    irr: float | None = None
    rlv_pence: int | None = None
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 4: ORM + migration.** Add to `FinancialAppraisalORM`: `outputs` (JSON, nullable), `validation` (JSON, nullable), `calc_version` (String, nullable), `inputs_version` (Integer, server_default '1'), `status` (String, server_default `'legacy_unreconciled'`), `input_hash`/`outputs_hash` (String, nullable). Write `migrations/002_appraisal_governance.py` adding those columns; the `'legacy_unreconciled'` default is what marks every pre-existing row (including the live York appraisal) as unmigrated — satisfying verification item 11 without touching row data. New saves overwrite status explicitly.

- [ ] **Step 5: Endpoint logic** (shared helper in `app/api/app.py`):

```python
from app.financial_model import CALC_VERSION, run_appraisal
from app.financial_model.migrate import migrate_inputs
from app.financial_model.hashing import input_hash, outputs_hash
from app.financial_model.types import CalculatorInputsV2
from pydantic import ValidationError

CLIENT_METRIC_MAP = {
    "gdv_pence": "gdv_pence",
    "total_cost_pence": "total_development_cost_pence",
    "profit_on_cost_pct": "profit_on_cost_pct",
    "profit_on_gdv_pct": "profit_on_gdv_pct",
    "return_on_equity_pct": "return_on_equity_pct",
    "irr": "irr_annual_pct",
    "rlv_pence": "rlv_pence",
}

def calculate_authoritative(payload: FinancialAppraisalCreate) -> dict:
    raw = payload.inputs_snapshot
    was_v1 = raw.get("inputs_version") != 2
    inputs = migrate_inputs(raw)  # raises HTTPException(422) on hard schema errors
    try:
        inputs = CalculatorInputsV2.model_validate(inputs.model_dump(mode="json"))
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    run = run_appraisal(inputs)
    if any(i.severity == "error" for i in run.validation):
        raise HTTPException(status_code=422, detail=[i.__dict__ for i in run.validation if i.severity == "error"])

    mismatches = []
    for client_field, metric_field in CLIENT_METRIC_MAP.items():
        client_value = getattr(payload, client_field, None)
        server_value = getattr(run.metrics, metric_field)
        if client_value is not None and client_value != server_value:
            mismatches.append({"field": client_field, "client": client_value, "server": server_value})

    status = ("legacy_unreconciled" if was_v1
              else "reconciled" if run.reconciliation.report_safe
              else "draft")
    outputs = {"metrics": metrics_dict(run.metrics), "reconciliation": rec_dict(run.reconciliation)}
    return {
        "inputs_snapshot": inputs.model_dump(mode="json"),
        "outputs": outputs,
        "validation": {
            "issues": [i.__dict__ for i in run.validation],
            "client_mismatches": mismatches,
        },
        "calc_version": CALC_VERSION,
        "inputs_version": 2,
        "status": status,
        "input_hash": input_hash(inputs),
        "outputs_hash": canonical_hash(outputs),
        # legacy columns from the server calculation, never from the client:
        "gdv_pence": run.metrics.gdv_pence,
        "total_cost_pence": run.metrics.total_development_cost_pence,
        "profit_on_cost_pct": run.metrics.profit_on_cost_pct,
        "profit_on_gdv_pct": run.metrics.profit_on_gdv_pct,
        "return_on_equity_pct": run.metrics.return_on_equity_pct,
        "irr": run.metrics.irr_annual_pct,
        "rlv_pence": run.metrics.rlv_pence,
    }
```

`POST /appraisals` and `PUT /appraisals/{project_id}` both call `calculate_authoritative` and persist inputs + outputs **atomically in one repository call** (extend the repository `create`/`update` to accept the full dict). GET is unchanged apart from the enlarged response model.

- [ ] **Step 6: Run to verify pass** — `pytest` (whole backend suite; existing structural tests updated where column lists changed, e.g. `tests/test_orm_tables.py`).

- [ ] **Step 7: Commit**

```bash
git add app migrations/002_appraisal_governance.py tests
git commit -m "feat(backend): server-side recalculation, typed appraisal schema and governance columns"
```

---

### Task 13: Frontend save flow consumes server authority

**Files:**
- Modify: `frontend/src/lib/api.ts` (appraisal functions, lines ~108–122)
- Modify: `frontend/src/types.ts` (`FinancialAppraisal`/`FinancialAppraisalCreate`, lines ~152–176)
- Modify: `frontend/src/components/ConversionCalculator.tsx` (save handler + status banner)
- Modify: `frontend/src/components/ProjectDetail.tsx` (metric labels read from `outputs.metrics` when present)

**Interfaces:**
- Consumes: Task 12's API contract; `AppraisalRun` from Task 8.
- Produces: `saveAppraisal(projectId, payload): Promise<FinancialAppraisal>` returning the authoritative record; visible save error state; a status banner ("Reconciled" green / "Draft — unreconciled" amber / "Legacy — recalculation required, save to migrate" red) driven by the stored `status`.

- [ ] **Step 1: Extend `frontend/src/types.ts`** with the new response fields (`outputs`, `validation`, `calc_version`, `inputs_version`, `status`, `input_hash`, `outputs_hash`) mirroring Task 12's `FinancialAppraisal`.
- [ ] **Step 2: Update the save handler** in `ConversionCalculator.tsx`: send `inputs_snapshot` (v2) plus the seven client metric fields (server uses them only for mismatch recording); on response, surface `status` and any `validation.client_mismatches` in a banner; replace the silent `catch(() => {})` on load (line 73) and the missing catch on save with an error banner state (`saveError: string | null`). A 422 response renders its `detail` list as field-level messages above the footer.
- [ ] **Step 3: On load**, if the stored record's `status === 'legacy_unreconciled'`, show the red banner and DO NOT display stored legacy `gdv_pence`-style columns as current — the live `runAppraisal` result is the display source; the stored record becomes current on next save.
- [ ] **Step 4: `ProjectDetail.tsx`** — prefer `appraisal.outputs.metrics` fields for its summary cards; fall back to the legacy columns only with a "legacy — unreconciled" caption when `outputs` is null.
- [ ] **Step 5: Verify end-to-end** with the API running (`docker-compose up api` or existing dev flow): save a fresh appraisal → status Reconciled/Draft as appropriate; reload → identical figures (determinism); attempt a save with a negative cost via devtools-modified payload → 422 surfaced, nothing persisted.
- [ ] **Step 6: Run both suites + build** — `cd frontend && npm test && npx tsc --noEmit && npm run build` and `pytest`.
- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat: save flow adopts server-authoritative outputs with status and error surfacing"
```

---

### Task 14: Documentation, lint, full verification and implementation report

**Files:**
- Create: `docs/financial-model/test-cases.md` — enumerate every golden fixture (inputs summary, hand-derivation, expected values), the invariant list, and how to run both suites.
- Create: `docs/financial-model/model-governance.md` — dual-implementation policy (TS for interactivity, Python for authority, golden fixtures as the contract; any formula change requires: spec edit → fixture update with hand derivation → both engines updated in one change); calc/inputs versioning; status lifecycle (draft → reconciled; legacy_unreconciled); hash usage; what blocks `report_safe`.
- Create: `docs/financial-model/migration-notes.md` — v1→v2 field mapping table (`ltv_pct → legacy_leverage_pct + proposed committed_net_facility (unconfirmed)`), the `fund_as_required` legacy equity rule, DB migration 002 behaviour (existing rows → `legacy_unreconciled`), and the York appraisal's expected post-migration state.
- Modify: whatever lint requires (the audit reports 23 errors incl. React effect issues, unused error vars, `any` in the report generator — most disappear with Tasks 8–10; fix the rest properly, no `eslint-disable` unless justified inline).

- [ ] **Step 1: Write the three documents** listed above.
- [ ] **Step 2: Full verification run** — record every command and outcome:

```bash
cd frontend && npm test            # all frontend tests
cd frontend && npx tsc --noEmit    # type check
cd frontend && npm run lint        # 0 errors
cd frontend && npm run build       # production build
pytest                             # all backend tests incl. fixture parity
```

- [ ] **Step 3: Exercise the four release-gate schemes** in the running app and record the reconciliation panel state for each:
  1. all-cash scheme (fixture A values) — zero finance cost, sources = uses;
  2. development-finance sell-all scheme — summary interest equals ledger interest by construction, senior repaid;
  3. retain/refinance scheme — no sale receipts, red "senior outstanding" flag, IRR n/a;
  4. downside exceeding the facility — funding gap flagged, facility NOT expanded, committed facility unchanged.
- [ ] **Step 4: Confirm the York appraisal path**: with the live DB, GET returns `status legacy_unreconciled`; loading it shows the red banner; saving migrates + recalculates and the response carries v2 inputs, calc_version 2.0.0, and mismatch records against its stale stored outputs. If no live DB is available in the dev environment, cover the same path with the v1-snapshot backend test (Task 12) and note that in the report.
- [ ] **Step 5: Write the implementation report** (append to the plan file or as `docs/reviews/2026-08-12-release-1-implementation-report.md`): files changed, migrations introduced, calculation definitions implemented (spec section references), defects corrected (map each audit P0 to its fixing task/commit), tests added with counts and results, the worked reconciliation (fixture B table), remaining limitations (no dated programme; single-month disposal; break-even/cost-to-complete/lender GDV deferred to Release 2; pari-passu unsupported; SDLT England/NI only; VAT unmodelled), and the recommended next phase (Release 2 — lender-ready underwriting).
- [ ] **Step 6: Final commit**

```bash
git add docs
git commit -m "docs: release 1 verification, governance and migration notes"
```

---

## Self-review record

- **Spec coverage (Release 1 scope):** calculation specification (pre-plan, done); single monthly engine (T4); debt/equity/interest correctness incl. serviced vs rolled and cash-zero (T4); exit logic incl. retain-no-receipts and selling costs in TDC (T2, T5); balanced sources-and-uses (T6); correct lender definitions — day-one LTV, net/gross LTC, LTGDV, peak debt, headroom (T5); prohibited metrics removed from reports (T10); validation incl. negative values and impossible percentages (T6, T12); fixed-facility scenarios (T8); server-side authoritative persistence with versioning/hashes/legacy marking (T11–T13); golden tests + invariants both languages (T4, T7, T11); York handled via migration status default (T12, T14). Deferred by design to R2/R3 and stated as "n/a" in outputs: lender GDV, break-even pair, cost-to-complete, dated programme, VAT, pari-passu.
- **Placeholder scan:** the Python schedule/metrics/validation modules are specified by port-rules + signatures rather than full listings — acceptable because the acceptance criterion (fixture parity + transliteration rules + hand-computed pence tests in both languages) is fully specified and machine-checkable. UI tasks 9–10 specify complete component contracts, section content, palette and behaviours; implementers read the existing components for idiom. No TBDs remain.
- **Type consistency check:** `AppraisalRun` fields (`inputs/schedule/model/metrics/validation/reconciliation`) used identically in T7–T13; `AppraisalResultV2` field names in T5 match T9/T10/T12's `CLIENT_METRIC_MAP`; `MonthlyModel.totals` keys used in T6/T9/T10 match T1's type; `runLedger(schedule, finance, equity_sources)` signature consistent across T4–T7 and the Python port.

## Execution handoff

Plan complete. Execute with superpowers:subagent-driven-development (fresh subagent per task, review between tasks) or superpowers:executing-plans (inline with checkpoints). Tasks 1–7 are strictly sequential; Task 11 can run in parallel with Tasks 8–10 once Task 7 is committed; Tasks 12–14 are sequential after both streams merge.

