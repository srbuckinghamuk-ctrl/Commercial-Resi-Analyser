import { useState } from 'react';
import type { Project } from '../types';
import EligibilityWizard from './EligibilityWizard';

interface EligibilityAssessmentProps {
  projects: Project[];
  selectedProject: Project | null;
}

export default function EligibilityAssessment({ projects, selectedProject }: EligibilityAssessmentProps) {
  const [chosen, setChosen] = useState<Project | null>(selectedProject);

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>PDR Eligibility Assessment</h2>

      {!chosen && (
        <div>
          <p style={{ color: '#94a3b8', marginBottom: 12 }}>Select a project to assess:</p>
          {projects.length === 0 ? (
            <p style={{ color: '#64748b' }}>No projects yet. Create one in the New Project tab.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setChosen(p)}
                  style={{
                    padding: 12,
                    background: '#0f1d32',
                    borderRadius: 8,
                    border: '1px solid #1e3a5f',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: '#e2e8f0',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.address_raw}</div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
                    {p.use_class} · £{(p.price_pence / 100).toLocaleString()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {chosen && (
        <div>
          <button
            onClick={() => setChosen(null)}
            style={{
              marginBottom: 16,
              padding: '6px 12px',
              background: '#1e3a5f',
              color: '#e2e8f0',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            ← Back to project list
          </button>
          <EligibilityWizard project={chosen} />
        </div>
      )}
    </div>
  );
}
