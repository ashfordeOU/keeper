// SPDX-License-Identifier: AGPL-3.0-or-later
// The command palette: jump anywhere or run any action by typing a few letters.

import { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '../../core/themes';
import { api } from '../api';
import { themePatch, toggleThemePatch } from '../theme';
import { mod, shift, useStore, type Route } from '../state';
import { Icon } from './Icon';
import '../styles/screens-a.css';

interface Command {
  id: string;
  label: string;
  group: 'Go to' | 'Actions' | 'Search';
  icon: string;
  kbd?: string;
  keywords?: string;
  /** listed only once something is typed (e.g. one entry per theme) */
  typed?: boolean;
  run: () => unknown;
}

/** Subsequence match with a bonus for word starts; -1 when it does not match. */
export function fuzzyScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    score += at === 0 || /[\s\-/]/.test(t[at - 1]) ? 5 : 1;
    score -= Math.min(3, at - ti);
    ti = at + 1;
  }
  return score;
}

const PAGES: [Route, string, string, string?][] = [
  [{ name: 'home' }, 'Home', 'home'],
  [{ name: 'recents' }, 'Recents', 'clock'],
  [{ name: 'downloads' }, 'Downloaded From', 'down', `${shift}${mod}J`],
  [{ name: 'library', arg: 'image' }, 'Images', 'image'],
  [{ name: 'library', arg: 'video' }, 'Videos', 'video'],
  [{ name: 'library', arg: 'audio' }, 'Music', 'audio'],
  [{ name: 'library', arg: 'document' }, 'Documents', 'document'],
  [{ name: 'library', arg: 'archive' }, 'Archives', 'archive'],
  [{ name: 'library', arg: 'installer' }, 'Installers', 'installer'],
  [{ name: 'library', arg: 'app' }, 'Apps', 'app'],
  [{ name: 'screenshots' }, 'Screenshots', 'screenshot'],
  [{ name: 'cleanup' }, 'Clean Up', 'broom', `${shift}${mod}K`],
  [{ name: 'duplicates' }, 'Duplicates', 'dupes', `${shift}${mod}D`],
  [{ name: 'space' }, 'Space Map', 'map'],
  [{ name: 'large' }, 'Large Files', 'weight'],
  [{ name: 'rules' }, 'Automations', 'rules'],
  [{ name: 'health' }, 'Health', 'bolt'],
  [{ name: 'startup' }, 'Startup Items', 'power'],
  [{ name: 'apps' }, 'Applications', 'app'],
  [{ name: 'protection' }, 'Protection', 'shield'],
  [{ name: 'assistant' }, 'Assistant', 'assistant'],
  [{ name: 'tools' }, 'Toolbox', 'terminal'],
  [{ name: 'island' }, 'Island', 'island'],
  [{ name: 'history' }, 'History', 'history'],
  [{ name: 'settings' }, 'Settings', 'settings', `${mod},`],
];

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [text, setText] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => [
    ...PAGES.map(([route, label, icon, kbd]) => ({ id: `go-${label}`, label, group: 'Go to' as const, icon, kbd, run: () => store.go(route) })),
    { id: 'browse', label: 'Browse Home Folder', group: 'Go to', icon: 'folder', run: () => store.go({ name: 'browse', arg: store.info?.home }) },
    { id: 'rescan', label: 'Rescan Library', group: 'Actions', icon: 'refresh', keywords: 'index refresh reload', run: async () => { await api.library.rescan(); store.toast('Reading your folders…'); } },
    { id: 'look', label: 'Switch Theme (last two used)', group: 'Actions', icon: 'palette', kbd: `${mod}${shift}T`, keywords: 'theme look colour color playful minimal', run: () => store.settings && store.updateSettings(toggleThemePatch(store.settings)) },
    ...THEMES.map((t) => ({ id: `theme-${t.id}`, label: `Theme: ${t.name}`, group: 'Actions' as const, icon: 'palette', typed: true, keywords: `theme look ${t.tags.join(' ')}`, run: () => store.settings && store.updateSettings(themePatch(store.settings, t.id)) })),
    { id: 'appearance', label: 'Toggle Dark Mode', group: 'Actions', icon: 'moon', keywords: 'theme light appearance', run: () => store.settings && store.updateSettings({ appearance: store.settings.appearance === 'dark' ? 'light' : 'dark' }) },
    { id: 'view', label: store.view === 'grid' ? 'Show as List' : 'Show as Grid', group: 'Actions', icon: store.view === 'grid' ? 'list' : 'grid', kbd: store.view === 'grid' ? `${mod}2` : `${mod}1`, run: () => store.setView(store.view === 'grid' ? 'list' : 'grid') },
    { id: 'inspector', label: store.inspector ? 'Hide Inspector' : 'Show Inspector', group: 'Actions', icon: 'info', kbd: `${mod}I`, run: () => store.setInspector(!store.inspector) },
    { id: 'awake', label: 'Keep Awake for 1 Hour', group: 'Actions', icon: 'coffee', keywords: 'caffeine sleep stay awake', run: async () => { await api.island.keepAwake(true, { minutes: 60 }); store.toast('Staying awake for the next hour'); } },
    { id: 'awake-off', label: 'Allow Sleep Again', group: 'Actions', icon: 'moon', keywords: 'keep awake stop', run: async () => { await api.island.keepAwake(false); store.toast('Your computer can sleep again'); } },
    { id: 'capture', label: 'Copy Text from Screen Area', group: 'Actions', icon: 'text', keywords: 'ocr capture scan qr barcode', run: async () => {
      const r = await api.capture.text();
      if (!r) return;
      const out = r.code ?? r.text;
      if (out) { await api.files.copyText(out); store.toast(r.code ? 'QR code copied' : 'Text copied'); } else store.toast('No text found in that area');
    } },
    { id: 'clip-ocr', label: 'Copy Text from Image on Clipboard', group: 'Actions', icon: 'clipboard', keywords: 'ocr', run: async () => {
      const r = await api.capture.clipboardImage();
      if (r?.text || r?.code) { await api.files.copyText(r.code ?? r.text); store.toast('Text copied'); } else store.toast('No image with text on the clipboard');
    } },
    { id: 'focus', label: 'Start a 25-Minute Focus', group: 'Actions', icon: 'timer', keywords: 'pomodoro timer', run: async () => { await api.island.focus('start', 25); store.toast('Focus started — see you in 25 minutes'); } },
    { id: 'focus-stop', label: 'Stop Focus Timer', group: 'Actions', icon: 'timer', run: async () => { await api.island.focus('stop'); } },
    { id: 'present', label: 'Presentation Mode', group: 'Actions', icon: 'eye', keywords: 'hide desktop do not disturb', run: async () => { const on = await api.island.presentation(true); store.toast(on ? 'Presentation mode on' : 'Presentation mode is not available here'); } },
    { id: 'present-off', label: 'End Presentation Mode', group: 'Actions', icon: 'eye', run: async () => { await api.island.presentation(false); } },
    { id: 'eject', label: 'Eject All Disks', group: 'Actions', icon: 'arrowUp', keywords: 'unmount drives usb', run: async () => { const r = await api.system.ejectAll(); store.toast(r.ejected.length ? `Ejected ${r.ejected.join(', ')}` : 'No disks to eject'); } },
    { id: 'shelf-clear', label: 'Clear the Shelf', group: 'Actions', icon: 'island', run: async () => { await api.island.clearShelf(); } },
  ], [store]);

  const looksLikeSearch = text.trim().length > 1;
  const results = useMemo(() => {
    const q = text.trim();
    const scored = commands
      .map((c) => ({ c, s: q ? Math.max(fuzzyScore(c.label, q), fuzzyScore(c.keywords ?? '', q) - 10) : 0 }))
      .filter((x) => x.s >= 0 && (q || !x.c.typed))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    const search: Command[] = looksLikeSearch ? [{ id: 'search', label: `Search files for “${q}”`, group: 'Search', icon: 'search', kbd: '↩', run: () => store.go({ name: 'search', q }) }] : [];
    // A strong command match goes first; otherwise searching files does.
    const commandFirst = /^(theme|look)\b/i.test(q) && scored.some((c) => c.id.startsWith('theme-'));
    return q && scored.length && (commandFirst || fuzzyScore(scored[0].label, q) >= 90) ? [...scored, ...search] : [...search, ...scored];
  }, [commands, text, looksLikeSearch, store]);

  useEffect(() => setIndex(0), [text]);
  useEffect(() => {
    listRef.current?.querySelector('.q-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    void c.run();
  };

  return (
    <div className="palette-back" onMouseDown={onClose}>
      <div className="quick palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="q-input">
          <Icon name="sparkle" size={18} />
          <input
            autoFocus
            value={text}
            placeholder="Type a command, a page, or what you are looking for…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') run(results[index]);
            }}
          />
        </div>
        <div className="q-results" ref={listRef}>
          {results.map((c, i) => (
            <div key={c.id}>
              {i === 0 || results[i - 1].group !== c.group ? <div className="group">{c.group}</div> : null}
              <div className={`q-row ${i === index ? 'on' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
                <Icon name={c.icon} size={15} />
                <span className="ellipsis">{c.label}</span>
                {c.kbd ? <span className="kbd">{c.kbd}</span> : null}
              </div>
            </div>
          ))}
          {!results.length ? <div className="empty small">No matching command</div> : null}
        </div>
        <div className="q-foot"><span>↑↓ to move</span><span>↩ to run</span><span>esc to close</span></div>
      </div>
    </div>
  );
}
