import { useState, useEffect } from 'react';
import type { Project, PipelineStage, EligibilityAssessment as EligibilityType, FinancialAppraisal } from '../types';
import { PIPELINE_STAGES } from '../types';
import { changeStage, getEligibility, getAppraisal } from '../lib/api';
import EligibilityWizard from './EligibilityWizard';
import ConversionCalculator from './ConversionCalculator';

interface ProjectDetailProps {
  project: Project;
  onBack: () => void;
  onProjectUpdated: () => void;
}

type DetailView = 'overview' | 'eligibility' | 'calculator';

const STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  opportunity_identified: 'Property identified and added to pipeline',
  eligibility_assessed: 'PDR eligibility checks completed',
  financial_appraisal: 'Financial viability assessment in progress',
  prior_approval_submitted: 'Prior approval application submitted to LPA',
  approved: 'Prior approval granted',
  in_conversion: 'Conversion works underway',
  complete: 'Project completed',
};

const STAGE_ACTIONS: Record<PipelineStage, { label: string; view: DetailView } | null> = {
  opportunity_identified: { label: 'Run Eligibility Assessment', view: 'eligibility' },
  eligibility_assessed: { label: 'Start Financial Appraisal', view: 'calculator' },
  financial_appraisal: { label: 'Review Financial Appraisal', view: 'calculator' },
  prior_approval_submitted: null,
  approved: null,
  in_conversion: null,
  complete: null,
};

export default function ProjectDetail({ project, onBack, onProjectUpdated }: ProjectDetailProps) {
  const [view, setView] = useState<DetailView>('overview');
  const [eligibility, setEligibility] = useState<EligibilityType | null>(null);
  const [appraisal, setAppraisal] = useState<FinancialAppraisal | null>(null);
  const [advancing, setAdvancing] = useState(false);

  const currentStageIndex = PIPELINE_STAGES.findIndex((s) => s.value === project.stage);
  const nextStage = currentStageIndex < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[currentStageIndex + 1] : null;

  useEffect(() => {
    getEligibility(project.id).then(setEligibility).catch(() => setEligibility(null));
    getAppraisal(project.id).then(setAppraisal).catch(() => setAppraisal(null));
  }, [project.id]);

  const handleAdvanceStage = async () => {
    if (!nextStage || advancing) return;
    setAdvancing(true);
    try {
      await changeStage(project.id, nextStage.value);
      onProjectUpdated();
    } catch (err) {
      console.error('Stage change failed:', err);
    } finally {
      setAdvancing(false);
    }
  };

  if (view === 'eligibility') {
    return (
      <div>
        <button
          onClick={() => setView('overview')}
          style={{
            margin: '16px 24px',
            padding: '8px 16px',
            background: '#1e3a5f',
            color: '#93c5fd',
            border: '1px solid #2563eb',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ← Back to Project
        </button>
        <EligibilityWizard project={project} />
      </div>
    );
  }

  if (view === 'calculator') {
    return (
      <div>
        <button
          onClick={() => setView('overview')}
          style={{
            margin: '16px 24px',
            padding: '8px 16px',
            background: '#1e3a5f',
            color: '#93c5fd',
            border: '1px solid #2563eb',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ← Back to Project
        </button>
        <ConversionCalculator project={project} />
      </div>
    );
  }

  const stageAction = STAGE_ACTIONS[project.stage];

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          padding: '8px 16px',
          background: 'transparent',
          color: '#93c5fd',
          border: '1px solid #1e3a5f',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
          marginBottom: 20,
        }}
      >
        ← Back to Pipeline
      </button>

      {/* Project header */}
      <div
        style={{
          background: '#0a1628',
          border: '1px solid #1e3a5f',
          borderRadius: 10,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h2 style={{ color: '#e2e8f0', fontSize: 20, margin: '0 0 8px 0' }}>{project.address_raw}</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', color: '#94a3b8', fontSize: 14 }}>
          <span>£{(project.price_pence / 100).toLocaleString()}</span>
          <span>{project.use_class.replace(/_/g, ' ')}</span>
          {project.address_postcode && <span>{project.address_postcode}</span>}
          {project.floor_area_sqm && <span>{project.floor_area_sqm.toLocaleString()} m²</span>}
          {project.tenure !== 'unknown' && <span>{project.tenure}</span>}
        </div>
        {project.source_url && (
          <a
            href={project.source_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#60a5fa', fontSize: 12, marginTop: 8, display: 'inline-block' }}
          >
            View listing →
          </a>
        )}
      </div>

      {/* Pipeline progress tracker */}
      <div
        style={{
          background: '#0a1628',
          border: '1px solid #1e3a5f',
          borderRadius: 10,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <h3 style={{ color: '#e2e8f0', fontSize: 16, margin: '0 0 20px 0' }}>Appraisal Progress</h3>

        <div style={{ position: 'relative' }}>
          {/* Connecting line */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              right: 16,
              height: 2,
              background: '#1e3a5f',
              zIndex: 0,
            }}
          />
          {/* Progress fill */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              width: `${(currentStageIndex / (PIPELINE_STAGES.length - 1)) * 100}%`,
              height: 2,
              background: '#2563eb',
              zIndex: 1,
              transition: 'width 0.3s ease',
            }}
          />

          {/* Stage nodes */}
          <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 2 }}>
            {PIPELINE_STAGES.map((stage, i) => {
              const isCompleted = i < currentStageIndex;
              const isCurrent = i === currentStageIndex;
              return (
                <div
                  key={stage.value}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {/* Circle */}
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      background: isCompleted ? '#2563eb' : isCurrent ? '#0a1628' : '#0f1d32',
                      border: isCurrent ? '2px solid #2563eb' : isCompleted ? '2px solid #2563eb' : '2px solid #1e3a5f',
                      color: isCompleted ? '#fff' : isCurrent ? '#60a5fa' : '#475569',
                      transition: 'all 0.3s ease',
                      boxShadow: isCurrent ? '0 0 0 4px rgba(37, 99, 235, 0.2)' : 'none',
                    }}
                  >
                    {isCompleted ? '✓' : i + 1}
                  </div>

                  {/* Label */}
                  <span
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      fontWeight: isCurrent ? 600 : 400,
                      color: isCompleted ? '#60a5fa' : isCurrent ? '#e2e8f0' : '#475569',
                      textAlign: 'center',
                      lineHeight: 1.3,
                      maxWidth: 100,
                      wordWrap: 'break-word',
                    }}
                  >
                    {stage.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Current stage description */}
        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: '#0f1d32',
            borderRadius: 8,
            border: '1px solid #1e3a5f',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ color: '#60a5fa', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>CURRENT STAGE</div>
              <div style={{ color: '#e2e8f0', fontSize: 15, fontWeight: 600 }}>
                {PIPELINE_STAGES[currentStageIndex]?.label}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
                {STAGE_DESCRIPTIONS[project.stage]}
              </div>
            </div>
            {nextStage && (
              <button
                onClick={handleAdvanceStage}
                disabled={advancing}
                style={{
                  padding: '8px 16px',
                  background: advancing ? '#1e3a5f' : '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: advancing ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {advancing ? 'Advancing...' : `Advance → ${nextStage.label}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Eligibility card */}
        <ActionCard
          title="Eligibility Assessment"
          description="Check PDR eligibility — flood risk, Article 4, EPC, and more"
          status={
            eligibility
              ? eligibility.verdict === 'green'
                ? 'Eligible'
                : eligibility.verdict === 'amber'
                ? 'Checks Outstanding'
                : 'Not Eligible'
              : 'Not Started'
          }
          statusColor={
            eligibility
              ? eligibility.verdict === 'green'
                ? '#22c55e'
                : eligibility.verdict === 'amber'
                ? '#f59e0b'
                : '#ef4444'
              : '#475569'
          }
          buttonLabel={eligibility ? 'Review Assessment' : 'Run Assessment'}
          onClick={() => setView('eligibility')}
          highlighted={stageAction?.view === 'eligibility'}
        />

        {/* Financial Appraisal card */}
        <ActionCard
          title="Financial Appraisal"
          description="Unit mix, conversion costs, finance, cashflow, and exit strategy"
          status={appraisal ? 'Saved' : 'Not Started'}
          statusColor={appraisal ? '#22c55e' : '#475569'}
          buttonLabel={appraisal ? 'Review Appraisal' : 'Start Appraisal'}
          onClick={() => setView('calculator')}
          highlighted={stageAction?.view === 'calculator'}
        />
      </div>

      {/* Key metrics (if appraisal exists) */}
      {appraisal && (() => {
        // Server-authoritative outputs (Task 12) are the preferred source;
        // the legacy flat columns are shown only when a record predates
        // recalculation (outputs is null), flagged as such below.
        const metrics = appraisal.outputs?.metrics ?? null;
        const display = metrics
          ? {
              gdv: metrics.gdv_pence,
              totalCost: metrics.total_development_cost_pence,
              profitOnCost: metrics.profit_on_cost_pct,
              profitOnGdv: metrics.profit_on_gdv_pct,
              returnOnEquity: metrics.return_on_equity_pct,
              irr: metrics.irr_annual_pct,
            }
          : {
              gdv: appraisal.gdv_pence,
              totalCost: appraisal.total_cost_pence,
              profitOnCost: appraisal.profit_on_cost_pct,
              profitOnGdv: appraisal.profit_on_gdv_pct,
              returnOnEquity: appraisal.return_on_equity_pct,
              irr: appraisal.irr,
            };
        const isLegacy = metrics == null;
        return (
          <div
            style={{
              background: '#0a1628',
              border: '1px solid #1e3a5f',
              borderRadius: 10,
              padding: 24,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <h3 style={{ color: '#e2e8f0', fontSize: 16, margin: 0 }}>Key Metrics</h3>
              {isLegacy && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#ef4444',
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: 'rgba(239, 68, 68, 0.12)',
                  }}
                >
                  legacy — unreconciled
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
              {display.gdv != null && (
                <MetricTile label="GDV" value={`£${(display.gdv / 100).toLocaleString()}`} />
              )}
              {display.totalCost != null && (
                <MetricTile label="Total Cost" value={`£${(display.totalCost / 100).toLocaleString()}`} />
              )}
              {display.profitOnCost != null && (
                <MetricTile label="Profit on Cost" value={`${display.profitOnCost.toFixed(1)}%`} />
              )}
              {display.profitOnGdv != null && (
                <MetricTile label="Profit on GDV" value={`${display.profitOnGdv.toFixed(1)}%`} />
              )}
              {display.returnOnEquity != null && (
                <MetricTile label="Return on Equity" value={`${display.returnOnEquity.toFixed(1)}%`} />
              )}
              {display.irr != null && (
                <MetricTile label="IRR" value={`${display.irr.toFixed(1)}%`} />
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ActionCard({
  title,
  description,
  status,
  statusColor,
  buttonLabel,
  onClick,
  highlighted,
}: {
  title: string;
  description: string;
  status: string;
  statusColor: string;
  buttonLabel: string;
  onClick: () => void;
  highlighted: boolean;
}) {
  return (
    <div
      style={{
        background: '#0a1628',
        border: highlighted ? '2px solid #2563eb' : '1px solid #1e3a5f',
        borderRadius: 10,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ color: '#e2e8f0', fontSize: 15, margin: 0 }}>{title}</h4>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: statusColor,
            padding: '2px 8px',
            borderRadius: 10,
            background: `${statusColor}18`,
          }}
        >
          {status}
        </span>
      </div>
      <p style={{ color: '#94a3b8', fontSize: 13, margin: 0, lineHeight: 1.4 }}>{description}</p>
      <button
        onClick={onClick}
        style={{
          marginTop: 'auto',
          padding: '10px 16px',
          background: highlighted ? '#2563eb' : '#1e3a5f',
          color: highlighted ? '#fff' : '#93c5fd',
          border: highlighted ? 'none' : '1px solid #2563eb',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#0f1d32', borderRadius: 8, padding: 14, border: '1px solid #1e3a5f' }}>
      <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
