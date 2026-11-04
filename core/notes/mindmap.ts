// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A note's headings and lists as a mind map, and back. The map is the note:
// every edit (add, rename, move, remove) is written into the Markdown, and
// everything that is not a heading or a list item (paragraphs, tables, code,
// properties) stays where it was, attached to the branch above it. Pure, so
// it is unit-tested; the layout is plain arithmetic for hundreds of nodes.

import { splitFrontmatter } from './parse';

export interface MindNode {
  id: string;
  text: string;
  kind: 'root' | 'heading' | 'item';
  /** heading level as written (1–6) */
  level: number;
  /** "- ", "* ", "1. " … as written */
  marker?: string;
  /** a checkbox: ' ' or 'x' */
  task?: string;
  /** lines after this node that are not branches (kept as written) */
  rest: string[];
  /** a list item: lines after its branches, not indented (text below a list), kept with it */
  after?: string[];
  /** a list item: its indentation and depth as written (kept while it stays at that depth) */
  ind?: string;
  depth?: number;
  /** added or moved in the map: written with a blank line before it */
  fresh?: boolean;
  children: MindNode[];
}

export interface MindDoc {
  /** the properties block, as written */
  front: string;
  root: MindNode;
  /** the root came from a "# Title" line (else it is the file's name) */
  rootIsHeading: boolean;
}

let seq = 0;
const nid = () => `m${(++seq).toString(36)}`;

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const HEAD = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Reads a note into a map: the title (or file name) in the middle, headings and list items as branches. */
export function parseMindmap(text: string, fileTitle: string): MindDoc {
  const src = text.replace(/\r\n?/g, '\n');
  const { yaml, bodyStart } = splitFrontmatter(src);
  const front = yaml !== null ? src.slice(0, bodyStart) : '';
  const lines = src.slice(bodyStart).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const root: MindNode = { id: nid(), text: fileTitle, kind: 'root', level: 0, rest: [], children: [] };
  let rootIsHeading = false;
  // Lines inside code blocks are never headings or list items.
  const fenced = new Set<number>();
  for (let k = 0, mark: string | null = null; k < lines.length; k++) {
    const f = FENCE.exec(lines[k]);
    if (mark) { fenced.add(k); if (f && lines[k].trim().startsWith(mark)) mark = null; } else if (f) { mark = f[1]; fenced.add(k); }
  }
  // The first "# Title" (with only blank lines before it, and no other "# " title) is the middle of the map.
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const h1 = fenced.has(i) ? null : HEAD.exec(lines[i] ?? '');
  let lead = '';
  if (h1 && h1[1].length === 1 && !lines.some((l, k) => k > i && !fenced.has(k) && /^#\s/.test(l))) { root.text = h1[2]; rootIsHeading = true; lead = lines.slice(0, i).map((l) => `${l}\n`).join(''); i++; } else i = 0;

  const heads: MindNode[] = [root];
  let items: MindNode[] = [];
  // Where text that is not a branch goes: the section, or (after a list) below the list's last top item.
  let tail: string[] = root.rest;
  let fenceInto: string[] | null = null;
  let fenceCut = 0;
  const indentOf = (l: string) => l.length - l.trimStart().length;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (fenced.has(i)) {
      if (!fenceInto) {
        // A code block indented under a list item belongs to it; otherwise to the section.
        if (items.length && /^\s/.test(line)) { const it = items[items.length - 1]; fenceInto = it.rest; fenceCut = (it.ind ?? '').length; }
        else { items = []; fenceInto = tail; fenceCut = 0; }
      }
      fenceInto.push(relIndent(line, fenceCut));
      if (!fenced.has(i + 1)) fenceInto = null;
      continue;
    }
    const h = HEAD.exec(line);
    if (h) {
      const level = h[1].length;
      while (heads.length > 1 && heads[heads.length - 1].level >= level) heads.pop();
      const node: MindNode = { id: nid(), text: h[2], kind: 'heading', level, rest: [], children: [] };
      heads[heads.length - 1].children.push(node);
      heads.push(node);
      items = [];
      tail = node.rest;
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const indent = li[1].replace(/\t/g, '    ').length;
      while (items.length && (items[items.length - 1].ind ?? '').replace(/\t/g, '    ').length >= indent) items.pop();
      const parent = items.length ? items[items.length - 1] : heads[heads.length - 1];
      const node: MindNode = { id: nid(), text: li[4], kind: 'item', level: 0, marker: /\d/.test(li[2]) ? li[2].replace(/\d+/, '1') : li[2], task: li[3] === undefined ? undefined : li[3].toLowerCase() === 'x' ? 'x' : ' ', rest: [], after: [], ind: li[1], depth: items.length, children: [] };
      parent.children.push(node);
      items.push(node);
      if (items.length === 1) tail = node.after!;
      continue;
    }
    if (items.length) {
      const it = items[items.length - 1];
      if (line.trim() && indentOf(line) > 0) { it.rest.push(relIndent(line, (it.ind ?? '').length)); continue; }
      if (!line.trim()) {
        // A blank line inside a list: before more of the same item, or between items.
        const next = lines.slice(i + 1).find((l) => l.trim());
        if (next !== undefined && indentOf(next) > 0 && !LIST.test(next)) { it.rest.push(''); continue; }
        if (next !== undefined && LIST.test(next)) { it.after!.push(''); continue; }
        tail.push(line);
        continue;
      }
      items = [];
    }
    tail.push(line);
  }
  return { front: front + lead, root, rootIsHeading };
}

const relIndent = (line: string, by: number) => { let k = 0; while (k < by && (line[k] === ' ' || line[k] === '\t')) k++; return line.slice(k); };

/** The map written back as Markdown. */
export function serializeMindmap(doc: MindDoc): string {
  const out: string[] = [];
  const blankBefore = () => { if (out.length && out[out.length - 1].trim() !== '') out.push(''); };
  if (doc.rootIsHeading) out.push(`# ${doc.root.text}`);
  out.push(...doc.root.rest);
  const writeItem = (n: MindNode, depth: number, index: number) => {
    const pad = n.ind !== undefined && n.depth === depth ? n.ind : '  '.repeat(depth);
    const marker = n.marker && /\d/.test(n.marker) ? `${index + 1}${n.marker.slice(-1)}` : n.marker ?? '-';
    out.push(`${pad}${marker} ${n.task !== undefined ? `[${n.task}] ` : ''}${n.text}`);
    for (const r of n.rest) out.push(r.trim() ? `${pad}${r}` : r);
    n.children.forEach((c, k) => writeItem(c, depth + 1, k));
    out.push(...(n.after ?? []));
  };
  const writeChildren = (n: MindNode, level: number) => {
    const items = n.children.filter((c) => c.kind === 'item');
    const heads = n.children.filter((c) => c.kind !== 'item');
    items.forEach((c, k) => writeItem(c, 0, k));
    for (const hd of heads) {
      const lv = Math.min(6, Math.max(hd.level, level + 1));
      if (hd.fresh) blankBefore();
      out.push(`${'#'.repeat(lv)} ${hd.text}`);
      out.push(...hd.rest);
      writeChildren(hd, lv);
    }
  };
  writeChildren(doc.root, doc.rootIsHeading ? 1 : 0);
  let body = out.join('\n');
  if (body && !body.endsWith('\n')) body += '\n';
  return doc.front + body;
}

// ---------------------------------------------------------------- edits

export function findNode(doc: MindDoc, id: string): { node: MindNode; parent: MindNode | null; index: number } | null {
  if (doc.root.id === id) return { node: doc.root, parent: null, index: 0 };
  const walk = (p: MindNode): ReturnType<typeof findNode> => {
    for (let i = 0; i < p.children.length; i++) {
      const c = p.children[i];
      if (c.id === id) return { node: c, parent: p, index: i };
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(doc.root);
}

const isUnder = (node: MindNode, id: string): boolean => node.children.some((c) => c.id === id || isUnder(c, id));

/** A branch moved under an item becomes an item (and so do its branches); headings deeper than 6 too. */
function fitKind(n: MindNode, parent: MindNode) {
  if (n.kind === 'heading' && (parent.kind === 'item' || parentLevel(parent) >= 6)) {
    n.kind = 'item';
    n.marker = '-';
    n.task = undefined;
  }
  if (n.kind === 'heading') n.level = Math.max(parentLevel(parent) + 1, Math.min(n.level, 6));
  for (const c of n.children) fitKind(c, n);
}
const parentLevel = (p: MindNode) => (p.kind === 'root' ? 1 : p.kind === 'heading' ? p.level : 7);

/** Headings come after list items under the same branch (that is how Markdown reads them). */
function keepOrder(p: MindNode) {
  const items = p.children.filter((c) => c.kind === 'item');
  const heads = p.children.filter((c) => c.kind !== 'item');
  p.children = [...items, ...heads];
}

/** A new branch: under a heading or the middle it is a heading (when its siblings are), otherwise a list item. */
function newNode(parent: MindNode, like: MindNode | undefined, text: string): MindNode {
  const asHeading = like ? like.kind === 'heading' : parent.kind !== 'item' && parent.children.every((c) => c.kind === 'heading') && parent.kind === 'root';
  return asHeading && parentLevel(parent) < 6
    ? { id: nid(), text, kind: 'heading', level: parentLevel(parent) + 1, rest: [], children: [], fresh: true }
    : { id: nid(), text, kind: 'item', level: 0, marker: like?.marker ?? '-', task: like?.task !== undefined ? ' ' : undefined, rest: [], children: [], fresh: true };
}

export function addChild(doc: MindDoc, parentId: string, text = 'New idea'): string | null {
  const f = findNode(doc, parentId);
  if (!f) return null;
  const like = [...f.node.children].reverse().find((c) => (f.node.kind === 'item' ? true : c.kind === 'heading')) ?? f.node.children[f.node.children.length - 1];
  const n = newNode(f.node, like, text);
  f.node.children.push(n);
  keepOrder(f.node);
  return n.id;
}

export function addSibling(doc: MindDoc, id: string, text = 'New idea'): string | null {
  const f = findNode(doc, id);
  if (!f) return null;
  if (!f.parent) return addChild(doc, id, text);
  const n = newNode(f.parent, f.node, text);
  if (f.node.kind === 'heading' && n.kind === 'heading') n.level = f.node.level;
  f.parent.children.splice(f.index + 1, 0, n);
  keepOrder(f.parent);
  return n.id;
}

export function renameNode(doc: MindDoc, id: string, text: string): boolean {
  const f = findNode(doc, id);
  const t = text.replace(/\s*\n\s*/g, ' ').trim();
  if (!f || !t) return false;
  f.node.text = t;
  if (f.node.kind === 'root') doc.rootIsHeading = true;
  return true;
}

/** Removes a branch; its text below it (paragraphs) goes with it. */
export function removeNode(doc: MindDoc, id: string): string | null {
  const f = findNode(doc, id);
  if (!f || !f.parent) return null;
  f.parent.children.splice(f.index, 1);
  return f.parent.children[Math.min(f.index, f.parent.children.length - 1)]?.id ?? f.parent.id;
}

/** Moves a branch under another (at `index`, or last). Not into itself. */
export function moveNode(doc: MindDoc, id: string, parentId: string, index?: number): boolean {
  const f = findNode(doc, id);
  const p = findNode(doc, parentId);
  if (!f || !f.parent || !p || id === parentId || isUnder(f.node, parentId)) return false;
  f.parent.children.splice(f.index, 1);
  const at = index === undefined ? p.node.children.length : Math.max(0, Math.min(index - (f.parent === p.node && f.index < index ? 1 : 0), p.node.children.length));
  p.node.children.splice(at, 0, f.node);
  f.node.fresh = true;
  fitKind(f.node, p.node);
  keepOrder(p.node);
  return true;
}

export function countNodes(n: MindNode): number {
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}

/** A new mind map note. */
export function newMindmapText(title: string): string {
  return `---\nview: mindmap\n---\n# ${title}\n\n## First idea\n\n## Second idea\n\n## Third idea\n`;
}

export const isMindmapNote = (props: Record<string, unknown>) => String(props.view ?? '').toLowerCase().replace(/[\s-]/g, '') === 'mindmap';

// ---------------------------------------------------------------- layout

export interface Placed { id: string; x: number; y: number; w: number; h: number; depth: number; side: 1 | -1; branch: number; hidden: number; node: MindNode }
export interface MindLayout { nodes: Placed[]; edges: { from: Placed; to: Placed }[]; width: number; height: number; minX: number; minY: number }

/** Rough text width (no DOM): wide letters count more. */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += /[MW@#%&]/.test(ch) ? 0.9 : /[A-Z0-9mw]/.test(ch) ? 0.68 : /[ilj.,;:'|! ]/.test(ch) ? 0.3 : ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
  return w * size;
}

/**
 * Places the map: 'balanced' puts the first branches left and right of the
 * middle, 'right' grows to the right like a tree. Collapsed branches hide
 * their children (and say how many).
 */
export function layoutMindmap(doc: MindDoc, opts: { mode: 'balanced' | 'right'; collapsed: Set<string>; gapX?: number; gapY?: number; maxW?: number; /** real text widths, when a screen can measure them */ measure?: (text: string, size: number, bold: boolean) => number }): MindLayout {
  const gapX = opts.gapX ?? 44;
  const gapY = opts.gapY ?? 10;
  const maxW = opts.maxW ?? 240;
  const size = (n: MindNode, depth: number) => {
    const fs = depth === 0 ? 17 : depth === 1 ? 14 : 13;
    const padX = depth === 0 ? 20 : 12;
    return { w: Math.min(maxW + (depth === 0 ? 80 : 0), Math.max(depth === 0 ? 96 : 40, Math.ceil((opts.measure ? opts.measure(`${n.task === 'x' ? '✓ ' : ''}${n.text}` || ' ', fs, depth < 2) : textWidth(`${n.task === 'x' ? '✓ ' : ''}${n.text}` || ' ', fs)) + 2 * padX + 4))), h: depth === 0 ? 46 : depth === 1 ? 34 : 30 };
  };
  const shown = (n: MindNode) => (opts.collapsed.has(n.id) ? [] : n.children);
  const blockH = new Map<string, number>();
  const measure = (n: MindNode, depth: number): number => {
    const own = size(n, depth).h;
    const kids = shown(n);
    const sum = kids.reduce((s, c) => s + measure(c, depth + 1), 0) + Math.max(0, kids.length - 1) * gapY;
    const h = Math.max(own, sum);
    blockH.set(n.id, h);
    return h;
  };
  const nodes: Placed[] = [];
  const edges: { from: Placed; to: Placed }[] = [];
  const place = (n: MindNode, depth: number, xEdge: number, top: number, side: 1 | -1, branch: number, parent: Placed | null) => {
    const s = size(n, depth);
    const bh = blockH.get(n.id)!;
    const x = side === 1 ? xEdge : xEdge - s.w;
    const p: Placed = { id: n.id, x, y: top + (bh - s.h) / 2, w: s.w, h: s.h, depth, side, branch, hidden: opts.collapsed.has(n.id) ? countNodes(n) - 1 : 0, node: n };
    nodes.push(p);
    if (parent) edges.push({ from: parent, to: p });
    let y = top + (bh - (shown(n).reduce((sum, c) => sum + blockH.get(c.id)!, 0) + Math.max(0, shown(n).length - 1) * gapY)) / 2;
    for (const c of shown(n)) {
      place(c, depth + 1, side === 1 ? x + s.w + gapX : x - gapX, y, side, branch, p);
      y += blockH.get(c.id)! + gapY;
    }
  };

  const root = doc.root;
  const rs = size(root, 0);
  const kids = shown(root);
  kids.forEach((c) => measure(c, 1));
  blockH.set(root.id, rs.h);
  let right = kids;
  let left: MindNode[] = [];
  if (opts.mode === 'balanced' && kids.length > 1) {
    // Fill the right side up to half of the total height, the rest goes left (in order, clockwise).
    const total = kids.reduce((s, c) => s + blockH.get(c.id)!, 0);
    let acc = 0;
    let cut = kids.length;
    for (let k = 0; k < kids.length; k++) { if (acc >= total / 2 && k > 0) { cut = k; break; } acc += blockH.get(kids[k].id)!; }
    right = kids.slice(0, cut);
    left = kids.slice(cut).reverse();
  }
  const rootP: Placed = { id: root.id, x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, depth: 0, side: 1, branch: -1, hidden: opts.collapsed.has(root.id) ? countNodes(root) - 1 : 0, node: root };
  nodes.push(rootP);
  const column = (list: MindNode[], side: 1 | -1, firstBranch: number) => {
    const h = list.reduce((s, c) => s + blockH.get(c.id)!, 0) + Math.max(0, list.length - 1) * gapY * 2;
    let y = -h / 2;
    list.forEach((c, k) => {
      place(c, 1, side === 1 ? rootP.x + rootP.w + gapX * 1.4 : rootP.x - gapX * 1.4, y, side, firstBranch + k, rootP);
      y += blockH.get(c.id)! + gapY * 2;
    });
  };
  column(right, 1, 0);
  column(left, -1, right.length);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of nodes) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); }
  return { nodes, edges, width: maxX - minX, height: maxY - minY, minX, minY };
}

/** The next node for an arrow key: across to a child or the parent, or up and down among siblings. */
export function neighbour(layout: MindLayout, doc: MindDoc, id: string, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): string | null {
  const here = layout.nodes.find((p) => p.id === id);
  if (!here) return null;
  const f = findNode(doc, id);
  if (!f) return null;
  const visibleKids = layout.nodes.filter((p) => f.node.children.some((c) => c.id === p.id));
  const outward = (key === 'ArrowRight' && here.side === 1) || (key === 'ArrowLeft' && here.side === -1);
  if (here.depth === 0 && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    const side = key === 'ArrowRight' ? 1 : -1;
    const k = visibleKids.filter((p) => p.side === side);
    return k.length ? k[Math.floor((k.length - 1) / 2)].id : null;
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (outward) return visibleKids.length ? visibleKids[Math.floor((visibleKids.length - 1) / 2)].id : null;
    return f.parent?.id ?? null;
  }
  // Up and down: the nearest node at the same depth on the same side.
  const same = layout.nodes.filter((p) => p.depth === here.depth && p.side === here.side && p.id !== id);
  const dir = key === 'ArrowDown' ? 1 : -1;
  const cand = same.filter((p) => (p.y - here.y) * dir > 0).sort((a, b) => Math.abs(a.y - here.y) - Math.abs(b.y - here.y));
  return cand[0]?.id ?? null;
}
