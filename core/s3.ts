// SPDX-License-Identifier: AGPL-3.0-or-later
// AWS Signature Version 4 for S3-compatible storage (AWS, Cloudflare R2,
// Backblaze B2, MinIO, …): signed PUT uploads and presigned download links that
// expire. Written from the published specification so no SDK is needed.

import { createHash, createHmac } from 'node:crypto';

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}

const sha256hex = (data: string | Buffer | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as SigV4 wants it ('/' kept in paths). */
export function uriEncode(s: string, keepSlash = false): string {
  return [...new TextEncoder().encode(s)]
    .map((b) => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/')) return c;
      return '%' + b.toString(16).toUpperCase().padStart(2, '0');
    })
    .join('');
}

export function amzDate(d: Date): { full: string; short: string } {
  const full = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { full, short: full.slice(0, 8) };
}

function signingKey(secret: string, short: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac('AWS4' + secret, short), region), service), 'aws4_request');
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&');
}

export interface SignInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  /** hex SHA-256 of the body, or 'UNSIGNED-PAYLOAD' */
  payloadHash: string;
  creds: S3Credentials;
  date?: Date;
  service?: string;
}

/** Returns the headers to send, including Authorization. */
export function signHeaders(i: SignInput): Record<string, string> {
  const service = i.service ?? 's3';
  const { full, short } = amzDate(i.date ?? new Date());
  const headers: Record<string, string> = { ...i.headers, host: i.url.host, 'x-amz-date': full, 'x-amz-content-sha256': i.payloadHash };
  if (i.creds.sessionToken) headers['x-amz-security-token'] = i.creds.sessionToken;
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const names = Object.keys(lower).sort();
  const query: Record<string, string> = {};
  i.url.searchParams.forEach((v, k) => (query[k] = v));
  const canonical = [
    i.method.toUpperCase(),
    uriEncode(decodeURIComponent(i.url.pathname), true) || '/',
    canonicalQuery(query),
    names.map((n) => `${n}:${lower[n]}\n`).join(''),
    names.join(';'),
    i.payloadHash,
  ].join('\n');
  const scope = `${short}/${i.creds.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', full, scope, sha256hex(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(i.creds.secretAccessKey, short, i.creds.region, service)).update(toSign).digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${i.creds.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

/** A GET link anyone can open until it expires (max 7 days). */
export function presignGet(url: URL, creds: S3Credentials, expiresSec: number, date = new Date(), service = 's3'): string {
  const { full, short } = amzDate(date);
  const scope = `${short}/${creds.region}/${service}/aws4_request`;
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));
  Object.assign(query, {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': full,
    'X-Amz-Expires': String(Math.max(1, Math.min(604_800, Math.round(expiresSec)))),
    'X-Amz-SignedHeaders': 'host',
  });
  if (creds.sessionToken) query['X-Amz-Security-Token'] = creds.sessionToken;
  const canonical = ['GET', uriEncode(decodeURIComponent(url.pathname), true), canonicalQuery(query), `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', full, scope, sha256hex(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, short, creds.region, service)).update(toSign).digest('hex');
  return `${url.origin}${uriEncode(decodeURIComponent(url.pathname), true)}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

/** https://endpoint/bucket/key (path style works with every S3-compatible service). */
export function objectUrl(endpoint: string, bucket: string, key: string): URL {
  const base = endpoint.replace(/\/+$/, '');
  return new URL(`${base}/${uriEncode(bucket)}/${uriEncode(key.replace(/^\/+/, ''), true)}`);
}

export { sha256hex };
