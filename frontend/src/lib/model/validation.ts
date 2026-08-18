import type { AcquisitionInputsV5, AnyCalculatorInputs, MonthlyModel, Schedule } from './finance-types';
import { computeLenderGdv } from './lender-valuation';
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
import { pct } from './pct';

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
  if ('programme' in inputs && inputs.programme != null) {
    const term = Math.max(1, Math.floor(inputs.finance.term_months));
    for (const [name, pkg] of Object.entries(inputs.programme.packages)) {
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
  if ('sales_phasing' in inputs && inputs.sales_phasing != null) {
    const term = Math.max(1, Math.floor(inputs.finance.term_months));
    const trs = inputs.sales_phasing.tranches;
    if (inputs.exit_strategy.route === 'retain_all') {
      err('sales_phasing', 'Phased sales apply to the sold portion — a retain-all exit has none. Remove the block or change the exit route.');
    }
    if (trs.length === 0) err('sales_phasing', 'Phased sales need at least one tranche.');
    trs.forEach((tr, i) => {
      const field = `sales_phasing.tranches[${i}]`;
      if (!Number.isInteger(tr.month_offset) || tr.month_offset < 0 || tr.month_offset > term - 1) {
        err(field, `Tranche month must be a whole month between 0 and ${term - 1}.`);
      }
      if (!Number.isFinite(tr.pct_of_gross_receipts) || tr.pct_of_gross_receipts <= 0) {
        err(field, 'Tranche percentage must be a finite number greater than zero.');
      }
      if (i > 0 && !(tr.month_offset > trs[i - 1].month_offset)) {
        err(field, 'Tranche months must be strictly increasing.');
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
    if (!Number.isFinite(rf.investment_value_pence) || rf.investment_value_pence < 0) {
      err('refinance', 'Refinance investment value must be zero or more.');
    }
    if (!Number.isFinite(rf.ltv_pct) || rf.ltv_pct <= 0 || rf.ltv_pct > 100) {
      err('refinance', 'Refinance LTV must be greater than 0 and at most 100.');
    }
    if (!Number.isFinite(rf.arrangement_fee_pence) || rf.arrangement_fee_pence < 0) {
      err('refinance', 'Refinance arrangement fee must be zero or more.');
    }
    if (!Number.isFinite(rf.legal_costs_pence) || rf.legal_costs_pence < 0) {
      err('refinance', 'Refinance legal costs must be zero or more.');
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

  return issues;
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
  const sourcesTotal =
    model.totals.equity_contributed_pence
    + (model.totals.additional_equity_pence - model.totals.refinance_shortfall_equity_pence)
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
