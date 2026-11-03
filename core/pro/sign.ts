// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Signing for Keeper Pro: Ed25519 and HMAC through Web Crypto, so the same code
// runs in the app (Node), in the command line and in the license server (a
// Cloudflare Worker). No dependencies.
//
// Every signed message starts with a purpose line ("keeper-license-v1\n",
// "keeper-pro-config-v1\n"), so a signature made for one kind of thing can never
// be passed off as another.

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error('This system has no Web Crypto');
  return c.subtle;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------- base64url

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Standard base64 (keys as the owner stores them) → bytes. */
export function unb64(text: string): Uint8Array {
  return unb64url(text.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

export const utf8 = (s: string) => enc.encode(s);
export const fromUtf8 = (b: Uint8Array) => dec.decode(b);

const buf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

// ---------------------------------------------------------------- Ed25519

/** Signs `purpose\nmessage` with a PKCS#8 Ed25519 private key (base64). Server side and tests only. */
export async function signEd25519(privateKeyPkcs8B64: string, purpose: string, message: string): Promise<string> {
  const key = await subtle().importKey('pkcs8', buf(unb64(privateKeyPkcs8B64)), { name: 'Ed25519' }, false, ['sign']);
  const sig = await subtle().sign({ name: 'Ed25519' }, key, buf(utf8(`${purpose}\n${message}`)));
  return b64url(new Uint8Array(sig));
}

/** True when any of the raw 32-byte public keys (base64) signed `purpose\nmessage`. */
export async function verifyEd25519(publicKeysB64: readonly string[], purpose: string, message: string, sigB64url: string): Promise<boolean> {
  let sig: Uint8Array;
  try {
    sig = unb64url(sigB64url);
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  for (const k of publicKeysB64) {
    try {
      const raw = unb64(k);
      if (raw.length !== 32) continue;
      const key = await subtle().importKey('raw', buf(raw), { name: 'Ed25519' }, false, ['verify']);
      if (await subtle().verify({ name: 'Ed25519' }, key, buf(sig), buf(utf8(`${purpose}\n${message}`)))) return true;
    } catch { /* a malformed key never verifies */ }
  }
  return false;
}

/** A new key pair: the public half (raw, base64) ships in the app; the private half (PKCS#8, base64) never enters the repository. */
export async function newKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = (await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey('raw', kp.publicKey));
  const priv = new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey));
  const std = (b: Uint8Array) => b64url(b).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url(b).length % 4)) % 4);
  return { publicKey: std(pub), privateKey: std(priv) };
}

// ---------------------------------------------------------------- hashes and HMAC

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await subtle().digest('SHA-256', buf(utf8(text))));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await subtle().importKey('raw', buf(utf8(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const d = new Uint8Array(await subtle().sign('HMAC', key, buf(utf8(message))));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compares two strings in time that does not depend on where they differ. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** The hash a license carries instead of an e-mail address: lower-cased, trimmed, SHA-256. */
export const emailHash = (email: string) => sha256Hex(`keeper-email-v1\n${email.trim().toLowerCase()}`);
