// SPDX-License-Identifier: AGPL-3.0-or-later
// Helpers shared by every viewer: file addresses, loading bytes, and the
// sanitizer that keeps documents from running code or calling home.

import DOMPurify from 'dompurify';
import { api, isDemo } from '../api';

export function fileUrl(p: string): string {
  if (api.preview?.url) return api.preview.url(p);
  return 'keeper-file://' + p.split(/([\\/])/).map((seg, i) => (i % 2 ? seg : encodeURIComponent(seg))).join('');
}

export class PreviewUnavailable extends Error {}

/** The whole file as bytes (fetched through keeper-file://, which supports any size). */
export async function fetchBytes(p: string, maxBytes = 300 * 1024 * 1024): Promise<ArrayBuffer> {
  if (isDemo) throw new PreviewUnavailable('This preview is available in the desktop app.');
  const res = await fetch(fileUrl(p));
  if (!res.ok) throw new Error(res.status === 403 ? 'Keeper is not allowed to read this file.' : `Could not read the file (${res.status})`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new PreviewUnavailable(`This file is too large to preview here (${Math.round(len / 1048576)} MB).`);
  return res.arrayBuffer();
}

export async function fetchText(p: string, maxBytes?: number): Promise<{ text: string; encoding: string; truncated: boolean; size: number }> {
  return api.preview.text(p, maxBytes);
}

let hooked = false;

/**
 * Cleans HTML from documents, e-mails, notebooks and Markdown: no scripts, no
 * event handlers, no forms or frames, and nothing loaded from the internet
 * (remote images are dropped so opening a file never tells anyone you did).
 */
export function sanitize(html: string, opts: { allowRemoteImages?: boolean } = {}): { html: string; blockedRemote: number } {
  let blockedRemote = 0;
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
    FORBID_ATTR: ['style', 'srcset'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    RETURN_DOM_FRAGMENT: false,
  }) as string;
  if (opts.allowRemoteImages) return { html: clean, blockedRemote };
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  doc.querySelectorAll('img, video, audio, source, track').forEach((el) => {
    const src = el.getAttribute('src') ?? '';
    if (src && !/^(data:|blob:|keeper-file:)/i.test(src)) {
      el.removeAttribute('src');
      el.setAttribute('data-blocked', 'remote');
      el.setAttribute('alt', el.getAttribute('alt') || 'Remote image hidden');
      blockedRemote++;
    }
  });
  doc.querySelectorAll('[background]').forEach((el) => el.removeAttribute('background'));
  return { html: doc.body.firstElementChild!.innerHTML, blockedRemote };
}

/** Cleaned HTML wrapped in a document for a sandboxed, script-free iframe. */
export function sandboxDoc(html: string, dark: boolean): string {
  const csp = "default-src 'none'; img-src data: blob: keeper-file:; style-src 'unsafe-inline'; font-src data:";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
    body{font:15px/1.6 -apple-system,'Segoe UI',system-ui,sans-serif;margin:24px;color:${dark ? '#e8e8ea' : '#1b1b1f'};background:${dark ? '#17171b' : '#fff'};word-wrap:break-word}
    img{max-width:100%;height:auto} a{color:#6d6dff} table{border-collapse:collapse} td,th{border:1px solid #8884;padding:4px 8px} pre{white-space:pre-wrap}
  </style></head><body>${html}</body></html>`;
}

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function extOfName(name: string): string {
  const l = name.toLowerCase();
  for (const c of ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst']) if (l.endsWith('.' + c)) return c;
  const i = l.lastIndexOf('.');
  return i > 0 ? l.slice(i + 1) : '';
}

/** Opens links from previews in the browser, never inside Keeper. */
export function onLinkClick(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest('a');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href') ?? '';
  if (/^(https?|mailto):/i.test(href)) void api.system.openExternal(href);
}
