/**
 * Coordinator — Borrow Queue (BORROW-07..14).
 *
 * Grouping change:
 *   Queue items from the same student with the same time window are grouped
 *   into one "bundle row". The coordinator sees one row per student-request,
 *   not one row per equipment type. Clicking "Review" expands all items in
 *   that bundle and lets the coordinator approve/reject each one individually
 *   or all at once.
 *
 * Everything else (LendPanel, WalkinForm, styles) is unchanged.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listTypes, listArticles, type EquipmentType, type Article } from '../inventory/api.js';
import { listQueue, approveRequest, rejectRequest, lendPlatform, lendWalkinGuest, type QueueItem } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { SPORT_BUNDLES } from '../../lib/sportBundles.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

// ── Bundle: one student + one time window = one logical request ──
interface Bundle {
  key: string;               // student_id + start + end
  student_id: string;
  student_name: string;
  student_email: string;
  requested_start_at: string;
  requested_return_at: string;
  submitted_at: string;      // earliest submission in the group
  items: QueueItem[];        // all queue items in this bundle
  sport: string | null;      // detected sport label (or null if mixed)
}

function buildBundles(queue: QueueItem[]): Bundle[] {
  const map = new Map<string, Bundle>();
  for (const q of queue) {
    // Round to minute so minor sub-second differences don't split a bundle
    const startMin = q.requested_start_at.slice(0, 16);
    const endMin   = q.requested_return_at.slice(0, 16);
    const key = `${q.student_id}|${startMin}|${endMin}`;
    if (!map.has(key)) {
      map.set(key, {
        key, student_id: q.student_id,
        student_name: q.student_name, student_email: q.student_email,
        requested_start_at: q.requested_start_at,
        requested_return_at: q.requested_return_at,
        submitted_at: q.submitted_at,
        items: [], sport: null,
      });
    }
    const b = map.get(key)!;
    b.items.push(q);
    // Use the earliest submission timestamp
    if (q.submitted_at < b.submitted_at) b.submitted_at = q.submitted_at;
  }

  // Detect sport for display label
  for (const b of map.values()) {
    const typeNames = b.items.map((i) => i.equipment_type_name.toLowerCase());
    for (const bundle of SPORT_BUNDLES) {
      const bundleNames = bundle.items.map((i) => i.name.toLowerCase());
      if (typeNames.some((n) => bundleNames.includes(n))) {
        b.sport = bundle.label;
        break;
      }
    }
  }

  return [...map.values()].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
}

// ─────────────────────────── SCREEN ──────────────────────────────
export default function BorrowQueueScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue]     = useState<QueueItem[] | null>(null);
  const [selectedBundle, setSelectedBundle] = useState<Bundle | null>(null);
  const [selectedItem, setSelectedItem]     = useState<QueueItem | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWalkin, setShowWalkin] = useState(false);

  const load = useCallback(async () => {
    try { const r = await listQueue(); setQueue(r.queue); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Borrow Queue"><p /></PortalShell>;
  if (!user)   return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash = {
    ok:  (m: string) => { setNotice(m); setError(null);  },
    err: (m: string) => { setError(m);  setNotice(null); },
  };

  const bundles = queue ? buildBundles(queue) : [];

  // ── LendPanel for a single item (after approve) ──────────────
  if (selectedItem) {
    return (
      <PortalShell title="Borrow Queue" tint="slate">
        <div style={wrap}>
          {error  && <div style={box.err}>{error}</div>}
          {notice && <div style={box.ok}>{notice}</div>}
          <LendPanel
            item={selectedItem}
            onBack={() => setSelectedItem(null)}
            onDone={(m) => { flash.ok(m); setSelectedItem(null); void load();
              // refresh bundle
              setSelectedBundle((prev) => prev
                ? { ...prev, items: prev.items.filter((i) => i.borrow_request_id !== selectedItem.borrow_request_id) }
                : null);
            }}
            onError={flash.err}
          />
        </div>
      </PortalShell>
    );
  }

  // ── Bundle detail view ───────────────────────────────────────
  if (selectedBundle) {
    return (
      <PortalShell title="Borrow Queue" tint="slate">
        <div style={wrap}>
          {error  && <div style={box.err}>{error}</div>}
          {notice && <div style={box.ok}>{notice}</div>}
          <BundlePanel
            bundle={selectedBundle}
            onBack={() => { setSelectedBundle(null); void load(); }}
            onSelectItem={setSelectedItem}
            onDone={(m) => { flash.ok(m); void load();
              setSelectedBundle((prev) => prev ? { ...prev, items: [] } : null);
            }}
            onError={flash.err}
          />
        </div>
      </PortalShell>
    );
  }

  // ── Main queue view ──────────────────────────────────────────
  return (
    <PortalShell title="Borrow Queue" tint="slate">
      <div style={wrap}>
        {error  && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        <Panel title="Pending Requests">
          {queue === null ? <p style={muted}>Loading…</p>
            : bundles.length === 0 ? <p style={muted}>No pending requests.</p>
            : (
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Student</th>
                    <th style={th}>Request</th>
                    <th style={th}>Window</th>
                    <th style={th}>Items</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {bundles.map((b) => (
                    <tr key={b.key}>
                      <td style={td}>
                        <strong>{b.student_name}</strong><br />
                        <span style={{ color: '#8a949f', fontSize: 12 }}>{b.student_email}</span>
                      </td>
                      <td style={td}>
                        <strong>{b.sport ?? 'Equipment'}</strong>
                        <br />
                        <span style={{ fontSize: 12, color: '#5c6773' }}>
                          {new Date(b.submitted_at).toLocaleString()}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ fontSize: 13 }}>
                          {new Date(b.requested_start_at).toLocaleDateString()}{' '}
                          {new Date(b.requested_start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {' → '}
                          {new Date(b.requested_return_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td style={td}>
                        <span style={{ ...badgeBase, background: '#e7edf4', color: '#26485f' }}>
                          {b.items.length} item{b.items.length !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button style={reviewBtn} onClick={() => setSelectedBundle(b)}>
                          Review →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </Panel>

        <Panel
          title="Walk-in Guest"
          action={
            <button style={ghostBtn} onClick={() => setShowWalkin((v) => !v)}>
              {showWalkin ? 'Close' : 'New Walk-in'}
            </button>
          }
        >
          {showWalkin
            ? <WalkinForm onDone={(m) => { flash.ok(m); setShowWalkin(false); }} onError={flash.err} />
            : <p style={muted}>Lend equipment directly to an unregistered guest, no prior request needed.</p>}
        </Panel>
      </div>
    </PortalShell>
  );
}

// ─────────────────────────── BUNDLE PANEL ────────────────────────
/**
 * Shows all items in a bundle. Coordinator can:
 *   - Approve All → all items approved at once, then lend each one
 *   - Reject All  → all items rejected with one reason
 *   - Or act on individual items via "Lend" button per item
 */
function BundlePanel({ bundle, onBack, onSelectItem, onDone, onError }: {
  bundle: Bundle;
  onBack: () => void;
  onSelectItem: (item: QueueItem) => void;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]       = useState('');
  const [busy, setBusy]           = useState(false);
  const [itemResults, setItemResults] = useState<Array<{ id: string; ok: boolean; msg: string }>>([]);

  const PRESET_REASONS = [
    'Equipment not available for the requested window.',
    'Student has an existing active borrow.',
    'Requested duration exceeds the allowed limit.',
    'Insufficient stock for this item.',
  ];

  async function approveAll() {
    setBusy(true);
    const results: typeof itemResults = [];
    for (const item of bundle.items) {
      try {
        await approveRequest(item.borrow_request_id);
        results.push({ id: item.borrow_request_id, ok: true, msg: 'Approved' });
      } catch (e) {
        results.push({ id: item.borrow_request_id, ok: false, msg: errMsg(e) });
      }
    }
    setBusy(false);
    setItemResults(results);
    const allOk = results.every((r) => r.ok);
    if (allOk) {
      onDone(`All ${bundle.items.length} items approved for ${bundle.student_name}. Now lend each item below.`);
    } else {
      onError('Some items could not be approved. See details below.');
    }
  }

  async function rejectAll() {
    if (!reason.trim()) { onError('Enter a rejection reason.'); return; }
    setBusy(true);
    const results: typeof itemResults = [];
    for (const item of bundle.items) {
      try {
        await rejectRequest(item.borrow_request_id, reason);
        results.push({ id: item.borrow_request_id, ok: true, msg: 'Rejected' });
      } catch (e) {
        results.push({ id: item.borrow_request_id, ok: false, msg: errMsg(e) });
      }
    }
    setBusy(false);
    setItemResults(results);
    onDone(`All items rejected for ${bundle.student_name}.`);
  }

  return (
    <>
      {/* Back + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button style={backBtn} onClick={onBack}>← Back</button>
        <div>
          <strong style={{ fontSize: 16 }}>{bundle.sport ?? 'Equipment'} Request</strong>
          <span style={{ marginLeft: 12, fontSize: 13, color: '#5c6773' }}>
            {bundle.student_name} · {bundle.student_email}
          </span>
        </div>
      </div>

      <Panel title="Request Details">
        <div style={detailRow}>
          <span style={detailLabel}>Student</span>
          <span>{bundle.student_name} ({bundle.student_email})</span>
        </div>
        <div style={detailRow}>
          <span style={detailLabel}>Sport / Type</span>
          <span>{bundle.sport ?? 'Mixed equipment'}</span>
        </div>
        <div style={detailRow}>
          <span style={detailLabel}>Requested window</span>
          <span>
            {new Date(bundle.requested_start_at).toLocaleString()} →{' '}
            {new Date(bundle.requested_return_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div style={detailRow}>
          <span style={detailLabel}>Submitted</span>
          <span>{new Date(bundle.submitted_at).toLocaleString()}</span>
        </div>
      </Panel>

      <Panel title={`Items (${bundle.items.length})`}>
        <table style={table}>
          <thead>
            <tr>
              <th style={th}>Equipment</th>
              <th style={th}>Status after action</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {bundle.items.map((item) => {
              const result = itemResults.find((r) => r.id === item.borrow_request_id);
              return (
                <tr key={item.borrow_request_id}>
                  <td style={{ ...td, fontWeight: 500 }}>{item.equipment_type_name}</td>
                  <td style={td}>
                    {result
                      ? <span style={{ ...badgeBase, ...(result.ok ? { background: '#d1fae5', color: '#065f46' } : { background: '#fee2e2', color: '#991b1b' }) }}>
                          {result.msg}
                        </span>
                      : <span style={{ color: '#aaa', fontSize: 12 }}>Pending action</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button style={reviewBtn} onClick={() => onSelectItem(item)}>
                      Lend →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Approve All / Reject All actions */}
        {!rejecting ? (
          <div style={actionRow}>
            <button style={acceptBtn} disabled={busy} onClick={approveAll}>
              {busy ? 'Approving…' : `Approve All ${bundle.items.length} Items`}
            </button>
            <button style={rejectBtnStyle} disabled={busy} onClick={() => setRejecting(true)}>
              Reject All
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Rejection reason:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {PRESET_REASONS.map((p) => (
                <button key={p} style={{ ...ghostBtn, fontSize: 12, background: reason === p ? '#e7edf4' : undefined }}
                  onClick={() => setReason(p)}>{p}</button>
              ))}
            </div>
            <textarea
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, minHeight: 70, boxSizing: 'border-box' }}
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Or type a custom reason…"
            />
            <div style={{ ...actionRow, marginTop: 10 }}>
              <button style={rejectBtnStyle} disabled={busy} onClick={rejectAll}>
                {busy ? 'Rejecting…' : 'Confirm Reject All'}
              </button>
              <button style={ghostBtn} onClick={() => setRejecting(false)}>Cancel</button>
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}

// ─────────────────────────── LEND PANEL ──────────────────────────
function LendPanel({ item, onBack, onDone, onError }: {
  item: QueueItem; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [stage, setStage]     = useState<'decide' | 'lend'>('decide');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason]   = useState('');
  const [busy, setBusy]       = useState(false);

  const PRESET_REASONS = [
    'Equipment not available for the requested window.',
    'Student has an existing active borrow.',
    'Requested duration exceeds the allowed limit.',
    'Insufficient stock for this item.',
  ];

  async function accept() {
    setBusy(true);
    try { await approveRequest(item.borrow_request_id); setStage('lend'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!reason.trim()) { onError('Enter a rejection reason.'); return; }
    setBusy(true);
    try { await rejectRequest(item.borrow_request_id, reason); onDone(`Request rejected for ${item.student_name}.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button style={backBtn} onClick={onBack}>← Back</button>
        <strong style={{ fontSize: 16 }}>{item.equipment_type_name}</strong>
        <span style={{ fontSize: 13, color: '#5c6773' }}>{item.student_name}</span>
      </div>

      <Panel title="Request Details">
        <div style={detailRow}><span style={detailLabel}>Student</span><span>{item.student_name} ({item.student_email})</span></div>
        <div style={detailRow}><span style={detailLabel}>Equipment</span><span>{item.equipment_type_name}</span></div>
        <div style={detailRow}>
          <span style={detailLabel}>Window</span>
          <span>{new Date(item.requested_start_at).toLocaleString()} → {new Date(item.requested_return_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div style={detailRow}><span style={detailLabel}>Submitted</span><span>{new Date(item.submitted_at).toLocaleString()}</span></div>
      </Panel>

      {stage === 'decide' && !rejecting && (
        <div style={actionRow}>
          <button style={acceptBtn} disabled={busy} onClick={accept}>{busy ? 'Approving…' : 'Approve & Proceed to Lend'}</button>
          <button style={rejectBtnStyle} disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
          <button style={ghostBtn} onClick={onBack}>Back</button>
        </div>
      )}

      {stage === 'decide' && rejecting && (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Rejection reason:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {PRESET_REASONS.map((p) => (
              <button key={p} style={{ ...ghostBtn, fontSize: 12, background: reason === p ? '#e7edf4' : undefined }}
                onClick={() => setReason(p)}>{p}</button>
            ))}
          </div>
          <textarea
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, minHeight: 70, boxSizing: 'border-box' }}
            value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a custom reason…"
          />
          <div style={{ ...actionRow, marginTop: 10 }}>
            <button style={rejectBtnStyle} disabled={busy} onClick={reject}>{busy ? 'Rejecting…' : 'Confirm Reject'}</button>
            <button style={ghostBtn} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}

      {stage === 'lend' && <ArticlePicker item={item} onDone={onDone} onError={onError} />}
    </>
  );
}

// ─────────────────────────── ARTICLE PICKER ──────────────────────
function ArticlePicker({ item, onDone, onError }: {
  item: QueueItem; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [agreedStart, setStart] = useState(item.requested_start_at.slice(0, 16));
  const [agreedEnd, setEnd]     = useState(item.requested_return_at.slice(0, 16));
  const [busy, setBusy]         = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listArticles({ equipmentTypeId: item.equipment_type_id, state: 'AVAILABLE' });
      setArticles(r.articles);
    } catch (e) { onError(errMsg(e)); }
  }, [item.equipment_type_id, onError]);
  useEffect(() => { void load(); }, [load]);

  async function lend() {
    if (selected.length === 0) { onError('Select at least one article.'); return; }
    setBusy(true);
    try {
      await lendPlatform({ borrowRequestId: item.borrow_request_id, articleIds: selected, agreedStartAt: new Date(agreedStart).toISOString(), agreedReturnAt: new Date(agreedEnd).toISOString() });
      onDone(`Lent ${selected.length} article(s) of ${item.equipment_type_name} to ${item.student_name}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  function toggle(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  return (
    <Panel title={`Select Articles — ${item.equipment_type_name}`}>
      {articles.length === 0 ? <p style={muted}>No available articles for this type.</p> : (
        <>
          {articles.map((a) => (
            <label key={a.article_id} style={checkRow}>
              <input type="checkbox" checked={selected.includes(a.article_id)} onChange={() => toggle(a.article_id)} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{a.barcode}</span>
              <span style={{ color: '#5c6773', fontSize: 12 }}>· {a.current_condition_label}</span>
            </label>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, maxWidth: 480 }}>
            <label style={{ fontSize: 13 }}>Agreed start<br /><input type="datetime-local" style={dtInput} value={agreedStart} onChange={(e) => setStart(e.target.value)} /></label>
            <label style={{ fontSize: 13 }}>Agreed return<br /><input type="datetime-local" style={dtInput} value={agreedEnd} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={acceptBtn} disabled={busy || selected.length === 0} onClick={lend}>
              {busy ? 'Lending…' : `Confirm Lend (${selected.length} article${selected.length !== 1 ? 's' : ''})`}
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

// ─────────────────────────── WALKIN FORM ─────────────────────────
function WalkinForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [types, setTypes]       = useState<EquipmentType[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [typeId, setTypeId]     = useState(0);
  const [selectedArticles, setSelectedArticles] = useState<string[]>([]);
  const [guestName, setGuestName]       = useState('');
  const [guestId, setGuestId]           = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [isFaculty, setIsFaculty]       = useState(false);
  const [agreedStart, setStart]         = useState(() => new Date().toISOString().slice(0, 16));
  const [agreedEnd, setEnd]             = useState(() => { const d = new Date(); d.setHours(d.getHours() + 2); return d.toISOString().slice(0, 16); });
  const [busy, setBusy] = useState(false);

  useEffect(() => { listTypes().then((r) => setTypes(r.types)).catch(() => {}); }, []);
  useEffect(() => {
    if (!typeId) { setArticles([]); setSelectedArticles([]); return; }
    listArticles({ equipmentTypeId: typeId, state: 'AVAILABLE' }).then((r) => setArticles(r.articles)).catch(() => {});
  }, [typeId]);

  function toggleArticle(id: string) {
    setSelectedArticles((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!typeId || selectedArticles.length === 0) { onError('Select equipment type and at least one article.'); return; }
    setBusy(true);
    try {
      await lendWalkinGuest({ guestFullName: guestName, guestIdNumber: guestId, guestContactNumber: guestContact, guestIsFaculty: isFaculty, equipmentTypeId: typeId, articleIds: selectedArticles, agreedStartAt: new Date(agreedStart).toISOString(), agreedReturnAt: new Date(agreedEnd).toISOString() });
      onDone(`Walk-in lend recorded for ${guestName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 560, marginBottom: 16 }}>
        <L label="Guest full name"><input style={inp} value={guestName} onChange={(e) => setGuestName(e.target.value)} required /></L>
        <L label="ID card number"><input style={inp} value={guestId} onChange={(e) => setGuestId(e.target.value)} required /></L>
        <L label="Contact number"><input style={inp} value={guestContact} onChange={(e) => setGuestContact(e.target.value)} required /></L>
        <L label="Faculty member?">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8 }}>
            <input type="checkbox" checked={isFaculty} onChange={(e) => setIsFaculty(e.target.checked)} />
            Yes, faculty
          </label>
        </L>
        <L label="Equipment type">
          <select style={inp} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
            <option value={0}>Select</option>
            {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name} ({t.lending_unit})</option>)}
          </select>
        </L>
        <L label="Agreed start"><input type="datetime-local" style={inp} value={agreedStart} onChange={(e) => setStart(e.target.value)} /></L>
        <L label="Agreed return"><input type="datetime-local" style={inp} value={agreedEnd} onChange={(e) => setEnd(e.target.value)} /></L>
      </div>
      {articles.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <span style={lbl}>Select articles</span>
          {articles.map((a) => (
            <label key={a.article_id} style={checkRow}>
              <input type="checkbox" checked={selectedArticles.includes(a.article_id)} onChange={() => toggleArticle(a.article_id)} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{a.barcode}</span>
              <span style={{ color: '#5c6773', fontSize: 12 }}>· {a.current_condition_label}</span>
            </label>
          ))}
        </div>
      )}
      <button style={acceptBtn} disabled={busy}>{busy ? 'Lending…' : 'Record Walk-in Lend'}</button>
    </form>
  );
}

// ─────────────────────────── shared UI ───────────────────────────
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={panel}>
      <div style={panelHead}><span>{title}</span>{action}</div>
      <div style={panelBody}>{children}</div>
    </section>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

// ─── styles ──────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 900, margin: '0 auto', paddingBottom: 48 };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const dtInput: React.CSSProperties = { ...inp, marginTop: 4 };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const rejectBtnStyle: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#26485f', border: '1px solid #dfe3e8', borderRadius: 4, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
const backBtn: React.CSSProperties = { background: '#f0f4f8', color: '#26485f', border: '1px solid #dfe3e8', borderRadius: 4, padding: '6px 12px', fontSize: 13, cursor: 'pointer' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14 };
const detailLabel: React.CSSProperties = { font: '600 13px var(--font-body)', color: '#555' };
const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '4px 0', cursor: 'pointer' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok:  { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
