// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// AI agents: connect any agent or AI app to Keeper, start agents in a folder
// with their own accounts, choose what they may do, add AI services and see
// what they cost, write skills, serve other tools through the model gateway,
// and (if wanted) let Keeper learn habits privately and suggest automations.

import { AbilitiesPanel, MemoryPanel, PersonasPanel, SchedulesPanel, TeamsPanel } from '../components/AbilitiesPanels';
import { useEffect, useMemo, useState } from 'react';
import type { ActionInfo, AuditItem, GatewayInfo, SkillInfo } from '../../core/api-agents';
import type { McpAppInfo } from '../../core/api-brain';
import { normalizeAgentSettings, type AgentSettings } from '../../core/agents-config';
import type { Permission } from '../../core/brain/actions';
import type { CatalogEntry } from '../../core/brain/catalog';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Empty, Modal, PageHead, Toggle } from '../components/ui';
import { AuditShot, ComputerUsePanel } from '../components/ComputerUse';
import { BrowserAgentPanel } from '../components/BrowserAgent';
import { useAsync, useStore } from '../state';
import '../styles/agents.css';

type Tab = 'connect' | 'services' | 'abilities' | 'teams' | 'schedules' | 'personas' | 'memory' | 'permissions' | 'skills' | 'gateway' | 'learning';
const TABS: [Tab, string][] = [['connect', 'Agents & apps'], ['services', 'AI services'], ['abilities', 'Abilities'], ['teams', 'Teams'], ['schedules', 'Schedules'], ['personas', 'Personas & projects'], ['memory', 'Memory'], ['permissions', 'What agents may do'], ['skills', 'Skills'], ['gateway', 'Gateway'], ['learning', 'Learning']];

/** A draft skill handed over from the Assistant ("Save as skill"). */
let pendingDraft: string | null = null;
export function openSkillDraft(text: string) {
  pendingDraft = text;
}

function useAgentSettings(): [AgentSettings, (p: Partial<AgentSettings>) => Promise<void>] {
  const { settings, updateSettings } = useStore();
  const a = normalizeAgentSettings(settings?.agents);
  return [a, (p) => updateSettings({ agents: { ...a, ...p } })];
}

export function Agents() {
  const { route, go } = useStore();
  const tab = (TABS.find(([t]) => t === route.arg)?.[0] ?? (pendingDraft ? 'skills' : 'connect')) as Tab;
  return (
    <div className="agents">
      <PageHead title="Agents" sub="Any AI app or agent can work with Keeper's brain — with your permission for anything it changes.">
        <button className="btn" onClick={() => go({ name: 'graph' })}><Icon name="graph" size={14} /> Knowledge graph</button>
      </PageHead>
      <div className="seg agents-tabs">
        {TABS.map(([t, label]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => go({ name: 'agents', arg: t })}>{label}</button>)}
      </div>
      {tab === 'connect' ? <Connect /> : tab === 'services' ? <Services /> : tab === 'abilities' ? <AbilitiesPanel /> : tab === 'teams' ? <TeamsPanel /> : tab === 'schedules' ? <SchedulesPanel /> : tab === 'personas' ? <PersonasPanel /> : tab === 'memory' ? <MemoryPanel /> : tab === 'permissions' ? <Permissions /> : tab === 'skills' ? <Skills /> : tab === 'gateway' ? <Gateway /> : <Learning />}
    </div>
  );
}

// ---------------------------------------------------------------- agents & apps

function Connect() {
  const { toast, info } = useStore();
  const apps = useAsync(() => api.brain.apps(), []);
  const [v, setV] = useState(0);
  const clis = useAsync(() => api.agents.clis(v > 0), [v]);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [cwd, setCwd] = useState('');
  const toggle = async (a: McpAppInfo) => {
    if (!window.confirm(`${a.connected ? 'Remove Keeper from' : 'Add Keeper to'} ${a.label}?\n\nKeeper changes only its own entry in ${a.file} and keeps a backup of the file first.`)) return;
    const r = await api.brain.setAppConnected(a.id, !a.connected);
    toast(r.message);
    apps.reload();
  };
  return (
    <>
      <h2>Connect apps and agents to Keeper</h2>
      <p className="small muted">They get Keeper's brain over MCP: search and read your files, the knowledge graph, skills, and — only as you allow on the next tab — actions such as moving files or quitting a program.</p>
      <div className="card agent-apps">
        {(apps.data ?? []).map((a) => (
          <div key={a.id} className="row agent-app">
            <div className="grow">
              <div style={{ fontWeight: 600 }}>{a.label} {a.connected ? <span className="badge accent">Connected</span> : null}</div>
              <div className="small muted ellipsis" title={a.file}>{a.file.replace(info?.home ?? '\u0000', '~')}</div>
            </div>
            <button className={`btn ${a.connected ? '' : 'primary'}`} onClick={() => void toggle(a)}>{a.connected ? 'Disconnect' : 'Connect'}</button>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 22 }}>Start an agent</h2>
      <p className="small muted">Agents found on this computer. Each opens in Keeper's Terminal in the folder you choose. Profiles keep separate settings folders, so two accounts of the same agent stay signed in side by side.</p>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input className="input grow" placeholder={`Folder to start in (default: ${info?.home ?? 'home'})`} value={cwd} onChange={(e) => setCwd(e.target.value)} />
        <button className="btn" onClick={() => setV(v + 1)}><Icon name="refresh" size={13} /> Look again</button>
      </div>
      <div className="agent-grid">
        {(clis.data?.agents ?? []).filter((a) => a.installed).map((a) => {
          const profiles = (clis.data?.profiles ?? []).filter((p) => p.agent === a.id);
          return (
            <div key={a.id} className="card agent-card">
              <div className="row" style={{ gap: 8 }}><Icon name="agent" size={18} /><b className="grow">{a.label}</b><span className="small muted">{a.vendor}</span></div>
              <div className="btn-row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
                <button className="btn primary sm" onClick={async () => toast((await api.agents.launch(a.id, { cwd: cwd || undefined })).message)}><Icon name="play" size={12} /> Start</button>
                {profiles.map((p) => (
                  <span key={p.id} className="profile-chip">
                    <button className="btn sm" onClick={async () => toast((await api.agents.launch(a.id, { profileId: p.id, cwd: cwd || undefined })).message)}>{p.label}</button>
                    <button className="btn sm ghost icon" title="Remove profile" onClick={async () => { await api.agents.removeProfile(p.id); clis.reload(); }}><Icon name="close" size={11} /></button>
                  </span>
                ))}
                {a.configEnv ? <button className="btn sm ghost" onClick={() => { setProfileFor(a.id); setLabel(''); }}><Icon name="plus" size={12} /> Profile</button> : null}
              </div>
            </div>
          );
        })}
      </div>
      {clis.data && !clis.data.agents.some((a) => a.installed) ? <Empty icon="agent" title="No agent command-line tools found">Install one (for example Claude Code or Codex CLI) and press Look again.</Empty> : null}
      <details className="small" style={{ marginTop: 12 }}>
        <summary>Not installed ({(clis.data?.agents ?? []).filter((a) => !a.installed).length})</summary>
        <div className="not-installed">
          {(clis.data?.agents ?? []).filter((a) => !a.installed).map((a) => (
            <button key={a.id} className="link-like" onClick={() => a.install && void api.system.openExternal(a.install)}>{a.label}</button>
          ))}
        </div>
      </details>
      {profileFor ? (
        <Modal title="New profile" onClose={() => setProfileFor(null)}>
          <p className="small muted" style={{ marginTop: 0 }}>A profile has its own settings folder (and sign-in) inside Keeper's data, so it never touches the agent's usual one.</p>
          <input className="input" autoFocus placeholder="Name, e.g. Work account" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => setProfileFor(null)}>Cancel</button>
            <button className="btn primary" disabled={!label.trim()} onClick={async () => { await api.agents.saveProfile({ agent: profileFor, label: label.trim(), cwd: cwd || undefined }); setProfileFor(null); clis.reload(); }}>Create</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- AI services

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));

function Services() {
  const { settings, toast, updateSettings } = useStore();
  const [a, setA] = useAgentSettings();
  const catalog = useAsync(() => api.agents.catalog(), []);
  const usage = useAsync(() => api.agents.usage(30), []);
  const [adding, setAdding] = useState<CatalogEntry | null>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [base, setBase] = useState('');
  const [models, setModels] = useState<Record<string, string[]>>({});
  const conns = settings?.brain.connections ?? [];
  const groups: [CatalogEntry['group'], string][] = [['cloud', 'Model makers'], ['distributor', 'Distributors and fast hosts'], ['enterprise', 'Enterprise clouds'], ['local', 'On this computer'], ['gateway', 'Gateways and custom addresses']];
  return (
    <>
      <h2>Your AI connections</h2>
      <div className="card">
        <table className="table agent-table">
          <thead><tr><th>Connection</th><th>Model</th><th>Calls (30 days)</th><th>Tokens in / out</th><th>Cost</th><th /></tr></thead>
          <tbody>
            {conns.map((c) => {
              const u = usage.data?.find((x) => x.id === c.id);
              return (
                <tr key={c.id}>
                  <td><b>{c.label}</b>{settings?.brain.active === c.id ? <span className="badge accent" style={{ marginLeft: 6 }}>Assistant</span> : null}</td>
                  <td>
                    {models[c.id]?.length ? (
                      <select className="input sm" value={c.model} onChange={(e) => void updateSettings({ brain: { ...settings!.brain, connections: conns.map((x) => (x.id === c.id ? { ...x, model: e.target.value } : x)) } })}>
                        {[c.model, ...models[c.id].filter((m) => m !== c.model)].filter(Boolean).map((m) => <option key={m}>{m}</option>)}
                      </select>
                    ) : <span className="mono small">{c.model || '—'}</span>}
                    <button className="btn sm ghost icon" title="Fetch the service's model list" onClick={async () => { const r = await api.agents.listModels(c.id); if (r.ok) setModels({ ...models, [c.id]: r.models }); else toast(r.message ?? 'Could not list models'); }}><Icon name="refresh" size={12} /></button>
                  </td>
                  <td>{u ? `${u.calls}${u.errors ? ` (${u.errors} failed)` : ''}` : '0'}</td>
                  <td className="small">{u ? `${fmt(u.input)} / ${fmt(u.output)}` : '—'}</td>
                  <td className="small">{u?.cost !== undefined ? `$${u.cost.toFixed(2)}` : <input className="input sm price" placeholder="$/M in,out" defaultValue={a.prices[c.id] ? `${a.prices[c.id].input},${a.prices[c.id].output}` : ''} onBlur={(e) => { const [i, o] = e.target.value.split(',').map(Number); if (Number.isFinite(i) && Number.isFinite(o)) void setA({ prices: { ...a.prices, [c.id]: { input: i, output: o } } }); }} />}</td>
                  <td>
                    <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={a.fallback.includes(c.id)} onChange={(e) => void setA({ fallback: e.target.checked ? [...a.fallback, c.id] : a.fallback.filter((x) => x !== c.id) })} /> Fallback</label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="small muted" style={{ marginTop: 8 }}>Token counts are Keeper's estimate (four characters a token). Prices are what you enter, per million tokens in and out. When the assistant's AI fails (network, limits, overload), the ticked ones answer in order.</div>
      </div>

      <h2 style={{ marginTop: 22 }}>Private folders stay on this computer</h2>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>Once a conversation touches one of these folders, it continues on a local AI, and nothing from them reaches a cloud service.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {a.privateFolders.map((f) => <span key={f} className="chip">{f}<button className="link-like" onClick={() => void setA({ privateFolders: a.privateFolders.filter((x) => x !== f) })}><Icon name="close" size={10} /></button></span>)}
          <button className="btn sm" onClick={async () => { const p = window.prompt('Folder path'); if (p) await setA({ privateFolders: [...a.privateFolders, p] }); }}><Icon name="plus" size={12} /> Folder</button>
          <span className="grow" />
          <span className="small">Local AI</span>
          <select className="input sm" value={a.localConnection} onChange={(e) => void setA({ localConnection: e.target.value })}>
            {conns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <h2 style={{ marginTop: 22 }}>Add a service</h2>
      {groups.map(([g, title]) => (
        <div key={g} className="catalog-group">
          <div className="small muted catalog-title">{title}</div>
          <div className="catalog">
            {(catalog.data ?? []).filter((e) => e.group === g).map((e) => (
              <button key={e.id} className="card catalog-item" onClick={() => { setAdding(e); setKey(''); setModel(''); setBase(e.baseUrl); }}>
                <b>{e.label}</b>
                <span className="small muted">{e.style === 'openai' ? 'OpenAI format' : e.style === 'anthropic' ? 'Anthropic format' : e.style === 'gemini' ? 'Gemini API' : e.style === 'bedrock' ? 'Converse API' : e.style === 'ollama' ? 'Ollama API' : 'Responses API'}{e.tools ? ' · tools' : ''}{e.local ? ' · local' : ''}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {adding ? (
        <Modal title={`Add ${adding.label}`} onClose={() => setAdding(null)}>
          {adding.note ? <p className="small muted" style={{ marginTop: 0 }}>{adding.note}</p> : null}
          <label className="small">Address</label>
          <input className="input" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://…" />
          {!adding.keyless ? (<><label className="small">Key (kept in the system keychain)</label><input className="input" type="password" value={key} onChange={(e) => setKey(e.target.value)} /></>) : null}
          <label className="small">Model (leave empty to pick from the service's list after adding)</label>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
          <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
            {adding.docs ? <button className="link-like" onClick={() => void api.system.openExternal(adding.docs!)}>Get a key</button> : <span />}
            <button className="btn primary" disabled={!base || (!adding.keyless && !key && adding.group !== 'local')} onClick={async () => {
              const r = await api.agents.addConnection(adding.id, { key: key || undefined, model: model || undefined, baseUrl: base });
              toast(r.ok ? `Added ${adding.label}` : r.message ?? 'Could not add it');
              if (r.ok) setAdding(null);
            }}>Add</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- permissions and history

const PERMS: [Permission, string][] = [['off', 'Off'], ['ask', 'Ask'], ['allow', 'Allow']];

function Permissions() {
  const [a, setA] = useAgentSettings();
  const actions = useAsync(() => api.agents.actions(), [JSON.stringify(a.permissions)]);
  const audit = useAsync(() => api.agents.audit(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => api.on('agent-audit', () => audit.reload()), []);
  const groups: [string, string][] = [['files', 'Files'], ['keeper', 'Keeper'], ['tasks', 'Tasks, notes and Insights'], ['system', 'Programs and the computer'], ['clipboard', 'Clipboard']];
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>Let agents act</h2>
          <div className="small muted">Off: agents can only search and read. On: each action below follows its own setting. Files only ever go to the Trash, and changes can be undone.</div>
        </div>
        <Toggle on={a.actions} onChange={(v) => void setA({ actions: v })} />
      </div>
      {groups.map(([g, title]) => (
        <div key={g} className="card perm-group" style={{ opacity: a.actions ? 1 : 0.5 }}>
          <div className="small muted perm-title">{title}</div>
          {(actions.data ?? []).filter((x) => x.group === g).map((x: ActionInfo) => (
            <div key={x.name} className="row perm-row">
              <div className="grow">{x.label}{x.destructive ? <span className="badge warn" style={{ marginLeft: 6 }}>can lose work</span> : null}{x.readOnly ? <span className="small muted"> · reads only</span> : null}</div>
              <div className="seg sm">
                {PERMS.map(([p, l]) => <button key={p} disabled={!a.actions} className={x.permission === p ? 'on' : ''} onClick={async () => { await api.agents.setPermission(x.name, p); await setA({ permissions: { ...a.permissions, [x.name]: p } }); }}>{l}</button>)}
              </div>
            </div>
          ))}
        </div>
      ))}
      <ComputerUsePanel />
      <BrowserAgentPanel />
      <h2 style={{ marginTop: 22 }}>What agents did</h2>
      <div className="card">
        {(audit.data ?? []).length ? (audit.data ?? []).slice(0, 60).map((e: AuditItem, i) => (
          <div key={i} className="row audit-row">
            <span className={`dot ${e.status}`} />
            <div className="grow"><b>{e.client}</b> {e.status === 'done' ? '' : e.status === 'denied' ? 'was declined: ' : e.status === 'refused' ? 'was refused: ' : e.status === 'off' ? 'was not allowed to ' : 'failed to '}{e.description}{e.detail && (e.status === 'error' || e.status === 'refused') ? <span className="small muted"> — {e.detail}</span> : null}</div>
            {e.shot ? <AuditShot file={e.shot} /> : null}
            <span className="small muted">{relativeTime(e.at)}</span>
          </div>
        )) : <div className="small muted">Nothing yet.</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- skills

const TEMPLATE = `---
name: my-skill
description: Use when … (say what it does and when to use it)
---

# My skill

1. …
`;

function Skills() {
  const { toast } = useStore();
  const skills = useAsync(() => api.agents.skills(), []);
  const others = useAsync(() => api.agents.otherSkills(), []);
  const [edit, setEdit] = useState<{ text: string; prev?: string } | null>(() => (pendingDraft ? { text: pendingDraft } : null));
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => { pendingDraft = null; }, []);
  const toText = (s: SkillInfo) => `---\nname: ${s.name}\ndescription: ${JSON.stringify(s.description)}\n---\n\n${s.body}\n`;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>Skills</h2>
          <div className="small muted">Instructions an AI reads only when it needs them, in the open SKILL.md format: they work in Keeper's assistant and in agents connected to Keeper. Save a good Assistant answer as a skill with “Save as skill”.</div>
        </div>
        <button className="btn primary" onClick={() => { setEdit({ text: TEMPLATE }); setErrors([]); }}><Icon name="plus" size={13} /> New skill</button>
      </div>
      <div className="skill-list">
        {(skills.data ?? []).map((s) => (
          <div key={s.name} className="card skill">
            <div className="row" style={{ gap: 8 }}>
              <b className="grow mono">{s.name}</b>
              <Toggle on={s.enabled} onChange={async (v) => { await api.agents.setSkillEnabled(s.name, v); skills.reload(); }} />
            </div>
            <div className="small muted skill-desc">{s.description}</div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={() => { setEdit({ text: toText(s), prev: s.name }); setErrors([]); }}>Edit</button>
              <button className="btn sm ghost" onClick={async () => { const p = await api.agents.exportSkill(s.name); if (p) toast(`Exported to ${p}`); }}>Export</button>
              <button className="btn sm ghost" onClick={async () => { if (window.confirm(`Delete the skill “${s.name}”?`)) { await api.agents.removeSkill(s.name); skills.reload(); } }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {!(skills.data ?? []).length ? <Empty icon="sparkle" title="No skills yet">Write one, import one from another agent, or save an Assistant answer as a skill.</Empty> : null}
      {(others.data ?? []).length ? (
        <>
          <h2 style={{ marginTop: 22 }}>Skills from other agents on this computer</h2>
          <div className="card">
            {(others.data ?? []).map((o) => (
              <div key={o.path} className="row perm-row">
                <div className="grow"><b className="mono">{o.name}</b> <span className="small muted">from {o.from}</span></div>
                <button className="btn sm" onClick={async () => { const r = await api.agents.importSkill(o.path); toast(r.ok ? `Imported ${r.name}` : r.errors.join('; ')); skills.reload(); others.reload(); }}>Import</button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {edit ? (
        <Modal title={edit.prev ? `Edit ${edit.prev}` : 'New skill'} width={760} onClose={() => setEdit(null)}>
          <textarea className="input mono skill-editor" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} spellCheck={false} />
          {errors.length ? <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>{errors.join(' · ')}</div> : null}
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => {
              const r = await api.agents.saveSkill(edit.text, edit.prev);
              if (!r.ok) { setErrors(r.errors); return; }
              toast(`Saved ${r.name}`);
              setEdit(null);
              skills.reload();
            }}>Save</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- gateway

function Gateway() {
  const { toast } = useStore();
  const [a, setA] = useAgentSettings();
  const g = useAsync(() => api.agents.gateway(), [a.gateway, a.a2a, a.gatewayPort]);
  const [host, setHost] = useState('');
  const info: GatewayInfo | null = g.data ?? null;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>Model gateway</h2>
          <div className="small muted">Tools that speak the OpenAI or Anthropic API can use your AI connections through Keeper — and <span className="mono">keeper/brain</span> answers from your files. Only on this computer, with a token.</div>
        </div>
        <Toggle on={a.gateway} onChange={(v) => void setA({ gateway: v })} />
      </div>
      {info?.on && info.port ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="badge accent">Running</span><span className="mono small grow">{info.base}</span>
            <button className="btn sm" onClick={async () => { await api.agents.rotateToken(); g.reload(); toast('New token: update the tools that use it'); }}>New token</button>
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Models</div>
          <div className="model-list">{info.models.map((m) => <span key={m.id} className="chip mono" title={m.label}>{m.id}</span>)}</div>
          {info.snippets.map((s) => (
            <div key={s.id} className="snippet">
              <div className="row"><span className="small grow">{s.label}</span><button className="btn sm ghost" onClick={() => { void api.files.copyText(s.text); toast('Copied'); }}><Icon name="copy" size={12} /> Copy</button></div>
              <pre className="mono small">{s.text}</pre>
            </div>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
        <div>
          <b>Agent-to-agent (A2A)</b>
          <div className="small muted">Other agents can find Keeper's agent card and hand it tasks such as “find the lease and tell me when it ends”.</div>
        </div>
        <Toggle on={a.a2a} onChange={(v) => void setA({ a2a: v })} />
      </div>
      <div style={{ marginTop: 18 }}>
        <b>Reach it from elsewhere</b>
        <div className="small muted">Phones, Siri Shortcuts or a voice assistant can reach Keeper through your own tunnel (Devices → tunnel). Add the tunnel's host name here; the token is still required.</div>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {a.remoteHosts.map((h) => <span key={h} className="chip mono">{h}<button className="link-like" onClick={() => void setA({ remoteHosts: a.remoteHosts.filter((x) => x !== h) })}><Icon name="close" size={10} /></button></span>)}
          <input className="input sm" placeholder="keeper.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
          <button className="btn sm" disabled={!host.trim()} onClick={() => { void setA({ remoteHosts: [...a.remoteHosts, host.trim().toLowerCase()] }); setHost(''); }}>Add</button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- learning

function Learning() {
  const { toast } = useStore();
  const [a, setA] = useAgentSettings();
  const st = useAsync(() => api.agents.learning(), [a.learn]);
  const sg = useAsync(() => api.agents.suggestions(), [a.learn]);
  const kinds = useMemo(() => ({ rule: 'rules', pin: 'pin', 'saved-search': 'search', skill: 'sparkle' }) as Record<string, string>, []);
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>Learn from how I use Keeper</h2>
          <div className="small muted">Keeper notes what you open, search, move and throw away in Keeper — only on this computer — and suggests automations, pins and saved searches. Nothing is sent anywhere. Off by default.</div>
        </div>
        <Toggle on={a.learn} onChange={(v) => void setA({ learn: v })} />
      </div>
      {a.learn && st.data ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><div className="grow small">{st.data.summary}</div><span className="small muted">{st.data.events} events{st.data.since ? ` since ${relativeTime(st.data.since)}` : ''}</span></div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <span className="small">Keep for</span>
            <select className="input sm" value={a.learnDays} onChange={(e) => void setA({ learnDays: Number(e.target.value) })}>{[14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
            <span className="grow" />
            <button className="btn sm danger" onClick={async () => { if (window.confirm('Forget everything Keeper learned?')) { await api.agents.forget(); st.reload(); sg.reload(); toast('Forgotten'); } }}>Forget everything</button>
          </div>
        </div>
      ) : null}
      {a.learn ? (
        <>
          <h2 style={{ marginTop: 22 }}>Suggestions</h2>
          {(sg.data ?? []).map((s) => (
            <div key={s.id} className="card row suggestion">
              <Icon name={kinds[s.kind] ?? 'sparkle'} size={18} />
              <div className="grow"><b>{s.title}</b><div className="small muted">{s.detail}</div></div>
              <button className="btn sm primary" onClick={async () => { const r = await api.agents.applySuggestion(s.id); toast(r.message); sg.reload(); }}>Yes</button>
              <button className="btn sm ghost" onClick={async () => { await api.agents.dismissSuggestion(s.id); sg.reload(); }}>No thanks</button>
            </div>
          ))}
          {!(sg.data ?? []).length ? <Empty icon="sparkle" title="Nothing to suggest yet">Suggestions appear once something repeats a few times.</Empty> : null}
        </>
      ) : null}
    </>
  );
}
