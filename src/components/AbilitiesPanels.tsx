// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Agents page's Abilities, Teams, Schedules, Personas & projects and
// Memory tabs: what any AI can do through Keeper, and the person's control
// over each part.

import { useEffect, useMemo, useState } from 'react';
import type { AbilityInfo, ProviderInfo } from '../../core/api-abilities';
import type { AbilitiesSettings, Persona, Project, ScheduledTask } from '../../core/abilities/config';
import type { Memory } from '../../core/abilities/memory';
import { PERSONA_TEMPLATES } from '../../core/abilities/personas';
import type { TeamResult, TeamSpec, TranscriptEntry, Strategy } from '../../core/abilities/teams';
import { TEAM_TEMPLATES } from '../../core/abilities/teams';
import { relativeTime } from '../../core/format';
import { api } from '../api';
import { useAsync, useStore } from '../state';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import '../styles/abilities.css';

const PERMS: ['off' | 'ask' | 'allow', string][] = [['off', 'Off'], ['ask', 'Ask'], ['allow', 'Allow']];

function useAbilities(): [AbilitiesSettings | null, (p: Partial<AbilitiesSettings>) => Promise<void>, () => void] {
  const [s, setS] = useState<AbilitiesSettings | null>(null);
  const load = () => void api.abilities.settings().then(setS);
  useEffect(() => {
    load();
    return api.on('abilities-changed' as 'navigate', load as never);
  }, []);
  return [s, async (p) => setS(await api.abilities.save(p)), load];
}

const when = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ---------------------------------------------------------------- Abilities

export function AbilitiesPanel() {
  const [s, save] = useAbilities();
  const list = useAsync(() => api.abilities.list(), [s]);
  const prov = useAsync(() => api.abilities.providers(), []);
  const costs = useAsync(() => api.abilities.costs(30), []);
  const [test, setTest] = useState<{ ok: boolean; message: string; results?: { title: string; url: string }[] } | null>(null);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  if (!s) return null;
  const groups = [...new Set((list.data ?? []).map((a) => a.group))];
  const searchP = prov.data?.search.find((p) => p.id === s.search.provider);
  const imageP = prov.data?.images.find((p) => p.id === s.images.provider);
  const keyBtn = (name: string, label = 'Key') => (
    <button className="btn sm" onClick={() => setKeyFor(name)}>{prov.data?.keys[name] ? <><Icon name="check" size={12} /> {label} saved</> : <><Icon name="lock" size={12} /> Add {label.toLowerCase()}</>}</button>
  );
  return (
    <div className="abil">
      <div className="card row abil-head">
        <div className="grow">
          <b>Built-in skills for every AI</b>
          <div className="small muted">Whichever AI you use — Claude, OpenAI, Gemini, Grok, a model on this computer, or an agent like Claude Code or Codex — gets these through Keeper: in the Assistant, over MCP, through the gateway and from other agents.</div>
        </div>
        <Toggle on={s.enabled} onChange={(v) => void save({ enabled: v })} />
      </div>
      <div className="card row">
        <div className="grow">
          <b>Stay on this computer</b>
          <div className="small muted">Turns off everything that reaches the internet (web search, posts, research, cloud pictures and voice). Code, memory, schedules and pictures from a local service keep working.</div>
        </div>
        <Toggle on={s.localOnly} onChange={(v) => void save({ localOnly: v })} />
      </div>

      {groups.map((g) => (
        <div key={g} className="card abil-group" style={{ opacity: s.enabled ? 1 : 0.5 }}>
          <div className="small muted abil-title">{g}</div>
          {(list.data ?? []).filter((a) => a.group === g).map((a: AbilityInfo) => (
            <div key={a.name} className="row abil-row">
              <div className="grow">
                <div>{a.label}{a.network === 'always' ? <span className="badge" title="Uses the internet">web</span> : a.network === 'never' ? <span className="badge ok" title="Stays on this computer">on this computer</span> : null}</div>
                <div className="small muted">{a.description}</div>
              </div>
              <div className="seg sm">
                {PERMS.map(([p, l]) => (
                  <button key={p} disabled={!s.enabled || (s.localOnly && a.network === 'always')} className={a.permission === p ? 'on' : ''} onClick={() => void save({ permissions: { ...s.permissions, [a.name]: p } })}>{l}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      <h2>Web search</h2>
      <div className="card abil-form">
        <label>Search service
          <select className="input" value={s.search.provider} onChange={(e) => void save({ search: { ...s.search, provider: e.target.value as AbilitiesSettings['search']['provider'] } })}>
            {(prov.data?.search ?? []).map((p: ProviderInfo) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {s.search.provider === 'searxng' ? <label>SearXNG address<input className="input" value={s.search.searxngUrl} onChange={(e) => void save({ search: { ...s.search, searxngUrl: e.target.value } })} /></label> : null}
        {s.search.provider === 'google' ? <label>Search engine id (cx)<input className="input" value={s.search.googleCx} onChange={(e) => void save({ search: { ...s.search, googleCx: e.target.value } })} /></label> : null}
        <div className="row" style={{ gap: 8 }}>
          {searchP?.needsKey ? keyBtn(s.search.provider === 'xai' ? 'xai' : `search:${s.search.provider}`) : null}
          <button className="btn sm" onClick={async () => { setTest({ ok: true, message: 'Searching…' }); setTest(await api.abilities.testSearch('owls')); }}><Icon name="search" size={12} /> Try it</button>
          {searchP?.keyHint ? <span className="small muted">{searchP.keyHint}</span> : null}
        </div>
        {s.search.provider === 'free' ? <div className="small muted">The built-in search answers from encyclopedias and instant answers only. For full web results choose a search service (several have free plans) or your own SearXNG.</div> : null}
        {test ? <div className={`small ${test.ok ? '' : 'err'}`}>{test.message}{test.results?.length ? <ul>{test.results.map((r) => <li key={r.url}>{r.title} <span className="muted">{r.url}</span></li>)}</ul> : null}</div> : null}
      </div>

      <h2>Posts</h2>
      <div className="card abil-form">
        <div className="small muted">Hacker News and Mastodon hashtags need nothing. X uses your xAI key; Bluesky needs your handle and an app password; Reddit needs your own Reddit app id.</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{keyBtn('xai', 'xAI key')}{keyBtn('bluesky', 'Bluesky app password')}</div>
        <label>Mastodon server<input className="input" value={s.social.mastodonInstance} onChange={(e) => void save({ social: { ...s.social, mastodonInstance: e.target.value } })} /></label>
        <label>Bluesky handle<input className="input" placeholder="you.bsky.social" value={s.social.blueskyHandle} onChange={(e) => void save({ social: { ...s.social, blueskyHandle: e.target.value } })} /></label>
        <label>Reddit app id<input className="input" value={s.social.redditClientId} onChange={(e) => void save({ social: { ...s.social, redditClientId: e.target.value } })} /></label>
      </div>

      <h2>Pictures</h2>
      <div className="card abil-form">
        <label>Picture service
          <select className="input" value={s.images.provider} onChange={(e) => void save({ images: { ...s.images, provider: e.target.value as AbilitiesSettings['images']['provider'], model: '' } })}>
            {(prov.data?.images ?? []).map((p: ProviderInfo) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {imageP?.local ? <label>Address<input className="input" value={s.images.localUrl} onChange={(e) => void save({ images: { ...s.images, localUrl: e.target.value } })} /></label> : <div className="row" style={{ gap: 8 }}>{keyBtn(`images:${s.images.provider}`)}<span className="small muted">An OpenAI, Gemini or xAI key you already added for chat is used too.</span></div>}
        <label>Model (optional)<input className="input" placeholder="the service's default" value={s.images.model} onChange={(e) => void save({ images: { ...s.images, model: e.target.value } })} /></label>
        {imageP && !imageP.edits ? <div className="small muted">{imageP.label} can make pictures but not edit them in Keeper.</div> : null}
      </div>

      <h2>Code</h2>
      <div className="card abil-form">
        <div className="small muted">Code runs in a sealed workspace: a fresh folder, no internet, no access to your files (unless you pass some in), and a time limit.</div>
        <div className="row"><span className="grow">Run Python too</span><Toggle on={s.code.python} onChange={(v) => void save({ code: { ...s.code, python: v } })} /></div>
        <label>Time limit (seconds)<input className="input" type="number" min={2} max={300} value={s.code.timeoutSec} onChange={(e) => void save({ code: { ...s.code, timeoutSec: Number(e.target.value) || 20 } })} /></label>
      </div>

      <h2>Voice</h2>
      <div className="card abil-form">
        <label>Speech to text
          <select className="input" value={s.voice.stt} onChange={(e) => void save({ voice: { ...s.voice, stt: e.target.value as AbilitiesSettings['voice']['stt'] } })}>
            <option value="dictation">A speech service (OpenAI-compatible)</option>
            <option value="off">Off</option>
          </select>
        </label>
        {s.voice.stt !== 'off' ? <>
          <label>Service address<input className="input" value={s.voice.sttUrl} onChange={(e) => void save({ voice: { ...s.voice, sttUrl: e.target.value } })} /></label>
          <label>Model<input className="input" value={s.voice.sttModel} onChange={(e) => void save({ voice: { ...s.voice, sttModel: e.target.value } })} /></label>
          <div className="row" style={{ gap: 8 }}>{keyBtn('voice')}<span className="small muted">A local server (e.g. a whisper server on this computer) needs no key.</span></div>
        </> : null}
        <label>Speaking
          <select className="input" value={s.voice.tts} onChange={(e) => void save({ voice: { ...s.voice, tts: e.target.value as AbilitiesSettings['voice']['tts'] } })}>
            <option value="system">This computer's voices</option>
            <option value="off">Off</option>
          </select>
        </label>
        <div className="row"><span className="grow">Hands-free conversation in the Assistant (listens again after each answer)</span><Toggle on={s.voice.handsFree} onChange={(v) => void save({ voice: { ...s.voice, handsFree: v } })} /></div>
      </div>

      <h2>Gateway</h2>
      <div className="card row">
        <div className="grow">
          <b>Give every gateway model Keeper's abilities</b>
          <div className="small muted">Plain chat apps that talk to Keeper's gateway get web search, pictures, code and memory without setting anything up. Without this, ask for “model-name+abilities”.</div>
        </div>
        <Toggle on={s.gatewayInject} onChange={(v) => void save({ gatewayInject: v })} />
      </div>

      <h2>Spending (last 30 days)</h2>
      <div className="card">
        {costs.data && Object.keys(costs.data.byProvider).length ? (
          <table className="abil-costs"><tbody>
            {Object.entries(costs.data.byProvider).map(([p, r]) => <tr key={p}><td>{p}</td><td>{r.calls} calls</td><td>{r.units} units</td><td>{r.usd ? `$${r.usd.toFixed(2)}` : '—'}</td></tr>)}
          </tbody></table>
        ) : <div className="small muted">Nothing used yet.</div>}
      </div>

      {keyFor ? <KeyDialog name={keyFor} onClose={() => { setKeyFor(null); prov.reload?.(); }} /> : null}
    </div>
  );
}

function KeyDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [v, setV] = useState('');
  const { toast } = useStore();
  return (
    <Modal title="Add a key" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Kept in your computer's keychain, never in Keeper's settings file.</p>
      <input className="input" type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={name.replace(/^.*:/, '')} />
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!v.trim()} onClick={async () => { const ok = await api.abilities.setKey(name, v.trim()); toast(ok ? 'Key saved' : 'This computer has no keychain Keeper can use'); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Teams

const STRATEGIES: [Strategy, string, string][] = [
  ['compare', 'Side by side', 'Everyone answers the same question; compare the answers.'],
  ['critique', 'Writer and reviewer', 'The first member answers, the second reviews, the first revises.'],
  ['panel', 'Panel with a chair', 'Everyone answers; the first member merges them into one.'],
  ['delegate', 'Planner and workers', 'The first member splits the job; the others do the parts; the first assembles.'],
  ['router', 'Best for the job', 'Each request goes to the member best suited to it (private ones stay on this computer).'],
];

export function TeamsPanel() {
  const [s, , reload] = useAbilities();
  const members = useAsync(() => api.abilities.members(), []);
  const [edit, setEdit] = useState<(Omit<TeamSpec, 'id'> & { id?: string }) | null>(null);
  const [run, setRun] = useState<{ team: TeamSpec; prompt: string } | null>(null);
  if (!s) return null;
  const label = (id: string) => members.data?.find((m) => m.id === id)?.label ?? id;
  return (
    <div className="abil">
      <p className="muted small" style={{ marginTop: 0 }}>Put several AIs to work on one request. Members are the AIs you connected under AI services, plus agent sessions running in Keeper's Terminal (Claude Code, Codex, Grok, …), even from different accounts.</p>
      <div className="abil-teams">
        {s.teams.map((t) => (
          <div key={t.id} className="card abil-team">
            <div className="row"><b className="grow">{t.name}</b><span className="badge">{STRATEGIES.find((x) => x[0] === t.strategy)?.[1]}</span></div>
            <div className="small muted">{t.members.map(label).join(' · ') || 'No members'}</div>
            <div className="btn-row">
              <button className="btn sm primary" onClick={() => setRun({ team: t, prompt: '' })}><Icon name="play" size={12} /> Ask the team</button>
              <button className="btn sm" onClick={() => setEdit(t)}>Edit</button>
              <button className="btn sm ghost" onClick={async () => { await api.abilities.removeTeam(t.id); reload(); }}>Remove</button>
            </div>
          </div>
        ))}
        <div className="card abil-team new">
          <b>New team</b>
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            {TEAM_TEMPLATES.map((tp) => <button key={tp.name} className="btn sm" onClick={() => setEdit({ ...tp, members: (members.data ?? []).slice(0, tp.strategy === 'critique' ? 2 : 3).map((m) => m.id) })}>{tp.name}</button>)}
          </div>
        </div>
      </div>
      {edit ? <TeamEditor team={edit} members={members.data ?? []} onClose={() => { setEdit(null); reload(); }} /> : null}
      {run ? <TeamRun team={run.team} label={label} onClose={() => setRun(null)} /> : null}
    </div>
  );
}

function TeamEditor({ team, members, onClose }: { team: Omit<TeamSpec, 'id'> & { id?: string }; members: { id: string; label: string; local?: boolean }[]; onClose: () => void }) {
  const [t, setT] = useState(team);
  const toggle = (id: string) => setT({ ...t, members: t.members.includes(id) ? t.members.filter((m) => m !== id) : [...t.members, id] });
  return (
    <Modal title={t.id ? 'Edit team' : 'New team'} onClose={onClose} width={560}>
      <div className="abil-form">
        <label>Name<input className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
        <label>How they work together
          <select className="input" value={t.strategy} onChange={(e) => setT({ ...t, strategy: e.target.value as Strategy })}>
            {STRATEGIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <div className="small muted">{STRATEGIES.find((x) => x[0] === t.strategy)?.[2]}</div>
        <div className="small muted">Members, in order:</div>
        <div className="abil-members">
          {members.map((m) => (
            <label key={m.id} className="row">
              <input type="checkbox" checked={t.members.includes(m.id)} onChange={() => toggle(m.id)} />
              <span className="grow">{m.label}</span>
              {t.members.includes(m.id) ? <span className="badge">{t.members.indexOf(m.id) + 1}</span> : null}
              {m.local ? <span className="badge ok">on this computer</span> : null}
            </label>
          ))}
          {!members.length ? <div className="small muted">Connect an AI under AI services first.</div> : null}
        </div>
        {t.strategy === 'critique' ? <label>Review rounds<input className="input" type="number" min={1} max={5} value={t.rounds ?? 1} onChange={(e) => setT({ ...t, rounds: Number(e.target.value) || 1 })} /></label> : null}
        <label>Most calls per request<input className="input" type="number" min={2} max={60} value={t.maxCalls ?? 20} onChange={(e) => setT({ ...t, maxCalls: Number(e.target.value) || 20 })} /></label>
        <label>Instructions for every member (optional)<textarea className="input" rows={3} value={t.instructions ?? ''} onChange={(e) => setT({ ...t, instructions: e.target.value })} /></label>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!t.name.trim() || !t.members.length} onClick={async () => { await api.abilities.saveTeam(t); onClose(); }}>Save team</button>
      </div>
    </Modal>
  );
}

function TeamRun({ team, label, onClose }: { team: TeamSpec; label: (id: string) => string; onClose: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [result, setResult] = useState<TeamResult | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => api.on('abilities-team' as 'navigate', ((d: { runId: string; entry: TranscriptEntry }) => { if (d.runId === runId) setEntries((e) => [...e, d.entry]); }) as never), [runId]);
  const go = async () => {
    const id = Math.random().toString(36).slice(2);
    setRunId(id);
    setEntries([]);
    setResult(null);
    setErr('');
    try {
      setResult(await api.abilities.runTeam(id, team.id, prompt));
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setRunId(null);
    }
  };
  return (
    <Modal title={<>{team.name}</>} onClose={onClose} width={team.strategy === 'compare' ? 980 : 720}>
      <div className="row" style={{ gap: 8 }}>
        <textarea className="input grow" rows={2} placeholder="Ask the team…" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && prompt.trim() && !runId) { e.preventDefault(); void go(); } }} />
        {runId ? <button className="btn" onClick={() => void api.abilities.cancelTeam(runId)}>Stop</button> : <button className="btn primary" disabled={!prompt.trim()} onClick={() => void go()}><Icon name="send" size={13} /> Ask</button>}
      </div>
      {err ? <div className="err small" style={{ marginTop: 10 }}>{err}</div> : null}
      {runId && !entries.length ? <div className="small muted" style={{ marginTop: 10 }}><span className="spinner" /> Working…</div> : null}
      {result?.answers ? (
        <div className="abil-compare">
          {result.answers.map((a) => <div key={a.member} className={`card ${a.error ? 'err' : ''}`}><div className="small muted">{a.label}</div><div className="abil-answer">{a.text}</div></div>)}
        </div>
      ) : result ? (
        <div className="card" style={{ marginTop: 12 }}>
          {result.routed ? <div className="small muted">Sent to {label(result.routed.member)} — {result.routed.reason}</div> : null}
          <div className="abil-answer">{result.answer}</div>
          <div className="small muted">{result.calls} call{result.calls === 1 ? '' : 's'}</div>
        </div>
      ) : null}
      {entries.length && !result?.answers ? (
        <details className="abil-transcript" open={!result}>
          <summary className="small muted">How they worked ({entries.length} steps)</summary>
          {entries.map((e, i) => <div key={i} className={`abil-entry ${e.error ? 'err' : ''}`}><b>{label(e.member)}</b> <span className="badge">{e.role}</span> <span className="small muted">{(e.ms / 1000).toFixed(1)} s</span><div className="small">{e.text.slice(0, 600)}</div></div>)}
        </details>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------- Schedules

export function SchedulesPanel() {
  const [s, , reload] = useAbilities();
  const [edit, setEdit] = useState<(Omit<ScheduledTask, 'id'> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!s) return null;
  return (
    <div className="abil">
      <p className="muted small" style={{ marginTop: 0 }}>Requests the assistant runs on a schedule with your AI and abilities — a morning briefing, a weekly research digest, a reminder. Results arrive in the Island, as a notification or as a file.</p>
      {s.tasks.map((t) => (
        <div key={t.id} className="card abil-task">
          <div className="row">
            <div className="grow"><b>{t.name}</b> <span className="small muted">· {t.when}{t.once ? ' (once)' : ''}</span></div>
            <Toggle on={t.enabled} onChange={async (v) => { await api.abilities.saveTask({ ...t, enabled: v }); reload(); }} />
          </div>
          <div className="small">{t.prompt}</div>
          {t.lastRun ? <div className="small muted">Last ran {relativeTime(t.lastRun)}{t.lastResult ? `: ${t.lastResult.slice(0, 160)}` : ''}</div> : null}
          <div className="btn-row">
            <button className="btn sm" disabled={busy === t.id} onClick={async () => { setBusy(t.id); try { await api.abilities.runTask(t.id); } finally { setBusy(null); reload(); } }}>{busy === t.id ? <span className="spinner" /> : <Icon name="play" size={12} />} Run now</button>
            <button className="btn sm" onClick={() => setEdit(t)}>Edit</button>
            <button className="btn sm ghost" onClick={async () => { await api.abilities.removeTask(t.id); reload(); }}>Remove</button>
          </div>
        </div>
      ))}
      <button className="btn primary" onClick={() => setEdit({ name: '', prompt: '', when: 'every weekday at 8:30', deliver: ['island', 'notification'], enabled: true })}><Icon name="plus" size={13} /> New scheduled request</button>
      {edit ? <TaskEditor task={edit} personas={s.personas} projects={s.projects} onClose={() => { setEdit(null); reload(); }} /> : null}
    </div>
  );
}

function TaskEditor({ task, personas, projects, onClose }: { task: Omit<ScheduledTask, 'id'> & { id?: string }; personas: Persona[]; projects: Project[]; onClose: () => void }) {
  const [t, setT] = useState(task);
  const desc = useAsync(() => api.abilities.describeSchedule(t.when), [t.when]);
  const toggle = (d: 'island' | 'notification' | 'file') => setT({ ...t, deliver: t.deliver.includes(d) ? t.deliver.filter((x) => x !== d) : [...t.deliver, d] });
  return (
    <Modal title={t.id ? 'Edit scheduled request' : 'New scheduled request'} onClose={onClose} width={560}>
      <div className="abil-form">
        <label>Name<input className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Morning briefing" /></label>
        <label>What to do<textarea className="input" rows={3} value={t.prompt} onChange={(e) => setT({ ...t, prompt: e.target.value })} placeholder="Summarise today's calendar, unread mail and the weather in five lines." /></label>
        <label>When<input className="input" value={t.when} onChange={(e) => setT({ ...t, when: e.target.value })} /></label>
        <div className={`small ${desc.data && !desc.data.ok ? 'err' : 'muted'}`}>{desc.data?.ok ? `${desc.data.label}. Next: ${(desc.data.next ?? []).map(when).join(', ') || 'never'}` : desc.data?.error}</div>
        <div className="row" style={{ gap: 14 }}>
          {(['island', 'notification', 'file'] as const).map((d) => <label key={d} className="row" style={{ gap: 6 }}><input type="checkbox" checked={t.deliver.includes(d)} onChange={() => toggle(d)} /> {d === 'island' ? 'Island' : d === 'notification' ? 'Notification' : 'Save as a file'}</label>)}
        </div>
        <label>Persona<select className="input" value={t.persona ?? ''} onChange={(e) => setT({ ...t, persona: e.target.value || undefined })}><option value="">None</option>{personas.map((p) => <option key={p.id} value={p.id}>{p.avatar} {p.name}</option>)}</select></label>
        <label>Project<select className="input" value={t.project ?? ''} onChange={(e) => setT({ ...t, project: e.target.value || undefined })}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!t.prompt.trim() || !desc.data?.ok} onClick={async () => { await api.abilities.saveTask({ ...t, name: t.name.trim() || t.prompt.slice(0, 40) }); onClose(); }}>Save</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Personas & projects

export function PersonasPanel() {
  const [s, , reload] = useAbilities();
  const { toast } = useStore();
  const [p, setP] = useState<(Omit<Persona, 'id'> & { id?: string }) | null>(null);
  const [pr, setPr] = useState<(Omit<Project, 'id'> & { id?: string }) | null>(null);
  if (!s) return null;
  const err = (e: unknown) => toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
  return (
    <div className="abil">
      <h2 style={{ marginTop: 0 }}>Personas</h2>
      <p className="muted small">How an assistant talks and what it focuses on, with its own memories if you like. A persona never claims to be a real person.</p>
      <div className="abil-teams">
        {s.personas.map((x) => (
          <div key={x.id} className="card abil-team">
            <div className="row"><span className="abil-avatar">{x.avatar ?? '🦉'}</span><b className="grow">{x.name}</b></div>
            <div className="small muted">{x.instructions.slice(0, 140)}</div>
            <div className="btn-row"><button className="btn sm" onClick={() => setP(x)}>Edit</button><button className="btn sm ghost" onClick={async () => { await api.abilities.removePersona(x.id); reload(); }}>Remove</button></div>
          </div>
        ))}
        <div className="card abil-team new">
          <b>New persona</b>
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>{PERSONA_TEMPLATES.map((tp) => <button key={tp.name} className="btn sm" onClick={() => setP(tp)}>{tp.avatar} {tp.name}</button>)}<button className="btn sm" onClick={() => setP({ name: '', instructions: '', avatar: '🦉', memoryScope: 'shared' })}>Blank</button></div>
        </div>
      </div>
      <h2>Projects</h2>
      <p className="muted small">A set of folders, instructions and memories. In a project the AI only uses files from its folders.</p>
      <div className="abil-teams">
        {s.projects.map((x) => (
          <div key={x.id} className="card abil-team">
            <b>{x.name}</b>
            <div className="small muted">{x.folders.join(', ') || 'No folders'}</div>
            <div className="btn-row"><button className="btn sm" onClick={() => setPr(x)}>Edit</button><button className="btn sm ghost" onClick={async () => { await api.abilities.removeProject(x.id); reload(); }}>Remove</button></div>
          </div>
        ))}
        <div className="card abil-team new"><b>New project</b><button className="btn sm" onClick={() => setPr({ name: '', instructions: '', folders: [] })}><Icon name="plus" size={12} /> Add</button></div>
      </div>
      {p ? (
        <Modal title={p.id ? 'Edit persona' : 'New persona'} onClose={() => setP(null)} width={540}>
          <div className="abil-form">
            <div className="row" style={{ gap: 8 }}>
              <label style={{ width: 80 }}>Avatar<input className="input" value={p.avatar ?? ''} onChange={(e) => setP({ ...p, avatar: e.target.value.slice(0, 4) })} /></label>
              <label className="grow">Name<input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></label>
            </div>
            <label>How it talks and what it does<textarea className="input" rows={5} value={p.instructions} onChange={(e) => setP({ ...p, instructions: e.target.value })} /></label>
            <label>Memories<select className="input" value={p.memoryScope ?? 'shared'} onChange={(e) => setP({ ...p, memoryScope: e.target.value as Persona['memoryScope'] })}><option value="shared">Shared memories</option><option value="own">Shared and its own</option><option value="none">None</option></select></label>
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => setP(null)}>Cancel</button>
            <button className="btn primary" onClick={async () => { try { await api.abilities.savePersona(p); setP(null); reload(); } catch (e) { err(e); } }}>Save</button>
          </div>
        </Modal>
      ) : null}
      {pr ? (
        <Modal title={pr.id ? 'Edit project' : 'New project'} onClose={() => setPr(null)} width={540}>
          <div className="abil-form">
            <label>Name<input className="input" value={pr.name} onChange={(e) => setPr({ ...pr, name: e.target.value })} /></label>
            <label>Folders (one per line)<textarea className="input" rows={3} value={pr.folders.join('\n')} onChange={(e) => setPr({ ...pr, folders: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></label>
            <label>Instructions<textarea className="input" rows={4} value={pr.instructions} onChange={(e) => setPr({ ...pr, instructions: e.target.value })} /></label>
          </div>
          <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => setPr(null)}>Cancel</button>
            <button className="btn primary" disabled={!pr.name.trim()} onClick={async () => { await api.abilities.saveProject(pr); setPr(null); reload(); }}>Save</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Memory

export function MemoryPanel() {
  const [s, save] = useAbilities();
  const [list, setList] = useState<Memory[]>([]);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const load = () => void api.abilities.memories().then(setList);
    load();
    return api.on('abilities-memories' as 'navigate', load as never);
  }, []);
  const shown = useMemo(() => list.filter((m) => !q || m.text.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt), [list, q]);
  if (!s) return null;
  const scopeLabel = (m: Memory) => (m.scope === 'shared' ? 'shared' : `${m.scope}: ${m.scope === 'persona' ? s.personas.find((p) => p.id === m.owner)?.name ?? m.owner : s.projects.find((p) => p.id === m.owner)?.name ?? m.owner}`);
  return (
    <div className="abil">
      <div className="card row">
        <div className="grow"><b>Memory</b><div className="small muted">Things you asked an AI to remember, kept on this computer. Every one is here to read, change or delete.</div></div>
        <Toggle on={s.memory.on} onChange={(v) => void save({ memory: { ...s.memory, on: v } })} />
      </div>
      <div className="card row">
        <div className="grow"><b>Memories may go to AIs on the internet</b><div className="small muted">Off: only AIs on this computer see your memories. On: memories you mark “cloud” go to cloud AIs too.</div></div>
        <Toggle on={s.memory.cloud} onChange={(v) => void save({ memory: { ...s.memory, cloud: v } })} />
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <input className="input grow" placeholder="Add a memory…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && text.trim()) { setList(await api.abilities.addMemory(text.trim())); setText(''); } }} />
        <input className="input" style={{ width: 200 }} placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card">
        {shown.length ? shown.map((m) => (
          <div key={m.id} className="row abil-mem">
            <button className={`btn sm ghost icon ${m.pinned ? 'on' : ''}`} title={m.pinned ? 'Unpin' : 'Pin (always included)'} aria-label={m.pinned ? 'Unpin' : 'Pin (always included)'} onClick={async () => setList(await api.abilities.editMemory(m.id, { pinned: !m.pinned }))}><Icon name="pin" size={13} /></button>
            <div className="grow">
              <input className="input bare" defaultValue={m.text} onBlur={async (e) => { if (e.target.value.trim() && e.target.value !== m.text) setList(await api.abilities.editMemory(m.id, { text: e.target.value })); }} />
              <div className="small muted">{scopeLabel(m)} · by {m.by} · {relativeTime(m.updatedAt)}</div>
            </div>
            <label className="small row" style={{ gap: 4 }} title="May go to AIs on the internet"><input type="checkbox" checked={m.cloud} disabled={!s.memory.cloud} onChange={async (e) => setList(await api.abilities.editMemory(m.id, { cloud: e.target.checked }))} /> cloud</label>
            <button className="btn sm ghost icon" title="Delete" aria-label="Delete" onClick={async () => setList(await api.abilities.removeMemory(m.id))}><Icon name="trash" size={13} /></button>
          </div>
        )) : <div className="small muted">Nothing remembered yet. Ask any AI in Keeper to “remember that …”.</div>}
      </div>
      {list.length ? <button className="btn ghost" style={{ marginTop: 10 }} onClick={async () => { if (confirm('Forget every memory?')) setList(await api.abilities.clearMemories()); }}>Forget everything</button> : null}
    </div>
  );
}
