// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Health → Processes and Services: every running program with what it uses,
// and quitting, force quitting, suspending, restarting and re-prioritising
// them; the system's services with start, stop and start-at-boot.
//
// It reads the system only while this page is open and the window is visible.

import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForceQuitApp, ProcAction, ProcActionResult, ProcDetails } from '../../core/api-procs';
import { formatBytes, relativeTime } from '../../core/format';
import {
  buildTree, canEnd, flattenTree, groupByApp, matchProc, procChanges, procRegex, procsCsv, PRIORITIES, priorityOf, type PriorityLevel, type ProcRow, type ProcSample, type ServiceRow,
} from '../../core/procs';
import { api } from '../api';
import { Sparkline } from '../components/Chart';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, Loading, Modal, Toggle, type MenuItem } from '../components/ui';
import { mod, useStore } from '../state';

const InspectExtras = lazy(() => import('./monitor/InspectExtras').then((m) => ({ default: m.InspectExtras })));
import '../styles/procs.css';

// ---------------------------------------------------------------- remembered choices

function remembered<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = useCallback((x: T) => {
    setV(x);
    try {
      localStorage.setItem(key, JSON.stringify(x));
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  return [v, set];
}

// ---------------------------------------------------------------- columns

type Tab = 'cpu' | 'memory' | 'energy' | 'disk' | 'network';
type ColId = 'name' | 'pid' | 'user' | 'cpu' | 'memory' | 'threads' | 'energy' | 'read' | 'write' | 'connections' | 'uptime' | 'state' | 'priority' | 'ppid' | 'path' | 'command';

const rateText = (n?: number) => (n === undefined ? '—' : n < 1024 ? (n ? `${n} B/s` : '0') : `${formatBytes(n)}/s`);
/** How long it has run, to the minute: a column counting seconds would redraw every row every second. */
function runningFor(started: number): string {
  const m = Math.max(0, Math.floor((Date.now() - started) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

const STATE: Record<string, string> = { R: 'Running', S: 'Sleeping', T: 'Suspended', t: 'Suspended', Z: 'Zombie', D: 'Waiting on disk', I: 'Idle', U: 'Waiting', X: 'Ending' };

interface Col {
  label: string;
  width: string;
  num?: boolean;
  value: (p: ProcRow) => number | string | undefined;
  show?: (p: ProcRow) => React.ReactNode;
  /** depends on what the operating system reports */
  needs?: ProcSample['unavailable'][number];
}

const COLS: Record<ColId, Col> = {
  name: { label: 'Name', width: 'minmax(220px, 3fr)', value: (p) => p.name.toLowerCase() },
  pid: { label: 'PID', width: '72px', num: true, value: (p) => p.pid },
  user: { label: 'User', width: 'minmax(80px, 1fr)', value: (p) => p.user ?? '', show: (p) => p.user ?? '—', needs: 'user' },
  cpu: { label: '% CPU', width: '78px', num: true, value: (p) => p.cpu, show: (p) => p.cpu.toFixed(1) },
  memory: { label: 'Memory', width: '92px', num: true, value: (p) => p.memory, show: (p) => formatBytes(p.memory) },
  threads: { label: 'Threads', width: '72px', num: true, value: (p) => p.threads ?? -1, show: (p) => p.threads ?? '—', needs: 'threads' },
  energy: { label: 'Energy', width: '78px', num: true, value: (p) => p.energy ?? 0, show: (p) => (p.energy ?? 0).toFixed(1) },
  read: { label: 'Read', width: '92px', num: true, value: (p) => p.readRate ?? -1, show: (p) => rateText(p.readRate), needs: 'disk' },
  write: { label: 'Written', width: '92px', num: true, value: (p) => p.writeRate ?? -1, show: (p) => rateText(p.writeRate), needs: 'disk' },
  connections: { label: 'Connections', width: '100px', num: true, value: (p) => p.connections ?? -1, show: (p) => (p.connections === undefined ? '—' : p.connections || '') },
  uptime: { label: 'Running for', width: '100px', num: true, value: (p) => (p.started ? -p.started : 0), show: (p) => (p.started ? runningFor(p.started) : '—') },
  state: { label: 'State', width: '100px', value: (p) => p.state ?? '', show: (p) => (p.state ? STATE[p.state] ?? p.state : '—') },
  priority: { label: 'Priority', width: '82px', value: (p) => p.nice ?? 0, show: (p) => priorityName(priorityOf(p.nice)) },
  ppid: { label: 'Parent', width: '72px', num: true, value: (p) => p.ppid },
  path: { label: 'Where', width: 'minmax(160px, 2fr)', value: (p) => p.path ?? '', show: (p) => <span className="mono ellipsis" title={p.path}>{p.path ?? '—'}</span> },
  command: { label: 'Command', width: 'minmax(200px, 3fr)', value: (p) => p.command ?? '', show: (p) => <span className="mono ellipsis" title={p.command}>{p.command ?? '—'}</span> },
};

const TAB_COLS: Record<Tab, ColId[]> = {
  cpu: ['name', 'cpu', 'threads', 'uptime', 'user', 'pid'],
  memory: ['name', 'memory', 'threads', 'user', 'pid'],
  energy: ['name', 'energy', 'cpu', 'state', 'user', 'pid'],
  disk: ['name', 'read', 'write', 'user', 'pid'],
  network: ['name', 'connections', 'user', 'pid'],
};
const TAB_SORT: Record<Tab, ColId> = { cpu: 'cpu', memory: 'memory', energy: 'energy', disk: 'read', network: 'connections' };
const TAB_LABEL: Record<Tab, string> = { cpu: 'CPU', memory: 'Memory', energy: 'Energy', disk: 'Disk', network: 'Network' };

function priorityName(l: PriorityLevel): string {
  return { lowest: 'Lowest', low: 'Low', normal: 'Normal', high: 'High', highest: 'Highest' }[l];
}

const ACTION_VERB: Record<ProcAction, string> = { quit: 'Quit', forceQuit: 'Force Quit', endTree: 'End Process Tree', suspend: 'Suspend', resume: 'Resume', restart: 'Restart' };

// ---------------------------------------------------------------- live readings

const KEEP = 60;

function useSampler(intervalMs: number, paused: boolean, network: boolean, disk: boolean) {
  const [s, setS] = useState<ProcSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hist = useRef<{ cpu: number[]; mem: number[]; disk: number[]; net: number[] }>({ cpu: [], mem: [], disk: [], net: [] });
  const netRef = useRef({ network, disk });
  netRef.current = { network, disk };
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const once = async () => {
      // Nothing is read while the window is hidden or the person paused it.
      if (document.visibilityState === 'visible') {
        try {
          const r = await api.procs.sample(netRef.current);
          if (!alive) return;
          const h = hist.current;
          const push = (a: number[], v: number) => { a.push(v); if (a.length > KEEP) a.shift(); };
          push(h.cpu, r.system.cpu);
          push(h.mem, (r.system.memUsed / r.system.memTotal) * 100);
          push(h.disk, (r.system.diskRead ?? 0) + (r.system.diskWrite ?? 0));
          push(h.net, (r.system.netIn ?? 0) + (r.system.netOut ?? 0));
          setS(r);
          setError(null);
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : String(e));
        }
      }
      if (alive && !paused) timer = setTimeout(() => void once(), intervalMs);
    };
    void once();
    const vis = () => { if (document.visibilityState === 'visible' && !paused) { clearTimeout(timer); void once(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); };
  }, [intervalMs, paused, tick]);

  return { s, error, hist: hist.current, refresh };
}

// ---------------------------------------------------------------- row model

type Row =
  | { kind: 'proc'; p: ProcRow; depth: number; hasKids?: boolean; open?: boolean }
  | { kind: 'group'; key: string; name: string; lead: ProcRow; agg: ProcRow; count: number; open: boolean };

const ROW_H = 30;

// ---------------------------------------------------------------- Processes

export function Processes() {
  const { toast, info, route, go } = useStore();
  const platform = info?.platform ?? 'linux';
  const [tab, setTab] = remembered<Tab>('procs.tab', 'cpu');
  const [mode, setMode] = remembered<'list' | 'tree' | 'apps'>('procs.mode', 'apps');
  const [interval, setIntervalMs] = remembered<number>('procs.interval', 2000);
  const [tabCols, setTabCols] = remembered<Record<Tab, ColId[]>>('procs.columns', TAB_COLS);
  const [mineOnly, setMineOnly] = remembered<boolean>('procs.mine', false);
  // Pinned programs (by name) stay at the top; new ones are marked; ended ones are listed for two minutes.
  const [pins, setPins] = remembered<string[]>('procs.pins', []);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [ended, setEnded] = useState<{ pid: number; name: string; at: number }[]>([]);
  const prevProcs = useRef<ProcRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: ColId; desc: boolean }>({ key: TAB_SORT[tab], desc: true });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [colMenu, setColMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ action: ProcAction; procs: ProcRow[] } | null>(null);
  const [adminRetry, setAdminRetry] = useState<{ action: ProcAction | 'priority'; failed: ProcActionResult['failed']; level?: PriorityLevel } | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [prio, setPrio] = useState<ProcRow | null>(null);
  const [forceQuit, setForceQuit] = useState(route.arg === 'force-quit');
  const [iconMap, setIconMap] = useState<Record<string, string>>({});
  const [scroll, setScroll] = useState(0);
  const [viewH, setViewH] = useState(600);
  const box = useRef<HTMLDivElement>(null);
  const asked = useRef(new Set<string>());

  const { s, error, hist, refresh } = useSampler(interval, paused, tab === 'network', tab === 'disk' || tab === 'energy');
  const cols = (tabCols[tab] ?? TAB_COLS[tab]).filter((c) => COLS[c]);
  const unavailable = new Set(s?.unavailable ?? []);
  const self = s?.self ?? -1;

  useEffect(() => setSort({ key: TAB_SORT[tab], desc: true }), [tab]);
  useEffect(() => { if (route.arg === 'force-quit') setForceQuit(true); }, [route]);
  useEffect(() => {
    const open = () => setForceQuit(true);
    window.addEventListener('keeper:force-quit', open);
    return () => window.removeEventListener('keeper:force-quit', open);
  }, []);

  useEffect(() => {
    if (!s) return;
    const c = procChanges(prevProcs.current, s.procs);
    prevProcs.current = s.procs;
    setFresh(c.fresh);
    const now = Date.now();
    if (c.ended.length || ended.length) setEnded((old) => [...c.ended.map((e) => ({ ...e, at: now })), ...old].filter((e) => now - e.at < 120_000).slice(0, 12));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);
  const pinned = useMemo(() => new Set(pins), [pins]);
  const togglePin = (name: string) => setPins(pinned.has(name) ? pins.filter((x) => x !== name) : [...pins, name]);
  const badRegex = /^\/.+\/[a-z]*$/.test(q.trim()) && !procRegex(q);
  const procs = useMemo(() => (s?.procs ?? []).filter((p) => (!mineOnly || p.mine) && matchProc(p, q)), [s, q, mineOnly]);
  const cmp = useCallback((a: ProcRow, b: ProcRow) => {
    const c = COLS[sort.key];
    const x = c.value(a) ?? '';
    const y = c.value(b) ?? '';
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return Number(pinned.has(b.name)) - Number(pinned.has(a.name)) || (sort.desc ? -r : r) || a.pid - b.pid;
  }, [sort, pinned]);

  const rows: Row[] = useMemo(() => {
    if (mode === 'list') return [...procs].sort(cmp).map((p) => ({ kind: 'proc', p, depth: 0 }));
    if (mode === 'tree') {
      // While searching, matches are shown with their whole family line so they make sense.
      const all = s?.procs ?? [];
      let list = procs;
      if (q.trim()) {
        const by = new Map(all.map((p) => [p.pid, p]));
        const keep = new Map(procs.map((p) => [p.pid, p]));
        for (const p of procs) {
          let up = by.get(p.ppid);
          while (up && !keep.has(up.pid)) { keep.set(up.pid, up); up = by.get(up.ppid); }
        }
        list = [...keep.values()];
      }
      return flattenTree(buildTree(list, cmp), closed).map((n) => ({ kind: 'proc', p: n.p, depth: n.depth, hasKids: n.children.length > 0, open: !closed.has(n.p.pid) }));
    }
    const groups = groupByApp(procs, platform);
    const agg = (g: (typeof groups)[number]): ProcRow => ({
      ...g.lead, name: g.name, cpu: g.cpu, memory: g.memory, energy: g.energy, readRate: g.readRate, writeRate: g.writeRate,
      threads: g.members.reduce((x, m) => x + (m.threads ?? 0), 0) || undefined, connections: g.members.some((m) => m.connections !== undefined) ? g.members.reduce((x, m) => x + (m.connections ?? 0), 0) : undefined,
    });
    const out: Row[] = [];
    for (const g of groups.map((g) => ({ g, a: agg(g) })).sort((x, y) => cmp(x.a, y.a))) {
      if (g.g.members.length === 1) { out.push({ kind: 'proc', p: g.g.members[0], depth: 0 }); continue; }
      const open = openGroups.has(g.g.key) || (!!q.trim() && g.g.members.length < 8);
      out.push({ kind: 'group', key: g.g.key, name: g.g.name, lead: g.g.lead, agg: g.a, count: g.g.members.length, open });
      if (open) for (const m of [...g.g.members].sort(cmp)) out.push({ kind: 'proc', p: m, depth: 1 });
    }
    return out;
  }, [procs, mode, cmp, closed, openGroups, platform, q, s]);

  // Only the rows on screen are drawn.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 8);
  const last = Math.min(rows.length, Math.ceil((scroll + viewH) / ROW_H) + 8);
  const visible = rows.slice(first, last);

  // App icons for what is on screen, a few at a time and only once per program.
  useEffect(() => {
    const want = visible.map((r) => (r.kind === 'group' ? r.lead.path : r.p.path)).filter((p): p is string => !!p && !asked.current.has(p));
    if (!want.length) return;
    for (const p of want) asked.current.add(p);
    const t = setTimeout(() => void api.procs.icons(want).then((m) => setIconMap((x) => ({ ...x, ...m }))).catch(() => undefined), 120);
    return () => clearTimeout(t);
  }, [visible]);

  const byPid = useMemo(() => new Map((s?.procs ?? []).map((p) => [p.pid, p])), [s]);
  const selected = [...sel].map((pid) => byPid.get(pid)).filter((p): p is ProcRow => !!p);

  const run = async (action: ProcAction, list: ProcRow[], admin = false) => {
    setConfirm(null);
    const r = await api.procs.act(action, list.map((p) => p.pid), { admin });
    const names = list.length === 1 ? list[0].name : `${list.length} processes`;
    if (r.done) toast(`${ACTION_VERB[action]}: ${r.failed.length ? `${r.done} of ${list.length} done` : names}`);
    if (r.failed.length) {
      if (!admin && r.failed.some((f) => f.needsAdmin)) setAdminRetry({ action, failed: r.failed });
      else toast(r.failed.map((f) => `${f.name ?? f.pid}: ${f.reason}`).join(' · '));
    }
    if (action !== 'suspend' && action !== 'resume') setSel(new Set());
    refresh();
  };

  /** Quit and suspend ask first only when it could hurt: force, a whole tree, several at once, or not yours. */
  const ask = (action: ProcAction, list: ProcRow[]) => {
    if (!list.length) return;
    const blocked = list.map((p) => ({ p, c: canEnd(p, platform, self, action !== 'quit' && action !== 'restart') })).filter((x) => !x.c.ok);
    if (blocked.length === list.length) {
      toast(blocked[0].c.reason!);
      return;
    }
    const risky = action === 'forceQuit' || action === 'endTree' || list.length > 1 || list.some((p) => !p.mine || canEnd(p, platform, self).reason);
    if (risky || action === 'restart') setConfirm({ action, procs: list });
    else void run(action, list);
  };

  const selectRow = (pid: number, e: React.MouseEvent | React.KeyboardEvent) => {
    if (e.shiftKey && anchor !== null) {
      const ids = rows.map((r) => (r.kind === 'proc' ? r.p.pid : r.lead.pid));
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(pid);
      if (a >= 0 && b >= 0) { setSel(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1))); return; }
    }
    if (e.metaKey || e.ctrlKey) {
      const n = new Set(sel);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      setSel(n);
    } else setSel(new Set([pid]));
    setAnchor(pid);
  };

  const menuFor = (e: React.MouseEvent, list: ProcRow[]) => {
    e.preventDefault();
    const one = list.length === 1 ? list[0] : undefined;
    const isSelf = one?.pid === self;
    const items: MenuItem[] = isSelf
      ? [{ label: 'Restart Keeper', icon: 'refresh', run: () => void api.procs.restartKeeper() }, { sep: true, label: '' }, { label: 'Inspect…', icon: 'info', kbd: `${mod}I`, run: () => setInspect(one!.pid) }]
      : [
        { label: list.length > 1 ? `Quit ${list.length} Processes` : 'Quit', icon: 'close', kbd: platform === 'darwin' ? '⌫' : 'Del', run: () => ask('quit', list) },
        { label: 'Force Quit', icon: 'warning', danger: true, run: () => ask('forceQuit', list) },
        ...(one ? [{ label: 'End Process Tree', icon: 'trash', danger: true, run: () => ask('endTree', [one]) }] : []),
        { sep: true, label: '' },
        list.every((p) => p.state === 'T' || p.state === 't')
          ? { label: 'Resume', icon: 'play', run: () => void run('resume', list) }
          : { label: 'Suspend', icon: 'pause', run: () => ask('suspend', list) },
        ...(one ? [{ label: 'Restart', icon: 'refresh', run: () => ask('restart', [one]) }] : []),
        { sep: true, label: '' },
        ...(one ? [
          { label: 'Change Priority…', icon: 'bolt', run: () => setPrio(one) },
          { label: 'App Settings…', icon: 'settings', run: () => go({ name: 'appcontrols', arg: one.path ?? one.name }) },
          { label: 'Inspect…', icon: 'info', kbd: `${mod}I`, run: () => setInspect(one.pid) },
          { label: pinned.has(one.name) ? 'Unpin' : 'Pin to Top', icon: 'pin', run: () => togglePin(one.name) },
          ...(one.path ? [{ label: platform === 'darwin' ? 'Show in Finder' : platform === 'win32' ? 'Show in Explorer' : 'Show in Folder', icon: 'reveal', run: () => void api.procs.reveal(one.path!) }] : []),
          { label: 'Copy Process ID', icon: 'copy', run: () => void navigator.clipboard.writeText(String(one.pid)) },
          ...(one.command ? [{ label: 'Copy Command', icon: 'copy', run: () => void navigator.clipboard.writeText(one.command!) }] : []),
        ] : []),
      ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      ask(e.altKey ? 'forceQuit' : 'quit', selected.filter((p) => p.pid !== self));
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i' && selected.length === 1) {
      e.preventDefault();
      setInspect(selected[0].pid);
    } else if (e.key === 'Escape') setSel(new Set());
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      const ids = rows.map((r) => (r.kind === 'proc' ? r.p.pid : r.lead.pid));
      const cur = anchor === null ? -1 : ids.indexOf(anchor);
      const next = Math.max(0, Math.min(ids.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      setSel(new Set([ids[next]]));
      setAnchor(ids[next]);
      const el = box.current;
      if (el) {
        const top = next * ROW_H;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + ROW_H > el.scrollTop + el.clientHeight - ROW_H) el.scrollTop = top - el.clientHeight + 2 * ROW_H;
      }
    }
  };

  if (error && !s) return <Empty icon="warning" title="Could not read the running programs">{error}</Empty>;
  if (!s) return <Loading label="Reading running programs…" />;

  const sys = s.system;
  const grid = cols.map((c) => COLS[c].width).join(' ');
  const threads = s.procs.reduce((x, p) => x + (p.threads ?? 0), 0);

  const cell = (c: ColId, p: ProcRow, row: Row) => {
    if (c !== 'name') {
      const col = COLS[c];
      if (col.needs && unavailable.has(col.needs) && !(c === 'connections' && p.connections !== undefined)) return <span className="muted">—</span>;
      return col.show ? col.show(p) : String(col.value(p) ?? '');
    }
    const depth = row.kind === 'proc' ? row.depth : 0;
    const icon = iconMap[(row.kind === 'group' ? row.lead : p).path ?? ''];
    const caret = row.kind === 'group' || (row.kind === 'proc' && row.hasKids)
      ? (
        <button
          className="proc-caret"
          aria-label={(row.kind === 'group' ? row.open : row.open) ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            if (row.kind === 'group') { const n = new Set(openGroups); if (n.has(row.key)) n.delete(row.key); else n.add(row.key); setOpenGroups(n); }
            else { const n = new Set(closed); if (n.has(p.pid)) n.delete(p.pid); else n.add(p.pid); setClosed(n); }
          }}
        >
          <Icon name={row.open ? 'chevronDown' : 'chevronRight'} size={12} />
        </button>
      )
      : <span className="proc-caret" />;
    return (
      <span className="proc-name" style={{ paddingLeft: depth * 16 }}>
        {caret}
        {icon ? <img src={icon} alt="" width={16} height={16} /> : <span className={`proc-glyph ${p.app ? 'app' : ''}`}><Icon name={p.app ? 'app' : 'terminal'} size={11} /></span>}
        <span className="ellipsis" title={p.command ?? p.name}>{p.name}</span>
        {row.kind === 'group' ? <span className="badge">{row.count}</span> : null}
        {p.state === 'T' || p.state === 't' ? <span className="badge warn">Suspended</span> : null}
        {p.pid === self ? <span className="badge accent">Keeper</span> : null}
        {pinned.has(p.name) ? <Icon name="pin" size={11} className="muted" /> : null}
        {fresh.has(p.pid) ? <span className="badge ok" title="Started in the last minute">New</span> : null}
        {!p.mine && p.pid !== self ? <Icon name="lock" size={11} className="muted" /> : null}
      </span>
    );
  };

  return (
    <div className="procs" onKeyDown={onKey} tabIndex={-1}>
      <div className="procs-meters">
        <Meter label="CPU" value={`${Math.round(sys.cpu)}%`} sub={`${s.procs.length} processes${threads ? ` · ${threads.toLocaleString()} threads` : ''}`} values={hist.cpu} color="var(--accent)">
          <div className="cores" title="Each processor core">{sys.perCore.map((v, i) => <i key={i} style={{ height: `${Math.max(4, v)}%` }} title={`Core ${i + 1}: ${Math.round(v)}%`} />)}</div>
        </Meter>
        <Meter label="Memory" value={formatBytes(sys.memUsed)} sub={`of ${formatBytes(sys.memTotal)}${sys.swapTotal ? ` · swap ${formatBytes(sys.swapUsed ?? 0)} of ${formatBytes(sys.swapTotal)}` : ''}`} values={hist.mem} color="var(--ok)">
          <div className="pressure"><i style={{ width: `${(sys.memUsed / sys.memTotal) * 100}%`, background: sys.memUsed / sys.memTotal > 0.9 ? 'var(--danger)' : sys.memUsed / sys.memTotal > 0.75 ? 'var(--warn)' : 'var(--ok)' }} /></div>
        </Meter>
        <Meter label="Disk" value={sys.diskRead === undefined ? '—' : rateText((sys.diskRead ?? 0) + (sys.diskWrite ?? 0))} sub={sys.diskWrite === undefined ? (sys.diskRead === undefined ? 'measuring…' : 'read and written together') : `read ${rateText(sys.diskRead)} · written ${rateText(sys.diskWrite)}`} values={hist.disk} color="var(--warn)" />
        <Meter label="Network" value={sys.netIn === undefined ? '—' : rateText((sys.netIn ?? 0) + (sys.netOut ?? 0))} sub={sys.netIn === undefined ? 'measuring…' : `in ${rateText(sys.netIn)} · out ${rateText(sys.netOut)}`} values={hist.net} color="#8b5cf6" />
      </div>

      <div className="procs-bar">
        <div className="seg" role="tablist">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
        </div>
        <div className="search-box">
          <Icon name="search" size={13} />
          <input placeholder="Filter by name, PID, user or command — or /regex/" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter processes" style={badRegex ? { color: 'var(--danger)' } : undefined} title={badRegex ? 'This regular expression is not valid' : undefined} />
        </div>
        <div className="seg" title="How the list is arranged">
          <button className={mode === 'apps' ? 'on' : ''} onClick={() => setMode('apps')} title="Helpers grouped under their app">By app</button>
          <button className={mode === 'tree' ? 'on' : ''} onClick={() => setMode('tree')} title="Which program started which">Tree</button>
          <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>All</button>
        </div>
        <label className="row small" style={{ gap: 6 }}><Toggle on={mineOnly} onChange={setMineOnly} label="Only mine" /> Only mine</label>
      </div>

      <div className="procs-actions">
        <span className="small muted ellipsis">{selected.length ? `${selected.length} selected` : 'Select a process, or right-click it for everything'}</span>
        <div className="grow" />
        <button className="btn sm" disabled={!selected.length} onClick={() => ask('quit', selected)}><Icon name="close" size={13} /> Quit</button>
        <button className="btn sm" disabled={!selected.length} onClick={() => ask('forceQuit', selected)}><Icon name="warning" size={13} /> Force Quit</button>
        <button className="btn sm" disabled={!selected.length} onClick={() => (selected.every((p) => p.state === 'T' || p.state === 't') ? void run('resume', selected) : ask('suspend', selected))}>
          <Icon name={selected.length && selected.every((p) => p.state === 'T' || p.state === 't') ? 'play' : 'pause'} size={13} /> {selected.length && selected.every((p) => p.state === 'T' || p.state === 't') ? 'Resume' : 'Suspend'}
        </button>
        <button className="btn sm" disabled={selected.length !== 1} onClick={() => setInspect(selected[0].pid)}><Icon name="info" size={13} /> Inspect</button>
        <span className="procs-sep" />
        <select className="input" style={{ height: 28, width: 'auto' }} value={interval} onChange={(e) => setIntervalMs(Number(e.target.value))} aria-label="Update every" title="How often the list updates">
          <option value={1000}>Every second</option>
          <option value={2000}>Every 2 seconds</option>
          <option value={5000}>Every 5 seconds</option>
        </select>
        <button className={`btn sm ${paused ? 'primary' : ''}`} onClick={() => setPaused(!paused)} title={paused ? 'Resume updates' : 'Pause updates'}>
          <Icon name={paused ? 'play' : 'pause'} size={13} /> {paused ? 'Paused' : 'Pause'}
        </button>
        <button className="btn sm ghost icon" title="Columns" onClick={(e) => setColMenu({ x: e.clientX, y: e.clientY })}><Icon name="list" size={14} /></button>
        <button className="btn sm ghost" title="Save the list as a spreadsheet" onClick={async () => { const p = await api.tools.saveAs(`Processes ${new Date().toISOString().slice(0, 16).replace(':', '.')}.csv`, procsCsv([...procs].sort(cmp))); if (p) toast(`Saved ${p.split(/[\\/]/).pop()}`); }}>CSV</button>
        <button className="btn sm" onClick={() => setForceQuit(true)} title="Force Quit Applications">Force Quit…</button>
      </div>

      {ended.length ? (
        <div className="procs-ended small muted" aria-label="Ended recently">Ended recently: {ended.map((e) => <span key={`${e.pid}-${e.at}`} className="badge" title={`PID ${e.pid} · ${new Date(e.at).toLocaleTimeString()}`}>{e.name}</span>)}</div>
      ) : null}
      <div className="procs-table" role="grid" aria-rowcount={rows.length}>
        <div className="procs-head" style={{ gridTemplateColumns: grid }}>
          {cols.map((c) => (
            <button key={c} className={`${COLS[c].num ? 'num' : ''} ${sort.key === c ? 'on' : ''}`} onClick={() => setSort({ key: c, desc: sort.key === c ? !sort.desc : !!COLS[c].num })}>
              {COLS[c].label}{sort.key === c ? <Icon name={sort.desc ? 'chevronDown' : 'arrowUp'} size={10} /> : null}
            </button>
          ))}
        </div>
        <div className="procs-body" ref={box} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
          {!rows.length ? <div className="small muted" style={{ padding: 20 }}>Nothing matches “{q}”.</div> : null}
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {/* Rows are placed by `top`, so their order in the page can stay put while the list re-sorts:
                moving nodes every second costs far more drawing than changing a number. */}
            {visible.map((r, i) => ({ r, i, k: r.kind === 'group' ? `g:${r.key}` : `p:${r.p.pid}` })).sort((x, y) => (x.k < y.k ? -1 : 1)).map(({ r, i }) => {
              const p = r.kind === 'group' ? r.agg : r.p;
              const pid = r.kind === 'group' ? r.lead.pid : r.p.pid;
              const on = sel.has(pid);
              return (
                <div
                  key={r.kind === 'group' ? `g:${r.key}` : `p:${pid}`}
                  role="row"
                  aria-rowindex={first + i + 1}
                  aria-selected={on}
                  className={`procs-row ${on ? 'on' : ''} ${r.kind === 'group' ? 'group' : ''} ${p.state === 'T' || p.state === 't' ? 'stopped' : ''}`}
                  style={{ gridTemplateColumns: grid, top: (first + i) * ROW_H }}
                  onClick={(e) => selectRow(pid, e)}
                  onDoubleClick={() => (r.kind === 'group' ? setOpenGroups(new Set([...openGroups, r.key])) : setInspect(pid))}
                  onContextMenu={(e) => {
                    // An app's row acts on the app itself; its helpers follow it (or End Process Tree takes them all).
                    const list = r.kind === 'group' ? [r.lead] : sel.has(pid) && sel.size > 1 ? selected : [r.p];
                    if (!sel.has(pid)) setSel(new Set([pid]));
                    menuFor(e, list);
                  }}
                >
                  {cols.map((c) => <span key={c} className={COLS[c].num ? 'num' : ''}>{cell(c, p, r)}</span>)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {[...unavailable].filter((u) => cols.some((c) => COLS[c].needs === u)).length ? (
        <div className="small muted" style={{ marginTop: 6 }}>
          “—” means {platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'this system'} does not report it per process without slowing your computer down.
        </div>
      ) : null}

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {colMenu ? (
        <ContextMenu
          x={colMenu.x}
          y={colMenu.y}
          onClose={() => setColMenu(null)}
          items={[
            ...(Object.keys(COLS) as ColId[]).filter((c) => c !== 'name').map((c) => ({
              label: `${cols.includes(c) ? '✓ ' : ' '}${COLS[c].label}`,
              run: () => {
                const cur = cols.includes(c) ? cols.filter((x) => x !== c) : [...cols, c];
                setTabCols({ ...tabCols, [tab]: cur });
              },
            })),
            { sep: true, label: '' },
            { label: 'Reset Columns', icon: 'undo', run: () => setTabCols({ ...tabCols, [tab]: TAB_COLS[tab] }) },
          ]}
        />
      ) : null}

      {confirm ? <ConfirmAction c={confirm} platform={platform} self={self} onCancel={() => setConfirm(null)} onRun={(list) => void run(confirm.action, list)} /> : null}

      {adminRetry ? (
        <Modal title="Needs an administrator" onClose={() => setAdminRetry(null)}>
          <p>{adminRetry.failed.map((f) => f.name ?? f.pid).join(', ')} {adminRetry.failed.length > 1 ? 'belong' : 'belongs'} to another user or the system.</p>
          <p className="small muted">{platform === 'win32' ? 'Windows will ask for permission.' : platform === 'darwin' ? 'macOS will ask for your password or Touch ID.' : 'Your system will ask for an administrator password.'} Only this one action runs with those rights.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setAdminRetry(null)}>Cancel</button>
            <button
              className="btn primary"
              onClick={() => {
                const a = adminRetry;
                setAdminRetry(null);
                if (a.action === 'priority') void Promise.all(a.failed.map((f) => api.procs.setPriority(f.pid, a.level!, { admin: true }))).then(refresh);
                else void run(a.action, a.failed.map((f) => byPid.get(f.pid) ?? ({ pid: f.pid, ppid: 0, name: f.name ?? String(f.pid), mine: false, cpu: 0, memory: 0 } as ProcRow)), true);
              }}
            >
              <Icon name="lock" size={13} /> Try as Administrator
            </button>
          </div>
        </Modal>
      ) : null}

      {prio ? (
        <PriorityDialog
          p={prio}
          onClose={() => setPrio(null)}
          onSet={async (level) => {
            setPrio(null);
            const r = await api.procs.setPriority(prio.pid, level);
            if (r.ok) toast(`${prio.name}: priority ${priorityName(level).toLowerCase()}`);
            else if (r.failed.some((f) => f.needsAdmin)) setAdminRetry({ action: 'priority', failed: r.failed, level });
            else toast(r.failed.map((f) => f.reason).join(' · '));
            refresh();
          }}
        />
      ) : null}
      {inspect !== null ? <Inspect pid={inspect} live={byPid.get(inspect)} platform={platform} onClose={() => setInspect(null)} onPick={(pid) => setInspect(pid)} /> : null}
      {forceQuit ? <ForceQuitDialog onClose={() => setForceQuit(false)} onDone={refresh} /> : null}
    </div>
  );
}

function Meter({ label, value, sub, values, color, children }: { label: string; value: string; sub: string; values: number[]; color: string; children?: React.ReactNode }) {
  return (
    <div className="card meter">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="small muted">{label}</span>
        <b className="meter-value">{value}</b>
      </div>
      <Sparkline values={values} color={color} height={34} />
      {children}
      <div className="small muted ellipsis" title={sub}>{sub}</div>
    </div>
  );
}

function ConfirmAction({ c, platform, self, onCancel, onRun }: { c: { action: ProcAction; procs: ProcRow[] }; platform: string; self: number; onCancel: () => void; onRun: (list: ProcRow[]) => void }) {
  const force = c.action !== 'quit' && c.action !== 'restart';
  const checks = c.procs.map((p) => ({ p, c: canEnd(p, platform, self, force) }));
  const ok = checks.filter((x) => x.c.ok).map((x) => x.p);
  const blocked = checks.filter((x) => !x.c.ok);
  const warn = checks.filter((x) => x.c.ok && x.c.reason);
  const others = ok.filter((p) => !p.mine);
  const what: Record<ProcAction, string> = {
    quit: 'Each one is asked to close, the same as quitting it yourself. Unsaved work may be lost.',
    forceQuit: 'They stop at once, without saving anything.',
    endTree: 'It stops at once, together with every program it started.',
    suspend: 'They freeze until you resume them. A frozen app shows as not responding.',
    resume: '',
    restart: 'It quits, then starts again the same way it was started.',
  };
  const verb = ACTION_VERB[c.action];
  return (
    <Modal title={`${verb} ${ok.length === 1 ? ok[0].name : `${ok.length} processes`}?`} onClose={onCancel}>
      <p>{what[c.action]}</p>
      {ok.length > 1 ? <div className="small" style={{ maxHeight: 120, overflow: 'auto', marginBottom: 8 }}>{ok.map((p) => <div key={p.pid}>{p.name} <span className="muted">({p.pid})</span></div>)}</div> : null}
      {warn.map((x) => <p key={x.p.pid} className="small" style={{ color: 'var(--warn)' }}>{x.c.reason}</p>)}
      {others.length ? <p className="small muted"><Icon name="lock" size={11} /> {others.map((p) => p.name).join(', ')} {others.length > 1 ? 'belong' : 'belongs'} to another user or the system; you may be asked for an administrator password.</p> : null}
      {blocked.length ? <p className="small muted">Left alone: {blocked.map((x) => `${x.p.name} — ${x.c.reason}`).join(' ')}</p> : null}
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className={`btn ${force || c.action === 'quit' ? 'danger' : 'primary'}`} disabled={!ok.length} autoFocus onClick={() => onRun(ok)}>{verb}</button>
      </div>
    </Modal>
  );
}

function PriorityDialog({ p, onClose, onSet }: { p: ProcRow; onClose: () => void; onSet: (l: PriorityLevel) => void }) {
  const cur = priorityOf(p.nice);
  return (
    <Modal title={`Priority of ${p.name}`} onClose={onClose}>
      <p className="small muted">Higher priority gets the processor first when it is busy. Lowering is always allowed; raising usually needs an administrator.</p>
      <div className="col" style={{ gap: 6, marginTop: 10 }}>
        {(Object.keys(PRIORITIES) as PriorityLevel[]).map((l) => (
          <button key={l} className={`btn ${l === cur ? 'primary' : ''}`} style={{ justifyContent: 'space-between' }} onClick={() => onSet(l)}>
            <span>{priorityName(l)}</span>
            <span className="small" style={{ opacity: 0.7 }}>{l === cur ? 'now' : l === 'lowest' ? 'only when nothing else wants it' : l === 'highest' ? 'ahead of almost everything' : ''}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Inspect({ pid, live, platform, onClose, onPick }: { pid: number; live?: ProcRow; platform: string; onClose: () => void; onPick: (pid: number) => void }) {
  const [d, setD] = useState<ProcDetails | null | undefined>(undefined);
  useEffect(() => {
    setD(undefined);
    void api.procs.details(pid).then(setD).catch(() => setD(null));
  }, [pid]);
  return (
    <Modal title={<span className="row" style={{ gap: 8 }}><Icon name="info" size={18} /> {live?.name ?? d?.name ?? pid}</span>} onClose={onClose} width={680}>
      {d === undefined ? <Loading /> : d === null ? <p className="muted">It is no longer running.</p> : (
        <div className="inspect">
          <div className="kv">
            <span>Process ID</span><b className="mono">{d.pid}{live ? <span className="muted"> · parent {live.ppid}</span> : null}</b>
            <span>User</span><b>{d.user ?? '—'}</b>
            {d.started ? <><span>Started</span><b>{relativeTime(d.started)}</b></> : null}
            {live ? <><span>Now</span><b>{live.cpu.toFixed(1)}% CPU · {formatBytes(live.memory)}{live.threads ? ` · ${live.threads} threads` : ''} · {STATE[live.state ?? ''] ?? '—'} · priority {priorityName(priorityOf(live.nice)).toLowerCase()}</b></> : null}
            {d.path ? <><span>Program</span><b className="mono wrap">{d.path}</b></> : null}
            {d.command ? <><span>Command</span><b className="mono wrap">{d.command}</b></> : null}
            {d.cwd ? <><span>Working in</span><b className="mono wrap">{d.cwd}</b></> : null}
          </div>
          <h4>Memory</h4>
          <div className="kv">{d.memory.map((m) => <Fragment key={m.label}><span>{m.label}</span><b>{formatBytes(m.bytes)}</b></Fragment>)}</div>
          <Suspense fallback={null}><InspectExtras pid={d.pid} onPick={onPick} /></Suspense>
          {d.children.length ? (
            <>
              <h4>Started by it ({d.children.length})</h4>
              <div className="chips">{d.children.slice(0, 40).map((c) => <button key={c.pid} className="badge" onClick={() => onPick(c.pid)}>{c.name} · {c.pid}</button>)}</div>
            </>
          ) : null}
          <h4>Network connections ({d.connections.length})</h4>
          {d.connections.length ? (
            <div className="inspect-list mono">{d.connections.slice(0, 100).map((c, i) => <div key={i}>{c.proto} {c.local}{c.remote ? ` → ${c.remote}` : ''} {c.state ? <span className="muted">{c.state}</span> : null}</div>)}</div>
          ) : <p className="small muted">None.</p>}
          {platform !== 'win32' ? (
            <>
              <h4>Open files ({d.openFiles.length + (d.openFilesMore ?? 0)})</h4>
              {d.openFiles.length ? <div className="inspect-list mono">{d.openFiles.map((f) => <div key={f} className="ellipsis" title={f}>{f}</div>)}{d.openFilesMore ? <div className="muted">and {d.openFilesMore} more</div> : null}</div> : <p className="small muted">None that Keeper can see.</p>}
            </>
          ) : null}
          {d.notes.map((n) => <p key={n} className="small muted">{n}</p>)}
        </div>
      )}
    </Modal>
  );
}

/** The quick "Force Quit Applications" window: only apps, the ones with windows. */
export function ForceQuitDialog({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const { toast, info } = useStore();
  const [apps, setApps] = useState<ForceQuitApp[] | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<number | null>(null);
  const load = useCallback(() => {
    void api.procs.apps().then((a) => {
      setApps(a.sort((x, y) => Number(!!y.notResponding) - Number(!!x.notResponding) || x.name.localeCompare(y.name)));
      void api.procs.icons(a.map((x) => x.path).filter((p): p is string => !!p)).then(setIcons).catch(() => undefined);
    }).catch(() => setApps([]));
  }, []);
  useEffect(load, [load]);
  const go = async (force: boolean) => {
    if (sel === null) return;
    const a = apps?.find((x) => x.pid === sel);
    const r = await api.procs.act(force ? 'forceQuit' : 'quit', [sel]);
    toast(r.ok ? `${force ? 'Force quit' : 'Quit'} ${a?.name ?? sel}` : r.failed.map((f) => f.reason).join(' · '));
    setSel(null);
    setTimeout(load, 400);
    onDone?.();
  };
  return (
    <Modal title="Force Quit Applications" onClose={onClose} width={440}>
      <p className="small muted">If an app has stopped responding, select it and choose Force Quit. Unsaved changes will be lost.</p>
      <div className="fq-list" role="listbox">
        {!apps ? <Loading /> : !apps.length ? <p className="small muted" style={{ padding: 12 }}>No apps with windows are open.</p> : apps.map((a) => (
          <button key={a.pid} role="option" aria-selected={sel === a.pid} className={`fq-row ${sel === a.pid ? 'on' : ''}`} onClick={() => setSel(a.pid)} onDoubleClick={() => { setSel(a.pid); void go(true); }}>
            {a.path && icons[a.path] ? <img src={icons[a.path]} alt="" width={20} height={20} /> : <Icon name="app" size={18} />}
            <span className="grow ellipsis">{a.name}</span>
            {a.notResponding ? <span className="badge danger">Not responding</span> : null}
          </button>
        ))}
      </div>
      <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
        <span className="small muted">{info?.platform === 'darwin' ? '⌥⌘⎋' : 'Ctrl+Alt+Esc'} opens this from anywhere in Keeper</span>
        <div className="btn-row">
          <button className="btn" disabled={sel === null} onClick={() => void go(false)}>Quit</button>
          <button className="btn danger" disabled={sel === null} onClick={() => void go(true)}>Force Quit</button>
        </div>
      </div>
    </Modal>
  );
}

/** Opens Force Quit Applications with ⌥⌘Esc (Ctrl+Alt+Esc) anywhere in the main window. */
export function ForceQuitHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.altKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen(true); }
    };
    const ev = () => setOpen(true);
    window.addEventListener('keydown', key);
    window.addEventListener('keeper:force-quit-anywhere', ev);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keeper:force-quit-anywhere', ev); };
  }, []);
  return open ? <ForceQuitDialog onClose={() => setOpen(false)} /> : null;
}

// ---------------------------------------------------------------- Services

export function Services() {
  const { toast, info } = useStore();
  const [data, setData] = useState<{ supported: boolean; services: ServiceRow[]; note?: string } | null>(null);
  const [q, setQ] = useState('');
  const [scope, setScope] = remembered<'all' | 'user' | 'system'>('services.scope', 'all');
  const [state, setState] = remembered<'all' | 'running' | 'stopped' | 'failed'>('services.state', 'all');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => void api.procs.services().then(setData).catch((e: unknown) => setData({ supported: false, services: [], note: e instanceof Error ? e.message : String(e) })), []);
  useEffect(load, [load]);

  if (!data) return <Loading label="Reading services…" />;
  if (!data.supported) return <Empty icon="power" title="Services are not available here">{data.note}</Empty>;
  const list = data.services.filter((s) => (scope === 'all' || s.scope === scope) && (state === 'all' || s.state === state) && (!q.trim() || `${s.name} ${s.id} ${s.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  const count = (st: ServiceRow['state']) => data.services.filter((s) => s.state === st).length;
  const doIt = async (s: ServiceRow, action: 'start' | 'stop' | 'restart' | 'enable' | 'disable') => {
    setBusy(`${s.id}:${action}`);
    const r = await api.procs.serviceAction(s.id, s.scope, action);
    setBusy(null);
    toast(r.ok ? `${s.name}: ${{ start: 'started', stop: 'stopped', restart: 'restarted', enable: 'starts automatically', disable: 'no longer starts automatically' }[action]}` : r.failed.map((f) => f.reason).join(' · '));
    load();
  };
  const adminNote = info?.platform === 'win32' ? 'Windows asks for permission' : 'asks for an administrator password';
  return (
    <div className="services">
      <div className="procs-bar">
        <div className="search-box">
          <Icon name="search" size={13} />
          <input placeholder="Filter services" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter services" />
        </div>
        {info?.platform !== 'win32' ? (
          <div className="seg">
            {(['all', 'user', 'system'] as const).map((x) => <button key={x} className={scope === x ? 'on' : ''} onClick={() => setScope(x)}>{x === 'all' ? 'All' : x === 'user' ? 'Mine' : 'System'}</button>)}
          </div>
        ) : null}
        <div className="seg">
          {(['all', 'running', 'stopped', 'failed'] as const).map((x) => <button key={x} className={state === x ? 'on' : ''} onClick={() => setState(x)}>{x === 'all' ? 'All' : `${x[0].toUpperCase()}${x.slice(1)}`}{x !== 'all' ? ` ${count(x)}` : ''}</button>)}
        </div>
        <div className="grow" />
        <button className="btn sm" onClick={load}><Icon name="refresh" size={13} /> Refresh</button>
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table services-table">
          <thead><tr><th>Service</th><th>State</th><th title="Starts by itself at startup or login">At startup</th><th /></tr></thead>
          <tbody>
            {list.slice(0, 500).map((s) => (
              <tr key={`${s.scope}:${s.id}`}>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <b className="ellipsis" title={s.id}>{s.name}</b>
                    {s.scope === 'system' ? <span className="badge" title={`Changing it ${adminNote}`}><Icon name="lock" size={10} /> System</span> : null}
                  </div>
                  {s.description ? <div className="small muted ellipsis" style={{ maxWidth: 520 }} title={s.description}>{s.description}</div> : null}
                </td>
                <td><span className={`badge ${s.state === 'running' ? 'ok' : s.state === 'failed' ? 'danger' : ''}`}>{s.state === 'running' ? `Running${s.pid ? ` · ${s.pid}` : ''}` : s.state === 'failed' ? 'Failed' : s.state === 'stopped' ? 'Stopped' : '—'}</span></td>
                <td>{s.enabled === undefined ? <span className="muted">—</span> : <Toggle on={s.enabled} label={`${s.name} at startup`} onChange={(v) => void doIt(s, v ? 'enable' : 'disable')} />}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {s.state === 'running'
                    ? <>
                      <button className="btn ghost sm" disabled={!!busy} onClick={() => void doIt(s, 'restart')}>Restart</button>
                      <button className="btn ghost sm" disabled={!!busy} onClick={() => void doIt(s, 'stop')}>Stop</button>
                    </>
                    : <button className="btn ghost sm" disabled={!!busy} onClick={() => void doIt(s, 'start')}>Start</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length ? <p className="small muted" style={{ padding: 14 }}>No services match.</p> : null}
        {list.length > 500 ? <p className="small muted" style={{ padding: 14 }}>Showing 500 of {list.length}; filter to see the rest.</p> : null}
      </div>
      {data.note ? <p className="small muted" style={{ marginTop: 8 }}>{data.note}</p> : null}
    </div>
  );
}
