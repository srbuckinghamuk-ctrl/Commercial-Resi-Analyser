import type { AnyCalculatorInputs } from './finance-types';
import type { SensitivityLever, SensitivityMetrics, MeasuredMetrics, LeverSetting } from './sensitivity';
import { InvalidBaseDocumentError, measure } from './sensitivity';
import { isProgrammeNetwork } from './programme';
import type { ProgrammeNetwork } from './programme';
import { computeCostPlan, developedAreaSqm } from './index';
import type { CostPlanInputs } from './cost-plan';

/**
 * The standard lender stress pack of spec §25: nine named stresses, each one
 * §12.5 cell of the base document, run through `sensitivity.measure`.
 *
 * Port of `app/financial_model/stress_pack.py`.
 */

export type StressKey =
  | 'unit_loss' | 'area_reduction' | 'abnormal_cost' | 'slower_absorption' | 'delayed_start'
  | 'yield_expansion' | 'lower_refi_ltv' | 'opex_vacancy' | 'risks_crystallise';

export interface StressDefinition {
  key: StressKey;
  label: string;
  // [lever, value]; a null value is DERIVED from the document (§25.3).
  settings: ReadonlyArray<readonly [SensitivityLever, number | null]>;
}

// §25.2. Closed, normative order, normative magnitudes.
export const STRESS_PACK: readonly StressDefinition[] = [
  { key: 'unit_loss', label: 'One unit lost', settings: [['saleable_area', null]] },
  { key: 'area_reduction', label: 'Saleable area -5%', settings: [['saleable_area', -5]] },
  { key: 'abnormal_cost', label: 'Abnormal cost +10%', settings: [['abnormal_cost', 10]] },
  { key: 'slower_absorption', label: 'Sales six months slower', settings: [['sales_slip', 6]] },
  { key: 'delayed_start', label: 'Start / PC six months late', settings: [['programme_slip', 6]] },
  { key: 'yield_expansion', label: 'Exit yield +100 bp', settings: [['exit_yield', 1]] },
  { key: 'lower_refi_ltv', label: 'Refinance LTV -10 pp', settings: [['refi_ltv', 10]] },
  {
    key: 'opex_vacancy', label: 'Opex +10%, vacancy +5 pp',
    settings: [['operating_cost', 10], ['vacancy', 5]],
  },
  {
    key: 'risks_crystallise', label: 'Recorded risks crystallise',
    settings: [['construction_cost', null], ['programme_slip', null]],
  },
];

/** §25.3: the same 12-dp rule package-timing.ts uses for the midpoint. */
const round12 = (x: number): number => Math.round(x * 1e12) / 1e12;

export interface StressSetting {
  lever: SensitivityLever;
  value: number;
  phase_id: null;  // always null: no pack lever carries a target
}

export interface StressDerivation {
  cost_impact_pence: number;
  base_build_pence: number;
  cost_pct: number | null;         // §25.3 p, or null when the cost half is inapplicable
  programme_impact_months: number;  // the SUM
  programme_impact_max_months: number | null;
  stated_item_count: number;        // assessed items with a non-null cost impact
}

export interface ResolvedStress {
  key: StressKey;
  label: string;
  settings: StressSetting[];
  derivation: StressDerivation | null;
  applicable: boolean;
  note: string | null;
}

export interface StressResult extends ResolvedStress {
  metrics: SensitivityMetrics;
  delta_profit_pence: number | null;
}

export interface StressPackResult {
  base: MeasuredMetrics;
  stresses: StressResult[];
}

// The notes, ASCII only, byte-identical in stress_pack.py.
export const NOTE_NO_UNITS = 'The unit mix is empty, so there is no saleable area to reduce.';
export const NOTE_NO_COST_PLAN = 'This document has no cost plan, so there is no abnormal contingency class to stress.';
export const NOTE_NO_ABNORMAL_PACKAGE = 'No package carries the abnormal contingency class, so the stress has nothing to attach to.';
export const NOTE_NO_LEDGER = 'No unit-sales ledger is modelled, so there is no completion date to slip.';
export const NOTE_NO_NETWORK = 'The programme is not a precedence network, so there is no phase to slip.';
export const NOTE_NO_INVESTMENT_CASE = 'No investment case is modelled, so there is no take-out to stress.';
export const NOTE_NO_COST_IMPACT = 'No assessed due-diligence item states a cost impact.';
export const NOTE_NO_BASE_BUILD = 'The base build is zero, so a cost impact has no base to scale.';
export const NOTE_NO_PROGRAMME_IMPACT = 'No assessed due-diligence item states a programme impact.';
export const NOTE_NO_NETWORK_FOR_IMPACT = 'The programme is not a precedence network, so the programme impact has no phase to slip.';

interface Facts {
  n_units: number;
  cost_plan: CostPlanInputs | null;
  has_abnormal_base: boolean;
  has_ledger: boolean;
  network: ProgrammeNetwork | null;
  has_investment_case: boolean;
  sum_cost: number;
  stated_item_count: number;
  sum_months: number;
  max_months: number | null;
  base_build: number;
}

function facts(inputs: AnyCalculatorInputs): Facts {
  const costPlan = 'cost_plan' in inputs ? inputs.cost_plan : null;
  const programme = 'programme' in inputs ? inputs.programme : null;
  const network = programme != null && isProgrammeNetwork(programme) && programme.phases.length > 0
    ? programme
    : null;
  const hasLedger = 'unit_sales' in inputs && inputs.unit_sales != null && inputs.unit_sales.units.length > 0;
  const items = 'due_diligence' in inputs ? inputs.due_diligence.items : [];
  const assessed = items.filter((i) => i.status === 'red' || i.status === 'amber');
  const costed = assessed.filter((i) => i.cost_impact_pence !== null);
  const months = assessed
    .map((i) => i.programme_impact_months)
    .filter((m): m is number => m !== null);
  const result = computeCostPlan(inputs, developedAreaSqm(inputs), inputs.unit_mix.units.length);

  return {
    n_units: inputs.unit_mix.units.length,
    cost_plan: costPlan,
    has_abnormal_base: costPlan !== null
      && costPlan.contingency.some((c) => c.name === 'abnormal')
      && (costPlan.mode === 'headline' || costPlan.packages.some((p) => p.contingency_class === 'abnormal')),
    has_ledger: hasLedger,
    network,
    has_investment_case: ('investment_case' in inputs ? inputs.investment_case : null) != null,
    sum_cost: costed.reduce((sum, i) => sum + (i.cost_impact_pence as number), 0),
    stated_item_count: costed.length,
    sum_months: months.reduce((sum, m) => sum + m, 0),
    max_months: months.length > 0 ? Math.max(...months) : null,
    base_build: result.base_build_pence,
  };
}

/**
 * §25.3 derivations and §25.4 applicability, from the base document alone. An
 * inapplicable stress keeps its fixed settings (no-ops by construction on
 * this document) and resolves its derived ones to 0, so it is still measured
 * and equals the base — design decision 10/11.
 */
export function resolveStress(inputs: AnyCalculatorInputs, definition: StressDefinition): ResolvedStress {
  const f = facts(inputs);
  const key = definition.key;
  let settings: StressSetting[] = [];
  let derivation: StressDerivation | null = null;
  const notes: string[] = [];
  let applicable = true;

  if (key === 'unit_loss' || key === 'area_reduction') {
    if (f.n_units === 0) {
      applicable = false;
      notes.push(NOTE_NO_UNITS);
    }
    let value = definition.settings[0][1];
    if (value === null) {
      value = f.n_units > 0 ? round12(-100 / f.n_units) : 0;
    }
    settings = [{ lever: 'saleable_area', value, phase_id: null }];
  } else if (key === 'abnormal_cost') {
    if (f.cost_plan === null) {
      applicable = false;
      notes.push(NOTE_NO_COST_PLAN);
    } else if (!f.has_abnormal_base) {
      applicable = false;
      notes.push(NOTE_NO_ABNORMAL_PACKAGE);
    }
    settings = [{ lever: 'abnormal_cost', value: 10, phase_id: null }];
  } else if (key === 'slower_absorption') {
    if (!f.has_ledger) {
      applicable = false;
      notes.push(NOTE_NO_LEDGER);
    }
    settings = [{ lever: 'sales_slip', value: 6, phase_id: null }];
  } else if (key === 'delayed_start') {
    if (f.network === null) {
      applicable = false;
      notes.push(NOTE_NO_NETWORK);
    }
    settings = [{ lever: 'programme_slip', value: 6, phase_id: null }];
  } else if (key === 'yield_expansion' || key === 'lower_refi_ltv' || key === 'opex_vacancy') {
    if (!f.has_investment_case) {
      applicable = false;
      notes.push(NOTE_NO_INVESTMENT_CASE);
    }
    settings = definition.settings.map(([lever, value]) => ({
      lever, value: value as number, phase_id: null,
    }));
  } else {
    // risks_crystallise
    const costOk = f.sum_cost > 0 && f.base_build > 0;
    if (f.sum_cost <= 0) {
      notes.push(NOTE_NO_COST_IMPACT);
    } else if (f.base_build <= 0) {
      notes.push(NOTE_NO_BASE_BUILD);
    }
    const monthsOk = f.sum_months > 0 && f.network !== null;
    if (f.sum_months <= 0) {
      notes.push(NOTE_NO_PROGRAMME_IMPACT);
    } else if (f.network === null) {
      notes.push(NOTE_NO_NETWORK_FOR_IMPACT);
    }
    const costPct = costOk ? round12((f.sum_cost / f.base_build) * 100) : null;
    applicable = costOk || monthsOk;
    derivation = {
      cost_impact_pence: f.sum_cost, base_build_pence: f.base_build, cost_pct: costPct,
      programme_impact_months: f.sum_months, programme_impact_max_months: f.max_months,
      stated_item_count: f.stated_item_count,
    };
    settings = [
      { lever: 'construction_cost', value: costOk ? (costPct as number) : 0, phase_id: null },
      { lever: 'programme_slip', value: monthsOk ? f.sum_months : 0, phase_id: null },
    ];
  }

  return {
    key, label: definition.label, settings, derivation, applicable,
    note: notes.length > 0 ? notes.join(' ') : null,
  };
}

/**
 * §25.2: nine cells plus the base. Throws `InvalidBaseDocumentError` on a
 * base that fails validation, exactly as `runSensitivity` does.
 */
export function runStressPack(inputs: AnyCalculatorInputs): StressPackResult {
  const base = measure(inputs, []);
  if (base.validation_errors.length > 0) {
    const messages = [...new Set(base.validation_errors.map((e) => e.message))];
    throw new InvalidBaseDocumentError(`Invalid base document: ${messages.join(' ')}`);
  }
  const stresses: StressResult[] = STRESS_PACK.map((definition) => {
    const resolved = resolveStress(inputs, definition);
    const settings: LeverSetting[] = resolved.settings.map((s) => (
      { lever: s.lever, phaseId: null, value: s.value }
    ));
    const m = measure(inputs, settings);
    const delta = m.profit_pence === null || base.profit_pence === null
      ? null
      : m.profit_pence - base.profit_pence;
    return { ...resolved, metrics: m, delta_profit_pence: delta };
  });
  return { base: base as MeasuredMetrics, stresses };
}
