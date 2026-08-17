import { useState, useCallback } from 'react';
import type { Project, EligibilityAssessment } from '../types';
import { getEligibility, getAppraisal, isNotFound } from '../lib/api';
import { generateEligibilityPdf, generateAppraisalPdf } from '../lib/export-pdf';
import { generateProjectsExcel } from '../lib/export-excel';
import { generateInvestmentMemo } from '../lib/export-investment-memo';
import { SnapshotMissingError } from '../lib/export-errors';
import { computeSpider } from '../lib/deal-spider';
import { runAppraisal, migrateInputsToV5 } from '../lib/model';
import { buildProvenance } from '../lib/report-provenance';

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

/**
 * Defensive normalisation for legacy saved snapshots that only recorded a
 * unit's floor area in sq ft (no floor_area_sqm field, which the v2 engine
 * requires). This is a unit conversion of raw stored data, not a financial
 * calculation — migrateInputs() does not perform it.
 */
function normaliseUnitAreas(raw: Record<string, unknown>): Record<string, unknown> {
  const unitMix = raw.unit_mix as { units?: Array<Record<string, unknown>> } | undefined;
  if (!unitMix?.units) return raw;
  return {
    ...raw,
    unit_mix: {
      units: unitMix.units.map((u) => ({
        ...u,
        floor_area_sqm:
          typeof u.floor_area_sqm === 'number'
            ? u.floor_area_sqm
            : typeof u.floor_area_sqft === 'number'
              ? Math.round((u.floor_area_sqft as number) * 0.092903 * 100) / 100
              : 0,
      })),
    },
  };
}

export default function ExportPage({ projects, projectsLoading, backendOffline }: ExportPageProps) {
  // The router-based shell has no notion of a globally "selected" project, so
  // the export page owns the choice itself.
  const [selectedId, setSelectedId] = useState<string>('');
  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;
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
    } catch {
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

      // Deal Spider section — computed from the saved snapshot when it holds
      // calculator data; eligibility feeds the prior-approval axis.
      let spider;
      const raw = appraisal.inputs_snapshot as Record<string, unknown> | null;
      if (raw && typeof raw === 'object' && 'acquisition' in raw && 'unit_mix' in raw) {
        let eligibility = null;
        try {
          eligibility = await getEligibility(selectedProject.id);
        } catch {
          // eligibility optional — spider marks the axis provisional
        }
        // R3b: hydrate to v4 like the authoritative appraisal path below, and
        // apply the same legacy sq-ft normalisation the memo path already does
        // (closes a pre-existing spider/memo inconsistency). R8 Task 10: the
        // server now normalises to v5, so this must too -- migrateInputsToV4
        // throws on a v5 document (spec §3.5's guard against the v1-fallback
        // corruption path).
        spider = computeSpider(migrateInputsToV5(normaliseUnitAreas(raw), selectedProject), eligibility);
      }

      const blob = generateAppraisalPdf(selectedProject, appraisal, spider);
      const safeName = selectedProject.address_postcode || selectedProject.id.slice(0, 8);
      downloadBlob(blob, `appraisal-${safeName}.pdf`);
    } catch {
      setError('Could not generate appraisal PDF. Has a financial appraisal been saved for this project?');
    } finally {
      setLoading(null);
    }
  }, [selectedProject]);

  const handleInvestmentMemo = useCallback(async () => {
    if (!selectedProject) return;
    setLoading('memo');
    setError(null);
    try {
      const appraisal = await getAppraisal(selectedProject.id);
      const raw = appraisal.inputs_snapshot as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object' || !('unit_mix' in raw) || !('acquisition' in raw)) {
        throw new SnapshotMissingError();
      }

      // Single authoritative run — the memo consumes it directly and performs
      // zero recalculation (spec §11.9). R8 Task 10: normalise to v5, matching
      // the server boundary.
      const run = runAppraisal(migrateInputsToV5(normaliseUnitAreas(raw), selectedProject));

      let eligibility: EligibilityAssessment | null = null;
      try {
        eligibility = await getEligibility(selectedProject.id);
      } catch {
        // eligibility is optional for the memo
      }

      // Provenance comes from the stored record, not from this run: the hashes
      // are the server's statement about what it computed and persisted (spec
      // §13.2). buildProvenance compares the two calculation versions and marks
      // the report as a recomputation when they differ, rather than letting a
      // stored hash sit beside figures it does not describe.
      const provenance = buildProvenance(run, appraisal);
      const blob = generateInvestmentMemo(selectedProject, run, eligibility, provenance);
      const safeName = selectedProject.address_postcode || selectedProject.id.slice(0, 8);
      downloadBlob(blob, `investment-memo-${safeName}.pdf`);
    } catch (err) {
      // R6: this used to swallow the error entirely and always blame a missing saved
      // appraisal — including for a genuine engine defect thrown by generateInvestmentMemo,
      // which lost the memo silently and told the user to check something that was not
      // the problem. Distinguish by type, not by message content (error message text is
      // not a contract): a missing/incomplete snapshot or a project with no saved
      // appraisal at all are the two documented, user-actionable outcomes; anything else
      // is a defect, logged so it stays findable instead of vanishing.
      console.error('Investment Memorandum generation failed', err);
      if (err instanceof SnapshotMissingError || isNotFound(err)) {
        setError(
          'Could not generate Investment Memorandum. Ensure a financial appraisal has been saved with full calculator data.',
        );
      } else {
        setError(
          'Could not generate Investment Memorandum — an unexpected error occurred while building it. Check the browser console for details.',
        );
      }
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
    } catch {
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

      {/* Project picker */}
      <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <label htmlFor="export-project" style={{ display: 'block', color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
          Project
        </label>
        {projectsLoading ? (
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Loading projects…</p>
        ) : backendOffline ? (
          <p role="alert" style={{ color: '#f87171', fontSize: 14, margin: 0 }}>
            Can't reach the server — your projects will appear here once the connection recovers.
          </p>
        ) : projects.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>No projects yet.</p>
        ) : (
          <select
            id="export-project"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 6, color: '#e2e8f0', fontSize: 14 }}
          >
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.address_raw}</option>
            ))}
          </select>
        )}
      </div>

      {/* Investment Memorandum */}
      <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Investment Memorandum (PDF)</h3>
        <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>
          Comprehensive report with headline cost estimate, sensitivity analysis, risk register, cashflow
          and funding request. Issued as a DRAFT development appraisal: it is suitable for sponsor and
          preliminary lender review, and becomes a document a credit committee can rely on only once the
          appraisal is report-safe and a lender case has been approved.
        </p>
        {selectedProject ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
              Selected: <strong style={{ color: '#e2e8f0' }}>{selectedProject.address_raw}</strong>
            </div>
            <button
              onClick={handleInvestmentMemo}
              disabled={loading === 'memo'}
              style={{
                padding: '10px 20px',
                background: '#1e3a5f',
                color: '#93c5fd',
                border: '1px solid #2563eb',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
                opacity: loading === 'memo' ? 0.6 : 1,
              }}
            >
              {loading === 'memo' ? 'Generating...' : 'Download Investment Memorandum'}
            </button>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: 13 }}>
            Choose a project above to generate its Investment Memorandum.
          </p>
        )}
      </div>

      {/* Project-specific exports */}
      <div style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <h3 style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Quick Reports (PDF)</h3>
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
