// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// POP3 (RFC 1939, STLS from RFC 2595): the answers a server gives and which
// messages to download or remove. A POP3 account downloads into a mailbox on
// this computer (electron/services/pim/pop3.ts); a copy stays on the server
// unless the person chose otherwise.

/** A one-line answer: +OK or -ERR and the text after it. */
export function statusLine(line: string): { ok: boolean; text: string } {
  const m = line.match(/^([+-])(OK|ERR)\b ?(.*)$/i);
  if (!m) return { ok: false, text: line.trim() };
  return { ok: m[1] === '+', text: m[3].trim() };
}

/** Where a multi-line answer ends (the line with a single dot), or -1 while more is coming. */
export function multiLineEnd(buf: Buffer): number {
  if (buf.length >= 3 && buf.subarray(0, 3).toString('latin1') === '.\r\n') return 0;
  const i = buf.indexOf('\r\n.\r\n');
  return i < 0 ? -1 : i + 2;
}

/** The body of a multi-line answer without its first and last lines, with leading dots put back as they were. */
export function unstuff(body: Buffer): Buffer {
  return Buffer.from(body.toString('latin1').replace(/^\.\./gm, '.'), 'latin1');
}

/** UIDL's answer: message number → unique id. */
export function parseUidl(text: string): { n: number; uid: string }[] {
  return text.split(/\r?\n/).map((l) => l.trim().match(/^(\d+)\s+(\S+)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ n: Number(m[1]), uid: m[2] }));
}

/** What to do on a check: messages to download, and (when nothing is kept) those to remove from the server. */
export function pop3Plan(list: { n: number; uid: string }[], seen: Record<string, number>, o: { keep: boolean; now: number; removeAfterDays?: number }): { fetch: { n: number; uid: string }[]; remove: number[] } {
  const fetch = list.filter((x) => !(x.uid in seen));
  const remove = o.keep
    ? (o.removeAfterDays ? list.filter((x) => x.uid in seen && o.now - seen[x.uid] > o.removeAfterDays! * 86_400_000).map((x) => x.n) : [])
    : list.filter((x) => x.uid in seen).map((x) => x.n);
  return { fetch, remove };
}

/** The usual POP3 server for an address (pop.example.com) when the provider file has none. */
export function guessPop3(email: string): { host: string; port: number; security: 'tls' } {
  return { host: `pop.${email.split('@')[1] ?? ''}`, port: 995, security: 'tls' };
}
