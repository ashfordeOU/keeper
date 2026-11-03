// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Typed Snippets: abbreviations you type in any app that become your saved
// text. One list with Dictation's spoken snippets: each snippet can be typed,
// said, or both. Placeholders fill in the date, the clipboard and where the
// cursor goes. Apps where it never expands, and whether the keyboard
// listener can run on this computer (and how to let it), are here too.

import { useEffect, useMemo, useState } from 'react';
import { validAbbr } from '../../core/typing/expand';
import type { DeepPartial, Snippet, VoiceSettings } from '../../core/voice/types';
import { api } from '../api';
import { useFeature } from '../features';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/ui';
import { useStore } from '../state';
import '../styles/launcher.css';
import '../voice/voice.css';

const uid = () => Math.random().toString(36).slice(2, 10);
const PLACEHOLDERS: [string, string][] = [
  ['{date}', 'Today’s date'], ['{date iso}', 'Date as 2026-11-03'], ['{date +7d}', 'A week from today'], ['{time}', 'The time now'],
  ['{weekday}', 'Day of the week'], ['{clipboard}', 'What you copied'], ['{cursor}', 'Cursor goes here'],
];

type Status = { on: boolean; how?: string; note?: string; wanted: boolean; platform: string };

export function TypedSnippets() {
  const { settings, updateSettings, toast, go } = useStore();
  const dictationOn = useFeature('dictation');
  const [cfg, setCfg] = useState<VoiceSettings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [edit, setEdit] = useState<Snippet | null>(null);
  const [abbr, setAbbr] = useState('');
  const [text, setText] = useState('');
  const [say, setSay] = useState('');
  const [preview, setPreview] = useState('');
  const [appName, setAppName] = useState('');
  const [q, setQ] = useState('');

  const loadStatus = () => void api.snippets.status().then(setStatus).catch(() => undefined);
  useEffect(() => {
    void api.voice.settings().then(setCfg);
    loadStatus();
    const off = api.on('voice-settings', (s) => { setCfg(s); setTimeout(loadStatus, 400); });
    return () => off();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void api.snippets.preview(text).then(setPreview).catch(() => setPreview(text)), 150);
    return () => clearTimeout(t);
  }, [text]);

  const save = async (patch: DeepPartial<VoiceSettings>) => { setCfg(await api.voice.setSettings(patch)); setTimeout(loadStatus, 600); };
  const all = cfg?.snippets ?? [];
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter((s) => !n || [s.abbr, s.text, s.trigger].some((x) => x?.toLowerCase().includes(n)));
  }, [all, q]);
  const taken = (a: string) => all.some((s) => s.abbr === a && s.id !== edit?.id);
  const abbrOk = validAbbr(abbr.trim()) && !taken(abbr.trim());
  const canSave = !!text && (abbrOk || (!abbr.trim() && !!say.trim()));

  const reset = () => { setEdit(null); setAbbr(''); setText(''); setSay(''); };
  const submit = () => {
    if (!canSave) return;
    const s: Snippet = { id: edit?.id ?? uid(), abbr: abbr.trim() || undefined, text, trigger: say.trim(), uses: edit?.uses };
    void save({ snippets: edit ? all.map((x) => (x.id === edit.id ? s : x)) : [...all, s] }).then(() => toast(edit ? 'Snippet saved' : `Type ${s.abbr ?? s.trigger} anywhere`));
    reset();
  };
  const exclude = settings?.typing.excludeApps ?? [];
  const setExclude = (list: string[]) => void updateSettings({ typing: { ...(settings?.typing ?? { excludeApps: [] }), excludeApps: list } });

  const mac = status?.platform === 'darwin';
  // The "Say" column only when some snippet is said.
  const sayCol = dictationOn && all.some((x) => x.trigger);
  return (
    <div className="page snip-page" data-testid="snippets-page">
      <PageHead title="Typed Snippets" sub="Type a short abbreviation in any app and it becomes your saved text. Keys still reach your apps; nothing you type is kept." />

      {status ? (
        <div className={`card snip-status ${status.on ? 'ok' : status.wanted ? 'warn' : ''}`} role="status" data-testid="snippets-status">
          <Icon name={status.on ? 'check' : status.wanted ? 'warning' : 'info'} size={16} />
          <div className="grow">
            <b>{status.on ? 'Ready in every app' : status.wanted ? 'Not listening yet' : all.some((s) => s.abbr) ? 'Off' : 'Add a snippet to start'}</b>
            <div className="small muted">
              {status.on
                ? `Listening to the keyboard (${status.how}). Password fields are skipped${mac ? ', and macOS hides them anyway' : ''}.`
                : status.note ?? (all.some((s) => s.abbr) ? 'Typed snippets are switched off in Settings → Features.' : 'Snippets with something to type turn the listener on; with none, nothing runs.')}
            </div>
          </div>
          {status.wanted && !status.on ? (
            <>
              {mac ? <button className="btn sm" onClick={() => void api.permissions.openSettings('input')}>Open Input Monitoring</button> : null}
              <button className="btn sm primary" onClick={() => void api.snippets.restart().then(loadStatus)}>Try again</button>
            </>
          ) : null}
        </div>
      ) : null}

      <h2 className="voice-h">{edit ? 'Change the snippet' : 'New snippet'}</h2>
      <div className="card snip-form" data-testid="snippet-form">
        <label htmlFor="snip-abbr">Type</label>
        <div>
          <input id="snip-abbr" className="input" placeholder=";addr" value={abbr} onChange={(e) => setAbbr(e.target.value.replace(/\s/g, ''))} aria-describedby="snip-abbr-help" data-testid="snippet-abbr" />
          <div id="snip-abbr-help" className="small muted">{abbr && taken(abbr.trim()) ? 'Another snippet already uses this.' : '2 to 32 characters, no spaces. Starting with a mark like ; or / keeps it from going off inside a word.'}</div>
        </div>
        <label htmlFor="snip-text">Becomes</label>
        <div>
          <textarea id="snip-text" className="input" placeholder={'12 High Street\nLondon'} value={text} onChange={(e) => setText(e.target.value)} data-testid="snippet-text" />
          <select className="input snip-insert" aria-label="Add a placeholder" value="" onChange={(e) => { const v = e.target.value; if (v) setText((t) => t + v); }}>
            <option value="">Add the date, the clipboard or the cursor…</option>
            {PLACEHOLDERS.map(([p, l]) => <option key={p} value={p}>{l}  {p}</option>)}
          </select>
        </div>
        {dictationOn ? (
          <>
            <label htmlFor="snip-say">Or say</label>
            <div>
              <input id="snip-say" className="input" placeholder="my address (optional)" value={say} onChange={(e) => setSay(e.target.value)} />
              <div className="small muted">Dictation types it when you say this. The same list as Dictation’s snippets.</div>
            </div>
          </>
        ) : null}
        {text ? (
          <>
            <span className="small muted">Looks like</span>
            <div className="snip-preview" aria-live="polite" data-testid="snippet-preview">{preview || ' '}</div>
          </>
        ) : null}
        <span />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" disabled={!canSave} onClick={submit} data-testid="snippet-save">{edit ? 'Save' : 'Add snippet'}</button>
          {edit ? <button className="btn" onClick={reset}>Cancel</button> : null}
          <span className="grow" />
          <button className="btn" onClick={() => void api.snippets.importCsv().then((r) => { if (r) toast(`Added ${r.added} snippet${r.added === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} skipped` : ''}`); })} title="A CSV file: abbreviation, text, and (optionally) what to say">Import from CSV…</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2 className="voice-h grow">Your snippets ({all.length})</h2>
        {all.length > 8 ? <input className="input" style={{ maxWidth: 240 }} placeholder="Find a snippet" aria-label="Find a snippet" value={q} onChange={(e) => setQ(e.target.value)} /> : null}
      </div>
      <div className="card">
        {shown.length ? (
          <table className="snip-table" data-testid="snippets-table">
            <thead><tr><th>Type</th><th>Becomes</th>{sayCol ? <th>Say</th> : null}<th aria-label="Actions" /></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>{s.abbr ? <code>{s.abbr}</code> : <span className="muted small">said only</span>}</td>
                  <td className="snip-text">{s.text.length > 160 ? `${s.text.slice(0, 159)}…` : s.text}</td>
                  {sayCol ? <td className="muted">{s.trigger || '—'}</td> : null}
                  <td style={{ whiteSpace: 'nowrap', width: 72 }}>
                    <button className="btn icon sm ghost" title="Change" aria-label={`Change ${s.abbr ?? s.trigger}`} onClick={() => { setEdit(s); setAbbr(s.abbr ?? ''); setText(s.text); setSay(s.trigger); }}><Icon name="rename" size={12} /></button>
                    <button className="btn icon sm ghost" title="Remove" aria-label={`Remove ${s.abbr ?? s.trigger}`} onClick={() => void save({ snippets: all.filter((x) => x.id !== s.id) })}><Icon name="close" size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty small" style={{ padding: 18 }}>{all.length ? 'No snippet matches.' : 'No snippets yet. Add one above, for example ;sig for your signature.'}</div>}
      </div>

      <details className="card snip-more" data-testid="snippets-exclude">
        <summary>Apps where snippets never expand ({exclude.length})</summary>
        <div className="small muted" style={{ marginBottom: 8 }}>Snippets never expand in these apps, nor in apps Dictation leaves out{' '}<button className="btn sm ghost" onClick={() => go({ name: 'dictation', arg: 'apps' })}>Dictation → Per app</button>.</div>
        <div className="chips" style={{ marginBottom: 8 }}>
          {exclude.map((a) => (
            <span key={a} className="chip">{a}<button className="btn icon sm ghost" aria-label={`Remove ${a}`} onClick={() => setExclude(exclude.filter((x) => x !== a))}><Icon name="close" size={10} /></button></span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ maxWidth: 260 }} placeholder="App name, for example Terminal" aria-label="App to leave out" value={appName} onChange={(e) => setAppName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && appName.trim()) { setExclude([...exclude, appName.trim()]); setAppName(''); } }} />
          <button className="btn" disabled={!appName.trim()} onClick={() => { setExclude([...exclude, appName.trim()]); setAppName(''); }}>Leave out</button>
        </div>
      </details>
      <p className="small muted">Works on macOS (allow Input Monitoring), Windows, and Linux on X11 or with the “input” group; on Wayland without it the system keeps typing private.</p>
    </div>
  );
}
