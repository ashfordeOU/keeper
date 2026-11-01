// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Voice on a real Mac: the talk-key event tap starting, ScreenCaptureKit
// capturing the computer's sound, a microphone level (through the probe and
// through Keeper's own window), the whisper model downloaded and checked
// against its pinned hash by Keeper, a sentence spoken by macOS's `say`
// transcribed on the device, and (guided) a real dictation with the talk key.

import fs from 'node:fs';
import path from 'node:path';
import { fail, pass, skip, verdict, type Ctx } from '../context';
import { until } from '../sys';

const SENTENCE = 'Keeper keeps my files tidy and easy to find';
const SPOKEN = 'The quick brown fox jumps over the lazy dog';

/** Share of the expected words found in the text (0–1). */
export function wordMatch(expected: string, got: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const want = norm(expected);
  const have = new Set(norm(got));
  return want.length ? want.filter((w) => have.has(w)).length / want.length : 0;
}

/** Loudness of base64 float32 audio chunks (dBFS peak). */
export function peakDb(chunks: string[]): number {
  let peak = 0;
  for (const c of chunks) {
    let b: Buffer;
    try { b = Buffer.from(c.replace(/^audio\s+/, ''), 'base64'); } catch { continue; }
    for (let i = 0; i + 4 <= b.length; i += 4) { const v = Math.abs(b.readFloatLE(i)); if (Number.isFinite(v) && v > peak) peak = v; }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -160;
}

export async function runVoice(ctx: Ctx) {
  const { rec } = ctx;
  const tcc = ctx.facts.tcc as Record<string, any>;

  await rec.check('voice.status', 'Voice: what Keeper says it can do here', 'auto', async (h) => {
    const app = await ctx.app();
    const st = await app.call<any>('voice.status');
    h.artifact(ctx.saveData('voice-status.json', st));
    const s = st?.supports ?? {};
    return verdict(!!st, `talk key: ${s.holdKey ? 'yes' : 'no'} (${s.keyHow ?? ''}); computer sound: ${s.systemAudio ? 'yes' : 'no'} (${s.systemHow ?? ''}); password guard: ${s.passwordGuard}; models: ${(st?.models ?? []).join(', ') || 'none'}`, s);
  });

  await rec.check('voice.event-tap', 'Voice: the talk-key event tap starts (keeper-helper voice.keys)', 'auto', async (h) => {
    const helper = await ctx.helper();
    if (!helper) return skip('keeper-helper is not built');
    const r = await helper.call('voice.keys', { code: 61, esc: 53 }, { streamMs: 2500, timeoutMs: 5000 });
    h.artifact(ctx.saveData('voice-keys.json', { error: r.error, deltas: r.deltas.slice(0, 10) }));
    if (r.deltas.includes('ready')) return pass('The event tap started ("ready")');
    return fail(`No "ready": ${r.error ?? 'nothing came back'}${tcc.inputMonitoring ? '' : ' (Input Monitoring is not allowed for this terminal)'}`, r.error);
  });

  await rec.check('voice.system-audio', 'Voice: the computer\'s sound through ScreenCaptureKit (keeper-helper voice.systemAudio)', 'auto', async (h) => {
    const helper = await ctx.helper();
    if (!helper) return skip('keeper-helper is not built');
    const sound = ctx.dry ? null : ctx.sys.background('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff']);
    const r = await helper.call('voice.systemAudio', {}, { streamMs: 4000, timeoutMs: 8000 });
    await sound?.stop('SIGTERM');
    const db = peakDb(r.deltas);
    h.artifact(ctx.saveData('voice-system-audio.json', { error: r.error, chunks: r.deltas.length, peakDb: db, sample: r.deltas.slice(0, 1).map((d) => d.slice(0, 80)) }));
    if (!r.deltas.length) return fail(`No sound came through: ${r.error ?? 'nothing'}${tcc.screenRecording ? '' : ' (Screen & System Audio Recording is not allowed for this terminal)'}`, r.error);
    return pass(`${r.deltas.length} chunks in 4 s while a system sound played; peak ${db.toFixed(1)} dBFS`, { chunks: r.deltas.length, peakDb: db });
  });

  if (!ctx.args.quick) {
    await rec.check('voice.model', 'Voice: the small speech model downloads and passes Keeper\'s pinned hash check', 'auto', async (h) => {
      const app = await ctx.app();
      const t0 = Date.now();
      const models = await app.call<string[]>('voice.downloadModel', 'tiny');
      h.artifact(ctx.saveData('voice-models.json', { models, seconds: (Date.now() - t0) / 1000 }));
      return verdict(Array.isArray(models) && models.includes('tiny'), `Installed models: ${(models ?? []).join(', ')} (${Math.round((Date.now() - t0) / 1000)} s)`);
    });

    await rec.check('voice.transcribe', 'Voice: a sentence spoken by macOS is recognised on the device', 'auto', async (h) => {
      const app = await ctx.app();
      const wav = path.join(ctx.paths.run, 'speech.wav');
      const say = await ctx.sys.run('/usr/bin/say', ['-o', wav, '--data-format=LEI16@16000', SENTENCE], { timeoutMs: 30_000 });
      if (!say.ok && !ctx.dry) return fail('`say` could not make the test recording', say.stderr);
      const b64 = ctx.dry ? '' : fs.readFileSync(wav).toString('base64');
      const t0 = Date.now();
      const text = await app.page<string>('transcribe', async (b: string) => {
        const bin = atob(b);
        const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return (window as any).keeper.island.transcribe(u.buffer, 'audio/wav');
      }, b64);
      const m = wordMatch(SENTENCE, String(text ?? ''));
      h.artifact(ctx.saveData('voice-transcribe.json', { expected: SENTENCE, got: text, match: m, ms: Date.now() - t0 }));
      return verdict(m >= 0.6, `Heard "${text}" (${Math.round(m * 100)} % of the words, ${((Date.now() - t0) / 1000).toFixed(1)} s)`, { match: m });
    });
  }

  await rec.check('voice.mic-level', 'Voice: microphone level while the owner speaks', 'guided', async (h) => {
    if (!ctx.args.guided) return skip('No questions in this run');
    if (tcc.microphone !== 'granted' && !ctx.dry) return skip('The microphone is not allowed for this terminal');
    const a = await ctx.prompt.ask({ key: 'voice-mic', title: 'Say a sentence', lines: ['After Enter you will hear "speak now". Then read this aloud, in a normal voice:', `    "${SPOKEN}"`], question: 'Ready?', kind: 'enter', timeoutSec: 180 });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip('Skipped');
    await ctx.cue('speak now');
    const app = await ctx.app();
    // Keeper's own window (Chromium's microphone path) and the probe (AVAudioEngine) at the same time.
    const inApp = app.page<any>('mic-level', async (ms: number) => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ac = new AudioContext();
        const an = ac.createAnalyser();
        ac.createMediaStreamSource(s).connect(an);
        const buf = new Float32Array(an.fftSize);
        let peak = 0;
        const end = Date.now() + ms;
        while (Date.now() < end) {
          an.getFloatTimeDomainData(buf);
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          await new Promise((r) => setTimeout(r, 50));
        }
        s.getTracks().forEach((t) => t.stop());
        await ac.close();
        return { peakDb: peak > 0 ? 20 * Math.log10(peak) : -160 };
      } catch (e) { return { error: String(e) }; }
    }, 5000);
    const probe = ctx.probe('mic-level', '5');
    const [x, y] = await Promise.all([inApp.catch((e) => ({ error: String(e) })), probe]);
    h.artifact(ctx.saveData('voice-mic-level.json', { keeper: x, probe: y }));
    const loud = (v: any) => typeof v?.peakDb === 'number' && v.peakDb > -45;
    return verdict(loud(x) || loud(y), `Keeper's window: ${x?.peakDb !== undefined ? `${Number(x.peakDb).toFixed(1)} dBFS peak` : x?.error}; probe: ${y?.peakDb !== undefined ? `${Number(y.peakDb).toFixed(1)} dBFS peak, ${Number(y.rmsDb).toFixed(1)} dBFS average on "${y.device}"` : y?.error ?? 'no answer'}`, { keeper: x, probe: y });
  });

  if (ctx.args.quick) return;

  await rec.check('voice.dictation', 'Voice: hold the talk key and speak (the whole path)', 'guided', async (h) => {
    if (!ctx.args.guided) return skip('No questions in this run');
    if (!ctx.dry && (!tcc.inputMonitoring || tcc.microphone !== 'granted')) return skip('Needs Input Monitoring and the microphone for this terminal');
    const app = await ctx.app();
    const settings = await app.call<any>('voice.settings');
    await app.call('voice.setSettings', { dictation: { ...(settings?.dictation ?? {}), insert: 'copy', model: 'tiny', language: 'en' } });
    const key = settings?.dictation?.key ?? 'rightAlt';
    const keyName: Record<string, string> = { rightAlt: 'right Option (⌥) key', rightCtrl: 'right Control key', rightMeta: 'right Command key', fn: 'fn (Globe) key', rightShift: 'right Shift key' };
    const before = ((await app.call<any[]>('voice.history', { limit: 50 })) ?? []).length;
    const a = await ctx.prompt.ask({ key: 'voice-dictation', title: 'Dictate with the talk key', lines: [`Hold the ${keyName[key] ?? key}, say "${SENTENCE}", then let go.`, 'A small listening pill appears while you hold it. The text goes to the clipboard (nothing is typed anywhere).', 'Press Enter here when you have let go.'], question: 'Done?', kind: 'enter', timeoutSec: 240 });
    h.answered(a.answer, a.note);
    if (a.answer !== 'y') return skip('Skipped');
    const takes = await until(async () => { const l = (await app.call<any[]>('voice.history', { limit: 50 })) ?? []; return l.length > before ? l : null; }, 30_000, 1000);
    const text = takes?.[0]?.text ?? takes?.[0]?.raw ?? '';
    const m = wordMatch(SENTENCE, text);
    h.artifact(ctx.saveData('voice-dictation.json', { got: text, match: m, key }));
    if (!takes) return fail('No new take in Voice\'s history 30 s after the key was let go');
    return verdict(m >= 0.6, `Heard "${text}" (${Math.round(m * 100)} % of the words)`, { match: m });
  });
}
