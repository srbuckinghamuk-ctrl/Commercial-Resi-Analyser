import * as XLSX from 'xlsx';
import type { Project } from '../types';
import { PIPELINE_STAGES } from '../types';
import type { CalculatorInputs, AppraisalMetrics, CashflowResult } from './conversion-types';
import { calculateCommercialSdlt } from './commercial-sdlt';

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatProjectRow(project: Project): Record<string, string | number> {
  const stageLabel = PIPELINE_STAGES.find((s) => s.value === project.stage)?.label ?? titleCase(project.stage);
  return {
    'Address': project.address_raw,
    'Postcode': project.address_postcode || '',
    'Town': project.address_town || '',
    'Price (£)': project.price_pence / 100,
    'Price Qualifier': project.price_qualifier || '',
    'Use Class': titleCase(project.use_class),
    'Floor Area (m²)': project.floor_area_sqm ?? '',
    'Floors': project.floors ?? '',
    'Tenure': titleCase(project.tenure),
    'EPC': project.epc_rating || '',
    'Vacant': project.is_vacant === true ? 'Yes' : project.is_vacant === false ? 'No' : '',
    'Stage': stageLabel,
    'Source': project.source_name || '',
    'Source URL': project.source_url || '',
    'Created': new Date(project.created_at).toLocaleDateString('en-GB'),
  };
}

export function generateProjectsExcel(projects: Project[]): Blob {
  const rows = projects.map(formatProjectRow);
  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = Object.keys(rows[0] || {}).map((key) => ({
    wch: Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length)) + 2,
  }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Projects');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function pounds(pence: number): number {
  return Math.round(pence) / 100;
}

function sheetFromRows(rows: (string | number)[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 42 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  return ws;
}

/**
 * Full appraisal workbook: Summary, Cost Plan, Unit Mix, Cashflow and
 * Assumptions — the format lenders and quantity surveyors ask for.
 */
export function generateAppraisalExcel(
  project: Project,
  inputs: CalculatorInputs,
  metrics: AppraisalMetrics,
  cashflow: CashflowResult,
): Blob {
  const wb = XLSX.utils.book_new();

  // ── Summary ──
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows([
      ['Development Appraisal', ''],
      ['Property', project.address_raw],
      ['Postcode', project.address_postcode ?? ''],
      ['Use class', titleCase(project.use_class)],
      ['', ''],
      ['Gross Development Value (£)', pounds(metrics.total_gdv_pence)],
      ['Total development cost (£)', pounds(metrics.total_cost_pence)],
      ['Profit (£)', pounds(metrics.profit_pence)],
      ['Profit on cost (%)', metrics.profit_on_cost_pct],
      ['Profit on GDV (%)', metrics.profit_on_gdv_pct],
      ['Return on equity (%)', metrics.return_on_equity_pct],
      ['IRR annual (%)', metrics.irr_annual ?? 'n/a'],
      ['Residual land value (£)', pounds(metrics.rlv_pence)],
      ['', ''],
      ['Loan amount (£)', pounds(metrics.loan_amount_pence)],
      ['Equity required (£)', pounds(metrics.equity_required_pence)],
      ['Peak funding (£)', pounds(cashflow.peak_funding_pence)],
    ]),
    'Summary',
  );

  // ── Cost Plan ──
  const sdlt = calculateCommercialSdlt(inputs.acquisition.purchase_price_pence);
  const brokerFee = Math.round((inputs.acquisition.purchase_price_pence * inputs.acquisition.broker_fee_pct) / 100);
  const baseBuild = inputs.conversion_costs.construction_cost_per_sqm_pence * inputs.conversion_costs.total_construction_sqm;
  const contingency = Math.round((baseBuild * inputs.conversion_costs.contingency_pct) / 100);
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows([
      ['Element', 'Amount (£)'],
      ['ACQUISITION', ''],
      ['Purchase price', pounds(inputs.acquisition.purchase_price_pence)],
      ['SDLT (commercial rates)', pounds(sdlt.total_pence)],
      ['Legal fees', pounds(inputs.acquisition.legal_fees_pence)],
      ['Survey', pounds(inputs.acquisition.survey_cost_pence)],
      [`Broker fee (${inputs.acquisition.broker_fee_pct}%)`, pounds(brokerFee)],
      ['Other acquisition costs', pounds(inputs.acquisition.other_acquisition_costs_pence)],
      ['Sub-total acquisition', pounds(metrics.total_acquisition_cost_pence)],
      ['', ''],
      ['CONSTRUCTION', ''],
      [`Base build (${inputs.conversion_costs.total_construction_sqm} m² @ £${pounds(inputs.conversion_costs.construction_cost_per_sqm_pence)}/m²)`, pounds(baseBuild)],
      [`Contingency (${inputs.conversion_costs.contingency_pct}%)`, pounds(contingency)],
      ['Fire safety', pounds(inputs.conversion_costs.fire_safety_pence)],
      ['Sound insulation', pounds(inputs.conversion_costs.sound_insulation_pence)],
      ['Part L compliance', pounds(inputs.conversion_costs.part_l_compliance_pence)],
      ['Sub-total construction', pounds(metrics.total_construction_cost_pence)],
      ['', ''],
      ['PROFESSIONAL & STATUTORY', ''],
      ['Prior approval fees', pounds(inputs.conversion_costs.prior_approval_fee_per_dwelling_pence * Math.max(1, inputs.unit_mix.units.length))],
      ['CIL / s106', pounds(inputs.conversion_costs.cil_s106_pence)],
      ['Architect', pounds(inputs.conversion_costs.architect_pence)],
      ['Structural engineer', pounds(inputs.conversion_costs.structural_engineer_pence)],
      ['M&E', pounds(inputs.conversion_costs.mande_pence)],
      ['Planning consultant', pounds(inputs.conversion_costs.planning_consultant_pence)],
      ['Building control', pounds(inputs.conversion_costs.building_control_pence)],
      ['Other professional fees', pounds(inputs.conversion_costs.other_professional_fees_pence)],
      ['Sub-total professional fees', pounds(metrics.total_professional_fees_pence)],
      ['', ''],
      ['FINANCE', ''],
      [`Arrangement fee (${inputs.finance.arrangement_fee_pct}%)`, pounds(metrics.arrangement_fee_pence)],
      [`Exit fee (${inputs.finance.exit_fee_pct}%)`, pounds(metrics.exit_fee_pence)],
      [`Interest (${inputs.finance.interest_rate_annual_pct}% p.a., drawdown basis)`, pounds(metrics.total_interest_pence)],
      ['Sub-total finance', pounds(metrics.total_finance_cost_pence)],
      ['', ''],
      ['DISPOSAL', ''],
      ['Selling costs', pounds(metrics.total_selling_costs_pence)],
      ['', ''],
      ['TOTAL DEVELOPMENT COST', pounds(metrics.total_cost_pence)],
    ]),
    'Cost Plan',
  );

  // ── Unit Mix ──
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows([
      ['Unit', 'Type', 'Floor area (m²)', 'Est. value (£)', '£/m²', 'Notes'],
      ...inputs.unit_mix.units.map((u, i): (string | number)[] => [
        `Unit ${i + 1}`,
        titleCase(u.type),
        u.floor_area_sqm,
        pounds(u.estimated_value_pence),
        u.floor_area_sqm > 0 ? Math.round(pounds(u.estimated_value_pence) / u.floor_area_sqm) : '',
        u.comparable_notes,
      ]),
      ['', '', '', '', '', ''],
      ['Total', '', inputs.unit_mix.units.reduce((s, u) => s + u.floor_area_sqm, 0), pounds(metrics.total_gdv_pence), '', ''],
    ]),
    'Unit Mix',
  );

  // ── Cashflow ──
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows([
      ['Month', 'Drawdown (£)', 'Cumulative drawdown (£)', 'Interest (£)', 'Cumulative interest (£)', 'Income (£)', 'Net cashflow (£)', 'Cumulative cashflow (£)'],
      ...cashflow.months.map((m): (string | number)[] => [
        m.label,
        pounds(m.drawdown_pence),
        pounds(m.cumulative_drawdown_pence),
        pounds(m.interest_pence),
        pounds(m.cumulative_interest_pence),
        pounds(m.income_pence),
        pounds(m.net_cashflow_pence),
        pounds(m.cumulative_cashflow_pence),
      ]),
    ]),
    'Cashflow',
  );

  // ── Assumptions ──
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows([
      ['Assumption', 'Value', 'Basis'],
      ['Build cost £/m²', pounds(inputs.conversion_costs.construction_cost_per_sqm_pence), 'Assumption — verify with QS'],
      ['Contingency %', inputs.conversion_costs.contingency_pct, 'Standard allowance'],
      ['Funding source', titleCase(inputs.finance.funding_source), 'Assumed'],
      ['LTC %', inputs.finance.ltv_pct, 'Assumed'],
      ['Interest rate % p.a.', inputs.finance.interest_rate_annual_pct, 'Indicative terms'],
      ['Interest type', titleCase(inputs.finance.interest_type), 'Assumed'],
      ['Loan term (months)', inputs.finance.loan_term_months, 'Assumed programme'],
      ['Arrangement fee %', inputs.finance.arrangement_fee_pct, 'Indicative terms'],
      ['Exit fee %', inputs.finance.exit_fee_pct, 'Indicative terms'],
      ['Selling agent fee %', inputs.exit_strategy.selling_agent_fee_pct, 'Standard'],
      ['Sales legal fee £', pounds(inputs.exit_strategy.selling_legal_fee_pence), 'Estimate'],
      ['RLV target profit', '20% on cost', 'Convention'],
    ]),
    'Assumptions',
  );

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
