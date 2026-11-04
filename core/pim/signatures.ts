// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Signatures and how each account writes: several rich signatures per
// send-from address (pictures, links, fonts, colours) with a default for new
// mail, replies and forwards; the account's font, size, colour and format;
// where the quote goes; Reply All by default; attachments on forwards. Also
// reading signatures other apps keep (a web mail's settings, a desktop mail
// app's signature files, Thunderbird's preferences).

import { htmlToText } from './compose-rich';
import type { Account, Identity } from './types';

export interface Signature {
  id: string;
  name: string;
  /** cleaned HTML (sanitizeSignature); pictures inside as data: URLs */
  html: string;
}

/** Which signature goes under each kind of message ('' = none; unset = the first one). */
export interface SignatureDefaults {
  new?: string;
  reply?: string;
  forward?: string;
}

export interface ComposeStyle {
  /** a font stack name from FONTS */
  font?: string;
  /** CSS size: '13px' … */
  size?: string;
  color?: string;
  /** rich text (HTML and plain) or plain text only */
  format?: 'rich' | 'plain';
  /** your answer above the quote (usual) or below it */
  quote?: 'above' | 'below';
  /** Reply answers everyone */
  replyAll?: boolean;
  /** Forward keeps the original's attachments (on unless false) */
  forwardAttachments?: boolean;
}

export const FONTS: { id: string; label: string; css: string }[] = [
  { id: 'system', label: 'System', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  { id: 'sans', label: 'Sans serif', css: 'Helvetica, Arial, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monospace', css: 'Menlo, Consolas, "Courier New", monospace' },
  { id: 'rounded', label: 'Rounded', css: '"SF Pro Rounded", "Nunito", "Segoe UI", sans-serif' },
];
export const SIZES = ['12px', '13px', '14px', '16px', '18px'];

// ---------------------------------------------------------------- cleaning

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TAGS = new Set(['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'font', 'hr', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'small', 'big', 'sub', 'sup', 'center', 'blockquote']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|svg|math|form|noscript|title|head|xml|meta|link)\b[\s\S]*?<\/\1\s*>/gi;
const STYLE_PROPS = new Set(['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'vertical-align', 'letter-spacing', 'width', 'height', 'max-width', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'border-collapse', 'display', 'white-space']);

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const v = m?.[2] ?? m?.[3] ?? m?.[4];
  return v === undefined ? undefined : v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}

/** Only harmless CSS: the listed properties, no url(), expression() or imports. */
export function cleanStyle(style: string): string {
  return style.split(';').map((d) => d.trim()).filter(Boolean).flatMap((d) => {
    const i = d.indexOf(':');
    if (i < 0) return [];
    const k = d.slice(0, i).trim().toLowerCase();
    const v = d.slice(i + 1).trim();
    if (!STYLE_PROPS.has(k) || /url\s*\(|expression|javascript:|@import|behavior|[<>{}\\]/i.test(v) || v.length > 200) return [];
    return [`${k}:${v}`];
  }).join(';');
}

/** A picture inside the signature: a data: picture or one already attached (cid:); https pictures are kept as they are. */
function safeImgSrc(src: string): string | undefined {
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(src)) return src.length <= 1_400_000 ? src.replace(/\s+/g, '') : undefined;
  if (/^cid:[\w.@%+-]+$/i.test(src)) return src;
  if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
  return undefined;
}

/**
 * A signature's HTML, cleaned: formatting, tables, links (web, mail, phone)
 * and pictures (inside it, or https) are kept; scripts, event handlers,
 * forms, frames, SVG, unsafe CSS and other addresses are removed.
 */
export function sanitizeSignature(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(DROP_WITH_CONTENT, '');
  out = out.replace(/^[\s\S]*<body\b[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  out = out.replace(/<\/?([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (m, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!TAGS.has(t)) return '';
    if (m.startsWith('</')) return t === 'img' || t === 'br' || t === 'hr' ? '' : `</${t === 'font' ? 'span' : t === 'center' ? 'div' : t}>`;
    const kept: string[] = [];
    let style = cleanStyle(attr(attrs, 'style') ?? '');
    if (t === 'a') {
      const href = attr(attrs, 'href') ?? '';
      if (/^(https?:|mailto:|tel:)/i.test(href)) kept.push(`href="${esc(href)}"`);
    }
    if (t === 'img') {
      const src = safeImgSrc(attr(attrs, 'src') ?? '');
      if (!src) return '';
      kept.push(`src="${esc(src)}"`);
      const alt = attr(attrs, 'alt');
      if (alt) kept.push(`alt="${esc(alt)}"`);
    }
    for (const a of ['width', 'height']) {
      const v = attr(attrs, a);
      if ((t === 'img' || t === 'td' || t === 'table') && v && /^\d{1,4}%?$/.test(v)) kept.push(`${a}="${v}"`);
    }
    if (t === 'td' || t === 'th') for (const a of ['colspan', 'rowspan', 'valign', 'align']) { const v = attr(attrs, a); if (v && /^[\w]{1,10}$/.test(v)) kept.push(`${a}="${v}"`); }
    if (t === 'table') for (const a of ['cellpadding', 'cellspacing', 'border']) { const v = attr(attrs, a); if (v && /^\d{1,2}$/.test(v)) kept.push(`${a}="${v}"`); }
    if (t === 'font') {
      const face = attr(attrs, 'face');
      const color = attr(attrs, 'color');
      const size = attr(attrs, 'size');
      style = cleanStyle([style, face ? `font-family:${face}` : '', color ? `color:${color}` : '', size && /^[1-7]$/.test(size) ? `font-size:${['', '10px', '13px', '16px', '18px', '24px', '32px', '48px'][Number(size)]}` : ''].filter(Boolean).join(';'));
    }
    if (style) kept.push(`style="${esc(style)}"`);
    const name = t === 'font' ? 'span' : t === 'center' ? 'div' : t;
    if (t === 'center') kept.push('align="center"');
    return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}>`;
  });
  return out.trim();
}

/** Plain text as signature HTML (a signature written before rich signatures). */
export function textSignature(text: string): string {
  return esc(text.trim()).replace(/\n/g, '<br>');
}

// ---------------------------------------------------------------- choosing

/** An address's signatures, with an old plain one turned into the first. */
export function signaturesOf(i?: Pick<Identity, 'signature' | 'signatures'>): Signature[] {
  if (!i) return [];
  if (i.signatures?.length) return i.signatures;
  return i.signature?.trim() ? [{ id: 'sig', name: 'Signature', html: textSignature(i.signature) }] : [];
}

/**
 * The signature for a new message, a reply or a forward: the address's own
 * choice for that kind ('' means none), else the first. Replies and forwards
 * get none when the account leaves signatures off them.
 */
export function pickSignature(i: Pick<Identity, 'signature' | 'signatures' | 'signatureDefaults'> | undefined, kind: 'new' | 'reply' | 'forward', onReplies = true): Signature | undefined {
  const list = signaturesOf(i);
  if (!list.length) return undefined;
  const chosen = i?.signatureDefaults?.[kind];
  if (chosen === '') return undefined;
  if (chosen) return list.find((s) => s.id === chosen) ?? list[0];
  if (kind !== 'new' && !onReplies) return undefined;
  return list[0];
}

// ---------------------------------------------------------------- pictures as attachments

export interface InlinePart {
  cid: string;
  filename: string;
  contentType: string;
  /** base64 */
  content: string;
}

/**
 * Pictures written into HTML as data: URLs become attached pictures the
 * message points to (cid:), which mail apps show without asking; the same
 * picture twice is attached once.
 */
export function inlineImages(html: string, tag = 'keeper'): { html: string; parts: InlinePart[] } {
  const parts: InlinePart[] = [];
  const seen = new Map<string, string>();
  const out = html.replace(/(<img\b[^>]*\bsrc=")data:(image\/(png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)(")/gi, (_m, pre: string, type: string, ext: string, data: string, post: string) => {
    let cid = seen.get(data);
    if (!cid) {
      cid = `sig${parts.length + 1}.${tag}@keeper`;
      seen.set(data, cid);
      parts.push({ cid, filename: `picture-${parts.length + 1}.${ext.toLowerCase().replace('jpeg', 'jpg')}`, contentType: type.toLowerCase(), content: data });
    }
    return `${pre}cid:${cid}${post}`;
  });
  return { html: out, parts };
}

// ---------------------------------------------------------------- how the account writes

/** The wrapper style for what you write (font, size, colour), or '' when nothing was chosen. */
export function styleCss(s?: ComposeStyle): string {
  if (!s) return '';
  const font = FONTS.find((f) => f.id === s.font);
  return [font && s.font !== 'system' ? `font-family:${font.css}` : '', s.size ? `font-size:${s.size}` : '', s.color && /^#[0-9a-f]{3,8}$/i.test(s.color) ? `color:${s.color}` : ''].filter(Boolean).join(';');
}

/** What you wrote, wrapped in the account's font, size and colour. */
export function styledBody(html: string, s?: ComposeStyle): string {
  const css = styleCss(s);
  return css ? `<div style="${esc(css)}">${html}</div>` : html;
}

/**
 * The message's text and HTML: what you wrote (in the account's style),
 * the signature, and the quote above or below, as the account says. Plain
 * format sends no HTML at all.
 */
export function assembleStyled(o: { html: string; text: string; signature?: Signature; quotedText?: string; quotedHtml?: string; style?: ComposeStyle }): { text: string; html?: string } {
  const sigText = o.signature ? `-- \n${htmlToText(o.signature.html)}` : '';
  const below = o.style?.quote === 'below';
  const text = below ? [o.quotedText ?? '', o.text, sigText].filter(Boolean).join('\n\n') : [o.text, sigText, o.quotedText ?? ''].filter(Boolean).join('\n\n');
  if (o.style?.format === 'plain') return { text };
  const sigHtml = o.signature ? `<div class="keeper-signature">-- <br>${o.signature.html}</div>` : '';
  const q = o.quotedHtml ?? (o.quotedText ? esc(o.quotedText.replace(/^> ?/gm, '')).replace(/\n/g, '<br>') : '');
  const quoteHtml = q ? `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${q}</blockquote>` : '';
  const body = styledBody(o.html, o.style);
  const html = below ? [quoteHtml, body, sigHtml ? `<br>${sigHtml}` : ''].filter(Boolean).join('<br>') : [body, sigHtml ? `<br>${sigHtml}` : '', quoteHtml ? `<br>${quoteHtml}` : ''].join('');
  return { text, html };
}

/** Reply or Reply All, as the account prefers, when Reply is pressed. */
export function replyMode(a: Pick<Account, 'compose'> | undefined, pressed: 'reply' | 'replyAll'): 'reply' | 'replyAll' {
  return pressed === 'reply' && a?.compose?.replyAll ? 'replyAll' : pressed;
}

// ---------------------------------------------------------------- signatures other apps keep

/** A web mail's send-from addresses with their signatures (Gmail API settings.sendAs.list). */
export function fromGmailSendAs(json: { sendAs?: { sendAsEmail: string; displayName?: string; signature?: string; isDefault?: boolean; isPrimary?: boolean; replyToAddress?: string }[] }): { email: string; name?: string; signature?: Signature; replyTo?: string; isDefault: boolean }[] {
  return (json.sendAs ?? []).map((s) => {
    const html = s.signature?.trim() ? sanitizeSignature(s.signature) : '';
    return { email: s.sendAsEmail, name: s.displayName || undefined, replyTo: s.replyToAddress || undefined, isDefault: !!(s.isDefault ?? s.isPrimary), signature: html ? { id: `gmail-${s.sendAsEmail}`, name: 'From Gmail', html } : undefined };
  });
}

function decodeQp(s: string): string {
  const bytes: number[] = [];
  const t = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '=' && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...new TextEncoder().encode(t[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** An Apple Mail .mailsignature file: headers, a blank line, then HTML (maybe quoted-printable). */
export function fromMailSignatureFile(text: string): string | undefined {
  const split = text.search(/\r?\n\r?\n/);
  if (split < 0) return undefined;
  const head = text.slice(0, split);
  let body = text.slice(split).replace(/^\s+/, '');
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) body = decodeQp(body);
  else if (/content-transfer-encoding:\s*base64/i.test(head)) body = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));
  const html = sanitizeSignature(body);
  return html || undefined;
}

/** Signature names from Apple Mail's AllSignatures.plist (id → name). */
export function appleSignatureNames(plist: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of plist.match(/<dict>[\s\S]*?<\/dict>/g) ?? []) {
    const name = d.match(/<key>SignatureName<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
    const id = d.match(/<key>SignatureUniqueId<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
    if (name && id) out[id] = name.replace(/&amp;/g, '&');
  }
  return out;
}

/** Thunderbird's identities with their signatures, from prefs.js (inline HTML signatures; files are read by the caller). */
export function fromThunderbirdPrefs(prefs: string): { id: string; email?: string; name?: string; html?: string; file?: string }[] {
  const val = (key: string) => {
    const m = prefs.match(new RegExp(`user_pref\\("${key.replace(/\./g, '\\.')}",\\s*("((?:[^"\\\\]|\\\\.)*)"|(true|false|\\d+))\\);`));
    if (!m) return undefined;
    return m[2] !== undefined ? m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : m[3];
  };
  const ids = [...new Set([...prefs.matchAll(/user_pref\("mail\.identity\.(id\d+)\./g)].map((m) => m[1]))];
  return ids.map((id) => {
    const text = val(`mail.identity.${id}.htmlSigText`);
    const isHtml = val(`mail.identity.${id}.htmlSigFormat`) === 'true';
    const useFile = val(`mail.identity.${id}.attach_signature`) === 'true';
    return {
      id, email: val(`mail.identity.${id}.useremail`), name: val(`mail.identity.${id}.fullName`),
      html: text?.trim() ? (isHtml ? sanitizeSignature(text) : textSignature(text)) : undefined,
      file: useFile ? val(`mail.identity.${id}.sig_file-rel`)?.replace(/^\[ProfD\]/, '') ?? val(`mail.identity.${id}.sig_file`) : undefined,
    };
  }).filter((x) => x.email);
}

/** A desktop mail app's signature saved as a web page (.htm), cleaned. */
export function fromHtmFile(html: string): string | undefined {
  const out = sanitizeSignature(html);
  return htmlToText(out).trim() || /<img\b/.test(out) ? out : undefined;
}
