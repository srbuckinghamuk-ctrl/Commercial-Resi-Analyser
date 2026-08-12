import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Project } from '../types';
import type { CalculatorInputs, AppraisalMetrics, CashflowResult } from '../lib/conversion-types';
import { defaultCalculatorInputs } from '../lib/conversion-defaults';
import { calculateAppraisal } from '../lib/conversion-calc-engine';
import { buildCashflow } from '../lib/conversion-cashflow';
import { normaliseSnapshot } from '../lib/snapshot';
import { createAppraisal, getAppraisal, updateAppraisal, isNotFound } from '../lib/api';

import AcquisitionPage from './calculator/AcquisitionPage';
import UnitMixPage from './calculator/UnitMixPage';
import ConversionCostsPage from './calculator/ConversionCostsPage';
import FinancePage from './calculator/FinancePage';
import CashflowPage from './calculator/CashflowPage';
import AppraisalSummaryPage from './calculator/AppraisalSummaryPage';
import ScenariosPage from './calculator/ScenariosPage';
import ExitStrategyPage from './calculator/ExitStrategyPage';
import RiskRegisterPage from './calculator/RiskRegisterPage';
import InvestorSummaryPage from './calculator/InvestorSummaryPage';

type CalcPage =
  | 'acquisition'
  | 'unit_mix'
  | 'conversion_costs'
  | 'finance'
  | 'cashflow'
  | 'appraisal'
  | 'scenarios'
  | 'exit_strategy'
  | 'risk_register'
  | 'investor_summary';

const PAGES: { key: CalcPage; label: string; num: number }[] = [
  { key: 'acquisition', label: 'Acquisition', num: 1 },
  { key: 'unit_mix', label: 'Unit Mix', num: 2 },
  { key: 'conversion_costs', label: 'Costs', num: 3 },
  { key: 'finance', label: 'Finance', num: 4 },
  { key: 'cashflow', label: 'Cashflow', num: 5 },
  { key: 'appraisal', label: 'Appraisal', num: 6 },
  { key: 'scenarios', label: 'Scenarios', num: 7 },
  { key: 'exit_strategy', label: 'Exit', num: 8 },
  { key: 'risk_register', label: 'Risk', num: 9 },
  { key: 'investor_summary', label: 'Investor', num: 10 },
];

interface Props {
  project: Project | null;
}

type LoadState = 'loading' | 'ready' | 'error';

export default function ConversionCalculator({ project }: Props) {
  const [activePage, setActivePage] = useState<CalcPage>('acquisition');
  const [inputs, setInputs] = useState<CalculatorInputs>(() =>
    defaultCalculatorInputs(project ?? undefined),
  );
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const autosaveTimer = useRef<number | null>(null);
  // Latest props/state for effects keyed on the project *id* — background
  // refetches mint new project object identities and must not reset edits.
  const projectRef = useRef(project);
  projectRef.current = project;
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const loadSeq = useRef(0);

  const projectId = project?.id ?? null;

  const loadAppraisal = useCallback(() => {
    const proj = projectRef.current;
    if (!proj) return;
    const seq = ++loadSeq.current;
    setLoadState('loading');
    setInputs(defaultCalculatorInputs(proj));
    setSavedId(null);
    setSaveError(null);
    setDirty(false);
    getAppraisal(proj.id)
      .then((appraisal) => {
        if (seq !== loadSeq.current) return;
        const restored = normaliseSnapshot(appraisal.inputs_snapshot);
        if (restored) {
          setInputs(restored);
          setSavedId(appraisal.id);
        }
        setLoadState('ready');
      })
      .catch((e) => {
        if (seq !== loadSeq.current) return;
        if (isNotFound(e)) {
          // No saved appraisal yet — start from defaults.
          setLoadState('ready');
        } else {
          // A transient failure must NOT fall through to defaults: saving
          // over the top would silently destroy the stored appraisal.
          setLoadState('error');
        }
      });
  }, []);

  useEffect(() => {
    if (projectId) loadAppraisal();
  }, [projectId, loadAppraisal]);

  const metrics: AppraisalMetrics = useMemo(() => calculateAppraisal(inputs), [inputs]);
  const cashflow: CashflowResult = useMemo(() => buildCashflow(inputs), [inputs]);

  const updateInputs = useCallback((partial: Partial<CalculatorInputs>) => {
    setInputs((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!project || loadState !== 'ready') return;
    setSaving(true);
    setSaveError(null);
    const sentInputs = inputs;
    try {
      const payload = {
        project_id: project.id,
        name: `Appraisal — ${project.address_raw}`,
        inputs_snapshot: inputs as unknown as Record<string, unknown>,
        gdv_pence: metrics.total_gdv_pence,
        total_cost_pence: metrics.total_cost_pence,
        profit_on_cost_pct: metrics.profit_on_cost_pct,
        profit_on_gdv_pct: metrics.profit_on_gdv_pct,
        return_on_equity_pct: metrics.return_on_equity_pct,
        irr: metrics.irr_annual,
        rlv_pence: metrics.rlv_pence,
      };
      if (savedId) {
        await updateAppraisal(project.id, payload);
      } else {
        const result = await createAppraisal(payload);
        setSavedId(result.id);
      }
      // Edits typed while the request was in flight are NOT in the payload
      // just sent — only mark clean when nothing changed since.
      if (inputsRef.current === sentInputs) {
        setDirty(false);
      }
    } catch {
      setSaveError('Could not save the appraisal — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }, [project, inputs, metrics, savedId, loadState]);

  // Autosave: persist edits a few seconds after the user stops typing —
  // from the very first edit, so tab switches and refreshes lose nothing.
  useEffect(() => {
    if (!dirty || saving || loadState !== 'ready') return;
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void handleSave();
    }, 2500);
    return () => {
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    };
  }, [dirty, saving, loadState, handleSave]);

  // Warn before the browser tab closes with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 150px)' }}>
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
        {loadState === 'error' && (
          <div
            role="alert"
            style={{
              padding: '12px 16px',
              marginBottom: 16,
              background: '#450a0a',
              border: '1px solid #ef4444',
              borderRadius: 8,
              color: '#fca5a5',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>
              Could not load the saved appraisal — your saved data is untouched. Saving is
              disabled until it loads, so nothing gets overwritten.
            </span>
            <button
              onClick={loadAppraisal}
              style={{
                padding: '6px 14px',
                background: '#1e3a5f',
                color: '#e2e8f0',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                whiteSpace: 'nowrap',
              }}
            >
              Retry
            </button>
          </div>
        )}
        {activePage === 'acquisition' && (
          <AcquisitionPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'unit_mix' && (
          <UnitMixPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'conversion_costs' && (
          <ConversionCostsPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'finance' && (
          <FinancePage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'cashflow' && (
          <CashflowPage inputs={inputs} cashflow={cashflow} />
        )}
        {activePage === 'appraisal' && (
          <AppraisalSummaryPage metrics={metrics} inputs={inputs} />
        )}
        {activePage === 'scenarios' && (
          <ScenariosPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'exit_strategy' && (
          <ExitStrategyPage inputs={inputs} onChange={updateInputs} metrics={metrics} />
        )}
        {activePage === 'risk_register' && (
          <RiskRegisterPage inputs={inputs} onChange={updateInputs} />
        )}
        {activePage === 'investor_summary' && (
          <InvestorSummaryPage inputs={inputs} metrics={metrics} cashflow={cashflow} project={project} />
        )}
      </div>

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saveError ? (
            <span role="alert" style={{ color: '#f87171', fontSize: 13 }}>{saveError}</span>
          ) : (
            <span style={{ color: dirty ? '#f59e0b' : '#22c55e', fontSize: 13 }}>
              {loadState === 'loading' ? 'Loading…' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedId ? 'Saved' : ''}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || loadState !== 'ready'}
            style={{
              padding: '8px 24px',
              background: saving || loadState !== 'ready' ? '#1e293b' : '#2563eb',
              color: saving || loadState !== 'ready' ? '#8b95a5' : '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: saving || loadState !== 'ready' ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {saving ? 'Saving…' : savedId ? 'Update Appraisal' : 'Save Appraisal'}
          </button>
        </div>
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
