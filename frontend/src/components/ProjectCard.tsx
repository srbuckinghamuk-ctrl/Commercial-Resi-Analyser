import type { Project, PipelineStage } from '../types';
import { PIPELINE_STAGES } from '../types';

interface ProjectCardProps {
  project: Project;
  onStageChange: (projectId: string, newStage: PipelineStage) => void;
  onSelect: (project: Project) => void;
  onDelete: (projectId: string) => void;
}

const VERDICT_COLORS: Record<string, string> = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
};

export default function ProjectCard({ project, onStageChange, onSelect, onDelete }: ProjectCardProps) {
  const currentIndex = PIPELINE_STAGES.findIndex((s) => s.value === project.stage);
  const nextStage = currentIndex < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[currentIndex + 1] : null;

  return (
    <div
      style={{
        background: '#0f1d32',
        border: '1px solid #1e3a5f',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        cursor: 'pointer',
      }}
      onClick={() => onSelect(project)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, flex: 1 }}>
          {project.address_raw}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 14,
            padding: '0 4px',
          }}
          title="Delete project"
        >
          ✕
        </button>
      </div>
      <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
        {project.use_class.replace(/_/g, ' ')} · £{(project.price_pence / 100).toLocaleString()}
      </div>
      {project.address_postcode && (
        <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{project.address_postcode}</div>
      )}
      {nextStage && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStageChange(project.id, nextStage.value);
          }}
          style={{
            marginTop: 8,
            padding: '4px 10px',
            fontSize: 11,
            background: '#1e3a5f',
            color: '#93c5fd',
            border: '1px solid #2563eb',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          → {nextStage.label}
        </button>
      )}
    </div>
  );
}
