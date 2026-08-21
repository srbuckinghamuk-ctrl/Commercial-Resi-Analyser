/**
 * Representative appraisals for the report release gate.
 *
 * The audit asks the gate to run over "sell, retain, refinance and blended"
 * reports, because the memo's page composition changes route by route: a
 * sell-all case prints sale tranches and a redemption schedule, a retain-all
 * case prints neither and is where the audit found its near-blank page.
 *
 * These are authored here rather than shared with export-investment-memo.test.ts
 * so a change made to satisfy one suite cannot quietly move the other's ground.
 *
 * Test-support only; not imported by the application.
 */
import type { Project, EligibilityAssessment } from '../../types';
import type { CalculatorInputsV4, CalculatorInputsV5, CalculatorInputsV6, CalculatorInputsV7, AcquisitionInputsV5 } from '../model';
import { migrateV5toV6, migrateV6toV7 } from '../model';
import type { Jurisdiction } from '../tax/acquisition-tax';

export const qaProject: Project = {
  id: '9f1c2d34-5e6a-4b7c-8d9e-0a1b2c3d4e5f',
  address_raw: '9 & 9A Stonegate, York, YO1 8AN',
  address_line1: '9 & 9A Stonegate',
  address_line2: null,
  address_town: 'York',
  address_county: 'North Yorkshire',
  address_postcode: 'YO1 8AN',
  address_postcode_district: 'YO1',
  pa_submitted_date: null,
  pa_decision_date: null,
  price_pence: 42_500_000,
  price_qualifier: 'Guide price',
  use_class: 'office',
  floor_area_sqft: 5382,
  floor_area_sqm: 500,
  floors: 3,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: 'Ground-floor retail with upper parts',
  epc_rating: 'C',
  is_vacant: false,
  vacancy_date: null,
  source_url: null,
  source_name: null,
  // Stored verbatim as the live 9 & 9A Stonegate record holds it: the listing's
  // "Description" heading glued to the first sentence by the scraper's
  // `get_text(strip=True)`. The fixture keeps the defect so the gate exercises
  // the repair on the real string rather than a tidied version of it.
  description:
    'DescriptionThe subject comprises a mid-terrace period building arranged over three '
    + 'floors, with ground-floor retail accommodation and upper parts in ancillary use.',
  image_urls: [],
  stage: 'financial_appraisal',
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-08-16T00:00:00Z',
};

export const qaEligibility: EligibilityAssessment = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  project_id: qaProject.id,
  pdr_class: 'class_ma',
  ruleset_version: 'gpdo-2026-08.2',
  criteria: [
    { key: 'use_class', label: 'Use class E', passed: true, source: 'user', auto_checked: false, value: 'office', risk_flag: null },
    { key: 'floor_area', label: 'Floor area within limit', passed: true, source: 'auto', auto_checked: true, value: '500 m²', risk_flag: null },
    { key: 'vacant_3m', label: 'Vacant for 3+ months', passed: null, source: 'user', auto_checked: false, value: null, risk_flag: 'Occupation status unconfirmed' },
  ],
  verdict: 'amber',
  suggested_next_steps: ['Confirm vacancy period', 'Submit prior approval application'],
  notes: null,
  created_at: '2026-03-05T00:00:00Z',
  updated_at: '2026-03-05T00:00:00Z',
};

/**
 * A reconciled, report-safe base case: five one-bed units, a real facility, and
 * a sell-all exit. Every route fixture below is a modification of this one, so a
 * difference in the rendered report is a difference in the route, not the deal.
 */
export function sellAllInputs(): CalculatorInputsV4 {
  return {
    inputs_version: 4,
    project_id: qaProject.id,
    acquisition: {
      purchase_price_pence: 42_500_000,
      legal_fees_pence: 750_000,
      survey_cost_pence: 250_000,
      broker_fee_pct: 0.5,
      other_acquisition_costs_pence: 0,
    },
    unit_mix: {
      units: [
        { id: 'u1', type: '1bed', floor_area_sqm: 52, estimated_value_pence: 25_000_000, comparable_notes: '12 Stonegate, sold Feb 2026' },
        { id: 'u2', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 24_500_000, comparable_notes: '' },
        { id: 'u3', type: '1bed', floor_area_sqm: 50, estimated_value_pence: 24_500_000, comparable_notes: '' },
        { id: 'u4', type: '2bed', floor_area_sqm: 68, estimated_value_pence: 31_000_000, comparable_notes: '' },
        { id: 'u5', type: '2bed', floor_area_sqm: 70, estimated_value_pence: 32_000_000, comparable_notes: '' },
      ],
    },
    conversion_costs: {
      prior_approval_fee_per_dwelling_pence: 9_600,
      cil_s106_pence: 0,
      architect_pence: 1_200_000,
      structural_engineer_pence: 450_000,
      mande_pence: 400_000,
      planning_consultant_pence: 350_000,
      building_control_pence: 200_000,
      other_professional_fees_pence: 200_000,
      construction_cost_per_sqm_pence: 145_000,
      total_construction_sqm: 340,
      contingency_pct: 10,
      fire_safety_pence: 1_500_000,
      sound_insulation_pence: 900_000,
      part_l_compliance_pence: 700_000,
    },
    finance: {
      funding_source: 'development_finance',
      day_one_advance_pence: 25_000_000,
      day_one_market_value_pence: 45_000_000,
      development_cost_advance_pct: 100,
      committed_net_facility_pence: 75_000_000,
      committed_gross_facility_pence: 82_000_000,
      annual_interest_rate_pct: 9.0,
      interest_type: 'rolled_up',
      arrangement_fee_pct: 2,
      arrangement_fee_basis: 'committed_net_facility',
      exit_fee_pct: 1,
      exit_fee_basis: 'committed_gross_facility',
      broker_fee_pence: 250_000,
      lender_legal_fee_pence: 350_000,
      valuation_fee_pence: 180_000,
      monitoring_surveyor_fee_pence: 240_000,
      interest_reserve_pence: 7_000_000,
      term_months: 18,
      equity_draw_rule: 'equity_first',
      sales_sweep_pct: 100,
      legacy_leverage_pct: null,
      requires_confirmation: false,
      enforcement_cost_assumption_pence: 0,
    },
    equity_sources: [
      { id: 'e1', classification: 'cash', amount_pence: 40_000_000, timing_month: 0, repayment_priority: 1, evidence_status: 'confirmed', notes: 'Sponsor cash' },
    ],
    exit_strategy: {
      route: 'sell_all',
      selling_agent_fee_pct: 1.5,
      selling_legal_fee_pence: 150_000,
      retained_units: [],
    },
    risks: [
      { id: 'r1', description: 'Existing building structural capacity for new openings', likelihood: 'medium', impact: 'high', mitigation: 'Intrusive survey before contract' },
      { id: 'r2', description: 'Planning prior approval refused or delayed', likelihood: 'low', impact: 'high', mitigation: 'Pre-application advice obtained' },
      { id: 'r3', description: 'Construction cost inflation', likelihood: 'medium', impact: 'medium', mitigation: 'Fixed-price contract at RIBA 4' },
      { id: 'r4', description: 'Sales absorption slower than modelled', likelihood: 'medium', impact: 'medium', mitigation: 'Retain-and-refinance contingent exit' },
    ],
    scenarios: {
      base: { label: 'Base Case', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0 },
      upside: { label: 'Upside', gdv_adjustment_pct: 8, construction_cost_adjustment_pct: -5, timeline_adjustment_months: -2, interest_rate_adjustment_pct: 0 },
      downside: { label: 'Downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 12, timeline_adjustment_months: 3, interest_rate_adjustment_pct: 1 },
      severe: { label: 'Severe', gdv_adjustment_pct: -18, construction_cost_adjustment_pct: 20, timeline_adjustment_months: 6, interest_rate_adjustment_pct: 2 },
    },
    deal_spider: {
      storeys: 3,
      building_height_m: 11,
      bsa_higher_risk: false,
      daylight_pass_pct: 90,
      absorption_months: 8,
      exit_sell: true,
      exit_refinance: true,
      exit_hold: false,
      exit_part_sale: true,
      prior_approval_window_months: 3,
      programme_contingency_months: 2,
      cil_offset_pence: 0,
      target_profit_on_cost_pct: 20,
      weights: {},
    },
    lender_valuation: {
      basis: 'global_pct',
      global_value: -7.5,
      per_key_values: null,
      reason: 'Valuer applied a discount to the sponsor comparables',
      author: 'A. Valuer MRICS',
      date: '2026-07-14',
    },
    programme: {
      anchor_month: '2026-09',
      packages: {
        construction: { start_offset: 3, duration_months: 9, curve: { kind: 'straight_line' } },
        professional: { start_offset: 0, duration_months: 12, curve: { kind: 's_curve' } },
        statutory: { start_offset: 1, duration_months: 2, curve: { kind: 'straight_line' } },
      },
    },
    sales_phasing: null,
    refinance: null,
  };
}

/** Every unit retained — the audit's York shape, and the sparse-page case. */
export function retainAllInputs(): CalculatorInputsV4 {
  const inputs = sellAllInputs();
  inputs.exit_strategy = {
    route: 'retain_all',
    selling_agent_fee_pct: 1.5,
    selling_legal_fee_pence: 150_000,
    retained_units: inputs.unit_mix.units.map((u) => ({
      unit_id: u.id,
      monthly_rent_pence: Math.round(u.estimated_value_pence * 0.055 / 12),
    })),
  };
  return inputs;
}

/** Retained and refinanced — the take-out case a lender actually underwrites. */
export function refinanceInputs(): CalculatorInputsV4 {
  const inputs = retainAllInputs();
  inputs.refinance = {
    month_offset: 16,
    investment_value_pence: 150_000_000,
    ltv_pct: 65,
    arrangement_fee_pence: 975_000,
    legal_costs_pence: 400_000,
  };
  return inputs;
}

/** Part sold, part retained, with the sale receipts phased across three months. */
export function blendedInputs(): CalculatorInputsV4 {
  const inputs = sellAllInputs();
  inputs.exit_strategy = {
    route: 'blended',
    selling_agent_fee_pct: 1.5,
    selling_legal_fee_pence: 150_000,
    retained_units: [
      { unit_id: 'u4', monthly_rent_pence: 142_000 },
      { unit_id: 'u5', monthly_rent_pence: 146_000 },
    ],
  };
  inputs.sales_phasing = {
    tranches: [
      { month_offset: 14, pct_of_gross_receipts: 40 },
      { month_offset: 16, pct_of_gross_receipts: 35 },
      { month_offset: 18, pct_of_gross_receipts: 25 },
    ],
  };
  return inputs;
}

/**
 * R8 (spec §14). `sellAllInputs()` promoted to a v5 document with the
 * acquisition tax basis set: a confirmed jurisdiction and a real transaction
 * date, so `selectBandSet` resolves the band set by that date rather than
 * assuming the currently open-ended one. Every jurisdiction fixture below is
 * this function with one field changed, so a difference in the rendered
 * report is a difference in the jurisdiction, not the deal — the same
 * discipline `sellAllInputs`'s own doc comment asks of the exit-route
 * fixtures above.
 *
 * Before this, the standing report-QA corpus held no non-English, non-v4
 * document at all: every one of `sellAllInputs`/`retainAllInputs`/
 * `refinanceInputs`/`blendedInputs` is a pre-R8 v4 document, so every route
 * the release gate ran was an England/NI SDLT case defaulted by
 * `deriveMetrics`, never a document that actually recorded a jurisdiction.
 */
function v6AcquisitionInputs(overrides: Partial<AcquisitionInputsV5> = {}): CalculatorInputsV6 {
  const base = sellAllInputs();
  // R9: routed through migrateV5toV6 rather than spelling the v6 blocks out, so
  // these fixtures are byte-identical to what a migrated document carries and
  // cannot drift from the migration they stand in for.
  const v5: CalculatorInputsV5 = {
    ...base,
    inputs_version: 5,
    acquisition: {
      ...base.acquisition,
      jurisdiction: 'england_ni' as Jurisdiction,
      jurisdiction_source: 'user',
      jurisdiction_evidence_status: 'confirmed',
      acquisition_date: '2026-01-15',
      acquisition_tax_override_pence: null,
      acquisition_tax_override_reason: '',
      ...overrides,
    },
  };
  return migrateV5toV6(v5);
}

/**
 * A Welsh acquisition: LTT, a confirmed jurisdiction and a transaction date
 * (10 Feb 2026) inside the current non-residential band set (in force from
 * 22 Dec 2020) — so the tax basis is fully evidenced, not assumed.
 */
export function welshInputs(): CalculatorInputsV6 {
  return v6AcquisitionInputs({ jurisdiction: 'wales', acquisition_date: '2026-02-10' });
}

/**
 * A Scottish acquisition: LBTT, likewise a confirmed jurisdiction and a
 * transaction date inside the current band set (in force from 25 Jan 2019).
 */
export function scottishInputs(): CalculatorInputsV6 {
  return v6AcquisitionInputs({ jurisdiction: 'scotland', acquisition_date: '2026-02-10' });
}

/**
 * An England/NI acquisition whose jurisdiction is recorded but not yet
 * evidenced. `jurisdiction_evidence_status: 'unconfirmed'` is what
 * `taxBasisConfirmedFor` (report-provenance.ts) reads as an unconfirmed basis,
 * which drives `draftReason` to `'tax_basis_unconfirmed'` and puts the memo on
 * the DRAFT - TAX BASIS UNCONFIRMED path rather than the ordinary
 * DRAFT - NOT APPROVED one the other standing fixtures reach.
 */
export function unconfirmedJurisdictionInputs(): CalculatorInputsV6 {
  return v6AcquisitionInputs({ jurisdiction_evidence_status: 'unconfirmed' });
}

/**
 * R9 (Task 11, spec §15). Layers a populated, bridge-derived area schedule
 * carrying a material (>10%) unallocated balance, and ancillary
 * balcony/terrace + parking value on two units, onto whatever v6 document is
 * passed in — so a caller can combine this content with any jurisdiction /
 * evidence-status fixture below and exercise the area-schedule table, the
 * three efficiency ratios, the unallocated disclosure line and the GDV
 * internal/ancillary split against something other than its own zeroed
 * defaults.
 *
 * Geometry: existing 400, demolished 20, extension 20 (proposed 400); no
 * retained commercial or untouched area (developed 400); circulation 30,
 * plant 10, store 10, amenity 10 (available 340); the fixture's 290 m² of
 * unit NIA leaves 50 m² (12.5% of the 400 m² developed area) unallocated.
 */
function withBridgeAndAncillary(inputs: CalculatorInputsV6): CalculatorInputsV6 {
  return {
    ...inputs,
    areas: {
      basis: 'bridge_derived',
      existing_gia_sqm: 400,
      demolished_gia_sqm: 20,
      extension_gia_sqm: 20,
      retained_commercial_gia_sqm: 0,
      untouched_gia_sqm: 0,
      circulation_common_sqm: 30,
      plant_riser_sqm: 10,
      store_bin_cycle_sqm: 10,
      amenity_sqm: 10,
      external_amenity_sqm: 15,
    },
    unit_mix: {
      units: inputs.unit_mix.units.map((u, i) => {
        if (i === 0) {
          return { ...u, ancillary: { balcony_terrace_sqm: 5, balcony_terrace_value_pence: 800_000, parking_spaces: 1, parking_value_pence: 1_500_000 } };
        }
        if (i === 3) {
          return { ...u, ancillary: { balcony_terrace_sqm: 8, balcony_terrace_value_pence: 1_200_000, parking_spaces: 1, parking_value_pence: 1_500_000 } };
        }
        return u;
      }),
    },
  };
}

export function bridgeAndAncillaryInputs(): CalculatorInputsV6 {
  return withBridgeAndAncillary(v6AcquisitionInputs());
}

/**
 * R9 fix round 1 (Important 1). `bridgeAndAncillaryInputs()`'s populated
 * schedule, but combined with the tallest jurisdiction strings the standing
 * corpus has (Scotland: "Scotland"/"LBTT" run longer than "Wales"/"LTT") AND
 * an unconfirmed evidence status, so the DRAFT - TAX BASIS UNCONFIRMED
 * banner and its extra evidence-request text are on the document at the same
 * time as the new Section 3 content.
 *
 * Before this fixture, the populated area-schedule/efficiencies/GDV-split
 * content reached the page-bounds/sparse-page/orphan-heading QA gate through
 * exactly one route (`bridgeAndAncillaryInputs`, England/NI, fully
 * evidenced) — never combined with the longer strings and extra banner the
 * standing `welshInputs`/`scottishInputs`/`unconfirmedJurisdictionInputs`
 * fixtures exist specifically to stress. That gap matters because "added
 * content pushes a table past CONTENT_BOTTOM" is exactly the defect class
 * the round-1 blank-trailing-page fix closed — the taller strings here are
 * where it would recur if the fix were incomplete.
 *
 * The facility is widened over `bridgeAndAncillaryInputs()`'s: the
 * bridge-derived 400 m² cost area (vs. the 340 m² `sellAllInputs()` was
 * originally sized for) raises total development cost enough to open a
 * funding gap against the unwidened committed facility, which would make
 * `report_safe` false and the watermark read UNRECONCILED — masking the
 * `tax_basis_unconfirmed` reason this fixture exists to combine with the
 * populated content.
 */
export function bridgeAncillaryScottishUnconfirmedInputs(): CalculatorInputsV6 {
  const inputs = withBridgeAndAncillary(v6AcquisitionInputs({
    jurisdiction: 'scotland',
    acquisition_date: '2026-02-10',
    jurisdiction_evidence_status: 'unconfirmed',
  }));
  return {
    ...inputs,
    finance: {
      ...inputs.finance,
      committed_net_facility_pence: 150_000_000,
      committed_gross_facility_pence: 165_000_000,
    },
  };
}

/**
 * The legacy v1 snapshot shape. Migrating it forces
 * `finance.requires_confirmation`, which is what makes a run not report-safe —
 * the state every DRAFT-watermark assertion needs.
 */
export function legacyV1Snapshot(): Record<string, unknown> {
  const base = sellAllInputs();
  return {
    project_id: qaProject.id,
    acquisition: base.acquisition,
    unit_mix: base.unit_mix,
    conversion_costs: base.conversion_costs,
    finance: {
      funding_source: 'bridging',
      ltv_pct: 65,
      interest_rate_annual_pct: 9.5,
      arrangement_fee_pct: 2,
      exit_fee_pct: 1,
      loan_term_months: 12,
      interest_type: 'rolled_up',
    },
    exit_strategy: { route: 'retain_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 150_000, retained_units: [] },
    risks: [],
  };
}

/**
 * R10 (Task 13, spec §16). The standing corpus above is entirely v4/v5/v6
 * (headline-mode) documents — none exercises the detailed cost-plan mode's
 * package schedule, mode-dependent memo heading, or the three contingency
 * classes' resolved bases. Built from `v6AcquisitionInputs()` (the same
 * England/NI, evidenced base every other v6+ fixture shares) migrated to v7,
 * then given a genuine three-package cost plan whose three contingency
 * classes resolve against three DIFFERENT bases (all_packages vs. two
 * different selected_packages subsets) — so a report-QA assertion that the
 * base differs by class is actually exercised, not vacuously true of one
 * shared figure. Two fee lines are switched from fixed to percentage bases
 * (one of each: pct_of_base_build, pct_of_construction_total) so both fee
 * bases are on the page too. The three flat compliance fields are zeroed —
 * detailed mode prices compliance inside a package, and a non-zero flat
 * figure alongside is a hard validation error (spec §3.2.1).
 */
export function detailedCostPlanInputs(): CalculatorInputsV7 {
  const v7 = migrateV6toV7(v6AcquisitionInputs());
  return {
    ...v7,
    conversion_costs: {
      ...v7.conversion_costs,
      fire_safety_pence: 0,
      sound_insulation_pence: 0,
      part_l_compliance_pence: 0,
    },
    cost_plan: {
      mode: 'detailed',
      packages: [
        {
          id: 'pkg-structure', code: 'structure', label: 'Structural repairs',
          amount_pence: 20_000_000, contingency_class: 'general', lender_eligible: true, notes: '', vat_override: null,
        },
        {
          id: 'pkg-envelope', code: 'envelope', label: 'Envelope — windows, cladding, roof',
          amount_pence: 10_000_000, contingency_class: 'existing_building', lender_eligible: true, notes: '', vat_override: null,
        },
        {
          id: 'pkg-externals', code: 'externals', label: 'Externals and landscaping',
          amount_pence: 5_000_000, contingency_class: 'abnormal', lender_eligible: false, notes: '', vat_override: null,
        },
      ],
      contingency: [
        { name: 'general', pct: 5 },
        { name: 'existing_building', pct: 12 },
        { name: 'abnormal', pct: 8 },
      ],
      fee_lines: v7.cost_plan.fee_lines.map((f) => {
        if (f.code === 'architect') return { ...f, basis: 'pct_of_base_build' as const, amount_pence: 0, pct: 5 };
        if (f.code === 'planning_consultant') return { ...f, basis: 'pct_of_construction_total' as const, amount_pence: 0, pct: 1.5 };
        return f;
      }),
    },
  };
}
