// SPDX-License-Identifier: AGPL-3.0-or-later
// Reading WebDAV PROPFIND answers (Nextcloud, ownCloud, home servers, NAS
// boxes, Apache, nginx…) without an XML library: namespaces vary by server,
// so elements are matched by their local name.

import type { Quota, RemoteEntry } from './types';
import { normalizeRemote } from './paths';

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** The text of the first element with this local name, whatever its prefix. */
function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? decodeXml(m[1].trim()) : undefined;
}

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'gi'))].map((m) => m[1]);
}

/**
 * Entries of a Depth: 1 listing. `basePath` is the server path of the
 * connection's top folder (e.g. /remote.php/dav/files/ana); `dir` the folder
 * listed, inside the connection. The folder itself is left out.
 */
export function parseMultistatus(xml: string, basePath: string, dir: string): RemoteEntry[] {
  const base = decodeURIComponent(basePath.replace(/\/+$/, ''));
  const self = normalizeRemote(dir);
  const out: RemoteEntry[] = [];
  for (const r of blocks(xml, 'response')) {
    const href = tag(r, 'href');
    if (!href) continue;
    // Some servers send full URLs, some absolute paths.
    let p = href.replace(/^https?:\/\/[^/]+/i, '');
    try {
      p = decodeURIComponent(p);
    } catch {
      /* already plain */
    }
    if (base && p.startsWith(base)) p = p.slice(base.length);
    const path = normalizeRemote(p);
    if (path === self) continue;
    // Only the OK propstat counts; 404 ones list properties the server lacks.
    const ok = blocks(r, 'propstat').find((ps) => /\s200\s/.test(tag(ps, 'status') ?? ' 200 ')) ?? r;
    const isDir = /<(?:[\w-]+:)?collection\b/i.test(tag(ok, 'resourcetype') ?? '') || /<(?:[\w-]+:)?resourcetype>\s*<(?:[\w-]+:)?collection/i.test(r);
    const size = Number(tag(ok, 'getcontentlength') ?? 0) || 0;
    const mod = tag(ok, 'getlastmodified');
    out.push({
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      isDir,
      size: isDir ? 0 : size,
      mtime: mod ? Date.parse(mod) || 0 : 0,
      mime: isDir ? undefined : tag(ok, 'getcontenttype') || undefined,
    });
  }
  return out;
}

/** RFC 4331 quota properties from a Depth: 0 PROPFIND. */
export function parseQuota(xml: string): Quota | undefined {
  const free = Number(tag(xml, 'quota-available-bytes'));
  const used = Number(tag(xml, 'quota-used-bytes'));
  if (!Number.isFinite(free) && !Number.isFinite(used)) return undefined;
  // Unlimited quota is reported as a negative number.
  const f = Number.isFinite(free) && free >= 0 ? free : undefined;
  const u = Number.isFinite(used) && used >= 0 ? used : undefined;
  return { free: f, used: u, total: f !== undefined && u !== undefined ? f + u : undefined };
}

export const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:displayname/></d:prop></d:propfind>`;

export const QUOTA_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:quota-available-bytes/><d:quota-used-bytes/></d:prop></d:propfind>`;
