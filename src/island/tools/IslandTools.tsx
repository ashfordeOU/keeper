// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's tools: Ask, AI usage, sales, stocks, notes, weather,
// system, converter, emoji, shortcuts, calendar and the extras for timers,
// the shelf and the mirror. Each samples only while it is on screen.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IslandState } from '../../../core/api';
import type { IslandShortcut, SalesConfigView } from '../../../core/api-island-tools';
import { addRecent, buildIndex, GROUPS, searchEmoji, TONES, withTone, type EmojiEntry } from '../../../core/island-tools/emoji';
import { isTodayPad, noteTitle, searchNotes, takeLine, todayPad, upsert, type IslandToolsStore, type QuickNote } from '../../../core/island-tools/notes';
import { dayKey } from '../../../core/pim/tasks';
import { addTaskFromText } from '../../pim/tasks-ui';
import { useFeature } from '../../features';
import type { SalesSummary } from '../../../core/island-tools/sales';
import { parseWatchlist, sparkPath, type Point, type Quote } from '../../../core/island-tools/stocks';
import { answer, type Rates } from '../../../core/island-tools/units';
import { formatTokens, warnLevel, type UsageReport, type UsageTool } from '../../../core/island-tools/usage';
import { agendaFor, countdown, inIsland, islandAgenda, type AgendaItem } from '../../../core/pim/agenda';
import { parseQuickAdd } from '../../../core/pim/quickadd';
import type { SystemAccess } from '../../../core/pim/syscal';
import type { CalendarInfo, Occurrence } from '../../../core/pim/types';
import { describeCode } from '../../../core/weather';
import { formatBytes } from '../../../core/format';
import { memoryDetail, memoryTone } from '../../../core/memory';
import { api } from '../../api';
import { openNative } from '../../lib/native';
import { Icon } from '../../components/Icon';
import { useStore } from '../../state';

const say = (text: string) => window.dispatchEvent(new CustomEvent('island-toast', { detail: text }));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const timeOf = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const until = (t?: number) => {
  if (!t) return '';
  const m = Math.max(0, Math.round((t - Date.now()) / 60_000));
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} days`;
};

/** Runs `fn` now and every `ms` while the tool is on screen; nothing in the background. */
function useWhileVisible(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ref.current();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') ref.current(); }, ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

/** The Island tools' own store (notes, to-dos, scripts, watchlist, recent emoji). */
export function useToolsStore(): [IslandToolsStore | null, (p: Partial<IslandToolsStore>) => void] {
  const [s, setS] = useState<IslandToolsStore | null>(null);
  useEffect(() => {
    const load = () => void api.islandTools.store().then(setS);
    load();
    // An AI added to a note (island_notes_append): show it, so typing here does not write over it.
    return api.on('island-tools-changed' as 'navigate', load as never);
  }, []);
  const save = useCallback((p: Partial<IslandToolsStore>) => {
    setS((cur) => (cur ? { ...cur, ...p } : cur));
    void api.islandTools.saveStore(p);
  }, []);
  return [s, save];
}

// ---------------------------------------------------------------- Ask

const QUICK = [
  { id: 'rewrite', label: 'Rewrite', prompt: 'Rewrite this to be clear and friendly, keeping the meaning.' },
  { id: 'shorter', label: 'Shorter', prompt: 'Make this shorter without losing anything important.' },
  { id: 'summarize', label: 'Summarize', prompt: 'Summarize this in three short bullet points.' },
  { id: 'extract', label: 'Extract', prompt: 'Extract the key facts (names, dates, amounts, addresses, links) as a short list.' },
  { id: 'brainstorm', label: 'Brainstorm', prompt: 'Brainstorm ten ideas about this, one line each.' },
  { id: 'fix', label: 'Fix grammar', prompt: 'Fix spelling and grammar; change nothing else.' },
];

export function AskTool() {
  const [conns, setConns] = useState<{ id: string; label: string; local: boolean; ready: boolean; os?: boolean }[]>([]);
  const [conn, setConn] = useState('');
  const [prompt, setPrompt] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string; provider: string }[]>([]);
  useEffect(() => {
    void api.islandTools.askConnections().then((c) => {
      setConns(c);
      // Apple's on-device model first where there is one, then a local one, then the first ready.
      const pick = c.find((x) => x.os && x.ready) ?? c.find((x) => x.local && x.ready) ?? c.find((x) => x.ready);
      if (pick) setConn(pick.id);
    });
  }, []);
  const go = async (p: string) => {
    if (!p.trim() && !input.trim()) return;
    setBusy(true);
    try {
      const r = await api.islandTools.ask(p || 'Help with this.', input || undefined, conn || undefined);
      setHistory((h) => [{ q: p || input.slice(0, 80), a: r.text, provider: r.provider }, ...h].slice(0, 20));
      setPrompt('');
    } catch (e) {
      say(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };
  const fromClipboard = async () => {
    const t = await navigator.clipboard?.readText?.().catch(() => '');
    if (t) setInput(t);
    else say('The clipboard has no text');
  };
  return (
    <div className="itool ask" onDragOver={(e) => e.preventDefault()} onDrop={async (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) setInput((await f.text()).slice(0, 40_000));
    }}>
      <div className="row-x">
        <select className="input sm" value={conn} onChange={(e) => setConn(e.target.value)} title="Which AI answers">
          {conns.length === 0 ? <option value="">No AI connected — set one up in Settings → AI &amp; Brain</option> : null}
          {conns.map((c) => <option key={c.id} value={c.id} disabled={!c.ready}>{c.label}{c.local ? ' · on this computer' : ''}{c.ready ? '' : ' (needs a key)'}</option>)}
        </select>
        <button className="btn sm" onClick={() => void fromClipboard()} title="Work on the text you copied"><Icon name="clipboard" size={11} /> Use clipboard</button>
      </div>
      <textarea className="input" rows={2} placeholder="Text to work on (paste, use the clipboard, or drop a file)…" value={input} onChange={(e) => setInput(e.target.value)} />
      <div className="chips">{QUICK.map((q) => <button key={q.id} className="chip" disabled={busy || !input.trim()} onClick={() => void go(q.prompt)}>{q.label}</button>)}</div>
      <div className="row-x">
        <input className="input" placeholder="Ask anything…" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void go(prompt); }} />
        <button className="btn sm primary" disabled={busy} onClick={() => void go(prompt)}>{busy ? 'Thinking…' : 'Ask'}</button>
      </div>
      <div className="answers">
        {history.map((h, i) => (
          <div key={i} className="answer tile">
            <div className="muted small">{h.q.slice(0, 90)} · {h.provider}</div>
            <div className="a">{h.a}</div>
            <div className="row-x">
              <button className="btn sm" onClick={() => void navigator.clipboard.writeText(h.a).then(() => say('Copied'))}><Icon name="copy" size={11} /> Copy</button>
              <button className="btn sm" onClick={() => setInput(h.a)}>Work on this</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- AI usage

function Bar({ pct, level }: { pct: number; level: string }) {
  return <div className={`ubar ${level}`}><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>;
}

export function UsageTool() {
  const [list, setList] = useState<UsageReport[] | null>(null);
  const [online, setOnline] = useState<Partial<Record<UsageTool, boolean>>>({});
  const load = useCallback(() => { void api.islandTools.usage().then(setList); void api.islandTools.usageOnline().then(setOnline); }, []);
  useWhileVisible(load, 60_000);
  const allow = async (t: UsageTool, on: boolean) => { await api.islandTools.setUsageOnline(t, on); load(); };
  if (!list) return <div className="muted">Looking…</div>;
  return (
    <div className="itool usage">
      {list.map((r) => (
        <div key={r.tool} className={`tile urow state-${r.state}`}>
          <div className="row-x"><b>{r.label}</b><span className="muted small grow">{r.source}</span>
            {(r.tool === 'claude' || r.tool === 'copilot' || r.tool === 'cursor') && r.state !== 'none' ? (
              <label className="small" title="Ask the provider for exact limits with this tool's own sign-in (nothing goes anywhere else)"><input type="checkbox" checked={!!online[r.tool]} onChange={(e) => void allow(r.tool, e.target.checked)} /> Exact limits</label>
            ) : null}
          </div>
          {r.windows.map((w) => (
            <div key={w.label} className="uwin">
              <span className="small">{w.label}</span>
              {w.usedPercent !== undefined ? <Bar pct={w.usedPercent} level={warnLevel(w.usedPercent)} /> : <span className="grow" />}
              <span className="small num">{w.usedPercent !== undefined ? `${Math.round(w.usedPercent)}%` : w.tokens !== undefined ? `${formatTokens(w.tokens)} tokens` : ''}{w.used !== undefined && w.limit ? ` · ${w.used}/${w.limit}` : ''}</span>
              <span className="muted small">{w.resetsAt ? `resets in ${until(w.resetsAt)}` : ''}</span>
            </div>
          ))}
          {r.message ? <div className="muted small">{r.message}</div> : null}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Sales

export function SalesTool() {
  const [conf, setConf] = useState<SalesConfigView | null>(null);
  const [s, setS] = useState<(SalesSummary & { errors: { provider: string; message: string }[] }) | null>(null);
  const [adding, setAdding] = useState<string>('');
  const [key, setKey] = useState('');
  const [shop, setShop] = useState('');
  const load = useCallback((force = false) => {
    void api.islandTools.salesConfig().then((c) => {
      setConf(c);
      if (c.providers.some((p) => p.connected)) void api.islandTools.sales(force).then(setS);
    });
  }, []);
  useWhileVisible(() => load(false), 5 * 60_000);
  if (!conf) return null;
  const fmt = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: conf.currency, maximumFractionDigits: v >= 1000 ? 0 : 2 });
  const connected = conf.providers.filter((p) => p.connected);
  return (
    <div className="itool sales">
      {s && connected.length ? (
        <>
          <div className="sales-top">
            <div><span className="muted small">Today</span><b className="big num">{fmt(s.today)}</b><span className="muted small">{s.count.today} sale{s.count.today === 1 ? '' : 's'}</span></div>
            <div><span className="muted small">7 days</span><b className="num">{fmt(s.week)}</b></div>
            <div><span className="muted small">30 days</span><b className="num">{fmt(s.month)}</b></div>
            <svg className="spark" viewBox="0 0 160 40" preserveAspectRatio="none"><path d={sparkPath(s.daily, 160, 38)} /></svg>
          </div>
          <div className="small muted">{s.byProvider.map((p) => `${conf.providers.find((x) => x.id === p.provider)?.label}: ${fmt(p.month)}`).join(' · ')}{s.unconverted.length ? ` · not converted: ${s.unconverted.map((u) => `${u.amount.toFixed(2)} ${u.currency}`).join(', ')}` : ''}</div>
          {s.errors.map((e) => <div key={e.provider} className="small" style={{ color: '#fca5a5' }}>{conf.providers.find((x) => x.id === e.provider)?.label}: {e.message}</div>)}
        </>
      ) : <div className="muted small">Connect a store or payment service with a read-only key. Keys stay in this computer's keychain; Keeper only reads your sales.</div>}
      <div className="chips">
        {conf.providers.map((p) => (
          <button key={p.id} className={`chip ${p.connected ? 'on' : ''}`} onClick={() => setAdding(adding === p.id ? '' : p.id)} title={p.connected ? 'Connected — click to change or remove' : p.keyHint}>{p.connected ? '● ' : '+ '}{p.label}</button>
        ))}
        <label className="small"><input type="checkbox" checked={conf.ping} onChange={(e) => void api.islandTools.setSalesPrefs({ ping: e.target.checked }).then(setConf)} /> Ping on new sales</label>
        <select className="input sm" value={conf.currency} onChange={(e) => void api.islandTools.setSalesPrefs({ currency: e.target.value }).then(() => load(true))}>{['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'CHF', 'SEK', 'BRL'].map((c) => <option key={c}>{c}</option>)}</select>
        <label className="small" title="Convert other currencies with the European Central Bank's daily rates (downloads the rates once a day)"><input type="checkbox" checked={conf.convert} onChange={(e) => void api.islandTools.setSalesPrefs({ convert: e.target.checked }).then(() => load(true))} /> Convert currencies</label>
        <button aria-label="Refresh" title="Refresh" className="btn sm" onClick={() => load(true)}><Icon name="refresh" size={11} /></button>
      </div>
      {adding ? (() => {
        const p = conf.providers.find((x) => x.id === adding)!;
        return (
          <div className="tile">
            <div className="small muted">{p.keyHint}</div>
            <div className="row-x">
              {p.needsShop ? <input className="input sm" placeholder="your-store.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value)} /> : null}
              <input className="input sm grow" type="password" placeholder="Read-only key" value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="btn sm primary" disabled={!key.trim()} onClick={() => void api.islandTools.setSalesProvider(p.id, key, shop).then((c) => { setConf(c); setKey(''); setAdding(''); load(true); })}>Save</button>
              {p.connected ? <button className="btn sm" onClick={() => void api.islandTools.removeSalesProvider(p.id).then((c) => { setConf(c); setAdding(''); setS(null); load(true); })}>Remove</button> : null}
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}

// ---------------------------------------------------------------- Stocks

export function StocksTool({ store, save }: { store: IslandToolsStore; save: (p: Partial<IslandToolsStore>) => void }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [chart, setChart] = useState<Point[]>([]);
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(store.stocks.join(' '));
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const symbols = store.stocks;
  useWhileVisible(() => { if (symbols.length) void api.islandTools.quotes(symbols).then((r) => { setQuotes(r.quotes); setErrors(r.errors); }); }, 60_000);
  useEffect(() => { void api.islandTools.stocksKey().then(setHasKey); }, []);
  useEffect(() => { if (open) void api.islandTools.chart(open).then(setChart); }, [open]);
  return (
    <div className="itool stocks">
      {edit ? (
        <div className="tile">
          <div className="row-x"><input className="input sm grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="AAPL MSFT NVDA BTC ETH" /><button className="btn sm primary" onClick={() => { save({ stocks: parseWatchlist(text) }); setEdit(false); }}>Save</button></div>
          <div className="small muted">Shares: delayed quotes from Stooq with no key, or live with a free Twelve Data key (also gives intraday charts). Crypto from CoinGecko.</div>
          <div className="row-x"><input className="input sm grow" type="password" placeholder={hasKey ? 'Twelve Data key saved' : 'Twelve Data key (optional)'} value={key} onChange={(e) => setKey(e.target.value)} /><button className="btn sm" disabled={!key.trim()} onClick={() => void api.islandTools.setStocksKey(key).then((ok) => { setHasKey(ok); setKey(''); })}>Save key</button></div>
        </div>
      ) : null}
      <div className="qlist">
        {symbols.map((sym) => {
          const q = quotes.find((x) => x.symbol === sym);
          return (
            <div key={sym} className={`qrow ${open === sym ? 'on' : ''}`} onClick={() => setOpen(open === sym ? null : sym)}>
              <b>{sym}</b>
              <span className="num grow" style={{ textAlign: 'right' }}>{q ? q.price.toLocaleString(undefined, { maximumFractionDigits: q.price < 10 ? 4 : 2 }) : '—'}</span>
              <span className={`num chg ${q?.changePct === undefined ? '' : q.changePct >= 0 ? 'up' : 'down'}`}>{q?.changePct !== undefined ? `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%` : ''}</span>
            </div>
          );
        })}
      </div>
      {open && chart.length > 1 ? <svg className="spark big" viewBox="0 0 400 70" preserveAspectRatio="none"><path d={sparkPath(chart.map((p) => p.v), 400, 68)} /></svg> : open ? <div className="muted small">{hasKey || /BTC|ETH|SOL/.test(open) ? 'Loading the chart…' : 'Intraday charts need a free Twelve Data key (Edit).'}</div> : null}
      {errors.map((e) => <div key={e} className="small muted">{e}</div>)}
      <button className="btn sm" onClick={() => setEdit(!edit)}><Icon name="settings" size={11} /> Edit list</button>
    </div>
  );
}

// ---------------------------------------------------------------- Notes

export function NotesTool({ store, save }: { store: IslandToolsStore; save: (p: Partial<IslandToolsStore>) => void }) {
  const [q, setQ] = useState('');
  const [id, setId] = useState<string | null>(store.notes[0]?.id ?? null);
  const list = searchNotes(store.notes, q);
  const cur = store.notes.find((n) => n.id === id);
  const update = (n: QuickNote) => save({ notes: upsert(store.notes, n) });
  const create = () => {
    const n: QuickNote = { id: uid(), text: '', created: Date.now(), updated: Date.now() };
    save({ notes: [n, ...store.notes] });
    setId(n.id);
  };
  // Today's pad: one note a day, made the first time it is opened.
  const openToday = () => {
    const p = todayPad(store.notes, dayKey(Date.now()));
    if (p.created) save({ notes: [p.note, ...store.notes] });
    setId(p.note.id);
  };
  const tasksOn = useFeature('islandTodos');
  // ⌘/Ctrl+Enter: the line under the cursor becomes a task for today (plain words work: "call Ana 3pm !!").
  const lineToTask = (e: React.KeyboardEvent<HTMLTextAreaElement>, n: QuickNote) => {
    if (!tasksOn || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const el = e.currentTarget;
    const r = takeLine(n.text, el.selectionStart);
    if (!r) return;
    update({ ...n, text: r.text, updated: Date.now() });
    window.requestAnimationFrame(() => el.setSelectionRange(r.caret, r.caret));
    void addTaskFromText(r.task, { plannedFor: dayKey(Date.now()) }).then((t) => t && say(`Task added: ${t.title}`));
  };
  return (
    <div className="itool notes">
      <div className="nlist">
        <div className="row-x"><input className="input sm grow" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn sm icon" title="New note" aria-label="New note" onClick={create}><Icon name="plus" size={11} /></button></div>
        <button className={`nitem ${cur && cur.id === todayPad([], dayKey(Date.now())).note.id ? 'on' : ''}`} onClick={openToday} data-testid="notes-today"><Icon name="sun" size={10} /> Today</button>
        {list.filter((n) => !isTodayPad(n) || n.id !== todayPad([], dayKey(Date.now())).note.id).map((n) => <button key={n.id} className={`nitem ${n.id === id ? 'on' : ''}`} onClick={() => setId(n.id)}>{n.pinned ? '📌 ' : ''}{noteTitle(n)}</button>)}
      </div>
      {cur ? (
        <div className="nedit">
          <textarea className="input" value={cur.text} placeholder={tasksOn ? 'Write anything; it saves as you type. ⌘/Ctrl+Enter turns a line into a task.' : 'Write anything; it saves as you type.'} onChange={(e) => update({ ...cur, text: e.target.value, updated: Date.now() })} onKeyDown={(e) => lineToTask(e, cur)} autoFocus />
          <div className="row-x">
            <button className="btn sm" onClick={() => update({ ...cur, pinned: !cur.pinned, updated: Date.now() })}><Icon name="pin" size={11} /> {cur.pinned ? 'Unpin' : 'Pin'}</button>
            <button className="btn sm" onClick={() => void navigator.clipboard.writeText(cur.text).then(() => say('Copied'))}><Icon name="copy" size={11} /> Copy</button>
            <span className="grow" />
            <button className="btn sm" onClick={() => { save({ notes: store.notes.filter((n) => n.id !== cur.id) }); setId(null); }}><Icon name="trash" size={11} /> Delete</button>
          </div>
        </div>
      ) : <div className="muted" style={{ margin: 'auto' }}>No note selected.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Weather

const WX: Record<string, string> = { sun: '☀️', partly: '⛅', cloud: '☁️', fog: '🌫️', drizzle: '🌦️', rain: '🌧️', snow: '❄️', storm: '⛈️' };

export function WeatherTool({ state }: { state: IslandState }) {
  const w = state.weather;
  if (!w) return <div className="muted">Choose a place in Keeper → Weather to see the forecast here.</div>;
  return (
    <div className="itool weather">
      <div className="tile wnow">
        <span className="big num">{Math.round(w.current.temp)}°</span>
        <div><b>{describeCode(w.current.code).label}</b><div className="muted small">{w.place.name} · feels {Math.round(w.current.feels ?? w.current.temp)}°{w.current.aqi !== undefined ? ` · AQI ${Math.round(w.current.aqi)}` : ''}</div>{w.nowcast ? <div className="small" style={{ color: '#93c5fd' }}>{w.nowcast}</div> : null}</div>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => void openNative('weather', { lat: w.place.lat, lon: w.place.lon, label: w.place.name }, say)}><Icon name="external" size={12} /> Open in Weather</button>
      </div>
      <div className="wdays">
        {w.daily.slice(0, 7).map((d) => (
          <div key={d.t} className="wday">
            <span className="small">{new Date(d.t).toLocaleDateString([], { weekday: 'short' })}</span>
            <span className="wicon">{WX[describeCode(d.code).icon]}</span>
            <span className="num small">{Math.round(d.max)}°</span>
            <span className="num small muted">{Math.round(d.min)}°</span>
            {d.rainChance >= 30 ? <span className="small" style={{ color: '#93c5fd' }}>{Math.round(d.rainChance)}%</span> : <span className="small"> </span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- System

export function SystemTool() {
  const [h, setH] = useState<Awaited<ReturnType<typeof api.system.health>> | null>(null);
  const [disk, setDisk] = useState<{ total: number; free: number } | null>(null);
  const [net, setNet] = useState<{ rateIn: number; rateOut: number } | null>(null);
  useWhileVisible(() => {
    void api.system.health().then(setH).catch(() => undefined);
    void api.net?.sample?.().then((s) => setNet(s.totals)).catch(() => undefined);
  }, 2000);
  useEffect(() => { void api.system.disks().then((d) => { const sys = d.find((x) => x.system) ?? d[0]; if (sys) setDisk({ total: sys.total, free: sys.free }); }).catch(() => undefined); }, []);
  if (!h) return <div className="muted">Reading…</div>;
  // Used as the system's own monitor counts it; on a Mac the colour follows memory pressure, as Activity Monitor's does.
  const memUsed = h.memory.total - h.memory.free;
  const memLevel = { ok: 'ok', warn: 'high', bad: 'full' }[memoryTone({ used: memUsed, total: h.memory.total, pressure: h.memory.pressure })];
  const memMore = memoryDetail(h.memory);
  const rows: [string, number, string][] = [
    ['Processor', h.cpuPercent, `${Math.round(h.cpuPercent)}% of ${h.cores} cores`],
    ['Memory', (memUsed / h.memory.total) * 100, `${formatBytes(memUsed)} of ${formatBytes(h.memory.total)}`],
  ];
  if (disk) rows.push(['Disk', ((disk.total - disk.free) / disk.total) * 100, `${formatBytes(disk.free)} free of ${formatBytes(disk.total)}`]);
  if (h.battery) rows.push(['Battery', h.battery.percent, `${Math.round(h.battery.percent)}%${h.battery.charging ? ' · charging' : ''}${h.battery.health ? ` · health ${Math.round(h.battery.health)}%` : ''}`]);
  return (
    <div className="itool system">
      {rows.flatMap(([label, pct, detail]) => [
        <div key={label} className="uwin" title={label === 'Memory' && h.memory.pressure ? `Memory pressure: ${h.memory.pressure}` : undefined}><span className="small">{label}</span><Bar pct={pct} level={label === 'Battery' ? (pct < 20 ? 'full' : 'ok') : label === 'Memory' ? memLevel : warnLevel(pct)} /><span className="small num">{detail}</span></div>,
        label === 'Memory' && memMore ? <div key="mem-more" className="small muted num" style={{ textAlign: 'right' }}>{memMore}</div> : null,
      ])}
      {net ? <div className="uwin"><span className="small">Network</span><span className="small num grow">↓ {formatBytes(net.rateIn)}/s · ↑ {formatBytes(net.rateOut)}/s</span></div> : null}
      <div className="small muted">Busiest: {h.processes.slice(0, 3).map((p) => `${p.name} ${Math.round(p.cpu)}%`).join(' · ')}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Converter

export function ConvertTool() {
  const [q, setQ] = useState('');
  const [rates, setRates] = useState<Rates | undefined>();
  const results = useMemo(() => answer(q, rates), [q, rates]);
  const wantsCurrency = /\b[a-z]{3}\b.*\b[a-z]{3}\b|[$€£¥₹]/i.test(q) && !results.length;
  return (
    <div className="itool convert">
      <input className="input big" autoFocus placeholder="5 ft in cm · 72f · 3 cups · 100 km/h in mph · 1.5 GB in MiB · 20 eur in usd" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="conv-out">
        {results.map((r) => <button key={r.unit} className="conv-ans" title="Copy" onClick={() => void navigator.clipboard.writeText(r.text).then(() => say('Copied'))}>{r.text}</button>)}
        {!results.length && q ? <span className="muted">{wantsCurrency ? '' : 'Type a number and a unit.'}</span> : null}
      </div>
      {wantsCurrency && !rates ? <button className="btn sm" onClick={() => void api.islandTools.rates('EUR').then((r) => setRates(r ?? undefined))}>Get today's exchange rates (European Central Bank)</button> : null}
      <div className="small muted">Length, weight, temperature, volume, speed, area, data, time and currencies.</div>
    </div>
  );
}

// ---------------------------------------------------------------- Emoji

let emojiIndex: EmojiEntry[] | null = null;
async function loadEmoji(): Promise<EmojiEntry[]> {
  if (emojiIndex) return emojiIndex;
  const [data, kw] = await Promise.all([import('unicode-emoji-json/data-by-emoji.json'), import('emojilib/dist/emoji-en-US.json')]);
  const d = data as unknown as { default?: Parameters<typeof buildIndex>[0] } & Parameters<typeof buildIndex>[0];
  const k = kw as unknown as { default?: Record<string, string[]> } & Record<string, string[]>;
  emojiIndex = buildIndex(d.default ?? d, k.default ?? k);
  return emojiIndex;
}

export function EmojiTool({ store, save }: { store: IslandToolsStore; save: (p: Partial<IslandToolsStore>) => void }) {
  const [index, setIndex] = useState<EmojiEntry[]>([]);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState(GROUPS[0]);
  const [tone, setTone] = useState(() => Number(localStorage.getItem('island.emojiTone') ?? 0) || 0);
  useEffect(() => { void loadEmoji().then(setIndex); }, []);
  const list = q ? searchEmoji(index, q, 160) : index.filter((x) => x.group === group).slice(0, 400);
  const pick = (x: EmojiEntry) => {
    const e = withTone(x, tone);
    void navigator.clipboard.writeText(e).then(() => say(`Copied ${e}`));
    save({ emojiRecent: addRecent(store.emojiRecent, e) });
  };
  return (
    <div className="itool emoji">
      <div className="row-x">
        <input className="input sm grow" autoFocus placeholder="Search emoji: heart, party, thumbs up…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tones">{TONES.map((t, i) => <button key={i} className={tone === i ? 'on' : ''} onClick={() => { setTone(i); try { localStorage.setItem('island.emojiTone', String(i)); } catch { /* ignore */ } }}>{'👋' + t}</button>)}</div>
      </div>
      {!q && store.emojiRecent.length ? <div className="egrid recent">{store.emojiRecent.slice(0, 16).map((e) => <button key={e} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/plain', e)} onClick={() => void navigator.clipboard.writeText(e).then(() => say(`Copied ${e}`))}>{e}</button>)}</div> : null}
      {!q ? <div className="chips">{GROUPS.map((g) => <button key={g} className={`chip ${g === group ? 'on' : ''}`} onClick={() => setGroup(g)}>{g.split(' ')[0]}</button>)}</div> : null}
      <div className="egrid">
        {list.map((x) => <button key={x.e} title={x.name} draggable onDragStart={(ev) => ev.dataTransfer.setData('text/plain', withTone(x, tone))} onClick={() => pick(x)}>{withTone(x, tone)}</button>)}
        {q && !list.length ? <span className="muted">No emoji match.</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Shortcuts

export function ShortcutsTool() {
  const [list, setList] = useState<IslandShortcut[] | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { void api.islandTools.shortcuts().then(setList); }, []);
  if (!list) return <div className="muted">Loading…</div>;
  return (
    <div className="itool shortcuts">
      {!list.length ? <div className="muted small">No shortcuts yet. On a Mac your Shortcuts appear here; everywhere, so do Keeper's automations and the commands in Settings → Island.</div> : null}
      <div className="sgrid">
        {list.map((s) => (
          <button key={`${s.kind}:${s.id}`} className="tile sbtn" disabled={busy === s.id} title={s.detail} onClick={async () => { setBusy(s.id); const r = await api.islandTools.runShortcut(s.kind, s.id).finally(() => setBusy('')); say(r.message); }}>
            <Icon name={s.kind === 'shortcut' ? 'bolt' : s.kind === 'rule' ? 'rules' : 'terminal'} size={14} />
            <span className="ellipsis">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Calendar (agenda + month + quick add)

const DAY_MS = 86_400_000;
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDay = (t: number, n: number) => { const d = new Date(dayStart(t)); d.setDate(d.getDate() + n); return d.getTime(); };

function AgendaRow({ e, now }: { e: AgendaItem; now: number }) {
  return (
    <div className={`ev${e.past ? ' past' : ''}${e.now ? ' now' : ''}`} data-testid="island-agenda-item">
      <i className="cal-dot" style={{ background: e.color }} aria-hidden />
      <span className="time">{e.allDay ? 'All day' : timeOf(e.start)}</span>
      <button className="ev-open" title={`${e.calendarName}${e.openUrl ? ' · opens where it lives' : ' · opens in Keeper'}`} onClick={() => void api.pim.openEvent(e.eventId, e.instance)}>
        <b className="ellipsis">{e.title}</b>
        <span className="muted small ellipsis">{[!e.allDay && !e.past ? countdown(e.start, now, e.end) : '', e.join && e.location?.includes(e.join) ? (e.provider ?? '') : e.location ?? ''].filter(Boolean).join(' · ')}</span>
      </button>
      {e.location && !(e.join && e.location.includes(e.join)) ? <button className="btn sm icon ghost" aria-label="Show the place on a map" title="Show on map" onClick={() => void openNative('maps', { address: e.location }, say)}><Icon name="map" size={12} /></button> : null}
      <button className="btn sm icon ghost" aria-label="Open in Calendar" title="Open in Calendar" onClick={() => void openNative('calendar', { eventUrl: e.openUrl, date: e.start }, say)}><Icon name="calendar" size={12} /></button>
      {e.join && !e.past ? <button className="btn sm primary" title={e.provider ? `Join on ${e.provider}` : 'Join the meeting'} onClick={() => void api.system.openExternal(e.join!)}>Join</button> : null}
    </div>
  );
}

export function CalendarTool({ now }: { state: IslandState; now: number }) {
  const [month, setMonth] = useState(() => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); });
  const [occ, setOcc] = useState<Occurrence[]>([]);
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const [day, setDay] = useState<number | null>(null);
  const [access, setAccess] = useState<SystemAccess | null>(null);
  const [quick, setQuick] = useState('');
  const [target, setTarget] = useState('');
  const [drop, setDrop] = useState(false);
  const m0 = new Date(month);
  const start = new Date(m0.getFullYear(), m0.getMonth(), 1 - ((m0.getDay() + 6) % 7)).getTime();
  const end = Math.max(start + 42 * DAY_MS, addDay(now, 2));
  const from = Math.min(start, dayStart(now));
  const load = useCallback(() => {
    if (!api.pim) return;
    void api.pim.occurrences(from, end).then(setOcc).catch(() => setOcc([]));
    void api.pim.calendars().then(setCals).catch(() => setCals([]));
  }, [from, end]);
  useEffect(load, [load]);
  useEffect(() => api.on('pim-changed', ((k: string) => { if (k === 'calendar' || k === 'accounts') load(); }) as never), [load]);
  // While this tab is open, calendars are checked every minute.
  useEffect(() => {
    if (!api.pim?.watchCalendar) return;
    void api.pim.watchCalendar(true);
    const h = setInterval(() => void api.pim.watchCalendar(true), 60_000);
    return () => { clearInterval(h); void api.pim.watchCalendar(false); };
  }, []);
  useEffect(() => { void api.pim?.systemAccess?.().then(setAccess).catch(() => undefined); }, []);
  useEffect(() => { void api.pim?.prefs?.().then((p) => setTarget((t) => t || p.defaultCalendar || '')).catch(() => undefined); }, []);
  const writable = cals.filter((c) => !c.readOnly && !c.tasks);
  const agenda = useMemo(() => islandAgenda(occ, cals, now), [occ, cals, now]);
  const picked = useMemo(() => (day === null ? null : agendaFor(occ, cals, day, now)), [occ, cals, day, now]);
  const marks = useMemo(() => {
    const s = new Set<string>();
    for (const o of occ) if (inIsland(cals.find((c) => c.id === o.event.calendar))) s.add(new Date(o.start).toDateString());
    return s;
  }, [occ, cals]);
  const preview = quick.trim() ? parseQuickAdd(quick) : null;
  const add = async () => {
    if (!preview) return;
    try {
      const e = await api.pim.quickAdd(quick, target || writable[0]?.id);
      if (e) say(`Added “${e.title}” · ${new Date(e.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: e.allDay ? undefined : 'numeric', minute: e.allDay ? undefined : '2-digit' })}`);
      setQuick('');
      load();
    } catch (err) {
      say(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
    }
  };
  const onDrop = async (ev: React.DragEvent) => {
    ev.preventDefault();
    setDrop(false);
    let n = 0;
    for (const f of Array.from(ev.dataTransfer.files)) {
      const p = api.files.pathOf?.(f);
      if (p && /\.(ics|ical|ifb|icalendar)$/i.test(p)) n += await api.pim.importIcs(p, target || undefined).catch(() => 0);
    }
    say(n ? `Imported ${n} event${n === 1 ? '' : 's'}` : 'Drop a calendar file (.ics) here to import it');
    load();
  };
  const days = Array.from({ length: 42 }, (_, i) => new Date(start + i * DAY_MS + 3600_000));
  const ask = access && (access.state === 'notDetermined' || (access.state === 'denied' && access.via === 'eventkit'));
  return (
    <div className={`itool cal${drop ? ' dropping' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrop(true); } }} onDragLeave={() => setDrop(false)} onDrop={(e) => void onDrop(e)}>
      <div className="mgrid">
        <div className="row-x"><button className="btn sm icon" aria-label="Previous month" title="Previous month" onClick={() => setMonth(new Date(m0.getFullYear(), m0.getMonth() - 1, 1).getTime())}><Icon name="chevronLeft" size={11} /></button><b className="grow" style={{ textAlign: 'center' }}>{m0.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b><button className="btn sm icon" aria-label="Next month" title="Next month" onClick={() => setMonth(new Date(m0.getFullYear(), m0.getMonth() + 1, 1).getTime())}><Icon name="chevronRight" size={11} /></button></div>
        <div className="mdays" role="grid" aria-label="Month">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="muted small" aria-hidden>{d}</span>)}
          {days.map((d) => {
            const ds = d.toDateString();
            const t = dayStart(d.getTime());
            const isToday = ds === new Date(now).toDateString();
            return <button key={ds} aria-label={d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} aria-pressed={day === t} className={`mday ${d.getMonth() !== m0.getMonth() ? 'out' : ''} ${isToday ? 'today' : ''} ${day === t ? 'on' : ''}`} onClick={() => setDay(day === t || isToday ? null : t)}>{d.getDate()}{marks.has(ds) ? <i /> : null}</button>;
          })}
        </div>
      </div>
      <div className="mlist" data-testid="island-agenda">
        <div className="cal-quick">
          <input className="input sm" value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Add: lunch with Sam tomorrow 1pm" aria-label="Quick add an event" />
          {writable.length > 1 ? (
            <select className="input sm" value={target || writable[0]?.id} onChange={(e) => setTarget(e.target.value)} aria-label="Calendar for new events">
              {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : null}
        </div>
        {preview ? <div className="muted small ellipsis" aria-live="polite">{preview.title} · {new Date(preview.start).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: preview.allDay ? undefined : 'numeric', minute: preview.allDay ? undefined : '2-digit' })}{preview.rrule ? ' · repeats' : ''} — press Return</div> : null}
        {ask ? (
          <div className="cal-access" role="note">
            <span className="small">{access!.message}</span>
            {access!.canRequest
              ? <button className="btn sm primary" onClick={() => void api.pim.systemAccess(true).then((a) => { setAccess(a); load(); })}>Allow calendar access</button>
              : <button className="btn sm" onClick={() => void api.system.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars')}>Open System Settings</button>}
          </div>
        ) : null}
        {picked ? (
          <>
            <b className="small">{new Date(day!).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</b>
            {!picked.length ? <div className="muted small">Nothing on this day.</div> : picked.map((e) => <AgendaRow key={e.key} e={e} now={now} />)}
          </>
        ) : (
          <>
            <b className="small">Today</b>
            {!agenda.today.length ? <div className="muted small">Nothing else today.</div> : agenda.today.map((e) => <AgendaRow key={e.key} e={e} now={now} />)}
            <b className="small" style={{ marginTop: 4 }}>Tomorrow</b>
            {!agenda.tomorrow.length ? <div className="muted small">Nothing tomorrow.</div> : agenda.tomorrow.map((e) => <AgendaRow key={e.key} e={e} now={now} />)}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Focus extras: sounds and Clock timers

type Noise = 'off' | 'white' | 'pink' | 'brown' | 'rain';

/** Focus sounds made on the spot (no files, no network): white, pink, brown noise or rain. */
export function useFocusSound(kind: Noise | undefined, on: boolean, volume = 0.4) {
  useEffect(() => {
    if (!on || !kind || kind === 'off') return;
    const ctx = new AudioContext();
    const len = 2 * ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    let node: AudioNode = src;
    if (kind === 'rain') {
      // Rain: brown noise through a high-pass, with a soft patter on top.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 500;
      src.connect(hp);
      node = hp;
    }
    node.connect(gain).connect(ctx.destination);
    src.start();
    return () => { src.stop(); void ctx.close(); };
  }, [kind, on, volume]);
}

export function FocusExtras() {
  const { settings, updateSettings } = useStore();
  const isl = settings?.island;
  const [timers, setTimers] = useState<{ id: string; label: string; endsAt?: number; leftMs?: number; durationMs: number }[]>([]);
  const load = useCallback(() => { void api.pim?.alarms?.().then((a) => setTimers(a.timers as never)).catch(() => setTimers([])); }, []);
  useWhileVisible(load, 1000);
  if (!isl) return null;
  const set = (p: Partial<NonNullable<typeof isl>>) => void updateSettings({ island: { ...isl, ...p } });
  return (
    <div className="focus-extras">
      <div className="row-x">
        <span className="small muted">Focus sound</span>
        {(['off', 'white', 'pink', 'brown', 'rain'] as Noise[]).map((n) => <button key={n} className={`chip ${(isl.focusSound ?? 'off') === n ? 'on' : ''}`} onClick={() => set({ focusSound: n })}>{n === 'off' ? 'None' : n[0].toUpperCase() + n.slice(1)}</button>)}
        <input type="range" min={0} max={1} step={0.05} value={isl.focusVolume ?? 0.4} onChange={(e) => set({ focusVolume: Number(e.target.value) })} title="Volume" style={{ width: 70 }} />
      </div>
      <div className="row-x">
        <span className="small muted">Timers</span>
        {[1, 5, 10, 15].map((m) => <button key={m} className="chip" onClick={() => void api.pim.startTimer(`${m} min`, m * 60_000).then(load)}>{m} min</button>)}
        {timers.map((t) => {
          const left = t.endsAt ? Math.max(0, t.endsAt - Date.now()) : t.leftMs ?? t.durationMs;
          return <span key={t.id} className="chip on num" title={t.label}>{Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')} <button className="x" onClick={() => void api.pim.timerAction(t.id, 'cancel').then(load)}>×</button></span>;
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Mirror

export function MirrorTool() {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [flip, setFlip] = useState(true);
  const [guides, setGuides] = useState(true);
  const [light, setLight] = useState<number | null>(null);
  const [mic, setMic] = useState(0);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let ctx: AudioContext | null = null;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    navigator.mediaDevices?.getUserMedia({ video: { width: 640, height: 360 }, audio: true })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } }))
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
        let analyser: AnalyserNode | null = null;
        if (s.getAudioTracks().length) {
          ctx = new AudioContext();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(s).connect(analyser);
        }
        const data = new Uint8Array(512);
        let n = 0;
        const tick = () => {
          if (analyser) {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (const v of data) sum += ((v - 128) / 128) ** 2;
            setMic(Math.min(1, Math.sqrt(sum / data.length) * 4));
          }
          // How bright the picture is, twice a second: a hint when the room is too dark.
          if (++n % 30 === 0 && video.current && video.current.readyState >= 2) {
            const c = canvas.getContext('2d');
            if (c) {
              c.drawImage(video.current, 0, 0, 32, 18);
              const px = c.getImageData(0, 0, 32, 18).data;
              let lum = 0;
              for (let i = 0; i < px.length; i += 4) lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
              setLight(lum / (px.length / 4) / 255);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setError('No camera, or permission was not given.'));
    // The camera and microphone switch off as soon as the mirror closes.
    return () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close(); };
  }, []);
  return (
    <div className="cam mirror">
      {error ? <div className="muted">{error}</div> : (
        <div className="mwrap">
          <video ref={video} autoPlay playsInline muted style={{ transform: flip ? 'scaleX(-1)' : undefined }} />
          {guides ? <div className="guides" aria-hidden><i className="v1" /><i className="v2" /><i className="h1" /><i className="h2" /><i className="eye" /></div> : null}
        </div>
      )}
      <div className="row-x">
        <button className={`chip ${flip ? 'on' : ''}`} onClick={() => setFlip(!flip)}>Mirror</button>
        <button className={`chip ${guides ? 'on' : ''}`} onClick={() => setGuides(!guides)}>Framing guides</button>
        <span className="small muted">Mic</span><div className="ubar ok" style={{ width: 80 }}><i style={{ width: `${Math.round(mic * 100)}%` }} /></div>
        {light !== null ? <span className="small" style={{ color: light < 0.25 ? '#fbbf24' : '#86efac' }}>{light < 0.25 ? 'A little dark — face a window or a lamp' : light > 0.85 ? 'Very bright' : 'Lighting looks good'}</span> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Shelf: share

export function ShareButton({ paths }: { paths: string[] }) {
  const [targets, setTargets] = useState<{ id: string; label: string }[] | null>(null);
  if (!paths.length) return null;
  return (
    <span style={{ position: 'relative' }}>
      <button className="btn sm" title="AirDrop, Mail, Messages, nearby devices and your Keeper devices" onClick={() => void (targets ? setTargets(null) : api.places.shareTargets().then((t) => setTargets(t.map((x) => ({ id: x.id, label: x.name })))))}><Icon name="share" size={12} /> Share</button>
      {targets ? (
        <div className="shelf-pop" style={{ bottom: 30, top: 'auto' }}>
          {targets.map((t) => <button key={t.id} onClick={() => { setTargets(null); void api.places.share(paths, t.id).then((r) => say(r.message ?? (r.ok ? 'Shared' : 'Could not share'))); }}>{t.label}</button>)}
          {!targets.length ? <span className="muted small">Nothing to share with here.</span> : null}
        </div>
      ) : null}
    </span>
  );
}
