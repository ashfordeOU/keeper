// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's Terminal: tabs of split panes, each pane a terminal (or a web tool,
// shared notes or remote files). Terminals live in the session host, so this
// window can close and open again without losing them.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { ContextMenu, Modal, type MenuItem } from '../components/ui';
import { Icon } from '../components/Icon';
import { actionFor, formatCombo } from '../../core/terminal/keys';
import { close as closePane, findLeaf, leaf, leaves, neighbour, paneId, replaceLeaf, resize, split, swap, equalize } from '../../core/terminal/layout';
import type { PaneNode, SessionInfo, ShellInfo, SshHost, TerminalProfile, TerminalSettings, TerminalTab, WebTool, Workspace } from '../../core/terminal/types';
import { useStore } from '../state';
import { FilesPanel } from './FilesPanel';
import { AgentBoard } from './AgentBoard';
import { TerminalSettingsDialog } from './SettingsDialog';
import { ACTION_NAMES } from './actions';
import { useTT } from './strings';
import { XTermPane, type PaneHandle } from './XTermPane';
import '../styles/terminal.css';

type Mode = 'page' | 'window' | 'quick';
type Leaf = Extract<PaneNode, { type: 'leaf' }>;

const MAC = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');
const layoutKey = (mode: Mode) => `term.layout.${mode}`;

function loadLayout(mode: Mode): { tabs: TerminalTab[]; active: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(layoutKey(mode)) ?? 'null');
    return v?.tabs?.length ? v : null;
  } catch {
    return null;
  }
}

const URL_RE = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+[^\s\x1b'"<>]*/;
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');

export function TerminalApp({ mode = 'page', startCwd }: { mode?: Mode; startCwd?: string }) {
  const tt = useTT();
  const { toast, info } = useStore();
  const [settings, setSettings] = useState<TerminalSettings | null>(null);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tools, setTools] = useState<WebTool[]>([]);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState('');
  const [panel, setPanel] = useState<'files' | 'notes' | 'sessions' | null>(null);
  // Agents' terminals and the agent hub (a view of its own), and which panes agents control.
  const [agentsView, setAgentsView] = useState(false);
  const [agentTerms, setAgentTerms] = useState<Record<string, { agent: string; human: boolean }>>({});
  useEffect(() => {
    const load = () => void api.agentterm?.state().then((s) => {
      const map: Record<string, { agent: string; human: boolean }> = {};
      const walk = (ts: typeof s.terms) => { for (const t of ts) { map[t.id] = { agent: s.agents.find((a) => `agent:${a.id}` === t.owner)?.name ?? t.owner.replace(/^agent:/, ''), human: t.controller === 'human' }; walk(t.sub); } };
      walk(s.terms);
      setAgentTerms(map);
    }).catch(() => undefined);
    load();
    return api.on('agentterm-changed', load);
  }, []);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dialog, setDialog] = useState<null | 'settings' | 'palette' | 'url' | 'workspace' | { kind: 'paste'; text: string; resolve: (ok: boolean) => void } | { kind: 'broadcast' } | { kind: 'rename'; id: string; title: string } | { kind: 'group'; id: string; group: string }>(null);
  const [findText, setFindText] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const panes = useRef(new Map<string, PaneHandle>());
  const urlWatch = useRef(new Map<string, (data: string) => void>());

  const tab = tabs.find((t) => t.id === activeTab) ?? tabs[0];
  const focusLeaf = tab ? findLeaf(tab.root, tab.focus) ?? leaves(tab.root)[0] : undefined;
  const focusSession = sessions.find((s) => s.id === focusLeaf?.session);

  // ---------------------------------------------------------------- loading

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [s, sh, list] = await Promise.all([api.terminal.settings(), api.terminal.shells(), api.terminal.sessions().catch(() => [] as SessionInfo[])]);
      if (!alive) return;
      setSettings(s);
      setShells(sh);
      setSessions(list);
      const saved = loadLayout(mode);
      const ids = new Set(list.map((x) => x.id));
      let restoredTabs: TerminalTab[] = [];
      if (saved) {
        // Panes whose terminal is gone are dropped; tabs with nothing left go too.
        for (const t of saved.tabs) {
          let root: PaneNode | null = t.root;
          for (const l of leaves(t.root)) if ((l.kind ?? 'terminal') === 'terminal' && !ids.has(l.session)) root = root && closePane(root, l.id);
          if (root) restoredTabs.push({ ...t, root, focus: findLeaf(root, t.focus) ? t.focus : leaves(root)[0].id });
        }
      }
      if (restoredTabs.length && startCwd) {
        // "Open in Terminal" on a folder: a new tab there, beside the tabs from last time.
        const s1 = await api.terminal.create({ cwd: startCwd });
        if (!alive) return;
        const l1 = leaf(s1.id);
        const t1: TerminalTab = { id: paneId(), root: l1, focus: l1.id };
        restoredTabs.push(t1);
        setTabs(restoredTabs);
        setActiveTab(t1.id);
        setReady(true);
        void api.terminal.sshHosts().then((h) => alive && setHosts(h));
        void api.terminal.webTools().then((w) => alive && setTools(w));
        return;
      }
      if (!restoredTabs.length) {
        const s0 = await api.terminal.create({ cwd: startCwd });
        if (!alive) return;
        const l = leaf(s0.id);
        restoredTabs = [{ id: paneId(), root: l, focus: l.id }];
      }
      setTabs(restoredTabs);
      setActiveTab(saved && restoredTabs.some((t) => t.id === saved.active) ? saved.active : restoredTabs[0].id);
      setReady(true);
      void api.terminal.sshHosts().then((h) => alive && setHosts(h));
      void api.terminal.webTools().then((w) => alive && setTools(w));
    })().catch((e) => toast(e instanceof Error ? e.message : String(e)));
    const offs = [
      api.on('term-sessions', (s) => setSessions(s)),
      api.on('term-settings', (s) => setSettings(s)),
      api.on('term-open', (q) => {
        // An agent's terminal shown to the person (from the Agents view or the agent itself).
        if (q.session) { showSession(q.session); return; }
        // Agents started from Keeper arrive with a command to run (and a title).
        if (q.run) void newTab({ cwd: q.cwd, run: q.run, title: q.title });
        else if (q.cwd) void newTab({ cwd: q.cwd });
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The layout is remembered per window kind, so reopening shows the same tabs and panes.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(layoutKey(mode), JSON.stringify({ tabs, active: activeTab }));
    } catch {
      /* storage unavailable */
    }
  }, [tabs, activeTab, ready, mode]);

  // ---------------------------------------------------------------- helpers

  const profileOf = useCallback((id?: string): TerminalProfile | undefined => {
    if (!settings) return undefined;
    const s = sessions.find((x) => x.id === id);
    return settings.profiles.find((p) => p.id === s?.profileId) ?? settings.profiles.find((p) => p.id === settings.defaultProfile);
  }, [settings, sessions]);

  const updateTab = (id: string, fn: (t: TerminalTab) => TerminalTab) => setTabs((all) => all.map((t) => (t.id === id ? fn(t) : t)));

  const create = async (opts: Parameters<typeof api.terminal.create>[0] = {}) => {
    try {
      return await api.terminal.create(opts);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  /** A terminal that already runs (an agent's): its tab if one shows it, else a new tab. */
  function showSession(id: string) {
    const has = (n: PaneNode): boolean => (n.type === 'leaf' ? n.session === id : n.children.some(has));
    let found: string | undefined;
    setTabs((all) => {
      const t = all.find((x) => has(x.root));
      if (t) { found = t.id; return all; }
      const l = leaf(id);
      const nt: TerminalTab = { id: paneId(), root: l, focus: l.id };
      found = nt.id;
      return [...all, nt];
    });
    setTimeout(() => found && setActiveTab(found), 0);
  }

  async function newTab(opts: Parameters<typeof api.terminal.create>[0] = {}) {
    const s = await create(opts);
    if (!s) return;
    const l = leaf(s.id);
    const t: TerminalTab = { id: paneId(), root: l, focus: l.id };
    setTabs((all) => [...all, t]);
    setActiveTab(t.id);
  }

  async function splitPane(dir: 'row' | 'col', opts: Parameters<typeof api.terminal.create>[0] & { leaf?: Partial<Leaf> } = {}) {
    if (!tab || !focusLeaf) return newTab(opts);
    let added: Leaf;
    if (opts.leaf?.kind && opts.leaf.kind !== 'terminal') added = leaf(focusLeaf.session, opts.leaf) as Leaf;
    else if (opts.leaf?.session) added = leaf(opts.leaf.session) as Leaf;
    else {
      // A new pane starts as a sister of the focused one: same profile, folder and group.
      const s = await create({ cloneOf: opts.profileId || opts.profile || opts.cwd ? undefined : focusLeaf.session, group: focusSession?.group, ...opts });
      if (!s) return;
      added = leaf(s.id) as Leaf;
    }
    updateTab(tab.id, (t) => ({ ...t, root: split(t.root, focusLeaf.id, dir, added), focus: added.id, zoomed: undefined }));
    return added;
  }

  const sessionShownElsewhere = (sessionId: string, exceptLeaf: string) =>
    tabs.some((t) => leaves(t.root).some((l) => l.id !== exceptLeaf && l.session === sessionId && (l.kind ?? 'terminal') === 'terminal'));

  /** Closes a pane; its terminal ends unless `keep` (it then waits in Sessions) or another pane still shows it. */
  async function closeLeaf(tabId: string, leafId: string, keep = false) {
    const t = tabs.find((x) => x.id === tabId);
    const l = t && findLeaf(t.root, leafId);
    if (!t || !l) return;
    if ((l.kind ?? 'terminal') === 'terminal' && !keep && !sessionShownElsewhere(l.session, l.id)) void api.terminal.kill(l.session).catch(() => undefined);
    const root = closePane(t.root, leafId);
    if (!root) {
      const rest = tabs.filter((x) => x.id !== tabId);
      setTabs(rest);
      if (activeTab === tabId) setActiveTab(rest[rest.length - 1]?.id ?? '');
      if (!rest.length) {
        if (mode === 'quick') return void api.terminal.toggleQuick();
        if (mode === 'window') return window.close();
        void newTab();
      }
      return;
    }
    updateTab(tabId, (x) => ({ ...x, root, focus: leaves(root)[0].id, zoomed: x.zoomed === leafId ? undefined : x.zoomed }));
  }

  function closeTab(tabId: string) {
    const t = tabs.find((x) => x.id === tabId);
    if (!t) return;
    for (const l of leaves(t.root)) if ((l.kind ?? 'terminal') === 'terminal' && !tabs.some((o) => o.id !== tabId && leaves(o.root).some((x) => x.session === l.session))) void api.terminal.kill(l.session).catch(() => undefined);
    const rest = tabs.filter((x) => x.id !== tabId);
    setTabs(rest);
    if (activeTab === tabId) setActiveTab(rest[Math.max(0, tabs.findIndex((x) => x.id === tabId) - 1)]?.id ?? '');
    if (!rest.length) {
      if (mode === 'quick') void api.terminal.toggleQuick();
      else if (mode === 'window') window.close();
      else void newTab();
    }
  }

  const broadcastTargets = (t: TerminalTab | undefined) => (t?.broadcast ? [...new Set(leaves(t.root).filter((l) => (l.kind ?? 'terminal') === 'terminal').map((l) => l.session))] : undefined);

  function toggleBroadcast() {
    if (!tab) return;
    if (!tab.broadcast && settings?.confirmBroadcast && leaves(tab.root).length > 1) return setDialog({ kind: 'broadcast' });
    updateTab(tab.id, (t) => ({ ...t, broadcast: !t.broadcast }));
  }

  const confirmPaste = (text: string) => new Promise<boolean>((resolve) => setDialog({ kind: 'paste', text, resolve }));

  /** Starts a web tool (editor or notebooks) in a terminal, then shows its page once it prints its address. */
  async function startWebTool(id: 'editor' | 'notebook') {
    const folder = focusSession?.cwd || (await api.settings.pickFolder());
    if (!folder) return;
    const token = randomToken();
    const cmd = await api.terminal.webToolCommand(id, folder, token);
    if (!cmd) return toast(tools.find((x) => x.id === id)?.hint ?? 'Not installed');
    const s = await create({ cwd: folder, run: cmd, title: id === 'editor' ? tt('editor') : tt('notebook') });
    if (!s || !tab) return;
    const l = leaf(s.id) as Leaf;
    const t: TerminalTab = { id: paneId(), root: l, focus: l.id, title: id === 'editor' ? tt('editor') : tt('notebook') };
    setTabs((all) => [...all, t]);
    setActiveTab(t.id);
    let buf = '';
    urlWatch.current.set(s.id, (data) => {
      buf = (buf + data).slice(-4000);
      // eslint-disable-next-line no-control-regex
      const m = buf.replace(/\x1b\[[0-9;]*m/g, '').match(URL_RE);
      if (!m) return;
      urlWatch.current.delete(s.id);
      // The server may print its token hidden ("token=..."); Keeper made the token, so it puts it back.
      const u = new URL(m[0].replace(/[).,]+$/, ''));
      if (id === 'notebook') u.searchParams.set('token', token);
      else if (!/code-server/.test(cmd)) u.searchParams.set('tkn', token);
      const url = u.toString();
      const web = leaf(s.id, { kind: 'web', url }) as Leaf;
      setTabs((all) => all.map((x) => (x.id === t.id ? { ...x, root: { type: 'split', id: paneId(), dir: 'col', children: [web, x.root], sizes: [0.78, 0.22] }, focus: web.id } : x)));
    });
  }

  function openUrl(url: string) {
    if (!focusLeaf) return;
    void splitPane('row', { leaf: { kind: 'web', url } });
  }

  async function restartLeaf(l: Leaf) {
    const old = sessions.find((s) => s.id === l.session);
    const s = await create({ profileId: old?.profileId, cwd: old?.cwd, group: old?.group, title: old?.title });
    if (!s || !tab) return;
    void api.terminal.kill(l.session).catch(() => undefined);
    for (const t of tabs) updateTab(t.id, (x) => ({ ...x, root: mapSessions(x.root, l.session, s.id) }));
  }

  function openWorkspace(ws: Workspace) {
    void (async () => {
      // Each terminal pane in a saved layout gets a fresh terminal with the same profile and folder.
      const out: TerminalTab[] = [];
      for (const t of ws.tabs) {
        let root = t.root;
        for (const l of leaves(t.root)) {
          if ((l.kind ?? 'terminal') !== 'terminal') continue;
          const meta = (l as Leaf & { profileId?: string; cwd?: string });
          const s = await create({ profileId: meta.profileId, cwd: meta.cwd });
          if (s) root = replaceLeaf(root, l.id, { session: s.id });
        }
        out.push({ ...t, id: paneId(), root });
      }
      setTabs((all) => [...all, ...out]);
      if (out[0]) setActiveTab(out[0].id);
    })();
  }

  function workspaceFromTabs(name: string): Workspace {
    const withMeta = (n: PaneNode): PaneNode => (n.type === 'leaf'
      ? ({ ...n, profileId: sessions.find((s) => s.id === n.session)?.profileId, cwd: sessions.find((s) => s.id === n.session)?.cwd } as PaneNode)
      : { ...n, children: n.children.map(withMeta) });
    return { id: paneId(), name, tabs: tabs.map((t) => ({ ...t, root: withMeta(t.root) })), active: activeTab };
  }

  // ---------------------------------------------------------------- actions and keys

  const run = useCallback((action: string) => {
    const pane = focusLeaf ? panes.current.get(focusLeaf.id) : undefined;
    switch (action) {
      case 'tab.new': return void newTab({ profileId: settings?.defaultProfile });
      case 'tab.close': return tab && closeTab(tab.id);
      case 'tab.next':
      case 'tab.prev': {
        const i = tabs.findIndex((t) => t.id === tab?.id);
        const n = tabs[(i + (action === 'tab.next' ? 1 : -1) + tabs.length) % tabs.length];
        if (n) setActiveTab(n.id);
        return;
      }
      case 'pane.splitRight': return void splitPane('row');
      case 'pane.splitDown': return void splitPane('col');
      case 'pane.close': return tab && focusLeaf && void closeLeaf(tab.id, focusLeaf.id);
      case 'pane.zoom': return tab && focusLeaf && updateTab(tab.id, (t) => ({ ...t, zoomed: t.zoomed ? undefined : focusLeaf.id }));
      case 'pane.next':
      case 'pane.prev': {
        if (!tab) return;
        const ls = leaves(tab.root);
        const i = ls.findIndex((l) => l.id === focusLeaf?.id);
        const n = ls[(i + (action === 'pane.next' ? 1 : -1) + ls.length) % ls.length];
        return updateTab(tab.id, (t) => ({ ...t, focus: n.id }));
      }
      case 'pane.left':
      case 'pane.right':
      case 'pane.up':
      case 'pane.down': {
        if (!tab || !focusLeaf) return;
        const n = neighbour(tab.root, focusLeaf.id, action.slice(5) as 'left');
        if (n) updateTab(tab.id, (t) => ({ ...t, focus: n }));
        return;
      }
      case 'broadcast.toggle': return toggleBroadcast();
      case 'search.open': return setFindText((v) => (v === null ? '' : v));
      case 'prompt.prev': return pane?.jumpPrompt(-1);
      case 'prompt.next': return pane?.jumpPrompt(1);
      case 'font.bigger': return pane?.fontStep(1);
      case 'font.smaller': return pane?.fontStep(-1);
      case 'font.reset': return pane?.fontStep(0);
      case 'clear': return pane?.clear();
      case 'palette': return setDialog('palette');
      case 'copyMode': return setFindText((v) => (v === null ? '' : v));
      default:
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tabs, focusLeaf, settings, focusSession]);

  useEffect(() => {
    if (!settings) return;
    const onKey = (e: KeyboardEvent) => {
      if (dialog) return;
      const a = actionFor(settings.keybindings, e, MAC);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      run(a);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [settings, run, dialog]);

  // ---------------------------------------------------------------- menus

  const newMenuItems = (): MenuItem[] => {
    if (!settings) return [];
    const items: MenuItem[] = [];
    for (const p of settings.profiles) items.push({ label: `${p.badge ? p.badge + '  ' : ''}${p.name}${p.isolate ? '  ·  own sign-ins' : ''}`, icon: 'terminal', run: () => void newTab({ profileId: p.id }), kbd: p.id === settings.defaultProfile ? formatCombo(settings.keybindings['tab.new'], MAC) : undefined });
    items.push({ sep: true, label: '' });
    for (const s of shells) items.push({ label: s.label, icon: 'terminal', run: () => void newTab({ profile: { id: `shell-${s.id}`, name: s.label, shell: s.id, scheme: 'keeper' } }) });
    if (hosts.length) {
      items.push({ sep: true, label: '' });
      for (const h of hosts.slice(0, 12)) items.push({ label: `SSH · ${h.alias}${h.host && h.host !== h.alias ? ` (${h.host})` : ''}`, icon: 'server', run: () => void newTab({ profile: { id: `ssh-${h.alias}`, name: h.alias, shell: 'default', ssh: h.alias, scheme: 'harbor' }, title: h.alias }) });
    }
    items.push({ sep: true, label: '' });
    for (const w of tools) {
      if (w.id === 'url') items.push({ label: tt('webPage') + '…', icon: 'globe', run: () => setDialog('url') });
      else items.push({ label: `${w.id === 'editor' ? tt('editor') : tt('notebook')}${w.available ? '' : ` — ${tt('missing')}`}`, icon: w.id === 'editor' ? 'code' : 'document', run: () => (w.available ? void startWebTool(w.id as 'editor' | 'notebook') : toast(w.hint ?? tt('missing'))) });
    }
    if (settings.workspaces.length) {
      items.push({ sep: true, label: '' });
      for (const w of settings.workspaces) items.push({ label: `${tt('workspaces')} · ${w.name}`, icon: 'grid', run: () => openWorkspace(w) });
    }
    return items;
  };

  const paneMenu = (e: React.MouseEvent, l: Leaf) => {
    e.preventDefault();
    if (!tab) return;
    const pane = panes.current.get(l.id);
    const sel = pane?.selection() ?? '';
    const s = sessions.find((x) => x.id === l.session);
    const items: MenuItem[] = [
      ...(sel ? [{ label: 'Copy', icon: 'copy', run: () => void navigator.clipboard.writeText(sel) }] : []),
      { label: 'Paste', icon: 'clipboard', run: () => void navigator.clipboard.readText().then((t) => pane?.paste(t)) },
      { sep: true, label: '' },
      { label: tt('splitRight'), icon: 'plus', kbd: formatCombo(settings?.keybindings['pane.splitRight'] ?? '', MAC), run: () => void splitPane('row') },
      { label: tt('splitDown'), icon: 'plus', kbd: formatCombo(settings?.keybindings['pane.splitDown'] ?? '', MAC), run: () => void splitPane('col') },
      { label: tt('clone'), icon: 'copy', run: () => void splitPane('row', { cloneOf: l.session }) },
      { label: tt('mirror'), icon: 'eye', run: () => void splitPane('row', { leaf: { session: l.session } }) },
      { label: tab.zoomed ? 'Unzoom' : tt('zoom'), icon: 'grid', run: () => updateTab(tab.id, (t) => ({ ...t, zoomed: t.zoomed ? undefined : l.id })) },
      { label: 'Even out panes', icon: 'grid', run: () => updateTab(tab.id, (t) => ({ ...t, root: equalize(t.root) })) },
      ...(leaves(tab.root).length > 1 ? [{ label: 'Swap with next pane', icon: 'shuffle', run: () => {
        const ls = leaves(tab.root);
        const i = ls.findIndex((x) => x.id === l.id);
        updateTab(tab.id, (t) => ({ ...t, root: swap(t.root, l.id, ls[(i + 1) % ls.length].id) }));
      } }] : []),
      { sep: true, label: '' },
      { label: tt('rename') + '…', icon: 'rename', run: () => setDialog({ kind: 'rename', id: l.session, title: s?.title ?? '' }) },
      { label: `${tt('group')}…${s?.group ? ` (${s.group})` : ''}`, icon: 'tag', run: () => setDialog({ kind: 'group', id: l.session, group: s?.group ?? '' }) },
      { label: tt('search'), icon: 'search', kbd: formatCombo(settings?.keybindings['search.open'] ?? '', MAC), run: () => setFindText('') },
      { label: tt('clear'), icon: 'close', run: () => pane?.clear() },
      ...(s?.cwd ? [
        { label: 'Show folder', icon: 'reveal', run: () => void api.files.reveal(s.cwd!) },
        ...(settings?.launchers ?? []).map((x) => ({ label: `${tt('openIn')} ${x.name}`, icon: 'external', run: () => void api.terminal.openWith(x.command, s.cwd!) })),
      ] : []),
      { sep: true, label: '' },
      { label: tt('detach'), icon: 'down', run: () => void closeLeaf(tab.id, l.id, true) },
      { label: tt('closePane'), icon: 'close', danger: true, kbd: formatCombo(settings?.keybindings['pane.close'] ?? '', MAC), run: () => void closeLeaf(tab.id, l.id) },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // ---------------------------------------------------------------- rendering panes

  const tabTitle = (t: TerminalTab) => {
    if (t.title) return t.title;
    const f = findLeaf(t.root, t.focus) ?? leaves(t.root)[0];
    const s = sessions.find((x) => x.id === f?.session);
    const base = s?.title || s?.profileName || tt('title');
    return s?.running && s.running !== '…' ? `${base} — ${s.running}` : base;
  };

  const renderNode = (t: TerminalTab, n: PaneNode, visible: boolean): React.ReactNode => {
    if (t.zoomed && n.type === 'split') {
      const z = findLeaf(n, t.zoomed);
      if (z) return renderNode({ ...t, zoomed: undefined }, z, visible);
    }
    if (n.type === 'leaf') {
      const s = sessions.find((x) => x.id === n.session);
      const active = t.focus === n.id;
      const head = (
        <div className="tpane-head" onContextMenu={(e) => paneMenu(e, n)} onDoubleClick={() => updateTab(t.id, (x) => ({ ...x, zoomed: x.zoomed ? undefined : n.id }))}>
          {s ? <span className="tpane-dot" style={{ background: profileOf(s.id)?.color ?? 'var(--accent)' }} /> : null}
          <span className="ellipsis">{n.kind === 'web' ? (n.url ?? '').replace(/([?&](tkn|token)=)[^&]+/, '$1…') : n.kind === 'notes' ? tt('notes') : s ? `${s.title}${s.cwd ? ` — ${s.cwd.replace(info?.home ?? '\0', '~')}` : ''}` : tt('title')}</span>
          {s?.group ? <span className="badge">{s.group}</span> : null}
          {agentTerms[n.session] ? <span className={`badge agent-badge ${agentTerms[n.session].human ? 'human' : ''}`} title={agentTerms[n.session].human ? 'You have taken this terminal over from the agent' : 'An agent controls this terminal'}>{agentTerms[n.session].human ? '✋ you' : `🤖 ${agentTerms[n.session].agent}`}</span> : null}
          {s?.running && s.running !== '…' ? <span className="badge accent">{s.running}</span> : null}
          <button className="tpane-x" title={tt('closePane')} onClick={() => void closeLeaf(t.id, n.id)}><Icon name="close" size={11} /></button>
        </div>
      );
      let body: React.ReactNode;
      if (n.kind === 'web') body = <WebPane url={n.url ?? 'about:blank'} />;
      else if (n.kind === 'notes') body = <NotesPane noteKey={s?.group ? `group:${s.group}` : `tab:${t.id}`} hint={s?.group ? tt('shared') : tt('tabNotes')} />;
      else body = settings ? (
        <XTermPane
          ref={(h) => {
            if (h) panes.current.set(n.id, h);
            else panes.current.delete(n.id);
          }}
          session={n.session}
          cwd={s?.cwd}
          profile={profileOf(n.session)}
          settings={settings}
          active={active}
          visible={visible}
          broadcastTo={broadcastTargets(t)}
          onFocus={() => t.focus !== n.id && updateTab(t.id, (x) => ({ ...x, focus: n.id }))}
          onOutput={urlWatch.current.has(n.session) ? (d) => urlWatch.current.get(n.session)?.(d) : undefined}
          confirmPaste={confirmPaste}
          restored={!!s?.restored}
          onRestart={() => void restartLeaf(n)}
        />
      ) : null;
      return (
        <div key={n.id} className={`tpane ${active ? 'focused' : ''} ${t.broadcast ? 'broadcasting' : ''}`} onContextMenu={(e) => (n.kind ?? 'terminal') === 'terminal' && paneMenu(e, n)}>
          {leaves(t.root).length > 1 || n.kind === 'web' ? head : null}
          {body}
        </div>
      );
    }
    return (
      <div key={n.id} className={`tsplit dir-${n.dir}`}>
        {n.children.map((c, i) => (
          <Fragment key={c.id}>
            <div className="tsplit-cell" style={{ flex: `${n.sizes[i]} 1 0` }}>{renderNode(t, c, visible)}</div>
            {i < n.children.length - 1 ? <Divider dir={n.dir} onDrag={(delta) => updateTab(t.id, (x) => ({ ...x, root: resize(x.root, n.id, i, delta) }))} /> : null}
          </Fragment>
        ))}
      </div>
    );
  };

  if (!settings) return <div className={`term-app mode-${mode}`}><div className="term-loading"><div className="spinner" /></div></div>;

  return (
    <div className={`term-app mode-${mode}`}>
      <div className="term-bar">
        <div className="term-tabs" role="tablist">
          {tabs.map((t) => {
            const f = findLeaf(t.root, t.focus) ?? leaves(t.root)[0];
            const s = sessions.find((x) => x.id === f?.session);
            const p = profileOf(s?.id);
            return (
              <div key={t.id} role="tab" aria-selected={t.id === tab?.id} className={`term-tab ${t.id === tab?.id ? 'on' : ''}`} onMouseDown={(e) => e.button === 1 ? closeTab(t.id) : setActiveTab(t.id)} onDoubleClick={() => s && setDialog({ kind: 'rename', id: s.id, title: s.title })}>
                {p?.badge ? <span className="tab-badge" style={{ background: p.color ?? 'var(--accent)' }}>{p.badge}</span> : <Icon name="terminal" size={12} />}
                <span className="ellipsis">{tabTitle(t)}</span>
                {t.broadcast ? <span title={tt('broadcastOn')}>⇶</span> : null}
                {leaves(t.root).length > 1 ? <span className="muted small">{leaves(t.root).length}</span> : null}
                <button className="tab-x" onMouseDown={(e) => e.stopPropagation()} onClick={() => closeTab(t.id)} title={tt('close')}><Icon name="close" size={11} /></button>
              </div>
            );
          })}
          <button className="btn ghost sm icon" title={`${tt('newTab')} (${formatCombo(settings.keybindings['tab.new'], MAC)})`} onClick={() => void newTab()}><Icon name="plus" size={14} /></button>
          <button className="btn ghost sm icon" title={tt('newTerminal')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, items: newMenuItems() }); }}><Icon name="chevronDown" size={13} /></button>
        </div>
        <div className="term-tools">
          <button className={`btn ghost sm icon ${tab?.broadcast ? 'on' : ''}`} title={`${tt('broadcast')} (${formatCombo(settings.keybindings['broadcast.toggle'], MAC)})`} onClick={toggleBroadcast}>⇶</button>
          <button className="btn ghost sm icon" title={`${tt('splitRight')} (${formatCombo(settings.keybindings['pane.splitRight'], MAC)})`} onClick={() => void splitPane('row')}><span className="split-ico v" /></button>
          <button className="btn ghost sm icon" title={`${tt('splitDown')} (${formatCombo(settings.keybindings['pane.splitDown'], MAC)})`} onClick={() => void splitPane('col')}><span className="split-ico h" /></button>
          <span className="term-sep" />
          <button className={`btn ghost sm ${panel === 'files' ? 'on' : ''}`} onClick={() => setPanel(panel === 'files' ? null : 'files')}><Icon name="server" size={13} /> {tt('files')}</button>
          <button className={`btn ghost sm ${panel === 'notes' ? 'on' : ''}`} onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><Icon name="text" size={13} /> {tt('notes')}</button>
          <button className={`btn ghost sm ${panel === 'sessions' ? 'on' : ''}`} onClick={() => setPanel(panel === 'sessions' ? null : 'sessions')}><Icon name="list" size={13} /> {tt('sessions')} <span className="muted">{sessions.length}</span></button>
          <button className={`btn ghost sm ${agentsView ? 'on' : ''}`} onClick={() => setAgentsView(!agentsView)} title="Agents' terminals, sub-workers, messages and the shared task board"><Icon name="assistant" size={13} /> Agents <span className="muted">{Object.keys(agentTerms).length || ''}</span></button>
          <span className="term-sep" />
          <button className="btn ghost sm icon" title={tt('workspaces')} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 4, items: [
            { label: tt('saveWorkspace'), icon: 'plus', run: () => setDialog('workspace') },
            ...settings.workspaces.map((w) => ({ label: w.name, icon: 'grid', run: () => openWorkspace(w) })),
          ] }); }}><Icon name="grid" size={14} /></button>
          {mode === 'page' ? <button className="btn ghost sm icon" title="Open in its own window" onClick={() => void api.terminal.openWindow()}><Icon name="external" size={14} /></button> : null}
          <button className="btn ghost sm icon" title={tt('settings')} onClick={() => setDialog('settings')}><Icon name="settings" size={14} /></button>
        </div>
      </div>

      {findText !== null ? (
        <div className="term-find">
          <Icon name="search" size={13} />
          <input autoFocus placeholder={tt('search')} value={findText} onChange={(e) => { setFindText(e.target.value); if (focusLeaf) panes.current.get(focusLeaf.id)?.find(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && focusLeaf) panes.current.get(focusLeaf.id)?.find(findText, e.shiftKey);
              if (e.key === 'Escape') { setFindText(null); if (focusLeaf) { panes.current.get(focusLeaf.id)?.clearFind(); panes.current.get(focusLeaf.id)?.focus(); } }
            }} />
          <button className="btn ghost sm icon" onClick={() => focusLeaf && panes.current.get(focusLeaf.id)?.find(findText, true)}><Icon name="arrowUp" size={12} /></button>
          <button className="btn ghost sm icon" onClick={() => focusLeaf && panes.current.get(focusLeaf.id)?.find(findText)}><Icon name="chevronDown" size={12} /></button>
          <button className="btn ghost sm icon" onClick={() => setFindText(null)}><Icon name="close" size={12} /></button>
        </div>
      ) : null}

      <div className="term-body">
        {agentsView ? <AgentBoard onShow={(id) => { setAgentsView(false); showSession(id); }} /> : null}
        <div className="term-stage" style={agentsView ? { display: 'none' } : undefined}>
          {tabs.map((t) => (
            <div key={t.id} className="term-tab-body" style={{ display: t.id === tab?.id ? 'flex' : 'none' }}>
              {renderNode(t, t.root, t.id === tab?.id)}
            </div>
          ))}
          {!tabs.length ? <div className="term-empty">{tt('empty')}</div> : null}
        </div>
        {panel ? (
          <aside className="term-panel">
            {panel === 'files' ? <FilesPanel hosts={hosts} initial={profileOf(focusSession?.id)?.ssh} /> : null}
            {panel === 'notes' ? <NotesPane noteKey={focusSession?.group ? `group:${focusSession.group}` : `tab:${tab?.id ?? ''}`} hint={focusSession?.group ? tt('shared') : tt('tabNotes')} /> : null}
            {panel === 'sessions' ? (
              <SessionsList
                sessions={sessions}
                shown={new Set(tabs.flatMap((t) => leaves(t.root).map((l) => l.session)))}
                onOpen={(id) => {
                  const l = leaf(id);
                  const t: TerminalTab = { id: paneId(), root: l, focus: l.id };
                  setTabs((all) => [...all, t]);
                  setActiveTab(t.id);
                }}
                onKill={(id) => void api.terminal.kill(id)}
              />
            ) : null}
          </aside>
        ) : null}
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}

      {dialog === 'settings' ? <TerminalSettingsDialog settings={settings} shells={shells} onClose={() => setDialog(null)} onChange={(patch) => void api.terminal.setSettings(patch).then(setSettings)} /> : null}
      {dialog === 'palette' ? <Palette settings={settings} onRun={(a) => { setDialog(null); run(a); }} onClose={() => setDialog(null)} extra={newMenuItems()} /> : null}
      {dialog === 'url' ? <PromptDialog title={tt('webPage')} label={tt('url')} initial="http://localhost:3000" onCancel={() => setDialog(null)} onOk={(v) => { setDialog(null); if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(v)) openUrl(v); else toast('Only pages served by this computer (localhost) open inside the Terminal.'); }} /> : null}
      {dialog === 'workspace' ? <PromptDialog title={tt('saveWorkspace')} label={tt('name')} initial={`Layout ${new Date().toLocaleDateString()}`} onCancel={() => setDialog(null)} onOk={(v) => { setDialog(null); void api.terminal.saveWorkspace(workspaceFromTabs(v)).then((s) => { setSettings(s); toast(`Saved “${v}”`); }); }} /> : null}
      {dialog && typeof dialog === 'object' && dialog.kind === 'rename' ? <PromptDialog title={tt('rename')} label={tt('name')} initial={dialog.title} onCancel={() => setDialog(null)} onOk={(v) => { void api.terminal.rename(dialog.id, v); setDialog(null); }} /> : null}
      {dialog && typeof dialog === 'object' && dialog.kind === 'group' ? (
        <PromptDialog title={tt('group')} label="Terminals in the same group share notes and a folder ($KEEPER_SHARED_DIR). New terminals split from them join too. Leave empty to leave the group." initial={dialog.group} onCancel={() => setDialog(null)} onOk={(v) => { void api.terminal.setGroup(dialog.id, v.trim() || undefined); setDialog(null); }} />
      ) : null}
      {dialog && typeof dialog === 'object' && dialog.kind === 'paste' ? (
        <Modal title={tt('pasteTitle')} onClose={() => { dialog.resolve(false); setDialog(null); }}>
          <p className="muted small" style={{ marginTop: 0 }}>{tt('pasteBody')}</p>
          <pre className="term-paste-preview">{dialog.text.slice(0, 2000)}</pre>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => { dialog.resolve(false); setDialog(null); }}>{tt('cancel')}</button>
            <button className="btn primary" autoFocus onClick={() => { dialog.resolve(true); setDialog(null); }}>{tt('paste')}</button>
          </div>
        </Modal>
      ) : null}
      {dialog && typeof dialog === 'object' && dialog.kind === 'broadcast' ? (
        <Modal title={tt('broadcast')} onClose={() => setDialog(null)}>
          <p style={{ marginTop: 0 }}>{tt('broadcastOn')}: {tab ? leaves(tab.root).length : 0}.</p>
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setDialog(null)}>{tt('cancel')}</button>
            <button className="btn primary" autoFocus onClick={() => { if (tab) updateTab(tab.id, (t) => ({ ...t, broadcast: true })); setDialog(null); }}>OK</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function mapSessions(n: PaneNode, from: string, to: string): PaneNode {
  return n.type === 'leaf' ? (n.session === from ? { ...n, session: to } : n) : { ...n, children: n.children.map((c) => mapSessions(c, from, to)) };
}

function Divider({ dir, onDrag }: { dir: 'row' | 'col'; onDrag: (delta: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`tdivider dir-${dir}`}
      onMouseDown={(e) => {
        e.preventDefault();
        const parent = ref.current?.parentElement;
        if (!parent) return;
        const size = dir === 'row' ? parent.clientWidth : parent.clientHeight;
        let last = dir === 'row' ? e.clientX : e.clientY;
        const move = (m: MouseEvent) => {
          const now = dir === 'row' ? m.clientX : m.clientY;
          if (Math.abs(now - last) < 2) return;
          onDrag((now - last) / size);
          last = now;
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          document.body.classList.remove('resizing');
        };
        document.body.classList.add('resizing');
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    />
  );
}

function WebPane({ url }: { url: string }) {
  const [key, setKey] = useState(0);
  return (
    <div className="tweb-pane">
      <div className="tweb-bar">
        <button className="btn ghost sm icon" title="Reload" onClick={() => setKey((k) => k + 1)}><Icon name="refresh" size={12} /></button>
        <span className="ellipsis small muted grow">{url.replace(/([?&](tkn|token)=)[^&]+/, '$1…')}</span>
        <button className="btn ghost sm icon" title="Open in the browser" onClick={() => void api.system.openExternal(url)}><Icon name="external" size={12} /></button>
      </div>
      <iframe key={key} src={url} title={url} />
    </div>
  );
}

function NotesPane({ noteKey, hint }: { noteKey: string; hint: string }) {
  const [text, setText] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void api.terminal.notes(noteKey).then((t) => alive && setText(t));
    const off = api.on('term-notes', (k, t) => k === noteKey && setText((cur) => (cur === t ? cur : t)));
    return () => {
      alive = false;
      off();
    };
  }, [noteKey]);
  return (
    <div className="tnotes-pane">
      <div className="small muted">{hint}</div>
      <textarea value={text} placeholder="Commands to remember, context for the programs in these terminals, a to-do…" onChange={(e) => {
        const v = e.target.value;
        setText(v);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void api.terminal.setNotes(noteKey, v), 500);
      }} />
    </div>
  );
}

function SessionsList({ sessions, shown, onOpen, onKill }: { sessions: SessionInfo[]; shown: Set<string>; onOpen: (id: string) => void; onKill: (id: string) => void }) {
  const tt = useTT();
  return (
    <div className="tsessions-list">
      <div className="small muted" style={{ marginBottom: 8 }}>Terminals keep running here even when no window shows them.</div>
      {sessions.map((s) => (
        <div key={s.id} className="tsession-row">
          <span className={`tstatus-dot ${s.exit ? (s.restored ? 'restored' : 'ended') : 'live'}`} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>{s.title}</div>
            <div className="small muted ellipsis">{s.profileName}{s.group ? ` · ${s.group}` : ''}{s.cwd ? ` · ${s.cwd}` : ''}{s.running && s.running !== '…' ? ` · ${tt('running')}: ${s.running}` : ''}</div>
          </div>
          {!shown.has(s.id) ? <button className="btn sm" onClick={() => onOpen(s.id)}>{tt('open')}</button> : <span className="badge">on screen</span>}
          <button className="btn ghost sm icon" title={tt('close')} onClick={() => onKill(s.id)}><Icon name="close" size={12} /></button>
        </div>
      ))}
      {!sessions.length ? <div className="muted small">{tt('empty')}</div> : null}
    </div>
  );
}

function PromptDialog({ title, label, initial, onOk, onCancel }: { title: string; label: string; initial: string; onOk: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} onClose={onCancel}>
      <label className="small muted" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onOk(v)} style={{ width: '100%' }} />
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={() => onOk(v)}>OK</button>
      </div>
    </Modal>
  );
}



function Palette({ settings, onRun, onClose, extra }: { settings: TerminalSettings; onRun: (a: string) => void; onClose: () => void; extra: MenuItem[] }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const items = useMemo(() => {
    const acts = Object.keys(ACTION_NAMES).map((a) => ({ label: ACTION_NAMES[a], kbd: formatCombo(settings.keybindings[a] ?? '', MAC), run: () => onRun(a) }));
    const more = extra.filter((x) => !x.sep).map((x) => ({ label: `New: ${x.label}`, kbd: '', run: () => { onClose(); x.run?.(); } }));
    const all = [...acts, ...more];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((x) => words.every((w) => x.label.toLowerCase().includes(w)));
  }, [q, settings, extra, onRun, onClose]);
  return (
    <div className="palette-back" onMouseDown={onClose}>
      <div className="quick palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="q-input">
          <Icon name="terminal" size={16} />
          <input autoFocus value={q} placeholder="Type an action…" onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === 'Enter') items[i]?.run();
              if (e.key === 'Escape') onClose();
            }} />
        </div>
        <div className="q-results">
          {items.slice(0, 40).map((x, n) => (
            <button key={x.label} className={`q-row ${n === i ? 'on' : ''}`} onMouseEnter={() => setI(n)} onClick={() => x.run()}>
              <span className="grow">{x.label}</span>
              {x.kbd ? <kbd>{x.kbd}</kbd> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
