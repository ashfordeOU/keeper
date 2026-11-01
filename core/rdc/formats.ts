// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reading and writing other tools' connection files: .rdp (Remote Desktop),
// .vnc (VNC viewers), Host entries in ~/.ssh/config, and Keeper's own JSON.
// Passwords are never written out. A password found in a .vnc file comes back
// separately so it can go straight into the system keychain.

import { vncUnobfuscate } from './des';
import { defaultPort, type Connection, type PortForward, type Protocol } from './types';
import { splitHostPort, vncPort } from './uri';

export type Format = 'rdp' | 'vnc' | 'ssh' | 'json';

export interface Imported {
  conn: Omit<Connection, 'id' | 'created'>;
  /** a password the file carried (only .vnc files do): goes to the keychain, never to disk */
  secret?: string;
}

/** Text from a file: .rdp files saved by Windows are UTF-16 with a byte-order mark. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  // UTF-16 without a mark: every other byte is zero.
  if (bytes.length > 4 && bytes[1] === 0 && bytes[3] === 0) return new TextDecoder('utf-16le').decode(bytes);
  return new TextDecoder().decode(bytes);
}

/** Which kind of file this is, from its name or its first lines. */
export function detectFormat(text: string, fileName = ''): Format | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'rdp') return 'rdp';
  if (ext === 'vnc' || ext === 'vncviewer') return 'vnc';
  if (ext === 'json') return 'json';
  if (/(^|[\\/])(ssh_)?config$/.test(fileName) || ext === 'conf') return 'ssh';
  const t = text.trim();
  if (t.startsWith('{')) return 'json';
  if (/^\s*full address:s:/im.test(t)) return 'rdp';
  if (/^\s*\[connection\]/im.test(t)) return 'vnc';
  if (/^\s*host\s+\S/im.test(t)) return 'ssh';
  return null;
}

// ---------------------------------------------------------------- .rdp

function rdpFields(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^:]+):([sib]):(.*)$/.exec(line);
    if (m) out.set(m[1].trim().toLowerCase(), m[3].trim());
  }
  return out;
}

export function parseRdp(text: string, fileName = ''): Imported[] {
  const f = rdpFields(text);
  const hp = splitHostPort(f.get('full address') ?? f.get('alternate full address') ?? '');
  if (!hp) return [];
  let user = f.get('username') || undefined;
  let domain = f.get('domain') || undefined;
  if (user?.includes('\\')) [domain, user] = user.split('\\', 2) as [string, string];
  const port = Number(f.get('server port')) || hp.port;
  const num = (k: string) => (f.has(k) ? Number(f.get(k)) : undefined);
  const audio = num('audiomode');
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.rdp$/i, '');
  return [{
    conn: {
      name: base || hp.host,
      protocol: 'rdp',
      host: hp.host,
      port: port && port !== 3389 ? port : undefined,
      user,
      domain,
      rdp: {
        width: num('desktopwidth') || undefined,
        height: num('desktopheight') || undefined,
        fullscreen: num('screen mode id') === 2 ? true : num('screen mode id') === 1 ? false : undefined,
        multimon: num('use multimon') === 1 || undefined,
        clipboard: num('redirectclipboard') === 0 ? false : true,
        drives: f.get('drivestoredirect') ? true : undefined,
        audio: audio === 1 ? 'remote' : audio === 2 ? 'off' : audio === 0 ? 'local' : undefined,
        gateway: (num('gatewayusagemethod') ?? 0) > 0 && (num('gatewayusagemethod') !== 4) && f.get('gatewayhostname') ? f.get('gatewayhostname') : undefined,
        nla: num('enablecredsspsupport') === 0 ? false : undefined,
        admin: num('administrative session') === 1 || undefined,
        dynamicResolution: num('dynamic resolution') === 1 || undefined,
      },
    },
  }];
}

/** A .rdp file the system's Remote Desktop app (and FreeRDP) understands. No password. */
export function toRdp(c: Connection): string {
  const r = c.rdp ?? {};
  const lines: string[] = [];
  const s = (k: string, v: string) => lines.push(`${k}:s:${v}`);
  const i = (k: string, v: number) => lines.push(`${k}:i:${v}`);
  s('full address', `${c.host.includes(':') ? `[${c.host}]` : c.host}${c.port && c.port !== 3389 ? `:${c.port}` : ''}`);
  if (c.user) s('username', c.domain ? `${c.domain}\\${c.user}` : c.user);
  if (c.domain) s('domain', c.domain);
  i('screen mode id', r.fullscreen === false || (r.width && r.height && r.fullscreen !== true) ? 1 : 2);
  if (r.width && r.height) { i('desktopwidth', r.width); i('desktopheight', r.height); }
  i('use multimon', r.multimon ? 1 : 0);
  i('redirectclipboard', r.clipboard === false ? 0 : 1);
  if (r.drives) s('drivestoredirect', '*');
  i('audiomode', r.audio === 'remote' ? 1 : r.audio === 'off' ? 2 : 0);
  i('enablecredsspsupport', r.nla === false ? 0 : 1);
  i('authentication level', r.ignoreCert ? 0 : 2);
  if (r.admin) i('administrative session', 1);
  i('dynamic resolution', r.dynamicResolution ? 1 : 0);
  if (r.gateway) {
    s('gatewayhostname', r.gateway);
    i('gatewayusagemethod', 1);
    i('gatewayprofileusagemethod', 1);
  } else i('gatewayusagemethod', 4);
  i('prompt for credentials', 0);
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- .vnc

function iniSections(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let cur = new Map<string, string>();
  out.set('', cur);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      cur = out.get(sec[1].toLowerCase()) ?? new Map();
      out.set(sec[1].toLowerCase(), cur);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) cur.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
  }
  return out;
}

export function parseVnc(text: string, fileName = ''): Imported[] {
  const ini = iniSections(text);
  const conn = ini.get('connection') ?? ini.get('');
  const opts = ini.get('options') ?? new Map<string, string>();
  const rawHost = conn?.get('host') ?? conn?.get('server');
  if (!rawHost) return [];
  // host, host:display, host::port, [v6]:display
  const m = /^(\[[^\]]+\]|[^:]+)(?::(:?\d+))?$/.exec(rawHost);
  if (!m) return [];
  const host = m[1].replace(/^\[|\]$/g, '');
  const port = Number(conn?.get('port')) || vncPort(m[2]);
  const pw = conn?.get('password');
  let secret: string | undefined;
  if (pw && /^[0-9a-f]{16}$/i.test(pw)) secret = vncUnobfuscate(pw) || undefined;
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.vnc$/i, '');
  const flag = (k: string) => {
    const v = opts.get(k) ?? conn?.get(k);
    return v === undefined ? undefined : v === '1' || v.toLowerCase() === 'true';
  };
  const scaling = (opts.get('scaling') ?? opts.get('scaling_mode') ?? '').toLowerCase();
  return [{
    conn: {
      name: base || host,
      protocol: 'vnc',
      host,
      port: port && port !== 5900 ? port : undefined,
      user: conn?.get('username') || undefined,
      vnc: { viewOnly: flag('viewonly') || undefined, shared: flag('shared') === false ? false : undefined, scale: scaling === 'none' || scaling === '100%' ? 'none' : undefined, picture: /^tight$/i.test(opts.get('preferredencoding') ?? opts.get('preferred_encoding') ?? '') ? 'fast' : undefined },
    },
    secret,
  }];
}

export function toVnc(c: Connection): string {
  const port = c.port ?? 5900;
  const lines = ['[Connection]', `Host=${c.host.includes(':') ? `[${c.host}]` : c.host}::${port}`, `Port=${port}`];
  if (c.user) lines.push(`UserName=${c.user}`);
  lines.push('', '[Options]', `ViewOnly=${c.vnc?.viewOnly ? 1 : 0}`, `Shared=${c.vnc?.shared === false ? 0 : 1}`, `Scaling=${c.vnc?.scale === 'none' ? 'None' : 'AspectFit'}`);
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- ~/.ssh/config

function sshForward(kind: PortForward['kind'], value: string): PortForward | null {
  const parts = value.trim().split(/\s+/);
  const listenSpec = parts[0] ?? '';
  const li = listenSpec.lastIndexOf(':');
  const bind = li > 0 ? listenSpec.slice(0, li) : undefined;
  const listen = Number(li > 0 ? listenSpec.slice(li + 1) : listenSpec);
  if (!Number.isInteger(listen) || listen < 1 || listen > 65535) return null;
  if (kind === 'D') return { kind, listen, bind };
  const hp = splitHostPort(parts[1] ?? '');
  if (!hp?.port) return null;
  return { kind, listen, bind, host: hp.host, port: hp.port };
}

export function parseSshConfig(text: string): Imported[] {
  const out: Imported[] = [];
  let cur: Imported | null = null;
  const yes = (v: string) => /^(yes|true)$/i.test(v);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^(\S+)\s*(?:=\s*|\s+)(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host' || key === 'match') {
      cur = null;
      if (key === 'match') continue;
      // One entry per plain alias; patterns (*, ?, !) are defaults, not computers.
      const alias = value.split(/\s+/).find((a) => !/[*?!]/.test(a));
      if (!alias) continue;
      cur = { conn: { name: alias, protocol: 'ssh', host: alias, ssh: {} } };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const c = cur.conn;
    switch (key) {
      case 'hostname': c.host = value; break;
      case 'user': c.user = value; break;
      case 'port': c.port = Number(value) === 22 ? undefined : Number(value) || undefined; break;
      case 'identityfile': c.keyFile = value; c.auth = 'key'; break;
      case 'proxyjump': if (value.toLowerCase() !== 'none') c.jump = value.split(',').map((s) => s.trim()).filter(Boolean); break;
      case 'forwardx11': case 'forwardx11trusted': if (yes(value)) c.ssh = { ...c.ssh, x11: true }; break;
      case 'forwardagent': if (yes(value)) c.ssh = { ...c.ssh, agent: true }; break;
      case 'localforward': case 'remoteforward': case 'dynamicforward': {
        const f = sshForward(key === 'localforward' ? 'L' : key === 'remoteforward' ? 'R' : 'D', value);
        if (f) c.ssh = { ...c.ssh, forwards: [...(c.ssh?.forwards ?? []), f] };
        break;
      }
    }
  }
  for (const i of out) if (i.conn.ssh && !Object.keys(i.conn.ssh).length) delete i.conn.ssh;
  return out;
}

const sshAlias = (name: string) => name.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9._@-]/g, '') || 'host';

export function toSshConfig(list: Connection[]): string {
  const blocks: string[] = [];
  for (const c of list) {
    if (c.protocol !== 'ssh' && c.protocol !== 'mosh') continue;
    const l = [`Host ${sshAlias(c.name)}`, `    HostName ${c.host}`];
    if (c.user) l.push(`    User ${c.user}`);
    if (c.port && c.port !== 22) l.push(`    Port ${c.port}`);
    if (c.keyFile) l.push(`    IdentityFile ${c.keyFile}`);
    if (c.jump?.length) l.push(`    ProxyJump ${c.jump.join(',')}`);
    if (c.ssh?.x11) l.push('    ForwardX11 yes');
    if (c.ssh?.agent) l.push('    ForwardAgent yes');
    for (const f of c.ssh?.forwards ?? []) {
      const listen = f.bind ? `${f.bind}:${f.listen}` : String(f.listen);
      if (f.kind === 'D') l.push(`    DynamicForward ${listen}`);
      else l.push(`    ${f.kind === 'L' ? 'LocalForward' : 'RemoteForward'} ${listen} ${f.host?.includes(':') ? `[${f.host}]` : f.host}:${f.port}`);
    }
    blocks.push(l.join('\n'));
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

// ---------------------------------------------------------------- Keeper's JSON

export const JSON_FORMAT = 'keeper-remote-desktops';

const PROTOS: Protocol[] = ['rdp', 'vnc', 'ssh', 'mosh', 'telnet', 'serial', 'spice', 'x2go', 'winrm', 'web', 'keeper'];

/** Keeps only fields a connection may have, with the right types (files from elsewhere are not trusted). */
export function cleanConnection(x: unknown): Omit<Connection, 'id' | 'created'> | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const str = (v: unknown, max = 500) => (typeof v === 'string' && v.length <= max ? v : undefined);
  const protocol = PROTOS.includes(o.protocol as Protocol) ? (o.protocol as Protocol) : null;
  const host = str(o.host, 300);
  if (!protocol || !host) return null;
  const port = typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? o.port : undefined;
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (JSON.parse(JSON.stringify(v)) as Record<string, unknown>) : undefined);
  return {
    name: str(o.name, 200) || host,
    protocol,
    host,
    port: port === defaultPort(protocol) ? undefined : port,
    user: str(o.user, 200),
    domain: str(o.domain, 200),
    folder: str(o.folder, 200),
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 30) : undefined,
    color: str(o.color, 30),
    favourite: o.favourite === true || undefined,
    notes: str(o.notes, 5000),
    auth: (['password', 'key', 'agent', 'interactive', 'none'] as const).find((a) => a === o.auth),
    keyFile: str(o.keyFile, 1000),
    askEveryTime: o.askEveryTime === true || undefined,
    gateway: obj(o.gateway) as Connection['gateway'],
    jump: Array.isArray(o.jump) ? o.jump.filter((t): t is string => typeof t === 'string') : undefined,
    mac: str(o.mac, 40),
    rdp: obj(o.rdp) as Connection['rdp'],
    vnc: obj(o.vnc) as Connection['vnc'],
    ssh: obj(o.ssh) as Connection['ssh'],
    serial: obj(o.serial) as Connection['serial'],
    web: obj(o.web) as Connection['web'],
    winrm: obj(o.winrm) as Connection['winrm'],
    spice: obj(o.spice) as Connection['spice'],
    hostKey: str(o.hostKey, 200),
  };
}

export function parseJson(text: string): Imported[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return []; }
  const list = Array.isArray(data) ? data : (data as { connections?: unknown[] })?.connections;
  if (!Array.isArray(list)) return [];
  return list.map(cleanConnection).filter((c): c is NonNullable<typeof c> => !!c).map((conn) => ({ conn }));
}

export function toJson(list: Connection[]): string {
  // hasPassword says a secret is in this computer's keychain; it means nothing elsewhere.
  const connections = list.map(({ hasPassword: _h, lastUsed: _l, ...c }) => c);
  return JSON.stringify({ format: JSON_FORMAT, version: 1, connections }, null, 2) + '\n';
}

export function importText(text: string, format: Format, fileName = ''): Imported[] {
  if (format === 'rdp') return parseRdp(text, fileName);
  if (format === 'vnc') return parseVnc(text, fileName);
  if (format === 'ssh') return parseSshConfig(text);
  return parseJson(text);
}

export function exportText(list: Connection[], format: Format): string {
  if (format === 'json') return toJson(list);
  if (format === 'ssh') return toSshConfig(list);
  const c = list[0];
  if (!c) return '';
  return format === 'rdp' ? toRdp(c) : toVnc(c);
}

/** Drops all signs of a secret from anything that gets logged or shown. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 1) out = out.split(s).join('••••');
  return out;
}
