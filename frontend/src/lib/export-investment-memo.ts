import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project, EligibilityAssessment } from '../types';
import type { AppraisalRun, ModelFlag } from './model';
import { runAppraisal } from './model';
import { applyScenario } from './apply-scenario';

// ── This memo consumes the finished AppraisalRun only ─────
//
// generateInvestmentMemo performs zero recalculation of financial metrics:
// every figure it prints comes from run.metrics, run.model or
// run.schedule.totals (the shared engine's output — frontend/src/lib/model),
// or is a raw, unmodified input value. The only local arithmetic below is
// presentational: unit conversions (pence→£/sq ft), running totals for a
// cashflow table, ratios of two already-authoritative totals (e.g. a
// category's % of an engine-computed grand total), and the Retained
// Portfolio's indicative gross yield (rent ÷ capital value — the engine does
// not model rental income at all, so there is no authoritative figure to
// consume; captioned "indicative — not part of the appraisal" wherever shown).
// No cost, fee, LTV, LTC, IRR or profit figure is re-derived here — see
// docs/financial-model/calculation-specification.md §11 for the
// prohibited-calculations list this file was rewritten to comply with.

const PAGE_W = 210;
const MARGIN_L = 20;
const MARGIN_R = 20;
const MARGIN_T = 25;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const FOOTER_Y = 287;

const DRAFT_WATERMARK_TEXT = 'DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE';

function fmt(pence: number): string {
  return (pence / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  });
}

function fmtPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/** Percentage that may be `null` (spec §1.5 — unknown, zero-denominator, or not yet available). */
function fmtPctSafe(pct: number | null, naLabel = 'n/a'): string {
  return pct === null ? naLabel : fmtPct(pct);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function todayFormatted(): string {
  return fmtDate(new Date().toISOString());
}

function sqmToSqft(sqm: number): number {
  return Math.round(sqm * 10.7639);
}

/** Presentational unit conversion of an already-authoritative pence total — not a formula. */
function perSqftPence(totalPence: number, sqm: number): string {
  if (sqm <= 0) return '-';
  const sqft = sqmToSqft(sqm);
  return fmt(Math.round(totalPence / sqft));
}

function unitLabel(type: string): string {
  const map: Record<string, string> = {
    studio: 'Studio',
    '1bed': '1-Bed',
    '2bed': '2-Bed',
    '3bed': '3-Bed',
  };
  return map[type] ?? type;
}

function flagPresent(flags: ModelFlag[], code: ModelFlag['code']): boolean {
  return flags.some((f) => f.code === code);
}

/** Short codes for the sensitivity-grid flag column (spec §11.8 — debt is never re-sized in scenarios). */
function flagShortCodes(flags: ModelFlag[]): string {
  const codes: string[] = [];
  if (flagPresent(flags, 'facility_exceeded')) codes.push('FE');
  if (flagPresent(flags, 'funding_gap')) codes.push('FG');
  if (flagPresent(flags, 'senior_outstanding_at_maturity')) codes.push('NR');
  return codes.join(',');
}

/** Full-word flag summary for the Scenario Comparison table's Flags row. */
function flagSummary(flags: ModelFlag[]): string {
  const labels: string[] = [];
  if (flagPresent(flags, 'facility_exceeded')) labels.push('Facility exceeded');
  if (flagPresent(flags, 'funding_gap')) labels.push('Funding gap');
  if (flagPresent(flags, 'senior_outstanding_at_maturity')) labels.push('Senior not repaid');
  return labels.length > 0 ? labels.join('; ') : 'None';
}

/**
 * Sources = uses to the penny (spec §7), computed here for the report table only —
 * this mirrors frontend/src/lib/model/validation.ts's reconcile() aggregation of
 * already-computed ledger totals; it is a display grouping of engine output, not a
 * new financial formula. Exported so tests can assert the identity directly.
 */
export function sourcesAndUsesTotals(run: AppraisalRun): {
  usesTotal: number;
  sourcesTotal: number;
  rolledInterestPence: number;
} {
  const { model, schedule, metrics, inputs } = run;
  const rolledInterestPence = inputs.finance.interest_type === 'rolled_up' ? model.totals.interest_pence : 0;
  const usesTotal = metrics.total_development_cost_pence;
  const sourcesTotal =
    model.totals.equity_contributed_pence +
    model.totals.additional_equity_pence +
    model.totals.funding_gap_pence +
    model.totals.draws_pence +
    model.totals.capitalised_fees_pence +
    rolledInterestPence +
    schedule.totals.selling_costs_pence +
    model.totals.exit_fee_pence;
  return { usesTotal, sourcesTotal, rolledInterestPence };
}

export function generateInvestmentMemo(
  project: Project,
  run: AppraisalRun,
  eligibility?: EligibilityAssessment | null,
): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { inputs, metrics, model, schedule } = run;
  const draft = !run.reconciliation.report_safe;

  const totalSqm = inputs.unit_mix.units.reduce((s, u) => s + u.floor_area_sqm, 0);
  const totalSqft = sqmToSqft(totalSqm);
  const unitCount = inputs.unit_mix.units.length;

  // ── Draft watermark (spec: unreconciled appraisals never look lender-ready) ──
  function watermark(): void {
    doc.setTextColor(200);
    doc.setFontSize(40);
    doc.setFont('helvetica', 'bold');
    doc.text(DRAFT_WATERMARK_TEXT, PAGE_W / 2, 160, { angle: 35, align: 'center' });
  }

  // jspdf-autotable paginates internally via its own doc.addPage() calls when
  // a table spans multiple pages — those pages never go through newPage()
  // below, so watermarking must also be driven by autoTable's didDrawPage
  // hook (see the table() wrapper). lastWatermarkedPage guards against
  // watermarking the same physical page twice (harmless — it would just
  // redraw identical grey text in the same place — but pointless work).
  let lastWatermarkedPage = 0;

  /** Draws the watermark on the current page, at most once per physical page. */
  function ensureWatermark(): void {
    if (!draft) return;
    const page = doc.getNumberOfPages();
    if (page === lastWatermarkedPage) return;
    lastWatermarkedPage = page;
    watermark();
  }

  /** Every new page gets the watermark when the run isn't report-safe. */
  function newPage(): void {
    doc.addPage();
    ensureWatermark();
  }

  /**
   * autoTable wrapper — every table call must go through this, not
   * autoTable(doc, ...) directly, so that pages autoTable creates on its own
   * (internal pagination for a table taller than one page) also get the
   * watermark via didDrawPage, which fires once per physical page the table
   * touches, including the first.
   */
  function table(options: Parameters<typeof autoTable>[1]): void {
    autoTable(doc, {
      ...options,
      didDrawPage: (data) => {
        ensureWatermark();
        options.didDrawPage?.(data);
      },
    });
  }

  function addPageFooter(): void {
    const pageCount = doc.getNumberOfPages();
    for (let i = 2; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150);
      doc.text(project.address_raw, MARGIN_L, FOOTER_Y);
      doc.text('CONFIDENTIAL', PAGE_W / 2, FOOTER_Y, { align: 'center' });
      doc.text(`Page ${i - 1}`, PAGE_W - MARGIN_R, FOOTER_Y, { align: 'right' });
    }
  }

  function sectionTitle(y: number, num: number, title: string): number {
    if (y > 245) {
      newPage();
      y = MARGIN_T;
    }
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 95);
    doc.text(`${num}. ${title}`, MARGIN_L, y);
    y += 4;
    doc.setDrawColor(30, 58, 95);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_L, y, MARGIN_L + CONTENT_W, y);
    return y + 8;
  }

  function subHeading(y: number, text: string): number {
    if (y > 255) {
      newPage();
      y = MARGIN_T;
    }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(text, MARGIN_L, y);
    return y + 6;
  }

  function bodyText(y: number, text: string): number {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(text, CONTENT_W);
    for (const line of lines) {
      if (y > 270) {
        newPage();
        y = MARGIN_T;
      }
      doc.text(line, MARGIN_L, y);
      y += 5;
    }
    return y + 2;
  }

  function infoRequired(y: number, label: string): number {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(180, 83, 9);
    if (y > 270) {
      newPage();
      y = MARGIN_T;
    }
    doc.text(`[Information Required: ${label}]`, MARGIN_L, y);
    doc.setFont('helvetica', 'normal');
    return y + 6;
  }

  // ── Cover Page ──
  doc.setFillColor(10, 22, 40);
  doc.rect(0, 0, PAGE_W, 297, 'F');
  ensureWatermark();

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('PROJECT REPORT / INVESTMENT MEMORANDUM', MARGIN_L, 60);

  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(226, 232, 240);
  const titleLines = doc.splitTextToSize(project.address_raw, CONTENT_W);
  let ty = 75;
  for (const line of titleLines) {
    doc.text(line, MARGIN_L, ty);
    ty += 10;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  ty += 5;
  if (project.address_postcode) {
    doc.text(project.address_postcode, MARGIN_L, ty);
    ty += 7;
  }
  doc.text(
    `${project.use_class.replace(/_/g, ' ').toUpperCase()} -> RESIDENTIAL CONVERSION`,
    MARGIN_L,
    ty,
  );
  ty += 7;
  doc.text(
    `${unitCount} unit${unitCount !== 1 ? 's' : ''} | ${totalSqft.toLocaleString()} sq ft NIA`,
    MARGIN_L,
    ty,
  );

  ty += 20;
  doc.setDrawColor(30, 58, 95);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_L, ty, MARGIN_L + CONTENT_W, ty);
  ty += 12;

  const coverMetrics = [
    ['GDV', fmt(metrics.gdv_pence)],
    ['Total Development Cost', fmt(metrics.total_development_cost_pence)],
    ['Profit on Cost', fmtPctSafe(metrics.profit_on_cost_pct)],
    ['Profit on GDV', fmtPctSafe(metrics.profit_on_gdv_pct)],
    ['IRR (Annual)', fmtPctSafe(metrics.irr_annual_pct)],
    ['Equity Contributed', fmt(metrics.equity_contributed_pence)],
  ];
  doc.setFontSize(10);
  for (const [label, value] of coverMetrics) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(label, MARGIN_L, ty);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(226, 232, 240);
    doc.text(value, MARGIN_L + 65, ty);
    ty += 7;
  }

  ty = 250;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Date: ${todayFormatted()}`, MARGIN_L, ty);
  ty += 5;
  doc.text('PRIVATE & CONFIDENTIAL', MARGIN_L, ty);
  ty += 5;
  doc.text(
    'This document is prepared for the sole use of the intended recipient and should not be',
    MARGIN_L,
    ty,
  );
  ty += 4;
  doc.text(
    'distributed without the prior written consent of the sponsor.',
    MARGIN_L,
    ty,
  );

  // ── Section 1: Executive Summary ──
  doc.addPage();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, 297, 'F');
  ensureWatermark();
  let y = MARGIN_T;

  y = sectionTitle(y, 1, 'Executive Summary');

  const fundingLabel =
    inputs.finance.funding_source === 'cash'
      ? 'Cash'
      : inputs.finance.funding_source === 'bridging'
        ? 'Bridging loan'
        : 'Development finance';

  y = bodyText(
    y,
    `This memorandum presents the investment case for the acquisition and conversion of ${project.address_raw} from ${project.use_class.replace(/_/g, ' ')} use to ${unitCount} residential unit${unitCount !== 1 ? 's' : ''} under Permitted Development Rights.`,
  );

  y = subHeading(y, 'The Ask');
  y = bodyText(
    y,
    `Total development cost is ${fmt(metrics.total_development_cost_pence)}, funded through ${fmt(metrics.equity_contributed_pence)} equity and peak senior debt of ${fmt(metrics.peak_debt_pence)} (${fundingLabel.toLowerCase()}), representing gross LTC of ${fmtPctSafe(metrics.gross_ltc_pct)}.`,
  );

  y = subHeading(y, 'Use of Funds');
  const tdcForShare = metrics.total_development_cost_pence;
  const shareOfTdc = (part: number) => (tdcForShare > 0 ? fmtPct((part / tdcForShare) * 100) : fmtPct(0));
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Category', 'Amount', '% of Total']],
    body: [
      ['Acquisition (inc. SDLT)', fmt(metrics.acquisition_cost_pence), shareOfTdc(metrics.acquisition_cost_pence)],
      ['Construction', fmt(metrics.construction_cost_pence), shareOfTdc(metrics.construction_cost_pence)],
      ['Professional Fees', fmt(metrics.professional_fees_pence), shareOfTdc(metrics.professional_fees_pence)],
      ['Statutory Costs', fmt(metrics.statutory_costs_pence), shareOfTdc(metrics.statutory_costs_pence)],
      ['Selling Costs', fmt(metrics.selling_costs_pence), shareOfTdc(metrics.selling_costs_pence)],
      ['Finance Costs', fmt(metrics.finance_costs_pence), shareOfTdc(metrics.finance_costs_pence)],
      ['Total', fmt(metrics.total_development_cost_pence), '100.0%'],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = subHeading(y, 'Headline Returns');
  y = bodyText(
    y,
    `GDV of ${fmt(metrics.gdv_pence)} against total development cost of ${fmt(metrics.total_development_cost_pence)} generates a profit of ${fmt(metrics.profit_pence)}${metrics.profit_is_unrealised ? ' (unrealised — subject to refinance/valuation)' : ''}, equating to ${fmtPctSafe(metrics.profit_on_cost_pct)} profit on cost and ${fmtPctSafe(metrics.profit_on_gdv_pct)} profit on GDV. Annualised IRR is ${fmtPctSafe(metrics.irr_annual_pct, 'not available (no sign change in equity flows)')}, with return on equity of ${fmtPctSafe(metrics.return_on_equity_pct)} over a ${inputs.finance.term_months}-month programme.`,
  );

  y = subHeading(y, 'Exit');
  const exitLabel =
    inputs.exit_strategy.route === 'sell_all'
      ? 'Sale of all units on the open market'
      : inputs.exit_strategy.route === 'retain_all'
        ? 'Retention of all units as buy-to-let investments'
        : 'Blended exit — partial sale and partial retention';
  y = bodyText(y, `Primary exit: ${exitLabel}.`);

  // ── Section 2: The Opportunity ──
  if (y > 220) {
    newPage();
    y = MARGIN_T;
  }
  y = sectionTitle(y, 2, 'The Opportunity');
  y = bodyText(
    y,
    `The property at ${project.address_raw} is a ${project.use_class.replace(/_/g, ' ')} premises being offered at ${fmt(project.price_pence)}${project.price_qualifier ? ` (${project.price_qualifier})` : ''}. The building comprises ${project.floors ?? '—'} storey${(project.floors ?? 0) > 1 ? 's' : ''} with a gross floor area of approximately ${project.floor_area_sqm?.toLocaleString() ?? '—'} m² (${project.floor_area_sqft?.toLocaleString() ?? '—'} sq ft).`,
  );
  y = bodyText(
    y,
    `Tenure is ${project.tenure}${project.lease_years_remaining ? ` with ${project.lease_years_remaining} years remaining` : ''}. EPC rating: ${project.epc_rating ?? 'Unknown'}. Vacancy status: ${project.is_vacant === true ? 'Vacant' : project.is_vacant === false ? 'Occupied' : 'Unknown'}.`,
  );
  if (project.description) {
    y = bodyText(y, project.description);
  }
  y = infoRequired(y, 'Market rationale — why this asset, why now, demand drivers');

  // ── Section 3: The Scheme ──
  if (y > 200) {
    newPage();
    y = MARGIN_T;
  }
  y = sectionTitle(y, 3, 'The Scheme');

  y = subHeading(y, 'Description');
  y = bodyText(
    y,
    `Conversion of existing ${project.use_class.replace(/_/g, ' ')} premises to ${unitCount} residential unit${unitCount !== 1 ? 's' : ''} comprising a total of ${totalSqm.toLocaleString()} m² (${totalSqft.toLocaleString()} sq ft) net internal area.`,
  );

  y = subHeading(y, 'Proposed Unit Mix');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Unit', 'Type', 'NIA (m²)', 'NIA (sq ft)', 'Est. Value', '£/sq ft', 'Notes']],
    body: inputs.unit_mix.units.map((u, i) => [
      `${i + 1}`,
      unitLabel(u.type),
      u.floor_area_sqm.toLocaleString(),
      sqmToSqft(u.floor_area_sqm).toLocaleString(),
      fmt(u.estimated_value_pence),
      perSqftPence(u.estimated_value_pence, u.floor_area_sqm),
      u.comparable_notes || '—',
    ]),
    foot: [[
      '',
      `${unitCount} units`,
      totalSqm.toLocaleString(),
      totalSqft.toLocaleString(),
      fmt(metrics.gdv_pence),
      perSqftPence(metrics.gdv_pence, totalSqm),
      '',
    ]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    footStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(y, 'Planning Position');
  if (eligibility) {
    const pdrLabel = eligibility.pdr_class.replace(/_/g, ' ').toUpperCase();
    y = bodyText(
      y,
      `Eligible for conversion under ${pdrLabel}. Eligibility verdict: ${eligibility.verdict.toUpperCase()}.`,
    );
    const failedCriteria = eligibility.criteria.filter((c) => c.passed === false);
    const pendingCriteria = eligibility.criteria.filter((c) => c.passed === null);
    if (failedCriteria.length > 0) {
      y = bodyText(
        y,
        `Failed criteria: ${failedCriteria.map((c) => c.label).join('; ')}.`,
      );
    }
    if (pendingCriteria.length > 0) {
      y = bodyText(
        y,
        `Pending verification: ${pendingCriteria.map((c) => c.label).join('; ')}.`,
      );
    }
  } else {
    y = infoRequired(y, 'Planning status, permission reference, conditions outstanding');
  }
  y = infoRequired(y, 'Design and specification status, procurement route, contractor');

  // ── Section 4: Market Evidence ──
  if (y > 220) {
    newPage();
    y = MARGIN_T;
  }
  y = sectionTitle(y, 4, 'Market Evidence');
  y = bodyText(
    y,
    'Comparable evidence should support the revenue assumptions adopted in the appraisal. Each comparable is listed below with address, transaction date, size, achieved £/sq ft, and source.',
  );

  const compsWithNotes = inputs.unit_mix.units.filter((u) => u.comparable_notes);
  if (compsWithNotes.length > 0) {
    y = subHeading(y, 'Comparable Notes from Unit Schedule');
    for (const u of compsWithNotes) {
      y = bodyText(
        y,
        `${unitLabel(u.type)} (${u.floor_area_sqm} m²) at ${fmt(u.estimated_value_pence)} — ${u.comparable_notes}`,
      );
    }
  }

  y = infoRequired(
    y,
    'Full comparable table: address, date, size (sq ft), £/sq ft, source for each transaction',
  );
  y = infoRequired(y, 'Absorption rates, demand drivers, local market commentary');

  // ── Section 5: Development Appraisal ──
  newPage();
  y = MARGIN_T;
  y = sectionTitle(y, 5, 'Development Appraisal');

  y = subHeading(y, 'Revenue');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Item', 'Amount']],
    body: [
      ['Gross Development Value (GDV)', fmt(metrics.gdv_pence)],
      ['Blended £/sq ft', perSqftPence(metrics.gdv_pence, totalSqm)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: { 1: { halign: 'right' } },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(y, 'Cost Plan');
  // Every row below is either a raw stored input (rate, area, fixed fee) or an
  // engine-computed total from run.metrics / run.model.totals — no cost or fee
  // amount is derived here (spec §11.9).
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Element', 'Amount', '£/sq ft']],
    body: [
      ['ACQUISITION', '', ''],
      ['  Purchase price', fmt(inputs.acquisition.purchase_price_pence), perSqftPence(inputs.acquisition.purchase_price_pence, totalSqm)],
      ['  SDLT', fmt(metrics.sdlt_pence), perSqftPence(metrics.sdlt_pence, totalSqm)],
      ['  Legal fees', fmt(inputs.acquisition.legal_fees_pence), ''],
      ['  Survey', fmt(inputs.acquisition.survey_cost_pence), ''],
      [`  Broker fee rate`, fmtPct(inputs.acquisition.broker_fee_pct), ''],
      ['  Other acquisition costs', fmt(inputs.acquisition.other_acquisition_costs_pence), ''],
      ['  Sub-total acquisition (inc. SDLT, fees)', fmt(metrics.acquisition_cost_pence), perSqftPence(metrics.acquisition_cost_pence, totalSqm)],
      ['', '', ''],
      ['CONSTRUCTION', '', ''],
      ['  Build rate', `${fmt(inputs.conversion_costs.construction_cost_per_sqm_pence)}/m²`, ''],
      [`  Contingency rate`, fmtPct(inputs.conversion_costs.contingency_pct), ''],
      ['  Fire safety', fmt(inputs.conversion_costs.fire_safety_pence), ''],
      ['  Sound insulation', fmt(inputs.conversion_costs.sound_insulation_pence), ''],
      ['  Part L compliance', fmt(inputs.conversion_costs.part_l_compliance_pence), ''],
      ['  Sub-total construction (inc. contingency)', fmt(metrics.construction_cost_pence), perSqftPence(metrics.construction_cost_pence, totalSqm)],
      ['', '', ''],
      ['PROFESSIONAL FEES', '', ''],
      ['  Architect', fmt(inputs.conversion_costs.architect_pence), ''],
      ['  Structural engineer', fmt(inputs.conversion_costs.structural_engineer_pence), ''],
      ['  M&E', fmt(inputs.conversion_costs.mande_pence), ''],
      ['  Planning consultant', fmt(inputs.conversion_costs.planning_consultant_pence), ''],
      ['  Other professional fees', fmt(inputs.conversion_costs.other_professional_fees_pence), ''],
      ['  Sub-total professional fees', fmt(metrics.professional_fees_pence), perSqftPence(metrics.professional_fees_pence, totalSqm)],
      ['', '', ''],
      ['STATUTORY COSTS', '', ''],
      ['  Prior approval fee per dwelling', fmt(inputs.conversion_costs.prior_approval_fee_per_dwelling_pence), ''],
      ['  CIL / S106', fmt(inputs.conversion_costs.cil_s106_pence), ''],
      ['  Building control', fmt(inputs.conversion_costs.building_control_pence), ''],
      ['  Sub-total statutory costs', fmt(metrics.statutory_costs_pence), perSqftPence(metrics.statutory_costs_pence, totalSqm)],
      ['', '', ''],
      ['FINANCE COSTS', '', ''],
      [`  Arrangement fee (${fmtPct(inputs.finance.arrangement_fee_pct)} of ${inputs.finance.arrangement_fee_basis.replace(/_/g, ' ')})`, fmt(model.totals.arrangement_fee_pence), ''],
      [`  Exit fee (${fmtPct(inputs.finance.exit_fee_pct)} of ${inputs.finance.exit_fee_basis.replace(/_/g, ' ')})`, fmt(model.totals.exit_fee_pence), ''],
      [`  Interest (${fmtPct(inputs.finance.annual_interest_rate_pct)} p.a., ${inputs.finance.term_months} months)`, fmt(model.totals.interest_pence), ''],
      ['  Ancillary lender fees', fmt(model.totals.ancillary_fees_pence), ''],
      ['  Sub-total finance costs', fmt(metrics.finance_costs_pence), ''],
      ['', '', ''],
      ['TOTAL DEVELOPMENT COST', fmt(metrics.total_development_cost_pence), perSqftPence(metrics.total_development_cost_pence, totalSqm)],
    ],
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
    didParseCell(data) {
      const text = String(data.cell.raw);
      if (
        text.startsWith('ACQUISITION') ||
        text.startsWith('CONSTRUCTION') ||
        text.startsWith('PROFESSIONAL') ||
        text.startsWith('STATUTORY') ||
        text.startsWith('FINANCE') ||
        text.startsWith('TOTAL')
      ) {
        data.cell.styles.fontStyle = 'bold';
      }
      if (text.includes('Sub-total') || text.startsWith('TOTAL')) {
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(y, 'Appraisal Metrics');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Gross Development Value', fmt(metrics.gdv_pence)],
      ['Total Development Cost', fmt(metrics.total_development_cost_pence)],
      [`Developer Profit${metrics.profit_is_unrealised ? ' (unrealised)' : ''}`, fmt(metrics.profit_pence)],
      ['Profit on Cost', fmtPctSafe(metrics.profit_on_cost_pct)],
      ['Profit on GDV', fmtPctSafe(metrics.profit_on_gdv_pct)],
      ['Return on Equity', fmtPctSafe(metrics.return_on_equity_pct)],
      ['Equity Multiple', metrics.equity_multiple === null ? 'n/a' : `${metrics.equity_multiple.toFixed(2)}x`],
      ['IRR (Annual)', fmtPctSafe(metrics.irr_annual_pct, 'not available (no sign change in equity flows)')],
      [`Residual Land Value (at ${fmtPct(inputs.deal_spider.target_profit_on_cost_pct)} target profit on cost)`, fmt(metrics.rlv_pence)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(y, 'Residual Land Value Check');
  const rlvDiff = metrics.rlv_pence - inputs.acquisition.purchase_price_pence;
  const rlvHeadroom = inputs.acquisition.purchase_price_pence > 0
    ? (rlvDiff / inputs.acquisition.purchase_price_pence) * 100
    : 0;
  y = bodyText(
    y,
    `At the deal spider's configured target profit on cost of ${fmtPct(inputs.deal_spider.target_profit_on_cost_pct)}, the residual land value is ${fmt(metrics.rlv_pence)}. The purchase price of ${fmt(inputs.acquisition.purchase_price_pence)} is ${rlvDiff >= 0 ? `${fmt(Math.abs(rlvDiff))} below` : `${fmt(Math.abs(rlvDiff))} above`} the RLV, representing ${rlvDiff >= 0 ? 'positive' : 'negative'} headroom of ${fmtPct(Math.abs(rlvHeadroom))}. This RLV uses the appraisal's own finance and SDLT (spec §3.18) — it is not re-solved for the residual price.`,
  );

  // ── Section 6: Programme ──
  newPage();
  y = MARGIN_T;
  y = sectionTitle(y, 6, 'Programme');

  y = subHeading(y, 'Timeline');
  y = bodyText(
    y,
    `Total programme: ${inputs.finance.term_months} months. Peak senior debt of ${fmt(metrics.peak_debt_pence)} is reached in month ${metrics.peak_debt_month !== null ? metrics.peak_debt_month + 1 : '—'} of the programme. Total interest cost: ${fmt(model.totals.interest_pence)}.`,
  );
  y = infoRequired(y, 'Key dates — start on site, practical completion, sales/letting period');
  y = infoRequired(y, 'Critical path, long-lead items');

  y = subHeading(y, 'Monthly Cashflow');
  let cumDraw = 0;
  let cumEquityCf = 0;
  const cfRows = model.months.map((m, i) => {
    cumDraw += m.draw_pence;
    cumEquityCf += model.equity_cashflows_pence[i] ?? 0;
    return [
      `Month ${m.month + 1}`,
      fmt(m.draw_pence),
      fmt(cumDraw),
      fmt(m.interest_accrued_pence),
      fmt(m.closing_balance_pence),
      fmt(m.gross_receipts_pence),
      fmt(model.equity_cashflows_pence[i] ?? 0),
      fmt(cumEquityCf),
    ];
  });
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Month', 'Draw', 'Cum. Draw', 'Interest', 'Closing Bal.', 'Receipts', 'Equity CF', 'Cum. Equity CF']],
    body: cfRows,
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 7 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Section 7: Funding Request ──
  if (y > 200) {
    newPage();
    y = MARGIN_T;
  }
  y = sectionTitle(y, 7, 'Funding Request');

  y = subHeading(y, 'Sources & Uses');
  const { usesTotal, sourcesTotal, rolledInterestPence } = sourcesAndUsesTotals(run);
  const usesRows: Array<[string, number]> = [
    ['Acquisition (inc. SDLT)', metrics.acquisition_cost_pence],
    ['Construction', metrics.construction_cost_pence],
    ['Professional fees', metrics.professional_fees_pence],
    ['Statutory costs', metrics.statutory_costs_pence],
    ['Selling costs', metrics.selling_costs_pence],
    ['Finance costs', metrics.finance_costs_pence],
  ];
  const sourcesRows: Array<[string, number]> = [
    ['Equity contributed', model.totals.equity_contributed_pence],
    ['Additional equity required', model.totals.additional_equity_pence],
    ['Funding gap (unfunded)', model.totals.funding_gap_pence],
    ['Senior debt draws', model.totals.draws_pence],
    ['Capitalised lender fees', model.totals.capitalised_fees_pence],
    ['Rolled-up interest', rolledInterestPence],
    ['Proceeds applied — selling costs', schedule.totals.selling_costs_pence],
    ['Proceeds applied — exit fee', model.totals.exit_fee_pence],
  ];
  const suRowCount = Math.max(usesRows.length, sourcesRows.length);
  const suBody: string[][] = [];
  for (let i = 0; i < suRowCount; i++) {
    const s = sourcesRows[i];
    const u = usesRows[i];
    suBody.push([
      s ? s[0] : '',
      s ? fmt(s[1]) : '',
      '',
      u ? u[0] : '',
      u ? fmt(u[1]) : '',
    ]);
  }
  suBody.push(['Total', fmt(sourcesTotal), '', 'Total', fmt(usesTotal)]);

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Sources', 'Amount', '', 'Uses', 'Amount']],
    body: suBody,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      1: { halign: 'right' },
      2: { cellWidth: 5 },
      4: { halign: 'right' },
    },
    didParseCell(data) {
      const text = String(data.cell.raw);
      if (text === 'Total') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;
  y = bodyText(
    y,
    `Sources and uses both total ${fmt(sourcesTotal)} (spec §7 invariant: sum of sources = sum of uses).${!run.reconciliation.sources_equal_uses ? ' WARNING: this run does not reconcile — see the draft watermark and the reconciliation panel.' : ''}`,
  );

  y = subHeading(y, 'Key Lending Metrics');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Peak senior debt', fmt(metrics.peak_debt_pence)],
      ['Net LTC (excl. finance)', fmtPctSafe(metrics.net_ltc_pct)],
      ['Gross LTC (incl. finance)', fmtPctSafe(metrics.gross_ltc_pct)],
      ['LTGDV (developer basis)', fmtPctSafe(metrics.ltgdv_developer_pct)],
      ['LTGDV (lender basis)', metrics.ltgdv_lender_pct === null ? 'not available (Release 2)' : fmtPct(metrics.ltgdv_lender_pct)],
      ['Facility headroom (gross)', metrics.facility_headroom_pence === null ? 'not available — no facility' : fmt(metrics.facility_headroom_pence)],
      ['Interest reserve remaining', metrics.interest_reserve_remaining_pence === null ? 'n/a' : fmt(metrics.interest_reserve_remaining_pence)],
      ['Interest rate', `${fmtPct(inputs.finance.annual_interest_rate_pct)} p.a.`],
      ['Interest type', inputs.finance.interest_type === 'rolled_up' ? 'Rolled up' : 'Serviced'],
      ['Facility term', `${inputs.finance.term_months} months`],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;
  y = bodyText(
    y,
    'Net LTC = cumulative net senior advances (principal draws + capitalised non-interest fees) ÷ development cost before disposal and finance (spec §5.4). Gross LTC = peak gross senior debt ÷ total development cost, TDC (spec §5.5). LTGDV = peak gross senior debt ÷ GDV; the lender-underwritten GDV basis is not yet available (Release 2).',
  );

  y = infoRequired(y, 'Security package — first charge, debenture, personal guarantees');
  y = infoRequired(y, 'Drawdown profile, priority of repayment');

  // ── Section 8: Returns ──
  if (y > 200) {
    newPage();
    y = MARGIN_T;
  }
  y = sectionTitle(y, 8, 'Returns');

  y = subHeading(y, 'Investor Returns');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Internal Rate of Return (IRR, annual)', fmtPctSafe(metrics.irr_annual_pct, 'not available (no sign change in equity flows)')],
      ['Equity Multiple', metrics.equity_multiple === null ? 'n/a' : `${metrics.equity_multiple.toFixed(2)}x`],
      ['Return on Equity', fmtPctSafe(metrics.return_on_equity_pct)],
      ['Profit on Cost', fmtPctSafe(metrics.profit_on_cost_pct)],
      ['Profit on GDV', fmtPctSafe(metrics.profit_on_gdv_pct)],
      ['Hold Period', `${inputs.finance.term_months} months`],
      [`Total Profit${metrics.profit_is_unrealised ? ' (unrealised)' : ''}`, fmt(metrics.profit_pence)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = infoRequired(y, 'Waterfall / promote structure (if JV)');

  y = subHeading(y, 'Lender Position — Day-one LTV');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Day-one senior advance', fmt(metrics.day_one_advance_pence)],
      ['Day-one LTV (vs purchase price)', fmtPctSafe(metrics.day_one_ltv_on_price_pct)],
      [
        'Day-one LTV (vs day-one market value)',
        metrics.day_one_ltv_on_value_pct === null
          ? 'not available — no day-one market value provided'
          : fmtPct(metrics.day_one_ltv_on_value_pct),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;
  y = bodyText(
    y,
    'Day-one LTV = the actual month-0 senior advance (not the committed facility) ÷ purchase price, or ÷ day-one market value where provided (spec §5.1). Dividing the total committed facility by purchase price is not a valid day-one LTV and is never reported.',
  );

  // ── Section 9: Risk Register ──
  newPage();
  y = MARGIN_T;
  y = sectionTitle(y, 9, 'Risk Register');

  if (inputs.risks.length > 0) {
    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['#', 'Risk', 'Likelihood', 'Impact', 'Mitigation']],
      body: inputs.risks.map((r, i) => [
        `${i + 1}`,
        r.description || '—',
        r.likelihood.charAt(0).toUpperCase() + r.likelihood.slice(1),
        r.impact.charAt(0).toUpperCase() + r.impact.slice(1),
        r.mitigation || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: {
        0: { halign: 'center', cellWidth: 8 },
        1: { cellWidth: 45 },
        2: { cellWidth: 22 },
        3: { cellWidth: 22 },
      },
      didParseCell(data) {
        if (data.section === 'body') {
          const val = String(data.cell.raw).toLowerCase();
          if (data.column.index === 2 || data.column.index === 3) {
            if (val === 'high') data.cell.styles.textColor = [220, 38, 38];
            else if (val === 'medium') data.cell.styles.textColor = [217, 119, 6];
            else data.cell.styles.textColor = [22, 163, 74];
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  } else {
    y = infoRequired(y, 'Risk register — no risks have been entered in the calculator');
  }

  y = bodyText(
    y,
    'The risk register should cover: planning risk, cost inflation, contractor insolvency, ground conditions / existing structure, MEES/EPC compliance, building safety (Gateway 2/3 where applicable), sales rate, interest rate, and exit liquidity.',
  );

  const missingRiskCategories = [
    'planning', 'cost inflation', 'contractor insolvency', 'ground conditions',
    'MEES/EPC', 'building safety', 'sales rate', 'interest rate', 'exit liquidity',
  ];
  const enteredDescriptions = inputs.risks.map((r) => r.description.toLowerCase());
  const missing = missingRiskCategories.filter(
    (cat) => !enteredDescriptions.some((d) => d.includes(cat.toLowerCase())),
  );
  if (missing.length > 0) {
    y = infoRequired(y, `Risks not yet addressed: ${missing.join(', ')}`);
  }

  // ── Section 10: Sensitivity & Downside ──
  if (y > 200) {
    newPage();
    y = MARGIN_T;
  }
  y = sectionTitle(y, 10, 'Sensitivity & Downside');
  y = bodyText(
    y,
    'Every scenario below re-runs the full appraisal engine (runAppraisal) against adjusted GDV/cost/timeline/rate assumptions with the committed facility and equity sources held fixed — debt is never re-sized inside a scenario (spec §11.8). FE = facility exceeded, FG = funding gap, NR = senior debt not repaid within the modelled term.',
  );

  y = subHeading(y, 'Scenario Comparison');
  const scenarioKeys = ['base', 'upside', 'downside'] as const;
  const scenarioRuns = scenarioKeys.map((key) => {
    const overrides = inputs.scenarios[key];
    return { label: overrides.label, overrides, run: runAppraisal(applyScenario(inputs, overrides)) };
  });

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Metric', ...scenarioRuns.map((s) => s.label)]],
    body: [
      ['GDV adjustment', ...scenarioRuns.map((s) => `${s.overrides.gdv_adjustment_pct >= 0 ? '+' : ''}${s.overrides.gdv_adjustment_pct}%`)],
      ['Cost adjustment', ...scenarioRuns.map((s) => `${s.overrides.construction_cost_adjustment_pct >= 0 ? '+' : ''}${s.overrides.construction_cost_adjustment_pct}%`)],
      ['GDV', ...scenarioRuns.map((s) => fmt(s.run.metrics.gdv_pence))],
      ['Total Development Cost', ...scenarioRuns.map((s) => fmt(s.run.metrics.total_development_cost_pence))],
      ['Profit', ...scenarioRuns.map((s) => fmt(s.run.metrics.profit_pence))],
      ['Profit on Cost', ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.profit_on_cost_pct))],
      ['Profit on GDV', ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.profit_on_gdv_pct))],
      ['IRR (Annual)', ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.irr_annual_pct))],
      ['Return on Equity', ...scenarioRuns.map((s) => fmtPctSafe(s.run.metrics.return_on_equity_pct))],
      ['Flags', ...scenarioRuns.map((s) => flagSummary(s.run.model.flags))],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Shared grid: one runAppraisal per (cost, GDV) combination, feeding both matrices below.
  const gdvSteps = [-15, -10, -5, 0, 5];
  const costSteps = [-5, 0, 5, 10, 15];
  const grid = costSteps.map((costAdj) =>
    gdvSteps.map((gdvAdj) => {
      const scenRun = runAppraisal(applyScenario(inputs, {
        label: '',
        gdv_adjustment_pct: gdvAdj,
        construction_cost_adjustment_pct: costAdj,
        timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      }));
      return {
        pocPct: scenRun.metrics.profit_on_cost_pct,
        ltgdvPct: scenRun.metrics.ltgdv_developer_pct,
        flags: flagShortCodes(scenRun.model.flags),
      };
    }),
  );

  y = subHeading(y, 'Two-Way Sensitivity Matrix: Profit on Cost (%)');
  const pocRows: (string | number)[][] = costSteps.map((costAdj, ci) => [
    `Cost ${costAdj >= 0 ? '+' : ''}${costAdj}%`,
    ...grid[ci].map((cell) => `${fmtPctSafe(cell.pocPct)}${cell.flags ? ` [${cell.flags}]` : ''}`),
  ]);

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['', ...gdvSteps.map((g) => `GDV ${g >= 0 ? '+' : ''}${g}%`)]],
    body: pocRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [51, 65, 85], halign: 'center' },
    columnStyles: { 0: { fontStyle: 'bold', halign: 'left' } },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index > 0) {
        const val = parseFloat(String(data.cell.raw));
        if (val < 0) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else if (val < 15) {
          data.cell.styles.textColor = [217, 119, 6];
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(y, 'Two-Way Sensitivity Matrix: LTGDV, developer basis (%)');
  const ltgdvRows: (string | number)[][] = costSteps.map((costAdj, ci) => [
    `Cost ${costAdj >= 0 ? '+' : ''}${costAdj}%`,
    ...grid[ci].map((cell) => `${fmtPctSafe(cell.ltgdvPct)}${cell.flags ? ` [${cell.flags}]` : ''}`),
  ]);

  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['', ...gdvSteps.map((g) => `GDV ${g >= 0 ? '+' : ''}${g}%`)]],
    body: ltgdvRows,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255, halign: 'center' },
    bodyStyles: { textColor: [51, 65, 85], halign: 'center' },
    columnStyles: { 0: { fontStyle: 'bold', halign: 'left' } },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index > 0) {
        const val = parseFloat(String(data.cell.raw));
        if (val > 75) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        } else if (val > 65) {
          data.cell.styles.textColor = [217, 119, 6];
        }
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(y, 'Senior Debt Position');
  y = bodyText(
    y,
    "Senior repayment and developer break-even analysis: not yet available (Release 2). Do not rely on any previously reported figures for this metric.",
  );

  // ── Section 11: Exit Strategy ──
  if (y > 210) {
    newPage();
    y = MARGIN_T;
  }
  y = sectionTitle(y, 11, 'Exit Strategy');

  y = subHeading(y, 'Primary Exit');
  y = bodyText(y, exitLabel + '.');

  if (inputs.exit_strategy.route === 'sell_all' || inputs.exit_strategy.route === 'blended') {
    const agentFee = fmtPct(inputs.exit_strategy.selling_agent_fee_pct);
    const legalFee = fmt(inputs.exit_strategy.selling_legal_fee_pence);
    y = bodyText(
      y,
      `Disposal costs: agent at ${agentFee} of sale price, legal at ${legalFee} per transaction.`,
    );
  }

  if (
    (inputs.exit_strategy.route === 'retain_all' || inputs.exit_strategy.route === 'blended') &&
    inputs.exit_strategy.retained_units.length > 0
  ) {
    y = subHeading(y, 'Retained Portfolio');
    const retainedRows = inputs.exit_strategy.retained_units.map((r) => {
      const unit = inputs.unit_mix.units.find((u) => u.id === r.unit_id);
      const annualRent = r.monthly_rent_pence * 12;
      const cv = unit?.estimated_value_pence ?? 0;
      const yieldPct = cv > 0 ? (annualRent / cv) * 100 : 0;
      return [
        unit ? unitLabel(unit.type) : '—',
        unit ? `${unit.floor_area_sqm} m²` : '—',
        fmt(r.monthly_rent_pence),
        fmt(annualRent),
        fmt(cv),
        fmtPct(yieldPct),
      ];
    });

    table({
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Unit', 'Size', 'Monthly Rent', 'Annual Rent', 'Capital Value', 'Gross Yield (indicative — not part of the appraisal)']],
      body: retainedRows,
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      bodyStyles: { textColor: [51, 65, 85] },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
    });
    y = (doc as any).lastAutoTable.finalY + 6;
  }

  y = subHeading(y, 'Contingent Exit');
  y = infoRequired(y, 'At least one contingent exit strategy with supporting evidence');
  y = bodyText(
    y,
    'Contingent exits may include: sale of individual units to owner-occupiers at revised pricing, bulk sale to a registered provider or institutional PRS investor, or refinance onto long-term BTL debt.',
  );

  // ── Section 12: Appendices ──
  newPage();
  y = MARGIN_T;
  y = sectionTitle(y, 12, 'Appendices');

  y = subHeading(y, 'A. Assumption Schedule');
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Assumption', 'Value', 'Basis']],
    body: [
      ['Purchase price', fmt(inputs.acquisition.purchase_price_pence), 'Asking price / offer'],
      ['SDLT', fmt(metrics.sdlt_pence), 'Commercial (non-residential) bands — England/NI only (spec §3.3)'],
      ['Build rate £/m²', fmt(inputs.conversion_costs.construction_cost_per_sqm_pence), 'Assumption — verify with QS'],
      ['Contingency', fmtPct(inputs.conversion_costs.contingency_pct), 'On base build cost only'],
      ['Blended GDV £/sq ft', perSqftPence(metrics.gdv_pence, totalSqm), 'Comparable evidence — verify'],
      ['Committed net facility', inputs.finance.committed_net_facility_pence === null ? 'Not entered' : fmt(inputs.finance.committed_net_facility_pence), inputs.finance.requires_confirmation ? 'Requires confirmation' : 'Confirmed'],
      ['RLV target profit', fmtPct(inputs.deal_spider.target_profit_on_cost_pct), 'deal_spider.target_profit_on_cost_pct (configurable)'],
      ['Interest rate', `${fmtPct(inputs.finance.annual_interest_rate_pct)} p.a.`, 'Market rate / indicative terms'],
      ['Interest type', inputs.finance.interest_type === 'rolled_up' ? 'Rolled up' : 'Serviced', 'Assumed'],
      ['Loan term', `${inputs.finance.term_months} months`, 'Assumed programme duration'],
      ['Arrangement fee', fmtPct(inputs.finance.arrangement_fee_pct), 'Indicative terms'],
      ['Exit fee', fmtPct(inputs.finance.exit_fee_pct), 'Indicative terms'],
      ['Construction VAT', 'Treatment unconfirmed', 'No reduced-rate saving assumed in this appraisal (spec §3.4)'],
      ['Purchase VAT / TOGC', 'Unconfirmed', 'Purchase price treated as VAT-exempt/TOGC — unconfirmed (spec §3.3)'],
      ['Agent fee', fmtPct(inputs.exit_strategy.selling_agent_fee_pct), 'Standard estate agent fee'],
      ['Legal fee (disposal)', fmt(inputs.exit_strategy.selling_legal_fee_pence), 'Estimate'],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = subHeading(y, 'B. Information Required');
  const infoItems = [
    'Market rationale — why this asset, why now, demand drivers',
    'Full comparable evidence table (address, date, size, £/sq ft, source)',
    'Planning permission reference / prior approval application status',
    'Design and specification status',
    'Procurement route and contractor details',
    'Programme — key dates (start on site, PC, sales period)',
    'Critical path and long-lead items',
    'Sponsor / team track record and CVs',
    'Professional team and warranties / collateral warranties',
    'Insurance details (CAR, PI, etc.)',
    'Security package details',
    'Drawdown profile',
    'Contingent exit strategy with evidence',
  ];
  if (missing.length > 0) {
    infoItems.push(`Risk register gaps: ${missing.join(', ')}`);
  }
  table({
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['#', 'Item']],
    body: infoItems.map((item, i) => [`${i + 1}`, item]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [180, 83, 9], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [255, 251, 235] },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' } },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = subHeading(y, 'C. Additional Appendices Required');
  y = infoRequired(y, 'Team CVs');
  y = infoRequired(y, 'Professional team schedule and warranties');
  y = infoRequired(y, 'Insurance schedule');

  // ── Footer on all pages ──
  addPageFooter();

  return doc.output('blob');
}
