import { useState, useCallback, useEffect } from 'react';
import type { Project, EligibilityAssessment as EligAssessment } from '../types';
import { runEligibility, getEligibility } from '../lib/api';
import { formatUseClass } from '../lib/format';
import EligibilityVerdictDisplay from './EligibilityVerdict';

interface EligibilityWizardProps {
  project: Project;
}

type WizardState = 'loading' | 'idle' | 'running' | 'complete' | 'error';

function isNotFound(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith('HTTP 404');
}

export default function EligibilityWizard({ project }: EligibilityWizardProps) {
  const [state, setState] = useState<WizardState>('loading');
  const [assessment, setAssessment] = useState<EligAssessment | null>(null);
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean | null>>({});
  const [updating, setUpdating] = useState(false);
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
      } catch (e) {
        if (cancelled) return;
        if (isNotFound(e)) {
          setState('idle'); // no assessment yet — normal for a new project
        } else {
          setState('error');
          setErrorMsg('Could not load the existing assessment — check your connection and try again.');
        }
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
    } catch {
      setState('error');
      setErrorMsg('Could not run the eligibility checks — check your connection and try again.');
    }
  }, [project.id, manualOverrides]);

  // Answering a manual criterion re-runs the engine but keeps the list on
  // screen — no full-page flash, and answers can be changed or cleared.
  const handleOverride = useCallback(
    (key: string, value: boolean | null) => {
      const updated = { ...manualOverrides };
      if (value === null) {
        delete updated[key];
      } else {
        updated[key] = value;
      }
      setManualOverrides(updated);
      setUpdating(true);
      setErrorMsg('');
      runEligibility(project.id, updated)
        .then((result) => {
          setAssessment(result.assessment);
        })
        .catch(() => {
          setErrorMsg('Could not save your answer — check your connection and try again.');
        })
        .finally(() => setUpdating(false));
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
          {formatUseClass(project.use_class)} · £{(project.price_pence / 100).toLocaleString()}
          {project.floor_area_sqm != null && ` · ${project.floor_area_sqm} m²`}
          {project.address_postcode && ` · ${project.address_postcode}`}
        </div>
      </div>

      {state === 'loading' && (
        <p style={{ color: '#94a3b8', padding: 16 }}>Loading…</p>
      )}

      {state === 'idle' && (
        <div>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 12 }}>
            Checks this property against the Permitted Development Rights (PDR) criteria for its
            use class — flood risk, Article 4 directions, EPC data and floorspace limits — then
            asks you to confirm anything that can't be verified automatically.
          </p>
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
            Run eligibility assessment
          </button>
        </div>
      )}

      {state === 'running' && (
        <div style={{ color: '#60a5fa', padding: 16 }} role="status">
          Running eligibility checks — querying flood risk, Article 4, EPC data…
        </div>
      )}

      {state === 'error' && (
        <div>
          <p role="alert" style={{ color: '#ef4444', marginBottom: 8 }}>{errorMsg}</p>
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
          {updating && (
            <p role="status" style={{ color: '#60a5fa', fontSize: 13, margin: '0 0 8px' }}>Updating verdict…</p>
          )}
          {errorMsg && (
            <p role="alert" style={{ color: '#ef4444', fontSize: 13, margin: '0 0 8px' }}>{errorMsg}</p>
          )}
          <div style={{ opacity: updating ? 0.6 : 1, transition: 'opacity 0.15s ease' }}>
            <EligibilityVerdictDisplay
              assessment={assessment}
              onOverride={handleOverride}
              overrides={manualOverrides}
            />
          </div>
          <button
            onClick={handleRun}
            disabled={updating}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#1e3a5f',
              color: '#e2e8f0',
              border: 'none',
              borderRadius: 6,
              cursor: updating ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Re-run assessment
          </button>
        </div>
      )}
    </div>
  );
}
