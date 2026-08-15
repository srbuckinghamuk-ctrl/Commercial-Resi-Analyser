import type { ScrapeStatus } from '../types';

const IS = { background: '#07111f', border: '1px solid #162840', color: '#b8d4ee', padding: '9px 12px', fontSize: 12, borderRadius: 4, outline: 'none', fontFamily: 'inherit', flex: 1 };

interface UrlBarProps {
  url: string;
  status: ScrapeStatus;
  errorMsg: string | null;
  onUrlChange: (value: string) => void;
  onScrape: () => void;
}

export function UrlBar({ url, status, errorMsg, onUrlChange, onScrape }: UrlBarProps) {
  const isLoading = status === 'loading';

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="url"
          value={url}
          onChange={e => onUrlChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !isLoading) onScrape(); }}
          placeholder="Paste an auction listing URL and click Scrape..."
          style={IS}
          disabled={isLoading}
        />
        <button
          onClick={onScrape}
          disabled={isLoading || url.trim() === ''}
          style={{
            background: isLoading || url.trim() === '' ? '#0a1828' : '#1a3a5c',
            color: isLoading || url.trim() === '' ? '#2a5878' : '#b8d4ee',
            border: '1px solid #162840',
            borderRadius: 4,
            padding: '9px 20px',
            fontSize: 12,
            cursor: isLoading || url.trim() === '' ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 0.5,
          }}
        >
          {isLoading ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg style={{ animation: 'spin 1s linear infinite', height: 14, width: 14 }} viewBox="0 0 24 24" fill="none">
                <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Scraping...
            </span>
          ) : 'Scrape'}
        </button>
      </div>
      {status === 'error' && errorMsg && (
        <p style={{ marginTop: 6, fontSize: 11, color: '#e05050' }}>{errorMsg}</p>
      )}
    </div>
  );
}
