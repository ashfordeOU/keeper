// SPDX-License-Identifier: AGPL-3.0-or-later
// One terminal on screen. It shows what the session printed so far, then live
// output; sends typing (to one terminal or, when broadcasting, to several);
// marks each command with how it ended; and resizes the program to fit.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal, type IDisposable, type IMarker } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import '@xterm/xterm/css/xterm.css';
import { api } from '../api';
import { quotePath } from '../../core/terminal/profiles';
import { schemeById, xtermTheme } from '../../core/terminal/schemes';
import type { SessionInfo, ShellEvent, TerminalProfile, TerminalSettings } from '../../core/terminal/types';

export interface PaneHandle {
  focus(): void;
  find(text: string, back?: boolean): boolean;
  clearFind(): void;
  clear(): void;
  jumpPrompt(dir: -1 | 1): void;
  fontStep(d: number): void;
  selection(): string;
  paste(text: string): void;
  fit(): void;
}

interface Props {
  session: string;
  profile?: TerminalProfile;
  settings: TerminalSettings;
  active: boolean;
  visible: boolean;
  /** typing goes to these sessions too */
  broadcastTo?: string[];
  onFocus(): void;
  onInfo?(info: SessionInfo): void;
  /** called for every chunk of output (used to spot the address of a web tool starting up) */
  onOutput?(data: string): void;
  onExit?(code: number): void;
  /** paste guard: return false to cancel */
  confirmPaste(text: string): Promise<boolean>;
  restored?: boolean;
  onRestart?(): void;
}

/** The current Keeper theme as terminal colours. */
function keeperTheme(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const bg = v('--bg-sunk', v('--bg', '#14151b'));
  const dark = document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  const base = schemeById(dark ? 'night' : 'day')!;
  return { ...xtermTheme(base), background: bg, foreground: v('--text', base.foreground), cursor: v('--accent', base.cursor), cursorAccent: bg, selectionBackground: `${v('--accent', '#6d6dff')}44` };
}

const MONO = 'ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

export const XTermPane = forwardRef<PaneHandle, Props>(function XTermPane(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const marks = useRef<{ marker: IMarker; exit?: number; started: number; ended?: number }[]>([]);
  const props = useRef(p);
  props.current = p;
  const [status, setStatus] = useState<{ exit?: number; ms?: number } | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => term.current?.focus(),
    find: (text, back) => (back ? search.current?.findPrevious(text, { incremental: false }) : search.current?.findNext(text, { incremental: true })) ?? false,
    clearFind: () => search.current?.clearDecorations(),
    clear: () => {
      term.current?.clear();
      void api.terminal.clear(props.current.session);
    },
    jumpPrompt: (dir) => {
      const t = term.current;
      if (!t) return;
      const top = t.buffer.active.viewportY;
      const lines = marks.current.map((m) => m.marker.line).filter((l) => l >= 0);
      const target = dir < 0 ? [...lines].reverse().find((l) => l < top) : lines.find((l) => l > top);
      if (target !== undefined) t.scrollToLine(target);
    },
    fontStep: (d) => {
      const t = term.current;
      if (!t) return;
      t.options.fontSize = d === 0 ? (props.current.profile?.fontSize ?? 13) : Math.min(32, Math.max(8, (t.options.fontSize ?? 13) + d));
      fit.current?.fit();
    },
    selection: () => term.current?.getSelection() ?? '',
    paste: (text) => void pasteText(text),
    fit: () => fit.current?.fit(),
  }));

  const send = (data: string) => {
    const pp = props.current;
    if (pp.restored) return;
    api.terminal.input(pp.session, data);
    for (const other of pp.broadcastTo ?? []) if (other !== pp.session) api.terminal.input(other, data);
  };

  const pasteText = async (text: string) => {
    if (!text) return;
    const pp = props.current;
    if (pp.settings.pasteGuard && /\r?\n./.test(text.trimEnd()) && !(await pp.confirmPaste(text))) return;
    // Bracketed paste keeps shells from running pasted lines one by one where they support it.
    term.current?.paste(text);
  };

  // Create the terminal once per session.
  useEffect(() => {
    const pp = props.current;
    const prof = pp.profile;
    const scheme = prof?.scheme && prof.scheme !== 'keeper' ? schemeById(prof.scheme) : undefined;
    const t = new Terminal({
      allowProposedApi: true,
      fontFamily: prof?.fontFamily || MONO,
      fontSize: prof?.fontSize ?? 13,
      lineHeight: prof?.lineHeight ?? 1.15,
      cursorStyle: prof?.cursor ?? 'bar',
      cursorBlink: prof?.cursorBlink ?? true,
      scrollback: prof?.scrollback ?? pp.settings.scrollback,
      theme: scheme ? xtermTheme(scheme) : keeperTheme(),
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      drawBoldTextInBrightColors: true,
      smoothScrollDuration: 0,
      convertEol: false,
    });
    const f = new FitAddon();
    const s = new SearchAddon();
    t.loadAddon(f);
    t.loadAddon(s);
    t.loadAddon(new WebLinksAddon((_e, uri) => void api.system.openExternal(uri)));
    const u = new Unicode11Addon();
    t.loadAddon(u);
    t.unicode.activeVersion = '11';
    t.loadAddon(new ClipboardAddon());
    t.open(host.current!);
    term.current = t;
    fit.current = f;
    search.current = s;
    // Pictures printed by programs (sixel and inline-image escape codes), loaded only when needed.
    void import('@xterm/addon-image').then(({ ImageAddon }) => {
      if (term.current === t) t.loadAddon(new ImageAddon({ sixelSupport: true, iipSupport: true }));
    }).catch(() => undefined);
    // GPU drawing is much faster for busy output; the plain renderer takes over if the GPU says no.
    if (pp.settings.webgl) {
      void import('@xterm/addon-webgl').then(({ WebglAddon }) => {
        if (term.current !== t) return;
        try {
          const w = new WebglAddon();
          w.onContextLoss(() => w.dispose());
          t.loadAddon(w);
        } catch {
          /* no WebGL here */
        }
      }).catch(() => undefined);
    }

    const subs: IDisposable[] = [];
    subs.push(t.onData((d) => send(d)));
    subs.push(t.onBinary((d) => send(d)));
    subs.push(t.onResize(({ cols, rows }) => !props.current.restored && api.terminal.resize(props.current.session, cols, rows)));
    subs.push(t.onSelectionChange(() => {
      if (props.current.settings.copyOnSelect) {
        const sel = t.getSelection();
        if (sel) void navigator.clipboard.writeText(sel).catch(() => undefined);
      }
    }));
    t.attachCustomKeyEventHandler((e) => {
      // Let the window's shortcuts (split, new tab…) through; the rest goes to the program.
      if (e.type !== 'keydown') return true;
      const mod = e.metaKey || e.ctrlKey;
      const mac = navigator.platform.toLowerCase().includes('mac');
      if (mac && e.metaKey && e.key.toLowerCase() === 'c' && t.hasSelection()) {
        void navigator.clipboard.writeText(t.getSelection());
        return false;
      }
      if (!mac && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
        void navigator.clipboard.writeText(t.getSelection());
        return false;
      }
      if ((mac && e.metaKey && e.key.toLowerCase() === 'v') || (!mac && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v')) {
        void navigator.clipboard.readText().then((x) => pasteText(x));
        e.preventDefault();
        return false;
      }
      if (mac && e.metaKey) return false;
      if (mod && e.shiftKey) return false;
      return true;
    });

    // Output: buffered until the snapshot arrives, then lined up by offset so nothing repeats or goes missing.
    let ready = false;
    let total = 0;
    const early: { data: string; at: number }[] = [];
    const write = (data: string, at: number) => {
      const end = at + data.length;
      if (end <= total) return;
      const chunk = at < total ? data.slice(total - at) : data;
      total = end;
      t.write(chunk);
      props.current.onOutput?.(chunk);
    };
    const offData = api.on('term-data', (id, data, at) => {
      if (id !== props.current.session) return;
      if (!ready) early.push({ data, at });
      else write(data, at ?? total);
    });
    const offEvent = api.on('term-event', (id, ev: ShellEvent) => {
      if (id !== props.current.session) return;
      if (ev.kind === 'command-start') {
        const marker = t.registerMarker(0);
        if (marker) marks.current.push({ marker, started: Date.now() });
        if (marks.current.length > 500) marks.current.shift()?.marker.dispose();
        setStatus(null);
      } else if (ev.kind === 'command-end') {
        const last = marks.current[marks.current.length - 1];
        if (last && last.ended === undefined) {
          last.ended = Date.now();
          last.exit = ev.exit;
          // A small coloured mark in the margin: green for success, red for failure.
          const deco = t.registerDecoration({ marker: last.marker, x: 0, width: 1, overviewRulerOptions: { color: ev.exit ? '#ff6b7a' : '#7bd88f' } });
          deco?.onRender((el) => {
            el.classList.add('term-mark', ev.exit ? 'bad' : 'good');
            el.title = `${ev.exit ? `Exit ${ev.exit}` : 'Done'} · ${formatMs(last.ended! - last.started)}`;
          });
          setStatus({ exit: ev.exit, ms: last.ended - last.started });
        }
      } else if (ev.kind === 'prompt') {
        const marker = t.registerMarker(0);
        if (marker) marks.current.push({ marker, started: Date.now(), ended: Date.now() });
      }
    });
    const offExit = api.on('term-exit', (id, code) => {
      if (id !== props.current.session) return;
      setExited(code);
      props.current.onExit?.(code);
    });
    let cancelled = false;
    void api.terminal.attach(pp.session).then((r) => {
      if (cancelled) return;
      if (r.data) t.write(r.data);
      total = r.total ?? r.data.length;
      ready = true;
      for (const e of early.splice(0)) write(e.data, e.at);
      if (r.info.exit) setExited(r.info.exit.code);
      props.current.onInfo?.(r.info);
      f.fit();
      if (!props.current.restored) api.terminal.resize(pp.session, t.cols, t.rows);
    }).catch((e) => t.write(`\r\n\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m\r\n`));

    return () => {
      cancelled = true;
      offData();
      offEvent();
      offExit();
      for (const d of subs) d.dispose();
      api.terminal.detach(pp.session);
      t.dispose();
      term.current = null;
    };
  }, [p.session]);

  // Fit to the pane whenever its size changes (only while it is on screen).
  useEffect(() => {
    if (!p.visible || !host.current) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        try {
          fit.current?.fit();
        } catch {
          /* not laid out yet */
        }
      });
    });
    ro.observe(host.current);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [p.visible]);

  useEffect(() => {
    if (p.active && p.visible) term.current?.focus();
  }, [p.active, p.visible]);

  // Theme changes (profile scheme or Keeper's own theme).
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    const apply = () => {
      const scheme = p.profile?.scheme && p.profile.scheme !== 'keeper' ? schemeById(p.profile.scheme) : undefined;
      t.options.theme = scheme ? xtermTheme(scheme) : keeperTheme();
    };
    apply();
    if (p.profile?.scheme && p.profile.scheme !== 'keeper') return;
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-look', 'style', 'class'] });
    return () => mo.disconnect();
  }, [p.profile?.scheme]);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f)).filter((x): x is string => !!x);
    if (!files.length) return;
    const kind = await api.terminal.shellKind(p.profile?.id);
    send(files.map((f) => quotePath(f, kind)).join(' ') + ' ');
    term.current?.focus();
  };

  return (
    <div
      className={`term-pane ${p.active ? 'active' : ''} ${dragOver ? 'drop' : ''}`}
      onMouseDown={() => p.onFocus()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="term-host" ref={host} />
      {p.broadcastTo && p.broadcastTo.length > 1 ? <div className="term-badge broadcast" title="Typing goes to every pane in this tab">⇶</div> : null}
      {status && status.exit !== undefined ? <div className={`term-badge exit ${status.exit ? 'bad' : 'good'}`}>{status.exit ? `✕ ${status.exit}` : '✓'} · {formatMs(status.ms ?? 0)}</div> : null}
      {p.restored || exited !== null ? (
        <div className="term-ended">
          <span>{p.restored ? 'Restored from last time — nothing is running.' : `The program ended${exited ? ` (exit ${exited})` : ''}.`}</span>
          {p.onRestart ? <button className="btn sm" onClick={p.onRestart}>Start again here</button> : null}
        </div>
      ) : null}
    </div>
  );
});

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`;
}
