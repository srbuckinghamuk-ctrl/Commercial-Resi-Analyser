import { useState, useCallback } from 'react';
import type { ProjectCreate, UseClass, Tenure, ScrapeStatus } from '../types';
import { USE_CLASS_OPTIONS, TENURE_OPTIONS } from '../types';
import { scrapeUrl, createProject } from '../lib/api';

interface NewProjectProps {
  onProjectCreated: () => void;
}

export default function NewProject({ onProjectCreated }: NewProjectProps) {
  const [mode, setMode] = useState<'url' | 'manual'>('url');
  const [url, setUrl] = useState('');
  const [scrapeStatus, setScrapeStatus] = useState<ScrapeStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const [addressRaw, setAddressRaw] = useState('');
  const [addressPostcode, setAddressPostcode] = useState('');
  const [pricePounds, setPricePounds] = useState('');
  const [useClass, setUseClass] = useState<UseClass>('office');
  const [floorAreaSqft, setFloorAreaSqft] = useState('');
  const [floors, setFloors] = useState('');
  const [tenure, setTenure] = useState<Tenure>('unknown');
  const [description, setDescription] = useState('');
  const [isVacant, setIsVacant] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleScrape = useCallback(async () => {
    if (!url.trim()) return;
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
        setFloorAreaSqft(l.floor_area_sqft ? String(l.floor_area_sqft) : '');
        setFloors(l.floors ? String(l.floors) : '');
        setTenure(l.tenure || 'unknown');
        setDescription(l.description || '');
        setIsVacant(l.is_vacant ?? false);
        setScrapeStatus('success');
        setMode('manual');
      } else {
        setScrapeStatus('error');
        setErrorMsg('Could not extract listing data from this page.');
      }
    } catch (e) {
      setScrapeStatus('error');
      setErrorMsg(e instanceof Error ? e.message : 'Scrape failed');
    }
  }, [url]);

  const handleManualSave = useCallback(async () => {
    if (!addressRaw.trim() || !pricePounds.trim()) return;
    setSaveStatus('saving');
    try {
      const data: ProjectCreate = {
        address_raw: addressRaw,
        address_postcode: addressPostcode || undefined,
        price_pence: Math.round(parseFloat(pricePounds) * 100),
        use_class: useClass,
        floor_area_sqft: floorAreaSqft ? parseFloat(floorAreaSqft) : undefined,
        floors: floors ? parseInt(floors, 10) : undefined,
        tenure,
        description: description || undefined,
        is_vacant: isVacant,
      };
      await createProject(data);
      setSaveStatus('saved');
      onProjectCreated();
    } catch {
      setSaveStatus('error');
    }
  }, [addressRaw, addressPostcode, pricePounds, useClass, floorAreaSqft, floors, tenure, description, isVacant, onProjectCreated]);

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

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
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
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste commercial property URL..."
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleScrape}
              disabled={scrapeStatus === 'loading'}
              style={{
                padding: '8px 20px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {scrapeStatus === 'loading' ? 'Scraping...' : 'Scrape'}
            </button>
          </div>
          {scrapeStatus === 'error' && (
            <p style={{ color: '#ef4444', marginTop: 8, fontSize: 13 }}>{errorMsg}</p>
          )}
          {scrapeStatus === 'success' && (
            <p style={{ color: '#22c55e', marginTop: 8, fontSize: 13 }}>
              Listing scraped — review details below and save.
            </p>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Address *</label>
            <input style={inputStyle} value={addressRaw} onChange={(e) => setAddressRaw(e.target.value)} placeholder="Full address" />
          </div>
          <div>
            <label style={labelStyle}>Postcode</label>
            <input style={inputStyle} value={addressPostcode} onChange={(e) => setAddressPostcode(e.target.value)} placeholder="E.g. SW1A 1AA" />
          </div>
          <div>
            <label style={labelStyle}>Price (£) *</label>
            <input style={inputStyle} type="number" value={pricePounds} onChange={(e) => setPricePounds(e.target.value)} placeholder="Guide / asking price" />
          </div>
          <div>
            <label style={labelStyle}>Use Class</label>
            <select style={inputStyle} value={useClass} onChange={(e) => setUseClass(e.target.value as UseClass)}>
              {USE_CLASS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Floor Area (sq ft)</label>
            <input style={inputStyle} type="number" value={floorAreaSqft} onChange={(e) => setFloorAreaSqft(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Number of Floors</label>
            <input style={inputStyle} type="number" value={floors} onChange={(e) => setFloors(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Tenure</label>
            <select style={inputStyle} value={tenure} onChange={(e) => setTenure(e.target.value as Tenure)}>
              {TENURE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, minHeight: 80 }} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={isVacant} onChange={(e) => setIsVacant(e.target.checked)} />
            <label style={{ color: '#e2e8f0', fontSize: 14 }}>Property is currently vacant</label>
          </div>
          <button
            onClick={handleManualSave}
            disabled={saveStatus === 'saving' || !addressRaw.trim() || !pricePounds.trim()}
            style={{
              padding: '10px 24px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              marginTop: 8,
              alignSelf: 'flex-start',
            }}
          >
            {saveStatus === 'saving' ? 'Saving...' : 'Create Project'}
          </button>
          {saveStatus === 'saved' && (
            <p style={{ color: '#22c55e', fontSize: 13 }}>Project created successfully</p>
          )}
          {saveStatus === 'error' && (
            <p style={{ color: '#ef4444', fontSize: 13 }}>Failed to create project</p>
          )}
        </div>
      )}
    </div>
  );
}
