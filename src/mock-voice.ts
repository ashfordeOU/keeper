// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Demo of dictation and meetings in the browser preview: a pretend take
// streams its words in, the tidy-up rules are the real ones, and two past
// meetings show speakers, notes and transcripts.

import { learnFromCorrection, readySuggestions, resolveRules, tidy, wordCount } from '../core/voice/tidy';
import { searchTakes, takeStats } from '../core/voice/history';
import { defaultVoiceSettings, mergeVoiceSettings, normalizeVoiceSettings } from '../core/voice/settings';
import { ruleNotes, toMarkdown, toSrt, toTxt, toVtt } from '../core/voice/meeting';
import { allTemplates, mergeNotes, padIsEmpty, pickTemplate } from '../core/voice/meeting-notes';
import type { DictationState, MeetingLive, MeetingRecord, Take, Utterance, VoiceApi, VoiceSettings, VoiceStatus } from '../core/voice/types';
import type { WhisperSize } from '../core/whisper';

export function mockVoice(emit: (ch: string, ...a: unknown[]) => void): { voice: VoiceApi } {
  let cfg: VoiceSettings = normalizeVoiceSettings({
    dictionary: [
      { id: 'd1', word: 'Keeper', heard: ['keep her'], uses: 14 },
      { id: 'd2', word: 'Kubernetes', heard: ['cooper netties'], uses: 6 },
      { id: 'd3', word: 'Anja', heard: ['anya'], uses: 2, suggested: true },
    ],
    snippets: [{ id: 's1', trigger: 'my address', text: 'Narva mnt 5, 10117 Tallinn, Estonia', uses: 3 }, { id: 's2', trigger: 'sign off', text: 'Best,\nMaria' }],
  }, 'darwin');
  const now = Date.now();
  const H = 3600_000;
  const D = 24 * H;
  const t = (id: string, at: number, app: string, raw: string, durationMs: number): Take => {
    const r = resolveRules(app, cfg.apps, { tone: 'auto', commands: 'everywhere' });
    const text = tidy(raw, { tone: r.tone, mode: r.mode, commands: r.commands, fillers: true, formatting: true, dictionary: cfg.dictionary, snippets: cfg.snippets }).text;
    return { id, at, app, raw, text, durationMs, words: wordCount(text), engine: 'device', language: 'en', outcome: 'typed' };
  };
  let takes: Take[] = [
    t('t1', now - 12 * 60_000, 'Slack', 'um yeah sounds good see you at three thirty pm no wait four pm thumbs up emoji', 5200),
    t('t2', now - 2 * H, 'Mail', 'hi anna comma new paragraph thanks for the notes from monday period I will send the revised budget by friday period new paragraph best comma new line maria', 14800),
    t('t3', now - 5 * H, 'Terminal', 'git commit dash m fix the login bug', 3100),
    t('t4', now - D - 2 * H, 'Notes', 'ideas for the offsite colon open paren one close paren a long walk', 7400),
    t('t5', now - 2 * D, 'Code', 'rename the variable to camel case user session token', 4200),
    t('t6', now - 3 * D, 'Messages', 'running about ten minutes late sorry', 2600),
    t('t7', now - 6 * D, 'Mail', 'please find the report at keeper dot app slash reports slash q three', 6100),
    { ...t('t8', now - 8 * D, '1Password', 'this should never be typed', 1800), outcome: 'kept' },
  ];
  let state: DictationState = { phase: 'idle', stable: '', pending: '', island: true };
  let liveTimer: ReturnType<typeof setInterval> | undefined;
  const models: WhisperSize[] = ['base'];
  const u = (id: string, start: number, speaker: string, text: string): Utterance => ({ id, start, end: start + Math.max(2, text.split(' ').length * 0.35), speaker, text, track: speaker === 'me' ? 'mic' : 'system' });
  let meetings: MeetingRecord[] = [
    {
      id: 'm-weekly', title: 'Weekly product sync', startedAt: now - 3 * H, endedAt: now - 3 * H + 31 * 60_000, durationMs: 31 * 60_000, app: 'Zoom', language: 'en',
      event: { id: 'e1', title: 'Weekly product sync', start: now - 3 * H, end: now - 2.5 * H, attendees: ['Anja Tamm', 'Ben Ortiz', 'Maria Lind'] },
      speakers: [{ id: 'me', label: 'You', track: 'mic', estimated: false }, { id: 's1', label: 'Anja Tamm', track: 'system', estimated: false }, { id: 's2', label: 'Speaker 3', track: 'system', estimated: true, suggestion: { name: 'Ben Ortiz', why: 'Sounds like Ben Ortiz from earlier meetings, who is on the invite', score: 0.71 } }],
      utterances: [
        u('a', 2, 'me', 'Morning everyone, let’s start with the launch checklist.'),
        u('b', 9, 's1', 'The new onboarding is ready. We tested it with twelve people last week and everyone finished it.'),
        u('c', 21, 's2', 'Support is worried about the password reset flow, it still sends two emails.'),
        u('d', 33, 'me', 'Okay. We decided to fix the reset emails before the launch, it is too visible.'),
        u('e', 41, 's1', 'I will update the email template by Wednesday.'),
        u('f', 50, 's2', 'And I’ll write the help article for the new onboarding by Friday.'),
        u('g', 61, 'me', 'Great. Can you also check the Spanish translation, Ben?'),
        u('h', 66, 's2', 'Sure, I can do that tomorrow.'),
        u('i', 75, 'me', 'Then we keep the launch on the 14th. Thanks all.'),
      ],
    },
    {
      id: 'm-call', title: 'Call with Northwind', startedAt: now - 2 * D, endedAt: now - 2 * D + 18 * 60_000, durationMs: 18 * 60_000, app: 'Google Meet', language: 'en',
      speakers: [{ id: 'me', label: 'You', track: 'mic', estimated: false }, { id: 's1', label: 'Others', track: 'system', estimated: true }],
      utterances: [u('a', 3, 'me', 'Thanks for making time today.'), u('b', 8, 's1', 'Happy to. We reviewed the proposal and the pricing works for us.'), u('c', 18, 'me', 'Wonderful. I will send the contract this afternoon.')],
    },
  ];
  meetings[0].notes = {
    summary: 'The team reviewed the launch checklist. Onboarding tested well (12 of 12 finished). The password reset still sends two emails; it will be fixed before launch, which stays on the 14th.',
    decisions: ['Fix the duplicate password reset emails before launch', 'Keep the launch date on the 14th'],
    actions: [{ text: 'Update the reset email template', owner: 'Anja Tamm', due: 'Wednesday', taskId: 'r1' }, { text: 'Write the help article for the new onboarding', owner: 'Ben Ortiz', due: 'Friday' }, { text: 'Check the Spanish translation', owner: 'Ben Ortiz', due: 'tomorrow' }],
    by: 'Ollama (llama3.2)', at: now - 2.4 * H,
  };
  meetings[0].notePath = 'vault:v1:Meetings/Weekly product sync.md';
  meetings[1].notes = ruleNotes(meetings[1], now - 2 * D);
  let live: (MeetingLive & { all: Utterance[] }) | null = null;
  let meetTimer: ReturnType<typeof setInterval> | undefined;

  const push = () => emit('voice-state', state, live ? { ...live, utterances: live.all.slice(-40) } : undefined, undefined);
  const set = (p: Partial<DictationState>) => { state = { ...state, ...p }; push(); };
  const status = async (): Promise<VoiceStatus> => ({
    dictation: state, meeting: live ? { ...live, utterances: live.all.slice(-40), elapsedMs: Date.now() - live.startedAt } : undefined, models: [...models],
    supports: { holdKey: true, keyHow: 'event tap', systemAudio: true, systemHow: 'ScreenCaptureKit', passwordGuard: true, typeInsert: true, systemEngine: true }, platform: 'darwin',
  });
  const SAY = 'so the plan for tomorrow is to meet at ten am comma review the draft and send it to anna dot lee at example dot com period';
  const finishTake = async () => {
    clearInterval(liveTimer);
    set({ phase: 'working', level: 0 });
    await new Promise((r) => setTimeout(r, 500));
    const raw = SAY;
    const text = tidy(raw, { tone: 'neutral', mode: 'prose', commands: true, fillers: true, formatting: true, dictionary: cfg.dictionary, snippets: cfg.snippets }).text;
    takes = [{ id: `t${Date.now()}`, at: Date.now(), app: 'Keeper', raw, text, durationMs: 6400, words: wordCount(text), engine: 'device', language: 'en', outcome: 'typed' }, ...takes];
    set({ phase: 'idle', stable: '', pending: '' });
    return state;
  };
  const meeting = (id: string) => meetings.find((m) => m.id === id) ?? null;
  const fmt = (m: MeetingRecord, f: string) => (f === 'md' ? toMarkdown(m) : f === 'srt' ? toSrt(m) : f === 'vtt' ? toVtt(m) : toTxt(m));

  const api: VoiceApi = {
    status,
    settings: async () => cfg,
    setSettings: async (patch) => { cfg = normalizeVoiceSettings(mergeVoiceSettings(cfg, patch), 'darwin'); emit('voice-settings', cfg); return cfg; },
    async start(how) {
      if (state.phase !== 'idle') return state;
      const words = SAY.split(' ');
      let i = 0;
      set({ phase: how === 'edit' ? 'editing' : 'locked', how: how === 'edit' ? 'edit' : 'toggle', since: Date.now(), app: 'Keeper', tone: 'neutral', stable: '', pending: '', error: undefined });
      liveTimer = setInterval(() => {
        i = Math.min(words.length, i + 2);
        set({ stable: words.slice(0, Math.max(0, i - 3)).join(' '), pending: words.slice(Math.max(0, i - 3), i).join(' '), level: 0.3 + Math.random() * 0.5 });
        emit('voice-level', 0.3 + Math.random() * 0.5);
        if (i >= words.length) clearInterval(liveTimer);
      }, 280);
      return state;
    },
    stop: finishTake,
    async toggle() { return state.phase === 'idle' ? api.start('toggle') : finishTake(); },
    async cancel() { clearInterval(liveTimer); set({ phase: 'idle', stable: '', pending: '' }); return state; },
    async confirm() { set({ phase: 'idle', review: undefined }); return state; },
    history: async (q) => searchTakes(takes, q),
    removeTake: async (id) => { takes = takes.filter((x) => x.id !== id); },
    clearHistory: async () => { takes = []; },
    stats: async () => takeStats(takes, Date.now(), cfg.dictation.typingWpm),
    reuseTake: async (id, how) => { const x = takes.find((y) => y.id === id); if (x && how === 'copy') await navigator.clipboard?.writeText(x.text).catch(() => undefined); },
    async correct(id, fixed) {
      const x = takes.find((y) => y.id === id);
      if (!x) return [];
      cfg = { ...cfg, dictionary: learnFromCorrection(cfg.dictionary, x.text, fixed, () => `d${Date.now()}`) };
      takes = takes.map((y) => (y.id === id ? { ...y, text: fixed } : y));
      emit('voice-settings', cfg);
      return readySuggestions(cfg.dictionary);
    },
    async preview(text, app) {
      const r = resolveRules(app, cfg.apps, { tone: cfg.dictation.tone, commands: cfg.dictation.commands });
      return tidy(text, { tone: r.tone, mode: r.mode, commands: r.commands, fillers: cfg.dictation.fillers, formatting: cfg.dictation.formatting, dictionary: cfg.dictionary, snippets: cfg.snippets }).text;
    },
    async downloadModel(size) {
      for (let f = 0; f <= 1; f += 0.25) { emit('voice-download', { size, fraction: f }); await new Promise((r) => setTimeout(r, 250)); }
      if (!models.includes(size)) models.push(size);
      emit('voice-download', null);
      return [...models];
    },
    async removeModel(size) { const i = models.indexOf(size); if (i >= 0) models.splice(i, 1); return [...models]; },
    testKey: async () => ({ ok: true, note: 'Listening with the event tap' }),
    meetings: async () => [...meetings].sort((a, b) => b.startedAt - a.startedAt),
    meeting: async (id) => meeting(id),
    async startMeeting(o = {}) {
      if (live) return live;
      const script: [string, string][] = [['me', 'Okay, we’re recording — is everyone fine with that?'], ['s1', 'Yes, go ahead.'], ['s1', 'So the first thing is the Q4 budget, we are about ten percent over.'], ['me', 'Let’s go with cutting the conference travel then.'], ['s1', 'I’ll draft the new numbers by Thursday.']];
      live = { id: `m${Date.now()}`, title: o.title ?? 'Budget review', startedAt: Date.now(), paused: false, elapsedMs: 0, tracks: { mic: true, system: true }, utterances: [], level: { mic: 0.4, system: 0.3 }, all: [] };
      let k = 0;
      meetTimer = setInterval(() => {
        if (!live || live.paused) return;
        if (k < script.length) { const [sp, tx] = script[k]; live.all.push(u(`l${k}`, (Date.now() - live.startedAt) / 1000, sp, tx)); k++; }
        live.level = { mic: Math.random() * 0.7, system: Math.random() * 0.6 };
        live.elapsedMs = Date.now() - live.startedAt;
        emit('voice-meeting', { ...live, utterances: live.all.slice(-40) });
      }, 1800);
      push();
      return { ...live, utterances: [] };
    },
    async pauseMeeting(p) { if (live) { live.paused = p; push(); } return live; },
    async stopMeeting() {
      if (!live) return null;
      clearInterval(meetTimer);
      const rec: MeetingRecord = { id: live.id, title: live.title, startedAt: live.startedAt, endedAt: Date.now(), durationMs: Date.now() - live.startedAt, app: 'Zoom', speakers: [{ id: 'me', label: 'You', track: 'mic', estimated: false }, { id: 's1', label: 'Others', track: 'system', estimated: true }], utterances: live.all };
      rec.notes = ruleNotes(rec);
      meetings = [rec, ...meetings];
      live = null;
      emit('voice-meeting', null);
      push();
      emit('voice-meetings-changed');
      return rec;
    },
    dismissOffer: async () => undefined,
    async renameSpeaker(mid, sid, label) { const m = meeting(mid); if (m) m.speakers = m.speakers.map((s) => (s.id === sid ? { ...s, label, estimated: false, suggestion: undefined } : s)); return m ? { ...m } : null; },
    async renameMeeting(id, title) { const m = meeting(id); if (m) m.title = title; return m; },
    async writeNotes(id) {
      const m = meeting(id);
      if (!m) return m;
      const tpls = allTemplates(cfg.meetings.templates);
      m.notes = !padIsEmpty(m.myNotes) ? mergeNotes(m, m.myNotes, tpls.find((t) => t.id === m.template) ?? pickTemplate(m.event?.title ?? m.title, tpls)) : ruleNotes(m);
      return { ...m };
    },
    async setMyNotes(id, text, template) { if (id === 'live') return; const m = meeting(id); if (m) { m.myNotes = text; if (template) m.template = template; } },
    async sendActions(id) { const m = meeting(id); let n = 0; for (const a of m?.notes?.actions ?? []) if (!a.taskId) { a.taskId = `t${++n}`; } return n; },
    async exportMeeting(id, f) { const m = meeting(id); if (!m) return null; const b = new Blob([fmt(m, f)], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${m.title}.${f}`; a.click(); return `${m.title}.${f}`; },
    removeMeeting: async (id) => { meetings = meetings.filter((m) => m.id !== id); },
    async linkEvent(id, ev) { const m = meeting(id); if (m) m.event = ev ? { id: ev, title: 'Weekly product sync', start: m.startedAt, end: m.startedAt + H, attendees: ['Anja Tamm', 'Ben Ortiz'] } : undefined; return m; },
    voices: async () => [{ name: 'Anja Tamm', n: 3, at: now - 3 * H }],
    forgetVoices: async () => undefined,
    saveStatsPng: async (b64) => { const a = document.createElement('a'); a.href = b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`; a.download = 'Keeper dictation.png'; a.click(); return 'Keeper dictation.png'; },
    tray: async () => ['Dictation', '  Start Dictating', 'Record Meeting', '  Start Recording'],
    eventsNear: async () => [{ id: 'e1', title: 'Weekly product sync', start: now - 3 * H, end: now - 2.5 * H }, { id: 'e2', title: 'Design review', start: now - 1 * H, end: now - 0.5 * H }],
    hud: { ready: async () => ({ settings: cfg, state }), audio: () => undefined, level: () => undefined, key: () => undefined },
  };
  void defaultVoiceSettings;
  return { voice: api };
}
