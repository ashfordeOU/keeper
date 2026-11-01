// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Code-aware spelling: in an editor or terminal, the project's own file and
// symbol names are handed to the recognizer (and used to fix capitals), so
// "user session store" can come out as userSessionStore when you say it.
// Pure: the main process reads `git ls-files` and a `git grep` of declarations.

const COMMON = new Set('index main test tests spec src lib dist build docs readme license changelog package config utils util helpers types type node modules public assets static vendor scripts tools data index.ts setup default style styles app server client common core base init this that with from what when then have will your there their about would could should value values string number boolean object array result error errors item items list name names file files path paths data info item temp tmp main.ts services service components component electron screens images fixtures examples example source sources output input module models model handler handlers'.split(' '));

const interesting = (w: string, plainOk = true) => w.length >= 4 && w.length <= 40 && !COMMON.has(w.toLowerCase()) && /^[A-Za-z_$][\w$.-]*$/.test(w) && (/[a-z][A-Z]|[A-Z]{2}|_|-|\d|\./.test(w) || /^[A-Z][a-z]/.test(w) || (plainOk && w.length >= 6));

/** Names from tracked files: the file names without extensions, and folder names. */
export function termsFromFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths.slice(0, 20_000)) {
    const parts = p.split(/[\\/]/);
    const base = parts[parts.length - 1].replace(/\.(d\.ts|[a-z0-9]{1,5})$/i, '');
    for (const w of [base, ...parts.slice(0, -1)]) if (interesting(w)) out.push(w);
  }
  return out;
}

const DECL = /\b(?:function|class|interface|type|enum|struct|trait|def|fn|func|const|let|var|val|protocol|record|module|object|impl)\s+([A-Za-z_$][\w$]*)/;

/** Names declared in the code, from `git grep -o` lines ("export function fooBar"). */
export function termsFromSymbols(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const m = DECL.exec(l);
    // a plain lowercase name in code is usually a local variable: only mixed or styled names count
    if (m && interesting(m[1], false)) out.push(m[1]);
  }
  return out;
}

/**
 * The terms worth a place in the prompt: names from files with changes not
 * yet committed (what you are working on now), then from recent commits, then declared names by how often they
 * appear, then file names.
 */
export function rankTerms(files: string[], symbols: string[], max = 60, recent: string[] = [], now: string[] = []): string[] {
  const count = new Map<string, number>();
  for (const s of now) count.set(s, (count.get(s) ?? 0) + 60);
  for (const s of recent) count.set(s, (count.get(s) ?? 0) + 25);
  for (const s of symbols) count.set(s, (count.get(s) ?? 0) + 2);
  for (const f of files) count.set(f, (count.get(f) ?? 0) + 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [w] of [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** The project folder an editor's window title names ("voice.ts — keeper — Code"), from known project folders. */
export function folderFromTitle(title: string, folders: string[]): string | undefined {
  const parts = title.split(/\s+[—–-]\s+|\s*[|•]\s*|[:\[\]()]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const byName = new Map(folders.map((f) => [f.split(/[\\/]/).filter(Boolean).pop()!.toLowerCase(), f]));
  for (const p of parts) if (byName.has(p)) return byName.get(p);
  return undefined;
}

/** Walks up from a folder to the one holding `.git`. */
export function gitRootOf(dir: string, hasGit: (d: string) => boolean): string | undefined {
  let d = dir.replace(/[\\/]+$/, '');
  for (let i = 0; i < 40 && d; i++) {
    if (hasGit(d)) return d;
    const up = d.replace(/[\\/][^\\/]*$/, '');
    if (up === d) break;
    d = up;
  }
  return undefined;
}

/** How a code name sounds when said: "labelSpeakers" → "label speakers" (two words or more only). */
export function spokenForms(name: string): string[] {
  const parts = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase().trim().split(/\s+/);
  return parts.length >= 2 ? [parts.join(' ')] : [];
}
