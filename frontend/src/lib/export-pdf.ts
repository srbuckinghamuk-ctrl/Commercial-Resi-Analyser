import { jsPDF } from 'jspdf';
import type { Project, EligibilityAssessment, FinancialAppraisal } from '../types';

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

export function generateAppraisalPdf(project: Project, appraisal: FinancialAppraisal): Blob {
  const doc = new jsPDF();
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
      doc.addPage();
      y = 20;
    }
  }
  return doc.output('blob');
}
