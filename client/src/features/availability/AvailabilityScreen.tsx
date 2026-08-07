/**
 * Equipment Availability Checker (Feature 2 — EQUIP-AVAIL-01..10).
 * Open to every authenticated role. Read-only — no borrow action here
 * (EQUIP-AVAIL-09; that's Feature 3).
 *
 * Student view:
 *   Sport cards at the top. Click a sport → items table with live status.
 *   "Request [Sport] Equipment" button navigates to /my-borrows with sport
 *   pre-selected via router state.
 *
 * Staff view (unchanged):
 *   Filter dropdowns + equipment card grid + total stock figures.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listSportCategories, type SportCategory } from '../inventory/api.js';
import { listAvailability, subscribeAvailability, type AvailabilityRow } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { SPORT_BUNDLES } from '../../lib/sportBundles.js';

const SPORT_EMOJI: Record<string, string> = {
  Badminton: '🏸', Football: '⚽', Basketball: '🏀',
  Cricket: '🏏', 'Table Tennis': '🏓', Volleyball: '🏐', Tennis: '🎾',
};

export default function AvailabilityScreen() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [sportCategoryId, setSportCategoryId] = useState(0);
  const [indoorFilter, setIndoorFilter] = useState<'' | 'indoor' | 'outdoor'>('');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSport, setSelectedSport] = useState<string | null>(null);

  const userId = user?.userId ?? null;

  const loadInitial = useCallback(async () => {
    try {
      const [status, categories] = await Promise.all([listAvailability(), listSportCategories()]);
      setRows(status.status);
      setCats(categories.categories);
      setError(null);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) return;
      setError(e instanceof ApiRequestError ? e.body.error : 'Could not load availability.');
    }
  }, []);

  // Gate on userId so this never fires before auth refresh completes
  useEffect(() => {
    if (!userId) return;
    void loadInitial();
  }, [userId, loadInitial]);

  useEffect(() => {
    if (loading || !user) return;
    const close = subscribeAvailability((snapshot) => {
      setRows(snapshot);
      setLive(true);
    });
    return close;
  }, [loading, user]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      if (sportCategoryId && r.sportCategoryId !== sportCategoryId) return false;
      if (indoorFilter === 'indoor' && !r.isIndoor) return false;
      if (indoorFilter === 'outdoor' && r.isIndoor) return false;
      return true;
    });
  }, [rows, sportCategoryId, indoorFilter]);

  if (loading) return <PortalShell title="Equipment Availability"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;

  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR';
  const isStudent = user.role === 'STUDENT';

  // Sports that have at least one equipment type in the live data
  const availableSports = rows
    ? SPORT_BUNDLES.filter((b) =>
        rows.some((r) => r.sportCategoryName.toLowerCase() === b.sportName.toLowerCase())
      )
    : [];

  const selectedBundle = SPORT_BUNDLES.find((b) => b.label === selectedSport) ?? null;
  const sportRows = selectedBundle && rows
    ? rows.filter((r) => r.sportCategoryName.toLowerCase() === selectedBundle.sportName.toLowerCase())
    : [];

  return (
    <PortalShell title="Equipment Availability" tint={isStaff ? 'navy' : 'sage'}>
      <div style={wrap}>

        {/* Header */}
        <div style={headerRow}>
          <p style={subtitle}>
            {isStudent
              ? 'Select a sport to see available equipment, then submit a borrow request.'
              : 'Live status per equipment type. Updates automatically.'}
          </p>
          <span style={{ ...liveDot, ...(live ? liveDotOn : undefined) }}>
            <span style={dot} /> {live ? 'Live' : 'Connecting…'}
          </span>
        </div>

        {error && <div style={errBox}>{error}</div>}

        {/* ══ STUDENT VIEW ══ */}
        {isStudent && (
          <>
            {/* Sport cards */}
            <div style={sportGrid}>
              {rows === null
                ? <p style={muted}>Loading…</p>
                : availableSports.length === 0
                  ? <p style={muted}>No equipment is currently listed. Check back later.</p>
                  : availableSports.map((b) => {
                      const sportItems = rows.filter((r) =>
                        r.sportCategoryName.toLowerCase() === b.sportName.toLowerCase()
                      );
                      const anyAvailable = sportItems.some((r) => r.statusBadge !== 'CHECKED_OUT');
                      const isActive = selectedSport === b.label;
                      return (
                        <button
                          key={b.label}
                          style={sportCard(isActive, anyAvailable)}
                          onClick={() => setSelectedSport(isActive ? null : b.label)}
                        >
                          <span style={sportEmojiStyle}>{SPORT_EMOJI[b.label] ?? '🏅'}</span>
                          <span style={sportLabel}>{b.label}</span>
                          <span style={sportSub}>
                            {anyAvailable
                              ? `${sportItems.length} item${sportItems.length !== 1 ? 's' : ''}`
                              : 'Checked Out'}
                          </span>
                        </button>
                      );
                    })}
            </div>

            {/* Expanded sport detail */}
            {selectedBundle && (
              <div style={detailPanel}>
                <div style={detailHead}>
                  <span>{SPORT_EMOJI[selectedBundle.label] ?? '🏅'} {selectedBundle.label} Equipment</span>
                  <button
                    style={borrowBtn}
                    onClick={() => navigate('/my-borrows', { state: { sport: selectedBundle.label } })}
                  >
                    Request {selectedBundle.label} Equipment →
                  </button>
                </div>
                <table style={itemTable}>
                  <thead>
                    <tr>
                      <th style={th}></th>
                      <th style={th}>Item</th>
                      <th style={th}>Unit</th>
                      <th style={th}>Setting</th>
                      <th style={th}>Available</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sportRows.length === 0
                      ? (
                        <tr>
                          <td style={td} colSpan={6}>
                            No equipment data found for {selectedBundle.label}.
                          </td>
                        </tr>
                      )
                      : sportRows.map((r) => (
                          <tr key={r.equipmentTypeId}>
                            <td style={td}>
                              {r.imageUrl
                                ? <img src={r.imageUrl} alt="" style={thumb}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                : <div style={thumbPlaceholder}>{r.name.charAt(0)}</div>}
                            </td>
                            <td style={{ ...td, fontWeight: 500 }}>{r.name}</td>
                            <td style={td}>{r.lendingUnit}</td>
                            <td style={td}>{r.isIndoor ? 'Indoor' : 'Outdoor'}</td>
                            <td style={td}><strong>{r.availableUnits}</strong></td>
                            <td style={td}>
                              <span style={{
                                ...badgeBase,
                                ...(r.statusBadge === 'AVAILABLE' ? badge.ok
                                  : r.statusBadge === 'LOW_STOCK' ? badge.warn
                                  : badge.danger),
                              }}>
                                {r.statusBadge === 'AVAILABLE' ? 'Available'
                                  : r.statusBadge === 'LOW_STOCK' ? 'Low Stock'
                                  : 'Checked Out'}
                              </span>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ══ STAFF VIEW (unchanged) ══ */}
        {!isStudent && (
          <>
            <div style={filterRow}>
              <select style={select} value={sportCategoryId}
                onChange={(e) => setSportCategoryId(Number(e.target.value))}>
                <option value={0}>All sports</option>
                {cats.map((c) => (
                  <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>
                ))}
              </select>
              <select style={select} value={indoorFilter}
                onChange={(e) => setIndoorFilter(e.target.value as '' | 'indoor' | 'outdoor')}>
                <option value="">Indoor &amp; outdoor</option>
                <option value="indoor">Indoor only</option>
                <option value="outdoor">Outdoor only</option>
              </select>
            </div>
            {rows === null ? (
              <p style={muted}>Loading…</p>
            ) : filtered.length === 0 ? (
              <p style={muted}>No equipment matches these filters.</p>
            ) : (
              <div style={grid}>
                {filtered.map((r) => (
                  <EquipmentCard key={r.equipmentTypeId} row={r} showTotal={isStaff} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}

function EquipmentCard({ row, showTotal }: { row: AvailabilityRow; showTotal: boolean }) {
  const badgeStyle = row.statusBadge === 'AVAILABLE' ? badge.ok
    : row.statusBadge === 'LOW_STOCK' ? badge.warn : badge.danger;
  const badgeText = row.statusBadge === 'AVAILABLE' ? 'Available'
    : row.statusBadge === 'LOW_STOCK' ? 'Low Stock' : 'Checked Out';
  return (
    <div style={card}>
      <div style={cardImageWrap}>
        {row.imageUrl
          ? <img src={row.imageUrl} alt="" style={cardImage}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div style={cardImagePlaceholder}>{row.name.charAt(0)}</div>}
      </div>
      <div style={cardBody}>
        <div style={cardTop}>
          <h3 style={cardTitle}>{row.name}</h3>
          <span style={{ ...badgeBase, ...badgeStyle }}>{badgeText}</span>
        </div>
        <p style={cardMeta}>
          {row.sportCategoryName} · {row.isIndoor ? 'Indoor' : 'Outdoor'} ·{' '}
          {row.lendingUnit === 'PAIR' ? 'Pair' : 'Single'}
        </p>
        <div style={cardCount}>
          <span style={countNumber}>{row.availableUnits}</span>
          <span style={countLabel}>
            available{showTotal && row.totalStock !== undefined ? ` of ${row.totalStock} total` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── styles ──────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 900, margin: '0 auto', paddingBottom: 48 };
const headerRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 };
const subtitle: React.CSSProperties = { margin: 0, color: '#5c6773', fontSize: 14 };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14 };
const errBox: React.CSSProperties = { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 };
const liveDot: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a949f', fontWeight: 500 };
const liveDotOn: React.CSSProperties = { color: '#1f7a45' };
const dot: React.CSSProperties = { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'currentColor' };

// Student sport cards
const sportGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12, marginBottom: 20 };
const sportCard = (active: boolean, hasStock: boolean): React.CSSProperties => ({
  background: active ? '#0a6ebd' : '#fff',
  color: active ? '#fff' : hasStock ? '#26485f' : '#9ca3af',
  border: `2px solid ${active ? '#0a6ebd' : hasStock ? '#dfe3e8' : '#e5e7eb'}`,
  borderRadius: 10, padding: '16px 10px', textAlign: 'center',
  cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  boxShadow: active ? '0 2px 8px rgba(10,110,189,0.25)' : '0 1px 2px rgba(0,0,0,0.04)',
  transition: 'all 0.15s',
});
const sportEmojiStyle: React.CSSProperties = { fontSize: 28 };
const sportLabel: React.CSSProperties = { fontWeight: 600, fontSize: 13 };
const sportSub: React.CSSProperties = { fontSize: 11, opacity: 0.8 };

// Detail panel
const detailPanel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 24, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' };
const detailHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: 'linear-gradient(#fff,#f7f9fb)', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#26485f' };
const borrowBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const itemTable: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 12px', borderBottom: '1px solid #e5e5e5', background: '#f7f9fb' };
const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #eee', color: '#333' };
const thumb: React.CSSProperties = { width: 32, height: 32, objectFit: 'cover', borderRadius: 4 };
const thumbPlaceholder: React.CSSProperties = { width: 32, height: 32, borderRadius: 4, background: '#e7edf4', color: '#26485f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 };
const badgeBase: React.CSSProperties = { display: 'inline-block', font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4 };
const badge = {
  ok:     { background: '#d1fae5', color: '#065f46' } as React.CSSProperties,
  warn:   { background: '#fef3c7', color: '#92400e' } as React.CSSProperties,
  danger: { background: '#fee2e2', color: '#991b1b' } as React.CSSProperties,
};

// Staff filters + cards
const filterRow: React.CSSProperties = { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' };
const select: React.CSSProperties = { font: '14px var(--font-body)', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, background: '#fff' };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
const cardImageWrap: React.CSSProperties = { height: 100, background: '#f0f4f8', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const cardImage: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
const cardImagePlaceholder: React.CSSProperties = { fontSize: 36, fontWeight: 700, color: '#26485f', opacity: 0.4 };
const cardBody: React.CSSProperties = { padding: '12px 14px' };
const cardTop: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 };
const cardTitle: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, color: '#1a1d21' };
const cardMeta: React.CSSProperties = { margin: '0 0 8px', fontSize: 12, color: '#5c6773' };
const cardCount: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 4 };
const countNumber: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: '#26485f' };
const countLabel: React.CSSProperties = { fontSize: 12, color: '#5c6773' };
