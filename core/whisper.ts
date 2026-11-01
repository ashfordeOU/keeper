// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// On-device speech to text: the pure parts of running a Whisper model.
// Sound becomes a log-mel picture, the model writes tokens, and the tokens
// become timed text. No network and no native code here; the model files are
// downloaded once, checked against the SHA-256 below, and run with ONNX Runtime.

export type WhisperSize = 'tiny' | 'base' | 'small';

export interface WhisperFile { path: string; sha256: string; size: number }
export interface WhisperModel { size: WhisperSize; repo: string; revision: string; label: string; files: { encoder: WhisperFile; decoder: WhisperFile; tokenizer: WhisperFile } }

const TOKENIZER = { path: 'tokenizer.json', sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566', size: 2480466 };

/** Pinned model files (MIT-licensed Whisper weights, ONNX export, 8-bit). */
export const WHISPER_MODELS: Record<WhisperSize, WhisperModel> = {
  tiny: {
    size: 'tiny', label: 'Fast (40 MB)', repo: 'onnx-community/whisper-tiny', revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
    files: {
      encoder: { path: 'onnx/encoder_model_quantized.onnx', sha256: '2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19', size: 10124990 },
      decoder: { path: 'onnx/decoder_model_quantized.onnx', sha256: '2a160a2a5ccf901f83aa4d4ceec580a269bd2cec582871e0816e98c610594f12', size: 30461071 },
      tokenizer: TOKENIZER,
    },
  },
  base: {
    size: 'base', label: 'Balanced (77 MB)', repo: 'onnx-community/whisper-base', revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    files: {
      encoder: { path: 'onnx/encoder_model_quantized.onnx', sha256: '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46', size: 23201314 },
      decoder: { path: 'onnx/decoder_model_quantized.onnx', sha256: 'c859636f4463dd5a9ea752546c6c7badeb48ab3e22b340cafef08a15552fcb2e', size: 53310178 },
      tokenizer: TOKENIZER,
    },
  },
  small: {
    size: 'small', label: 'Most accurate (250 MB)', repo: 'onnx-community/whisper-small', revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    files: {
      encoder: { path: 'onnx/encoder_model_quantized.onnx', sha256: 'a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92', size: 92326160 },
      decoder: { path: 'onnx/decoder_model_quantized.onnx', sha256: '0486afa8eb464bf2210d07aca0cb3f5d91d3f2f01cbe47f9f1e6ff9122abaaf6', size: 155989346 },
      tokenizer: TOKENIZER,
    },
  },
};

export const whisperUrl = (m: WhisperModel, f: WhisperFile) => `https://huggingface.co/${m.repo}/resolve/${m.revision}/${f.path}`;

// ---------------------------------------------------------------- special tokens (multilingual models)

export const TOK = {
  eot: 50257,
  sot: 50258,
  translate: 50358,
  transcribe: 50359,
  noTimestamps: 50363,
  tsBegin: 50364,
  firstLang: 50259,
} as const;

/** Language codes in token order: the first is token 50259. */
export const WHISPER_LANGS = 'en zh de es ru ko fr ja pt tr pl ca nl ar sv it id hi fi vi he uk el ms cs ro da hu ta no th ur hr bg lt la mi ml cy sk te fa lv bn sr az sl kn et mk br eu is hy ne mn bs kk sq sw gl mr pa si km sn yo so af oc ka be tg sd gu am yi lo uz fo ht ps tk nn mt sa lb my bo tl mg as tt haw ln ha ba jw su'.split(' ');

export const langToken = (code: string): number | undefined => {
  const i = WHISPER_LANGS.indexOf(code.toLowerCase().split(/[-_]/)[0]);
  return i < 0 ? undefined : TOK.firstLang + i;
};

/** Tokens the model must never write (from the model's generation settings). */
export const SUPPRESS = [1, 2, 7, 8, 9, 10, 14, 25, 26, 27, 28, 29, 31, 58, 59, 60, 61, 62, 63, 90, 91, 92, 93, 359, 503, 522, 542, 873, 893, 902, 918, 922, 931, 1350, 1853, 1982, 2460, 2627, 3246, 3253, 3268, 3536, 3846, 3961, 4183, 4667, 6585, 6647, 7273, 9061, 9383, 10428, 10929, 11938, 12033, 12331, 12562, 13793, 14157, 14635, 15265, 15618, 16553, 16604, 18362, 18956, 20075, 21675, 22520, 26130, 26161, 26435, 28279, 29464, 31650, 32302, 32470, 36865, 42863, 47425, 49870, 50254, 50258, 50358, 50359, 50360, 50361, 50362];

// ---------------------------------------------------------------- sound → log-mel

export const SAMPLE_RATE = 16000;
export const N_FFT = 400;
export const HOP = 160;
export const WINDOW_SAMPLES = 30 * SAMPLE_RATE;
export const FRAMES = 3000;
export const SECONDS_PER_TOKEN = 0.02;

const hzToMel = (f: number) => (f < 1000 ? (3 * f) / 200 : 15 + (27 * Math.log(f / 1000)) / Math.log(6.4));
const melToHz = (m: number) => (m < 15 ? (200 * m) / 3 : 1000 * Math.exp((Math.log(6.4) * (m - 15)) / 27));

/** Slaney-style mel filter bank, the same numbers the model was trained with. Row-major [nMels][nFft/2+1]. */
export function melFilters(nMels = 80, sr = SAMPLE_RATE, nFft = N_FFT): Float32Array {
  const bins = nFft / 2 + 1;
  const out = new Float32Array(nMels * bins);
  const lo = hzToMel(0);
  const hi = hzToMel(sr / 2);
  const pts = Array.from({ length: nMels + 2 }, (_, i) => melToHz(lo + ((hi - lo) * i) / (nMels + 1)));
  for (let m = 0; m < nMels; m++) {
    const enorm = 2 / (pts[m + 2] - pts[m]);
    for (let k = 0; k < bins; k++) {
      const f = (k * sr) / nFft;
      const lower = (f - pts[m]) / (pts[m + 1] - pts[m]);
      const upper = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
      out[m * bins + k] = Math.max(0, Math.min(lower, upper)) * enorm;
    }
  }
  return out;
}

let tables: { cos: Float32Array; sin: Float32Array; win: Float32Array } | null = null;
function dftTables() {
  if (tables) return tables;
  const bins = N_FFT / 2 + 1;
  const cos = new Float32Array(bins * N_FFT);
  const sin = new Float32Array(bins * N_FFT);
  for (let k = 0; k < bins; k++) for (let n = 0; n < N_FFT; n++) {
    const a = (2 * Math.PI * k * n) / N_FFT;
    cos[k * N_FFT + n] = Math.cos(a);
    sin[k * N_FFT + n] = Math.sin(a);
  }
  const win = new Float32Array(N_FFT);
  for (let n = 0; n < N_FFT; n++) win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT);
  return (tables = { cos, sin, win });
}

/**
 * 30 seconds of 16 kHz mono sound (shorter is padded with silence) as the
 * model's input: [nMels × 3000] log-mel values, scaled the way Whisper expects.
 */
export function logMel(samples: Float32Array, nMels = 80, filters = melFilters(nMels)): Float32Array {
  const audio = new Float32Array(WINDOW_SAMPLES);
  audio.set(samples.subarray(0, WINDOW_SAMPLES));
  const pad = N_FFT / 2;
  const padded = new Float32Array(WINDOW_SAMPLES + 2 * pad);
  padded.set(audio, pad);
  for (let i = 0; i < pad; i++) {
    padded[pad - 1 - i] = audio[i + 1];
    padded[pad + WINDOW_SAMPLES + i] = audio[WINDOW_SAMPLES - 2 - i];
  }
  const { cos, sin, win } = dftTables();
  const bins = N_FFT / 2 + 1;
  const frame = new Float32Array(N_FFT);
  const power = new Float32Array(bins);
  const out = new Float32Array(nMels * FRAMES);
  let max = -Infinity;
  for (let t = 0; t < FRAMES; t++) {
    const off = t * HOP;
    let silent = true;
    for (let n = 0; n < N_FFT; n++) {
      frame[n] = padded[off + n] * win[n];
      if (frame[n] !== 0) silent = false;
    }
    if (silent) power.fill(0);
    else for (let k = 0; k < bins; k++) {
      let re = 0;
      let im = 0;
      const base = k * N_FFT;
      for (let n = 0; n < N_FFT; n++) {
        re += frame[n] * cos[base + n];
        im -= frame[n] * sin[base + n];
      }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < nMels; m++) {
      let s = 0;
      const row = m * bins;
      for (let k = 0; k < bins; k++) s += filters[row + k] * power[k];
      const v = Math.log10(Math.max(s, 1e-10));
      out[m * FRAMES + t] = v;
      if (v > max) max = v;
    }
  }
  const floor = max - 8;
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], floor) + 4) / 4;
  return out;
}

// ---------------------------------------------------------------- choosing the next token

/**
 * Whisper's timestamp rules: times come in pairs, never go backwards, and
 * the first one is near the start. Changes the logits in place.
 */
export function applyTimestampRules(logits: Float32Array, sampled: number[], maxInitialTs = 50) {
  const NEG = -Infinity;
  logits[TOK.noTimestamps] = NEG;
  for (const t of SUPPRESS) if (t < logits.length) logits[t] = NEG;
  const n = sampled.length;
  if (n === 0) {
    logits[220] = NEG;
    logits[TOK.eot] = NEG;
    for (let i = 0; i < TOK.tsBegin; i++) logits[i] = NEG;
    for (let i = TOK.tsBegin + maxInitialTs + 1; i < logits.length; i++) logits[i] = NEG;
    return;
  }
  const last = sampled[n - 1] >= TOK.tsBegin;
  const penult = n < 2 || sampled[n - 2] >= TOK.tsBegin;
  if (last) {
    if (penult) for (let i = TOK.tsBegin; i < logits.length; i++) logits[i] = NEG;
    else for (let i = 0; i < TOK.eot; i++) logits[i] = NEG;
  }
  const times = sampled.filter((t) => t >= TOK.tsBegin);
  if (times.length) {
    const lastTs = times[times.length - 1] + (last && !penult ? 0 : 1);
    for (let i = TOK.tsBegin; i < Math.min(lastTs, logits.length); i++) logits[i] = NEG;
  }
  // When a time is more likely than any single word, write a time.
  let maxAll = NEG;
  for (let i = 0; i < logits.length; i++) if (logits[i] > maxAll) maxAll = logits[i];
  if (maxAll === NEG) return;
  let sumTs = 0;
  let maxText = NEG;
  for (let i = 0; i < logits.length; i++) {
    const p = Math.exp(logits[i] - maxAll);
    if (i >= TOK.tsBegin) sumTs += p;
    else if (logits[i] > maxText) maxText = logits[i];
  }
  if (Math.log(sumTs) + maxAll > maxText) for (let i = 0; i < TOK.tsBegin; i++) logits[i] = NEG;
}

export function argmax(a: Float32Array, from = 0, to = a.length): number {
  let best = from;
  for (let i = from + 1; i < to; i++) if (a[i] > a[best]) best = i;
  return best;
}

/** True when the tail keeps repeating one short phrase (the model is stuck). */
export function isLooping(tokens: number[]): boolean {
  for (let gram = 1; gram <= 12; gram++) {
    const times = gram < 3 ? 8 : gram < 6 ? 4 : 3;
    if (tokens.length < gram * times) continue;
    const tail = tokens.slice(-gram).join(',');
    let k = 1;
    while (k < times && tokens.slice(-gram * (k + 1), -gram * k).join(',') === tail) k++;
    if (k === times) return true;
  }
  return false;
}

// ---------------------------------------------------------------- tokens → timed text

export interface TokenSegment { start: number; end: number; tokens: number[] }

/**
 * Splits one window's tokens at its time marks. Returns the segments (times in
 * seconds from the window start) and how far into the window the next one
 * should start, as Whisper does.
 */
export function segmentsFromTokens(tokens: number[], windowSec: number): { segments: TokenSegment[]; consumed: number } {
  const isTs = (t: number) => t >= TOK.tsBegin;
  const sec = (t: number) => (t - TOK.tsBegin) * SECONDS_PER_TOKEN;
  const segments: TokenSegment[] = [];
  const cuts: number[] = [];
  for (let i = 1; i < tokens.length; i++) if (isTs(tokens[i]) && isTs(tokens[i - 1])) cuts.push(i);
  const singleEnding = tokens.length >= 2 && isTs(tokens[tokens.length - 1]) && !isTs(tokens[tokens.length - 2]);
  if (cuts.length) {
    if (singleEnding) cuts.push(tokens.length);
    let from = 0;
    for (const c of cuts) {
      const part = tokens.slice(from, c);
      const text = part.filter((t) => !isTs(t));
      if (text.length && isTs(part[0])) segments.push({ start: sec(part[0]), end: sec(part[part.length - 1]), tokens: text });
      from = c;
    }
    const consumed = singleEnding ? windowSec : sec(tokens[from - 1]);
    return { segments, consumed: consumed > 0 ? Math.min(consumed, windowSec) : windowSec };
  }
  const times = tokens.filter(isTs);
  const text = tokens.filter((t) => !isTs(t));
  const end = times.length >= 2 && sec(times[times.length - 1]) > sec(times[0]) ? sec(times[times.length - 1]) : windowSec;
  if (text.length) segments.push({ start: times.length ? sec(times[0]) : 0, end, tokens: text });
  return { segments, consumed: windowSec };
}

// ---------------------------------------------------------------- token ids → text

let byteDecoder: Map<string, number> | null = null;
/** The byte-level alphabet GPT-2-style tokenizers use, reversed. */
export function bytesFromUnicode(): Map<string, number> {
  if (byteDecoder) return byteDecoder;
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  byteDecoder = new Map(bs.map((b, i) => [String.fromCharCode(cs[i]), b]));
  return byteDecoder;
}

/** id → token text, from a tokenizer.json. */
export function vocabFromTokenizer(json: { model: { vocab: Record<string, number> }; added_tokens?: { id: number; content: string }[] }): string[] {
  const out: string[] = [];
  for (const [s, id] of Object.entries(json.model.vocab)) out[id] = s;
  for (const t of json.added_tokens ?? []) out[t.id] = t.content;
  return out;
}

/** Text tokens back to a string (special tokens are left out). */
export function decodeTokens(ids: number[], vocab: string[]): string {
  const dec = bytesFromUnicode();
  const bytes: number[] = [];
  for (const id of ids) {
    if (id >= TOK.eot) continue;
    for (const ch of vocab[id] ?? '') {
      const b = dec.get(ch);
      if (b !== undefined) bytes.push(b);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Drops a phrase the model keeps writing again and again (a known failure on music or noise). */
export function tidySegments<T extends { text: string }>(segs: T[]): T[] {
  const out: T[] = [];
  for (const s of segs) {
    const t = s.text.trim().toLowerCase();
    const n = out.length;
    if (n >= 2 && out[n - 1].text.trim().toLowerCase() === t && out[n - 2].text.trim().toLowerCase() === t) continue;
    out.push(s);
  }
  return out;
}
