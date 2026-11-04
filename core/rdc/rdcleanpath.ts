// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktop in a Keeper tab: the bytes the local relay speaks.
//
// The tab's RDP engine (IronRDP, a downloadable component) cannot open TCP or
// TLS itself, so it opens a WebSocket to a relay in Keeper's main process and
// sends one "RDCleanPath" request: the target, a token, and its X.224
// Connection Request. The relay dials the computer, passes the request on,
// reads the X.224 Connection Confirm, does the TLS handshake with the server,
// and answers with the confirm and the server's certificates. From then on the
// relay copies bytes between the WebSocket and the TLS connection; the engine
// signs in (CredSSP/NLA) through it with the server's public key.
//
// The request and answer are DER (ASN.1), version 3390:
//   RDCleanPathPdu ::= SEQUENCE {
//     version            [0] INTEGER,
//     error              [1] RDCleanPathErr OPTIONAL,
//     destination        [2] UTF8String OPTIONAL,
//     proxyAuth          [3] UTF8String OPTIONAL,
//     serverAuth         [4] UTF8String OPTIONAL,
//     preconnectionBlob  [5] UTF8String OPTIONAL,
//     x224ConnectionPdu  [6] OCTET STRING OPTIONAL,
//     serverCertChain    [7] SEQUENCE OF OCTET STRING OPTIONAL,
//     serverAddr         [9] UTF8String OPTIONAL }
//   RDCleanPathErr ::= SEQUENCE { errorCode [0] INTEGER, httpStatusCode [1] INTEGER OPTIONAL,
//     wsaLastError [2] INTEGER OPTIONAL, tlsAlertCode [3] INTEGER OPTIONAL }
// every tag EXPLICIT. Pure functions: tested byte by byte (test/rdc-rdp.test.ts).

export const RDCLEANPATH_VERSION = 3390;
/** A request is a few hundred bytes; anything bigger is refused before it is read. */
export const MAX_REQUEST = 64 * 1024;

export const RDCP_GENERAL_ERROR = 1;
export const RDCP_NEGOTIATION_ERROR = 2;
export const RDCP_TARGET_UNREACHABLE = 103;
export const RDCP_DNS_FAILED = 104;
export const RDCP_TLS_FAILED = 105;

export interface RDCleanPathErr {
  errorCode: number;
  httpStatusCode?: number;
  wsaLastError?: number;
  tlsAlertCode?: number;
}

export interface RDCleanPathPdu {
  version: number;
  error?: RDCleanPathErr;
  destination?: string;
  proxyAuth?: string;
  serverAuth?: string;
  preconnectionBlob?: string;
  x224?: Uint8Array;
  certChain?: Uint8Array[];
  serverAddr?: string;
}

// ---------------------------------------------------------------- DER

function lenBytes(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
}

function tlv(tag: number, body: Uint8Array): Uint8Array {
  const l = lenBytes(body.length);
  const out = new Uint8Array(1 + l.length + body.length);
  out[0] = tag;
  out.set(l, 1);
  out.set(body, 1 + l.length);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A non-negative INTEGER, shortest form (a leading zero when the top bit is set). */
export function derInteger(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Only non-negative whole numbers');
  const b: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) b.unshift(v & 0xff);
  if (!b.length) b.push(0);
  if (b[0] & 0x80) b.unshift(0);
  return tlv(0x02, Uint8Array.from(b));
}

const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
const explicit = (n: number, inner: Uint8Array) => tlv(0xa0 | n, inner);

export interface Tlv { tag: number; body: Uint8Array; end: number }

/** One TLV at `at`; null when the bytes are not all here yet; throws on a malformed length. */
export function readTlv(b: Uint8Array, at = 0): Tlv | null {
  if (b.length < at + 2) return null;
  const tag = b[at];
  if ((tag & 0x1f) === 0x1f) throw new Error('Long tags are not used here');
  let len = b[at + 1];
  let o = at + 2;
  if (len & 0x80) {
    const k = len & 0x7f;
    if (k === 0 || k > 4) throw new Error('Bad length');
    if (b.length < o + k) return null;
    len = 0;
    for (let i = 0; i < k; i++) len = len * 256 + b[o + i];
    o += k;
  }
  if (b.length < o + len) return null;
  return { tag, body: b.subarray(o, o + len), end: o + len };
}

/** The whole size of the DER message at the start of `b` once its header is here (null until then). */
export function pduLength(b: Uint8Array): number | null {
  if (b.length < 2) return null;
  if (b[0] !== 0x30) throw new Error('Not an RDCleanPath message');
  let len = b[1];
  let o = 2;
  if (len & 0x80) {
    const k = len & 0x7f;
    if (k === 0 || k > 4) throw new Error('Bad length');
    if (b.length < 2 + k) return null;
    len = 0;
    for (let i = 0; i < k; i++) len = len * 256 + b[2 + i];
    o += k;
  }
  return o + len;
}

function children(body: Uint8Array): Tlv[] {
  const out: Tlv[] = [];
  let at = 0;
  while (at < body.length) {
    const t = readTlv(body, at);
    if (!t) throw new Error('Cut-off field');
    out.push(t);
    at = t.end;
  }
  return out;
}

function readInt(t: Tlv): number {
  if (t.tag !== 0x02 || !t.body.length || t.body.length > 7 || t.body[0] & 0x80) throw new Error('Bad number');
  let n = 0;
  for (const x of t.body) n = n * 256 + x;
  return n;
}

function readString(t: Tlv): string {
  if (t.tag !== 0x0c) throw new Error('Bad text');
  return new TextDecoder('utf-8', { fatal: true }).decode(t.body);
}

function inner(t: Tlv): Tlv {
  const c = children(t.body);
  if (c.length !== 1) throw new Error('Bad field');
  return c[0];
}

// ---------------------------------------------------------------- RDCleanPath

export function encodeRDCleanPath(p: RDCleanPathPdu): Uint8Array {
  const f: Uint8Array[] = [explicit(0, derInteger(p.version))];
  if (p.error) {
    const e: Uint8Array[] = [explicit(0, derInteger(p.error.errorCode))];
    if (p.error.httpStatusCode !== undefined) e.push(explicit(1, derInteger(p.error.httpStatusCode)));
    if (p.error.wsaLastError !== undefined) e.push(explicit(2, derInteger(p.error.wsaLastError)));
    if (p.error.tlsAlertCode !== undefined) e.push(explicit(3, derInteger(p.error.tlsAlertCode)));
    f.push(explicit(1, tlv(0x30, concat(e))));
  }
  if (p.destination !== undefined) f.push(explicit(2, utf8(p.destination)));
  if (p.proxyAuth !== undefined) f.push(explicit(3, utf8(p.proxyAuth)));
  if (p.serverAuth !== undefined) f.push(explicit(4, utf8(p.serverAuth)));
  if (p.preconnectionBlob !== undefined) f.push(explicit(5, utf8(p.preconnectionBlob)));
  if (p.x224) f.push(explicit(6, tlv(0x04, p.x224)));
  if (p.certChain) f.push(explicit(7, tlv(0x30, concat(p.certChain.map((c) => tlv(0x04, c))))));
  if (p.serverAddr !== undefined) f.push(explicit(9, utf8(p.serverAddr)));
  return tlv(0x30, concat(f));
}

/** Reads one RDCleanPath message; throws with a plain reason when it is not one. */
export function decodeRDCleanPath(b: Uint8Array): RDCleanPathPdu {
  if (b.length > MAX_REQUEST) throw new Error('Too large');
  const top = readTlv(b, 0);
  if (!top || top.tag !== 0x30 || top.end !== b.length) throw new Error('Not an RDCleanPath message');
  const out: RDCleanPathPdu = { version: -1 };
  let last = -1;
  for (const t of children(top.body)) {
    if ((t.tag & 0xe0) !== 0xa0) throw new Error('Unexpected field');
    const n = t.tag & 0x1f;
    if (n <= last) throw new Error('Fields out of order');
    last = n;
    const v = inner(t);
    switch (n) {
      case 0: out.version = readInt(v); break;
      case 1: {
        if (v.tag !== 0x30) throw new Error('Bad error');
        const e: RDCleanPathErr = { errorCode: -1 };
        for (const x of children(v.body)) {
          const k = x.tag & 0x1f;
          const val = readInt(inner(x));
          if (k === 0) e.errorCode = val;
          else if (k === 1) e.httpStatusCode = val;
          else if (k === 2) e.wsaLastError = val;
          else if (k === 3) e.tlsAlertCode = val;
        }
        if (e.errorCode < 0) throw new Error('Error without a code');
        out.error = e;
        break;
      }
      case 2: out.destination = readString(v); break;
      case 3: out.proxyAuth = readString(v); break;
      case 4: out.serverAuth = readString(v); break;
      case 5: out.preconnectionBlob = readString(v); break;
      case 6: if (v.tag !== 0x04) throw new Error('Bad X.224 field'); out.x224 = v.body.slice(); break;
      case 7: if (v.tag !== 0x30) throw new Error('Bad certificate list'); out.certChain = children(v.body).map((c) => { if (c.tag !== 0x04) throw new Error('Bad certificate'); return c.body.slice(); }); break;
      case 9: out.serverAddr = readString(v); break;
      default: throw new Error('Unknown field');
    }
  }
  if (out.version !== RDCLEANPATH_VERSION) throw new Error(`Version ${out.version} is not ${RDCLEANPATH_VERSION}`);
  return out;
}

export interface RelayRequest { destination: string; token: string; x224: Uint8Array; preconnectionBlob?: string }

/** The engine's request, checked: everything the relay needs is there and nothing it does not do. */
export function parseRelayRequest(b: Uint8Array): RelayRequest {
  const p = decodeRDCleanPath(b);
  if (p.error || p.certChain || p.serverAddr) throw new Error('That is an answer, not a request');
  if (!p.destination) throw new Error('No destination');
  if (p.proxyAuth === undefined) throw new Error('No token');
  // A request without X.224 is the Hyper-V console flavour, which this relay does not offer.
  if (!p.x224) throw new Error('No X.224 request');
  return { destination: p.destination, token: p.proxyAuth, x224: p.x224, preconnectionBlob: p.preconnectionBlob };
}

export const relayResponse = (x224: Uint8Array, certChain: Uint8Array[], serverAddr: string) =>
  encodeRDCleanPath({ version: RDCLEANPATH_VERSION, x224, certChain, serverAddr });

export const relayError = (e: RDCleanPathErr, x224?: Uint8Array) => encodeRDCleanPath({ version: RDCLEANPATH_VERSION, error: e, x224 });

/** Constant-time comparison of two tokens. */
export function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

// ---------------------------------------------------------------- TPKT and X.224

/** The size of the TPKT packet at the start of `b` (null until its header is here). */
export function tpktLength(b: Uint8Array): number | null {
  if (b.length < 4) return null;
  if (b[0] !== 3) throw new Error('Not a TPKT packet');
  const n = (b[2] << 8) | b[3];
  if (n < 7) throw new Error('TPKT packet too short');
  return n;
}

export const PROTOCOL_RDP = 0;
export const PROTOCOL_SSL = 1;
export const PROTOCOL_HYBRID = 2;
export const PROTOCOL_HYBRID_EX = 8;

/** An X.224 Connection Request, as the outside apps and the engine send it. */
export function x224Request(protocols: number, cookie?: string): Uint8Array {
  const ck = cookie ? new TextEncoder().encode(`Cookie: mstshash=${cookie}\r\n`) : new Uint8Array(0);
  const neg = Uint8Array.from([0x01, 0x00, 0x08, 0x00, protocols & 0xff, (protocols >> 8) & 0xff, (protocols >> 16) & 0xff, (protocols >>> 24) & 0xff]);
  const x224 = concat([Uint8Array.from([0, 0xe0, 0, 0, 0, 0, 0]), ck, neg]);
  x224[0] = x224.length - 1;
  const len = x224.length + 4;
  return concat([Uint8Array.from([3, 0, len >> 8, len & 0xff]), x224]);
}

/** The protocols an X.224 Connection Request asks for (0 when it carries no negotiation request). */
export function requestedProtocols(b: Uint8Array): number {
  const n = tpktLength(b);
  if (n === null || b.length < n || b[5] !== 0xe0) throw new Error('Not an X.224 Connection Request');
  const end = 5 + b[4];
  if (end > n) throw new Error('Bad X.224 length');
  // The negotiation request is the last 8 bytes, after the cookie or routing token.
  if (end - 8 >= 11 && b[end - 8] === 0x01 && b[end - 6] === 8) return b[end - 4] | (b[end - 3] << 8) | (b[end - 2] << 16) | (b[end - 1] << 24);
  return 0;
}

export type X224Confirm = { ok: true; protocol: number } | { ok: false; failure: number };

/** What the server chose (or why it refused) in its X.224 Connection Confirm. */
export function parseConfirm(b: Uint8Array): X224Confirm {
  const n = tpktLength(b);
  if (n === null || b.length < n || b[5] !== 0xd0) throw new Error('Not an X.224 Connection Confirm');
  const end = 5 + b[4];
  if (end > n) throw new Error('Bad X.224 length');
  if (end - 8 >= 11) {
    const type = b[end - 8];
    const v = (b[end - 4] | (b[end - 3] << 8) | (b[end - 2] << 16) | (b[end - 1] << 24)) >>> 0;
    if (type === 0x02) return { ok: true, protocol: v };
    if (type === 0x03) return { ok: false, failure: v };
  }
  return { ok: true, protocol: PROTOCOL_RDP };
}

/** Why a server refused, in words (RDP_NEG_FAILURE codes). */
export function failureText(code: number): string {
  switch (code) {
    case 1: return 'The computer asks for a secure connection (TLS) that was not offered.';
    case 2: return 'The computer does not offer a secure connection (it has no certificate for Remote Desktop).';
    case 3: return 'The computer has no usable certificate for Remote Desktop.';
    case 4: return 'The computer cannot use the security this client asked for.';
    case 5: return 'The computer asks for Network Level Authentication. Switch it on for this connection.';
    case 6: return 'The computer asks for a smart card or Windows Hello sign-in, which Keeper cannot do in a tab.';
    default: return `The computer refused the connection (code ${code}).`;
  }
}

// ---------------------------------------------------------------- certificates

/** "AB:CD:…", the way Windows and most tools show a fingerprint. */
export function colonHex(bytes: Uint8Array): string {
  return [...bytes].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** The pin stored with a connection: "sha256/" and the certificate's SHA-256 in base64, as web consoles keep it. */
export const pinOf = (sha256: Uint8Array) => `sha256/${base64(sha256)}`;

function base64(b: Uint8Array): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '=') + (i + 2 < b.length ? A[n & 63] : '=');
  }
  return s;
}

export type CertVerdict = 'trusted' | 'pinned' | 'ask' | 'changed' | 'any';

/**
 * Whether to go on with a server's certificate:
 *  pinned  it is the one the person trusted for this connection;
 *  changed a different one was trusted before (Windows renews its own certificate every few months: ask again, with a warning);
 *  trusted the system trusts it for this name and nothing was pinned;
 *  any     the connection accepts any certificate;
 *  ask     first time: show the fingerprint and ask.
 */
export function certVerdict(o: { pin?: string; seen: string; systemTrusted: boolean; acceptAny?: boolean; trustedNow?: string }): CertVerdict {
  if (o.trustedNow && o.trustedNow === o.seen) return 'pinned';
  if (o.pin) return o.pin === o.seen ? 'pinned' : o.acceptAny ? 'any' : 'changed';
  if (o.systemTrusted) return 'trusted';
  if (o.acceptAny) return 'any';
  return 'ask';
}
