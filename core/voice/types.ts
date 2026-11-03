// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Voice: dictation anywhere and meeting recording. The shapes shared by the
// main process, the interface, the command line and AI abilities.

import type { WhisperSize } from '../whisper';

/** How finished text should sound in an app. "verbatim" changes nothing but spoken commands. */
export type Tone = 'auto' | 'casual' | 'neutral' | 'professional' | 'verbatim';
/** prose for chat and prompt boxes; exact keeps flags, symbols and case for shells and code */
export type TextMode = 'auto' | 'prose' | 'exact';
export type InsertMode = 'paste' | 'type' | 'copy';
/** where speech becomes text: this computer (default), the system recognizer (macOS), or a service the person chose */
export type SpeechEngine = 'device' | 'system' | 'cloud';
/** the key held (or tapped) to talk */
export type HoldKey = 'fn' | 'rightAlt' | 'rightCtrl' | 'rightMeta' | 'rightShift' | 'capsLock' | 'f13' | 'f14' | 'f15' | 'f16' | 'f17' | 'f18' | 'f19' | 'f5' | 'f9' | 'scrollLock' | 'pause';
export type HudPlace = 'island' | 'pill' | 'both';
export type Corner = 'top' | 'top-left' | 'top-right' | 'bottom' | 'bottom-left' | 'bottom-right';

export interface AppRule {
  id: string;
  /** app name as the system reports it (case-insensitive, part of the name is enough) */
  app: string;
  tone?: Tone;
  mode?: TextMode;
  insert?: InsertMode;
  /** spoken commands ("new line", "comma") in this app */
  commands?: boolean;
  /** never type here: the take is kept in history only */
  exclude?: boolean;
}

export interface DictEntry {
  id: string;
  /** how it should be written */
  word: string;
  /** what the recognizer tends to write instead (fixed after the fact) */
  heard?: string[];
  /** only for this language ("en"); everywhere when empty */
  lang?: string;
  uses?: number;
  /** suggested from your corrections, waiting for a yes */
  suggested?: boolean;
}

export interface Snippet {
  id: string;
  /** what you say ("my address"); '' for a snippet that is only typed */
  trigger: string;
  /** what you type for it (";addr"); typed snippets, core/typing/expand.ts */
  abbr?: string;
  /** what is typed, word for word (typed snippets fill in {date}, {clipboard}, {cursor}…) */
  text: string;
  uses?: number;
}

export interface DictationSettings {
  key: HoldKey;
  /** hold the key; tap it to lock on; or hands-free (starts on speech, stops after a pause) */
  mode: 'hold' | 'toggle' | 'handsfree';
  doubleTapLatch: boolean;
  /** the global shortcut that toggles dictation where no key hook is possible */
  shortcut: string;
  /** another shortcut: say how to change the selected text */
  editShortcut: string;
  engine: SpeechEngine;
  model: WhisperSize;
  /** "auto" or a language code */
  language: string;
  /** write English whatever language is spoken */
  translate: boolean;
  /** show the text first; Return types it, Esc throws it away */
  review: boolean;
  /** spoken punctuation and formatting commands: everywhere, only in editors and terminals, or never */
  commands: 'everywhere' | 'editors' | 'off';
  fillers: boolean;
  /** numbers, times, dates, money, emails and links written the usual way */
  formatting: boolean;
  tone: Tone;
  /** a last tidy-up pass by an AI on this computer (never sent anywhere), with the rule-tidied text as fallback */
  aiPolish: boolean;
  insert: InsertMode;
  /** seconds of quiet that end a hands-free take */
  silenceSec: number;
  /** a take stops by itself after this many seconds */
  maxSec: number;
  sounds: boolean;
  hud: HudPlace;
  corner: Corner;
  /** microphone deviceId; empty for the system default */
  mic: string;
  history: boolean;
  historyCap: number;
  /** keep the recording of each take (otherwise only the text) */
  keepAudio: boolean;
  /** "edit by voice": the selected text and your instruction go to the AI you chose */
  voiceEdit: 'off' | 'ask' | 'on';
  /** words per minute you type, for "time saved" */
  typingWpm: number;
  /** in editors and terminals, hand the project's file and symbol names to the recognizer */
  codeTerms: boolean;
}

export interface MeetingSettings {
  /** notice calls (a meeting app or a meeting page using the microphone) and offer to record */
  detect: boolean;
  /** record the computer's sound (the other people) as well as the microphone */
  systemAudio: boolean;
  /** tell speakers apart after the call */
  diarize: boolean;
  /** write a summary, decisions and action items when it ends */
  autoNotes: boolean;
  /** where notes go: a Keeper Notes vault id, or a folder path */
  notesTarget: { kind: 'vault'; id: string; folder: string } | { kind: 'folder'; path: string } | { kind: 'none' };
  /** which AI writes the notes: one on this computer (else plain rules), the AI chosen in Settings, or no AI */
  notesAi: 'local' | 'active' | 'rules';
  /** action items become reminders */
  actionsToTasks: boolean;
  keepAudio: boolean;
  language: string;
  model: WhisperSize;
  /** AIs may read the live transcript through the meeting abilities */
  liveForAI: boolean;
  /** remember the voices of people you name, to suggest their names next time (on this computer only) */
  rememberVoices: boolean;
  /** meeting apps and page titles that count as a call (added to the built-in list) */
  extraApps: string[];
}

export interface VoiceSurfaces {
  /** dictation and meeting items in the menu bar / tray */
  tray: boolean;
  /** Island live activity while listening or recording */
  island: boolean;
  /** palette commands */
  palette: boolean;
}

export interface VoiceSettings {
  dictation: DictationSettings;
  meetings: MeetingSettings;
  surfaces: VoiceSurfaces;
  apps: AppRule[];
  dictionary: DictEntry[];
  snippets: Snippet[];
}

// ---------------------------------------------------------------- live state

export type DictationPhase = 'idle' | 'listening' | 'locked' | 'working' | 'review' | 'editing';

export interface DictationState {
  phase: DictationPhase;
  /** what the recognizer has so far (finished part, then the part still changing) */
  stable: string;
  pending: string;
  /** the tidied text waiting for review */
  review?: string;
  app?: string;
  since?: number;
  level?: number;
  /** "hold", "locked", "hands-free", "edit" */
  how?: string;
  error?: string;
  /** a question waiting for a yes before anything is sent (voice edit to an online AI) */
  ask?: string;
  /** the rules in use for the app in front */
  tone?: string;
  /** shown in the Island (false when only the floating pill is chosen) */
  island?: boolean;
  /** the key hook is not available here and why (Wayland, permission) */
  keyNote?: string;
}

export interface Take {
  id: string;
  at: number;
  app?: string;
  /** what was typed */
  text: string;
  /** what the recognizer heard */
  raw: string;
  language?: string;
  durationMs: number;
  words: number;
  engine: SpeechEngine;
  /** typed, copied, kept (excluded app or password field), cancelled, edited */
  outcome: 'typed' | 'copied' | 'kept' | 'edited';
  /** a recording kept with the take */
  audio?: string;
}

export interface DictationStats {
  takes: number;
  words: number;
  minutesSpoken: number;
  /** compared with typing at the person's own speed */
  minutesSaved: number;
  activeDays28: number;
  dailyAverage: number;
  /** words per day, oldest first, last 28 days */
  spark: number[];
  topApps: { app: string; words: number }[];
}

// ---------------------------------------------------------------- meetings

export interface Speaker {
  id: string;
  /** what is shown: "You", "Speaker 2", or a name the person gave */
  label: string;
  /** from the microphone (you) or the computer's sound (the others) */
  track: 'mic' | 'system';
  /** labels from sound alone are guesses: say so */
  estimated: boolean;
  /** the average voice print of this speaker's pieces (computer's sound only) */
  print?: number[];
  /** a name to suggest (a remembered voice, or the only other person invited); never applied by itself */
  suggestion?: { name: string; why: string; score: number };
}

export interface Utterance {
  id: string;
  /** seconds from the start */
  start: number;
  end: number;
  speaker: string;
  text: string;
  track: 'mic' | 'system';
}

export interface ActionItem { text: string; owner?: string; due?: string; taskId?: string }

export interface MeetingNotes {
  summary: string;
  decisions: string[];
  actions: ActionItem[];
  /** "ai" (which provider) or "rules" (no AI chosen) */
  by: string;
  at: number;
}

export interface MeetingRecord {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  /** paused time doesn't count */
  durationMs: number;
  /** the app or page it came from */
  app?: string;
  language?: string;
  speakers: Speaker[];
  utterances: Utterance[];
  notes?: MeetingNotes;
  /** the calendar event it belongs to */
  event?: { id: string; title: string; start: number; end: number; attendees: string[]; url?: string };
  /** where the note was written */
  notePath?: string;
  audio?: { mic?: string; system?: string };
  /** sound from the computer could not be recorded here; why */
  systemNote?: string;
  /** the voice prints of the pieces (to compare remembered voices on one footing) */
  prints?: number[][];
}

export interface MeetingLive {
  id: string;
  title: string;
  startedAt: number;
  paused: boolean;
  elapsedMs: number;
  tracks: { mic: boolean; system: boolean };
  systemNote?: string;
  utterances: Utterance[];
  level: { mic: number; system: number };
}

export interface MeetingOffer {
  id: string;
  app: string;
  /** "Zoom is using the microphone", "A meeting page is open in Chrome" */
  reason: string;
  event?: { title: string; start: number };
  at: number;
}

export type ExportFormat = 'md' | 'srt' | 'vtt' | 'txt' | 'json';

export interface VoiceStatus {
  dictation: DictationState;
  meeting?: MeetingLive;
  offer?: MeetingOffer;
  /** speech models on this computer */
  models: WhisperSize[];
  /** the model being downloaded */
  downloading?: { size: WhisperSize; fraction: number };
  /** what this computer can do */
  supports: { holdKey: boolean; keyHow: string; systemAudio: boolean; systemHow: string; passwordGuard: boolean; typeInsert: boolean; systemEngine: boolean };
  platform: string;
}

export interface VoiceApi {
  status(): Promise<VoiceStatus>;
  settings(): Promise<VoiceSettings>;
  setSettings(patch: DeepPartial<VoiceSettings>): Promise<VoiceSettings>;
  /** dictation */
  start(how?: 'toggle' | 'hold' | 'edit'): Promise<DictationState>;
  stop(): Promise<DictationState>;
  toggle(): Promise<DictationState>;
  cancel(): Promise<DictationState>;
  /** after review: type it, or throw it away */
  confirm(text?: string): Promise<DictationState>;
  history(q?: { query?: string; app?: string; limit?: number }): Promise<Take[]>;
  removeTake(id: string): Promise<void>;
  clearHistory(): Promise<void>;
  stats(): Promise<DictationStats>;
  /** type a past take again, or copy it */
  reuseTake(id: string, how: 'type' | 'copy'): Promise<void>;
  /** the text was corrected: learn the words (suggestions wait for a yes) */
  correct(id: string, fixed: string): Promise<DictEntry[]>;
  /** try the tidy-up rules on some text, for the settings preview */
  preview(text: string, app?: string): Promise<string>;
  /** speech models */
  downloadModel(size: WhisperSize): Promise<WhisperSize[]>;
  removeModel(size: WhisperSize): Promise<WhisperSize[]>;
  /** test the key hook: resolves with what was pressed */
  testKey(): Promise<{ ok: boolean; note?: string }>;
  /** meetings */
  meetings(): Promise<MeetingRecord[]>;
  meeting(id: string): Promise<MeetingRecord | null>;
  startMeeting(o?: { title?: string; app?: string; offerId?: string }): Promise<MeetingLive>;
  pauseMeeting(paused: boolean): Promise<MeetingLive | null>;
  stopMeeting(): Promise<MeetingRecord | null>;
  dismissOffer(id: string, forApp?: boolean): Promise<void>;
  renameSpeaker(meetingId: string, speakerId: string, label: string): Promise<MeetingRecord | null>;
  renameMeeting(id: string, title: string): Promise<MeetingRecord | null>;
  writeNotes(id: string): Promise<MeetingRecord | null>;
  exportMeeting(id: string, format: ExportFormat): Promise<string | null>;
  removeMeeting(id: string): Promise<void>;
  linkEvent(id: string, eventId: string | null): Promise<MeetingRecord | null>;
  /** calendar events around a meeting, to link it */
  eventsNear(id: string): Promise<{ id: string; title: string; start: number; end: number }[]>;
  /** the menu-bar items as text */
  tray(): Promise<string[]>;
  /** voices remembered from names you confirmed */
  voices(): Promise<{ name: string; n: number; at: number }[]>;
  forgetVoices(name?: string): Promise<void>;
  /** dictation statistics as a PNG (base64) saved to Downloads; returns the path */
  saveStatsPng(base64: string): Promise<string>;
  /** the floating listening pill (its own window) */
  hud: { ready(): Promise<{ settings: VoiceSettings; state: DictationState; meeting?: MeetingLive; offer?: MeetingOffer; capture?: { mic: boolean; deviceId?: string; system: boolean } }>; audio(track: 'mic' | 'system', samples: Float32Array): void; level(n: number): void; key(k: 'enter' | 'escape' | 'always'): void };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
