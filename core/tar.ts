// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small reader for the .tar archives components ship in (ustar, with pax and
// GNU long names): regular files, folders and symbolic links. Everything else
// (devices, hard links, fifos) is refused. The writer is scripts/components.mjs.

export interface TarEntry {
  path: string;
  type: 'file' | 'dir' | 'symlink';
  mode: number;
  data?: Uint8Array;
  link?: string;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0.*$/s, '');
const octal = (b: Uint8Array) => {
  const s = text(b).trim();
  return s ? parseInt(s, 8) : 0;
};

function paxRecords(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const s = new TextDecoder().decode(b);
  let i = 0;
  while (i < s.length) {
    const sp = s.indexOf(' ', i);
    if (sp < 0) break;
    const len = Number(s.slice(i, sp));
    if (!len) break;
    const rec = s.slice(sp + 1, i + len - 1);
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/** The entries of an uncompressed tar. Throws on anything malformed or unsupported. */
export function readTar(tar: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let longName: string | undefined;
  let longLink: string | undefined;
  let pax: Record<string, string> = {};
  for (let o = 0; o + 512 <= tar.length;) {
    const h = tar.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    // The header checksum counts its own field as spaces.
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== octal(h.subarray(148, 156))) throw new Error('The archive is damaged (a header checksum does not match)');
    const size = octal(h.subarray(124, 136));
    const type = String.fromCharCode(h[156] || 48);
    const start = o + 512;
    const end = start + size;
    if (end > tar.length) throw new Error('The archive is cut short');
    const data = tar.subarray(start, end);
    o = start + Math.ceil(size / 512) * 512;
    if (type === 'x') { pax = paxRecords(data); continue; }
    if (type === 'g') continue;
    if (type === 'L') { longName = text(data); continue; }
    if (type === 'K') { longLink = text(data); continue; }
    const prefix = text(h.subarray(345, 500));
    const name = pax.path ?? longName ?? (prefix ? `${prefix}/${text(h.subarray(0, 100))}` : text(h.subarray(0, 100)));
    const link = pax.linkpath ?? longLink ?? text(h.subarray(157, 257));
    pax = {};
    longName = longLink = undefined;
    const p = name.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!p || p === '.') continue;
    const mode = octal(h.subarray(100, 108)) & 0o777;
    if (type === '0' || type === '\0' || type === '7') out.push({ path: p, type: 'file', mode, data });
    else if (type === '5') out.push({ path: p, type: 'dir', mode });
    else if (type === '2') out.push({ path: p, type: 'symlink', mode, link });
    else throw new Error(`The archive holds an unsupported entry (${p})`);
  }
  return out;
}
