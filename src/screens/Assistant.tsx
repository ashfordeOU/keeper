// SPDX-License-Identifier: AGPL-3.0-or-later
// Assistant: ask what is safe to remove. It only sees names, sizes and dates.

import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../../core/format';
import type { AiMessage, AiReply } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Check, PageHead, SafetyBadge } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-b.css';

const PROVIDER = { anthropic: 'Claude', openai: 'OpenAI', ollama: 'Local model' } as const;
const STARTERS = ['What can I safely delete?', 'Why is my disk full?', 'Find old installers I no longer need', 'Which big files have I not opened in a year?'];

interface Turn {
  msg: AiMessage;
  reply?: AiReply;
}

export function Assistant() {
  const { settings, go, trash, info } = useStore();
  const provider = settings?.ai.provider ?? 'anthropic';
  const hasKey = useAsync(() => (provider === 'ollama' ? Promise.resolve(true) : api.settings.hasSecret(provider)), [provider]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const short = (p: string) => (info?.home && p.startsWith(info.home) ? '~' + p.slice(info.home.length) : p);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const history: AiMessage[] = [...turns.map((t) => t.msg), { role: 'user', content: q.trim() }];
    setTurns((t) => [...t, { msg: { role: 'user', content: q.trim() } }]);
    setText('');
    setBusy(true);
    setError(null);
    try {
      const reply = await api.ai.ask(history);
      setTurns((t) => [...t, { msg: { role: 'assistant', content: reply.text }, reply }]);
      setPicked((s) => new Set([...s, ...reply.suggestions.filter((x) => x.safety === 'safe').map((x) => x.path)]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const trashPicked = async (paths: string[]) => {
    if (!paths.length) return;
    await trash(paths, `Assistant: moved ${paths.length} item${paths.length === 1 ? '' : 's'} to the Trash`);
    setPicked((s) => new Set([...s].filter((p) => !paths.includes(p))));
    setTurns((t) => t.map((x) => (x.reply ? { ...x, reply: { ...x.reply, suggestions: x.reply.suggestions.filter((s) => !paths.includes(s.path)) } } : x)));
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead title="Assistant" sub="Ask about your disk in your own words. Nothing is removed unless you press a button.">
        <span className="badge accent"><Icon name="assistant" size={11} /> {PROVIDER[provider]}</span>
        <button className="btn ghost sm" onClick={() => go({ name: 'settings' })}>Change</button>
      </PageHead>

      <div className="card pad small" style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
        <Icon name="lock" size={16} />
        <div>
          The assistant only sees file names, folders, sizes and dates — never what is inside your files.
          {provider === 'ollama' ? ' You are using a local model, so nothing leaves this computer.' : ' Choose “Local” in Settings to keep everything on this computer.'}
        </div>
      </div>

      {hasKey.data === false ? (
        <div className="card pad col" style={{ alignItems: 'flex-start', gap: 8 }}>
          <h3>Add your API key to start</h3>
          <p className="small muted" style={{ margin: 0 }}>The assistant uses your own {PROVIDER[provider]} key, stored encrypted by your system’s keychain. Everything else in Keeper works without it.</p>
          <button className="btn primary" onClick={() => go({ name: 'settings' })}>Open Settings</button>
        </div>
      ) : (
        <div className="chat">
          {!turns.length ? (
            <div className="chips">
              {STARTERS.map((s) => <button key={s} className="chip" style={{ paddingRight: 10 }} onClick={() => void ask(s)}>{s}</button>)}
            </div>
          ) : null}
          {turns.map((t, i) => (
            <div key={i} className="col" style={{ gap: 8 }}>
              {t.msg.content ? <div className={`msg ${t.msg.role}`}>{t.msg.content}</div> : null}
              {t.reply?.suggestions.length ? (
                <div className="card" style={{ padding: 8 }}>
                  {t.reply.suggestions.map((s) => (
                    <div key={s.path} className="item-row">
                      <Check on={picked.has(s.path)} onChange={(v) => setPicked((p) => { const n = new Set(p); if (v) n.add(s.path); else n.delete(s.path); return n; })} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="ellipsis" title={s.path}>{short(s.path)}</div>
                        <div className="small muted">{s.reason}</div>
                      </div>
                      <SafetyBadge safety={s.safety} />
                      <span className="num muted">{formatBytes(s.size)}</span>
                      <button className="btn ghost sm icon" title="Show in folder" onClick={() => void api.files.reveal(s.path)}><Icon name="reveal" size={13} /></button>
                    </div>
                  ))}
                  <div className="row" style={{ padding: '8px 6px 2px', justifyContent: 'space-between' }}>
                    <span className="small muted">{formatBytes(t.reply.suggestions.filter((s) => picked.has(s.path)).reduce((n, s) => n + s.size, 0))} selected</span>
                    <button className="btn danger sm" disabled={!t.reply.suggestions.some((s) => picked.has(s.path))} onClick={() => void trashPicked(t.reply!.suggestions.filter((s) => picked.has(s.path)).map((s) => s.path))}>
                      <Icon name="trash" size={12} /> Move selected to Trash
                    </button>
                  </div>
                </div>
              ) : null}
              {t.reply?.search ? (
                <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => go({ name: 'search', q: t.reply!.search })}><Icon name="search" size={12} /> Run this search: “{t.reply.search}”</button>
              ) : null}
            </div>
          ))}
          {busy ? <div className="msg assistant row"><div className="spinner" /> Looking at your files…</div> : null}
          {error ? <div className="msg assistant" style={{ color: 'var(--danger)' }}>{error}</div> : null}
          <div ref={end} />
          <div className="composer">
            <textarea
              className="input"
              placeholder="Ask anything about your files and space…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text); } }}
            />
            <button className="btn primary" disabled={!text.trim() || busy} onClick={() => void ask(text)} style={{ height: 42 }}><Icon name="send" size={14} /> Ask</button>
          </div>
        </div>
      )}
    </div>
  );
}
