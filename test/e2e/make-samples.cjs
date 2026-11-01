// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage: node test/e2e/make-samples.cjs <folder>
// Generates one real file of every kind the previewer supports.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const K = require('path').resolve(__dirname, '../../node_modules') + '/';
const sharp = require(K + 'sharp');
const { PDFDocument, StandardFonts, rgb } = require(K + 'pdf-lib');
const JSZip = require(K + 'jszip');
const XLSX = require(K + 'xlsx');
const ffmpeg = require(K + 'ffmpeg-static');
const out = process.argv[2];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const w = (n, d) => fs.writeFileSync(path.join(out, n), d);

(async () => {
  const svgArt = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#6d6dff"/><stop offset="1" stop-color="#ff6fa3"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><circle cx="460" cy="150" r="80" fill="#fff" opacity=".4"/><text x="40" y="330" font-size="64" font-family="sans-serif" fill="#fff">Keeper</text></svg>`;
  const png = await sharp(Buffer.from(svgArt)).png().toBuffer();
  w('01 picture.png', png);
  w('02 photo.jpg', await sharp(png).jpeg({ quality: 90 }).withExif({ IFD0: { Make: 'Canon', Model: 'Canon EOS R5', Software: 'Keeper test' } }).toBuffer());
  w('03 drawing.svg', svgArt.replace('</svg>', '<script>document.title="pwned"; window.__pwned = true;</script><image href="https://example.com/track.png" width="1" height="1"/></svg>'));
  w('04 scan.tiff', await sharp(png).tiff().toBuffer());
  w('05 modern.webp', await sharp(png).webp().toBuffer());
  w('06 modern.avif', await sharp(png).avif().toBuffer());
  // A RAW file stand-in: a TIFF header with a big embedded JPEG preview.
  const big = await sharp(png).resize(1600).jpeg().toBuffer();
  const thumb = await sharp(png).resize(160).jpeg().toBuffer();
  w('07 camera.dng', Buffer.concat([Buffer.from('II*\0\x08\0\0\0', 'binary'), Buffer.alloc(400), thumb, Buffer.alloc(100), big, Buffer.alloc(64)]));
  // PDF
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const p = pdf.addPage([595, 842]);
    p.drawText(`Quarterly report — page ${i}`, { x: 60, y: 760, size: 26, font, color: rgb(0.2, 0.2, 0.5) });
    p.drawText(i === 2 ? 'The invoice total is 4,200 euros.' : 'Everything in its place.', { x: 60, y: 700, size: 14, font });
  }
  w('08 report.pdf', await pdf.save());
  // DOCX
  const docx = new JSZip();
  docx.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  docx.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docx.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Letter to the team</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Thanks for a </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>wonderful</w:t></w:r><w:r><w:t xml:space="preserve"> quarter.</w:t></w:r></w:p></w:body></w:document>');
  w('09 letter.docx', await docx.generateAsync({ type: 'nodebuffer' }));
  // XLSX
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Month', 'Revenue', 'Costs'], ['Jan', 1200, 800], ['Feb', 1500, 900], ['Mar', 1800, 950]]), 'Budget');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Team'], ['Ana', 'Design'], ['Jo', 'Code']]), 'People');
  w('10 budget.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  w('11 growth.csv', 'Month,Visitors,Signups\nJanuary,12400,310\nFebruary,13900,402\nMarch,"15,200",488\n');
  // PPTX (minimal)
  const pptx = new JSZip();
  pptx.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
  const slide = (title, body) => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="4400" b="1"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="2800"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  pptx.file('ppt/slides/slide1.xml', slide('Keeper launch', 'Everything in its place'));
  pptx.file('ppt/slides/slide2.xml', slide('Roadmap', 'Previews for every format'));
  w('12 deck.pptx', await pptx.generateAsync({ type: 'nodebuffer' }));
  // ODT
  const odt = new JSZip();
  odt.file('mimetype', 'application/vnd.oasis.opendocument.text');
  odt.file('content.xml', '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:h text:outline-level="1">Open document</text:h><text:p>Written in an open format.</text:p></office:text></office:body></office:document-content>');
  w('13 notes.odt', await odt.generateAsync({ type: 'nodebuffer' }));
  w('14 memo.rtf', '{\\rtf1\\ansi{\\fonttbl{\\f0 Helvetica;}}\\f0\\b Memo\\b0\\par Please review the plan by Friday.\\par}');
  // Archives
  const zip = new JSZip();
  zip.file('brand/readme.txt', 'Brand kit');
  zip.file('brand/logo.svg', svgArt);
  zip.file('brand/colours/palette.json', JSON.stringify({ primary: '#6d6dff' }));
  w('15 brand-kit.zip', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const tmp = fs.mkdtempSync('/tmp/kt-tar-');
  fs.mkdirSync(path.join(tmp, 'project/src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'project/src/main.py'), 'print("hello")\n');
  fs.writeFileSync(path.join(tmp, 'project/README.md'), '# Project\n');
  execFileSync('tar', ['-czf', path.join(out, '16 project.tar.gz'), '-C', tmp, 'project']);
  // Media
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(out, '17 clip.mp4')]);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25', '-t', '2', '-c:v', 'mpeg4', path.join(out, '18 old.avi')]);
  fs.writeFileSync(path.join(out, '17 clip.srt'), '1\n00:00:00,500 --> 00:00:02,500\nHello from the subtitles\n');
  fs.writeFileSync('/tmp/kt-cover.jpg', await sharp(png).resize(300).jpeg().toBuffer());
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-i', '/tmp/kt-cover.jpg', '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-id3v2_version', '3', '-metadata', 'title=Morning Light', '-metadata', 'artist=Ana Sol', '-metadata', 'album=Coast', '-disposition:v', 'attached_pic', path.join(out, '19 song.mp3')]);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=3', path.join(out, '20 tone.flac')]);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-c:a', 'pcm_s16be', path.join(out, '21 voice.aiff')]);
  // Fonts, 3D, mail, contacts, calendar, text
  const ttf = execFileSync('sh', ['-c', 'fc-list : file | grep -iE "\\.ttf" | head -1 || find /usr/share/fonts -name "*.ttf" | head -1']).toString().trim().replace(/:\s*$/, '');
  if (ttf) fs.copyFileSync(ttf, path.join(out, '22 font.ttf'));
  const tri = (a, b, c) => `facet normal 0 0 0\n outer loop\n  vertex ${a}\n  vertex ${b}\n  vertex ${c}\n endloop\nendfacet\n`;
  const v = ['0 0 0', '1 0 0', '1 1 0', '0 1 0', '0 0 1', '1 0 1', '1 1 1', '0 1 1'];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  w('23 cube.stl', 'solid cube\n' + faces.map(([a, b, c]) => tri(v[a], v[b], v[c])).join('') + 'endsolid cube\n');
  w('24 message.eml', ['From: Ana Sol <ana@example.com>', 'To: you@example.com', 'Subject: Lunch on Friday?', 'Date: Thu, 30 Oct 2026 10:00:00 +0000', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '', '--b', 'Content-Type: text/html; charset=utf-8', '', '<p>Hi! How about <b>lunch on Friday</b>?</p><img src="https://tracker.example.com/pixel.gif"><script>alert(1)</script>', '--b', 'Content-Type: text/plain; name="menu.txt"', 'Content-Disposition: attachment; filename="menu.txt"', '', 'Soup of the day', '--b--', ''].join('\r\n'));
  w('25 contact.vcf', 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana Sol\r\nORG:Keeper\r\nTEL;TYPE=CELL:+351 900 000 000\r\nEMAIL:ana@example.com\r\nEND:VCARD\r\n');
  w('26 events.ics', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20261106T100000Z\r\nDTEND:20261106T110000Z\r\nSUMMARY:Launch review\r\nLOCATION:Room 4\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  w('27 readme.md', '# Samples\n\nA **Markdown** file with a table:\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```python\nprint("hi")\n```\n\n![remote](https://example.com/x.png)\n');
  w('28 data.json', JSON.stringify({ name: 'keeper', list: [1, 2, 3], nested: { ok: true, none: null } }, null, 2));
  w('29 notebook.ipynb', JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# Analysis'] }, { cell_type: 'code', execution_count: 1, source: ['x = 21 * 2\n', 'print(x)'], outputs: [{ output_type: 'stream', name: 'stdout', text: ['42\n'] }, { output_type: 'display_data', data: { 'image/png': png.toString('base64') } }] }], metadata: { kernelspec: { display_name: 'Python 3', language: 'python' }, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 }));
  w('30 server.log', '2026-10-30 09:00:01 INFO Server started\n2026-10-30 09:00:05 WARN Slow request\n2026-10-30 09:00:09 ERROR Disk full\n');
  w('31 page.html', '<!doctype html><html><head><script>window.parent.__pwned=1</script></head><body><h1>Hello page</h1><img src="https://example.com/x.png"><p>Rendered safely.</p></body></html>');
  w('32 code.py', 'def greet(name: str) -> str:\n    """Say hello."""\n    return f"Hello {name}"\n\nprint(greet("Keeper"))\n');
  // SQLite
  const initSqlJs = require(K + 'sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, team TEXT); INSERT INTO people (name, team) VALUES ("Ana", "Design"), ("Jo", "Code");');
  w('33 app.sqlite', Buffer.from(db.export()));
  w('34 mystery.bin', Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 37) % 256)));
  w('35 subtitles.srt', '1\n00:00:01,000 --> 00:00:03,000\nFirst line\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\n');
  console.log(fs.readdirSync(out).length, 'files in', out);
})();
