import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Project, PipelineStage, UseClass, Tenure, EligibilityAssessment as EligibilityType, FinancialAppraisal, StageTransition } from '../types';
import { PIPELINE_STAGES, USE_CLASS_OPTIONS, TENURE_OPTIONS } from '../types';
import { changeStage, getEligibility, getAppraisal, updateProject, listTransitions } from '../lib/api';
import { formatUseClass, humanise } from '../lib/format';
import { activeDeadline, todayIso } from '../lib/deadlines';
import EligibilityWizard from './EligibilityWizard';

interface ProjectDetailProps {
  project: Project;
  view: 'overview' | 'eligibility';
  onProjectUpdated: () => void;
}

const STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  opportunity_identified: 'Property identified and added to pipeline',
  eligibility_assessed: 'PDR eligibility checks completed',
  financial_appraisal: 'Financial viability assessment in progress',
  prior_approval_submitted: 'Prior approval application submitted to LPA — determination is due within 56 days',
  approved: 'Prior approval granted — works must complete within 3 years of the decision date',
  in_conversion: 'Conversion works underway',
  complete: 'Project completed',
};

const STAGE_HINTS: Record<PipelineStage, string | null> = {
  opportunity_identified: 'Next: run the eligibility check below.',
  eligibility_assessed: 'Next: build the financial appraisal below.',
  financial_appraisal: 'Next: finalise the appraisal, then submit the prior approval application.',
  prior_approval_submitted: 'Track the 56-day determination deadline with your LPA.',
  approved: 'Line up contractors and finance; record your decision date externally for the 3-year completion window.',
  in_conversion: 'Advance to Complete once works finish.',
  complete: 'Nothing left to do — export the final reports from the Export page.',
};

export default function ProjectDetail({ project, view, onProjectUpdated }: ProjectDetailProps) {
  const navigate = useNavigate();
  const [eligibility, setEligibility] = useState<EligibilityType | null>(null);
  const [appraisal, setAppraisal] = useState<FinancialAppraisal | null>(null);
  const [transitions, setTransitions] = useState<StageTransition[]>([]);
  const [advancing, setAdvancing] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const currentStageIndex = PIPELINE_STAGES.findIndex((s) => s.value === project.stage);
  const nextStage = currentStageIndex < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[currentStageIndex + 1] : null;
  const prevStage = currentStageIndex > 0 ? PIPELINE_STAGES[currentStageIndex - 1] : null;
  const deadline = activeDeadline(project);

  useEffect(() => {
    if (view !== 'overview') return;
    getEligibility(project.id).then(setEligibility).catch(() => setEligibility(null));
    getAppraisal(project.id).then(setAppraisal).catch(() => setAppraisal(null));
    listTransitions(project.id).then(setTransitions).catch(() => setTransitions([]));
  }, [project.id, view, project.stage]);

  const handleStageMove = async (stage: PipelineStage) => {
    if (advancing) return;
    setAdvancing(true);
    setStageError(null);
    try {
      await changeStage(project.id, stage);
      // Entering a deadline-bearing stage starts its statutory clock — default
      // the date to today so the countdown is live immediately (editable below).
      if (stage === 'prior_approval_submitted' && !project.pa_submitted_date) {
        await updateProject(project.id, { pa_submitted_date: todayIso() });
      } else if (stage === 'approved' && !project.pa_decision_date) {
        await updateProject(project.id, { pa_decision_date: todayIso() });
      }
      onProjectUpdated();
    } catch {
      setStageError('Could not change the stage — check your connection and try again.');
    } finally {
      setAdvancing(false);
    }
  };

  const handleDateChange = async (field: 'pa_submitted_date' | 'pa_decision_date', value: string) => {
    try {
      await updateProject(project.id, { [field]: value || null });
      onProjectUpdated();
    } catch {
      setStageError('Could not save the date — check your connection and try again.');
    }
  };

  if (view === 'eligibility') {
    return (
      <div>
        <Link
          to={`/projects/${project.id}`}
          style={{ display: 'inline-block', margin: '16px 24px', padding: '8px 16px', background: '#1e3a5f', color: '#93c5fd', border: '1px solid #2563eb', borderRadius: 6, fontSize: 13, textDecoration: 'none' }}
        >
          ← Back to project
        </Link>
        <div style={{ padding: '0 24px 24px', maxWidth: 960, margin: '0 auto' }}>
          <EligibilityWizard project={project} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <Link
        to="/"
        style={{ display: 'inline-block', padding: '8px 16px', background: 'transparent', color: '#93c5fd', border: '1px solid #1e3a5f', borderRadius: 6, fontSize: 13, marginBottom: 20, textDecoration: 'none' }}
      >
        ← Back to pipeline
      </Link>

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ color: '#e2e8f0', fontSize: 20, margin: '0 0 8px 0' }}>{project.address_raw}</h2>
          <button
            onClick={() => setEditing((e) => !e)}
            style={{ padding: '6px 14px', background: editing ? '#1e3a5f' : 'transparent', color: '#93c5fd', border: '1px solid #1e3a5f', borderRadius: 6, cursor: 'pointer', fontSize: 13, flexShrink: 0 }}
          >
            {editing ? 'Close' : 'Edit'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', color: '#94a3b8', fontSize: 14 }}>
          <span>£{(project.price_pence / 100).toLocaleString()}</span>
          <span>{formatUseClass(project.use_class)}</span>
          {project.address_postcode && <span>{project.address_postcode}</span>}
          {project.floor_area_sqm && <span>{project.floor_area_sqm.toLocaleString()} m²</span>}
          {project.tenure !== 'unknown' && <span>{humanise(project.tenure)}</span>}
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
        {project.image_urls.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {project.image_urls.slice(0, 6).map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Listing photo ${i + 1} of ${project.address_raw}`}
                loading="lazy"
                referrerPolicy="no-referrer"
                style={{ height: 90, borderRadius: 6, border: '1px solid #1e3a5f', objectFit: 'cover', flexShrink: 0 }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ))}
          </div>
        )}
        {editing && (
          <EditProjectForm
            project={project}
            onSaved={() => {
              setEditing(false);
              onProjectUpdated();
            }}
            onCancel={() => setEditing(false)}
          />
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
        <h3 style={{ color: '#e2e8f0', fontSize: 16, margin: '0 0 20px 0' }}>Pipeline stage</h3>

        <div style={{ position: 'relative' }}>
          {/* Track between first and last node centres */}
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: `${100 / (2 * PIPELINE_STAGES.length)}%`,
              right: `${100 / (2 * PIPELINE_STAGES.length)}%`,
              height: 2,
              background: '#1e3a5f',
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: `${100 / (2 * PIPELINE_STAGES.length)}%`,
              width: `calc(${100 - 100 / PIPELINE_STAGES.length}% * ${currentStageIndex / (PIPELINE_STAGES.length - 1)})`,
              height: 2,
              background: '#2563eb',
              zIndex: 1,
              transition: 'width 0.3s ease',
            }}
          />

          <div style={{ display: 'flex', position: 'relative', zIndex: 2 }}>
            {PIPELINE_STAGES.map((stage, i) => {
              const isCompleted = i < currentStageIndex;
              const isCurrent = i === currentStageIndex;
              return (
                <div
                  key={stage.value}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}
                >
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
                      border: isCurrent || isCompleted ? '2px solid #2563eb' : '2px solid #1e3a5f',
                      color: isCompleted ? '#fff' : isCurrent ? '#60a5fa' : '#64748b',
                      transition: 'all 0.3s ease',
                      boxShadow: isCurrent ? '0 0 0 4px rgba(37, 99, 235, 0.2)' : 'none',
                    }}
                  >
                    {isCompleted ? '✓' : i + 1}
                  </div>
                  <span
                    style={{
                      marginTop: 8,
                      fontSize: 11,
                      fontWeight: isCurrent ? 600 : 400,
                      color: isCompleted ? '#60a5fa' : isCurrent ? '#e2e8f0' : '#8b95a5',
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
              {STAGE_HINTS[project.stage] && (
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>{STAGE_HINTS[project.stage]}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {prevStage && (
                <button
                  onClick={() => handleStageMove(prevStage.value)}
                  disabled={advancing}
                  style={{
                    padding: '8px 14px',
                    background: 'transparent',
                    color: '#94a3b8',
                    border: '1px solid #1e3a5f',
                    borderRadius: 6,
                    cursor: advancing ? 'default' : 'pointer',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ← {prevStage.label}
                </button>
              )}
              {nextStage && (
                <button
                  onClick={() => handleStageMove(nextStage.value)}
                  disabled={advancing}
                  style={{
                    padding: '8px 16px',
                    background: advancing ? '#1e3a5f' : '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: advancing ? 'default' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {advancing ? 'Moving…' : `Advance → ${nextStage.label}`}
                </button>
              )}
            </div>
          </div>
          {stageError && (
            <p role="alert" style={{ color: '#f87171', fontSize: 13, margin: '10px 0 0' }}>{stageError}</p>
          )}

          {/* Statutory deadline tracking */}
          {(project.stage === 'prior_approval_submitted' ||
            project.stage === 'approved' ||
            project.stage === 'in_conversion') && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #1e3a5f', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              {project.stage === 'prior_approval_submitted' && (
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  Application submitted
                  <input
                    type="date"
                    value={project.pa_submitted_date ?? ''}
                    onChange={(e) => void handleDateChange('pa_submitted_date', e.target.value)}
                    style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', padding: '4px 8px', fontSize: 13 }}
                  />
                </label>
              )}
              {(project.stage === 'approved' || project.stage === 'in_conversion') && (
                <label style={{ color: '#94a3b8', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  Approval decision date
                  <input
                    type="date"
                    value={project.pa_decision_date ?? ''}
                    onChange={(e) => void handleDateChange('pa_decision_date', e.target.value)}
                    style={{ background: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 4, color: '#e2e8f0', padding: '4px 8px', fontSize: 13 }}
                  />
                </label>
              )}
              {deadline && (
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    background: deadline.status === 'overdue' ? '#450a0a' : deadline.status === 'warning' ? '#3b2f1e' : '#0f2a1e',
                    color: deadline.status === 'overdue' ? '#ef4444' : deadline.status === 'warning' ? '#fbbf24' : '#22c55e',
                  }}
                >
                  {deadline.chip} · due {deadline.due}
                </span>
              )}
            </div>
          )}
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
              : '#94a3b8'
          }
          buttonLabel={eligibility ? 'Review assessment' : 'Run assessment'}
          onClick={() => navigate(`/projects/${project.id}/eligibility`)}
          highlighted={project.stage === 'opportunity_identified'}
        />

        <ActionCard
          title="Financial Appraisal"
          description="Unit mix, conversion costs, finance, cashflow, and exit strategy"
          status={appraisal ? 'Saved' : 'Not Started'}
          statusColor={appraisal ? '#22c55e' : '#94a3b8'}
          buttonLabel={appraisal ? 'Review appraisal' : 'Start appraisal'}
          onClick={() => navigate(`/projects/${project.id}/calculator`)}
          highlighted={project.stage === 'eligibility_assessed' || project.stage === 'financial_appraisal'}
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

      {/* Activity timeline */}
      {transitions.length > 0 && (
        <div
          style={{
            background: '#0a1628',
            border: '1px solid #1e3a5f',
            borderRadius: 10,
            padding: 24,
            marginTop: 24,
          }}
        >
          <h3 style={{ color: '#e2e8f0', fontSize: 16, margin: '0 0 16px 0' }}>Activity</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {transitions.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? '#2563eb' : '#1e3a5f', marginTop: 6, flexShrink: 0 }} />
                  {i < transitions.length - 1 && <span style={{ width: 2, flex: 1, background: '#1e3a5f' }} />}
                </div>
                <div style={{ paddingBottom: i < transitions.length - 1 ? 16 : 0 }}>
                  <div style={{ color: '#e2e8f0', fontSize: 13 }}>
                    {t.from_stage
                      ? `${humanise(t.from_stage)} → ${humanise(t.to_stage)}`
                      : `Added to pipeline at ${humanise(t.to_stage)}`}
                  </div>
                  {t.notes && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{t.notes}</div>}
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                    {new Date(t.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EditProjectForm({
  project,
  onSaved,
  onCancel,
}: {
  project: Project;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [addressRaw, setAddressRaw] = useState(project.address_raw);
  const [postcode, setPostcode] = useState(project.address_postcode ?? '');
  const [pricePounds, setPricePounds] = useState(String(project.price_pence / 100));
  const [useClass, setUseClass] = useState<UseClass>(project.use_class);
  const [floorAreaSqm, setFloorAreaSqm] = useState(project.floor_area_sqm != null ? String(project.floor_area_sqm) : '');
  const [floors, setFloors] = useState(project.floors != null ? String(project.floors) : '');
  const [tenure, setTenure] = useState<Tenure>(project.tenure);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    background: '#0f1d32',
    border: '1px solid #1e3a5f',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 14,
  };
  const labelStyle = { color: '#94a3b8', fontSize: 13, marginBottom: 4, display: 'block' as const };

  const price = parseFloat(pricePounds);
  const valid = addressRaw.trim().length > 0 && Number.isFinite(price) && price >= 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateProject(project.id, {
        address_raw: addressRaw.trim(),
        address_postcode: postcode.trim() || null,
        price_pence: Math.round(price * 100),
        use_class: useClass,
        floor_area_sqm: floorAreaSqm ? parseFloat(floorAreaSqm) : null,
        floors: floors ? parseInt(floors, 10) : null,
        tenure,
      });
      onSaved();
    } catch {
      setError('Could not save the changes — check your connection and try again.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #1e3a5f', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label htmlFor="edit-address" style={labelStyle}>Address *</label>
        <input id="edit-address" style={inputStyle} value={addressRaw} onChange={(e) => setAddressRaw(e.target.value)} />
      </div>
      <div>
        <label htmlFor="edit-postcode" style={labelStyle}>Postcode</label>
        <input id="edit-postcode" style={inputStyle} value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="E.g. SW1A 1AA" />
      </div>
      <div>
        <label htmlFor="edit-price" style={labelStyle}>Price (£) *</label>
        <input id="edit-price" style={inputStyle} type="number" min={0} value={pricePounds} onChange={(e) => setPricePounds(e.target.value)} />
      </div>
      <div>
        <label htmlFor="edit-use-class" style={labelStyle}>Use Class</label>
        <select id="edit-use-class" style={inputStyle} value={useClass} onChange={(e) => setUseClass(e.target.value as UseClass)}>
          {USE_CLASS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="edit-floor-area" style={labelStyle}>Floor Area (m²)</label>
        <input id="edit-floor-area" style={inputStyle} type="number" min={0} value={floorAreaSqm} onChange={(e) => setFloorAreaSqm(e.target.value)} />
      </div>
      <div>
        <label htmlFor="edit-floors" style={labelStyle}>Number of Floors</label>
        <input id="edit-floors" style={inputStyle} type="number" min={0} value={floors} onChange={(e) => setFloors(e.target.value)} />
      </div>
      <div>
        <label htmlFor="edit-tenure" style={labelStyle}>Tenure</label>
        <select id="edit-tenure" style={inputStyle} value={tenure} onChange={(e) => setTenure(e.target.value as Tenure)}>
          {TENURE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={!valid || saving}
          style={{ padding: '8px 20px', background: valid ? '#2563eb' : '#1e293b', color: valid ? '#fff' : '#8b95a5', border: 'none', borderRadius: 6, cursor: valid && !saving ? 'pointer' : 'default', fontSize: 13, fontWeight: 600 }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ padding: '8px 16px', background: 'transparent', color: '#94a3b8', border: '1px solid #1e3a5f', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
        >
          Cancel
        </button>
        {error && <span role="alert" style={{ color: '#f87171', fontSize: 13 }}>{error}</span>}
      </div>
    </form>
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
      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#e2e8f0', fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
