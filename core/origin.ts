// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Recording where a file Keeper saved came from, the way browsers and the
// system do, so "Downloaded From" (and Finder's Where from, Explorer's
// Security note, other apps) know it:
//   macOS    com.apple.metadata:kMDItemWhereFroms (a binary property list of
//            URLs) and com.apple.quarantine
//   Windows  the <file>:Zone.Identifier stream (ZoneId, ReferrerUrl, HostUrl)
//   Linux    user.xdg.origin.url and user.xdg.referrer.url
// Sources without a web address get a keeper:// one: keeper://mail/<message>,
// keeper://link/<device>, keeper://cloud/<connection>. Plain functions.

export type KeeperOrigin = 'mail' | 'link' | 'cloud';

export function keeperUrl(kind: KeeperOrigin, detail: string): string {
  return `keeper://${kind}/${encodeURIComponent(detail)}`;
}

/** What a keeper:// origin is called in Downloaded From. */
export function keeperSource(url: string): { id: string; name: string; host: string } | undefined {
  const m = url.match(/^keeper:\/\/(mail|link|cloud)\/([^?#]*)/i);
  if (!m) return undefined;
  let detail = '';
  try { detail = decodeURIComponent(m[2]).split('/')[0]; } catch { detail = m[2]; }
  const kind = m[1].toLowerCase();
  if (kind === 'mail') return { id: 'keeper-mail', name: 'Mail', host: 'keeper' };
  if (kind === 'link') return { id: `keeper-link:${detail.toLowerCase()}`, name: detail ? `Keeper Link · ${detail}` : 'Keeper Link', host: 'keeper' };
  return { id: `keeper-cloud:${detail.toLowerCase()}`, name: detail || 'Cloud and servers', host: 'keeper' };
}

/** The Zone.Identifier stream Windows browsers write (zone 3: the internet). */
export function zoneIdentifier(url: string, referrer?: string): string {
  return ['[ZoneTransfer]', 'ZoneId=3', ...(referrer ? [`ReferrerUrl=${referrer}`] : []), `HostUrl=${url}`, ''].join('\r\n');
}

/** com.apple.quarantine as a downloading app writes it: flags;time (hex seconds);agent;id. */
export function quarantineValue(now = Date.now(), agent = 'Keeper', id = ''): string {
  return `0081;${Math.floor(now / 1000).toString(16)};${agent};${id}`;
}

/** A binary property list holding an array of strings (what kMDItemWhereFroms holds). */
export function whereFromsPlist(urls: string[]): Buffer {
  const objects: Buffer[] = [];
  const intMarker = (n: number) => (n < 256 ? Buffer.from([0x10, n]) : Buffer.from([0x11, n >> 8, n & 0xff]));
  const head = (type: number, n: number) => (n < 15 ? Buffer.from([type | n]) : Buffer.concat([Buffer.from([type | 0x0f]), intMarker(n)]));
  const strings = urls.slice(0, 200).map((u) => u.slice(0, 8000));
  // Object 0: the array, pointing at objects 1..n (one-byte references).
  objects.push(Buffer.concat([head(0xa0, strings.length), Buffer.from(strings.map((_, i) => i + 1))]));
  for (const s of strings) {
    if (/^[\x00-\x7f]*$/.test(s)) objects.push(Buffer.concat([head(0x50, s.length), Buffer.from(s, 'ascii')]));
    else {
      const le = Buffer.from(s, 'utf16le');
      for (let i = 0; i < le.length; i += 2) [le[i], le[i + 1]] = [le[i + 1], le[i]];
      objects.push(Buffer.concat([head(0x60, le.length / 2), le]));
    }
  }
  const header = Buffer.from('bplist00', 'ascii');
  const offsets: number[] = [];
  let at = header.length;
  for (const o of objects) { offsets.push(at); at += o.length; }
  const tableAt = at;
  const offSize = tableAt < 256 ? 1 : tableAt < 65536 ? 2 : 4;
  const table = Buffer.alloc(offsets.length * offSize);
  offsets.forEach((o, i) => table.writeUIntBE(o, i * offSize, offSize));
  const trailer = Buffer.alloc(32);
  trailer.writeUInt8(offSize, 6);
  trailer.writeUInt8(1, 7);
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(tableAt), 24);
  return Buffer.concat([header, ...objects, table, trailer]);
}
