// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Capture a web page: opens the address in a hidden window of Keeper's browser
// (kbrowser.ts, a private session that keeps nothing), sized as a desktop or a
// phone, closes a cookie banner where it is simple, scrolls through so late
// pictures load, then takes the whole page as one PNG (through the DevTools
// protocol, so fixed headers are not repeated) or prints it to PDF. The file
// goes to the screenshot folder and into Capture's history.

import { nativeImage, type BrowserWindow } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { uniqueName } from '../../core/rules';
import type { WebCaptureResult } from '../../core/api-webcapture';
import { bannerScript, captureFileName, DEVICES, fitHeight, normalizeCaptureUrl, pdfLayout, scrollScript, type WebCaptureOptions } from '../../core/web-capture';
import { remember, screenshotFolder } from './capture';
import { openPageWindow } from './kbrowser';


const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the page to load, at most `ms`; a slow page is captured as far as it got. */
function loaded(win: BrowserWindow, url: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const wc = win.webContents;
    let done = false;
    const end = (e?: Error) => { if (done) return; done = true; clearTimeout(t); e ? reject(e) : resolve(); };
    const t = setTimeout(() => end(), ms);
    wc.once('did-finish-load', () => end());
    wc.once('did-fail-load', (_e, code, desc, _u, main) => { if (main && code !== -3) end(new Error(failWords(code, desc))); });
    void wc.loadURL(url).catch(() => undefined);
  });
}

function failWords(code: number, desc: string): string {
  if (code === -105 || code === -137) return 'That address could not be found.';
  if (code === -102 || code === -106) return 'The site did not answer.';
  if (code === -7 || code === -118) return 'The site took too long to answer.';
  if (code <= -200 && code > -300) return 'The site’s certificate is not valid.';
  if (code === -312) return 'Browsers do not open pages on that port.';
  return `The page did not load (${desc || code}).`;
}

export async function captureWebPage(opts: WebCaptureOptions, phase: (text: string) => void = () => undefined): Promise<WebCaptureResult> {
  const url = normalizeCaptureUrl(opts.url);
  const dev = DEVICES[opts.device];
  const scale = opts.sharp && !dev.mobile ? 2 : dev.scale;
  const { ownConnectionDenied } = await import('./fw');
  const u = new URL(url);
  if (await ownConnectionDenied(u.hostname, u.protocol === 'https:' ? 443 : Number(u.port) || 80).catch(() => false)) throw new Error(`Keeper’s firewall blocks ${u.hostname}.`);

  const win = openPageWindow({ width: dev.width, height: dev.height });
  const wc = win.webContents;
  const dbg = wc.debugger;
  try {
    // The DevTools protocol answers only once the window has a page of its own.
    await win.loadURL('about:blank');
    dbg.attach('1.3');
    const send = <T = unknown>(method: string, params?: Record<string, unknown>) => dbg.sendCommand(method, params) as Promise<T>;
    const metrics = (height: number) => send('Emulation.setDeviceMetricsOverride', { width: dev.width, height, deviceScaleFactor: scale, mobile: dev.mobile, screenWidth: dev.width, screenHeight: dev.height });
    await metrics(dev.height);
    if (dev.userAgent) await send('Emulation.setUserAgentOverride', { userAgent: dev.userAgent, platform: 'Android' });
    if (dev.mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmulatedMedia', { media: 'screen' });

    phase('Opening the page');
    await loaded(win, url, 30_000);
    await wait(800);
    let banner = false;
    if (opts.banners) {
      phase('Closing the cookie banner');
      const r = await wc.executeJavaScript(bannerScript(), true).catch(() => null) as { clicked: number; found: number } | null;
      banner = !!r?.found;
      if (banner) await wait(700);
    }
    if (opts.scroll && !dev.frameOnly) {
      phase('Loading the whole page');
      await Promise.race([wc.executeJavaScript(scrollScript(), true).catch(() => undefined), wait(20_000)]);
      await wait(400);
    }

    const title = wc.getTitle() || u.hostname;
    const layout = await send<{ cssContentSize?: { width: number; height: number }; contentSize: { width: number; height: number } }>('Page.getLayoutMetrics');
    const content = layout.cssContentSize ?? layout.contentSize;
    const fit = dev.frameOnly ? { height: dev.height, cut: false } : fitHeight(content.height, scale);
    const dir = await screenshotFolder();
    const file = uniqueName(path.join(dir, captureFileName(url, opts.format, new Date(), opts.device)), existsSync);

    phase(opts.format === 'pdf' ? 'Making the PDF' : 'Taking the picture');
    let thumb: string | undefined;
    if (opts.format === 'pdf') {
      const pl = pdfLayout(dev.width, Math.min(content.height, 19_200));
      const pdf = await wc.printToPDF({
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        ...(pl.single ? { pageSize: { width: pl.width, height: pl.height } } : { pageSize: 'A4' }),
      });
      await fsp.writeFile(file, pdf);
    } else {
      // The window becomes as tall as the page, so nothing fixed is drawn twice.
      if (!dev.frameOnly) await metrics(fit.height);
      await wait(300);
      const shot = await send<{ data: string }>('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !dev.frameOnly, fromSurface: true, clip: { x: 0, y: 0, width: dev.width, height: fit.height, scale: 1 } });
      const png = Buffer.from(shot.data, 'base64');
      await fsp.writeFile(file, png);
      thumb = nativeImage.createFromBuffer(png).resize({ width: 320 }).crop({ x: 0, y: 0, width: 320, height: Math.min(400, Math.round((320 / dev.width) * fit.height)) }).toDataURL();
    }
    await remember({ kind: 'webpage', value: `${title} · ${path.basename(file)}`, path: file, ...(thumb ? { thumb } : {}) });
    return { path: file, format: opts.format, width: dev.width, height: fit.height, cut: fit.cut, banner, title, thumb };
  } finally {
    try { dbg.detach(); } catch { /* already gone */ }
    if (!win.isDestroyed()) win.destroy();
  }
}
