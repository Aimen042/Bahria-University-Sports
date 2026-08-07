/**
 * Student — Borrow Equipment (BORROW-01..14).
 *
 * UX flow:
 *   1. Screen shows sport cards (one per sport that has equipment types in DB).
 *   2. Student clicks a sport → an expandable panel slides open showing a TABLE
 *      of all equipment items for that sport (name, unit, availability status).
 *   3. Student picks date/time → clicks "Request All [Sport] Equipment".
 *   4. One borrow_request per equipment type is submitted.
 *   5. My Requests table below shows all submitted requests.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listTypes, listStatus, type EquipmentType, type StatusRow } from '../inventory/api.js';
import { submitRequest, listMyRequests, type MyRequest } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { SPORT_BUNDLES } from '../../lib/sportBundles.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

// ─── styles ──────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 820, margin: '0 auto', padding: '0 0 48px' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok:  { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', font: '600 15px var(--font-body)', color: '#26485f' };
const panelBody: React.CSSProperties = { padding: '0 18px 18px' };
const sportGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 24 };
const sportCard = (active: boolean): React.CSSProperties => ({
  background: active ? '#0a6ebd' : '#fff',
  color: active ? '#fff' : '#26485f',
  border: `2px solid ${active ? '#0a6ebd' : '#dfe3e8'}`,
  borderRadius: 10, padding: '18px 12px', textAlign: 'center',
  cursor: 'pointer', fontWeight: 600, fontSize: 14,
  transition: 'all 0.15s', boxShadow: active ? '0 2px 8px rgba(10,110,189,0.25)' : '0 1px 2px rgba(0,0,0,0.04)',
});
const sportEmoji: React.CSSProperties = { fontSize: 28, display: 'block', marginBottom: 6 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 12 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 10px', borderBottom: '1px solid #e5e5e5', background: '#f7f9fb' };
const td: React.CSSProperties = { padding: '10px 10px', borderBottom: '1px solid #eee', color: '#333' };
const badgeBase: React.CSSProperties = { display: 'inline-block', font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4 };
const formRow: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 16 };
const lbl: React.CSSProperties = { display: 'block', font: '500 11px var(--font-body)', color: '#5c6773', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' };
const inp: React.CSSProperties = { font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, background: '#fff' };
const primaryBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const resultRow: React.CSSProperties = { display: 'flex', gap: 8, padding: '3px 0', fontSize: 13 };

// Sport emoji map
const SPORT_EMOJI: Record<string, string> = {
  Badminton: '🏸', Football: '⚽', Basketball: '🏀',
  Cricket: '🏏', 'Table Tennis': '🏓', Volleyball: '🏐', Tennis: '🎾',
};

function statusBadge(s: MyRequest['status']): React.CSSProperties {
  if (s === 'PENDING')  return { background: '#fef3c7', color: '#92400e' };
  if (s === 'APPROVED') return { background: '#d1fae5', color: '#065f46' };
  if (s === 'REJECTED') return { background: '#fee2e2', color: '#991b1b' };
  return { background: '#e5e7eb', color: '#374151' };
}

function availBadge(badge: string): React.CSSProperties {
  if (badge === 'AVAILABLE') return { background: '#d1fae5', color: '#065f46' };
  if (badge === 'LOW_STOCK') return { background: '#fef3c7', color: '#92400e' };
  return { background: '#fee2e2', color: '#991b1b' };
}

// ─────────────────────────── SCREEN ──────────────────────────────
export default function MyBorrowsScreen() {
  const { user, loading } = useAuth();
  const [types, setTypes]     = useState<EquipmentType[]>([]);
  const [status, setStatus]   = useState<StatusRow[]>([]);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);
  const location = useLocation();
  const [selectedSport, setSelectedSport] = useState<string | null>(
    // Pre-select sport if navigated from AvailabilityScreen
    (location.state as { sport?: string } | null)?.sport ?? null
  );

  const userId = user?.userId ?? null;

  const load = useCallback(async () => {
    try {
      const [t, s, r] = await Promise.all([listTypes(), listStatus(), listMyRequests()]);
      setTypes(t.types); setStatus(s.status); setRequests(r.requests);
      setError(null);
    } catch (e) {
      // Ignore 401s — they fire on the initial render before auth refresh
      // completes. The effect re-runs once userId is set and succeeds.
      if (e instanceof ApiRequestError && e.status === 401) return;
      setError(errMsg(e));
    }
  }, []);  // stable — no deps needed, called explicitly via userId effect

  // Only run after auth confirmed
  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  if (loading) return <PortalShell title="My Borrows"><p /></PortalShell>;
  if (!user)   return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  // Sports that actually have equipment types in the DB
  const availableSports = SPORT_BUNDLES.filter((b) =>
    types.some((t) => t.sport_category_name.toLowerCase() === b.sportName.toLowerCase())
  );

  const selectedBundle = SPORT_BUNDLES.find((b) => b.label === selectedSport) ?? null;
  const bundleTypes = selectedBundle
    ? types.filter((t) => t.sport_category_name.toLowerCase() === selectedBundle.sportName.toLowerCase())
    : [];

  return (
    <PortalShell title="My Borrows" tint="sage">
      <div style={wrap}>
        {error  && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {/* ── Step 1: Sport selector ── */}
        <div style={{ ...panel }}>
          <div style={panelHead}>Select a Sport to Borrow Equipment</div>
          <div style={{ padding: '4px 18px 18px' }}>
            {availableSports.length === 0
              ? <p style={muted}>No equipment types have been added yet. Contact the Coordinator.</p>
              : (
                <div style={sportGrid}>
                  {availableSports.map((b) => (
                    <button
                      key={b.label}
                      style={sportCard(selectedSport === b.label)}
                      onClick={() => { setSelectedSport(selectedSport === b.label ? null : b.label); setError(null); setNotice(null); }}
                    >
                      <span style={sportEmoji}>{SPORT_EMOJI[b.label] ?? '🏅'}</span>
                      {b.label}
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>

        {/* ── Step 2: Items table + request form ── */}
        {selectedBundle && (
          <div style={panel}>
            <div style={panelHead}>
              {SPORT_EMOJI[selectedBundle.label] ?? '🏅'} {selectedBundle.label} Equipment
              <span style={{ fontSize: 12, fontWeight: 400, color: '#5c6773' }}>
                {bundleTypes.length} item{bundleTypes.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div style={panelBody}>
              {bundleTypes.length === 0
                ? <p style={muted}>No equipment types found for {selectedBundle.label}. Ask a Coordinator to add them.</p>
                : (
                  <>
                    {/* Equipment table */}
                    <table style={table}>
                      <thead>
                        <tr>
                          <th style={th}>Item</th>
                          <th style={th}>Unit</th>
                          <th style={th}>Setting</th>
                          <th style={th}>Availability</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bundleTypes.map((t) => {
                          const s = status.find((x) => x.equipment_type_id === t.equipment_type_id);
                          return (
                            <tr key={t.equipment_type_id}>
                              <td style={{ ...td, fontWeight: 500 }}>{t.name}</td>
                              <td style={td}>{t.lending_unit}</td>
                              <td style={td}>{t.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                              <td style={td}>
                                {s
                                  ? <span style={{ ...badgeBase, ...availBadge(s.status_badge) }}>
                                      {s.status_badge.replace('_', ' ')} · {s.available_units} unit{s.available_units !== 1 ? 's' : ''}
                                    </span>
                                  : <span style={{ color: '#aaa', fontSize: 12 }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Request form */}
                    <RequestForm
                      sport={selectedBundle.label}
                      bundleTypes={bundleTypes}
                      onDone={(m) => {
                        setNotice(m); setError(null);
                        void load();
                      }}
                      onError={(m) => { setError(m); setNotice(null); }}
                    />
                  </>
                )}
            </div>
          </div>
        )}

        {/* ── My Requests table ── */}
        <div style={panel}>
          <div style={panelHead}>My Requests</div>
          <div style={panelBody}>
            {requests.length === 0
              ? <p style={muted}>You haven't submitted any requests yet.</p>
              : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Equipment</th>
                      <th style={th}>Sport</th>
                      <th style={th}>Window</th>
                      <th style={th}>Status</th>
                      <th style={th}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => {
                      const t = types.find((x) => x.name === r.equipment_type_name);
                      return (
                        <tr key={r.borrow_request_id}>
                          <td style={{ ...td, fontWeight: 500 }}>{r.equipment_type_name}</td>
                          <td style={td}>{t?.sport_category_name ?? '—'}</td>
                          <td style={{ ...td, fontSize: 12, color: '#5c6773' }}>
                            {new Date(r.requested_start_at).toLocaleDateString()} &nbsp;
                            {new Date(r.requested_start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' → '}
                            {new Date(r.requested_return_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={td}>
                            <span style={{ ...badgeBase, ...statusBadge(r.status) }}>{r.status}</span>
                          </td>
                          <td style={{ ...td, color: '#8f2323', fontSize: 13 }}>{r.rejection_reason ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      </div>
    </PortalShell>
  );
}

// ─────────────────────────── REQUEST FORM ────────────────────────
function RequestForm({ sport, bundleTypes, onDone, onError }: {
  sport: string;
  bundleTypes: EquipmentType[];
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [date, setDate]           = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime]     = useState('13:00');
  const [busy, setBusy]           = useState(false);
  const [results, setResults]     = useState<Array<{ name: string; ok: boolean; msg: string }>>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !startTime || !endTime) { onError('Fill in all date and time fields.'); return; }
    if (startTime >= endTime) { onError('Return time must be after start time.'); return; }

    const requestedStartAt  = new Date(`${date}T${startTime}:00`).toISOString();
    const requestedReturnAt = new Date(`${date}T${endTime}:00`).toISOString();

    setBusy(true); setResults([]);
    const out: typeof results = [];

    for (const t of bundleTypes) {
      try {
        await submitRequest({ equipmentTypeId: t.equipment_type_id, requestedStartAt, requestedReturnAt });
        out.push({ name: t.name, ok: true, msg: 'Submitted' });
      } catch (e) {
        out.push({ name: t.name, ok: false, msg: errMsg(e) });
      }
    }

    setBusy(false); setResults(out);
    const successCount = out.filter((r) => r.ok).length;

    if (successCount === out.length) {
      onDone(`All ${successCount} request${successCount !== 1 ? 's' : ''} for ${sport} submitted! A Coordinator will review them shortly.`);
    } else if (successCount > 0) {
      onDone(`${successCount} of ${out.length} requests submitted. See below for details.`);
    } else {
      onError('No requests could be submitted. See details below.');
    }
  }

  return (
    <>
      <form onSubmit={submit}>
        <div style={formRow}>
          <div>
            <span style={lbl}>Date</span>
            <input type="date" style={inp} value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <span style={lbl}>Start time</span>
            <input type="time" style={inp} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </div>
          <div>
            <span style={lbl}>Return time</span>
            <input type="time" style={inp} value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </div>
          <button style={primaryBtn} disabled={busy}>
            {busy ? 'Submitting…' : `Request All ${sport} Equipment`}
          </button>
        </div>
      </form>

      {/* Per-item results */}
      {results.length > 0 && (
        <div style={{ marginTop: 12, border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 14px' }}>
          {results.map((r) => (
            <div key={r.name} style={{ ...resultRow, color: r.ok ? '#065f46' : '#991b1b' }}>
              <span>{r.ok ? '✓' : '✗'}</span>
              <span style={{ flex: 1 }}>{r.name}</span>
              {!r.ok && <span style={{ fontSize: 12 }}>{r.msg}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
