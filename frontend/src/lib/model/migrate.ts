import type {
  CalculatorInputs, FinanceInputs, ProposedUnit, ProposedUnitV6, UnitMixInputsV6,
} from '../conversion-types';
import type {
  CalculatorInputsV2, CalculatorInputsV3, CalculatorInputsV4, CalculatorInputsV5,
  CalculatorInputsV6, CalculatorInputsV7,
  AcquisitionInputsV5, EquitySource, FacilityTerms, LenderValuation,
  ProgrammeInputs, SalesPhasingInputs, RefinanceInputs,
} from './finance-types';
import {
  calculateTotalAcquisitionCost, calculateTotalConstructionCost, calculateTotalProfessionalFees,
} from '../conversion-calc-engine';
import { DEFAULT_UNIT_ANCILLARY } from '../conversion-types';
import { DEFAULT_AREA_BRIDGE } from './areas';
import { defaultCalculatorInputsV2 } from '../conversion-defaults';
import { costPlanFromLegacyCosts } from './cost-plan';

function isV2(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV2 {
  return snapshot.inputs_version === 2 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/** A v3 document has the same finance shape as v2, discriminated by inputs_version === 3. */
export function isV3(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV3 {
  return snapshot.inputs_version === 3 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/** A v4 document has the same finance shape as v2/v3, discriminated by inputs_version === 4. */
export function isV4(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV4 {
  return snapshot.inputs_version === 4 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/** A v5 document has the same finance shape as v2–v4, discriminated by inputs_version === 5. */
export function isV5(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV5 {
  return snapshot.inputs_version === 5 && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/** A v6 document has the same finance shape as v2–v5, discriminated by
 *  inputs_version === 6. */
export function isV6(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV6 {
  return snapshot.inputs_version === 6
    && typeof snapshot.finance === 'object' && snapshot.finance !== null
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
    enforcement_cost_assumption_pence: 0,
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
    // v1 has no VAT block at all, so the chargeable consideration IS the price
    // (§17.7). Passed as the half-built document the accessor needs, rather than
    // by fabricating a branded number here.
    calculateTotalAcquisitionCost({ acquisition }) +
    // v1 migration runs before the areas block exists, so the manual field IS
    // the area here — passed explicitly rather than read inside the callee.
    calculateTotalConstructionCost(conversion_costs, conversion_costs.total_construction_sqm) +
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

/**
 * Normalises a v1, v2 or v3 snapshot to v3 — the shape every Task 8
 * UI/report consumer needed from Release 2b onward, so a component never had
 * to branch on the snapshot's saved version. v1/v2 snapshots route through
 * the existing migrateInputs() + migrateV2toV3() chain unchanged. A v3 snapshot
 * is merged onto v3 defaults field-by-field (mirroring migrateInputs' own
 * v2-merge branch above) so fields added to the schema after the snapshot was
 * saved get sane defaults instead of `undefined`, rather than being routed
 * through the v1 fallback path (which would misread a v3 `finance` object as
 * v1-shaped and silently produce garbage facility terms).
 *
 * A v4 document is refused (R3b): see the `isV4` guard below.
 */
export function migrateInputsToV3(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV3 {
  if (isV4(snapshot)) {
    // R3b: v4 documents carry programme/sales_phasing/refinance the UI can author.
    // Downgrading would silently discard them — hydrate with migrateInputsToV4.
    throw new Error('migrateInputsToV3: input is a v4 document — use migrateInputsToV4');
  }
  if (isV3(snapshot)) {
    const defaults = migrateV2toV3(defaultCalculatorInputsV2(project));
    const saved = snapshot as unknown as Partial<CalculatorInputsV3>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 3,
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
      lender_valuation: saved.lender_valuation ?? null,
    };
  }
  return migrateV2toV3(migrateInputs(snapshot, project));
}

/**
 * Upgrades a v2 document to v3 by stamping `inputs_version: 3` and adding the
 * (nullable) `lender_valuation` block. Every other field is carried across
 * unchanged -- this migration is purely additive (spec calc 2.1.0, design §B1:
 * outputs are unchanged while the block is absent).
 *
 * Precondition: `v2` must not already be a v3 document -- this guards against
 * double-migration (idempotence). Callers that don't know a document's version
 * should check with `isV2`/`isV3` (or the server's `is_v2_or_later`) first.
 *
 * If `v2` illegally already carries a `lender_valuation` key (e.g. a
 * hand-edited or partially-migrated row), it is passed through unchanged
 * rather than clobbered -- the type layer (or the caller) is responsible for
 * validating its shape.
 */
export function migrateV2toV3(v2: CalculatorInputsV2): CalculatorInputsV3 {
  if (isV3(v2 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV2toV3: input is already a v3 document');
  }
  const { inputs_version: _v2Version, ...rest } = v2;
  const existingLenderValuation = (v2 as unknown as { lender_valuation?: LenderValuation | null }).lender_valuation;
  return {
    ...rest,
    inputs_version: 3,
    lender_valuation: existingLenderValuation ?? null,
  };
}

/**
 * Normalises any stored snapshot (v1, v2, v3 or v4) to v4 -- the shape every
 * Task 4+ consumer needs from Release 3a onward. v1/v2/v3 snapshots route
 * through the existing migrateInputsToV3() + migrateV3toV4() chain unchanged.
 * A v4 snapshot is merged onto v4 defaults field-by-field (mirroring
 * migrateInputsToV3's own v3-merge branch above) so fields added to the
 * schema after the snapshot was saved get sane defaults instead of
 * `undefined`, rather than being routed through the v1 fallback path.
 */
export function migrateInputsToV4(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV4 {
  if (isV5(snapshot)) {
    throw new Error('migrateInputsToV4: input is a v5 document — use migrateInputsToV5');
  }
  if (isV4(snapshot)) {
    const defaults = migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project)));
    const saved = snapshot as unknown as Partial<CalculatorInputsV4>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 4,
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
      lender_valuation: saved.lender_valuation ?? null,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
    };
  }
  return migrateV3toV4(migrateInputsToV3(snapshot, project));
}

/**
 * Upgrades a v3 document to v4 by stamping `inputs_version: 4` and adding the
 * three (nullable) `programme` / `sales_phasing` / `refinance` blocks. Every
 * other field is carried across unchanged -- this migration is purely
 * additive (spec §6.1 / design §2.4: outputs are unchanged while all three
 * are null).
 *
 * Precondition: `v3` must not already be a v4 document -- this guards against
 * double-migration (idempotence), same as migrateV2toV3.
 *
 * If `v3` illegally already carries `programme` / `sales_phasing` /
 * `refinance` keys (e.g. a hand-edited or partially-migrated row), they are
 * passed through unchanged rather than clobbered -- the type layer (or the
 * caller) is responsible for validating their shape.
 */
export function migrateV3toV4(v3: CalculatorInputsV3): CalculatorInputsV4 {
  if (isV4(v3 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV3toV4: input is already a v4 document');
  }
  const { inputs_version: _v3Version, ...rest } = v3;
  const extra = v3 as unknown as {
    programme?: ProgrammeInputs | null;
    sales_phasing?: SalesPhasingInputs | null;
    refinance?: RefinanceInputs | null;
  };
  return {
    ...rest,
    inputs_version: 4,
    programme: extra.programme ?? null,
    sales_phasing: extra.sales_phasing ?? null,
    refinance: extra.refinance ?? null,
  };
}

/**
 * Upgrades a v4 document to v5 by stamping `inputs_version: 5` and adding the
 * acquisition block's six R8 fields. Purely additive, and deliberately so:
 * `england_ni` with unchanged bands means **no existing appraisal's computed
 * values move**. The jurisdiction is stamped `migrated_default` and
 * `unconfirmed` — a legacy document never told us where the property is, and
 * saying otherwise would be a claim the record does not support.
 *
 * `acquisition_date` is null rather than today's date: stamping a date the
 * transaction did not have would be inventing evidence, and a null is handled
 * explicitly downstream (`date_basis: 'assumed_current'`).
 */
export function migrateV4toV5(v4: CalculatorInputsV4): CalculatorInputsV5 {
  if (isV5(v4 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV4toV5: input is already a v5 document');
  }
  const { inputs_version: _v4Version, acquisition, ...rest } = v4;
  const existing = acquisition as Partial<AcquisitionInputsV5>;
  return {
    ...rest,
    inputs_version: 5,
    acquisition: {
      ...acquisition,
      jurisdiction: existing.jurisdiction ?? 'england_ni',
      jurisdiction_source: existing.jurisdiction_source ?? 'migrated_default',
      jurisdiction_evidence_status: existing.jurisdiction_evidence_status ?? 'unconfirmed',
      acquisition_date: existing.acquisition_date ?? null,
      acquisition_tax_override_pence: existing.acquisition_tax_override_pence ?? null,
      acquisition_tax_override_reason: existing.acquisition_tax_override_reason ?? '',
    },
  };
}

const RECOGNISED_INPUTS_VERSIONS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Normalises any stored snapshot (v1–v5) to v5. Mirrors migrateInputsToV4's
 * shape exactly: an already-v5 document is merged field-by-field onto v5
 * defaults so fields added after it was saved get sane values rather than
 * `undefined`; anything older routes through the existing chain.
 *
 * Task 10 fix round 2: mirrors migrate_inputs_to_v5's Python guard (added in
 * fix round 1) against two shapes that must be refused outright rather than
 * silently reaching the v1 fallback path below (which reads an unrecognised
 * document as noise and rebuilds `finance`/`equity_sources` from an
 * LTV-based heuristic -- exactly the corruption the isV5-vs-v4 guard in
 * migrateInputsToV4 already exists to stop, just for a different trigger):
 *
 * 1. An `inputs_version` this module does not implement at all (a future
 *    `6`, or a stray `99`) -- none of the isVN checks below are
 *    version-agnostic, so an unrecognised number satisfies none of them and
 *    falls all the way through undetected.
 * 2. A document declaring `inputs_version: 5` that nonetheless fails isV5's
 *    own structural check (`finance` missing `committed_net_facility_pence`,
 *    or not an object at all).
 *
 * A document declaring `inputs_version: 2`/`3`/`4` that fails ITS OWN
 * structural check is deliberately NOT covered by either rule: that is the
 * existing, permissive behaviour (falls through to the v1 legacy path) and
 * is left alone, exactly as in the Python port.
 */
export function migrateInputsToV5(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV5 {
  const version = snapshot.inputs_version;
  if (
    version !== undefined && version !== null
    && !RECOGNISED_INPUTS_VERSIONS.includes(version as number)
  ) {
    throw new Error(
      `migrateInputsToV5: unrecognised inputs_version ${JSON.stringify(version)} `
      + `(expected one of ${RECOGNISED_INPUTS_VERSIONS.join(', ')}, or absent for a v1 document)`,
    );
  }
  if (version === 5 && !isV5(snapshot)) {
    throw new Error(
      'migrateInputsToV5: inputs_version is 5 but the document fails the v5 structural check '
      + '(finance is not an object, or is missing committed_net_facility_pence) -- refusing to '
      + 'silently reinterpret it via the v1 fallback path',
    );
  }
  // Belt-and-braces, mirroring migrateInputsToV4's isV5 refusal (and the
  // Python twin). It is currently unreachable — RECOGNISED_INPUTS_VERSIONS
  // stops at 5, so a document tagged 6 has already thrown above — and it is
  // kept deliberately so that widening the roster can never quietly turn this
  // entry point into a v6 downgrader that drops `areas` and every unit's
  // `ancillary` block.
  if (isV6(snapshot)) {
    throw new Error('migrateInputsToV5: input is a v6 document — use migrateInputsToV6');
  }
  if (isV5(snapshot)) {
    const defaults = migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project))));
    const saved = snapshot as unknown as Partial<CalculatorInputsV5>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 5,
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
      lender_valuation: saved.lender_valuation ?? null,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
    };
  }
  return migrateV4toV5(migrateInputsToV4(snapshot, project));
}

/**
 * Upgrades a v5 document to v6 by stamping `inputs_version: 6`, adding a zeroed
 * area bridge on the **manual** basis, and giving every unit a zeroed ancillary
 * block.
 *
 * Purely additive, and deliberately so. `basis: 'manual'` means the cost area
 * stays `conversion_costs.total_construction_sqm` — the exact number the
 * document already used — so no migrated appraisal's computed values move. A
 * bridge is not synthesised from `total_construction_sqm`: inventing an
 * existing GIA the record never stated would be inventing evidence, the same
 * reasoning that leaves R8's `acquisition_date` null rather than stamping today.
 */
/**
 * Gives every unit a zeroed `ancillary` block, keeping any values a unit
 * already carries. Extracted because BOTH v6 write paths need it — the
 * migration below and `migrateInputsToV6`'s already-v6 merge branch — and
 * fix round 2 found the merge branch had been taking `saved.unit_mix` verbatim,
 * so a stored v6 unit missing `ancillary` kept a type-required field absent.
 * Python's twin default-fills it through `CalculatorInputsV6.model_validate`,
 * so the two engines disagreed on that document. One helper, both call sites.
 *
 * `unitMix` is optional for the same parity reason: `migrate_v5_to_v6` reads
 * `doc.get("unit_mix") or {}` and yields empty units for a document that has
 * none, where this used to throw on `unit_mix.units`.
 */
function unitsWithAncillary(unitMix: { units?: readonly ProposedUnit[] } | null | undefined): UnitMixInputsV6 {
  return {
    units: (unitMix?.units ?? []).map((u) => ({
      ...u,
      ancillary: {
        ...DEFAULT_UNIT_ANCILLARY,
        ...((u as Partial<ProposedUnitV6>).ancillary ?? {}),
      },
    })),
  };
}

export function migrateV5toV6(v5: CalculatorInputsV5): CalculatorInputsV6 {
  if (isV6(v5 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV5toV6: input is already a v6 document');
  }
  const { inputs_version: _v5Version, unit_mix, ...rest } = v5;
  const existingAreas = (v5 as unknown as Partial<CalculatorInputsV6>).areas;
  return {
    ...rest,
    inputs_version: 6,
    areas: { ...DEFAULT_AREA_BRIDGE, ...(existingAreas ?? {}) },
    unit_mix: unitsWithAncillary(unit_mix),
  };
}

const RECOGNISED_INPUTS_VERSIONS_V6: readonly number[] = [1, 2, 3, 4, 5, 6];

/**
 * Normalises any stored snapshot (v1–v6) to v6. Mirrors migrateInputsToV5's
 * shape exactly.
 *
 * The two refusals below are R8's hardest-won guard, carried forward. R8
 * shipped `migrateInputsToV4` without a v5 guard; a v5 document satisfied none
 * of the isVN checks, fell all the way through to the v1 fallback, and was
 * silently corrupted — fields dropped, a *confirmed* equity source replaced by
 * an unconfirmed stub with a different amount, the facility rebuilt from
 * `ltv_pct` — while returning 201. An unrecognised version must fail loudly.
 */
export function migrateInputsToV6(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV6 {
  const version = snapshot.inputs_version;
  if (
    version !== undefined && version !== null
    && !RECOGNISED_INPUTS_VERSIONS_V6.includes(version as number)
  ) {
    throw new Error(
      `migrateInputsToV6: unrecognised inputs_version ${JSON.stringify(version)} `
      + `(expected one of ${RECOGNISED_INPUTS_VERSIONS_V6.join(', ')}, or absent for a v1 document)`,
    );
  }
  if (version === 6 && !isV6(snapshot)) {
    throw new Error(
      'migrateInputsToV6: inputs_version is 6 but the document fails the v6 structural check '
      + '(finance is not an object, or is missing committed_net_facility_pence) -- refusing to '
      + 'silently reinterpret it via the v1 fallback path',
    );
  }
  if (isV6(snapshot)) {
    const defaults = migrateV5toV6(
      migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project)))),
    );
    const saved = snapshot as unknown as Partial<CalculatorInputsV6>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 6,
      areas: { ...defaults.areas, ...(saved.areas ?? {}) },
      acquisition: { ...defaults.acquisition, ...(saved.acquisition ?? {}) },
      // Fix round 2: default-filled per unit, not taken verbatim. A stored v6
      // unit that predates the ancillary block (or a hand-edited row) would
      // otherwise keep a type-required field absent here, where Python's
      // model_validate fills it — a silent cross-engine divergence.
      unit_mix: unitsWithAncillary(saved.unit_mix ?? defaults.unit_mix),
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
      lender_valuation: saved.lender_valuation ?? null,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
    };
  }
  return migrateV5toV6(migrateInputsToV5(snapshot, project));
}

/** A v7 document has the same finance shape as v2–v6, discriminated by
 *  inputs_version === 7. */
export function isV7(snapshot: Record<string, unknown>): snapshot is Record<string, unknown> & CalculatorInputsV7 {
  return snapshot.inputs_version === 7
    && typeof snapshot.finance === 'object' && snapshot.finance !== null
    && 'committed_net_facility_pence' in (snapshot.finance as object);
}

/**
 * R10 (spec §16). Adds the cost plan. Purely additive: an existing v6
 * document's `conversion_costs` is untouched, and the plan built from it via
 * `costPlanFromLegacyCosts` reproduces the same eight fee figures and the same
 * contingency percentage the document already had — so no migrated
 * appraisal's computed values move.
 */
export function migrateV6toV7(v6: CalculatorInputsV6): CalculatorInputsV7 {
  if (isV7(v6 as unknown as Record<string, unknown>)) {
    throw new Error('migrateV6toV7: input is already a v7 document');
  }
  const { inputs_version: _v6Version, ...rest } = v6;
  const existingPlan = (v6 as unknown as Partial<CalculatorInputsV7>).cost_plan;
  return {
    ...rest,
    inputs_version: 7,
    cost_plan: existingPlan ?? costPlanFromLegacyCosts(v6.conversion_costs),
  };
}

const RECOGNISED_INPUTS_VERSIONS_V7: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * Normalises any stored snapshot (v1–v7) to v7. Mirrors migrateInputsToV6's
 * shape exactly.
 *
 * The two refusals below are R8's hardest-won guard, carried forward. R8
 * shipped `migrateInputsToV4` without a v5 guard; a v5 document satisfied none
 * of the isVN checks, fell all the way through to the v1 fallback, and was
 * silently corrupted — fields dropped, a *confirmed* equity source replaced by
 * an unconfirmed stub with a different amount, the facility rebuilt from
 * `ltv_pct` — while returning 201. An unrecognised version must fail loudly.
 */
export function migrateInputsToV7(
  snapshot: Record<string, unknown>,
  project?: { id: string; price_pence: number; floor_area_sqm: number | null; floors?: number | null },
): CalculatorInputsV7 {
  const version = snapshot.inputs_version;
  if (
    version !== undefined && version !== null
    && !RECOGNISED_INPUTS_VERSIONS_V7.includes(version as number)
  ) {
    throw new Error(
      `migrateInputsToV7: unrecognised inputs_version ${JSON.stringify(version)} `
      + `(expected one of ${RECOGNISED_INPUTS_VERSIONS_V7.join(', ')}, or absent for a v1 document)`,
    );
  }
  if (version === 7 && !isV7(snapshot)) {
    throw new Error(
      'migrateInputsToV7: inputs_version is 7 but the document fails the v7 structural check '
      + '(finance is not an object, or is missing committed_net_facility_pence) -- refusing to '
      + 'silently reinterpret it via the v1 fallback path',
    );
  }
  if (isV7(snapshot)) {
    const defaults = migrateV6toV7(migrateV5toV6(
      migrateV4toV5(migrateV3toV4(migrateV2toV3(defaultCalculatorInputsV2(project)))),
    ));
    const saved = snapshot as unknown as Partial<CalculatorInputsV7>;
    return {
      ...defaults,
      ...saved,
      inputs_version: 7,
      areas: { ...defaults.areas, ...(saved.areas ?? {}) },
      acquisition: { ...defaults.acquisition, ...(saved.acquisition ?? {}) },
      unit_mix: unitsWithAncillary(saved.unit_mix ?? defaults.unit_mix),
      conversion_costs: { ...defaults.conversion_costs, ...(saved.conversion_costs ?? {}) },
      cost_plan: { ...defaults.cost_plan, ...(saved.cost_plan ?? {}) },
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
      lender_valuation: saved.lender_valuation ?? null,
      programme: saved.programme ?? null,
      sales_phasing: saved.sales_phasing ?? null,
      refinance: saved.refinance ?? null,
    };
  }
  return migrateV6toV7(migrateInputsToV6(snapshot, project));
}
