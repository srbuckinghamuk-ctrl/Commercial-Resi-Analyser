/**
 * R13 spec §19, Task 5b (moved to v11 by R14 Task 14, the entry-point
 * cutover): the shared test-document builders every downstream task
 * consumes. This module exists so that "a valid current-version document
 * with an investment case" means the same thing everywhere — fourteen tasks
 * inventing their own would disagree in ways that surface as mysterious
 * failures three tasks downstream.
 *
 * Every builder is built from a fixture JSON file (or another builder) via
 * `migrateInputsToV11` — never a hand-authored default object — so a fixture
 * and a builder can never disagree about what a valid v11 document looks
 * like. Mirrors `tests/fixtures_investment_case.py`, using each language's
 * own naming convention for the same functions (camelCase here, snake_case
 * there — the same per-language split every migrate/is-vN pair in this repo
 * already uses).
 *
 * SCOPE NOTE (read before hand-deriving pins against these documents):
 * `icDoc`/`investmentCaseDoc`/`explicitRefinanceDoc`/`anchoredSlippedDoc` are
 * exercised by this module's own test file and their numbers are hand-derived
 * and verified (see the JSON fixtures' own notes, and this file's inline
 * comments for `anchoredSlippedDoc`). The NOI/ledger family below them
 * (`noiDoc`, `retainAllNoiDoc`, `blendedDoc`, `mixedNoiDoc`,
 * `allFourInOneMonthDoc`, `noiRedeemsDoc`) are built to be VALID, structurally
 * correct documents that exercise their named concept — verified to validate
 * cleanly and run without error — but their exact monthly economics are NOT
 * tuned to any downstream task's plan-text pinned figures. Tasks 9-11 must
 * hand-derive their own expected numbers against what these builders actually
 * produce, not assume the plan's illustrative numbers already match.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateInputsToV11 } from '../migrate';
import { buildSchedule } from '../schedule';
import { runLedger as engineRunLedger } from '../monthly-engine';
import { applyScenario } from '../apply-scenario';
import { runAppraisal } from '../index';
import { generateInvestmentMemo } from '../../export-investment-memo';
import { inspectPdf } from '../../report-qa/pdf-inspect';
import { documentText } from '../../report-qa/report-checks';
import type { CalculatorInputsV11, OperatingLine, MonthlyModel } from '../finance-types';
import type { ScenarioOverrides } from '../../conversion-types';
import type { SensitivityLever } from '../sensitivity';
import type { Project } from '../../../types';

const FIXTURE_DIR = resolve(__dirname, '../../../../../fixtures/financial-model');

function loadFixtureInputs(stem: string): Record<string, unknown> {
  const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${stem}.json`), 'utf-8')) as {
    inputs: Record<string, unknown>;
  };
  return raw.inputs;
}

/** A minimal, self-contained Project the memo generator needs. No consumer of
 *  `memoText` asserts on project fields — the memo prints them, it does not
 *  compute from them — so this is a placeholder, not derived from anything. */
export const FIXTURE_PROJECT: Project = {
  id: 'ic-fixture-project',
  address_raw: '1 Investment Case Way, Testville, TT1 1IC',
  address_line1: '1 Investment Case Way',
  address_line2: null,
  address_town: 'Testville',
  address_county: 'Testshire',
  address_postcode: 'TT1 1IC',
  address_postcode_district: 'TT1',
  pa_submitted_date: null,
  pa_decision_date: null,
  price_pence: 60_000_000,
  price_qualifier: 'Guide price',
  use_class: 'office',
  floor_area_sqft: 3_767,
  floor_area_sqm: 350,
  floors: 2,
  tenure: 'freehold',
  lease_years_remaining: null,
  current_use_description: 'Former office building, vacant since 2025',
  epc_rating: 'C',
  is_vacant: true,
  vacancy_date: '2026-06-01',
  source_url: null,
  source_name: null,
  description: 'Fixture project for the R13 investment-case builder suite.',
  image_urls: [],
  stage: 'financial_appraisal',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

/**
 * The override keys every later task uses (spec §19, Task 5b brief). Each is
 * a SINGLE named deviation from `icDoc()`'s base — a test that breaks one
 * rule cannot accidentally break two.
 */
export interface IcDocOverrides {
  route?: 'sell_all' | 'blended' | 'retain_all';
  /** Only `null` is a meaningful value — drops the block entirely. */
  refinance?: null;
  /** Only `null` is a meaningful value — drops the case entirely. */
  investmentCase?: null;
  explicitValue?: number | null;
  arrangementFeePct?: number;
  dropRetainedUnit?: string;
  addRetainedUnitId?: string;
  allRentsZero?: boolean;
  anchorPhaseId?: string;
  stabilisationMonth?: number;
  rampMonths?: number;
  termMonths?: number;
  occupancyPct?: number;
  capYieldPct?: number;
  purchasersCostsPct?: number;
  ltvCapPct?: number;
  dscrFloor?: number;
  icrFloor?: number;
  annualRatePct?: number;
  amortisationYears?: number | null;
  termYears?: number;
  lines?: OperatingLine[];
  duplicateLineIds?: boolean;
  pctLineValue?: number;
  /** §19.7 rule 11's blank-id arm — 'l1's id blanked, everything else
   *  untouched (parallel to `duplicateLineIds`'s single deviation). */
  blankLineId?: boolean;
  /** §19.7 rule 11's OPEX_CODES membership arm — 'l1's code set to a string
   *  no `OpexCode` names. Cast at the write site, not the type: `OperatingLine`
   *  stays honestly typed, and this override exists precisely to construct the
   *  malformed-at-runtime document validation must defend against. */
  invalidLineCode?: boolean;
  opexHeavy?: boolean;
  opexExceedsRent?: boolean;
  ltvBinds?: boolean;
  takeoutShortfall?: boolean;
  salesSweepPct?: number;
}

function applyIcDocOverrides(doc: CalculatorInputsV11, o: IcDocOverrides): CalculatorInputsV11 {
  const next: CalculatorInputsV11 = { ...doc };

  if (o.route !== undefined) {
    next.exit_strategy = { ...next.exit_strategy, route: o.route };
  }
  if ('refinance' in o) {
    next.refinance = null;
  }
  if ('investmentCase' in o) {
    next.investment_case = null;
  }
  if (o.explicitValue !== undefined && next.refinance != null) {
    next.refinance = { ...next.refinance, investment_value_pence: o.explicitValue };
  }
  if (o.arrangementFeePct !== undefined && next.refinance != null) {
    next.refinance = { ...next.refinance, arrangement_fee_pct: o.arrangementFeePct };
  }
  if (o.dropRetainedUnit !== undefined) {
    next.exit_strategy = {
      ...next.exit_strategy,
      retained_units: next.exit_strategy.retained_units.filter(
        (r) => r.unit_id !== o.dropRetainedUnit,
      ),
    };
  }
  if (o.addRetainedUnitId !== undefined) {
    next.exit_strategy = {
      ...next.exit_strategy,
      retained_units: [
        ...next.exit_strategy.retained_units,
        { unit_id: o.addRetainedUnitId, monthly_rent_pence: 1_000_00 },
      ],
    };
  }
  if (o.allRentsZero) {
    next.exit_strategy = {
      ...next.exit_strategy,
      retained_units: next.exit_strategy.retained_units.map((r) => ({ ...r, monthly_rent_pence: 0 })),
    };
  }
  if (o.salesSweepPct !== undefined) {
    next.finance = { ...next.finance, sales_sweep_pct: o.salesSweepPct };
  }
  if (o.termMonths !== undefined) {
    next.finance = { ...next.finance, term_months: o.termMonths };
  }

  if (next.investment_case != null) {
    let ic = next.investment_case;
    if (o.anchorPhaseId !== undefined) {
      ic = {
        ...ic,
        stabilisation: {
          ...ic.stabilisation,
          anchor: { phase_id: o.anchorPhaseId, offset_months: ic.stabilisation.anchor?.offset_months ?? 0 },
        },
      };
    }
    // A `stabilisationMonth` override means "use this explicit month instead
    // of the anchor" — ONE coherent deviation (anchored -> explicit), not two
    // independent field writes. Left anchored, an overridden month_offset
    // would have NO EFFECT on the resolved month at all once Task 6/8's
    // resolver reads this block: a non-null anchor supersedes month_offset
    // unconditionally (§18.6). Clearing it here, once, is what keeps every
    // caller's month_offset override meaningful.
    if (o.stabilisationMonth !== undefined) {
      ic = {
        ...ic,
        stabilisation: { ...ic.stabilisation, anchor: null, month_offset: o.stabilisationMonth },
      };
    }
    if (o.rampMonths !== undefined) {
      ic = { ...ic, stabilisation: { ...ic.stabilisation, ramp_months: o.rampMonths } };
    }
    if (o.occupancyPct !== undefined) {
      ic = { ...ic, stabilisation: { ...ic.stabilisation, stabilised_occupancy_pct: o.occupancyPct } };
    }
    if (o.capYieldPct !== undefined) {
      ic = { ...ic, valuation: { ...ic.valuation, cap_yield_pct: o.capYieldPct } };
    }
    if (o.purchasersCostsPct !== undefined) {
      ic = { ...ic, valuation: { ...ic.valuation, purchasers_costs_pct: o.purchasersCostsPct } };
    }
    if (o.ltvCapPct !== undefined) {
      ic = { ...ic, takeout: { ...ic.takeout, ltv_cap_pct: o.ltvCapPct } };
    }
    if (o.dscrFloor !== undefined) {
      ic = { ...ic, takeout: { ...ic.takeout, dscr_floor: o.dscrFloor } };
    }
    if (o.icrFloor !== undefined) {
      ic = { ...ic, takeout: { ...ic.takeout, icr_floor: o.icrFloor } };
    }
    if (o.annualRatePct !== undefined) {
      ic = { ...ic, takeout: { ...ic.takeout, annual_rate_pct: o.annualRatePct } };
    }
    if (o.amortisationYears !== undefined) {
      ic = { ...ic, takeout: { ...ic.takeout, amortisation_years: o.amortisationYears } };
    }
    if (o.termYears !== undefined) {
      ic = { ...ic, takeout: { ...ic.takeout, term_years: o.termYears } };
    }
    if (o.lines !== undefined) {
      ic = { ...ic, operating_lines: o.lines };
    }
    if (o.blankLineId) {
      const lines = ic.operating_lines.map((l) => ({ ...l }));
      if (lines.length >= 1) lines[0] = { ...lines[0], id: '' };
      ic = { ...ic, operating_lines: lines };
    }
    if (o.invalidLineCode) {
      const lines = ic.operating_lines.map((l) => ({ ...l }));
      if (lines.length >= 1) lines[0] = { ...lines[0], code: 'not_a_real_code' as OperatingLine['code'] };
      ic = { ...ic, operating_lines: lines };
    }
    if (o.duplicateLineIds) {
      const lines = ic.operating_lines.map((l) => ({ ...l }));
      if (lines.length >= 2) lines[1] = { ...lines[1], id: lines[0].id };
      ic = { ...ic, operating_lines: lines };
    }
    // 'l1' is icDoc()'s management line — the base fixture's only line with a
    // sub-100 percentage headroom to push past 100 (letting_and_re_letting is
    // already fixed at 2%, and the two fixed lines have no "percentage" to
    // breach at all).
    if (o.pctLineValue !== undefined) {
      const v = o.pctLineValue;
      ic = {
        ...ic,
        operating_lines: ic.operating_lines.map((l) => (l.id === 'l1' ? { ...l, value: v } : l)),
      };
    }
    // "Heavy but plausible": every line scaled x5. Both percentage lines stay
    // <= 100% individually (50%, 10%) so this alone cannot trip §19.7 rule
    // 11's <=100% check once Task 6 lands — a document this task builds must
    // not become a landmine for the very next one.
    if (o.opexHeavy) {
      ic = { ...ic, operating_lines: ic.operating_lines.map((l) => ({ ...l, value: l.value * 5 })) };
    }
    // Guaranteed opex > gross rent AT ANY OCCUPANCY, via the FIXED insurance
    // line ('l3') alone: 500,000 exceeds the 295,000 gross potential rent
    // ceiling outright. Deliberately does not touch the percentage lines,
    // which stay within their valid range.
    if (o.opexExceedsRent) {
      ic = {
        ...ic,
        operating_lines: ic.operating_lines.map((l) => (l.id === 'l3' ? { ...l, value: 500_000 } : l)),
      };
    }
    // The EXACT pair fixtures/financial-model/u-investment-case-ltv-binds.json
    // uses, so `icDoc({ ltvBinds: true })` and that fixture agree on what "LTV
    // binds" means — see that fixture's own note for the hand-derivation.
    if (o.ltvBinds) {
      ic = {
        ...ic,
        valuation: { ...ic.valuation, cap_yield_pct: 7.5 },
        takeout: { ...ic.takeout, ltv_cap_pct: 55 },
      };
    }
    // Floors the take-out toward a near-zero quantum via every cap at once —
    // structural (a case that IS sized, but to next to nothing), not tuned to
    // a specific pence figure.
    if (o.takeoutShortfall) {
      ic = { ...ic, takeout: { ...ic.takeout, ltv_cap_pct: 1, dscr_floor: 100, icr_floor: 100 } };
    }
    next.investment_case = ic;
  }

  return next;
}

/** A valid retain-all v11 document with an investment case (built from
 *  fixtures/financial-model/t-investment-case.json — DSCR binds, hand-derived
 *  there). `overrides` applies zero or more single, named deviations. */
export function icDoc(overrides: IcDocOverrides = {}): CalculatorInputsV11 {
  const doc = migrateInputsToV11(loadFixtureInputs('t-investment-case')) as CalculatorInputsV11;
  return applyIcDocOverrides(doc, overrides);
}

/** Alias of {@link icDoc}, used by the schedule/metrics tasks under the name
 *  their own briefs use (Task 5b brief). */
export const investmentCaseDoc = icDoc;

/**
 * `investment_case: null`, an explicit `investment_value_pence` of
 * 5,000,000.00 and `ltv_pct` 60 — the calc 2.11.0 path that must stay
 * bit-identical. Pinned exactly to the figures Task 8's own brief already
 * asserts against this function's name (`5_000_000_00`, `arrangement_fee_pence`
 * `30_000_00`, `legal_costs_pence` `20_000_00`), so that test does not have to
 * be rewritten once this builder exists.
 */
export function explicitRefinanceDoc(): CalculatorInputsV11 {
  const doc = icDoc({ investmentCase: null });
  if (doc.refinance == null) {
    throw new Error('explicitRefinanceDoc: base document unexpectedly has no refinance block');
  }
  return {
    ...doc,
    refinance: {
      ...doc.refinance,
      investment_value_pence: 5_000_000_00,
      ltv_pct: 60,
      arrangement_fee_pence: 30_000_00,
      arrangement_fee_basis: 'fixed_pence',
      arrangement_fee_pct: 0,
      legal_costs_pence: 20_000_00,
    },
  };
}

/**
 * A programme network with a slipped phase (`construction` slips 2 months),
 * one sale tranche at `month_offset` 12 anchored to `sales + 3` (resolves to
 * 14), a second tranche and the refinance both anchored to `maturity_tail + 4`
 * (resolves to 18). This is Task 12's document and the reason it can fail
 * against `main`: before Task 8/12, the memo and CashflowPage print the raw
 * `month_offset`, not the resolved month.
 *
 * Hand-derived forward pass (verified against `derivePhases`/`derive_phases`
 * before this was written, not harvested from a report):
 *   acquisition   dur 1                              -> start 0,  finish 1
 *   construction  dur 6, slip 2, pred acquisition FS  -> floor 1, start 1+2=3, finish 9
 *   practical_completion dur 0 (milestone), pred construction FS -> start 9,  finish 9
 *   unit_completions dur 2, pred practical_completion FS -> start 9,  finish 11
 *   sales         dur 3, pred unit_completions FS     -> start 11, finish 14
 *   maturity_tail dur 0 (milestone), pred sales FS    -> start 14, finish 14
 * Tranche 0 anchor {sales, +3}: 11 + 3 = 14. Tranche 1 / refinance anchor
 * {maturity_tail, +4}: 14 + 4 = 18. Both raw `month_offset`s (12, 15/16)
 * deliberately disagree with the resolved months, exactly as
 * s-dated-programme.json's own anchored tranches do, so a dead anchor cannot
 * hide behind an agreeing fallback.
 *
 * Built from fixtures/financial-model/j-blended-refinance.json's acquisition/
 * unit_mix/finance/equity numbers (an already-proven-good v5 corpus fixture),
 * upgraded to v10 shape with this task's own programme/sales_phasing/
 * refinance/investment_case overlay, then run through `migrateInputsToV11`
 * (R14 Task 14) exactly as a real stored v10 document would be. `investment_case`
 * is null — this document is about anchor resolution, not the investment case.
 */
export function anchoredSlippedDoc(): CalculatorInputsV11 {
  const raw = loadFixtureInputs('j-blended-refinance') as Record<string, unknown>;
  const acquisition = raw.acquisition as Record<string, unknown>;
  const doc: Record<string, unknown> = {
    ...raw,
    inputs_version: 10,
    investment_case: null,
    acquisition: {
      ...acquisition,
      jurisdiction: 'england_ni',
      jurisdiction_source: 'user',
      jurisdiction_evidence_status: 'confirmed',
      acquisition_date: '2026-08-01',
      acquisition_tax_override_pence: null,
      acquisition_tax_override_reason: '',
    },
    areas: {
      basis: 'manual', existing_gia_sqm: 0, demolished_gia_sqm: 0, extension_gia_sqm: 0,
      retained_commercial_gia_sqm: 0, untouched_gia_sqm: 0, circulation_common_sqm: 0,
      plant_riser_sqm: 0, store_bin_cycle_sqm: 0, amenity_sqm: 0, external_amenity_sqm: 0,
    },
    cost_plan: {
      mode: 'headline', packages: [],
      contingency: [
        { name: 'general', pct: 10 }, { name: 'existing_building', pct: 0 }, { name: 'abnormal', pct: 0 },
      ],
      fee_lines: [
        { id: 'fee-architect', code: 'architect', category: 'professional', label: 'Architect', basis: 'fixed', amount_pence: 1_500_000, pct: 0, per_dwelling: false, vat_override: null, phase_id: null },
        { id: 'fee-structural', code: 'structural_engineer', category: 'professional', label: 'Structural engineer', basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false, vat_override: null, phase_id: null },
        { id: 'fee-mande', code: 'mande', category: 'professional', label: 'M&E', basis: 'fixed', amount_pence: 500_000, pct: 0, per_dwelling: false, vat_override: null, phase_id: null },
        { id: 'fee-planning', code: 'planning_consultant', category: 'professional', label: 'Planning consultant', basis: 'fixed', amount_pence: 300_000, pct: 0, per_dwelling: false, vat_override: null, phase_id: null },
        { id: 'fee-prior-approval', code: 'prior_approval', category: 'statutory', label: 'Prior approval fee', basis: 'fixed', amount_pence: 9_600, pct: 0, per_dwelling: true, vat_override: null, phase_id: null },
      ],
    },
    vat: {
      registered: false, return_frequency: 'quarterly', first_period_end_month: 2, repayment_lag_months: 1,
      treatments: (['acquisition', 'construction', 'professional', 'statutory', 'selling', 'lender_ancillary'] as const)
        .map((category) => ({
          category, rate_pct: 0, recoverable_pct: 0, recovery_basis: 'unconfirmed', evidence_status: 'unconfirmed', notes: '',
        })),
      purchase: { vendor_opted_to_tax: false, togc_treatment: 'unconfirmed', evidence_status: 'unconfirmed', notes: '' },
    },
    finance: { ...(raw.finance as Record<string, unknown>), term_months: 22 },
    programme: {
      anchor_month: '2026-08',
      phases: [
        { id: 'acquisition', code: 'acquisition', label: 'Acquisition', duration_months: 1, slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [] },
        { id: 'construction', code: 'construction', label: 'Main construction', duration_months: 6, slip_months: 2, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'acquisition', type: 'FS', lag_months: 0 }] },
        { id: 'practical_completion', code: 'practical_completion', label: 'Practical completion', duration_months: 0, slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'construction', type: 'FS', lag_months: 0 }] },
        { id: 'unit_completions', code: 'unit_completions', label: 'Unit completions', duration_months: 2, slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'practical_completion', type: 'FS', lag_months: 0 }] },
        { id: 'sales', code: 'sales', label: 'Sales run-off', duration_months: 3, slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'unit_completions', type: 'FS', lag_months: 0 }] },
        { id: 'maturity_tail', code: 'maturity_tail', label: 'Maturity', duration_months: 0, slip_months: 0, start_offset: 0, curve: { kind: 'straight_line' }, predecessors: [{ phase_id: 'sales', type: 'FS', lag_months: 0 }] },
      ],
      category_phase_ids: { construction: 'construction', professional: 'acquisition', statutory: 'acquisition' },
    },
    sales_phasing: {
      tranches: [
        { month_offset: 12, pct_of_gross_receipts: 60, anchor: { phase_id: 'sales', offset_months: 3 } },
        { month_offset: 15, pct_of_gross_receipts: 40, anchor: { phase_id: 'maturity_tail', offset_months: 4 } },
      ],
    },
    refinance: {
      month_offset: 16, investment_value_pence: 30_000_000, ltv_pct: 65,
      arrangement_fee_pence: 300_000, legal_costs_pence: 100_000,
      anchor: { phase_id: 'maturity_tail', offset_months: 4 },
      arrangement_fee_basis: 'fixed_pence', arrangement_fee_pct: 0,
    },
  };
  return migrateInputsToV11(doc) as CalculatorInputsV11;
}

// --- The NOI / ledger family --------------------------------------------
//
// Unlike icDoc()'s base (cash-funded — see t-investment-case.json's note on
// why), the ledger tests these feed need a real development facility: peak
// debt, draws, interest and repayment are all zero on a cash deal, which
// would make a facility-balance assertion vacuous. `_facilityNoiBase` is the
// shared building block: development-finance-funded, blended exit, an
// investment case that stabilises almost immediately (month_offset 1, ramp 1)
// so mid-term months already carry full NOI. Built from
// fixtures/financial-model/j-blended-refinance.json, the same proven-good
// acquisition/unit_mix/cost numbers `anchoredSlippedDoc` reuses above.

function _facilityNoiBase(): CalculatorInputsV11 {
  const doc = anchoredSlippedDoc();
  return {
    ...doc,
    finance: { ...doc.finance, term_months: 24 },
    programme: null,
    sales_phasing: null,
    refinance: null,
    exit_strategy: {
      ...doc.exit_strategy,
      route: 'blended',
      retained_units: [{ unit_id: 'u4', monthly_rent_pence: 150_000 }],
    },
    investment_case: {
      stabilisation: { anchor: null, month_offset: 1, ramp_months: 1, stabilised_occupancy_pct: 96 },
      operating_lines: [
        { id: 'l1', code: 'management', label: 'Management fee', basis: 'pct_of_gross_rent', value: 10 },
        { id: 'l2', code: 'letting_and_re_letting', label: 'Letting and re-letting', basis: 'pct_of_gross_rent', value: 2 },
        { id: 'l3', code: 'insurance', label: 'Buildings insurance', basis: 'fixed_pence_per_month', value: 25_000 },
        { id: 'l4', code: 'compliance_and_safety', label: 'Compliance and safety', basis: 'fixed_pence_per_month', value: 8_000 },
      ],
      valuation: { cap_yield_pct: 5.5, purchasers_costs_pct: 6.75 },
      takeout: { ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3, annual_rate_pct: 6, amortisation_years: 25, term_years: 5 },
    },
  };
}

/** A facility-funded document whose investment case is already stabilised by
 *  month 4 (see `_facilityNoiBase`), so mid-term ledger months carry full
 *  NOI. `overrides` reuses `icDoc`'s override contract. */
export function noiDoc(overrides: IcDocOverrides = {}): CalculatorInputsV11 {
  return applyIcDocOverrides(_facilityNoiBase(), overrides);
}

/** The retain-all variant of the NOI base: every unit retained (rather than
 *  `_facilityNoiBase`'s single retained unit), still facility-funded. */
export function retainAllNoiDoc(): CalculatorInputsV11 {
  const doc = _facilityNoiBase();
  return {
    ...doc,
    exit_strategy: {
      ...doc.exit_strategy,
      route: 'retain_all',
      retained_units: doc.unit_mix.units.map((u) => ({ unit_id: u.id, monthly_rent_pence: 150_000 })),
    },
  };
}

/** The blended exit itself: `rents: 'market'` keeps the retained unit's rent
 *  at `_facilityNoiBase`'s figure; `rents: 'zero'` zeroes it, isolating NOI's
 *  contribution from the sold units' contribution to the same metrics. */
export function blendedDoc({ rents }: { rents: 'market' | 'zero' }): CalculatorInputsV11 {
  const doc = _facilityNoiBase();
  return {
    ...doc,
    exit_strategy: {
      ...doc.exit_strategy,
      retained_units: doc.exit_strategy.retained_units.map((r) => ({
        ...r,
        monthly_rent_pence: rents === 'zero' ? 0 : r.monthly_rent_pence,
      })),
    },
  };
}

/** Named separately from `blendedDoc` because the reconciliation tests read
 *  it under its own name (Task 5b brief); the document itself is the market-
 *  rent blended case — both a sale and a retained NOI stream present at once. */
export function mixedNoiDoc(): CalculatorInputsV11 {
  return blendedDoc({ rents: 'market' });
}

/**
 * VAT reclaim, NOI, a sale and a refinance all converging in month 6 of a
 * 12-month term. Built from fixtures/financial-model/r-vat-quarterly.json's
 * acquisition/unit_mix/cost/VAT numbers (VAT registered, 100% recoverable on
 * zero-rated-sale acquisition and construction, quarterly returns) — a
 * proven-good corpus fixture already known to produce reclaims. Verified
 * (not hand-derived economically, but MECHANICALLY checked before this was
 * written): with `programme: null` (auto windows) and this term, the reclaim
 * lands at months 3 and 6; the sale tranche and the refinance are both set to
 * `month_offset` 6 directly (no anchor needed — there is no programme network
 * for one to resolve against) so they land in the SAME verified reclaim
 * month. `investment_case` stabilises at month 1 (ramp 1), so NOI is already
 * flowing well before month 6 too.
 *
 * Task 9's own economics for this month (repayment/exit-fee pence) are NOT
 * reproduced here — see this file's header scope note.
 */
export function allFourInOneMonthDoc(): CalculatorInputsV11 {
  const raw = loadFixtureInputs('r-vat-quarterly') as Record<string, unknown>;
  const doc: Record<string, unknown> = {
    ...raw,
    inputs_version: 10,
    programme: null,
    finance: { ...(raw.finance as Record<string, unknown>), term_months: 12 },
    exit_strategy: {
      ...(raw.exit_strategy as Record<string, unknown>),
      route: 'blended',
      retained_units: [{ unit_id: 'u3', monthly_rent_pence: 200_000 }],
    },
    sales_phasing: { tranches: [{ month_offset: 6, pct_of_gross_receipts: 100, anchor: null }] },
    refinance: {
      month_offset: 6, investment_value_pence: null, ltv_pct: null,
      arrangement_fee_pence: 0, legal_costs_pence: 50_000, anchor: null,
      arrangement_fee_basis: 'pct_of_quantum', arrangement_fee_pct: 1.5,
    },
    investment_case: {
      stabilisation: { anchor: null, month_offset: 1, ramp_months: 1, stabilised_occupancy_pct: 96 },
      operating_lines: [
        { id: 'l1', code: 'management', label: 'Management fee', basis: 'pct_of_gross_rent', value: 10 },
        { id: 'l2', code: 'letting_and_re_letting', label: 'Letting and re-letting', basis: 'pct_of_gross_rent', value: 2 },
        { id: 'l3', code: 'insurance', label: 'Buildings insurance', basis: 'fixed_pence_per_month', value: 25_000 },
        { id: 'l4', code: 'compliance_and_safety', label: 'Compliance and safety', basis: 'fixed_pence_per_month', value: 8_000 },
      ],
      valuation: { cap_yield_pct: 5.5, purchasers_costs_pct: 6.75 },
      takeout: { ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3, annual_rate_pct: 6, amortisation_years: 25, term_years: 5 },
    },
  };
  return migrateInputsToV11(doc) as CalculatorInputsV11;
}

/**
 * A compact, dedicated retain-all document with a SMALL facility (~£47,000
 * net) relative to its NOI (~£3,470/month once stabilised at ~£347,000
 * pence/month — three modest units at £1,500/month each), so cumulative NOI
 * alone can plausibly clear the balance within the term once Task 9 wires
 * NOI into the ledger's repayment path. `_facilityNoiBase`'s facility (from
 * j-blended-refinance.json, tens of millions) is far too large for NOI alone
 * to ever redeem, which is why this is its own bespoke, smaller document
 * rather than a variant of it. Verified today (validates cleanly, runs
 * without error) — the actual redemption behaviour this name promises does
 * not exist until Task 9 lands, so it cannot be verified further yet.
 */
export function noiRedeemsDoc(): CalculatorInputsV11 {
  const doc: Record<string, unknown> = {
    inputs_version: 10, project_id: null,
    acquisition: {
      purchase_price_pence: 3_000_000, legal_fees_pence: 50_000, survey_cost_pence: 30_000,
      broker_fee_pct: 1.0, other_acquisition_costs_pence: 0,
      jurisdiction: 'england_ni', jurisdiction_source: 'user', jurisdiction_evidence_status: 'confirmed',
      acquisition_date: '2026-08-01', acquisition_tax_override_pence: null, acquisition_tax_override_reason: '',
    },
    areas: {
      basis: 'manual', existing_gia_sqm: 0, demolished_gia_sqm: 0, extension_gia_sqm: 0,
      retained_commercial_gia_sqm: 0, untouched_gia_sqm: 0, circulation_common_sqm: 0,
      plant_riser_sqm: 0, store_bin_cycle_sqm: 0, amenity_sqm: 0, external_amenity_sqm: 0,
    },
    unit_mix: {
      units: [1, 2, 3].map((i) => ({
        id: `u${i}`, type: '1bed', floor_area_sqm: 40, estimated_value_pence: 1_000_000, comparable_notes: '',
        ancillary: { balcony_terrace_sqm: 0, balcony_terrace_value_pence: 0, parking_spaces: 0, parking_value_pence: 0 },
      })),
    },
    conversion_costs: {
      prior_approval_fee_per_dwelling_pence: 0, cil_s106_pence: 0, architect_pence: 0, structural_engineer_pence: 0,
      mande_pence: 0, planning_consultant_pence: 0, building_control_pence: 0, other_professional_fees_pence: 0,
      construction_cost_per_sqm_pence: 30_000, total_construction_sqm: 120, contingency_pct: 0,
      fire_safety_pence: 0, sound_insulation_pence: 0, part_l_compliance_pence: 0,
    },
    cost_plan: {
      mode: 'headline', packages: [],
      contingency: [{ name: 'general', pct: 10 }, { name: 'existing_building', pct: 0 }, { name: 'abnormal', pct: 0 }],
      fee_lines: [],
    },
    programme: null,
    vat: {
      registered: false, return_frequency: 'quarterly', first_period_end_month: 2, repayment_lag_months: 1,
      treatments: (['acquisition', 'construction', 'professional', 'statutory', 'selling', 'lender_ancillary'] as const)
        .map((category) => ({
          category, rate_pct: 0, recoverable_pct: 0, recovery_basis: 'unconfirmed', evidence_status: 'unconfirmed', notes: '',
        })),
      purchase: { vendor_opted_to_tax: false, togc_treatment: 'unconfirmed', evidence_status: 'unconfirmed', notes: '' },
    },
    finance: {
      funding_source: 'development_finance', day_one_advance_pence: 0, day_one_market_value_pence: null,
      development_cost_advance_pct: 100, committed_net_facility_pence: 8_000_000, committed_gross_facility_pence: 8_800_000,
      annual_interest_rate_pct: 8.0, interest_type: 'rolled_up', arrangement_fee_pct: 2.0,
      arrangement_fee_basis: 'committed_net_facility', exit_fee_pct: 1.0, exit_fee_basis: 'committed_gross_facility',
      broker_fee_pence: 0, lender_legal_fee_pence: 0, valuation_fee_pence: 0, monitoring_surveyor_fee_pence: 0,
      interest_reserve_pence: null, term_months: 36, equity_draw_rule: 'equity_first', sales_sweep_pct: 100,
      legacy_leverage_pct: null, requires_confirmation: false, enforcement_cost_assumption_pence: 0,
    },
    equity_sources: [{ id: 'e1', classification: 'cash', amount_pence: 1_000_000, timing_month: 0, repayment_priority: 1, evidence_status: 'confirmed', notes: '' }],
    exit_strategy: {
      route: 'retain_all', selling_agent_fee_pct: 1.5, selling_legal_fee_pence: 0,
      retained_units: [1, 2, 3].map((i) => ({ unit_id: `u${i}`, monthly_rent_pence: 150_000 })),
    },
    sales_phasing: null,
    refinance: null,
    investment_case: {
      stabilisation: { anchor: null, month_offset: 1, ramp_months: 1, stabilised_occupancy_pct: 96 },
      operating_lines: [
        { id: 'l1', code: 'management', label: 'Management fee', basis: 'pct_of_gross_rent', value: 10 },
        { id: 'l2', code: 'letting_and_re_letting', label: 'Letting and re-letting', basis: 'pct_of_gross_rent', value: 2 },
        { id: 'l3', code: 'insurance', label: 'Buildings insurance', basis: 'fixed_pence_per_month', value: 25_000 },
        { id: 'l4', code: 'compliance_and_safety', label: 'Compliance and safety', basis: 'fixed_pence_per_month', value: 8_000 },
      ],
      valuation: { cap_yield_pct: 5.5, purchasers_costs_pct: 6.75 },
      takeout: { ltv_cap_pct: 65, dscr_floor: 1.3, icr_floor: 1.3, annual_rate_pct: 6, amortisation_years: 25, term_years: 5 },
    },
    risks: [],
    scenarios: {
      base: { label: 'Base Case', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: 0, timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0, phase_slip_phase_id: null, phase_slip_months: 0 },
      upside: { label: 'Upside', gdv_adjustment_pct: 10, construction_cost_adjustment_pct: -5, timeline_adjustment_months: -2, interest_rate_adjustment_pct: 0, phase_slip_phase_id: null, phase_slip_months: 0 },
      downside: { label: 'Downside', gdv_adjustment_pct: -10, construction_cost_adjustment_pct: 15, timeline_adjustment_months: 3, interest_rate_adjustment_pct: 1, phase_slip_phase_id: null, phase_slip_months: 0 },
      severe: { label: 'Severe', gdv_adjustment_pct: -15, construction_cost_adjustment_pct: 20, timeline_adjustment_months: 6, interest_rate_adjustment_pct: 2, phase_slip_phase_id: null, phase_slip_months: 0 },
    },
    deal_spider: {
      storeys: 2, building_height_m: 7, bsa_higher_risk: false, daylight_pass_pct: 100, absorption_months: 6,
      exit_sell: false, exit_refinance: false, exit_hold: true, exit_part_sale: false,
      prior_approval_window_months: 2, programme_contingency_months: 1, cil_offset_pence: 0,
      target_profit_on_cost_pct: 20, weights: {},
    },
    lender_valuation: null,
  };
  return migrateInputsToV11(doc) as CalculatorInputsV11;
}

/** A retain-all document with a rent MISSING for one unit (§19.7 rule 2's
 *  silent-understatement trap) — Task 15's editor test renders this directly. */
export function retainAllDocMissingRents(): CalculatorInputsV11 {
  return icDoc({ dropRetainedUnit: 'u2' });
}

// --- Thin plumbing wrappers ----------------------------------------------

/** Runs the ledger for a document, exactly as `runAppraisal` would but
 *  without deriving metrics/reconciliation too — a thin wrapper over
 *  `buildSchedule` + monthly-engine's `runLedger`, so no later task
 *  re-derives this two-call plumbing itself. */
export function runLedger(doc: CalculatorInputsV11): MonthlyModel {
  const schedule = buildSchedule(doc);
  return engineRunLedger(schedule, doc.finance, doc.equity_sources);
}

// One deliberately modest, documented step per lever — the magnitude does
// not matter for an order-independence check (Task 13's own use of this
// function), only that applying the SAME set of lever values in different
// orders gives the same result. `phase_slip` needs a target phase id, which
// this base document does not always have (e.g. icDoc()'s programme network
// does — 'construction' exists there); callers combining `phase_slip` with a
// document that has no programme network get a documented no-op, exactly as
// `applyScenario`'s own phase_slip arm already treats a null programme.
const LEVER_STEPS: Record<Exclude<SensitivityLever, 'phase_slip'>, keyof ScenarioOverrides> = {
  gdv: 'gdv_adjustment_pct',
  construction_cost: 'construction_cost_adjustment_pct',
  timeline: 'timeline_adjustment_months',
  interest_rate: 'interest_rate_adjustment_pct',
  // R13 spec §19.8. Task 13 extended this table with its own three levers —
  // see the KNOWN LIMITATION note this docstring used to carry, now resolved.
  exit_yield: 'exit_yield_adjustment_pct',
  operating_cost: 'operating_cost_adjustment_pct',
  vacancy: 'vacancy_adjustment_pct',
};

/**
 * Applies a named sequence of sensitivity levers to a document, one
 * `applyScenario` call per lever, folding left to right. Task 13's own use
 * of this (`applyLeversInOrder(icDoc(), order)` under several permutations of
 * the same set) is what needs a shared implementation: if every task built
 * its own fold it could silently apply the levers in a different combined
 * shape per call site.
 */
export function applyLeversInOrder(
  doc: CalculatorInputsV11, leverNames: readonly SensitivityLever[],
): CalculatorInputsV11 {
  const ZERO: ScenarioOverrides = {
    label: 'applyLeversInOrder', gdv_adjustment_pct: 0, construction_cost_adjustment_pct: 0,
    timeline_adjustment_months: 0, interest_rate_adjustment_pct: 0,
    phase_slip_phase_id: null, phase_slip_months: 0,
    exit_yield_adjustment_pct: 0, operating_cost_adjustment_pct: 0, vacancy_adjustment_pct: 0,
  };
  return leverNames.reduce((acc, lever) => {
    if (lever === 'phase_slip') {
      const phaseId = 'programme' in acc && acc.programme != null ? acc.programme.phases[0]?.id ?? null : null;
      return applyScenario(acc, { ...ZERO, phase_slip_phase_id: phaseId, phase_slip_months: phaseId == null ? 0 : 1 });
    }
    const field = LEVER_STEPS[lever];
    return applyScenario(acc, { ...ZERO, [field]: 5 });
  }, doc) as CalculatorInputsV11;
}

/** Runs a document through the real memo generator and returns its extracted
 *  text, so later tasks assert on prose without re-deriving the PDF-to-text
 *  plumbing `export-investment-memo.test.ts` already established (`inspectPdf`
 *  + `documentText`, the canonical extractor — not a second, ad hoc byte
 *  decode). */
export async function memoText(doc: CalculatorInputsV11): Promise<string> {
  const run = runAppraisal(doc);
  const blob = generateInvestmentMemo(FIXTURE_PROJECT, run);
  const info = await inspectPdf(blob);
  return documentText(info);
}
