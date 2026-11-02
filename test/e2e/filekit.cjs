// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Usage (Linux): xvfb-run -a node test/e2e/filekit.cjs /tmp/kf /tmp/kf-shots
// Drives the real Keeper app through the file kit: a saved workflow (merge →
// page numbers → watermark → compress), comparing two PDFs, EPUB to PDF with
// the app's own printer, CSV → XLSX → JSON, "Convert to…" from the file menu,
// and previews of a 3D model and a DXF drawing. Screenshots in light and dark.
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOME = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3]);
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
for (const d of ['Documents', 'Downloads', 'Pictures', 'Desktop']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
const S = path.join(HOME, 'Documents', 'kit');
fs.mkdirSync(S, { recursive: true });
const F = (...p) => path.join(S, ...p);
const has = (cmd) => { try { execFileSync('which', [cmd]); return true; } catch { return false; } };
const pdfText = (f) => (has('pdftotext') ? execFileSync('pdftotext', [f, '-']).toString() : '');
const pages = (f) => Number((execFileSync('pdfinfo', [f]).toString().match(/Pages:\s+(\d+)/) || [])[1]);
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) process.exitCode = 1; };

async function fixtures() {
  const { PDFDocument, StandardFonts } = require(path.join(ROOT, 'node_modules/pdf-lib'));
  const mk = async (name, list) => {
    const d = await PDFDocument.create();
    const f = await d.embedFont(StandardFonts.Helvetica);
    for (const lines of list) { const p = d.addPage([595, 842]); lines.forEach((l, i) => p.drawText(l, { x: 72, y: 760 - i * 20, size: i ? 12 : 22, font: f })); }
    fs.writeFileSync(F(name), await d.save());
  };
  await mk('chapter 1.pdf', [['Chapter one', 'It starts here.'], ['Still chapter one', 'More words.']]);
  await mk('chapter 2.pdf', [['Chapter two', 'The quick brown fox jumps over the lazy dog.']]);
  await mk('chapter 2 revised.pdf', [['Chapter two', 'The quick red fox jumps over the lazy cat.']]);
  fs.writeFileSync(F('stock.csv'), 'item,qty,price\nApple,3,1.20\n"Pear, green",5,0.80\nPlum,7,2.10\n');
  // A small EPUB.
  const JSZip = require(path.join(ROOT, 'node_modules/jszip'));
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  z.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  z.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Small Book</dc:title><dc:identifier id="id">kb1</dc:identifier></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>');
  z.file('OEBPS/c1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>First chapter</h1><p>It was a bright cold day in April.</p></body></html>');
  z.file('OEBPS/c2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Second chapter</h1><p>And the clocks were striking thirteen.</p></body></html>');
  fs.writeFileSync(F('small book.epub'), await z.generateAsync({ type: 'nodebuffer' }));
  // A DXF floor plan and a 3D model.
  const dxf = ['0', 'SECTION', '2', 'ENTITIES'];
  const line = (x1, y1, x2, y2, layer = 'walls') => dxf.push('0', 'LINE', '8', layer, '10', x1, '20', y1, '11', x2, '21', y2);
  line(0, 0, 400, 0); line(400, 0, 400, 300); line(400, 300, 0, 300); line(0, 300, 0, 0); line(200, 0, 200, 300);
  dxf.push('0', 'CIRCLE', '8', 'furniture', '10', '100', '20', '150', '40', '40');
  dxf.push('0', 'ARC', '8', 'doors', '10', '200', '20', '120', '40', '50', '50', '0', '51', '90');
  dxf.push('0', 'TEXT', '8', 'labels', '10', '40', '20', '260', '40', '16', '1', 'Living room');
  dxf.push('0', 'TEXT', '8', 'labels', '10', '240', '20', '260', '40', '16', '1', 'Kitchen');
  dxf.push('0', 'ENDSEC', '0', 'EOF');
  fs.writeFileSync(F('floor plan.dxf'), dxf.join('\n') + '\n');
  // An octahedron as STL.
  const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const faces = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  fs.writeFileSync(F('gem.stl'), `solid gem\n${faces.map((f) => `facet normal 0 0 0\nouter loop\n${f.map((i) => `vertex ${v[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid gem\n`);
}

(async () => {
  await fixtures();
  const app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/.bin/electron'), args: [ROOT, '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env: { ...process.env, KEEPER_DEFAULTS: 'before-1.0', HOME, NODE_OPTIONS: '', XDG_CONFIG_HOME: HOME + '/.config', XDG_DATA_HOME: HOME + '/.local/share' } });
  const errors = [];
  let main;
  for (let i = 0; i < 60 && !main; i++) {
    main = app.windows().find((w) => w.url().includes('view=app'));
    if (!main) await new Promise((r) => setTimeout(r, 500));
  }
  main.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await main.setViewportSize({ width: 1360, height: 900 }).catch(() => undefined);
  await main.waitForTimeout(2500);
  const skipTour = async () => { for (const label of ['Skip tour', 'Got it']) { const b = main.locator('button', { hasText: label }); if (await b.count()) await b.first().click().catch(() => undefined); } };
  await skipTour();
  const run = (op, inputs, extra = {}) => main.evaluate(([o, i, x]) => window.keeper.convert.run({ op: o, inputs: i, ...x }), [op, inputs, extra]);
  const nav = (r) => app.evaluate(({ BrowserWindow }, route) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('event:navigate', route)), r);
  const shot = async (name) => {
    for (const dark of [false, true]) {
      await main.evaluate((d) => window.keeper.settings.set({ appearance: d ? 'dark' : 'light' }), dark);
      await main.waitForTimeout(600);
      await main.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
    }
    await main.evaluate(() => window.keeper.settings.set({ appearance: 'light' }));
  };

  // ---- a saved workflow: merge → page numbers → watermark → compress
  const flow = { id: 'e2e-pack', name: 'Pack chapters', created: Date.now(), steps: [
    { id: 's1', op: { tool: 'pdf.merge' } },
    { id: 's2', op: { tool: 'pdf.number', position: 'bottom-center', start: 1 } },
    { id: 's3', op: { tool: 'pdf.watermark', text: 'CONFIDENTIAL', opacity: 0.2 } },
    { id: 's4', op: { tool: 'pdf.compress', quality: 60, maxSide: 1600 } },
  ], outDir: path.join(HOME, 'Documents', 'packed') };
  const saved = await main.evaluate((w) => window.keeper.filekit.saveWorkflow(w), flow);
  check(saved.some((w) => w.id === 'e2e-pack'), 'the workflow is saved');
  const fr = await main.evaluate(([id, i]) => window.keeper.filekit.runWorkflow(id, i), ['e2e-pack', [F('chapter 1.pdf'), F('chapter 2.pdf')]]);
  const packed = fr.outputs[0];
  const ptxt = pdfText(packed);
  check(fr.outputs.length === 1 && pages(packed) === 3, `the workflow makes one 3-page PDF (${fr.message})`);
  check(/CONFIDENTIAL/.test(ptxt.replace(/\s+/g, '')) && /Chapter one/.test(ptxt) && /Chapter two/.test(ptxt), 'merged, with the watermark on the pages');
  check(/\b3\b/.test(ptxt), 'page numbers are on the pages');
  const listed = await main.evaluate(() => window.keeper.filekit.workflows());
  check(listed.find((w) => w.id === 'e2e-pack')?.lastRun?.ok === true, 'the last run is remembered');

  // ---- compare two PDFs
  const cmp = await run({ tool: 'pdf.compare', args: { visual: true } }, [F('chapter 2.pdf'), F('chapter 2 revised.pdf')]);
  check(/2 words added, 2 removed/.test(cmp.message || ''), `comparing finds the changed words (${cmp.message})`);
  check(cmp.outputs.some((o) => /differences\.png$/.test(o)), 'and shows where the page looks different (the app draws the pages)');
  check(/<del>brown<\/del> <ins>red<\/ins>/.test(fs.readFileSync(cmp.outputs[0], 'utf8')), 'the report marks removed and added words');

  // ---- EPUB → PDF with the app's own printer
  const ep = await run({ tool: 'convert.to', args: { format: 'pdf' } }, [F('small book.epub')]);
  const eptxt = pdfText(ep.outputs[0]);
  check(/First chapter/.test(eptxt) && /striking thirteen/.test(eptxt), `the e-book becomes a PDF with both chapters (${ep.message})`);

  // ---- CSV → XLSX → JSON
  const x = await run({ tool: 'convert.to', args: { format: 'xlsx' } }, [F('stock.csv')]);
  check(fs.readFileSync(x.outputs[0]).subarray(0, 2).toString() === 'PK', 'CSV becomes an Excel file');
  const j = await run({ tool: 'convert.to', args: { format: 'json' } }, [x.outputs[0]]);
  const rows = JSON.parse(fs.readFileSync(j.outputs[0], 'utf8'));
  check(rows.length === 3 && rows[1].item === 'Pear, green' && rows[2].qty === 7, 'and the spreadsheet becomes JSON with the same rows');

  // ---- DXF and 3D model through Convert to…
  const svg = await run({ tool: 'convert.to', args: { format: 'pdf' } }, [F('floor plan.dxf')]);
  check(/Living room/.test(pdfText(svg.outputs[0])), `the drawing becomes a PDF with its labels (${svg.message})`);
  const glb = await run({ tool: 'convert.to', args: { format: 'glb' } }, [F('gem.stl')]);
  check(fs.readFileSync(glb.outputs[0]).subarray(0, 4).toString() === 'glTF', 'STL becomes glTF');

  // ---- screens: Convert to… from the file menu
  await nav('browse:' + S);
  await main.waitForSelector('.file-card, .file-list tbody tr', { timeout: 20000 });
  await main.waitForTimeout(1200);
  await skipTour();
  const card = main.locator('.file-card, .file-list tbody tr', { hasText: 'stock.csv' }).first();
  await card.click({ button: 'right' });
  await main.waitForTimeout(300);
  const item = main.locator('.menu button', { hasText: 'Convert to…' });
  check(await item.count() > 0, 'the file menu has “Convert to…”');
  await item.first().click();
  await main.waitForTimeout(900);
  check(await main.locator('.conv-panel h2', { hasText: 'Convert to…' }).count() > 0, 'it opens Convert to… with the file');
  const formats = await main.locator('.kit-format b').allTextContents();
  check(['.xlsx', '.json', '.yaml', '.sqlite'].every((f) => formats.includes(f)), `the formats a CSV can become are offered (${formats.join(' ')})`);
  await main.locator('.kit-format', { hasText: '.yaml' }).first().click();
  await shot('convert-to');
  await main.locator('.conv-panel button.primary', { hasText: 'Run' }).click();
  await main.waitForSelector('.conv-result .conv-out', { timeout: 30000 });
  check(await main.locator('.conv-out', { hasText: 'stock.yaml' }).count() > 0, 'running it makes stock.yaml');
  await shot('convert-to-done');

  // ---- the PDF tools list and an option form
  await main.locator('.conv-cats button', { hasText: 'PDF' }).click();
  await main.waitForTimeout(400);
  const pdfTools = await main.locator('.conv-tool b').allTextContents();
  check(['Pages per sheet', 'Booklet', 'Compare', 'Bates numbers', 'Digital signature (certificate)', 'Sanitize', 'Tables out of PDFs', 'Prepare for AI'].every((t) => pdfTools.includes(t)), `the PDF tools are listed (${pdfTools.length})`);
  await main.locator('.conv-find').fill('header');
  await main.waitForTimeout(300);
  check(await main.locator('.conv-tool').count() === 1, 'the tool finder narrows the list');
  await main.locator('.conv-tool', { hasText: 'Header and footer' }).first().click();
  await main.waitForTimeout(400);
  await shot('pdf-header-footer');

  // ---- the workflow editor
  await main.locator('.conv-cats button', { hasText: 'Workflows' }).click();
  await main.waitForTimeout(500);
  await main.locator('.conv-tool', { hasText: 'Pack chapters' }).first().click();
  await main.waitForTimeout(500);
  check(await main.locator('.flow-node').count() === 4, 'the workflow shows its four steps as a chain');
  await main.locator('.flow-node').nth(2).click();
  await main.waitForTimeout(300);
  await shot('workflow');

  // ---- previews: a 3D model and a DXF drawing in Quick Look
  for (const [name, sel, label] of [['gem.stl', '.ql canvas', '3D model'], ['floor plan.dxf', '.ql [role="img"][aria-label="Drawing"] svg', 'DXF drawing']]) {
    await nav('browse:' + S);
    await main.waitForTimeout(800);
    await main.locator('.file-card, .file-list tbody tr', { hasText: name }).first().click();
    await main.keyboard.press('Space');
    await main.waitForSelector('.ql', { timeout: 10000 });
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = (await main.locator(sel).count()) > 0; if (!ok) await main.waitForTimeout(250); }
    check(ok, `Quick Look shows the ${label}`);
    if (name.endsWith('.dxf')) check(await main.locator('.ql text', { hasText: 'Kitchen' }).count() > 0, 'the drawing shows its labels');
    await main.waitForTimeout(800);
    await shot(`preview-${name.split('.').pop()}`);
    await main.keyboard.press('Escape');
    await main.waitForTimeout(300);
  }

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ').slice(0, 400)}` : ''}`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
