// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// DXF drawings (the open CAD exchange format) read into lines, arcs, circles,
// polylines and text, and drawn as SVG for previews and conversion.

export type Shape =
  | { type: 'line'; layer: string; color?: number; x1: number; y1: number; x2: number; y2: number }
  | { type: 'circle'; layer: string; color?: number; cx: number; cy: number; r: number }
  | { type: 'arc'; layer: string; color?: number; cx: number; cy: number; r: number; a1: number; a2: number }
  | { type: 'ellipse'; layer: string; color?: number; cx: number; cy: number; mx: number; my: number; ratio: number; a1: number; a2: number }
  | { type: 'poly'; layer: string; color?: number; points: [number, number][]; closed: boolean }
  | { type: 'text'; layer: string; color?: number; x: number; y: number; h: number; text: string; rot: number }
  | { type: 'point'; layer: string; color?: number; x: number; y: number };

export interface Drawing { shapes: Shape[]; layers: Record<string, number>; bounds: { minX: number; minY: number; maxX: number; maxY: number }; units?: string; skipped: Record<string, number> }

/** The AutoCAD colour index's first colours (others map to grey). */
const ACI: Record<number, string> = { 1: '#e53935', 2: '#fdd835', 3: '#43a047', 4: '#00acc1', 5: '#1e88e5', 6: '#d81b60', 8: '#808080', 9: '#c0c0c0' };

const UNITS: Record<number, string> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

export function parseDxf(text: string): Drawing {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([Number(raw[i].trim()), raw[i + 1].trim()]);
  const shapes: Shape[] = [];
  const layers: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  let units: string | undefined;
  let section = '';
  let i = 0;
  // Blocks are drawn where INSERT places them.
  const blocks = new Map<string, Shape[]>();
  let blockName = '';
  let blockShapes: Shape[] | null = null;
  const take = (start: number) => {
    const g: Record<number, string[]> = {};
    let j = start + 1;
    while (j < pairs.length && pairs[j][0] !== 0) { (g[pairs[j][0]] ??= []).push(pairs[j][1]); j++; }
    return { g, next: j };
  };
  const num = (g: Record<number, string[]>, c: number, d = 0, k = 0) => (g[c]?.[k] !== undefined ? Number(g[c][k]) : d);
  let poly: (Shape & { type: 'poly' }) | null = null;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code !== 0) { i++; continue; }
    const { g, next } = take(i);
    i = next;
    if (val === 'SECTION') { section = g[2]?.[0] ?? ''; continue; }
    if (val === 'ENDSEC') { section = ''; continue; }
    if (section === 'HEADER') continue;
    if (section === 'TABLES') { if (val === 'LAYER' && g[2]) layers[g[2][0]] = Math.abs(num(g, 62, 7)); continue; }
    if (val === 'BLOCK') { blockName = g[2]?.[0] ?? ''; blockShapes = []; continue; }
    if (val === 'ENDBLK') { if (blockShapes) blocks.set(blockName, blockShapes); blockShapes = null; continue; }
    const target = blockShapes ?? shapes;
    const layer = g[8]?.[0] ?? '0';
    const color = g[62] ? Math.abs(num(g, 62)) : undefined;
    const base = { layer, color };
    switch (val) {
      case 'LINE': target.push({ type: 'line', ...base, x1: num(g, 10), y1: num(g, 20), x2: num(g, 11), y2: num(g, 21) }); break;
      case 'CIRCLE': target.push({ type: 'circle', ...base, cx: num(g, 10), cy: num(g, 20), r: num(g, 40) }); break;
      case 'ARC': target.push({ type: 'arc', ...base, cx: num(g, 10), cy: num(g, 20), r: num(g, 40), a1: num(g, 50), a2: num(g, 51) }); break;
      case 'ELLIPSE': target.push({ type: 'ellipse', ...base, cx: num(g, 10), cy: num(g, 20), mx: num(g, 11), my: num(g, 21), ratio: num(g, 40, 1), a1: num(g, 41), a2: num(g, 42, Math.PI * 2) }); break;
      case 'POINT': target.push({ type: 'point', ...base, x: num(g, 10), y: num(g, 20) }); break;
      case 'LWPOLYLINE': {
        const xs = g[10] ?? [];
        const ys = g[20] ?? [];
        target.push({ type: 'poly', ...base, points: xs.map((x, k) => [Number(x), Number(ys[k] ?? 0)]), closed: (num(g, 70) & 1) === 1 });
        break;
      }
      case 'POLYLINE': poly = { type: 'poly', ...base, points: [], closed: (num(g, 70) & 1) === 1 }; break;
      case 'VERTEX': if (poly) poly.points.push([num(g, 10), num(g, 20)]); break;
      case 'SEQEND': if (poly) { target.push(poly); poly = null; } break;
      case 'SPLINE': {
        // Drawn through its fit points, or its control points as a close approximation.
        const xs = g[11] ?? g[10] ?? [];
        const ys = g[21] ?? g[20] ?? [];
        target.push({ type: 'poly', ...base, points: xs.map((x, k) => [Number(x), Number(ys[k] ?? 0)]), closed: (num(g, 70) & 1) === 1 });
        break;
      }
      case 'TEXT': case 'MTEXT': case 'ATTRIB': {
        const t = [...(g[3] ?? []), ...(g[1] ?? [])].join('').replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;]*;/g, '').replace(/[{}]/g, '');
        target.push({ type: 'text', ...base, x: num(g, 10), y: num(g, 20), h: num(g, 40, 2.5), text: t, rot: num(g, 50) });
        break;
      }
      case 'INSERT': {
        const b = blocks.get(g[2]?.[0] ?? '');
        if (!b) break;
        const ox = num(g, 10); const oy = num(g, 20); const sx = num(g, 41, 1); const sy = num(g, 42, 1); const rot = (num(g, 50) * Math.PI) / 180;
        const tf = (x: number, y: number): [number, number] => [ox + x * sx * Math.cos(rot) - y * sy * Math.sin(rot), oy + x * sx * Math.sin(rot) + y * sy * Math.cos(rot)];
        for (const s of b) target.push(transform(s, tf, Math.abs(sx), (rot * 180) / Math.PI));
        break;
      }
      case 'HATCH': case 'DIMENSION': case 'SOLID': case '3DFACE': case 'VIEWPORT': case 'LEADER': case 'MLINE': case 'IMAGE':
        skipped[val] = (skipped[val] ?? 0) + 1; break;
      default: break;
    }
  }
  if (/\$INSUNITS/.test(text)) {
    const at = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
    if (at >= 0) units = UNITS[Number(pairs[at + 1]?.[1])];
  }
  return { shapes, layers, bounds: bounds(shapes), units, skipped };
}

function transform(s: Shape, tf: (x: number, y: number) => [number, number], scale: number, rotDeg: number): Shape {
  switch (s.type) {
    case 'line': { const [x1, y1] = tf(s.x1, s.y1); const [x2, y2] = tf(s.x2, s.y2); return { ...s, x1, y1, x2, y2 }; }
    case 'circle': { const [cx, cy] = tf(s.cx, s.cy); return { ...s, cx, cy, r: s.r * scale }; }
    case 'arc': { const [cx, cy] = tf(s.cx, s.cy); return { ...s, cx, cy, r: s.r * scale, a1: s.a1 + rotDeg, a2: s.a2 + rotDeg }; }
    case 'ellipse': { const [cx, cy] = tf(s.cx, s.cy); return { ...s, cx, cy, mx: s.mx * scale, my: s.my * scale }; }
    case 'poly': return { ...s, points: s.points.map(([x, y]) => tf(x, y)) };
    case 'text': { const [x, y] = tf(s.x, s.y); return { ...s, x, y, h: s.h * scale, rot: s.rot + rotDeg }; }
    case 'point': { const [x, y] = tf(s.x, s.y); return { ...s, x, y }; }
  }
}

function bounds(shapes: Shape[]) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const add = (x: number, y: number) => { if (!Number.isFinite(x) || !Number.isFinite(y)) return; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const s of shapes) {
    switch (s.type) {
      case 'line': add(s.x1, s.y1); add(s.x2, s.y2); break;
      case 'circle': case 'arc': add(s.cx - s.r, s.cy - s.r); add(s.cx + s.r, s.cy + s.r); break;
      case 'ellipse': { const r = Math.hypot(s.mx, s.my); add(s.cx - r, s.cy - r); add(s.cx + r, s.cy + r); break; }
      case 'poly': for (const [x, y] of s.points) add(x, y); break;
      case 'text': add(s.x, s.y); add(s.x + s.h * s.text.length * 0.6, s.y + s.h); break;
      case 'point': add(s.x, s.y); break;
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The drawing as SVG, flipped so +Y is up as in CAD, lines a constant hairline width. */
export function dxfToSvg(d: Drawing, o: { background?: string; stroke?: string; hidden?: string[] } = {}): string {
  const { minX, minY, maxX, maxY } = d.bounds;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const pad = Math.max(w, h) * 0.03;
  const hidden = new Set(o.hidden ?? []);
  const sw = Math.max(w, h) / 900;
  const colorOf = (s: Shape) => {
    const c = s.color ?? d.layers[s.layer];
    return c && c !== 7 && ACI[c] ? ACI[c] : o.stroke ?? 'currentColor';
  };
  const Y = (y: number) => maxY + minY - y;
  const parts: string[] = [];
  for (const s of d.shapes) {
    if (hidden.has(s.layer)) continue;
    const c = colorOf(s);
    switch (s.type) {
      case 'line': parts.push(`<line x1="${s.x1}" y1="${Y(s.y1)}" x2="${s.x2}" y2="${Y(s.y2)}" stroke="${c}"/>`); break;
      case 'circle': parts.push(`<circle cx="${s.cx}" cy="${Y(s.cy)}" r="${s.r}" stroke="${c}"/>`); break;
      case 'arc': {
        const a1 = (s.a1 * Math.PI) / 180;
        let a2 = (s.a2 * Math.PI) / 180;
        if (a2 <= a1) a2 += Math.PI * 2;
        const large = a2 - a1 > Math.PI ? 1 : 0;
        parts.push(`<path d="M${s.cx + s.r * Math.cos(a1)} ${Y(s.cy + s.r * Math.sin(a1))} A${s.r} ${s.r} 0 ${large} 0 ${s.cx + s.r * Math.cos(a2)} ${Y(s.cy + s.r * Math.sin(a2))}" stroke="${c}"/>`);
        break;
      }
      case 'ellipse': {
        const rx = Math.hypot(s.mx, s.my);
        const ang = (Math.atan2(s.my, s.mx) * 180) / Math.PI;
        parts.push(`<ellipse cx="${s.cx}" cy="${Y(s.cy)}" rx="${rx}" ry="${rx * s.ratio}" transform="rotate(${-ang} ${s.cx} ${Y(s.cy)})" stroke="${c}"/>`);
        break;
      }
      case 'poly': if (s.points.length > 1) parts.push(`<${s.closed ? 'polygon' : 'polyline'} points="${s.points.map(([x, y]) => `${x},${Y(y)}`).join(' ')}" stroke="${c}"/>`); break;
      case 'text': parts.push(`<text x="${s.x}" y="${Y(s.y)}" font-size="${s.h}" fill="${c}" stroke="none"${s.rot ? ` transform="rotate(${-s.rot} ${s.x} ${Y(s.y)})"` : ''}>${esc(s.text)}</text>`); break;
      case 'point': parts.push(`<circle cx="${s.x}" cy="${Y(s.y)}" r="${sw * 1.5}" fill="${c}"/>`); break;
    }
  }
  const vb = `${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${Math.round(Math.min(2000, 1200 * (w / Math.max(w, h))))}" height="${Math.round(Math.min(2000, 1200 * (h / Math.max(w, h))))}">${o.background ? `<rect x="${minX - pad}" y="${minY - pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" fill="${o.background}"/>` : ''}<g fill="none" stroke-width="${sw}" vector-effect="non-scaling-stroke" font-family="sans-serif">${parts.join('')}</g></svg>`;
}

/** A tiny DXF writer (lines and circles), used to make test drawings and from SVG exports. */
export function writeDxf(shapes: Shape[]): string {
  const out: (string | number)[] = [0, 'SECTION', 2, 'ENTITIES'];
  for (const s of shapes) {
    if (s.type === 'line') out.push(0, 'LINE', 8, s.layer, 10, s.x1, 20, s.y1, 30, 0, 11, s.x2, 21, s.y2, 31, 0);
    else if (s.type === 'circle') out.push(0, 'CIRCLE', 8, s.layer, 10, s.cx, 20, s.cy, 30, 0, 40, s.r);
    else if (s.type === 'arc') out.push(0, 'ARC', 8, s.layer, 10, s.cx, 20, s.cy, 30, 0, 40, s.r, 50, s.a1, 51, s.a2);
    else if (s.type === 'poly') { out.push(0, 'LWPOLYLINE', 8, s.layer, 90, s.points.length, 70, s.closed ? 1 : 0); for (const [x, y] of s.points) out.push(10, x, 20, y); }
    else if (s.type === 'text') out.push(0, 'TEXT', 8, s.layer, 10, s.x, 20, s.y, 30, 0, 40, s.h, 1, s.text);
  }
  out.push(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}
