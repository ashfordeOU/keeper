// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Collects every piece of C# that Keeper compiles on Windows at run time, so CI
// can prove each one compiles with the compilers Windows ships with:
//
//   - `Add-Type -TypeDefinition …` and `Add-Type -MemberDefinition …` inside the
//     PowerShell scripts in electron/ and core/ (Windows PowerShell 5.1, C# 5)
//   - the Keeper Link service (core/screen/unattended.ts), built with the
//     .NET Framework 4 csc.exe
//
// The TypeScript compiler reads the strings as the program sees them (escapes
// applied, `${name}` filled in from the constant it names), so what is checked
// is what runs. Each Add-Type becomes a small .ps1 that only declares the type;
// nothing is called.
//
// Usage: node scripts/ci/csharp-sources.mjs <out folder>
// Writes <out>/addtype-NN.ps1, <out>/KeeperLinkService.cs and <out>/manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] ?? 'csharp-out');
const HOLE = '\u0000';

function tsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = [...tsFiles(path.join(ROOT, 'electron')), ...tsFiles(path.join(ROOT, 'core'))].filter((f) => fs.readFileSync(f, 'utf8').includes('Add-Type'));
const program = ts.createProgram(files, { noResolve: true, noLib: true, allowJs: false, target: ts.ScriptTarget.ES2022 });
const checker = program.getTypeChecker();

/** The text a string expression has at run time; unknown parts become HOLE. */
function textOf(node, depth = 0) {
  if (!node || depth > 8) return HOLE;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return textOf(node.expression, depth + 1);
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    for (const span of node.templateSpans) s += textOf(span.expression, depth + 1) + span.literal.text;
    return s;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return textOf(node.left, depth + 1) + textOf(node.right, depth + 1);
  if (ts.isIdentifier(node)) {
    const decl = checker.getSymbolAtLocation(node)?.declarations?.[0];
    if (decl && ts.isVariableDeclaration(decl) && decl.initializer) return textOf(decl.initializer, depth + 1);
  }
  return HOLE;
}

/** PowerShell's string forms used for definitions: @'…'@, '…', "…" and $variables. */
function readPsString(s, i) {
  if (s.startsWith("@'", i)) {
    const start = s.indexOf('\n', i) + 1;
    const end = s.indexOf("\n'@", start);
    if (end < 0) return null;
    return { value: s.slice(start, end), end: end + 3 };
  }
  if (s[i] === "'") {
    let j = i + 1;
    let v = '';
    for (;;) {
      if (j >= s.length) return null;
      if (s[j] === "'" && s[j + 1] === "'") { v += "'"; j += 2; continue; }
      if (s[j] === "'") break;
      v += s[j++];
    }
    return { value: v, end: j + 1 };
  }
  if (s[i] === '$') {
    const m = /^\$(\w+)/.exec(s.slice(i));
    if (!m) return null;
    // $name = '…' or @'…'@ earlier in the same script
    const re = new RegExp(`\\$${m[1]}\\s*=\\s*`, 'g');
    let found = null;
    for (const a of s.slice(0, i).matchAll(re)) found = a;
    if (!found) return null;
    const r = readPsString(s, found.index + found[0].length);
    return r && { value: r.value, end: i + m[0].length };
  }
  return null;
}

/** Splits one Add-Type statement into its other parameters and the definition. */
function addTypesIn(script) {
  const found = [];
  const re = /Add-Type\b/g;
  let m;
  while ((m = re.exec(script))) {
    // the statement ends at a newline or ; outside a string; definitions are the only multi-line part
    const kind = /-(TypeDefinition|MemberDefinition)\s+/.exec(script.slice(m.index, m.index + 400));
    if (!kind || script.slice(m.index, m.index + kind.index).includes('\n')) continue;
    const defAt = m.index + kind.index + kind[0].length;
    const def = readPsString(script, defAt);
    if (!def) { found.push({ error: `could not read the definition after "${script.slice(m.index, m.index + 80)}"` }); continue; }
    const before = script.slice(m.index + 'Add-Type'.length, m.index + kind.index);
    const tail = /^[^\n;})]*/.exec(script.slice(def.end))[0];
    found.push({ kind: kind[1], params: (before + ' ' + tail).replace(/\s+/g, ' ').trim(), source: def.value });
    re.lastIndex = def.end;
  }
  return found;
}

const results = [];
const problems = [];
for (const sf of program.getSourceFiles()) {
  if (!files.includes(path.resolve(sf.fileName))) continue;
  const rel = path.relative(ROOT, sf.fileName).split(path.sep).join('/');
  const seen = new Set();
  const visit = (node) => {
    // Whole expressions only: a template inside another template is read as part of its parent.
    const isString = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
    if (isString && !(node.parent && (ts.isTemplateSpan(node.parent) || (ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)))) {
      const text = textOf(node);
      if (/Add-Type\b[^\n]*-(TypeDefinition|MemberDefinition)/.test(text)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        for (const a of addTypesIn(text)) {
          const where = `${rel}:${line}`;
          if (a.error) { problems.push(`${where}: ${a.error}`); continue; }
          if (a.source.includes(HOLE)) { problems.push(`${where}: part of the C# is only known at run time`); continue; }
          const key = a.params + '\n' + a.source;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ where, ...a });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Every Add-Type with a definition in the sources must have been found.
let expected = 0;
for (const f of files) expected += (fs.readFileSync(f, 'utf8').match(/Add-Type[^\n]*?-(TypeDefinition|MemberDefinition)/g) ?? []).length;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
results.forEach((r, i) => {
  const name = `addtype-${String(i + 1).padStart(2, '0')}`;
  fs.writeFileSync(path.join(OUT, `${name}.cs`), r.source);
  // Compile only: the parameters as written (-Name, -Namespace, -ReferencedAssemblies, -Language …), minus -PassThru.
  const params = r.params.replace(/-PassThru\b/i, '').replace(/\s+/g, ' ').trim();
  fs.writeFileSync(path.join(OUT, `${name}.ps1`), [
    "$ErrorActionPreference = 'Stop'",
    `$src = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '${name}.cs'))`,
    `Add-Type ${params} -${r.kind} $src`,
    "Write-Output 'compiled'",
    '',
  ].join('\r\n'));
  manifest.push({ name, where: r.where, kind: r.kind, params });
});

// Windows Runtime types and .NET assemblies the scripts load by name.
const winrt = new Set();
const assemblies = new Set();
for (const f of files.concat(tsFiles(path.join(ROOT, 'electron')), tsFiles(path.join(ROOT, 'core')))) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\[(Windows\.[\w.]+)\s*,\s*([\w.]+)\s*,\s*ContentType\s*=\s*WindowsRuntime\]/g)) winrt.add(`${m[1]}, ${m[2]}, ContentType = WindowsRuntime`);
  for (const m of s.matchAll(/Add-Type -AssemblyName ([\w.]+(?:\s*,\s*[\w.]+)*)/g)) for (const a of m[1].split(',')) assemblies.add(a.trim());
}
fs.writeFileSync(path.join(OUT, 'loads.ps1'), [
  "$ErrorActionPreference = 'Stop'",
  '$bad = 0',
  ...[...assemblies].sort().map((a) => `try { Add-Type -AssemblyName ${a}; Write-Output 'assembly ${a}' } catch { Write-Output "FAILED assembly ${a}: $_"; $bad++ }`),
  ...[...winrt].sort().map((t) => `try { $null = [${t}]; Write-Output 'type ${t.split(',')[0]}' } catch { Write-Output "FAILED type ${t.split(',')[0]}: $_"; $bad++ }`),
  'exit $bad',
  '',
].join('\r\n'));
manifest.push({ name: 'loads', where: `${assemblies.size} assemblies, ${winrt.size} Windows Runtime types`, kind: 'load' });

// The Keeper Link service, generated for made-up paths.
const bundle = await build({ entryPoints: [path.join(ROOT, 'core/screen/unattended.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
fs.writeFileSync(path.join(OUT, 'KeeperLinkService.cs'), mod.windowsServiceSource({ exe: 'C:\\Program Files\\Keeper\\Keeper.exe', daemon: 'C:\\Program Files\\Keeper\\resources\\app.asar\\dist-electron\\linkd.cjs', dataDir: 'C:\\Users\\ci\\AppData\\Roaming\\Keeper', user: 'ci' }));
manifest.push({ name: 'KeeperLinkService', where: 'core/screen/unattended.ts', kind: 'csc' });

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
for (const m of manifest) console.log(`${m.name.padEnd(18)} ${m.where}${m.params ? `  [${m.params}]` : ''}`);
console.log(`${results.length} Add-Type definitions (${expected} in the sources) and the Link service`);
if (problems.length) {
  for (const p of problems) console.error(`problem: ${p}`);
  process.exit(1);
}
// Duplicates in the sources are collapsed, so there can be fewer; never more, and never none.
if (results.length === 0 || results.length > expected) {
  console.error(`expected up to ${expected} definitions, found ${results.length}`);
  process.exit(1);
}
