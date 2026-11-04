// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Bm25 } from '../core/brain/bm25';
import { chunkText, stem, terms } from '../core/brain/chunk';
import { meanPool } from '../core/brain/e5';
import { BrainEngine, makeSnippet, type Embedder } from '../core/brain/engine';
import { Harness, type HarnessEnv } from '../core/brain/harness';
import { McpServer, serveLines, type JsonRpcResponse } from '../core/brain/mcp';
import { createProvider, type ChatMessage, type ChatProvider, type ChatResult, type ToolSpec } from '../core/brain/providers';
import { ibanValid, luhn, redact } from '../core/brain/redact';
import { UnigramTokenizer } from '../core/brain/tokenizer';
import { cosine, quantize, VectorStore } from '../core/brain/vectors';
import type { FileEntry } from '../core/types';
import { DAY, file, NOW } from './helpers';

const H = '/Users/sam';

// ---------------------------------------------------------------- chunks and words

describe('chunkText', () => {
  it('keeps short text whole and covers every word of long text', () => {
    expect(chunkText('Hello there.')).toEqual([{ start: 0, end: 12, heading: undefined }]);
    const para = (n: number) => `Paragraph ${n}. ` + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6);
    const text = Array.from({ length: 12 }, (_, i) => para(i)).join('\n\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(800);
    // Every paragraph's opening words land in some chunk.
    for (let i = 0; i < 12; i++) expect(chunks.some((c) => text.slice(c.start, c.end).includes(`Paragraph ${i}.`))).toBe(true);
  });

  it('starts new passages at headings and remembers them', () => {
    const text = '# Lease\n\nThe deposit is two months of rent and is returned at the end.\n\n# Utilities\n\nWater and power are paid by the tenant.' + ' More words here.'.repeat(30);
    const chunks = chunkText(text, { size: 200 });
    const lease = chunks.find((c) => text.slice(c.start, c.end).includes('deposit'));
    const util = chunks.find((c) => text.slice(c.start, c.end).includes('Water'));
    expect(lease?.heading).toBe('Lease');
    expect(util?.heading).toBe('Utilities');
  });

  it('cuts one huge paragraph with overlap', () => {
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const chunks = chunkText(text, { size: 500, overlap: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toBeLessThan(chunks[i - 1].end);
    expect(chunks[chunks.length - 1].end).toBe(text.length);
  });

  it('splits code at top-level declarations', () => {
    const fn = (n: number) => `export function f${n}(a: number) {\n  const x = a * ${n};\n  return x + 1;\n}\n`;
    const code = Array.from({ length: 40 }, (_, i) => fn(i)).join('\n');
    const chunks = chunkText(code, { code: true, size: 300 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(code.slice(c.start, c.end).trimStart().startsWith('export function')).toBe(true);
  });

  it('returns nothing for blank text', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });
});

describe('terms', () => {
  it('folds accents and case, splits camelCase and snake_case, stems plurals', () => {
    expect(terms('Résumé_Final invoices TaxReturn2025')).toEqual(['resume', 'final', 'invoice', 'tax', 'return2025']);
    expect(stem('companies')).toBe('company');
    expect(stem('class')).toBe('class');
  });
  it('drops stop words and pairs CJK characters', () => {
    expect(terms('the cat and the hat')).toEqual(['cat', 'hat']);
    expect(terms('東京駅')).toEqual(['東京', '京駅']);
  });
});

// ---------------------------------------------------------------- BM25

describe('Bm25', () => {
  it('ranks the passage that is most about the words first', () => {
    const b = new Bm25();
    const a = b.add(terms('kubernetes cluster migration plan for kubernetes'));
    const c = b.add(terms('grocery list: apples, bread, milk'));
    const d = b.add(terms('a short note mentioning kubernetes once among many other words about lunch and meetings'));
    const hits = b.search(terms('kubernetes migration'));
    expect(hits.map((h) => h.doc)).toEqual([a, d]);
    expect(hits.some((h) => h.doc === c)).toBe(false);
  });

  it('forgets removed passages, reuses numbers after compaction and survives saving', () => {
    const b = new Bm25();
    const x = b.add(['alpha', 'beta']);
    b.add(['gamma']);
    b.remove(x);
    expect(b.search(['alpha'])).toEqual([]);
    b.compact();
    const y = b.add(['delta']);
    expect(y).toBe(x);
    const back = Bm25.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
    expect(back.search(['delta']).map((h) => h.doc)).toEqual([y]);
    expect(back.search(['gamma'])).toHaveLength(1);
    expect(back.size).toBe(2);
  });

  it('applies boosts and filters', () => {
    const b = new Bm25();
    const body = b.add(['invoice', 'acme', 'total']);
    const name = b.add(['invoice'], 3);
    expect(b.search(['invoice'])[0].doc).toBe(name);
    expect(b.search(['invoice'], 10, (d) => d !== name).map((h) => h.doc)).toEqual([body]);
  });
});

// ---------------------------------------------------------------- vectors

function randomUnit(n: number, seed: number): Float32Array {
  let s = seed;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; v[i] = s / 2147483648 - 0.5; }
  let norm = 0;
  for (const x of v) norm += x * x;
  return v.map((x) => x / Math.sqrt(norm));
}

describe('VectorStore', () => {
  it('8-bit vectors rank like the float originals', () => {
    const dims = 384;
    const store = new VectorStore(dims, 4);
    const raw: Float32Array[] = [];
    for (let i = 0; i < 300; i++) { const v = randomUnit(dims, i + 1); raw.push(v); store.set(i, v); }
    const q = randomUnit(dims, 999);
    const exact = raw.map((v, i) => ({ i, s: cosine(q, v) })).sort((a, b) => b.s - a.s).slice(0, 10).map((x) => x.i);
    const got = store.search(q, 10).map((h) => h.key);
    // The top hits agree; quantisation error is far below the gaps between them.
    expect(got.slice(0, 5)).toEqual(exact.slice(0, 5));
    expect(new Set(got).size).toBe(10);
    const { q: qq, scale } = quantize(raw[0]);
    const back = Array.from(qq, (x) => x * scale);
    expect(cosine(back, raw[0])).toBeGreaterThan(0.999);
  });

  it('deletes, reuses rows and round-trips through bytes', () => {
    const s = new VectorStore(3);
    s.set(7, [1, 0, 0]);
    s.set(8, [0, 1, 0]);
    s.delete(7);
    s.set(9, [0, 0, 1]);
    expect(s.size).toBe(2);
    const back = VectorStore.fromBuffer(s.toBuffer());
    expect(back.search(new Float32Array([0, 0, 1]), 1)[0].key).toBe(9);
    expect(back.has(7)).toBe(false);
  });

  it('searches 200 000 passages quickly', () => {
    const dims = 384;
    const rows = 200_000;
    const s = new VectorStore(dims, rows);
    const v = randomUnit(dims, 3);
    for (let i = 0; i < rows; i++) s.set(i, v);
    const q = randomUnit(dims, 4);
    // The yardstick: the least work any search has to do, one plain dot product per row
    // over the same amount of 8-bit data. Timing both side by side, best of several runs,
    // means a busy machine slows both alike, while a real slowdown in search (sorting
    // every row, copying rows, a slower inner loop) still shows up as a bigger ratio.
    const plain = new Int8Array(dims * rows).fill(7);
    let sink = 0;
    const floor = () => {
      for (let r = 0; r < rows; r++) {
        const off = r * dims;
        let dot = 0;
        for (let i = 0; i < dims; i++) dot += q[i] * plain[off + i];
        sink += dot;
      }
    };
    s.search(q, 50);
    floor();
    let searchMs = Infinity;
    let floorMs = Infinity;
    for (let run = 0; run < 5; run++) {
      let t0 = performance.now();
      s.search(q, 50);
      searchMs = Math.min(searchMs, performance.now() - t0);
      t0 = performance.now();
      floor();
      floorMs = Math.min(floorMs, performance.now() - t0);
    }
    expect(Number.isFinite(sink)).toBe(true);
    // About 50 ms on a laptop, close to the yardstick; allow three times it plus a little.
    expect(searchMs, `search ${searchMs.toFixed(1)} ms, plain scan ${floorMs.toFixed(1)} ms`).toBeLessThan(floorMs * 3 + 25);
  });
});

describe('meanPool', () => {
  it('averages the masked tokens and normalises', () => {
    const hidden = new Float32Array([1, 0, 3, 0, 100, 100]);
    const [v] = meanPool(hidden, [1, 3, 2], [[1, 1, 0]]);
    // (1,0) and (3,0) average to (2,0); the third token is padding.
    expect(v[0]).toBeCloseTo(1);
    expect(v[1]).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------- tokenizer

describe('UnigramTokenizer', () => {
  const tok = new UnigramTokenizer({
    vocab: [['<s>', 0], ['<pad>', 0], ['</s>', 0], ['<unk>', 0], ['▁', -2], ['▁hello', -3], ['▁hell', -4], ['o', -3], ['▁wor', -4], ['ld', -4], ['▁world', -3.5], ['▁a', -2], ['b', -3]],
    unkId: 3, bosId: 0, eosId: 2, padId: 1,
  });
  it('finds the best split and adds start and end markers', () => {
    expect(tok.encode('hello world')).toEqual([0, 5, 10, 2]);
    // Leading spaces go, runs of spaces become one, one trailing space stays (as the model's own tokenizer does).
    expect(tok.encode('  hello   world ')).toEqual([0, 5, 10, 4, 2]);
  });
  it('turns unknown characters into one <unk>', () => {
    expect(tok.encodeRaw('abxyz')).toEqual([11, 12, 3]);
  });
  it('cuts long input to the limit', () => {
    expect(tok.encode('hello '.repeat(100), 10)).toHaveLength(10);
  });

  // The real model's tokenizer is 17 MB and downloaded on demand; when it is
  // available (KEEPER_E5_DIR), compare with ids from the reference implementation.
  const dir = process.env.KEEPER_E5_DIR;
  it.skipIf(!dir || !existsSync(path.join(dir ?? '', 'tokenizer.json')))('matches the reference tokenizer on mixed-language samples', () => {
    const real = UnigramTokenizer.fromJson(readFileSync(path.join(dir!, 'tokenizer.json'), 'utf8'));
    const ref = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'e5-token-ids.json'), 'utf8')) as [string, number[]][];
    for (const [s, ids] of ref) expect(real.encode(s)).toEqual(ids);
  });
});

// ---------------------------------------------------------------- redaction

describe('redact', () => {
  const secrets = [
    'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
    'AKIAIOSFODNN7EXAMPLE',
    'AIzaSyA1234567890abcdefghijklmnopqrstuv',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'xoxb-1234567890-abcdefghij',
    'sk_live_abcdefghijklmnop1234',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'postgres://admin:hunter2@db.example.com:5432/app',
  ];
  it('blanks every kind of key and token', () => {
    for (const s of secrets) {
      const r = redact(`config: ${s} end`);
      expect(r.text, s).not.toContain(s);
      expect(Object.values(r.found).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }
  });
  it('blanks private keys, password lines, cards and IBANs but keeps ordinary text', () => {
    const text = [
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----',
      'Wi-Fi password: Sunflower-2024!',
      'PASSWORD=correct-horse-battery',
      'api_key = "abc123def456"',
      'Card 4111 1111 1111 1111 exp 12/29',
      'IBAN DE89 3704 0044 0532 0130 00',
      'Order 1234567890123 shipped; total 12.50; phone 555 0100',
    ].join('\n');
    const r = redact(text);
    expect(r.text).not.toContain('b3BlbnNzaC1rZXkt');
    expect(r.text).not.toContain('Sunflower-2024!');
    expect(r.text).not.toContain('correct-horse-battery');
    expect(r.text).not.toContain('abc123def456');
    expect(r.text).not.toContain('4111 1111 1111 1111');
    expect(r.text).toContain('[card ending 1111]');
    expect(r.text).not.toContain('3704 0044');
    // Not a valid card number (Luhn) and not a secret: left alone.
    expect(r.text).toContain('Order 1234567890123 shipped');
    expect(r.text).toContain('Wi-Fi password: [removed]');
  });
  it('checks card and IBAN check digits', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });
});

// ---------------------------------------------------------------- engine

/** A toy "meaning" model: words in the same group get the same direction. */
const GROUPS = [['rent', 'lease', 'landlord', 'apartment', 'tenant', 'deposit', 'miete', 'vermieter'], ['kubernetes', 'cluster', 'migration', 'deploy'], ['cake', 'recipe', 'flour', 'bake']];
const fakeEmbedder: Embedder = {
  id: 'toy',
  dims: 4,
  async embed(texts) {
    return texts.map((t) => {
      const v = new Float32Array(4);
      v[3] = 0.05;
      for (const w of terms(t, true)) GROUPS.forEach((g, i) => { if (g.some((x) => w.startsWith(x))) v[i] += 1; });
      return v;
    });
  },
};

function library(): { lib: Map<string, FileEntry>; texts: Record<string, string> } {
  const texts: Record<string, string> = {
    [`${H}/Documents/lease.pdf`]: 'Apartment lease. The tenant pays 1,200 EUR each month. The deposit is two months and the landlord returns it within 30 days.',
    [`${H}/Documents/Mietvertrag.txt`]: 'Die Miete beträgt 1200 Euro. Der Vermieter erhält die Kaution.',
    [`${H}/Documents/k8s-plan.md`]: '# Kubernetes migration\n\nMove the payments cluster to the new region in March.',
    [`${H}/Documents/cake.txt`]: 'Grandma\'s cake recipe: flour, sugar, eggs. Bake for 40 minutes.',
  };
  const lib = new Map<string, FileEntry>();
  for (const p of Object.keys(texts)) lib.set(p, file(p, { text: texts[p] }));
  lib.set(`${H}/Downloads/invoice-acme.pdf`, file(`${H}/Downloads/invoice-acme.pdf`, { source: { id: 'gmail', name: 'Gmail', host: 'mail.google.com' }, mtime: NOW - 3 * DAY }));
  lib.set(`${H}/Pictures/beach.jpg`, file(`${H}/Pictures/beach.jpg`, { mtime: NOW - 400 * DAY }));
  return { lib, texts };
}

async function engine(withMeaning = false) {
  const { lib, texts } = library();
  const e = new BrainEngine({ getText: async (f) => texts[f.path], isExcluded: (p) => p.includes('/Private/') });
  await e.sync(lib.values());
  if (withMeaning) {
    e.useEmbedder(fakeEmbedder);
    while (await e.embedSome(8, (p) => lib.get(p))) { /* drain */ }
  }
  return { e, lib, texts };
}

describe('BrainEngine', () => {
  it('finds files by words inside them, with the matching passage', async () => {
    const { e, lib } = await engine();
    const hits = await e.search({ query: 'deposit landlord' }, lib, NOW);
    expect(hits[0].path).toBe(`${H}/Documents/lease.pdf`);
    expect(hits[0].why).toContain('words');
    expect(hits[0].snippet).toContain('deposit');
    const [s, eIdx] = hits[0].highlights![0];
    expect(hits[0].snippet!.slice(s, eIdx).toLowerCase()).toMatch(/deposit|landlord/);
  });

  it('finds files by meaning, across languages, once vectors exist', async () => {
    const { e, lib } = await engine(true);
    expect(e.pendingCount).toBe(0);
    const hits = await e.search({ query: 'how much rent do I pay', mode: 'meaning' }, lib, NOW);
    const paths = hits.map((h) => h.path);
    expect(paths.slice(0, 2).sort()).toEqual([`${H}/Documents/Mietvertrag.txt`, `${H}/Documents/lease.pdf`]);
    expect(paths).not.toContain(`${H}/Documents/cake.txt`);
  });

  it('mixes signals: hybrid ranks a file found by both words and meaning first', async () => {
    const { e, lib } = await engine(true);
    const hits = await e.search({ query: 'cluster migration' }, lib, NOW);
    expect(hits[0].path).toBe(`${H}/Documents/k8s-plan.md`);
    expect(hits[0].why).toEqual(expect.arrayContaining(['words', 'meaning']));
    expect(hits[0].score).toBeGreaterThan(0.5);
  });

  it('applies search-bar filters and options', async () => {
    const { e, lib } = await engine();
    const fromGmail = await e.search({ query: 'pdfs from gmail' }, lib, NOW);
    expect(fromGmail.map((h) => h.path)).toEqual([`${H}/Downloads/invoice-acme.pdf`]);
    const recent = await e.search({ query: 'beach', modifiedAfter: NOW - 30 * DAY }, lib, NOW);
    expect(recent).toEqual([]);
    const inDocs = await e.search({ query: 'recipe', within: [`${H}/Pictures`] }, lib, NOW);
    expect(inDocs).toEqual([]);
    const byKind = await e.search({ query: 'beach', kinds: ['image'] }, lib, NOW);
    expect(byKind[0].path).toBe(`${H}/Pictures/beach.jpg`);
  });

  it('finds files with no text by name and details', async () => {
    const { e, lib } = await engine();
    const hits = await e.search({ query: 'acme invoice' }, lib, NOW);
    expect(hits[0].path).toBe(`${H}/Downloads/invoice-acme.pdf`);
    expect(hits[0].source).toBe('Gmail');
  });

  it('keeps up with changes and never indexes excluded folders', async () => {
    const { e, lib, texts } = await engine();
    expect(await e.sync(lib.values())).toBe(0);
    const p = `${H}/Documents/cake.txt`;
    texts[p] = 'Now this file is about sourdough starters.';
    lib.set(p, { ...lib.get(p)!, mtime: NOW, text: texts[p] });
    lib.delete(`${H}/Pictures/beach.jpg`);
    const secret = `${H}/Private/diary.txt`;
    texts[secret] = 'secret sourdough diary';
    lib.set(secret, file(secret, { text: texts[secret] }));
    expect(await e.sync(lib.values())).toBe(1);
    const hits = await e.search({ query: 'sourdough' }, lib, NOW);
    expect(hits.map((h) => h.path)).toEqual([p]);
    expect(await e.search({ query: 'grandma' }, lib, NOW)).toEqual([]);
    expect(e.files.has(`${H}/Pictures/beach.jpg`)).toBe(false);
  });

  it('saves and loads without re-reading anything', async () => {
    const { e, lib } = await engine();
    const copy = new BrainEngine({ getText: async () => { throw new Error('should not read'); } });
    copy.load(JSON.parse(JSON.stringify(e.toJSON())));
    expect(await copy.sync(lib.values())).toBe(0);
    const hits = await copy.search({ query: 'kubernetes' }, lib, NOW);
    expect(hits[0].path).toBe(`${H}/Documents/k8s-plan.md`);
  });

  it('makes snippets around the first word', () => {
    const long = 'x '.repeat(200) + 'the Invoices are here ' + 'y '.repeat(200);
    const s = makeSnippet(long, ['invoice']);
    expect(s.snippet.startsWith('…')).toBe(true);
    const [a, b] = s.highlights[0];
    expect(s.snippet.slice(a, b)).toBe('Invoices');
  });
});

// ---------------------------------------------------------------- harness

/** A scripted AI: each turn returns the next result. */
function scripted(turns: ((msgs: ChatMessage[], tools: ToolSpec[]) => Partial<ChatResult>)[], over: Partial<ChatProvider> = {}): ChatProvider & { seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  let i = 0;
  return {
    id: 'fake', label: 'Fake', model: 'fake-1', local: false, supportsTools: true, contextTokens: 100_000, seen,
    async chat(msgs, tools, opts) {
      seen.push(JSON.parse(JSON.stringify(msgs)));
      const r = { text: '', toolCalls: [], stop: 'end' as const, ...turns[Math.min(i++, turns.length - 1)](msgs, tools) };
      if (r.text) opts?.onDelta?.(r.text);
      return { ...r, stop: r.toolCalls?.length ? 'tool' : r.stop } as ChatResult;
    },
    ...over,
  };
}

async function harnessEnv(): Promise<HarnessEnv & { trashed: string[] }> {
  const { e, lib, texts } = await engine();
  const trashed: string[] = [];
  return {
    trashed,
    visibility: 'full',
    home: H,
    allowed: (p) => lib.has(p) || p.startsWith(`${H}/Documents`),
    search: (q, o) => e.search({ query: q, ...o, kinds: o.kinds as never }, lib, NOW),
    read: async (p, off, max) => {
      const t = texts[p] ?? '';
      return { text: t.slice(off, off + max), total: t.length, truncated: off + max < t.length };
    },
  };
}

describe('Harness', () => {
  it('runs tools, cites sources, and only proposes actions', async () => {
    const env = await harnessEnv();
    const ai = scripted([
      () => ({ toolCalls: [{ id: 'a', name: 'search_files', args: { query: 'deposit' } }] }),
      () => ({ toolCalls: [{ id: 'b', name: 'read_file', args: { path: '~/Documents/lease.pdf' } }] }),
      () => ({ toolCalls: [{ id: 'c', name: 'propose_actions', args: { actions: [{ type: 'trash', path: `${H}/Documents/lease.pdf`, reason: 'old' }, { type: 'trash', path: '/etc/passwd', reason: 'nope' }] } }] }),
      () => ({ text: 'The deposit is two months [[~/Documents/lease.pdf]].' }),
    ]);
    const steps: string[] = [];
    const r = await new Harness(ai, env, { onStep: (s) => steps.push(s.tool) }).ask('What is the deposit?');
    expect(steps).toEqual(['search_files', 'read_file', 'propose_actions']);
    expect(r.answer).toContain('two months');
    expect(r.sources[0].path).toBe(`${H}/Documents/lease.pdf`);
    expect(r.actions).toEqual([{ type: 'trash', path: `${H}/Documents/lease.pdf`, reason: 'old' }]);
    expect(env.trashed).toEqual([]);
    // The tool results went back to the AI, each answering its call.
    const last = ai.seen[3];
    expect(last.filter((m) => m.role === 'tool').map((m) => m.toolCallId)).toEqual(['a', 'b', 'c']);
    expect(last.find((m) => m.toolCallId === 'b')!.content).toContain('two months');
    expect(last.find((m) => m.toolCallId === 'c')!.content).toContain('/etc/passwd');
  });

  it('refuses paths outside the library and reports errors back to the AI', async () => {
    const env = await harnessEnv();
    const ai = scripted([() => ({ toolCalls: [{ id: 'x', name: 'read_file', args: { path: '/etc/shadow' } }] }), () => ({ text: 'Could not read it.' })]);
    const r = await new Harness(ai, env).ask('read /etc/shadow');
    expect(r.trace[0].error).toBe(true);
    const tool = ai.seen[1].find((m) => m.role === 'tool')!;
    expect(tool.isError).toBe(true);
    expect(tool.content).toMatch(/outside/);
  });

  it('blanks secrets before they reach a cloud AI, not a local one', async () => {
    const env = await harnessEnv();
    const p = `${H}/Documents/lease.pdf`;
    env.read = async () => ({ text: 'wifi password: hunter22 and the deposit', total: 40, truncated: false });
    const call = () => ({ toolCalls: [{ id: 'r', name: 'read_file', args: { path: p } }] });
    const cloud = scripted([call, () => ({ text: 'ok' })]);
    const r = await new Harness(cloud, env).ask('?');
    expect(cloud.seen[1].find((m) => m.role === 'tool')!.content).not.toContain('hunter22');
    expect(r.redacted).toEqual({ password: 1 });
    const local = scripted([call, () => ({ text: 'ok' })], { local: true });
    await new Harness(local, env).ask('?');
    expect(local.seen[1].find((m) => m.role === 'tool')!.content).toContain('hunter22');
  });

  it('hides text inside files when only names are allowed', async () => {
    const env = { ...(await harnessEnv()), visibility: 'names' as const };
    const ai = scripted([(_m, tools) => ({ toolCalls: [{ id: 's', name: 'search_files', args: { query: 'deposit' } }], text: tools.map((t) => t.name).join(',') }), () => ({ text: 'done' })]);
    await new Harness(ai, env).ask('deposit?');
    expect(ai.seen[0].length).toBeGreaterThan(0);
    const result = ai.seen[1].find((m) => m.role === 'tool')!.content;
    expect(result).toContain('lease.pdf');
    expect(result).not.toContain('two months');
  });

  it('looks things up first for AIs without tools, and reads suggestions from the answer', async () => {
    const env = await harnessEnv();
    const ai = scripted([(msgs, tools) => {
      expect(tools).toEqual([]);
      expect(msgs[msgs.length - 1].content).toContain('lease.pdf');
      return { text: `Two months.\n\`\`\`json\n{"actions":[{"type":"open","path":"${H}/Documents/lease.pdf","reason":"see"},{"type":"trash","path":"/bin/sh","reason":"x"}]}\n\`\`\`` };
    }], { supportsTools: false, contextTokens: 8192 });
    const r = await new Harness(ai, env).ask('deposit landlord');
    expect(r.retrievalOnly).toBe(true);
    expect(r.answer).toBe('Two months.');
    expect(r.actions).toEqual([{ type: 'open', path: `${H}/Documents/lease.pdf`, reason: 'see' }]);
  });

  it('stops after a set number of rounds', async () => {
    const env = await harnessEnv();
    const ai = scripted([(_m, tools) => (tools.length ? { toolCalls: [{ id: 'l', name: 'search_files', args: { query: 'x' } }] } : { text: 'giving up' })]);
    const r = await new Harness(ai, env, { maxRounds: 3 }).ask('loop');
    expect(ai.seen).toHaveLength(3);
    expect(r.answer).toBe('giving up');
  });
});

// ---------------------------------------------------------------- providers

describe('providers', () => {
  it('speaks the OpenAI chat format, streaming text and tool calls', async () => {
    const http = await import('node:http');
    let body: Record<string, unknown> = {};
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        body = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (d: unknown) => res.write(`data: ${JSON.stringify(d)}\n\n`);
        ev({ choices: [{ delta: { content: 'Hel' } }] });
        ev({ choices: [{ delta: { content: 'lo' } }] });
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'search_files', arguments: '{"que' } }] } }] });
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"tax"}' } }] }, finish_reason: 'tool_calls' }] });
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const p = createProvider({ kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'local-model' });
      expect(p.local).toBe(true);
      let streamed = '';
      const r = await p.chat([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], [{ name: 'search_files', description: 'd', parameters: { type: 'object' } }], { onDelta: (d) => (streamed += d) });
      expect(streamed).toBe('Hello');
      expect(r.toolCalls).toEqual([{ id: 'c1', name: 'search_files', args: { query: 'tax' } }]);
      expect(r.stop).toBe('tool');
      expect((body.tools as unknown[]).length).toBe(1);
    } finally {
      server.close();
    }
  });

  it('needs a key for cloud endpoints', async () => {
    const p = createProvider({ kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'x' });
    await expect(p.chat([{ role: 'user', content: 'hi' }], [])).rejects.toThrow(/API key/);
  });
});

// ---------------------------------------------------------------- MCP

describe('MCP server', () => {
  async function server() {
    const env = await harnessEnv();
    return new McpServer({ env, version: '0.1.0', savedSearches: () => [{ id: 's1', name: 'Leases', text: 'lease' }], status: () => ({ files: 6 }) });
  }

  it('does the handshake and lists read-only tools', async () => {
    const s = await server();
    const init = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    expect(init!.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'keeper' }, capabilities: { tools: {} } });
    expect(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
    const list = (await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))!.result as { tools: { name: string }[] };
    const names = list.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_files', 'read_file']));
    expect(names).not.toContain('propose_actions');
    const old = await s.handle({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect((old!.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18');
  });

  it('calls tools, reads resources and reports errors', async () => {
    const s = await server();
    const r = (await s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_files', arguments: { query: 'kubernetes' } } }))!.result as { content: { text: string }[] };
    expect(r.content[0].text).toContain('k8s-plan.md');
    const bad = (await s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_file', arguments: { path: '/etc/passwd' } } }))!.result as { isError: boolean };
    expect(bad.isError).toBe(true);
    const res = (await s.handle({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'keeper://saved/s1' } }))!.result as { contents: { text: string }[] };
    expect(res.contents[0].text).toContain('lease.pdf');
    const unknown = await s.handle({ jsonrpc: '2.0', id: 7, method: 'nope' });
    expect(unknown!.error!.code).toBe(-32601);
  });

  it('serves newline-delimited JSON over streams', async () => {
    const s = await server();
    const input = new PassThrough();
    const out: JsonRpcResponse[] = [];
    const done = serveLines(s, input, (l) => out.push(JSON.parse(l)));
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
    input.write('not json\n');
    input.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n');
    await done;
    expect(out.map((o) => o.id).sort()).toEqual([1, 2, null].sort());
    expect(out.find((o) => o.id === 1)!.result).toBeTruthy();
    expect(out.find((o) => o.id === null)!.error!.code).toBe(-32700);
    expect(out.find((o) => o.id === 2)!.result).toEqual({});
  });
});

// Real embeddings, when the model has been downloaded (KEEPER_E5_DIR=…/models).
describe.skipIf(!process.env.KEEPER_E5_MODELS)('E5 model', () => {
  it('puts similar sentences closer than unrelated ones, across languages', async () => {
    const { E5Embedder } = await import('../core/brain/e5');
    const e = await E5Embedder.load(process.env.KEEPER_E5_MODELS!);
    const [q] = await e.embed(['how much did I pay for rent'], 'query');
    const [en, de, fox] = await e.embed(['Monthly apartment lease payment: 1,200 EUR to the landlord.', 'Wohnungsmiete: 1200 Euro monatlich an den Vermieter.', 'The quick brown fox jumps over the lazy dog.'], 'passage');
    expect(cosine(q, en)).toBeGreaterThan(cosine(q, fox) + 0.08);
    expect(cosine(q, de)).toBeGreaterThan(cosine(q, fox) + 0.08);
  }, 60_000);
});

