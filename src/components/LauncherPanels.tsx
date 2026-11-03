// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings panels for Quick Search as a launcher (saved links, your own
// commands), the selection bar, and the apps whose copies are never kept.

import { useState } from 'react';
import { linkAllowed, type QuickLink, type UserCommand } from '../../core/launcher/links';
import { SELECTION_ACTIONS, type SelectionActionId } from '../../core/selection';
import { useStore } from '../state';
import { Icon } from './Icon';
import '../styles/launcher.css';

const uid = () => Math.random().toString(36).slice(2, 10);

export function LauncherLinksPanel() {
  const { settings, updateSettings } = useStore();
  const [kw, setKw] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  if (!settings) return null;
  const ls = settings.launcher;
  const setLinks = (links: QuickLink[]) => void updateSettings({ launcher: { ...ls, links } });
  const ok = kw.trim() && !/\s/.test(kw.trim()) && linkAllowed(url.trim()) && !ls.links.some((l) => l.keyword.toLowerCase() === kw.trim().toLowerCase());
  return (
    <div data-testid="launcher-links">
      <table className="snip-table" style={{ width: '100%' }}>
        <thead><tr><th>Type</th><th>Name</th><th>Opens</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {ls.links.map((l) => (
            <tr key={l.id}>
              <td><code>{l.keyword}</code></td>
              <td>{l.name}</td>
              <td className="small muted" style={{ wordBreak: 'break-all' }}>{l.url}</td>
              <td style={{ width: 32 }}><button className="btn icon sm ghost" aria-label={`Remove ${l.name}`} title="Remove" onClick={() => setLinks(ls.links.filter((x) => x.id !== l.id))}><Icon name="close" size={12} /></button></td>
            </tr>
          ))}
          <tr>
            <td><input className="input" aria-label="Word to type" placeholder="docs" value={kw} onChange={(e) => setKw(e.target.value)} style={{ width: 90 }} /></td>
            <td><input className="input" aria-label="Name" placeholder="Team docs" value={name} onChange={(e) => setName(e.target.value)} /></td>
            <td><input className="input" aria-label="Address" placeholder="https://example.com/search?q={query}" value={url} onChange={(e) => setUrl(e.target.value)} /></td>
            <td><button className="btn icon sm" aria-label="Add the link" title="Add" disabled={!ok} onClick={() => { setLinks([...ls.links, { id: uid(), keyword: kw.trim(), name: name.trim() || kw.trim(), url: url.trim() }]); setKw(''); setName(''); setUrl(''); }}><Icon name="plus" size={12} /></button></td>
          </tr>
        </tbody>
      </table>
      <div className="small muted" style={{ marginTop: 6 }}>Put <code>{'{query}'}</code> where the words you type after the word go. Web, mail and keeper:// addresses only.</div>
    </div>
  );
}

export function LauncherCommandsPanel() {
  const { settings, updateSettings } = useStore();
  const [name, setName] = useState('');
  const [kw, setKw] = useState('');
  const [cmd, setCmd] = useState('');
  const [output, setOutput] = useState<UserCommand['output']>('show');
  if (!settings) return null;
  const ls = settings.launcher;
  const setCmds = (commands: UserCommand[]) => void updateSettings({ launcher: { ...ls, commands } });
  return (
    <div data-testid="launcher-commands">
      {ls.commands.length ? (
        <table className="snip-table" style={{ width: '100%', marginBottom: 8 }}>
          <thead><tr><th>Name</th><th>Type</th><th>Runs</th><th>Ask first</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {ls.commands.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.keyword ? <code>{c.keyword}</code> : '—'}</td>
                <td className="small" style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>{c.command}</td>
                <td><input type="checkbox" aria-label={`Ask before running ${c.name}`} checked={c.confirm} onChange={(e) => setCmds(ls.commands.map((x) => (x.id === c.id ? { ...x, confirm: e.target.checked } : x)))} /></td>
                <td style={{ width: 32 }}><button className="btn icon sm ghost" aria-label={`Remove ${c.name}`} title="Remove" onClick={() => setCmds(ls.commands.filter((x) => x.id !== c.id))}><Icon name="close" size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8 }}>
        <input className="input" aria-label="Command name" placeholder="Name, for example Restart the printer" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="Word to type (optional)" placeholder="Word (optional)" value={kw} onChange={(e) => setKw(e.target.value.replace(/\s/g, ''))} />
        <input className="input" aria-label="What it runs" style={{ fontFamily: 'var(--mono)' }} placeholder={'say {query}'} value={cmd} onChange={(e) => setCmd(e.target.value)} />
        <select className="input" aria-label="What happens with what it prints" value={output} onChange={(e) => setOutput(e.target.value as UserCommand['output'])}>
          <option value="show">Show it</option>
          <option value="copy">Copy it</option>
          <option value="none">Nothing</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <span className="small muted grow">Runs in your home folder with the system’s shell. <code>{'{query}'}</code> is what you type after the word, passed as one quoted piece.</span>
        <button className="btn" disabled={!name.trim() || !cmd.trim()} onClick={() => { setCmds([...ls.commands, { id: uid(), name: name.trim(), keyword: kw.trim() || undefined, command: cmd, confirm: true, output }]); setName(''); setKw(''); setCmd(''); }}>Add command</button>
      </div>
    </div>
  );
}

const LANGS = ['', 'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Turkish', 'Russian', 'Ukrainian', 'Arabic', 'Hebrew', 'Hindi', 'Chinese', 'Japanese', 'Korean', 'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Greek', 'Czech'];

export function SelectionBarPanel() {
  const { settings, updateSettings } = useStore();
  if (!settings) return null;
  const sel = settings.selection;
  const set = (patch: Partial<typeof sel>) => void updateSettings({ selection: { ...sel, ...patch } });
  const toggle = (id: SelectionActionId, on: boolean) => set({ actions: on ? SELECTION_ACTIONS.map((a) => a.id).filter((a) => a === id || sel.actions.includes(a)) : sel.actions.filter((a) => a !== id) });
  return (
    <div data-testid="selection-settings" style={{ display: 'grid', gap: 10 }}>
      <div role="group" aria-label="Buttons on the bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {SELECTION_ACTIONS.map((a) => (
          <label key={a.id} className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={sel.actions.includes(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} /> {a.label}{a.ai ? ' (AI)' : ''}
          </label>
        ))}
      </div>
      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        Translate into
        <select className="input" style={{ width: 200 }} value={sel.language} onChange={(e) => set({ language: e.target.value })}>
          {LANGS.map((l) => <option key={l} value={l}>{l || 'This computer’s language'}</option>)}
        </select>
      </label>
      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        Search with
        <input className="input" defaultValue={sel.searchUrl} aria-label="Search address" onBlur={(e) => { if (/^https?:\/\/.*\{query\}/.test(e.target.value)) set({ searchUrl: e.target.value.trim() }); }} />
      </label>
    </div>
  );
}

export function ClipIgnorePanel() {
  const { settings, updateSettings } = useStore();
  const [app, setApp] = useState('');
  if (!settings) return null;
  const isl = settings.island;
  const list = isl.clipIgnoreApps;
  const set = (next: string[]) => void updateSettings({ island: { ...isl, clipIgnoreApps: next } });
  const add = () => { const a = app.trim(); if (a && !list.some((x) => x.toLowerCase() === a.toLowerCase())) set([...list, a]); setApp(''); };
  return (
    <div data-testid="clip-ignore">
      <div className="chips" style={{ marginBottom: 8 }}>
        {list.map((a) => <span key={a} className="chip">{a}<button className="btn icon sm ghost" aria-label={`Keep copies from ${a} again`} onClick={() => set(list.filter((x) => x !== a))}><Icon name="close" size={10} /></button></span>)}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" style={{ maxWidth: 240 }} aria-label="App name" placeholder="App name" value={app} onChange={(e) => setApp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn" disabled={!app.trim()} onClick={add}>Never keep</button>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Copies that apps mark as secret, and text that looks like a password, are never kept anyway. In clipboard history, right-click a clip to leave out its app.</div>
    </div>
  );
}
