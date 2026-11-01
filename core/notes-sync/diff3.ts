// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Line-based three-way merge. Two edits to different parts of a note merge
// cleanly; two edits to the same lines are a conflict, never a silent pick.

/** Pairs of equal lines [i in a, j in b], in order (a longest common subsequence). */
export function lineMatches(a: string[], b: string[]): [number, number][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const out: [number, number][] = [];
  for (let i = 0; i < start; i++) out.push([i, i]);
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0) {
    if (n * m <= 25_000_000) {
      // LCS table over the middle part, from the end so we can walk forwards.
      const w = m + 1;
      const t = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          t[i * w + j] = a[start + i] === b[start + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (a[start + i] === b[start + j]) { out.push([start + i, start + j]); i++; j++; }
        else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
        else j++;
      }
    } else {
      // Very long and very different: match unique equal lines in order only.
      const seen = new Map<string, number>();
      for (let j = start; j < endB; j++) seen.set(b[j], seen.has(b[j]) ? -1 : j);
      let last = start - 1;
      for (let i = start; i < endA; i++) {
        const j = seen.get(a[i]);
        if (j !== undefined && j > last) { out.push([i, j]); last = j; }
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) out.push([endA + k, endB + k]);
  return out;
}

export interface MergeChunk {
  ok: boolean;
  /** merged lines (ok) */
  lines?: string[];
  /** a conflict: what each side has */
  base?: string[];
  mine?: string[];
  theirs?: string[];
}

export interface MergeResult {
  clean: boolean;
  /** the merged text; for a conflict, "mine" is kept in conflicting places */
  text: string;
  chunks: MergeChunk[];
  conflicts: number;
}

const split = (s: string) => (s === '' ? [] : s.replace(/\r\n/g, '\n').split('\n'));
const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);

/** Three-way merge of mine and theirs, both edited from base. */
export function merge3(base: string, mine: string, theirs: string): MergeResult {
  if (mine === theirs) return { clean: true, text: mine, chunks: [{ ok: true, lines: split(mine) }], conflicts: 0 };
  if (base === mine) return { clean: true, text: theirs, chunks: [{ ok: true, lines: split(theirs) }], conflicts: 0 };
  if (base === theirs) return { clean: true, text: mine, chunks: [{ ok: true, lines: split(mine) }], conflicts: 0 };
  const o = split(base);
  const a = split(mine);
  const b = split(theirs);
  const oa = new Int32Array(o.length).fill(-1);
  const ob = new Int32Array(o.length).fill(-1);
  for (const [i, j] of lineMatches(o, a)) oa[i] = j;
  for (const [i, j] of lineMatches(o, b)) ob[i] = j;
  const chunks: MergeChunk[] = [];
  const push = (lines: string[]) => {
    if (!lines.length) return;
    const last = chunks[chunks.length - 1];
    if (last?.ok) last.lines!.push(...lines);
    else chunks.push({ ok: true, lines: [...lines] });
  };
  let io = 0;
  let ia = 0;
  let ib = 0;
  let conflicts = 0;
  for (;;) {
    // Stable run: base, mine and theirs agree line by line.
    while (io < o.length && oa[io] === ia && ob[io] === ib) { push([o[io]]); io++; ia++; ib++; }
    // The next base line kept by both sides.
    let k = io;
    while (k < o.length && !(oa[k] >= ia && ob[k] >= ib)) k++;
    const ea = k < o.length ? oa[k] : a.length;
    const eb = k < o.length ? ob[k] : b.length;
    const co = o.slice(io, k);
    const ca = a.slice(ia, ea);
    const cb = b.slice(ib, eb);
    if (co.length || ca.length || cb.length) {
      if (same(ca, co)) push(cb);
      else if (same(cb, co)) push(ca);
      else if (same(ca, cb)) push(ca);
      else { chunks.push({ ok: false, base: co, mine: ca, theirs: cb }); conflicts++; }
    }
    if (k >= o.length) break;
    io = k; ia = ea; ib = eb;
  }
  const text = chunks.flatMap((c) => (c.ok ? c.lines! : c.mine!)).join('\n');
  return { clean: conflicts === 0, text, chunks, conflicts };
}

/** "+3 −1 lines" between two texts. */
export function changeSummary(before: string, after: string): string {
  const a = split(before);
  const b = split(after);
  const common = lineMatches(a, b).length;
  const added = b.length - common;
  const removed = a.length - common;
  if (!added && !removed) return 'no text changes';
  return [added ? `+${added}` : '', removed ? `−${removed}` : ''].filter(Boolean).join(' ') + ` line${added + removed === 1 ? '' : 's'}`;
}

/** Rows for a side-by-side compare: each row is a line on the left, the right, or both. */
export function sideBySide(left: string, right: string): { l?: string; r?: string; kind: 'same' | 'changed' | 'left' | 'right' }[] {
  const a = split(left);
  const b = split(right);
  const m = lineMatches(a, b);
  const rows: { l?: string; r?: string; kind: 'same' | 'changed' | 'left' | 'right' }[] = [];
  let i = 0;
  let j = 0;
  const gap = (ei: number, ej: number) => {
    while (i < ei && j < ej) rows.push({ l: a[i++], r: b[j++], kind: 'changed' });
    while (i < ei) rows.push({ l: a[i++], kind: 'left' });
    while (j < ej) rows.push({ r: b[j++], kind: 'right' });
  };
  for (const [x, y] of m) { gap(x, y); rows.push({ l: a[i++], r: b[j++], kind: 'same' }); }
  gap(a.length, b.length);
  return rows;
}
