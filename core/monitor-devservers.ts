// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Dev servers grouped by project: every listening port is mapped to the
// process holding it, that process's working folder and the folder's git
// root, so "vite on 5173 and postgres on 5432" show up under the project they
// belong to, with what kind of server each is, whether anything is talking to
// it, and how to start it again. Pure; the service does the reading.

import path from 'node:path';

export interface Listener {
  port: number;
  pid: number;
  /** process name */
  name: string;
  /** 127.0.0.1, 0.0.0.0, ::, … */
  address?: string;
  proto?: 'tcp' | 'udp';
}

export interface ListenerInfo extends Listener {
  cwd?: string;
  command?: string;
  /** the process's argument list when the system gives it exactly (Linux) */
  argv?: string[];
  user?: string;
  mine?: boolean;
  cpu?: number;
  /** open connections to it right now */
  established?: number;
  started?: number;
}

export interface DevServer {
  port: number;
  pid: number;
  name: string;
  /** "Vite", "Next.js", "PostgreSQL"… */
  kind: string;
  /** a link that opens it, for web servers */
  url?: string;
  address?: string;
  /** reachable from other computers on the network */
  exposed: boolean;
  /** nothing connected and no processor use */
  idle: boolean;
  command?: string;
  cwd?: string;
  started?: number;
}

export interface DevProject {
  /** git root, else the working folder; null for servers with no folder (databases started by the system) */
  root: string | null;
  name: string;
  servers: DevServer[];
}

const KINDS: [RegExp, string, boolean][] = [
  // [command pattern, label, serves web pages]
  [/\bvite(\.js)?\b/i, 'Vite', true],
  [/\bnext(\.js)?\b.*\b(dev|start)\b|next-server|next-router-worker/i, 'Next.js', true],
  [/\bnuxt\b|nuxi/i, 'Nuxt', true],
  [/\bastro\b/i, 'Astro', true],
  [/\bremix\b|react-router\s+dev/i, 'Remix', true],
  [/\bsvelte-kit\b/i, 'SvelteKit', true],
  [/webpack(-dev-server|\s+serve)/i, 'webpack', true],
  [/\bparcel\b/i, 'Parcel', true],
  [/storybook/i, 'Storybook', true],
  [/\bng\s+serve\b|@angular[\\/]cli/i, 'Angular', true],
  [/\bexpo\b|metro/i, 'Expo / Metro', true],
  [/rails\s+s(erver)?\b|\bpuma\b/i, 'Rails', true],
  [/manage\.py\s+runserver/i, 'Django', true],
  [/\bflask\b/i, 'Flask', true],
  [/\buvicorn\b|\bfastapi\b/i, 'Uvicorn', true],
  [/\bgunicorn\b|\bhypercorn\b/i, 'Gunicorn', true],
  [/\bjupyter/i, 'Jupyter', true],
  [/\bstreamlit\b/i, 'Streamlit', true],
  [/\bgradio\b/i, 'Gradio', true],
  [/artisan\s+serve|php\s+-S\b/i, 'PHP', true],
  [/\bhugo\b/i, 'Hugo', true],
  [/\bjekyll\b/i, 'Jekyll', true],
  [/\bwrangler\b|workerd/i, 'Wrangler', true],
  [/\bfirebase\b.*emulators/i, 'Firebase emulators', true],
  [/http\.server|SimpleHTTPServer|http-server|\bserve\b/i, 'Static server', true],
  [/spring|\.jar\b|gradle|mvn/i, 'Java', true],
  [/\bdotnet\b/i, '.NET', true],
  [/\bbun\b/i, 'Bun', true],
  [/\bdeno\b/i, 'Deno', true],
  [/\bnode(\.exe)?\b|\bnpm\b|\bpnpm\b|\byarn\b|\bnpx\b|\btsx\b/i, 'Node.js', true],
  [/\bpython[\d.]*(\.exe)?\b/i, 'Python', true],
  [/\bruby\b/i, 'Ruby', true],
  [/\bgo-build\b|\bgo\s+run\b|[\\/]air\b/i, 'Go', true],
  [/\bcargo\b|target[\\/](debug|release)[\\/]/i, 'Rust', true],
  [/\bbeam\.smp\b|\bmix\s+phx/i, 'Elixir', true],
  [/\bpostgres\b|\bpostmaster\b/i, 'PostgreSQL', false],
  [/\bmysqld\b|\bmariadbd?\b/i, 'MySQL', false],
  [/\bredis-server\b|\bvalkey/i, 'Redis', false],
  [/\bmongod\b/i, 'MongoDB', false],
  [/\bmemcached\b/i, 'Memcached', false],
  [/elasticsearch|opensearch/i, 'Search engine', false],
  [/\bminio\b/i, 'MinIO', false],
  [/docker-proxy|com\.docker|vpnkit|rootlessport|gvproxy/i, 'Container', true],
];

/** What kind of server a process is, from its name and command line. */
export function serverKind(name: string, command = ''): { kind: string; web: boolean } {
  const s = `${name} ${command}`;
  for (const [re, kind, web] of KINDS) if (re.test(s)) return { kind, web };
  return { kind: name, web: false };
}

const DEV_RUNTIME = /\b(node|npm|pnpm|yarn|npx|bun|deno|tsx|python[\d.]*|ruby|php|java|dotnet|go|cargo|beam\.smp|postgres|mysqld|mariadbd|redis-server|mongod|docker-proxy|hugo|jekyll|uvicorn|gunicorn|flask|rails|puma|vite|next-server|workerd|jupyter)/i;

/** Ports below 1024, system services and other people's programs are not dev servers. */
export function looksLikeDevServer(l: ListenerInfo, home?: string): boolean {
  if (l.mine === false) return false;
  const inHome = !!(l.cwd && home && l.cwd !== home && l.cwd.startsWith(home));
  if (l.port < 1024 && !inHome) return false;
  return inHome || DEV_RUNTIME.test(`${l.name} ${l.command ?? ''}`);
}

/** The git root above a folder (a `.git` folder or file), or undefined. */
export function gitRootOf(dir: string, exists: (p: string) => boolean): string | undefined {
  // Keep the path's own style (a POSIX path on Windows stays POSIX, and the other way round).
  const p = /^[a-zA-Z]:[\\/]|\\/.test(dir) ? path.win32 : path.posix;
  let d = p.resolve(dir);
  for (let i = 0; i < 40; i++) {
    if (exists(p.join(d, '.git'))) return d;
    const up = p.dirname(d);
    if (up === d) return undefined;
    d = up;
  }
  return undefined;
}

const isAny = (a?: string) => !a || a === '*' || a === '0.0.0.0' || a === '::' || a === '[::]';

/** Groups listening ports by project folder. One entry per port (IPv4 and IPv6 of the same port fold together). */
export function groupDevServers(listeners: ListenerInfo[], rootOf: (cwd: string) => string | undefined, opts: { home?: string; all?: boolean } = {}): DevProject[] {
  const seen = new Set<string>();
  const groups = new Map<string, DevProject>();
  for (const l of [...listeners].sort((a, b) => a.port - b.port)) {
    const key = `${l.pid}:${l.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!opts.all && !looksLikeDevServer(l, opts.home)) continue;
    const { kind, web } = serverKind(l.name, l.command);
    const root = l.cwd && l.cwd !== '/' && l.cwd !== opts.home ? rootOf(l.cwd) ?? l.cwd : null;
    const exposed = isAny(l.address) || !!(l.address && !/^(127\.|::1$|\[::1\]|localhost)/.test(l.address));
    const host = l.address && !isAny(l.address) && !l.address.includes(':') ? l.address : 'localhost';
    const server: DevServer = {
      port: l.port, pid: l.pid, name: l.name, kind, url: web ? `http://${host}:${l.port}` : undefined, address: l.address, exposed,
      idle: l.established === 0 && (l.cpu ?? 0) < 0.5, command: l.command, cwd: l.cwd, started: l.started,
    };
    const gk = root ?? '';
    const g = groups.get(gk) ?? { root, name: root ? path.basename(root) : 'Other servers', servers: [] };
    g.servers.push(server);
    groups.set(gk, g);
  }
  return [...groups.values()].sort((a, b) => (a.root === null ? 1 : b.root === null ? -1 : a.name.localeCompare(b.name)));
}

/** Splits a command line the way a shell would for plain quoting ("a b" 'c d' e\ f). */
export function splitCommandLine(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      else if (ch === '\\' && q === '"' && (s[i + 1] === '"' || s[i + 1] === '\\')) cur += s[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
      has = true;
    } else if (ch === '\\' && s[i + 1] !== undefined && process.platform !== 'win32') {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}

export interface RestartPlan {
  file: string;
  args: string[];
  cwd: string;
}

/**
 * How to start a server again after stopping it: the same program, arguments
 * and folder. Refused when the folder or command is unknown, or for system
 * databases (restart those from Services).
 */
export function restartPlan(s: Pick<ListenerInfo, 'argv' | 'command' | 'cwd' | 'name'>): RestartPlan | { error: string } {
  if (!s.cwd) return { error: 'Keeper cannot see which folder this server runs in.' };
  const argv = s.argv?.length ? s.argv : s.command ? splitCommandLine(s.command) : [];
  if (!argv.length) return { error: 'Keeper cannot see how this server was started.' };
  const { kind, web } = serverKind(s.name, s.command);
  if (!web) return { error: `${kind} is a database or system service; restart it from Health → Services.` };
  return { file: argv[0], args: argv.slice(1), cwd: s.cwd };
}
