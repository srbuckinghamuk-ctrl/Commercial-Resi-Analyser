import { useState, useCallback, useEffect } from 'react';
import type { Project, EligibilityAssessment as EligAssessment } from '../types';
import { runEligibility, getEligibility } from '../lib/api';
import EligibilityVerdictDisplay from './EligibilityVerdict';

interface EligibilityWizardProps {
  project: Project;
}

type WizardState = 'idle' | 'running' | 'complete' | 'error';

export default function EligibilityWizard({ project }: EligibilityWizardProps) {
  const [state, setState] = useState<WizardState>('idle');
  const [assessment, setAssessment] = useState<EligAssessment | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean | null>>({});
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await getEligibility(project.id);
        if (!cancelled) {
          setAssessment(existing);
          setState('complete');
        }
      } catch {
        // No existing assessment — that's fine
      }
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  const handleRun = useCallback(async () => {
    setState('running');
    setErrorMsg('');
    try {
      const result = await runEligibility(project.id, manualOverrides);
      setAssessment(result.assessment);
      setState('complete');
    } catch (e) {
      setState('error');
      setErrorMsg(e instanceof Error ? e.message : 'Failed to run eligibility check');
    }
  }, [project.id, manualOverrides]);

  const handleOverride = useCallback(
    (key: string, value: boolean | null) => {
      const updated = { ...manualOverrides, [key]: value };
      setManualOverrides(updated);
      setState('running');
      setErrorMsg('');
      runEligibility(project.id, updated)
        .then((result) => {
          setAssessment(result.assessment);
          setState('complete');
        })
        .catch((e) => {
          setState('error');
          setErrorMsg(e instanceof Error ? e.message : 'Failed to update');
        });
    },
    [project.id, manualOverrides],
  );

  return (
    <div>
      <div
        style={{
          padding: 12,
          background: '#0f1d32',
          borderRadius: 8,
          border: '1px solid #1e3a5f',
          marginBottom: 16,
        }}
      >
        <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{project.address_raw}</div>
        <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
          {project.use_class} · £{(project.price_pence / 100).toLocaleString()}
          {project.floor_area_sqm != null && ` · ${project.floor_area_sqm} sq m`}
          {project.address_postcode && ` · ${project.address_postcode}`}
        </div>
      </div>

      {state === 'idle' && (
        <button
          onClick={handleRun}
          style={{
            padding: '10px 24px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Run Eligibility Assessment
        </button>
      )}

      {state === 'running' && (
        <div style={{ color: '#60a5fa', padding: 16 }}>
          Running eligibility checks — querying flood risk, Article 4, EPC data...
        </div>
      )}

      {state === 'error' && (
        <div>
          <p style={{ color: '#ef4444', marginBottom: 8 }}>{errorMsg}</p>
          <button
            onClick={handleRun}
            style={{
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {state === 'complete' && assessment && (
        <div>
          <EligibilityVerdictDisplay assessment={assessment} onOverride={handleOverride} />
          <button
            onClick={handleRun}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#1e3a5f',
              color: '#e2e8f0',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Re-run Assessment
          </button>
        </div>
      )}
    </div>
  );
}
