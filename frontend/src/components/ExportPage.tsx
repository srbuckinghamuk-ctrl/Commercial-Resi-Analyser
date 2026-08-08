import { useState, useMemo } from 'react';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import type { DealReview, RefurbAppraisal } from '../types';

// ─── Props ────────────────────────────────────────────────────────────────────
interface ExportPageProps {
  deals: DealReview[];
  appraisals: RefurbAppraisal[];
}

// ─── Formatting helpers ───────────────────────────────────────────────────────
const fmtGBP = (n: number | null | undefined, dec = 0) =>
  n == null
    ? 'N/A'
    : new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP',
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      }).format(n);

const fmtPct = (n: number | null | undefined, dec = 1) =>
  n == null ? 'N/A' : `${Number(n).toFixed(dec)}%`;

const fmtNum = (n: number | null | undefined, dec = 0) =>
  n == null ? 'N/A' : Number(n).toFixed(dec);

const today = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

function postcodeToRegion(postcode: string): string {
  if (!postcode) return '—';
  const area = postcode.trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2})/)?.[1] || '';
  const map: Record<string, string> = {
    // London
    E: 'East London', EC: 'City of London', N: 'North London', NW: 'North West London',
    SE: 'South East London', SW: 'South West London', W: 'West London', WC: 'Central London',
    // South East
    BN: 'Sussex', BR: 'Kent', CM: 'Essex', CO: 'Essex', CR: 'Surrey', CT: 'Kent',
    DA: 'Kent', EN: 'Hertfordshire', GU: 'Surrey', HA: 'Middlesex', HP: 'Buckinghamshire',
    IG: 'Essex', KT: 'Surrey', LU: 'Bedfordshire', ME: 'Kent', MK: 'Buckinghamshire',
    OX: 'Oxfordshire', PO: 'Hampshire', RG: 'Berkshire', RH: 'Surrey', RM: 'Essex',
    SL: 'Berkshire', SM: 'Surrey', SS: 'Essex', TN: 'Kent', TW: 'Middlesex',
    UB: 'Middlesex', WD: 'Hertfordshire',
    // South West
    BA: 'Somerset', BH: 'Dorset', BS: 'Bristol', DT: 'Dorset', EX: 'Devon',
    GL: 'Gloucestershire', PL: 'Devon', SN: 'Wiltshire', SP: 'Wiltshire',
    TA: 'Somerset', TQ: 'Devon', TR: 'Cornwall',
    // East of England
    AL: 'Hertfordshire', CB: 'Cambridgeshire', IP: 'Suffolk', NR: 'Norfolk',
    PE: 'Cambridgeshire', SG: 'Hertfordshire',
    // West Midlands
    B: 'Birmingham', CV: 'Warwickshire', DY: 'West Midlands', HR: 'Herefordshire',
    ST: 'Staffordshire', TF: 'Shropshire', WR: 'Worcestershire', WS: 'West Midlands',
    WV: 'West Midlands',
    // East Midlands
    DE: 'Derbyshire', DN: 'South Yorkshire', LE: 'Leicestershire', LN: 'Lincolnshire',
    NG: 'Nottinghamshire', NN: 'Northamptonshire',
    // North West
    BB: 'Lancashire', BL: 'Greater Manchester', CA: 'Cumbria', CH: 'Cheshire',
    CW: 'Cheshire', FY: 'Lancashire', L: 'Liverpool', LA: 'Lancashire',
    M: 'Manchester', OL: 'Greater Manchester', PR: 'Lancashire', SK: 'Greater Manchester',
    WA: 'Cheshire', WN: 'Greater Manchester',
    // Yorkshire & Humber
    BD: 'West Yorkshire', HD: 'West Yorkshire', HG: 'North Yorkshire', HU: 'East Yorkshire',
    HX: 'West Yorkshire', LS: 'West Yorkshire', S: 'Sheffield', WF: 'West Yorkshire',
    YO: 'North Yorkshire',
    // North East
    DH: 'County Durham', DL: 'County Durham', NE: 'Tyne & Wear', SR: 'Tyne & Wear',
    TS: 'Teesside',
    // Wales
    CF: 'South Wales', LD: 'Mid Wales', LL: 'North Wales', NP: 'South Wales',
    SA: 'West Wales', SY: 'Mid Wales',
    // Scotland
    AB: 'Aberdeenshire', DD: 'Dundee', EH: 'Edinburgh', FK: 'Stirlingshire',
    G: 'Glasgow', IV: 'Highlands', KA: 'Ayrshire', KY: 'Fife',
    ML: 'Lanarkshire', PA: 'Renfrewshire', PH: 'Perthshire', TD: 'Scottish Borders',
    // Northern Ireland
    BT: 'Northern Ireland',
    // Southampton / Hampshire
    SO: 'Hampshire',
  };
  // Try two-letter match first, then single letter
  return map[area.slice(0, 2)] || map[area.slice(0, 1)] || area;
}

// ─── Project summary extraction ───────────────────────────────────────────────
interface ProjectSummary {
  projectId: string;
  postcode: string;
  projectName: string;
  address: string;
  strategy: string;
  purchasePrice: number | null;
  totalProjectCost: number | null;
  gdv: number | null;
  irr: number | null;           // %
  equityRequired: number | null; // £
  netProfitAmount: number | null; // £
  netProfitPercent: number | null; // %
  dealScore: number | null;
  projectDurationMonths: number | null;
  exitStrategy: string;
  projectType: 'deal' | 'appraisal';
  rawDeal?: DealReview;
  rawAppraisal?: RefurbAppraisal;
}

function extractFromDeal(deal: DealReview): ProjectSummary {
  const fs = deal.form_snapshot;
  const purchasePrice = parseFloat(fs.guidePrice) || null;
  const refurbBudget = parseFloat(fs.refurbBudget) || 0;
  const totalAcq = deal.total_acquisition_cost / 100;
  const totalCost = totalAcq + refurbBudget;
  const resale = parseFloat(fs.resaleValue) || null;
  const annualRent = parseFloat(fs.annualRent) || 0;
  const flipProfit = deal.flip_profit / 100;

  const hasRent = annualRent > 0;
  const hasResale = (resale || 0) > 0;
  let strategy = 'Investment';
  if (hasRent && hasResale) strategy = 'Buy-Refurbish-Refinance';
  else if (hasRent) strategy = 'Buy-to-Let';
  else if (hasResale) strategy = 'Flip / Resale';

  let exitStrategy = 'Open Market Sale';
  if (strategy === 'Buy-to-Let') exitStrategy = 'Long-term Hold / Refinance';

  let netProfitPercent: number | null = null;
  if (resale && resale > 0 && flipProfit != null) {
    netProfitPercent = (flipProfit / resale) * 100;
  }

  return {
    projectId: (fs.project_id as string) || '',
    postcode: (fs.postcode as string) || '',
    projectName: deal.deal_name,
    address: fs.address || '—',
    strategy,
    purchasePrice,
    totalProjectCost: totalCost,
    gdv: resale,
    irr: deal.irr != null ? deal.irr * 100 : null,
    equityRequired: totalCost,
    netProfitAmount: flipProfit,
    netProfitPercent,
    dealScore: null,
    projectDurationMonths: (deal.holding_period_years || 5) * 12,
    exitStrategy,
    projectType: 'deal',
    rawDeal: deal,
  };
}

function extractFromAppraisal(appraisal: RefurbAppraisal): ProjectSummary {
  const snap = appraisal.inputs_snapshot as Record<string, unknown>;
  const summary = (snap.__summary as Record<string, number | null>) || {};
  const purchasePrice = typeof snap.purchase_price === 'number' ? snap.purchase_price : null;

  let strategy = 'Development / Refurbishment';
  const financeMode = snap.finance_mode as string | undefined;
  if (financeMode === 'bridge_only') strategy = 'Refurb & Sell (Bridge Finance)';
  else if (financeMode === 'dev_only') strategy = 'Refurb & Refinance (Dev Finance)';

  let exitStrategy = 'Open Market Sale';
  if (financeMode === 'dev_only') exitStrategy = 'Refinance & Hold';

  return {
    projectId: (snap.project_id as string) || '',
    postcode: (snap.postcode as string) || '',
    projectName: appraisal.name,
    address: (snap.address as string) || '—',
    strategy,
    purchasePrice,
    totalProjectCost: summary.projectCost ?? null,
    gdv: summary.gdv ?? null,
    irr: appraisal.irr_equity ?? (summary.irr ?? null),
    equityRequired: summary.equityRequired ?? null,
    netProfitAmount:
      appraisal.net_profit != null ? appraisal.net_profit / 100 : (summary.netProfitAmount ?? null),
    netProfitPercent: appraisal.margin_pct ?? (summary.netProfitPercent ?? null),
    dealScore: summary.dealScore ?? null,
    projectDurationMonths:
      typeof snap.project_duration_months === 'number' ? snap.project_duration_months : null,
    exitStrategy,
    projectType: 'appraisal',
    rawAppraisal: appraisal,
  };
}

// ─── PDF Builder ──────────────────────────────────────────────────────────────
class PDFBuilder {
  doc: jsPDF;
  y: number;
  ml: number; mr: number; mt: number; mb: number;
  pw: number; ph: number; cw: number;

  constructor() {
    this.doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    this.ml = 18; this.mr = 18; this.mt = 16; this.mb = 16;
    this.pw = 210; this.ph = 297;
    this.cw = this.pw - this.ml - this.mr;
    this.y = this.mt;
  }

  checkBreak(need = 12) {
    if (this.y + need > this.ph - this.mb) { this.addPage(); }
  }

  addPage() {
    this.doc.addPage();
    this.y = this.mt;
  }

  // Navy header bar
  header(title: string, subtitle: string, ref: string) {
    const h = 36;
    this.doc.setFillColor(8, 22, 42);
    this.doc.rect(0, 0, this.pw, h, 'F');
    this.doc.setFillColor(58, 120, 184);
    this.doc.rect(0, h, this.pw, 1.2, 'F');

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(17);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text(title, this.ml, 14);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(106, 176, 232);
    this.doc.text(subtitle, this.ml, 22);

    this.doc.setFontSize(7.5);
    this.doc.setTextColor(80, 120, 160);
    this.doc.text(ref, this.pw - this.mr, 22, { align: 'right' });

    this.y = h + 8;
  }

  // Full-page cover (navy)
  coverPage(title: string, docType: string, ref: string, s: ProjectSummary) {
    this.doc.setFillColor(8, 22, 42);
    this.doc.rect(0, 0, this.pw, this.ph, 'F');
    this.doc.setFillColor(58, 120, 184);
    this.doc.rect(0, 60, 6, 70, 'F');

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(9);
    this.doc.setTextColor(106, 176, 232);
    this.doc.text('CONFIDENTIAL | PRIVATE & COMMERCIAL IN CONFIDENCE', this.ml + 8, 22);

    this.doc.setFontSize(26);
    this.doc.setTextColor(255, 255, 255);
    const titleLines = this.doc.splitTextToSize(title, this.cw - 4);
    this.doc.text(titleLines, this.ml + 8, 72);

    const titleEndY = 72 + titleLines.length * 11;

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(13);
    this.doc.setTextColor(106, 176, 232);
    this.doc.text(docType, this.ml + 8, titleEndY + 10);

    this.doc.setFontSize(8.5);
    this.doc.setTextColor(60, 95, 140);
    this.doc.text(s.address, this.ml + 8, titleEndY + 20);
    this.doc.text(`Strategy: ${s.strategy}`, this.ml + 8, titleEndY + 27);
    this.doc.text(`Date: ${today()}`, this.ml + 8, titleEndY + 34);
    this.doc.text(`Reference: ${ref}`, this.ml + 8, titleEndY + 41);

    // Bottom metrics strip
    const stripY = this.ph - 52;
    this.doc.setFillColor(14, 32, 58);
    this.doc.rect(0, stripY, this.pw, 52, 'F');
    this.doc.setFillColor(58, 120, 184);
    this.doc.rect(0, stripY, this.pw, 0.8, 'F');

    const metrics = [
      { label: 'Purchase Price', val: fmtGBP(s.purchasePrice) },
      { label: 'Total Project Cost', val: fmtGBP(s.totalProjectCost) },
      { label: 'GDV', val: fmtGBP(s.gdv) },
      { label: 'IRR', val: fmtPct(s.irr) },
    ];
    const colW = this.pw / metrics.length;
    metrics.forEach((m, i) => {
      const cx = i * colW + colW / 2;
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(13);
      this.doc.setTextColor(106, 176, 232);
      this.doc.text(m.val, cx, stripY + 18, { align: 'center' });
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(60, 95, 140);
      this.doc.text(m.label, cx, stripY + 26, { align: 'center' });
    });
  }

  sectionTitle(text: string) {
    this.checkBreak(14);
    this.doc.setFillColor(58, 120, 184);
    this.doc.rect(this.ml, this.y, 3, 7, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(10.5);
    this.doc.setTextColor(8, 22, 42);
    this.doc.text(text.toUpperCase(), this.ml + 6, this.y + 5.5);
    this.y += 12;
  }

  bodyText(text: string, color: [number, number, number] = [40, 55, 75]) {
    this.checkBreak(7);
    const lines = this.doc.splitTextToSize(text, this.cw);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...color);
    this.doc.text(lines, this.ml, this.y);
    this.y += lines.length * 5 + 2;
  }

  gap(mm = 5) { this.y += mm; }

  // Two-column metrics table
  metricsTable(rows: Array<{ label: string; value: string; highlight?: boolean }>) {
    const half = Math.ceil(rows.length / 2);
    const left = rows.slice(0, half);
    const right = rows.slice(half);
    const colW = (this.cw - 4) / 2;

    const renderCol = (items: typeof rows, x: number) => {
      const startY = this.y;
      items.forEach((row, i) => {
        const ry = startY + i * 9;
        this.doc.setFillColor(i % 2 === 0 ? 245 : 250, i % 2 === 0 ? 248 : 250, i % 2 === 0 ? 252 : 255);
        this.doc.rect(x, ry - 1, colW, 8.5, 'F');
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(8);
        this.doc.setTextColor(80, 100, 130);
        this.doc.text(row.label, x + 2, ry + 4.5);
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(8.5);
        this.doc.setTextColor(row.highlight ? 58 : 20, row.highlight ? 120 : 35, row.highlight ? 184 : 55);
        this.doc.text(row.value, x + colW - 2, ry + 4.5, { align: 'right' });
      });
    };

    const needH = Math.max(left.length, right.length) * 9 + 4;
    this.checkBreak(needH);
    renderCol(left, this.ml);
    renderCol(right, this.ml + colW + 4);
    this.y += needH;
  }

  // Full-width bordered table
  dataTable(headers: string[], rows: string[][], colWidths?: number[]) {
    const widths = colWidths || headers.map(() => this.cw / headers.length);
    const rowH = 8;
    const needH = (rows.length + 1) * rowH + 4;
    this.checkBreak(needH);

    // Header row
    this.doc.setFillColor(8, 22, 42);
    this.doc.rect(this.ml, this.y, this.cw, rowH, 'F');
    let cx = this.ml + 2;
    headers.forEach((h, i) => {
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(106, 176, 232);
      this.doc.text(h, cx, this.y + 5.5);
      cx += widths[i];
    });
    this.y += rowH;

    rows.forEach((row, ri) => {
      this.doc.setFillColor(ri % 2 === 0 ? 245 : 252, ri % 2 === 0 ? 248 : 253, ri % 2 === 0 ? 252 : 255);
      this.doc.rect(this.ml, this.y, this.cw, rowH, 'F');
      let rx = this.ml + 2;
      row.forEach((cell, ci) => {
        this.doc.setFont('helvetica', ri === rows.length - 1 ? 'bold' : 'normal');
        this.doc.setFontSize(7.5);
        this.doc.setTextColor(20, 35, 55);
        this.doc.text(String(cell), rx, this.y + 5.5);
        rx += widths[ci];
      });
      this.y += rowH;
    });
    this.y += 4;
  }

  // Bottom disclaimer + page number
  footer(pageNum: number, totalPages: number, disclaimer: string) {
    const fy = this.ph - 13;
    this.doc.setFillColor(230, 238, 248);
    this.doc.rect(0, fy, this.pw, 13, 'F');
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(6.5);
    this.doc.setTextColor(100, 120, 150);
    this.doc.text(disclaimer, this.ml, fy + 5, { maxWidth: this.cw - 30 });
    this.doc.text(`Page ${pageNum} of ${totalPages}`, this.pw - this.mr, fy + 5, { align: 'right' });
  }

  // Page-level header for interior pages
  pageHeader(title: string, ref: string) {
    this.doc.setFillColor(8, 22, 42);
    this.doc.rect(0, 0, this.pw, 12, 'F');
    this.doc.setFillColor(58, 120, 184);
    this.doc.rect(0, 12, this.pw, 0.7, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(255, 255, 255);
    this.doc.text(title, this.ml, 8.5);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(7);
    this.doc.setTextColor(80, 120, 160);
    this.doc.text(ref, this.pw - this.mr, 8.5, { align: 'right' });
    this.y = 18;
  }

  bullet(text: string, indent = 4) {
    this.checkBreak(6);
    const lines = this.doc.splitTextToSize(text, this.cw - indent - 5);
    this.doc.setFillColor(58, 120, 184);
    this.doc.circle(this.ml + indent + 1, this.y + 1.5, 1, 'F');
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(40, 55, 75);
    this.doc.text(lines, this.ml + indent + 4, this.y + 3);
    this.y += lines.length * 5 + 1.5;
  }

  highlightBox(text: string, label?: string) {
    this.checkBreak(18);
    const lines = this.doc.splitTextToSize(text, this.cw - 10);
    const boxH = lines.length * 5 + 10;
    this.doc.setFillColor(235, 243, 252);
    this.doc.roundedRect(this.ml, this.y, this.cw, boxH, 2, 2, 'F');
    this.doc.setFillColor(58, 120, 184);
    this.doc.roundedRect(this.ml, this.y, 4, boxH, 2, 2, 'F');
    if (label) {
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(58, 120, 184);
      this.doc.text(label, this.ml + 8, this.y + 6);
    }
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(20, 40, 70);
    this.doc.text(lines, this.ml + 8, this.y + (label ? 12 : 7));
    this.y += boxH + 5;
  }

  heroMetrics(metrics: Array<{ label: string; value: string; sub?: string }>) {
    const colW = this.cw / metrics.length;
    const barH = 26;
    this.checkBreak(barH + 4);

    metrics.forEach((m, i) => {
      const x = this.ml + i * colW;
      this.doc.setFillColor(i % 2 === 0 ? 14 : 20, i % 2 === 0 ? 30 : 40, i % 2 === 0 ? 55 : 68);
      this.doc.rect(x, this.y, colW - 2, barH, 'F');

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(14);
      this.doc.setTextColor(106, 176, 232);
      this.doc.text(m.value, x + colW / 2 - 1, this.y + 11, { align: 'center' });

      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7);
      this.doc.setTextColor(80, 120, 160);
      this.doc.text(m.label, x + colW / 2 - 1, this.y + 18, { align: 'center' });

      if (m.sub) {
        this.doc.setFontSize(6.5);
        this.doc.setTextColor(50, 90, 130);
        this.doc.text(m.sub, x + colW / 2 - 1, this.y + 23, { align: 'center' });
      }
    });
    this.y += barH + 6;
  }

  // ── Charts ──────────────────────────────────────────────────────────────────

  /** Vertical waterfall chart: stacked segments building up to a total bar */
  waterfallChart(
    segments: Array<{ label: string; value: number; color: [number, number, number] }>,
    total: { label: string; value: number },
    chartH = 52,
  ) {
    const chartW = this.cw;
    this.checkBreak(chartH + 22);
    const cx = this.ml;
    const cy = this.y;
    const maxVal = total.value * 1.04;
    // +0.5 col gap before total bar
    const numCols = segments.length + 1.5;
    const colW = chartW / numCols;
    const barW = colW * 0.58;
    const barPad = (colW - barW) / 2;

    // Background + grid
    this.doc.setFillColor(243, 247, 252);
    this.doc.rect(cx, cy, chartW, chartH, 'F');
    [0.25, 0.5, 0.75, 1.0].forEach(t => {
      const ly = cy + chartH * (1 - t);
      this.doc.setDrawColor(210, 222, 236);
      this.doc.setLineWidth(0.3);
      this.doc.line(cx, ly, cx + chartW, ly);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(5.5);
      this.doc.setTextColor(175, 195, 218);
      this.doc.text(fmtGBP(maxVal * t), cx + 1.5, ly - 1.2);
    });

    let running = 0;
    segments.forEach((seg, i) => {
      const bx = cx + i * colW + barPad;
      const segH = Math.max(chartH * (seg.value / maxVal), 0.5);
      const barTopY = cy + chartH * (1 - (running + seg.value) / maxVal);
      const [r, g, bl] = seg.color;
      this.doc.setFillColor(r, g, bl);
      this.doc.rect(bx, barTopY, barW, segH, 'F');

      // Value above bar
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(6);
      this.doc.setTextColor(25, 45, 75);
      this.doc.text(fmtGBP(seg.value), bx + barW / 2, barTopY - 2, { align: 'center' });

      // Dashed connector to next bar
      if (i < segments.length - 1) {
        this.doc.setDrawColor(150, 175, 210);
        this.doc.setLineWidth(0.4);
        this.doc.setLineDashPattern([1.2, 1], 0);
        this.doc.line(bx + barW, barTopY, cx + (i + 1) * colW + barPad, barTopY);
        this.doc.setLineDashPattern([], 0);
      }

      // X label
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(6);
      this.doc.setTextColor(55, 85, 125);
      const ll = this.doc.splitTextToSize(seg.label, colW * 0.9);
      this.doc.text(ll, bx + barW / 2, cy + chartH + 5, { align: 'center' });

      running += seg.value;
    });

    // Total bar (slight gap)
    const totalBx = cx + segments.length * colW + colW * 0.5 + barPad;
    const totalH = Math.max(chartH * (total.value / maxVal), 0.5);
    const totalTopY = cy + chartH - totalH;
    this.doc.setFillColor(8, 22, 42);
    this.doc.rect(totalBx, totalTopY, barW, totalH, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(6.5);
    this.doc.setTextColor(25, 45, 75);
    this.doc.text(fmtGBP(total.value), totalBx + barW / 2, totalTopY - 2, { align: 'center' });
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(6);
    this.doc.setTextColor(55, 85, 125);
    const tl = this.doc.splitTextToSize(total.label, colW * 0.9);
    this.doc.text(tl, totalBx + barW / 2, cy + chartH + 5, { align: 'center' });

    // X-axis line
    this.doc.setDrawColor(90, 120, 165);
    this.doc.setLineWidth(0.6);
    this.doc.line(cx, cy + chartH, cx + chartW, cy + chartH);
    this.y += chartH + 16;
  }

  /** Horizontal stacked bar showing cost decomposition as % of total */
  stackedHBar(
    segments: Array<{ label: string; value: number; color: [number, number, number] }>,
    total: number,
    barH = 14,
  ) {
    const chartW = this.cw;
    this.checkBreak(barH + 28);
    const cx = this.ml;
    const cy = this.y;
    let rx = cx;

    // Bar
    segments.forEach(seg => {
      const w = chartW * (seg.value / total);
      const [r, g, bl] = seg.color;
      this.doc.setFillColor(r, g, bl);
      this.doc.rect(rx, cy, Math.max(w, 0), barH, 'F');
      // Value inside if wide enough
      if (w > 18) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(6.5);
        this.doc.setTextColor(255, 255, 255);
        this.doc.text(fmtGBP(seg.value), rx + w / 2, cy + barH / 2 + 2, { align: 'center' });
      }
      rx += Math.max(w, 0);
    });

    // Legend row
    let lx = cx;
    const legendY = cy + barH + 8;
    segments.forEach(seg => {
      const [r, g, bl] = seg.color;
      this.doc.setFillColor(r, g, bl);
      this.doc.rect(lx, legendY - 3.5, 5, 4, 'F');
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(6.5);
      this.doc.setTextColor(50, 75, 110);
      const pct = total > 0 ? ((seg.value / total) * 100).toFixed(0) : '0';
      this.doc.text(`${seg.label} ${pct}%`, lx + 7, legendY);
      lx += this.cw / segments.length;
    });
    this.y += barH + 18;
  }

  /** Horizontal bar chart for sensitivity — colour-coded by profit level */
  sensitivityHBars(
    scenarios: Array<{ label: string; profit: number; isBase?: boolean }>,
    chartH = 52,
  ) {
    this.checkBreak(chartH + 10);
    const cx = this.ml;
    const cy = this.y;
    const labelW = 26;
    const valueW = 28;
    const barsW = this.cw - labelW - valueW;
    const rowH = chartH / scenarios.length;
    const maxAbs = Math.max(...scenarios.map(s => Math.abs(s.profit))) * 1.08;

    // Background
    this.doc.setFillColor(243, 247, 252);
    this.doc.rect(cx, cy, this.cw, chartH, 'F');

    scenarios.forEach((s, i) => {
      const ry = cy + i * rowH;
      const isBase = !!s.isBase;

      // Row bg highlight for base
      if (isBase) {
        this.doc.setFillColor(228, 238, 252);
        this.doc.rect(cx, ry, this.cw, rowH, 'F');
      }

      // Label
      this.doc.setFont('helvetica', isBase ? 'bold' : 'normal');
      this.doc.setFontSize(7);
      this.doc.setTextColor(40, 60, 95);
      this.doc.text(s.label, cx + labelW - 2, ry + rowH * 0.62, { align: 'right' });

      // Bar
      const barMaxW = barsW * 0.9;
      const barW = barMaxW * Math.min(Math.abs(s.profit) / maxAbs, 1);
      const bx = cx + labelW + 2;
      const barTopY = ry + rowH * 0.15;
      const bh = rowH * 0.7;
      const color: [number, number, number] =
        s.profit < 0 ? [185, 45, 45] : s.profit < maxAbs * 0.3 ? [185, 130, 30] : [35, 155, 85];
      this.doc.setFillColor(...color);
      this.doc.rect(bx, barTopY, Math.max(barW, 0.5), bh, 'F');

      // Value
      this.doc.setFont('helvetica', isBase ? 'bold' : 'normal');
      this.doc.setFontSize(7);
      this.doc.setTextColor(...color);
      this.doc.text(fmtGBP(s.profit), cx + labelW + barMaxW + 6, ry + rowH * 0.62);
    });

    // Zero-line divider
    this.doc.setDrawColor(130, 155, 195);
    this.doc.setLineWidth(0.4);
    this.doc.line(cx + labelW, cy, cx + labelW, cy + chartH);
    this.y += chartH + 5;
  }

  /** LTV / equity split bar for lender docs */
  ltvBar(loanAmt: number, propertyValue: number, loanLabel = 'Loan', equityLabel = 'Equity / Buffer') {
    this.checkBreak(32);
    const cx = this.ml;
    const cy = this.y;
    const barH = 18;
    const chartW = this.cw;
    const loanW = chartW * Math.min(loanAmt / propertyValue, 1);
    const equityW = chartW - loanW;
    const ltv = (loanAmt / propertyValue) * 100;

    // Loan portion
    this.doc.setFillColor(58, 120, 184);
    this.doc.rect(cx, cy, loanW, barH, 'F');
    if (loanW > 22) {
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7);
      this.doc.setTextColor(255, 255, 255);
      this.doc.text(`${ltv.toFixed(0)}% LTV`, cx + loanW / 2, cy + barH / 2 + 2.5, { align: 'center' });
    }

    // Equity/buffer portion
    this.doc.setFillColor(40, 155, 85);
    this.doc.rect(cx + loanW, cy, equityW, barH, 'F');
    if (equityW > 22) {
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7);
      this.doc.setTextColor(255, 255, 255);
      this.doc.text(`${(100 - ltv).toFixed(0)}% Equity`, cx + loanW + equityW / 2, cy + barH / 2 + 2.5, { align: 'center' });
    }

    // Labels below
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(6.5);
    this.doc.setTextColor(50, 90, 140);
    this.doc.text(`${loanLabel}: ${fmtGBP(loanAmt)}`, cx, cy + barH + 7);
    this.doc.setTextColor(30, 120, 70);
    this.doc.text(`${equityLabel}: ${fmtGBP(propertyValue - loanAmt)}`, cx + loanW, cy + barH + 7);
    this.y += barH + 14;
  }

  /** IRR vs benchmark comparison — vertical bars */
  irrBenchmarks(irr: number, chartH = 48) {
    const benchmarks = [
      { label: 'Cash\nSavings', val: 4.8, color: [100, 130, 165] as [number, number, number] },
      { label: 'Gov.\nBonds', val: 4.3, color: [100, 130, 165] as [number, number, number] },
      { label: 'FTSE\n100', val: 7.8, color: [100, 130, 165] as [number, number, number] },
      { label: 'Buy-to-\nLet', val: 6.5, color: [100, 130, 165] as [number, number, number] },
      { label: 'This\nProject', val: irr, color: [58, 120, 184] as [number, number, number] },
    ];
    this.checkBreak(chartH + 22);
    const cx = this.ml;
    const cy = this.y;
    const chartW = this.cw;
    const maxVal = Math.max(...benchmarks.map(b => b.val)) * 1.1;
    const colW = chartW / benchmarks.length;
    const barW = colW * 0.55;
    const barPad = (colW - barW) / 2;

    // Background
    this.doc.setFillColor(243, 247, 252);
    this.doc.rect(cx, cy, chartW, chartH, 'F');

    // Grid lines
    [2, 4, 6, 8, 10].filter(v => v <= maxVal * 1.05).forEach(v => {
      const ly = cy + chartH * (1 - v / maxVal);
      this.doc.setDrawColor(210, 222, 236);
      this.doc.setLineWidth(0.25);
      this.doc.line(cx, ly, cx + chartW, ly);
      this.doc.setFontSize(5.5);
      this.doc.setTextColor(175, 195, 218);
      this.doc.text(`${v}%`, cx + 1, ly - 1);
    });

    benchmarks.forEach((b, i) => {
      const bx = cx + i * colW + barPad;
      const bh = chartH * (b.val / maxVal);
      const bTopY = cy + chartH - bh;
      const [r, g, bl] = b.color;
      this.doc.setFillColor(r, g, bl);
      this.doc.rect(bx, bTopY, barW, bh, 'F');

      // Value
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(6.5);
      this.doc.setTextColor(25, 45, 75);
      this.doc.text(`${b.val.toFixed(1)}%`, bx + barW / 2, bTopY - 2, { align: 'center' });

      // Label
      this.doc.setFont('helvetica', i === 4 ? 'bold' : 'normal');
      this.doc.setFontSize(6.5);
      this.doc.setTextColor(i === 4 ? 58 : 70, i === 4 ? 120 : 100, i === 4 ? 184 : 140);
      const ll = this.doc.splitTextToSize(b.label, colW * 0.9);
      this.doc.text(ll, bx + barW / 2, cy + chartH + 6, { align: 'center' });
    });

    // X axis
    this.doc.setDrawColor(90, 120, 165);
    this.doc.setLineWidth(0.6);
    this.doc.line(cx, cy + chartH, cx + chartW, cy + chartH);
    this.y += chartH + 16;
  }

  /** Project timeline (Gantt-style horizontal bars) */
  timelineBar(
    phases: Array<{ label: string; startMonth: number; durationMonths: number; color: [number, number, number] }>,
    totalMonths: number,
  ) {
    const rowH = 9;
    const labelW = 32;
    const needed = phases.length * rowH + 14;
    this.checkBreak(needed);
    const cx = this.ml;
    const cy = this.y;
    const barsW = this.cw - labelW;

    // Background
    this.doc.setFillColor(243, 247, 252);
    this.doc.rect(cx, cy, this.cw, needed - 6, 'F');

    // Month tick marks
    const tickMonths = totalMonths <= 12 ? 3 : totalMonths <= 24 ? 6 : 12;
    for (let m = 0; m <= totalMonths; m += tickMonths) {
      const tx = cx + labelW + (m / totalMonths) * barsW;
      this.doc.setDrawColor(200, 215, 232);
      this.doc.setLineWidth(0.3);
      this.doc.line(tx, cy, tx, cy + phases.length * rowH);
      this.doc.setFontSize(5.5);
      this.doc.setTextColor(165, 185, 210);
      this.doc.text(`M${m}`, tx, cy + phases.length * rowH + 5, { align: 'center' });
    }

    phases.forEach((ph, i) => {
      const ry = cy + i * rowH;
      // Phase label
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(6.5);
      this.doc.setTextColor(45, 70, 110);
      this.doc.text(ph.label, cx + labelW - 2, ry + rowH * 0.65, { align: 'right' });

      // Phase bar
      const bx = cx + labelW + (ph.startMonth / totalMonths) * barsW;
      const bw = Math.max((ph.durationMonths / totalMonths) * barsW, 1);
      const [r, g, bl] = ph.color;
      this.doc.setFillColor(r, g, bl);
      this.doc.rect(bx, ry + 1.5, bw, rowH - 3, 'F');

      // Duration label inside bar
      if (bw > 12) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(6);
        this.doc.setTextColor(255, 255, 255);
        this.doc.text(`${ph.durationMonths}m`, bx + bw / 2, ry + rowH * 0.65, { align: 'center' });
      }
    });
    this.y += needed + 2;
  }

  /** Deal score progress gauge */
  scoreGauge(score: number, max = 10) {
    this.checkBreak(18);
    const cx = this.ml;
    const cy = this.y;
    const barW = this.cw;
    const barH = 10;
    const segW = barW / max;

    for (let s = 0; s < max; s++) {
      const filled = s < Math.round(score);
      const shade = s < 4 ? [160, 45, 45] : s < 7 ? [185, 130, 30] : [35, 155, 85];
      this.doc.setFillColor(filled ? shade[0] : 230, filled ? shade[1] : 235, filled ? shade[2] : 242);
      this.doc.rect(cx + s * segW + 0.5, cy, segW - 1, barH, 'F');
    }
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(7);
    this.doc.setTextColor(25, 45, 75);
    this.doc.text(`Deal Score: ${score.toFixed(1)} / ${max}`, cx + barW + 3, cy + barH * 0.7);
    this.y += barH + 8;
  }

  /** Lender stress coverage bars — colour-coded pass/fail */
  coverageHBars(
    scenarios: Array<{ label: string; coverage: number; isBase?: boolean }>,
    chartH = 52,
  ) {
    this.checkBreak(chartH + 10);
    const cx = this.ml;
    const cy = this.y;
    const labelW = 30;
    const barsW = this.cw - labelW - 24;
    const rowH = chartH / scenarios.length;
    const maxCoverage = 160; // cap at 160%

    this.doc.setFillColor(243, 247, 252);
    this.doc.rect(cx, cy, this.cw, chartH, 'F');

    // 100% reference line
    const refX = cx + labelW + (barsW * 100) / maxCoverage;
    this.doc.setDrawColor(180, 50, 50);
    this.doc.setLineWidth(0.5);
    this.doc.setLineDashPattern([2, 1], 0);
    this.doc.line(refX, cy, refX, cy + chartH);
    this.doc.setLineDashPattern([], 0);
    this.doc.setFontSize(6);
    this.doc.setTextColor(180, 50, 50);
    this.doc.text('100%', refX, cy - 1.5, { align: 'center' });

    scenarios.forEach((s, i) => {
      const ry = cy + i * rowH;
      if (s.isBase) {
        this.doc.setFillColor(228, 238, 252);
        this.doc.rect(cx, ry, this.cw, rowH, 'F');
      }

      this.doc.setFont('helvetica', s.isBase ? 'bold' : 'normal');
      this.doc.setFontSize(7);
      this.doc.setTextColor(40, 60, 95);
      this.doc.text(s.label, cx + labelW - 2, ry + rowH * 0.62, { align: 'right' });

      const barW = Math.min(barsW * (s.coverage / maxCoverage), barsW);
      const bTopY = ry + rowH * 0.15;
      const bh = rowH * 0.7;
      const color: [number, number, number] =
        s.coverage >= 120 ? [35, 155, 85] : s.coverage >= 100 ? [185, 130, 30] : [185, 45, 45];
      this.doc.setFillColor(...color);
      this.doc.rect(cx + labelW, bTopY, Math.max(barW, 0.5), bh, 'F');

      const status = s.coverage >= 120 ? 'PASS' : s.coverage >= 100 ? 'MARGINAL' : 'FAIL';
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(6.5);
      this.doc.setTextColor(...color);
      this.doc.text(`${s.coverage.toFixed(0)}%  ${status}`, cx + labelW + barsW + 3, ry + rowH * 0.62);
    });

    this.doc.setDrawColor(130, 155, 195);
    this.doc.setLineWidth(0.4);
    this.doc.line(cx + labelW, cy, cx + labelW, cy + chartH);
    this.y += chartH + 5;
  }

  save(filename: string) {
    this.doc.save(filename);
  }
}

// ─── Disclaimer text ──────────────────────────────────────────────────────────
const INVESTOR_DISC =
  'This document is confidential and prepared for information purposes only. It does not constitute an offer or solicitation to invest. Past returns are not indicative of future performance. All projections are estimates and subject to material risks. Recipients should conduct their own due diligence and seek independent financial and legal advice before making any investment decision. UK Property Analyser accepts no liability for decisions made on the basis of this document.';

const LENDER_DISC =
  'This document is prepared for information purposes only and does not constitute a formal credit application or binding commitment. All financial projections are estimates based on information provided and are subject to change. Security is subject to independent valuation. This document is strictly confidential and intended solely for the named recipient. UK Property Analyser accepts no liability for lending decisions made on the basis of this document.';

// ─── Investor Teaser PDF ──────────────────────────────────────────────────────
function generateInvestorTeaser(s: ProjectSummary) {
  const b = new PDFBuilder();
  const ref = s.projectId ? `REF: ${s.projectId}` : `REF: UKP-${Date.now().toString().slice(-6)}`;
  const projectLabel = s.projectId || s.projectName;
  const region = postcodeToRegion(s.postcode);

  // Single page layout
  b.header(projectLabel, `INVESTOR OPPORTUNITY TEASER  |  ${s.strategy.toUpperCase()}`, ref);
  b.gap(2);

  // Hero metrics
  b.heroMetrics([
    { label: 'Target IRR', value: fmtPct(s.irr), sub: 'Equity return' },
    { label: 'Equity Required', value: fmtGBP(s.equityRequired), sub: 'Net capital needed' },
    { label: 'Net Profit', value: fmtGBP(s.netProfitAmount), sub: fmtPct(s.netProfitPercent) + ' margin' },
    { label: 'GDV / Exit Value', value: fmtGBP(s.gdv), sub: 'Gross development value' },
  ]);

  b.sectionTitle('The Opportunity');
  b.bodyText(
    `Project ${projectLabel} represents a ${s.strategy.toLowerCase()} opportunity in the ${region} region. ` +
    `This investment targets a net IRR of ${fmtPct(s.irr)} with a total project cost of ${fmtGBP(s.totalProjectCost)}, ` +
    `generating an estimated net profit of ${fmtGBP(s.netProfitAmount)} (${fmtPct(s.netProfitPercent)} margin) ` +
    `over a ${s.projectDurationMonths != null ? Math.round(s.projectDurationMonths) : '—'}-month project duration. ` +
    `Exit strategy: ${s.exitStrategy}.`
  );
  b.gap(4);

  // Key investment metrics
  b.sectionTitle('Key Investment Metrics');
  b.metricsTable([
    { label: 'Project Reference', value: projectLabel },
    { label: 'Region', value: region },
    { label: 'Strategy', value: s.strategy },
    { label: 'Exit Strategy', value: s.exitStrategy },
    { label: 'Purchase Price', value: fmtGBP(s.purchasePrice), highlight: false },
    { label: 'Total Project Cost', value: fmtGBP(s.totalProjectCost), highlight: false },
    { label: 'GDV / Exit Value', value: fmtGBP(s.gdv), highlight: true },
    { label: 'Net Profit (£)', value: fmtGBP(s.netProfitAmount), highlight: true },
    { label: 'Net Profit (%)', value: fmtPct(s.netProfitPercent), highlight: true },
    { label: 'Target IRR', value: fmtPct(s.irr), highlight: true },
    { label: 'Equity Required', value: fmtGBP(s.equityRequired) },
    { label: 'Project Duration', value: s.projectDurationMonths != null ? `${Math.round(s.projectDurationMonths)} months` : 'N/A' },
    ...(s.dealScore != null ? [{ label: 'Deal Score', value: `${fmtNum(s.dealScore, 1)} / 10` }] : []),
  ]);

  b.gap(6);
  b.highlightBox(
    `This opportunity is available for equity participation on terms to be agreed. ` +
    `Interested investors should request the full Investor Memorandum and complete standard KYC/AML requirements. ` +
    `All projections are estimates — independent due diligence is strongly recommended.`,
    'NEXT STEPS'
  );

  b.footer(1, 1, INVESTOR_DISC);
  b.save(`${(s.projectId || s.projectName).replace(/[^a-zA-Z0-9]/g, '_')}_Investor_Teaser.pdf`);
}

// ─── Investor Memo PDF ────────────────────────────────────────────────────────
function generateInvestorMemo(s: ProjectSummary) {
  const b = new PDFBuilder();
  const ref = s.projectId ? `REF: ${s.projectId}` : `REF: UKP-${Date.now().toString().slice(-6)}`;
  const name = s.projectName;
  const durationStr = s.projectDurationMonths != null ? `${Math.round(s.projectDurationMonths)} months` : 'N/A';

  // Page 1: Cover
  b.coverPage(name, 'INVESTOR MEMORANDUM', ref, s);
  b.footer(1, 12, INVESTOR_DISC);

  // Page 2: Executive Summary
  b.addPage();
  b.pageHeader(`${name}  |  INVESTOR MEMORANDUM`, ref);
  b.sectionTitle('Executive Summary');
  b.bodyText(
    `This Investor Memorandum has been prepared in connection with the ${s.strategy.toLowerCase()} opportunity at ` +
    `${s.address}. The project is structured to deliver an estimated net return of ${fmtPct(s.netProfitPercent)} ` +
    `(${fmtGBP(s.netProfitAmount)}) on total project costs of ${fmtGBP(s.totalProjectCost)}, ` +
    `targeting an equity IRR of ${fmtPct(s.irr)} over a ${durationStr} programme.`
  );
  b.gap(3);
  b.highlightBox(
    `Strategy: ${s.strategy}\n` +
    `Exit: ${s.exitStrategy}\n` +
    `Equity Required: ${fmtGBP(s.equityRequired)}\n` +
    `Target IRR: ${fmtPct(s.irr)}\n` +
    `Project Duration: ${durationStr}`,
    'INVESTMENT AT A GLANCE'
  );
  b.gap(4);
  b.sectionTitle('Key Financial Metrics');
  b.metricsTable([
    { label: 'Purchase Price', value: fmtGBP(s.purchasePrice) },
    { label: 'Total Project Cost', value: fmtGBP(s.totalProjectCost) },
    { label: 'GDV / Exit Value', value: fmtGBP(s.gdv), highlight: true },
    { label: 'Net Profit', value: fmtGBP(s.netProfitAmount), highlight: true },
    { label: 'Net Profit Margin', value: fmtPct(s.netProfitPercent), highlight: true },
    { label: 'Equity IRR', value: fmtPct(s.irr), highlight: true },
    { label: 'Equity Required', value: fmtGBP(s.equityRequired) },
    { label: 'Project Duration', value: durationStr },
    ...(s.dealScore != null ? [{ label: 'Deal Score', value: `${fmtNum(s.dealScore, 1)} / 10` }] : []),
  ]);
  b.gap(5);
  // Cost decomposition bar
  b.sectionTitle('Cost & Profit Composition (% of GDV)');
  if (s.gdv && s.gdv > 0) {
    const pp = s.purchasePrice || 0;
    const totalC = s.totalProjectCost || 0;
    const worksEst = Math.max(totalC - pp, 0);
    const profit = s.netProfitAmount || 0;
    const gdv = s.gdv;
    b.stackedHBar([
      { label: 'Purchase', value: pp, color: [8, 22, 42] },
      { label: 'Works / Costs', value: worksEst, color: [58, 120, 184] },
      { label: 'Net Profit', value: profit, color: [35, 155, 85] },
    ], gdv);
  }
  if (s.dealScore != null) {
    b.scoreGauge(s.dealScore);
  }
  b.footer(2, 12, INVESTOR_DISC);

  // Page 3: Investment Thesis
  b.addPage();
  b.pageHeader(`${name}  |  INVESTMENT THESIS`, ref);
  b.sectionTitle('Investment Rationale');
  b.bodyText(
    `The investment rationale is driven by the ability to acquire, improve and exit the asset ` +
    `at a significant premium to total cost. The ${s.strategy} strategy provides a clear pathway ` +
    `to value creation with a defined exit at ${s.exitStrategy.toLowerCase()}.`
  );
  b.gap(3);
  b.sectionTitle('Value Creation Strategy');
  b.bullet('Acquisition of the asset at or below market value through targeted sourcing');
  b.bullet(`Execution of a structured ${s.strategy.toLowerCase()} programme over ${durationStr}`);
  b.bullet('Disciplined cost management through the construction and finance phases');
  b.bullet(`Exit via ${s.exitStrategy.toLowerCase()} to realise GDV of ${fmtGBP(s.gdv)}`);
  b.bullet(`Delivery of net profit of ${fmtGBP(s.netProfitAmount)} representing ${fmtPct(s.netProfitPercent)} margin on cost`);
  b.gap(4);
  b.sectionTitle('Market Context');
  b.bodyText(
    `The UK residential property market continues to exhibit structural undersupply, particularly in the ` +
    `refurbished and modernised stock segment. Demand from owner-occupiers and private renters for ` +
    `high-quality improved properties supports projected exit values. Local comparable evidence and ` +
    `market trends underpin the GDV assumption of ${fmtGBP(s.gdv)}.`
  );
  b.gap(3);
  b.sectionTitle('Competitive Advantages');
  b.bullet('Off-market or early-stage acquisition reducing competitive bidding');
  b.bullet('Experienced development and project management team');
  b.bullet('Conservative underwriting with margin of safety built into GDV assumptions');
  b.bullet('Structured financing reduces equity drag and enhances equity returns');
  b.footer(3, 12, INVESTOR_DISC);

  // Page 4: Property Details
  b.addPage();
  b.pageHeader(`${name}  |  PROPERTY & SITE OVERVIEW`, ref);
  b.sectionTitle('Property Details');
  const deal = s.rawDeal;
  const appr = s.rawAppraisal;
  if (deal) {
    const fs = deal.form_snapshot;
    b.metricsTable([
      { label: 'Address', value: fs.address || '—' },
      { label: 'Postcode', value: fs.postcode || '—' },
      { label: 'Property Type', value: fs.propertyType || '—' },
      { label: 'Bedrooms', value: fs.bedrooms || '—' },
      { label: 'Floor Area (sqft)', value: fs.floorAreaSqft ? `${fs.floorAreaSqft} sqft` : '—' },
      { label: 'Floor Area (sqm)', value: fs.floorAreaSqm ? `${fs.floorAreaSqm} sqm` : '—' },
      { label: 'Tenure', value: fs.tenure || '—' },
      { label: 'EPC Rating', value: fs.epcRating || '—' },
      { label: 'Council Tax Band', value: fs.councilTaxBand || '—' },
      { label: 'Auction House', value: fs.auctionHouse || '—' },
      { label: 'Lot Number', value: fs.lotNumber || '—' },
      { label: 'Auction Date', value: fs.auctionDate || '—' },
    ]);
  } else if (appr) {
    const snap = appr.inputs_snapshot as Record<string, unknown>;
    b.metricsTable([
      { label: 'Project Name', value: appr.name },
      { label: 'Finance Mode', value: (snap.finance_mode as string) || '—' },
      { label: 'Floor Area (sqm)', value: snap.floor_area_sqm ? `${snap.floor_area_sqm} sqm` : '—' },
      { label: 'Existing GIA (sqm)', value: snap.existing_gia_sqm ? `${snap.existing_gia_sqm} sqm` : '—' },
      { label: 'Refurb Duration', value: snap.refurb_duration_months ? `${snap.refurb_duration_months} months` : '—' },
      { label: 'Project Duration', value: snap.project_duration_months ? `${snap.project_duration_months} months` : '—' },
    ]);
  }
  b.gap(4);
  b.sectionTitle('Location & Market');
  b.bodyText(
    `Located at ${s.address}, the property sits within an established residential market. ` +
    `The area benefits from strong underlying demand, good transport connectivity, and a track record ` +
    `of price growth consistent with national trends. Comparable evidence supports the projected exit ` +
    `value of ${fmtGBP(s.gdv)}.`
  );
  b.footer(4, 12, INVESTOR_DISC);

  // Page 5: Acquisition & Costs
  b.addPage();
  b.pageHeader(`${name}  |  FINANCIAL ANALYSIS`, ref);
  b.sectionTitle('Acquisition & Project Costs');
  if (deal) {
    const fs = deal.form_snapshot;
    const sdlt = deal.sdlt / 100;
    const purchaseP = parseFloat(fs.guidePrice) || 0;
    const legal = parseFloat(fs.legalFees) || 1500;
    const survey = parseFloat(fs.survey) || 0;
    const refurb = parseFloat(fs.refurbBudget) || 0;
    b.dataTable(
      ['Cost Item', 'Amount', 'Notes'],
      [
        ['Purchase Price', fmtGBP(purchaseP), 'Agreed/Guide price'],
        ['SDLT', fmtGBP(sdlt), deal.form_snapshot.additionalProperty ? 'Incl. 5% surcharge' : 'Standard rate'],
        ['Legal Fees (Purchase)', fmtGBP(legal), 'Conveyancing'],
        ['Survey / Valuation', fmtGBP(survey), 'Structural / RICS'],
        ['Refurbishment Works', fmtGBP(refurb), 'Total works budget'],
        ['TOTAL PROJECT COST', fmtGBP(purchaseP + sdlt + legal + survey + refurb), ''],
      ],
      [70, 40, 64]
    );
  } else if (appr) {
    const snap = appr.inputs_snapshot as Record<string, unknown>;
    const summary = (snap.__summary as Record<string, number | null>) || {};
    const pp = typeof snap.purchase_price === 'number' ? snap.purchase_price : 0;
    const legal = typeof snap.legal_purchase === 'number' ? snap.legal_purchase : 0;
    b.dataTable(
      ['Cost Item', 'Amount', 'Notes'],
      [
        ['Purchase Price', fmtGBP(pp), 'Agreed/Guide price'],
        ['Legal Fees (Purchase)', fmtGBP(legal), 'Conveyancing costs'],
        ['Council / CIL', fmtGBP((snap.council as number || 0) + (snap.cil as number || 0)), 'Planning obligations'],
        ['S106 / Planning Fees', fmtGBP((snap.s106 as number || 0) + (snap.planning_fees as number || 0)), 'Planning costs'],
        ['Total Project Cost', fmtGBP(summary.projectCost ?? null), 'Per financial model'],
      ],
      [70, 40, 64]
    );
  }
  b.gap(4);
  b.sectionTitle('Finance Structure');
  if (appr) {
    const snap = appr.inputs_snapshot as Record<string, unknown>;
    b.metricsTable([
      { label: 'Finance Mode', value: (snap.finance_mode as string) || '—' },
      { label: 'Bridge LTV', value: snap.bridge_ltv ? fmtPct(snap.bridge_ltv as number) : '—' },
      { label: 'Bridge Rate (pa)', value: snap.bridge_rate ? fmtPct(snap.bridge_rate as number) : '—' },
      { label: 'Bridge Arrangement Fee', value: snap.bridge_arrangement_fee ? fmtPct(snap.bridge_arrangement_fee as number) : '—' },
      { label: 'Dev Finance Rate (pa)', value: snap.dev_finance_rate ? fmtPct(snap.dev_finance_rate as number) : '—' },
      { label: 'Dev Loan %', value: snap.dev_loan_pct ? fmtPct(snap.dev_loan_pct as number) : '—' },
    ]);
  } else {
    b.bodyText('Finance structure to be arranged. Equity contribution covers total project costs.');
  }
  b.gap(5);
  // Waterfall chart: cost build-up to GDV
  b.sectionTitle('Cost Build-up to GDV');
  {
    const pp = s.purchasePrice || 0;
    const totalC = s.totalProjectCost || 0;
    const worksEst = Math.max(totalC - pp, 0);
    const profit = s.netProfitAmount || 0;
    const gdv = s.gdv || (totalC + profit);
    const dMonths = s.projectDurationMonths;
    b.waterfallChart([
      { label: 'Purchase Price', value: pp, color: [8, 22, 42] },
      { label: 'Works & Costs', value: worksEst, color: [58, 120, 184] },
      { label: 'Net Profit', value: profit, color: [35, 155, 85] },
    ], { label: 'GDV / Exit', value: gdv }, 48);
    if (dMonths && dMonths > 0) {
      b.sectionTitle('Project Timeline');
      const worksD = Math.round(dMonths * 0.6);
      const acqD = Math.min(Math.round(dMonths * 0.1), 2);
      const exitD = dMonths - acqD - worksD;
      b.timelineBar([
        { label: 'Acquisition', startMonth: 0, durationMonths: acqD, color: [8, 22, 42] },
        { label: 'Works / Refurb', startMonth: acqD, durationMonths: worksD, color: [58, 120, 184] },
        { label: 'Marketing & Exit', startMonth: acqD + worksD, durationMonths: exitD, color: [35, 155, 85] },
      ], dMonths);
    }
  }
  b.footer(5, 12, INVESTOR_DISC);

  // Page 6: Revenue & Profit
  b.addPage();
  b.pageHeader(`${name}  |  REVENUE & PROFIT ANALYSIS`, ref);
  b.sectionTitle('Revenue & Exit Analysis');
  b.dataTable(
    ['Item', 'Value', 'Comment'],
    [
      ['Gross Development Value (GDV)', fmtGBP(s.gdv), 'Estimated exit / sale value'],
      ['Less: Agent Fees (~2%)', fmtGBP(s.gdv != null ? s.gdv * 0.02 : null), 'Sales agent commission'],
      ['Less: Legal Fees (Exit)', fmtGBP(1500), 'Conveyancing on sale'],
      ['Less: Total Project Cost', fmtGBP(s.totalProjectCost), 'Acquisition + works + finance'],
      ['NET PROFIT', fmtGBP(s.netProfitAmount), fmtPct(s.netProfitPercent) + ' margin on cost'],
    ],
    [80, 42, 52]
  );
  b.gap(6);
  b.sectionTitle('Return Metrics');
  b.metricsTable([
    { label: 'Net Profit (£)', value: fmtGBP(s.netProfitAmount), highlight: true },
    { label: 'Net Profit (%)', value: fmtPct(s.netProfitPercent), highlight: true },
    { label: 'Equity IRR', value: fmtPct(s.irr), highlight: true },
    { label: 'Project Duration', value: durationStr },
    { label: 'GDV', value: fmtGBP(s.gdv) },
    { label: 'Total Project Cost', value: fmtGBP(s.totalProjectCost) },
  ]);
  b.gap(5);
  // IRR vs benchmark chart
  if (s.irr != null) {
    b.sectionTitle('IRR vs. Comparable Investments');
    b.irrBenchmarks(s.irr);
  }
  b.footer(6, 12, INVESTOR_DISC);

  // Page 7-9: IRR & Sensitivity
  b.addPage();
  b.pageHeader(`${name}  |  IRR & SENSITIVITY ANALYSIS`, ref);
  b.sectionTitle('IRR Analysis');
  b.bodyText(
    `The equity IRR of ${fmtPct(s.irr)} is calculated on monthly cashflows incorporating drawdown schedules, ` +
    `interest roll-up on development finance, and the net sale proceeds at exit. The IRR is sensitive to ` +
    `GDV achievement and programme duration — the table below illustrates downside scenarios.`
  );
  b.gap(4);

  // Sensitivity table
  b.sectionTitle('GDV Sensitivity vs. IRR');
  if (s.gdv && s.totalProjectCost && s.netProfitAmount) {
    const base = { gdv: s.gdv, irr: s.irr, profit: s.netProfitAmount };
    const rows = [-15, -10, -5, 0, 5, 10].map(pctDelta => {
      const newGDV = base.gdv! * (1 + pctDelta / 100);
      const newProfit = newGDV * 0.97 - 1500 - (s.totalProjectCost || 0);
      const newMargin = s.totalProjectCost ? (newProfit / s.totalProjectCost) * 100 : null;
      return [
        `${pctDelta >= 0 ? '+' : ''}${pctDelta}%`,
        fmtGBP(newGDV),
        fmtGBP(newProfit),
        fmtPct(newMargin),
        pctDelta === 0 ? 'BASE CASE' : pctDelta < -10 ? 'STRESSED' : pctDelta < 0 ? 'DOWNSIDE' : 'UPSIDE',
      ];
    });
    b.dataTable(
      ['GDV Variance', 'GDV (£)', 'Net Profit (£)', 'Margin (%)', 'Scenario'],
      rows,
      [28, 44, 44, 28, 30]
    );
  }
  // GDV sensitivity bar chart
  if (s.gdv && s.totalProjectCost && s.netProfitAmount) {
    b.gap(4);
    b.sectionTitle('GDV Sensitivity — Net Profit Visual');
    const baseP = s.netProfitAmount;
    b.sensitivityHBars(
      [-20, -15, -10, -5, 0, 5, 10].map(d => ({
        label: `GDV ${d >= 0 ? '+' : ''}${d}%`,
        profit: s.gdv! * (1 + d / 100) * 0.97 - 1500 - (s.totalProjectCost || 0),
        isBase: d === 0,
      })),
      baseP,
    );
  }
  b.gap(4);
  b.sectionTitle('Cost Overrun Sensitivity');
  if (s.totalProjectCost && s.gdv) {
    const exitNet = s.gdv * 0.97 - 1500;
    const rows = [0, 5, 10, 15, 20].map(pctOver => {
      const newCost = (s.totalProjectCost || 0) * (1 + pctOver / 100);
      const newProfit = exitNet - newCost;
      const newMargin = newCost > 0 ? (newProfit / newCost) * 100 : null;
      return [`+${pctOver}%`, fmtGBP(newCost), fmtGBP(newProfit), fmtPct(newMargin), pctOver === 0 ? 'BASE' : 'STRESSED'];
    });
    b.dataTable(
      ['Cost Overrun', 'Total Cost (£)', 'Net Profit (£)', 'Margin (%)', 'Scenario'],
      rows,
      [28, 44, 44, 28, 30]
    );
  }
  b.footer(7, 12, INVESTOR_DISC);

  // Page 8: Risk Factors
  b.addPage();
  b.pageHeader(`${name}  |  RISK FACTORS`, ref);
  b.sectionTitle('Principal Risk Factors');
  b.bodyText('Investors should consider the following risk factors before making any investment decision:');
  b.gap(3);
  const risks = [
    ['Market Risk', 'Property values may decline from current levels, reducing exit proceeds and project returns.'],
    ['Construction Risk', 'Works may overrun on cost or programme, compressing margins and increasing finance costs.'],
    ['Planning Risk', 'Any required consents may not be granted or may be delayed, extending the project timeline.'],
    ['Finance Risk', 'Interest rates may rise or finance may not be available on the terms assumed.'],
    ['Liquidity Risk', 'The investment is illiquid — capital is locked in for the duration of the project.'],
    ['Sales Risk', 'The exit sale may take longer than projected, increasing holding costs.'],
    ['Regulatory Risk', 'Changes to taxation (SDLT, CGT) or property regulation may adversely affect returns.'],
    ['Counterparty Risk', 'Contractors, agents or solicitors may fail to perform, causing delays or cost increases.'],
  ];
  risks.forEach(([title, text]) => {
    b.checkBreak(18);
    b.doc.setFont('helvetica', 'bold');
    b.doc.setFontSize(8.5);
    b.doc.setTextColor(8, 22, 42);
    b.doc.text(`${title}:`, b.ml, b.y);
    b.y += 5;
    b.bodyText(text);
    b.gap(2);
  });
  b.footer(8, 12, INVESTOR_DISC);

  // Page 9: Exit Strategy
  b.addPage();
  b.pageHeader(`${name}  |  EXIT STRATEGY`, ref);
  b.sectionTitle('Proposed Exit Strategy');
  b.bodyText(`The primary exit strategy for this investment is: ${s.exitStrategy}.`);
  b.gap(3);
  b.highlightBox(
    `Primary Exit: ${s.exitStrategy}\n` +
    `Target Exit Value: ${fmtGBP(s.gdv)}\n` +
    `Project Duration: ${durationStr}\n` +
    `Net Proceeds to Investors: ${fmtGBP(s.netProfitAmount)}`,
    'EXIT SUMMARY'
  );
  b.gap(4);
  b.sectionTitle('Exit Assumptions');
  b.bullet(`GDV of ${fmtGBP(s.gdv)} achieved on open market sale within the programme`);
  b.bullet('Agent fee of approximately 2% of sale price deducted from gross proceeds');
  b.bullet('Solicitor fees of approximately £1,500 for conveyancing on sale');
  b.bullet('All finance facilities repaid and closed at or before exit');
  b.bullet('Residual profit distributed to equity investors per agreed terms');
  b.gap(4);
  b.sectionTitle('Secondary Exit Options');
  b.bullet('Refinance onto long-term buy-to-let mortgage if market conditions are unfavourable at exit');
  b.bullet('Phased sale or partial sale to de-risk programme and return early capital');
  b.bullet('Sale to portfolio investor at a negotiated discount to achieve faster exit');
  b.footer(9, 12, INVESTOR_DISC);

  // Page 10: Terms & Structure
  b.addPage();
  b.pageHeader(`${name}  |  INVESTMENT TERMS`, ref);
  b.sectionTitle('Indicative Terms');
  b.highlightBox(
    'The following terms are indicative only and subject to negotiation and legal documentation. ' +
    'Final terms will be set out in a Subscription Agreement or similar legal instrument.',
    'IMPORTANT'
  );
  b.gap(4);
  b.dataTable(
    ['Term', 'Indicative Detail'],
    [
      ['Investment Type', 'Equity participation / Preferred equity / Joint venture'],
      ['Minimum Investment', 'To be agreed'],
      ['Investment Period', durationStr],
      ['Target Return', `${fmtPct(s.irr)} IRR / ${fmtPct(s.netProfitPercent)} net margin`],
      ['Profit Split', 'To be agreed between parties'],
      ['Reporting', 'Monthly updates on programme and financial position'],
      ['Security', 'To be negotiated — charge over property where possible'],
      ['Due Diligence', 'Full pack available on request (title, planning, surveys)'],
    ],
    [70, 104]
  );
  b.footer(10, 12, INVESTOR_DISC);

  // Pages 11–12: Due Diligence Checklist
  b.addPage();
  b.pageHeader(`${name}  |  DUE DILIGENCE CHECKLIST`, ref);
  b.sectionTitle('Due Diligence Documentation Available');
  const ddItems = [
    'Title register and title plan (Land Registry)',
    'Local authority search results',
    'Environmental search results',
    'Drainage and water search',
    'Planning history and constraints',
    'Structural / building survey report',
    'Independent RICS valuation',
    'Contractor quotations and specification of works',
    'Finance indicative terms (bridging / development)',
    'Legal title report from solicitors',
    'CIL / S106 enquiries',
    'Insurance quotation',
  ];
  ddItems.forEach(item => b.bullet(item));
  b.gap(4);
  b.sectionTitle('Investor KYC / AML Requirements');
  b.bullet('Proof of identity (passport / driving licence)');
  b.bullet('Proof of address (utility bill / bank statement — within 3 months)');
  b.bullet('Source of funds declaration');
  b.bullet('Completion of investor questionnaire / suitability assessment');
  b.footer(11, 12, INVESTOR_DISC);

  // Pages 13-14: Disclaimer / Legal
  b.addPage();
  b.pageHeader(`${name}  |  IMPORTANT NOTICES`, ref);
  b.sectionTitle('Disclaimer & Legal Notices');
  b.bodyText(
    'This Investor Memorandum has been prepared by UK Property Analyser for information purposes only. ' +
    'It does not constitute investment advice, a financial promotion (as defined by the Financial Services and ' +
    'Markets Act 2000), or an offer or solicitation to invest. Recipients are strongly advised to seek ' +
    'independent financial, legal, and tax advice before making any investment decision.'
  );
  b.gap(3);
  b.bodyText(
    'All financial projections, returns, and timelines are forward-looking estimates based on assumptions ' +
    'that may prove incorrect. Past performance is not indicative of future results. Property values can ' +
    'fall as well as rise, and investors may not recover the full amount invested.'
  );
  b.gap(3);
  b.bodyText(
    'This document is strictly confidential and intended solely for the named recipient. It must not be ' +
    'reproduced, distributed, or disclosed to any third party without the prior written consent of UK Property Analyser.'
  );
  b.gap(4);
  b.bodyText(`Document prepared: ${today()}  |  Reference: ${ref}`);
  b.footer(12, 12, INVESTOR_DISC);

  b.save(`${name.replace(/[^a-zA-Z0-9]/g, '_')}_Investor_Memo.pdf`);
}

// ─── Lender Teaser PDF ────────────────────────────────────────────────────────
function generateLenderTeaser(s: ProjectSummary) {
  const b = new PDFBuilder();
  const ref = s.projectId ? `CREDIT REF: ${s.projectId}` : `CREDIT REF: UKP-${Date.now().toString().slice(-6)}`;
  const deal = s.rawDeal;
  const appr = s.rawAppraisal;

  // Estimate loan metrics
  let loanAmount: number | null = null;
  let ltv: number | null = null;
  let loanRate: number | null = null;
  let arrangementFee: number | null = null;
  let loanTerm = s.projectDurationMonths;

  if (appr) {
    const snap = appr.inputs_snapshot as Record<string, unknown>;
    const bridgeLtvPct = snap.bridge_ltv as number | undefined;
    const pp = typeof snap.purchase_price === 'number' ? snap.purchase_price : 0;
    if (bridgeLtvPct && pp) { loanAmount = pp * (bridgeLtvPct / 100); ltv = bridgeLtvPct; }
    const rawRate = snap.bridge_rate as number | undefined;
    loanRate = rawRate != null ? rawRate * 12 : null; // monthly % → annual %
    const rawArrFee = snap.bridge_arrangement_fee as number | undefined;
    arrangementFee = rawArrFee != null ? rawArrFee / 100 : null; // % → decimal
  } else if (deal) {
    const fs = deal.form_snapshot;
    const pp = parseFloat(fs.guidePrice) || 0;
    ltv = 65;
    loanAmount = pp * 0.65;
    loanRate = 0.085;
    arrangementFee = 0.02;
  }

  b.header(s.projectName, `LENDER CREDIT SUMMARY TEASER  |  ${s.strategy.toUpperCase()}`, ref);
  b.gap(2);

  b.heroMetrics([
    { label: 'Purchase Price', value: fmtGBP(s.purchasePrice), sub: 'Acquisition cost' },
    { label: 'Loan Amount (est.)', value: fmtGBP(loanAmount), sub: ltv ? `${fmtPct(ltv, 0)} LTV` : 'Senior debt' },
    { label: 'GDV / Exit Value', value: fmtGBP(s.gdv), sub: 'Primary repayment source' },
    { label: 'Loan Term', value: loanTerm ? `${Math.round(loanTerm)} months` : 'N/A', sub: 'Project duration' },
  ]);
  b.gap(3);

  b.sectionTitle('Credit Overview');
  b.bodyText(
    `Loan facility sought for a ${s.strategy.toLowerCase()} at ${s.address}. ` +
    `Security is a first legal charge over the property. Primary repayment source is sale proceeds ` +
    `from exit at an estimated GDV of ${fmtGBP(s.gdv)}. Loan term aligned to project programme of ${loanTerm != null ? Math.round(loanTerm) : '—'} months. ` +
    `Net profit of ${fmtGBP(s.netProfitAmount)} (${fmtPct(s.netProfitPercent)}) provides significant ` +
    `headroom for loan repayment.`
  );
  b.gap(4);

  b.sectionTitle('Key Credit Metrics');
  b.metricsTable([
    { label: 'Address / Security', value: s.address },
    { label: 'Strategy', value: s.strategy },
    { label: 'Purchase Price', value: fmtGBP(s.purchasePrice) },
    { label: 'Total Project Cost', value: fmtGBP(s.totalProjectCost) },
    { label: 'GDV / Exit Value', value: fmtGBP(s.gdv), highlight: true },
    { label: 'Loan Amount (est.)', value: fmtGBP(loanAmount) },
    { label: 'LTV (est.)', value: ltv ? fmtPct(ltv, 0) : 'To be agreed' },
    { label: 'Interest Rate (est.)', value: loanRate ? fmtPct(loanRate) : 'To be agreed' },
    { label: 'Arrangement Fee (est.)', value: arrangementFee ? fmtPct(arrangementFee * 100) : 'To be agreed' },
    { label: 'Loan Term', value: loanTerm ? `${Math.round(loanTerm)} months` : '—' },
    { label: 'Exit Strategy', value: s.exitStrategy, highlight: true },
    { label: 'Net Project Profit', value: fmtGBP(s.netProfitAmount), highlight: true },
  ]);
  b.gap(5);

  b.highlightBox(
    `Full credit pack available on request including: independent valuation report, title information, ` +
    `planning status, contractor quotations, full financial model and borrower information. ` +
    `This teaser is for initial indicative purposes only.`,
    'NEXT STEPS'
  );

  b.footer(1, 1, LENDER_DISC);
  b.save(`${s.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_Lender_Teaser.pdf`);
}

// ─── Lender Memo PDF ──────────────────────────────────────────────────────────
function generateLenderMemo(s: ProjectSummary) {
  const b = new PDFBuilder();
  const ref = s.projectId ? `CREDIT REF: ${s.projectId}` : `CREDIT REF: UKP-${Date.now().toString().slice(-6)}`;
  const name = s.projectName;
  const durationStr = s.projectDurationMonths != null ? `${Math.round(s.projectDurationMonths)} months` : 'N/A';
  const appr = s.rawAppraisal;
  const deal = s.rawDeal;

  // Finance data
  const snap = appr ? (appr.inputs_snapshot as Record<string, unknown>) : {};
  const pp = s.purchasePrice || 0;
  // bridge_ltv is stored as percentage (e.g. 70 = 70%), bridge_rate as monthly % (e.g. 0.65 = 0.65%/mo)
  const bridgeLtvPct = (snap.bridge_ltv as number | undefined) || 70;
  const bridgeRateMonthly = (snap.bridge_rate as number | undefined) || 0.65;
  const arrFeePct = (snap.bridge_arrangement_fee as number | undefined) || 1.5;
  const exitFeePct = (snap.bridge_exit_fee_pct as number | undefined) || 1;
  const loanAmount = pp * (bridgeLtvPct / 100);
  const ltcRatio = s.totalProjectCost && loanAmount ? (loanAmount / s.totalProjectCost) * 100 : null;

  // Page 1: Cover
  b.coverPage(name, 'LENDER CREDIT MEMORANDUM', ref, s);
  b.footer(1, 10, LENDER_DISC);

  // Page 2: Credit Summary
  b.addPage();
  b.pageHeader(`${name}  |  CREDIT SUMMARY`, ref);
  b.sectionTitle('Credit Summary');
  b.highlightBox(
    `Facility Type: ${appr ? 'Bridging / Development Finance' : 'Bridging Loan'}\n` +
    `Loan Amount: ${fmtGBP(loanAmount)}\n` +
    `LTV: ${fmtPct(bridgeLtvPct, 0)}\n` +
    `Loan Term: ${durationStr}\n` +
    `Primary Security: First legal charge over ${s.address}\n` +
    `Repayment: Sale of property at exit (GDV: ${fmtGBP(s.gdv)})`,
    'FACILITY OVERVIEW'
  );
  b.gap(4);
  b.sectionTitle('Key Credit Metrics');
  b.metricsTable([
    { label: 'Purchase Price', value: fmtGBP(pp) },
    { label: 'Total Project Cost', value: fmtGBP(s.totalProjectCost) },
    { label: 'GDV (Exit Value)', value: fmtGBP(s.gdv), highlight: true },
    { label: 'Loan Amount', value: fmtGBP(loanAmount) },
    { label: 'LTV', value: fmtPct(bridgeLtvPct, 0), highlight: true },
    { label: 'LTC', value: ltcRatio != null ? fmtPct(ltcRatio, 0) : 'N/A', highlight: true },
    { label: 'Interest Rate (pa)', value: fmtPct(bridgeRateMonthly * 12) },
    { label: 'Arrangement Fee', value: fmtPct(arrFeePct) },
    { label: 'Exit Fee', value: fmtPct(exitFeePct) },
    { label: 'Loan Term', value: durationStr },
    { label: 'Net Profit (Borrower)', value: fmtGBP(s.netProfitAmount) },
    { label: 'Project Strategy', value: s.strategy },
  ]);
  b.gap(5);
  // LTV visual
  b.sectionTitle('Loan-to-Value Breakdown');
  if (s.gdv && s.gdv > 0) {
    b.ltvBar(loanAmount, s.gdv, 'Senior Loan', 'Equity / Headroom');
  } else if (pp > 0) {
    b.ltvBar(loanAmount, pp, 'Senior Loan', 'Equity / Headroom');
  }
  b.footer(2, 10, LENDER_DISC);

  // Page 3: Borrower & Project Overview
  b.addPage();
  b.pageHeader(`${name}  |  PROJECT OVERVIEW`, ref);
  b.sectionTitle('Project Overview');
  b.bodyText(
    `The borrower is seeking ${appr ? 'bridging and/or development finance' : 'a bridging facility'} to ` +
    `fund the acquisition and ${s.strategy.toLowerCase()} of the property at ${s.address}. ` +
    `The project is planned over ${durationStr}, with exit via ${s.exitStrategy.toLowerCase()} ` +
    `generating sufficient proceeds to fully repay the loan facility.`
  );
  b.gap(3);
  b.sectionTitle('Project Feasibility');
  b.bullet(`Purchase price: ${fmtGBP(pp)} — sourced from market / auction`);
  b.bullet(`Total project cost: ${fmtGBP(s.totalProjectCost)} — acquisition, works, finance and exit costs`);
  b.bullet(`GDV: ${fmtGBP(s.gdv)} — supported by comparable evidence`);
  b.bullet(`Net profit: ${fmtGBP(s.netProfitAmount)} (${fmtPct(s.netProfitPercent)}) providing comfort above loan`);
  b.bullet(`Loan of ${fmtGBP(loanAmount)} represents ${fmtPct(bridgeLtvPct, 0)} of purchase price`);
  b.gap(4);
  b.sectionTitle('Borrower Profile');
  b.bodyText(
    'The borrower is an experienced property developer/investor with a track record of delivering ' +
    'comparable projects on time and within budget. References and case studies are available on request. ' +
    'Full borrower information pack including personal financial statement, CV, and previous project history ' +
    'will be provided as part of the full credit application.'
  );
  b.footer(3, 10, LENDER_DISC);

  // Page 4: Security Analysis
  b.addPage();
  b.pageHeader(`${name}  |  SECURITY ANALYSIS`, ref);
  b.sectionTitle('Primary Security');
  b.bodyText(`First legal charge over the freehold / leasehold interest in the property at: ${s.address}.`);
  b.gap(3);
  b.sectionTitle('Valuation');
  b.metricsTable([
    { label: 'Purchase Price', value: fmtGBP(pp) },
    { label: 'Day-1 Open Market Value', value: 'Per independent RICS valuation' },
    { label: 'Gross Development Value', value: fmtGBP(s.gdv) },
    { label: 'LTV (Day 1)', value: fmtPct(bridgeLtvPct, 0) },
    { label: 'LTGDV', value: s.gdv && loanAmount ? fmtPct((loanAmount / s.gdv) * 100, 0) : 'N/A', highlight: true },
  ]);
  b.gap(4);
  b.sectionTitle('Title & Planning');
  b.bullet('Title is registered at HM Land Registry — title register and plan to be provided');
  b.bullet('No adverse entries or restrictions on title (to be confirmed by solicitors)');
  b.bullet('Planning — status to be confirmed; any consents to be included in legal charge');
  b.bullet('Building warranty / professional indemnity insurance to be maintained throughout');
  b.gap(4);
  b.sectionTitle('Additional Security (Where Available)');
  b.bullet('Personal guarantee from principal borrower');
  b.bullet('Debenture / floating charge over borrower entity (if SPV)');
  b.bullet('Assignment of building contract and professional appointments');
  b.bullet('Assignment of sale contracts / development agreement at exit');
  b.footer(4, 10, LENDER_DISC);

  // Page 5: Financial Model
  b.addPage();
  b.pageHeader(`${name}  |  FINANCIAL MODEL`, ref);
  b.sectionTitle('Development Appraisal Summary');
  const exitNet = (s.gdv || 0) * 0.97 - 1500;
  b.dataTable(
    ['Item', 'Amount', 'Basis'],
    [
      ['Purchase Price', fmtGBP(pp), 'Agreed price'],
      ['Acquisition Costs (SDLT, Legal, Survey)', fmtGBP(deal ? (deal.sdlt / 100 + (parseFloat(deal.form_snapshot.legalFees) || 1500) + (parseFloat(deal.form_snapshot.survey) || 500)) : 0), 'Per deal inputs'],
      ['Works / Refurb Budget', fmtGBP(deal ? parseFloat(deal.form_snapshot.refurbBudget) || 0 : null), 'Contractor quotes'],
      ['Finance Costs', fmtGBP(loanAmount * (bridgeRateMonthly / 100) * (s.projectDurationMonths || 12)), 'Interest at ' + fmtPct(bridgeRateMonthly * 12) + ' pa'],
      ['Arrangement + Exit Fees', fmtGBP(loanAmount * ((arrFeePct + exitFeePct) / 100)), 'On loan amount'],
      ['TOTAL PROJECT COST', fmtGBP(s.totalProjectCost), 'All-in cost'],
      ['GDV (Sales Proceeds)', fmtGBP(s.gdv), 'Comparable evidence'],
      ['Less Agent / Legal Exit', fmtGBP((s.gdv || 0) * 0.02 + 1500), 'Est. 2% + £1,500'],
      ['NET SALE PROCEEDS', fmtGBP(exitNet), ''],
      ['NET PROFIT', fmtGBP(s.netProfitAmount), fmtPct(s.netProfitPercent) + ' margin'],
    ],
    [90, 48, 36]
  );
  b.gap(5);
  // Waterfall: cost build-up to GDV
  b.sectionTitle('Cost Build-up vs. Exit Proceeds');
  {
    const worksEst = Math.max((s.totalProjectCost || 0) - pp, 0);
    const profit = s.netProfitAmount || 0;
    const gdvVal = s.gdv || (s.totalProjectCost || 0) + profit;
    b.waterfallChart([
      { label: 'Purchase Price', value: pp, color: [8, 22, 42] },
      { label: 'Works & Costs', value: worksEst, color: [58, 120, 184] },
      { label: 'Net Profit', value: profit, color: [35, 155, 85] },
    ], { label: 'GDV / Exit', value: gdvVal }, 44);
  }
  b.footer(5, 10, LENDER_DISC);

  // Page 6: Repayment Analysis
  b.addPage();
  b.pageHeader(`${name}  |  REPAYMENT ANALYSIS`, ref);
  b.sectionTitle('Repayment Structure');
  b.bodyText(
    `The loan will be repaid in full from the proceeds of the exit sale / refinance at the end of the project. ` +
    `Interest is rolled up during the loan term and deducted from gross sale proceeds at redemption.`
  );
  b.gap(3);
  const totalInterest = loanAmount * (bridgeRateMonthly / 100) * (s.projectDurationMonths || 12);
  const totalFees = loanAmount * ((arrFeePct + exitFeePct) / 100);
  const totalLoanCost = loanAmount + totalInterest + totalFees;
  b.metricsTable([
    { label: 'Loan Amount', value: fmtGBP(loanAmount) },
    { label: 'Interest (rolled-up, est.)', value: fmtGBP(totalInterest) },
    { label: 'Arrangement + Exit Fees', value: fmtGBP(totalFees) },
    { label: 'Total Loan Cost', value: fmtGBP(totalLoanCost) },
    { label: 'GDV (Exit)', value: fmtGBP(s.gdv), highlight: true },
    { label: 'Loan Repayment Coverage', value: s.gdv ? fmtPct((s.gdv / totalLoanCost) * 100, 0) : 'N/A', highlight: true },
  ]);
  b.gap(4);
  b.sectionTitle('Repayment Timeline');
  b.bullet(`Loan drawdown: Month 0 (at acquisition)`);
  b.bullet(`Project programme: ${durationStr}`);
  b.bullet(`Planned exit / repayment: End of programme`);
  b.bullet(`Contingency extension: Up to 3 months (per facility terms)`);
  // Loan vs GDV coverage visual
  if (s.gdv && s.gdv > 0) {
    b.gap(4);
    b.sectionTitle('Loan Cost vs. GDV Coverage');
    b.ltvBar(totalLoanCost, s.gdv, 'Total Loan Cost', 'Lender Headroom');
  }
  b.footer(6, 10, LENDER_DISC);

  // Page 7: Stress Testing
  b.addPage();
  b.pageHeader(`${name}  |  STRESS TESTING`, ref);
  b.sectionTitle('Downside Stress Scenarios');
  b.bodyText('The table below illustrates loan repayment coverage under stressed GDV scenarios:');
  b.gap(3);
  if (s.gdv) {
    const rows = [-20, -15, -10, -5, 0].map(pctD => {
      const stressGDV = s.gdv! * (1 + pctD / 100);
      const coverage = (stressGDV / totalLoanCost) * 100;
      const headroom = stressGDV - totalLoanCost;
      return [
        `${pctD}% GDV`,
        fmtGBP(stressGDV),
        fmtGBP(totalLoanCost),
        fmtGBP(headroom),
        fmtPct(coverage, 0),
        coverage >= 110 ? 'PASS' : coverage >= 100 ? 'MARGINAL' : 'FAIL',
      ];
    });
    b.dataTable(
      ['Scenario', 'GDV (£)', 'Loan Cost (£)', 'Headroom (£)', 'Coverage', 'Status'],
      rows,
      [30, 36, 36, 36, 24, 22]
    );
    b.gap(4);
    b.sectionTitle('Coverage Ratio by Scenario');
    b.coverageHBars(
      [-20, -15, -10, -5, 0].map(pctD => ({
        label: `GDV ${pctD}%`,
        coverage: (s.gdv! * (1 + pctD / 100) / totalLoanCost) * 100,
        isBase: pctD === 0,
      }))
    );
  }
  b.gap(4);
  b.sectionTitle('Break-Even Analysis');
  if (s.gdv && totalLoanCost) {
    const breakEvenPct = ((s.gdv - totalLoanCost) / s.gdv) * 100;
    b.bodyText(
      `The GDV can fall by up to ${fmtPct(breakEvenPct, 1)} from the base case before the loan is impaired. ` +
      `Break-even GDV is ${fmtGBP(totalLoanCost + 1500)}, representing ${fmtPct((totalLoanCost / s.gdv) * 100, 0)} of base GDV.`
    );
  }
  b.gap(4);
  b.sectionTitle('Programme Overrun Stress');
  b.bullet('3-month extension: Additional interest cost of ' + fmtGBP(loanAmount * (bridgeRateMonthly / 100) * 3));
  b.bullet('6-month extension: Additional interest cost of ' + fmtGBP(loanAmount * (bridgeRateMonthly / 100) * 6));
  b.bullet('Default interest provisions and step-in rights protect lender position');
  b.footer(7, 10, LENDER_DISC);

  // Page 8: Risk Register
  b.addPage();
  b.pageHeader(`${name}  |  CREDIT RISK REGISTER`, ref);
  b.sectionTitle('Credit Risk Assessment');
  b.dataTable(
    ['Risk', 'Probability', 'Impact', 'Mitigation', 'Residual'],
    [
      ['GDV shortfall', 'Low-Medium', 'High', 'Conservative GDV; strong comps', 'Low-Medium'],
      ['Cost overrun', 'Medium', 'Medium', 'Fixed-price contract; contingency', 'Low'],
      ['Programme delay', 'Low-Medium', 'Medium', 'Experienced contractor; ext. option', 'Low'],
      ['Borrower default', 'Low', 'High', 'First charge; PG; step-in rights', 'Low'],
      ['Title defect', 'Very Low', 'High', 'Solicitor report; title insurance', 'Very Low'],
      ['Market decline', 'Low-Medium', 'High', 'LTV buffer; stress tested to -20%', 'Low-Medium'],
      ['Interest rate rise', 'Low', 'Low', 'Fixed-rate facility assumed', 'Very Low'],
    ],
    [38, 25, 20, 48, 22]
  );
  b.footer(8, 10, LENDER_DISC);

  // Page 9-10: Conditions & Covenants
  b.addPage();
  b.pageHeader(`${name}  |  CONDITIONS & COVENANTS`, ref);
  b.sectionTitle('Proposed Facility Conditions');
  const conditions = [
    'Independent RICS valuation confirming day-1 and GDV values',
    'Solicitor\'s title report confirming good and marketable title',
    'Evidence of planning permission (if required for proposed works)',
    'Fixed-price building contract or detailed schedule of works with QS sign-off',
    'Personal guarantee from principal directors/shareholders',
    'Evidence of professional indemnity and public liability insurance',
    'Borrower to demonstrate equivalent liquidity/net worth for equity injection',
    'Opening of a dedicated project account for loan drawdown proceeds',
  ];
  conditions.forEach(c => b.bullet(c));
  b.gap(4);
  b.sectionTitle('Ongoing Covenants');
  const covenants = [
    'Monthly progress reports with photographic evidence',
    'QS sign-off on each drawdown request (where applicable)',
    'Immediate notification of material delays or cost overruns',
    'Lender retains right to appoint monitoring surveyor at borrower cost',
    'No material change to project without lender consent',
    'Property to be maintained in good condition throughout the term',
  ];
  covenants.forEach(c => b.bullet(c));
  b.footer(9, 10, LENDER_DISC);

  // Page 11: Disclaimer
  b.addPage();
  b.pageHeader(`${name}  |  IMPORTANT NOTICES`, ref);
  b.sectionTitle('Disclaimer & Legal Notices');
  b.bodyText(
    'This Lender Credit Memorandum has been prepared by the borrower / project sponsor for information purposes ' +
    'only. It does not constitute a formal credit application or create any binding obligation on either party. ' +
    'All financial projections are estimates based on assumptions that may prove incorrect.'
  );
  b.gap(3);
  b.bodyText(
    'Lenders should conduct their own independent due diligence including commissioning independent valuation ' +
    'and legal reports before making any lending decision. Security is subject to independent valuation and ' +
    'legal confirmation of good title.'
  );
  b.gap(3);
  b.bodyText(`Document prepared: ${today()}  |  Reference: ${ref}`);
  b.footer(10, 10, LENDER_DISC);

  b.save(`${name.replace(/[^a-zA-Z0-9]/g, '_')}_Lender_Memo.pdf`);
}

// ─── XLSX Spreadsheet Export ──────────────────────────────────────────────────
function exportSpreadsheet(s: ProjectSummary) {
  const wb = XLSX.utils.book_new();

  const deal = s.rawDeal;
  const appr = s.rawAppraisal;

  // Helper: create a sheet from array-of-arrays, set col widths, append to workbook
  const makeSheet = (name: string, data: unknown[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = data[0].map(() => ({ wch: 30 }));
    XLSX.utils.book_append_sheet(wb, ws, name);
    return ws;
  };

  // ── 1. Inputs — raw values used by formulas on other sheets ────────────
  // Row 1 = header, data starts at row 2  →  B2, B3, B4 …
  const inputsData: unknown[][] = [['Input', 'Value', 'Description']];
  if (appr) {
    const snap = appr.inputs_snapshot as Record<string, unknown>;
    const summary = (snap.__summary as Record<string, number | null>) || {};
    inputsData.push(
      ['Purchase Price',          typeof snap.purchase_price === 'number' ? snap.purchase_price : 0,  '£'],              // B2
      ['Legal Fees (Purchase)',    typeof snap.legal_purchase === 'number' ? snap.legal_purchase : 0,  '£'],              // B3
      ['SDLT',                    summary.projectCost ? (s.totalProjectCost || 0) * 0 : 0,            'From calc engine'],// B4 placeholder
      ['CIL',                     (snap.cil_total as number) || 0,                                     '£'],             // B5
      ['S106',                    (snap.s106 as number) || 0,                                          '£'],             // B6
      ['Planning Fees',           (snap.planning_fees as number) || 0,                                 '£'],             // B7
      ['Refurb Rate /m²',         (snap.refurb_rate_per_m2 as number) || 0,                            '£/m²'],          // B8
      ['New Build Rate /m²',      (snap.newbuild_rate_per_m2 as number) || 0,                          '£/m²'],          // B9
      ['Existing GIA (m²)',       (snap.existing_gia_m2 as number) || 0,                               'm²'],            // B10
      ['Additional GIA (m²)',     (snap.gia_m2 as number) || 0,                                        'm²'],            // B11
      ['External Works',          (snap.external_works as number) || 0,                                '£'],             // B12
      ['Contingency %',           (snap.contingency_pct as number) || 0,                               '%'],             // B13
      ['Prelims %',               (snap.prelims_pct as number) || 0,                                   '%'],             // B14
      ['Bridge LTV %',            (snap.bridge_ltv as number) || 0,                                    '%'],             // B15
      ['Bridge Rate (monthly %)', (snap.bridge_rate as number) || 0,                                   '%/mo'],          // B16
      ['Bridge Arrangement Fee %',(snap.bridge_arrangement_fee as number) || 0,                        '%'],             // B17
      ['Bridge Exit Fee %',       (snap.bridge_exit_fee_pct as number) || 0,                           '%'],             // B18
      ['Dev Loan % of Works',     (snap.dev_loan_pct as number) || 0,                                  '%'],             // B19
      ['Dev Finance Rate (pa %)', (snap.dev_finance_rate as number) || 0,                              '%/yr'],          // B20
      ['Dev Arrangement Fee %',   (snap.dev_arrangement_fee as number) || 0,                           '%'],             // B21
      ['Project Duration (months)',(snap.project_duration_months as number) || 12,                     'months'],        // B22
      ['GDV',                     (snap.gdv as number) || (s.gdv || 0),                                '£'],             // B23
      ['Agent Fee %',             2,                                                                    '%'],             // B24
      ['Legal Fees (Sale)',       1500,                                                                 '£'],             // B25
      ['Equity Required',         s.equityRequired || 0,                                               '£'],             // B26
      ['IRR %',                   s.irr != null ? s.irr / 100 : '',                                    'decimal'],       // B27
      ['Deal Score',              s.dealScore ?? '',                                                    '/10'],           // B28
    );
  } else if (deal) {
    const fs = deal.form_snapshot;
    inputsData.push(
      ['Purchase Price',          parseFloat(fs.guidePrice) || 0,                                      '£'],             // B2
      ['Legal Fees (Purchase)',   (parseFloat(fs.guidePrice) || 0) * 0.0119,                           '£ (1.19% of PP)'],// B3
      ['SDLT',                    deal.sdlt / 100,                                                     '£'],             // B4
      ['Survey',                  parseFloat(fs.survey) || 0,                                          '£'],             // B5
      ['Refurb Budget',           parseFloat(fs.refurbBudget) || 0,                                    '£'],             // B6
      ['Contingency %',           10,                                                                   '%'],             // B7
      ['Holding Period (years)',   deal.holding_period_years || 5,                                      'years'],         // B8
      ['GDV / Resale',            parseFloat(fs.resaleValue) || 0,                                     '£'],             // B9
      ['Agent Fee %',             2,                                                                    '%'],             // B10
      ['Legal Fees (Sale)',       1500,                                                                 '£'],             // B11
      ['Equity Required',         s.equityRequired || 0,                                               '£'],             // B12
      ['IRR %',                   s.irr != null ? s.irr / 100 : '',                                    'decimal'],       // B13
      ['Deal Score',              s.dealScore ?? '',                                                    '/10'],           // B14
    );
  }
  makeSheet('Inputs', inputsData);

  // ── 2. Acquisition Costs (with formulas) ────────────────────────────────
  if (appr) {
    makeSheet('Acquisition Costs', [
      ['Item', 'Amount (£)', 'Formula / Notes'],
      ['Purchase Price',       { t: 'n', f: 'Inputs!B2' },         '= Inputs!B2'],
      ['Legal Fees (Purchase)',{ t: 'n', f: 'Inputs!B3' },         '= Inputs!B3'],
      ['SDLT',                 { t: 'n', f: 'Inputs!B4' },         '= Inputs!B4'],
      ['CIL',                  { t: 'n', f: 'Inputs!B5' },         '= Inputs!B5'],
      ['S106',                 { t: 'n', f: 'Inputs!B6' },         '= Inputs!B6'],
      ['Planning Fees',        { t: 'n', f: 'Inputs!B7' },         '= Inputs!B7'],
      ['Total Acquisition',    { t: 'n', f: 'SUM(B2:B7)' },        '= SUM of items above'],
    ]);
  } else if (deal) {
    makeSheet('Acquisition Costs', [
      ['Item', 'Amount (£)', 'Formula / Notes'],
      ['Purchase Price',       { t: 'n', f: 'Inputs!B2' },         '= Inputs!B2'],
      ['Legal Fees (Purchase)',{ t: 'n', f: 'Inputs!B3' },         '= Inputs!B3'],
      ['SDLT',                 { t: 'n', f: 'Inputs!B4' },         '= Inputs!B4'],
      ['Survey',               { t: 'n', f: 'Inputs!B5' },         '= Inputs!B5'],
      ['Total Acquisition',    { t: 'n', f: 'SUM(B2:B5)' },        '= SUM of items above'],
    ]);
  }

  // ── 3. Works Costs (with formulas) ─────────────────────────────────────
  if (appr) {
    makeSheet('Works Costs', [
      ['Item', 'Amount (£)', 'Formula / Notes'],
      ['Refurb Works',         { t: 'n', f: 'Inputs!B8*Inputs!B10' },                   '= Refurb rate × Existing GIA'],
      ['New Build Works',      { t: 'n', f: 'Inputs!B9*Inputs!B11' },                   '= New build rate × Additional GIA'],
      ['External Works',       { t: 'n', f: 'Inputs!B12' },                              '= Inputs!B12'],
      ['Subtotal Works',       { t: 'n', f: 'SUM(B2:B4)' },                              '= Sum of works items'],
      ['Prelims',              { t: 'n', f: 'B5*(Inputs!B14/100)' },                     '= Subtotal × Prelims %'],
      ['Contingency',          { t: 'n', f: 'B5*(Inputs!B13/100)' },                     '= Subtotal × Contingency %'],
      ['Total Works Cost',     { t: 'n', f: 'B5+B6+B7' },                                '= Subtotal + Prelims + Contingency'],
    ]);
  } else if (deal) {
    makeSheet('Works Costs', [
      ['Item', 'Amount (£)', 'Formula / Notes'],
      ['Refurb Budget',        { t: 'n', f: 'Inputs!B6' },                               '= Inputs!B6'],
      ['Contingency',          { t: 'n', f: 'B2*(Inputs!B7/100)' },                      '= Refurb × Contingency %'],
      ['Total Works Cost',     { t: 'n', f: 'B2+B3' },                                   '= Refurb + Contingency'],
    ]);
  }

  // ── 4. Finance Costs (with formulas) ───────────────────────────────────
  if (appr) {
    makeSheet('Finance Costs', [
      ['Item', 'Amount (£)', 'Formula / Notes'],
      ['Bridge Loan Amount',     { t: 'n', f: 'Inputs!B2*(Inputs!B15/100)' },                                '= Purchase Price × Bridge LTV %'],
      ['Bridge Interest',        { t: 'n', f: 'B2*(Inputs!B16/100)*Inputs!B22' },                            '= Bridge Loan × Monthly Rate × Months'],
      ['Bridge Arrangement Fee', { t: 'n', f: 'B2*(Inputs!B17/100)' },                                       '= Bridge Loan × Arrangement Fee %'],
      ['Bridge Exit Fee',        { t: 'n', f: 'B2*(Inputs!B18/100)' },                                       '= Bridge Loan × Exit Fee %'],
      ['Dev Loan Amount',        { t: 'n', f: '\'Works Costs\'!B8*(Inputs!B19/100)' },                       '= Total Works × Dev Loan %'],
      ['Dev Interest',           { t: 'n', f: 'B6*(Inputs!B20/100)*(Inputs!B22/12)' },                       '= Dev Loan × Annual Rate × (Months/12)'],
      ['Dev Arrangement Fee',    { t: 'n', f: 'B6*(Inputs!B21/100)' },                                       '= Dev Loan × Arrangement Fee %'],
      ['Total Finance Costs',    { t: 'n', f: 'B3+B4+B5+B7+B8' },                                           '= Sum of interest + fees (excl. loan principal)'],
    ]);
  } else if (deal) {
    makeSheet('Finance Costs', [
      ['Item', 'Amount (£)', 'Formula / Notes'],
      ['Loan Amount (65% LTV)', { t: 'n', f: 'Inputs!B2*0.65' },                                            '= Purchase Price × 65%'],
      ['Interest (8.5% pa)',    { t: 'n', f: 'B2*0.085*Inputs!B8' },                                        '= Loan × 8.5% × Holding Period (years)'],
      ['Arrangement Fee (2%)',  { t: 'n', f: 'B2*0.02' },                                                    '= Loan × 2%'],
      ['Total Finance Costs',  { t: 'n', f: 'B3+B4' },                                                      '= Interest + Arrangement Fee'],
    ]);
  }

  // ── 5. Exit Costs (with formulas) ──────────────────────────────────────
  const gdvRef = appr ? 'Inputs!B23' : 'Inputs!B9';
  const agentRef = appr ? 'Inputs!B24' : 'Inputs!B10';
  const exitLegalRef = appr ? 'Inputs!B25' : 'Inputs!B11';
  makeSheet('Exit Costs', [
    ['Item', 'Amount (£)', 'Formula / Notes'],
    ['GDV / Exit Sale Price',  { t: 'n', f: gdvRef },                           `= ${gdvRef}`],
    ['Agent Fee',              { t: 'n', f: `B2*(${agentRef}/100)` },            `= GDV × Agent Fee %`],
    ['Legal Fees (Sale)',      { t: 'n', f: exitLegalRef },                      `= ${exitLegalRef}`],
    ['Total Exit Costs',       { t: 'n', f: 'B3+B4' },                           '= Agent Fee + Legal'],
    ['Net Sale Proceeds',      { t: 'n', f: 'B2-B5' },                           '= GDV − Exit Costs'],
  ]);

  // ── 6. Profit Analysis (with formulas) ─────────────────────────────────
  makeSheet('Profit Analysis', [
    ['Item', 'Amount (£)', 'Formula / Notes'],
    ['GDV / Exit Value',          { t: 'n', f: `'Exit Costs'!B2` },                                  '= GDV from Exit Costs'],
    ['Less: Exit Costs',          { t: 'n', f: `-'Exit Costs'!B5` },                                 '= − Total Exit Costs'],
    ['Net Sale Proceeds',         { t: 'n', f: 'B2+B3' },                                            '= GDV + (−Exit Costs)'],
    ['Less: Acquisition Costs',   { t: 'n', f: `-'Acquisition Costs'!B${appr ? 8 : 6}` },            '= − Total Acquisition'],
    ['Less: Works Costs',         { t: 'n', f: `-'Works Costs'!B${appr ? 8 : 4}` },                  '= − Total Works'],
    ['Less: Finance Costs',       { t: 'n', f: `-'Finance Costs'!B${appr ? 9 : 5}` },                '= − Total Finance'],
    ['Net Profit',                { t: 'n', f: 'B4+B5+B6+B7' },                                      '= Net Proceeds − All Costs'],
    ['Total Project Cost',        { t: 'n', f: '-(B5+B6+B7)' },                                      '= Acq + Works + Finance'],
    ['Margin on Cost (%)',        { t: 'n', f: 'IF(B9<>0,B8/B9,"")' },                               '= Net Profit / Total Project Cost'],
    ['Margin on GDV (%)',         { t: 'n', f: 'IF(B2<>0,B8/B2,"")' },                               '= Net Profit / GDV'],
  ]);

  // ── 7. Return Metrics (with formulas) ──────────────────────────────────
  const equityRef = appr ? 'Inputs!B26' : 'Inputs!B12';
  const irrRef = appr ? 'Inputs!B27' : 'Inputs!B13';
  const scoreRef = appr ? 'Inputs!B28' : 'Inputs!B14';
  makeSheet('Return Metrics', [
    ['Metric', 'Value', 'Formula / Notes'],
    ['Equity Required (£)',     { t: 'n', f: equityRef },                                              `= ${equityRef}`],
    ['Net Profit (£)',          { t: 'n', f: `'Profit Analysis'!B8` },                                 '= Net Profit from Profit Analysis'],
    ['Margin on Cost (%)',      { t: 'n', f: `'Profit Analysis'!B10` },                                '= From Profit Analysis'],
    ['Equity Multiple (x)',     { t: 'n', f: `IF(B2<>0,(B2+B3)/B2,"")` },                             '= (Equity + Profit) / Equity'],
    ['Equity IRR (%)',          { t: 'n', f: irrRef },                                                 `= ${irrRef}`],
    ['Deal Score',              { t: 'n', f: scoreRef },                                               `= ${scoreRef}`],
    ['GDV (£)',                 { t: 'n', f: `'Exit Costs'!B2` },                                      '= GDV'],
    ['LTGDV (%)',               { t: 'n', f: `IF(B8<>0,B2/B8,"")` },                                  '= Equity / GDV'],
    ['Project Duration (mo)',   { t: 'n', f: appr ? 'Inputs!B22' : '' },                               '= From Inputs'],
  ]);

  // ── 8. Sensitivity — GDV (with formulas) ───────────────────────────────
  const sensData: unknown[][] = [
    ['GDV Variance', 'GDV (£)', 'Net Profit (£)', 'Margin on Cost (%)', 'Notes'],
  ];
  [-20, -15, -10, -5, 0, 5, 10, 15].forEach((d, i) => {
    const row = i + 2; // data rows start at row 2
    sensData.push([
      `${d >= 0 ? '+' : ''}${d}%`,
      { t: 'n', f: `'Exit Costs'!B2*(1+${d}/100)` },
      { t: 'n', f: `B${row}-'Exit Costs'!B5-'Profit Analysis'!B9` },
      { t: 'n', f: `IF('Profit Analysis'!B9<>0,C${row}/'Profit Analysis'!B9,"")` },
      d === 0 ? 'Base Case' : d < -10 ? 'Stressed' : d < 0 ? 'Downside' : 'Upside',
    ]);
  });
  makeSheet('Sensitivity (GDV)', sensData);

  // ── 9. Sensitivity — Cost Overrun (with formulas) ──────────────────────
  const costSensData: unknown[][] = [
    ['Cost Overrun', 'Total Cost (£)', 'Net Profit (£)', 'Margin on Cost (%)', 'Notes'],
  ];
  [0, 5, 10, 15, 20].forEach((d, i) => {
    const row = i + 2;
    costSensData.push([
      `+${d}%`,
      { t: 'n', f: `'Profit Analysis'!B9*(1+${d}/100)` },
      { t: 'n', f: `'Exit Costs'!B6-B${row}` },
      { t: 'n', f: `IF(B${row}<>0,C${row}/B${row},"")` },
      d === 0 ? 'Base Case' : 'Stressed',
    ]);
  });
  makeSheet('Sensitivity (Cost)', costSensData);

  // ── 10. Risk Summary ──────────────────────────────────────────────────
  makeSheet('Risk Summary', [
    ['Risk Category', 'Description', 'Probability', 'Impact', 'Mitigation'],
    ['Market Risk', 'Property values decline, reducing GDV', 'Low-Medium', 'High', 'Conservative GDV assumptions; strong comparable evidence'],
    ['Construction Risk', 'Works overrun on cost or programme', 'Medium', 'Medium', 'Fixed-price contract; QS monitoring; contingency included'],
    ['Planning Risk', 'Consents delayed or refused', 'Low', 'Medium', 'Pre-application advice obtained; fallback use assessed'],
    ['Finance Risk', 'Finance not available or rate increases', 'Low', 'High', 'Terms agreed in principle; fixed-rate facility'],
    ['Sales Risk', 'Exit sale takes longer than projected', 'Low-Medium', 'Medium', 'Marketing starts early; fallback to rental if needed'],
    ['Regulatory Risk', 'Changes to SDLT, CGT or planning policy', 'Low', 'Medium', 'Monitor policy; legal advice obtained'],
    ['Counterparty Risk', 'Contractor, agent or solicitor underperforms', 'Low', 'Medium', 'Experienced team; contractual protections in place'],
    ['Liquidity Risk', 'Capital locked in for project duration', 'Inherent', 'Medium', 'Clear exit timeline; investor aware of illiquid nature'],
  ]);

  // Save
  XLSX.writeFile(wb, `${(s.projectId || s.projectName).replace(/[^a-zA-Z0-9]/g, '_')}_Appraisal_Spreadsheet.xlsx`);
}

// ─── UI Styles ────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: '#071525',
  border: '1px solid #0e2235',
  borderRadius: 8,
  padding: '18px 20px',
  marginBottom: 18,
};

const sectionCard: React.CSSProperties = {
  background: '#060f1e',
  border: '1px solid #0a1e35',
  borderRadius: 10,
  padding: '20px 24px',
  marginBottom: 20,
};

const metricCell: React.CSSProperties = {
  background: '#0a1929',
  border: '1px solid #0e2235',
  borderRadius: 6,
  padding: '10px 14px',
  minWidth: 120,
  flex: '1 1 140px',
};

const btnBase: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '9px 18px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: 0.3,
  transition: 'opacity 0.15s',
};

const btnBlue: React.CSSProperties = { ...btnBase, background: '#1a4a7a', color: '#a8d0f0' };
const btnGreen: React.CSSProperties = { ...btnBase, background: '#0f3a22', color: '#7de8a8' };

// ─── Main Component ───────────────────────────────────────────────────────────
export function ExportPage({ deals, appraisals }: ExportPageProps) {
  const [selectedId, setSelectedId] = useState<string>('');

  const allProjects = useMemo(() => {
    const d = deals.map(deal => ({ id: `deal_${deal.id}`, label: `[Deal] ${deal.deal_name}`, type: 'deal' as const, deal }));
    const a = appraisals.map(ap => ({ id: `appr_${ap.id}`, label: `[Appraisal] ${ap.name}`, type: 'appraisal' as const, appraisal: ap }));
    return [...d, ...a];
  }, [deals, appraisals]);

  const summary = useMemo<ProjectSummary | null>(() => {
    if (!selectedId) return null;
    const found = allProjects.find(p => p.id === selectedId);
    if (!found) return null;
    return found.type === 'deal' ? extractFromDeal(found.deal) : extractFromAppraisal(found.appraisal);
  }, [selectedId, allProjects]);

  const label = (text: string, sub: string) => (
    <div style={metricCell}>
      <div style={{ fontSize: 10, color: '#3a78b8', marginBottom: 3, letterSpacing: 0.3 }}>{text}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#c8e0f8' }}>{sub}</div>
    </div>
  );

  if (allProjects.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#2a5878' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>◈</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#3a6888', marginBottom: 6 }}>No saved projects found</div>
        <div style={{ fontSize: 12, color: '#1e4060' }}>Save a deal or appraisal first, then return here to export.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Page title */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#6ab0e8', letterSpacing: 1, marginBottom: 4 }}>EXPORT & REPORTING</div>
        <div style={{ fontSize: 11, color: '#2a5878' }}>Generate professional investor and lender documents from any saved project.</div>
      </div>

      {/* Project selector */}
      <div style={card}>
        <div style={{ fontSize: 10, color: '#3a78b8', letterSpacing: 1, marginBottom: 8, fontWeight: 600 }}>SELECT PROJECT</div>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          style={{
            width: '100%',
            background: '#040c17',
            border: '1px solid #1a4060',
            borderRadius: 6,
            color: '#b0ccec',
            padding: '9px 12px',
            fontSize: 12,
            fontFamily: 'inherit',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="">— Choose a saved project —</option>
          {allProjects.map(p => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Summary panel */}
      {summary && (
        <>
          <div style={card}>
            <div style={{ fontSize: 10, color: '#3a78b8', letterSpacing: 1, marginBottom: 10, fontWeight: 600 }}>PROJECT SUMMARY</div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#c8e0f8', marginBottom: 2 }}>{summary.projectName}</div>
              <div style={{ fontSize: 11, color: '#2a6a9a' }}>{summary.address}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {label('Strategy', summary.strategy)}
              {label('Purchase Price', fmtGBP(summary.purchasePrice))}
              {label('Total Project Cost', fmtGBP(summary.totalProjectCost))}
              {label('GDV', fmtGBP(summary.gdv))}
              {label('IRR', fmtPct(summary.irr))}
              {label('Equity Required', fmtGBP(summary.equityRequired))}
              {label('Net Profit (£)', fmtGBP(summary.netProfitAmount))}
              {label('Net Profit (%)', fmtPct(summary.netProfitPercent))}
              {summary.dealScore != null && label('Deal Score', `${fmtNum(summary.dealScore, 1)} / 10`)}
              {label('Project Duration', summary.projectDurationMonths != null ? `${Math.round(summary.projectDurationMonths)} months` : 'N/A')}
              {label('Exit Strategy', summary.exitStrategy)}
            </div>
          </div>

          {/* Investor Documents */}
          <div style={sectionCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 3, height: 20, background: '#3a78b8', borderRadius: 2 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6ab0e8', letterSpacing: 0.8 }}>INVESTOR DOCUMENTS</div>
            </div>
            <div style={{ fontSize: 11, color: '#1e4a6a', marginBottom: 14 }}>
              Equity-focused documents highlighting opportunity, returns, and investment thesis.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={btnBlue}
                onClick={() => generateInvestorTeaser(summary)}
              >
                ↓ Generate Investor Teaser
              </button>
              <button
                type="button"
                style={btnBlue}
                onClick={() => generateInvestorMemo(summary)}
              >
                ↓ Generate Investor Memo
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#163050', marginTop: 8 }}>
              Teaser: 1-page PDF summary. Memo: 12-page PDF with full investment analysis, sensitivity, risk register and exit strategy.
            </div>
          </div>

          {/* Lender Documents */}
          <div style={sectionCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 3, height: 20, background: '#2a8a5a', borderRadius: 2 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#5adaaa', letterSpacing: 0.8 }}>LENDER DOCUMENTS</div>
            </div>
            <div style={{ fontSize: 11, color: '#1a4a3a', marginBottom: 14 }}>
              Credit-focused documents highlighting security, repayment, and loan structure.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...btnBase, background: '#0a3222', color: '#7de8a8' }}
                onClick={() => generateLenderTeaser(summary)}
              >
                ↓ Generate Lender Teaser
              </button>
              <button
                type="button"
                style={{ ...btnBase, background: '#0a3222', color: '#7de8a8' }}
                onClick={() => generateLenderMemo(summary)}
              >
                ↓ Generate Lender Memo
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#0f3028', marginTop: 8 }}>
              Teaser: 1-page credit summary. Memo: 10-page PDF with security analysis, financial model, stress testing and risk register.
            </div>
          </div>

          {/* Appraisal Spreadsheet */}
          <div style={sectionCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 3, height: 20, background: '#8a6a2a', borderRadius: 2 }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e8c85a', letterSpacing: 0.8 }}>APPRAISAL SPREADSHEET</div>
            </div>
            <div style={{ fontSize: 11, color: '#4a3a1a', marginBottom: 14 }}>
              Full XLSX workbook with acquisition costs, works, finance, exit costs, profit analysis, return metrics, sensitivity and risk summary.
            </div>
            <div>
              <button
                type="button"
                style={{ ...btnBase, background: '#2a2010', color: '#e8c85a' }}
                onClick={() => exportSpreadsheet(summary)}
              >
                ↓ Export Appraisal Spreadsheet (.xlsx)
              </button>
            </div>
            <div style={{ fontSize: 10, color: '#2a2010', marginTop: 8 }}>
              Exports 9 sheets: Summary · Acquisition Costs · Works Costs · Finance Costs · Exit Costs · Profit Analysis · Return Metrics · Sensitivity Analysis · Risk Summary
            </div>
          </div>
        </>
      )}

      {!summary && allProjects.length > 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#1a3a5a' }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>↑</div>
          <div style={{ fontSize: 12 }}>Select a project above to generate export documents.</div>
        </div>
      )}
    </div>
  );
}
