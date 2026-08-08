import { useState, useCallback, useMemo, useEffect } from 'react';
import type { FormState, ScrapeStatus, DealReview, RefurbAppraisal } from './types';
import { EMPTY_FORM } from './types';
import { UrlBar } from './components/UrlBar';
import { scrapeUrl, saveDeal, updateDeal, listDeals, deleteDeal, saveAppraisal, listAppraisals, updateAppraisal, deleteAppraisal } from './lib/api';
import type { NormalizedListing } from './types';
import { PropertyForm } from './components/PropertyForm';
import { MetricsPanel } from './components/MetricsPanel';
import { computeMetrics, calcIRR } from './lib/calculations';
import { Dashboard } from './components/Dashboard';
import { RefurbCalculator } from './components/RefurbCalculator';
import { ExportPage } from './components/ExportPage';

function listingToForm(listing: NormalizedListing): FormState {
  return {
    address: listing.address.raw ?? '',
    postcode: '',
    guidePrice: listing.price.guide_price != null
      ? (listing.price.guide_price / 100).toString()
      : '',
    propertyType: listing.property_type ?? 'unknown',
    bedrooms: listing.bedrooms?.toString() ?? '',
    floorAreaSqft: listing.floor_area_sqft?.toString() ?? '',
    floorAreaSqm: listing.floor_area_sqm?.toString() ?? '',
    existingGiaSqm: '',
    tenure: listing.tenure ?? 'unknown',
    epcRating: listing.epc_rating ?? '',
    councilTaxBand: listing.council_tax_band ?? '',
    lotNumber: listing.auction?.lot_number ?? '',
    auctionDate: listing.auction?.auction_date?.slice(0, 10) ?? '',
    auctionHouse: listing.auction?.auction_house ?? '',
    onlineBidding: listing.auction?.online_bidding ?? false,
    leaseLength: listing.lease?.lease_length_years?.toString() ?? '',
    groundRent: listing.lease?.ground_rent_pa != null
      ? (listing.lease.ground_rent_pa / 100).toString()
      : '',
    serviceCharge: listing.lease?.service_charge_pa != null
      ? (listing.lease.service_charge_pa / 100).toString()
      : '',
    annualRent: '',
    legalFees: '1500',
    survey: '500',
    resaleValue: '',
    refurbBudget: '',
    additionalProperty: false,
    holdingPeriod: '5',
  };
}

export default function App() {
  // Existing state
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ScrapeStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Phase 3: tab, deal identity, deal name, deals list
  const [activeTab, setActiveTab] = useState<'analyser' | 'dashboard' | 'refurb' | 'export'>('analyser');
  const [savedDealId, setSavedDealId] = useState<string | null>(null);
  const [dealName, setDealName] = useState('');
  const [deals, setDeals] = useState<DealReview[]>([]);

  // Phase 3: save feedback
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Refurb appraisals
  const [appraisals, setAppraisals] = useState<RefurbAppraisal[]>([]);
  const [refurbLoadTrigger, setRefurbLoadTrigger] = useState<{
    inputs: Record<string, unknown>;
    appraisalId: string | null;
    version: number;
  } | null>(null);

  const [backendOffline, setBackendOffline] = useState(false);

  // Load deals and appraisals on mount
  useEffect(() => {
    let failed = 0;
    listDeals()
      .then(d => { setDeals(d); setBackendOffline(false); })
      .catch(() => { failed++; if (failed >= 2) setBackendOffline(true); });
    listAppraisals()
      .then(a => { setAppraisals(a); setBackendOffline(false); })
      .catch(() => { failed++; if (failed >= 2) setBackendOffline(true); });
  }, []);

  const handleFormChange = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const metrics = useMemo(() => computeMetrics(form), [form]);

  const irr = useMemo(() => {
    const p = (s: string) => parseFloat(s) || 0;
    return calcIRR(
      metrics.totalAcquisitionCost,
      p(form.annualRent),
      p(form.resaleValue),
      parseInt(form.holdingPeriod, 10) || 5,
    );
  }, [metrics.totalAcquisitionCost, form.annualRent, form.resaleValue, form.holdingPeriod]);

  const handleScrape = useCallback(async () => {
    if (!url.trim()) return;
    setStatus('loading');
    setErrorMsg(null);
    try {
      const data = await scrapeUrl(url.trim());
      if (data.error) {
        setErrorMsg(data.error);
        setStatus('error');
      } else if (data.listing) {
        const newForm = listingToForm(data.listing);
        setForm(newForm);
        setDealName(newForm.address);  // pre-fill deal name from address
        setSavedDealId(null);          // clear any previously loaded deal
        setSaveStatus('idle');
        setStatus('success');
      } else {
        setErrorMsg('Scrape returned no data. Please try again.');
        setStatus('error');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unexpected error during scrape.');
      setStatus('error');
    }
  }, [url]);

  const [globalError, setGlobalError] = useState<string | null>(null);

  const handleNewDeal = useCallback(() => {
    setForm(EMPTY_FORM);
    setSavedDealId(null);
    setDealName('');
    setSaveStatus('idle');
    setSaveError(null);
    setStatus('idle');
    setUrl('');
    setErrorMsg(null);
    setActiveTab('analyser');
  }, []);

  const handleLoadDeal = useCallback((deal: DealReview) => {
    setForm(deal.form_snapshot as FormState);
    setSavedDealId(deal.id);
    setDealName(deal.deal_name);
    setSaveStatus('idle');
    setSaveError(null);
    setStatus('success');
    setActiveTab('analyser');
  }, []);

  const buildSavePayload = useCallback(() => {
    return {
      listing_id: null,
      deal_name: dealName || form.address || 'Untitled Deal',
      form_snapshot: form as unknown as Record<string, unknown>,
      sdlt: Math.round(metrics.sdlt * 100),
      total_acquisition_cost: Math.round(metrics.totalAcquisitionCost * 100),
      gross_rental_yield: metrics.grossRentalYield,
      flip_profit: Math.round(metrics.flipProfit * 100),
      irr: irr,
      holding_period_years: parseInt(form.holdingPeriod, 10) || 5,
    };
  }, [dealName, form, metrics, irr]);

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      let saved: DealReview;
      if (savedDealId) {
        saved = await updateDeal(savedDealId, buildSavePayload());
      } else {
        saved = await saveDeal(buildSavePayload());
        setSavedDealId(saved.id);
      }
      // Refresh deals list
      const refreshed = await listDeals();
      setDeals(refreshed);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      setSaveStatus('error');
    }
  }, [savedDealId, buildSavePayload]);

  const handleSaveAsNew = useCallback(async () => {
    setSavedDealId(null);
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const saved = await saveDeal(buildSavePayload());
      setSavedDealId(saved.id);
      const refreshed = await listDeals();
      setDeals(refreshed);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
      setSaveStatus('error');
    }
  }, [buildSavePayload]);

  const handleDeleteDeal = useCallback(async (id: string) => {
    try {
      await deleteDeal(id);
      setDeals(prev => prev.filter(d => d.id !== id));
      if (savedDealId === id) {
        setSavedDealId(null);
        setSaveStatus('idle');
      }
    } catch {
      setGlobalError('Failed to delete deal. Please try again.');
      setTimeout(() => setGlobalError(null), 4000);
    }
  }, [savedDealId]);

  const handleSaveRefurbProject = useCallback(async (data: {
    name: string;
    inputs: Record<string, unknown>;
    summary: Record<string, number | null>;
    appraisalId: string | null;
  }): Promise<string> => {
    // Auto-assign project_id if not set
    if (!data.inputs.project_id) {
      let maxNum = 0;
      for (const a of appraisals) {
        const id = a.inputs_snapshot.project_id as string | undefined;
        if (id) {
          const m = id.match(/^UKP-(\d+)$/);
          if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
        }
      }
      data.inputs.project_id = `UKP-${String(maxNum + 1).padStart(3, '0')}`;
    }
    const existingStage = data.appraisalId
      ? appraisals.find(a => a.id === data.appraisalId)?.inputs_snapshot.__stage
      : undefined;
    const inputs_snapshot = existingStage
      ? { ...data.inputs, __stage: existingStage }
      : data.inputs;
    const payload = {
      name: data.name,
      inputs_snapshot,
      net_profit: data.summary.netProfitAmount != null ? Math.round(data.summary.netProfitAmount * 100) : null,
      margin_pct: data.summary.netProfitPercent ?? null,
      irr_equity: data.summary.irr ?? null,
    };
    let savedId: string;
    if (data.appraisalId) {
      await updateAppraisal(data.appraisalId, payload);
      savedId = data.appraisalId;
    } else {
      const created = await saveAppraisal(payload);
      savedId = created.id;
    }
    const refreshed = await listAppraisals();
    setAppraisals(refreshed);
    return savedId;
  }, [appraisals]);

  const handleLoadAppraisal = useCallback((appraisal: RefurbAppraisal) => {
    setRefurbLoadTrigger({
      inputs: appraisal.inputs_snapshot,
      appraisalId: appraisal.id,
      version: Date.now(),
    });
    setActiveTab('refurb');
  }, []);

  const handleDeleteAppraisal = useCallback(async (id: string) => {
    try {
      await deleteAppraisal(id);
      setAppraisals(prev => prev.filter(a => a.id !== id));
    } catch {
      setGlobalError('Failed to delete appraisal. Please try again.');
      setTimeout(() => setGlobalError(null), 4000);
    }
  }, []);

  const handlePromoteAppraisal = useCallback(async (id: string) => {
    const appraisal = appraisals.find(a => a.id === id);
    if (!appraisal) return;
    try {
      await updateAppraisal(id, {
        inputs_snapshot: { ...appraisal.inputs_snapshot, __stage: 'due_diligence' },
      });
      const refreshed = await listAppraisals();
      setAppraisals(refreshed);
    } catch {
      setGlobalError('Failed to promote project. Please try again.');
      setTimeout(() => setGlobalError(null), 4000);
    }
  }, [appraisals]);

  const handlePromoteToBid = useCallback(async (id: string) => {
    const appraisal = appraisals.find(a => a.id === id);
    if (!appraisal) return;
    try {
      await updateAppraisal(id, {
        inputs_snapshot: { ...appraisal.inputs_snapshot, __stage: 'final_bid' },
      });
      const refreshed = await listAppraisals();
      setAppraisals(refreshed);
    } catch {
      setGlobalError('Failed to promote project. Please try again.');
      setTimeout(() => setGlobalError(null), 4000);
    }
  }, [appraisals]);

  const handlePromoteToApproved = useCallback(async (id: string) => {
    const appraisal = appraisals.find(a => a.id === id);
    if (!appraisal) return;
    try {
      await updateAppraisal(id, {
        inputs_snapshot: { ...appraisal.inputs_snapshot, __stage: 'approved_to_bid' },
      });
      const refreshed = await listAppraisals();
      setAppraisals(refreshed);
    } catch {
      setGlobalError('Failed to promote project. Please try again.');
      setTimeout(() => setGlobalError(null), 4000);
    }
  }, [appraisals]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #3a78b8' : '2px solid transparent',
    color: active ? '#6ab0e8' : '#2a5878',
    padding: '12px 18px',
    cursor: 'pointer',
    fontSize: 11,
    letterSpacing: 0.5,
    fontFamily: 'inherit',
    fontWeight: active ? 700 : 400,
  });

  return (
    <div style={{ fontFamily: "'Georgia', serif", background: '#050d18', minHeight: '100vh', color: '#b0ccec' }}>
      {/* Top nav */}
      <nav style={{ background: '#040c17', borderBottom: '1px solid #0e1e30', display: 'flex', alignItems: 'center', padding: '0 0 0 18px', position: 'sticky', top: 0, zIndex: 100, boxShadow: '0 2px 20px #000a' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#4a88c8', marginRight: 24, letterSpacing: 2, whiteSpace: 'nowrap' }}>◈ UK PROPERTY</div>
        <button type="button" onClick={() => setActiveTab('dashboard')} style={tabStyle(activeTab === 'dashboard')}>
          Project Pipeline
          {(deals.length + appraisals.length) > 0 && (
            <span style={{ marginLeft: 6, fontSize: 9, background: '#0a1e30', color: '#5aaae0', border: '1px solid #1a4060', borderRadius: 8, padding: '1px 6px' }}>
              {deals.length + appraisals.length}
            </span>
          )}
        </button>
        <button type="button" onClick={() => setActiveTab('analyser')} style={tabStyle(activeTab === 'analyser')}>Project Data</button>
        <button type="button" onClick={() => setActiveTab('refurb')} style={tabStyle(activeTab === 'refurb')}>Development Calculator</button>
        <button type="button" onClick={() => setActiveTab('export')} style={tabStyle(activeTab === 'export')}>Export</button>
        <div style={{ marginLeft: 'auto', paddingRight: 18 }}>
          <button type="button" onClick={handleNewDeal} style={{ background: 'transparent', border: '1px solid #1a4060', color: '#5aaae0', cursor: 'pointer', fontSize: 10, borderRadius: 4, padding: '5px 12px', fontFamily: 'inherit' }}>+ New Deal</button>
        </div>
      </nav>

      {backendOffline && (
        <div style={{ background: '#1a0a0a', border: '1px solid #502020', color: '#e06060', padding: '8px 18px', fontSize: 11, textAlign: 'center' }}>
          Backend not reachable — saved projects and scraping unavailable. Check the server is running.
        </div>
      )}
      {globalError && (
        <div style={{ position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)', background: '#1a0a0a', border: '1px solid #502020', color: '#e06060', padding: '8px 18px', fontSize: 11, borderRadius: 6, zIndex: 200, boxShadow: '0 4px 20px #000a' }}>
          {globalError}
        </div>
      )}
      <div style={{ padding: '24px 28px', maxWidth: 1380, margin: '0 auto' }}>
        {/* Analyser tab */}
        {activeTab === 'analyser' && (
          <>
            <UrlBar
              url={url}
              status={status}
              errorMsg={errorMsg}
              onUrlChange={setUrl}
              onScrape={handleScrape}
            />
            {(status === 'idle' || status === 'success') && (
              <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 340px', gap: 28, alignItems: 'start' }}>
                <PropertyForm form={form} onChange={handleFormChange} />
                <MetricsPanel
                  metrics={metrics}
                  additionalProperty={form.additionalProperty}
                  onToggleAdditionalProperty={v => handleFormChange('additionalProperty', v)}
                  irr={irr}
                  savedDealId={savedDealId}
                  dealName={dealName}
                  onDealNameChange={setDealName}
                  onSave={handleSave}
                  onSaveAsNew={handleSaveAsNew}
                  saveStatus={saveStatus}
                  saveError={saveError}
                />
              </div>
            )}
          </>
        )}

        {/* Dashboard tab */}
        {activeTab === 'dashboard' && (
          <Dashboard
            deals={deals}
            onLoadDeal={handleLoadDeal}
            onDeleteDeal={handleDeleteDeal}
            appraisals={appraisals}
            onLoadAppraisal={handleLoadAppraisal}
            onDeleteAppraisal={handleDeleteAppraisal}
            onPromoteAppraisal={handlePromoteAppraisal}
            onPromoteToBid={handlePromoteToBid}
            onPromoteToApproved={handlePromoteToApproved}
          />
        )}

        {/* Export tab */}
        {activeTab === 'export' && (
          <ExportPage deals={deals} appraisals={appraisals} />
        )}

        {/* Refurb Calculator tab */}
        {activeTab === 'refurb' && (
          <RefurbCalculator
            guidePrice={form.guidePrice}
            floorAreaSqm={form.floorAreaSqm}
            existingGiaSqm={form.existingGiaSqm}
            projectName={[form.lotNumber, form.address].filter(Boolean).join(' — ')}
            onGuidePriceChange={val => handleFormChange('guidePrice', val)}
            onFloorAreaSqmChange={val => handleFormChange('floorAreaSqm', val)}
            onExistingGiaSqmChange={val => handleFormChange('existingGiaSqm', val)}
            loadTrigger={refurbLoadTrigger}
            onSaveProject={handleSaveRefurbProject}
            onExitProject={() => { setRefurbLoadTrigger(null); setActiveTab('dashboard'); }}
          />
        )}
      </div>
    </div>
  );
}
