import { jsPDF } from 'jspdf';
import type { Project, EligibilityAssessment, FinancialAppraisal } from '../types';
import { CLASS_MA_AXES, SCENARIO_COLORS, type SpiderResult } from './deal-spider';

function formatPence(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

export function buildEligibilityContent(project: Project, assessment: EligibilityAssessment): string[] {
  const lines: string[] = [];
  lines.push('PDR ELIGIBILITY REPORT');
  lines.push('');
  lines.push(`Property: ${project.address_raw}`);
  lines.push(`Postcode: ${project.address_postcode || 'N/A'}`);
  lines.push(`Use Class: ${project.use_class.replace(/_/g, ' ')}`);
  lines.push(`Price: ${formatPence(project.price_pence)}`);
  lines.push(`Floor Area: ${project.floor_area_sqm ? `${project.floor_area_sqm} m²` : 'N/A'}`);
  lines.push('');
  lines.push(`PDR Class: ${assessment.pdr_class.replace(/_/g, ' ').toUpperCase()}`);
  lines.push(`Verdict: ${assessment.verdict.toUpperCase()}`);
  lines.push('');
  lines.push('CRITERIA:');
  for (const c of assessment.criteria) {
    const status = c.passed === true ? 'PASS' : c.passed === false ? 'FAIL' : 'PENDING';
    lines.push(`  [${status}] ${c.label}${c.value ? ` (${c.value})` : ''}`);
  }
  if (assessment.suggested_next_steps.length > 0) {
    lines.push('');
    lines.push('SUGGESTED NEXT STEPS:');
    for (const step of assessment.suggested_next_steps) {
      lines.push(`  - ${step}`);
    }
  }
  lines.push('');
  lines.push(`Report generated: ${new Date().toLocaleDateString('en-GB')}`);
  return lines;
}

export function buildAppraisalContent(project: Project, appraisal: FinancialAppraisal): string[] {
  const lines: string[] = [];
  lines.push('FINANCIAL APPRAISAL SUMMARY');
  lines.push('');
  lines.push(`Property: ${project.address_raw}`);
  lines.push(`Appraisal: ${appraisal.name}`);
  lines.push('');
  lines.push('KEY METRICS:');
  lines.push(`  GDV: ${appraisal.gdv_pence ? formatPence(appraisal.gdv_pence) : 'N/A'}`);
  lines.push(`  Total Cost: ${appraisal.total_cost_pence ? formatPence(appraisal.total_cost_pence) : 'N/A'}`);
  lines.push(`  Profit on Cost: ${appraisal.profit_on_cost_pct != null ? formatPct(appraisal.profit_on_cost_pct) : 'N/A'}`);
  lines.push(`  Profit on GDV: ${appraisal.profit_on_gdv_pct != null ? formatPct(appraisal.profit_on_gdv_pct) : 'N/A'}`);
  lines.push(`  Return on Equity: ${appraisal.return_on_equity_pct != null ? formatPct(appraisal.return_on_equity_pct) : 'N/A'}`);
  lines.push(`  IRR: ${appraisal.irr != null ? formatPct(appraisal.irr) : 'N/A'}`);
  lines.push(`  Residual Land Value: ${appraisal.rlv_pence ? formatPence(appraisal.rlv_pence) : 'N/A'}`);
  lines.push('');
  lines.push(`Report generated: ${new Date().toLocaleDateString('en-GB')}`);
  return lines;
}

export function generateEligibilityPdf(project: Project, assessment: EligibilityAssessment): Blob {
  const doc = new jsPDF();
  const lines = buildEligibilityContent(project, assessment);
  let y = 20;
  for (const line of lines) {
    if (line === '') {
      y += 6;
      continue;
    }
    const isHeader = line === line.toUpperCase() && line.length > 3 && !line.startsWith(' ');
    doc.setFontSize(isHeader ? 14 : 11);
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    doc.text(line, 15, y);
    y += isHeader ? 8 : 6;
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  }
  return doc.output('blob');
}

export function buildSpiderContent(result: SpiderResult): string[] {
  const lines: string[] = [];
  lines.push('DEAL SPIDER — CLASS MA RISK PROFILE');
  lines.push('');

  if (result.blocked) {
    lines.push('VERDICT: BLOCKED — CLASS MA NOT AVAILABLE');
    lines.push(`  Failing check(s): ${result.blockedBy.join('; ')}`);
    lines.push('  The eligibility gate outranks the score — no deal score is reported.');
  } else {
    lines.push(`Overall: ${result.overall!.toFixed(1)}/5 — RAG: ${result.rag.toUpperCase()}`);
  }
  lines.push('');

  lines.push('AXIS SCORES:');
  for (const axis of result.axes) {
    const marker = axis.provisional ? ' †provisional' : '';
    lines.push(
      `  ${axis.short}: raw ${axis.raw.toFixed(1)} ${axis.unit} -> score ${axis.score.toFixed(1)}/5 x weight ${axis.weight} = ${axis.weighted.toFixed(1)}${marker}`,
    );
  }

  if (result.caveats.length > 0) {
    lines.push('');
    lines.push('PROVISIONAL — UNVERIFIED INPUTS:');
    for (const caveat of result.caveats) {
      lines.push(`  † ${caveat}`);
    }
  }
  return lines;
}

// Last unwatermarked path to pre-correction numbers: a record with status !==
// 'reconciled' (including undefined/legacy, e.g. a legacy_unreconciled row)
// must never render lender-ready. Same text/style as export-investment-memo.ts's
// draft watermark, kept local since this file's manual text layout (no
// autoTable) doesn't share that module's page-tracking machinery.
const DRAFT_WATERMARK_TEXT = 'DRAFT - UNRECONCILED - NOT FOR LENDER RELIANCE';

function drawDraftWatermark(doc: jsPDF): void {
  doc.setTextColor(200);
  doc.setFontSize(40);
  doc.setFont('helvetica', 'bold');
  doc.text(DRAFT_WATERMARK_TEXT, 105, 160, { angle: 35, align: 'center' });
  doc.setTextColor(0, 0, 0);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Draw the radar as vector graphics centred at (cx, cy) with radius r (mm). */
function drawSpiderRadar(doc: jsPDF, result: SpiderResult, cx: number, cy: number, r: number): void {
  const n = result.axes.length;
  const angle = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt = (i: number, score: number): [number, number] => {
    const a = angle(i);
    const d = (score / 5) * r;
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)];
  };

  // Rings and spokes
  doc.setDrawColor(200, 208, 218);
  doc.setLineWidth(0.15);
  for (let ring = 1; ring <= 5; ring++) {
    const pts = result.axes.map((_, i) => pt(i, ring));
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      doc.line(x1, y1, x2, y2);
    }
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, 5);
    doc.line(cx, cy, x, y);
  }

  // Base polygon
  const [br, bg, bb] = hexToRgb(SCENARIO_COLORS.base);
  doc.setDrawColor(br, bg, bb);
  doc.setLineWidth(0.5);
  const scorePts = result.axes.map((a, i) => pt(i, a.score));
  for (let i = 0; i < n; i++) {
    const [x1, y1] = scorePts[i];
    const [x2, y2] = scorePts[(i + 1) % n];
    doc.line(x1, y1, x2, y2);
  }
  doc.setFillColor(br, bg, bb);
  for (const [x, y] of scorePts) {
    doc.circle(x, y, 0.7, 'F');
  }

  // Axis labels
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90, 100, 112);
  result.axes.forEach((a, i) => {
    const ang = angle(i);
    const lx = cx + (r + 7) * Math.cos(ang);
    const ly = cy + (r + 7) * Math.sin(ang);
    const label = a.short + (a.provisional ? ' †' : '') + ` ${a.score.toFixed(1)}`;
    doc.text(label, lx, ly, { align: 'center' });
  });

  // Centre score
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  if (result.blocked) {
    doc.setTextColor(220, 60, 60);
    doc.text('BLOCKED', cx, cy + 1.5, { align: 'center' });
  } else {
    doc.setTextColor(50, 60, 72);
    doc.text(`${result.overall!.toFixed(1)}/5`, cx, cy + 1.5, { align: 'center' });
  }
  doc.setTextColor(0, 0, 0);
}

export function generateAppraisalPdf(
  project: Project,
  appraisal: FinancialAppraisal,
  spider?: SpiderResult,
): Blob {
  const doc = new jsPDF();
  // Gate: any status other than 'reconciled' — including undefined (pre-status
  // legacy rows) and 'legacy_unreconciled' — is a draft and must never look
  // lender-ready when printed.
  const isDraft = appraisal.status !== 'reconciled';
  const newPage = (): void => {
    doc.addPage();
    if (isDraft) drawDraftWatermark(doc);
  };
  if (isDraft) drawDraftWatermark(doc);

  const lines = buildAppraisalContent(project, appraisal);
  let y = 20;
  for (const line of lines) {
    if (line === '') {
      y += 6;
      continue;
    }
    const isHeader = line === line.toUpperCase() && line.length > 3 && !line.startsWith(' ');
    doc.setFontSize(isHeader ? 14 : 11);
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    doc.text(line, 15, y);
    y += isHeader ? 8 : 6;
    if (y > 270) {
      newPage();
      y = 20;
    }
  }

  if (spider) {
    newPage();
    y = 20;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DEAL SPIDER — CLASS MA RISK PROFILE', 15, y);
    y += 8;

    drawSpiderRadar(doc, spider, 105, y + 55, 45);
    y += 118;

    // Axis table
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    const cols = [15, 55, 95, 125, 150, 175];
    const headers = ['Axis', 'Raw value', 'Score /5', 'Weight', 'Contribution', ''];
    headers.forEach((h, i) => doc.text(h, cols[i], y));
    y += 5;
    doc.setDrawColor(180, 188, 198);
    doc.line(15, y - 3.5, 195, y - 3.5);
    doc.setFont('helvetica', 'normal');
    for (const axis of spider.axes) {
      const def = CLASS_MA_AXES.find((d) => d.id === axis.id);
      doc.text(axis.short + (axis.provisional ? ' †' : ''), cols[0], y);
      doc.text(`${axis.raw.toFixed(1)} ${axis.unit}`, cols[1], y);
      doc.text(axis.score.toFixed(1), cols[2], y);
      doc.text(String(axis.weight), cols[3], y);
      doc.text(axis.weighted.toFixed(1), cols[4], y);
      if (def) {
        doc.setFontSize(6.5);
        doc.setTextColor(120, 128, 138);
        const range = `${def.min}-${def.max}, ${def.direction} better`;
        doc.text(range, cols[5], y);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
      }
      y += 6;
      if (y > 270) {
        newPage();
        y = 20;
      }
    }

    y += 4;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    if (spider.blocked) {
      doc.setTextColor(220, 60, 60);
      doc.text(`BLOCKED — failing check(s): ${spider.blockedBy.join('; ')}`, 15, y);
      doc.setTextColor(0, 0, 0);
      y += 6;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('The eligibility gate outranks the score — no deal score is reported.', 15, y);
      y += 6;
    } else {
      doc.text(`Overall: ${spider.overall!.toFixed(1)}/5 — RAG: ${spider.rag.toUpperCase()}`, 15, y);
      y += 8;
    }

    if (spider.caveats.length > 0) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Provisional — unverified inputs:', 15, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      for (const caveat of spider.caveats) {
        const wrapped = doc.splitTextToSize(`† ${caveat}`, 175) as string[];
        for (const line of wrapped) {
          doc.text(line, 15, y);
          y += 5;
          if (y > 275) {
            newPage();
            y = 20;
          }
        }
      }
    }
  }

  return doc.output('blob');
}
