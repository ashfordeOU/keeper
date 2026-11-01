// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Text pieces of a PDF page (where each run of text sits) turned into lines,
// paragraphs, headings, tables, chunks for AI and comparisons.

export interface Piece { page: number; str: string; x: number; y: number; width: number; height: number }

export interface Line { page: number; y: number; x: number; size: number; text: string; pieces: Piece[] }

/** Pieces grouped into lines, top to bottom, left to right. */
export function toLines(items: Piece[]): Line[] {
  const byPage = new Map<number, Piece[]>();
  for (const it of items) if (it.str.trim()) (byPage.get(it.page) ?? byPage.set(it.page, []).get(it.page)!).push(it);
  const out: Line[] = [];
  for (const [page, list] of [...byPage].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur: Piece[] = [];
    const flush = () => {
      if (!cur.length) return;
      cur.sort((a, b) => a.x - b.x);
      let text = '';
      let end = -Infinity;
      for (const p of cur) {
        const gap = p.x - end;
        if (text && gap > p.height * 0.15 && !text.endsWith(' ') && !p.str.startsWith(' ')) text += ' ';
        text += p.str;
        end = p.x + p.width;
      }
      out.push({ page, y: cur[0].y, x: cur[0].x, size: Math.max(...cur.map((p) => p.height)), text: text.replace(/\s+/g, ' ').trim(), pieces: cur });
      cur = [];
    };
    for (const it of list) {
      if (cur.length && Math.abs(cur[0].y - it.y) > Math.max(2, Math.min(cur[0].height, it.height) * 0.5)) flush();
      cur.push(it);
    }
    flush();
  }
  return out;
}

/** Most common text size: the body text. */
function bodySize(lines: Line[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) counts.set(Math.round(l.size), (counts.get(Math.round(l.size)) ?? 0) + l.text.length);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

export interface Block { page: number; kind: 'heading' | 'paragraph' | 'list'; level?: number; text: string }

/** Lines joined into paragraphs, with larger text as headings and bullets as lists. */
export function toBlocks(lines: Line[]): Block[] {
  const body = bodySize(lines);
  const out: Block[] = [];
  let prev: Line | undefined;
  for (const l of lines) {
    const big = l.size >= body * 1.25 && l.text.length < 140;
    const bullet = /^([•·▪‣◦\-*–]|\d{1,3}[.)])\s+/.test(l.text);
    const last = out[out.length - 1];
    const gap = prev && prev.page === l.page ? prev.y - l.y : Infinity;
    if (big) {
      const level = l.size >= body * 1.8 ? 1 : l.size >= body * 1.45 ? 2 : 3;
      if (last?.kind === 'heading' && last.page === l.page && last.level === level && gap < l.size * 1.6) last.text += ` ${l.text}`;
      else out.push({ page: l.page, kind: 'heading', level, text: l.text });
    } else if (bullet) {
      out.push({ page: l.page, kind: 'list', text: l.text.replace(/^([•·▪‣◦\-*–])\s+/, '') });
    } else if (last && last.kind !== 'heading' && gap < l.size * 1.7 && (last.page === l.page || !/[.!?:]$/.test(last.text))) {
      last.text = last.text.endsWith('-') ? last.text.slice(0, -1) + l.text : `${last.text} ${l.text}`;
    } else {
      out.push({ page: l.page, kind: 'paragraph', text: l.text });
    }
    prev = l;
  }
  return out;
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map((b) => (b.kind === 'heading' ? `${'#'.repeat(b.level ?? 2)} ${b.text}` : b.kind === 'list' ? `- ${b.text}` : b.text)).join('\n\n').replace(/\n\n(- )/g, '\n$1') + '\n';
}

export function linesToText(lines: Line[]): string {
  let out = '';
  let page = 0;
  for (const l of lines) {
    if (l.page !== page) { if (page) out += '\f\n'; page = l.page; }
    out += l.text + '\n';
  }
  return out;
}

/**
 * Tables found on pages: runs of lines whose words line up in the same
 * columns. Each table is rows of cells.
 */
export function findTables(lines: Line[], minRows = 3): { page: number; rows: string[][] }[] {
  const tables: { page: number; rows: string[][] }[] = [];
  const cellsOf = (l: Line) => {
    const cells: { x: number; end: number; text: string }[] = [];
    // A run of text with wide gaps inside ("Apple   3   1.20") holds several cells.
    const parts: Piece[] = [];
    const split = new Set<Piece>();
    for (const p of l.pieces) {
      const cw = p.width / Math.max(1, p.str.length);
      const re = /\S+(?: \S+)*/g;
      let m: RegExpExecArray | null;
      const found: Piece[] = [];
      while ((m = re.exec(p.str))) found.push({ ...p, str: m[0], x: p.x + m.index * cw, width: m[0].length * cw });
      if (found.length > 1 && /\S {2,}\S/.test(p.str)) { found.forEach((f) => split.add(f)); parts.push(...found); } else parts.push(p);
    }
    for (const p of parts.sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      if (last && !split.has(p) && p.x - last.end < Math.max(p.height * 1.2, 6)) { last.text += (p.x - last.end > p.height * 0.15 ? ' ' : '') + p.str; last.end = p.x + p.width; }
      else cells.push({ x: p.x, end: p.x + p.width, text: p.str });
    }
    return cells.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
  };
  let run: { line: Line; cells: { x: number; end: number; text: string }[] }[] = [];
  const close = () => {
    if (run.length >= minRows) {
      // Columns: cluster the left edges seen in the run.
      const xs = run.flatMap((r) => r.cells.map((c) => c.x)).sort((a, b) => a - b);
      const cols: number[] = [];
      for (const x of xs) if (!cols.length || x - cols[cols.length - 1] > 12) cols.push(x);
      const col = (x: number) => { let best = 0; for (let i = 0; i < cols.length; i++) if (Math.abs(cols[i] - x) < Math.abs(cols[best] - x)) best = i; return best; };
      const rows = run.map((r) => {
        const row = new Array<string>(cols.length).fill('');
        for (const c of r.cells) { const k = col(c.x); row[k] = row[k] ? `${row[k]} ${c.text}` : c.text; }
        return row;
      });
      tables.push({ page: run[0].line.page, rows });
    }
    run = [];
  };
  for (const l of lines) {
    const cells = cellsOf(l);
    const prev = run[run.length - 1];
    const aligned = prev && prev.line.page === l.page && cells.length >= 2 && Math.abs(cells.length - prev.cells.length) <= 1
      && cells.filter((c) => prev.cells.some((pc) => Math.abs(pc.x - c.x) < 12 || Math.abs(pc.end - c.end) < 12)).length >= Math.min(cells.length, prev.cells.length) - 1;
    if (cells.length >= 2 && (!run.length || aligned)) run.push({ line: l, cells });
    else { close(); if (cells.length >= 2) run.push({ line: l, cells }); }
  }
  close();
  return tables;
}

export function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][], sep = ','): string {
  return rows.map((r) => r.map((c) => (sep === ',' ? csvCell(c) : c.replace(/[\t\n]/g, ' '))).join(sep)).join('\n') + '\n';
}

export interface Chunk { id: string; page: number; pages: number[]; heading?: string; text: string; tokens: number }

/**
 * Text cut into pieces an AI can take one at a time: whole paragraphs, about
 * `target` words each, never across a heading, each knowing its pages and
 * section, with a little overlap so meaning is not lost at the cuts.
 */
export function chunkForAi(blocks: Block[], o: { target?: number; overlap?: number; source?: string } = {}): Chunk[] {
  const target = o.target ?? 350;
  const overlap = o.overlap ?? 40;
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const chunks: Chunk[] = [];
  let heading: string | undefined;
  let buf: Block[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((b) => (b.kind === 'list' ? `- ${b.text}` : b.text)).join('\n\n');
    const pages = [...new Set(buf.map((b) => b.page))];
    chunks.push({ id: `${o.source ? `${o.source}#` : ''}${chunks.length + 1}`, page: pages[0], pages, heading, text, tokens: Math.ceil(words(text) * 1.33) });
    // Carry the last sentences over.
    const tail = text.split(/(?<=[.!?])\s+/).reverse();
    let carry = '';
    for (const s of tail) { if (words(carry) + words(s) > overlap) break; carry = `${s} ${carry}`.trim(); }
    buf = carry && overlap ? [{ page: pages[pages.length - 1], kind: 'paragraph', text: carry }] : [];
  };
  for (const b of blocks) {
    if (b.kind === 'heading') { flush(); buf = []; heading = b.text; continue; }
    const n = words(b.text);
    if (buf.length && buf.reduce((t, x) => t + words(x.text), 0) + n > target) flush();
    if (n > target * 1.5) {
      // A very long paragraph is cut at sentences.
      let part = '';
      for (const s of b.text.split(/(?<=[.!?])\s+/)) {
        if (words(part) + words(s) > target && part) { buf.push({ ...b, text: part }); flush(); part = ''; }
        part = part ? `${part} ${s}` : s;
      }
      if (part) buf.push({ ...b, text: part });
      continue;
    }
    buf.push(b);
  }
  flush();
  return chunks;
}

// ---------------------------------------------------------------- comparing

export type DiffOp = { kind: 'same' | 'added' | 'removed'; words: string[] };

/** Word-by-word differences (longest common subsequence), merged into runs. */
export function diffWords(a: string[], b: string[]): DiffOp[] {
  // Trim the common start and end first so large, mostly-equal texts stay fast.
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e);
  const B = b.slice(s, b.length - e);
  const ops: DiffOp[] = [];
  const push = (kind: DiffOp['kind'], w: string) => { const last = ops[ops.length - 1]; if (last?.kind === kind) last.words.push(w); else ops.push({ kind, words: [w] }); };
  for (const w of a.slice(0, s)) push('same', w);
  if (A.length * B.length > 25_000_000) {
    // Too big for a full table: report the middle as replaced.
    for (const w of A) push('removed', w);
    for (const w of B) push('added', w);
  } else {
    const n = A.length;
    const m = B.length;
    const dp = new Array<Uint32Array>(n + 1);
    for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push('removed', A[i++]);
      else push('added', B[j++]);
    }
    while (i < n) push('removed', A[i++]);
    while (j < m) push('added', B[j++]);
  }
  for (const w of a.slice(a.length - e)) push('same', w);
  return ops;
}

export function diffSummary(ops: DiffOp[]): { added: number; removed: number; same: number } {
  const c = { added: 0, removed: 0, same: 0 };
  for (const o of ops) c[o.kind] += o.words.length;
  return c;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A readable report of the differences, as a web page. */
export function diffHtml(ops: DiffOp[], a: string, b: string, extra = ''): string {
  const c = diffSummary(ops);
  const body = ops.map((o) => {
    const t = esc(o.words.join(' '));
    if (o.kind === 'same') return o.words.length > 60 ? `${esc(o.words.slice(0, 25).join(' '))} <span class="skip">… ${o.words.length - 50} unchanged words …</span> ${esc(o.words.slice(-25).join(' '))}` : t;
    return o.kind === 'added' ? `<ins>${t}</ins>` : `<del>${t}</del>`;
  }).join(' ');
  return `<!doctype html><meta charset="utf-8"><title>Comparison</title><style>
body{font:15px/1.6 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#222}
ins{background:#d5f5dd;text-decoration:none;color:#0b5d1e}del{background:#fde0e0;color:#8a1212}
.skip{color:#999;font-style:italic}.sum{color:#555}@media(prefers-color-scheme:dark){body{background:#1c1c1e;color:#ddd}ins{background:#1e4429;color:#bff0c9}del{background:#4a1f1f;color:#ffc9c9}}
</style><h1>What changed</h1><p class="sum"><b>${esc(a)}</b> → <b>${esc(b)}</b>: ${c.added} words added, ${c.removed} removed, ${c.same} the same.</p>${extra}<p>${body}</p>`;
}
