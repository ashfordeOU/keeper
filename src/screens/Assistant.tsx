// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Assistant: ask anything about your files, with whichever AI you use. It
// searches and reads through Keeper's brain, cites the files it used, and
// suggests changes as buttons; nothing changes until you press one.

import { openSkillDraft } from './Agents';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AskResult } from '../../core/api-brain';
import type { BrainHit } from '../../core/brain-contract';
import type { ProposedAction, TraceStep } from '../../core/brain/harness';
import type { ChatMessage } from '../../core/brain/providers';
import { formatBytes, relativeTime } from '../../core/format';
import { api } from '../api';
import { KIND_ICON, openCite } from '../lib/graph-open';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/ui';
import { PersonaPicker, VoiceButton } from '../components/VoiceTalk';
import { normalizeAgentSettings } from '../../core/agents-config';
import { useAsync, useStore } from '../state';
import '../styles/screens-b.css';
import '../styles/brain.css';

const STARTERS = ['What’s the Wi-Fi password in my screenshots?', 'How much do I owe on open invoices?', 'Summarise my lease: deposit, notice period, rent', 'What can I safely delete to free space?'];

interface Turn {
  q: string;
  reqId: string;
  text: string;
  steps: TraceStep[];
  result?: AskResult;
  error?: string;
  done: Set<number>;
}

const VIS_LABEL = { names: 'file names and details only', snippets: 'names and the passages that matched', full: 'the files it finds, page by page' } as const;

/** Bold text, paragraphs and [[path]] citations; everything else stays plain. */
function Answer({ text, home, onOpen, names }: { text: string; home?: string; onOpen: (p: string) => void; /** names of cited mail, events and other items, by their link */ names?: Map<string, string> }) {
  const expand = (p: string) => (home && p.startsWith('~') ? home + p.slice(1) : p);
  const inline = (s: string, key: string): ReactNode[] =>
    s.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g).map((part, i) => {
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const p = expand(part.slice(2, -2).trim());
        const item = /^(keeper|https?):/.test(p);
        return <button key={`${key}-${i}`} className="cite" title={item ? names?.get(p) ?? p : p} onClick={() => onOpen(p)}><Icon name={item ? (p.startsWith('keeper://mail') ? 'mail' : p.startsWith('keeper://event') ? 'calendar' : 'link') : 'document'} size={11} />{item ? names?.get(p) ?? 'Item' : p.split(/[\\/]/).pop()}</button>;
      }
      if (part.startsWith('**') && part.endsWith('**')) return <b key={`${key}-${i}`}>{part.slice(2, -2)}</b>;
      return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
    });
  return <div className="answer">{text.split(/\n{2,}/).map((para, i) => <p key={i}>{para.split('\n').flatMap((line, j) => (j ? [<br key={`b${j}`} />, ...inline(line, `${i}-${j}`)] : inline(line, `${i}-${j}`)))}</p>)}</div>;
}

function Snip({ h }: { h: BrainHit }) {
  if (!h.snippet) return null;
  const out: ReactNode[] = [];
  let at = 0;
  for (const [a, b] of h.highlights ?? []) {
    out.push(h.snippet.slice(at, a), <mark key={a}>{h.snippet.slice(a, b)}</mark>);
    at = b;
  }
  out.push(h.snippet.slice(at));
  return <div className="snip">{out}</div>;
}

function actionLabel(a: ProposedAction): string {
  const name = a.path.split(/[\\/]/).pop();
  switch (a.type) {
    case 'trash': return `Move ${name} to the Trash`;
    case 'move': return `Move ${name} to ${a.to.split(/[\\/]/).pop()}`;
    case 'rename': return `Rename ${name} to ${a.name}`;
    case 'tag': return `Tag ${name} #${a.tag}`;
    case 'open': return `Open ${name}`;
  }
}

export function Assistant() {
  const { settings, updateSettings, go, trash, info, route, toast, draft, setDraft } = useStore();
  const conns = useAsync(() => api.brain.connections(), [settings?.brain]);
  const [turns, setTurns] = useState<Turn[]>([]);
  // The question being typed is kept with the tab, across restarts and crashes.
  const text = draft('assistant');
  const setText = (v: string) => setDraft('assistant', v);
  const [busy, setBusy] = useState<string | null>(null);
  // "Use this computer" for this conversation; only offered when the person allows it under Agents.
  const computerAllowed = normalizeAgentSettings(settings?.agents).computer.permission !== 'off';
  const [useComputer, setUseComputer] = useState(false);
  const history = useRef<ChatMessage[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const b = settings?.brain;
  const active = conns.data?.connections.find((c) => c.id === conns.data!.active);
  const ready = !!active && (!active.needsKey || active.hasKey);
  const short = (p: string) => (info?.home && p.startsWith(info.home) ? '~' + p.slice(info.home.length) : p);

  // "Ask Keeper" from anywhere (shortcut, keeper://ask, Shortcuts) arrives with the question filled in.
  useEffect(() => {
    if (route.name === 'assistant' && route.arg) setText(route.arg);
  }, [route.name, route.arg]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  useEffect(() => {
    const offD = api.on('brain-delta', (d) => setTurns((t) => t.map((x) => (x.reqId === d.reqId ? { ...x, text: x.text + d.text } : x))));
    const offS = api.on('brain-step', (d) => setTurns((t) => t.map((x) => (x.reqId === d.reqId ? { ...x, steps: [...x.steps, d.step] } : x))));
    return () => { offD(); offS(); };
  }, []);

  // Stop (Island or shortcut) also ends the answer in progress.
  useEffect(() => api.on('computer-stopped', () => { if (busy) void api.brain.cancel(busy); }), [busy]);

  // Abilities: a persona or project for this conversation, and voice.
  const abil = useAsync(() => api.abilities.settings(), []);
  const [who, setWho] = useState<{ persona?: string; project?: string }>({});

  const ask = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    const reqId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setTurns((t) => [...t, { q, reqId, text: '', steps: [], done: new Set() }]);
    setText('');
    setBusy(reqId);
    try {
      const r = await api.brain.ask(reqId, q, history.current.length ? history.current : undefined, { ...(computerAllowed && useComputer ? { computer: true } : {}), persona: who.persona, project: who.project });
      history.current = r.messages;
      setTurns((t) => t.map((x) => (x.reqId === reqId ? { ...x, text: r.answer, result: r } : x)));
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      setTurns((t) => t.map((x) => (x.reqId === reqId ? { ...x, error: msg } : x)));
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (turn: Turn, i: number, a: ProposedAction) => {
    try {
      if (a.type === 'trash') await trash([a.path], 'Assistant: moved to the Trash');
      else if (a.type === 'move') await api.files.move([a.path], a.to);
      else if (a.type === 'rename') await api.files.rename(a.path, a.name);
      else if (a.type === 'tag') {
        const tags = (await api.library.inspect(a.path))?.tags ?? [];
        await api.library.setTags(a.path, [...new Set([...tags, a.tag])]);
      } else await api.files.open(a.path);
      if (a.type !== 'open') toast(actionLabel(a).replace(/^(\w+)/, (m) => ({ Move: 'Moved', Rename: 'Renamed', Tag: 'Tagged' })[m] ?? m));
      setTurns((t) => t.map((x) => (x.reqId === turn.reqId ? { ...x, done: new Set([...x.done, i]) } : x)));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  };

  const newChat = () => { history.current = []; setTurns([]); };

  return (
    <div style={{ maxWidth: 880 }}>
      <PageHead title="Assistant" sub="Ask about anything in your files. It answers from what Keeper has read, and cites the files.">
        {conns.data ? (
          <span className="ai-picker">
            <select className="input" value={conns.data.active} aria-label="AI" onChange={(e) => b && void updateSettings({ brain: { ...b, active: e.target.value } })}>
              {conns.data.connections.map((c) => <option key={c.id} value={c.id}>{c.label}{c.model && c.kind !== 'platform' ? ` · ${c.model}` : ''}</option>)}
            </select>
          </span>
        ) : null}
        {turns.length ? <button className="btn ghost sm" onClick={newChat}><Icon name="plus" size={12} /> New chat</button> : null}
        <button className="btn ghost sm" onClick={() => go({ name: 'settings', arg: 'brain' })}><Icon name="settings" size={12} /> AI &amp; Brain</button>
      </PageHead>

      <div className="card pad small" style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
        <Icon name="lock" size={16} />
        <div>
          The AI sees {VIS_LABEL[b?.visibility ?? 'snippets']}, only from your library folders.{' '}
          {active?.local ? 'This AI runs on this computer, so nothing leaves it.' : 'Passwords, keys and card numbers are blanked out before anything is sent.'}{' '}
          Nothing is moved or deleted unless you press a button.
        </div>
      </div>

      {conns.data && !ready ? (
        <div className="card pad col" style={{ alignItems: 'flex-start', gap: 8 }}>
          <h3>Choose an AI to start</h3>
          <p className="small muted" style={{ margin: 0 }}>Use Claude, OpenAI or any compatible service with your own key, a model on this computer (Ollama, LM Studio), or your computer’s built-in AI where there is one. Everything else in Keeper works without it.</p>
          <button className="btn primary" onClick={() => go({ name: 'settings', arg: 'brain' })}>Set up an AI</button>
        </div>
      ) : (
        <div className="chat">
          {!turns.length ? (
            <div className="chips">
              {STARTERS.map((s) => <button key={s} className="chip" style={{ paddingRight: 10 }} onClick={() => void ask(s)}>{s}</button>)}
            </div>
          ) : null}
          {turns.map((t) => (
            <div key={t.reqId} className="col" style={{ gap: 8 }}>
              <div className="msg user">{t.q}</div>
              {t.steps.length ? (
                <details className="trace">
                  <summary><Icon name="search" size={12} /> {busy === t.reqId ? t.steps[t.steps.length - 1].summary + '…' : `Looked at ${t.steps.length} thing${t.steps.length === 1 ? '' : 's'}`}</summary>
                  <ol>{t.steps.map((s, i) => <li key={i} className={s.error ? 'err' : ''}>{s.tool.replace(/_/g, ' ')}: {s.summary} <span className="muted">· {s.ms} ms</span></li>)}</ol>
                </details>
              ) : null}
              {t.text ? <div className="msg assistant"><Answer text={t.text} home={info?.home} names={new Map((t.result?.sources ?? []).filter((h) => h.item).map((h) => [h.path, h.name]))} onOpen={(p) => (/^(keeper|https?):/.test(p) ? openCite(p, go) : void api.files.open(p))} /></div> : null}
              {busy === t.reqId && !t.text ? <div className="msg assistant row"><div className="spinner" /> {t.steps.length ? 'Reading…' : 'Searching your files…'}</div> : null}
              {t.error ? <div className="msg assistant" style={{ color: 'var(--danger)' }}>{t.error}</div> : null}
              {t.result?.actions.length ? (
                <div className="card actions-card">
                  <div className="small muted" style={{ padding: '2px 6px' }}>Suggested — nothing happens until you press a button</div>
                  {t.result.actions.map((a, i) => (
                    <div key={i} className="action-row">
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="ellipsis" title={a.path}>{actionLabel(a)}</div>
                        {a.reason ? <div className="small muted">{a.reason}</div> : null}
                      </div>
                      {t.done.has(i) ? <span className="badge ok"><Icon name="check" size={11} /> Done</span> : (
                        <button className={`btn sm ${a.type === 'trash' ? 'danger' : ''}`} onClick={() => void runAction(t, i, a)}>
                          <Icon name={a.type === 'trash' ? 'trash' : a.type === 'tag' ? 'tag' : a.type === 'open' ? 'external' : a.type === 'rename' ? 'rename' : 'folder'} size={12} /> {a.type === 'trash' ? 'Trash' : a.type[0].toUpperCase() + a.type.slice(1)}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              {t.result?.sources.length ? (
                <details className="card" open={t.result.sources.length <= 3}>
                  <summary className="small muted" style={{ padding: '8px 12px', cursor: 'default' }}>Sources ({t.result.sources.length}) · {t.result.provider}{t.result.model && t.result.model !== 'on-device' ? ` · ${t.result.model}` : ''}{t.result.redacted ? ` · ${Object.values(t.result.redacted).reduce((n, x) => n + x, 0)} secret(s) blanked` : ''}{t.result.retrievalOnly ? ' · looked up first' : ''}</summary>
                  <div className="sources">
                    {t.result.sources.map((h) => (
                      <button key={h.path} className="source" onClick={() => (h.item || /^(keeper|https?):/.test(h.path) ? openCite(h.path, go) : void api.files.reveal(h.path))} title={h.item ? `Open ${h.name}` : `Show ${h.path}`}>
                        <Icon name={h.item ? (h.item === 'contact' ? 'smile' : KIND_ICON[h.item]) : h.kind === 'image' ? 'image' : h.kind === 'video' ? 'video' : h.kind === 'audio' ? 'audio' : 'document'} size={14} />
                        <div className="grow" style={{ minWidth: 0 }}>
                          <div className="ellipsis">{h.item ? h.name : short(h.path)}</div>
                          <Snip h={h} />
                        </div>
                        <span className="small muted">{h.size ? formatBytes(h.size) : ''}{h.mtime ? ` · ${relativeTime(h.mtime)}` : ''}</span>
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
              {t.result && !t.error ? (
                <div className="btn-row" style={{ marginTop: 6 }}>
                  <button className="btn sm ghost" title="Turn what worked into a skill the assistant and other agents can reuse" onClick={async () => {
                    const draft = await api.agents.draftSkill({ title: t.q.slice(0, 60), question: t.q, answer: t.result!.answer, steps: t.result!.trace.map((s) => ({ tool: s.tool, summary: s.summary, args: s.args })) });
                    openSkillDraft(draft);
                    go({ name: 'agents', arg: 'skills' });
                  }}><Icon name="sparkle" size={12} /> Save as skill</button>
                </div>
              ) : null}
            </div>
          ))}
          <div ref={end} />
          {computerAllowed ? (
            <label className={`computer-toggle ${useComputer ? 'on' : ''}`} title="The AI may see the screen, move the pointer, click and type, within your rules under Agents. Stop it any time from the Island.">
              <input type="checkbox" checked={useComputer} onChange={(e) => setUseComputer(e.target.checked)} />
              <Icon name="laptop" size={13} /> Let it use this computer
            </label>
          ) : null}
          <div className="composer" style={{ position: 'relative' }}>
            <PersonaPicker personas={abil.data?.personas ?? []} projects={abil.data?.projects ?? []} persona={who.persona} project={who.project} onChange={setWho} />
            <textarea
              className="input"
              placeholder={useComputer && computerAllowed ? 'Ask it to do something on this computer…' : 'Ask anything about your files…'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text); } }}
            />
            {abil.data?.enabled && abil.data.voice.stt !== 'off' ? <VoiceButton onText={(t) => void ask(t)} busy={!!busy} lastAnswer={turns[turns.length - 1]?.text} handsFree={abil.data.voice.handsFree} /> : null}
            {busy ? (
              <button className="btn" onClick={() => void api.brain.cancel(busy)} style={{ height: 42 }}><Icon name="close" size={14} /> Stop</button>
            ) : (
              <button className="btn primary" disabled={!text.trim()} onClick={() => void ask(text)} style={{ height: 42 }}><Icon name="send" size={14} /> Ask</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
