// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where speech becomes text. On this computer by default (the Whisper model
// file transcription uses too, shared and loaded once); macOS's own
// recognizer when chosen; a speech service only when the person picks one and
// gives it a key (or runs it on localhost).

import { app } from 'electron';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SpeechEngine } from '../../../core/voice/types';
import type { WhisperSize } from '../../../core/whisper';
import { getSecret, settings } from '../../store';
import { sharedWhisper, type LocalSegment, type LocalWhisper } from '../whisper';

export interface Recognized { language: string; segments: LocalSegment[] }

export const modelsDir = () => path.join(app.getPath('userData'), 'models');
const ffmpeg = () => { try { return (require('ffmpeg-static') as string).replace('app.asar', 'app.asar.unpacked'); } catch { return 'ffmpeg'; } };
export const whisper = (): LocalWhisper => sharedWhisper(modelsDir(), ffmpeg);

/** 16-bit WAV for recognizers that read files, and for kept recordings. */
export function wav(samples: Float32Array, rate = 16000): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

/** Reads back a WAV written by `wav`. */
export function unwav(b: Buffer): Float32Array {
  const n = (b.length - 44) >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(44 + i * 2) / 32768;
  return out;
}

export interface RecognizeOptions { engine: SpeechEngine; size: WhisperSize; language: string; translate?: boolean; prompt?: string; offset?: number; signal?: AbortSignal; live?: { id: string; start: number } }

export async function recognize(samples: Float32Array, o: RecognizeOptions): Promise<Recognized> {
  if (o.engine === 'cloud') return cloud(samples, o);
  if (o.engine === 'system' && process.platform === 'darwin') {
    const f = path.join(os.tmpdir(), `keeper-voice-${process.pid}-${Date.now()}.wav`);
    await fsp.writeFile(f, wav(samples));
    try {
      const { macHelperCall } = await import('../platform/mac');
      const r = await macHelperCall<{ segments: { start: number; end: number; text: string }[] }>('speech.transcribe', { path: f, language: o.language === 'auto' ? undefined : o.language }, 120_000);
      return { language: o.language === 'auto' ? 'en' : o.language, segments: r.segments.map((s) => ({ ...s, start: s.start + (o.offset ?? 0), end: s.end + (o.offset ?? 0) })) };
    } finally {
      void fsp.rm(f, { force: true });
    }
  }
  return whisper().transcribeSamples(samples, { size: o.size, language: o.language, translate: o.translate, prompt: o.prompt, offset: o.offset, signal: o.signal, live: o.live });
}

/** An OpenAI-compatible transcription service the person chose (Settings → Island → Dictation service). */
async function cloud(samples: Float32Array, o: RecognizeOptions): Promise<Recognized> {
  const s = settings().island;
  const key = await getSecret('dictation');
  if (!key && !/localhost|127\.0\.0\.1|\[::1\]/.test(s.dictationUrl)) throw new Error('Add a key for the speech service, or switch Dictation back to “On this computer”');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav(samples))], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', s.dictationModel);
  form.append('response_format', 'verbose_json');
  if (o.language && o.language !== 'auto') form.append('language', o.language);
  if (o.prompt) form.append('prompt', o.prompt);
  const res = await fetch(o.translate ? s.dictationUrl.replace(/transcriptions$/, 'translations') : s.dictationUrl, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: form, signal: o.signal });
  if (!res.ok) throw new Error(`The speech service answered ${res.status}`);
  const j = (await res.json()) as { text?: string; language?: string; segments?: { start: number; end: number; text: string }[] };
  const off = o.offset ?? 0;
  const segments = j.segments?.length ? j.segments.map((x) => ({ start: x.start + off, end: x.end + off, text: x.text.trim() })) : [{ start: off, end: off + samples.length / 16000, text: (j.text ?? '').trim() }];
  return { language: j.language ?? (o.language === 'auto' ? 'en' : o.language), segments: segments.filter((x) => x.text) };
}
