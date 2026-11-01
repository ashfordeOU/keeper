// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Agents view in the Terminal: every AI agent Keeper knows (any tool, any
// account), the terminals they opened with their sub-workers, the rooms where
// they talk, the shared task board, team recipes, and the rules for what
// agents may run. The person can post, assign, hand off, pause, take a
// terminal over, or stop everything.

import { useCallback, useEffect, useState } from 'react';
import type { AgentTermNode, AgentTermState } from '../../core/api-agentterm';
import type { BusMessage } from '../../core/terminal/agent/bus';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { useStore } from '../state';

type Tab = 'team' | 'rooms' | 'tasks' | 'recipes' | 'rules';

const STATUS: Record<string, string> = { idle: 'Idle', running: 'Running', waiting: 'Needs input', exited: 'Ended', starting: 'Starting', working: 'Working', away: 'Away' };
const ago = (t?: number) => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

export function AgentBoard({ onShow }: { onShow(id: string): void }) {
  const { toast } = useStore();
  const [s, setS] = useState<AgentTermState | null>(null);
  const [tab, setTab] = useState<Tab>('team');
  const load = useCallback(() => void api.agentterm.state().then(setS).catch(() => undefined), []);
  useEffect(() => {
    load();
    return api.on('agentterm-changed', load);
  }, [load]);
  const act = (p: Promise<unknown>, ok?: string) => void p.then(() => { if (ok) toast(ok); load(); }, (e: Error) => toast(e.message));
  if (!s) return <div className="agent-board"><div className="term-empty">Loading…</div></div>;
  const live = (ts: AgentTermNode[]): number => ts.reduce((n, t) => n + (t.status !== 'exited' ? 1 : 0) + live(t.sub), 0);
  const agentName = (owner: string) => s.agents.find((a) => `agent:${a.id}` === owner)?.name ?? owner.replace(/^agent:/, '');

  const termRow = (t: AgentTermNode, depth: number) => (
    <div key={t.id}>
      <div className={`ab-term st-${t.status}`} style={{ paddingLeft: 10 + depth * 18 }}>
        {depth ? <span className="ab-tree">└</span> : null}
        <span className={`ab-dot st-${t.status}`} />
        <b className="ellipsis">{t.name}</b>
        <span className="muted small">{t.id} · {agentName(t.owner)}{t.headless ? ' · headless' : ''}</span>
        <span className={`badge ${t.status === 'waiting' ? 'warn' : t.status === 'running' ? 'accent' : ''}`}>{STATUS[t.status] ?? t.status}</span>
        {t.running ? <code className="ab-cmd ellipsis">{t.running}</code> : null}
        {t.prompt ? <span className="ab-ask ellipsis" title={t.prompt}>asks: {t.prompt}</span> : null}
        {t.controller === 'human' ? <span className="badge">✋ you have it</span> : null}
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => onShow(t.id)}><Icon name="eye" size={12} /> Show</button>
        {t.controller === 'human'
          ? <button className="btn sm" onClick={() => act(api.agentterm.takeOver(t.id, true), 'Handed back to the agent')}>Hand back</button>
          : <button className="btn sm" disabled={t.status === 'exited'} onClick={() => { act(api.agentterm.takeOver(t.id), 'You have the terminal; the agent waits'); onShow(t.id); }}>Take over</button>}
        <button className="btn sm ghost danger" title="Close it and its sub-workers" onClick={() => act(api.agentterm.close(t.id), 'Closed')}><Icon name="close" size={12} /></button>
      </div>
      {t.sub.map((c) => termRow(c, depth + 1))}
    </div>
  );

  return (
    <div className="agent-board">
      <div className="ab-head">
        <div className="ab-tabs">
          {(['team', 'rooms', 'tasks', 'recipes', 'rules'] as Tab[]).map((x) => (
            <button key={x} className={`btn sm ${tab === x ? 'on' : 'ghost'}`} onClick={() => setTab(x)}>
              {x === 'team' ? `Agents & terminals (${s.agents.filter((a) => a.harness !== 'human').length} · ${live(s.terms)})` : x === 'rooms' ? `Rooms (${s.rooms.length})` : x === 'tasks' ? `Task board (${s.tasks.filter((t) => t.status === 'open' || t.status === 'claimed').length})` : x === 'recipes' ? 'Teams' : 'Rules'}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn sm danger" onClick={() => act(api.agentterm.stopAll().then((n) => toast(`Stopped ${n} agent terminal${n === 1 ? '' : 's'}; agents may not open more until you resume them`)))}>
          <Icon name="close" size={12} /> Stop all agent terminals
        </button>
      </div>
      <div className="ab-body">
        {tab === 'team' ? <Team s={s} act={act} termRow={termRow} /> : null}
        {tab === 'rooms' ? <Rooms s={s} act={act} /> : null}
        {tab === 'tasks' ? <Tasks s={s} act={act} /> : null}
        {tab === 'recipes' ? <Recipes s={s} act={act} /> : null}
        {tab === 'rules' ? <Rules s={s} act={act} /> : null}
      </div>
    </div>
  );
}

type Act = (p: Promise<unknown>, ok?: string) => void;

function Team({ s, act, termRow }: { s: AgentTermState; act: Act; termRow: (t: AgentTermNode, d: number) => React.ReactNode }) {
  const [invite, setInvite] = useState<{ name: string; harness: string; account: string } | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const agents = s.agents.filter((a) => a.harness !== 'human');
  return (
    <>
      <div className="ab-section-head"><h3>Agents</h3><span className="muted small">Any tool, model or account. They find each other with hub_list_agents and talk through the hub.</span><span className="grow" /><button className="btn sm" onClick={() => setInvite({ name: '', harness: 'custom', account: '' })}><Icon name="plus" size={12} /> Add an agent</button></div>
      {invite ? (
        <div className="card pad ab-invite">
          <input className="input" placeholder="Name (e.g. reviewer)" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
          <input className="input" placeholder="Program (claude, codex, gemini, grok, …)" value={invite.harness} onChange={(e) => setInvite({ ...invite, harness: e.target.value })} />
          <input className="input" placeholder="Account / profile (optional)" value={invite.account} onChange={(e) => setInvite({ ...invite, account: e.target.value })} />
          <button className="btn primary sm" disabled={!invite.name.trim()} onClick={() => act(api.agentterm.addAgent({ name: invite.name.trim(), harness: invite.harness.trim() || 'custom', account: invite.account.trim() || undefined }).then((r) => { setMade(r.env); setInvite(null); }))}>Create identity</button>
          <button className="btn sm ghost" onClick={() => setInvite(null)}>Cancel</button>
        </div>
      ) : null}
      {made ? <div className="card pad small">Start the agent with this in its environment, and add <code>keeper mcp</code> as its MCP server: <code className="ab-token">{made}</code> <button className="btn sm ghost" onClick={() => { void navigator.clipboard.writeText(made); }}>Copy</button> <button className="btn sm ghost" onClick={() => setMade(null)}>Done</button></div> : null}
      <div className="ab-agents">
        {agents.length ? agents.map((a) => (
          <div key={a.id} className={`ab-agent st-${a.status}`}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`ab-dot st-${a.status}`} />
              <b className="ellipsis">{a.name}</b>
              <span className="badge">{a.harness}{a.model ? ` · ${a.model}` : ''}</span>
              {a.account ? <span className="badge">{a.account}</span> : null}
              {!a.approved ? <span className="badge warn">waiting for you</span> : null}
            </div>
            <div className="small muted ellipsis">{STATUS[a.status] ?? a.status}{a.doing ? ` — ${a.doing}` : ''} · {a.via === 'mcp' ? 'uses the hub tools' : a.session ? 'messages typed in at its prompt' : 'not connected yet'} · seen {ago(a.lastSeen)}</div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              {!a.approved ? <button className="btn sm primary" onClick={() => act(api.agentterm.approve(a.id), `${a.name} may join`)}>Allow</button> : null}
              {a.perms.terminals ? <button className="btn sm ghost" onClick={() => act(api.agentterm.pause(a.id, true), `${a.name} paused`)}>Pause</button> : <button className="btn sm" onClick={() => act(api.agentterm.pause(a.id, false), `${a.name} resumed`)}>Resume</button>}
              <label className="small row" style={{ gap: 4 }} title="Only take messages from agents signed in with the same account">
                <input type="checkbox" checked={a.perms.sameAccountOnly} onChange={(e) => act(api.agentterm.setPerms(a.id, { sameAccountOnly: e.target.checked }))} /> same account only
              </label>
            </div>
          </div>
        )) : <div className="muted small">No agents yet. Start one from Agents → Coding agents, run a team from Teams, or add one here.</div>}
      </div>
      <div className="ab-section-head"><h3>Terminals</h3><span className="muted small">Sub-workers sit under the terminal that opened them and end with it.</span></div>
      <div className="ab-terms">{s.terms.length ? s.terms.map((t) => termRow(t, 0)) : <div className="muted small">Agents have no terminals open.</div>}</div>
      {s.locks.length ? (
        <>
          <div className="ab-section-head"><h3>Locks</h3></div>
          {s.locks.map((l) => <div key={l.name} className="small"><Icon name="lock" size={11} /> <code>{l.name}</code> · {s.agents.find((a) => a.id === l.holder)?.name ?? l.holder} · until {new Date(l.expires).toLocaleTimeString()}</div>)}
        </>
      ) : null}
    </>
  );
}

function Rooms({ s, act }: { s: AgentTermState; act: Act }) {
  const [room, setRoom] = useState(s.rooms[0]?.name ?? 'general');
  const [msgs, setMsgs] = useState<BusMessage[]>([]);
  const [text, setText] = useState('');
  const load = useCallback(() => void api.agentterm.messages(room).then(setMsgs), [room]);
  useEffect(() => {
    load();
    return api.on('agentterm-changed', load);
  }, [load]);
  const name = (id: string) => (id === 'human' ? 'You' : id === 'hub' ? 'Keeper' : s.agents.find((a) => a.id === id)?.name ?? id);
  return (
    <div className="ab-rooms">
      <div className="ab-room-list">
        {[...new Set([...s.rooms.map((r) => r.name), room])].map((r) => <button key={r} className={`ab-room ${r === room ? 'on' : ''}`} onClick={() => setRoom(r)}>#{r} <span className="muted">{s.rooms.find((x) => x.name === r)?.count ?? 0}</span></button>)}
        <button className="btn sm ghost" onClick={() => { const r = prompt('Room name'); if (r) setRoom(r.trim()); }}><Icon name="plus" size={12} /> Room</button>
      </div>
      <div className="ab-chat">
        <div className="ab-msgs">
          {msgs.map((m) => (
            <div key={m.seq} className={`ab-msg ${m.from === 'human' ? 'me' : ''}`}>
              <span className="ab-from">{name(m.from)}</span>
              {(m.data as { thread?: number } | undefined)?.thread ? <span className="muted small">↳ {(m.data as { thread: number }).thread} </span> : null}
              <span className="ab-text">{m.text}</span>
              <span className="muted small">{new Date(m.at).toLocaleTimeString()}</span>
            </div>
          ))}
          {!msgs.length ? <div className="muted small">Nothing here yet.</div> : null}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <input className="input grow" placeholder={`Message #${room} (use @name to reach an agent, @all for everyone)`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { act(api.agentterm.post(room, text.trim())); setText(''); } }} />
          <button className="btn primary sm" disabled={!text.trim()} onClick={() => { act(api.agentterm.post(room, text.trim())); setText(''); }}>Send</button>
        </div>
      </div>
    </div>
  );
}

function Tasks({ s, act }: { s: AgentTermState; act: Act }) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const agents = s.agents.filter((a) => a.harness !== 'human');
  const col = (status: string, label: string) => (
    <div className="ab-col">
      <div className="ab-col-head">{label} <span className="muted">{s.tasks.filter((t) => t.status === status).length}</span></div>
      {s.tasks.filter((t) => t.status === status).map((t) => (
        <div key={t.id} className="ab-task">
          <div><b>{t.id}</b> {t.title}</div>
          <div className="small muted">{t.assignee ? `@${s.agents.find((a) => a.id === t.assignee)?.name ?? t.assignee}` : 'anyone'}{t.forHarness ? ` · ${t.forHarness.join('/')}` : ''}{t.room ? ` · #${t.room}` : ''}</div>
          {t.result ? <div className="small ab-result">{t.result.slice(0, 240)}</div> : null}
          {t.context?.summary ? <div className="small muted">Context: {t.context.summary.slice(0, 160)}</div> : null}
          {status === 'open' || status === 'claimed' ? (
            <select className="input sm" value="" onChange={(e) => e.target.value && act(api.agentterm.handoff(t.id, e.target.value, 'Assigned by the person'), `Handed ${t.id} over`)}>
              <option value="">{status === 'open' ? 'Assign to…' : 'Hand to…'}</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.harness})</option>)}
            </select>
          ) : null}
        </div>
      ))}
    </div>
  );
  return (
    <>
      <div className="row ab-newtask" style={{ gap: 6 }}>
        <input className="input grow" placeholder="New task for the agents" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Anyone can claim it</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.harness})</option>)}
        </select>
        <button className="btn primary sm" disabled={!title.trim()} onClick={() => { act(api.agentterm.postTask({ title: title.trim(), assignee: assignee || undefined, room: 'tasks' }), 'Posted'); setTitle(''); }}>Post</button>
      </div>
      <div className="ab-cols">{col('open', 'Open')}{col('claimed', 'In progress')}{col('done', 'Done')}{col('failed', 'Failed')}</div>
    </>
  );
}

function Recipes({ s, act }: { s: AgentTermState; act: Act }) {
  const [goal, setGoal] = useState('');
  const [pick, setPick] = useState(s.recipes[0]?.id ?? '');
  return (
    <>
      <p className="small muted">Start a team of agents that work together through the hub. Keeper opens each agent in its own terminal, briefs it, opens a room and posts the first task. Mix tools and models freely; each role uses an installed agent that suits it.</p>
      <div className="ab-recipes">
        {s.recipes.map((r) => (
          <label key={r.id} className={`ab-recipe ${pick === r.id ? 'on' : ''}`}>
            <input type="radio" checked={pick === r.id} onChange={() => setPick(r.id)} />
            <div>
              <b>{r.name}</b>
              <div className="small muted">{r.description}</div>
              <div className="small">{r.roles.map((x) => `${x.count > 1 ? `${x.count}× ` : ''}${x.title} (${x.prefer.slice(0, 3).join(', ')})`).join(' · ')}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" placeholder="Goal, e.g. “Add dark mode to the settings page”" value={goal} onChange={(e) => setGoal(e.target.value)} />
        <button className="btn primary" disabled={!goal.trim() || !pick} onClick={() => act(api.agentterm.runRecipe(pick, goal.trim(), {}).then((r) => { if (r.missing.length) throw new Error(`Started, but no installed agent for: ${r.missing.join(', ')}`); }), 'Team started')}>Start team</button>
      </div>
    </>
  );
}

function Rules({ s, act }: { s: AgentTermState; act: Act }) {
  const [allow, setAllow] = useState(s.policy.allow.join('\n'));
  const [deny, setDeny] = useState(s.policy.deny.join('\n'));
  const [jail, setJail] = useState(s.policy.jail.join('\n'));
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  return (
    <div className="ab-rules">
      <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={s.policy.askRisky} onChange={(e) => act(api.agentterm.setPolicy({ askRisky: e.target.checked }))} /> Ask me before commands that delete, force-push, run as administrator, run scripts from the internet, publish, or change live systems</label>
      <div className="ab-rule-grid">
        <label>Always allowed (one pattern per line, * matches anything)<textarea className="input" rows={5} value={allow} onChange={(e) => setAllow(e.target.value)} placeholder={'npm test*\ngit status'} /></label>
        <label>Never allowed<textarea className="input" rows={5} value={deny} onChange={(e) => setDeny(e.target.value)} placeholder={'npm publish*\nterraform destroy*'} /></label>
        <label>Agents' terminals stay in these folders (empty: anywhere)<textarea className="input" rows={5} value={jail} onChange={(e) => setJail(e.target.value)} placeholder={'~/code'} /></label>
      </div>
      <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
        <label>Terminals per agent <input className="input sm" type="number" min={1} max={64} defaultValue={s.limits.maxSessionsPerAgent} onBlur={(e) => act(api.agentterm.setPolicy({}, { maxSessionsPerAgent: Number(e.target.value) || 12 }))} /></label>
        <label>Close agent terminals after (minutes) <input className="input sm" type="number" min={1} defaultValue={Math.round(s.limits.defaultTtlMs / 60000)} onBlur={(e) => act(api.agentterm.setPolicy({}, { defaultTtlMs: (Number(e.target.value) || 120) * 60000 }))} /></label>
        <label>Longest single command (minutes) <input className="input sm" type="number" min={1} defaultValue={Math.round(s.limits.maxRunMs / 60000)} onBlur={(e) => act(api.agentterm.setPolicy({}, { maxRunMs: (Number(e.target.value) || 30) * 60000 }))} /></label>
      </div>
      <button className="btn primary sm" onClick={() => act(api.agentterm.setPolicy({ allow: lines(allow), deny: lines(deny), jail: lines(jail) }), 'Saved')}>Save rules</button>
      <p className="small muted">Every agent command is kept in a transcript for 14 days. Passwords, keys and tokens are blanked in what agents read back. Whether agents may use terminals at all is under Agents → Permissions (“Use terminals”).</p>
    </div>
  );
}
