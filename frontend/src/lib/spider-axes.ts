// Class MA deal-spider axis definitions — kept in a standalone module (no
// dependency on the model package or conversion-defaults) so that
// conversion-defaults.ts can read CLASS_MA_AXES without creating a circular
// import through deal-spider.ts → ./model → migrate.ts → conversion-defaults.ts.

export type SpiderAxisId =
  | 'margin_resilience'
  | 'prior_approval'
  | 'deliverability'
  | 'building_safety'
  | 'tax_advantage'
  | 'programme'
  | 'sales_velocity'
  | 'exit_optionality'
  | 'acquisition_headroom';

export interface SpiderAxisDef {
  id: SpiderAxisId;
  label: string; // radar label, may contain \n
  short: string;
  min: number;
  max: number;
  direction: 'higher' | 'lower';
  unit: string;
  help: string;
  /** True when the axis is (partly) built from an unconfirmed illustrative figure — spec §11.10. */
  illustrative?: boolean;
}

export const CLASS_MA_AXES: SpiderAxisDef[] = [
  {
    id: 'margin_resilience',
    label: 'Margin\nResilience',
    short: 'Resilience',
    min: -5,
    max: 15,
    direction: 'higher',
    unit: '%',
    help: 'Profit on cost (%) recomputed under the saved Downside scenario, not the base case. Normalised linearly from -5% (score 0) to +15% (score 5).',
  },
  {
    id: 'prior_approval',
    label: 'Prior Approval\nRisk',
    short: 'Approval',
    min: 0,
    max: 5,
    direction: 'higher',
    unit: '/5',
    help: 'Derived from the Eligibility gate: 5 × (passed checks ÷ applicable checks). Any hard-gate fail forces 0 and blocks the overall score. An unverified Article 4 or vacancy-period check caps the axis at 2 and marks it provisional.',
  },
  {
    id: 'deliverability',
    label: 'Daylight &\nLayout',
    short: 'Layout',
    min: 0,
    max: 100,
    direction: 'higher',
    unit: '%',
    help: 'The lower of (a) % of proposed units meeting NDSS minimum floor areas (studio 37m², 1-bed 50m², 2-bed 61m², 3-bed 74m²) and (b) the manual daylight pass % entered on this page. Normalised 0–100% to 0–5.',
  },
  {
    id: 'building_safety',
    label: 'Building\nSafety',
    short: 'Safety',
    min: 0,
    max: 5,
    direction: 'higher',
    unit: '/5',
    help: 'Banded from height/storeys: higher-risk building (≥18m, ≥7 storeys, or flagged HRB) scores 0; 11–18m or 5–6 storeys scores 3 (EWS1 / remediation exposure); below that scores 5.',
  },
  {
    id: 'tax_advantage',
    label: 'Tax\nAdvantage',
    short: 'Tax',
    min: 0,
    max: 6,
    direction: 'higher',
    unit: '% GDV',
    // Task 13 (spec §17.10). The VAT component used to be a flat
    // `construction_cost_pence * 0.15` guess; it is now the VAT actually
    // saved against a standard-rated (20%) counterfactual, net of
    // irrecoverable VAT and the VAT carry's own finance cost — the same VAT
    // model reported everywhere else in the document, not a second figure
    // that could disagree with it. It is 0, not a confirmed zero advantage,
    // wherever the document is not VAT-registered (computeSpider's
    // per-run `note` on this axis says so explicitly).
    //
    // `illustrative` stays true (judgement call, task-13 brief): the VAT
    // figure is no longer a guess, but this axis still adds an SDLT
    // counterfactual and a manually-entered CIL offset into ONE number that
    // no lender metric reads anywhere else — that combination, not the VAT
    // term alone, is what keeps the whole axis out of the appraisal.
    help: 'Tax captured by the commercial-to-resi route as % of GDV: (residential SDLT incl. 5% surcharge − non-residential SDLT actually paid) + the VAT this deal\'s own modelled treatment saves against a standard-rated (20%) counterfactual, net of irrecoverable VAT and VAT carry interest + CIL existing-floorspace offset. Zero, not a confirmed zero tax advantage, wherever the document is not VAT-registered. Illustrative only: folds an SDLT counterfactual and a manual CIL offset into one number no lender metric uses, so it stays excluded from the appraisal and all lender metrics. A caveat appears alongside this axis whenever the VAT evidence itself is UNCONFIRMED for a charged category or the purchase treatment. Normalised 0–6% of GDV to 0–5.',
    illustrative: true,
  },
  {
    id: 'programme',
    label: 'Programme\nRisk',
    short: 'Programme',
    min: 8,
    max: 30,
    direction: 'lower',
    unit: 'mo',
    help: 'Total months from exchange to practical completion: 56-day prior approval window (as months) + loan term + programme contingency. Normalised 8 months (score 5) to 30 months (score 0).',
  },
  {
    id: 'sales_velocity',
    label: 'Sales\nVelocity',
    short: 'Sales',
    min: 3,
    max: 18,
    direction: 'lower',
    unit: 'mo',
    help: 'Absorption months to dispose of the full unit count, entered manually on this page. Normalised 3 months (score 5) to 18 months (score 0).',
  },
  {
    id: 'exit_optionality',
    label: 'Exit\nOptionality',
    short: 'Exit',
    min: 0,
    max: 4,
    direction: 'higher',
    unit: 'routes',
    help: 'Count of viable exits ticked on this page: sell / refinance / hold / part-sale-part-hold. Normalised 0 routes (score 0) to 4 routes (score 5).',
  },
  {
    id: 'acquisition_headroom',
    label: 'Acquisition\nHeadroom',
    short: 'Headroom',
    min: 0,
    max: 30,
    direction: 'higher',
    unit: '%',
    help: '(Max bid − purchase price) ÷ max bid, where max bid is the residual land value at the target profit on cost set on this page. Normalised 0% (score 0) to 30% (score 5). Negative headroom scores 0.',
  },
];
