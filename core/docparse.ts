// SPDX-License-Identifier: AGPL-3.0-or-later
// Small, dependency-free readers for e-mail (MIME), contact cards (vCard),
// RTF and subtitle files, used by the previewer.

// ---------------------------------------------------------------- e-mail

export interface MailPart {
  headers: Record<string, string>;
  contentType: string;
  charset?: string;
  filename?: string;
  cid?: string;
  /** decoded body bytes */
  body: Uint8Array;
  parts?: MailPart[];
}

export interface Mail {
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments: { filename: string; contentType: string; size: number; cid?: string; data: Uint8Array }[];
}

function splitHeaders(raw: string): [Record<string, string>, string] {
  const idx = raw.search(/\r?\n\r?\n/);
  const head = idx >= 0 ? raw.slice(0, idx) : raw;
  const body = idx >= 0 ? raw.slice(idx).replace(/^\r?\n\r?\n/, '') : '';
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) {
      const k = m[1].toLowerCase();
      headers[k] = headers[k] ? `${headers[k]}, ${m[2]}` : m[2];
    }
  }
  return [headers, body];
}

function param(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  const m = value.match(new RegExp(`${name}\\*?=(?:"([^"]*)"|([^;\\s]*))`, 'i'));
  const v = m?.[1] ?? m?.[2];
  if (!v) return undefined;
  // RFC 2231: utf-8''name%20here
  const ext = v.match(/^([\w-]+)''(.*)$/);
  return ext ? decodeURIComponent(ext[2]) : decodeWords(v);
}

function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

function decodeQP(s: string): Uint8Array {
  const clean = s.replace(/=\r?\n/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '=' && /^[0-9A-F]{2}$/i.test(clean.slice(i + 1, i + 3))) {
      out.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(clean.charCodeAt(i) & 255);
  }
  return Uint8Array.from(out);
}

function decodeB64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(clean.slice(0, clean.length - (clean.length % 4)) || '');
  return latin1Bytes(bin);
}

export function bytesToText(b: Uint8Array, charset = 'utf-8'): string {
  try {
    return new TextDecoder(charset.toLowerCase().replace(/^(us-)?ascii$/, 'utf-8')).decode(b);
  } catch {
    return new TextDecoder('utf-8').decode(b);
  }
}

/** =?utf-8?B?…?= and =?iso-8859-1?Q?…?= words in headers. */
export function decodeWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_m, cs: string, enc: string, data: string) =>
      bytesToText(enc.toUpperCase() === 'B' ? decodeB64(data) : decodeQP(data.replace(/_/g, ' ')), cs));
}

function parsePart(raw: string): MailPart {
  const [headers, body] = splitHeaders(raw);
  const contentType = (headers['content-type'] ?? 'text/plain').split(';')[0].trim().toLowerCase();
  const charset = param(headers['content-type'], 'charset');
  const enc = (headers['content-transfer-encoding'] ?? '').toLowerCase().trim();
  const disp = headers['content-disposition'];
  const filename = param(disp, 'filename') ?? param(headers['content-type'], 'name');
  const cid = headers['content-id']?.replace(/[<>]/g, '');
  if (contentType.startsWith('multipart/')) {
    const boundary = param(headers['content-type'], 'boundary');
    const parts: MailPart[] = [];
    if (boundary) {
      const chunks = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*\\r?\\n?`));
      for (const c of chunks.slice(1)) if (c.trim() && !c.startsWith('--')) parts.push(parsePart(c));
    }
    return { headers, contentType, charset, body: new Uint8Array(), parts };
  }
  const decoded = enc === 'base64' ? decodeB64(body) : enc === 'quoted-printable' ? decodeQP(body) : latin1Bytes(body);
  return { headers, contentType, charset, filename, cid, body: decoded };
}

/** Parses an .eml (or .emlx: a byte count line comes first). Input is the file as Latin-1 text. */
export function parseMail(input: string): Mail {
  const raw = /^\d+\s*\n/.test(input) ? input.replace(/^\d+\s*\n/, '') : input;
  const root = parsePart(raw);
  const h = root.headers;
  const mail: Mail = { from: h.from && decodeWords(h.from), to: h.to && decodeWords(h.to), cc: h.cc && decodeWords(h.cc), date: h.date, subject: h.subject && decodeWords(h.subject), attachments: [] };
  const walk = (p: MailPart) => {
    if (p.parts) return p.parts.forEach(walk);
    const isAttachment = !!p.filename || /^attachment/i.test(p.headers['content-disposition'] ?? '');
    if (!isAttachment && p.contentType === 'text/html' && mail.html === undefined) mail.html = bytesToText(p.body, p.charset);
    else if (!isAttachment && p.contentType === 'text/plain' && mail.text === undefined) mail.text = bytesToText(p.body, p.charset);
    else mail.attachments.push({ filename: p.filename ?? `${p.cid ?? 'part'}.${p.contentType.split('/')[1] ?? 'bin'}`, contentType: p.contentType, size: p.body.length, cid: p.cid, data: p.body });
  };
  walk(root);
  return mail;
}

// ---------------------------------------------------------------- vCard

export interface Contact {
  name: string;
  org?: string;
  title?: string;
  phones: { type: string; value: string }[];
  emails: { type: string; value: string }[];
  addresses: { type: string; value: string }[];
  urls: string[];
  birthday?: string;
  note?: string;
  photo?: string;
}

export function parseVcards(text: string): Contact[] {
  const out: Contact[] = [];
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let cur: Contact | null = null;
  const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  for (const line of lines) {
    if (/^BEGIN:VCARD/i.test(line)) cur = { name: '', phones: [], emails: [], addresses: [], urls: [] };
    else if (/^END:VCARD/i.test(line) && cur) {
      out.push(cur);
      cur = null;
    } else if (cur) {
      const m = line.match(/^(?:[\w-]+\.)?([\w-]+)((?:;[^:]*)?):(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const params = m[2];
      const value = m[3];
      const type = (params.match(/TYPE=([^;:]+)/i)?.[1] ?? params.replace(/^;/, '').split(';').find((x) => !x.includes('=')) ?? '').toLowerCase().split(',')[0] || 'other';
      if (key === 'FN') cur.name = unesc(value);
      else if (key === 'N' && !cur.name) cur.name = unesc(value.split(';').slice(0, 2).reverse().filter(Boolean).join(' '));
      else if (key === 'ORG') cur.org = unesc(value.split(';').filter(Boolean).join(', '));
      else if (key === 'TITLE') cur.title = unesc(value);
      else if (key === 'TEL') cur.phones.push({ type, value: value.replace(/^tel:/i, '') });
      else if (key === 'EMAIL') cur.emails.push({ type, value });
      else if (key === 'ADR') cur.addresses.push({ type, value: unesc(value.split(';').filter(Boolean).join(', ')) });
      else if (key === 'URL') cur.urls.push(unesc(value));
      else if (key === 'BDAY') cur.birthday = value;
      else if (key === 'NOTE') cur.note = unesc(value);
      else if (key === 'PHOTO') {
        if (/^data:image\//.test(value)) cur.photo = value;
        else if (/ENCODING=(b|BASE64)/i.test(params)) cur.photo = `data:image/${(params.match(/TYPE=(\w+)/i)?.[1] ?? 'jpeg').toLowerCase()};base64,${value}`;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- RTF

/** Plain text from RTF: paragraphs kept, formatting and embedded objects dropped. */
export function rtfToText(rtf: string): string {
  let out = '';
  const stack: boolean[] = [];
  let skip = false;
  let ucSkip = 1;
  let pendingSkip = 0;
  const SKIP_DESTS = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|headerl|headerr|footerl|footerr|themedata|colorschememapping|latentstyles|datastore|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|mmathPr|wgrffmtfilter|pgdsctbl|fldinst)$/;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === '{') {
      stack.push(skip);
      if (rtf[i + 1] === '\\' && rtf[i + 2] === '*') skip = true;
    } else if (c === '}') {
      skip = stack.pop() ?? false;
    } else if (c === '\\') {
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (!skip) out += next;
        i++;
      } else if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4);
        if (pendingSkip > 0) pendingSkip--;
        else if (!skip) out += new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(hex, 16)));
        i += 3;
      } else if (next === '\n' || next === '\r') {
        if (!skip) out += '\n';
        i++;
      } else {
        const m = rtf.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
        if (!m) continue;
        const word = m[1];
        const num = m[2] !== undefined ? parseInt(m[2], 10) : undefined;
        i += m[0].length;
        if (SKIP_DESTS.test(word)) skip = true;
        else if (!skip) {
          if (word === 'par' || word === 'line' || word === 'sect' || word === 'row') out += '\n';
          else if (word === 'tab' || word === 'cell') out += '\t';
          else if (word === 'emdash') out += '—';
          else if (word === 'endash') out += '–';
          else if (word === 'bullet') out += '•';
          else if (word === 'lquote') out += '‘';
          else if (word === 'rquote') out += '’';
          else if (word === 'ldblquote') out += '“';
          else if (word === 'rdblquote') out += '”';
          else if (word === 'uc' && num !== undefined) ucSkip = num;
          else if (word === 'u' && num !== undefined) {
            out += String.fromCharCode(num < 0 ? num + 65536 : num);
            pendingSkip = ucSkip;
          }
        }
      }
    } else if (c === '\r' || c === '\n') {
      continue;
    } else if (!skip) {
      if (pendingSkip > 0) pendingSkip--;
      else out += c;
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------- subtitles

export interface Cue {
  start: number;
  end: number;
  text: string;
}

const ts = (s: string) => {
  const m = s.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/);
  return m ? (+(m[1] ?? 0)) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : NaN;
};

export function parseSubtitles(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const start = ts(a);
    const end = ts(b);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    cues.push({ start, end, text: lines.slice(timeIdx + 1).join('\n').replace(/<[^>]+>/g, '') });
  }
  return cues;
}

const vttTime = (t: number) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};

/** SubRip to WebVTT so the video element can show it. */
export function toVtt(text: string): string {
  if (/^WEBVTT/.test(text.trimStart())) return text;
  return 'WEBVTT\n\n' + parseSubtitles(text).map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`).join('\n\n') + '\n';
}
