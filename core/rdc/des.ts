// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// DES, only for what VNC needs: the challenge-response sign-in ("VNC
// authentication") and the obfuscated passwords VNC tools keep in files. Both
// are weak by design of the protocol, which is why Keeper recommends reaching
// VNC through SSH or Keeper Link. Small and dependency-free; not for anything
// else. (Electron's crypto library does not always offer DES.)

const IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
const FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
const E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
const P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25];
const PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4];
const PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const S = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

const toBits = (b: Uint8Array): number[] => {
  const out: number[] = [];
  for (const x of b) for (let i = 7; i >= 0; i--) out.push((x >> i) & 1);
  return out;
};
const fromBits = (bits: number[]): Uint8Array => {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i++) out[i >> 3] |= bits[i] << (7 - (i & 7));
  return out;
};
const permute = (bits: number[], table: number[]) => table.map((p) => bits[p - 1]);
const rotl = (half: number[], n: number) => [...half.slice(n), ...half.slice(0, n)];

function subkeys(key: Uint8Array): number[][] {
  const k = permute(toBits(key), PC1);
  let c = k.slice(0, 28);
  let d = k.slice(28);
  const out: number[][] = [];
  for (const s of SHIFTS) {
    c = rotl(c, s);
    d = rotl(d, s);
    out.push(permute([...c, ...d], PC2));
  }
  return out;
}

function feistel(r: number[], k: number[]): number[] {
  const x = permute(r, E).map((b, i) => b ^ k[i]);
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    const six = x.slice(i * 6, i * 6 + 6);
    const v = S[i][(six[0] * 2 + six[5]) * 16 + six[1] * 8 + six[2] * 4 + six[3] * 2 + six[4]];
    for (let j = 3; j >= 0; j--) out.push((v >> j) & 1);
  }
  return permute(out, P);
}

function block(input: Uint8Array, keys: number[][]): Uint8Array {
  const b = permute(toBits(input), IP);
  let l = b.slice(0, 32);
  let r = b.slice(32);
  for (const k of keys) {
    const f = feistel(r, k);
    [l, r] = [r, l.map((x, i) => x ^ f[i])];
  }
  return fromBits(permute([...r, ...l], FP));
}

/** DES in ECB mode over whole 8-byte blocks. */
export function desEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const keys = subkeys(key);
  const out = new Uint8Array(data.length);
  for (let i = 0; i + 8 <= data.length; i += 8) out.set(block(data.subarray(i, i + 8), keys), i);
  return out;
}

export function desDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const keys = subkeys(key).reverse();
  const out = new Uint8Array(data.length);
  for (let i = 0; i + 8 <= data.length; i += 8) out.set(block(data.subarray(i, i + 8), keys), i);
  return out;
}

const reverseBits = (b: number) => {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
};

/** VNC's key: the password's first 8 bytes, each byte's bits reversed (as the reference viewer does). */
export function vncKey(password: string): Uint8Array {
  const key = new Uint8Array(8);
  const bytes = new TextEncoder().encode(password);
  for (let i = 0; i < 8 && i < bytes.length; i++) key[i] = reverseBits(bytes[i]);
  return key;
}

/** The answer to a VNC authentication challenge (16 bytes in, 16 out). */
export function vncResponse(password: string, challenge: Uint8Array): Uint8Array {
  return desEncrypt(vncKey(password), challenge.subarray(0, 16));
}

// The fixed key every VNC tool uses to scramble stored passwords (23, 82, 107, 6, 35, 78, 88, 7 in VNC's own bit order).
const FIXED = new Uint8Array([0xe8, 0x4a, 0xd6, 0x60, 0xc4, 0x72, 0x1a, 0xe0]);

/** The 8 bytes VNC tools keep in a password file (x11vnc -rfbauth, ~/.vnc/passwd) or a .vnc file. */
export function vncObfuscate(password: string): Uint8Array {
  const p = new Uint8Array(8);
  p.set(new TextEncoder().encode(password).subarray(0, 8));
  return desEncrypt(FIXED, p);
}

/** Reads a stored VNC password (hex as in .vnc files, or the raw 8 bytes). */
export function vncUnobfuscate(stored: string | Uint8Array): string {
  const bytes = typeof stored === 'string' ? new Uint8Array((stored.match(/../g) ?? []).map((h) => parseInt(h, 16))) : stored;
  if (bytes.length < 8) return '';
  const p = desDecrypt(FIXED, bytes.subarray(0, 8));
  const end = p.indexOf(0);
  return new TextDecoder('latin1').decode(end >= 0 ? p.subarray(0, end) : p);
}
