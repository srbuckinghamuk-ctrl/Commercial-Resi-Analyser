import { useState, useCallback } from 'react';
import type { Project } from '../types';
import { getEligibility, getAppraisal } from '../lib/api';
import { generateEligibilityPdf, generateAppraisalPdf } from '../lib/export-pdf';
import { generateProjectsExcel } from '../lib/export-excel';

interface ExportPageProps {
  projects: Project[];
  selectedProject: Project | null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPage({ projects, selectedProject }: ExportPageProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEligibilityPdf = useCallback(async () => {
    if (!selectedProject) return;
    setLoading('eligibility');
    setError(null);
    try {
      const assessment = await getEligibility(selectedProject.id);
      const blob = generateEligibilityPdf(selectedProject, assessment);
      const safeName = selectedProject.address_postcode || selectedProject.id.slice(0, 8);
      downloadBlob(blob, `eligibility-${safeName}.pdf`);
    } catch (err) {
      setError('Could not generate eligibility PDF. Has an eligibility assessment been run for this project?');
    } finally {
      setLoading(null);
    }
  }, [selectedProject]);

  const handleAppraisalPdf = useCallback(async () => {
    if (!selectedProject) return;
    setLoading('appraisal');
    setError(null);
    try {
      const appraisal = await getAppraisal(selectedProject.id);
      const blob = generateAppraisalPdf(selectedProject, appraisal);
      const safeName = selectedProject.address_postcode || selectedProject.id.slice(0, 8);
      downloadBlob(blob, `appraisal-${safeName}.pdf`);
    } catch (err) {
      setError('Could not generate appraisal PDF. Has a financial appraisal been saved for this project?');
    } finally {
      setLoading(null);
    }
  }, [selectedProject]);

  const handleExcel = useCallback(() => {
    if (projects.length === 0) return;
    setLoading('excel');
    setError(null);
    try {
      const blob = generateProjectsExcel(projects);
      downloadBlob(blob, `projects-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setError('Could not generate Excel file.');
    } finally {
      setLoading(null);
    }
  }, [projects]);

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, fontWeight: 600, marginBottom: 20 }}>Export</h2>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8, padding: 12, marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Project-specific exports */}
      <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Project Reports (PDF)</h3>
        {selectedProject ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
              Selected: <strong style={{ color: '#e2e8f0' }}>{selectedProject.address_raw}</strong>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={handleEligibilityPdf}
                disabled={loading === 'eligibility'}
                style={{
                  padding: '8px 16px',
                  background: '#1e3a5f',
                  color: '#93c5fd',
                  border: '1px solid #2563eb',
                  borderRadius: 6,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  opacity: loading === 'eligibility' ? 0.6 : 1,
                }}
              >
                {loading === 'eligibility' ? 'Generating...' : 'Eligibility Report PDF'}
              </button>
              <button
                onClick={handleAppraisalPdf}
                disabled={loading === 'appraisal'}
                style={{
                  padding: '8px 16px',
                  background: '#1e3a5f',
                  color: '#93c5fd',
                  border: '1px solid #2563eb',
                  borderRadius: 6,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  opacity: loading === 'appraisal' ? 0.6 : 1,
                }}
              >
                {loading === 'appraisal' ? 'Generating...' : 'Financial Appraisal PDF'}
              </button>
            </div>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: 13 }}>
            Select a project from the Pipeline tab to export its reports.
          </p>
        )}
      </div>

      {/* Bulk export */}
      <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>All Projects (Excel)</h3>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
          Export all {projects.length} project{projects.length !== 1 ? 's' : ''} to a spreadsheet.
        </p>
        <button
          onClick={handleExcel}
          disabled={projects.length === 0 || loading === 'excel'}
          style={{
            padding: '8px 16px',
            background: projects.length > 0 ? '#1e3a5f' : '#0f1d32',
            color: projects.length > 0 ? '#93c5fd' : '#475569',
            border: `1px solid ${projects.length > 0 ? '#2563eb' : '#1e3a5f'}`,
            borderRadius: 6,
            cursor: projects.length > 0 && !loading ? 'pointer' : 'not-allowed',
            fontSize: 13,
            opacity: loading === 'excel' ? 0.6 : 1,
          }}
        >
          {loading === 'excel' ? 'Generating...' : 'Download Excel'}
        </button>
      </div>
    </div>
  );
}
