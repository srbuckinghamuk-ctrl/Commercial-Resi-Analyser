import type { Project } from '../types';

interface PipelineProps {
  projects: Project[];
  onSelectProject: (project: Project) => void;
}

export default function Pipeline({ projects, onSelectProject }: PipelineProps) {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Project Pipeline</h2>
      <p style={{ color: '#94a3b8' }}>
        {projects.length} project{projects.length !== 1 ? 's' : ''} in pipeline.
        Full Kanban dashboard coming in Plan 4.
      </p>
      {projects.map((p) => (
        <div
          key={p.id}
          onClick={() => onSelectProject(p)}
          style={{
            padding: 12,
            marginTop: 8,
            background: '#0f1d32',
            borderRadius: 8,
            cursor: 'pointer',
            border: '1px solid #1e3a5f',
          }}
        >
          <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.address_raw}</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            {p.use_class} · £{(p.price_pence / 100).toLocaleString()} · {p.stage.replace(/_/g, ' ')}
          </div>
        </div>
      ))}
    </div>
  );
}
