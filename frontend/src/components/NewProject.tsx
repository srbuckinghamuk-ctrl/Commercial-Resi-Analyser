import { useState, useCallback } from 'react';
import type { Project, ProjectCreate, UseClass, Tenure, ScrapeStatus } from '../types';
import { USE_CLASS_OPTIONS, TENURE_OPTIONS } from '../types';
import { scrapeUrl, createProject } from '../lib/api';

interface NewProjectProps {
  onProjectCreated: (project: Project) => void;
}

const SUPPORTED_SITES = 'Rightmove Commercial, Savills Auctions, Allsop and EIG';

export default function NewProject({ onProjectCreated }: NewProjectProps) {
  const [mode, setMode] = useState<'url' | 'manual'>('url');
  const [url, setUrl] = useState('');
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const [addressRaw, setAddressRaw] = useState('');
  const [addressPostcode, setAddressPostcode] = useState('');
  const [pricePounds, setPricePounds] = useState('');
  const [useClass, setUseClass] = useState<UseClass>('office');
  const [floorAreaSqm, setFloorAreaSqm] = useState('');
  const [floors, setFloors] = useState('');
  const [tenure, setTenure] = useState<Tenure>('unknown');
  const [description, setDescription] = useState('');
  const [isVacant, setIsVacant] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [showValidation, setShowValidation] = useState(false);

  const price = parseFloat(pricePounds);
  const addressValid = addressRaw.trim().length > 0;
  const priceValid = pricePounds.trim().length > 0 && Number.isFinite(price) && price >= 0;
  const formValid = addressValid && priceValid;

  const handleScrape = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!url.trim() || scrapeStatus === 'loading') return;
      setScrapeStatus('loading');
      setErrorMsg('');
      try {
        const response = await scrapeUrl(url.trim());
        if (response.error) {
          setScrapeStatus('error');
          setErrorMsg(response.error);
        } else if (response.listing) {
          const l = response.listing;
          setAddressRaw(l.address.raw || '');
          setAddressPostcode(l.address.postcode || '');
          setPricePounds(l.price.amount ? String(l.price.amount / 100) : '');
          setUseClass(l.use_class || 'unknown');
          setFloorAreaSqm(l.floor_area_sqm ? String(l.floor_area_sqm) : '');
          setFloors(l.floors ? String(l.floors) : '');
          setTenure(l.tenure || 'unknown');
          setDescription(l.description || '');
          setIsVacant(l.is_vacant ?? false);
          setScrapeStatus('success');
          setMode('manual');
        } else {
          setScrapeStatus('error');
          setErrorMsg(`Could not extract listing data from this page. Supported sites: ${SUPPORTED_SITES}.`);
        }
      } catch {
        setScrapeStatus('error');
        setErrorMsg('The scrape failed — check the URL and your connection, then try again.');
      }
    },
    [url, scrapeStatus],
  );

  const handleManualSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setShowValidation(true);
      if (!formValid || saveStatus === 'saving') return;
      setSaveStatus('saving');
      try {
        const data: ProjectCreate = {
          address_raw: addressRaw.trim(),
          address_postcode: addressPostcode.trim() || undefined,
          price_pence: Math.round(price * 100),
          use_class: useClass,
          floor_area_sqm: floorAreaSqm ? parseFloat(floorAreaSqm) : undefined,
          floors: floors ? parseInt(floors, 10) : undefined,
          tenure,
          description: description || undefined,
          is_vacant: isVacant,
        };
        const project = await createProject(data);
        onProjectCreated(project);
      } catch {
        setSaveStatus('error');
      }
    },
    [formValid, saveStatus, addressRaw, addressPostcode, price, useClass, floorAreaSqm, floors, tenure, description, isVacant, onProjectCreated],
  );

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
  const fieldErrorStyle = { color: '#f87171', fontSize: 12, marginTop: 4 };

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <h2 style={{ color: '#e2e8f0', fontSize: 20, marginBottom: 16 }}>New Project</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setMode('url')}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: mode === 'url' ? '#2563eb' : '#1e3a5f',
            color: '#e2e8f0',
          }}
        >
          Scrape URL
        </button>
        <button
          onClick={() => setMode('manual')}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: mode === 'manual' ? '#2563eb' : '#1e3a5f',
            color: '#e2e8f0',
          }}
        >
          Manual Entry
        </button>
      </div>

      {mode === 'url' && (
        <form onSubmit={handleScrape}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (scrapeStatus === 'error') {
                  setScrapeStatus('idle');
                  setErrorMsg('');
                }
              }}
              placeholder="Paste a listing URL…"
              aria-label="Listing URL"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              type="submit"
              disabled={scrapeStatus === 'loading' || !url.trim()}
              style={{
                padding: '8px 20px',
                background: url.trim() ? '#2563eb' : '#1e293b',
                color: url.trim() ? '#fff' : '#8b95a5',
                border: 'none',
                borderRadius: 6,
                cursor: scrapeStatus === 'loading' || !url.trim() ? 'default' : 'pointer',
              }}
            >
              {scrapeStatus === 'loading' ? 'Scraping…' : 'Scrape'}
            </button>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>
            Works with listings from {SUPPORTED_SITES}. Other sites: use Manual Entry.
          </p>
          {scrapeStatus === 'error' && (
            <p role="alert" style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>{errorMsg}</p>
          )}
          {scrapeStatus === 'success' && (
            <p style={{ color: '#22c55e', marginTop: 8, fontSize: 13 }}>
              Listing scraped — review details below and save.
            </p>
          )}
        </form>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleManualSave} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="np-address" style={labelStyle}>Address *</label>
            <input
              id="np-address"
              style={inputStyle}
              value={addressRaw}
              onChange={(e) => {
                setAddressRaw(e.target.value);
                if (saveStatus === 'error') setSaveStatus('idle');
              }}
              placeholder="Full address"
            />
            {showValidation && !addressValid && <p style={fieldErrorStyle}>Enter the property address.</p>}
          </div>
          <div>
            <label htmlFor="np-postcode" style={labelStyle}>Postcode</label>
            <input id="np-postcode" style={inputStyle} value={addressPostcode} onChange={(e) => setAddressPostcode(e.target.value)} placeholder="E.g. SW1A 1AA" />
            <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
              Needed for the automated eligibility checks and the map.
            </p>
          </div>
          <div>
            <label htmlFor="np-price" style={labelStyle}>Price (£) *</label>
            <input
              id="np-price"
              style={inputStyle}
              type="number"
              min={0}
              value={pricePounds}
              onChange={(e) => {
                setPricePounds(e.target.value);
                if (saveStatus === 'error') setSaveStatus('idle');
              }}
              placeholder="Guide / asking price"
            />
            {showValidation && !priceValid && <p style={fieldErrorStyle}>Enter the asking or guide price (0 or more).</p>}
          </div>
          <div>
            <label htmlFor="np-use-class" style={labelStyle}>Use Class</label>
            <select id="np-use-class" style={inputStyle} value={useClass} onChange={(e) => setUseClass(e.target.value as UseClass)}>
              {USE_CLASS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
              The use class decides which Permitted Development route applies — worth getting right.
            </p>
          </div>
          <div>
            <label htmlFor="np-floor-area" style={labelStyle}>Floor Area (m²)</label>
            <input id="np-floor-area" style={inputStyle} type="number" min={0} value={floorAreaSqm} onChange={(e) => setFloorAreaSqm(e.target.value)} />
          </div>
          <div>
            <label htmlFor="np-floors" style={labelStyle}>Number of Floors</label>
            <input id="np-floors" style={inputStyle} type="number" min={0} value={floors} onChange={(e) => setFloors(e.target.value)} />
          </div>
          <div>
            <label htmlFor="np-tenure" style={labelStyle}>Tenure</label>
            <select id="np-tenure" style={inputStyle} value={tenure} onChange={(e) => setTenure(e.target.value as Tenure)}>
              {TENURE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="np-description" style={labelStyle}>Description</label>
            <textarea id="np-description" style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input id="np-vacant" type="checkbox" checked={isVacant} onChange={(e) => setIsVacant(e.target.checked)} />
            <label htmlFor="np-vacant" style={{ color: '#e2e8f0', fontSize: 14, cursor: 'pointer' }}>Property is currently vacant</label>
          </div>
          <button
            type="submit"
            disabled={saveStatus === 'saving'}
            style={{
              padding: '10px 24px',
              background: formValid ? '#2563eb' : '#1e293b',
              color: formValid ? '#fff' : '#8b95a5',
              border: 'none',
              borderRadius: 6,
              cursor: saveStatus === 'saving' ? 'default' : 'pointer',
              marginTop: 8,
              alignSelf: 'flex-start',
            }}
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Create Project'}
          </button>
          {saveStatus === 'error' && (
            <p role="alert" style={{ color: '#ef4444', fontSize: 13 }}>
              Could not create the project — check your connection and try again.
            </p>
          )}
        </form>
      )}
    </div>
  );
}
