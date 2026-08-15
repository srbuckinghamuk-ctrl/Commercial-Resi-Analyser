import { useState, useMemo, useCallback } from 'react';
import type { Project, PipelineStage, UseClass } from '../types';
import { PIPELINE_STAGES, USE_CLASS_OPTIONS } from '../types';
import { changeStage, deleteProject } from '../lib/api';
import { filterProjects, sortProjects } from '../lib/pipeline-helpers';
import type { PipelineFilters, SortField, SortDirection } from '../lib/pipeline-helpers';
import ProjectCard from './ProjectCard';

interface PipelineProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
  onProjectsChanged: () => void;
}

export default function Pipeline({ projects, onSelectProject, onProjectsChanged }: PipelineProps) {
  const [filters, setFilters] = useState<PipelineFilters>({
    stage: 'all',
    useClass: 'all',
  });
  const [sortBy, setSortBy] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

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
      try {
        await changeStage(projectId, newStage);
        onProjectsChanged();
      } catch (err) {
        console.error('Stage change failed:', err);
      }
    },
    [onProjectsChanged],
  );

  const handleDelete = useCallback(
    async (projectId: string) => {
      try {
        await deleteProject(projectId);
        onProjectsChanged();
      } catch (err) {
        console.error('Delete failed:', err);
      }
    },
    [onProjectsChanged],
  );

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
            <option value="stage">Stage</option>
          </select>
        </label>

        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          style={{ background: '#0f1d32', border: '1px solid #1e3a5f', color: '#93c5fd', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
        >
          {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>

        <span style={{ color: '#64748b', fontSize: 13, marginLeft: 'auto' }}>
          {processed.length} project{processed.length !== 1 ? 's' : ''}
        </span>
      </div>

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
              <div style={{ padding: 8, flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
                {stageProjects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onStageChange={handleStageChange}
                    onSelect={onSelectProject}
                    onDelete={handleDelete}
                  />
                ))}
                {stageProjects.length === 0 && (
                  <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: 16 }}>
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
