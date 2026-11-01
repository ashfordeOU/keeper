// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which files a synced folder leaves out: a .keeperignore file in the folder
// (one pattern per line, the same rules as a .gitignore) plus Keeper's own
// working files and the usual system clutter.

/** Never synced: Keeper's own bookkeeping, half-written files and system clutter. */
export const ALWAYS_IGNORED = ['.keeper-versions/', '.keeper-sync/', '*.keeper-part', '*.keeper-part.json', '.DS_Store', 'Thumbs.db', 'desktop.ini', '.Spotlight-V100/', '.Trashes/', '.fseventsd/', '$RECYCLE.BIN/', '*.keeperlock.partial', '~$*'];

interface Rule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRe(glob: string, anchored: boolean): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches any number of folders, a trailing "**" everything below.
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i++;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const j = glob.indexOf(']', i);
      if (j < 0) re += '\\[';
      else {
        re += '[' + glob.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
        i = j;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp((anchored ? '^' : '^(?:.*/)?') + re + '(?:/.*)?$', process.platform === 'win32' || process.platform === 'darwin' ? 'i' : '');
}

export function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }
    if (line.startsWith('\\')) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    // A slash at the start or in the middle ties the pattern to the folder's top.
    const anchored = line.includes('/');
    line = line.replace(/^\//, '');
    if (line) rules.push({ re: globToRe(line, anchored), negate, dirOnly });
  }
  return rules;
}

export class IgnoreMatcher {
  private rules: Rule[];
  constructor(patterns: string[] | string = []) {
    const text = Array.isArray(patterns) ? patterns.join('\n') : patterns;
    this.rules = [...parseIgnore(ALWAYS_IGNORED.join('\n')), ...parseIgnore(text)];
  }
  /** `rel` uses forward slashes; `isDir` for folders. The last matching rule wins. */
  ignored(rel: string, isDir = false): boolean {
    let out = false;
    for (const r of this.rules) {
      if (r.dirOnly && !isDir) {
        // "build/" still hides everything inside build.
        if (!rel.includes('/')) continue;
        const parents = rel.split('/').slice(0, -1);
        let hit = false;
        for (let i = 1; i <= parents.length && !hit; i++) hit = r.re.test(parents.slice(0, i).join('/'));
        if (hit) out = !r.negate;
        continue;
      }
      if (r.re.test(rel)) out = !r.negate;
    }
    return out;
  }
}
