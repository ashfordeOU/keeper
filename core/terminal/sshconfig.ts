// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading ~/.ssh/config so the hosts people already use show up in Keeper.
// Connections themselves go through the system's ssh, so keys, the agent,
// jump hosts and everything else in that file keep working.

import path from 'node:path';
import type { SshHost } from './types';

export interface ReadDeps {
  read: (file: string) => string | undefined;
  /** expands a glob in an Include line (relative to ~/.ssh) */
  glob?: (pattern: string) => string[];
  home: string;
}

interface Block {
  patterns: string[];
  opts: Record<string, string>;
}

function tokenize(line: string): [string, string] | null {
  const m = line.match(/^\s*([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)(.*?)\s*$/);
  if (!m) return null;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return [m[1].toLowerCase(), v];
}

function blocks(file: string, d: ReadDeps, depth = 0, out: Block[] = [], current?: Block): Block[] {
  const text = d.read(file);
  if (text === undefined || depth > 8) return out;
  let cur: Block | undefined = current;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const t = tokenize(line);
    if (!t) continue;
    const [k, v] = t;
    if (k === 'include') {
      for (const pat of v.split(/\s+/)) {
        const abs = expand(pat, d.home, path.posix.join(d.home, '.ssh'));
        const files = /[*?[]/.test(abs) ? (d.glob?.(abs) ?? []) : [abs];
        for (const f of files) blocks(f, d, depth + 1, out, cur);
      }
      continue;
    }
    if (k === 'host') {
      cur = { patterns: v.split(/\s+/).filter(Boolean), opts: {} };
      out.push(cur);
      continue;
    }
    if (k === 'match') {
      // Match blocks need runtime facts; their options are not listed per host.
      cur = { patterns: [], opts: {} };
      out.push(cur);
      continue;
    }
    if (!cur) {
      cur = { patterns: ['*'], opts: {} };
      out.push(cur);
    }
    // ssh uses the first value it sees for each option.
    if (!(k in cur.opts)) cur.opts[k] = v;
  }
  return out;
}

function expand(p: string, home: string, base: string): string {
  if (p.startsWith('~/')) return path.posix.join(home, p.slice(2));
  if (p.startsWith('/')) return p;
  return path.posix.join(base, p);
}

/** ssh's pattern matching: * and ?, with !negation. */
export function hostMatches(patterns: string[], host: string): boolean {
  let ok = false;
  for (const p of patterns) {
    const neg = p.startsWith('!');
    const re = new RegExp(`^${(neg ? p.slice(1) : p).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    if (re.test(host)) {
      if (neg) return false;
      ok = true;
    }
  }
  return ok;
}

/** The hosts named in the config (not wildcard patterns), each with the options that apply to it. */
export function parseSshConfig(d: ReadDeps, file = path.posix.join(d.home, '.ssh', 'config')): SshHost[] {
  const all = blocks(file, d);
  const names: string[] = [];
  for (const b of all) for (const p of b.patterns) if (!/[*?!]/.test(p) && !names.includes(p)) names.push(p);
  return names.map((alias) => {
    const opts: Record<string, string> = {};
    for (const b of all) if (hostMatches(b.patterns, alias)) for (const [k, v] of Object.entries(b.opts)) if (!(k in opts)) opts[k] = v;
    return {
      alias,
      host: opts.hostname,
      user: opts.user,
      port: opts.port ? Number(opts.port) : undefined,
      identityFile: opts.identityfile ? expand(opts.identityfile, d.home, d.home) : undefined,
      proxyJump: opts.proxyjump,
    };
  });
}

/** "user@host:port" or an alias → the parts an SFTP client needs (the config fills in what is missing). */
export function resolveHost(target: string, known: SshHost[]): { host: string; user?: string; port: number; identityFile?: string; alias?: string } {
  const k = known.find((h) => h.alias === target);
  if (k) return { host: k.host ?? k.alias, user: k.user, port: k.port ?? 22, identityFile: k.identityFile, alias: k.alias };
  const m = target.match(/^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!m) return { host: target, port: 22 };
  return { user: m[1], host: m[2].replace(/^\[|\]$/g, ''), port: m[3] ? Number(m[3]) : 22 };
}
