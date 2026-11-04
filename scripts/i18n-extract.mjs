// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Finds the interface's words that are not yet translatable: text written
// straight into JSX, and the words in title, aria-label, placeholder and alt.
// It is the groundwork for translating all of Keeper (docs/TRANSLATING.md):
//
//   node scripts/i18n-extract.mjs                 a summary: strings per area, the files with most
//   node scripts/i18n-extract.mjs --write FILE    every string with where it is, as JSON (a catalogue
//                                                 to give translators, keyed by file and words)
//   node scripts/i18n-extract.mjs --rtl           CSS written for left-to-right only (margin-left,
//                                                 padding-right, left:, text-align: left…), per file
//
// test/i18n.test.ts keeps the count from growing.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label']);

function walk(dir, ext, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** Words a person reads: at least two letters, not only symbols, numbers or code. */
export const wordy = (s) => /\p{L}{2,}/u.test(s) && !/^[\s\p{P}\p{S}\d]*$/u.test(s) && !/^[a-z]+([A-Z][a-z]*)+$/.test(s.trim()) && !/^[\w.-]+\.(tsx?|css|json|md)$/.test(s.trim());

/** The untranslated strings in one TSX source. */
export function stringsIn(text, file = 'x.tsx') {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const add = (node, s, kind) => {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t && wordy(t)) out.push({ text: t, kind, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) add(node, node.text, 'text');
    else if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText()) && node.initializer) {
      const i = node.initializer;
      if (ts.isStringLiteral(i)) add(i, i.text, node.name.getText());
      else if (ts.isJsxExpression(i) && i.expression && (ts.isStringLiteral(i.expression) || ts.isNoSubstitutionTemplateLiteral(i.expression))) add(i, i.expression.text, node.name.getText());
    } else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && node.expression && ts.isStringLiteral(node.expression)) add(node, node.expression.text, 'text');
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every untranslated string in the interface. */
export function extractAll(root = ROOT) {
  const files = walk(path.join(root, 'src'), ['.tsx']).filter((f) => !/mock/.test(path.basename(f)));
  const out = [];
  for (const f of files) for (const s of stringsIn(readFileSync(f, 'utf8'), f)) out.push({ ...s, file: path.relative(root, f).split(path.sep).join('/') });
  return out;
}

/** How many words go through translation keys (t('…')) in the interface. */
export function keyedUses(root = ROOT) {
  let n = 0;
  for (const f of walk(path.join(root, 'src'), ['.tsx', '.ts'])) n += (readFileSync(f, 'utf8').match(/\bt\(\s*'[a-zA-Z]+\.[\w.]+'/g) ?? []).length;
  return n;
}

const PHYSICAL = /(?:^|[;{\s])(margin-left|margin-right|padding-left|padding-right|border-left|border-right|left|right|text-align:\s*(?:left|right)|float:\s*(?:left|right))\s*:?/g;

/** CSS that assumes left-to-right, per file: what right-to-left languages (Arabic, Hebrew) need changed to logical properties. */
export function rtlReport(root = ROOT) {
  const out = {};
  for (const f of walk(path.join(root, 'src'), ['.css'])) {
    const n = (readFileSync(f, 'utf8').match(PHYSICAL) ?? []).length;
    if (n) out[path.relative(root, f).split(path.sep).join('/')] = n;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.includes('--rtl')) {
    const r = rtlReport();
    const total = Object.values(r).reduce((a, b) => a + b, 0);
    console.log(`${total} left-to-right CSS properties in ${Object.keys(r).length} stylesheets (logical ones, such as margin-inline-start, work both ways):`);
    for (const [f, n] of Object.entries(r).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${f}`);
    process.exit(0);
  }
  const all = extractAll();
  const w = args.indexOf('--write');
  if (w >= 0) {
    const file = args[w + 1] || 'strings.en.json';
    writeFileSync(file, JSON.stringify(all.map((s) => ({ key: `${s.file}:${s.text}`, text: s.text, where: `${s.file}:${s.line}`, kind: s.kind })), null, 1));
    console.log(`Wrote ${all.length} strings to ${file}`);
  }
  const byArea = {};
  for (const s of all) { const area = s.file.split('/').slice(0, 2).join('/'); byArea[area] = (byArea[area] ?? 0) + 1; }
  const keyed = keyedUses();
  console.log(`${all.length} interface strings are not yet translatable; ${keyed} go through translation keys (${Math.round((keyed / (keyed + all.length)) * 100)}% of the interface).`);
  for (const [a, n] of Object.entries(byArea).sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`  ${String(n).padStart(5)}  ${a}`);
}
