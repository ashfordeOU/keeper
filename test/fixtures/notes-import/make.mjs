// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Makes small, made-up exports of every notes app Keeper imports from, the
// way each app lays them out: Evernote .enex, Joplin .jex, a Standard Notes
// backup, Notesnook exports, a Markdown vault, a Bear export, Google Keep
// Takeout, Simplenote's export and Apple Notes saved as files. Every note is
// written here; nothing is copied from anyone. Pictures are tiny PNGs made
// below.
//
//   node test/fixtures/notes-import/make.mjs <out-dir>     (or import { makeFixtures })
//
// Each export ends up in <out-dir>/<name> (a folder or a single file).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- tiny files

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A w×h PNG of one colour. */
export function png(w, h, [r, g, b]) {
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
export const PICS = { leaf: png(4, 3, [40, 160, 70]), sky: png(3, 3, [60, 120, 220]), sun: png(2, 2, [250, 200, 40]) };

/** A zip with stored (uncompressed) entries. */
export function zip(entries) {
  const locals = []; const central = []; let off = 0;
  for (const [name, data0] of entries) {
    const data = Buffer.from(data0); const n = Buffer.from(name); const crc = crc32(data);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt32LE(crc, 14); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(n.length, 26);
    locals.push(l, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** A plain ustar archive (what a .jex is). */
export function tar(entries) {
  const parts = [];
  for (const [name, data0] of entries) {
    const data = Buffer.from(data0); const h = Buffer.alloc(512);
    h.write(name, 0, 100); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('14500000000\0', 136); h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const x of h) sum += x; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

const md5 = (b) => createHash('md5').update(b).digest('hex');
const id32 = (s) => createHash('md5').update(s).digest('hex');

// ---------------------------------------------------------------- the exports

function enex() {
  const note = (title, created, updated, tags, enml, resources = []) => `<note><title>${title}</title><created>${created}</created><updated>${updated}</updated>${tags.map((t) => `<tag>${t}</tag>`).join('')}
<content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${enml}</en-note>]]></content>
${resources.map(([name, mime, data]) => `<resource><data encoding="base64">${data.toString('base64').replace(/(.{76})/g, '$1\n')}</data><mime>${mime}</mime><resource-attributes><file-name>${name}</file-name></resource-attributes></resource>`).join('\n')}</note>`;
  const garden = note('Garden plan', '20260301T080000Z', '20260402T093000Z', ['garden', 'spring jobs'],
    `<div><b>Beds</b> for this year.</div><div><en-todo checked="true"/>Order compost</div><div><en-todo checked="false"/>Dig the north bed</div><div><en-media hash="${md5(PICS.leaf)}" type="image/png"/></div><table><tr><td><b>Bed</b></td><td><b>Crop</b></td></tr><tr><td>North</td><td>Garlic</td></tr><tr><td>South</td><td>Tomatoes | cherry</td></tr></table><div>See <a href="evernote:///view/1/s1/aaaa/aaaa/">Café ☕ plans — 東京</a> and the <en-media hash="${md5(PDF)}" type="application/pdf"/></div>`,
    [['leaf.png', 'image/png', PICS.leaf], ['seed list.pdf', 'application/pdf', PDF]]);
  const cafe = note('Café ☕ plans — 東京', '20260310T120000Z', '20260310T121500Z', ['travel'],
    '<h2>Places</h2><ul><li>Kissa near the station</li><li>Bakery<ul><li>open at 7</li></ul></li></ul><ol><li>Book</li><li>Go</li></ol><div>Back to <a href="evernote:///view/1/s1/bbbb/bbbb/">Garden plan</a>.</div>');
  const q = note('Q3 / Q4: plan?', '20260501T080000Z', '20260501T080000Z', [], '<p>Quarterly <i>review</i> &amp; <s>old</s> notes, <code>x_y</code>.</p><blockquote>A quote</blockquote>');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export export-date="20260601T000000Z" application="Evernote" version="10.0">\n${[garden, cafe, q].join('\n')}\n</en-export>\n`;
}

function jex() {
  const props = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n');
  const t = (iso) => iso;
  const f1 = id32('folder-home'), f2 = id32('folder-kitchen'), n1 = id32('note-reno'), n2 = id32('note-tiles'), n3 = id32('note-locked'), tg = id32('tag-diy'), nt = id32('nt'), r1 = id32('res-sky');
  const items = [
    [`${f1}.md`, `Home\n\n${props({ id: f1, parent_id: '', created_time: t('2026-02-01T10:00:00.000Z'), updated_time: t('2026-02-01T10:00:00.000Z'), type_: 2 })}`],
    [`${f2}.md`, `Kitchen\n\n${props({ id: f2, parent_id: f1, created_time: t('2026-02-01T10:00:00.000Z'), updated_time: t('2026-02-01T10:00:00.000Z'), type_: 2 })}`],
    [`${n1}.md`, `Renovation\n\nThe plan, with [the tiles](:/${n2}).\n\n- [x] Measure\n- [ ] Buy paint\n\n| Room | Cost |\n| --- | --- |\n| Kitchen | 1200 |\n\n![sky](:/${r1})\n\n${props({ id: n1, parent_id: f2, created_time: t('2026-02-02T10:00:00.000Z'), updated_time: t('2026-02-03T11:00:00.000Z'), user_created_time: t('2026-02-02T10:00:00.000Z'), user_updated_time: t('2026-02-03T11:00:00.000Z'), is_todo: 0, markup_language: 1, encryption_applied: 0, type_: 1 })}`],
    [`${n2}.md`, `Tiles — größe 20×20\n\nWhite, matte. Back to [Renovation](:/${n1}).\n\n${props({ id: n2, parent_id: f1, created_time: t('2026-02-04T10:00:00.000Z'), updated_time: t('2026-02-04T10:00:00.000Z'), user_created_time: t('2026-02-04T10:00:00.000Z'), user_updated_time: t('2026-02-04T10:00:00.000Z'), encryption_applied: 0, type_: 1 })}`],
    [`${n3}.md`, `\n\n${props({ id: n3, parent_id: f1, created_time: t('2026-02-05T10:00:00.000Z'), updated_time: t('2026-02-05T10:00:00.000Z'), encryption_cipher_text: 'JED01abc', encryption_applied: 1, type_: 1 })}`],
    [`${tg}.md`, `diy\n\n${props({ id: tg, created_time: t('2026-02-01T10:00:00.000Z'), updated_time: t('2026-02-01T10:00:00.000Z'), type_: 5 })}`],
    [`${nt}.md`, props({ id: nt, note_id: n1, tag_id: tg, created_time: t('2026-02-01T10:00:00.000Z'), updated_time: t('2026-02-01T10:00:00.000Z'), type_: 6 })],
    [`${r1}.md`, `sky.png\n\n${props({ id: r1, mime: 'image/png', filename: 'sky.png', file_extension: 'png', created_time: t('2026-02-02T10:00:00.000Z'), updated_time: t('2026-02-02T10:00:00.000Z'), size: PICS.sky.length, type_: 4 })}`],
  ];
  return tar([...items, [`resources/${r1}.png`, PICS.sky]]);
}

function standardNotes() {
  const item = (uuid, content_type, content, created) => ({ uuid, content_type, content, created_at: created, updated_at: created, created_at_timestamp: Date.parse(created) * 1000, updated_at_timestamp: Date.parse(created) * 1000, deleted: false });
  return JSON.stringify({
    version: '004',
    items: [
      item('sn-1', 'Note', { title: 'Reading list', text: '- [ ] A book about rivers\n- [x] Poems\n\nNotes with ünïcödé ✓', references: [] }, '2026-01-10T09:00:00.000Z'),
      item('sn-2', 'Note', { title: 'Passwords hint', text: 'secret', protected: true, references: [] }, '2026-01-11T09:00:00.000Z'),
      item('sn-3', 'Note', { title: 'Old draft', text: 'gone', trashed: true, references: [] }, '2026-01-12T09:00:00.000Z'),
      item('sn-t', 'Tag', { title: 'books', references: [{ uuid: 'sn-1', content_type: 'Note' }] }, '2026-01-10T09:00:00.000Z'),
    ],
  }, null, 2);
}

function notesnookBackup() {
  return JSON.stringify({
    version: 5.9, type: 'web', date: Date.parse('2026-03-01T00:00:00Z'), encrypted: false,
    data: {
      n1: { id: 'n1', type: 'note', title: 'Weekly review', contentId: 'c1', dateCreated: Date.parse('2026-03-01T08:00:00Z'), dateEdited: Date.parse('2026-03-02T08:00:00Z'), tags: [] },
      c1: { id: 'c1', type: 'tiptap', noteId: 'n1', data: '<h2>Done</h2><ul class="checklist"><li class="checked">Taxes</li><li>Call mum</li></ul><table><tbody><tr><th>Day</th><th>Hours</th></tr><tr><td>Mon</td><td>3</td></tr></tbody></table>' },
      t1: { id: 't1', type: 'tag', title: 'routine' },
      r1: { id: 'r1', type: 'relation', fromType: 'tag', fromId: 't1', toType: 'note', toId: 'n1' },
    },
  });
}

/** Writes every export into `dir` and returns where each one is. */
export function makeFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  const w = (rel, data) => { const p = path.join(dir, ...rel.split('/')); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, data); return p; };

  const out = {};
  out.evernote = w('evernote/Garden.enex', enex());
  out['joplin-jex'] = w('joplin/export.jex', jex());
  out.standardnotes = w('standardnotes/Standard Notes Backup.txt', standardNotes());

  // Notesnook: a Markdown export folder with a picture, and an unencrypted backup.
  w('notesnook-md/Ideas/Bike trip.md', '---\ntitle: "Bike trip: route"\ncreated_at: 2026-03-03T10:00:00.000Z\nupdated_at: 2026-03-04T10:00:00.000Z\ntags: ["travel", "summer"]\n---\n\nRoute along the river.\n\n![map](attachments/sun.png)\n\n- [ ] Pump the tyres\n');
  w('notesnook-md/Ideas/attachments/sun.png', PICS.sun);
  out.notesnook = path.join(dir, 'notesnook-md');
  out['notesnook-backup'] = w('notesnook/backup.nnbackup', notesnookBackup());

  // A Markdown vault made by another notes app.
  w('vault/.obsidian/app.json', '{"attachmentFolderPath":"Files"}');
  w('vault/Home.md', '---\ntags: [index]\n---\n# Home\n\nStart at [[Projects/Shed]] or [[Ideas – ébauche]].\n\n![[leaf.png]]\n');
  w('vault/Projects/Shed.md', '# Shed\n\nBack to [[Home|the start]].\n\n- [ ] Roof\n- [x] Floor\n\n| Part | Done |\n| --- | --- |\n| Roof | no |\n');
  w('vault/Ideas – ébauche.md', 'Unicode name ✓ and a [plain link](Projects/Shed.md).\n');
  w('vault/Files/leaf.png', PICS.leaf);
  w('vault/.trash/Old.md', 'old');
  out.markdown = path.join(dir, 'vault');

  // Bear: a Markdown note and a TextBundle with its picture.
  w('bear/Sourdough.md', '# Sourdough\n\nFeed the starter. #food/baking #quick meals#\n\n::Remember the salt::\n');
  w('bear/Trip notes.textbundle/text.md', '# Trip notes\n\nThe view: ![](assets/sky.png)\n\n#travel\n');
  w('bear/Trip notes.textbundle/assets/sky.png', PICS.sky);
  w('bear/Trip notes.textbundle/info.json', '{"version":2,"type":"net.daringfireball.markdown"}');
  out.bear = path.join(dir, 'bear');

  // Google Keep from Takeout: .json notes with .html twins and pictures.
  const keep = (name, j, html) => { w(`keep/Takeout/Keep/${name}.json`, JSON.stringify(j)); w(`keep/Takeout/Keep/${name}.html`, html); };
  keep('Shopping', { title: 'Shopping', listContent: [{ text: 'Eggs', isChecked: true }, { text: 'Flour', isChecked: false }], labels: [{ name: 'home' }], isTrashed: false, isArchived: false, createdTimestampUsec: 1767225600000000, userEditedTimestampUsec: 1767312000000000 },
    '<html><body><div class="note"><div class="title">Shopping</div><div class="content"><ul class="list"><li class="listitem checked">Eggs</li></ul></div></div></body></html>');
  keep('Whiteboard', { title: '', textContent: 'Photo of the whiteboard\nwith the plan', attachments: [{ filePath: 'board.png', mimetype: 'image/png' }], annotations: [{ url: 'https://example.com/plan', title: 'Plan page' }], labels: [], isTrashed: false, isArchived: true, createdTimestampUsec: 1767225600000000, userEditedTimestampUsec: 1767225600000000 }, '<html><body><div class="content">Photo</div></body></html>');
  keep('Binned', { title: 'Binned', textContent: 'old', isTrashed: true, isArchived: false, labels: [], createdTimestampUsec: 1767225600000000, userEditedTimestampUsec: 1767225600000000 }, '<html></html>');
  w('keep/Takeout/Keep/board.png', PICS.sun);
  w('keep/Takeout/archive_browser.html', '<html><body>Takeout</body></html>');
  out.keep = path.join(dir, 'keep/Takeout/Keep');

  // Simplenote: its export .zip (source/notes.json and the notes as .txt).
  const sn = { activeNotes: [
    { id: 's1', content: 'Packing list\n- socks\n- charger', creationDate: '2026-04-01T10:00:00.000Z', lastModified: '2026-04-02T10:00:00.000Z', tags: ['travel'], pinned: true },
    { id: 's2', content: 'Ünïcode title 😀\nbody', creationDate: '2026-04-03T10:00:00.000Z', lastModified: '2026-04-03T10:00:00.000Z' },
  ], trashedNotes: [{ id: 's3', content: 'Trash me\nx', creationDate: '2026-04-04T10:00:00.000Z', lastModified: '2026-04-04T10:00:00.000Z' }] };
  out.simplenote = w('simplenote/notes.zip', zip([['source/notes.json', JSON.stringify(sn, null, 2)], ['notes/Packing list.txt', sn.activeNotes[0].content], ['notes/Ünïcode title 😀.txt', sn.activeNotes[1].content]]));

  // Apple Notes saved as files: Markdown and HTML, folders per account and folder, a picture.
  w('applenotes/iCloud/Notes/Groceries.md', '# Groceries\n\n- [ ] Milk\n- [x] Bread\n');
  w('applenotes/iCloud/Work/Meeting.html', '<html><head><title>Meeting</title></head><body><h1>Meeting</h1><div>Agenda for <b>Monday</b></div><ul><li><input type="checkbox" checked>Slides</li><li><input type="checkbox">Room</li></ul><table><tr><th>Who</th><th>What</th></tr><tr><td>Ana</td><td>Notes</td></tr></table><img src="Meeting%20files/sketch.png"></body></html>');
  w('applenotes/iCloud/Work/Meeting files/sketch.png', PICS.leaf);
  out['applenotes-export'] = path.join(dir, 'applenotes');
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])) && process.argv[2]) console.log(JSON.stringify(makeFixtures(process.argv[2]), null, 2));
