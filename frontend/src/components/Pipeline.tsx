import { useState, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Project, PipelineStage, UseClass } from '../types';
import { PIPELINE_STAGES, USE_CLASS_OPTIONS } from '../types';
import { changeStage, deleteProject } from '../lib/api';
import { filterProjects, sortProjects } from '../lib/pipeline-helpers';
import type { PipelineFilters, SortField, SortDirection } from '../lib/pipeline-helpers';
import ProjectCard from './ProjectCard';

interface PipelineProps {
  projects: Project[];
  loading: boolean;
  onProjectsChanged: () => void;
}

export default function Pipeline({ projects, loading, onProjectsChanged }: PipelineProps) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<PipelineFilters>({
    stage: 'all',
    useClass: 'all',
  });
  const [sortBy, setSortBy] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [actionError, setActionError] = useState<string | null>(null);

  const processed = useMemo(() => {
    const filtered = filterProjects(projects, filters);
    return sortProjects(filtered, sortBy, sortDir);
  }, [projects, filters, sortBy, sortDir]);

  const projectsByStage = useMemo(() => {
    const map = new Map<PipelineStage, Project[]>();
    for (const s of PIPELINE_STAGES) {
      map.set(s.value, []);
    }
    for (const p of processed) {
      const list = map.get(p.stage);
      if (list) list.push(p);
    }
    return map;
  }, [processed]);

  const handleStageChange = useCallback(
    async (projectId: string, newStage: PipelineStage) => {
      setActionError(null);
      try {
        await changeStage(projectId, newStage);
        onProjectsChanged();
      } catch {
        setActionError('Could not move the project — check your connection and try again.');
      }
    },
    [onProjectsChanged],
  );

  const handleDelete = useCallback(
    async (project: Project) => {
      const confirmed = window.confirm(
        `Delete "${project.address_raw}"?\n\nThis also deletes its eligibility assessment and financial appraisal, and cannot be undone.`,
      );
      if (!confirmed) return;
      setActionError(null);
      try {
        await deleteProject(project.id);
        onProjectsChanged();
      } catch {
        setActionError('Could not delete the project — check your connection and try again.');
      }
    },
    [onProjectsChanged],
  );

  if (!loading && projects.length === 0) {
    return (
      <div style={{ padding: '64px 24px', maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 22, marginBottom: 10 }}>
          Screen commercial buildings for residential conversion
        </h2>
        <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
          Add a property to check its Permitted Development eligibility, run a full
          development appraisal, and generate an investor-ready report.
        </p>
        <Link
          to="/new"
          style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: '#2563eb',
            color: '#fff',
            borderRadius: 6,
            fontSize: 15,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Add your first property
        </Link>
        <p style={{ color: '#64748b', fontSize: 13, marginTop: 16 }}>
          Paste a listing URL from Rightmove Commercial, Savills Auctions, Allsop or EIG — or enter details manually.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Filters row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ color: '#94a3b8', fontSize: 13 }}>
          Use class:
          <select
            value={filters.useClass}
            onChange={(e) => setFilters((f) => ({ ...f, useClass: e.target.value as UseClass | 'all' }))}
            style={{ marginLeft: 6, background: '#0f1d32', color: '#e2e8f0', border: '1px solid #1e3a5f', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          >
            <option value="all">All</option>
            {USE_CLASS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label style={{ color: '#94a3b8', fontSize: 13 }}>
          Sort:
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
            style={{ marginLeft: 6, background: '#0f1d32', color: '#e2e8f0', border: '1px solid #1e3a5f', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          >
            <option value="created_at">Date Added</option>
            <option value="price_pence">Price</option>
          </select>
        </label>

        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          aria-label={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'} — click to toggle`}
          style={{ background: '#0f1d32', border: '1px solid #1e3a5f', color: '#93c5fd', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
        >
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>

        <span style={{ color: '#94a3b8', fontSize: 13, marginLeft: 'auto' }}>
          {processed.length} project{processed.length !== 1 ? 's' : ''}
        </span>
      </div>

      {actionError && (
        <p role="alert" style={{ color: '#f87171', fontSize: 13, margin: '0 0 12px' }}>{actionError}</p>
      )}

      {/* Kanban columns */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 16,
        }}
      >
        {PIPELINE_STAGES.map((stage) => {
          const stageProjects = projectsByStage.get(stage.value) || [];
          return (
            <div
              key={stage.value}
              style={{
                minWidth: 220,
                maxWidth: 280,
                flex: '1 0 220px',
                background: '#0a1628',
                borderRadius: 8,
                border: '1px solid #1e3a5f',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid #1e3a5f',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{stage.label}</span>
                <span
                  style={{
                    background: '#1e3a5f',
                    color: '#93c5fd',
                    borderRadius: 10,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {stageProjects.length}
                </span>
              </div>
              <div style={{ padding: 8, flex: 1, overflowY: 'auto', maxHeight: 'calc(100dvh - 220px)' }}>
                {stageProjects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onStageChange={handleStageChange}
                    onSelect={(project) => navigate(`/projects/${project.id}`)}
                    onDelete={() => handleDelete(p)}
                  />
                ))}
                {stageProjects.length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 16 }}>
                    No projects
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
