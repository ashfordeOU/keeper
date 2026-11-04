// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Rich signatures and how each account writes: cleaning, pictures as
// attached (cid:) pictures, the default per kind of message, the account's
// style and quote, and signatures read from other apps' files.

import { describe, expect, it } from 'vitest';
import { appleSignatureNames, assembleStyled, cleanStyle, fromGmailSendAs, fromHtmFile, fromMailSignatureFile, fromThunderbirdPrefs, inlineImages, pickSignature, replyMode, sanitizeSignature, signaturesOf, styleCss, textSignature } from '../core/pim/signatures';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('cleaning a signature', () => {
  it('keeps formatting, tables, links and pictures, and removes everything risky', () => {
    const dirty = `<html><head><style>body{}</style></head><body><table cellpadding="0" onclick="x()"><tr><td valign="top" width="60"><img src="data:image/png;base64,${PNG}" width="48" onerror="steal()" alt="Logo"></td>
      <td><font face="Georgia" color="#336699" size="3">Ana López</font><br><a href="https://studio.example" style="color:#c00;background:url(https://t.example/x)">studio.example</a>
      <a href="javascript:alert(1)">bad</a> <a href="tel:+441234">call</a><script>alert(1)</script><iframe src="x"></iframe><svg><a href="x"/></svg>
      <img src="http://plain.example/logo.png"><img src="https://cdn.example/logo.png"><form><input></form></td></tr></table></body></html>`;
    const c = sanitizeSignature(dirty);
    expect(c).not.toMatch(/script|onclick|onerror|iframe|svg|javascript:|url\(|<form|<input|http:\/\/plain/);
    expect(c).toContain(`<img src="data:image/png;base64,${PNG}" alt="Logo" width="48">`);
    expect(c).toContain('<span style="font-family:Georgia;color:#336699;font-size:16px">Ana López</span>');
    expect(c).toContain('<a href="https://studio.example" style="color:#c00">studio.example</a>');
    expect(c).toContain('<a href="tel:+441234">call</a>');
    expect(c).toContain('<img src="https://cdn.example/logo.png">');
    expect(c).toContain('<td width="60" valign="top">');
  });
  it('keeps only harmless CSS', () => {
    expect(cleanStyle('color: red; position: fixed; background-image: url(x); font-size: 12px; width: expression(1)')).toBe('color:red;font-size:12px');
  });
  it('turns an older plain signature into HTML', () => {
    expect(textSignature('Ana <ana@x>\nStudio')).toBe('Ana &lt;ana@x&gt;<br>Studio');
    expect(signaturesOf({ signature: 'Ana' })).toEqual([{ id: 'sig', name: 'Signature', html: 'Ana' }]);
  });
});

describe('choosing a signature', () => {
  const ident = { signatures: [{ id: 'a', name: 'Full', html: 'Full' }, { id: 'b', name: 'Short', html: 'Short' }], signatureDefaults: { reply: 'b', forward: '' } };
  it('uses the default for each kind of message', () => {
    expect(pickSignature(ident, 'new')?.id).toBe('a');
    expect(pickSignature(ident, 'reply')?.id).toBe('b');
    expect(pickSignature(ident, 'forward')).toBeUndefined();
    expect(pickSignature({ signatures: ident.signatures }, 'reply', false)).toBeUndefined();
    expect(pickSignature({ signatures: ident.signatures, signatureDefaults: { reply: 'b' } }, 'reply', false)?.id).toBe('b');
    expect(pickSignature(undefined, 'new')).toBeUndefined();
  });
  it('answers everyone when the account prefers Reply All', () => {
    expect(replyMode({ compose: { replyAll: true } }, 'reply')).toBe('replyAll');
    expect(replyMode({}, 'reply')).toBe('reply');
  });
});

describe('pictures in signatures', () => {
  it('become attached pictures, the same one once', () => {
    const { html, parts } = inlineImages(`<p><img src="data:image/png;base64,${PNG}"></p><img alt="x" src="data:image/png;base64,${PNG}"><img src="data:image/jpeg;base64,AAAA">`, 'm1');
    expect(html).toBe('<p><img src="cid:sig1.m1@keeper"></p><img alt="x" src="cid:sig1.m1@keeper"><img src="cid:sig2.m1@keeper">');
    expect(parts).toEqual([
      { cid: 'sig1.m1@keeper', filename: 'picture-1.png', contentType: 'image/png', content: PNG },
      { cid: 'sig2.m1@keeper', filename: 'picture-2.jpg', contentType: 'image/jpeg', content: 'AAAA' },
    ]);
  });
});

describe('how an account writes', () => {
  const sig = { id: 'a', name: 'S', html: '<b>Ana</b><br>Studio' };
  it('wraps what you wrote in the account’s font, size and colour', () => {
    expect(styleCss({ font: 'serif', size: '14px', color: '#223344' })).toBe('font-family:Georgia, "Times New Roman", serif;font-size:14px;color:#223344');
    expect(styleCss({ color: 'red;background:url(x)' })).toBe('');
  });
  it('puts the signature under the text and the quote above or below', () => {
    const above = assembleStyled({ html: '<p>Hi</p>', text: 'Hi', signature: sig, quotedText: '> old', style: { size: '14px' } });
    expect(above.text).toBe('Hi\n\n-- \nAna\nStudio\n\n> old');
    expect(above.html).toMatch(/^<div style="font-size:14px"><p>Hi<\/p><\/div><br><div class="keeper-signature">-- <br><b>Ana<\/b><br>Studio<\/div><br><blockquote/);
    const below = assembleStyled({ html: '<p>Hi</p>', text: 'Hi', quotedText: '> old', style: { quote: 'below' } });
    expect(below.text).toBe('> old\n\nHi');
    expect(below.html!.indexOf('blockquote')).toBeLessThan(below.html!.indexOf('<p>Hi'));
    expect(assembleStyled({ html: '<p>Hi</p>', text: 'Hi', signature: sig, style: { format: 'plain' } })).toEqual({ text: 'Hi\n\n-- \nAna\nStudio' });
  });
});

describe('signatures from other apps', () => {
  it('reads a web mail’s send-from addresses', () => {
    const got = fromGmailSendAs({ sendAs: [{ sendAsEmail: 'ana@gmail.example', displayName: 'Ana', isPrimary: true, isDefault: true, signature: '<div dir="ltr"><b>Ana</b><script>x</script></div>' }, { sendAsEmail: 'sales@studio.example', replyToAddress: 'team@studio.example' }] });
    expect(got[0]).toMatchObject({ email: 'ana@gmail.example', name: 'Ana', isDefault: true, signature: { html: '<div><b>Ana</b></div>' } });
    expect(got[1]).toMatchObject({ email: 'sales@studio.example', replyTo: 'team@studio.example', signature: undefined });
  });
  it('reads a .mailsignature file and the names list', () => {
    const file = 'Content-Transfer-Encoding: quoted-printable\nContent-Type: text/html;\n\tcharset=utf-8\nMessage-Id: <x>\nMime-Version: 1.0\n\n<div>L=C3=B3pez <b>Studio</b></div>';
    expect(fromMailSignatureFile(file)).toBe('<div>López <b>Studio</b></div>');
    expect(appleSignatureNames('<plist><array><dict><key>SignatureIsRich</key><true/><key>SignatureName</key><string>Work &amp; more</string><key>SignatureUniqueId</key><string>ABC-1</string></dict></array></plist>')).toEqual({ 'ABC-1': 'Work & more' });
  });
  it('reads Thunderbird’s identities and a saved web page', () => {
    const prefs = ['user_pref("mail.identity.id1.useremail", "ana@example.org");', 'user_pref("mail.identity.id1.fullName", "Ana");', 'user_pref("mail.identity.id1.htmlSigFormat", true);', 'user_pref("mail.identity.id1.htmlSigText", "<b>Ana</b>\\n<i>Studio</i>");',
      'user_pref("mail.identity.id2.useremail", "plain@example.org");', 'user_pref("mail.identity.id2.htmlSigText", "Plain <me>");', 'user_pref("mail.identity.id3.useremail", "file@example.org");', 'user_pref("mail.identity.id3.attach_signature", true);', 'user_pref("mail.identity.id3.sig_file-rel", "[ProfD]sig.html");'].join('\n');
    const got = fromThunderbirdPrefs(prefs);
    expect(got.find((x) => x.id === 'id1')).toMatchObject({ email: 'ana@example.org', name: 'Ana', html: '<b>Ana</b>\n<i>Studio</i>' });
    expect(got.find((x) => x.id === 'id2')!.html).toBe('Plain &lt;me&gt;');
    expect(got.find((x) => x.id === 'id3')!.file).toBe('sig.html');
    expect(fromHtmFile('<html><body><p class=MsoNormal>Regards<o:p></o:p></p></body></html>')).toBe('<p>Regards</p>');
  });
});

describe('signatures in the main process', () => {
  it('reads a Google account’s send-from signatures from its settings (stand-in server)', async () => {
    const http = await import('node:http');
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(`${req.headers.authorization} ${req.url}`);
      if (req.url !== '/gmail/v1/users/me/settings/sendAs') { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sendAs: [{ sendAsEmail: 'ana@gmail.example', isDefault: true, signature: '<div><img src="https://cdn.example/logo.png"><b>Ana</b><img src=x onerror=alert(1)></div>' }] }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const mod = await import('../electron/services/pim/signature-import');
    mod.GMAIL_API.base = `http://127.0.0.1:${(server.address() as { port: number }).port}/gmail/v1`;
    try {
      const got = await mod.gmailSendAs('tok-1');
      expect(seen).toEqual(['Bearer tok-1 /gmail/v1/users/me/settings/sendAs']);
      expect(got[0].signature?.html).toBe('<div><img src="https://cdn.example/logo.png"><b>Ana</b></div>');
    } finally {
      server.close();
    }
  });

  it('finds Thunderbird signatures in a profile', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-sig-'));
    const root = process.platform === 'darwin' ? path.join(home, 'Library/Thunderbird') : path.join(home, '.thunderbird');
    fs.mkdirSync(path.join(root, 'p1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'profiles.ini'), '[Profile0]\nName=default\nIsRelative=1\nPath=p1\nDefault=1\n');
    fs.writeFileSync(path.join(root, 'p1', 'prefs.js'), 'user_pref("mail.identity.id1.useremail", "ana@example.org");\nuser_pref("mail.identity.id1.attach_signature", true);\nuser_pref("mail.identity.id1.sig_file-rel", "[ProfD]sig.html");\n');
    fs.writeFileSync(path.join(root, 'p1', 'sig.html'), '<p>Ana <a href="https://studio.example">Studio</a></p>');
    const { localSignatures } = await import('../electron/services/pim/signature-import');
    try {
      const got = await localSignatures(home);
      expect(got).toEqual([{ source: 'Thunderbird', name: 'ana@example.org', html: '<p>Ana <a href="https://studio.example">Studio</a></p>', email: 'ana@example.org' }]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('sends pictures inside a signature as attached pictures the HTML points to', async () => {
    const { compose } = await import('../electron/services/pim/mail');
    const { simpleParser } = await import('mailparser');
    const sig = { id: 's', name: 'S', html: sanitizeSignature(`<p><img src="data:image/png;base64,${PNG}" alt="Logo"> Ana</p>`) };
    const out = assembleStyled({ html: '<p>Hello</p>', text: 'Hello', signature: sig, style: { font: 'serif' } });
    const { html, parts } = inlineImages(out.html!, 't');
    const { raw } = await compose({ from: { address: 'ana@example.org' }, to: [{ address: 'ben@example.org' }], cc: [], bcc: [], subject: 'Hi', text: out.text, html, attachments: parts.map((p) => ({ filename: p.filename, content: p.content, encoding: 'base64', contentType: p.contentType, cid: p.cid })) as never });
    const parsed = await simpleParser(raw, { keepCidLinks: true });
    expect(parsed.html).toContain('src="cid:sig1.t@keeper"');
    expect(parsed.html).toContain('font-family:Georgia');
    expect(parsed.html).not.toContain('data:image');
    const img = parsed.attachments.find((a) => a.contentId === '<sig1.t@keeper>');
    expect(img?.contentType).toBe('image/png');
    expect(img?.content.toString('base64')).toBe(PNG);
    expect(parsed.text).toContain('-- \nAna');
  });
});
