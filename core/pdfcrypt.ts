// SPDX-License-Identifier: AGPL-3.0-or-later
// PDF passwords without outside tools.
//
// Locking uses the modern standard (AES-256, revision 6), which every current
// PDF reader opens. Unlocking handles revisions 2–6 (RC4 40/128-bit, AES-128,
// AES-256) for files whose objects are not packed into encrypted object
// streams; for those, the caller can fall back to an external tool.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream, PDFString } from 'pdf-lib';

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

// ---------------------------------------------------------------- primitives

function sha(alg: 'sha256' | 'sha384' | 'sha512' | 'md5', ...parts: Buffer[]): Buffer {
  const h = createHash(alg);
  for (const p of parts) h.update(p);
  return h.digest();
}

function aesCbcNoPad(key: Buffer, iv: Buffer, data: Buffer, decrypt = false): Buffer {
  const alg = key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc';
  const c = decrypt ? createDecipheriv(alg, key, iv) : createCipheriv(alg, key, iv);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data), c.final()]);
}

function aesEncrypt(key: Buffer, data: Buffer): Buffer {
  const iv = randomBytes(16);
  const c = createCipheriv(key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc', key, iv);
  return Buffer.concat([iv, c.update(data), c.final()]);
}

function aesDecrypt(key: Buffer, data: Buffer): Buffer {
  if (data.length < 32 || data.length % 16 !== 0) {
    // Some writers leave empty strings unencrypted.
    if (data.length < 16) return Buffer.alloc(0);
  }
  const d = createDecipheriv(key.length === 16 ? 'aes-128-cbc' : 'aes-256-cbc', key, data.subarray(0, 16));
  try {
    return Buffer.concat([d.update(data.subarray(16)), d.final()]);
  } catch {
    d.setAutoPadding(false);
    return data.subarray(16);
  }
}

export function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

/** Revision 6 password hash (ISO 32000-2, algorithm 2.B). Revision 5 is plain SHA-256. */
export function hashR6(password: Buffer, salt: Buffer, udata: Buffer, revision = 6): Buffer {
  let k = sha('sha256', password, salt, udata);
  if (revision === 5) return k;
  for (let i = 0; ; ) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([password, k, udata])));
    const e = aesCbcNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let mod = 0;
    for (let b = 0; b < 16; b++) mod += e[b];
    k = sha((['sha256', 'sha384', 'sha512'] as const)[mod % 3], e);
    i++;
    if (i >= 64 && e[e.length - 1] <= i - 32) break;
  }
  return k.subarray(0, 32);
}

const utf8pw = (pw: string) => Buffer.from(pw.normalize('NFKC'), 'utf8').subarray(0, 127);
const latinPw = (pw: string) => Buffer.concat([Buffer.from(pw, 'latin1').subarray(0, 32), PAD]).subarray(0, 32);

// ---------------------------------------------------------------- walking objects

type Transform = (bytes: Buffer, ref: PDFRef) => Buffer;

function bytesOf(s: PDFString | PDFHexString): Buffer {
  return Buffer.from(s.asBytes());
}

function walk(obj: PDFObject, ref: PDFRef, fn: Transform, doc: PDFDocument): PDFObject {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(fn(bytesOf(obj), ref).toString('hex'));
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) obj.set(i, walk(obj.get(i), ref, fn, doc));
    return obj;
  }
  if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) obj.set(k, walk(v, ref, fn, doc));
    return obj;
  }
  return obj;
}

function isXrefOrSig(dict: PDFDict): boolean {
  const type = dict.get(PDFName.of('Type'));
  return type === PDFName.of('XRef') || type === PDFName.of('Sig');
}

/** Applies `fn` to every string and stream in the document except the encryption dictionary itself. */
function transformAll(doc: PDFDocument, encryptRef: PDFRef | undefined, fn: Transform, skipMetadata = false) {
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (encryptRef && ref.objectNumber === encryptRef.objectNumber && ref.generationNumber === encryptRef.generationNumber) continue;
    if (obj instanceof PDFRawStream) {
      if (isXrefOrSig(obj.dict)) continue;
      if (skipMetadata && obj.dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) continue;
      walk(obj.dict, ref, fn, doc);
      doc.context.assign(ref, PDFRawStream.of(obj.dict, new Uint8Array(fn(Buffer.from(obj.contents), ref))));
    } else if (obj instanceof PDFStream) {
      // Streams pdf-lib created itself (fonts, page contents) are flattened first.
      walk(obj.dict, ref, fn, doc);
    } else if (obj instanceof PDFDict) {
      if (isXrefOrSig(obj)) continue;
      walk(obj, ref, fn, doc);
    } else if (obj instanceof PDFArray) {
      walk(obj, ref, fn, doc);
    } else if (obj instanceof PDFString || obj instanceof PDFHexString) {
      doc.context.assign(ref, walk(obj, ref, fn, doc));
    }
  }
}

// ---------------------------------------------------------------- locking

/**
 * Encrypts a PDF with AES-256. `ownerPassword` defaults to the user password;
 * all permissions are granted to whoever has the password.
 */
export async function encryptPdf(bytes: Uint8Array, userPassword: string, ownerPassword = userPassword): Promise<Uint8Array> {
  if (!userPassword) throw new Error('Type the password');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error('This PDF already has a password');
  // pdf-lib keeps the streams it generated in memory; save once so everything is raw bytes.
  const flat = await PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false });

  const fileKey = randomBytes(32);
  const up = utf8pw(userPassword);
  const op = utf8pw(ownerPassword);
  const uvs = randomBytes(8);
  const uks = randomBytes(8);
  const U = Buffer.concat([hashR6(up, uvs, Buffer.alloc(0)), uvs, uks]);
  const UE = aesCbcNoPad(hashR6(up, uks, Buffer.alloc(0)), Buffer.alloc(16), fileKey);
  const ovs = randomBytes(8);
  const oks = randomBytes(8);
  const O = Buffer.concat([hashR6(op, ovs, U), ovs, oks]);
  const OE = aesCbcNoPad(hashR6(op, oks, U), Buffer.alloc(16), fileKey);
  const P = -4;
  const perms = Buffer.alloc(16);
  perms.writeInt32LE(P, 0);
  perms.writeUInt32LE(0xffffffff, 4);
  perms.write('Tadb', 8, 'latin1');
  randomBytes(4).copy(perms, 12);
  const cipher = createCipheriv('aes-256-ecb', fileKey, null);
  cipher.setAutoPadding(false);
  const Perms = Buffer.concat([cipher.update(perms), cipher.final()]);

  transformAll(flat, undefined, (b) => aesEncrypt(fileKey, b));

  const ctx = flat.context;
  const hex = (b: Buffer) => PDFHexString.of(b.toString('hex'));
  const encrypt = ctx.obj({
    Filter: 'Standard', V: 5, R: 6, Length: 256, P,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF', StrF: 'StdCF',
  }) as PDFDict;
  encrypt.set(PDFName.of('O'), hex(O));
  encrypt.set(PDFName.of('U'), hex(U));
  encrypt.set(PDFName.of('OE'), hex(OE));
  encrypt.set(PDFName.of('UE'), hex(UE));
  encrypt.set(PDFName.of('Perms'), hex(Perms));
  encrypt.set(PDFName.of('EncryptMetadata'), PDFBool.True);
  const encRef = ctx.register(encrypt);
  ctx.trailerInfo.Encrypt = encRef;
  const id = randomBytes(16);
  ctx.trailerInfo.ID = ctx.obj([hex(id), hex(id)]);
  return flat.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

// ---------------------------------------------------------------- unlocking

function str(dict: PDFDict, key: string): Buffer {
  const v = dict.get(PDFName.of(key));
  if (v instanceof PDFString || v instanceof PDFHexString) return bytesOf(v);
  return Buffer.alloc(0);
}

function num(dict: PDFDict, key: string, def = 0): number {
  const v = dict.get(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : def;
}

interface Handler {
  key: Buffer;
  revision: number;
  /** RC4 or AES for streams / strings */
  stm: 'rc4' | 'aes' | 'none';
  str: 'rc4' | 'aes' | 'none';
  encryptMetadata: boolean;
}

function cfMethod(enc: PDFDict, which: 'StmF' | 'StrF'): 'rc4' | 'aes' | 'none' {
  const v = num(enc, 'V');
  if (v < 4) return 'rc4';
  const name = enc.get(PDFName.of(which));
  if (!(name instanceof PDFName) || name.asString() === '/Identity') return 'none';
  const cf = enc.lookup(PDFName.of('CF'), PDFDict);
  const filter = cf.lookup(PDFName.of(name.asString().slice(1)), PDFDict);
  const cfm = filter?.get(PDFName.of('CFM'));
  const m = cfm instanceof PDFName ? cfm.asString() : '/V2';
  return m === '/AESV2' || m === '/AESV3' ? 'aes' : m === '/None' ? 'none' : 'rc4';
}

function legacyKey(pw: Buffer, enc: PDFDict, id0: Buffer, r: number, length: number, encryptMetadata: boolean): Buffer {
  const P = Buffer.alloc(4);
  P.writeInt32LE(num(enc, 'P'), 0);
  let k = sha('md5', pw, str(enc, 'O').subarray(0, 32), P, id0, r >= 4 && !encryptMetadata ? Buffer.from([255, 255, 255, 255]) : Buffer.alloc(0));
  const n = r === 2 ? 5 : length / 8;
  if (r >= 3) for (let i = 0; i < 50; i++) k = sha('md5', k.subarray(0, n));
  return k.subarray(0, n);
}

function checkLegacyUser(key: Buffer, enc: PDFDict, id0: Buffer, r: number): boolean {
  const U = str(enc, 'U');
  if (r === 2) return rc4(key, PAD).equals(U.subarray(0, 32));
  let x = rc4(key, sha('md5', PAD, id0));
  for (let i = 1; i <= 19; i++) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
  return x.subarray(0, 16).equals(U.subarray(0, 16));
}

function authenticate(enc: PDFDict, id0: Buffer, password: string): Handler {
  const r = num(enc, 'R');
  const encryptMetadata = enc.get(PDFName.of('EncryptMetadata')) !== PDFBool.False;
  const base = { revision: r, stm: cfMethod(enc, 'StmF'), str: cfMethod(enc, 'StrF'), encryptMetadata };
  if (r === 5 || r === 6) {
    const pw = utf8pw(password);
    const U = str(enc, 'U').subarray(0, 48);
    const O = str(enc, 'O').subarray(0, 48);
    if (hashR6(pw, U.subarray(32, 40), Buffer.alloc(0), r).equals(U.subarray(0, 32))) {
      return { ...base, key: aesCbcNoPad(hashR6(pw, U.subarray(40, 48), Buffer.alloc(0), r), Buffer.alloc(16), str(enc, 'UE').subarray(0, 32), true) };
    }
    if (hashR6(pw, O.subarray(32, 40), U, r).equals(O.subarray(0, 32))) {
      return { ...base, key: aesCbcNoPad(hashR6(pw, O.subarray(40, 48), U, r), Buffer.alloc(16), str(enc, 'OE').subarray(0, 32), true) };
    }
    throw new Error('Wrong password');
  }
  if (r < 2 || r > 4) throw new Error(`This PDF uses an unusual kind of protection (revision ${r})`);
  const length = r === 2 ? 40 : num(enc, 'Length', 40) || 40;
  // As the user password…
  const asUser = legacyKey(latinPw(password), enc, id0, r, length, encryptMetadata);
  if (checkLegacyUser(asUser, enc, id0, r)) return { ...base, key: asUser };
  // …or as the owner password, which unwraps the user password from /O.
  let ok = sha('md5', latinPw(password));
  const n = r === 2 ? 5 : length / 8;
  if (r >= 3) for (let i = 0; i < 50; i++) ok = sha('md5', ok);
  const okey = ok.subarray(0, n);
  let userPw: Buffer = str(enc, 'O').subarray(0, 32);
  if (r === 2) userPw = rc4(okey, userPw);
  else for (let i = 19; i >= 0; i--) userPw = rc4(Buffer.from(okey.map((b) => b ^ i)), userPw);
  const viaOwner = legacyKey(userPw, enc, id0, r, length, encryptMetadata);
  if (checkLegacyUser(viaOwner, enc, id0, r)) return { ...base, key: viaOwner };
  throw new Error('Wrong password');
}

function objectKey(h: Handler, ref: PDFRef, aes: boolean): Buffer {
  if (h.revision >= 5) return h.key;
  const b = Buffer.alloc(5);
  b.writeUIntLE(ref.objectNumber, 0, 3);
  b.writeUInt16LE(ref.generationNumber, 3);
  return sha('md5', h.key, b, aes ? Buffer.from('sAlT') : Buffer.alloc(0)).subarray(0, Math.min(h.key.length + 5, 16));
}

export function isPdfEncrypted(bytes: Uint8Array): boolean {
  // The trailer (or the cross-reference stream) names an /Encrypt dictionary.
  const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 4096))).toString('latin1');
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(Buffer.from(bytes).toString('latin1'));
}

/** Removes the password from a PDF. Throws "Wrong password" or a reason it cannot be done here. */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const encRef = doc.context.trailerInfo.Encrypt;
  if (!encRef) throw new Error('This PDF has no password');
  const enc = (encRef instanceof PDFRef ? doc.context.lookup(encRef, PDFDict) : encRef) as PDFDict;
  const filter = enc.get(PDFName.of('Filter'));
  if (!(filter instanceof PDFName) || filter.asString() !== '/Standard') throw new Error('This PDF uses certificate protection, which needs the original certificate');
  const ids = doc.context.trailerInfo.ID;
  const id0 = ids instanceof PDFArray && ids.size() ? bytesOf(ids.get(0) as PDFHexString) : Buffer.alloc(0);
  const h = authenticate(enc, id0, password);
  // Packed object streams were encrypted as a whole; pdf-lib could not have read inside them.
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Type')) === PDFName.of('ObjStm')) {
      throw new Error('PACKED');
    }
  }
  const strMethod = h.str;
  const stmMethod = h.stm;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (encRef instanceof PDFRef && ref.objectNumber === encRef.objectNumber) continue;
    const decStr: Transform = (b, r) => (strMethod === 'none' ? b : strMethod === 'aes' ? aesDecrypt(objectKey(h, r, true), b) : rc4(objectKey(h, r, false), b));
    if (obj instanceof PDFRawStream) {
      if (isXrefOrSig(obj.dict)) continue;
      walk(obj.dict, ref, decStr, doc);
      if (!h.encryptMetadata && obj.dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) continue;
      const content = Buffer.from(obj.contents);
      const plain = stmMethod === 'none' ? content : stmMethod === 'aes' ? aesDecrypt(objectKey(h, ref, true), content) : rc4(objectKey(h, ref, false), content);
      doc.context.assign(ref, PDFRawStream.of(obj.dict, new Uint8Array(plain)));
    } else if (obj instanceof PDFDict || obj instanceof PDFArray) {
      if (obj instanceof PDFDict && isXrefOrSig(obj)) continue;
      walk(obj, ref, decStr, doc);
    } else if (obj instanceof PDFString || obj instanceof PDFHexString) {
      doc.context.assign(ref, walk(obj, ref, decStr, doc));
    }
  }
  delete doc.context.trailerInfo.Encrypt;
  if (encRef instanceof PDFRef) doc.context.delete(encRef);
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}

/** Test helper: legacy AES-128 (revision 4) encryption, to prove the unlocker handles older files. */
export async function encryptPdfLegacyForTests(bytes: Uint8Array, password: string, mode: 'aes128' | 'rc4' = 'aes128'): Promise<Uint8Array> {
  const doc = await PDFDocument.load(await (await PDFDocument.load(bytes)).save({ useObjectStreams: false }));
  const r = mode === 'aes128' ? 4 : 3;
  const id0 = randomBytes(16);
  const pw = latinPw(password);
  // Owner key from the same password; O = RC4 chain of the padded user password.
  let ok = sha('md5', pw);
  for (let i = 0; i < 50; i++) ok = sha('md5', ok);
  const okey = ok.subarray(0, 16);
  let O: Buffer = pw;
  for (let i = 0; i <= 19; i++) O = rc4(Buffer.from(okey.map((b) => b ^ i)), O);
  const enc = doc.context.obj({ Filter: 'Standard', V: mode === 'aes128' ? 4 : 2, R: r, Length: 128, P: -4 }) as PDFDict;
  if (mode === 'aes128') {
    enc.set(PDFName.of('CF'), doc.context.obj({ StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV2', Length: 16 } }));
    enc.set(PDFName.of('StmF'), PDFName.of('StdCF'));
    enc.set(PDFName.of('StrF'), PDFName.of('StdCF'));
  }
  enc.set(PDFName.of('O'), PDFHexString.of(O.toString('hex')));
  const key = legacyKey(pw, enc, id0, r, 128, true);
  let U = rc4(key, sha('md5', PAD, id0));
  for (let i = 1; i <= 19; i++) U = rc4(Buffer.from(key.map((b) => b ^ i)), U);
  enc.set(PDFName.of('U'), PDFHexString.of(Buffer.concat([U, Buffer.alloc(16)]).toString('hex')));
  const h: Handler = { key, revision: r, stm: mode === 'aes128' ? 'aes' : 'rc4', str: mode === 'aes128' ? 'aes' : 'rc4', encryptMetadata: true };
  transformAll(doc, undefined, (b, ref) => (mode === 'aes128' ? aesEncrypt(objectKey(h, ref, true), b) : rc4(objectKey(h, ref, false), b)));
  const encRef = doc.context.register(enc);
  doc.context.trailerInfo.Encrypt = encRef;
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of(id0.toString('hex')), PDFHexString.of(id0.toString('hex'))]);
  return doc.save({ useObjectStreams: false });
}
