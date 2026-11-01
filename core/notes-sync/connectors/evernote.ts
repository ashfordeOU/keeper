// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Evernote: reads .enex exports (ENML → Markdown, attachments kept) and
// writes .enex files that Evernote imports (Markdown → ENML). Writing back
// through Evernote's own service is not offered: it needs keys Evernote no
// longer hands out, so the honest path is export → import.

import { createHash } from 'node:crypto';
import { escapeHtml, htmlToMarkdown, markdownToHtml, parseHtml, textContent, type HNode } from '../markdown';
import type { Attachment, RemoteNote } from '../types';

const child = (n: HNode, name: string) => n.children.find((c) => c.name === name);
const kids = (n: HNode, name: string) => n.children.filter((c) => c.name === name);
const text = (n: HNode | undefined) => (n ? textContent(n).trim() : '');

/** 20261031T120000Z → time */
export function enexTime(s: string): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s.trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : undefined;
}

export function toEnexTime(t: number): string {
  return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

export const ATTACHMENT_REF = 'attachment:';

/** Notes in an .enex file. Images and files are referenced as attachment:<md5> until the hub stores them. */
export function parseEnex(xml: string, notebook?: string): RemoteNote[] {
  const root = parseHtml(xml, { xml: true });
  const exp = child(root, 'en-export') ?? root;
  const out: RemoteNote[] = [];
  kids(exp, 'note').forEach((n, i) => {
    const attachments: Attachment[] = [];
    for (const r of kids(n, 'resource')) {
      const data = Buffer.from(text(child(r, 'data')).replace(/\s+/g, ''), 'base64');
      const md5 = createHash('md5').update(data).digest('hex');
      const attrs = child(r, 'resource-attributes');
      attachments.push({ name: text(attrs && child(attrs, 'file-name')) || `${md5}.${(text(child(r, 'mime')).split('/')[1] || 'bin')}`, mime: text(child(r, 'mime')) || undefined, data: new Uint8Array(data), sourceRef: md5 });
    }
    const enml = text(child(n, 'content'));
    const body = htmlToMarkdown(enml, {
      media: (a) => {
        const at = attachments.find((x) => x.sourceRef === a.hash);
        const name = at?.name ?? a.hash ?? 'file';
        return /^image\//.test(a.type ?? '') ? `![${name}](${ATTACHMENT_REF}${a.hash})` : `[${name}](${ATTACHMENT_REF}${a.hash})`;
      },
    });
    const title = text(child(n, 'title')) || 'Untitled';
    const created = enexTime(text(child(n, 'created')));
    const modified = enexTime(text(child(n, 'updated'))) ?? created;
    out.push({
      sourceId: `${notebook ?? 'enex'}:${created ?? i}:${title}`.slice(0, 200),
      title, body,
      tags: kids(n, 'tag').map(text).filter(Boolean),
      created, modified, version: String(modified ?? ''),
      folder: notebook, attachments: attachments.length ? attachments : undefined,
    });
  });
  return out;
}

export interface EnexInput {
  title: string;
  body: string;
  tags: string[];
  created: number;
  modified: number;
  /** files the body links to: the link text in the body → bytes */
  files?: { link: string; name: string; mime?: string; data: Uint8Array }[];
}

/** An .enex file for Evernote's File → Import. */
export function writeEnex(notes: EnexInput[], app = 'Keeper'): string {
  const parts = notes.map((n) => {
    const res = (n.files ?? []).map((f) => ({ ...f, md5: createHash('md5').update(f.data).digest('hex') }));
    const html = markdownToHtml(n.body, {
      flavour: 'enml',
      image: (_alt, src) => {
        const f = res.find((r) => r.link === src || decodeURI(src) === r.link);
        return f ? `<en-media hash="${f.md5}" type="${f.mime ?? 'application/octet-stream'}"/>` : undefined;
      },
    });
    const enml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${html}</en-note>`;
    return [
      '<note>',
      `<title>${escapeHtml(n.title)}</title>`,
      `<content><![CDATA[${enml.replace(/]]>/g, ']]]]><![CDATA[>')}]]></content>`,
      `<created>${toEnexTime(n.created)}</created>`,
      `<updated>${toEnexTime(n.modified)}</updated>`,
      ...n.tags.map((t) => `<tag>${escapeHtml(t)}</tag>`),
      ...res.map((r) => `<resource><data encoding="base64">${Buffer.from(r.data).toString('base64')}</data><mime>${escapeHtml(r.mime ?? 'application/octet-stream')}</mime><resource-attributes><file-name>${escapeHtml(r.name)}</file-name></resource-attributes></resource>`),
      '</note>',
    ].join('\n');
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export export-date="${toEnexTime(Date.now())}" application="${escapeHtml(app)}" version="1.0">\n${parts.join('\n')}\n</en-export>\n`;
}
