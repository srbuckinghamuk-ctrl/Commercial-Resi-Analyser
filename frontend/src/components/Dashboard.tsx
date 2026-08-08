import { useState } from 'react';
import type { DealReview, RefurbAppraisal, RefurbProjectSummary } from '../types';
import { formatIRR } from '../lib/calculations';

type SortKey = 'irr' | 'gross_rental_yield' | 'flip_profit' | 'total_acquisition_cost' | 'auctionDate';
type AppraisalSortKey = 'irr' | 'equityRequired' | 'projectCost' | 'gdv' | 'dealScore' | 'netProfitAmount' | 'netProfitPercent' | 'auctionDate';
type SortDir = 'asc' | 'desc';

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

function getSummary(appraisal: RefurbAppraisal): RefurbProjectSummary | null {
  const s = appraisal.inputs_snapshot.__summary as RefurbProjectSummary | undefined;
  if (!s) return null;
  return s;
}

interface DashboardProps {
  deals: DealReview[];
  onLoadDeal: (deal: DealReview) => void;
  onDeleteDeal: (id: string) => void;
  appraisals: RefurbAppraisal[];
  onLoadAppraisal: (appraisal: RefurbAppraisal) => void;
  onDeleteAppraisal: (id: string) => void;
  onPromoteAppraisal: (id: string) => void;
  onPromoteToBid: (id: string) => void;
  onPromoteToApproved: (id: string) => void;
}

export function Dashboard({ deals, onLoadDeal, onDeleteDeal, appraisals, onLoadAppraisal, onDeleteAppraisal, onPromoteAppraisal, onPromoteToBid, onPromoteToApproved }: DashboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>('irr');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [appraisalSortKey, setAppraisalSortKey] = useState<AppraisalSortKey>('irr');
  const [appraisalSortDir, setAppraisalSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function handleAppraisalSort(key: AppraisalSortKey) {
    if (appraisalSortKey === key) {
      setAppraisalSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setAppraisalSortKey(key);
      setAppraisalSortDir('desc');
    }
  }

  const sorted = [...deals].sort((a, b) => {
    let aVal: number | null;
    let bVal: number | null;
    if (sortKey === 'auctionDate') {
      const snap = (x: DealReview) => (x.form_snapshot as unknown as Record<string, string>).auctionDate;
      const ad = snap(a); const bd = snap(b);
      aVal = ad ? new Date(ad).getTime() : null;
      bVal = bd ? new Date(bd).getTime() : null;
    } else {
      aVal = a[sortKey];
      bVal = b[sortKey];
    }
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return sortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  function getAppraisalSortValue(appraisal: RefurbAppraisal, key: AppraisalSortKey): number | null {
    const s = getSummary(appraisal);
    switch (key) {
      case 'irr': return s?.irr ?? appraisal.irr_equity ?? null;
      case 'equityRequired': return s?.equityRequired ?? null;
      case 'projectCost': return s?.projectCost ?? null;
      case 'gdv': return s?.gdv ?? null;
      case 'dealScore': return s?.dealScore ?? null;
      case 'netProfitAmount': return s?.netProfitAmount ?? (appraisal.net_profit != null ? appraisal.net_profit / 100 : null);
      case 'netProfitPercent': return s?.netProfitPercent ?? appraisal.margin_pct ?? null;
      case 'auctionDate': {
        const d = appraisal.inputs_snapshot.auction_date as string | undefined;
        return d ? new Date(d).getTime() : null;
      }
    }
  }

  const screeningAppraisals = appraisals.filter(a => a.inputs_snapshot.__stage !== 'due_diligence' && a.inputs_snapshot.__stage !== 'final_bid' && a.inputs_snapshot.__stage !== 'approved_to_bid');
  const dueDiligenceAppraisals = appraisals.filter(a => a.inputs_snapshot.__stage === 'due_diligence');
  const finalBidAppraisals = appraisals.filter(a => a.inputs_snapshot.__stage === 'final_bid');
  const approvedToBidAppraisals = appraisals.filter(a => a.inputs_snapshot.__stage === 'approved_to_bid');

  const sortedAppraisals = [...screeningAppraisals].sort((a, b) => {
    const aVal = getAppraisalSortValue(a, appraisalSortKey);
    const bVal = getAppraisalSortValue(b, appraisalSortKey);
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return appraisalSortDir === 'desc' ? bVal - aVal : aVal - bVal;
  });

  function handleDelete(deal: DealReview) {
    if (window.confirm(`Delete "${deal.deal_name}"? This cannot be undone.`)) {
      onDeleteDeal(deal.id);
    }
  }

  function handleDeleteAppraisal(appraisal: RefurbAppraisal) {
    if (window.confirm(`Delete "${appraisal.name}"? This cannot be undone.`)) {
      onDeleteAppraisal(appraisal.id);
    }
  }

  const thBase: React.CSSProperties = { textAlign: 'left', fontSize: 9, fontWeight: 700, color: '#2a5878', textTransform: 'uppercase', letterSpacing: 1, padding: '10px 12px', background: '#040c17', borderBottom: '1px solid #0e1e30' };
  const thSort: React.CSSProperties = { ...thBase, cursor: 'pointer', userSelect: 'none' };

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span style={{ marginLeft: 4 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  function appraisalSortIndicator(key: AppraisalSortKey) {
    if (appraisalSortKey !== key) return null;
    return <span style={{ marginLeft: 4 }}>{appraisalSortDir === 'desc' ? '↓' : '↑'}</span>;
  }

  const scoreColor = (score: number | null) => {
    if (score == null) return '#2a5878';
    if (score >= 7) return '#1acc70';
    if (score >= 5) return '#cc8030';
    return '#cc3030';
  };

  return (
    <div style={{ marginTop: 28 }}>
      {/* ── Initial Screening ── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#5aaae0', letterSpacing: 1 }}>Initial Screening</h2>
          <span style={{ fontSize: 10, color: '#2a5878' }}>{screeningAppraisals.length} project{screeningAppraisals.length !== 1 ? 's' : ''} saved</span>
        </div>

        {screeningAppraisals.length === 0 ? (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, padding: '32px 24px', textAlign: 'center', color: '#2a5878', fontSize: 12 }}>
            No saved projects yet. Open the Development Calculator and click Save Project to get started.
          </div>
        ) : (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thBase}>ID</th>
                  <th style={thBase}>Project</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('auctionDate')}>Auction Date{appraisalSortIndicator('auctionDate')}</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('irr')}>IRR{appraisalSortIndicator('irr')}</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('equityRequired')}>Equity Required{appraisalSortIndicator('equityRequired')}</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('projectCost')}>Project Cost{appraisalSortIndicator('projectCost')}</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('gdv')}>GDV{appraisalSortIndicator('gdv')}</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('dealScore')}>Deal Score{appraisalSortIndicator('dealScore')}</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('netProfitAmount')}>Net Profit (£){appraisalSortIndicator('netProfitAmount')}</th>
                  <th style={thSort} onClick={() => handleAppraisalSort('netProfitPercent')}>Net Profit (%){appraisalSortIndicator('netProfitPercent')}</th>
                  <th style={thBase}>Saved</th>
                  <th style={thBase}></th>
                  <th style={thBase}></th>
                </tr>
              </thead>
              <tbody>
                {sortedAppraisals.map(appraisal => {
                  const s = getSummary(appraisal);
                  const auctionDateRaw = appraisal.inputs_snapshot.auction_date as string | undefined;
                  const appraisalAuctionDate = auctionDateRaw
                    ? new Date(auctionDateRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';
                  const savedDate = new Date(appraisal.updated_at ?? appraisal.created_at).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  });
                  return (
                    <tr
                      key={appraisal.id}
                      style={{ borderBottom: '1px solid #0e1e30', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#0a1828')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => onLoadAppraisal(appraisal)}
                    >
                      <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{(appraisal.inputs_snapshot.project_id as string) || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontWeight: 600 }}>{appraisal.name}</td>
                      <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{appraisalAuctionDate}</td>
                      <td style={{ padding: '9px 12px', color: '#30ddaa', fontWeight: 700, fontFamily: 'monospace' }}>
                        {s?.irr != null ? `${s.irr.toFixed(1)}%` : (appraisal.irr_equity != null ? `${appraisal.irr_equity.toFixed(1)}%` : '—')}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.equityRequired != null ? gbp.format(s.equityRequired) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.projectCost != null ? gbp.format(s.projectCost) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.gdv != null ? gbp.format(s.gdv) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.dealScore != null
                          ? <span style={{ color: scoreColor(s.dealScore), fontWeight: 700 }}>{s.dealScore.toFixed(1)}<span style={{ color: '#2a5878', fontWeight: 400 }}>/10</span></span>
                          : <span style={{ color: '#2a5878' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.netProfitAmount != null
                          ? <span style={{ color: s.netProfitAmount >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(s.netProfitAmount)}</span>
                          : (appraisal.net_profit != null ? <span style={{ color: appraisal.net_profit >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(appraisal.net_profit / 100)}</span> : <span style={{ color: '#2a5878' }}>—</span>)
                        }
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.netProfitPercent != null
                          ? <span style={{ color: s.netProfitPercent >= 0 ? '#1acc70' : '#cc3030' }}>{s.netProfitPercent.toFixed(1)}%</span>
                          : (appraisal.margin_pct != null ? <span style={{ color: appraisal.margin_pct >= 0 ? '#1acc70' : '#cc3030' }}>{appraisal.margin_pct.toFixed(1)}%</span> : <span style={{ color: '#2a5878' }}>—</span>)
                        }
                      </td>
                      <td style={{ padding: '9px 12px', color: '#2a5878', fontSize: 10 }}>{savedDate}</td>
                      <td
                        style={{ padding: '9px 12px' }}
                        onClick={e => { e.stopPropagation(); onPromoteAppraisal(appraisal.id); }}
                      >
                        <button
                          style={{ background: 'transparent', border: '1px solid #1a4060', color: '#5aaae0', cursor: 'pointer', fontSize: 10, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap' }}
                          title="Move to Due Diligence Approval"
                          type="button"
                          onMouseEnter={e => { e.currentTarget.style.background = '#0a1e30'; e.currentTarget.style.color = '#8acaff'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#5aaae0'; }}
                        >
                          → Due Diligence
                        </button>
                      </td>
                      <td
                        style={{ padding: '9px 12px' }}
                        onClick={e => { e.stopPropagation(); handleDeleteAppraisal(appraisal); }}
                      >
                        <button
                          style={{ background: 'transparent', border: 'none', color: '#2a5878', cursor: 'pointer', fontSize: 13 }}
                          title="Delete project"
                          type="button"
                          onMouseEnter={e => (e.currentTarget.style.color = '#e05050')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#2a5878')}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Due Diligence Approval ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#5aaae0', letterSpacing: 1 }}>Due Diligence Approval</h2>
          <span style={{ fontSize: 10, color: '#2a5878' }}>{deals.length + dueDiligenceAppraisals.length} item{(deals.length + dueDiligenceAppraisals.length) !== 1 ? 's' : ''}</span>
        </div>

        {deals.length === 0 && dueDiligenceAppraisals.length === 0 ? (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, padding: '32px 24px', textAlign: 'center', color: '#2a5878', fontSize: 12 }}>
            No items yet. Save a deal or promote a project from Initial Screening.
          </div>
        ) : (
          <>
          {dueDiligenceAppraisals.length > 0 && (
            <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, overflow: 'hidden', marginBottom: deals.length > 0 ? 16 : 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thBase}>ID</th>
                  <th style={thBase}>Project</th>
                    <th style={thBase}>Auction Date</th>
                    <th style={thBase}>IRR</th>
                    <th style={thBase}>Equity Required</th>
                    <th style={thBase}>Project Cost</th>
                    <th style={thBase}>GDV</th>
                    <th style={thBase}>Deal Score</th>
                    <th style={thBase}>Net Profit (£)</th>
                    <th style={thBase}>Net Profit (%)</th>
                    <th style={thBase}>Saved</th>
                    <th style={thBase}></th>
                    <th style={thBase}></th>
                  </tr>
                </thead>
                <tbody>
                  {dueDiligenceAppraisals.map(appraisal => {
                    const s = getSummary(appraisal);
                    const auctionDateRaw = appraisal.inputs_snapshot.auction_date as string | undefined;
                    const appraisalAuctionDate = auctionDateRaw
                      ? new Date(auctionDateRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—';
                    const savedDate = new Date(appraisal.updated_at ?? appraisal.created_at).toLocaleDateString('en-GB', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    });
                    return (
                      <tr
                        key={appraisal.id}
                        style={{ borderBottom: '1px solid #0e1e30', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#0a1828')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={() => onLoadAppraisal(appraisal)}
                      >
                        <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{(appraisal.inputs_snapshot.project_id as string) || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontWeight: 600 }}>{appraisal.name}</td>
                        <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{appraisalAuctionDate}</td>
                        <td style={{ padding: '9px 12px', color: '#30ddaa', fontWeight: 700, fontFamily: 'monospace' }}>
                          {s?.irr != null ? `${s.irr.toFixed(1)}%` : (appraisal.irr_equity != null ? `${appraisal.irr_equity.toFixed(1)}%` : '—')}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                          {s?.equityRequired != null ? gbp.format(s.equityRequired) : '—'}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                          {s?.projectCost != null ? gbp.format(s.projectCost) : '—'}
                        </td>
                        <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                          {s?.gdv != null ? gbp.format(s.gdv) : '—'}
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                          {s?.dealScore != null
                            ? <span style={{ color: scoreColor(s.dealScore), fontWeight: 700 }}>{s.dealScore.toFixed(1)}<span style={{ color: '#2a5878', fontWeight: 400 }}>/10</span></span>
                            : <span style={{ color: '#2a5878' }}>—</span>
                          }
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                          {s?.netProfitAmount != null
                            ? <span style={{ color: s.netProfitAmount >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(s.netProfitAmount)}</span>
                            : (appraisal.net_profit != null ? <span style={{ color: appraisal.net_profit >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(appraisal.net_profit / 100)}</span> : <span style={{ color: '#2a5878' }}>—</span>)
                          }
                        </td>
                        <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                          {s?.netProfitPercent != null
                            ? <span style={{ color: s.netProfitPercent >= 0 ? '#1acc70' : '#cc3030' }}>{s.netProfitPercent.toFixed(1)}%</span>
                            : (appraisal.margin_pct != null ? <span style={{ color: appraisal.margin_pct >= 0 ? '#1acc70' : '#cc3030' }}>{appraisal.margin_pct.toFixed(1)}%</span> : <span style={{ color: '#2a5878' }}>—</span>)
                          }
                        </td>
                        <td style={{ padding: '9px 12px', color: '#2a5878', fontSize: 10 }}>{savedDate}</td>
                        <td
                          style={{ padding: '9px 12px' }}
                          onClick={e => { e.stopPropagation(); onPromoteToBid(appraisal.id); }}
                        >
                          <button
                            style={{ background: 'transparent', border: '1px solid #1a4060', color: '#5aaae0', cursor: 'pointer', fontSize: 10, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap' }}
                            title="Move to Final Bid Approval"
                            type="button"
                            onMouseEnter={e => { e.currentTarget.style.background = '#0a1e30'; e.currentTarget.style.color = '#8acaff'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#5aaae0'; }}
                          >
                            → Final Bid
                          </button>
                        </td>
                        <td
                          style={{ padding: '9px 12px' }}
                          onClick={e => { e.stopPropagation(); handleDeleteAppraisal(appraisal); }}
                        >
                          <button
                            style={{ background: 'transparent', border: 'none', color: '#2a5878', cursor: 'pointer', fontSize: 13 }}
                            title="Delete project"
                            type="button"
                            onMouseEnter={e => (e.currentTarget.style.color = '#e05050')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#2a5878')}
                          >
                            🗑
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {deals.length > 0 && (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thBase}>Name</th>
                  <th style={thSort} onClick={() => handleSort('auctionDate')}>Auction Date{sortIndicator('auctionDate')}</th>
                  <th style={thBase}>Address</th>
                  <th style={thSort} onClick={() => handleSort('total_acquisition_cost')}>Acquisition Cost{sortIndicator('total_acquisition_cost')}</th>
                  <th style={thSort} onClick={() => handleSort('irr')}>IRR{sortIndicator('irr')}</th>
                  <th style={thSort} onClick={() => handleSort('gross_rental_yield')}>Gross Yield{sortIndicator('gross_rental_yield')}</th>
                  <th style={thSort} onClick={() => handleSort('flip_profit')}>Flip Profit{sortIndicator('flip_profit')}</th>
                  <th style={thBase}>Saved</th>
                  <th style={thBase}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(deal => {
                  const snap = deal.form_snapshot as unknown as Record<string, string | boolean>;
                  const address = (snap.address as string) || '—';
                  const guidePrice = parseFloat(snap.guidePrice as string) || 0;
                  const auctionDateRaw = snap.auctionDate as string;
                  const auctionDateDisplay = auctionDateRaw
                    ? new Date(auctionDateRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';
                  const savedDate = new Date(deal.created_at).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  });
                  return (
                    <tr
                      key={deal.id}
                      style={{ borderBottom: '1px solid #0e1e30', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#0a1828')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => onLoadDeal(deal)}
                    >
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontWeight: 600 }}>{deal.deal_name}</td>
                      <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{auctionDateDisplay}</td>
                      <td style={{ padding: '9px 12px', color: '#4a88a8' }}>{address}</td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>{gbp.format(deal.total_acquisition_cost / 100)}</td>
                      <td style={{ padding: '9px 12px', color: '#5aaae0', fontWeight: 700, fontFamily: 'monospace' }}>{formatIRR(deal.irr)}</td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>{deal.gross_rental_yield.toFixed(1)}%</td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>{gbp.format(deal.flip_profit / 100)}</td>
                      <td style={{ padding: '9px 12px', color: '#2a5878', fontSize: 10 }}>{savedDate}</td>
                      <td
                        style={{ padding: '9px 12px' }}
                        onClick={e => { e.stopPropagation(); handleDelete(deal); }}
                      >
                        <button
                          style={{ background: 'transparent', border: 'none', color: '#2a5878', cursor: 'pointer', fontSize: 13 }}
                          title="Delete deal"
                          type="button"
                          onMouseEnter={e => (e.currentTarget.style.color = '#e05050')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#2a5878')}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
          </>
        )}
      </div>

      {/* ── Final Bid Approval ── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#5aaae0', letterSpacing: 1 }}>Final Bid Approval</h2>
          <span style={{ fontSize: 10, color: '#2a5878' }}>{finalBidAppraisals.length} item{finalBidAppraisals.length !== 1 ? 's' : ''}</span>
        </div>

        {finalBidAppraisals.length === 0 ? (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, padding: '32px 24px', textAlign: 'center', color: '#2a5878', fontSize: 12 }}>
            No items yet. Promote a project from Due Diligence Approval.
          </div>
        ) : (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thBase}>ID</th>
                  <th style={thBase}>Project</th>
                  <th style={thBase}>Auction Date</th>
                  <th style={thBase}>IRR</th>
                  <th style={thBase}>Equity Required</th>
                  <th style={thBase}>Project Cost</th>
                  <th style={thBase}>GDV</th>
                  <th style={thBase}>Deal Score</th>
                  <th style={thBase}>Net Profit (£)</th>
                  <th style={thBase}>Net Profit (%)</th>
                  <th style={thBase}>Saved</th>
                  <th style={thBase}></th>
                  <th style={thBase}></th>
                </tr>
              </thead>
              <tbody>
                {finalBidAppraisals.map(appraisal => {
                  const s = getSummary(appraisal);
                  const auctionDateRaw = appraisal.inputs_snapshot.auction_date as string | undefined;
                  const appraisalAuctionDate = auctionDateRaw
                    ? new Date(auctionDateRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';
                  const savedDate = new Date(appraisal.updated_at ?? appraisal.created_at).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  });
                  return (
                    <tr
                      key={appraisal.id}
                      style={{ borderBottom: '1px solid #0e1e30', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#0a1828')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => onLoadAppraisal(appraisal)}
                    >
                      <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{(appraisal.inputs_snapshot.project_id as string) || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontWeight: 600 }}>{appraisal.name}</td>
                      <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{appraisalAuctionDate}</td>
                      <td style={{ padding: '9px 12px', color: '#30ddaa', fontWeight: 700, fontFamily: 'monospace' }}>
                        {s?.irr != null ? `${s.irr.toFixed(1)}%` : (appraisal.irr_equity != null ? `${appraisal.irr_equity.toFixed(1)}%` : '—')}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.equityRequired != null ? gbp.format(s.equityRequired) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.projectCost != null ? gbp.format(s.projectCost) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.gdv != null ? gbp.format(s.gdv) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.dealScore != null
                          ? <span style={{ color: scoreColor(s.dealScore), fontWeight: 700 }}>{s.dealScore.toFixed(1)}<span style={{ color: '#2a5878', fontWeight: 400 }}>/10</span></span>
                          : <span style={{ color: '#2a5878' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.netProfitAmount != null
                          ? <span style={{ color: s.netProfitAmount >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(s.netProfitAmount)}</span>
                          : (appraisal.net_profit != null ? <span style={{ color: appraisal.net_profit >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(appraisal.net_profit / 100)}</span> : <span style={{ color: '#2a5878' }}>—</span>)
                        }
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.netProfitPercent != null
                          ? <span style={{ color: s.netProfitPercent >= 0 ? '#1acc70' : '#cc3030' }}>{s.netProfitPercent.toFixed(1)}%</span>
                          : (appraisal.margin_pct != null ? <span style={{ color: appraisal.margin_pct >= 0 ? '#1acc70' : '#cc3030' }}>{appraisal.margin_pct.toFixed(1)}%</span> : <span style={{ color: '#2a5878' }}>—</span>)
                        }
                      </td>
                      <td style={{ padding: '9px 12px', color: '#2a5878', fontSize: 10 }}>{savedDate}</td>
                      <td
                        style={{ padding: '9px 12px' }}
                        onClick={e => { e.stopPropagation(); onPromoteToApproved(appraisal.id); }}
                      >
                        <button
                          style={{ background: 'transparent', border: '1px solid #1a4060', color: '#5aaae0', cursor: 'pointer', fontSize: 10, borderRadius: 4, padding: '3px 8px', whiteSpace: 'nowrap' }}
                          title="Move to Approved to Bid"
                          type="button"
                          onMouseEnter={e => { e.currentTarget.style.background = '#0a1e30'; e.currentTarget.style.color = '#8acaff'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#5aaae0'; }}
                        >
                          → Approved to Bid
                        </button>
                      </td>
                      <td
                        style={{ padding: '9px 12px' }}
                        onClick={e => { e.stopPropagation(); handleDeleteAppraisal(appraisal); }}
                      >
                        <button
                          style={{ background: 'transparent', border: 'none', color: '#2a5878', cursor: 'pointer', fontSize: 13 }}
                          title="Delete project"
                          type="button"
                          onMouseEnter={e => (e.currentTarget.style.color = '#e05050')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#2a5878')}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Approved to Bid ── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: '#5aaae0', letterSpacing: 1 }}>Approved to Bid</h2>
          <span style={{ fontSize: 10, color: '#2a5878' }}>{approvedToBidAppraisals.length} item{approvedToBidAppraisals.length !== 1 ? 's' : ''}</span>
        </div>

        {approvedToBidAppraisals.length === 0 ? (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, padding: '32px 24px', textAlign: 'center', color: '#2a5878', fontSize: 12 }}>
            No items yet. Promote a project from Final Bid Approval.
          </div>
        ) : (
          <div style={{ background: '#07111f', border: '1px solid #162840', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={thBase}>ID</th>
                  <th style={thBase}>Project</th>
                  <th style={thBase}>Auction Date</th>
                  <th style={thBase}>IRR</th>
                  <th style={thBase}>Equity Required</th>
                  <th style={thBase}>Project Cost</th>
                  <th style={thBase}>GDV</th>
                  <th style={thBase}>Deal Score</th>
                  <th style={thBase}>Net Profit (£)</th>
                  <th style={thBase}>Net Profit (%)</th>
                  <th style={thBase}>Saved</th>
                  <th style={thBase}></th>
                </tr>
              </thead>
              <tbody>
                {approvedToBidAppraisals.map(appraisal => {
                  const s = getSummary(appraisal);
                  const auctionDateRaw = appraisal.inputs_snapshot.auction_date as string | undefined;
                  const appraisalAuctionDate = auctionDateRaw
                    ? new Date(auctionDateRaw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '—';
                  const savedDate = new Date(appraisal.updated_at ?? appraisal.created_at).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  });
                  return (
                    <tr
                      key={appraisal.id}
                      style={{ borderBottom: '1px solid #0e1e30', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#0a1828')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => onLoadAppraisal(appraisal)}
                    >
                      <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{(appraisal.inputs_snapshot.project_id as string) || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontWeight: 600 }}>{appraisal.name}</td>
                      <td style={{ padding: '9px 12px', color: '#4a88a8', fontFamily: 'monospace', fontSize: 11 }}>{appraisalAuctionDate}</td>
                      <td style={{ padding: '9px 12px', color: '#30ddaa', fontWeight: 700, fontFamily: 'monospace' }}>
                        {s?.irr != null ? `${s.irr.toFixed(1)}%` : (appraisal.irr_equity != null ? `${appraisal.irr_equity.toFixed(1)}%` : '—')}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.equityRequired != null ? gbp.format(s.equityRequired) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.projectCost != null ? gbp.format(s.projectCost) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#b8d4ee', fontFamily: 'monospace' }}>
                        {s?.gdv != null ? gbp.format(s.gdv) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.dealScore != null
                          ? <span style={{ color: scoreColor(s.dealScore), fontWeight: 700 }}>{s.dealScore.toFixed(1)}<span style={{ color: '#2a5878', fontWeight: 400 }}>/10</span></span>
                          : <span style={{ color: '#2a5878' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.netProfitAmount != null
                          ? <span style={{ color: s.netProfitAmount >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(s.netProfitAmount)}</span>
                          : (appraisal.net_profit != null ? <span style={{ color: appraisal.net_profit >= 0 ? '#1acc70' : '#cc3030' }}>{gbp.format(appraisal.net_profit / 100)}</span> : <span style={{ color: '#2a5878' }}>—</span>)
                        }
                      </td>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace' }}>
                        {s?.netProfitPercent != null
                          ? <span style={{ color: s.netProfitPercent >= 0 ? '#1acc70' : '#cc3030' }}>{s.netProfitPercent.toFixed(1)}%</span>
                          : (appraisal.margin_pct != null ? <span style={{ color: appraisal.margin_pct >= 0 ? '#1acc70' : '#cc3030' }}>{appraisal.margin_pct.toFixed(1)}%</span> : <span style={{ color: '#2a5878' }}>—</span>)
                        }
                      </td>
                      <td style={{ padding: '9px 12px', color: '#2a5878', fontSize: 10 }}>{savedDate}</td>
                      <td
                        style={{ padding: '9px 12px' }}
                        onClick={e => { e.stopPropagation(); handleDeleteAppraisal(appraisal); }}
                      >
                        <button
                          style={{ background: 'transparent', border: 'none', color: '#2a5878', cursor: 'pointer', fontSize: 13 }}
                          title="Delete project"
                          type="button"
                          onMouseEnter={e => (e.currentTarget.style.color = '#e05050')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#2a5878')}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
