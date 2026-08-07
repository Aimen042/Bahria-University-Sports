/**
 * Inventory console (Feature 4) — staff only.
 * Three tabs: Equipment | Articles | Damage Flags
 *
 * Architecture:
 * - Shared data (types, status, cats) lives at screen level, fetched once after
 *   auth confirms, passed as props so tabs don't re-fetch on switch.
 * - Each tab manages its OWN local error/notice state independently.
 *   This eliminates all cross-tab flash bleed and useCallback dep instability.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { ApiRequestError } from '../../lib/api.js';
import * as inv from './api.js';
import { STATE_LABEL } from './api.js';
import { SPORT_BUNDLES } from '../../lib/sportBundles.js';

type Tab = 'equipment' | 'articles' | 'damage';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}

export default function InventoryScreen() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('equipment');

  // Shared data — fetched once, survives tab switches
  const [types, setTypes]   = useState<inv.EquipmentType[]>([]);
  const [status, setStatus] = useState<inv.StatusRow[]>([]);
  const [cats, setCats]     = useState<inv.SportCategory[]>([]);

  const loadShared = useCallback(async () => {
    try {
      const [t, s, c] = await Promise.all([
        inv.listTypes(),
        inv.listStatus(),
        inv.listSportCategories(),
      ]);
      setTypes(t.types);
      setStatus(s.status);
      setCats(c.categories);
    } catch (_) {
      // shared load failure is silent — tabs show their own errors
    }
  }, []);

  // Only run after auth is confirmed — userId is a stable string
  const userId = user?.userId;
  useEffect(() => {
    if (!userId) return;
    void loadShared();
  }, [userId, loadShared]);

  if (loading) return <PortalShell title="Inventory"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'COORDINATOR') {
    return <Navigate to="/home" replace />;
  }

  return (
    <PortalShell title="Inventory" tint={user.role === 'SUPER_ADMIN' ? 'navy' : 'slate'}>
      <div style={wrap}>
        <div style={tabRow} role="tablist">
          {(['equipment', 'articles', 'damage'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t}
              onClick={() => setTab(t)}
              style={{ ...tabBtn, ...(tab === t ? tabActive : null) }}>
              {t === 'equipment' ? 'Equipment' : t === 'articles' ? 'Articles' : 'Damage Flags'}
            </button>
          ))}
        </div>

        {tab === 'equipment' && (
          <EquipmentTab types={types} status={status} cats={cats} onRefresh={loadShared} />
        )}
        {tab === 'articles' && (
          <ArticlesTab types={types} onRefresh={loadShared} />
        )}
        {tab === 'damage' && <DamageTab />}
      </div>
    </PortalShell>
  );
}

// ─────────────────────────── EQUIPMENT TAB ───────────────────────
function EquipmentTab({ types, status, cats, onRefresh }: {
  types: inv.EquipmentType[];
  status: inv.StatusRow[];
  cats: inv.SportCategory[];
  onRefresh: () => void;
}) {
  const [error, setError]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const badgeStyle = (b: string) =>
    b === 'AVAILABLE' ? badge.ok : b === 'LOW_STOCK' ? badge.warn : badge.danger;
  const statusFor = (id: number) => status.find((s) => s.equipment_type_id === id);

  return (
    <>
      {error  && <div style={box.err}>{error}</div>}
      {notice && <div style={box.ok}>{notice}</div>}
      <Panel title="Equipment Types" action={
        <button style={primaryBtn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Close' : 'Add Type'}
        </button>
      }>
        {showForm && (
          <AddTypeForm
            cats={cats}
            onDone={() => {
              setShowForm(false);
              setNotice('Equipment types created.');
              setError(null);
              onRefresh();
            }}
            onError={(m) => { setError(m); setNotice(null); }}
          />
        )}
        {types.length === 0
          ? <p style={muted}>No equipment types yet. Add one to begin.</p>
          : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}></th>
                  <th style={th}>Name</th>
                  <th style={th}>Sport</th>
                  <th style={th}>Setting</th>
                  <th style={th}>Unit</th>
                  <th style={th}>Available</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => {
                  const s = statusFor(t.equipment_type_id);
                  return (
                    <tr key={t.equipment_type_id}>
                      <td style={td}>
                        {t.image_url
                          ? <img src={t.image_url} alt="" style={thumb}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          : <div style={thumbPlaceholder} />}
                      </td>
                      <td style={td}>{t.name}</td>
                      <td style={td}>{t.sport_category_name}</td>
                      <td style={td}>{t.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                      <td style={td}>{t.lending_unit}</td>
                      <td style={td}>{s ? s.available_units : '—'}</td>
                      <td style={td}>
                        {s && (
                          <span style={{ ...badgeBase, ...badgeStyle(s.status_badge) }}>
                            {s.status_badge.replace('_', ' ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </Panel>
    </>
  );
}

// ─────────────────────────── ADD TYPE FORM ───────────────────────
function AddTypeForm({ cats, onDone, onError }: {
  cats: inv.SportCategory[];
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [selectedBundle, setSelectedBundle] = useState('');
  const [threshold, setThreshold] = useState('5');
  const [hours, setHours]         = useState(2);
  const [mins, setMins]           = useState(0);
  const [good, setGood]           = useState(70);
  const [worn, setWorn]           = useState(40);
  const [imageUrl, setImageUrl]   = useState('');
  const [busy, setBusy]           = useState(false);
  const [results, setResults]     = useState<Array<{ name: string; ok: boolean; msg: string }>>([]);

  const bundle = SPORT_BUNDLES.find((b) => b.label === selectedBundle) ?? null;
  const catId  = bundle
    ? cats.find((c) => c.name.toLowerCase() === bundle.sportName.toLowerCase())?.sport_category_id ?? null
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!bundle)       { onError('Select a sport first.'); return; }
    if (catId === null) { onError(`"${bundle.sportName}" not found in DB.`); return; }
    const th = threshold === '' ? 0 : Number(threshold);
    if (isNaN(th) || th < 0) { onError('Invalid threshold.'); return; }
    const dur = hours * 60 + mins;
    if (dur <= 0) { onError('Max duration must be > 0.'); return; }

    setBusy(true); setResults([]);
    const out: typeof results = [];
    for (const item of bundle.items) {
      try {
        await inv.createType({
          sportCategoryId: catId, name: item.name,
          lendingUnit: item.lendingUnit, lowStockThreshold: th,
          maxBorrowDurationMinutes: dur, conditionGoodMinScore: good,
          conditionWornMinScore: worn, isIndoor: item.isIndoor,
          imageUrl: imageUrl.trim() || undefined,
        });
        out.push({ name: item.name, ok: true, msg: 'Created' });
      } catch (err) {
        out.push({ name: item.name, ok: false, msg: errMsg(err) });
      }
    }
    setBusy(false); setResults(out);
    if (out.some((r) => r.ok)) onDone();
  }

  return (
    <form onSubmit={submit} style={formGrid}>
      <L label="Sport">
        <select style={inp} value={selectedBundle}
          onChange={(e) => { setSelectedBundle(e.target.value); setResults([]); }} required>
          <option value="">Select a sport</option>
          {SPORT_BUNDLES.map((b) => <option key={b.label} value={b.label}>{b.label}</option>)}
        </select>
      </L>
      <L label="Low-stock threshold">
        <input style={inp} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
      </L>
      <L label="Max borrow — hours">
        <input type="number" min={0} max={23} style={inp} value={hours}
          onChange={(e) => setHours(Number(e.target.value))} />
      </L>
      <L label="Max borrow — minutes">
        <select style={inp} value={mins} onChange={(e) => setMins(Number(e.target.value))}>
          {[0,15,30,45].map((m) => <option key={m} value={m}>{String(m).padStart(2,'0')}</option>)}
        </select>
      </L>
      <L label="GOOD score ≥">
        <input type="number" min={0} max={100} style={inp} value={good}
          onChange={(e) => setGood(Number(e.target.value))} />
      </L>
      <L label="WORN score ≥">
        <input type="number" min={0} max={100} style={inp} value={worn}
          onChange={(e) => setWorn(Number(e.target.value))} />
      </L>
      <div style={{ gridColumn: '1/-1' }}>
        <L label="Image URL (optional)">
          <input style={inp} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
        </L>
      </div>
      {bundle && (
        <div style={{ gridColumn: '1/-1', background: '#f7f9fb', border: '1px solid #dfe3e8', borderRadius: 4, padding: '10px 14px' }}>
          <span style={{ ...lbl, marginBottom: 8 }}>Items for {bundle.label}</span>
          {bundle.items.map((item) => (
            <div key={item.name} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 13 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0a6ebd', marginTop: 5, flexShrink: 0, display: 'inline-block' }} />
              <span style={{ flex: 1 }}>{item.name}</span>
              <span style={{ color: '#888', fontSize: 12 }}>{item.lendingUnit} · {item.isIndoor ? 'Indoor' : 'Outdoor'}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ gridColumn: '1/-1' }}>
        <button style={primaryBtn} disabled={busy || !bundle}>
          {busy ? 'Adding…' : bundle ? `Add All ${bundle.items.length} Items for ${bundle.label}` : 'Add Items'}
        </button>
      </div>
      {results.length > 0 && (
        <div style={{ gridColumn: '1/-1', border: '1px solid #dfe3e8', borderRadius: 4, padding: '10px 14px', fontSize: 13 }}>
          {results.map((r) => (
            <div key={r.name} style={{ display: 'flex', gap: 8, padding: '2px 0', color: r.ok ? '#1f7a45' : '#b3352b' }}>
              <span>{r.ok ? '✓' : '✗'}</span>
              <span style={{ flex: 1 }}>{r.name}</span>
              {!r.ok && <span>{r.msg}</span>}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}

// ─────────────────────────── ARTICLES TAB ────────────────────────
function ArticlesTab({ types, onRefresh }: {
  types: inv.EquipmentType[];
  onRefresh: () => void;
}) {
  // Each tab owns its own error/notice — no cross-tab bleed possible
  const [error, setError]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [articles, setArticles] = useState<inv.Article[]>([]);
  const [unpaired, setUnpaired] = useState<Array<{
    article_id: string; barcode: string;
    equipment_type_id: number; equipment_type_name: string;
  }>>([]);
  const [filterType, setFilterType]           = useState(0);
  const [filterState, setFilterState]         = useState<inv.ArticleState | ''>('');
  const [filterCondition, setFilterCondition] = useState<inv.ConditionLabel | ''>('');

  const load = useCallback(async () => {
    try {
      const [a, u] = await Promise.all([
        inv.listArticles({
          equipmentTypeId: filterType      || undefined,
          state:           filterState     || undefined,
          condition:       filterCondition || undefined,
        }),
        inv.listUnpaired(),
      ]);
      setArticles(a.articles);
      setUnpaired(u.articles);
      setError(null); // clear any previous error on success
    } catch (e) {
      setError(errMsg(e));
      setNotice(null);
    }
  }, [filterType, filterState, filterCondition]);

  useEffect(() => { void load(); }, [load]);

  function ok(m: string)  { setNotice(m); setError(null);  }
  function err(m: string) { setError(m);  setNotice(null); }

  async function scan(id: string) {
    const raw = prompt('Health score (0–100)?');
    if (raw === null) return;
    const score = Number(raw);
    if (isNaN(score)) { err('Score must be a number.'); return; }
    try {
      const r = await inv.scanArticle(id, { kind: 'AD_HOC', score });
      ok(`Scan recorded — condition: ${r.conditionLabel}.`);
      void load();
    } catch (e) { err(errMsg(e)); }
  }

  async function decommission(id: string) {
    if (!confirm('Decommission this article? This is permanent.')) return;
    try {
      await inv.decommissionArticle(id);
      ok('Article decommissioned.');
      void load();
      onRefresh();
    } catch (e) { err(errMsg(e)); }
  }

  const stateBadge = (s: inv.ArticleState) =>
    s === 'AVAILABLE' ? badge.ok :
    s === 'DAMAGED'   ? badge.danger :
    s === 'UNPAIRED'  ? badge.warn : badge.neutral;

  const seenPairs = new Set<string>();
  const rows: Array<{ kind: 'single' | 'pair'; a: inv.Article; b?: inv.Article }> = [];
  for (const a of articles) {
    if (a.pair_id) {
      if (seenPairs.has(a.pair_id)) continue;
      seenPairs.add(a.pair_id);
      const b = articles.find((x) => x.pair_id === a.pair_id && x.article_id !== a.article_id);
      rows.push({ kind: 'pair', a, b });
    } else {
      rows.push({ kind: 'single', a });
    }
  }

  return (
    <>
      {error  && <div style={box.err}>{error}</div>}
      {notice && <div style={box.ok}>{notice}</div>}

      <Panel title="Add Article(s)">
        <AddArticleForms
          types={types}
          onDone={(m) => { ok(m); void load(); onRefresh(); }}
          onError={err}
        />
      </Panel>

      {unpaired.length >= 2 && (
        <Panel title="Re-pair Articles"
          action={<span style={{ fontSize: 12.5, color: '#8a949f' }}>After a dissolved pair</span>}>
          <RePairForm
            unpaired={unpaired}
            onDone={() => { ok('Articles re-paired.'); void load(); }}
            onError={err}
          />
        </Panel>
      )}

      <Panel title="Articles" action={
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={{ ...inp, width: 'auto' }} value={filterType}
            onChange={(e) => setFilterType(Number(e.target.value))}>
            <option value={0}>All types</option>
            {types.map((t) => (
              <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>
            ))}
          </select>
          <select style={{ ...inp, width: 'auto' }} value={filterState}
            onChange={(e) => setFilterState(e.target.value as inv.ArticleState | '')}>
            <option value="">All states</option>
            {(['AVAILABLE','UNPAIRED','ON_LOAN','DAMAGED'] as inv.ArticleState[]).map((s) => (
              <option key={s} value={s}>{STATE_LABEL[s]}</option>
            ))}
          </select>
          <select style={{ ...inp, width: 'auto' }} value={filterCondition}
            onChange={(e) => setFilterCondition(e.target.value as inv.ConditionLabel | '')}>
            <option value="">All conditions</option>
            <option value="GOOD">Good</option>
            <option value="WORN">Worn</option>
            <option value="DAMAGED">Damaged</option>
          </select>
        </div>
      }>
        {rows.length === 0
          ? <p style={muted}>No articles match. Add one above.</p>
          : (
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Barcode</th>
                  <th style={th}>Type</th>
                  <th style={th}>Condition</th>
                  <th style={th}>State</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => r.kind === 'pair' ? (
                  <tr key={r.a.pair_id}>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>
                      <span style={pairChip}>Pair</span>
                      {r.a.barcode}{r.b ? ` + ${r.b.barcode}` : ''}
                    </td>
                    <td style={td}>{r.a.equipment_type_name}</td>
                    <td style={td}>
                      {r.a.current_condition_label}
                      {r.b && r.b.current_condition_label !== r.a.current_condition_label
                        ? ` / ${r.b.current_condition_label}` : ''}
                    </td>
                    <td style={td}>
                      <span style={{ ...badgeBase, ...stateBadge(r.a.state) }}>
                        {STATE_LABEL[r.a.state]}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={linkBtn} onClick={() => scan(r.a.article_id)}>Scan A</button>
                      {r.b && <button style={linkBtn} onClick={() => scan(r.b!.article_id)}>Scan B</button>}
                    </td>
                  </tr>
                ) : (
                  <tr key={r.a.article_id}>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{r.a.barcode}</td>
                    <td style={td}>{r.a.equipment_type_name}</td>
                    <td style={td}>{r.a.current_condition_label}</td>
                    <td style={td}>
                      <span style={{ ...badgeBase, ...stateBadge(r.a.state) }}>
                        {STATE_LABEL[r.a.state]}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button style={linkBtn} onClick={() => scan(r.a.article_id)}>Scan</button>
                      <button style={{ ...linkBtn, color: 'var(--danger)' }}
                        onClick={() => decommission(r.a.article_id)}>Decommission</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Panel>
    </>
  );
}

function AddArticleForms({ types, onDone, onError }: {
  types: inv.EquipmentType[];
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [equipmentTypeId, setType] = useState(0);
  const selectedType = types.find((t) => t.equipment_type_id === equipmentTypeId);
  const isPair = selectedType?.lending_unit === 'PAIR';
  const [barcode, setBarcode]   = useState('');
  const [score, setScore]       = useState(90);
  const [barcodeA, setBarcodeA] = useState('');
  const [barcodeB, setBarcodeB] = useState('');
  const [scoreA, setScoreA]     = useState(90);
  const [scoreB, setScoreB]     = useState(90);
  const [busy, setBusy]         = useState(false);

  async function submitSingle(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await inv.addArticle({ equipmentTypeId, barcode, entryScore: score });
      onDone(`Article ${r.article.barcode} added (${STATE_LABEL[r.article.state]}, ${r.article.conditionLabel}).`);
      setBarcode('');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  async function submitPair(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await inv.addArticlePair({ equipmentTypeId, barcodeA, barcodeB, entryScoreA: scoreA, entryScoreB: scoreB });
      onDone(r.pairEntry.paired
        ? `Pair added: ${r.pairEntry.barcodeA} + ${r.pairEntry.barcodeB} (AVAILABLE).`
        : `Pair added but not linked — one article needs review.`);
      setBarcodeA(''); setBarcodeB('');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <L label="Equipment type">
        <select style={{ ...inp, maxWidth: 320 }} value={equipmentTypeId}
          onChange={(e) => setType(Number(e.target.value))}>
          <option value={0}>Select</option>
          {types.map((t) => (
            <option key={t.equipment_type_id} value={t.equipment_type_id}>
              {t.name} ({t.lending_unit})
            </option>
          ))}
        </select>
      </L>

      {equipmentTypeId === 0 ? null : isPair ? (
        <form onSubmit={submitPair} style={{ ...formGrid, marginTop: 10 }}>
          <p style={{ gridColumn: '1/-1', margin: 0, fontSize: 13, color: '#5c6773' }}>
            This type lends in pairs — enter both articles together.
          </p>
          <L label="Barcode A"><input style={inp} value={barcodeA} onChange={(e) => setBarcodeA(e.target.value)} required /></L>
          <L label="Barcode B"><input style={inp} value={barcodeB} onChange={(e) => setBarcodeB(e.target.value)} required /></L>
          <L label="Entry score A"><input type="number" style={inp} value={scoreA} onChange={(e) => setScoreA(Number(e.target.value))} /></L>
          <L label="Entry score B"><input type="number" style={inp} value={scoreB} onChange={(e) => setScoreB(Number(e.target.value))} /></L>
          <div style={{ gridColumn: '1/-1' }}><button style={primaryBtn} disabled={busy}>{busy ? 'Adding…' : 'Add Pair'}</button></div>
        </form>
      ) : (
        <form onSubmit={submitSingle} style={{ ...formGrid, marginTop: 10 }}>
          <L label="Barcode"><input style={inp} value={barcode} onChange={(e) => setBarcode(e.target.value)} required /></L>
          <L label="Entry health score (0–100)"><input type="number" style={inp} value={score} onChange={(e) => setScore(Number(e.target.value))} /></L>
          <div style={{ gridColumn: '1/-1' }}><button style={primaryBtn} disabled={busy}>{busy ? 'Adding…' : 'Add Article'}</button></div>
        </form>
      )}
    </>
  );
}

function RePairForm({ unpaired, onDone, onError }: {
  unpaired: Array<{ article_id: string; barcode: string; equipment_type_id: number; equipment_type_name: string }>;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!a || !b || a === b) { onError('Pick two different unpaired articles.'); return; }
    setBusy(true);
    try { await inv.formPair(a, b); onDone(); setA(''); setB(''); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  const opt = (x: typeof unpaired[number]) =>
    <option key={x.article_id} value={x.article_id}>{x.barcode} · {x.equipment_type_name}</option>;
  return (
    <form onSubmit={submit} style={formGrid}>
      <L label="Article A"><select style={inp} value={a} onChange={(e) => setA(e.target.value)}><option value="">Select</option>{unpaired.map(opt)}</select></L>
      <L label="Article B"><select style={inp} value={b} onChange={(e) => setB(e.target.value)}><option value="">Select</option>{unpaired.map(opt)}</select></L>
      <div style={{ gridColumn: '1/-1' }}><button style={primaryBtn} disabled={busy}>{busy ? 'Pairing…' : 'Re-pair'}</button></div>
    </form>
  );
}

// ─────────────────────────── DAMAGE TAB ──────────────────────────
function DamageTab() {
  const [error, setError]   = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flags, setFlags]   = useState<inv.DamageFlag[]>([]);

  const load = useCallback(async () => {
    try { const r = await inv.listDamageFlags(); setFlags(r.flags); setError(null); }
    catch (e) { setError(errMsg(e)); setNotice(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function clearFlag(id: string) {
    const label = prompt('New condition (GOOD / WORN / DAMAGED)?', 'WORN');
    if (!label) return;
    const up = label.toUpperCase();
    if (!['GOOD','WORN','DAMAGED'].includes(up)) { setError('Must be GOOD, WORN, or DAMAGED.'); return; }
    try {
      await inv.clearDamageFlag(id, up as inv.ConditionLabel);
      setNotice('Flag cleared.'); setError(null);
      void load();
    } catch (e) { setError(errMsg(e)); setNotice(null); }
  }

  return (
    <>
      {error  && <div style={box.err}>{error}</div>}
      {notice && <div style={box.ok}>{notice}</div>}
      <Panel title="Open Damage Flags">
        {flags.length === 0
          ? <p style={muted}>No open damage flags.</p>
          : (
            <table style={table}>
              <thead><tr><th style={th}>Barcode</th><th style={th}>Type</th><th style={th}>Raised by</th><th style={th} /></tr></thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.flag_id}>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{f.barcode}</td>
                    <td style={td}>{f.equipment_type_name}</td>
                    <td style={td}>{f.raised_by_system ? 'System' : 'Staff'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <button style={primaryBtn} onClick={() => clearFlag(f.flag_id)}>Review &amp; Clear</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Panel>
    </>
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
const wrap: React.CSSProperties = { maxWidth: 900, margin: '0 auto' };
const tabRow: React.CSSProperties = { display: 'flex', gap: 4, padding: 4, background: '#e7edf4', borderRadius: 10, marginBottom: 18 };
const tabBtn: React.CSSProperties = { flex: 1, font: '500 14px var(--font-body)', padding: '9px 10px', border: 'none', background: 'transparent', color: '#5c6773', borderRadius: 7, cursor: 'pointer' };
const tabActive: React.CSSProperties = { background: '#fff', color: '#26485f', boxShadow: '0 1px 2px rgba(15,27,45,0.1)' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 560 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const primaryBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', font: '500 13px var(--font-body)', color: '#0a6ebd', cursor: 'pointer', padding: '4px 8px' };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4 };
const badge = {
  ok:      { background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  warn:    { background: '#fdf1e3', color: '#9a6412' } as React.CSSProperties,
  danger:  { background: '#fbe9e7', color: '#b3352b' } as React.CSSProperties,
  neutral: { background: '#eceff2', color: '#566' }    as React.CSSProperties,
};
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 14, fontSize: 14 } as React.CSSProperties,
  ok:  { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 14, fontSize: 14 } as React.CSSProperties,
};
const thumb: React.CSSProperties = { width: 32, height: 32, objectFit: 'cover', borderRadius: 4, display: 'block' };
const thumbPlaceholder: React.CSSProperties = { width: 32, height: 32, borderRadius: 4, background: '#eef1f4' };
const pairChip: React.CSSProperties = { font: '600 10px var(--font-body)', padding: '1px 6px', borderRadius: 3, background: '#e7edf4', color: '#26485f', marginRight: 6, textTransform: 'uppercase', letterSpacing: '0.03em' };
