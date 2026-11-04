// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Meetings' home: record now (or from the Island, the menu bar, or when a
// call is noticed), the live transcript, past meetings with speakers, notes
// (summary, decisions, action items), the calendar event, exports, and the
// settings — including what AIs may read.

import { useEffect, useMemo, useRef, useState } from 'react';
import { clock, transcriptLines } from '../../core/voice/meeting';
import { allTemplates, BUILTIN_TEMPLATES, padIsEmpty, pickTemplate, templateFromInput, templateSkeleton } from '../../core/voice/meeting-notes';
import type { DeepPartial, ExportFormat, MeetingLive, MeetingNotes, MeetingOffer, MeetingRecord, MeetingTemplate, VoiceSettings } from '../../core/voice/types';
import { WHISPER_MODELS, type WhisperSize } from '../../core/whisper';
import { api } from '../api';
import { useFeature } from '../features';
import { Icon } from '../components/Icon';
import { Empty, PageHead, Toggle } from '../components/ui';
import { useStore } from '../state';
import { Row } from './IslandSettings';
import '../voice/voice.css';
import { ComponentPrompt } from '../components/ComponentsPanel';

const COLORS = ['var(--accent)', '#ef8f3c', '#2f9e62', '#d946ef', '#0ea5e9', '#e5484d', '#a16207', '#64748b'];
const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Meetings({ initial }: { initial?: string }) {
  const { toast } = useStore();
  const [list, setList] = useState<MeetingRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(initial && initial !== 'settings' ? initial : null);
  const [live, setLive] = useState<MeetingLive | null>(null);
  const [offer, setOffer] = useState<MeetingOffer | undefined>();
  const [cfg, setCfg] = useState<VoiceSettings | null>(null);
  const [showSettings, setShowSettings] = useState(initial === 'settings');
  const templates = useMemo(() => allTemplates(cfg?.meetings.templates ?? []), [cfg]);
  const load = () => void api.voice.meetings().then((l) => { setList(l); setSel((s) => s ?? l[0]?.id ?? null); });
  useEffect(() => {
    load();
    void api.voice.settings().then(setCfg);
    void api.voice.status().then((s) => { setLive(s.meeting ?? null); setOffer(s.offer); });
    const offs = [
      api.on('voice-meeting', (m) => setLive(m)),
      api.on('voice-state', (_s, m, o) => { setLive(m ?? null); setOffer(o); }),
      api.on('voice-meetings-changed', load),
      api.on('voice-settings', (s) => setCfg(s)),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  const start = () => void api.voice.startMeeting(offer ? { app: offer.app, offerId: offer.id } : {}).then(setLive).catch((e) => toast(e instanceof Error ? e.message : String(e)));
  const stop = () => void flushPads().then(() => api.voice.stopMeeting()).then((m) => { setLive(null); if (m) { setSel(m.id); load(); } });
  return (
    <div className="page voice-page" data-testid="meetings-page">
      <PageHead title="Meetings" sub="Your microphone and the computer’s sound, written down on this computer, with who said what and notes after.">
        <button className="btn" onClick={() => setShowSettings(!showSettings)} data-testid="meetings-settings-toggle"><Icon name="settings" size={13} /> {showSettings ? 'Hide settings' : 'Settings'}</button>
      </PageHead>
      <ComponentPrompt featureId="meetings" />
      <LiveCard live={live} offer={offer} onStart={start} onStop={stop} templates={templates} />
      {showSettings && cfg ? <MeetingSettings cfg={cfg} save={async (p) => setCfg(await api.voice.setSettings(p))} /> : null}
      <h2 className="voice-h">Recorded</h2>
      {!list ? null : !list.length ? (
        <Empty icon="mic" title="No meetings yet">Press Record when a call starts — or let Keeper notice calls and ask. Everything stays on this computer.</Empty>
      ) : (
        <div className="meet-layout">
          <div className="card meet-list" data-testid="meetings-list">
            {list.map((m) => (
              <button key={m.id} className={`meet-item${sel === m.id ? ' on' : ''}`} onClick={() => setSel(m.id)}>
                <span className="t">{m.title}</span>
                <span className="m">{fmtDate(m.startedAt)} · {clock(m.durationMs / 1000)}{m.app ? ` · ${m.app}` : ''}{m.notes ? ' · notes' : ''}</span>
              </button>
            ))}
          </div>
          {sel ? <Detail key={sel} id={sel} templates={templates} onChanged={load} onDeleted={() => { setSel(null); load(); }} /> : null}
        </div>
      )}
    </div>
  );
}

function LiveCard({ live, offer, onStart, onStop, templates }: { live: MeetingLive | null; offer?: MeetingOffer; onStart(): void; onStop(): void; templates: MeetingTemplate[] }) {
  const notesOn = useFeature('meetingNotes');
  const [, tick] = useState(0);
  const at = useRef(Date.now());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { at.current = Date.now(); }, [live]);
  useEffect(() => {
    if (!live || live.paused) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => { box.current?.scrollTo({ top: 1e6 }); }, [live?.utterances.length]);
  const elapsed = live ? (live.paused ? live.elapsedMs : live.elapsedMs + Date.now() - at.current) : 0;
  return (
    <div className={`card voice-hero${live ? ' rec' : ''}`} data-testid="meetings-live" style={{ alignItems: 'flex-start' }}>
      <button className={`voice-big${live && !live.paused ? ' rec' : ''}`} aria-label={live ? 'Stop and save' : 'Record a meeting'} data-testid="meetings-record" onClick={live ? onStop : onStart}>
        {live ? <Icon name="check" size={26} /> : <span className="vhud-rec" style={{ width: 22, height: 22 }} />}
      </button>
      <div className="voice-hero-txt">
        {live ? (
          <>
            <div className="voice-state">{live.paused ? 'Paused' : 'Recording'} · {clock(elapsed / 1000)} · {live.title}</div>
            <div className="meet-levels">
              <span>Microphone</span><div className="voice-bar"><i style={{ width: `${Math.round(live.level.mic * 100)}%` }} /></div>
              {live.tracks.system ? <><span>Computer’s sound</span><div className="voice-bar"><i style={{ width: `${Math.round(live.level.system * 100)}%` }} /></div></> : null}
            </div>
            {live.systemNote ? <div className="voice-note"><Icon name="info" size={12} /> Only the microphone: {live.systemNote}</div> : null}
            <div className={notesOn ? 'meet-live-cols' : undefined}>
              {notesOn ? <NotesPad key={live.id} id="live" text={live.myNotes ?? ''} template={live.template} templates={templates} live /> : null}
              <div className="meet-transcript card" ref={box} style={{ maxHeight: notesOn ? 300 : 220, marginTop: 6 }} data-testid="meetings-live-transcript" aria-label="Live transcript">
                {live.utterances.length ? live.utterances.map((u) => (
                  <div className="meet-line" key={u.id}><span className="at">{clock(u.start)}</span><div><span className="who">{u.track === 'mic' ? 'You' : 'Others'}</span> <span className="say">{u.text}</span></div></div>
                )) : <div className="muted" style={{ padding: '6px 14px' }}>Lines appear here a moment after each pause.</div>}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="voice-state">{offer ? `${offer.app} call going on` : 'Record a meeting'}</div>
            <div className="muted">{offer ? offer.reason : 'Records your microphone and the computer’s sound, writes them down on this computer, and makes notes when you stop. Also from the Island and the menu bar.'}</div>
            <div className="vhud-consent" style={{ marginTop: 4 }}><Icon name="info" size={12} /> Tell everyone in the call that it’s being recorded — in many places their consent is required.</div>
          </>
        )}
      </div>
      {live ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm" onClick={() => void api.voice.pauseMeeting(!live.paused)}><Icon name={live.paused ? 'play' : 'pause'} size={12} /> {live.paused ? 'Resume' : 'Pause'}</button>
          <button className="btn sm primary" data-testid="meetings-stop" onClick={onStop}>Stop and save</button>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ id, templates, onChanged, onDeleted }: { id: string; templates: MeetingTemplate[]; onChanged(): void; onDeleted(): void }) {
  const { toast } = useStore();
  const notesOn = useFeature('meetingNotes');
  const plannerOn = useFeature('planner');
  const [m, setM] = useState<MeetingRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<{ id: string; title: string; start: number }[]>([]);
  useEffect(() => { void api.voice.meeting(id).then(setM); void api.voice.eventsNear(id).then(setEvents).catch(() => undefined); }, [id]);
  const lines = useMemo(() => (m ? transcriptLines(m) : []), [m]);
  if (!m) return <div className="card pad muted">Loading…</div>;
  const colorOf = (label: string) => COLORS[Math.max(0, m.speakers.findIndex((s) => s.label === label)) % COLORS.length];
  const exp = (f: ExportFormat) => void api.voice.exportMeeting(m.id, f).then((p) => p && toast(`Saved ${p}`));
  return (
    <div className="meet-detail" data-testid="meeting-detail">
      <div className="card pad" style={{ display: 'grid', gap: 10 }}>
        <input className="meet-title" defaultValue={m.title} aria-label="Meeting title" onBlur={(e) => e.target.value !== m.title && void api.voice.renameMeeting(m.id, e.target.value).then((x) => { setM(x); onChanged(); })} />
        <div className="muted small">{fmtDate(m.startedAt)} · {clock(m.durationMs / 1000)}{m.app ? ` · ${m.app}` : ''}{m.language ? ` · ${m.language}` : ''}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Icon name="calendar" size={13} />
          <select className="input" value={m.event?.id ?? ''} onChange={(e) => void api.voice.linkEvent(m.id, e.target.value || null).then(setM)} aria-label="Calendar event">
            <option value="">{m.event ? m.event.title : 'Not linked to an event'}</option>
            {events.filter((e) => e.id !== m.event?.id).map((e) => <option key={e.id} value={e.id}>{e.title} · {new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</option>)}
            {m.event ? <option value="">Unlink</option> : null}
          </select>
          {m.event?.attendees.length ? <span className="muted small">{m.event.attendees.join(', ')}</span> : null}
        </div>
        <div className="meet-speakers" aria-label="Speakers">
          {m.speakers.map((s) => (
            <label className="meet-speaker" key={s.id} title={s.estimated ? 'Told apart by voice: a guess. Name them to fix it.' : undefined}>
              <i style={{ background: colorOf(s.label) }} />
              <input key={s.label} defaultValue={s.label} list={`att-${m.id}`} onBlur={(e) => e.target.value !== s.label && void api.voice.renameSpeaker(m.id, s.id, e.target.value).then(setM)} />
              {s.estimated ? <span className="badge">estimated</span> : null}
              {s.suggestion ? <button className="meet-suggest" title={`${s.suggestion.why}. Click to use this name.`} data-testid="meeting-suggestion" onClick={(e) => { e.preventDefault(); void api.voice.renameSpeaker(m.id, s.id, s.suggestion!.name).then(setM); }}>{s.suggestion.name}?</button> : null}
            </label>
          ))}
          <datalist id={`att-${m.id}`}>{(m.event?.attendees ?? []).map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn sm primary" disabled={busy} data-testid="meeting-notes" onClick={() => { setBusy(true); void flushPads().then(() => api.voice.writeNotes(m.id)).then((x) => { setM(x); onChanged(); }).finally(() => setBusy(false)); }}><Icon name="sparkle" size={12} /> {busy ? 'Writing…' : notesOn && !padIsEmpty(m.myNotes) ? (m.notes?.sections ? 'Tidy my notes again' : 'Tidy my notes') : m.notes ? 'Write notes again' : 'Write notes'}</button>
          {(['md', 'srt', 'vtt', 'txt'] as ExportFormat[]).map((f) => <button key={f} className="btn sm" onClick={() => exp(f)}>{f === 'md' ? 'Markdown' : f.toUpperCase()}</button>)}
          <button className="btn sm ghost" onClick={() => { if (confirm(`Delete “${m.title}” and its transcript?`)) void api.voice.removeMeeting(m.id).then(onDeleted); }}><Icon name="trash" size={12} /> Delete</button>
        </div>
      </div>
      {m.notes?.sections?.length ? (
        <TidyNotes notes={m.notes} plannerOn={plannerOn} onRemind={() => void api.voice.sendActions(m.id).then((n) => { toast(n ? `Added ${n} to Reminders` : 'Already in Reminders'); return api.voice.meeting(m.id); }).then((x) => x && setM(x)).catch((e) => toast(e instanceof Error ? e.message : String(e)))} notePath={m.notePath} />
      ) : m.notes ? (
        <div className="card meet-notes" data-testid="meeting-notes-card">
          <h3>Summary</h3><div>{m.notes.summary}</div>
          <h3>Decisions</h3>{m.notes.decisions.length ? <ul>{m.notes.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul> : <div className="muted">None noted.</div>}
          <h3>Action items</h3>{m.notes.actions.length ? <ul>{m.notes.actions.map((a, i) => <li key={i}>{a.text}{a.owner ? <b> — {a.owner}</b> : null}{a.due ? <span className="muted"> (due {a.due})</span> : null}{a.taskId ? <span className="badge ok" style={{ marginLeft: 6 }}>in Reminders</span> : null}</li>)}</ul> : <div className="muted">None noted.</div>}
          <div className="muted small">Written by {m.notes.by === 'rules' ? 'Keeper’s plain rules (no AI chosen)' : m.notes.by}{m.notePath ? ` · saved to ${m.notePath.replace(/^vault:[^:]+:/, 'Notes › ')}` : ''}</div>
        </div>
      ) : null}
      {notesOn ? <NotesPad key={`pad-${m.id}-${m.notes?.at ?? 0}`} id={m.id} text={m.myNotes ?? ''} template={m.template} templates={templates} eventTitle={m.event?.title ?? m.title} tidied={!!m.notes?.sections} /> : null}
      <div className="card meet-transcript" data-testid="meeting-transcript">
        {m.speakers.some((s) => s.estimated && s.label.startsWith('Speaker')) ? <div className="meet-consent" style={{ borderTop: 0 }}><Icon name="info" size={12} /> Other people are told apart by their voices; the labels are estimates.</div> : null}
        {lines.map((l, i) => <div className="meet-line" key={i}><span className="at">{clock(l.at)}</span><div><span className="who" style={{ color: colorOf(l.who) }}>{l.who}</span> <span className="say">{l.text}</span></div></div>)}
        {!lines.length ? <div className="muted" style={{ padding: 14 }}>Nothing was said.</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- your notes

/** Pads with typing not yet saved: saved before notes are written or the recording stops. */
const pending = new Map<string, () => Promise<void>>();
const flushPads = () => Promise.all([...pending.values()].map((f) => f())).then(() => undefined);

/** Your own notes: a plain pad (Markdown headings and bullets), with the template for this kind of meeting. */
function NotesPad({ id, text, template, templates, live, eventTitle, tidied }: { id: string; text: string; template?: string; templates: MeetingTemplate[]; live?: boolean; eventTitle?: string; /** tidy notes were made: the pad waits closed */ tidied?: boolean }) {
  const [value, setValue] = useState(text);
  const [tpl, setTpl] = useState(template ?? '');
  const [open, setOpen] = useState(!!live || (!padIsEmpty(text) && !tidied));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ value, tpl });
  latest.current = { value, tpl };
  const save = () => { clearTimeout(timer.current); pending.delete(id); return api.voice.setMyNotes(id, latest.current.value, latest.current.tpl || undefined); };
  const later = () => { clearTimeout(timer.current); pending.set(id, save); timer.current = setTimeout(() => void save(), 800); };
  useEffect(() => () => { if (pending.has(id)) void save(); }, []);
  const chosen = templates.find((t) => t.id === tpl);
  const choose = (next: string) => {
    const t = templates.find((x) => x.id === next);
    setTpl(next);
    // An untouched pad takes the new template's headings; typed notes are never replaced.
    if (t && padIsEmpty(value)) setValue(templateSkeleton(t));
    later();
  };
  if (!open) {
    return (
      <div className="card meet-pad-closed">
        <div><b>Your notes</b><div className="muted small">{padIsEmpty(value) ? 'Type what matters; Keeper fills it out from the transcript.' : `${value.split(/\n/).filter((l) => /^\s*[-*•]\s*\S/.test(l)).length} points${chosen ? ` · ${chosen.name}` : ''}`}</div></div>
        <button className="btn sm" data-testid="meeting-pad-open" onClick={() => { setOpen(true); if (!value.trim()) { const t = chosen ?? pickTemplate(eventTitle, templates); setTpl(t.id); setValue(templateSkeleton(t)); later(); } }}><Icon name="note" size={12} /> {padIsEmpty(value) ? 'Add your notes' : 'Edit your notes'}</button>
      </div>
    );
  }
  return (
    <div className="card meet-pad" data-testid={live ? 'meetings-live-pad' : 'meeting-pad'}>
      <div className="meet-pad-head">
        <b>Your notes</b>
        <select className="input sm" aria-label="Note template" value={tpl} data-testid="meeting-template" onChange={(e) => choose(e.target.value)}>
          {!tpl ? <option value="">Template…</option> : null}
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {eventTitle && !live ? <span className="muted small" data-user-text>{eventTitle}</span> : null}
      </div>
      <textarea
        className="meet-pad-text"
        aria-label="Your notes"
        spellCheck
        value={value}
        placeholder="- a point in a few words&#10;- [ ] something to do @name"
        onChange={(e) => { setValue(e.target.value); later(); }}
        onBlur={() => void save()}
      />
      <div className="meet-pad-foot muted small">Headings start sections · “- [ ]” or @name makes an action item · Saved as you type</div>
    </div>
  );
}

/** Tidy notes: your points as you wrote them, what the transcript adds marked as such, each with its moment in the call. */
function TidyNotes({ notes, plannerOn, onRemind, notePath }: { notes: MeetingNotes; plannerOn: boolean; onRemind(): void; notePath?: string }) {
  const waiting = notes.actions.filter((a) => !a.taskId).length;
  return (
    <div className="card meet-notes" data-testid="meeting-notes-card">
      {notes.summary ? <><h3>Summary</h3><div>{notes.summary}</div></> : null}
      {notes.sections!.map((s, i) => (
        <section key={i} className="meet-sec">
          <h3>{s.title}</h3>
          {s.items.length ? (
            <ul>
              {s.items.map((it, j) => (
                <li key={j} className={it.from === 'transcript' ? 'from-call' : undefined} data-from={it.from}>
                  {it.text}
                  {it.from === 'transcript' ? <span className="meet-src" title="Heard in the call, not in your notes">from the call{it.at !== undefined ? ` · ${clock(it.at)}` : ''}</span> : it.at !== undefined ? <span className="meet-src quiet" title="When this came up in the call">{clock(it.at)}</span> : null}
                  {notes.actions.some((a) => a.taskId && a.text && it.text.includes(a.text.slice(0, 30))) ? <span className="badge ok" style={{ marginLeft: 6 }}>in Reminders</span> : null}
                  {it.detail ? <div className="meet-detail-line muted">{it.detail} <span className="meet-src">from the call</span></div> : null}
                </li>
              ))}
            </ul>
          ) : <div className="muted">Nothing noted.</div>}
        </section>
      ))}
      <div className="meet-notes-foot">
        <span className="muted small">{notes.by === 'rules' ? 'Tidied on this computer with plain rules' : `Tidied by ${notes.by}`} · your words kept as typed{notePath ? ` · saved to ${notePath.replace(/^vault:[^:]+:/, 'Notes › ')}` : ''}</span>
        {plannerOn && waiting ? <button className="btn sm" data-testid="meeting-remind" onClick={onRemind}><Icon name="check" size={12} /> Add {waiting} to Reminders</button> : null}
      </div>
    </div>
  );
}

/** Your own templates: a name, its sections, and words in an event title that choose it. */
function TemplateEditor({ templates, save }: { templates: MeetingTemplate[]; save: (t: MeetingTemplate[]) => void }) {
  const [name, setName] = useState('');
  const [sections, setSections] = useState('');
  const [match, setMatch] = useState('');
  const add = () => { const t = templateFromInput(name, sections, match); if (!t) return; save([...templates.filter((x) => x.id !== t.id), t]); setName(''); setSections(''); setMatch(''); };
  return (
    <div className="meet-tpls" data-testid="meeting-templates">
      {[...BUILTIN_TEMPLATES, ...templates].map((t) => (
        <div className="meet-tpl" key={t.id}>
          <b>{t.name}</b>
          <span className="muted small">{t.sections.join(' · ')}{t.match?.length ? ` — when the event says ${t.match.slice(0, 3).map((w) => `“${w}”`).join(', ')}` : ''}</span>
          {templates.includes(t) ? <button className="btn sm ghost" aria-label={`Remove ${t.name}`} onClick={() => save(templates.filter((x) => x !== t))}><Icon name="trash" size={12} /></button> : <span className="badge">Built in</span>}
        </div>
      ))}
      <form className="meet-tpl-new" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" aria-label="Template name" placeholder="Name, e.g. Planning" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="Sections" placeholder="Sections, separated by commas" value={sections} onChange={(e) => setSections(e.target.value)} />
        <input className="input" aria-label="Words in the event title" placeholder="Event words, e.g. planning" value={match} onChange={(e) => setMatch(e.target.value)} />
        <button className="btn sm" type="submit" disabled={!name.trim() || !sections.trim()} data-testid="meeting-template-add">Add template</button>
      </form>
    </div>
  );
}

function MeetingSettings({ cfg, save }: { cfg: VoiceSettings; save: (p: DeepPartial<VoiceSettings>) => Promise<void> }) {
  const m = cfg.meetings;
  const detectOn = useFeature('meetingDetect');
  const notesOn = useFeature('meetingNotes');
  const [vaults, setVaults] = useState<{ id: string; name: string }[]>([]);
  const [voices, setVoices] = useState<{ name: string }[]>([]);
  useEffect(() => { void api.voice.voices().then(setVoices).catch(() => undefined); }, []);
  useEffect(() => { void api.notes?.vaults?.().then((v: { id: string; name: string }[]) => setVaults(v)).catch(() => undefined); }, []);
  return (
    <>
      <h2 className="voice-h">Meeting settings</h2>
      <div className="card settings-section" data-testid="meetings-settings">
        <Row title="Notice calls" desc="When a meeting app or a meeting page in a browser starts using the microphone, offer to record — over the call, in the Island and the menu bar."><Toggle on={detectOn && m.detect} onChange={(v) => void (async () => { if (v && !detectOn) await api.features.set('meetingDetect', true); await save({ meetings: { detect: v } }); })()} /></Row>
        <Row title="Record the computer’s sound" desc="The other people. macOS asks for Screen & System Audio Recording; Windows records its loopback; Linux the sound server’s monitor."><Toggle on={m.systemAudio} onChange={(v) => void save({ meetings: { systemAudio: v } })} /></Row>
        <Row title="Tell speakers apart" desc="You from the microphone; others grouped by voice on this computer (labelled as estimates)."><Toggle on={m.diarize} onChange={(v) => void save({ meetings: { diarize: v } })} /></Row>
        <Row title="Write notes when it ends" desc="Summary, decisions and action items."><Toggle on={m.autoNotes} onChange={(v) => void save({ meetings: { autoNotes: v } })} /></Row>
        <Row title="Notes written by" desc={m.notesAi === 'local' ? 'An AI on this computer (Ollama, Apple Intelligence) when set up; otherwise plain rules. Nothing is sent.' : m.notesAi === 'active' ? 'The AI chosen in Settings → AI. Only the transcript text is sent, never the sound.' : 'Plain rules on this computer, no AI.'}>
          <div className="seg">{(['local', 'active', 'rules'] as const).map((x) => <button key={x} className={m.notesAi === x ? 'on' : ''} onClick={() => void save({ meetings: { notesAi: x } })}>{{ local: 'AI on this computer', active: 'My chosen AI', rules: 'No AI' }[x]}</button>)}</div>
        </Row>
        <Row title="Save notes to" desc="A Markdown note per meeting.">
          <select className="input" value={m.notesTarget.kind === 'vault' ? `vault:${m.notesTarget.id}` : m.notesTarget.kind} onChange={(e) => {
            const v = e.target.value;
            if (v === 'folder') void api.settings.pickFolder().then((p: string | null) => { if (p) void save({ meetings: { notesTarget: { kind: 'folder', path: p } } }); });
            else if (v.startsWith('vault:')) void save({ meetings: { notesTarget: { kind: 'vault', id: v.slice(6), folder: 'Meetings' } } });
            else void save({ meetings: { notesTarget: { kind: 'none' } } });
          }}>
            <option value="none">Only here in Keeper</option>
            {vaults.map((v) => <option key={v.id} value={`vault:${v.id}`}>Keeper Notes › {v.name} › Meetings</option>)}
            <option value="folder">{m.notesTarget.kind === 'folder' ? m.notesTarget.path : 'A folder…'}</option>
          </select>
        </Row>
        {notesOn ? (
          <>
            <Row title="Template from the event" desc="1:1, standup or interview, chosen from the calendar event’s title."><Toggle on={m.autoTemplate} onChange={(v) => void save({ meetings: { autoTemplate: v } })} /></Row>
            <Row title="Note templates" desc="The sections your notes start with.">
              <TemplateEditor templates={m.templates} save={(t) => void save({ meetings: { templates: t } })} />
            </Row>
          </>
        ) : null}
        <Row title="Action items to Reminders" desc="Each action item becomes a reminder in Keeper’s Reminders."><Toggle on={m.actionsToTasks} onChange={(v) => void save({ meetings: { actionsToTasks: v } })} /></Row>
        <Row title="Keep the recordings" desc="Otherwise only the transcript is kept."><Toggle on={m.keepAudio} onChange={(v) => void save({ meetings: { keepAudio: v } })} /></Row>
        <Row title="Speech model">
          <select className="input" value={m.model} onChange={(e) => void save({ meetings: { model: e.target.value as WhisperSize } })}>
            {(Object.keys(WHISPER_MODELS) as WhisperSize[]).map((s) => <option key={s} value={s}>{s === 'turbo' ? 'Large v3 turbo' : s[0].toUpperCase() + s.slice(1)} · {WHISPER_MODELS[s].label}</option>)}
          </select>
        </Row>
        <Row title="Suggest names from remembered voices" desc={`When you name a speaker, Keeper remembers how they sound (a small voice print, on this computer only) and suggests the name next time. Always a suggestion; nothing is named by itself.${voices.length ? ` Remembered: ${voices.map((x) => x.name).join(', ')}.` : ''}`}>
          {voices.length ? <button className="btn sm" onClick={() => { if (confirm('Forget every remembered voice?')) void api.voice.forgetVoices().then(() => setVoices([])); }}>Forget voices</button> : null}
          <Toggle on={m.rememberVoices} onChange={(v) => void save({ meetings: { rememberVoices: v } })} />
        </Row>
        <Row title="Let AIs read the live transcript" desc="Agents and assistants connected to Keeper can read the meeting being recorded (each still asks your permission once)."><Toggle on={m.liveForAI} onChange={(v) => void save({ meetings: { liveForAI: v } })} /></Row>
        <Row title="More call apps" desc="Names of other apps or page titles that mean a call (comma-separated).">
          <input className="input" style={{ width: 240 }} defaultValue={m.extraApps.join(', ')} onBlur={(e) => void save({ meetings: { extraApps: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} />
        </Row>
      </div>
    </>
  );
}
