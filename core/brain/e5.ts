// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The model behind "search by meaning": multilingual-e5-small (MIT licence,
// about 100 languages), 8-bit, 118 MB. Downloaded once, when the person turns
// meaning search on, from a pinned revision, and checked against known
// SHA-256 sums before it is used. It runs on this computer; text never leaves it.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { UnigramTokenizer } from './tokenizer';
import type { Embedder } from './engine';
import { onnxRuntime } from '../component-paths';

export const E5 = {
  id: 'multilingual-e5-small-int8@761b726',
  label: 'Multilingual E5 small (8-bit)',
  dims: 384,
  maxTokens: 512,
  base: 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  files: [
    { name: 'model_quantized.onnx', remote: 'onnx/model_quantized.onnx', size: 118_308_185, sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193' },
    { name: 'tokenizer.json', remote: 'tokenizer.json', size: 17_082_730, sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39' },
  ],
} as const;

export const E5_DOWNLOAD_BYTES = E5.files.reduce((n, f) => n + f.size, 0);

export function e5Dir(modelsDir: string): string {
  return path.join(modelsDir, 'multilingual-e5-small');
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** True when every file is there with the right size (the hash was checked when it was downloaded). */
export async function e5Present(modelsDir: string): Promise<boolean> {
  const dir = e5Dir(modelsDir);
  for (const f of E5.files) {
    const st = await fsp.stat(path.join(dir, f.name)).catch(() => null);
    if (!st || st.size !== f.size) return false;
  }
  return true;
}

/** Downloads the model files that are missing, checking each one's SHA-256. */
export async function downloadE5(modelsDir: string, onProgress?: (fraction: number) => void, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<void> {
  const dir = e5Dir(modelsDir);
  await fsp.mkdir(dir, { recursive: true });
  let done = 0;
  for (const f of E5.files) {
    const dest = path.join(dir, f.name);
    const st = await fsp.stat(dest).catch(() => null);
    if (st?.size === f.size) { done += f.size; continue; }
    const tmp = dest + '.partial';
    const res = await fetchImpl(`${E5.base}/${f.remote}`, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`Could not download the meaning-search model (${res.status})`);
    const out = createWriteStream(tmp);
    const reader = res.body.getReader();
    const hash = createHash('sha256');
    let got = 0;
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        hash.update(value);
        got += value.length;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
        onProgress?.(Math.min(1, (done + got) / E5_DOWNLOAD_BYTES));
      }
    } finally {
      await new Promise<void>((r) => out.end(() => r()));
    }
    const sum = hash.digest('hex');
    if (got !== f.size || sum !== f.sha256) {
      await fsp.rm(tmp, { force: true });
      throw new Error(`The meaning-search model did not match its known checksum (${f.name}); nothing was installed`);
    }
    await fsp.rename(tmp, dest);
    done += f.size;
  }
  onProgress?.(1);
}

/** Checks the files on disk against the pinned sums (slow: reads 135 MB). */
export async function verifyE5(modelsDir: string): Promise<boolean> {
  const dir = e5Dir(modelsDir);
  for (const f of E5.files) {
    const p = path.join(dir, f.name);
    if (!existsSync(p) || (await sha256(p)) !== f.sha256) return false;
  }
  return true;
}

/** Averages the token vectors the attention mask covers. */
export function meanPool(hidden: Float32Array, dims: [number, number, number], mask: number[][]): Float32Array[] {
  const [batch, seq, width] = dims;
  const out: Float32Array[] = [];
  for (let b = 0; b < batch; b++) {
    const v = new Float32Array(width);
    let n = 0;
    for (let t = 0; t < seq; t++) {
      if (!mask[b][t]) continue;
      n++;
      const off = (b * seq + t) * width;
      for (let i = 0; i < width; i++) v[i] += hidden[off + i];
    }
    let norm = 0;
    for (let i = 0; i < width; i++) { v[i] /= n || 1; norm += v[i] * v[i]; }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < width; i++) v[i] /= norm;
    out.push(v);
  }
  return out;
}

type Ort = typeof import('onnxruntime-node');

export class E5Embedder implements Embedder {
  readonly id = E5.id;
  readonly dims = E5.dims;
  private constructor(private ort: Ort, private session: import('onnxruntime-node').InferenceSession, private tok: UnigramTokenizer, private maxTokens: number) {}

  /** Loads the model from disk. `threads` stays low so the computer stays responsive. */
  static async load(modelsDir: string, opts: { threads?: number; maxTokens?: number } = {}): Promise<E5Embedder> {
    const dir = e5Dir(modelsDir);
    const ort = onnxRuntime<Ort>('Search by meaning');
    const tok = UnigramTokenizer.fromJson(await fsp.readFile(path.join(dir, 'tokenizer.json'), 'utf8'));
    const session = await ort.InferenceSession.create(path.join(dir, 'model_quantized.onnx'), {
      intraOpNumThreads: opts.threads ?? 2,
      interOpNumThreads: 1,
      graphOptimizationLevel: 'all',
    });
    return new E5Embedder(ort, session, tok, opts.maxTokens ?? 256);
  }

  async embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
    if (!texts.length) return [];
    // e5 was trained with these prefixes; leaving them out costs accuracy.
    const ids = texts.map((t) => this.tok.encode(`${kind}: ${t}`, this.maxTokens));
    const seq = Math.max(...ids.map((x) => x.length));
    const n = ids.length;
    const inputIds = new BigInt64Array(n * seq).fill(BigInt(this.tok.pad));
    const attention = new BigInt64Array(n * seq);
    const mask: number[][] = [];
    ids.forEach((row, b) => {
      const m = new Array(seq).fill(0);
      row.forEach((id, t) => { inputIds[b * seq + t] = BigInt(id); attention[b * seq + t] = 1n; m[t] = 1; });
      mask.push(m);
    });
    const T = this.ort.Tensor;
    const feeds: Record<string, import('onnxruntime-node').Tensor> = {
      input_ids: new T('int64', inputIds, [n, seq]),
      attention_mask: new T('int64', attention, [n, seq]),
    };
    if (this.session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new T('int64', new BigInt64Array(n * seq), [n, seq]);
    const out = await this.session.run(feeds);
    const hidden = out[this.session.outputNames[0]];
    return meanPool(hidden.data as Float32Array, hidden.dims as unknown as [number, number, number], mask);
  }
}
