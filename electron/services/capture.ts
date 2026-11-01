// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Screen tools: copy text (and QR codes / barcodes) from any area of the
// screen, take screenshots of the screen, a window or an area, and pick a
// colour from anywhere. The screen is frozen under a full-screen overlay so the
// user can choose calmly; nothing leaves the computer.

import { app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import type { CaptureResult } from '../../core/api';
import { decodeCode } from '../../core/codes';
import { CaptureHistory, describeColor, mergeCaptureOptions, screenshotName, tidyText, type CaptureEntry, type CaptureOptions, type PickedColor } from '../../core/capture';
import { uniqueName } from '../../core/rules';
import { readImage as readClipboardImage, writeText } from './clip';
import { loadImage, ocrImage, ocrImageAuto, ocrTuned } from './vision';
import { permissionNeeded } from './permission-nudge';

export type Rect = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------- options & history

const optionsFile = () => path.join(app.getPath('userData'), 'capture-options.json');
const historyFile = () => path.join(app.getPath('userData'), 'captures.json');

let options: CaptureOptions | null = null;
export const history = new CaptureHistory();
let historyLoaded = false;

export async function getOptions(): Promise<CaptureOptions> {
  if (options) return options;
  try {
    options = mergeCaptureOptions(JSON.parse(await fsp.readFile(optionsFile(), 'utf8')));
  } catch {
    options = mergeCaptureOptions(null);
  }
  return options;
}

export async function setOptions(patch: Partial<CaptureOptions>): Promise<CaptureOptions> {
  options = mergeCaptureOptions({ ...(await getOptions()), ...patch });
  await fsp.mkdir(path.dirname(optionsFile()), { recursive: true });
  await fsp.writeFile(optionsFile(), JSON.stringify(options, null, 2));
  return options;
}

export async function loadHistory(): Promise<CaptureEntry[]> {
  if (!historyLoaded) {
    historyLoaded = true;
    try {
      const raw = JSON.parse(await fsp.readFile(historyFile(), 'utf8'));
      if (Array.isArray(raw)) history.items = raw.filter((x) => x && typeof x.id === 'string').slice(0, history.max);
    } catch {
      /* first run */
    }
  }
  return history.items;
}

let saveTimer: NodeJS.Timeout | undefined;
export function saveHistory() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void fsp.writeFile(historyFile(), JSON.stringify(history.items)).catch(() => undefined), 300);
}

export async function remember(e: Omit<CaptureEntry, 'id' | 'at'>): Promise<CaptureEntry | undefined> {
  await loadHistory();
  const entry = history.add(e);
  saveHistory();
  return entry;
}

// ---------------------------------------------------------------- the frozen screen

async function grabDisplay(display: Electron.Display): Promise<Electron.NativeImage> {
  const { width, height } = display.size;
  const scale = display.scaleFactor;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } });
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!src || src.thumbnail.isEmpty()) {
    if (process.platform === 'darwin') permissionNeeded('screen', 'capture');
  }
  if (!src || src.thumbnail.isEmpty()) throw new Error('Keeper needs permission to see the screen (on macOS: System Settings → Privacy & Security → Screen Recording).');
  return src.thumbnail;
}

export function displayUnderCursor(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

const BASE_CSS = `html,body{margin:0;height:100%;overflow:hidden;user-select:none;font:13px -apple-system,'Segoe UI',system-ui,sans-serif}
#tip{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:rgba(20,20,24,.88);color:#fff;padding:7px 13px;border-radius:9px;z-index:9;pointer-events:none}`;

const AREA_PAGE = (img: string, tip: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
body{cursor:crosshair;background:url(${img}) 0 0/100% 100% no-repeat}
#shade{position:fixed;inset:0;background:rgba(0,0,0,.35)}
#sel{position:fixed;border:1.5px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.35);display:none}
#size{position:fixed;background:rgba(20,20,24,.88);color:#fff;font-size:11px;padding:2px 6px;border-radius:5px;display:none}
</style></head><body><div id="shade"></div><div id="sel"></div><div id="size"></div><div id="tip">${tip} · Esc to cancel</div><script>
let sx,sy,dragging=false;const sel=document.getElementById('sel'),shade=document.getElementById('shade'),size=document.getElementById('size');
addEventListener('mousedown',e=>{sx=e.clientX;sy=e.clientY;dragging=true;shade.style.display='none';sel.style.display='block';size.style.display='block';draw(e)});
addEventListener('mousemove',e=>dragging&&draw(e));
addEventListener('mouseup',e=>{if(!dragging)return;dragging=false;const r=rect(e);keeperCapture.done(r.w<6||r.h<6?null:r)});
addEventListener('keydown',e=>{if(e.key==='Escape')keeperCapture.done(null)});
function rect(e){return{x:Math.min(sx,e.clientX),y:Math.min(sy,e.clientY),w:Math.abs(e.clientX-sx),h:Math.abs(e.clientY-sy)}}
function draw(e){const r=rect(e);Object.assign(sel.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});size.textContent=Math.round(r.w*devicePixelRatio)+' × '+Math.round(r.h*devicePixelRatio);Object.assign(size.style,{left:r.x+'px',top:Math.max(0,r.y-22)+'px'})}
</script></body></html>`;

const COLOR_PAGE = (img: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
body{cursor:none;background:url(${img}) 0 0/100% 100% no-repeat}
#loupe{position:fixed;width:132px;height:132px;border-radius:50%;border:3px solid #fff;box-shadow:0 4px 18px rgba(0,0,0,.45);overflow:hidden;pointer-events:none}
#loupe canvas{width:132px;height:132px;image-rendering:pixelated}
#label{position:fixed;background:rgba(20,20,24,.9);color:#fff;font:12px ui-monospace,monospace;padding:3px 7px;border-radius:6px;pointer-events:none;display:flex;gap:6px;align-items:center}
#sw{width:12px;height:12px;border-radius:3px;border:1px solid #fff8}
</style></head><body><div id="tip">Click to pick a colour · Esc to cancel</div><div id="loupe"><canvas id="c" width="11" height="11"></canvas></div><div id="label"><span id="sw"></span><span id="hex"></span></div><script>
const img=new Image();img.src=${JSON.stringify(img)};const full=document.createElement('canvas');let ctx;
img.onload=()=>{full.width=img.width;full.height=img.height;ctx=full.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0)};
const c=document.getElementById('c').getContext('2d');c.imageSmoothingEnabled=false;
const loupe=document.getElementById('loupe'),label=document.getElementById('label'),hex=document.getElementById('hex'),sw=document.getElementById('sw');
function px(e){const sx=img.width/innerWidth,sy=img.height/innerHeight;return{x:Math.floor(e.clientX*sx),y:Math.floor(e.clientY*sy)}}
addEventListener('mousemove',e=>{if(!ctx)return;const p=px(e);c.clearRect(0,0,11,11);c.drawImage(full,p.x-5,p.y-5,11,11,0,0,11,11);c.strokeStyle='#fff';c.lineWidth=.15;c.strokeRect(5,5,1,1);
const d=ctx.getImageData(p.x,p.y,1,1).data;const h='#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');hex.textContent=h;sw.style.background=h;
Object.assign(loupe.style,{left:(e.clientX-66)+'px',top:(e.clientY-66)+'px'});Object.assign(label.style,{left:(e.clientX+74)+'px',top:(e.clientY+40)+'px'})});
addEventListener('mousedown',e=>{if(!ctx)return;const p=px(e);const d=ctx.getImageData(p.x,p.y,1,1).data;keeperCapture.done({r:d[0],g:d[1],b:d[2]})});
addEventListener('keydown',e=>{if(e.key==='Escape')keeperCapture.done(null)});
</script></body></html>`;

const WINDOW_PAGE = (items: { id: string; name: string; thumb: string }[]) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
body{background:rgba(12,12,16,.94);color:#fff;overflow:auto}
h1{font-size:18px;font-weight:600;margin:64px 0 18px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px;padding:0 48px 48px}
button{all:unset;cursor:pointer;border-radius:12px;padding:10px;background:rgba(255,255,255,.06);display:flex;flex-direction:column;gap:8px}
button:hover,button:focus{background:rgba(130,130,255,.35)}
img{width:100%;aspect-ratio:16/10;object-fit:contain;background:#000;border-radius:8px}
span{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head><body><h1>Choose a window</h1><div class="grid">${items
  .map((w) => `<button data-id="${w.id.replace(/"/g, '')}"><img src="${w.thumb}"><span>${w.name.replace(/[<>&]/g, '')}</span></button>`)
  .join('')}</div><script>
document.querySelectorAll('button').forEach(b=>b.onclick=()=>keeperCapture.done(b.dataset.id));
addEventListener('keydown',e=>{if(e.key==='Escape')keeperCapture.done(null)});
</script></body></html>`;

let overlayBusy = false;

/** Shows a page over the whole display and waits for it to report a choice. */
async function overlay<T>(display: Electron.Display, html: string, preload: string): Promise<T | null> {
  if (overlayBusy) return null;
  overlayBusy = true;
  const win = new BrowserWindow({
    x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height,
    frame: false, transparent: false, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, resizable: false, movable: false,
    hasShadow: false, enableLargerThanScreen: true, show: false, backgroundColor: '#000000',
    webPreferences: { preload, contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  try {
    return await new Promise<T | null>((resolve) => {
      const onDone = (e: Electron.IpcMainEvent, r: T | null) => {
        if (e.sender !== win.webContents) return;
        ipcMain.removeListener('capture.done', onDone);
        resolve(r);
      };
      ipcMain.on('capture.done', onDone);
      win.on('closed', () => {
        ipcMain.removeListener('capture.done', onDone);
        resolve(null);
      });
      void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
        win.show();
        win.focus();
        overlayReady?.(win);
      });
    });
  } finally {
    overlayBusy = false;
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Test hook: lets automated tests drive the overlay once it is on screen. */
let overlayReady: ((w: BrowserWindow) => void) | undefined;
export function onOverlayReady(fn: ((w: BrowserWindow) => void) | undefined) {
  overlayReady = fn;
}

function crop(shot: Electron.NativeImage, display: Electron.Display, r: Rect): Electron.NativeImage {
  const sx = shot.getSize().width / display.bounds.width;
  const sy = shot.getSize().height / display.bounds.height;
  return shot.crop({ x: Math.round(r.x * sx), y: Math.round(r.y * sy), width: Math.max(1, Math.round(r.w * sx)), height: Math.max(1, Math.round(r.h * sy)) });
}

/** Lets the user drag a rectangle on the frozen screen. Returns the crop and the rectangle in screen pixels. */
export async function pickArea(preload: string, tip: string): Promise<{ image: Electron.NativeImage; rect: Rect; display: Electron.Display; scale: number } | null> {
  const display = displayUnderCursor();
  const shot = await grabDisplay(display);
  const r = await overlay<Rect>(display, AREA_PAGE(shot.toDataURL(), tip), preload);
  if (!r) return null;
  const scale = shot.getSize().width / display.bounds.width;
  return { image: crop(shot, display, r), rect: r, display, scale };
}

export async function pickWindow(preload: string): Promise<{ id: string; name: string; image: Electron.NativeImage } | null> {
  const display = displayUnderCursor();
  const big = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
  const sources = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: big, fetchWindowIcons: false }))
    .filter((s) => !s.thumbnail.isEmpty() && s.name && !/^Keeper( Island)?$/.test(s.name));
  if (!sources.length) throw new Error('No windows to capture were found.');
  const items = sources.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.resize({ width: 480 }).toDataURL() }));
  const id = await overlay<string>(display, WINDOW_PAGE(items), preload);
  const chosen = sources.find((s) => s.id === id);
  return chosen ? { id: chosen.id, name: chosen.name, image: chosen.thumbnail } : null;
}

// ---------------------------------------------------------------- reading text and codes

function decodeBarcode(img: Electron.NativeImage) {
  const { width, height } = img.getSize();
  return decodeCode(img.toBitmap(), width, height, true);
}

/** Text, QR code and barcode from any image, cleaned up the way the user prefers. */
export async function readImage(img: Electron.NativeImage, langs: string[], o?: CaptureOptions): Promise<CaptureResult> {
  const opts = o ?? (await getOptions());
  const { width, height } = img.getSize();
  const code = decodeBarcode(img);
  // Careful mode scales small crops up (Tesseract reads ~30 px letters best); fast mode scales big ones down.
  const longest = Math.max(width, height);
  const factor = opts.accurate ? (longest < 1200 ? Math.min(3, 1800 / Math.max(1, longest)) : 1) : longest > 1400 ? 1400 / longest : 1;
  const scaled = factor !== 1 ? img.resize({ width: Math.round(width * factor), height: Math.round(height * factor), quality: 'best' }) : img;
  // The reader chosen in Capture options (system recognizer, cleaned picture, layout), else the usual read.
  const tuned = await ocrTuned(scaled, langs, { engine: opts.ocrEngine, layout: opts.ocrLayout, enhance: opts.ocrEnhance, handwriting: opts.handwriting, keepSpaces: opts.keepLineBreaks, autoLanguage: opts.autoLanguage }).catch(() => undefined);
  const raw = tuned ?? (opts.autoLanguage ? (await ocrImageAuto(scaled, langs)).text : await ocrImage(scaled, langs));
  const text = tidyText(raw, opts.keepLineBreaks);
  return { text, code: code?.value, codeFormat: code?.format, image: (longest > 480 ? img.resize(width >= height ? { width: 480 } : { height: 480 }) : img).toDataURL() };
}

async function rememberResult(r: CaptureResult) {
  if (r.code) await remember({ kind: r.codeFormat === 'QR_CODE' ? 'qr' : 'barcode', value: r.code, format: r.codeFormat, thumb: r.image });
  if (r.text) await remember({ kind: /^https?:\/\/\S+$/i.test(r.text.trim()) ? 'link' : 'text', value: r.text, thumb: r.image });
}

/** Drag over an area; its text (or code) goes to the clipboard and the history. */
export async function captureText(preload: string, langs: string[]): Promise<CaptureResult | null> {
  const picked = await pickArea(preload, 'Drag over the text to copy');
  if (!picked) return null;
  const r = await readImage(picked.image, langs);
  const out = r.code && !r.text ? r.code : r.text;
  if (out) await writeText(out);
  await rememberResult(r);
  return r;
}

export async function clipboardImage(langs: string[]): Promise<CaptureResult | null> {
  const img = await readClipboardImage();
  if (!img) return null;
  const r = await readImage(img, langs);
  await rememberResult(r);
  return r;
}

/** Text from an image or PDF file on disk. */
export async function readFile(p: string, langs: string[]): Promise<CaptureResult> {
  if (/\.pdf$/i.test(p)) {
    const text = await pdfText(p);
    if (text.trim()) {
      const r: CaptureResult = { text: tidyText(text, (await getOptions()).keepLineBreaks) };
      await rememberResult(r);
      return r;
    }
    // A scanned PDF has no text layer: read the first page through the OS preview.
  }
  const img = await loadImage(p, 3000);
  if (!img) throw new Error('This file cannot be read as an image.');
  const r = await readImage(img, langs);
  await rememberResult(r);
  return r;
}

/** The text layer of a PDF (all pages). */
export async function pdfText(p: string, maxPages = 200): Promise<string> {
  // A real dynamic import: pdf.js ships as an ES module and is kept outside the bundle.
  const load = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
  const pdfjs = (await load('pdfjs-dist/legacy/build/pdf.mjs')) as {
    getDocument(o: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; disableFontFace?: boolean }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }> }> }> };
  };
  const data = new Uint8Array(await fsp.readFile(p));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').trim());
  }
  return pages.join('\n\n');
}

// ---------------------------------------------------------------- screenshots

export async function screenshotFolder(): Promise<string> {
  const o = await getOptions();
  const dir = o.screenshotFolder || path.join(app.getPath('pictures'), 'Screenshots');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export async function saveScreenshot(img: Electron.NativeImage): Promise<string> {
  const dir = await screenshotFolder();
  const p = uniqueName(path.join(dir, screenshotName()), existsSync);
  await fsp.writeFile(p, img.toPNG());
  await remember({ kind: 'screenshot', value: path.basename(p), path: p, thumb: img.resize({ width: 320 }).toDataURL() });
  return p;
}

export type ScreenshotMode = 'full' | 'window' | 'area';

export async function takeScreenshot(mode: ScreenshotMode, preload: string): Promise<string | null> {
  let img: Electron.NativeImage | null = null;
  if (mode === 'full') img = await grabDisplay(displayUnderCursor());
  else if (mode === 'area') img = (await pickArea(preload, 'Drag over the area to capture'))?.image ?? null;
  else img = (await pickWindow(preload))?.image ?? null;
  if (!img || img.isEmpty()) return null;
  return saveScreenshot(img);
}

// ---------------------------------------------------------------- colour picker

export async function pickColor(preload: string): Promise<PickedColor | null> {
  const display = displayUnderCursor();
  const shot = await grabDisplay(display);
  const c = await overlay<{ r: number; g: number; b: number }>(display, COLOR_PAGE(shot.toDataURL()), preload);
  if (!c) return null;
  const color = describeColor(c.r, c.g, c.b);
  await writeText(color.hex);
  await remember({ kind: 'color', value: color.hex });
  return color;
}

export function colorHistory(): string[] {
  return history.items.filter((x) => x.kind === 'color').slice(0, 20).map((x) => x.value);
}

/** A PNG data URL from the editor, or for copying. */
export function imageFromDataUrl(dataUrl: string): Electron.NativeImage {
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) throw new Error('Not an image');
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) throw new Error('The image is empty');
  return img;
}
