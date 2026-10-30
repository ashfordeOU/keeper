// SPDX-License-Identifier: AGPL-3.0-or-later
// "Copy text from the screen": freezes the screen under a see-through window,
// lets the user drag a rectangle, then reads the text (and any QR code) in it
// on this computer.

import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import jsQR from 'jsqr';
import type { CaptureResult } from '../../core/api';
import { readImage as readClipboardImage } from './clip';
import { ocrImage } from './vision';

const OVERLAY = (img: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;cursor:crosshair;overflow:hidden;user-select:none;font:13px -apple-system,'Segoe UI',system-ui,sans-serif}
body{background:url(${img}) 0 0/100% 100% no-repeat}
#shade{position:fixed;inset:0;background:rgba(0,0,0,.35)}
#sel{position:fixed;border:1.5px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.35);display:none;background:transparent}
#tip{position:fixed;top:18px;left:50%;transform:translateX(-50%);background:rgba(20,20,24,.85);color:#fff;padding:7px 13px;border-radius:9px}
</style></head><body><div id="shade"></div><div id="sel"></div><div id="tip">Drag over the text to copy · Esc to cancel</div><script>
let sx,sy,dragging=false;const sel=document.getElementById('sel'),shade=document.getElementById('shade');
addEventListener('mousedown',e=>{sx=e.clientX;sy=e.clientY;dragging=true;shade.style.display='none';sel.style.display='block';draw(e)});
addEventListener('mousemove',e=>dragging&&draw(e));
addEventListener('mouseup',e=>{if(!dragging)return;dragging=false;const r=rect(e);if(r.w<6||r.h<6){keeperCapture.done(null);return}keeperCapture.done(r)});
addEventListener('keydown',e=>{if(e.key==='Escape')keeperCapture.done(null)});
function rect(e){return{x:Math.min(sx,e.clientX),y:Math.min(sy,e.clientY),w:Math.abs(e.clientX-sx),h:Math.abs(e.clientY-sy)}}
function draw(e){const r=rect(e);Object.assign(sel.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'})}
</script></body></html>`;

let busy = false;

export async function captureText(preloadPath: string, langs: string[]): Promise<CaptureResult | null> {
  if (busy) return null;
  busy = true;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { width, height } = display.size;
    const scale = display.scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) } });
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Keeper needs permission to see the screen (System Settings → Privacy & Security → Screen Recording).');
    const shot = src.thumbnail;

    const win = new BrowserWindow({
      x: display.bounds.x, y: display.bounds.y, width, height, frame: false, transparent: false, alwaysOnTop: true, skipTaskbar: true,
      fullscreenable: false, resizable: false, movable: false, hasShadow: false, enableLargerThanScreen: true, show: false,
      webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const rect = await new Promise<{ x: number; y: number; w: number; h: number } | null>((resolve) => {
      const onDone = (e: Electron.IpcMainEvent, r: { x: number; y: number; w: number; h: number } | null) => {
        if (e.sender !== win.webContents) return;
        ipcMain.removeListener('capture.done', onDone);
        resolve(r);
      };
      ipcMain.on('capture.done', onDone);
      win.on('closed', () => resolve(null));
      void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY(shot.toDataURL()))}`).then(() => { win.show(); win.focus(); });
    });
    if (!win.isDestroyed()) win.close();
    if (!rect) return null;

    const sx = shot.getSize().width / width;
    const sy = shot.getSize().height / height;
    const crop = shot.crop({ x: Math.round(rect.x * sx), y: Math.round(rect.y * sy), width: Math.max(1, Math.round(rect.w * sx)), height: Math.max(1, Math.round(rect.h * sy)) });
    return await readImage(crop, langs);
  } finally {
    busy = false;
  }
}

/** Text and QR code from any image. */
export async function readImage(img: Electron.NativeImage, langs: string[]): Promise<CaptureResult> {
  const { width, height } = img.getSize();
  // Small crops read better scaled up.
  const scaled = Math.max(width, height) < 600 ? img.resize({ width: width * 2, height: height * 2, quality: 'best' }) : img;
  let code: string | undefined;
  try {
    const bmp = img.toBitmap();
    // toBitmap is BGRA; jsQR wants RGBA, but it only looks at brightness, so the swap does not matter.
    code = jsQR(new Uint8ClampedArray(bmp.buffer, bmp.byteOffset, bmp.byteLength), width, height)?.data;
  } catch {
    code = undefined;
  }
  const text = await ocrImage(scaled, langs);
  return { text, code, image: img.toDataURL() };
}

export async function clipboardImage(langs: string[]): Promise<CaptureResult | null> {
  const img = await readClipboardImage();
  return img ? readImage(img, langs) : null;
}
