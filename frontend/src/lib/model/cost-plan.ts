/** R10 spec §16. The cost plan: mode, packages, contingency classes, fee lines.
 *  `ConversionCostInputs` is shared with the v1 document shape, so this is a new
 *  block on CalculatorInputsV7 rather than an edit — the same reasoning as
 *  AcquisitionInputsV5 (R8) and UnitMixInputsV6 (R9). */

export type CostPlanMode = 'headline' | 'detailed';

/** The audit's own twelve packages (§7.5), plus `other`. A fixed enum plus a
 *  free `label` makes this a schedule — groupable and comparable across
 *  appraisals — while still admitting the line a scheme has that the enum does not. */
export type CostPackageCode =
  | 'enabling_strip_out_asbestos' | 'structure' | 'envelope' | 'roof_windows'
  | 'fire_acoustic_thermal' | 'mech_elec_public_health' | 'drainage_utilities'
  | 'lift' | 'partitions' | 'finishes' | 'common_parts' | 'externals' | 'other';

export const COST_PACKAGE_CODES: readonly CostPackageCode[] = [
  'enabling_strip_out_asbestos', 'structure', 'envelope', 'roof_windows',
  'fire_acoustic_thermal', 'mech_elec_public_health', 'drainage_utilities',
  'lift', 'partitions', 'finishes', 'common_parts', 'externals', 'other',
];

export type ContingencyClassName = 'general' | 'existing_building' | 'abnormal';

export const CONTINGENCY_CLASS_NAMES: readonly ContingencyClassName[] = [
  'general', 'existing_building', 'abnormal',
];

export interface CostPackage {
  id: string;
  code: CostPackageCode;
  label: string;
  amount_pence: number;
  /** Recorded but NOT live in R10 (spec §16.9): neither engine reads this field
   *  when resolving a contingency class's base. Scoping is driven solely by each
   *  ContingencyClass's own `basis` / `package_ids` — set nowhere in the product
   *  today, so every class currently applies to `all_packages`. Do not wire this
   *  in without reading §16.9 first; it changes contingency base resolution. */
  contingency_class: ContingencyClassName;
  /** R10 records this and computes `lender_eligible_base_pence` from it, but the
   *  ledger's draw cap does NOT read it. Wiring it to
   *  `development_cost_advance_pct` is R14. Do not assume this figure is live. */
  lender_eligible: boolean;
  notes: string;
}

export interface ContingencyClass {
  name: ContingencyClassName;
  pct: number;
  /** 'all_packages' — the whole base build, and the only meaningful option in
   *  headline mode, where there are no packages to name. */
  basis: 'all_packages' | 'selected_packages';
  package_ids: string[];
}

export type FeeBasis = 'fixed' | 'pct_of_base_build' | 'pct_of_construction_total';

export type FeeCode =
  | 'architect' | 'structural_engineer' | 'mande' | 'planning_consultant'
  | 'other_professional' | 'prior_approval' | 'cil_s106' | 'building_control' | 'other';

export type FeeCategory = 'professional' | 'statutory';

/** Spec §3.4. FIXED, not a user choice, and deliberately not what the field
 *  names suggest: `building_control` sits in the middle of the professional-fee
 *  block in ConversionCostInputs but both schedule modules count it in the
 *  STATUTORY total (§3.6). Classifying it as professional would move money
 *  between two separately-reported, separately-spread lines while leaving every
 *  total correct — invisible to any totals-based test. */
export const FEE_CODE_CATEGORY: Readonly<Record<Exclude<FeeCode, 'other'>, FeeCategory>> = {
  architect: 'professional',
  structural_engineer: 'professional',
  mande: 'professional',
  planning_consultant: 'professional',
  other_professional: 'professional',
  prior_approval: 'statutory',
  cil_s106: 'statutory',
  building_control: 'statutory',
};

export interface FeeLine {
  id: string;
  code: FeeCode;
  category: FeeCategory;
  label: string;
  basis: FeeBasis;
  /** basis 'fixed' → the amount. Hard-validated to 0 on a 'pct_*' basis, so a
   *  basis change cannot silently resurrect a stale figure. */
  amount_pence: number;
  /** basis 'pct_*' → the percentage. Hard-validated to 0 on 'fixed'. */
  pct: number;
  /** Preserves §3.6's `prior_approval_fee_per_dwelling × max(1, unit_count)`.
   *  Hard-validated false on any 'pct_*' basis. */
  per_dwelling: boolean;
}

export interface CostPlanInputs {
  mode: CostPlanMode;
  packages: CostPackage[];
  /** Exactly three, one per ContingencyClassName, in CONTINGENCY_CLASS_NAMES
   *  order. This is schema, not a user-managed list. */
  contingency: ContingencyClass[];
  fee_lines: FeeLine[];
}

export function defaultContingencyClasses(generalPct: number): ContingencyClass[] {
  return CONTINGENCY_CLASS_NAMES.map((name) => ({
    name,
    pct: name === 'general' ? generalPct : 0,
    basis: 'all_packages' as const,
    package_ids: [],
  }));
}

/** A new document starts in headline mode with no packages. The general
 *  contingency default (10%) matches DEFAULT_CONVERSION_COSTS.contingency_pct
 *  in conversion-defaults.ts; the fee lines are filled by
 *  defaultCalculatorInputsV7 (Task 12) from DEFAULT_CONVERSION_COSTS, so that
 *  one set of default fee figures exists rather than two. */
export const DEFAULT_COST_PLAN: CostPlanInputs = {
  mode: 'headline',
  packages: [],
  contingency: defaultContingencyClasses(10),
  fee_lines: [],
};

import type { ConversionCostInputs } from '../conversion-types';

/** Spec §4. Builds a cost plan from a pre-v7 document's flat cost fields.
 *  Used in two places, and it must be the SAME construction in both: the v6→v7
 *  migration (Task 5), and the engine's fallback for a document that has no
 *  `cost_plan` block at all. If the two ever diverge, migrating a document
 *  would change its figures — which is exactly what this release forbids.
 *
 *  No package schedule is synthesised. Splitting a headline figure into invented
 *  packages would be inventing evidence, the same reasoning that left R8's
 *  acquisition_date null and R9's bridge zeroed rather than back-derived. */
export function costPlanFromLegacyCosts(cc: ConversionCostInputs): CostPlanInputs {
  const fee = (
    code: Exclude<FeeCode, 'other'>, label: string, amount: number, perDwelling = false,
  ): FeeLine => ({
    id: `fee-${code}`,
    code,
    category: FEE_CODE_CATEGORY[code],
    label,
    basis: 'fixed',
    amount_pence: amount,
    pct: 0,
    per_dwelling: perDwelling,
  });
  return {
    mode: 'headline',
    packages: [],
    contingency: defaultContingencyClasses(cc.contingency_pct),
    fee_lines: [
      fee('architect', 'Architect', cc.architect_pence),
      fee('structural_engineer', 'Structural engineer', cc.structural_engineer_pence),
      fee('mande', 'M&E', cc.mande_pence),
      fee('planning_consultant', 'Planning consultant', cc.planning_consultant_pence),
      fee('other_professional', 'Other professional fees', cc.other_professional_fees_pence),
      fee('prior_approval', 'Prior approval fee', cc.prior_approval_fee_per_dwelling_pence, true),
      fee('cil_s106', 'CIL / S106', cc.cil_s106_pence),
      fee('building_control', 'Building control', cc.building_control_pence),
    ],
  };
}

import type { AnyCalculatorInputs } from './finance-types';

export interface CostPackageLine {
  id: string;
  code: CostPackageCode;
  label: string;
  amount_pence: number;
  contingency_class: ContingencyClassName;
  lender_eligible: boolean;
}

export interface ContingencyLine {
  name: ContingencyClassName;
  pct: number;
  basis: 'all_packages' | 'selected_packages';
  base_pence: number;
  amount_pence: number;
}

export interface FeeLineResult {
  id: string;
  code: FeeCode;
  category: FeeCategory;
  label: string;
  basis: FeeBasis;
  base_pence: number;
  amount_pence: number;
}

/** Spec §16. The ONLY shape the UI and the memo may read cost from. Every
 *  contingency and fee line reports its BASE as well as its amount — that is the
 *  audit's "show the base" discharged as data rather than prose. */
export interface CostPlanResult {
  mode: CostPlanMode;
  packages: CostPackageLine[];
  base_build_pence: number;
  contingency: ContingencyLine[];
  contingency_total_pence: number;
  compliance_pence: number;
  construction_total_pence: number;
  fees: FeeLineResult[];
  professional_total_pence: number;
  statutory_total_pence: number;
  /** R10 Task 13 (CARRIED-2). construction_total_pence + professional_total_pence +
   *  statutory_total_pence, computed once here so no component or memo has to sum
   *  three already-computed totals itself. Purely additive — moves no other figure. */
  conversion_total_pence: number;
  lender_eligible_base_pence: number;
  /** Display only; enters no calculation. null when the area is 0. */
  implied_rate_pence_per_sqm: number | null;
}

/** A pre-v7 document has no `cost_plan`, read structurally exactly like the
 *  codebase's other version dispatches (`'areas' in inputs`, `'programme' in inputs`).
 *
 *  The fallback DERIVES the plan from the document's own cost fields. It must not
 *  be `DEFAULT_COST_PLAN`: that carries no fee lines and a hardcoded 10%
 *  contingency, so once Task 7 makes the schedule read its totals from here,
 *  every unmigrated document would report ZERO professional fees and ZERO
 *  statutory costs. The golden fixtures run their native v6 documents without
 *  migrating (`golden-fixtures.test.ts` calls `runAppraisal(fx.inputs)` directly),
 *  so this is the difference between the identity gate passing and all twelve
 *  fixtures failing. */
function costPlanOf(inputs: AnyCalculatorInputs): CostPlanInputs {
  return 'cost_plan' in inputs && inputs.cost_plan != null
    ? inputs.cost_plan
    : costPlanFromLegacyCosts(inputs.conversion_costs);
}

export function computeCostPlan(
  inputs: AnyCalculatorInputs,
  areaSqm: number,
  unitCount: number,
): CostPlanResult {
  const plan = costPlanOf(inputs);
  const cc = inputs.conversion_costs;
  const detailed = plan.mode === 'detailed';

  const packages: CostPackageLine[] = plan.packages.map((p) => ({
    id: p.id, code: p.code, label: p.label, amount_pence: p.amount_pence,
    contingency_class: p.contingency_class, lender_eligible: p.lender_eligible,
  }));

  // Spec §1.1: the fractional-area product rounds once, at source.
  const baseBuild = detailed
    ? packages.reduce((s, p) => s + p.amount_pence, 0)
    : Math.round(cc.construction_cost_per_sqm_pence * areaSqm);

  // §3.2.1: in detailed mode compliance is priced inside the packages
  // (`fire_acoustic_thermal`). Counting the fields too would double count.
  const compliance = detailed
    ? 0
    : cc.fire_safety_pence + cc.sound_insulation_pence + cc.part_l_compliance_pence;

  const byId = new Map(plan.packages.map((p) => [p.id, p.amount_pence]));
  const contingency: ContingencyLine[] = plan.contingency.map((c) => {
    const base = c.basis === 'all_packages'
      ? baseBuild
      : c.package_ids.reduce((s, id) => s + (byId.get(id) ?? 0), 0);
    return {
      name: c.name, pct: c.pct, basis: c.basis,
      base_pence: base,
      amount_pence: Math.round((base * c.pct) / 100),
    };
  });
  // Sum of ROUNDED figures. Three allowances at 5% are not one at 15%.
  const contingencyTotal = contingency.reduce((s, c) => s + c.amount_pence, 0);

  const constructionTotal = baseBuild + contingencyTotal + compliance;

  // No fee basis includes fees, so this needs no ordering and no iteration.
  const fees: FeeLineResult[] = plan.fee_lines.map((f) => {
    const base = f.basis === 'pct_of_base_build' ? baseBuild
      : f.basis === 'pct_of_construction_total' ? constructionTotal
      : 0;
    const amount = f.basis === 'fixed'
      ? (f.per_dwelling ? f.amount_pence * Math.max(1, unitCount) : f.amount_pence)
      : Math.round((base * f.pct) / 100);
    return {
      id: f.id, code: f.code, category: f.category, label: f.label,
      basis: f.basis, base_pence: base, amount_pence: amount,
    };
  });

  const totalFor = (category: FeeCategory) =>
    fees.reduce((s, f) => s + (f.category === category ? f.amount_pence : 0), 0);
  const professionalTotal = totalFor('professional');
  const statutoryTotal = totalFor('statutory');

  return {
    mode: plan.mode,
    packages,
    base_build_pence: baseBuild,
    contingency,
    contingency_total_pence: contingencyTotal,
    compliance_pence: compliance,
    construction_total_pence: constructionTotal,
    fees,
    professional_total_pence: professionalTotal,
    statutory_total_pence: statutoryTotal,
    conversion_total_pence: constructionTotal + professionalTotal + statutoryTotal,
    lender_eligible_base_pence: packages.reduce(
      (s, p) => s + (p.lender_eligible ? p.amount_pence : 0), 0,
    ),
    implied_rate_pence_per_sqm: areaSqm > 0 ? Math.round(baseBuild / areaSqm) : null,
  };
}
