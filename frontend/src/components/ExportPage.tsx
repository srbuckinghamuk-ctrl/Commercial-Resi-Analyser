import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Project } from '../types';
import { getEligibility, getAppraisal } from '../lib/api';
import { generateEligibilityPdf, generateAppraisalPdf } from '../lib/export-pdf';
import { generateProjectsExcel, generateAppraisalExcel } from '../lib/export-excel';
import { generateInvestmentMemo } from '../lib/export-investment-memo';
import { calculateAppraisal } from '../lib/conversion-calc-engine';
import { buildCashflow } from '../lib/conversion-cashflow';
import { normaliseSnapshot } from '../lib/snapshot';
import { exportErrorMessage, SnapshotMissingError } from '../lib/export-errors';

const NO_APPRAISAL =
  'no financial appraisal is saved for this project yet — open the Conversion Calculator and save one first';
const NO_ELIGIBILITY =
  'no eligibility assessment exists for this project yet — run one from the project page first';

interface ExportPageProps {
  projects: Project[];
  projectsLoading: boolean;
  backendOffline: boolean;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPage({ projects, projectsLoading, backendOffline }: ExportPageProps) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // Default to the first project once the list arrives.
  useEffect(() => {
    if (!selectedId && projects.length > 0) {
      setSelectedId(projects[0].id);
    }
  }, [projects, selectedId]);

  // A stale error from one project shouldn't linger over another.
  useEffect(() => {
    setError(null);
  }, [selectedId]);

  const handleEligibilityPdf = useCallback(async () => {
    if (!selected) return;
    setLoading('eligibility');
    setError(null);
    try {
      const assessment = await getEligibility(selected.id);
      const blob = generateEligibilityPdf(selected, assessment);
      const safeName = selected.address_postcode || selected.id.slice(0, 8);
      downloadBlob(blob, `eligibility-${safeName}.pdf`);
    } catch (err) {
      console.error('Eligibility PDF export failed:', err);
      setError(exportErrorMessage('eligibility PDF', NO_ELIGIBILITY, err));
    } finally {
      setLoading(null);
    }
  }, [selected]);

  const handleAppraisalPdf = useCallback(async () => {
    if (!selected) return;
    setLoading('appraisal');
    setError(null);
    try {
      const appraisal = await getAppraisal(selected.id);
      const blob = generateAppraisalPdf(selected, appraisal);
      const safeName = selected.address_postcode || selected.id.slice(0, 8);
      downloadBlob(blob, `appraisal-${safeName}.pdf`);
    } catch (err) {
      console.error('Appraisal PDF export failed:', err);
      setError(exportErrorMessage('appraisal PDF', NO_APPRAISAL, err));
    } finally {
      setLoading(null);
    }
  }, [selected]);

  const handleInvestmentMemo = useCallback(async () => {
    if (!selected) return;
    setLoading('memo');
    setError(null);
    try {
      const appraisal = await getAppraisal(selected.id);
      const inputs = normaliseSnapshot(appraisal.inputs_snapshot);
      if (!inputs) {
        throw new SnapshotMissingError();
      }
      const metrics = calculateAppraisal(inputs);
      const cashflow = buildCashflow(inputs);

      let eligibility = null;
      try {
        eligibility = await getEligibility(selected.id);
      } catch {
        // eligibility is optional for the memo
      }

      const blob = generateInvestmentMemo(selected, inputs, metrics, cashflow, eligibility);
      const safeName = selected.address_postcode || selected.id.slice(0, 8);
      downloadBlob(blob, `investment-memo-${safeName}.pdf`);
    } catch (err) {
      console.error('Investment memorandum export failed:', err);
      setError(exportErrorMessage('Investment Memorandum', NO_APPRAISAL, err));
    } finally {
      setLoading(null);
    }
  }, [selected]);

  const handleAppraisalExcel = useCallback(async () => {
    if (!selected) return;
    setLoading('appraisal-excel');
    setError(null);
    try {
      const appraisal = await getAppraisal(selected.id);
      const inputs = normaliseSnapshot(appraisal.inputs_snapshot);
      if (!inputs) {
        throw new SnapshotMissingError();
      }
      const metrics = calculateAppraisal(inputs);
      const cashflow = buildCashflow(inputs);
      const blob = generateAppraisalExcel(selected, inputs, metrics, cashflow);
      const safeName = selected.address_postcode || selected.id.slice(0, 8);
      downloadBlob(blob, `appraisal-${safeName}.xlsx`);
    } catch (err) {
      console.error('Appraisal workbook export failed:', err);
      setError(exportErrorMessage('appraisal workbook', NO_APPRAISAL, err));
    } finally {
      setLoading(null);
    }
  }, [selected]);

  const handleExcel = useCallback(() => {
    if (projects.length === 0) return;
    setLoading('excel');
    setError(null);
    try {
      const blob = generateProjectsExcel(projects);
      downloadBlob(blob, `projects-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      setError('Could not generate the Excel file.');
    } finally {
      setLoading(null);
    }
  }, [projects]);

  const projectButton = (key: string, label: string, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={!selected || loading === key}
      style={{
        padding: '8px 16px',
        background: selected ? '#1e3a5f' : '#0f1d32',
        color: selected ? '#93c5fd' : '#64748b',
        border: `1px solid ${selected ? '#2563eb' : '#1e3a5f'}`,
        borderRadius: 6,
        cursor: selected && loading !== key ? 'pointer' : 'default',
        fontSize: 13,
        opacity: loading === key ? 0.6 : 1,
      }}
    >
      {loading === key ? 'Generating…' : label}
    </button>
  );

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Export</h2>

      {projects.length === 0 ? (
        projectsLoading ? (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading projects…</p>
        ) : backendOffline ? (
          <p role="alert" style={{ color: '#f87171', fontSize: 14 }}>
            Can't reach the server — your projects will appear here once the connection recovers.
          </p>
        ) : (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            Nothing to export yet — <Link to="/new" style={{ color: '#60a5fa' }}>add a property</Link> first.
          </p>
        )
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <label htmlFor="export-project" style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 6 }}>
              Project
            </label>
            <select
              id="export-project"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', background: '#0f1d32', border: '1px solid #1e3a5f', borderRadius: 6, color: '#e2e8f0', fontSize: 14 }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.address_raw}</option>
              ))}
            </select>
          </div>

          {error && (
            <div role="alert" style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8, padding: 12, marginBottom: 16, color: '#fca5a5', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{error}</span>
              <button onClick={() => setError(null)} aria-label="Dismiss error" style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
            </div>
          )}

          {/* Investment Memorandum */}
          <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Investment Memorandum (PDF)</h3>
            <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>
              Comprehensive report with full cost plan, sensitivity analysis, risk register, cashflow, and funding request. Suitable for equity investors and senior debt funders.
            </p>
            {projectButton('memo', 'Download investment memorandum', handleInvestmentMemo)}
          </div>

          {/* Quick reports */}
          <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Quick Reports (PDF)</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {projectButton('eligibility', 'Download eligibility report', handleEligibilityPdf)}
              {projectButton('appraisal', 'Download appraisal summary', handleAppraisalPdf)}
              {projectButton('appraisal-excel', 'Download appraisal workbook (Excel)', handleAppraisalExcel)}
            </div>
            <p style={{ color: '#64748b', fontSize: 12, margin: '10px 0 0' }}>
              The workbook includes the summary, full cost plan, unit schedule, month-by-month cashflow, and assumption schedule.
            </p>
          </div>

          {/* Bulk export */}
          <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16 }}>
            <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>All Projects (Excel)</h3>
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
              Export all {projects.length} project{projects.length !== 1 ? 's' : ''} to a spreadsheet.
            </p>
            <button
              onClick={handleExcel}
              disabled={loading === 'excel'}
              style={{
                padding: '8px 16px',
                background: '#1e3a5f',
                color: '#93c5fd',
                border: '1px solid #2563eb',
                borderRadius: 6,
                cursor: loading === 'excel' ? 'default' : 'pointer',
                fontSize: 13,
                opacity: loading === 'excel' ? 0.6 : 1,
              }}
            >
              {loading === 'excel' ? 'Generating…' : 'Download Excel'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
