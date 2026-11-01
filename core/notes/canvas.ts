// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// .canvas files (the open JSON Canvas 1.0 format): text, file, link and group
// cards on an endless board, joined by arrows. Read, checked and written back
// without losing fields Keeper does not know about.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type CanvasColor = string; // "1"–"6" preset or "#rrggbb"

interface NodeBase { id: string; x: number; y: number; width: number; height: number; color?: CanvasColor; [k: string]: unknown }
export type CanvasNode =
  | (NodeBase & { type: 'text'; text: string })
  | (NodeBase & { type: 'file'; file: string; subpath?: string })
  | (NodeBase & { type: 'link'; url: string })
  | (NodeBase & { type: 'group'; label?: string; background?: string; backgroundStyle?: 'cover' | 'ratio' | 'repeat' });

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: Side;
  fromEnd?: 'none' | 'arrow';
  toNode: string;
  toSide?: Side;
  toEnd?: 'none' | 'arrow';
  color?: CanvasColor;
  label?: string;
  [k: string]: unknown;
}

export interface CanvasData { nodes: CanvasNode[]; edges: CanvasEdge[]; [k: string]: unknown }

const SIDES = new Set(['top', 'right', 'bottom', 'left']);

export function emptyCanvas(): CanvasData { return { nodes: [], edges: [] }; }

/** Reads a .canvas file; an empty file is an empty board. Throws on JSON that is not a canvas. */
export function parseCanvas(text: string): CanvasData {
  if (!text.trim()) return emptyCanvas();
  const raw = JSON.parse(text) as Partial<CanvasData>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a canvas file');
  return { ...raw, nodes: Array.isArray(raw.nodes) ? raw.nodes : [], edges: Array.isArray(raw.edges) ? raw.edges : [] } as CanvasData;
}

/** Problems that would stop another app from opening the file (empty list when valid). */
export function validateCanvas(c: CanvasData): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const n of c.nodes) {
    if (typeof n.id !== 'string' || !n.id) errs.push('a card has no id');
    else if (ids.has(n.id)) errs.push(`two cards share the id ${n.id}`);
    ids.add(n.id);
    for (const k of ['x', 'y', 'width', 'height'] as const) if (typeof n[k] !== 'number' || !Number.isFinite(n[k])) errs.push(`card ${n.id}: ${k} is not a number`);
    if (n.type === 'text' && typeof n.text !== 'string') errs.push(`card ${n.id}: no text`);
    else if (n.type === 'file' && typeof n.file !== 'string') errs.push(`card ${n.id}: no file`);
    else if (n.type === 'link' && typeof n.url !== 'string') errs.push(`card ${n.id}: no url`);
    else if (!['text', 'file', 'link', 'group'].includes(n.type)) errs.push(`card ${n.id}: unknown type ${String(n.type)}`);
  }
  const eids = new Set<string>();
  for (const e of c.edges) {
    if (typeof e.id !== 'string' || !e.id) errs.push('an arrow has no id');
    else if (eids.has(e.id) || ids.has(e.id)) errs.push(`id ${e.id} is used twice`);
    eids.add(e.id);
    if (!ids.has(e.fromNode)) errs.push(`arrow ${e.id} starts at a missing card`);
    if (!ids.has(e.toNode)) errs.push(`arrow ${e.id} ends at a missing card`);
    if (e.fromSide && !SIDES.has(e.fromSide)) errs.push(`arrow ${e.id}: bad fromSide`);
    if (e.toSide && !SIDES.has(e.toSide)) errs.push(`arrow ${e.id}: bad toSide`);
  }
  return errs;
}

/** Writes the board the way vault tools do (tab-indented JSON), keeping every field. */
export function serializeCanvas(c: CanvasData): string {
  return JSON.stringify({ ...c, nodes: c.nodes, edges: c.edges }, null, '\t');
}

/** A 16-hex-digit id like the ones vault tools make. */
export function canvasId(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 16; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

export function addNode<T extends CanvasNode>(c: CanvasData, node: Omit<T, 'id'> & { id?: string }): CanvasData {
  return { ...c, nodes: [...c.nodes, { ...node, id: node.id ?? canvasId() } as unknown as CanvasNode] };
}

export function addEdge(c: CanvasData, from: string, to: string, extra: Partial<CanvasEdge> = {}): CanvasData {
  const a = c.nodes.find((n) => n.id === from), b = c.nodes.find((n) => n.id === to);
  const sides = a && b ? facingSides(a, b) : { fromSide: 'right' as Side, toSide: 'left' as Side };
  return { ...c, edges: [...c.edges, { id: canvasId(), fromNode: from, toNode: to, ...sides, ...extra }] };
}

/** Removes cards and the arrows touching them. */
export function removeNodes(c: CanvasData, ids: string[]): CanvasData {
  const gone = new Set(ids);
  return { ...c, nodes: c.nodes.filter((n) => !gone.has(n.id)), edges: c.edges.filter((e) => !gone.has(e.fromNode) && !gone.has(e.toNode) && !gone.has(e.id)) };
}

export function facingSides(a: NodeBase, b: NodeBase): { fromSide: Side; toSide: Side } {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

/** The point on a card's side where an arrow attaches. */
export function anchor(n: NodeBase, side: Side): { x: number; y: number } {
  if (side === 'top') return { x: n.x + n.width / 2, y: n.y };
  if (side === 'bottom') return { x: n.x + n.width / 2, y: n.y + n.height };
  if (side === 'left') return { x: n.x, y: n.y + n.height / 2 };
  return { x: n.x + n.width, y: n.y + n.height / 2 };
}

/** Preset colours 1–6 (red, orange, yellow, green, cyan, purple). */
export const CANVAS_COLORS: Record<string, string> = { '1': '#e93147', '2': '#ec7500', '3': '#e0ac00', '4': '#08b94e', '5': '#00bfbc', '6': '#7852ee' };
export const colorOf = (c?: string) => (c ? CANVAS_COLORS[c] ?? c : undefined);

/** Files a canvas shows (for backlinks and renames). */
export function canvasFiles(c: CanvasData): string[] {
  return c.nodes.filter((n): n is Extract<CanvasNode, { type: 'file' }> => n.type === 'file').map((n) => n.file);
}

/** Points file cards at a renamed file. */
export function renameInCanvas(c: CanvasData, from: string, to: string): CanvasData | null {
  let changed = false;
  const nodes = c.nodes.map((n) => {
    if (n.type === 'file' && n.file === from) { changed = true; return { ...n, file: to }; }
    if (n.type === 'group' && n.background === from) { changed = true; return { ...n, background: to }; }
    return n;
  });
  return changed ? { ...c, nodes } : null;
}
