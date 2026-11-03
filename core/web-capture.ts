// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Capture a web page": a whole page as one tall picture or a PDF, through
// Keeper's own browser, as a desktop or a phone sees it, or at the size social
// apps use for link previews (1200 × 630). Pure parts: the presets, the
// address, the file name, how tall a picture can be, and choosing the button
// that closes a cookie banner (preferring "only necessary" over "accept").

export type CaptureDevice = 'desktop' | 'phone' | 'social';
export type CaptureFormat = 'png' | 'pdf';

export interface DevicePreset {
  label: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  /** only what fits in the frame (the social preview), not the whole page */
  frameOnly: boolean;
  userAgent?: string;
}

export const DEVICES: Record<CaptureDevice, DevicePreset> = {
  desktop: { label: 'Desktop', width: 1440, height: 900, scale: 1, mobile: false, frameOnly: false },
  phone: {
    label: 'Phone', width: 390, height: 844, scale: 2, mobile: true, frameOnly: false,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  },
  social: { label: 'Social image', width: 1200, height: 630, scale: 1, mobile: false, frameOnly: true },
};

export interface WebCaptureOptions {
  url: string;
  device: CaptureDevice;
  format: CaptureFormat;
  /** close cookie banners where it is simple */
  banners: boolean;
  /** scroll through the page first so pictures that load late are there */
  scroll: boolean;
  /** twice the pixels (sharper on high-density screens, bigger files) */
  sharp: boolean;
}

export const defaultWebCapture = (): Omit<WebCaptureOptions, 'url'> => ({ device: 'desktop', format: 'png', banners: true, scroll: true, sharp: false });

/** "example.com/x" → "https://example.com/x"; only web addresses. */
export function normalizeCaptureUrl(input: string): string {
  const s = input.trim();
  if (!s) throw new Error('Paste the address of a page.');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^/:]+:\d+/.test(s) ? s : `https://${s}`;
  let u: URL;
  try { u = new URL(withScheme); } catch { throw new Error('That does not look like a web address.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web pages (http and https) can be captured.');
  if (!u.hostname) throw new Error('That does not look like a web address.');
  return u.toString();
}

/** "Web page example.com 2026-11-03 at 14.05.png" */
export function captureFileName(url: string, format: CaptureFormat, at = new Date(), device: CaptureDevice = 'desktop'): string {
  let host = 'page';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep "page" */ }
  const p = (n: number) => String(n).padStart(2, '0');
  const when = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} at ${p(at.getHours())}.${p(at.getMinutes())}.${p(at.getSeconds())}`;
  const kind = device === 'phone' ? ' (phone)' : device === 'social' ? ' (social)' : '';
  return `Web page ${host.replace(/[^a-z0-9.-]/gi, '_')}${kind} ${when}.${format}`;
}

/** Chromium draws at most about 16,000 pixels in one picture: taller pages are cut there. */
export const MAX_PIXELS = 16_000;

export function fitHeight(cssHeight: number, scale: number): { height: number; cut: boolean } {
  const max = Math.floor(MAX_PIXELS / Math.max(1, scale));
  const h = Math.max(1, Math.ceil(cssHeight));
  return h > max ? { height: max, cut: true } : { height: h, cut: false };
}

/** One tall PDF page when it fits (PDF pages stop at 200 inches), else A4 pages. */
export function pdfLayout(cssWidth: number, cssHeight: number): { single: true; width: number; height: number } | { single: false } {
  const w = cssWidth / 96;
  const h = cssHeight / 96;
  return h <= 200 && w <= 200 ? { single: true, width: Math.round(w * 1000) / 1000, height: Math.max(1, Math.round(h * 1000) / 1000) } : { single: false };
}

// ---------------------------------------------------------------- cookie banners

/**
 * Which button closes a cookie banner: words that refuse what is not needed
 * come first, then words that accept. Runs inside the page too (it is passed
 * as text), so it must not use anything from outside its own body.
 */
export function pickConsentButton(texts: string[]): number {
  const clean = texts.map((t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim());
  const refuse = [
    'reject all', 'reject', 'decline all', 'decline', 'refuse all', 'refuse', 'deny', 'only necessary', 'necessary only', 'essential only', 'only essential', 'use necessary cookies only', 'continue without accepting',
    'alle ablehnen', 'ablehnen', 'nur notwendige', 'tout refuser', 'refuser', 'continuer sans accepter', 'rechazar todo', 'rechazar', 'rifiuta tutto', 'rifiuta', 'weigeren', 'alles weigeren', 'avvisa alla', 'hylkää', 'odmítnout', 'odrzuć',
  ];
  const accept = [
    'accept all', 'accept all cookies', 'accept cookies', 'accept', 'allow all', 'allow', 'agree', 'i agree', 'agree and close', 'got it', 'ok', 'okay', 'i understand', 'understood',
    'alle akzeptieren', 'akzeptieren', 'zustimmen', 'tout accepter', 'accepter', "j'accepte", 'aceptar todo', 'aceptar', 'accetta tutto', 'accetta', 'accepteren', 'alles accepteren', 'godkänn alla', 'hyväksy', 'nõustun', 'aktsepteeri',
  ];
  const score = (t: string) => {
    if (!t || t.length > 60) return 0;
    for (const w of refuse) if (t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`)) return 3;
    for (const w of accept) if (t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`)) return 2;
    for (const w of refuse) if (t.includes(w)) return 1.5;
    for (const w of accept) if (t.includes(w) && t.length < 30) return 1;
    return 0;
  };
  let best = -1;
  let bestScore = 0;
  clean.forEach((t, i) => { const s = score(t); if (s > bestScore) { best = i; bestScore = s; } });
  return best;
}

/** The script run in the page: finds a consent dialog, presses the right button, hides what is left. */
export function bannerScript(): string {
  return `(() => {
  const pick = ${pickConsentButton.toString()};
  const WORDS = /cookie|consent|gdpr|privacy|cmp|didomi|onetrust|quantcast|truste|usercentrics|cookiebot|sp_message|evidon/i;
  const boxes = [...document.querySelectorAll('div, section, aside, dialog, form, [role=dialog], [aria-modal=true]')].filter((el) => {
    const s = getComputedStyle(el);
    const label = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '') + ' ' + (el.getAttribute('aria-label') || '');
    const fixed = s.position === 'fixed' || s.position === 'sticky' || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
    return fixed && (WORDS.test(label) || /cookie|consent/i.test((el.innerText || '').slice(0, 600)));
  });
  let clicked = 0;
  for (const box of boxes.slice(0, 4)) {
    const buttons = [...box.querySelectorAll('button, [role=button], a, input[type=button], input[type=submit]')].filter((b) => b.offsetParent !== null);
    const i = pick(buttons.map((b) => b.innerText || b.value || b.getAttribute('aria-label') || ''));
    if (i >= 0) { try { buttons[i].click(); clicked++; } catch {} }
  }
  // Whatever still covers the page goes out of the picture.
  for (const box of boxes) { const s = getComputedStyle(box); if (s.display !== 'none' && (s.position === 'fixed' || s.position === 'sticky')) box.style.setProperty('display', 'none', 'important'); }
  if (boxes.length) { document.documentElement.style.setProperty('overflow', 'auto', 'important'); document.body.style.setProperty('overflow', 'auto', 'important'); }
  return { found: boxes.length, clicked };
})()`;
}

/** The script that scrolls through the page so pictures that load late appear, then back to the top. */
export function scrollScript(maxSteps = 40, pauseMs = 250): string {
  return `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(200, Math.floor(innerHeight * 0.85));
  let steps = 0;
  for (let y = 0; y < document.documentElement.scrollHeight && steps < ${maxSteps}; y += step, steps++) { scrollTo(0, y); await wait(${pauseMs}); }
  scrollTo(0, document.documentElement.scrollHeight);
  await wait(${pauseMs});
  scrollTo(0, 0);
  // Pictures that started loading get a moment to finish.
  const imgs = [...document.images].filter((i) => !i.complete).slice(0, 60);
  await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))), wait(3000)]);
  return { steps, height: document.documentElement.scrollHeight };
})()`;
}
