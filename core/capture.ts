// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Pure helpers behind the screen tools: capture history, text clean-up,
// colour formats, the annotate editor's geometry and the beautify layout.

export type CaptureKind = 'text' | 'link' | 'qr' | 'barcode' | 'screenshot' | 'recording' | 'color';

export interface CaptureEntry {
  id: string;
  kind: CaptureKind;
  /** recognised text, decoded code, colour hex, or a saved file's path */
  value: string;
  /** barcode format (QR_CODE, EAN_13, …) */
  format?: string;
  /** small preview as a data URL */
  thumb?: string;
  /** saved file, for screenshots and recordings */
  path?: string;
  at: number;
}

export interface CaptureOptions {
  /** keep the line breaks of the original; off joins lines into paragraphs */
  keepLineBreaks: boolean;
  /** slower, more careful recognition */
  accurate: boolean;
  /** open links read from QR codes after a confirmation */
  openQrLinks: boolean;
  /** where screenshots go; empty = Pictures/Screenshots */
  screenshotFolder: string;
  /** where recordings go; empty = Movies (macOS) or Videos */
  recordingFolder: string;
  recordMic: boolean;
  recordSystemAudio: boolean;
  /** convert recordings to MP4 when finished */
  recordMp4: boolean;
  screenshotShortcut: string;
  recordShortcut: string;
  colorShortcut: string;
  /** after a screenshot, open it in the editor */
  annotateAfterScreenshot: boolean;
  /** work out the language of the text first (and read handwriting with the system's recognizer where there is one) */
  autoLanguage: boolean;
}

export function defaultCaptureOptions(): CaptureOptions {
  return {
    keepLineBreaks: true,
    accurate: true,
    openQrLinks: false,
    screenshotFolder: '',
    recordingFolder: '',
    recordMic: false,
    recordSystemAudio: false,
    recordMp4: true,
    screenshotShortcut: 'CommandOrControl+Alt+S',
    recordShortcut: 'CommandOrControl+Alt+R',
    colorShortcut: 'CommandOrControl+Alt+C',
    annotateAfterScreenshot: false,
    autoLanguage: true,
  };
}

export function mergeCaptureOptions(raw: unknown): CaptureOptions {
  const base = defaultCaptureOptions();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof CaptureOptions)[]) {
    if (typeof r[k] === typeof base[k]) (base as unknown as Record<string, unknown>)[k] = r[k];
  }
  return base;
}

// ---------------------------------------------------------------- history

export const HISTORY_MAX = 100;

export class CaptureHistory {
  items: CaptureEntry[] = [];
  constructor(public max = HISTORY_MAX) {}

  add(e: Omit<CaptureEntry, 'id' | 'at'> & { at?: number }): CaptureEntry | undefined {
    if (!e.value.trim()) return undefined;
    // The same value again moves to the top instead of repeating.
    this.items = this.items.filter((x) => !(x.kind === e.kind && x.value === e.value));
    const entry: CaptureEntry = { ...e, id: `${(e.at ?? Date.now()).toString(36)}${Math.random().toString(36).slice(2, 7)}`, at: e.at ?? Date.now() };
    this.items.unshift(entry);
    if (this.items.length > this.max) this.items.length = this.max;
    return entry;
  }

  remove(id: string) {
    this.items = this.items.filter((x) => x.id !== id);
  }

  clear() {
    this.items = [];
  }

  /** Tabs in the Captures screen. */
  filter(tab: 'all' | 'text' | 'links' | 'codes' | 'media'): CaptureEntry[] {
    switch (tab) {
      case 'text': return this.items.filter((x) => x.kind === 'text');
      case 'links': return this.items.filter((x) => x.kind === 'link' || ((x.kind === 'qr' || x.kind === 'barcode') && isHttpUrl(x.value)));
      case 'codes': return this.items.filter((x) => x.kind === 'qr' || x.kind === 'barcode');
      case 'media': return this.items.filter((x) => x.kind === 'screenshot' || x.kind === 'recording' || x.kind === 'color');
      default: return this.items;
    }
  }
}

export function isHttpUrl(s: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(s.trim());
}

/** What a recognised piece of text is: a link, or plain text. */
export function classifyText(text: string): 'link' | 'text' {
  return isHttpUrl(text) ? 'link' : 'text';
}

/**
 * Text recognition keeps every visual line break. For copying a paragraph
 * that is usually wrong, so lines are joined unless a blank line, a list
 * marker or a sentence end says the break is real. Hyphenated line ends are
 * re-joined ("infor-\nmation" -> "information").
 */
export function tidyText(text: string, keepLineBreaks: boolean): string {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (keepLineBreaks) return clean;
  return clean
    .split(/\n{2,}/)
    .map((para) =>
      para
        .split('\n')
        .reduce((acc, line, i, all) => {
          const l = line.trim();
          if (i === 0) return l;
          const prev = all[i - 1].trim();
          if (/^([-*•]|\d+[.)])\s/.test(l)) return `${acc}\n${l}`;
          if (/[a-z]-$/.test(prev) && /^[a-z]/.test(l)) return acc.slice(0, -1) + l;
          return `${acc} ${l}`;
        }, ''),
    )
    .join('\n\n');
}

// ---------------------------------------------------------------- colours

export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function toHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export interface PickedColor {
  hex: string;
  rgb: string;
  hsl: string;
}

export function describeColor(r: number, g: number, b: number): PickedColor {
  const { h, s, l } = toHsl(r, g, b);
  return { hex: toHex(r, g, b), rgb: `rgb(${r}, ${g}, ${b})`, hsl: `hsl(${h}, ${s}%, ${l}%)` };
}

// ---------------------------------------------------------------- annotate geometry

export interface Pt {
  x: number;
  y: number;
}

/** The two back corners of an arrow head at `to`, pointing away from `from`. */
export function arrowHead(from: Pt, to: Pt, size: number, spread = Math.PI / 7): [Pt, Pt] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

/** A rectangle from two corners in any order, clamped to the image. */
export function normRect(a: Pt, b: Pt, maxW = Infinity, maxH = Infinity): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(a.x, b.x));
  const y = Math.max(0, Math.min(a.y, b.y));
  const x2 = Math.min(maxW, Math.max(a.x, b.x));
  const y2 = Math.min(maxH, Math.max(a.y, b.y));
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** Averages blocks of pixels in place (RGBA), hiding what is underneath. */
export function pixelate(data: Uint8ClampedArray, width: number, height: number, block: number): void {
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ey = Math.min(height, by + block);
      const ex = Math.min(width, bx + block);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * width + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; n++;
      }
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * width + x) * 4;
        data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n; data[i + 3] = a / n;
      }
    }
  }
}

// ---------------------------------------------------------------- beautify

export interface BeautifyOptions {
  padding: number;
  radius: number;
  shadow: number;
  /** draw a window title bar above the image */
  frame: boolean;
  /** a preset id, or any colour as #rrggbb */
  background: string;
  /** widen or heighten the canvas to a shape for sharing (the picture stays centred) */
  aspect?: 'free' | '16:9' | '4:5' | '1:1';
}

export const FRAME_HEIGHT = 34;

export const BACKGROUNDS: { id: string; label: string; css: string; stops?: [string, string] }[] = [
  { id: 'none', label: 'None', css: 'transparent' },
  { id: 'dusk', label: 'Dusk', css: 'linear-gradient(135deg,#6d6dff,#ff6fa3)', stops: ['#6d6dff', '#ff6fa3'] },
  { id: 'ocean', label: 'Ocean', css: 'linear-gradient(135deg,#2bc0e4,#3b5bdb)', stops: ['#2bc0e4', '#3b5bdb'] },
  { id: 'mint', label: 'Mint', css: 'linear-gradient(135deg,#a8e063,#14b8a6)', stops: ['#a8e063', '#14b8a6'] },
  { id: 'sunset', label: 'Sunset', css: 'linear-gradient(135deg,#f9d423,#ff4e50)', stops: ['#f9d423', '#ff4e50'] },
  { id: 'graphite', label: 'Graphite', css: 'linear-gradient(135deg,#434343,#111111)', stops: ['#434343', '#111111'] },
  { id: 'white', label: 'White', css: '#ffffff' },
  { id: 'black', label: 'Black', css: '#000000' },
];

/** Canvas size and where the screenshot sits inside it. */
export function beautifyLayout(imgW: number, imgH: number, o: BeautifyOptions): { width: number; height: number; image: { x: number; y: number; w: number; h: number }; window: { x: number; y: number; w: number; h: number } } {
  const pad = Math.max(0, Math.round(o.padding));
  const frame = o.frame ? FRAME_HEIGHT : 0;
  let width = imgW + pad * 2;
  let height = imgH + frame + pad * 2;
  if (o.aspect && o.aspect !== 'free') {
    const [a, b] = o.aspect.split(':').map(Number);
    if (width / height > a / b) height = Math.round((width * b) / a);
    else width = Math.round((height * a) / b);
  }
  const x = Math.round((width - imgW) / 2);
  const y = Math.round((height - imgH - frame) / 2);
  const window = { x, y, w: imgW, h: imgH + frame };
  return { width, height, image: { x, y: y + frame, w: imgW, h: imgH }, window };
}

// ---------------------------------------------------------------- files

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

export function screenshotName(d = new Date()): string {
  return `Screenshot ${stamp(d)}.png`;
}

export function recordingName(d = new Date(), ext = 'webm'): string {
  return `Screen Recording ${stamp(d)}.${ext}`;
}

/** "photo.png" -> "photo (edited).png"; "photo (edited).png" -> "photo (edited 2).png" */
export function editedName(name: string, taken: (n: string) => boolean = () => false): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/ \(edited(?: \d+)?\)$/, '');
  for (let i = 1; i < 1000; i++) {
    const n = `${base} (edited${i > 1 ? ` ${i}` : ''}).png`;
    if (!taken(n)) return n;
  }
  return `${base} (edited ${Date.now()}).png`;
}
