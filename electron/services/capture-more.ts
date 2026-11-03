// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Capture's extras: a scrolling capture (Keeper scrolls the chosen part step
// by step and stitches the frames where they overlap), pictures pinned on top
// of everything (opacity, see-through for clicks, a close key), and the small
// preview after each screenshot (drag it out, Annotate, Copy, Save, Upload,
// Pin; several stack). Nothing here runs or exists until it is used.

import { BrowserWindow, dialog, globalShortcut, nativeImage, screen } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { findScroll, opacityForKey, pinOpacity, pinSize, previewBounds, previewStack, stitch, wheelSteps, type Bitmap, type ScrollMatch } from '../../core/capture-extras';
import { crop, grabDisplay, pickArea, type Rect } from './capture';
import { writeImage } from './clip';
import { onFloat } from './floats';
import { keepUnmanaged, overlayOptions } from './unmanaged';

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const page = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`;
const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif`;

function bitmapOf(img: Electron.NativeImage): Bitmap {
  const { width, height } = img.getSize();
  return { data: new Uint8Array(img.toBitmap()), width, height };
}

function imageOf(b: Bitmap): Electron.NativeImage {
  return nativeImage.createFromBitmap(Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength), { width: b.width, height: b.height, scaleFactor: 1 });
}

// ---------------------------------------------------------------- scrolling capture

let stopAsked = false;
let scrolling = false;

/** Stops a scrolling capture; what was taken so far is kept. */
export function stopScrolling(): boolean {
  if (!scrolling) return false;
  stopAsked = true;
  return true;
}

export function isScrolling(): boolean {
  return scrolling;
}

const BAR_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">${CSP}<title>Scrolling capture</title><style>
html,body{margin:0;height:100%;overflow:hidden;background:#18181c;color:#fff;font:600 13px ${FONT};user-select:none}
body{display:flex;align-items:center;gap:10px;padding:0 8px 0 14px;box-sizing:border-box;border-radius:12px}
.dot{width:10px;height:10px;border-radius:50%;background:#ff453a;animation:p 1s infinite alternate}@keyframes p{to{opacity:.35}}
span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{all:unset;padding:6px 12px;border-radius:8px;background:#fff;color:#111;cursor:pointer}
button:focus-visible{outline:2px solid #8ab4ff;outline-offset:2px}
</style></head><body><i class="dot" aria-hidden="true"></i><span id="t" role="status" aria-live="polite">Scrolling… 1 screen</span><button id="s" type="button">Stop (Esc)</button>
<script>document.getElementById('s').onclick=function(){keeperFloat.act('stop')};window.bar={n:function(n){document.getElementById('t').textContent='Scrolling… '+n+' screen'+(n===1?'':'s')}};</script></body></html>`;

/** The Stop bar, just outside the captured part (above or below it) so it never lands in the picture. */
async function stopBar(display: Electron.Display, r: Rect, preload: string): Promise<BrowserWindow> {
  const w = 280;
  const h = 44;
  const b = display.bounds;
  const below = r.y + r.h + 10 + h <= b.height;
  const above = r.y - 10 - h >= 0;
  const y = below ? r.y + r.h + 10 : above ? r.y - 10 - h : 8;
  const x = Math.max(8, Math.min(b.width - w - 8, r.x + r.w / 2 - w / 2));
  const win = new BrowserWindow({
    ...overlayOptions('scrollBar'),
    x: b.x + Math.round(x), y: b.y + Math.round(y), width: w, height: h, frame: false, resizable: false, movable: false, focusable: false,
    alwaysOnTop: true, show: false, hasShadow: true, backgroundColor: '#18181c', roundedCorners: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true, spellcheck: false },
  });
  keepUnmanaged(win, 'scrollBar');
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true);
  onFloat(win, (a) => { if (a === 'stop') stopScrolling(); });
  await win.loadURL(page(BAR_PAGE)).catch(() => undefined);
  win.showInactive();
  return win;
}

/**
 * Keeper scrolls the chosen part of a window one step at a time (the same
 * pointer and wheel events remote control uses) and stitches the frames where
 * they overlap, until the page stops moving, Stop or Esc is pressed, or the
 * picture is 30,000 pixels tall.
 */
export async function scrollingCapture(preload: string): Promise<Electron.NativeImage | null> {
  if (scrolling) return null;
  const { injector } = await import('./screen/injector');
  const inj = injector();
  const st = await inj.status();
  if (!st.available) throw new Error(`Scrolling capture scrolls the page for you, which is not possible here: ${st.reason ?? 'this system does not let apps scroll other windows.'}`);
  const picked = await pickArea(preload, 'Drag over the part of the window that scrolls');
  if (!picked) return null;
  const { display, rect } = picked;
  const host = { id: String(display.id), label: '', x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height, scale: display.scaleFactor, primary: false };
  const at = { x: (rect.x + rect.w / 2) / display.bounds.width, y: (rect.y + rect.h / 2) / display.bounds.height };
  const wheel = (dy: number) => inj.send([{ t: 'move', x: at.x, y: at.y }, { t: 'wheel', x: at.x, y: at.y, dx: 0, dy }], host);
  scrolling = true;
  stopAsked = false;
  const esc = (() => { try { return globalShortcut.register('Escape', () => stopScrolling()); } catch { return false; } })();
  let bar: BrowserWindow | null = null;
  try {
    bar = await stopBar(display, rect, preload);
    await wait(250);
    const grab = async () => bitmapOf(crop(await grabDisplay(display), display, rect));
    const frames: Bitmap[] = [await grab()];
    const matches: ScrollMatch[] = [];
    let steps = wheelSteps(rect.h);
    let still = 0;
    let height = frames[0].height;
    const scrollHook = scrollTestHook;
    while (!stopAsked && frames.length < 60 && height < 30_000) {
      if (scrollHook) await scrollHook(steps); else wheel(steps);
      await wait(500);
      let next = await grab();
      let m = findScroll(frames[frames.length - 1], next);
      // Moved more than a screen: go back and take smaller steps.
      for (let tries = 0; m.shift < 0 && tries < 3 && !stopAsked; tries++) {
        const back = steps;
        steps = Math.max(1, Math.floor(steps / 2));
        if (scrollHook) await scrollHook(-(back - steps)); else wheel(-(back - steps));
        await wait(500);
        next = await grab();
        m = findScroll(frames[frames.length - 1], next);
      }
      if (m.shift < 0) break;
      if (m.shift === 0) {
        // The end of the page (twice, in case the page was still moving).
        if (++still >= 2) break;
        continue;
      }
      still = 0;
      frames.push(next);
      matches.push(m);
      height += m.shift;
      if (bar && !bar.isDestroyed()) void bar.webContents.executeJavaScript(`window.bar&&bar.n(${frames.length})`).catch(() => undefined);
    }
    return imageOf(stitch(frames, matches));
  } finally {
    scrolling = false;
    if (esc) globalShortcut.unregister('Escape');
    if (bar && !bar.isDestroyed()) bar.destroy();
  }
}

/** Test hook: scrolls the test's own page instead of sending wheel events. */
let scrollTestHook: ((steps: number) => Promise<void>) | undefined;
export function onScrollStep(fn: typeof scrollTestHook) {
  scrollTestHook = fn;
}

// ---------------------------------------------------------------- pinned pictures

interface Pin { id: string; win: BrowserWindow; path: string; opacity: number; through: boolean }
const pins = new Map<string, Pin>();
let pinKey = '';
let pinKeyTaken = '';

const PIN_PAGE = (mac: boolean) => `<!doctype html><html lang="en"><head><meta charset="utf-8">${CSP}<title>Pinned picture</title><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:600 12px ${FONT};user-select:none}
body{-webkit-app-region:drag;cursor:grab}
img{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}
body.through{outline:2px dashed rgba(10,132,255,.9);outline-offset:-2px}
#bar{position:fixed;top:6px;right:6px;display:flex;gap:4px;padding:4px;border-radius:10px;background:rgba(24,24,28,.86);opacity:0;transition:opacity .15s;-webkit-app-region:no-drag}
body:hover #bar,#bar:focus-within{opacity:1}
button{all:unset;min-width:26px;height:26px;padding:0 7px;border-radius:7px;color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
button:hover{background:rgba(255,255,255,.16)}button:focus-visible{outline:2px solid #8ab4ff}
#pct{color:#fff;opacity:.8;min-width:34px;text-align:center;align-self:center}
</style></head><body><img id="i" alt="Pinned picture"><div id="bar" role="toolbar" aria-label="Pinned picture">
<button id="less" type="button" aria-label="More see-through">−</button><span id="pct">100%</span><button id="more" type="button" aria-label="Less see-through">+</button>
<button id="thru" type="button" aria-label="Let clicks through (T)">Click-through</button><button id="copy" type="button" aria-label="Copy (${mac ? '⌘' : 'Ctrl+'}C)">Copy</button><button id="x" type="button" aria-label="Close (Esc)">✕</button></div>
<script>
var op=1,css=false;function a(x,v){keeperFloat.act(x,v)}
window.pin={image:function(u){document.getElementById('i').src=u},set:function(s){op=s.opacity;css=s.css;document.getElementById('pct').textContent=Math.round(op*100)+'%';document.getElementById('i').style.opacity=css?op:1;document.body.classList.toggle('through',!!s.through)}};
document.getElementById('less').onclick=function(){a('opacity',Math.max(.2,op-.1))};document.getElementById('more').onclick=function(){a('opacity',Math.min(1,op+.1))};
document.getElementById('thru').onclick=function(){a('through',true)};document.getElementById('copy').onclick=function(){a('copy')};document.getElementById('x').onclick=function(){a('close')};
addEventListener('keydown',function(e){var k=e.key.toLowerCase();if(k==='escape'||((e.metaKey||e.ctrlKey)&&k==='w')){a('close');return}
if((e.metaKey||e.ctrlKey)&&k==='c'){a('copy');return}if(k==='t'){a('through',true);return}if(/^[0-9]$/.test(k)){a('key',k);return}
if(k==='+'||k==='='){a('zoom',1.1)}else if(k==='-'){a('zoom',1/1.1)}});
addEventListener('wheel',function(e){if(e.ctrlKey||e.metaKey){a('zoom',e.deltaY<0?1.06:1/1.06)}},{passive:true});
</script></body></html>`;

function pinView(p: Pin) {
  // Window opacity on macOS and Windows; Linux has none, so the picture itself fades.
  if (!isLinux) p.win.setOpacity(p.opacity);
  void p.win.webContents.executeJavaScript(`window.pin&&pin.set(${JSON.stringify({ opacity: p.opacity, css: isLinux, through: p.through })})`).catch(() => undefined);
}

/** The shortcut that makes see-through pins clickable again is held only while one is see-through. */
function syncPinKey() {
  const want = [...pins.values()].some((p) => p.through) ? pinKey : '';
  if (pinKeyTaken && pinKeyTaken !== want) { try { globalShortcut.unregister(pinKeyTaken); } catch { /* gone */ } pinKeyTaken = ''; }
  if (want && !pinKeyTaken) {
    try { if (globalShortcut.register(want, () => clickableAgain())) pinKeyTaken = want; } catch { /* not valid: the pins can still be closed from Capture */ }
  }
}

/** After all shortcuts were registered again (they are all dropped first). */
export function reclaimPinKey(acc: string) {
  pinKey = acc;
  pinKeyTaken = '';
  syncPinKey();
}

function setThrough(p: Pin, on: boolean) {
  p.through = on;
  p.win.setIgnoreMouseEvents(on);
  if (on) p.win.blur();
  pinView(p);
  syncPinKey();
}

/** Every see-through pin takes clicks again. */
export function clickableAgain(): number {
  let n = 0;
  for (const p of pins.values()) if (p.through) { setThrough(p, false); n++; }
  return n;
}

export function pinList(): { id: string; path: string; opacity: number; through: boolean; bounds: Electron.Rectangle }[] {
  return [...pins.values()].filter((p) => !p.win.isDestroyed()).map((p) => ({ id: p.id, path: p.path, opacity: p.opacity, through: p.through, bounds: p.win.getBounds() }));
}

export function closePins(): number {
  const n = pins.size;
  for (const p of [...pins.values()]) if (!p.win.isDestroyed()) p.win.destroy();
  pins.clear();
  syncPinKey();
  return n;
}

/** A picture floating over every app; drag it anywhere, close it with Esc. */
export async function pinImage(file: string, preload: string, o: { opacity?: number; through?: boolean } = {}): Promise<string> {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) throw new Error('This file cannot be pinned: it is not a picture Keeper can open.');
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = pinSize(img.getSize(), d.scaleFactor, d.workArea);
  const at = screen.getCursorScreenPoint();
  const x = Math.max(d.workArea.x, Math.min(d.workArea.x + d.workArea.width - size.width, at.x - Math.round(size.width / 2)));
  const y = Math.max(d.workArea.y, Math.min(d.workArea.y + d.workArea.height - size.height, at.y - Math.round(size.height / 2)));
  const win = new BrowserWindow({
    ...overlayOptions('pin'),
    x, y, width: size.width, height: size.height, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: true,
    resizable: true, alwaysOnTop: true, show: false, minWidth: 60, minHeight: 40,
    webPreferences: { preload, sandbox: true, contextIsolation: true, spellcheck: false },
  });
  keepUnmanaged(win, 'pin');
  win.setAlwaysOnTop(true, 'floating');
  win.setAspectRatio(size.width / size.height);
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  const id = `pin${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const p: Pin = { id, win, path: file, opacity: pinOpacity(o.opacity ?? 1), through: false };
  pins.set(id, p);
  win.on('closed', () => { pins.delete(id); syncPinKey(); });
  onFloat(win, (action, arg) => {
    if (action === 'close') win.destroy();
    else if (action === 'copy') void writeImage(nativeImage.createFromPath(file));
    else if (action === 'opacity' && typeof arg === 'number') { p.opacity = pinOpacity(arg); pinView(p); }
    else if (action === 'key' && typeof arg === 'string') { const v = opacityForKey(arg); if (v !== null) { p.opacity = v; pinView(p); } }
    else if (action === 'through') setThrough(p, true);
    else if (action === 'zoom' && typeof arg === 'number') {
      const b = win.getBounds();
      const k = Math.max(0.5, Math.min(2, arg));
      const w = Math.max(60, Math.round(b.width * k));
      const h = Math.max(40, Math.round(b.height * k));
      win.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: Math.round(b.y + (b.height - h) / 2), width: w, height: h });
    }
  });
  await win.loadURL(page(PIN_PAGE(isMac))).catch(() => undefined);
  await win.webContents.executeJavaScript(`window.pin.image(${JSON.stringify(img.toDataURL())})`).catch(() => undefined);
  pinView(p);
  win.show();
  if (o.through) setThrough(p, true);
  return id;
}

/** Changes a pin from Capture's page or the tests (opacity 0.2..1, see-through on or off, close). */
export function setPin(id: string, patch: { opacity?: number; through?: boolean; close?: boolean }): boolean {
  const p = pins.get(id);
  if (!p || p.win.isDestroyed()) return false;
  if (patch.close) { p.win.destroy(); return true; }
  if (typeof patch.opacity === 'number') { p.opacity = pinOpacity(patch.opacity); pinView(p); }
  if (typeof patch.through === 'boolean') setThrough(p, patch.through);
  return true;
}

// ---------------------------------------------------------------- the preview after a capture

export interface PreviewActions {
  annotate(file: string): void;
  share(file: string): Promise<unknown>;
  pin(file: string): Promise<unknown>;
  problem(message: string): void;
}

interface Item { id: string; path: string; thumb: string; icon: Electron.NativeImage }
let items: Item[] = [];
let previewWin: BrowserWindow | null = null;
let previewReady: Promise<void> | null = null;
let actions: PreviewActions | null = null;
let stayFor = 8;

const PREVIEW_PAGE = () => `<!doctype html><html lang="en"><head><meta charset="utf-8">${CSP}<title>Capture preview</title><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;font:600 12px ${FONT};user-select:none}
#list{position:absolute;right:9px;bottom:9px;display:flex;flex-direction:column;gap:12px}
.card{position:relative;width:232px;height:158px;border-radius:14px;background:rgba(28,28,32,.94);box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden;animation:in .18s ease-out;outline:none}
.card:focus-visible{box-shadow:0 0 0 3px #8ab4ff}
@keyframes in{from{transform:translateX(30px);opacity:0}}
.shot{display:block;width:232px;height:116px;object-fit:cover;object-position:top;background:#000;cursor:grab}
.row{display:flex;gap:2px;padding:4px;justify-content:space-between}
button{all:unset;flex:1;height:30px;border-radius:8px;color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:11.5px}
button:hover{background:rgba(255,255,255,.14)}button:focus-visible{outline:2px solid #8ab4ff;outline-offset:-2px}
.x{position:absolute;top:6px;right:6px;flex:none;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.6);opacity:0}
.card:hover .x,.card:focus-within .x{opacity:1}
.more{color:#fff;text-align:center;font-size:11px;opacity:.75}
</style></head><body><div id="list" role="list" aria-label="Screenshots just taken"></div>
<script>
var timers={},stay=8;
function a(x,v){keeperFloat.act(x,v)}
function arm(id,card){clearTimeout(timers[id]);if(stay>0&&!card.matches(':hover')&&!card.contains(document.activeElement))timers[id]=setTimeout(function(){a('dismiss',id)},stay*1000)}
function b(label,text,fn){var x=document.createElement('button');x.type='button';x.textContent=text;x.setAttribute('aria-label',label);x.title=label;x.onclick=function(e){e.stopPropagation();fn()};return x}
window.preview={set:function(list,more,s){stay=s;var L=document.getElementById('list');L.textContent='';
if(more){var m=document.createElement('div');m.className='more';m.textContent=more+' more';L.append(m)}
list.forEach(function(it){var c=document.createElement('div');c.className='card';c.setAttribute('role','listitem');c.tabIndex=0;c.setAttribute('aria-label',it.name);
var im=document.createElement('img');im.className='shot';im.src=it.thumb;im.alt=it.name;im.draggable=true;
im.addEventListener('dragstart',function(e){e.preventDefault();a('drag',it.id)});im.ondblclick=function(){a('annotate',it.id)};
var r=document.createElement('div');r.className='row';
r.append(b('Annotate','Annotate',function(){a('annotate',it.id)}),b('Copy','Copy',function(){a('copy',it.id)}),b('Save as…','Save',function(){a('save',it.id)}),b('Upload and copy link','Upload',function(){a('upload',it.id)}),b('Pin on screen','Pin',function(){a('pin',it.id)}));
var x=b('Close','✕',function(){a('dismiss',it.id)});x.className='x';
c.append(im,r,x);c.addEventListener('mouseenter',function(){clearTimeout(timers[it.id])});c.addEventListener('mouseleave',function(){arm(it.id,c)});
c.addEventListener('focusout',function(){arm(it.id,c)});
c.addEventListener('keydown',function(e){var k=e.key.toLowerCase();if(k==='escape')a('dismiss',it.id);else if((e.metaKey||e.ctrlKey)&&k==='c')a('copy',it.id);else if(k==='enter'&&e.target===c)a('annotate',it.id)});
L.append(c);arm(it.id,c)})},
state:function(){return Array.prototype.map.call(document.querySelectorAll('.card'),function(c){return c.getAttribute('aria-label')})}};
</script></body></html>`;

function layoutPreview() {
  const { shown, more } = previewStack(items, 4);
  if (!shown.length) {
    if (previewWin && !previewWin.isDestroyed()) previewWin.destroy();
    previewWin = null;
    previewReady = null;
    return;
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const b = previewBounds(d.workArea, shown.length + (more ? 0.2 : 0));
  const rect = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  if (!previewWin || previewWin.isDestroyed()) {
    previewWin = new BrowserWindow({
      ...overlayOptions('preview'), ...rect, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, alwaysOnTop: true, show: false,
      webPreferences: { preload: preloadPath, sandbox: true, contextIsolation: true, spellcheck: false },
    });
    keepUnmanaged(previewWin, 'preview');
    previewWin.setAlwaysOnTop(true, 'floating');
    if (isMac) previewWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    previewWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    previewWin.webContents.on('will-navigate', (e) => e.preventDefault());
    const w = previewWin;
    onFloat(w, (action, arg, e) => void onPreview(action, arg, e));
    w.on('closed', () => { if (previewWin === w) { previewWin = null; previewReady = null; } });
    previewReady = w.loadURL(page(PREVIEW_PAGE())).then(() => undefined, () => undefined);
  } else previewWin.setBounds(rect);
  const w = previewWin;
  const list = shown.map((i) => ({ id: i.id, name: path.basename(i.path), thumb: i.thumb }));
  void previewReady!.then(() => {
    if (w.isDestroyed()) return;
    void w.webContents.executeJavaScript(`window.preview.set(${JSON.stringify(list)}, ${more}, ${stayFor})`).catch(() => undefined);
    if (!w.isVisible()) w.showInactive();
  });
}

function drop(id: string) {
  items = items.filter((i) => i.id !== id);
  layoutPreview();
}

async function onPreview(action: string, arg: unknown, e: Electron.IpcMainEvent) {
  const it = items.find((i) => i.id === arg);
  if (!it) return;
  if (!existsSync(it.path)) { drop(it.id); return; }
  try {
    switch (action) {
      case 'dismiss': drop(it.id); break;
      // Dragged out: the file itself, into a chat, a mail or a folder.
      case 'drag': e.sender.startDrag({ file: it.path, icon: it.icon }); break;
      case 'annotate': drop(it.id); actions?.annotate(it.path); break;
      case 'copy': await writeImage(nativeImage.createFromPath(it.path)); break;
      case 'save': {
        const r = await dialog.showSaveDialog({ title: 'Save the screenshot', defaultPath: it.path, filters: [{ name: 'PNG picture', extensions: ['png'] }] });
        if (!r.canceled && r.filePath && path.resolve(r.filePath) !== path.resolve(it.path)) await fsp.copyFile(it.path, r.filePath);
        break;
      }
      case 'upload': drop(it.id); await actions?.share(it.path); break;
      case 'pin': drop(it.id); await actions?.pin(it.path); break;
    }
  } catch (err) {
    actions?.problem(err instanceof Error ? err.message : String(err));
  }
}

let preloadPath = '';

/** Shows the preview for a new screenshot (it joins the others already there). */
export function showPreview(file: string, img: Electron.NativeImage, o: { preload: string; seconds: number; actions: PreviewActions }) {
  preloadPath = o.preload;
  actions = o.actions;
  stayFor = o.seconds;
  const small = img.getSize().width > 464 ? img.resize({ width: 464 }) : img;
  const icon = img.resize({ width: 96 });
  items.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, path: file, thumb: small.toDataURL(), icon });
  if (items.length > 12) items = items.slice(-12);
  layoutPreview();
}

/** The previews on screen now (diagnostics and tests). */
export async function previewState(): Promise<{ items: string[]; shown: string[] }> {
  const shown = previewWin && !previewWin.isDestroyed() && previewReady ? await previewReady.then(() => previewWin!.webContents.executeJavaScript('window.preview.state()').catch(() => [])) as string[] : [];
  return { items: items.map((i) => i.path), shown };
}

export function closePreviews() {
  items = [];
  layoutPreview();
}
