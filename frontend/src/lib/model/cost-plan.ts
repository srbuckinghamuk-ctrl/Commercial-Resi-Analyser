/** R10 spec §16. The cost plan: mode, packages, contingency classes, fee lines.
 *  `ConversionCostInputs` is shared with the v1 document shape, so this is a new
 *  block on CalculatorInputsV7 rather than an edit — the same reasoning as
 *  AcquisitionInputsV5 (R8) and UnitMixInputsV6 (R9). */

import type { VatOverride } from './vat';
import type { BenchmarkOrigin } from './elemental-benchmark';
import { pct } from './pct';
import { computePackageTiming } from './package-timing';
import { monthsBetween } from './due-diligence';

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

/** R15 spec §23.6. null = not classified (the migration default). */
export type PriceBasis = 'fixed_price' | 'provisional_sum' | 'estimate';
export const PRICE_BASIS_VALUES: readonly PriceBasis[] = ['fixed_price', 'provisional_sum', 'estimate'];

export interface CostPackage {
  id: string;
  code: CostPackageCode;
  label: string;
  amount_pence: number;
  /** R11 spec §17.8. Live: scopes this package into its contingency class's
   *  base in detailed mode. `general` always takes the whole base build
   *  regardless of tag; `existing_building` and `abnormal` take the sum of
   *  packages carrying that tag, as an ADDITION on top of general. Headline
   *  mode has no packages, so every class there takes the whole base build
   *  regardless of tag -- see computeCostPlan's contingency resolution. */
  contingency_class: ContingencyClassName;
  /** R10 records this; R14 (calc 2.13.0) WIRES it, R15b (spec §24.4) per-months
   *  it: clearing this flag on a package removes that package's own spend
   *  months from `uses[m].lender_eligible_construction_pence`, which shrinks
   *  the ledger's §4.2(b) advance cap in exactly those months and widens the
   *  funding gap. `lender_eligible_ratio` remains the disclosure figure and
   *  the denominator-zero fallback — it no longer drives the cap itself. Live
   *  in detailed mode only: headline mode has no packages, and its ratio is
   *  pinned to 1. */
  lender_eligible: boolean;
  notes: string;
  /** R11 spec 17.1. Detailed mode only -- hard-rejected in headline mode
   *  (validation, Task 9). null on every migrated line and on every line the
   *  user has not overridden. Read ONLY through resolveVatTreatment(). */
  vat_override: VatOverride | null;
  /** R12 spec §18.5. Overrides the category default for this line's spend
   *  window. null on every migrated row and on every line the user has not
   *  re-tagged; resolved ONLY through `resolvedPhaseId()` (Task 11). */
  phase_id: string | null;
  /** R15 spec §23.6. null = not classified (the migration default). Read only
   *  by computeCostPlan's price-basis summary. */
  price_basis: PriceBasis | null;
  /** R17 spec §27.1. Non-null only on a package the benchmark apply action
   *  created: which set, which rate, which element, when, by whom, and whether
   *  the set was currentised at the time. null on every migrated row and on
   *  every package a user typed. Carried through to the result line verbatim;
   *  read by the benchmark engine's `applied_without_currentisation` warning
   *  and by the apply action's duplicate guard — never by any total. */
  benchmark_origin: BenchmarkOrigin | null;
}

/** R11 spec §17.8. One mechanism: the package's own `contingency_class` tag.
 *  `basis` / `package_ids` were a second, unwritten mechanism (R10 carry-over)
 *  and are deleted from the INPUT here. The result type `ContingencyLine`
 *  keeps `basis`, now DERIVED by computeCostPlan rather than read from this
 *  type -- see its resolution block for the mode-dependent rule. */
export interface ContingencyClass {
  name: ContingencyClassName;
  pct: number;
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
  /** R11 spec 17.1. Detailed mode only -- hard-rejected in headline mode
   *  (validation, Task 9). null on every migrated line and on every line the
   *  user has not overridden. Read ONLY through resolveVatTreatment(). */
  vat_override: VatOverride | null;
  /** R12 spec §18.5. Overrides the category default for this line's spend
   *  window. null on every migrated row and on every line the user has not
   *  re-tagged; resolved ONLY through `resolvedPhaseId()` (Task 11). */
  phase_id: string | null;
}

export type QsStage = 'order_of_cost' | 'riba_2' | 'riba_3' | 'riba_4' | 'tender' | 'contract_sum';
export const QS_STAGES: readonly QsStage[] = ['order_of_cost', 'riba_2', 'riba_3', 'riba_4', 'tender', 'contract_sum'];
export type QsStatus = 'draft' | 'issued' | 'reviewed';
export const QS_STATUSES: readonly QsStatus[] = ['draft', 'issued', 'reviewed'];

/** R15b spec §24.3. The QS's tender-price inflation allowance, applied per
 *  package from `base_date` to that package's spend midpoint. */
export interface InflationAllowance {
  annual_pct: number;
}

/** R15 spec §23.6. Detailed mode only (validation rule 8). */
export interface QsProvenance {
  source: string;
  stage: QsStage;
  date: string;       // ISO yyyy-mm-dd
  status: QsStatus;
  base_date: string;  // ISO; R15b's inflation origin
  /** R15b spec §24.3. null = no allowance recorded, including every raw
   *  pre-v14 stored document (no key at all — the engine reads it as
   *  `qsInput.inflation ?? null`, so an absent key and an explicit null are
   *  the same "no allowance" fact). */
  inflation: InflationAllowance | null;
}

export interface CostPlanInputs {
  mode: CostPlanMode;
  packages: CostPackage[];
  /** Exactly three, one per ContingencyClassName, in CONTINGENCY_CLASS_NAMES
   *  order. This is schema, not a user-managed list. */
  contingency: ContingencyClass[];
  fee_lines: FeeLine[];
  /** R15 spec §23.6. null on every migrated document and on every plan the
   *  user has not entered a QS provenance record for. */
  qs: QsProvenance | null;
}

export function defaultContingencyClasses(generalPct: number): ContingencyClass[] {
  return CONTINGENCY_CLASS_NAMES.map((name) => ({
    name,
    pct: name === 'general' ? generalPct : 0,
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
  qs: null,
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
    vat_override: null,
    phase_id: null,
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
    qs: null,
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
  /** R12 spec §18.5. Carried straight through from the input line so
   *  schedule.ts's `resolvedPhaseId()` (Task 11) can read it without
   *  re-deriving the cost plan a second time. null on every migrated row and
   *  on every line the user has not re-tagged. */
  phase_id: string | null;
  /** R15b spec §24.2/§24.3. Fields appended, in order, from
   *  `computePackageTiming`'s `PackageTiming` plus the per-package inflation
   *  allowance. `resolved_phase_id` is the RESOLVED phase (network-aware);
   *  `phase_id` above keeps its raw-input meaning. `months_from_base` and
   *  `inflation_factor` are null when the QS has no `base_date`/allowance
   *  (or `acquisition_date` is unknown); `inflation_pence` is 0 in that case,
   *  never null — it always enters the additive construction total. */
  resolved_phase_id: string | null;
  start_month: number;
  finish_month: number;
  midpoint_month: number;
  months_from_base: number | null;
  inflation_factor: number | null;
  inflation_pence: number;
  /** R17 spec §27.1. Carried straight through from the input line (the
   *  `phase_id` treatment); null on every row the apply action did not create. */
  benchmark_origin: BenchmarkOrigin | null;
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
  /** R12 spec §18.5. Carried straight through from the input line so
   *  schedule.ts's `resolvedPhaseId()` (Task 11) can read it without
   *  re-deriving the cost plan a second time. null on every migrated row and
   *  on every line the user has not re-tagged. */
  phase_id: string | null;
}

/** R15 spec §23.6. Mirrors PriceBasisSummary in cost_plan.py, field for field
 *  and in order. `amount_pence` of every package summed by its `price_basis`
 *  tag; a package with no tag (null — the migration default) falls into
 *  `unclassified_pence`. The two coverage percentages are against
 *  `base_build_pence`, via the shared `pct` helper (2 dp, null when the
 *  denominator is 0). */
export interface PriceBasisSummary {
  fixed_price_pence: number;
  provisional_sums_pence: number;
  estimate_pence: number;
  unclassified_pence: number;
  fixed_price_coverage_pct: number | null;
  provisional_sums_pct: number | null;
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
  /** R14 spec §5 (§4.2(b) amended). `lender_eligible_base_pence / base_build_pence`
   *  as an UNROUNDED float, and 1 in headline mode or when `base_build_pence` is 0
   *  — headline mode has no packages to flag, so its eligible base is 0 against a
   *  non-zero base build, and the raw quotient would silently zero the ledger's
   *  whole construction cap base. Reported here so a reader can SEE the cap base
   *  rather than infer it; republished on `Schedule` so the ledger reads one
   *  figure and never re-derives it. The one rounding is on the product
   *  (`construction_pence × ratio`), in the ledger. */
  lender_eligible_ratio: number;
  /** Display only; enters no calculation. null when the area is 0. */
  implied_rate_pence_per_sqm: number | null;
  /** R15b spec §24.3. Sum of ROUNDED package lines, not a rounding of the
   *  sum; 0 in headline mode and whenever no package carries an allowance. */
  inflation_total_pence: number;
  /** pct(inflation_total_pence, base_build_pence) — the Costs page and memo
   *  print it; null when base build is 0. */
  inflation_pct_of_base_build: number | null;
  latest_midpoint_month: number | null;
  latest_midpoint_months_from_base: number | null;
  /** Math.floor of the line above; the flag message and the memo sentence
   *  print this integer, never the float. */
  latest_midpoint_whole_months_from_base: number | null;
  /** R15 spec §23.6. LAST two fields, both null in headline mode. `qs` is the
   *  input block republished verbatim — the cost plan is the one place the
   *  memo reads it from, so it never re-derives provenance from the raw
   *  input document. */
  price_basis: PriceBasisSummary | null;
  qs: QsProvenance | null;
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
  if ('cost_plan' in inputs && inputs.cost_plan != null) return inputs.cost_plan;
  // R16b: only a pre-v7 document reaches here, and only a pre-v7 document
  // carries the flat fee fields the seed reads. The cast is needed because
  // the `in`-narrowing leaves the V7+ members with a non-null `cost_plan` in
  // the else branch's type, so `tsc` still sees the V16 member here even
  // though it can never actually occur.
  return costPlanFromLegacyCosts(inputs.conversion_costs as ConversionCostInputs);
}

export function computeCostPlan(
  inputs: AnyCalculatorInputs,
  areaSqm: number,
  unitCount: number,
): CostPlanResult {
  const plan = costPlanOf(inputs);
  const cc = inputs.conversion_costs;
  const detailed = plan.mode === 'detailed';

  // R15b spec §24.3. Package timing, resolved once; the tender-price
  // inflation origin (qs.base_date -> acquisition_date) and allowance.
  // `qsInput` is gated on detailed mode: headline mode has no packages by
  // validation, and a stray `qs` left on a headline document must not leak
  // an allowance into a mode with nothing priced to inflate.
  const timing = computePackageTiming(inputs);
  const timingById = new Map(timing.map((t) => [t.id, t]));
  const acqDate = ('acquisition_date' in inputs.acquisition ? inputs.acquisition.acquisition_date : null) ?? null;
  const qsInput = detailed ? (plan.qs ?? null) : null;
  // R16 minor: a raw stored document's `qs` object may have no `base_date`
  // key at all (not merely blank) -- the read must not assume the key
  // exists.
  const baseDate = qsInput != null && typeof qsInput.base_date === 'string' && qsInput.base_date.trim() !== ''
    ? qsInput.base_date
    : null;
  // `?? null`: a raw pre-v14 stored document has no `inflation` key at all.
  const inflation = qsInput != null ? (qsInput.inflation ?? null) : null;
  // spec §24.7 rule 1 owns the error; the engine degrades rather than
  // overflowing. A non-finite or negative rate reads as `null` here — the
  // same "no allowance" state an absent `inflation` key produces — so
  // `factor`/`inflation_pence` fall to their null/0 defaults below instead of
  // computing `Math.pow`/`Math.round` on a NaN or Infinity. `months_from_base`
  // and the latest-midpoint fields do not read this value at all, so they are
  // unaffected and still published.
  const inflationRate = inflation != null && Number.isFinite(inflation.annual_pct) && inflation.annual_pct >= 0
    ? inflation.annual_pct
    : null;
  const baseToMonth0 = baseDate != null && acqDate != null ? monthsBetween(baseDate, acqDate) : null;

  const packages: CostPackageLine[] = plan.packages.map((p) => {
    const t = timingById.get(p.id);
    const start = t?.start_month ?? 0;
    const finish = t?.finish_month ?? 0;
    const midpoint = t?.midpoint_month ?? 0;
    const monthsFromBase = baseToMonth0 == null ? null : Math.max(0, baseToMonth0 + midpoint);
    const factor = inflationRate != null && monthsFromBase != null
      ? Math.pow(1 + inflationRate / 100, monthsFromBase / 12)
      : null;
    const inflationPence = factor == null ? 0 : Math.round(p.amount_pence * (factor - 1));
    return {
      id: p.id, code: p.code, label: p.label, amount_pence: p.amount_pence,
      contingency_class: p.contingency_class, lender_eligible: p.lender_eligible,
      // `?? null`, not a bare passthrough: a raw pre-R12 stored document (run
      // through the golden-fixture corpus's OWN inputs_version, unmigrated) has
      // no `phase_id` key on this line at all, so `p.phase_id` reads
      // `undefined` there -- and `undefined !== null` would make the v8->v9
      // migration identity gate fail on a field this release added, not on
      // anything the migration actually changed.
      phase_id: p.phase_id ?? null,
      resolved_phase_id: t?.phase_id ?? null,
      start_month: start, finish_month: finish, midpoint_month: midpoint,
      months_from_base: monthsFromBase, inflation_factor: factor, inflation_pence: inflationPence,
      // `?? null`: a raw pre-v17 stored document has no `benchmark_origin` key.
      benchmark_origin: p.benchmark_origin ?? null,
    };
  });

  // Spec §1.1: the fractional-area product rounds once, at source.
  const baseBuild = detailed
    ? packages.reduce((s, p) => s + p.amount_pence, 0)
    : Math.round(cc.construction_cost_per_sqm_pence * areaSqm);

  // R14 spec §5. Summed ONCE: both `lender_eligible_base_pence` and the ratio
  // the ledger's §4.2(b) cap base reads are this figure.
  const lenderEligibleBase = packages.reduce(
    (s, p) => s + (p.lender_eligible ? p.amount_pence : 0), 0,
  );

  // §3.2.1: in detailed mode compliance is priced inside the packages
  // (`fire_acoustic_thermal`). Counting the fields too would double count.
  const compliance = detailed
    ? 0
    : cc.fire_safety_pence + cc.sound_insulation_pence + cc.part_l_compliance_pence;

  // R11 spec §17.8. One mechanism: the package's own tag. `basis`/`package_ids`
  // are gone from the input; the result keeps `basis` as a DERIVED description of
  // the base, so the reported shape and every fixture's strings are unchanged.
  //
  // Headline mode gives every class the whole base build. There are no packages
  // to tag, and ConversionCostsPage renders all three percentages in both modes —
  // scoping by tag here would silently zero a live input path.
  const contingency: ContingencyLine[] = plan.contingency.map((c) => {
    const scoped = detailed && c.name !== 'general';
    const base = scoped
      ? packages.filter((p) => p.contingency_class === c.name)
          .reduce((s, p) => s + p.amount_pence, 0)
      : baseBuild;
    const basis: 'all_packages' | 'selected_packages' = scoped ? 'selected_packages' : 'all_packages';
    return {
      name: c.name, pct: c.pct, basis,
      base_pence: base,
      amount_pence: Math.round((base * c.pct) / 100),
    };
  });
  // Sum of ROUNDED figures. Three allowances at 5% are not one at 15%.
  const contingencyTotal = contingency.reduce((s, c) => s + c.amount_pence, 0);

  // R15b spec §24.3. Sum of ROUNDED package lines, not a rounding of the
  // sum. 0 in headline mode -- there are no packages to inflate, and a stray
  // headline package's own inflation_pence is already 0 (qsInput was forced
  // to null above).
  const inflationTotal = detailed ? packages.reduce((s, p) => s + p.inflation_pence, 0) : 0;

  const constructionTotal = baseBuild + inflationTotal + contingencyTotal + compliance;

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
      // See the matching comment on the package mapping above.
      phase_id: f.phase_id ?? null,
    };
  });

  const totalFor = (category: FeeCategory) =>
    fees.reduce((s, f) => s + (f.category === category ? f.amount_pence : 0), 0);
  const professionalTotal = totalFor('professional');
  const statutoryTotal = totalFor('statutory');

  // R15 spec §23.6. `p.price_basis ?? null`, not a bare read: a raw
  // pre-R15 stored document (run through the golden-fixture corpus's OWN
  // inputs_version, unmigrated) has no `price_basis` key on the line at all,
  // so it reads `undefined` there -- treated the same as an untagged v13
  // package (unclassified), not a fifth bucket.
  let priceBasis: PriceBasisSummary | null = null;
  let qs: QsProvenance | null = null;
  if (detailed) {
    const sumFor = (basis: PriceBasis) =>
      plan.packages.reduce((s, p) => s + ((p.price_basis ?? null) === basis ? p.amount_pence : 0), 0);
    const fixed = sumFor('fixed_price');
    const provisional = sumFor('provisional_sum');
    const estimate = sumFor('estimate');
    const unclassified = plan.packages.reduce(
      (s, p) => s + ((p.price_basis ?? null) === null ? p.amount_pence : 0), 0,
    );
    priceBasis = {
      fixed_price_pence: fixed,
      provisional_sums_pence: provisional,
      estimate_pence: estimate,
      unclassified_pence: unclassified,
      fixed_price_coverage_pct: pct(fixed, baseBuild),
      provisional_sums_pct: pct(provisional, baseBuild),
    };
    // Normalised so a raw pre-v14 document publishes the same shape as its
    // migrated twin (spec §24.8's no-exclusion gate; Python's model_dump does
    // the same).
    qs = plan.qs != null ? { ...plan.qs, inflation: plan.qs.inflation ?? null } : null;
  }

  // R15b spec §24.3. The latest package spend midpoint and its distance from
  // the QS base date -- printed by the flag/memo as a whole month.
  const latestMidpoint = packages.length === 0 ? null : Math.max(...packages.map((p) => p.midpoint_month));
  const latestFromBase = latestMidpoint == null || baseToMonth0 == null
    ? null : Math.max(0, baseToMonth0 + latestMidpoint);
  const latestWhole = latestFromBase == null ? null : Math.floor(latestFromBase);

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
    lender_eligible_base_pence: lenderEligibleBase,
    // R14 spec §5. Unrounded — the ONE rounding is on the product, in the ledger.
    lender_eligible_ratio: !detailed || baseBuild === 0 ? 1 : lenderEligibleBase / baseBuild,
    implied_rate_pence_per_sqm: areaSqm > 0 ? Math.round(baseBuild / areaSqm) : null,
    inflation_total_pence: inflationTotal,
    inflation_pct_of_base_build: pct(inflationTotal, baseBuild),
    latest_midpoint_month: latestMidpoint,
    latest_midpoint_months_from_base: latestFromBase,
    latest_midpoint_whole_months_from_base: latestWhole,
    price_basis: priceBasis,
    qs,
  };
}
