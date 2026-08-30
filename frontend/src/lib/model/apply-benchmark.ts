/**
 * Apply benchmark rows to the cost plan (R17, spec §27.3 "the seam", design
 * decision 4). A frontend-only DOCUMENT TRANSFORM: it edits `inputs`, and the
 * engine then prices the result like any other package. Python has no twin —
 * there is nothing to compute in parity, only a UI edit.
 *
 * Two steps, so the confirmation can list exactly what will happen:
 *
 *   planApplication(inputs, elementCodes, actor, now) -> ApplicationPlan
 *   applyBenchmark(inputs, plan)                      -> CalculatorInputsV17
 *
 * Rules (decision 4 and §27.3):
 *   - Refused outright (not warned) when there is no benchmark block, when the
 *     cost plan is headline mode, when the set has no currentisation date, or
 *     when a recorded `qs.base_date` differs from `currentisation_date` — the
 *     §24.3 engine inflates every package from `qs.base_date`, so a benchmark
 *     amount currentised to one date and inflated from another would carry a
 *     second forward step. A warning would let the double count through.
 *   - One new `benchmark_origin`-tagged draft package per applied element,
 *     `price_basis: 'estimate'`, coded by the catalogue's `default_package`.
 *   - Re-applying an element REPLACES the earlier benchmark-derived package
 *     with the same `element_code` (that is the duplicate guard); it never
 *     creates a second one.
 *   - A package without `benchmark_origin` is never touched: a selection's
 *     `target_cost_package_id` package is listed as blocked so the user sees
 *     the separate draft package sits beside it. A `fixed_price` target, or
 *     any element on a plan whose QS stage is `contract_sum`, blocks the apply
 *     for that element entirely.
 *   - When `qs` is null it is seeded with the currentisation date as its base
 *     date, so the seam holds on a plan that had no provenance yet.
 *   - The pre-change cost plan is retained (deep copy) on
 *     `elemental_benchmark.applications[]`.
 *
 * Pure: neither function mutates its arguments.
 */
import type { CalculatorInputsV17 } from './finance-types';
import type { CostPackage, CostPlanInputs, QsProvenance } from './cost-plan';
import { computeCostPlan } from './cost-plan';
import { developedAreaSqm } from './areas';
import {
  computeElementalBenchmark, ELEMENT_BY_CODE,
} from './elemental-benchmark';
import type {
  BenchmarkApplication, BenchmarkOrigin, ElementCode, ElementalBenchmarkResult, ElementalBenchmarkRow,
} from './elemental-benchmark';
import type { CostPackageCode } from './cost-plan';

export interface PlannedCreate {
  element_code: ElementCode;
  label: string;
  amount_pence: number;
  package_code: CostPackageCode;
}

export interface PlannedReplace {
  element_code: ElementCode;
  package_id: string;
  old_amount_pence: number;
  new_amount_pence: number;
}

export interface PlannedBlock {
  element_code: ElementCode;
  package_id: string | null;
  reason: string;
}

export interface ApplicationSeam {
  qs_base_date: string | null;
  currentisation_date: string | null;
  /** True when the plan's base date equals the currentisation date, when it
   *  is blank and will be filled with it, or when `qs` is null and will be
   *  seeded to it. */
  aligned: boolean;
  will_seed_qs: boolean;
}

export interface ApplicationPlan {
  refusal: string | null;
  creates: PlannedCreate[];
  replaces: PlannedReplace[];
  blocked: PlannedBlock[];
  seam: ApplicationSeam;
  /** Carried so `applyBenchmark` needs no second engine run. Internal. */
  readonly _rows: ReadonlyMap<ElementCode, ElementalBenchmarkRow>;
  readonly _result: ElementalBenchmarkResult | null;
  readonly _actor: string;
  readonly _now: string;
  readonly _element_codes: ElementCode[];
}

export const HEADLINE_REFUSAL = 'Apply requires the detailed cost plan; headline mode compares the total only.';
export const NO_BENCHMARK_REFUSAL = 'No benchmark set is attached to this document.';
export const NO_CURRENTISATION_DATE_REFUSAL =
  'The benchmark set has no currentisation date; set one before applying so the package inflation has a base date to run from.';
export const USER_PACKAGE_BLOCK_REASON = 'user-entered package; benchmark creates a separate draft package';
export const FIXED_PRICE_BLOCK_REASON = 'fixed-price package; a benchmark rate cannot replace or sit beside a fixed price';
export const CONTRACT_SUM_BLOCK_REASON = 'the QS stage is contract sum; benchmark rates cannot be applied to a contracted plan';
export const NO_ROW_BLOCK_REASON = 'no benchmark row for this element (no selection or no rate)';

export function baseDateRefusal(qsBaseDate: string, currentisationDate: string): string {
  return `The QS base date ${qsBaseDate} differs from the benchmark currentisation date ${currentisationDate}; `
    + 'align them before applying, or the package inflation would carry the benchmark from the wrong date.';
}

function blankToNull(s: string | null | undefined): string | null {
  return typeof s === 'string' && s.trim() !== '' ? s : null;
}

export function planApplication(
  inputs: CalculatorInputsV17,
  elementCodes: ElementCode[],
  actor: string,
  nowIso: string,
): ApplicationPlan {
  const block = inputs.elemental_benchmark;
  const plan = inputs.cost_plan;
  const qsBaseDate = blankToNull(plan.qs?.base_date);
  const currentisationDate = block == null ? null : blankToNull(block.set.currentisation_date);
  const willSeedQs = plan.qs == null;
  // A recorded qs with a BLANK base date is not a mismatch: apply fills the
  // blank with the currentisation date (the engine reads a blank as "no
  // inflation origin", so nothing was inflating from anywhere yet).
  const aligned = currentisationDate != null && (qsBaseDate == null || qsBaseDate === currentisationDate);
  const seam: ApplicationSeam = {
    qs_base_date: qsBaseDate, currentisation_date: currentisationDate, aligned, will_seed_qs: willSeedQs,
  };
  const codes = Array.from(new Set(elementCodes));
  const empty = (refusal: string): ApplicationPlan => ({
    refusal, creates: [], replaces: [], blocked: [], seam,
    _rows: new Map(), _result: null, _actor: actor, _now: nowIso, _element_codes: codes,
  });

  if (block == null) return empty(NO_BENCHMARK_REFUSAL);
  if (plan.mode !== 'detailed') return empty(HEADLINE_REFUSAL);
  if (currentisationDate == null) return empty(NO_CURRENTISATION_DATE_REFUSAL);
  if (qsBaseDate != null && qsBaseDate !== currentisationDate) {
    return empty(baseDateRefusal(qsBaseDate, currentisationDate));
  }

  const areaSqm = developedAreaSqm(inputs);
  const costPlan = computeCostPlan(inputs, areaSqm, inputs.unit_mix.units.length);
  const result = computeElementalBenchmark(inputs, costPlan, areaSqm);
  if (result == null) return empty(NO_BENCHMARK_REFUSAL);

  const rows = new Map<ElementCode, ElementalBenchmarkRow>();
  for (const row of result.rows) rows.set(row.element_code, row);
  const selectionByCode = new Map(block.selections.map((s) => [s.element_code, s]));
  const packageById = new Map(plan.packages.map((p) => [p.id, p]));
  const contractSum = plan.qs?.stage === 'contract_sum';

  const creates: PlannedCreate[] = [];
  const replaces: PlannedReplace[] = [];
  const blocked: PlannedBlock[] = [];

  for (const code of codes) {
    const entry = ELEMENT_BY_CODE.get(code);
    const row = rows.get(code);
    if (entry == null || row == null) {
      blocked.push({ element_code: code, package_id: null, reason: NO_ROW_BLOCK_REASON });
      continue;
    }
    if (contractSum) {
      blocked.push({ element_code: code, package_id: null, reason: CONTRACT_SUM_BLOCK_REASON });
      continue;
    }
    const own = plan.packages.find((p) => p.benchmark_origin != null && p.benchmark_origin.element_code === code);
    if (own != null) {
      if (own.price_basis === 'fixed_price') {
        blocked.push({ element_code: code, package_id: own.id, reason: FIXED_PRICE_BLOCK_REASON });
        continue;
      }
      replaces.push({
        element_code: code, package_id: own.id,
        old_amount_pence: own.amount_pence, new_amount_pence: row.benchmark_amount_pence,
      });
      continue;
    }
    const targetId = selectionByCode.get(code)?.target_cost_package_id ?? null;
    const target = targetId != null ? packageById.get(targetId) ?? null : null;
    if (target != null) {
      if (target.price_basis === 'fixed_price') {
        blocked.push({ element_code: code, package_id: target.id, reason: FIXED_PRICE_BLOCK_REASON });
        continue;
      }
      blocked.push({ element_code: code, package_id: target.id, reason: USER_PACKAGE_BLOCK_REASON });
    }
    creates.push({
      element_code: code, label: `${entry.label} (benchmark)`,
      amount_pence: row.benchmark_amount_pence, package_code: entry.default_package,
    });
  }

  return {
    refusal: null, creates, replaces, blocked, seam,
    _rows: rows, _result: result, _actor: actor, _now: nowIso, _element_codes: codes,
  };
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function applyBenchmark(inputs: CalculatorInputsV17, plan: ApplicationPlan): CalculatorInputsV17 {
  if (plan.refusal != null) throw new Error(plan.refusal);
  const block = inputs.elemental_benchmark;
  const result = plan._result;
  if (block == null || result == null) throw new Error(NO_BENCHMARK_REFUSAL);
  if (plan.creates.length === 0 && plan.replaces.length === 0) return inputs;

  const set = block.set;
  const nowIso = plan._now;
  const actor = plan._actor;
  const previous: CostPlanInputs = deepCopy(inputs.cost_plan);
  const originFor = (code: ElementCode): BenchmarkOrigin => ({
    kind: 'benchmark',
    set_id: set.id,
    set_content_hash: set.content_hash,
    benchmark_rate_id: plan._rows.get(code)?.benchmark_rate_id ?? null,
    element_code: code,
    applied_at: nowIso,
    applied_by: actor,
    currentisation_method: result.currentisation_method,
  });

  const replaceById = new Map(plan.replaces.map((r) => [r.package_id, r]));
  const packages: CostPackage[] = inputs.cost_plan.packages.map((p) => {
    const r = replaceById.get(p.id);
    if (r == null) return p;
    return { ...p, amount_pence: r.new_amount_pence, benchmark_origin: originFor(r.element_code) };
  });
  const createdIds: string[] = [];
  for (const c of plan.creates) {
    const id = crypto.randomUUID();
    createdIds.push(id);
    packages.push({
      id,
      code: c.package_code,
      label: c.label,
      amount_pence: c.amount_pence,
      contingency_class: 'general',
      lender_eligible: true,
      notes: `Created by the benchmark apply action from ${set.name} (${set.dataset_version})`,
      vat_override: null,
      phase_id: null,
      price_basis: 'estimate',
      benchmark_origin: originFor(c.element_code),
    });
  }

  const seamDate = plan.seam.currentisation_date ?? set.currentisation_date ?? '';
  const qs: QsProvenance | null = inputs.cost_plan.qs != null
    ? (blankToNull(inputs.cost_plan.qs.base_date) == null
      ? { ...inputs.cost_plan.qs, base_date: seamDate }
      : inputs.cost_plan.qs)
    : {
      source: `Benchmark-derived (${set.name})`,
      stage: 'order_of_cost',
      date: nowIso.slice(0, 10),
      status: 'draft',
      base_date: seamDate,
      inflation: null,
    };

  const application: BenchmarkApplication = {
    id: crypto.randomUUID(),
    applied_at: nowIso,
    applied_by: actor,
    set_id: set.id,
    set_content_hash: set.content_hash,
    element_codes: [...plan.creates.map((c) => c.element_code), ...plan.replaces.map((r) => r.element_code)],
    created_package_ids: createdIds,
    replaced_package_ids: plan.replaces.map((r) => r.package_id),
    previous_cost_plan: previous,
  };

  return {
    ...inputs,
    cost_plan: { ...inputs.cost_plan, packages, qs },
    elemental_benchmark: { ...block, applications: [...block.applications, application] },
  };
}
