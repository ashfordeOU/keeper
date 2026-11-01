// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Who said what, on this computer. The microphone is you; the computer's
// sound is everyone else, told apart by the colour of their voices: each
// piece of speech becomes a small voice print (the average shape of its
// spectrum, MFCCs) and similar prints are grouped. Sound-only guesses are
// labelled as estimates ("Speaker 2"); the person can name them. Pure.

import type { Speaker, Utterance } from './types';

const SR = 16000;
const NFFT = 512;
const HOP = 160;
const BANDS = 32;
const COEFFS = 16;

/** In-place radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

let bank: Float32Array[] | null = null;
function melBank(): Float32Array[] {
  if (bank) return bank;
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const lo = mel(80);
  const hi = mel(7600);
  const pts = Array.from({ length: BANDS + 2 }, (_, i) => Math.floor(((NFFT + 1) * hz(lo + ((hi - lo) * i) / (BANDS + 1))) / SR));
  bank = Array.from({ length: BANDS }, (_, b) => {
    const row = new Float32Array(NFFT / 2 + 1);
    for (let k = pts[b]; k < pts[b + 1]; k++) row[k] = (k - pts[b]) / Math.max(1, pts[b + 1] - pts[b]);
    for (let k = pts[b + 1]; k < pts[b + 2]; k++) row[k] = (pts[b + 2] - k) / Math.max(1, pts[b + 2] - pts[b + 1]);
    return row;
  });
  return bank;
}

/**
 * A voice print for a piece of speech: the mean and spread of its MFCCs over
 * voiced frames (quiet frames are left out). Null for too little speech.
 */
export function voicePrint(a: Float32Array): Float32Array | null {
  const fb = melBank();
  const win = new Float32Array(400).map((_, n) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / 399));
  const frames: Float32Array[] = [];
  const energies: number[] = [];
  const re = new Float32Array(NFFT);
  const im = new Float32Array(NFFT);
  for (let off = 0; off + 400 <= a.length; off += HOP) {
    re.fill(0); im.fill(0);
    let e = 0;
    for (let n = 0; n < 400; n++) { const v = (a[off + n] - (n ? 0.97 * a[off + n - 1] : 0)) * win[n]; re[n] = v; e += v * v; }
    fft(re, im);
    const logMel = new Float32Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      let s = 0;
      const row = fb[b];
      for (let k = 0; k <= NFFT / 2; k++) if (row[k]) s += row[k] * (re[k] * re[k] + im[k] * im[k]);
      logMel[b] = Math.log(s + 1e-10);
    }
    const c = new Float32Array(COEFFS);
    for (let i = 1; i <= COEFFS; i++) {
      let s = 0;
      for (let b = 0; b < BANDS; b++) s += logMel[b] * Math.cos((Math.PI * i * (b + 0.5)) / BANDS);
      c[i - 1] = s;
    }
    frames.push(c);
    energies.push(e);
  }
  if (frames.length < 30) return null;
  // voiced frames only: the louder 60%
  const thr = [...energies].sort((x, y) => x - y)[Math.floor(energies.length * 0.4)];
  const voiced = frames.filter((_, i) => energies[i] >= thr);
  const out = new Float32Array(COEFFS * 2);
  for (const f of voiced) for (let i = 0; i < COEFFS; i++) out[i] += f[i] / voiced.length;
  for (const f of voiced) for (let i = 0; i < COEFFS; i++) out[COEFFS + i] += (f[i] - out[i]) ** 2 / voiced.length;
  for (let i = 0; i < COEFFS; i++) out[COEFFS + i] = Math.sqrt(out[COEFFS + i]);
  return out;
}

/** Puts every print on the same footing (mean 0, spread 1 per number) so no single number dominates. */
export function standardize(prints: Float32Array[]): Float32Array[] {
  if (!prints.length) return [];
  const d = prints[0].length;
  const mean = new Float32Array(d);
  const sd = new Float32Array(d);
  for (const p of prints) for (let i = 0; i < d; i++) mean[i] += p[i] / prints.length;
  for (const p of prints) for (let i = 0; i < d; i++) sd[i] += (p[i] - mean[i]) ** 2 / prints.length;
  return prints.map((p) => p.map((v, i) => (v - mean[i]) / (Math.sqrt(sd[i]) || 1)));
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / (Math.sqrt(aa * bb) || 1);
}

/**
 * Groups prints: start with each alone, keep joining the two closest groups
 * (average similarity) while they are similar enough. Returns a group number
 * per print, numbered by first appearance.
 */
export function cluster(prints: Float32Array[], o: { threshold?: number; maxGroups?: number } = {}): number[] {
  const n = prints.length;
  if (!n) return [];
  const thr = o.threshold ?? 0.25;
  const sim = prints.map((a) => prints.map((b) => cosine(a, b)));
  let groups: number[][] = prints.map((_, i) => [i]);
  const link = (x: number[], y: number[]) => { let s = 0; for (const i of x) for (const j of y) s += sim[i][j]; return s / (x.length * y.length); };
  for (;;) {
    let best = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const s = link(groups[i], groups[j]);
      if (s > best) { best = s; bi = i; bj = j; }
    }
    if (bi < 0 || (best < thr && groups.length <= (o.maxGroups ?? 8))) break;
    groups = [...groups.filter((_, k) => k !== bi && k !== bj), [...groups[bi], ...groups[bj]]];
  }
  const label = new Array<number>(n).fill(-1);
  groups.sort((x, y) => Math.min(...x) - Math.min(...y)).forEach((g, gi) => g.forEach((i) => (label[i] = gi)));
  return label;
}

/**
 * Labels a meeting's pieces. Microphone pieces are you; pieces from the
 * computer's sound are grouped by voice; pieces without a usable print join
 * the nearest group in time.
 */
export function labelSpeakers(utts: (Utterance & { print?: Float32Array | null })[], o: { you?: string; threshold?: number; diarize?: boolean } = {}): { utterances: Utterance[]; speakers: Speaker[] } {
  const speakers: Speaker[] = [];
  if (utts.some((u) => u.track === 'mic')) speakers.push({ id: 'me', label: o.you ?? 'You', track: 'mic', estimated: false });
  const sys = utts.filter((u) => u.track === 'system');
  const withPrint = sys.filter((u) => u.print);
  const labels = o.diarize === false ? withPrint.map(() => 0) : cluster(standardize(withPrint.map((u) => u.print!)), { threshold: o.threshold });
  const groupOf = new Map<string, number>();
  withPrint.forEach((u, i) => groupOf.set(u.id, labels[i]));
  const groups = new Set(labels);
  const many = groups.size > 1;
  for (const g of [...groups].sort((a, b) => a - b)) speakers.push({ id: `s${g + 1}`, label: many ? `Speaker ${g + 2}` : 'Others', track: 'system', estimated: true });
  if (sys.length && !groups.size) speakers.push({ id: 's1', label: 'Others', track: 'system', estimated: true });
  const out: Utterance[] = utts.map(({ print: _p, ...u }) => {
    if (u.track === 'mic') return { ...u, speaker: 'me' };
    let g = groupOf.get(u.id);
    if (g === undefined) {
      // nearest piece in time that has a group
      let best = Infinity;
      for (const w of withPrint) { const d = Math.abs(w.start - u.start); if (d < best) { best = d; g = groupOf.get(w.id); } }
    }
    return { ...u, speaker: `s${(g ?? 0) + 1}` };
  });
  return { utterances: out, speakers };
}

/**
 * Speakers on loudspeakers reach the microphone too. A microphone piece that
 * says the same as a computer-sound piece at the same time is that echo, and
 * is dropped.
 */
export function dropEcho<T extends Utterance>(utts: T[]): T[] {
  const sys = utts.filter((u) => u.track === 'system');
  const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean));
  return utts.filter((u) => {
    if (u.track !== 'mic') return true;
    const w = words(u.text);
    if (w.size < 2) return true;
    return !sys.some((s) => {
      if (s.end < u.start - 1.5 || s.start > u.end + 1.5) return false;
      const v = words(s.text);
      let same = 0;
      for (const x of w) if (v.has(x)) same++;
      return same / w.size >= 0.6;
    });
  });
}

// ---------------------------------------------------------------- remembered voices

/** A voice the person has named in an earlier meeting (only ever from a name they confirmed). */
export interface VoiceProfile { name: string; print: number[]; n: number; at: number }

export interface Suggestion { name: string; why: string; score: number }

/** The average print of a speaker's pieces (raw, so later meetings can compare). */
export function meanPrint(prints: (Float32Array | null | undefined)[]): number[] | undefined {
  const ok = prints.filter((p): p is Float32Array => !!p);
  if (!ok.length) return undefined;
  const out = new Array<number>(ok[0].length).fill(0);
  for (const p of ok) for (let i = 0; i < out.length; i++) out[i] += p[i] / ok.length;
  return out.map((v) => Math.round(v * 1000) / 1000);
}

/** Mean and spread of each number over a set of prints, to compare prints on one footing. */
export function printStats(prints: ArrayLike<number>[]): { mean: number[]; sd: number[] } | null {
  if (prints.length < 3) return null;
  const d = prints[0].length;
  const mean = new Array<number>(d).fill(0);
  const sd = new Array<number>(d).fill(0);
  for (const p of prints) for (let i = 0; i < d; i++) mean[i] += p[i] / prints.length;
  for (const p of prints) for (let i = 0; i < d; i++) sd[i] += (p[i] - mean[i]) ** 2 / prints.length;
  return { mean, sd: sd.map((v) => Math.sqrt(v) || 1) };
}

const zs = (p: ArrayLike<number>, s: { mean: number[]; sd: number[] }) => Float32Array.from({ length: s.mean.length }, (_, i) => (p[i] - s.mean[i]) / s.sd[i]);

const firstName = (s: string) => s.trim().toLowerCase().split(/[\s@.]+/)[0];

/**
 * Names to suggest for speakers told apart by voice: the remembered voice
 * each sounds most like (preferring people on the invite), one person per
 * speaker; otherwise, the only other person on the invite. Never applied by
 * itself — the person accepts or ignores it.
 */
export function suggestNames(
  speakers: { id: string; estimated: boolean; print?: number[] }[],
  profiles: VoiceProfile[],
  o: { attendees?: string[]; population: ArrayLike<number>[]; threshold?: number },
): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>();
  const est = speakers.filter((s) => s.estimated);
  const attendees = o.attendees ?? [];
  const onInvite = (name: string) => attendees.some((a) => firstName(a) === firstName(name));
  const stats = printStats([...o.population, ...profiles.map((p) => p.print)]);
  if (stats && profiles.length) {
    const pairs: { sid: string; p: VoiceProfile; score: number }[] = [];
    for (const s of est) {
      if (!s.print) continue;
      const a = zs(s.print, stats);
      for (const p of profiles) {
        if (attendees.length && !onInvite(p.name) && profiles.some((q) => onInvite(q.name))) continue;
        pairs.push({ sid: s.id, p, score: cosine(a, zs(p.print, stats)) + (onInvite(p.name) ? 0.05 : 0) });
      }
    }
    const usedS = new Set<string>();
    const usedP = new Set<string>();
    for (const x of pairs.sort((a, b) => b.score - a.score)) {
      if (x.score < (o.threshold ?? 0.5) || usedS.has(x.sid) || usedP.has(x.p.name)) continue;
      usedS.add(x.sid);
      usedP.add(x.p.name);
      out.set(x.sid, { name: x.p.name, score: Math.round(x.score * 100) / 100, why: `Sounds like ${x.p.name} from earlier meetings${onInvite(x.p.name) ? ', who is on the invite' : ''}` });
    }
  }
  // One other voice and one other person on the invite.
  const unnamed = est.filter((s) => !out.has(s.id));
  const free = attendees.filter((a) => ![...out.values()].some((x) => firstName(x.name) === firstName(a)));
  if (est.length === 1 && unnamed.length === 1 && attendees.length === 1 && free.length === 1) out.set(unnamed[0].id, { name: free[0], score: 0, why: 'The only other person on the invite' });
  return out;
}

/** Remembers (or refines) a voice under the name the person confirmed. */
export function rememberVoice(profiles: VoiceProfile[], name: string, print: number[], at = Date.now()): VoiceProfile[] {
  const key = name.trim().toLowerCase();
  const old = profiles.find((p) => p.name.trim().toLowerCase() === key);
  if (!old) return [...profiles, { name: name.trim(), print, n: 1, at }];
  const n = Math.min(old.n, 19);
  return profiles.map((p) => (p === old ? { ...p, name: name.trim(), print: p.print.map((v, i) => Math.round(((v * n + print[i]) / (n + 1)) * 1000) / 1000), n: old.n + 1, at } : p));
}
