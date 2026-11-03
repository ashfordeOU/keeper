// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Making a message's HTML safe to show: no scripts, no event handlers, no
// forms or embedded frames, remote images and CSS held back until you allow
// them, tracking pixels removed, links that show where they really go. The
// result is still drawn in a sandboxed frame without scripts as a second wall.
// Runs in the main process (it uses an HTML parser).

import sanitizeHtml from 'sanitize-html';
import { stripTracking } from './privacy';

export interface SanitizeOptions {
  /** load pictures and styles from the internet */
  allowRemote?: boolean;
  /** inline images: content id → data: URL */
  cid?: Record<string, string>;
}

export interface SanitizeResult {
  html: string;
  /** remote pictures and styles that were held back */
  blocked: number;
  /** tracking pixels removed */
  trackers: number;
  /** links that had tracking parameters taken off */
  cleanedLinks?: number;
}

// Hosts that only serve tracking pixels or open-tracking redirects.
const TRACKER_HOSTS = /(^|\.)(list-manage\.com|mailtrack\.io|mailtrack\.com|sendgrid\.net|mandrillapp\.com|mcsv\.net|hubspotemail\.net|hs-analytics\.net|pixel\.watch|mixpanel\.com|google-analytics\.com|doubleclick\.net|emltrk\.com|bananatag\.com|yesware\.com|getnotify\.com|mailfoogae\.appspot\.com|t\.sidekickopen\d*\.com|links\.iterable\.com|click\.e\.|open\.e\.)/i;

const isRemote = (u: string) => /^(https?:)?\/\//i.test(u.trim());

/** Takes remote url(...) and @import out of CSS unless allowed; counts them. */
export function cleanCss(css: string, allowRemote: boolean, count: () => void): string {
  let out = css.replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript:/gi, '');
  out = out.replace(/position\s*:\s*fixed/gi, 'position:static');
  if (!allowRemote) {
    out = out.replace(/@import[^;]*;?/gi, () => { count(); return ''; });
    out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, _q, u: string) => (isRemote(u) ? (count(), 'none') : m));
  }
  return out;
}

function tinyImage(attribs: Record<string, string>): boolean {
  const n = (v?: string) => (v ? parseFloat(v) : NaN);
  const w = n(attribs.width);
  const h = n(attribs.height);
  if ((w <= 2 && w >= 0) || (h <= 2 && h >= 0)) return true;
  const st = attribs.style ?? '';
  return /(^|;)\s*(width|height)\s*:\s*[01](px)?\s*(;|$)/i.test(st) || /display\s*:\s*none/i.test(st);
}

export function sanitizeMail(html: string, opts: SanitizeOptions = {}): SanitizeResult {
  let blocked = 0;
  let trackers = 0;
  let cleanedLinks = 0;
  const allowRemote = !!opts.allowRemote;
  const count = () => { blocked++; };
  let out = sanitizeHtml(html, {
    allowedTags: [
      'html', 'body', 'head', 'style', 'title', 'div', 'span', 'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'small', 'big', 'font', 'center',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'kbd', 'samp', 'q', 'cite', 'abbr', 'address', 'del', 'ins', 'mark', 'wbr',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
      'a', 'img', 'picture', 'source', 'figure', 'figcaption', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'details', 'summary',
    ],
    allowVulnerableTags: true,
    allowedAttributes: {
      '*': ['style', 'class', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'lang', 'title', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'face', 'size', 'background'],
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'width', 'height', 'style', 'data-blocked-src', 'title'],
      source: ['srcset', 'media', 'type'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data', 'cid'],
    allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'], a: ['http', 'https', 'mailto', 'tel'] },
    allowProtocolRelative: true,
    nonTextTags: ['script', 'textarea', 'option', 'noscript', 'title'],
    exclusiveFilter: (frame) => {
      if (frame.tag !== 'img') return false;
      const src = frame.attribs.src ?? frame.attribs['data-blocked-src'] ?? '';
      if (tinyImage(frame.attribs) || (isRemote(src) && TRACKER_HOSTS.test(safeHost(src)))) {
        trackers++;
        // It was counted as a held-back picture on the way in; it is simply gone now.
        if (frame.attribs['data-blocked-src']) blocked--;
        return true;
      }
      return false;
    },
    transformTags: {
      '*': (tagName, attribs) => {
        if (attribs.style) attribs.style = cleanCss(attribs.style, allowRemote, count);
        if (attribs.background && isRemote(attribs.background) && !allowRemote) {
          delete attribs.background;
          blocked++;
        }
        return { tagName, attribs };
      },
      a: (tagName, attribs) => {
        const href = (attribs.href ?? '').trim();
        const a: Record<string, string> = { ...attribs, rel: 'noopener noreferrer' };
        if (!/^(https?:|mailto:|tel:|\/\/)/i.test(href)) delete a.href;
        else if (!/^mailto:|^tel:/i.test(href)) {
          // Tracking parameters come off before the link can be opened.
          const clean = stripTracking(href);
          if (clean.removed) { cleanedLinks++; a.href = clean.href; }
          a.target = '_blank';
          a.title = clean.href;
        }
        if (a.style) a.style = cleanCss(a.style, allowRemote, count);
        return { tagName, attribs: a };
      },
      img: (tagName, attribs) => {
        const a = { ...attribs };
        if (a.style) a.style = cleanCss(a.style, allowRemote, count);
        const src = (a.src ?? '').trim();
        if (/^cid:/i.test(src)) {
          const data = opts.cid?.[src.slice(4).replace(/^<|>$/g, '')];
          if (data) a.src = data;
          else delete a.src;
        } else if (isRemote(src) && !allowRemote) {
          a['data-blocked-src'] = src;
          delete a.src;
          blocked++;
        }
        return { tagName, attribs: a };
      },
      source: (tagName, attribs) => {
        if (!allowRemote && attribs.srcset) {
          blocked++;
          return { tagName, attribs: {} };
        }
        return { tagName, attribs };
      },
    },
  });
  // CSS inside <style> blocks.
  out = out.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a: string, css: string, b: string) => a + cleanCss(css, allowRemote, count) + b);
  return { html: out, blocked, trackers, cleanedLinks };
}

function safeHost(u: string): string {
  try {
    return new URL(u.startsWith('//') ? 'https:' + u : u).hostname;
  } catch {
    return '';
  }
}

/** Plain text to safe HTML (links made clickable, quotes kept). */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const link = (u: string) => { const h = stripTracking(u.replace(/&amp;/g, '&')).href.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); return `<a href="${h}" target="_blank" rel="noopener noreferrer" title="${h}">${u}</a>`; };
  return `<div style="white-space:pre-wrap;font-family:inherit">${esc.replace(/(https?:\/\/[^\s<]+)/g, link)}</div>`;
}
