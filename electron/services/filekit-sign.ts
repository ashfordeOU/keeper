// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Digital signatures with X.509 certificates (PAdES-style, detached CMS),
// optional RFC 3161 trusted timestamps, and checking the signatures a PDF
// already carries. A personal certificate can be made on the spot.

import { createHash, createPrivateKey, generateKeyPairSync, webcrypto, X509Certificate } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { freeName, stemOf } from '../../core/convert';
import type { ConvertResult } from '../../core/convert-types';
import { exec, findTool } from './convert-extra';
import type { KitHelpers } from './filekit';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;
let engineSet = false;
function engine() {
  if (engineSet) return;
  pkijs.setEngine('node', new pkijs.CryptoEngine({ name: 'node', crypto: webcrypto as unknown as Crypto }));
  engineSet = true;
}

const PLACEHOLDER = 16384; // bytes kept for the signature (hex doubles it)
const BR_PLACE = '/ByteRange [0 /********** /********** /**********]';

const toAB = (b: Buffer | Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export interface SignerKeys { certs: Buffer[]; keyPkcs8: Buffer }

/** Certificate and private key from a .p12/.pfx (through OpenSSL) or PEM text. */
export async function loadSigner(file: string, password: string): Promise<SignerKeys> {
  let pem: string;
  if (/\.(p12|pfx)$/i.test(file)) {
    const openssl = await findTool(['openssl']);
    if (!openssl) throw new Error('Reading .p12/.pfx certificates needs OpenSSL; or export your certificate and key as PEM');
    let r = await exec(openssl, ['pkcs12', '-in', file, '-nodes', '-passin', 'stdin'], undefined, { input: `${password}\n` });
    // OpenSSL 3 needs -legacy for older files.
    if (r.code !== 0) r = await exec(openssl, ['pkcs12', '-legacy', '-in', file, '-nodes', '-passin', 'stdin'], undefined, { input: `${password}\n` });
    if (r.code !== 0) throw new Error(/mac verify|invalid password/i.test(r.stderr) ? 'The certificate password is wrong' : 'Could not open this certificate file');
    pem = r.stdout;
  } else pem = await fsp.readFile(file, 'utf8');
  const certs = [...pem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)].map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64'));
  const keyPem = pem.match(/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/)?.[0];
  if (!certs.length) throw new Error('No certificate was found in this file');
  if (!keyPem) throw new Error('No private key was found; signing needs the certificate together with its key');
  const key = createPrivateKey({ key: keyPem, passphrase: password || undefined });
  // The signer's certificate first: the one whose public key matches.
  const pub = key.asymmetricKeyType;
  const ordered = [...certs].sort((a) => (new X509Certificate(a).checkPrivateKey(key) ? -1 : 1));
  void pub;
  return { certs: ordered, keyPkcs8: key.export({ format: 'der', type: 'pkcs8' }) };
}

/** A personal (self-signed) certificate for document signing, valid three years. */
export async function makeSelfSigned(name: string, email = ''): Promise<{ pem: string; keys: SignerKeys }> {
  engine();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ valueHex: toAB(webcrypto.getRandomValues(new Uint8Array(16)).map((v, i) => (i === 0 ? v & 0x7f : v))) });
  const dn = (t: pkijs.RelativeDistinguishedNames) => {
    t.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: name }) }));
    if (email) t.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: '1.2.840.113549.1.9.1', value: new asn1js.IA5String({ value: email }) }));
  };
  dn(cert.subject);
  dn(cert.issuer);
  const now = new Date();
  cert.notBefore.value = new Date(now.getTime() - 60_000);
  cert.notAfter.value = new Date(now.getTime() + 3 * 365 * 86_400_000);
  const ku = new asn1js.BitString({ valueHex: new Uint8Array([0xc0]).buffer, unusedBits: 6 }); // digitalSignature, nonRepudiation
  cert.extensions = [
    new pkijs.Extension({ extnID: '2.5.29.15', critical: true, extnValue: ku.toBER(false), parsedValue: ku }),
    new pkijs.Extension({ extnID: '2.5.29.37', extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.4', '1.3.6.1.4.1.311.10.3.12'] }).toSchema().toBER(false) }),
  ];
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  cert.subjectPublicKeyInfo.fromSchema(asn1js.fromBER(toAB(spki)).result);
  const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' });
  const ck = await subtle.importKey('pkcs8', toAB(pkcs8), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  await cert.sign(ck, 'SHA-256');
  const der = Buffer.from(cert.toSchema(true).toBER(false));
  const wrap = (b: Buffer, label: string) => `-----BEGIN ${label}-----\n${b.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END ${label}-----\n`;
  return { pem: wrap(der, 'CERTIFICATE') + wrap(pkcs8, 'PRIVATE KEY'), keys: { certs: [der], keyPkcs8: pkcs8 } };
}

/** Adds an empty signature (field, widget and /Sig dictionary with room for the signature). */
async function prepare(pdf: Uint8Array, o: { reason?: string; location?: string; name?: string }): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: false, updateMetadata: false });
  const ctx = doc.context;
  const page = doc.getPage(0);
  const n = (doc.getForm().getFields().length + 1);
  const sig = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 9999999999, 9999999999, 9999999999],
    Contents: PDFHexString.of('0'.repeat(PLACEHOLDER * 2)),
    M: PDFString.fromDate(new Date()),
  } as never) as unknown as import('pdf-lib').PDFDict;
  if (o.reason) sig.set(PDFName.of('Reason'), PDFHexString.fromText(o.reason));
  if (o.location) sig.set(PDFName.of('Location'), PDFHexString.fromText(o.location));
  if (o.name) sig.set(PDFName.of('Name'), PDFHexString.fromText(o.name));
  const sigRef = ctx.register(sig);
  const widget = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], V: sigRef, T: PDFHexString.fromText(`Signature${n}`), F: 132, P: page.ref } as never);
  const widgetRef = ctx.register(widget);
  const annots = page.node.Annots();
  if (annots) annots.push(widgetRef); else page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
  const form = doc.getForm();
  void form;
  const acro = doc.catalog.lookup(PDFName.of('AcroForm')) as import('pdf-lib').PDFDict;
  const fields = acro.lookup(PDFName.of('Fields')) as import('pdf-lib').PDFArray;
  fields.push(widgetRef);
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  // Put the fixed-width placeholder text where pdf-lib wrote the numbers.
  const s = bytes.toString('latin1');
  const at = s.indexOf('/ByteRange [ 0 9999999999 9999999999 9999999999 ]');
  if (at < 0) throw new Error('Could not prepare the signature');
  const repl = BR_PLACE.padEnd('/ByteRange [ 0 9999999999 9999999999 9999999999 ]'.length, ' ');
  bytes.write(repl, at, 'latin1');
  return bytes;
}

async function timestamp(url: string, signature: ArrayBuffer): Promise<pkijs.ContentInfo> {
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({ hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: '2.16.840.1.101.3.4.2.1' }), hashedMessage: new asn1js.OctetString({ valueHex: toAB(createHash('sha256').update(Buffer.from(signature)).digest()) }) }),
    certReq: true,
    nonce: new asn1js.Integer({ valueHex: toAB(webcrypto.getRandomValues(new Uint8Array(8))) }),
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body: Buffer.from(req.toSchema().toBER(false)), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The timestamp server answered ${res.status}`);
  const resp = new pkijs.TimeStampResp({ schema: asn1js.fromBER(await res.arrayBuffer()).result });
  if (!resp.timeStampToken) throw new Error('The timestamp server did not give a timestamp');
  return resp.timeStampToken;
}

export async function signPdfWithCertificate(input: string, h: KitHelpers): Promise<ConvertResult> {
  engine();
  const a = h.args;
  const outputs: string[] = [];
  // A second signature must be added as an update after the first, which Keeper does not do yet;
  // re-saving would silently break the signature already there.
  if (findSignatures(await fsp.readFile(input)).length) throw new Error('This PDF is already signed. Adding a second signature would break the first one; sign the unsigned original instead');
  let keys: SignerKeys;
  let note = '';
  if (a.selfSigned) {
    const name = String(a.name ?? '').trim();
    const made = await makeSelfSigned(name);
    keys = made.keys;
    const certFile = freeName(h.outDir, `${name} signing certificate`, 'pem');
    await fsp.writeFile(certFile, made.pem, { mode: 0o600 });
    outputs.push(certFile);
    note = 'A personal certificate was made and saved next to the PDF: keep it private and choose it next time. Readers will show the signature as valid but “not trusted” until they trust this certificate.';
  } else keys = await loadSigner(String(a.cert), String(a.password ?? ''));
  const cert = new pkijs.Certificate({ schema: asn1js.fromBER(toAB(keys.certs[0])).result });
  const cn = cert.subject.typesAndValues.find((t) => t.type === '2.5.4.3')?.value.valueBlock.value as string | undefined;
  h.progress(0.2, 'Preparing');
  const prepared = await prepare(await fsp.readFile(input), { reason: String(a.reason ?? ''), location: String(a.location ?? ''), name: cn });
  const s = prepared.toString('latin1');
  const contentsAt = s.indexOf(`<${'0'.repeat(PLACEHOLDER * 2)}>`);
  if (contentsAt < 0) throw new Error('Could not prepare the signature');
  const start = contentsAt;
  const end = contentsAt + PLACEHOLDER * 2 + 2;
  const range = [0, start, end, prepared.length - end];
  const brAt = s.indexOf(BR_PLACE);
  const brText = `/ByteRange [${range.join(' ')}]`.padEnd(BR_PLACE.length, ' ');
  prepared.write(brText, brAt, 'latin1');
  const signedData = Buffer.concat([prepared.subarray(0, start), prepared.subarray(end)]);
  h.progress(0.5, 'Signing');
  const alg = createPrivateKey({ key: keys.keyPkcs8, format: 'der', type: 'pkcs8' }).asymmetricKeyType;
  const keyAlg = alg === 'ec' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await subtle.importKey('pkcs8', toAB(keys.keyPkcs8), keyAlg, false, ['sign']);
  const digest = createHash('sha256').update(signedData).digest();
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    signerInfos: [new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: [
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })] }),
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: toAB(digest) })] }),
        new pkijs.Attribute({ type: '1.2.840.113549.1.9.5', values: [new asn1js.UTCTime({ valueDate: new Date() })] }),
      ] }),
    })],
    certificates: keys.certs.map((c) => new pkijs.Certificate({ schema: asn1js.fromBER(toAB(c)).result })),
  });
  await sd.sign(key, 0, 'SHA-256');
  let stamped = '';
  const tsa = String(a.tsa ?? '').trim();
  if (tsa) {
    h.progress(0.7, 'Getting a trusted timestamp');
    const token = await timestamp(tsa, sd.signerInfos[0].signature.valueBlock.valueHexView.slice().buffer);
    sd.signerInfos[0].unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 1, attributes: [new pkijs.Attribute({ type: '1.2.840.113549.1.9.16.2.14', values: [token.toSchema()] })] });
    stamped = ' with a trusted timestamp';
  }
  const cms = Buffer.from(new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: sd.toSchema(true) }).toSchema().toBER(false));
  if (cms.length > PLACEHOLDER) throw new Error('The signature is larger than the space kept for it');
  prepared.write(cms.toString('hex').padEnd(PLACEHOLDER * 2, '0'), start + 1, 'latin1');
  const o = freeName(h.outDir, `${stemOf(input)} signed`, 'pdf');
  await fsp.writeFile(o, prepared);
  outputs.unshift(o);
  return { outputs, message: `Signed by ${cn ?? 'you'}${stamped}`, details: note || undefined };
}

interface Found { range: number[]; contents: Buffer; name?: string; reason?: string; time?: string }

function findSignatures(b: Buffer): Found[] {
  const s = b.toString('latin1');
  const out: Found[] = [];
  for (const m of s.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const range = m.slice(1, 5).map(Number);
    const hex = s.slice(range[1] + 1, range[2] - 1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) continue;
    // The dictionary around it, for the name and reason.
    const dictStart = s.lastIndexOf('<<', m.index!);
    const dict = s.slice(Math.max(0, dictStart - 2000), Math.min(s.length, (m.index ?? 0) + 600));
    const text = (k: string) => {
      const t = dict.match(new RegExp(`/${k}\\s*\\(([^)]*)\\)`))?.[1];
      if (t !== undefined) return t;
      const hx = dict.match(new RegExp(`/${k}\\s*<([0-9A-Fa-f]+)>`))?.[1];
      if (!hx) return undefined;
      const buf = Buffer.from(hx, 'hex');
      return buf[0] === 0xfe && buf[1] === 0xff ? buf.subarray(2).swap16().toString('utf16le') : buf.toString('latin1');
    };
    out.push({ range, contents: Buffer.from(hex.replace(/(00)+$/, ''), 'hex'), name: text('Name'), reason: text('Reason'), time: text('M') });
  }
  return out;
}

export async function verifyPdfSignatures(input: string): Promise<string> {
  engine();
  const b = await fsp.readFile(input);
  const sigs = findSignatures(b);
  if (!sigs.length) return 'This PDF has no digital signatures.';
  const lines: string[] = [];
  for (const [i, sg] of sigs.entries()) {
    const [a0, a1, b0, b1] = sg.range;
    const data = Buffer.concat([b.subarray(a0, a0 + a1), b.subarray(b0, b0 + b1)]);
    let der = sg.contents;
    // Trailing zero padding inside DER is harmless; find the real length.
    const parsed = asn1js.fromBER(toAB(der));
    if (parsed.offset > 0) der = der.subarray(0, parsed.offset);
    const ci = new pkijs.ContentInfo({ schema: parsed.result });
    const sd = new pkijs.SignedData({ schema: ci.content });
    const certs = (sd.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate);
    const si = sd.signerInfos[0];
    const signer = certs.find((c) => si.sid instanceof pkijs.IssuerAndSerialNumber && c.serialNumber.isEqual(si.sid.serialNumber)) ?? certs[0];
    const cn = signer?.subject.typesAndValues.find((t) => t.type === '2.5.4.3')?.value.valueBlock.value;
    const issuer = signer?.issuer.typesAndValues.find((t) => t.type === '2.5.4.3')?.value.valueBlock.value;
    let ok = false;
    let why = '';
    try {
      const r = await sd.verify({ signer: 0, data: toAB(data), checkChain: false, extendedMode: true });
      ok = !!(r as { signatureVerified?: boolean }).signatureVerified;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
      if (typeof e === 'object' && e && 'signatureVerified' in e) ok = !!(e as { signatureVerified?: boolean }).signatureVerified;
    }
    const whole = b0 + b1 === b.length;
    const signTime = si.signedAttrs?.attributes.find((x) => x.type === '1.2.840.113549.1.9.5')?.values[0] as asn1js.UTCTime | undefined;
    const tst = si.unsignedAttrs?.attributes.find((x) => x.type === '1.2.840.113549.1.9.16.2.14');
    let tsText = 'no trusted timestamp';
    if (tst) {
      try {
        const tci = new pkijs.ContentInfo({ schema: tst.values[0] });
        const tsd = new pkijs.SignedData({ schema: tci.content });
        const info = new pkijs.TSTInfo({ schema: asn1js.fromBER(tsd.encapContentInfo.eContent!.valueBlock.valueHexView.slice().buffer).result });
        tsText = `trusted timestamp ${info.genTime.toISOString()}`;
      } catch { tsText = 'a timestamp that could not be read'; }
    }
    const selfSigned = !!signer && cn === issuer;
    lines.push(`Signature ${i + 1}: ${ok ? '✓ intact' : '✕ broken'}${ok && !whole ? ' (the document was changed or added to after this signature)' : ''}`);
    lines.push(`  Signed by: ${cn ?? sg.name ?? 'unknown'}${issuer && !selfSigned ? ` (certificate from ${issuer})` : selfSigned ? ' (personal certificate, not from an authority)' : ''}`);
    if (signTime?.toDate) lines.push(`  Signed at: ${signTime.toDate().toISOString()}`);
    if (sg.reason) lines.push(`  Reason: ${sg.reason}`);
    lines.push(`  ${tsText[0].toUpperCase()}${tsText.slice(1)}`);
    if (signer) lines.push(`  Certificate valid ${signer.notBefore.value.toISOString().slice(0, 10)} to ${signer.notAfter.value.toISOString().slice(0, 10)}`);
    if (why && !ok) lines.push(`  ${why}`);
  }
  lines.push('', 'Intact means the signed bytes are unchanged and the signature matches the certificate. Whether to trust the certificate itself is up to you (or your PDF reader’s list of authorities).');
  return lines.join('\n');
}

/** For tests and the command line: a temporary self-signed PEM file. */
export async function tempSigner(name: string): Promise<string> {
  const p = path.join(os.tmpdir(), `keeper-cert-${process.pid}-${Date.now()}.pem`);
  if (!existsSync(p)) await fsp.writeFile(p, (await makeSelfSigned(name)).pem, { mode: 0o600 });
  return p;
}
