// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Dictation's home: how to talk anywhere (the key, the shortcut), the live
// text, statistics, history with search, the personal dictionary and
// snippets, per-app tone and rules, speech models and every setting —
// including where dictation shows up (menu bar, Island, palette).

import { useEffect, useMemo, useState } from 'react';
import { COMMAND_TABLE, CASE_COMMANDS } from '../../core/voice/tidy';
import { HOLD_KEYS, holdKeyLabel } from '../../core/voice/settings';
import type { AppRule, DeepPartial, DictationState, DictationStats, DictEntry, Snippet, Take, Tone, VoiceSettings, VoiceStatus } from '../../core/voice/types';
import { WHISPER_LANGS, WHISPER_MODELS, type WhisperSize } from '../../core/whisper';
import { api } from '../api';
import { useFeature } from '../features';
import { Icon } from '../components/Icon';
import { Empty, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { Row } from './IslandSettings';
import { statsPng } from '../voice/stats-png';
import '../voice/voice.css';
import { ComponentPrompt } from '../components/ComponentsPanel';
import { Tabs } from '../components/Tabs';

type Tab = 'dictate' | 'history' | 'words' | 'apps' | 'settings';
const isMac = navigator.platform.includes('Mac');
const plat = isMac ? 'darwin' : navigator.platform.startsWith('Win') ? 'win32' : 'linux';
const pretty = (s: string) => s.replace('CommandOrControl', isMac ? '⌘' : 'Ctrl').replace(/\+/g, ' ');
const uid = () => Math.random().toString(36).slice(2, 10);
const LANG_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });
const langName = (c: string) => { try { return LANG_NAMES.of(c) ?? c; } catch { return c; } };
const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86_400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };

export function Dictation({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>((['dictate', 'history', 'words', 'apps', 'settings'].includes(initialTab ?? '') ? initialTab : 'dictate') as Tab);
  const [cfg, setCfg] = useState<VoiceSettings | null>(null);
  const [st, setSt] = useState<VoiceStatus | null>(null);
  const [live, setLive] = useState<DictationState | null>(null);
  useEffect(() => {
    void api.voice.settings().then(setCfg);
    void api.voice.status().then((s) => { setSt(s); setLive(s.dictation); });
    const offs = [
      api.on('voice-state', (s) => setLive(s)),
      api.on('voice-settings', (s) => setCfg(s)),
      api.on('voice-download', () => void api.voice.status().then(setSt)),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  if (!cfg || !st || !live) return <div className="page"><PageHead title="Dictation" /></div>;
  const save = async (patch: DeepPartial<VoiceSettings>) => setCfg(await api.voice.setSettings(patch));
  return (
    <div className="page voice-page" data-testid="dictation-page">
      <PageHead title="Dictation" sub="Speak in any app and finished text appears where your cursor is. Recognised on this computer unless you choose a service." />
      <ComponentPrompt featureId="dictation" />
      <Tabs label="Dictation" value={tab} onChange={setTab} items={([['dictate', 'Dictate'], ['history', 'History'], ['words', 'Words & snippets'], ['apps', 'Per app'], ['settings', 'Settings']] as const).map(([k, l]) => ({ id: k, label: l, testId: `dictation-tab-${k}` }))} />
      {tab === 'dictate' ? <DictateTab cfg={cfg} st={st} live={live} save={save} refresh={() => void api.voice.status().then(setSt)} /> : null}
      {tab === 'history' ? <HistoryTab /> : null}
      {tab === 'words' ? <WordsTab cfg={cfg} save={save} /> : null}
      {tab === 'apps' ? <AppsTab cfg={cfg} save={save} /> : null}
      {tab === 'settings' ? <SettingsTab cfg={cfg} st={st} save={save} refresh={() => void api.voice.status().then(setSt)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- dictate

function DictateTab({ cfg, st, live, save, refresh }: { cfg: VoiceSettings; st: VoiceStatus; live: DictationState; save: (p: DeepPartial<VoiceSettings>) => Promise<void>; refresh: () => void }) {
  const { toast } = useStore();
  const holdOn = useFeature('dictationHold');
  const [stats, setStats] = useState<DictationStats | null>(null);
  useEffect(() => { void api.voice.stats().then(setStats); }, [live.phase]);
  const active = live.phase !== 'idle';
  const key = holdKeyLabel(cfg.dictation.key, plat);
  const noModel = cfg.dictation.engine === 'device' && !st.models.includes(cfg.dictation.model);
  const max = Math.max(1, ...(stats?.spark ?? [1]));
  return (
    <>
      <div className={`card voice-hero${active ? ' on' : ''}`} data-testid="dictation-hero">
        <button className={`voice-big${active ? ' on' : ''}`} aria-pressed={active} aria-label={active ? 'Stop dictating' : 'Start dictating'} data-testid="dictation-toggle"
          onClick={() => void (active ? api.voice.stop() : api.voice.start('toggle')).catch((e) => toast(e instanceof Error ? e.message : String(e)))}>
          <Icon name="mic" size={28} />
        </button>
        <div className="voice-hero-txt">
          <div className="voice-state">{live.phase === 'idle' ? 'Ready when you are' : live.phase === 'working' ? 'Writing it down…' : live.phase === 'review' ? 'Waiting for you to check it' : 'Listening…'}</div>
          {active && (live.stable || live.pending) ? <div className="voice-live" data-testid="dictation-live">{live.stable} <span className="p">{live.pending}</span></div> : (
            <div className="muted">
              {holdOn && st.supports.holdKey ? <>Hold <span className="voice-key">{key}</span> in any app and speak; let go to type it. Tap it to lock on.</> : <>Press <span className="voice-key">{pretty(cfg.dictation.shortcut)}</span> in any app to start, and again to finish.</>}
              {' '}Esc throws a take away.
            </div>
          )}
          {live.error ? <div className="voice-note"><Icon name="warning" size={12} /> {live.error}</div> : null}
          {holdOn && !st.supports.holdKey && st.supports.keyHow ? <div className="voice-note" data-testid="dictation-keynote"><Icon name="info" size={12} /> {st.supports.keyHow}</div> : null}
          {noModel ? <div className="voice-note"><Icon name="info" size={12} /> The speech model ({WHISPER_MODELS[cfg.dictation.model].label}) downloads the first time you dictate.</div> : null}
        </div>
        <div className="awake-hero-ctl" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => void api.voice.start('edit').catch((e) => toast(String(e instanceof Error ? e.message : e)))} disabled={cfg.dictation.voiceEdit === 'off'} title="Select text in any app first"><Icon name="sparkle" size={12} /> Edit selection by voice</button>
        </div>
      </div>

      <h2 className="voice-h">How you talk</h2>
      <div className="card settings-section">
        <Row title="Hold a key to talk" desc={holdOn ? (st.supports.holdKey ? `Listening for ${key} with the ${st.supports.keyHow}.` : st.supports.keyHow) : 'Off: the shortcut starts and stops dictation. Turning this on listens for one key (and Esc) only.'}>
          <Toggle on={holdOn} onChange={(v) => void api.features.set('dictationHold', v).then(() => setTimeout(refresh, 800))} />
        </Row>
        {holdOn ? (
          <Row title="Talk key" desc="Right-hand modifiers and F13–F19 rarely clash with anything.">
            <select className="input" value={cfg.dictation.key} data-testid="dictation-key" onChange={(e) => void save({ dictation: { key: e.target.value as VoiceSettings['dictation']['key'] } }).then(() => setTimeout(refresh, 800))}>
              {HOLD_KEYS.filter((k) => !k.mac || isMac).map((k) => <option key={k.id} value={k.id}>{holdKeyLabel(k.id, plat)}</option>)}
            </select>
          </Row>
        ) : null}
        <Row title="How it listens" desc={cfg.dictation.mode === 'hold' ? 'Talk while the key is held; a quick tap locks it on.' : cfg.dictation.mode === 'toggle' ? 'Press once to start, again to finish.' : `Starts when you press; stops by itself after ${cfg.dictation.silenceSec} s of quiet.`}>
          <div className="seg">{(['hold', 'toggle', 'handsfree'] as const).map((m) => <button key={m} className={cfg.dictation.mode === m ? 'on' : ''} onClick={() => void save({ dictation: { mode: m } })}>{{ hold: 'Hold', toggle: 'Press to toggle', handsfree: 'Hands-free' }[m]}</button>)}</div>
        </Row>
        <Row title="Tap to lock on" desc="A quick tap keeps listening until you press again — for long takes."><Toggle on={cfg.dictation.doubleTapLatch} onChange={(v) => void save({ dictation: { doubleTapLatch: v } })} /></Row>
        <Row title="Shortcut" desc="Works everywhere, with or without the talk key."><kbd className="badge">{pretty(cfg.dictation.shortcut)}</kbd></Row>
        <Row title="Check before typing" desc="Shows the finished text first: Return types it, Esc keeps it in history."><Toggle on={cfg.dictation.review} onChange={(v) => void save({ dictation: { review: v } })} /></Row>
        <Row title="Sounds" desc="A soft tone when listening starts and stops."><Toggle on={cfg.dictation.sounds} onChange={(v) => void save({ dictation: { sounds: v } })} /></Row>
      </div>

      {stats ? (
        <>
          <h2 className="voice-h">Your dictation <span className="muted small">(on this computer only)</span>
            <button className="btn sm" style={{ marginLeft: 'auto' }} data-testid="dictation-stats-png" onClick={() => void api.voice.saveStatsPng(statsPng(stats, cfg.dictation.typingWpm)).then((p) => toast(`Saved ${p}`)).catch((e) => toast(String(e instanceof Error ? e.message : e)))}><Icon name="image" size={12} /> Save as picture</button>
          </h2>
          <div className="card" data-testid="dictation-stats">
            <div className="voice-stats">
              <div><b>{stats.words.toLocaleString()}</b><span>words</span></div>
              <div><b>{Math.round(stats.minutesSaved)} min</b><span>saved vs typing at {cfg.dictation.typingWpm} wpm</span></div>
              <div><b>{stats.takes}</b><span>takes</span></div>
              <div><b>{stats.activeDays28}</b><span>active days (28)</span></div>
              <div><b>{stats.dailyAverage}</b><span>words a day</span></div>
            </div>
            <div className="voice-spark" aria-label="Words per day, last 28 days">{stats.spark.map((n, i) => <i key={i} style={{ height: `${Math.max(4, (n / max) * 100)}%` }} title={`${n} words`} />)}</div>
          </div>
        </>
      ) : null}

      <h2 className="voice-h">Spoken commands</h2>
      <div className="card">
        <div className="voice-cmds">
          {COMMAND_TABLE.map((c) => <div key={c.say[0]}><span>“{c.say[0]}”</span><code>{c.out}</code></div>)}
          {CASE_COMMANDS.map((c) => <div key={c}><span>{c}</span></div>)}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- history

function HistoryTab() {
  const { toast } = useStore();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Take[] | null>(null);
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const load = () => void api.voice.history({ query: q, limit: 300 }).then(setList);
  useEffect(load, [q]);
  useEffect(() => api.on('voice-state', (s) => { if (s.phase === 'idle') load(); }), [q]);
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: '1 1 260px' }} placeholder="Search what you said…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="dictation-search" />
        <button className="btn" onClick={() => { if (confirm('Delete the whole dictation history (and any kept recordings)?')) void api.voice.clearHistory().then(load); }}><Icon name="trash" size={13} /> Clear</button>
      </div>
      {!list ? null : !list.length ? <Empty icon="mic" title={q ? 'Nothing matches' : 'Nothing dictated yet'}>{q ? 'Try other words.' : 'What you dictate shows up here, with the app it went to.'}</Empty> : (
        <div className="card voice-list" data-testid="dictation-history">
          {list.map((t) => (
            <div className="voice-take" key={t.id}>
              <div className="meta"><b>{t.app ?? 'Unknown app'}</b><span>{ago(t.at)}</span><span>{t.words} words · {(t.durationMs / 1000).toFixed(1)} s</span>{t.outcome !== 'typed' ? <span className="badge">{t.outcome === 'kept' ? 'kept, not typed' : t.outcome}</span> : null}{t.language ? <span>{langName(t.language)}</span> : null}</div>
              <div className="acts">
                <button className="btn icon sm ghost" title="Copy" aria-label="Copy" onClick={() => void api.voice.reuseTake(t.id, 'copy').then(() => toast('Copied'))}><Icon name="copy" size={13} /></button>
                <button className="btn icon sm ghost" title="Fix the words (Keeper learns the corrections)" aria-label="Fix the words (Keeper learns the corrections)" onClick={() => setEdit({ id: t.id, text: t.text })}><Icon name="rename" size={13} /></button>
                {t.audio ? <button className="btn icon sm ghost" title="Play the recording" aria-label="Play the recording" onClick={() => { const a = new Audio(api.preview.url(t.audio!)); void a.play(); }}><Icon name="play" size={13} /></button> : null}
                <button className="btn icon sm ghost" title="Delete" aria-label="Delete" onClick={() => void api.voice.removeTake(t.id).then(load)}><Icon name="trash" size={13} /></button>
              </div>
              {edit?.id === t.id ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <textarea className="input" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={3} />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn sm primary" onClick={() => void api.voice.correct(t.id, edit.text).then((sug) => { setEdit(null); load(); if (sug.length) toast(`Suggested for your dictionary: ${sug.map((s) => s.word).join(', ')} (Words & snippets)`); })}>Save</button>
                    <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
                  </div>
                </div>
              ) : <div className="txt">{t.text}</div>}
              {t.raw !== t.text ? <div className="raw" title="What was heard">Heard: {t.raw}</div> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- dictionary and snippets

function WordsTab({ cfg, save }: { cfg: VoiceSettings; save: (p: DeepPartial<VoiceSettings>) => Promise<void> }) {
  const { go } = useStore();
  const [word, setWord] = useState('');
  const [heard, setHeard] = useState('');
  const [trig, setTrig] = useState('');
  const [text, setText] = useState('');
  const [tryIn, setTryIn] = useState('um so let us meet at three thirty pm no wait four pm comma email anna dot lee at example dot com new line thanks thumbs up emoji');
  const [tryOut, setTryOut] = useState('');
  useEffect(() => { const t = setTimeout(() => void api.voice.preview(tryIn).then(setTryOut), 200); return () => clearTimeout(t); }, [tryIn, cfg]);
  const dict = cfg.dictionary.filter((e) => !e.suggested);
  const sugg = cfg.dictionary.filter((e) => e.suggested && (e.uses ?? 0) >= 2);
  const setDict = (d: DictEntry[]) => save({ dictionary: d });
  const setSnips = (s: Snippet[]) => save({ snippets: s });
  return (
    <>
      <h2 className="voice-h">Try the tidy-up</h2>
      <div className="card voice-try">
        <textarea className="input" value={tryIn} onChange={(e) => setTryIn(e.target.value)} aria-label="What you might say" data-testid="dictation-try-in" />
        <div className="out" data-testid="dictation-try-out">{tryOut}</div>
      </div>

      {sugg.length ? (
        <>
          <h2 className="voice-h">Suggested from your corrections</h2>
          <div className="card settings-section">
            {sugg.map((e) => (
              <Row key={e.id} title={e.word} desc={`You changed “${(e.heard ?? []).join('”, “')}” to this ${e.uses} times.`}>
                <button className="btn sm primary" onClick={() => void setDict(cfg.dictionary.map((x) => (x.id === e.id ? { ...x, suggested: false } : x)))}>Add</button>
                <button className="btn sm" onClick={() => void setDict(cfg.dictionary.filter((x) => x.id !== e.id))}>Dismiss</button>
              </Row>
            ))}
          </div>
        </>
      ) : null}

      <div className="voice-grid">
        <div>
          <h2 className="voice-h">Personal dictionary</h2>
          <div className="card">
            <div className="voice-scroll">
              <table className="voice-table" data-testid="dictation-dictionary">
                <thead><tr><th>Write it as</th><th>When it’s heard as</th><th /></tr></thead>
                <tbody>
                  {dict.map((e) => (
                    <tr key={e.id}>
                      <td><b>{e.word}</b></td>
                      <td className="muted">{(e.heard ?? []).join(', ') || '—'}</td>
                      <td style={{ width: 32 }}><button className="btn icon sm ghost" title="Remove" aria-label="Remove" onClick={() => void setDict(cfg.dictionary.filter((x) => x.id !== e.id))}><Icon name="close" size={12} /></button></td>
                    </tr>
                  ))}
                  <tr>
                    <td><input className="input" placeholder="e.g. Kubernetes" value={word} onChange={(e) => setWord(e.target.value)} data-testid="dictation-word" /></td>
                    <td><input className="input" placeholder="cooper netties (optional)" value={heard} onChange={(e) => setHeard(e.target.value)} /></td>
                    <td><button className="btn icon sm" title="Add" aria-label="Add" disabled={!word.trim()} data-testid="dictation-word-add" onClick={() => { void setDict([...cfg.dictionary, { id: uid(), word: word.trim(), heard: heard.split(',').map((x) => x.trim()).filter(Boolean) }]); setWord(''); setHeard(''); }}><Icon name="plus" size={12} /></button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="meet-consent"><Icon name="info" size={12} /> Words here are handed to the recognizer before it listens, so it spells them your way, and fixed afterwards when it doesn’t.</div>
          </div>
        </div>
        <div>
          <h2 className="voice-h">Snippets</h2>
          <div className="card">
            <div className="voice-scroll">
              <table className="voice-table" data-testid="dictation-snippets">
                <thead><tr><th>Say</th><th>Types exactly</th><th /></tr></thead>
                <tbody>
                  {cfg.snippets.filter((s) => s.trigger).map((s) => (
                    <tr key={s.id}>
                      <td><b>{s.trigger}</b>{s.abbr ? <div className="small muted">or type {s.abbr}</div> : null}</td>
                      <td className="muted" style={{ whiteSpace: 'pre-wrap' }}>{s.text.length > 80 ? s.text.slice(0, 79) + '…' : s.text}</td>
                      <td style={{ width: 32 }}><button className="btn icon sm ghost" title="Remove" aria-label="Remove" onClick={() => void setSnips(cfg.snippets.filter((x) => x.id !== s.id))}><Icon name="close" size={12} /></button></td>
                    </tr>
                  ))}
                  <tr>
                    <td><input className="input" placeholder="my address" value={trig} onChange={(e) => setTrig(e.target.value)} /></td>
                    <td><textarea className="input" rows={1} placeholder="12 High Street…" value={text} onChange={(e) => setText(e.target.value)} /></td>
                    <td><button className="btn icon sm" title="Add" aria-label="Add" disabled={!trig.trim() || !text} onClick={() => { void setSnips([...cfg.snippets, { id: uid(), trigger: trig.trim(), text }]); setTrig(''); setText(''); }}><Icon name="plus" size={12} /></button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="meet-consent"><Icon name="info" size={12} /> Say the trigger on its own (said a little differently is fine), or “snippet my address” inside a sentence. To type them too, give them an abbreviation in <button className="btn sm ghost" onClick={() => go({ name: 'snippets' })}>Typed Snippets</button>.</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- per app

const TONES: [Tone, string][] = [['auto', 'Auto'], ['casual', 'Casual'], ['neutral', 'Neutral'], ['professional', 'Professional'], ['verbatim', 'Verbatim']];

function AppsTab({ cfg, save }: { cfg: VoiceSettings; save: (p: DeepPartial<VoiceSettings>) => Promise<void> }) {
  const [apps, setApps] = useState<string[]>([]);
  useEffect(() => { void api.awake?.apps?.().then(setApps).catch(() => undefined); }, []);
  const set = (rules: AppRule[]) => save({ apps: rules });
  const upd = (id: string, patch: Partial<AppRule>) => set(cfg.apps.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <>
      <div className="card settings-section">
        <Row title="Tone everywhere else" desc="Auto: verbatim and exact in terminals, neutral elsewhere.">
          <select className="input" value={cfg.dictation.tone} onChange={(e) => void save({ dictation: { tone: e.target.value as Tone } })}>{TONES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select>
        </Row>
        <Row title="Spoken commands" desc="“new line”, “comma”, “all caps”… Everywhere, or only in editors and terminals.">
          <div className="seg">{(['everywhere', 'editors', 'off'] as const).map((m) => <button key={m} className={cfg.dictation.commands === m ? 'on' : ''} onClick={() => void save({ dictation: { commands: m } })}>{{ everywhere: 'Everywhere', editors: 'Editors and terminals', off: 'Off' }[m]}</button>)}</div>
        </Row>
      </div>
      <h2 className="voice-h">Rules for apps</h2>
      <div className="card voice-scroll">
        <table className="voice-table" data-testid="dictation-apps">
          <thead><tr><th>App</th><th>Tone</th><th>Text</th><th>Put it in by</th><th>Commands</th><th>Never type here</th><th /></tr></thead>
          <tbody>
            {cfg.apps.map((r) => (
              <tr key={r.id}>
                <td style={{ minWidth: 140 }}><input className="input" value={r.app} list="voice-apps" onChange={(e) => void upd(r.id, { app: e.target.value })} /></td>
                <td><select className="input" value={r.tone ?? 'auto'} onChange={(e) => void upd(r.id, { tone: e.target.value as Tone })}>{TONES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></td>
                <td><select className="input" value={r.mode ?? 'auto'} onChange={(e) => void upd(r.id, { mode: e.target.value as AppRule['mode'] })}><option value="auto">Auto</option><option value="prose">Prose</option><option value="exact">Exact (code, shells)</option></select></td>
                <td><select className="input" value={r.insert ?? ''} onChange={(e) => void upd(r.id, { insert: (e.target.value || undefined) as AppRule['insert'] })}><option value="">Default</option><option value="paste">Pasting</option><option value="type">Typing keys</option><option value="copy">Copying only</option></select></td>
                <td><select className="input" value={r.commands === undefined ? '' : r.commands ? 'on' : 'off'} onChange={(e) => void upd(r.id, { commands: e.target.value === '' ? undefined : e.target.value === 'on' })}><option value="">Default</option><option value="on">On</option><option value="off">Off</option></select></td>
                <td><Toggle on={!!r.exclude} onChange={(v) => void upd(r.id, { exclude: v })} /></td>
                <td><button className="btn icon sm ghost" title="Remove" aria-label="Remove" onClick={() => void set(cfg.apps.filter((x) => x.id !== r.id))}><Icon name="close" size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="voice-apps">{apps.map((a) => <option key={a} value={a} />)}</datalist>
        <div style={{ padding: 10 }}><button className="btn sm" onClick={() => void set([...cfg.apps, { id: uid(), app: '' }])}><Icon name="plus" size={12} /> Add an app</button></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- settings

function SettingsTab({ cfg, st, save, refresh }: { cfg: VoiceSettings; st: VoiceStatus; save: (p: DeepPartial<VoiceSettings>) => Promise<void>; refresh: () => void }) {
  const { toast, go } = useStore();
  const d = cfg.dictation;
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => { void navigator.mediaDevices?.enumerateDevices?.().then((l) => setMics(l.filter((x) => x.kind === 'audioinput' && x.deviceId !== 'default' && x.deviceId !== 'communications'))).catch(() => undefined); }, []);
  const langs = useMemo(() => [...WHISPER_LANGS].map((c) => ({ c, n: langName(c) })).sort((a, b) => a.n.localeCompare(b.n)), []);
  return (
    <>
      <h2 className="voice-h">Speech recognition</h2>
      <div className="card settings-section">
        <Row title="Recognised" desc={d.engine === 'device' ? 'On this computer: nothing leaves it. Live text while you speak.' : d.engine === 'system' ? 'macOS’s own on-device recognizer.' : 'By the speech service in Island settings (your key). The recording is sent there.'}>
          <div className="seg">
            <button className={d.engine === 'device' ? 'on' : ''} onClick={() => void save({ dictation: { engine: 'device' } })}>On this computer</button>
            {st.supports.systemEngine ? <button className={d.engine === 'system' ? 'on' : ''} onClick={() => void save({ dictation: { engine: 'system' } })}>macOS recognizer</button> : null}
            <button className={d.engine === 'cloud' ? 'on' : ''} data-testid="dictation-engine-cloud" onClick={() => void save({ dictation: { engine: 'cloud' } })}>A service</button>
          </div>
        </Row>
        {d.engine === 'cloud' ? <Row title="Service" desc="Address, model and key are set with the Island’s settings."><button className="btn sm" onClick={() => go({ name: 'island' })}>Open Island settings</button></Row> : null}
        <Row title="Language" desc="Automatic works out the language from what you say.">
          <select className="input" value={d.language} onChange={(e) => void save({ dictation: { language: e.target.value } })} data-testid="dictation-language">
            <option value="auto">Automatic</option>
            {langs.map((l) => <option key={l.c} value={l.c}>{l.n}</option>)}
          </select>
        </Row>
        <Row title="Write it in English" desc="Translates what you say into English as it’s written."><Toggle on={d.translate} onChange={(v) => void save({ dictation: { translate: v } })} /></Row>
      </div>

      <h2 className="voice-h">Speech models <span className="muted small">(shared with meetings and file transcription)</span></h2>
      <div className="card voice-models" data-testid="dictation-models">
        {(Object.keys(WHISPER_MODELS) as WhisperSize[]).map((size) => {
          const m = WHISPER_MODELS[size];
          const have = st.models.includes(size);
          const dl = st.downloading?.size === size ? st.downloading.fraction : undefined;
          return (
            <div className="voice-model" key={size}>
              <input type="radio" name="vmodel" checked={d.model === size} onChange={() => void save({ dictation: { model: size } })} aria-label={`Use ${m.label}`} />
              <div className="grow"><b>{size === 'turbo' ? 'Large v3 turbo' : size[0].toUpperCase() + size.slice(1)}</b> <span className="muted">· {m.label}</span>{have ? <span className="badge ok" style={{ marginLeft: 6 }}>On this computer</span> : null}</div>
              {dl !== undefined ? <div className="voice-bar"><i style={{ width: `${Math.round(dl * 100)}%` }} /></div> : have
                ? <button className="btn sm" onClick={() => void api.voice.removeModel(size).then(refresh)}>Remove</button>
                : <button className="btn sm" onClick={() => void api.voice.downloadModel(size).then(refresh).catch((e) => toast(String(e instanceof Error ? e.message : e)))}><Icon name="down" size={12} /> Download</button>}
            </div>
          );
        })}
      </div>

      <h2 className="voice-h">Tidying up</h2>
      <div className="card settings-section">
        <Row title="Remove fillers and false starts" desc="“um”, “uh”, repeated words; “scratch that” and “no wait” keep only the correction."><Toggle on={d.fillers} onChange={(v) => void save({ dictation: { fillers: v } })} /></Row>
        <Row title="Write numbers, times, dates, money, emails and links" desc="“three thirty pm” → 3:30 PM, “anna dot lee at example dot com” → anna.lee@example.com."><Toggle on={d.formatting} onChange={(v) => void save({ dictation: { formatting: v } })} /></Row>
        <Row title="Spell my project’s names" desc="In editors and terminals, the file and symbol names of the project in front (read from git on this computer) help the recognizer spell them, and fix their capitals."><Toggle on={d.codeTerms} onChange={(v) => void save({ dictation: { codeTerms: v } })} /></Row>
        <Row title="Polish with an AI on this computer" desc="A last pass for punctuation by a local AI (Ollama, Apple Intelligence). Never sent online; skipped when none is set up."><Toggle on={d.aiPolish} onChange={(v) => void save({ dictation: { aiPolish: v } })} /></Row>
        <Row title="Edit by voice" desc="Select text anywhere, press the edit shortcut and say what to change. The text and instruction go to the AI you chose; an online AI asks first.">
          <div className="seg">{(['off', 'ask', 'on'] as const).map((m) => <button key={m} className={d.voiceEdit === m ? 'on' : ''} onClick={() => void save({ dictation: { voiceEdit: m } })}>{{ off: 'Off', ask: 'Ask first', on: 'Allowed' }[m]}</button>)}</div>
        </Row>
        <Row title="Edit shortcut"><kbd className="badge">{pretty(d.editShortcut)}</kbd></Row>
      </div>

      <h2 className="voice-h">Putting text in</h2>
      <div className="card settings-section">
        <Row title="How" desc={`Pasting is quickest (your clipboard is put back). Typing keys works where pasting is blocked. Copying only needs no permission. ${st.supports.passwordGuard ? (st.platform === 'linux' ? 'Never types into password fields that apps show to the accessibility service; keep password managers under Per app too.' : 'Never types into password fields.') : 'Password fields can’t be detected here: add password managers under Per app.'}`}>
          <div className="seg">{(['paste', 'type', 'copy'] as const).map((m) => <button key={m} className={d.insert === m ? 'on' : ''} onClick={() => void save({ dictation: { insert: m } })}>{{ paste: 'Paste', type: 'Type keys', copy: 'Copy only' }[m]}</button>)}</div>
        </Row>
        <Row title="Microphone">
          <select className="input" value={d.mic} onChange={(e) => void save({ dictation: { mic: e.target.value } })}>
            <option value="">System default</option>
            {mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microphone'}</option>)}
          </select>
        </Row>
        <Row title="Quiet that ends a hands-free take"><input className="input" type="number" min={0.8} max={8} step={0.5} style={{ width: 80 }} value={d.silenceSec} onChange={(e) => void save({ dictation: { silenceSec: Number(e.target.value) } })} /> s</Row>
        <Row title="Longest take"><input className="input" type="number" min={10} max={900} step={10} style={{ width: 80 }} value={d.maxSec} onChange={(e) => void save({ dictation: { maxSec: Number(e.target.value) } })} /> s</Row>
      </div>

      <h2 className="voice-h">Where it shows</h2>
      <div className="card settings-section">
        <Row title="While listening" desc="The Island’s live activity, a floating pill near the edge of the screen, or both.">
          <div className="seg">{(['island', 'pill', 'both'] as const).map((m) => <button key={m} className={d.hud === m ? 'on' : ''} onClick={() => void save({ dictation: { hud: m } })}>{{ island: 'Island', pill: 'Pill', both: 'Both' }[m]}</button>)}</div>
        </Row>
        {d.hud !== 'island' ? (
          <Row title="Pill position">
            <select className="input" value={d.corner} onChange={(e) => void save({ dictation: { corner: e.target.value as typeof d.corner } })}>
              {(['top', 'top-left', 'top-right', 'bottom', 'bottom-left', 'bottom-right'] as const).map((c) => <option key={c} value={c}>{c.replace('-', ' ').replace(/^./, (x) => x.toUpperCase())}</option>)}
            </select>
          </Row>
        ) : null}
        <Row title="Menu bar / tray" desc="Start dictating, edit by voice and history from the menu."><Toggle on={cfg.surfaces.tray} onChange={(v) => void save({ surfaces: { tray: v } })} /></Row>
        <Row title="Command palette" desc="“Start dictating”, “Record meeting” and more in ⌘K."><Toggle on={cfg.surfaces.palette} onChange={(v) => void save({ surfaces: { palette: v } })} /></Row>
      </div>

      <h2 className="voice-h">History</h2>
      <div className="card settings-section">
        <Row title="Keep a history" desc="The text of each take, on this computer."><Toggle on={d.history} onChange={(v) => void save({ dictation: { history: v } })} /></Row>
        <Row title="Keep at most"><input className="input" type="number" min={0} max={10000} style={{ width: 90 }} value={d.historyCap} onChange={(e) => void save({ dictation: { historyCap: Number(e.target.value) } })} /> takes</Row>
        <Row title="Keep the recordings" desc="Otherwise the sound is let go as soon as the text is written."><Toggle on={d.keepAudio} onChange={(v) => void save({ dictation: { keepAudio: v } })} /></Row>
        <Row title="Your typing speed" desc="For “time saved”."><input className="input" type="number" min={10} max={200} style={{ width: 80 }} value={d.typingWpm} onChange={(e) => void save({ dictation: { typingWpm: Number(e.target.value) } })} /> wpm</Row>
      </div>
    </>
  );
}
