import { useState, useMemo, useCallback, useEffect } from 'react';
import type { Project, FinancialAppraisal, FinancialAppraisalCreate } from '../types';
import { runAppraisal, migrateInputsToV4 } from '../lib/model';
import type { AppraisalRun, CalculatorInputsV4 } from '../lib/model';
import { defaultCalculatorInputsV4 } from '../lib/conversion-defaults';
import { getAppraisal, saveAppraisal, ApiError, formatApiErrorDetail } from '../lib/api';

import AcquisitionPage from './calculator/AcquisitionPage';
import UnitMixPage from './calculator/UnitMixPage';
import ConversionCostsPage from './calculator/ConversionCostsPage';
import FinancePage from './calculator/FinancePage';
import ProgrammePage from './calculator/ProgrammePage';
import CashflowPage from './calculator/CashflowPage';
import AppraisalSummaryPage from './calculator/AppraisalSummaryPage';
import ScenariosPage from './calculator/ScenariosPage';
import ExitStrategyPage from './calculator/ExitStrategyPage';
import RiskRegisterPage from './calculator/RiskRegisterPage';
import DealSpiderPage from './calculator/DealSpiderPage';
import InvestorSummaryPage from './calculator/InvestorSummaryPage';

type CalcPage =
  | 'acquisition'
  | 'unit_mix'
  | 'conversion_costs'
  | 'finance'
  | 'programme'
  | 'cashflow'
  | 'appraisal'
  | 'scenarios'
  | 'exit_strategy'
  | 'risk_register'
  | 'deal_spider'
  | 'investor_summary';

const PAGES: { key: CalcPage; label: string; num: number }[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1 },
  { key: 'unit_mix', label: 'Unit Mix', num: 2 },
  { key: 'conversion_costs', label: 'Costs', num: 3 },
  { key: 'finance', label: 'Finance', num: 4 },
  { key: 'programme', label: 'Programme', num: 5 },
  { key: 'cashflow', label: 'Cashflow', num: 6 },
  { key: 'appraisal', label: 'Appraisal', num: 7 },
  { key: 'scenarios', label: 'Scenarios', num: 8 },
  { key: 'exit_strategy', label: 'Exit', num: 9 },
  { key: 'risk_register', label: 'Risk', num: 10 },
  { key: 'deal_spider', label: 'Deal Spider', num: 11 },
  { key: 'investor_summary', label: 'Investor', num: 12 },
];

interface Props {
  project: Project | null;
}

/** Renders an ApiError as newline-joined lines: the summary followed by any
 * field-level messages from a 422/validation `detail` payload. */
function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const lines = formatApiErrorDetail(err.detail);
    return lines.length > 0 ? lines.join('\n') : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

const STATUS_BANNER: Record<
  'reconciled' | 'draft' | 'legacy_unreconciled',
  { label: string; color: string; background: string }
> = {
  reconciled: { label: 'Reconciled', color: '#22c55e', background: 'rgba(34, 197, 94, 0.12)' },
  draft: { label: 'Draft — unreconciled', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)' },
  legacy_unreconciled: {
    label: 'Legacy — recalculation required, save to migrate',
    color: '#ef4444',
    background: 'rgba(239, 68, 68, 0.12)',
  },
};

export default function ConversionCalculator({ project }: Props) {
  const [activePage, setActivePage] = useState<CalcPage>('acquisition');
  const [inputs, setInputs] = useState<CalculatorInputsV4>(() =>
    defaultCalculatorInputsV4(project ?? undefined),
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [appraisalRecord, setAppraisalRecord] = useState<FinancialAppraisal | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setInputs(defaultCalculatorInputsV4(project));
      setSavedId(null);
      setAppraisalRecord(null);
      setSaveError(null);
      setLoadError(null);
      getAppraisal(project.id)
        .then((appraisal) => {
          if (appraisal.inputs_snapshot && typeof appraisal.inputs_snapshot === 'object') {
            // Migrate onto v4 defaults so snapshots saved before newer
            // sections (or v1/v2/v3 snapshots) existed still load cleanly. The
            // live runAppraisal(inputs) result below is always the display
            // source -- stored legacy columns are never shown as current,
            // even when status is 'legacy_unreconciled'; the next save
            // migrates the stored record.
            setInputs(migrateInputsToV4(appraisal.inputs_snapshot as Record<string, unknown>, project));
            setSavedId(appraisal.id);
          }
          setAppraisalRecord(appraisal);
        })
        .catch((err) => {
          // No appraisal saved yet for this project is expected, not an error.
          if (err instanceof ApiError && err.status === 404) return;
          setLoadError(describeApiError(err, 'Failed to load the saved appraisal.'));
        });
    }
  }, [project]);

  // R3b: state is v4-native, so the engine is fed `inputs` directly -- no
  // widening call site needed any more.
  const run: AppraisalRun = useMemo(() => runAppraisal(inputs), [inputs]);

  const updateInputs = useCallback((partial: Partial<CalculatorInputsV4>) => {
    setInputs((prev) => ({ ...prev, ...partial }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    setSaveError(null);
    try {
      // inputs_snapshot is always v4 (R3b: this component's state is v4-native); the
      // seven client metric fields are used server-side ONLY to record mismatches for
      // audit -- the server always recalculates and persists its own values (Task 12).
      const payload: FinancialAppraisalCreate = {
        project_id: project.id,
        name: `Appraisal — ${project.address_raw}`,
        inputs_snapshot: inputs as unknown as Record<string, unknown>,
        gdv_pence: run.metrics.gdv_pence,
        total_cost_pence: run.metrics.total_development_cost_pence,
        profit_on_cost_pct: run.metrics.profit_on_cost_pct ?? undefined,
        profit_on_gdv_pct: run.metrics.profit_on_gdv_pct ?? undefined,
        return_on_equity_pct: run.metrics.return_on_equity_pct ?? undefined,
        irr: run.metrics.irr_annual_pct ?? undefined,
        rlv_pence: run.metrics.rlv_pence,
      };
      const result = await saveAppraisal(project.id, payload, savedId);
      setSavedId(result.id);
      setAppraisalRecord(result);
    } catch (err) {
      setSaveError(describeApiError(err, 'Failed to save the appraisal.'));
    } finally {
      setSaving(false);
    }
  }, [project, inputs, run, savedId]);

  const pageIndex = PAGES.findIndex((p) => p.key === activePage);

  const goNext = useCallback(() => {
    if (pageIndex < PAGES.length - 1) setActivePage(PAGES[pageIndex + 1].key);
  }, [pageIndex]);

  const goPrev = useCallback(() => {
    if (pageIndex > 0) setActivePage(PAGES[pageIndex - 1].key);
  }, [pageIndex]);

  if (!project) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>Conversion Calculator</h2>
        <p style={{ color: '#94a3b8' }}>Select a project from the Pipeline tab to start a financial appraisal.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Sub-nav */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid #1e3a5f',
          background: '#0d1b2a',
          overflowX: 'auto',
          flexShrink: 0,
        }}
      >
        {PAGES.map((page) => (
          <button
            key={page.key}
            onClick={() => setActivePage(page.key)}
            style={{
              padding: '8px 14px',
              border: 'none',
              borderBottom: activePage === page.key ? '2px solid #2563eb' : '2px solid transparent',
              background: 'transparent',
              color: activePage === page.key ? '#e2e8f0' : '#64748b',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activePage === page.key ? 600 : 400,
              whiteSpace: 'nowrap',
            }}
          >
            {page.num}. {page.label}
          </button>
        ))}
      </div>

      {/* Page content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {activePage === 'acquisition' && (
          <AcquisitionPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'unit_mix' && (
          <UnitMixPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'conversion_costs' && (
          <ConversionCostsPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'finance' && (
          <FinancePage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'programme' && (
          <ProgrammePage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'cashflow' && (
          <CashflowPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'appraisal' && (
          <AppraisalSummaryPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'scenarios' && (
          <ScenariosPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'exit_strategy' && (
          <ExitStrategyPage inputs={inputs} onChange={updateInputs} run={run} />
        )}
        {activePage === 'risk_register' && (
          <RiskRegisterPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'deal_spider' && (
          <DealSpiderPage inputs={inputs} onChange={updateInputs} project={project} />
        )}
        {activePage === 'investor_summary' && (
          <InvestorSummaryPage inputs={inputs} run={run} project={project} />
        )}
      </div>

      {/* Status / error banners */}
      {(appraisalRecord?.status || saveError || loadError) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 24px',
            borderTop: '1px solid #1e3a5f',
            background: '#0d1b2a',
            flexShrink: 0,
          }}
        >
          {appraisalRecord?.status && (
            <div
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                color: STATUS_BANNER[appraisalRecord.status].color,
                background: STATUS_BANNER[appraisalRecord.status].background,
                border: `1px solid ${STATUS_BANNER[appraisalRecord.status].color}`,
              }}
            >
              {STATUS_BANNER[appraisalRecord.status].label}
              {(appraisalRecord.validation?.client_mismatches?.length ?? 0) > 0 && (
                <span style={{ fontWeight: 400, marginLeft: 8 }}>
                  ({appraisalRecord.validation!.client_mismatches.length} client metric{' '}
                  {appraisalRecord.validation!.client_mismatches.length === 1 ? 'mismatch' : 'mismatches'}{' '}
                  recorded for audit)
                </span>
              )}
            </div>
          )}
          {loadError && (
            <div
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 13,
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Failed to load saved appraisal</div>
              {loadError.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
          {saveError && (
            <div
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 13,
                color: '#f87171',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Save failed</div>
              {saveError.split('\n').map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer nav */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '12px 24px',
          borderTop: '1px solid #1e3a5f',
          background: '#0d1b2a',
          flexShrink: 0,
        }}
      >
        <button
          onClick={goPrev}
          disabled={pageIndex === 0}
          style={{
            padding: '8px 20px',
            background: pageIndex === 0 ? '#1e293b' : '#1e3a5f',
            color: pageIndex === 0 ? '#475569' : '#e2e8f0',
            border: 'none',
            borderRadius: 6,
            cursor: pageIndex === 0 ? 'default' : 'pointer',
            fontSize: 14,
          }}
        >
          Previous
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '8px 24px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {saving ? 'Saving...' : savedId ? 'Update Appraisal' : 'Save Appraisal'}
        </button>
        <button
          onClick={goNext}
          disabled={pageIndex === PAGES.length - 1}
          style={{
            padding: '8px 20px',
            background: pageIndex === PAGES.length - 1 ? '#1e293b' : '#1e3a5f',
            color: pageIndex === PAGES.length - 1 ? '#475569' : '#e2e8f0',
            border: 'none',
            borderRadius: 6,
            cursor: pageIndex === PAGES.length - 1 ? 'default' : 'pointer',
            fontSize: 14,
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
