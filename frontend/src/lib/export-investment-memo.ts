import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Project, EligibilityAssessment } from '../types';
import type {
  CalculatorInputs,
  AppraisalMetrics,
  CashflowResult,
  ScenarioOverrides,
} from './conversion-types';
import {
  calculateGdv,
  calculateTotalAcquisitionCost,
  calculateTotalConstructionCost,
  calculateTotalProfessionalFees,
} from './conversion-calc-engine';
import { calculateCommercialSdlt } from './commercial-sdlt';

// ── Legacy v1 appraisal maths (private to this file) ──────
//
// The shared engine (frontend/src/lib/model) is now the sole authoritative
// calculator — the flat-rate LTV/IRR formulas below were removed from
// conversion-calc-engine.ts as prohibited formulas (spec §11). This memo's
// sensitivity/impairment sections still operate on the legacy v1
// CalculatorInputs shape and are rewritten properly in Task 10; until then
// they use this private, unexported copy so the shared engine stays clean.

function legacyCalculateIrr(cashflows: number[], maxIterations = 1000, tolerance = 1e-7): number {
  let guess = 0.01;
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const factor = Math.pow(1 + guess, t);
      npv += cashflows[t] / factor;
      if (t > 0) {
        dnpv -= (t * cashflows[t]) / Math.pow(1 + guess, t + 1);
      }
    }
    if (Math.abs(dnpv) < 1e-15) break;
    const newGuess = guess - npv / dnpv;
    if (Math.abs(newGuess - guess) < tolerance) return newGuess * 100;
    guess = newGuess;
  }
  return guess * 100;
}

function legacyCalculateAppraisal(inputs: CalculatorInputs): AppraisalMetrics {
  const gdv = calculateGdv(inputs.unit_mix.units);
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence).total_pence;
  const totalAcquisition = calculateTotalAcquisitionCost(inputs.acquisition);
  const totalConstruction = calculateTotalConstructionCost(inputs.conversion_costs);
  const totalProfessional = calculateTotalProfessionalFees(inputs.conversion_costs, inputs.unit_mix.units.length);

  const totalCostBeforeFinance = totalAcquisition + totalConstruction + totalProfessional;
  const loanAmount = Math.round((totalCostBeforeFinance * inputs.finance.ltv_pct) / 100);
  const equityRequired = totalCostBeforeFinance - loanAmount;

  const arrangementFee = Math.round((loanAmount * inputs.finance.arrangement_fee_pct) / 100);
  const exitFee = Math.round((loanAmount * inputs.finance.exit_fee_pct) / 100);
  const monthlyRate = inputs.finance.interest_rate_annual_pct / 100 / 12;
  const totalInterest = Math.round(loanAmount * monthlyRate * inputs.finance.loan_term_months);
  const totalFinanceCost = arrangementFee + exitFee + totalInterest;

  const totalCost = totalCostBeforeFinance + totalFinanceCost;
  const profit = gdv - totalCost;

  const profitOnCost = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const profitOnGdv = gdv > 0 ? (profit / gdv) * 100 : 0;
  const returnOnEquity = equityRequired > 0 ? (profit / equityRequired) * 100 : 0;

  const cashflows: number[] = [];
  cashflows.push(-equityRequired);
  for (let m = 1; m < inputs.finance.loan_term_months; m++) {
    cashflows.push(0);
  }
  cashflows.push(profit + equityRequired);

  const irrMonthly = cashflows.length > 1 ? legacyCalculateIrr(cashflows) : 0;
  const irrAnnual = (Math.pow(1 + irrMonthly / 100, 12) - 1) * 100;

  const totalCostExLand = totalCost - inputs.acquisition.purchase_price_pence - sdlt;
  const targetMultiplier = 1 + 20 / 100;
  const rlv = Math.round(gdv / targetMultiplier - totalCostExLand);

  return {
    total_gdv_pence: gdv,
    total_acquisition_cost_pence: totalAcquisition,
    sdlt_pence: sdlt,
    total_construction_cost_pence: totalConstruction,
    total_professional_fees_pence: totalProfessional,
    total_finance_cost_pence: totalFinanceCost,
    total_cost_pence: totalCost,
    profit_pence: profit,
    profit_on_cost_pct: Math.round(profitOnCost * 100) / 100,
    profit_on_gdv_pct: Math.round(profitOnGdv * 100) / 100,
    return_on_equity_pct: Math.round(returnOnEquity * 100) / 100,
    irr_monthly: Math.round(irrMonthly * 100) / 100,
    irr_annual: Math.round(irrAnnual * 100) / 100,
    rlv_pence: rlv,
    equity_required_pence: equityRequired,
    loan_amount_pence: loanAmount,
  };
}

const PAGE_W = 210;
const MARGIN_L = 20;
const MARGIN_R = 20;
const MARGIN_T = 25;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const FOOTER_Y = 287;

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

function fmtPctDp2(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
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

function perSqftPence(totalPence: number, sqm: number): string {
  if (sqm <= 0) return '—';
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

function addPageFooter(doc: jsPDF, projectName: string) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150);
    doc.text(projectName, MARGIN_L, FOOTER_Y);
    doc.text(`CONFIDENTIAL`, PAGE_W / 2, FOOTER_Y, { align: 'center' });
    doc.text(`Page ${i - 1}`, PAGE_W - MARGIN_R, FOOTER_Y, { align: 'right' });
  }
}

function sectionTitle(doc: jsPDF, y: number, num: number, title: string): number {
  if (y > 245) {
    doc.addPage();
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

function subHeading(doc: jsPDF, y: number, text: string): number {
  if (y > 255) {
    doc.addPage();
    y = MARGIN_T;
  }
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(text, MARGIN_L, y);
  return y + 6;
}

function bodyText(doc: jsPDF, y: number, text: string): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  const lines = doc.splitTextToSize(text, CONTENT_W);
  for (const line of lines) {
    if (y > 270) {
      doc.addPage();
      y = MARGIN_T;
    }
    doc.text(line, MARGIN_L, y);
    y += 5;
  }
  return y + 2;
}

function infoRequired(doc: jsPDF, y: number, label: string): number {
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(180, 83, 9);
  if (y > 270) {
    doc.addPage();
    y = MARGIN_T;
  }
  doc.text(`[Information Required: ${label}]`, MARGIN_L, y);
  doc.setFont('helvetica', 'normal');
  return y + 6;
}

function applyScenario(inputs: CalculatorInputs, overrides: ScenarioOverrides): CalculatorInputs {
  const gdvMult = 1 + overrides.gdv_adjustment_pct / 100;
  const costMult = 1 + overrides.construction_cost_adjustment_pct / 100;
  return {
    ...inputs,
    unit_mix: {
      units: inputs.unit_mix.units.map((u) => ({
        ...u,
        estimated_value_pence: Math.round(u.estimated_value_pence * gdvMult),
      })),
    },
    conversion_costs: {
      ...inputs.conversion_costs,
      construction_cost_per_sqm_pence: Math.round(
        inputs.conversion_costs.construction_cost_per_sqm_pence * costMult,
      ),
    },
    finance: {
      ...inputs.finance,
      loan_term_months: inputs.finance.loan_term_months + overrides.timeline_adjustment_months,
      interest_rate_annual_pct:
        inputs.finance.interest_rate_annual_pct + overrides.interest_rate_adjustment_pct,
    },
  };
}

export function generateInvestmentMemo(
  project: Project,
  inputs: CalculatorInputs,
  metrics: AppraisalMetrics,
  cashflow: CashflowResult,
  eligibility?: EligibilityAssessment | null,
): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const totalSqm = inputs.unit_mix.units.reduce((s, u) => s + u.floor_area_sqm, 0);
  const totalSqft = sqmToSqft(totalSqm);
  const unitCount = inputs.unit_mix.units.length;

  // ── Cover Page ──
  doc.setFillColor(10, 22, 40);
  doc.rect(0, 0, PAGE_W, 297, 'F');

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
    `${project.use_class.replace(/_/g, ' ').toUpperCase()} → RESIDENTIAL CONVERSION`,
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
    ['GDV', fmt(metrics.total_gdv_pence)],
    ['Total Cost', fmt(metrics.total_cost_pence)],
    ['Profit on Cost', fmtPct(metrics.profit_on_cost_pct)],
    ['Profit on GDV', fmtPct(metrics.profit_on_gdv_pct)],
    ['IRR (Annual)', fmtPct(metrics.irr_annual)],
    ['Equity Required', fmt(metrics.equity_required_pence)],
  ];
  doc.setFontSize(10);
  for (const [label, value] of coverMetrics) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(label, MARGIN_L, ty);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(226, 232, 240);
    doc.text(value, MARGIN_L + 60, ty);
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
  let y = MARGIN_T;

  y = sectionTitle(doc, y, 1, 'Executive Summary');

  const fundingLabel =
    inputs.finance.funding_source === 'cash'
      ? 'Cash'
      : inputs.finance.funding_source === 'bridging'
        ? 'Bridging loan'
        : 'Development finance';

  y = bodyText(
    doc,
    y,
    `This memorandum presents the investment case for the acquisition and conversion of ${project.address_raw} from ${project.use_class.replace(/_/g, ' ')} use to ${unitCount} residential unit${unitCount !== 1 ? 's' : ''} under Permitted Development Rights.`,
  );

  y = subHeading(doc, y, 'The Ask');
  y = bodyText(
    doc,
    y,
    `Total project cost is ${fmt(metrics.total_cost_pence)}, funded through ${fmt(metrics.equity_required_pence)} equity and ${fmt(metrics.loan_amount_pence)} ${fundingLabel.toLowerCase()} at ${fmtPct(inputs.finance.ltv_pct)} LTC.`,
  );

  y = subHeading(doc, y, 'Use of Funds');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Category', 'Amount', '% of Total']],
    body: [
      [
        'Acquisition (inc. SDLT)',
        fmt(metrics.total_acquisition_cost_pence),
        fmtPct((metrics.total_acquisition_cost_pence / metrics.total_cost_pence) * 100),
      ],
      [
        'Construction',
        fmt(metrics.total_construction_cost_pence),
        fmtPct((metrics.total_construction_cost_pence / metrics.total_cost_pence) * 100),
      ],
      [
        'Professional Fees',
        fmt(metrics.total_professional_fees_pence),
        fmtPct((metrics.total_professional_fees_pence / metrics.total_cost_pence) * 100),
      ],
      [
        'Finance Costs',
        fmt(metrics.total_finance_cost_pence),
        fmtPct((metrics.total_finance_cost_pence / metrics.total_cost_pence) * 100),
      ],
      ['Total', fmt(metrics.total_cost_pence), '100.0%'],
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

  y = subHeading(doc, y, 'Headline Returns');
  y = bodyText(
    doc,
    y,
    `GDV of ${fmt(metrics.total_gdv_pence)} against total cost of ${fmt(metrics.total_cost_pence)} generates a profit of ${fmt(metrics.profit_pence)}, equating to ${fmtPct(metrics.profit_on_cost_pct)} profit on cost and ${fmtPct(metrics.profit_on_gdv_pct)} profit on GDV. Annualised IRR is ${fmtPct(metrics.irr_annual)}, with return on equity of ${fmtPct(metrics.return_on_equity_pct)} over a ${inputs.finance.loan_term_months}-month programme.`,
  );

  y = subHeading(doc, y, 'Exit');
  const exitLabel =
    inputs.exit_strategy.route === 'sell_all'
      ? 'Sale of all units on the open market'
      : inputs.exit_strategy.route === 'retain_all'
        ? 'Retention of all units as buy-to-let investments'
        : 'Blended exit — partial sale and partial retention';
  y = bodyText(doc, y, `Primary exit: ${exitLabel}.`);

  // ── Section 2: The Opportunity ──
  if (y > 220) {
    doc.addPage();
    y = MARGIN_T;
  }
  y = sectionTitle(doc, y, 2, 'The Opportunity');
  y = bodyText(
    doc,
    y,
    `The property at ${project.address_raw} is a ${project.use_class.replace(/_/g, ' ')} premises being offered at ${fmt(project.price_pence)}${project.price_qualifier ? ` (${project.price_qualifier})` : ''}. The building comprises ${project.floors ?? '—'} storey${(project.floors ?? 0) > 1 ? 's' : ''} with a gross floor area of approximately ${project.floor_area_sqm?.toLocaleString() ?? '—'} m² (${project.floor_area_sqft?.toLocaleString() ?? '—'} sq ft).`,
  );
  y = bodyText(
    doc,
    y,
    `Tenure is ${project.tenure}${project.lease_years_remaining ? ` with ${project.lease_years_remaining} years remaining` : ''}. EPC rating: ${project.epc_rating ?? 'Unknown'}. Vacancy status: ${project.is_vacant === true ? 'Vacant' : project.is_vacant === false ? 'Occupied' : 'Unknown'}.`,
  );
  if (project.description) {
    y = bodyText(doc, y, project.description);
  }
  y = infoRequired(doc, y, 'Market rationale — why this asset, why now, demand drivers');

  // ── Section 3: The Scheme ──
  if (y > 200) {
    doc.addPage();
    y = MARGIN_T;
  }
  y = sectionTitle(doc, y, 3, 'The Scheme');

  y = subHeading(doc, y, 'Description');
  y = bodyText(
    doc,
    y,
    `Conversion of existing ${project.use_class.replace(/_/g, ' ')} premises to ${unitCount} residential unit${unitCount !== 1 ? 's' : ''} comprising a total of ${totalSqm.toLocaleString()} m² (${totalSqft.toLocaleString()} sq ft) net internal area.`,
  );

  y = subHeading(doc, y, 'Proposed Unit Mix');
  autoTable(doc, {
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
      fmt(metrics.total_gdv_pence),
      perSqftPence(metrics.total_gdv_pence, totalSqm),
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

  y = subHeading(doc, y, 'Planning Position');
  if (eligibility) {
    const pdrLabel = eligibility.pdr_class.replace(/_/g, ' ').toUpperCase();
    y = bodyText(
      doc,
      y,
      `Eligible for conversion under ${pdrLabel}. Eligibility verdict: ${eligibility.verdict.toUpperCase()}.`,
    );
    const failedCriteria = eligibility.criteria.filter((c) => c.passed === false);
    const pendingCriteria = eligibility.criteria.filter((c) => c.passed === null);
    if (failedCriteria.length > 0) {
      y = bodyText(
        doc,
        y,
        `Failed criteria: ${failedCriteria.map((c) => c.label).join('; ')}.`,
      );
    }
    if (pendingCriteria.length > 0) {
      y = bodyText(
        doc,
        y,
        `Pending verification: ${pendingCriteria.map((c) => c.label).join('; ')}.`,
      );
    }
  } else {
    y = infoRequired(doc, y, 'Planning status, permission reference, conditions outstanding');
  }
  y = infoRequired(doc, y, 'Design and specification status, procurement route, contractor');

  // ── Section 4: Market Evidence ──
  if (y > 220) {
    doc.addPage();
    y = MARGIN_T;
  }
  y = sectionTitle(doc, y, 4, 'Market Evidence');
  y = bodyText(
    doc,
    y,
    'Comparable evidence should support the revenue assumptions adopted in the appraisal. Each comparable is listed below with address, transaction date, size, achieved £/sq ft, and source.',
  );

  const compsWithNotes = inputs.unit_mix.units.filter((u) => u.comparable_notes);
  if (compsWithNotes.length > 0) {
    y = subHeading(doc, y, 'Comparable Notes from Unit Schedule');
    for (const u of compsWithNotes) {
      y = bodyText(
        doc,
        y,
        `${unitLabel(u.type)} (${u.floor_area_sqm} m²) at ${fmt(u.estimated_value_pence)} — ${u.comparable_notes}`,
      );
    }
  }

  y = infoRequired(
    doc,
    y,
    'Full comparable table: address, date, size (sq ft), £/sq ft, source for each transaction',
  );
  y = infoRequired(doc, y, 'Absorption rates, demand drivers, local market commentary');

  // ── Section 5: Development Appraisal ──
  doc.addPage();
  y = MARGIN_T;
  y = sectionTitle(doc, y, 5, 'Development Appraisal');

  y = subHeading(doc, y, 'Revenue');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Item', 'Amount']],
    body: [
      ['Gross Development Value (GDV)', fmt(metrics.total_gdv_pence)],
      ['Blended £/sq ft', perSqftPence(metrics.total_gdv_pence, totalSqm)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: { 1: { halign: 'right' } },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(doc, y, 'Cost Plan');
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence);
  const brokerFee = Math.round(
    (inputs.acquisition.purchase_price_pence * inputs.acquisition.broker_fee_pct) / 100,
  );
  const baseBuild =
    inputs.conversion_costs.construction_cost_per_sqm_pence *
    inputs.conversion_costs.total_construction_sqm;
  const contingencyAmt = Math.round(
    (baseBuild * inputs.conversion_costs.contingency_pct) / 100,
  );
  const arrangementFee = Math.round(
    (metrics.loan_amount_pence * inputs.finance.arrangement_fee_pct) / 100,
  );
  const exitFee = Math.round(
    (metrics.loan_amount_pence * inputs.finance.exit_fee_pct) / 100,
  );
  const totalInterest = metrics.total_finance_cost_pence - arrangementFee - exitFee;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Element', 'Amount', '£/sq ft']],
    body: [
      ['ACQUISITION', '', ''],
      ['  Purchase price', fmt(inputs.acquisition.purchase_price_pence), perSqftPence(inputs.acquisition.purchase_price_pence, totalSqm)],
      ['  SDLT', fmt(sdlt.total_pence), perSqftPence(sdlt.total_pence, totalSqm)],
      ['  Legal fees', fmt(inputs.acquisition.legal_fees_pence), ''],
      ['  Survey', fmt(inputs.acquisition.survey_cost_pence), ''],
      ['  Broker fee', fmt(brokerFee), ''],
      ['  Other acquisition costs', fmt(inputs.acquisition.other_acquisition_costs_pence), ''],
      ['  Sub-total acquisition', fmt(metrics.total_acquisition_cost_pence), perSqftPence(metrics.total_acquisition_cost_pence, totalSqm)],
      ['', '', ''],
      ['CONSTRUCTION', '', ''],
      ['  Base build cost', fmt(baseBuild), perSqftPence(baseBuild, totalSqm)],
      [`  Contingency (${inputs.conversion_costs.contingency_pct}%)`, fmt(contingencyAmt), ''],
      ['  Fire safety', fmt(inputs.conversion_costs.fire_safety_pence), ''],
      ['  Sound insulation', fmt(inputs.conversion_costs.sound_insulation_pence), ''],
      ['  Part L compliance', fmt(inputs.conversion_costs.part_l_compliance_pence), ''],
      ['  Sub-total construction', fmt(metrics.total_construction_cost_pence), perSqftPence(metrics.total_construction_cost_pence, totalSqm)],
      ['', '', ''],
      ['PROFESSIONAL FEES', '', ''],
      ['  Prior approval fees', fmt(inputs.conversion_costs.prior_approval_fee_per_dwelling_pence * Math.max(1, unitCount)), ''],
      ['  CIL / S106', fmt(inputs.conversion_costs.cil_s106_pence), ''],
      ['  Architect', fmt(inputs.conversion_costs.architect_pence), ''],
      ['  Structural engineer', fmt(inputs.conversion_costs.structural_engineer_pence), ''],
      ['  M&E', fmt(inputs.conversion_costs.mande_pence), ''],
      ['  Planning consultant', fmt(inputs.conversion_costs.planning_consultant_pence), ''],
      ['  Building control', fmt(inputs.conversion_costs.building_control_pence), ''],
      ['  Other professional fees', fmt(inputs.conversion_costs.other_professional_fees_pence), ''],
      ['  Sub-total professional fees', fmt(metrics.total_professional_fees_pence), perSqftPence(metrics.total_professional_fees_pence, totalSqm)],
      ['', '', ''],
      ['FINANCE COSTS', '', ''],
      [`  Arrangement fee (${fmtPct(inputs.finance.arrangement_fee_pct)})`, fmt(arrangementFee), ''],
      [`  Exit fee (${fmtPct(inputs.finance.exit_fee_pct)})`, fmt(exitFee), ''],
      [`  Interest (${fmtPct(inputs.finance.interest_rate_annual_pct)} p.a., ${inputs.finance.loan_term_months} months)`, fmt(totalInterest), ''],
      ['  Sub-total finance costs', fmt(metrics.total_finance_cost_pence), ''],
      ['', '', ''],
      ['TOTAL DEVELOPMENT COST', fmt(metrics.total_cost_pence), perSqftPence(metrics.total_cost_pence, totalSqm)],
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

  y = subHeading(doc, y, 'Appraisal Metrics');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Gross Development Value', fmt(metrics.total_gdv_pence)],
      ['Total Development Cost', fmt(metrics.total_cost_pence)],
      ['Developer Profit', fmt(metrics.profit_pence)],
      ['Profit on Cost', fmtPct(metrics.profit_on_cost_pct)],
      ['Profit on GDV', fmtPct(metrics.profit_on_gdv_pct)],
      ['Return on Equity', fmtPct(metrics.return_on_equity_pct)],
      ['IRR (Annual)', fmtPct(metrics.irr_annual)],
      ['Residual Land Value (at 20% PoC)', fmt(metrics.rlv_pence)],
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

  y = subHeading(doc, y, 'Residual Land Value Check');
  const rlvDiff = metrics.rlv_pence - inputs.acquisition.purchase_price_pence;
  const rlvHeadroom = inputs.acquisition.purchase_price_pence > 0
    ? (rlvDiff / inputs.acquisition.purchase_price_pence) * 100
    : 0;
  y = bodyText(
    doc,
    y,
    `At a target profit on cost of 20%, the residual land value is ${fmt(metrics.rlv_pence)}. The purchase price of ${fmt(inputs.acquisition.purchase_price_pence)} is ${rlvDiff >= 0 ? `${fmt(Math.abs(rlvDiff))} below` : `${fmt(Math.abs(rlvDiff))} above`} the RLV, representing ${rlvDiff >= 0 ? 'positive' : 'negative'} headroom of ${fmtPct(Math.abs(rlvHeadroom))}.`,
  );

  // ── Section 6: Programme ──
  doc.addPage();
  y = MARGIN_T;
  y = sectionTitle(doc, y, 6, 'Programme');

  y = subHeading(doc, y, 'Timeline');
  y = bodyText(
    doc,
    y,
    `Total programme: ${inputs.finance.loan_term_months} months. Peak funding of ${fmt(cashflow.peak_funding_pence)} is reached during the construction phase. Total interest cost: ${fmt(cashflow.total_interest_pence)}.`,
  );
  y = infoRequired(doc, y, 'Key dates — start on site, practical completion, sales/letting period');
  y = infoRequired(doc, y, 'Critical path, long-lead items');

  y = subHeading(doc, y, 'Monthly Cashflow');
  const cfRows = cashflow.months.map((m) => [
    m.label,
    fmt(m.drawdown_pence),
    fmt(m.cumulative_drawdown_pence),
    fmt(m.interest_pence),
    fmt(m.cumulative_interest_pence),
    fmt(m.income_pence),
    fmt(m.net_cashflow_pence),
    fmt(m.cumulative_cashflow_pence),
  ]);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Month', 'Drawdown', 'Cum. Draw', 'Interest', 'Cum. Int.', 'Income', 'Net CF', 'Cum. CF']],
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
    doc.addPage();
    y = MARGIN_T;
  }
  y = sectionTitle(doc, y, 7, 'Funding Request');

  y = subHeading(doc, y, 'Sources & Uses');
  const ltc = metrics.total_cost_pence > 0
    ? (metrics.loan_amount_pence / metrics.total_cost_pence) * 100
    : 0;
  const ltgdv = metrics.total_gdv_pence > 0
    ? (metrics.loan_amount_pence / metrics.total_gdv_pence) * 100
    : 0;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Sources', 'Amount', '%', '', 'Uses', 'Amount']],
    body: [
      [
        'Equity',
        fmt(metrics.equity_required_pence),
        fmtPct((metrics.equity_required_pence / metrics.total_cost_pence) * 100),
        '',
        'Acquisition (inc. SDLT)',
        fmt(metrics.total_acquisition_cost_pence),
      ],
      [
        fundingLabel,
        fmt(metrics.loan_amount_pence),
        fmtPct(ltc),
        '',
        'Construction',
        fmt(metrics.total_construction_cost_pence),
      ],
      [
        '',
        '',
        '',
        '',
        'Professional Fees',
        fmt(metrics.total_professional_fees_pence),
      ],
      [
        '',
        '',
        '',
        '',
        'Finance Costs',
        fmt(metrics.total_finance_cost_pence),
      ],
      [
        'Total',
        fmt(metrics.total_cost_pence),
        '100.0%',
        '',
        'Total',
        fmt(metrics.total_cost_pence),
      ],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { cellWidth: 5 },
      5: { halign: 'right' },
    },
    didParseCell(data) {
      const text = String(data.cell.raw);
      if (text === 'Total') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 6;

  y = subHeading(doc, y, 'Key Lending Metrics');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Loan amount', fmt(metrics.loan_amount_pence)],
      ['Loan-to-Cost (LTC)', fmtPct(ltc)],
      ['Loan-to-GDV (LTGDV)', fmtPct(ltgdv)],
      ['Interest rate', `${fmtPct(inputs.finance.interest_rate_annual_pct)} p.a.`],
      ['Interest type', inputs.finance.interest_type === 'rolled_up' ? 'Rolled up' : 'Serviced'],
      ['Arrangement fee', fmtPct(inputs.finance.arrangement_fee_pct)],
      ['Exit fee', fmtPct(inputs.finance.exit_fee_pct)],
      ['Loan term', `${inputs.finance.loan_term_months} months`],
      ['Peak funding', fmt(cashflow.peak_funding_pence)],
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

  y = infoRequired(doc, y, 'Security package — first charge, debenture, personal guarantees');
  y = infoRequired(doc, y, 'Drawdown profile, priority of repayment');

  // ── Section 8: Returns ──
  if (y > 200) {
    doc.addPage();
    y = MARGIN_T;
  }
  y = sectionTitle(doc, y, 8, 'Returns');

  y = subHeading(doc, y, 'Investor Returns');
  const equityMultiple = metrics.equity_required_pence > 0
    ? (metrics.profit_pence + metrics.equity_required_pence) / metrics.equity_required_pence
    : 0;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Internal Rate of Return (IRR)', fmtPct(metrics.irr_annual)],
      ['Equity Multiple', `${equityMultiple.toFixed(2)}x`],
      ['Return on Equity', fmtPct(metrics.return_on_equity_pct)],
      ['Profit on Cost', fmtPct(metrics.profit_on_cost_pct)],
      ['Profit on GDV', fmtPct(metrics.profit_on_gdv_pct)],
      ['Hold Period', `${inputs.finance.loan_term_months} months`],
      ['Total Profit', fmt(metrics.profit_pence)],
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

  y = infoRequired(doc, y, 'Waterfall / promote structure (if JV)');

  y = subHeading(doc, y, 'Lender Position');
  const dayOneLtv = inputs.acquisition.purchase_price_pence > 0
    ? (metrics.loan_amount_pence / inputs.acquisition.purchase_price_pence) * 100
    : 0;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    body: [
      ['Day-one LTV (loan / purchase price)', fmtPct(dayOneLtv)],
      ['Peak LTGDV (loan / GDV)', fmtPct(ltgdv)],
      ['Exit LTGDV', fmtPct(ltgdv)],
      ['Headroom (GDV less total cost)', fmt(metrics.profit_pence)],
      ['Headroom as % of GDV', fmtPct(metrics.profit_on_gdv_pct)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Section 9: Risk Register ──
  doc.addPage();
  y = MARGIN_T;
  y = sectionTitle(doc, y, 9, 'Risk Register');

  if (inputs.risks.length > 0) {
    autoTable(doc, {
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
    y = infoRequired(doc, y, 'Risk register — no risks have been entered in the calculator');
  }

  y = bodyText(
    doc,
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
    y = infoRequired(doc, y, `Risks not yet addressed: ${missing.join(', ')}`);
  }

  // ── Section 10: Sensitivity & Downside ──
  if (y > 200) {
    doc.addPage();
    y = MARGIN_T;
  }
  y = sectionTitle(doc, y, 10, 'Sensitivity & Downside');

  y = subHeading(doc, y, 'Scenario Comparison');
  const scenarioKeys = ['base', 'upside', 'downside'] as const;
  const scenarioMetrics = scenarioKeys.map((key) => ({
    label: inputs.scenarios[key].label,
    metrics: legacyCalculateAppraisal(applyScenario(inputs, inputs.scenarios[key])),
    overrides: inputs.scenarios[key],
  }));

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Metric', ...scenarioMetrics.map((s) => s.label)]],
    body: [
      ['GDV adjustment', ...scenarioMetrics.map((s) => `${s.overrides.gdv_adjustment_pct >= 0 ? '+' : ''}${s.overrides.gdv_adjustment_pct}%`)],
      ['Cost adjustment', ...scenarioMetrics.map((s) => `${s.overrides.construction_cost_adjustment_pct >= 0 ? '+' : ''}${s.overrides.construction_cost_adjustment_pct}%`)],
      ['GDV', ...scenarioMetrics.map((s) => fmt(s.metrics.total_gdv_pence))],
      ['Total Cost', ...scenarioMetrics.map((s) => fmt(s.metrics.total_cost_pence))],
      ['Profit', ...scenarioMetrics.map((s) => fmt(s.metrics.profit_pence))],
      ['Profit on Cost', ...scenarioMetrics.map((s) => fmtPct(s.metrics.profit_on_cost_pct))],
      ['Profit on GDV', ...scenarioMetrics.map((s) => fmtPct(s.metrics.profit_on_gdv_pct))],
      ['IRR (Annual)', ...scenarioMetrics.map((s) => fmtPct(s.metrics.irr_annual))],
      ['Return on Equity', ...scenarioMetrics.map((s) => fmtPct(s.metrics.return_on_equity_pct))],
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

  y = subHeading(doc, y, 'Two-Way Sensitivity Matrix: Profit on Cost (%)');
  const gdvSteps = [-15, -10, -5, 0, 5];
  const costSteps = [-5, 0, 5, 10, 15];

  const matrixRows: (string | number)[][] = [];
  for (const costAdj of costSteps) {
    const row: (string | number)[] = [`Cost ${costAdj >= 0 ? '+' : ''}${costAdj}%`];
    for (const gdvAdj of gdvSteps) {
      const adjusted = applyScenario(inputs, {
        label: '',
        gdv_adjustment_pct: gdvAdj,
        construction_cost_adjustment_pct: costAdj,
        timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      });
      const m = legacyCalculateAppraisal(adjusted);
      row.push(fmtPct(m.profit_on_cost_pct));
    }
    matrixRows.push(row);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['', ...gdvSteps.map((g) => `GDV ${g >= 0 ? '+' : ''}${g}%`)]],
    body: matrixRows,
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

  y = subHeading(doc, y, 'Two-Way Sensitivity Matrix: Lender LTGDV (%)');

  const ltgdvRows: (string | number)[][] = [];
  for (const costAdj of costSteps) {
    const row: (string | number)[] = [`Cost ${costAdj >= 0 ? '+' : ''}${costAdj}%`];
    for (const gdvAdj of gdvSteps) {
      const adjusted = applyScenario(inputs, {
        label: '',
        gdv_adjustment_pct: gdvAdj,
        construction_cost_adjustment_pct: costAdj,
        timeline_adjustment_months: 0,
        interest_rate_adjustment_pct: 0,
      });
      const m = legacyCalculateAppraisal(adjusted);
      const scenLtgdv = m.total_gdv_pence > 0
        ? (m.loan_amount_pence / m.total_gdv_pence) * 100
        : 0;
      row.push(fmtPct(scenLtgdv));
    }
    ltgdvRows.push(row);
  }

  autoTable(doc, {
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

  // Impairment analysis
  y = subHeading(doc, y, 'Impairment Thresholds');
  const equityImpairGdv = findImpairmentPoint(inputs, 'equity');
  const debtImpairGdv = findImpairmentPoint(inputs, 'debt');
  y = bodyText(
    doc,
    y,
    `Equity is impaired (profit falls to zero) at approximately ${fmtPct(equityImpairGdv)} GDV reduction (all else equal).`,
  );
  y = bodyText(
    doc,
    y,
    `Senior debt is impaired (GDV falls below total cost) at approximately ${fmtPct(debtImpairGdv)} GDV reduction (all else equal). This represents the lender's margin of safety.`,
  );

  // ── Section 11: Exit Strategy ──
  if (y > 210) {
    doc.addPage();
    y = MARGIN_T;
  }
  y = sectionTitle(doc, y, 11, 'Exit Strategy');

  y = subHeading(doc, y, 'Primary Exit');
  y = bodyText(doc, y, exitLabel + '.');

  if (inputs.exit_strategy.route === 'sell_all' || inputs.exit_strategy.route === 'blended') {
    const agentFee = fmtPct(inputs.exit_strategy.selling_agent_fee_pct);
    const legalFee = fmt(inputs.exit_strategy.selling_legal_fee_pence);
    y = bodyText(
      doc,
      y,
      `Disposal costs: agent at ${agentFee} of sale price, legal at ${legalFee} per transaction.`,
    );
  }

  if (
    (inputs.exit_strategy.route === 'retain_all' || inputs.exit_strategy.route === 'blended') &&
    inputs.exit_strategy.retained_units.length > 0
  ) {
    y = subHeading(doc, y, 'Retained Portfolio');
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

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN_L, right: MARGIN_R },
      head: [['Unit', 'Size', 'Monthly Rent', 'Annual Rent', 'Capital Value', 'Gross Yield']],
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

  y = subHeading(doc, y, 'Contingent Exit');
  y = infoRequired(doc, y, 'At least one contingent exit strategy with supporting evidence');
  y = bodyText(
    doc,
    y,
    'Contingent exits may include: sale of individual units to owner-occupiers at revised pricing, bulk sale to a registered provider or institutional PRS investor, or refinance onto long-term BTL debt.',
  );

  // ── Section 12: Appendices ──
  doc.addPage();
  y = MARGIN_T;
  y = sectionTitle(doc, y, 12, 'Appendices');

  y = subHeading(doc, y, 'A. Assumption Schedule');
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN_L, right: MARGIN_R },
    head: [['Assumption', 'Value', 'Basis']],
    body: [
      ['Purchase price', fmt(inputs.acquisition.purchase_price_pence), 'Asking price / offer'],
      ['SDLT', fmt(sdlt.total_pence), `Commercial rates, effective ${fmtPctDp2(sdlt.effective_rate_pct)}`],
      ['Build cost £/m²', fmt(inputs.conversion_costs.construction_cost_per_sqm_pence), 'Assumption — verify with QS'],
      ['Build cost £/sq ft', perSqftPence(inputs.conversion_costs.construction_cost_per_sqm_pence * inputs.conversion_costs.total_construction_sqm, inputs.conversion_costs.total_construction_sqm), 'Calculated'],
      ['Contingency', `${inputs.conversion_costs.contingency_pct}%`, 'Standard allowance'],
      ['Blended GDV £/sq ft', perSqftPence(metrics.total_gdv_pence, totalSqm), 'Comparable evidence — verify'],
      ['LTV / LTC', fmtPct(inputs.finance.ltv_pct), 'Assumed'],
      ['Interest rate', `${fmtPct(inputs.finance.interest_rate_annual_pct)} p.a.`, 'Market rate / indicative terms'],
      ['Interest type', inputs.finance.interest_type === 'rolled_up' ? 'Rolled up' : 'Serviced', 'Assumed'],
      ['Loan term', `${inputs.finance.loan_term_months} months`, 'Assumed programme duration'],
      ['Arrangement fee', fmtPct(inputs.finance.arrangement_fee_pct), 'Indicative terms'],
      ['Exit fee', fmtPct(inputs.finance.exit_fee_pct), 'Indicative terms'],
      ['RLV target profit', '20% on cost', 'Market standard'],
      ['Agent fee', fmtPct(inputs.exit_strategy.selling_agent_fee_pct), 'Standard estate agent fee'],
      ['Legal fee (disposal)', fmt(inputs.exit_strategy.selling_legal_fee_pence), 'Estimate'],
    ],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 58, 95], textColor: 255 },
    bodyStyles: { textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [241, 245, 249] },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  y = subHeading(doc, y, 'B. Information Required');
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
  autoTable(doc, {
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

  y = subHeading(doc, y, 'C. Additional Appendices Required');
  y = infoRequired(doc, y, 'Team CVs');
  y = infoRequired(doc, y, 'Professional team schedule and warranties');
  y = infoRequired(doc, y, 'Insurance schedule');

  // ── Footer on all pages ──
  addPageFooter(doc, project.address_raw);

  return doc.output('blob');
}

function findImpairmentPoint(
  inputs: CalculatorInputs,
  type: 'equity' | 'debt',
): number {
  for (let pct = 1; pct <= 50; pct++) {
    const adjusted = applyScenario(inputs, {
      label: '',
      gdv_adjustment_pct: -pct,
      construction_cost_adjustment_pct: 0,
      timeline_adjustment_months: 0,
      interest_rate_adjustment_pct: 0,
    });
    const m = legacyCalculateAppraisal(adjusted);
    if (type === 'equity' && m.profit_pence <= 0) return pct;
    if (type === 'debt' && m.total_gdv_pence <= m.total_cost_pence) return pct;
  }
  return 50;
}
