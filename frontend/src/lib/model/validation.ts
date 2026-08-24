import type {
  AcquisitionInputsV5, AnyCalculatorInputs, MonthlyModel, Schedule,
  RefinanceInputsV9, RefinanceInputsV10, SalesPhasingTrancheV9,
} from './finance-types';
import { MONITORING_CATEGORIES } from './finance-types';
import { OPEX_CODES, resolveStabilisationMonth } from './investment-case';
import { computeLenderGdv } from './lender-valuation';
import { unitAncillaryValuePence } from '../conversion-calc-engine';
// R9 fix wave: `selectBandSet` is restricted by the single-accessor guard
// (eslint.config.js) because it returns the raw band array. Validation's use is
// legitimate and narrow — it asks "can this date be placed in a band set at
// all?" and reports the answer as a ValidationIssue; it never reads `.bands`
// and never computes tax. Disabled at the call site rather than by adding
// validation.ts to the file allowlist, which would switch the cost-area
// selectors off for this file too.
// eslint-disable-next-line no-restricted-syntax -- see above; validation reports the date, it does not compute tax
import { regimeFor, selectBandSet } from '../tax/acquisition-tax';
import { areaBridge } from './areas';
import { computeCostPlan, FEE_CODE_CATEGORY } from './cost-plan';
import { VAT_CHARGE_CATEGORIES, isPurchaseVatChargeable, vatReturnPeriods } from './vat';
import { pct } from './pct';
import {
  isProgrammeNetwork, isLegacyProgramme, derivePhases, PRE_COMPLETION_CODES,
} from './programme';
import type { ProgrammeDerivation } from './programme';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

/**
 * ISO-8601 calendar date: right shape AND a date that exists (spec §14).
 *
 * R9 Task 12 clears an R8 carry-forward. Until this release both engines checked the
 * shape with a bare `/^\d{4}-\d{2}-\d{2}$/`, so `2026-02-31` validated cleanly and was
 * then accepted as `date_basis: 'transaction_date'` — a date the reader would take as
 * evidence of when the transaction happened. R8 recorded that as a known limitation
 * rather than fixing it; it is fixed here.
 *
 * The month/day round-trip is the check: constructing the date and reading the three
 * components back is the only way to get February and the leap-year rule right without
 * re-implementing the calendar. Two details keep it byte-identical to Python's
 * `datetime.date(y, m, d)` twin in validation.py:
 *   - `setUTCFullYear` after construction, because `Date.UTC` maps years 0–99 onto
 *     1900–1999 and would otherwise reject a 4-digit year Python accepts;
 *   - the explicit `y < 1` rejection, mirroring Python's `MINYEAR`.
 */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCFullYear(y);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
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

const NON_NEGATIVE_MONEY: Array<[string, (i: AnyCalculatorInputs) => number]> = [
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

export function validateInputs(inputs: AnyCalculatorInputs): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ severity: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ severity: 'warning', field, message });

  // R9 spec §15.6 — the area bridge, computed once and reused below. `areas`
  // is null for a pre-v6 document (no `areas` block at all), read structurally
  // exactly like the codebase's other version-dispatch checks (see
  // `'lender_valuation' in inputs` further down).
  const bridge = areaBridge(inputs);
  const areas = 'areas' in inputs ? inputs.areas : null;

  for (const [field, get] of NON_NEGATIVE_MONEY) {
    if (get(inputs) < 0) err(field, 'Monetary values cannot be negative.');
  }
  // Task-8 review correction: `developed_area_sqm` is the DERIVED cost area
  // under the bridge basis, so a negative value there is already reported by
  // the three derived-negative rules below against the field that actually
  // caused it. Reporting it again here, against a manual field the bridge-basis
  // user cannot even see, is gated out — this check is the manual basis's own
  // negative-input guard (and the legacy pre-v6 guard, where there is no
  // `areas` block to have a basis at all).
  if ((areas == null || areas.basis === 'manual') && bridge.developed_area_sqm < 0) {
    err('conversion_costs.total_construction_sqm', 'Area cannot be negative.');
  }
  // R10 Task 9: contingency_pct is now legacy (run.metrics.cost_plan.contingency
  // is the resolved figure), but this validates the raw manual/pre-v7 input, which
  // still exists and is still user-editable until Task 12 rebuilds the cost page.
  // eslint-disable-next-line no-restricted-syntax -- R10 Task 12 replaces this read
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
    if (e.classification !== 'cash' && e.amount_pence > 0) {
      warn(`equity_sources[${idx}]`, 'Non-cash equity (land/uplift/vendor/deferred) is recorded but not yet modelled as funding — Release 2; it does not fund monthly costs.');
    }
  }

  // R9 spec §15.6 — the area bridge. This block REPLACES the ±25% unit-NIA vs
  // construction-area warning that stood here until R9. That warning was a
  // proxy for a reconciliation the schema could not express; now that it can,
  // the proxy is deleted rather than kept alongside — a retired message left in
  // place is a second, quieter source of truth.
  if (areas != null) {
    for (const [field, value] of [
      ['existing_gia_sqm', areas.existing_gia_sqm],
      ['demolished_gia_sqm', areas.demolished_gia_sqm],
      ['extension_gia_sqm', areas.extension_gia_sqm],
      ['retained_commercial_gia_sqm', areas.retained_commercial_gia_sqm],
      ['untouched_gia_sqm', areas.untouched_gia_sqm],
      ['circulation_common_sqm', areas.circulation_common_sqm],
      ['plant_riser_sqm', areas.plant_riser_sqm],
      ['store_bin_cycle_sqm', areas.store_bin_cycle_sqm],
      ['amenity_sqm', areas.amenity_sqm],
      ['external_amenity_sqm', areas.external_amenity_sqm],
    ] as const) {
      if (value < 0) err(`areas.${field}`, 'Area cannot be negative.');
    }

    if (bridge.proposed_gia_sqm < 0) {
      err('areas.demolished_gia_sqm',
        `Demolished area (${areas.demolished_gia_sqm} m²) exceeds the existing building `
        + `(${areas.existing_gia_sqm} m²) — proposed GIA cannot be negative.`);
    }
    if (bridge.developed_gia_sqm < 0) {
      err('areas.retained_commercial_gia_sqm',
        `Retained commercial and untouched area together exceed proposed GIA `
        + `(${bridge.proposed_gia_sqm} m²) — developed area cannot be negative.`);
    }
    if (bridge.available_for_units_sqm < 0) {
      err('areas.circulation_common_sqm',
        `Circulation, plant, storage and amenity together exceed the developed area `
        + `(${bridge.developed_gia_sqm} m²) — no space remains for units.`);
    }
    if (areas.basis === 'bridge_derived' && bridge.developed_gia_sqm <= 0) {
      err('areas.existing_gia_sqm',
        'The bridge-derived cost basis is selected but the bridge produces no developed area — '
        + 'enter the building’s existing GIA, or switch the basis to manual.');
    }
    // Guarded on a positive developed area for the same reason the two
    // warnings below are: a zeroed bridge (basis manual, nothing entered —
    // exactly what migration writes for every pre-R9 document) means the
    // bridge is not in use at all, so a real unit schedule must not be judged
    // against a "0 m² building" nobody is reconciling against.
    if (bridge.developed_gia_sqm > 0 && bridge.unallocated_sqm < 0) {
      err('unit_mix.units',
        `Unit NIA (${bridge.unit_nia_sqm} m²) exceeds the area available for units `
        + `(${bridge.available_for_units_sqm} m²) — the schedule does not fit the building.`);
    }

    // Warnings only. An unallocated balance is frequently and legitimately
    // unknown at appraisal stage, so it never gates the document (spec §15.7).
    if (bridge.developed_gia_sqm > 0 && bridge.unallocated_sqm > bridge.developed_gia_sqm * 0.10) {
      warn('areas.unallocated_sqm',
        `${bridge.unallocated_sqm} m² of the developed area is unallocated `
        + `(${pct(bridge.unallocated_sqm, bridge.developed_gia_sqm)}%) — the bridge does not yet tie.`);
    }
    if (bridge.nia_to_gia_pct != null && (bridge.nia_to_gia_pct < 65 || bridge.nia_to_gia_pct > 90)) {
      warn('areas.nia_to_gia_pct',
        `Net-to-gross efficiency of ${bridge.nia_to_gia_pct}% is outside the 65–90% range `
        + 'typical of a conversion — check the area basis.');
    }
    if (areas.basis === 'manual' && bridge.developed_gia_sqm > 0) {
      const manual = bridge.manual_area_sqm;
      const diff = Math.abs(manual - bridge.developed_gia_sqm);
      if (diff > bridge.developed_gia_sqm * 0.05) {
        warn('areas.basis',
          `The manual construction area (${manual} m²) differs from the bridge's developed area `
          + `(${bridge.developed_gia_sqm} m²) by more than 5% — one of them is wrong, or the `
          + 'manual basis needs a reason.');
      }
    }
  }
  // R10 spec §16 — the cost plan. `cost_plan` is read structurally exactly like
  // `areas` above: a pre-v7 document has no cost_plan block at all and must not
  // gain errors from a block introduced this release.
  const cp = 'cost_plan' in inputs ? inputs.cost_plan : null;
  // R11 Task 9: hoisted out of the `if (cp != null)` block below so the VAT
  // warning further down ("registered: false with non-zero construction cost")
  // can read the resolved construction total without recomputing it.
  let resolvedCostPlan: ReturnType<typeof computeCostPlan> | null = null;
  // R12 §18.6/§18.8: hoisted so the sales_phasing/refinance anchor rules below
  // (which run after the programme block) can resolve `start(phase_id)` and
  // check anchor existence without re-deriving the network a second time.
  // `networkPhaseIds` is populated whenever `programme` is a v9 network,
  // regardless of whether it also has structural errors (an anchor can still
  // be checked for existence against the raw id set even when, say, a
  // different phase has a duplicate id). `programmeDerivation` is populated
  // ONLY when the network has no structural errors and no cycle — the same
  // gate the window rules use, because a tranche cannot resolve a month from
  // dates that do not exist.
  let networkPhaseIds: Set<string> = new Set();
  let programmeDerivation: ProgrammeDerivation | null = null;
  if (cp != null) {
    if (cp.mode === 'detailed') {
      if (cp.packages.length === 0) {
        err('cost_plan.packages', 'Detailed mode requires at least one cost package.');
      } else if (cp.packages.reduce((s, p) => s + p.amount_pence, 0) === 0) {
        err('cost_plan.packages', 'Detailed mode packages sum to zero — no construction cost is being priced.');
      }
    }
    if (cp.mode === 'headline' && cp.packages.length > 0) {
      err('cost_plan.mode', 'Headline mode does not use packages — remove them, or switch to detailed mode.');
    }

    cp.packages.forEach((p, idx) => {
      if (p.amount_pence < 0) err(`cost_plan.packages[${idx}].amount_pence`, 'Package amount cannot be negative.');
    });
    cp.contingency.forEach((c, idx) => {
      if (c.pct < 0) err(`cost_plan.contingency[${idx}].pct`, 'Contingency percentage cannot be negative.');
    });
    // Final review I3 (spec §16.5: "Any negative amount_pence or pct on a
    // package, contingency class OR fee line"). This third leg was missing --
    // Python enforces it at the schema (types.py FeeLine, Field(ge=0)), so a
    // negative fee was accepted by the client, computed into a total and shown
    // on screen, then rejected server-side with a raw pydantic 422 instead of
    // this module's own ValidationIssue message.
    cp.fee_lines.forEach((fl, idx) => {
      if (fl.amount_pence < 0) err(`cost_plan.fee_lines[${idx}].amount_pence`, 'Fee line amount cannot be negative.');
      if (fl.pct < 0) err(`cost_plan.fee_lines[${idx}].pct`, 'Fee line percentage cannot be negative.');
    });

    if (new Set(cp.packages.map((p) => p.id)).size !== cp.packages.length) {
      err('cost_plan.packages', 'Package ids must be unique.');
    }
    if (new Set(cp.fee_lines.map((f) => f.id)).size !== cp.fee_lines.length) {
      err('cost_plan.fee_lines', 'Fee line ids must be unique.');
    }

    const contingencyNames = cp.contingency.map((c) => c.name);
    if (cp.contingency.length !== 3 || new Set(contingencyNames).size !== contingencyNames.length) {
      err('cost_plan.contingency',
        'A cost plan must have exactly three contingency classes, one per class name, with no repeats.');
    }

    // R11 ruling R46. §17.8 made the package tag live: in detailed mode,
    // `existing_building`/`abnormal` resolve against Sigma(packages where
    // contingency_class === name), not the whole base build. A document can
    // carry a non-zero percentage on a class no package is tagged with --
    // ConversionCostsPage renders all three percentages in both modes, and new
    // packages default to `contingency_class: 'general'` -- so the resolved
    // base is silently zero. This is a WARNING, not an error: the rule that
    // used to catch this (a selected-packages contingency naming no packages
    // cannot carry a non-zero percentage) was deleted this release, and an
    // error here would repeat R38's defect -- a stored document already in
    // this state would acquire a hard error on migration, making
    // `report_safe` false and silently downgrading the report to DRAFT. Reads
    // `cost_plan`, which exists at v7 as well as v8, so this fires
    // identically before and after migration and does not touch the R38/R39
    // regression gate (which permits exactly one warning addition, on
    // `vat.registered`).
    if (cp.mode === 'detailed') {
      cp.contingency.forEach((c, idx) => {
        if (c.name === 'general') return;
        const hasTaggedPackage = cp.packages.some((p) => p.contingency_class === c.name);
        if (c.pct !== 0 && !hasTaggedPackage) {
          warn(`cost_plan.contingency[${idx}].pct`,
            `Contingency class '${c.name}' has a non-zero percentage (${c.pct}%) but no package `
            + `is tagged '${c.name}' — its resolved base is zero, so this contingency will `
            + 'compute to zero.');
        }
      });
    }

    // Spec §3.2.1: in detailed mode, compliance is priced inside the
    // fire_acoustic_thermal package (compute_cost_plan returns compliance_pence
    // 0 for detailed mode). A document carrying both would double-count that
    // money invisibly, so any non-zero flat compliance figure is a hard error
    // rather than being silently dropped by the engine.
    if (cp.mode === 'detailed') {
      const cc = inputs.conversion_costs;
      if (cc.fire_safety_pence !== 0) {
        err('conversion_costs.fire_safety_pence',
          'Detailed mode prices compliance inside the fire_acoustic_thermal package — fire_safety_pence must be zero to avoid double-counting.');
      }
      if (cc.sound_insulation_pence !== 0) {
        err('conversion_costs.sound_insulation_pence',
          'Detailed mode prices compliance inside the fire_acoustic_thermal package — sound_insulation_pence must be zero to avoid double-counting.');
      }
      if (cc.part_l_compliance_pence !== 0) {
        err('conversion_costs.part_l_compliance_pence',
          'Detailed mode prices compliance inside the fire_acoustic_thermal package — part_l_compliance_pence must be zero to avoid double-counting.');
      }
    }

    cp.fee_lines.forEach((fl, idx) => {
      if (fl.basis === 'fixed') {
        if (fl.pct !== 0) err(`cost_plan.fee_lines[${idx}].pct`, 'A fixed-basis fee line cannot carry a non-zero percentage.');
      } else {
        if (fl.amount_pence !== 0) {
          err(`cost_plan.fee_lines[${idx}].amount_pence`, 'A percentage-basis fee line cannot carry a non-zero fixed amount.');
        }
        if (fl.per_dwelling) {
          err(`cost_plan.fee_lines[${idx}].per_dwelling`, 'per_dwelling only applies to a fixed-basis fee line.');
        }
      }
      // Spec §3.4: building_control is FIXED as statutory despite sitting in the
      // professional-fee block of ConversionCostInputs. A wrong category moves
      // money between two separately-reported, separately-spread totals while
      // every grand total stays correct — invisible to any totals-based test.
      if (fl.code !== 'other' && fl.category !== FEE_CODE_CATEGORY[fl.code]) {
        err(`cost_plan.fee_lines[${idx}].category`,
          `Fee code '${fl.code}' must be categorised '${FEE_CODE_CATEGORY[fl.code]}'.`);
      }
    });

    // Warnings only — both need the resolved plan (base_build/base per fee
    // line), which is exactly what computeCostPlan already derives, so it is
    // reused here rather than re-implemented.
    const resolved = computeCostPlan(inputs, bridge.developed_area_sqm, inputs.unit_mix.units.length);
    resolvedCostPlan = resolved;
    if (resolved.base_build_pence > 0 && resolved.contingency_total_pence > resolved.base_build_pence * 0.5) {
      warn('cost_plan.contingency',
        `Contingency (${resolved.contingency_total_pence} pence) exceeds 50% of the base build cost `
        + `(${resolved.base_build_pence} pence) — check the packages or percentages.`);
    }
    resolved.fees.forEach((fee, idx) => {
      if (fee.basis !== 'fixed' && fee.base_pence === 0) {
        warn(`cost_plan.fee_lines[${idx}].basis`,
          'This fee line resolves against a zero base and will compute to zero.');
      }
    });
  }

  // R11 spec §17.7 / §17.9 (ruling R27). Chargeability is a fact about the
  // VENDOR; recovery is a fact about the BUYER. `vat.registered: false` is the
  // engine's inert switch and the migration default — it is NOT a statement
  // that the buyer is unregistered, and it must not be read as one.
  //
  // In the colliding state the model holds that VAT is due while
  // `resolveVatTreatment` returns the inert 0% row, so
  // `chargeableConsiderationPence` collapses back to the exclusive price and the
  // acquisition tax is charged on a base that excludes VAT — the exact
  // under-report §17.7 exists to remove, in the case where it costs MOST,
  // because a buyer who cannot recover it bears the whole amount.
  //
  // The rejected alternative was sourcing `rate_pct` independently of
  // `registered`. Identity-safe, but it makes one field mean two things in two
  // places, and this release exists partly to stop that. Read structurally, like
  // `cost_plan` and `areas` above: a pre-v8 document has no `vat` block at all.
  const vatInputs = 'vat' in inputs ? inputs.vat : null;
  if (vatInputs != null
      && !vatInputs.registered
      && isPurchaseVatChargeable(vatInputs.purchase)) {
    err('vat.registered',
      'Purchase VAT is chargeable (the vendor has opted to tax and TOGC does not apply), '
      + 'but the VAT engine is switched off, so the acquisition tax would be charged on the '
      + 'VAT-exclusive price. Set vat.registered to true and give the acquisition treatment '
      + 'row the applicable rate. If the buyer cannot recover that VAT, set '
      + "recoverable_pct: 0 and recovery_basis: 'blocked' — that models the position exactly: "
      + 'VAT charged, none recovered, and the acquisition tax on the VAT-inclusive '
      + 'consideration.');
  }

  // R11 spec §17.9 (Task 9). Every rule below is specified for a SET of
  // fields — R10 twice shipped a rule covering three fields with a test named
  // for one, leaving two unguarded while the suite looked complete. Each rule
  // here loops its own field set rather than checking a single representative
  // one. Gated on `vatInputs != null` throughout: a pre-v8 document has no
  // `vat` block at all and must produce no VAT issue, full stop.
  if (vatInputs != null) {
    // Single structural read of `treatments`, reused by every check below —
    // none of them resolve a charge or apply the override-over-category
    // precedence (that stays resolveVatTreatment's alone, spec §17.2), so one
    // exemption here covers the whole rule set rather than one per call site.
    // eslint-disable-next-line no-restricted-syntax -- structural shape/bounds validation only (spec §17.9); never resolves a charge, so it does not re-implement resolveVatTreatment's precedence
    const treatments = vatInputs.treatments;

    // Fix round 1 (Ruling R35): computed here, ahead of the override loop
    // below, so the zero-rated-sale warning can fire on an OVERRIDE's own
    // recovery_basis in the same pass that already extracts it — a
    // VatOverride carries its own recovery_basis, so the identical unsafe
    // assumption (full recovery on a zero-rated first grant while retaining a
    // unit for exempt residential letting) is expressible there too, and a
    // scan of `treatments` alone never sees it.
    const retainsAUnit = inputs.exit_strategy.route === 'retain_all'
      || (inputs.exit_strategy.route === 'blended' && inputs.exit_strategy.retained_units.length > 0);

    // Override in headline mode, rate_pct/recoverable_pct bounds, and the
    // zero-rated-sale-with-retained-units warning — one pass over packages,
    // one over fee lines, each reading `vat_override` exactly once into a
    // local for the same reason as the `treatments` exemption above.
    let anyOverrideNonZeroRate = false;
    if (cp != null) {
      cp.packages.forEach((p, idx) => {
        // eslint-disable-next-line no-restricted-syntax -- see the `treatments` exemption above; same structural-validation reasoning for the override object
        const override = p.vat_override;
        if (override == null) return;
        if (override.rate_pct !== 0) anyOverrideNonZeroRate = true;
        if (cp.mode === 'headline') {
          err(`cost_plan.packages[${idx}].vat_override`,
            'A VAT override only applies in detailed mode — headline mode has no packages '
            + 'to override. Remove the override, or switch to detailed mode.');
        }
        if (override.rate_pct < 0 || override.rate_pct > 100) {
          err(`cost_plan.packages[${idx}].vat_override.rate_pct`, 'VAT override rate must be between 0 and 100%.');
        }
        if (override.recoverable_pct < 0 || override.recoverable_pct > 100) {
          err(`cost_plan.packages[${idx}].vat_override.recoverable_pct`,
            'VAT override recoverable percentage must be between 0 and 100%.');
        }
        if (retainsAUnit && override.recovery_basis === 'zero_rated_sale') {
          warn(`cost_plan.packages[${idx}].vat_override.recovery_basis`,
            'This override is recovered on the basis of a zero-rated first grant, but the exit '
            + 'strategy retains at least one unit. Retained residential letting is an exempt '
            + 'supply, so full recovery here is unsafe — check whether the recoverable '
            + 'proportion should be restricted.');
        }
      });
      cp.fee_lines.forEach((fl, idx) => {
        // eslint-disable-next-line no-restricted-syntax -- see the `treatments` exemption above; same structural-validation reasoning for the override object
        const override = fl.vat_override;
        if (override == null) return;
        if (override.rate_pct !== 0) anyOverrideNonZeroRate = true;
        if (cp.mode === 'headline') {
          err(`cost_plan.fee_lines[${idx}].vat_override`,
            'A VAT override only applies in detailed mode — headline mode has no fee lines '
            + 'to override individually. Remove the override, or switch to detailed mode.');
        }
        if (override.rate_pct < 0 || override.rate_pct > 100) {
          err(`cost_plan.fee_lines[${idx}].vat_override.rate_pct`, 'VAT override rate must be between 0 and 100%.');
        }
        if (override.recoverable_pct < 0 || override.recoverable_pct > 100) {
          err(`cost_plan.fee_lines[${idx}].vat_override.recoverable_pct`,
            'VAT override recoverable percentage must be between 0 and 100%.');
        }
        if (retainsAUnit && override.recovery_basis === 'zero_rated_sale') {
          warn(`cost_plan.fee_lines[${idx}].vat_override.recovery_basis`,
            'This override is recovered on the basis of a zero-rated first grant, but the exit '
            + 'strategy retains at least one unit. Retained residential letting is an exempt '
            + 'supply, so full recovery here is unsafe — check whether the recoverable '
            + 'proportion should be restricted.');
        }
      });
    }

    // rate_pct / recoverable_pct out of 0..100 on every treatment row.
    treatments.forEach((t, idx) => {
      if (t.rate_pct < 0 || t.rate_pct > 100) {
        err(`vat.treatments[${idx}].rate_pct`, 'VAT rate must be between 0 and 100%.');
      }
      if (t.recoverable_pct < 0 || t.recoverable_pct > 100) {
        err(`vat.treatments[${idx}].recoverable_pct`, 'Recoverable percentage must be between 0 and 100%.');
      }
    });

    // `treatments` must hold exactly the six VAT_CHARGE_CATEGORIES, once each,
    // in the declared order — schema, not a user-managed list (spec §17.1).
    const categories = treatments.map((t) => t.category);
    const shapeOk = categories.length === VAT_CHARGE_CATEGORIES.length
      && VAT_CHARGE_CATEGORIES.every((c, i) => categories[i] === c);
    if (!shapeOk) {
      err('vat.treatments',
        'Treatments must be exactly the six VAT charge categories, once each, in order: '
        + `${VAT_CHARGE_CATEGORIES.join(', ')}.`);
    }

    // --- The two RETURN-CYCLE bounds. Both gated on `registered` (ruling R38,
    // spec §17.11). A field that parameterises a DORMANT engine is not
    // validated: with `registered: false` no return period is ever computed, so
    // there is no cycle to be out of bounds.
    //
    // This is not a softening. It is the fix for a shipped defect. The
    // migration gives EVERY document a `vat` block carrying
    // `first_period_end_month: 2`, so ungated these rules turned every stored
    // appraisal with `term_months <= 2` into a hard error on migration — and a
    // hard error makes `report_safe` false, which marks the report DRAFT. An
    // "inert" migration would have silently downgraded every short-term
    // appraisal in the database.
    //
    // The bounds that stay UNCONDITIONAL above are the ones that are nonsense
    // in any state: a negative rate, a negative recoverable proportion, a
    // treatments array that is not the six categories. A document that later
    // registers gets these two errors then, which is the right moment for them.
    if (vatInputs.registered) {
      // first_period_end_month must sit inside the modelled term.
      if (vatInputs.first_period_end_month < 0 || vatInputs.first_period_end_month >= f.term_months) {
        err('vat.first_period_end_month',
          `First period end month must be between 0 and ${f.term_months - 1}.`);
      }

      // repayment_lag_months: HMRC's payment window, capped at a documented
      // maximum rather than left open-ended.
      if (vatInputs.repayment_lag_months < 0 || vatInputs.repayment_lag_months > 6) {
        err('vat.repayment_lag_months', 'Repayment lag must be between 0 and 6 months.');
      }
    }

    // §17.3: where TOGC applies, purchase VAT is nil regardless of the option
    // to tax — that is the whole effect of a TOGC, and it must not be
    // expressible as "TOGC applies AND the acquisition rate is non-zero".
    const acqIdx = treatments.findIndex((t) => t.category === 'acquisition');
    if (acqIdx !== -1
        && vatInputs.purchase.togc_treatment === 'applies'
        && treatments[acqIdx].rate_pct !== 0) {
      err(`vat.treatments[${acqIdx}].rate_pct`,
        'Where TOGC applies, purchase VAT is nil regardless of the option to tax — the '
        + "acquisition treatment row's rate must be 0.");
    }

    // --- Warnings. Each carries real domain content, and each belongs on
    // `run.validation` (this function's return), never on `reconcile().issues`
    // (see the module note above `validateInputs`: that channel carries only
    // errors, bar one `'model'` warning). ---

    // The zero-rated first grant is what makes input VAT recoverable;
    // retained residential letting is EXEMPT, so full recovery is unsafe.
    // This is the single most likely real-world VAT error the model can catch.
    // (`retainsAUnit` itself is computed above, ahead of the override loop,
    // which also checks a package/fee-line override's own recovery_basis.)
    if (retainsAUnit) {
      treatments.forEach((t, idx) => {
        if (t.recovery_basis === 'zero_rated_sale') {
          warn(`vat.treatments[${idx}].recovery_basis`,
            'This category is recovered on the basis of a zero-rated first grant, but the exit '
            + 'strategy retains at least one unit. Retained residential letting is an exempt '
            + 'supply, so full recovery here is unsafe — check whether the recoverable '
            + 'proportion should be restricted.');
        }
      });
    }

    // Possible, but then the TOGC changes nothing and the finding is probably
    // mis-entered.
    if (vatInputs.purchase.togc_treatment === 'applies' && !vatInputs.purchase.vendor_opted_to_tax) {
      warn('vat.purchase.togc_treatment',
        'TOGC is marked as applying, but the vendor has not opted to tax — TOGC treatment '
        + 'changes nothing where there is no option to tax to disapply, so this is probably '
        + 'entered in error.');
    }

    // The engine is inert and the funding need is being reported as zero.
    if (!vatInputs.registered && (resolvedCostPlan?.construction_total_pence ?? 0) !== 0) {
      warn('vat.registered',
        'The VAT engine is switched off (vat.registered: false), but this document has a '
        + 'non-zero construction cost. Input VAT on construction and fees will be reported as '
        + 'zero throughout, including any that would otherwise be recoverable.');
    }

    // Ruling R4: derived from vatReturnPeriods(vat, term_months) — an INPUT
    // derivation — never from the RESULT field vat.receivable_at_maturity_pence,
    // which validateInputs cannot see (it takes inputs only). Gated on a
    // non-zero resolved rate so this cannot fire on a registered document that
    // charges nothing: a zero-rated document has nothing to reclaim, in or out
    // of term.
    const anyNonZeroRate = treatments.some((t) => t.rate_pct !== 0) || anyOverrideNonZeroRate;
    if (vatInputs.registered && anyNonZeroRate) {
      const periods = vatReturnPeriods(vatInputs, f.term_months);
      const finalPeriod = periods[periods.length - 1];
      if (finalPeriod != null && finalPeriod.reclaim_month == null) {
        warn('vat.repayment_lag_months',
          'The final VAT return period\'s reclaim falls outside the modelled term and will not '
          + 'appear in the cash flow — consider a shorter term, a shorter repayment lag, or '
          + 'reporting the balance as a receivable.');
      }
    }
  }

  if (inputs.exit_strategy.route === 'blended' && inputs.exit_strategy.retained_units.length === 0) {
    warn('exit_strategy.retained_units', 'Blended exit selected but no units are marked as retained.');
  }
  if (f.requires_confirmation) {
    warn('finance', 'Facility terms were migrated from a legacy appraisal and require confirmation.');
  }

  // Lender-underwritten GDV (spec §3.2, Release 2b Task 3). Only present on v3
  // inputs; v2 callers (pre-migration UI/report paths) have no lender_valuation
  // field at all and skip this block entirely.
  if ('lender_valuation' in inputs && inputs.lender_valuation != null) {
    const lv = inputs.lender_valuation;
    if (lv.reason.trim().length === 0) err('lender_valuation.reason', 'Lender valuation reason is required.');
    if (lv.author.trim().length === 0) err('lender_valuation.author', 'Lender valuation author is required.');
    if (lv.date.trim().length === 0) err('lender_valuation.date', 'Lender valuation date is required.');

    // Task-1-review addition: pence-valued bases must be whole, non-negative pence
    // (global_pct/unit_type adjustments are percentages and may be fractional/negative).
    if ((lv.basis === 'global_per_sqft' || lv.basis === 'fixed_amount') && lv.global_value != null) {
      if (!Number.isInteger(lv.global_value) || lv.global_value < 0) {
        err('lender_valuation.global_value',
          'Lender valuation global_value must be a non-negative whole number of pence for this basis.');
      }
    }
    if (lv.basis === 'per_unit' && lv.per_key_values != null) {
      for (const [id, value] of Object.entries(lv.per_key_values)) {
        if (!Number.isInteger(value) || value < 0) {
          err(`lender_valuation.per_key_values[${id}]`,
            'Lender valuation per_key_values value must be a non-negative whole number of pence for this basis.');
        }
      }
    }

    // Every other hard error (missing global_value, missing per_unit id, a
    // computed/absolute unit value that isn't positive) is computeLenderGdv's own
    // domain — catching its thrown message here keeps the wording identical to
    // what the compute path enforces instead of a second, driftable copy of the
    // same logic.
    try {
      computeLenderGdv(inputs);
    } catch (e) {
      err('lender_valuation', e instanceof Error ? e.message : 'Lender valuation could not be computed.');
    }
  }

  // Spec §3.18: RLV = GDV / (1 + target/100) − cost-excluding-land. A target of exactly
  // -100% divides by zero; below -100% flips the sign and produces a non-finite/nonsensical
  // RLV. Approved in Task 5 review: guard this at validation time rather than let RLV emit
  // Infinity/NaN downstream.
  if (inputs.deal_spider.target_profit_on_cost_pct <= -100) {
    err('deal_spider.target_profit_on_cost_pct', 'Target profit on cost must be greater than -100% — this value makes the residual land value calculation non-finite.');
  }

  // Spec §6 (Release 3a): explicit programme windows must sit inside [0, term-2] —
  // the schedule's programme arm only clamps the upper bound, so a negative
  // start_offset or an oversized window must be caught here as a hard error.
  // R12 (spec §18.1): `programme` is a two-state field across the version union —
  // the legacy `{ packages: {...} }` shape (v4-v8) or a v9 precedence network
  // (`{ phases: [...] }`). `isLegacyProgramme` narrows to the legacy shape this
  // block validates.
  if ('programme' in inputs && inputs.programme != null) {
    if (isProgrammeNetwork(inputs.programme)) {
      // R12 (spec §18.8). Real rules for the v9 precedence network, replacing
      // the Task 4 scaffolding placeholder. Order matters: the id/dependency/
      // scalar rules run FIRST and gate `derivePhases` — a network with a
      // dangling reference or a fractional field has already produced its
      // error, and deriving it anyway would report a second, confusing one.
      // A cycle (found only once the gate above is clear) reports ONLY the
      // cycle error and skips every window rule: dates do not exist for a
      // phase inside a cycle.
      const net = inputs.programme;
      const term = Math.max(1, Math.floor(inputs.finance.term_months));
      const phaseField = (id: string) => `programme.phases.${id}`;

      if (net.phases.length === 0) {
        err('programme.phases', 'A programme network must have at least one phase.');
      }

      const allIds = new Set(net.phases.map((p) => p.id));
      networkPhaseIds = allIds;
      const seenIds = new Set<string>();
      let structuralOk = true;

      for (const p of net.phases) {
        const field = phaseField(p.id);

        if (seenIds.has(p.id)) {
          err(field, `Duplicate phase id "${p.id}".`);
          structuralOk = false;
        }
        seenIds.add(p.id);

        if (!Number.isFinite(p.duration_months) || !Number.isInteger(p.duration_months)) {
          err(field, `Phase '${p.id}' duration_months must be a whole number of months.`);
          structuralOk = false;
        } else if (p.duration_months < 0) {
          err(field, `Phase '${p.id}' duration_months cannot be negative.`);
          structuralOk = false;
        }

        if (!Number.isFinite(p.start_offset) || !Number.isInteger(p.start_offset)) {
          err(field, `Phase '${p.id}' start_offset must be a whole number of months.`);
          structuralOk = false;
        } else if (p.start_offset < 0) {
          err(field, `Phase '${p.id}' start_offset cannot be negative.`);
          structuralOk = false;
        }

        // §18.2: slip_months is SIGNED (a negative slip is legal acceleration)
        // but must still be a whole number — Python's json.loads would
        // otherwise accept a fractional or non-finite value straight off the
        // wire.
        if (!Number.isFinite(p.slip_months) || !Number.isInteger(p.slip_months)) {
          err(field, `Phase '${p.id}' slip_months must be a whole number of months.`);
          structuralOk = false;
        }

        for (const d of p.predecessors) {
          if (d.phase_id === p.id) {
            err(field, `Phase '${p.id}' cannot depend on itself.`);
            structuralOk = false;
          } else if (!allIds.has(d.phase_id)) {
            err(field, `Phase '${p.id}' has a dependency on "${d.phase_id}", but there is no phase with id "${d.phase_id}".`);
            structuralOk = false;
          }
          if (!Number.isFinite(d.lag_months) || !Number.isInteger(d.lag_months)) {
            err(field, `Phase '${p.id}' has a dependency on "${d.phase_id}" whose lag_months must be a whole number of months.`);
            structuralOk = false;
          } else if (d.lag_months < 0) {
            err(field, `Phase '${p.id}' has a dependency on "${d.phase_id}" whose lag_months cannot be negative.`);
            structuralOk = false;
          }
        }

        // §6.1's four user_defined rules, unchanged, now evaluated per phase.
        if (p.curve.kind === 'user_defined') {
          const w = p.curve.weights;
          if (w.length !== p.duration_months) err(field, 'user_defined weights must have one entry per window month.');
          if (w.some((x) => !Number.isFinite(x))) err(field, 'user_defined weights must be finite numbers.');
          if (w.some((x) => x < 0)) err(field, 'user_defined weights cannot be negative.');
          if (w.reduce((a, b) => a + b, 0) <= 0) err(field, 'user_defined weights must sum to more than zero.');
        }
      }

      // §18.5: category_phase_ids is required whenever `programme` is a
      // network, and must name a real, non-milestone phase — a milestone
      // occupies no month and cannot carry spend.
      const milestoneIds = new Set(net.phases.filter((p) => p.duration_months === 0).map((p) => p.id));
      (['construction', 'professional', 'statutory'] as const).forEach((cat) => {
        const id = net.category_phase_ids[cat];
        const field = `programme.category_phase_ids.${cat}`;
        if (!allIds.has(id)) {
          err(field, `category_phase_ids.${cat} references phase "${id}", but there is no phase with id "${id}".`);
        } else if (milestoneIds.has(id)) {
          err(field, `category_phase_ids.${cat} references phase "${id}", which is a milestone and cannot carry spend.`);
        }
      });

      // §18.5: a detailed-mode line's `phase_id` override is the same rule —
      // absent phase or milestone — applied to the cost side of the
      // resolution. Read through `cp`, computed above; this does not need
      // `derivePhases` either, only the phase catalogue.
      if (cp != null) {
        cp.packages.forEach((p, idx) => {
          if (p.phase_id == null) return;
          const field = `cost_plan.packages[${idx}].phase_id`;
          if (!allIds.has(p.phase_id)) {
            err(field, `Cost package '${p.id}' is tagged to phase "${p.phase_id}", but there is no phase with id "${p.phase_id}".`);
          } else if (milestoneIds.has(p.phase_id)) {
            err(field, `Cost package '${p.id}' is tagged to phase "${p.phase_id}", which is a milestone and cannot carry spend.`);
          }
        });
        cp.fee_lines.forEach((fl, idx) => {
          if (fl.phase_id == null) return;
          const field = `cost_plan.fee_lines[${idx}].phase_id`;
          if (!allIds.has(fl.phase_id)) {
            err(field, `Fee line '${fl.id}' is tagged to phase "${fl.phase_id}", but there is no phase with id "${fl.phase_id}".`);
          } else if (milestoneIds.has(fl.phase_id)) {
            err(field, `Fee line '${fl.id}' is tagged to phase "${fl.phase_id}", which is a milestone and cannot carry spend.`);
          }
        });
      }

      if (structuralOk) {
        const derivation = derivePhases(net);
        if ('cycle' in derivation) {
          // §18.1: a cycle has no topological order and no defensible default
          // start for a phase inside it — a hard error naming the cycle in
          // order, not a generic "invalid programme".
          err('programme.phases', `Phase dependency cycle: ${derivation.cycle.join(' → ')}.`);
        } else {
          programmeDerivation = derivation;
          const globalFinish = derivation.finish_month;

          for (const dp of derivation.phases) {
            const field = phaseField(dp.id);
            const isMilestone = dp.duration_months === 0;

            // §18.1/§18.8: over-acceleration below month 0 is a hard error
            // naming the phase — never silently clamped (the R5 defect).
            if (dp.start_month < 0) {
              err(field, `Phase '${dp.id}' resolves to start month ${dp.start_month}, before month 0 (over-acceleration).`);
            }

            // Overrun — ALL phases. The first clause ("Programme finishes
            // month N") is a fact about the whole programme, so it always
            // quotes the GLOBAL finish; the second clause names THIS phase,
            // so its overrun quantity must be THIS phase's own — fix round 1,
            // Finding 1: a non-terminal breaching phase (finish(p) > term but
            // finish(p) < globalFinish) previously had the global overrun
            // (belonging to whichever phase sets globalFinish) spliced into
            // its own sentence, which understates or overstates its true
            // lateness whenever it is not the phase defining the programme's
            // end.
            const overrunBreach = isMilestone ? dp.start_month > term - 1 : dp.finish_month > term;
            if (overrunBreach) {
              const ownOverrun = isMilestone ? dp.start_month - (term - 1) : dp.finish_month - term;
              err(field, `Programme finishes month ${globalFinish}; facility term is ${term}. Phase '${dp.label}' ends ${ownOverrun} months after maturity.`);
            }

            // Sale tail — the PRE-COMPLETION codes only (spec §6.1's existing
            // rule and message, unchanged, so the v8->v9 migration-identity
            // alias holds on message as well as field). `other` gets only the
            // weaker overrun rule above.
            if (PRE_COMPLETION_CODES.includes(dp.code)) {
              const tailBreach = isMilestone ? dp.start_month > term - 2 : dp.finish_month > term - 1;
              if (tailBreach) {
                err(field, `Package must finish by month ${term - 2} — the final two months are the sale tail (spec §6).`);
              }
            }
          }
        }
      }
    } else if (isLegacyProgramme(inputs.programme)) {
      const programme = inputs.programme;
      const term = Math.max(1, Math.floor(inputs.finance.term_months));
      for (const [name, pkg] of Object.entries(programme.packages)) {
        const field = `programme.packages.${name}`;
        if (pkg.duration_months < 1) err(field, 'Package duration must be at least 1 month.');
        if (pkg.start_offset < 0) err(field, 'Package start month cannot be negative.');
        // CRITICAL 1b: the schedule's programme arm floors both fields (spec §6.1
        // window rules assume whole months) but never rejects a fractional value
        // itself — a typed "2.5" duration reaches buildSchedule un-floored and can
        // throw. Caught here as its own rule, alongside (not replacing) the
        // range checks above.
        if (!Number.isInteger(pkg.duration_months)) err(field, 'Package duration must be a whole number of months.');
        if (!Number.isInteger(pkg.start_offset)) err(field, 'Package start month must be a whole month.');
        if (pkg.start_offset + pkg.duration_months - 1 > term - 2) {
          err(field, `Package must finish by month ${term - 2} — the final two months are the sale tail (spec §6).`);
        }
        if (pkg.curve.kind === 'user_defined') {
          const w = pkg.curve.weights;
          if (w.length !== pkg.duration_months) err(field, 'user_defined weights must have one entry per window month.');
          // Finiteness must be checked explicitly: NaN passes every other rule here
          // (NaN < 0 is false, and a sum containing NaN is never <= 0) and then
          // poisons the spread. Python's json.loads accepts literal NaN/Infinity, so
          // the mirrored rule in validation.py is what keeps a hostile payload from
          // reaching build_schedule and 500-ing there.
          if (w.some((x) => !Number.isFinite(x))) err(field, 'user_defined weights must be finite numbers.');
          if (w.some((x) => x < 0)) err(field, 'user_defined weights cannot be negative.');
          if (w.reduce((a, b) => a + b, 0) <= 0) err(field, 'user_defined weights must sum to more than zero.');
        }
      }
    }
  }
  if ('sales_phasing' in inputs && inputs.sales_phasing != null) {
    const term = Math.max(1, Math.floor(inputs.finance.term_months));
    const trs = inputs.sales_phasing.tranches;
    if (inputs.exit_strategy.route === 'retain_all') {
      err('sales_phasing', 'Phased sales apply to the sold portion — a retain-all exit has none. Remove the block or change the exit route.');
    }
    if (trs.length === 0) err('sales_phasing', 'Phased sales need at least one tranche.');
    // R12 spec §18.6: `anchor` only exists on a v9 tranche; `'anchor' in tr`
    // reads it without narrowing the whole union, matching this file's
    // existing pattern for version-gated fields (e.g. `'jurisdiction' in
    // inputs.acquisition` below). `resolvedTrancheMonth` returns null when
    // the month cannot be resolved — an anchor naming an absent phase (own
    // error, reported separately below) or a network that failed to derive
    // (structural error or cycle, own error, reported above) — so the
    // ordering check does not manufacture a second, confusing error on top
    // of the first.
    const resolvedTrancheMonth = (tr: (typeof trs)[number]): number | null => {
      const anchor = 'anchor' in tr ? (tr as SalesPhasingTrancheV9).anchor : null;
      if (anchor == null) return tr.month_offset;
      if (programmeDerivation == null) return null;
      const dp = programmeDerivation.byId[anchor.phase_id];
      return dp ? dp.start_month + anchor.offset_months : null;
    };
    trs.forEach((tr, i) => {
      const field = `sales_phasing.tranches[${i}]`;
      if (!Number.isInteger(tr.month_offset) || tr.month_offset < 0 || tr.month_offset > term - 1) {
        err(field, `Tranche month must be a whole month between 0 and ${term - 1}.`);
      }
      if (!Number.isFinite(tr.pct_of_gross_receipts) || tr.pct_of_gross_receipts <= 0) {
        err(field, 'Tranche percentage must be a finite number greater than zero.');
      }
      const anchor = 'anchor' in tr ? (tr as SalesPhasingTrancheV9).anchor : null;
      if (anchor != null && !networkPhaseIds.has(anchor.phase_id)) {
        err(`${field}.anchor`, `Tranche anchor references phase "${anchor.phase_id}", but there is no phase with id "${anchor.phase_id}".`);
      }
      // §18.6/§18.8: the resolved months, not the entered ones — an anchor
      // on a phase that later slips can cross a neighbouring tranche even
      // though the two `month_offset`s (or anchors) were entered in order.
      if (i > 0) {
        const prevMonth = resolvedTrancheMonth(trs[i - 1]);
        const curMonth = resolvedTrancheMonth(tr);
        if (prevMonth != null && curMonth != null && !(curMonth > prevMonth)) {
          err(field, 'Tranche months must be strictly increasing.');
        }
      }
    });
    const pctSum = trs.reduce((a, b) => a + b.pct_of_gross_receipts, 0);
    if (trs.length > 0 && !(Math.abs(pctSum - 100) <= 1e-9)) {
      err('sales_phasing', `Tranche percentages must sum to 100 (currently ${pctSum}).`);
    }
  }
  if ('refinance' in inputs && inputs.refinance != null) {
    const term = Math.max(1, Math.floor(inputs.finance.term_months));
    const rf = inputs.refinance;
    if (inputs.exit_strategy.route === 'sell_all') {
      err('refinance', 'Refinance applies to the retained portion — a sell-all exit retains nothing. Remove the block or change the exit route.');
    }
    if (!Number.isInteger(rf.month_offset) || rf.month_offset < 0 || rf.month_offset > term - 1) {
      err('refinance', `Refinance month must be a whole month between 0 and ${term - 1}.`);
    }
    // R13 spec §19.7 rule 5 owns investment_value_pence/ltv_pct in full,
    // below, in the investment-case block (it needs `investment_case` in
    // scope, which this block does not have). Task 4's temporary range-only
    // guards stood here (`!= null && (!Number.isFinite(...) || ...)`,
    // field 'refinance'); rule 5 below MOVES that range check under the
    // specific field names, alongside the presence/absence checks it adds —
    // not duplicating it here, which is what would leave two overlapping
    // checks on one field. The range check itself is not optional: the v4-v9
    // explicit-pair path (`v4 refinance validation` below) still asserts
    // `investment_value_pence: -1` and `ltv_pct: 0/101` are hard errors, and
    // rule 5's own brief text (which shows only the null checks) would have
    // silently dropped that if followed literally — flagged per this
    // release's standing instruction rather than silently reconciled.
    if (!Number.isFinite(rf.arrangement_fee_pence) || rf.arrangement_fee_pence < 0) {
      err('refinance', 'Refinance arrangement fee must be zero or more.');
    }
    if (!Number.isFinite(rf.legal_costs_pence) || rf.legal_costs_pence < 0) {
      err('refinance', 'Refinance legal costs must be zero or more.');
    }
    // R12 spec §18.6: `anchor` only exists on a v9 refinance block.
    const rfAnchor = 'anchor' in rf ? (rf as RefinanceInputsV9).anchor : null;
    if (rfAnchor != null && !networkPhaseIds.has(rfAnchor.phase_id)) {
      err('refinance.anchor', `Refinance anchor references phase "${rfAnchor.phase_id}", but there is no phase with id "${rfAnchor.phase_id}".`);
    }
  }

  // R13b spec §22.7. The per-unit sales ledger. Structurally read, like every
  // post-v2 block: a v2-v11 document has no `unit_sales` key and stays inert.
  const unitSales = 'unit_sales' in inputs ? inputs.unit_sales : null;
  const salesPhasingBlock = 'sales_phasing' in inputs ? inputs.sales_phasing : null;
  if (unitSales != null && salesPhasingBlock != null) {
    // Rule 1 — on BOTH fields (§16.1's exclusion shape).
    const msg = 'Per-unit sales and phased sales cannot both be set — remove one.';
    err('unit_sales', msg);
    err('sales_phasing', msg);
  }
  if (unitSales != null) {
    const term = Math.max(1, Math.floor(inputs.finance.term_months));
    const route = inputs.exit_strategy.route;
    if (route === 'retain_all') {
      err('unit_sales', 'Per-unit sales apply to the sold portion — a retain-all exit has none. Remove the block or change the exit route.');
    }
    if (unitSales.deposit_release !== 'held_to_completion' && unitSales.deposit_release !== 'released_on_exchange') {
      err('unit_sales.deposit_release', 'deposit_release must be held_to_completion or released_on_exchange.');
    }

    const allIds = inputs.unit_mix.units.map((u) => u.id);
    const retainedIds = new Set(inputs.exit_strategy.retained_units.map((r) => r.unit_id));
    const soldIds = route === 'retain_all' ? [] : inputs.unit_mix.units
      .filter((u) => route === 'sell_all' || !retainedIds.has(u.id))
      .map((u) => u.id);
    // Rule 3, both directions, four messages.
    const seen = new Set<string>();
    unitSales.units.forEach((row, i) => {
      const field = `unit_sales.units[${i}]`;
      if (seen.has(row.unit_id)) err(field, `Unit "${row.unit_id}" has more than one sale row.`);
      seen.add(row.unit_id);
      if (!allIds.includes(row.unit_id)) {
        err(field, `Sale row unit "${row.unit_id}" does not exist in the unit mix.`);
      } else if (!soldIds.includes(row.unit_id) && route !== 'retain_all') {
        err(field, `Unit "${row.unit_id}" is retained and cannot carry a sale row.`);
      }
    });
    for (const uid of soldIds) {
      if (!seen.has(uid)) err('unit_sales', `Sold unit "${uid}" has no sale row.`);
    }

    // Rule 9.
    const soldGrossTotal = inputs.unit_mix.units
      .filter((u) => soldIds.includes(u.id))
      .reduce((s, u) => s + u.estimated_value_pence + unitAncillaryValuePence(u), 0);
    if (route !== 'retain_all' && soldGrossTotal <= 0) {
      err('unit_sales', 'Per-unit sales need a sold portion with value above zero.');
    }

    const resolvedEventMonth = (ev: { month_offset: number; anchor: { phase_id: string; offset_months: number } | null }): number | null => {
      const anchor = ev.anchor;
      if (anchor == null) return ev.month_offset;
      if (programmeDerivation == null) return null;
      const dp = programmeDerivation.byId[anchor.phase_id];
      return dp ? dp.start_month + anchor.offset_months : null;
    };

    const checkEvent = (
      ev: { month_offset: number; anchor: { phase_id: string; offset_months: number } | null },
      field: string,
      label: string,
    ): number | null => {
      // Rule 4: the entered month, the anchor, and the RESOLVED month.
      if (!Number.isInteger(ev.month_offset) || ev.month_offset < 0 || ev.month_offset > term - 1) {
        err(field, `${label} month must be a whole month between 0 and ${term - 1}.`);
      }
      const anchor = ev.anchor;
      if (anchor != null) {
        if (networkPhaseIds.size === 0) {
          err(field, `${label} anchor needs a programme network.`);
        } else if (!networkPhaseIds.has(anchor.phase_id)) {
          err(`${field}.anchor`, `${label} anchor references phase "${anchor.phase_id}", but there is no phase with id "${anchor.phase_id}".`);
        }
      }
      const m = resolvedEventMonth(ev);
      if (m != null && anchor != null && (m < 0 || m > term - 1)) {
        err(field, `${label} resolves to month ${m}, outside 0 to ${term - 1}.`);
      }
      return m;
    };

    unitSales.units.forEach((row, i) => {
      const field = `unit_sales.units[${i}]`;
      const completionM = checkEvent(row.completion, `${field}.completion`, 'Completion');
      const exchangeM = row.exchange == null ? null : checkEvent(row.exchange, `${field}.exchange`, 'Exchange');
      // Rule 5.
      if (exchangeM != null && completionM != null && exchangeM > completionM) {
        err(`${field}.exchange`, `Exchange must not fall after completion (resolved months ${exchangeM} > ${completionM}).`);
      }
      // Rule 6.
      if (!Number.isFinite(row.deposit_pct) || row.deposit_pct < 0 || row.deposit_pct > 100) {
        err(`${field}.deposit_pct`, 'Deposit percentage must be a finite number between 0 and 100.');
      } else if (row.exchange == null && row.deposit_pct !== 0) {
        err(`${field}.deposit_pct`, 'A deposit needs an exchange event — set exchange or set deposit_pct to 0.');
      }
      // Rule 7.
      if (row.agent_fee_pct != null && (!Number.isFinite(row.agent_fee_pct) || row.agent_fee_pct < 0 || row.agent_fee_pct >= 100)) {
        err(`${field}.agent_fee_pct`, 'Agent fee override must be a finite percentage from 0 to below 100.');
      }
      if (row.legal_fee_pence != null && (!Number.isInteger(row.legal_fee_pence) || row.legal_fee_pence < 0)) {
        err(`${field}.legal_fee_pence`, 'Legal fee override must be a whole number of pence, zero or more.');
      }
    });
  }

  // R13 spec §19.7. Gated on presence, not on `inputs_version >= 10`, matching
  // every other block here: a v9 document has no `investment_case` key, so the
  // whole block is skipped without a version test.
  const ic = 'investment_case' in inputs ? inputs.investment_case : null;
  const refi = 'refinance' in inputs ? inputs.refinance : null;

  // Rule 12 first: it applies whenever `refinance` is non-null, whether or not
  // there is an investment case, so it must not sit inside the `ic != null` arm.
  if (refi != null && 'arrangement_fee_pct' in refi) {
    const p = (refi as RefinanceInputsV10).arrangement_fee_pct;
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      err('refinance.arrangement_fee_pct', 'Refinance arrangement fee percentage must be between 0 and 100.');
    }
  }

  if (ic == null) {
    // Rule 5, the other arm — a refinance with no investment case must carry
    // the explicit pair, or it has no quantum at all. Also carries the range
    // check Task 4's temporary guard used to make (see the comment in the
    // general refinance block above) — now under this rule's own specific
    // field names rather than the generic 'refinance' field it fired on
    // before. The v4 refinance suite's negative/out-of-range assertions
    // still need this, so it is moved here, not dropped, even though the
    // brief's own rule 5 text shows only the null checks.
    if (refi != null && ('investment_value_pence' in refi)) {
      if (refi.investment_value_pence == null) {
        err('refinance.investment_value_pence', 'Refinance investment value is required when there is no investment case.');
      } else if (!Number.isFinite(refi.investment_value_pence) || refi.investment_value_pence < 0) {
        err('refinance.investment_value_pence', 'Refinance investment value must be zero or more.');
      }
      if (refi.ltv_pct == null) {
        err('refinance.ltv_pct', 'Refinance LTV is required when there is no investment case.');
      } else if (!Number.isFinite(refi.ltv_pct) || refi.ltv_pct <= 0 || refi.ltv_pct > 100) {
        err('refinance.ltv_pct', 'Refinance LTV must be greater than 0 and at most 100.');
      }
    }
  } else {
    const st = ic.stabilisation;
    const term = Math.max(1, Math.floor(inputs.finance.term_months));
    const route = inputs.exit_strategy.route;
    const rents = inputs.exit_strategy.retained_units;
    const unitIds = new Set(inputs.unit_mix.units.map((u) => u.id));

    // Rule 1
    if (route === 'sell_all') {
      err('investment_case', 'An investment case requires retained units — a sell-all exit retains none.');
    }

    // Rule 2 — the silent-understatement trap of §19.2. For `retain_all` EVERY
    // unit is retained but only listed units carry a rent, so a short list
    // understates NOI, the value and the take-out with no error anywhere.
    if (route === 'retain_all') {
      const rented = new Set(rents.map((r) => r.unit_id));
      const missing = inputs.unit_mix.units.filter((u) => !rented.has(u.id));
      if (missing.length > 0) {
        err('exit_strategy.retained_units', `A retain-all investment case needs a rent for every unit; ${missing.length} unit${missing.length === 1 ? '' : 's'} ${missing.length === 1 ? 'has' : 'have'} none.`);
      }
    }

    // Rule 3
    for (const r of rents) {
      if (!unitIds.has(r.unit_id)) {
        err('exit_strategy.retained_units', `Retained unit "${r.unit_id}" does not exist in the unit mix.`);
      }
    }

    // Rule 4
    if (rents.reduce((s, r) => s + r.monthly_rent_pence, 0) <= 0) {
      err('exit_strategy.retained_units', 'An investment case needs a rent roll greater than zero.');
    }

    // Rule 5 — supersession is an ERROR, never a silent override (§2).
    if (refi != null && 'investment_value_pence' in refi) {
      if (refi.investment_value_pence != null) {
        err('refinance.investment_value_pence', 'Remove the explicit refinance investment value — the investment case derives it.');
      }
      if (refi.ltv_pct != null) {
        err('refinance.ltv_pct', 'Remove the explicit refinance LTV — the investment case take-out supplies the cap.');
      }
    }

    // Rule 6 — reuses §18.8's anchor rule rather than restating it.
    if (st.anchor != null) {
      const net = 'programme' in inputs && inputs.programme != null
        && isProgrammeNetwork(inputs.programme) ? inputs.programme : null;
      if (net == null) {
        err('investment_case.stabilisation.anchor', 'A stabilisation anchor needs a programme network to anchor to.');
      } else if (!net.phases.some((p) => p.id === st.anchor!.phase_id)) {
        err('investment_case.stabilisation.anchor', `Stabilisation is anchored to phase "${st.anchor.phase_id}", which does not exist.`);
      }
    }

    // Rule 7 — a hard error on §18.8's reasoning: income that never starts
    // inside the term books zero NOI silently.
    const resolved = resolveStabilisationMonth(inputs, st);
    if (!Number.isInteger(resolved) || resolved < 0 || resolved > term - 1) {
      err('investment_case.stabilisation.month_offset', `Stabilisation must start within the facility term (month 0 to ${term - 1}); it resolves to month ${resolved}.`);
    }

    // Rule 8
    if (!Number.isFinite(st.stabilised_occupancy_pct)
      || st.stabilised_occupancy_pct <= 0 || st.stabilised_occupancy_pct > 100) {
      err('investment_case.stabilisation.stabilised_occupancy_pct', 'Stabilised occupancy must be greater than 0% and at most 100%.');
    }
    if (!Number.isInteger(st.ramp_months) || st.ramp_months < 0) {
      err('investment_case.stabilisation.ramp_months', 'The stabilisation ramp must be a whole number of months, zero or more.');
    }

    // Rule 9
    if (!Number.isFinite(ic.valuation.cap_yield_pct) || ic.valuation.cap_yield_pct <= 0) {
      err('investment_case.valuation.cap_yield_pct', 'The capitalisation yield must be greater than zero.');
    }
    if (!Number.isFinite(ic.valuation.purchasers_costs_pct) || ic.valuation.purchasers_costs_pct < 0) {
      err('investment_case.valuation.purchasers_costs_pct', "Purchaser's costs cannot be negative.");
    }

    // Rule 10
    const t = ic.takeout;
    if (!Number.isFinite(t.ltv_cap_pct) || t.ltv_cap_pct <= 0 || t.ltv_cap_pct > 100) {
      err('investment_case.takeout.ltv_cap_pct', 'The take-out LTV cap must be greater than 0% and at most 100%.');
    }
    if (!Number.isFinite(t.dscr_floor) || t.dscr_floor <= 0) {
      err('investment_case.takeout.dscr_floor', 'The DSCR floor must be greater than zero.');
    }
    if (!Number.isFinite(t.icr_floor) || t.icr_floor <= 0) {
      err('investment_case.takeout.icr_floor', 'The ICR floor must be greater than zero.');
    }
    if (!Number.isFinite(t.annual_rate_pct) || t.annual_rate_pct < 0) {
      err('investment_case.takeout.annual_rate_pct', 'The take-out interest rate cannot be negative.');
    }
    if (t.amortisation_years != null
      && (!Number.isFinite(t.amortisation_years) || t.amortisation_years <= 0)) {
      err('investment_case.takeout.amortisation_years', 'The amortisation period must be greater than zero, or empty for an interest-only take-out.');
    }
    if (!Number.isFinite(t.term_years) || t.term_years <= 0) {
      err('investment_case.takeout.term_years', 'The take-out term must be greater than zero.');
    }

    // Rule 11 — an EMPTY schedule is legal: NOI is then gross rent.
    const seen = new Set<string>();
    for (const l of ic.operating_lines) {
      // R13 fix-wave Minor 6. `seen.add(l.id)` used to run unconditionally,
      // including on the blank-id branch -- so a SECOND blank-id line raised
      // both "Every operating line needs an id" and a spurious
      // `Duplicate operating line id ""`, because the first blank id had
      // already been added to `seen`. Only a genuinely non-empty, non-seen
      // id gets added.
      if (l.id.trim() === '') {
        err('investment_case.operating_lines', 'Every operating line needs an id.');
      } else if (seen.has(l.id)) {
        err('investment_case.operating_lines', `Duplicate operating line id "${l.id}".`);
      } else {
        seen.add(l.id);
      }
      if (!OPEX_CODES.includes(l.code)) {
        err(`investment_case.operating_lines.${l.id}.code`, `"${l.code}" is not a recognised operating cost code.`);
      }
      if (!Number.isFinite(l.value) || l.value < 0) {
        err(`investment_case.operating_lines.${l.id}.value`, 'An operating line value cannot be negative.');
      } else if (l.basis === 'pct_of_gross_rent' && l.value > 100) {
        err(`investment_case.operating_lines.${l.id}.value`, 'A percentage operating line cannot exceed 100% of gross rent.');
      }
    }
  }

  // R8 (spec §14). Read through an `in` guard: v2–v4 documents carry none of
  // these fields and must not be reported as failing rules that did not exist
  // when they were saved.
  if ('jurisdiction' in inputs.acquisition) {
    const acq = inputs.acquisition as AcquisitionInputsV5;

    if (acq.acquisition_tax_override_pence !== null && acq.acquisition_tax_override_reason.trim() === '') {
      err(
        'acquisition.acquisition_tax_override_reason',
        'An acquisition tax override must state why the band calculation does not apply '
        + '(for example a relief or a linked transaction).',
      );
    }

    if (acq.acquisition_date !== null) {
      // R9 Task 12: shape AND calendar validity (see isCalendarDate above). The
      // shape-only regex this replaces let `2026-02-31` through, and selectBandSet
      // compares dates lexicographically rather than parsing them, so the appraisal
      // then reported `date_basis: 'transaction_date'` on a date that does not exist.
      if (!isCalendarDate(acq.acquisition_date)) {
        err('acquisition.acquisition_date',
          'Acquisition date must be a real ISO calendar date (YYYY-MM-DD).');
      } else {
        try {
          // eslint-disable-next-line no-restricted-syntax -- single-accessor guard: validation may ask whether a date is placeable; it never reads .bands
          selectBandSet(acq.jurisdiction, 'non_residential', acq.acquisition_date);
        } catch (e) {
          err('acquisition.acquisition_date', (e as Error).message);
        }
      }
    }

    if (acq.jurisdiction_evidence_status === 'unconfirmed') {
      warn(
        'acquisition.jurisdiction_evidence_status',
        'The tax jurisdiction has not been confirmed. Acquisition tax is computed on '
        + `${regimeFor(acq.jurisdiction)} and the report will remain a draft until it is confirmed.`,
      );
    }
  }

  // R12 spec §18.8/§18.9: a scenario's `phase_slip_phase_id` needs a real
  // target. `ScenarioOverrides` carries the field on every document version
  // (v2-v9), so a document with no v9 network at all can still have it set —
  // that must not be a silent no-op (the lever would look live while doing
  // nothing), so it is a hard error naming the scenario rather than a rule
  // scoped only to v9 documents. `hasNetwork` is true only for a v9 document
  // whose `programme` is an actual precedence network — a legacy `{ packages
  // }` programme has no phase to slip either.
  const hasNetwork = 'programme' in inputs && inputs.programme != null && isProgrammeNetwork(inputs.programme);
  (['base', 'upside', 'downside', 'severe'] as const).forEach((name) => {
    const scenario = inputs.scenarios[name];
    // R13b spec §22.7 (slip rule). Unlike Python's `int` field, a JSON
    // payload here parses `1.5` as a plain number with no coercion, so this
    // branch is LIVE in TS even though its Python twin is structurally
    // unreachable (Pydantic's `int` field refuses the fraction at parse
    // time) — kept in both so the two engines' rule lists match line for
    // line. `!= null` matches this file's structural-read idiom for every
    // other post-v2 field (see the `unit_sales`/`sales_phasing` guards
    // above): a pre-v12 document read here WITHOUT going through
    // `migrateInputsToV12` first (several test fixtures below cast raw JSON
    // straight to `AnyCalculatorInputs`) has no `sales_slip_months` key at
    // all, and that must stay inert rather than read as a fraction.
    if (scenario.sales_slip_months != null && !Number.isInteger(scenario.sales_slip_months)) {
      err(`scenarios.${name}.sales_slip_months`, 'Sales slip must be a whole number of months.');
    }
    if (scenario.phase_slip_phase_id == null) return;
    const field = `scenarios.${name}.phase_slip_phase_id`;
    if (!hasNetwork) {
      err(field, `Scenario '${name}' sets phase_slip_phase_id, but this document has no programme network to slip a phase within.`);
    } else if (!networkPhaseIds.has(scenario.phase_slip_phase_id)) {
      err(field, `Scenario '${name}' phase_slip_phase_id references phase "${scenario.phase_slip_phase_id}", but there is no phase with id "${scenario.phase_slip_phase_id}".`);
    }
  });

  validateMonitoring(inputs, issues);

  return issues;
}

/**
 * R14 spec §20.3 — the monitoring statement's INPUT-only rules. The three
 * result-derived flags (`monitoring_shortfall`, `monitoring_cost_variance`,
 * `monitoring_dated_after_redemption`) are Task 9's own — they need the
 * computed statement, which this function (inputs only) cannot see, so they
 * are raised as `FlagCode`s in metrics, not here. Read structurally, exactly
 * like `investment_case`/`lender_valuation` above: a pre-v11 document has no
 * `monitoring` key at all, and a v11 document with `monitoring: null` (every
 * migrated document) adds no issue either.
 */
export function validateMonitoring(inputs: AnyCalculatorInputs, issues: ValidationIssue[]): void {
  const monitoring = 'monitoring' in inputs ? inputs.monitoring : null;
  if (monitoring == null) return;

  const err = (field: string, message: string) => issues.push({ severity: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ severity: 'warning', field, message });

  const term = Math.max(1, Math.floor(inputs.finance.term_months));
  if (!Number.isInteger(monitoring.reporting_month)
    || monitoring.reporting_month < 1 || monitoring.reporting_month > term) {
    err('monitoring.reporting_month', `reporting_month must be between 1 and the term (${term})`);
  }

  // Exactly one line per category, any order, no duplicates (spec §20.1). A
  // category set of size 5 that contains all five required categories can
  // only BE those five categories, so this also catches an unrecognised
  // category value without a separate membership check.
  const categories = monitoring.lines.map((l) => l.category);
  const categorySet = new Set(categories);
  const validShape = categories.length === MONITORING_CATEGORIES.length
    && categorySet.size === MONITORING_CATEGORIES.length
    && MONITORING_CATEGORIES.every((c) => categorySet.has(c));
  if (!validShape) {
    err('monitoring.lines',
      'monitoring must carry exactly one line per category (acquisition, construction, professional, statutory, contingency)');
  }

  monitoring.lines.forEach((line, i) => {
    if (line.paid_to_date_pence > line.certified_to_date_pence) {
      err(`monitoring.lines[${i}].paid_to_date_pence`, 'paid to date cannot exceed certified to date');
    }
    if (line.certified_to_date_pence > line.committed_to_date_pence) {
      err(`monitoring.lines[${i}].certified_to_date_pence`, 'certified to date cannot exceed committed to date');
    }
  });

  const committedNet = inputs.finance.funding_source === 'cash'
    ? 0
    : (inputs.finance.committed_net_facility_pence ?? 0);
  if (monitoring.debt_drawn_to_date_pence > committedNet) {
    err('monitoring.debt_drawn_to_date_pence', 'debt drawn to date cannot exceed the committed net facility');
  }

  // Spec §5.10's cash-classified, non-rejected filter — the same one
  // cost-to-complete.ts and monthly-engine.ts already carry under this
  // comment — restated here because validateMonitoring has no access to
  // either module's computed total (inputs only).
  const cashEquityTotal = inputs.equity_sources
    .filter((s) => s.classification === 'cash' && s.evidence_status !== 'rejected')
    .reduce((sum, s) => sum + s.amount_pence, 0);
  if (monitoring.cash_equity_injected_to_date_pence > cashEquityTotal) {
    // Spec §20.3: "not an error — the audit's 'additional equity injected'
    // case; it is a warning."
    warn('monitoring.cash_equity_injected_to_date_pence', 'equity injected beyond committed sources');
  }
}

export function reconcile(
  inputs: AnyCalculatorInputs, schedule: Schedule, model: MonthlyModel,
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

  // Sources = uses, cumulatively, to the penny (spec §7). Spec §7 lists "lender fees" and
  // "interest whether capitalised or serviced" as uses, and "capitalised fees & rolled-up
  // interest (self-funding within the gross facility)" as sources — i.e. capitalised fees
  // (the arrangement fee) and rolled-up interest each appear once on both sides of the
  // identity (they fund themselves within the facility) rather than cancelling out of the
  // equation entirely. Keeping them explicit on both sides is both the clearest reading and
  // the one that holds to the penny, because the engine's per-month cost-funding loop already
  // guarantees Σ(cash uses) + serviced interest == draws + equity + funding gap + additional
  // equity; capitalised fees and rolled interest are additional matched pairs layered on top.
  const servicedInterest = model.months.reduce((s, m) => s + m.interest_serviced_pence, 0);
  const rolledInterest = model.months.reduce((s, m) => s + m.interest_capitalised_pence, 0);
  const capitalisedFees = model.totals.capitalised_fees_pence;

  const usesTotal = model.months.reduce((s, m) => s + m.uses_total_pence, 0)
    + servicedInterest + rolledInterest + capitalisedFees
    + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence;
  // Spec §4.5/§7: additional equity absorbed by the refinance event's shortfall or
  // negative-net-proceeds branches funds a facility redemption — a financing-side flow,
  // not a project cost — so it is excluded here exactly like sale-proceeds repayments
  // (netReceipts/repayment_pence never appear on either side of this identity either).
  // It still counts in full toward additional_equity_pence itself, the
  // additional_equity_required flag, equity contributed, and the equity cash-flow vector.
  //
  // R11 spec §17.6: the VAT reclaim is the THIRD such exclusion, on the same terms.
  // This function needs no structural change for VAT. The VAT outflow enters
  // uses_total_pence (monthly-engine.ts adds uses[m].vat_pence to cashUses) and is
  // funded through the existing per-month loop by draws, equity or a visible gap;
  // the reclaim repays, exactly as sale proceeds do. So, like sale-proceeds repayments
  // and refinance-shortfall equity, model.totals.vat_reclaim_pence appears on NEITHER
  // side. Over the term sources therefore fund the GROSS VAT outflow even though most
  // of it returns — which is correct, and is the treatment sale proceeds already get.
  //
  // R13 spec §19.5: a negative-NOI month's shortfall equity is the FOURTH such
  // exclusion, on the same terms as the refinance-shortfall slice above — it funds
  // an operating loss, not a project cost, so operating_shortfall_equity_pence is
  // excluded here too. Without this, a document with any negative-NOI month would
  // fail sources_equal_uses: the shortfall counts in full toward
  // additional_equity_pence (correctly — see that field's own doc comment) but has
  // no matching entry on the uses side, since NOI never enters uses_total_pence.
  const sourcesTotal =
    model.totals.equity_contributed_pence
    + (model.totals.additional_equity_pence - model.totals.refinance_shortfall_equity_pence
      - model.totals.operating_shortfall_equity_pence)
    + model.totals.funding_gap_pence // shown explicitly, never hidden
    + model.totals.draws_pence + capitalisedFees + rolledInterest
    + schedule.totals.selling_costs_pence + model.totals.exit_fee_pence; // proceeds applied at source
  const sourcesEqualUses = usesTotal === sourcesTotal;

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
