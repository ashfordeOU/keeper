// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Settings → AI & Brain: what Keeper has read, meaning search, which AI to use,
// what AIs may see, and connecting other AI apps to Keeper.

import { useEffect, useState } from 'react';
import type { ConnectionInfo, McpAppInfo, ServerInfo } from '../../core/api-brain';
import type { BrainStatus } from '../../core/brain-contract';
import type { AiConnection, BrainSettings } from '../../core/brain/config';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { Row } from '../screens/IslandSettings';
import { useAsync, useStore } from '../state';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import '../styles/brain.css';

export function useBrainStatus(): BrainStatus | null {
  const [s, setS] = useState<BrainStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void api.brain.status().then((x) => alive && setS(x));
    const off = api.on('brain-status', (x) => alive && setS(x));
    const h = setInterval(() => void api.brain.status().then((x) => alive && setS(x)), 5000);
    return () => { alive = false; off(); clearInterval(h); };
  }, []);
  return s;
}

const VIS: { id: BrainSettings['visibility']; label: string; desc: string }[] = [
  { id: 'names', label: 'Names only', desc: 'File names, folders, sizes and dates. Nothing inside files.' },
  { id: 'snippets', label: 'Matching passages', desc: 'Plus the short passages that matched, and up to a page of a file the AI opens.' },
  { id: 'full', label: 'Whole files', desc: 'The AI can read files it found, page by page.' },
];

function StatusCard({ st }: { st: BrainStatus | null }) {
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const vecDone = st.embedded + st.pending ? st.embedded / (st.embedded + st.pending) : 1;
  const read = st.files ? Math.min(1, (st.indexed ?? st.files) / st.files) : 1;
  return (
    <div className="brain-stats">
      <div><b>{st.files.toLocaleString()}</b><span>files known</span></div>
      <div><b>{st.withText.toLocaleString()}</b><span>with text read</span></div>
      <div><b>{(st.passages ?? 0).toLocaleString()}</b><span>passages</span></div>
      <div><b>{st.semantic === 'ready' ? st.embedded.toLocaleString() : '—'}</b><span>understood by meaning</span></div>
      <div className="brain-progress">
        {read < 1 ? <><div className="small muted">Reading files… {Math.round(read * 100)}%</div><div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(read * 100) || 0)}><i style={{ width: `${read * 100}%` }} /></div></> : null}
        {st.semantic === 'ready' && st.pending ? <><div className="small muted">Building meaning search… {Math.round(vecDone * 100)}% {st.message ? `· ${st.message}` : ''}</div><div className="progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(vecDone * 100) || 0)}><i style={{ width: `${vecDone * 100}%` }} /></div></> : null}
        {read >= 1 && !(st.semantic === 'ready' && st.pending) ? <div className="small muted"><Icon name="check" size={12} /> Up to date{st.updatedAt ? ` · ${relativeTime(st.updatedAt)}` : ''}</div> : null}
      </div>
      <button className="btn sm ghost" disabled={busy} title="Read every file again from scratch" onClick={async () => { setBusy(true); await api.brain.rebuild(); setBusy(false); }}><Icon name="refresh" size={12} /> Rebuild</button>
    </div>
  );
}

function ConnectionRow({ c, active, onUse, onChange, onRemove }: { c: ConnectionInfo; active: boolean; onUse: () => void; onChange: (c: AiConnection) => void; onRemove?: () => void }) {
  const { toast } = useStore();
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'busy' | null>(null);
  const [open, setOpen] = useState(active);
  return (
    <div className={`conn ${active ? 'on' : ''}`}>
      <div className="conn-head">
        <input type="radio" name="ai-active" checked={active} onChange={onUse} aria-label={`Use ${c.label}`} />
        <button className="conn-name" onClick={() => setOpen(!open)}>
          <b>{c.label}</b> <span className="muted small">{c.model || 'default model'}</span>
        </button>
        <span className={`badge ${c.local ? 'ok' : ''}`}>{c.local ? 'On this computer' : 'Internet'}</span>
        {c.needsKey && !c.hasKey ? <span className="badge warn">Needs a key</span> : null}
        <button className="btn ghost sm icon" onClick={() => setOpen(!open)} aria-label="Details"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} /></button>
      </div>
      {open ? (
        <div className="conn-body">
          {c.kind !== 'platform' ? (
            <label className="field"><span>Model</span><input className="input" defaultValue={c.model} onBlur={(e) => e.target.value.trim() !== c.model && onChange({ ...c, model: e.target.value.trim() })} /></label>
          ) : null}
          {c.kind === 'openai-compatible' || c.kind === 'ollama' ? (
            <label className="field"><span>Address</span><input className="input" defaultValue={c.baseUrl} placeholder="http://127.0.0.1:1234/v1" onBlur={(e) => e.target.value.trim() !== c.baseUrl && onChange({ ...c, baseUrl: e.target.value.trim() })} /></label>
          ) : null}
          {c.needsKey ? (
            <label className="field"><span>API key</span>
              <span className="row" style={{ gap: 6 }}>
                <input className="input" type="password" placeholder={c.hasKey ? 'Saved — paste to replace' : 'Paste your key'} value={key} onChange={(e) => setKey(e.target.value)} />
                <button className="btn sm" disabled={!key} onClick={async () => { const ok = await api.settings.setSecret(c.id, key); setKey(''); toast(ok ? 'Key saved, encrypted by your system keychain' : 'Could not save the key securely on this system'); onChange(c); }}>Save</button>
              </span>
            </label>
          ) : null}
          {c.kind === 'openai-compatible' || c.kind === 'ollama' ? (
            <label className="field inline"><Toggle on={c.tools !== false} onChange={(v) => onChange({ ...c, tools: v })} /> <span>Model can use tools (turn off for small local models; Keeper then looks things up first)</span></label>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" disabled={test === 'busy'} onClick={async () => { setTest('busy'); setTest(await api.brain.testConnection(c.id)); }}>{test === 'busy' ? <div className="spinner" /> : <Icon name="bolt" size={12} />} Test</button>
            {test && test !== 'busy' ? <span className={`small ${test.ok ? '' : 'danger-text'}`}>{test.message}</span> : null}
            <span className="grow" />
            {onRemove ? <button className="btn ghost sm" onClick={onRemove}><Icon name="trash" size={12} /> Remove</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddConnection({ onAdd, kinds, presets }: { onAdd: (c: AiConnection) => void; kinds: { kind: string; label: string; available: boolean }[]; presets: { id: string; label: string; baseUrl: string; local?: boolean }[] }) {
  const [pick, setPick] = useState('');
  const platform = kinds.find((k) => k.kind === 'platform');
  const add = () => {
    const id = `${pick}-${Date.now().toString(36)}`;
    if (pick === 'platform' && platform) onAdd({ id, kind: 'platform', label: platform.label, model: 'on-device' });
    else if (pick === 'custom') onAdd({ id, kind: 'openai-compatible', label: 'Custom (OpenAI-compatible)', model: '', baseUrl: 'http://127.0.0.1:8080/v1' });
    else {
      const p = presets.find((x) => x.id === pick);
      if (p) onAdd({ id, kind: p.id === 'openai' ? 'openai' : 'openai-compatible', label: p.label, model: '', baseUrl: p.baseUrl });
    }
    setPick('');
  };
  return (
    <div className="row" style={{ gap: 8, padding: '10px 14px' }}>
      <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 320 }}>
        <option value="">Add an AI…</option>
        {platform ? <option value="platform" disabled={!platform.available}>{platform.label}{platform.available ? '' : ' (not available here)'}</option> : null}
        {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        <option value="custom">Other service that speaks the OpenAI format…</option>
      </select>
      <button className="btn sm" disabled={!pick} onClick={add}><Icon name="plus" size={12} /> Add</button>
    </div>
  );
}

function AppsCard() {
  const { toast } = useStore();
  const apps = useAsync(() => api.brain.apps(), []);
  const server = useAsync(() => api.brain.server(), []);
  const [confirm, setConfirm] = useState<{ app: McpAppInfo; on: boolean } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const copy = (t: string, what: string) => { void navigator.clipboard.writeText(t); toast(`${what} copied`); };
  const info: ServerInfo | undefined = server.data;
  return (
    <>
      <div className="apps">
        {(apps.data ?? []).map((a) => (
          <div key={a.id} className="app-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{a.label}</div>
              <div className="small muted ellipsis" title={a.file}>{a.connected ? 'Connected — can search and read through Keeper' : a.installed ? 'Installed' : 'Not found on this computer'}</div>
            </div>
            {a.connected
              ? <button className="btn sm" onClick={() => setConfirm({ app: a, on: false })}>Disconnect</button>
              : <button className="btn sm primary" disabled={!a.installed} onClick={() => setConfirm({ app: a, on: true })}>Connect</button>}
          </div>
        ))}
      </div>
      {info ? (
        <div className="snippets">
          <div className="small muted" style={{ margin: '4px 0 6px' }}>For other AI apps, editors and agents (the operating system's agent hosts included), use Keeper's MCP server:</div>
          {info.snippets.map((s) => (
            <div key={s.id} className="snippet">
              <div className="row" style={{ justifyContent: 'space-between' }}><span className="small" style={{ fontWeight: 600 }}>{s.label}</span><button className="btn ghost sm" onClick={() => copy(s.text, s.label)}><Icon name="copy" size={12} /> Copy</button></div>
              <pre>{s.text}</pre>
            </div>
          ))}
          <div className="small muted">Your access token for the local API: <code>{showToken ? info.token : '••••••••••••'}</code> <button className="link-like" onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide' : 'Show'}</button> · <button className="link-like" onClick={() => copy(info.token, 'Token')}>Copy</button></div>
        </div>
      ) : null}
      {confirm ? (
        <Modal title={confirm.on ? `Connect ${confirm.app.label} to Keeper?` : `Disconnect ${confirm.app.label}?`} onClose={() => setConfirm(null)}>
          <p>{confirm.on
            ? <>Keeper will add itself to this settings file. Everything else in it stays as it is, and a copy of the current file is saved next to it first.</>
            : <>Keeper will remove itself from this settings file and keep a copy of the current file next to it.</>}</p>
          <pre className="snippet-path">{confirm.app.file}</pre>
          {confirm.on ? <p className="small muted">{confirm.app.label} will be able to search your library and read the files Keeper shows it, within your “What AIs may see” choice. It cannot move or delete anything.</p> : null}
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => { const r = await api.brain.setAppConnected(confirm.app.id, confirm.on); toast(r.message); setConfirm(null); apps.reload(); }}>{confirm.on ? 'Connect' : 'Disconnect'}</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function BrainSettingsPanel() {
  const { settings: s, updateSettings, toast } = useStore();
  const st = useBrainStatus();
  const conns = useAsync(() => api.brain.connections(), [s?.brain]);
  const size = useAsync(() => api.brain.modelSize(), []);
  if (!s) return null;
  const b = s.brain;
  const set = (patch: Partial<BrainSettings>) => void updateSettings({ brain: { ...b, ...patch } });
  const setConn = (c: AiConnection) => set({ connections: b.connections.map((x) => (x.id === c.id ? { id: c.id, kind: c.kind, label: c.label, model: c.model, baseUrl: c.baseUrl, tools: c.tools, contextTokens: c.contextTokens } : x)) });
  const sem = st?.semantic ?? (b.semantic ? 'ready' : 'off');
  return (
    <div className="brain-panel">
      <div className="brain-intro">
        <Icon name="sparkle" size={18} />
        <div>
          Keeper reads the text inside your documents, PDFs, e-mails, code and screenshots once, on this computer, and keeps an index of it.
          Any AI you use — here, or in another app — searches that index instead of your disk, so answers are quick and grounded in your files.
        </div>
      </div>
      <StatusCard st={st} />

      <Row title="Read text inside files" desc="Builds the passage index. Excluded folders are never read.">
        <Toggle on={b.enabled} onChange={(v) => set({ enabled: v })} />
      </Row>
      <Row
        title="Search by meaning"
        desc={sem === 'downloading'
          ? `Downloading the model… ${Math.round((st?.download ?? 0) * 100)}%`
          : sem === 'unavailable'
            ? <span className="danger-text">{st?.message ?? 'Not available on this computer'}</span>
            : <>Finds files by what they are about, not just the exact words (“money back when I move out” finds the deposit in a lease), in about 100 languages. A small model that runs on this computer{size.data ? ` (${formatBytes(size.data)} download, once)` : ''}.</>}
      >
        {sem === 'downloading' ? <div className="spinner" /> : <Toggle on={b.semantic && sem !== 'unavailable'} onChange={(v) => void api.brain.setSemantic(v)} />}
      </Row>
      {b.semantic ? (
        <Row title="Pause on battery" desc="Building meaning search waits until the computer is plugged in.">
          <Toggle on={b.pauseOnBattery} onChange={(v) => set({ pauseOnBattery: v })} />
        </Row>
      ) : null}

      <h3 className="brain-h">Your AI</h3>
      <div className="conns">
        {(conns.data?.connections ?? []).map((c) => (
          <ConnectionRow
            key={c.id}
            c={c}
            active={b.active === c.id}
            onUse={() => set({ active: c.id })}
            onChange={(n) => { setConn(n); conns.reload(); }}
            onRemove={['anthropic', 'openai', 'ollama'].includes(c.id) ? undefined : () => set({ connections: b.connections.filter((x) => x.id !== c.id), active: b.active === c.id ? 'anthropic' : b.active })}
          />
        ))}
        {conns.data ? <AddConnection kinds={conns.data.kinds} presets={conns.data.presets} onAdd={(c) => { set({ connections: [...b.connections, c], active: c.id }); toast(`${c.label} added`); }} /> : null}
      </div>

      <h3 className="brain-h">What AIs may see</h3>
      <div className="vis">
        {VIS.map((v) => (
          <label key={v.id} className={`update-mode ${b.visibility === v.id ? 'on' : ''}`}>
            <input type="radio" name="vis" checked={b.visibility === v.id} onChange={() => set({ visibility: v.id })} />
            <div><div className="update-mode-title">{v.label}</div><div className="small muted">{v.desc}</div></div>
          </label>
        ))}
      </div>
      <Row title="Only use AIs on this computer" desc="Nothing about your files leaves this computer, whichever AI is chosen.">
        <Toggle on={b.localOnly} onChange={(v) => set({ localOnly: v })} />
      </Row>
      <Row title="Blank out secrets" desc="Passwords, API keys, private keys, card and bank numbers are always removed before text goes to an AI on the internet. Turn this on to remove them for local AIs too.">
        <Toggle on={b.redactAlways} onChange={(v) => set({ redactAlways: v })} />
      </Row>

      <h3 className="brain-h">Use Keeper from other AI apps</h3>
      <AppsCard />
      <Row title="Blank out secrets for connected apps" desc="Recommended: most AI apps send what they read to the internet.">
        <Toggle on={b.mcpRedact} onChange={(v) => set({ mcpRedact: v })} />
      </Row>
      <Row title="Local API" desc="Serves search, read and ask (and MCP over HTTP) on 127.0.0.1 only, with your access token. Off unless you need it.">
        <Toggle on={b.http} onChange={(v) => set({ http: v })} />
      </Row>
    </div>
  );
}
