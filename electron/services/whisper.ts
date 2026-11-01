// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// On-device speech to text on every OS: a Whisper model run with ONNX Runtime.
// The model is downloaded once (pinned files, SHA-256 checked) into Keeper's
// models folder; nothing is sent anywhere. The model is let go a minute after
// the last use, so it costs nothing while idle.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, promises as fsp } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  applyTimestampRules, argmax, decodeTokens, isLooping, langToken, logMel, melFilters, segmentsFromTokens, tidySegments, TOK, vocabFromTokenizer,
  WHISPER_LANGS, WHISPER_MODELS, whisperUrl, SAMPLE_RATE, WINDOW_SAMPLES, type WhisperFile, type WhisperModel, type WhisperSize,
} from '../../core/whisper';

const req = createRequire(__filename);

type Tensor = { data: Float32Array; dims: number[] };
type Session = { run(feeds: Record<string, unknown>, fetches?: string[]): Promise<Record<string, Tensor>>; release?(): Promise<void> };

export interface LocalSegment { start: number; end: number; text: string }
export interface LocalTranscript { language: string; segments: LocalSegment[] }
export type Progress = (fraction: number, label?: string) => void;

export class LocalWhisper {
  private loaded: { size: WhisperSize; encoder: Session; decoder: Session; vocab: string[] } | null = null;
  private idle: NodeJS.Timeout | undefined;
  private busy = 0;

  constructor(private modelsDir: string, private ffmpeg: () => string) {}

  dir(size: WhisperSize) {
    return path.join(this.modelsDir, `whisper-${size}`);
  }

  /** Which sizes are already on this computer. */
  async installed(): Promise<WhisperSize[]> {
    const out: WhisperSize[] = [];
    for (const m of Object.values(WHISPER_MODELS)) if (Object.values(m.files).every((f) => existsSync(path.join(this.dir(m.size), path.basename(f.path))))) out.push(m.size);
    return out;
  }

  async remove(size: WhisperSize) {
    if (this.loaded?.size === size) await this.unload();
    await fsp.rm(this.dir(size), { recursive: true, force: true });
  }

  /** Downloads any missing file of a model, checking each one's fingerprint. */
  async ensure(model: WhisperModel, progress: Progress = () => {}) {
    const dir = this.dir(model.size);
    await fsp.mkdir(dir, { recursive: true });
    const files = Object.values(model.files);
    const total = files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    for (const f of files) {
      const dest = path.join(dir, path.basename(f.path));
      if (existsSync(dest)) { done += f.size; continue; }
      await download(whisperUrl(model, f), dest, f, (n) => progress((done + n) / total, `Downloading the speech model (${Math.round(((done + n) / total) * 100)}%)`));
      done += f.size;
    }
  }

  private async load(size: WhisperSize, progress: Progress) {
    if (this.loaded?.size === size) return this.loaded;
    await this.unload();
    const model = WHISPER_MODELS[size];
    await this.ensure(model, progress);
    progress(0, 'Loading the speech model');
    const ort = req('onnxruntime-node') as typeof import('onnxruntime-node');
    const dir = this.dir(size);
    const opts = { logSeverityLevel: 3, graphOptimizationLevel: 'all' } as const;
    const encoder = (await ort.InferenceSession.create(path.join(dir, path.basename(model.files.encoder.path)), opts)) as unknown as Session;
    const decoder = (await ort.InferenceSession.create(path.join(dir, path.basename(model.files.decoder.path)), opts)) as unknown as Session;
    const vocab = vocabFromTokenizer(JSON.parse(await fsp.readFile(path.join(dir, 'tokenizer.json'), 'utf8')));
    this.loaded = { size, encoder, decoder, vocab };
    return this.loaded;
  }

  async unload() {
    clearTimeout(this.idle);
    const l = this.loaded;
    this.loaded = null;
    await l?.encoder.release?.().catch(() => {});
    await l?.decoder.release?.().catch(() => {});
  }

  /** 16 kHz mono samples of any sound or video file (ffmpeg does the decoding). */
  async samples(file: string, start = 0, seconds?: number): Promise<Float32Array> {
    const args = ['-hide_banner', '-nostdin', '-v', 'error', ...(start ? ['-ss', String(start)] : []), ...(seconds ? ['-t', String(seconds)] : []), '-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'];
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const chunks: Buffer[] = [];
      let err = '';
      p.stdout.on('data', (d: Buffer) => chunks.push(d));
      p.stderr.on('data', (d: Buffer) => (err += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => {
        if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || 'Could not read the sound'));
        const buf = Buffer.concat(chunks);
        const copy = new Float32Array(buf.length >> 2);
        new Uint8Array(copy.buffer).set(buf.subarray(0, copy.length * 4));
        resolve(copy);
      });
    });
  }

  /**
   * Speech to timed text, fully on this computer. `language` is a code like
   * "en" or "auto" (the model works it out from the first 30 seconds).
   */
  async transcribe(file: string, o: { size?: WhisperSize; language?: string; translate?: boolean; progress?: Progress } = {}): Promise<LocalTranscript> {
    const progress = o.progress ?? (() => {});
    this.busy++;
    clearTimeout(this.idle);
    try {
      const m = await this.load(o.size ?? 'base', progress);
      const ort = req('onnxruntime-node') as typeof import('onnxruntime-node');
      const audio = await this.samples(file);
      const total = audio.length / SAMPLE_RATE;
      const filters = melFilters(80);
      const segments: LocalSegment[] = [];
      let language = o.language && o.language !== 'auto' ? o.language : '';
      let seek = 0;
      while (seek < total - 0.2) {
        progress(Math.min(0.99, seek / Math.max(total, 1)), `Listening on this computer (${fmt(seek)} of ${fmt(total)})`);
        const from = Math.floor(seek * SAMPLE_RATE);
        const chunk = audio.subarray(from, from + WINDOW_SAMPLES);
        const windowSec = Math.min(30, chunk.length / SAMPLE_RATE);
        if (rms(chunk) < 1e-4) { seek += windowSec; continue; }
        const mel = logMel(chunk, 80, filters);
        const enc = await m.encoder.run({ input_features: new ort.Tensor('float32', mel, [1, 80, 3000]) });
        const hidden = enc.last_hidden_state as unknown as import('onnxruntime-node').Tensor;
        const step = async (ids: number[]) => {
          const out = await m.decoder.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]), encoder_hidden_states: hidden }, ['logits']);
          const l = out.logits;
          const vocab = l.dims[2];
          return l.data.slice((ids.length - 1) * vocab, ids.length * vocab) as Float32Array;
        };
        if (!language) {
          const logits = await step([TOK.sot]);
          language = WHISPER_LANGS[argmax(logits, TOK.firstLang, TOK.firstLang + WHISPER_LANGS.length) - TOK.firstLang] ?? 'en';
        }
        const prompt = [TOK.sot, langToken(language) ?? TOK.firstLang, o.translate ? TOK.translate : TOK.transcribe];
        const sampled: number[] = [];
        while (sampled.length < 224) {
          const logits = await step([...prompt, ...sampled]);
          applyTimestampRules(logits, sampled);
          const next = argmax(logits);
          if (next === TOK.eot) break;
          sampled.push(next);
          if (isLooping(sampled)) break;
        }
        const { segments: segs, consumed } = segmentsFromTokens(sampled, windowSec);
        for (const s of segs) {
          const text = decodeTokens(s.tokens, m.vocab).trim();
          if (text) segments.push({ start: round(seek + s.start), end: round(seek + Math.max(s.end, s.start)), text });
        }
        seek += consumed > 0.5 ? consumed : windowSec;
      }
      progress(1);
      return { language: language || 'en', segments: tidySegments(segments) };
    } finally {
      this.busy--;
      if (!this.busy) this.idle = setTimeout(() => void this.unload(), 60_000);
    }
  }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const round = (n: number) => Math.round(n * 100) / 100;
function rms(a: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, a.length / 4));
}

/** Streams a file to disk while hashing it; only a matching file is kept. */
async function download(url: string, dest: string, f: WhisperFile, onBytes: (n: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download the speech model (${res.status})`);
  const hash = createHash('sha256');
  const tmp = dest + '.partial';
  const out = createWriteStream(tmp);
  let n = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      n += chunk.length;
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      onBytes(n);
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    await fsp.rm(tmp, { force: true });
    throw e;
  }
  if (hash.digest('hex') !== f.sha256) {
    await fsp.rm(tmp, { force: true });
    throw new Error('The speech model download did not match its fingerprint, so it was not used');
  }
  await fsp.rename(tmp, dest);
}
