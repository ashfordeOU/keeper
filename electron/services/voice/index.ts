// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Voice: dictation in any app (hold a key, speak, let go: finished text where
// the cursor is) and meeting recording (your microphone and the computer's
// sound, transcribed live on this computer, speakers told apart, notes after).
// Everything runs on this computer unless the person chooses a service.

import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fsp, type WriteStream } from 'node:fs';
import path from 'node:path';
import { globalShortcut, Notification } from 'electron';
import { KeyMachine, type KeyAction } from '../../../core/voice/keys';
import { spokenForms } from '../../../core/voice/code-terms';
import { searchTakes, takeStats } from '../../../core/voice/history';
import { bestEvent, detectMeeting, meetingFileName, notesPrompt, parseNotesReply, ruleNotes, sortUtterances, toMarkdown, toSrt, toTxt, toVtt, newUtteranceId } from '../../../core/voice/meeting';
import { dropEcho, labelSpeakers, meanPrint, rememberVoice, suggestNames, voicePrint } from '../../../core/voice/diarize';
import { advance, allText, display, newStream, type Piece, type StreamState } from '../../../core/voice/stream';
import { appKind, dictionaryPrompt, learnFromCorrection, readySuggestions, resolveRules, tidy, wordCount } from '../../../core/voice/tidy';
import { meter, rms, speechPieces, Vad } from '../../../core/voice/vad';
import type {
  DictationState, DictationStats, DictEntry, ExportFormat, MeetingLive, MeetingOffer, MeetingRecord, Take, Utterance, VoiceSettings, VoiceStatus,
} from '../../../core/voice/types';
import { WHISPER_MODELS, type WhisperSize } from '../../../core/whisper';
import { frontmostApp } from '../devices';
import { featureOn } from '../features';
import { poll } from '../governor';
import { recognize, wav, whisper } from './engine';
import { Hud } from './hud';
import { focusedIsSecure, insertText, readSelection } from './insert';
import type { HookResult, KeyHook } from './keyhook';
import { addTake, audioDir, deleteMeeting, listMeetings, loadTakes, loadVoices, meetingsDir, onVoiceSettings, readMeeting, removeTakes, saveMeeting, saveVoices, saveVoiceSettings, updateTake, voiceSettings } from './store';
import type { SystemAudio } from './system-audio';

const SR = 16000;

export interface VoiceDeps {
  broadcast(channel: string, ...args: unknown[]): void;
  alert(title: string, detail?: string): void;
  show(route?: string): void;
  updateTray(): void;
  preload: string;
  lockDown(w: Electron.BrowserWindow): void;
  /** apps using the microphone, when the Island already knows */
  micApps?(): string[] | undefined;
  /** calendar events Keeper knows about (Calendar, the Island's feed) */
  events?(from: number, to: number): Promise<{ id: string; title: string; start: number; end: number; allDay?: boolean; url?: string; location?: string; attendees?: string[] }[]>;
}

/** A growable sample buffer. */
class Samples {
  buf = new Float32Array(SR * 8);
  n = 0;
  push(a: Float32Array) {
    if (this.n + a.length > this.buf.length) { const b = new Float32Array(Math.max(this.buf.length * 2, this.n + a.length)); b.set(this.buf.subarray(0, this.n)); this.buf = b; }
    this.buf.set(a, this.n);
    this.n += a.length;
  }
  slice(from: number, to = this.n) { return this.buf.slice(Math.max(0, from), Math.min(to, this.n)); }
}

interface TakeRun {
  id: string;
  how: 'hold' | 'locked' | 'toggle' | 'handsfree' | 'edit';
  startedAt: number;
  audio: Samples;
  dropped: number;
  stream: StreamState;
  prevGuess: string;
  language?: string;
  app?: string;
  secure: Promise<boolean | null>;
  selection?: Promise<string>;
  vad?: Vad;
  heard: boolean;
  maxTimer?: NodeJS.Timeout;
  liveTimer?: NodeJS.Timeout;
  decoding: Promise<void> | null;
  cancelled: boolean;
  /** the front project's file and symbol names (code-aware spelling) */
  terms?: string[];
}

interface TrackRun { samples: Samples; cut: number; out?: WriteStream; file?: string; level: number }

interface MeetingRun {
  rec: MeetingRecord;
  paused: boolean;
  pausedAt?: number;
  pausedMs: number;
  tracks: { mic: TrackRun; system?: TrackRun };
  sys?: SystemAudio;
  queue: Promise<void>;
  pending: number;
  prints: Map<string, Float32Array | null>;
  timer?: NodeJS.Timeout;
}

export class VoiceService {
  readonly hud: Hud;
  private hook: KeyHook | null = null;
  private hookResult: HookResult = { ok: false, how: 'none' };
  private keys: KeyMachine;
  private take: TakeRun | null = null;
  private meetingRun: MeetingRun | null = null;
  private offer: MeetingOffer | undefined;
  private dismissed = new Map<string, number>();
  private reviewResolve: ((text: string | null) => void) | null = null;
  private escBound = false;
  private downloading?: { size: WhisperSize; fraction: number };
  private stopDetect?: () => void;
  state: DictationState = { phase: 'idle', stable: '', pending: '' };
  /** what the capture window should record (it asks again when it loads) */
  capture: { mic: boolean; deviceId?: string; system: boolean } = { mic: false, system: false };
  get currentOffer() { return this.offer; }

  constructor(private d: VoiceDeps) {
    const s = voiceSettings();
    this.keys = new KeyMachine({ mode: s.dictation.mode, doubleTapLatch: s.dictation.doubleTapLatch });
    this.hud = new Hud({ preload: d.preload, lockDown: d.lockDown, corner: () => voiceSettings().dictation.corner });
    onVoiceSettings((next, prev) => {
      this.keys.o = { mode: next.dictation.mode, doubleTapLatch: next.dictation.doubleTapLatch };
      if (next.dictation.key !== prev.dictation.key) void this.restartHook();
      if (next.meetings.detect !== prev.meetings.detect) this.startDetection();
      this.d.broadcast('voice-settings', next);
      this.d.updateTray();
    });
  }

  settings(): VoiceSettings { return voiceSettings(); }
  setSettings = saveVoiceSettings;

  // ---------------------------------------------------------------- status

  async status(): Promise<VoiceStatus> {
    return {
      dictation: this.state,
      meeting: this.live(),
      offer: this.offer,
      models: await whisper().installed(),
      downloading: this.downloading,
      supports: {
        holdKey: this.hookResult.ok,
        keyHow: this.hookResult.ok ? this.hookResult.how : (this.hookResult.note ?? (featureOn('dictationHold') ? 'Starting…' : 'Hold-to-talk is off (Settings → Features)')),
        systemAudio: process.platform !== 'linux' || true,
        systemHow: process.platform === 'darwin' ? 'ScreenCaptureKit (macOS 13 or later, Screen & System Audio Recording permission)' : process.platform === 'win32' ? 'WASAPI loopback' : 'the output’s monitor source (PipeWire or PulseAudio)',
        passwordGuard: process.platform === 'darwin' || process.platform === 'win32',
        typeInsert: true,
        systemEngine: process.platform === 'darwin',
      },
      platform: process.platform,
    };
  }

  private emit() {
    this.d.broadcast('voice-state', this.state, this.live(), this.offer);
  }

  private set(patch: Partial<DictationState>) {
    const s = voiceSettings();
    this.state = { ...this.state, ...patch, island: s.surfaces.island && s.dictation.hud !== 'pill' };
    this.emit();
  }

  // ---------------------------------------------------------------- the talk key

  /** Starts (or restarts) the native key hook; off when hold-to-talk is off. */
  async restartHook() {
    this.hook?.stop();
    this.hook = null;
    if (!featureOn('dictation') || !featureOn('dictationHold')) { this.hookResult = { ok: false, how: 'none' }; this.set({ keyNote: undefined }); return; }
    // Hold-to-talk is off by default: the native key hook's code loads only when it is turned on.
    const { makeKeyHook } = await import('./keyhook');
    if (!featureOn('dictation') || !featureOn('dictationHold')) return;
    // Another restart may have started a hook while the code loaded.
    (this.hook as KeyHook | null)?.stop();
    const hook = makeKeyHook();
    this.hook = hook;
    this.hookResult = await hook.start(voiceSettings().dictation.key, (e) => this.onKey(e)).catch((err: Error) => ({ ok: false, how: 'none', note: err.message }));
    if (this.hook !== hook) { hook.stop(); return; }
    this.set({ keyNote: this.hookResult.ok ? undefined : this.hookResult.note });
  }

  stopHook() {
    this.hook?.stop();
    this.hook = null;
    this.hookResult = { ok: false, how: 'none' };
  }

  private onKey(e: 'down' | 'up' | 'esc') {
    const now = Date.now();
    if (e === 'esc') {
      if (this.state.phase === 'review') return void this.confirmReview(null);
      return this.act(this.keys.escape());
    }
    // Hold the talk key with text selected and Shift: not available everywhere, so editing has its own shortcut.
    this.act(e === 'down' ? this.keys.down(now) : this.keys.up(now));
  }

  private act(a: KeyAction) {
    if (a === 'start') void this.start(this.keys.phase === 'handsfree' ? 'handsfree' : this.keys.phase === 'locked' ? 'toggle' : 'hold');
    else if (a === 'stop') void this.stop();
    else if (a === 'cancel') void this.cancel();
    else if (a === 'lock' && this.take) { this.take.how = 'locked'; this.set({ phase: 'locked', how: 'locked' }); }
  }

  /** The global shortcut (where no key hook is possible, and always as a second way). */
  toggleFromShortcut() {
    if (this.state.phase === 'review') return void this.confirmReview(this.state.review ?? '');
    if (this.take) { this.keys.reset(); return void this.stop(); }
    this.keys.reset();
    return void this.start('toggle');
  }

  private bindEsc(on: boolean) {
    // With a key hook, Esc comes from the hook; otherwise a temporary shortcut while listening.
    if (this.hookResult.ok) return;
    try {
      if (on && !this.escBound) { this.escBound = globalShortcut.register('Escape', () => (this.state.phase === 'review' ? void this.confirmReview(null) : void this.cancel())); }
      else if (!on && this.escBound) { globalShortcut.unregister('Escape'); this.escBound = false; }
    } catch { this.escBound = false; }
  }

  // ---------------------------------------------------------------- dictation

  async start(how: TakeRun['how'] = 'toggle'): Promise<DictationState> {
    if (!featureOn('dictation')) throw new Error('Dictation is switched off (Settings → Features)');
    if (this.take || this.state.phase === 'working' || this.state.phase === 'review') return this.state;
    const s = voiceSettings().dictation;
    const t: TakeRun = {
      id: randomUUID(), how, startedAt: Date.now(), audio: new Samples(), dropped: 0, stream: newStream(), prevGuess: '', heard: false, decoding: null, cancelled: false,
      secure: Promise.resolve(null),
    };
    this.take = t;
    // what is in front, before the pill appears (it never takes focus anyway)
    const appP = frontmostApp().catch(() => undefined);
    t.secure = focusedIsSecure();
    if (how === 'edit') t.selection = readSelection().catch(() => '');
    if (how === 'handsfree') t.vad = new Vad(s.silenceSec);
    this.set({ phase: how === 'edit' ? 'editing' : how === 'locked' || how === 'toggle' ? 'locked' : 'listening', stable: '', pending: '', review: undefined, error: undefined, ask: undefined, since: t.startedAt, how: how === 'handsfree' ? 'hands-free' : how, level: 0, app: undefined });
    await this.captureOn();
    if (s.sounds) this.hud.send('voice-sound', 'start');
    this.bindEsc(true);
    t.maxTimer = setTimeout(() => { if (this.take === t) void this.stop(); }, s.maxSec * 1000);
    if (s.engine === 'device') t.liveTimer = setInterval(() => this.livePass(t), 900);
    void appP.then((app) => {
      if (this.take !== t) return;
      t.app = app;
      const r = resolveRules(app, voiceSettings().apps, { tone: s.tone, commands: s.commands });
      if (s.codeTerms && appKind(app) !== 'other') void this.loadTerms(t);
      this.set({ app, tone: r.rule?.exclude ? 'kept in history (excluded app)' : `${r.tone}${r.mode === 'exact' ? ', exact' : ''}` });
    });
    return this.state;
  }

  /** Mic capture runs while a take or a meeting needs it. */
  private async captureOn() {
    await this.hud.ensure();
    const s = voiceSettings();
    const wantPill = this.take && s.dictation.hud !== 'island';
    this.capture = { mic: true, deviceId: s.dictation.mic, system: process.platform === 'win32' && !!this.meetingRun?.tracks.system };
    this.hud.send('voice-capture', this.capture);
    if (wantPill) this.hud.show('pill');
    else if (this.meetingRun && this.hud.shape === 'hidden') this.hud.show('hidden');
  }

  private captureOffIfIdle() {
    if (this.take || this.meetingRun) return;
    this.capture = { mic: false, system: false };
    this.hud.send('voice-capture', this.capture);
    if (this.state.phase !== 'review' && !this.offer) this.hud.show('hidden');
    this.hud.releaseSoon();
  }

  /** The recognizer's prompt: the project's names (code-aware spelling), then the personal dictionary. */
  private promptFor(t: TakeRun): string {
    const s = voiceSettings();
    return [t.terms?.join(', '), dictionaryPrompt(s.dictionary, t.language)].filter(Boolean).join(', ');
  }

  private async loadTerms(t: TakeRun) {
    try {
      const { frontProject, projectTerms } = await import('./code-terms');
      const root = await frontProject();
      if (root && this.take === t) t.terms = await projectTerms(root);
    } catch { /* no project: the dictionary alone */ }
  }

  /** Samples from the capture window. */
  onAudio(track: 'mic' | 'system', samples: Float32Array) {
    if (!(samples instanceof Float32Array) || !samples.length) return;
    if (track === 'mic' && this.take && !this.take.cancelled) {
      const t = this.take;
      t.audio.push(samples);
      const lvl = meter(rms(samples));
      if (lvl > 0.25) t.heard = true;
      if (t.vad) for (const e of t.vad.push(samples)) if (e.type === 'silence' && t.heard) void this.stop();
      this.state.level = lvl;
      this.d.broadcast('voice-level', lvl);
    }
    if (this.meetingRun && !this.meetingRun.paused) this.meetingAudio(track, samples);
  }

  private livePass(t: TakeRun) {
    if (t.decoding || this.take !== t) return;
    const buf = t.audio.slice(t.dropped);
    if (buf.length < SR * 0.8 || rms(buf) < 0.002) return;
    const s = voiceSettings();
    t.decoding = (async () => {
      try {
        const r = await recognize(buf, { engine: 'device', size: s.dictation.model, language: t.language ?? s.dictation.language, translate: s.dictation.translate, prompt: this.promptFor(t), live: { id: t.id, start: t.dropped } });
        if (this.take !== t) return;
        if (!t.language && s.dictation.language === 'auto' && r.language) t.language = r.language;
        const a = advance(t.stream, r.segments, buf.length / SR);
        t.dropped += Math.round(a.dropSec * SR);
        const shown = display(a.state, t.prevGuess);
        t.prevGuess = a.state.last.map((p) => p.text).join(' ');
        t.stream = a.state;
        this.set({ stable: shown.stable, pending: shown.pending });
      } catch (e) {
        if (this.take === t && !/Stopped/.test(String(e))) this.set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        t.decoding = null;
      }
    })();
  }

  async stop(): Promise<DictationState> {
    const t = this.take;
    if (!t) return this.state;
    this.take = null;
    this.keys.reset();
    clearInterval(t.liveTimer);
    clearTimeout(t.maxTimer);
    this.captureOffIfIdle();
    const s = voiceSettings();
    if (s.dictation.sounds) this.hud.send('voice-sound', 'stop');
    this.set({ phase: 'working', level: 0 });
    try {
      await t.decoding;
      const durationMs = Date.now() - t.startedAt;
      if (t.audio.n < SR * 0.25) return this.finish('Nothing was heard');
      const rest = t.audio.slice(t.dropped);
      const prompt = this.promptFor(t);
      const r = rest.length >= SR * 0.25 && rms(rest) > 0.0015
        ? await recognize(rest, { engine: s.dictation.engine, size: s.dictation.model, language: t.language ?? s.dictation.language, translate: s.dictation.translate, prompt, offset: t.stream.offset, live: { id: t.id, start: t.dropped } })
        : { language: t.language ?? 'en', segments: [] };
      const pieces: Piece[] = [...t.stream.committed, ...r.segments];
      const raw = pieces.map((p) => p.text.trim()).filter(Boolean).join(' ').trim();
      const language = t.language ?? r.language;
      if (!raw) return this.finish('Nothing was heard');
      if (t.how === 'edit') return await this.finishEdit(t, raw, durationMs, language);
      const rules = resolveRules(t.app, s.apps, { tone: s.dictation.tone, commands: s.dictation.commands });
      let text = tidy(raw, {
        tone: rules.tone, mode: rules.mode, commands: rules.commands, fillers: s.dictation.fillers, formatting: s.dictation.formatting,
        dictionary: [...(t.terms ?? []).map((w) => ({ id: `code:${w}`, word: w, heard: spokenForms(w) })), ...s.dictionary], snippets: s.snippets, language, pieces: pieces.map((p) => ({ ...p })),
      }).text;
      if (s.dictation.aiPolish && rules.mode === 'prose' && text.split(/\s+/).length > 3) text = await polish(text).catch(() => text);
      const secure = await Promise.race([t.secure, new Promise<null>((r2) => setTimeout(() => r2(null), 1500))]);
      let audioFile: string | undefined;
      if (s.dictation.keepAudio) {
        await fsp.mkdir(audioDir(), { recursive: true });
        audioFile = path.join(audioDir(), `${t.id}.wav`);
        await fsp.writeFile(audioFile, wav(t.audio.slice(0)));
      }
      const record = (outcome: Take['outcome'], finalText: string) => s.dictation.history
        ? addTake({ id: t.id, at: t.startedAt, app: t.app, text: finalText, raw, language, durationMs, words: wordCount(finalText), engine: s.dictation.engine, outcome, audio: audioFile }, s.dictation.historyCap)
        : Promise.resolve();
      if (rules.rule?.exclude || secure === true) {
        await record('kept', text);
        this.d.alert(secure ? 'Not typed into a password field' : `Not typed into ${t.app}`, 'The text is in Dictation history');
        return this.finish();
      }
      if (s.dictation.review) {
        this.set({ phase: 'review', review: text, stable: '', pending: '' });
        this.hud.show('review');
        this.bindEsc(true);
        const chosen = await new Promise<string | null>((resolve) => { this.reviewResolve = resolve; });
        if (chosen === null) { await record('kept', text); return this.finish(); }
        text = chosen;
      }
      const how = rules.rule?.insert ?? s.dictation.insert;
      const outcome = await insertText(text, how);
      await record(outcome, text);
      return this.finish();
    } catch (e) {
      return this.finish(e instanceof Error ? e.message : String(e));
    }
  }

  private async finishEdit(t: TakeRun, instruction: string, durationMs: number, language: string): Promise<DictationState> {
    const s = voiceSettings();
    const selected = (await t.selection) ?? '';
    if (!selected.trim()) return this.finish('Select some text first, then use the edit shortcut');
    if (s.dictation.voiceEdit === 'off') return this.finish('Editing by voice is off (Dictation → Edit by voice)');
    const { brainSettings, providerForConnection } = await import('../brain');
    const p = await providerForConnection(brainSettings().active);
    if (!p.local && s.dictation.voiceEdit === 'ask') {
      this.set({ phase: 'review', review: instruction, ask: `Send the selected text (${wordCount(selected)} words) and “${instruction}” to ${p.label}?`, how: 'edit' });
      this.hud.show('review');
      this.bindEsc(true);
      const ok = await new Promise<string | null>((resolve) => { this.reviewResolve = resolve; });
      if (ok === null) return this.finish();
      if (ok === 'always') await saveVoiceSettings({ dictation: { voiceEdit: 'on' } });
    }
    this.set({ phase: 'working', ask: undefined, review: undefined });
    const r = await p.chat([{ role: 'user', content: `Edit the text below as instructed. Reply with the edited text only — no introduction, quotes or notes. Keep its language unless told otherwise.\n\nInstruction: ${instruction}\n\n<text>\n${selected}\n</text>` }], [], { maxTokens: 4000, signal: AbortSignal.timeout(120_000) });
    const out = r.text.replace(/^\s*<text>\s*|\s*<\/text>\s*$/g, '').replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim();
    if (!out) return this.finish('The AI gave nothing back');
    await insertText(out, 'paste');
    if (s.dictation.history) await addTake({ id: t.id, at: t.startedAt, app: t.app, text: out, raw: `✎ ${instruction}`, language, durationMs, words: wordCount(out), engine: s.dictation.engine, outcome: 'edited' }, s.dictation.historyCap);
    return this.finish();
  }

  private finish(error?: string): DictationState {
    this.reviewResolve = null;
    this.bindEsc(false);
    this.set({ phase: 'idle', stable: '', pending: '', review: undefined, ask: undefined, error, level: 0 });
    if (!this.offer && this.hud.shape !== 'meeting') this.hud.show('hidden');
    if (error) setTimeout(() => { if (this.state.error === error) this.set({ error: undefined }); }, 6000);
    this.hud.releaseSoon();
    return this.state;
  }

  async cancel(): Promise<DictationState> {
    const t = this.take;
    if (this.state.phase === 'review') { this.confirmReview(null); return this.state; }
    if (!t) return this.state;
    t.cancelled = true;
    this.take = null;
    this.keys.reset();
    clearInterval(t.liveTimer);
    clearTimeout(t.maxTimer);
    this.captureOffIfIdle();
    if (voiceSettings().dictation.sounds) this.hud.send('voice-sound', 'cancel');
    return this.finish();
  }

  /** Review: type it (maybe edited), or null to throw it away. "always" answers a voice-edit question for good. */
  confirmReview(text: string | null) {
    const r = this.reviewResolve;
    this.reviewResolve = null;
    r?.(text);
  }

  async confirm(text?: string): Promise<DictationState> {
    this.confirmReview(text ?? this.state.review ?? '');
    return this.state;
  }

  /** A finished recording from elsewhere (the older Island recorder API): text with the chosen engine. */
  async transcribeBlob(audio: ArrayBuffer, mime: string): Promise<string> {
    const os = await import('node:os');
    const f = path.join(os.tmpdir(), `keeper-voice-${Date.now()}.${mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'}`);
    await fsp.writeFile(f, Buffer.from(audio));
    try {
      const s = voiceSettings().dictation;
      const samples = await whisper().samples(f);
      const r = await recognize(samples, { engine: s.engine, size: s.model, language: s.language, translate: s.translate, prompt: dictionaryPrompt(voiceSettings().dictionary) });
      return r.segments.map((x) => x.text.trim()).join(' ').trim();
    } finally {
      void fsp.rm(f, { force: true });
    }
  }

  // ---------------------------------------------------------------- history

  async history(q?: { query?: string; app?: string; limit?: number }) { return searchTakes(await loadTakes(), q); }
  removeTake = (id: string) => removeTakes([id]);
  clearHistory = () => removeTakes();
  async stats(): Promise<DictationStats> { return takeStats(await loadTakes(), Date.now(), voiceSettings().dictation.typingWpm); }

  async reuseTake(id: string, how: 'type' | 'copy') {
    const t = (await loadTakes()).find((x) => x.id === id);
    if (t) await insertText(t.text, how === 'copy' ? 'copy' : 'paste');
  }

  /** The person fixed a take's text: remember the words (suggestions wait for a yes). */
  async correct(id: string, fixed: string): Promise<DictEntry[]> {
    const t = (await loadTakes()).find((x) => x.id === id);
    if (!t) return [];
    const s = voiceSettings();
    const dict = learnFromCorrection(s.dictionary, t.text, fixed, () => randomUUID());
    await updateTake(id, { text: fixed, words: wordCount(fixed) });
    await saveVoiceSettings({ dictionary: dict });
    return readySuggestions(dict);
  }

  async preview(text: string, app?: string): Promise<string> {
    const s = voiceSettings();
    const r = resolveRules(app, s.apps, { tone: s.dictation.tone, commands: s.dictation.commands });
    return tidy(text, { tone: r.tone, mode: r.mode, commands: r.commands, fillers: s.dictation.fillers, formatting: s.dictation.formatting, dictionary: s.dictionary, snippets: s.snippets }).text;
  }

  // ---------------------------------------------------------------- models

  async downloadModel(size: WhisperSize): Promise<WhisperSize[]> {
    if (!WHISPER_MODELS[size]) throw new Error('Unknown model');
    this.downloading = { size, fraction: 0 };
    this.emit();
    try {
      await whisper().ensure(WHISPER_MODELS[size], (f) => { this.downloading = { size, fraction: f }; this.d.broadcast('voice-download', this.downloading); });
    } finally {
      this.downloading = undefined;
      this.d.broadcast('voice-download', null);
    }
    return whisper().installed();
  }

  async removeModel(size: WhisperSize): Promise<WhisperSize[]> {
    await whisper().remove(size);
    return whisper().installed();
  }

  async testKey(): Promise<{ ok: boolean; note?: string }> {
    if (!this.hook) await this.restartHook();
    return { ok: this.hookResult.ok, note: this.hookResult.ok ? `Listening with the ${this.hookResult.how}` : this.hookResult.note };
  }

  // ---------------------------------------------------------------- meetings

  live(): MeetingLive | undefined {
    const m = this.meetingRun;
    if (!m) return undefined;
    const now = Date.now();
    return {
      id: m.rec.id, title: m.rec.title, startedAt: m.rec.startedAt, paused: m.paused,
      elapsedMs: now - m.rec.startedAt - m.pausedMs - (m.paused && m.pausedAt ? now - m.pausedAt : 0),
      tracks: { mic: true, system: !!m.tracks.system },
      systemNote: m.rec.systemNote,
      utterances: m.rec.utterances.slice(-40),
      level: { mic: m.tracks.mic.level, system: m.tracks.system?.level ?? 0 },
    };
  }

  /** The whole live transcript (for AI abilities). */
  liveRecord(): MeetingRecord | null { return this.meetingRun?.rec ?? null; }

  async startMeeting(o: { title?: string; app?: string; offerId?: string } = {}): Promise<MeetingLive> {
    if (!featureOn('meetings')) throw new Error('Meeting recording is switched off (Settings → Features)');
    if (this.meetingRun) return this.live()!;
    const s = voiceSettings().meetings;
    const now = Date.now();
    const off = this.offer;
    this.offer = undefined;
    const ev = await this.eventAt(now, now + 30 * 60_000).catch(() => undefined);
    const rec: MeetingRecord = {
      id: `${new Date(now).toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`,
      title: o.title?.trim() || ev?.title || (o.app ?? off?.app ? `${o.app ?? off?.app} call` : 'Meeting'),
      startedAt: now, durationMs: 0, app: o.app ?? off?.app, speakers: [], utterances: [], event: ev,
    };
    const run: MeetingRun = { rec, paused: false, pausedMs: 0, tracks: { mic: { samples: new Samples(), cut: 0, level: 0 } }, queue: Promise.resolve(), pending: 0, prints: new Map() };
    this.meetingRun = run;
    if (s.keepAudio) await this.openTrackFile(run, 'mic');
    if (s.systemAudio) {
      run.tracks.system = { samples: new Samples(), cut: 0, level: 0 };
      if (s.keepAudio) await this.openTrackFile(run, 'system');
      const { startSystemAudio } = await import('./system-audio');
      const r = await startSystemAudio((x) => { if (this.meetingRun === run && !run.paused) this.meetingAudio('system', x); });
      if (r === 'renderer') { /* Windows: the capture window records loopback */ }
      else if ('error' in r) { rec.systemNote = r.error; run.tracks.system = undefined; }
      else run.sys = r;
    }
    await this.captureOn();
    this.hud.show(voiceSettings().dictation.hud === 'island' ? 'hidden' : 'meeting');
    run.timer = setInterval(() => this.cutPieces(run, false), 2000);
    // The Island's recording activity says it already; without the Island, a notice.
    if (!featureOn('island')) this.d.alert('Recording this meeting', 'Remember to tell everyone it is being recorded.');
    this.d.updateTray();
    this.emit();
    return this.live()!;
  }

  private async openTrackFile(run: MeetingRun, track: 'mic' | 'system') {
    await fsp.mkdir(meetingsDir(), { recursive: true });
    const file = path.join(meetingsDir(), `${run.rec.id}.${track}.pcm`);
    const tr = track === 'mic' ? run.tracks.mic : run.tracks.system!;
    tr.file = file;
    tr.out = createWriteStream(file);
  }

  private meetingAudio(track: 'mic' | 'system', x: Float32Array) {
    const run = this.meetingRun!;
    const tr = track === 'mic' ? run.tracks.mic : run.tracks.system;
    if (!tr) return;
    tr.samples.push(x);
    tr.level = meter(rms(x));
    if (tr.out) {
      const b = Buffer.alloc(x.length * 2);
      for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), i * 2);
      tr.out.write(b);
    }
  }

  /** Finished pieces of speech (a pause after them) go to the recognizer, one at a time. */
  private cutPieces(run: MeetingRun, final: boolean) {
    for (const track of ['mic', 'system'] as const) {
      const tr = track === 'mic' ? run.tracks.mic : run.tracks.system;
      if (!tr) continue;
      const pending = tr.samples.slice(tr.cut);
      if (!final && pending.length < SR * 2) continue;
      const pieces = speechPieces(pending, { minPause: 0.6, maxSec: 25 });
      const endSec = pending.length / SR;
      for (const p of pieces) {
        if (!final && p.end > endSec - 0.7) break;
        const from = tr.cut + Math.round(p.start * SR);
        const to = tr.cut + Math.round(p.end * SR);
        this.transcribePiece(run, track, tr.samples.slice(Math.max(0, from - SR * 0.15), to + SR * 0.15), Math.max(0, from / SR - 0.15));
      }
      const done = final ? pieces.length : pieces.filter((p) => p.end <= endSec - 0.7).length;
      if (final) tr.cut = tr.samples.n;
      else if (done) tr.cut += Math.round(pieces[done - 1].end * SR);
      else if (!pieces.length) tr.cut = tr.samples.n - Math.round(SR * 0.5);
      // let go of sound already handled (keep the buffer small in long meetings)
      if (tr.cut > SR * 120) { tr.samples = Object.assign(new Samples(), { buf: tr.samples.buf.slice(tr.cut), n: tr.samples.n - tr.cut }); (tr as TrackRun & { base?: number }).base = ((tr as TrackRun & { base?: number }).base ?? 0) + tr.cut; tr.cut = 0; }
    }
  }

  private transcribePiece(run: MeetingRun, track: 'mic' | 'system', samples: Float32Array, startSec: number) {
    const tr = (track === 'mic' ? run.tracks.mic : run.tracks.system) as TrackRun & { base?: number };
    const offset = startSec + (tr.base ?? 0) / SR;
    const s = voiceSettings();
    run.pending++;
    run.queue = run.queue.then(async () => {
      try {
        if (rms(samples) < 0.003) return;
        const r = await recognize(samples, { engine: s.dictation.engine === 'cloud' ? 'cloud' : 'device', size: s.meetings.model, language: run.rec.language ?? s.meetings.language, prompt: dictionaryPrompt(s.dictionary), offset });
        if (!run.rec.language && s.meetings.language === 'auto') run.rec.language = r.language;
        const text = r.segments.map((x) => x.text.trim()).join(' ').replace(/\[BLANK_AUDIO\]/g, '').trim();
        if (!text) return;
        const u: Utterance = { id: newUtteranceId(track, offset), start: offset, end: offset + samples.length / SR, speaker: track === 'mic' ? 'me' : 's1', text, track };
        if (track === 'system' && s.meetings.diarize) run.prints.set(u.id, voicePrint(samples));
        run.rec.utterances = sortUtterances([...run.rec.utterances, u]);
        if (!run.rec.speakers.some((x) => x.id === u.speaker)) run.rec.speakers.push(track === 'mic' ? { id: 'me', label: 'You', track: 'mic', estimated: false } : { id: 's1', label: 'Others', track: 'system', estimated: true });
        this.d.broadcast('voice-meeting', this.live());
      } catch {
        /* a piece that can't be read is skipped */
      } finally {
        run.pending--;
      }
    });
  }

  async pauseMeeting(paused: boolean): Promise<MeetingLive | null> {
    const run = this.meetingRun;
    if (!run || run.paused === paused) return this.live() ?? null;
    run.paused = paused;
    if (paused) { run.pausedAt = Date.now(); this.cutPieces(run, true); }
    else { run.pausedMs += Date.now() - (run.pausedAt ?? Date.now()); run.pausedAt = undefined; }
    this.emit();
    this.d.updateTray();
    return this.live() ?? null;
  }

  async stopMeeting(): Promise<MeetingRecord | null> {
    const run = this.meetingRun;
    if (!run) return null;
    if (run.paused) await this.pauseMeeting(false);
    clearInterval(run.timer);
    run.sys?.stop();
    this.meetingRun = null;
    this.captureOffIfIdle();
    this.hud.show('hidden');
    this.cutPieces(run, true);
    this.d.broadcast('voice-meeting', null);
    this.emit();
    this.d.updateTray();
    const rec = run.rec;
    rec.endedAt = Date.now();
    rec.durationMs = rec.endedAt - rec.startedAt - run.pausedMs;
    this.d.alert('Finishing the transcript', `${run.pending} piece${run.pending === 1 ? '' : 's'} left to write down`);
    await run.queue;
    const s = voiceSettings().meetings;
    const cleaned = dropEcho(rec.utterances);
    const labelled = labelSpeakers(cleaned.map((u) => ({ ...u, print: run.prints.get(u.id) })), { diarize: s.diarize });
    rec.utterances = labelled.utterances;
    rec.speakers = labelled.speakers;
    for (const sp of rec.speakers) if (sp.track === 'system') sp.print = meanPrint(rec.utterances.filter((u) => u.speaker === sp.id).map((u) => run.prints.get(u.id)));
    rec.prints = [...run.prints.values()].filter((p): p is Float32Array => !!p).slice(0, 300).map((p) => Array.from(p, (v) => Math.round(v * 1000) / 1000));
    for (const tr of [run.tracks.mic, run.tracks.system]) await new Promise<void>((r) => (tr?.out ? tr.out.end(() => r()) : r()));
    if (s.keepAudio) rec.audio = { mic: await pcmToWav(run.tracks.mic.file), system: await pcmToWav(run.tracks.system?.file) };
    if (!rec.event) rec.event = await this.eventAt(rec.startedAt, rec.endedAt).catch(() => undefined);
    await this.suggest(rec);
    await saveMeeting(rec);
    if (s.autoNotes && rec.utterances.length) await this.writeNotes(rec.id).catch(() => undefined);
    this.d.alert('Meeting saved', `${rec.title}: ${rec.utterances.length} lines`);
    this.d.broadcast('voice-meetings-changed');
    return (await readMeeting(rec.id)) ?? rec;
  }

  private async eventAt(from: number, to: number): Promise<MeetingRecord['event']> {
    const evs = (await this.d.events?.(from - 15 * 60_000, to + 15 * 60_000)) ?? [];
    const e = bestEvent(evs, from, to);
    return e ? { id: e.id, title: e.title, start: e.start, end: e.end, attendees: e.attendees ?? [], url: e.url } : undefined;
  }

  async eventsNear(id: string) {
    const m = await readMeeting(id);
    if (!m) return [];
    const evs = (await this.d.events?.(m.startedAt - 3 * 3600_000, m.startedAt + 3 * 3600_000)) ?? [];
    return evs.filter((e) => !e.allDay).map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end }));
  }

  async linkEvent(id: string, eventId: string | null): Promise<MeetingRecord | null> {
    const m = await readMeeting(id);
    if (!m) return null;
    if (!eventId) m.event = undefined;
    else {
      const evs = (await this.d.events?.(m.startedAt - 3 * 3600_000, m.startedAt + 3 * 3600_000)) ?? [];
      const e = evs.find((x) => x.id === eventId);
      if (e) m.event = { id: e.id, title: e.title, start: e.start, end: e.end, attendees: e.attendees ?? [], url: e.url };
    }
    await this.suggest(m);
    await saveMeeting(m);
    return m;
  }

  async renameSpeaker(meetingId: string, speakerId: string, label: string) {
    const m = await readMeeting(meetingId);
    if (!m) return null;
    const name = label.trim();
    m.speakers = m.speakers.map((s) => (s.id === speakerId ? { ...s, label: name || s.label, estimated: false, suggestion: undefined } : s));
    // A name the person confirmed: remember how this voice sounds, to suggest it next time.
    const sp = m.speakers.find((s) => s.id === speakerId);
    if (sp?.print && name && !/^(speaker \d+|others|you)$/i.test(name) && voiceSettings().meetings.rememberVoices) await saveVoices(rememberVoice(await loadVoices(), name, sp.print));
    await this.suggest(m);
    await saveMeeting(m);
    return m;
  }

  /** Name suggestions for speakers still told apart only by voice. */
  private async suggest(m: MeetingRecord) {
    for (const s of m.speakers) delete s.suggestion;
    if (!voiceSettings().meetings.rememberVoices && !m.event?.attendees.length) return;
    const taken = new Set(m.speakers.filter((s) => !s.estimated).map((s) => s.label.trim().toLowerCase()));
    const profiles = voiceSettings().meetings.rememberVoices ? (await loadVoices()).filter((p) => !taken.has(p.name.trim().toLowerCase())) : [];
    const attendees = (m.event?.attendees ?? []).filter((a) => !taken.has(a.trim().toLowerCase()));
    const sug = suggestNames(m.speakers, profiles, { attendees, population: m.prints ?? [] });
    for (const s of m.speakers) { const x = sug.get(s.id); if (x) s.suggestion = x; }
  }

  async voices() { return (await loadVoices()).map((p) => ({ name: p.name, n: p.n, at: p.at })); }
  async forgetVoices(name?: string) { await saveVoices(name ? (await loadVoices()).filter((p) => p.name !== name) : []); }

  async renameMeeting(id: string, title: string) {
    const m = await readMeeting(id);
    if (!m) return null;
    m.title = title.trim() || m.title;
    await saveMeeting(m);
    return m;
  }

  meetings = listMeetings;
  meeting = readMeeting;
  removeMeeting = deleteMeeting;

  /** Summary, decisions and action items, by the chosen AI (local first) or plain rules; then the note and tasks. */
  async writeNotes(id: string): Promise<MeetingRecord | null> {
    const m = await readMeeting(id);
    if (!m) return null;
    const s = voiceSettings().meetings;
    let notes = null;
    if (s.notesAi !== 'rules') {
      const p = await aiFor(s.notesAi === 'local').catch(() => null);
      if (p) {
        const r = await p.chat([{ role: 'user', content: notesPrompt(m) }], [], { maxTokens: 2000, signal: AbortSignal.timeout(180_000) }).catch(() => null);
        notes = r ? parseNotesReply(r.text, p.label) : null;
      }
    }
    m.notes = notes ?? ruleNotes(m);
    if (s.actionsToTasks && featureOn('pim')) {
      const { pim } = await import('../pim');
      for (const a of m.notes.actions) {
        if (a.taskId) continue;
        const r = await pim.saveReminder({ id: '', list: 'local', title: a.text.slice(0, 200), notes: `From “${m.title}”${a.owner ? ` · ${a.owner}` : ''}${a.due ? ` · due ${a.due}` : ''}`, done: false }).catch(() => null);
        if (r) a.taskId = r.id;
      }
    }
    m.notePath = await this.writeNoteFile(m).catch(() => m.notePath);
    await saveMeeting(m);
    this.d.broadcast('voice-meetings-changed');
    return m;
  }

  private async writeNoteFile(m: MeetingRecord): Promise<string | undefined> {
    const t = voiceSettings().meetings.notesTarget;
    const md = toMarkdown(m);
    const name = `${meetingFileName(m)}.md`;
    if (t.kind === 'folder' && t.path) {
      await fsp.mkdir(t.path, { recursive: true });
      const f = path.join(t.path, name);
      await fsp.writeFile(f, md);
      return f;
    }
    if (t.kind === 'vault' && t.id) {
      const notes = await import('../notes');
      const rel = path.posix.join(t.folder || 'Meetings', name);
      await notes.write(t.id, rel, md, 'Keeper meetings');
      return `vault:${t.id}:${rel}`;
    }
    return undefined;
  }

  async exportMeeting(id: string, format: ExportFormat): Promise<string | null> {
    const m = await readMeeting(id);
    if (!m) return null;
    const body = format === 'md' ? toMarkdown(m) : format === 'srt' ? toSrt(m) : format === 'vtt' ? toVtt(m) : format === 'json' ? JSON.stringify(m, null, 2) : toTxt(m);
    const { app, dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow();
    const def = path.join(app.getPath('documents'), `${meetingFileName(m)}.${format}`);
    const r = win ? await dialog.showSaveDialog(win, { defaultPath: def }) : { canceled: false, filePath: def };
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, body);
    return r.filePath;
  }

  /** The text of an export, without saving (CLI, abilities). */
  async exportText(id: string, format: ExportFormat): Promise<string | null> {
    const m = id === 'live' ? this.liveRecord() : await readMeeting(id);
    if (!m) return null;
    return format === 'md' ? toMarkdown(m) : format === 'srt' ? toSrt(m) : format === 'vtt' ? toVtt(m) : format === 'json' ? JSON.stringify(m, null, 2) : toTxt(m);
  }

  // ---------------------------------------------------------------- noticing calls

  startDetection() {
    this.stopDetect?.();
    this.stopDetect = undefined;
    if (!featureOn('meetings') || !featureOn('meetingDetect') || !voiceSettings().meetings.detect) return;
    this.stopDetect = poll('voice.detect', { baseMs: 15_000, pauseWhenLocked: true, idleFactor: 2 }, () => this.detectOnce(), { feature: ['meetings', 'meetingDetect'] });
  }

  stopDetection() { this.stopDetect?.(); this.stopDetect = undefined; }

  async detectOnce(input?: { micApps?: string[]; windows?: { app: string; title: string }[] }): Promise<MeetingOffer | undefined> {
    if (this.meetingRun) return undefined;
    const mic = input?.micApps ?? this.d.micApps?.() ?? (await micApps());
    if (!mic.length) { if (this.offer) { this.offer = undefined; this.hud.show('hidden'); this.emit(); } return undefined; }
    const now = Date.now();
    const windows = input?.windows ?? (await openWindows());
    const events = ((await this.d.events?.(now - 3600_000, now + 3600_000).catch(() => [])) ?? []).filter((e) => !e.allDay);
    const found = detectMeeting({ micApps: mic, windows, events, extraApps: voiceSettings().meetings.extraApps, now });
    if (!found) return undefined;
    const quiet = this.dismissed.get(found.app);
    if (quiet && quiet > now) return undefined;
    if (this.offer?.app === found.app) return this.offer;
    this.offer = { id: randomUUID(), app: found.app, reason: found.reason, event: found.event, at: now };
    // Pops up over the call itself, plus a system notification.
    await this.hud.ensure();
    this.hud.show('offer');
    this.emit();
    if (Notification.isSupported()) {
      const n = new Notification({ title: `Record this ${found.app} call?`, body: `${found.reason}. Tell everyone before recording.`, silent: true });
      n.on('click', () => void this.startMeeting({ app: found.app, offerId: this.offer?.id }));
      n.show();
    }
    return this.offer;
  }

  async dismissOffer(id: string, forApp = false) {
    if (this.offer?.id !== id) return;
    this.dismissed.set(this.offer.app, Date.now() + (forApp ? 30 * 86_400_000 : 2 * 3600_000));
    this.offer = undefined;
    this.hud.show('hidden');
    this.hud.releaseSoon();
    this.emit();
  }

  shutdown() {
    this.stopHook();
    this.stopDetection();
    if (this.take) void this.cancel();
    if (this.meetingRun) void this.stopMeeting();
    this.hud.destroy();
  }
}

async function pcmToWav(file?: string): Promise<string | undefined> {
  if (!file) return undefined;
  const pcm = await fsp.readFile(file).catch(() => null);
  if (!pcm) return undefined;
  const out = file.replace(/\.pcm$/, '.wav');
  const h = wav(new Float32Array(0));
  h.writeUInt32LE(36 + pcm.length, 4);
  h.writeUInt32LE(pcm.length, 40);
  await fsp.writeFile(out, Buffer.concat([h, pcm]));
  await fsp.rm(file, { force: true });
  return out;
}

/** The AI for notes: one on this computer first (when asked), else the one chosen in Settings. */
async function aiFor(localOnly: boolean) {
  const { brainSettings, providerForConnection } = await import('../brain');
  const b = brainSettings();
  const order = [b.active, ...b.connections.map((c) => c.id).filter((id) => id !== b.active)];
  for (const id of order) {
    const p = await providerForConnection(id).catch(() => null);
    if (!p) continue;
    if (!localOnly || p.local) return p;
  }
  return null;
}

/** A last careful pass by an AI on this computer: punctuation and obvious slips only. */
async function polish(text: string): Promise<string> {
  const p = await aiFor(true);
  if (!p) return text;
  const r = await p.chat([{ role: 'user', content: `Fix only punctuation, capitals and obvious recognition slips in this dictated text. Do not reword, add or remove anything else. Reply with the text only.\n\n<text>\n${text}\n</text>` }], [], { maxTokens: 2000, signal: AbortSignal.timeout(8000) });
  const out = r.text.replace(/^\s*<text>\s*|\s*<\/text>\s*$/g, '').trim();
  // a reply that changed too much is not trusted
  return out && Math.abs(out.length - text.length) < text.length * 0.25 ? out : text;
}

async function micApps(): Promise<string[]> {
  if (process.platform === 'darwin') {
    try {
      const { macHelperCall } = await import('../platform/mac');
      const r = await macHelperCall<{ inUse: boolean; apps: string[] }>('voice.micState', {}, 4000);
      return r.inUse ? r.apps : [];
    } catch { return []; }
  }
  const { micInUse } = await import('../media');
  return micInUse();
}

/** Open windows' app and title (only asked while something uses the microphone). */
async function openWindows(): Promise<{ app: string; title: string }[]> {
  const { run } = await import('../../../core/platform');
  if (process.platform === 'win32') {
    const { psRun } = await import('../ps-host');
    const r = await psRun("Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + \"`t\" + $_.MainWindowTitle }", 6000);
    return r.stdout.split(/\r?\n/).filter(Boolean).map((l) => { const [app, ...t] = l.split('\t'); return { app, title: t.join('\t') }; });
  }
  if (process.platform === 'linux') {
    const r = await run('wmctrl', ['-lx'], 3000);
    if (r.ok) return r.stdout.split('\n').filter(Boolean).map((l) => { const p = l.split(/\s+/); return { app: (p[2] ?? '').split('.').pop() ?? '', title: p.slice(4).join(' ') }; });
    const id = (await run('xdotool', ['getactivewindow'], 2000)).stdout.trim();
    if (!id) return [];
    const title = (await run('xdotool', ['getwindowname', id], 2000)).stdout.trim();
    return [{ app: (await frontmostApp().catch(() => '')) ?? '', title }];
  }
  // macOS: titles need Screen Recording permission; the app in front is enough with the calendar.
  return [{ app: (await frontmostApp().catch(() => '')) ?? '', title: '' }];
}

export function allTextOf(s: StreamState) { return allText(s); }
