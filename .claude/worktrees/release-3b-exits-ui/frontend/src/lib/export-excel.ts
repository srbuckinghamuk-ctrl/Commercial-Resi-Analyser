import * as XLSX from 'xlsx';
import type { Project } from '../types';
import { PIPELINE_STAGES } from '../types';

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
