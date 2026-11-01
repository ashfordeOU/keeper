// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { KeyMachine, parseHookLine } from '../core/voice/keys';
import { Vad, speechPieces, meter } from '../core/voice/vad';
import { advance, agreedWords, allText, display, newStream } from '../core/voice/stream';
import { cluster, cosine, dropEcho, labelSpeakers, standardize, voicePrint } from '../core/voice/diarize';
import { bestEvent, detectMeeting, liveText, meetingFileName, notesPrompt, parseNotesReply, ruleNotes, stamp, toMarkdown, toSrt, toTxt, toVtt, transcriptLines } from '../core/voice/meeting';
import { pruneTakes, searchTakes, takeStats } from '../core/voice/history';
import { defaultVoiceSettings, mergeVoiceSettings, normalizeVoiceSettings } from '../core/voice/settings';
import type { MeetingRecord, Take, Utterance } from '../core/voice/types';
import { bpeFromTokenizer, langToken, promptTokens, TOK, TOK_V3, tokensFor, WHISPER_MODELS, applyTimestampRules } from '../core/whisper';

describe('the talk key', () => {
  it('hold to talk, release to finish', () => {
    const k = new KeyMachine({ mode: 'hold', doubleTapLatch: true });
    expect(k.down(0)).toBe('start');
    expect(k.down(50)).toBe('none'); // key repeat
    expect(k.up(2000)).toBe('stop');
    expect(k.phase).toBe('idle');
  });
  it('a tap locks it on; the next press finishes', () => {
    const k = new KeyMachine({ mode: 'hold', doubleTapLatch: true });
    k.down(0);
    expect(k.up(120)).toBe('lock');
    expect(k.phase).toBe('locked');
    expect(k.down(5000)).toBe('stop');
    expect(k.up(5100)).toBe('none');
  });
  it('without latching a tap is too short and is thrown away', () => {
    const k = new KeyMachine({ mode: 'hold', doubleTapLatch: false });
    k.down(0);
    expect(k.up(100)).toBe('cancel');
  });
  it('Esc cancels; toggle and hands-free modes', () => {
    const k = new KeyMachine({ mode: 'hold', doubleTapLatch: true });
    k.down(0);
    expect(k.escape()).toBe('cancel');
    expect(k.escape()).toBe('none');
    const t = new KeyMachine({ mode: 'toggle', doubleTapLatch: false });
    expect(t.down(0)).toBe('start');
    expect(t.up(3000)).toBe('none');
    expect(t.down(4000)).toBe('stop');
    const h = new KeyMachine({ mode: 'handsfree', doubleTapLatch: false });
    expect(h.down(0)).toBe('start');
    expect(h.phase).toBe('handsfree');
  });
  it('reads hook lines', () => {
    expect(parseHookLine('key 97 down')).toEqual({ code: '97', down: true });
    expect(parseHookLine('key Control_R up')).toEqual({ code: 'Control_R', down: false });
    expect(parseHookLine('ready')).toBeNull();
  });
});

const tone = (sec: number, freq: number, amp = 0.3, sr = 16000) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr));
const silence = (sec: number) => new Float32Array(Math.round(sec * 16000)).map(() => (Math.random() - 0.5) * 0.001);
const cat = (...a: Float32Array[]) => { const out = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

describe('voice activity', () => {
  it('notices speech and the pause after it', () => {
    const v = new Vad(0.8);
    const ev = v.push(cat(silence(1), tone(1.5, 220), silence(1.5)));
    expect(ev.map((e) => e.type)).toEqual(['speech', 'silence']);
    expect(ev[0].at).toBeGreaterThan(0.8);
    expect(ev[0].at).toBeLessThan(1.2);
  });
  it('cuts a recording at pauses, and long speech at its quietest point', () => {
    const p = speechPieces(cat(silence(0.5), tone(2, 300), silence(1), tone(1, 200), silence(0.5)));
    expect(p).toHaveLength(2);
    expect(p[0].start).toBeCloseTo(0.5, 0);
    expect(p[1].end).toBeCloseTo(4.5, 0);
    const long = speechPieces(tone(40, 250), { maxSec: 10 });
    expect(long.length).toBeGreaterThanOrEqual(4);
    expect(long.every((x) => x.end - x.start <= 10.1)).toBe(true);
    expect(meter(0)).toBe(0);
    expect(meter(1)).toBe(1);
  });
});

describe('live text', () => {
  it('settles words two guesses agree on', () => {
    expect(agreedWords('hello there how', 'Hello there, who')).toBe('Hello there,');
    let s = newStream();
    s = advance(s, [{ start: 0, end: 1.5, text: 'Hello there.' }], 2).state;
    let r = advance(s, [{ start: 0, end: 1.5, text: 'Hello there.' }, { start: 2, end: 4, text: 'How are you' }], 6);
    expect(r.state.committed.map((p) => p.text)).toEqual(['Hello there.']);
    expect(r.dropSec).toBe(1.5);
    expect(r.state.offset).toBe(1.5);
    expect(r.state.last[0].start).toBeCloseTo(0.5);
    expect(display(r.state, '').stable).toBe('Hello there.');
    expect(display(r.state, 'How are').stable).toBe('Hello there. How are');
    expect(display(r.state, 'How are').pending).toBe('you');
    expect(allText(r.state)).toBe('Hello there. How are you');
    // the settled part never changes even when a later guess differs
    r = advance(r.state, [{ start: 0.5, end: 2.5, text: 'Who are you' }], 3);
    expect(r.state.committed[0].text).toBe('Hello there.');
  });
});

describe('who said what', () => {
  it('voice prints of different voices differ more than of the same voice', () => {
    const voice = (f0: number, sec: number, seed: number) => Float32Array.from({ length: sec * 16000 }, (_, i) => {
      const t = i / 16000;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += (Math.sin(2 * Math.PI * f0 * h * t + seed * h) / h) * (f0 > 180 ? (h % 2 ? 1 : 0.3) : 1);
      return 0.1 * v * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
    });
    const a1 = voicePrint(voice(110, 2, 1))!;
    const a2 = voicePrint(voice(112, 2, 2))!;
    const b1 = voicePrint(voice(240, 2, 3))!;
    const b2 = voicePrint(voice(236, 2, 4))!;
    expect(voicePrint(new Float32Array(1000))).toBeNull();
    const z = standardize([a1, a2, b1, b2]);
    expect(cosine(z[0], z[1])).toBeGreaterThan(cosine(z[0], z[2]));
    expect(cluster(z)).toEqual([0, 0, 1, 1]);
    const u = (id: string, start: number, track: 'mic' | 'system', text: string, print?: Float32Array | null): Utterance & { print?: Float32Array | null } => ({ id, start, end: start + 2, speaker: '', text, track, print });
    const r = labelSpeakers([u('m1', 0, 'mic', 'hi all'), u('a', 3, 'system', 'one', a1), u('b', 6, 'system', 'two', b1), u('c', 9, 'system', 'three', a2), u('d', 12, 'system', 'x', null), u('e', 15, 'system', 'four', b2)]);
    expect(r.speakers.map((s) => s.label)).toEqual(['You', 'Speaker 2', 'Speaker 3']);
    expect(r.speakers.slice(1).every((s) => s.estimated)).toBe(true);
    expect(r.utterances.map((x) => x.speaker)).toEqual(['me', 's1', 's2', 's1', 's1', 's2']);
    const one = labelSpeakers([u('a', 0, 'system', 'one', a1)], { diarize: false });
    expect(one.speakers[0].label).toBe('Others');
  });
  it('drops the microphone echo of the loudspeakers', () => {
    const u = (id: string, s: number, track: 'mic' | 'system', text: string): Utterance => ({ id, start: s, end: s + 3, speaker: '', text, track });
    const out = dropEcho([u('s', 10, 'system', 'we should ship on friday'), u('m', 10.4, 'mic', 'We should ship on Friday.'), u('m2', 20, 'mic', 'I agree with that plan')]);
    expect(out.map((x) => x.id)).toEqual(['s', 'm2']);
  });
});

const rec = (): MeetingRecord => ({
  id: 'm1', title: 'Weekly sync', startedAt: Date.UTC(2026, 9, 31, 14, 0), durationMs: 125_000, app: 'Zoom',
  speakers: [{ id: 'me', label: 'You', track: 'mic', estimated: false }, { id: 's1', label: 'Speaker 2', track: 'system', estimated: true }],
  utterances: [
    { id: 'a', start: 1, end: 4, speaker: 'me', text: 'Welcome everyone.', track: 'mic' },
    { id: 'b', start: 4.5, end: 6, speaker: 'me', text: 'Let us start.', track: 'mic' },
    { id: 'c', start: 8, end: 12, speaker: 's1', text: 'We decided to launch on Friday. I will send the slides by Monday.', track: 'system' },
    { id: 'd', start: 13, end: 15, speaker: 'me', text: 'Can you also update the budget sheet?', track: 'mic' },
  ],
  event: { id: 'e1', title: 'Weekly sync', start: 0, end: 1, attendees: ['Anna', 'Ben'] },
});

describe('meetings', () => {
  it('notices a call only when a meeting app or page has the microphone', () => {
    const now = Date.now();
    expect(detectMeeting({ micApps: [], windows: [{ app: 'zoom.us', title: 'Zoom Meeting' }], now })).toBeNull();
    expect(detectMeeting({ micApps: ['zoom.us'], windows: [], now })?.app).toBe('Zoom');
    expect(detectMeeting({ micApps: ['Microsoft Teams'], windows: [], now })?.reason).toMatch(/Teams is using the microphone/);
    expect(detectMeeting({ micApps: ['Google Chrome'], windows: [{ app: 'Google Chrome', title: 'Meet - abc-defg-hij - Google Chrome' }], now })?.app).toBe('Google Meet');
    expect(detectMeeting({ micApps: ['firefox'], windows: [{ app: 'firefox', title: 'Recipes — Mozilla Firefox' }], now })).toBeNull();
    expect(detectMeeting({ micApps: ['firefox'], windows: [], events: [{ title: 'Standup', start: now - 60_000, end: now + 600_000, url: 'https://meet.google.com/x' }], now })?.event?.title).toBe('Standup');
    expect(detectMeeting({ micApps: ['MyCallApp'], windows: [], extraApps: ['mycall'], now })?.app).toBe('MyCallApp');
    expect(detectMeeting({ micApps: ['Audacity'], windows: [], now })).toBeNull();
  });
  it('links the calendar event that overlaps most', () => {
    const evs = [{ id: 'a', start: 0, end: 1000, allDay: false }, { id: 'b', start: 500, end: 5000, allDay: false }, { id: 'c', start: 0, end: 10_000, allDay: true }];
    expect(bestEvent(evs, 600, 4000)?.id).toBe('b');
    expect(bestEvent(evs, 20 * 60_000, 30 * 60_000)).toBeUndefined();
  });
  it('exports subtitles, text and Markdown', () => {
    expect(stamp(3723.5)).toBe('01:02:03,500');
    expect(toSrt(rec())).toMatch(/^1\n00:00:01,000 --> 00:00:04,000\nYou: Welcome everyone\.\n/);
    expect(toVtt(rec())).toMatch(/^WEBVTT\n\n00:00:01\.000 --> 00:00:04\.000\n<v You>Welcome everyone\./);
    expect(transcriptLines(rec())).toHaveLength(3);
    expect(toTxt(rec()).split('\n')[0]).toBe('[0:01] You: Welcome everyone. Let us start.');
    const r = rec();
    r.notes = { summary: 'Launch planning.', decisions: ['Launch on Friday'], actions: [{ text: 'Send the slides', owner: 'Ben', due: 'Monday' }], by: 'ai', at: 0 };
    const md = toMarkdown(r);
    expect(md).toMatch(/^---\ntitle: "Weekly sync"\ndate: 2026-10-31/);
    expect(md).toContain('attendees: ["Anna", "Ben"]');
    expect(md.indexOf('## Decisions')).toBeLessThan(md.indexOf('## Transcript'));
    expect(md).toContain('- [ ] Send the slides — Ben (due Monday)');
    expect(md).toContain('estimated from their voices');
    expect(meetingFileName({ title: 'Plan: Q4/Q1?', startedAt: r.startedAt })).toBe('2026-10-31 Plan Q4 Q1');
  });
  it('asks the AI for notes and reads its answer', () => {
    const p = notesPrompt(rec());
    expect(p).toContain('Attendees: Anna, Ben');
    expect(p).toContain('You: Welcome everyone.');
    const n = parseNotesReply('Sure!\n```json\n{"summary":"S","decisions":["D"],"actions":[{"text":"A","owner":"Ben","due":""},"B"]}\n```', 'ai');
    expect(n).toMatchObject({ summary: 'S', decisions: ['D'], actions: [{ text: 'A', owner: 'Ben' }, { text: 'B' }] });
    expect(parseNotesReply('no json here', 'ai')).toBeNull();
  });
  it('writes plain notes without any AI', () => {
    const n = ruleNotes(rec());
    expect(n.by).toBe('rules');
    expect(n.decisions[0]).toMatch(/decided to launch on Friday/);
    expect(n.actions.map((a) => a.text)).toEqual(expect.arrayContaining(['I will send the slides by Monday.', 'Can you also update the budget sheet?']));
    expect(n.actions.find((a) => a.text.startsWith('I will'))).toMatchObject({ owner: 'Speaker 2', due: 'Monday' });
    expect(liveText(rec(), 7)).toMatch(/^\[0:08\] Speaker 2:/);
  });
});

describe('history and settings', () => {
  const take = (id: string, at: number, text: string, app = 'Mail', words = 10): Take => ({ id, at, app, text, raw: text, durationMs: 4000, words, engine: 'device', outcome: 'typed' });
  it('searches, caps and counts', () => {
    const now = Date.now();
    const t = [take('a', now - 1000, 'Quarterly report draft'), take('b', now - 2 * 86_400_000, 'Lunch at noon', 'Slack', 3), take('c', now - 40 * 86_400_000, 'Old one')];
    expect(searchTakes(t, { query: 'report' }).map((x) => x.id)).toEqual(['a']);
    expect(searchTakes(t, { app: 'slack' }).map((x) => x.id)).toEqual(['b']);
    expect(pruneTakes(t, 2).drop.map((x) => x.id)).toEqual(['c']);
    const s = takeStats(t, now, 40);
    expect(s.words).toBe(23);
    expect(s.activeDays28).toBe(2);
    expect(s.spark[27]).toBe(10);
    expect(s.minutesSaved).toBeGreaterThan(0);
    expect(s.topApps[0]).toEqual({ app: 'Mail', words: 20 });
  });
  it('fills in and limits saved settings', () => {
    const s = normalizeVoiceSettings({ dictation: { silenceSec: 99, key: 'bogus', model: 'huge' }, meetings: { notesTarget: { kind: 'folder', path: '/x' } }, nope: 1 });
    expect(s.dictation.silenceSec).toBe(8);
    expect(s.dictation.key).toBe('rightCtrl');
    expect(s.dictation.model).toBe('base');
    expect(s.dictation.engine).toBe('device');
    expect(s.meetings.notesTarget).toEqual({ kind: 'folder', path: '/x' });
    expect((s as unknown as Record<string, unknown>).nope).toBeUndefined();
    expect(defaultVoiceSettings('darwin').dictation.key).toBe('rightAlt');
    expect(mergeVoiceSettings(s, { snippets: [{ id: '1', trigger: 'a', text: 'b' }] }).snippets).toHaveLength(1);
  });
});

describe('speech model tokens', () => {
  it('knows the large-v3 family puts its special tokens one later', () => {
    expect(tokensFor(WHISPER_MODELS.turbo)).toBe(TOK_V3);
    expect(tokensFor(WHISPER_MODELS.base)).toBe(TOK);
    expect(langToken('yue', TOK_V3)).toBe(50358);
    expect(langToken('yue')).toBeUndefined();
    expect(WHISPER_MODELS.turbo.mels).toBe(128);
    const logits = new Float32Array(51866);
    applyTimestampRules(logits, [], 50, TOK_V3);
    expect(logits[TOK_V3.noTimestamps]).toBe(-Infinity);
    expect(logits[TOK_V3.tsBegin]).toBe(0);
    expect(logits[TOK_V3.transcribe]).toBe(-Infinity);
  });
  it('encodes a prompt with byte-level BPE', () => {
    const vocab: Record<string, number> = { 'Ġ': 1, K: 2, e: 3, p: 4, r: 5, 'ĠK': 6, ee: 7, 'ĠKee': 8, 'ĠKeep': 9, er: 10, 'ĠKeeper': 11, ',': 12 };
    const bpe = bpeFromTokenizer({ model: { vocab, merges: ['Ġ K', 'e e', 'ĠK ee', 'ĠKee p', 'e r', 'ĠKeep er'] } });
    expect(bpe.encode(' Keeper,')).toEqual([11, 12]);
    expect(promptTokens([11], TOK)).toEqual([TOK.prev, 11]);
    expect(promptTokens([])).toEqual([]);
  });
});

describe('Linux key hooks', () => {
  it('reads raw input events', async () => {
    const { parseInputEvents, keyboardsFromProcDevices, Xi2Reader } = await import('../core/voice/keys');
    const rec = (type: number, code: number, value: number) => { const b = new Uint8Array(24); const dv = new DataView(b.buffer); dv.setUint16(16, type, true); dv.setUint16(18, code, true); dv.setInt32(20, value, true); return b; };
    const buf = new Uint8Array([...rec(4, 4, 97), ...rec(1, 97, 1), ...rec(1, 97, 2), ...rec(0, 0, 0), ...rec(1, 97, 0)]);
    expect(parseInputEvents(buf)).toEqual([{ code: 97, down: true }, { code: 97, down: false }]);
    const procText = 'I: Bus=0011\nN: Name="AT Translated Set 2 keyboard"\nH: Handlers=sysrq kbd event3 leds\nB: EV=120013\n\nI: Bus=0003\nN: Name="Mouse"\nH: Handlers=mouse0 event5\nB: EV=17\n';
    expect(keyboardsFromProcDevices(procText)).toEqual(['/dev/input/event3']);
    const got: [number, boolean][] = [];
    const x = new Xi2Reader((k, d) => got.push([k, d]));
    for (const l of ['EVENT type 13 (RawKeyPress)', '    device: 3 (3)', '    detail: 105', 'EVENT type 15 (RawButtonPress)', '    detail: 1', 'EVENT type 14 (RawKeyRelease)', '    detail: 105']) x.line(l);
    expect(got).toEqual([[105, true], [105, false]]);
  });
});

describe('code-aware spelling', () => {
  it('picks the project’s own names', async () => {
    const { termsFromFiles, termsFromSymbols, rankTerms, folderFromTitle, gitRootOf } = await import('../core/voice/code-terms');
    const files = termsFromFiles(['src/voice/VoiceHud.tsx', 'core/voice/tidy.ts', 'README.md', 'src/index.ts', 'electron/services/keyhook.ts', 'docs/VOICE.md']);
    expect(files).toEqual(expect.arrayContaining(['VoiceHud', 'keyhook', 'VOICE']));
    expect(files).not.toContain('index');
    const syms = termsFromSymbols(['export function labelSpeakers(', 'const SR = 16000', 'class KeyMachine {', 'def parse_hook_line(x):', 'let value = 1', 'export function labelSpeakers(']);
    expect(syms).toEqual(['labelSpeakers', 'KeyMachine', 'parse_hook_line', 'labelSpeakers']);
    const r = rankTerms(files, syms, 4);
    expect(r[0]).toBe('labelSpeakers');
    expect(r).toHaveLength(4);
    expect(folderFromTitle('tidy.ts — keeper — Visual Studio Code', ['/home/a/code/keeper', '/home/a/code/other'])).toBe('/home/a/code/keeper');
    expect(folderFromTitle('Untitled', ['/x/keeper'])).toBeUndefined();
    expect(gitRootOf('/home/a/code/keeper/src/voice', (d) => d === '/home/a/code/keeper')).toBe('/home/a/code/keeper');
    expect(gitRootOf('/tmp/x', () => false)).toBeUndefined();
    const { spokenForms } = await import('../core/voice/code-terms');
    const { tidy } = await import('../core/voice/tidy');
    expect(spokenForms('labelSpeakers')).toEqual(['label speakers']);
    expect(spokenForms('parse_hook_line')).toEqual(['parse hook line']);
    expect(spokenForms('Voice')).toEqual([]);
    const dict = ['labelSpeakers', 'KeyMachine'].map((w) => ({ id: w, word: w, heard: spokenForms(w) }));
    expect(tidy('call label speakers on the key machine', { tone: 'verbatim', mode: 'exact', commands: true, fillers: false, formatting: false, dictionary: dict }).text).toBe('call labelSpeakers on the KeyMachine');
  });
});

describe('remembered voices', () => {
  it('suggests names from voices confirmed in earlier meetings', async () => {
    const { voicePrint, meanPrint, suggestNames, rememberVoice } = await import('../core/voice/diarize');
    const voice = (f0: number, sec: number, seed: number) => Float32Array.from({ length: sec * 16000 }, (_, i) => {
      const t = i / 16000;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += (Math.sin(2 * Math.PI * f0 * h * t + seed * h) / h) * (f0 > 180 ? (h % 2 ? 1 : 0.3) : 1);
      return 0.1 * v * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
    });
    // earlier meeting: Anja (low voice) and Ben (high voice), names confirmed
    const a = [voicePrint(voice(110, 2, 1))!, voicePrint(voice(112, 2, 5))!];
    const b = [voicePrint(voice(240, 2, 2))!, voicePrint(voice(236, 2, 6))!];
    let profiles = rememberVoice([], 'Anja Tamm', meanPrint(a)!, 1);
    profiles = rememberVoice(profiles, 'Ben Ortiz', meanPrint(b)!, 1);
    profiles = rememberVoice(profiles, 'anja tamm', meanPrint([voicePrint(voice(111, 2, 9))!])!, 2);
    expect(profiles.map((p) => [p.name, p.n])).toEqual([['anja tamm', 2], ['Ben Ortiz', 1]]);
    // this meeting: the same two voices, in the other order
    const s2 = [voicePrint(voice(238, 2, 3))!, voicePrint(voice(241, 2, 7))!];
    const s3 = [voicePrint(voice(109, 2, 4))!, voicePrint(voice(113, 2, 8))!];
    const speakers = [{ id: 'me', estimated: false }, { id: 's1', estimated: true, print: meanPrint(s2) }, { id: 's2', estimated: true, print: meanPrint(s3) }];
    const sug = suggestNames(speakers, profiles, { population: [...s2, ...s3], attendees: ['Ben Ortiz <ben@x>', 'Anja Tamm'] });
    expect(sug.get('s1')?.name).toBe('Ben Ortiz');
    expect(sug.get('s2')?.name).toBe('anja tamm');
    expect(sug.get('s1')?.why).toMatch(/earlier meetings, who is on the invite/);
    expect(sug.has('me')).toBe(false);
    // nobody remembered: the only other person on the invite
    const one = suggestNames([{ id: 's1', estimated: true, print: meanPrint(s2) }], [], { population: s2, attendees: ['Maria Lind'] });
    expect(one.get('s1')).toMatchObject({ name: 'Maria Lind', why: 'The only other person on the invite' });
    expect(suggestNames([{ id: 's1', estimated: true }], [], { population: [], attendees: ['A', 'B'] }).size).toBe(0);
  });
});

describe('code-aware spelling on a real project', () => {
  it('reads a git project’s names, what you work on first', async () => {
    const { projectTerms } = await import('../electron/services/voice/code-terms');
    const { execFileSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-terms-'));
    const git = (...a: string[]) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { stdio: 'ignore' });
    git('init', '-q');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'old.ts'), Array.from({ length: 40 }, (_, i) => `export function oldHelper${i}() {}\nexport class OldThing${i} {}`).join('\n'));
    git('add', '.');
    git('commit', '-q', '-m', 'old');
    for (let k = 0; k < 20; k++) { fs.writeFileSync(path.join(root, 'src', 'old.ts'), fs.readFileSync(path.join(root, 'src', 'old.ts'), 'utf8') + ' '); git('commit', '-q', '-am', `c${k}`); }
    fs.writeFileSync(path.join(root, 'src', 'voiceEngine.ts'), 'export class VoiceService {}\nconst x = 1');
    const t0 = Date.now();
    const terms = await projectTerms(root, 12);
    expect(terms).toEqual(expect.arrayContaining(['VoiceService', 'voiceEngine']));
    expect(terms).toHaveLength(12);
    expect(Date.now() - t0).toBeLessThan(8000);
    const again = Date.now();
    await projectTerms(root, 12);
    expect(Date.now() - again).toBeLessThan(50);
    fs.rmSync(root, { recursive: true, force: true });
  }, 20_000);
});
