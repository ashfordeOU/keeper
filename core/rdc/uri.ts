// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What people type into the quick-connect bar: rdp://host, vnc://host:5901,
// ssh user@host -p 2222, user@host, a bare host or address (IPv6 too), and the
// same links back out (keeper rdc add <uri>).

import { defaultPort, type Connection, type Protocol } from './types';

export interface Target {
  protocol?: Protocol;
  host: string;
  port?: number;
  user?: string;
  /** the protocol was not named and has to be guessed (by probing ports) */
  guess: boolean;
  /** anything else the text said (a serial speed, a web address, a jump host…) */
  extra?: Partial<Connection>;
}

const SCHEMES: Record<string, Protocol> = {
  rdp: 'rdp', ms_rd: 'rdp', 'ms-rd': 'rdp', vnc: 'vnc', ssh: 'ssh', sftp: 'ssh', mosh: 'mosh', telnet: 'telnet',
  serial: 'serial', spice: 'spice', x2go: 'x2go', nx: 'x2go', winrm: 'winrm', pwsh: 'winrm', powershell: 'winrm',
  http: 'web', https: 'web', keeper: 'keeper',
};

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const V4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function validHost(h: string): boolean {
  if (!h || h.length > 253) return false;
  if (V4_RE.test(h)) return h.split('.').every((n) => Number(n) <= 255);
  if (h.includes(':')) return /^[0-9a-fA-F:.%A-Za-z0-9]+$/.test(h) && h.split(':').length >= 3;
  return HOST_RE.test(h);
}

/** host, host:port, [v6]:port, a bare v6 address. */
export function splitHostPort(s: string): { host: string; port?: number } | null {
  const t = s.trim();
  if (!t) return null;
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(t);
  if (v6) return validHost(v6[1]) ? { host: v6[1], port: v6[2] ? Number(v6[2]) : undefined } : null;
  if ((t.match(/:/g) ?? []).length > 1) return validHost(t) ? { host: t } : null;
  const m = /^([^:]+)(?::(\d+))?$/.exec(t);
  if (!m || !validHost(m[1])) return null;
  const port = m[2] ? Number(m[2]) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) return null;
  return { host: m[1], port };
}

/** VNC display numbers: vnc://host:1 means port 5901; vnc://host::5901 and ports ≥ 100 are ports. */
export function vncPort(spec: string | undefined): number | undefined {
  if (spec === undefined || spec === '') return undefined;
  if (spec.startsWith(':')) return Number(spec.slice(1));
  const n = Number(spec);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n < 100 ? 5900 + n : n;
}

function parseUri(text: string): Target | null {
  const m = /^([a-z][a-z0-9+_.-]*):\/\/(.*)$/i.exec(text);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const protocol = SCHEMES[scheme];
  if (!protocol) return null;
  let rest = m[2];
  if (protocol === 'web') {
    let u: URL;
    try { u = new URL(text); } catch { return null; }
    return { protocol, host: u.hostname.replace(/^\[|\]$/g, ''), port: u.port ? Number(u.port) : undefined, guess: false, extra: { web: { url: u.toString() } } };
  }
  if (protocol === 'serial') {
    // serial:///dev/ttyUSB0?baud=115200   serial://COM3?baud=9600
    const [dev, q] = rest.split('?');
    const baud = Number(new URLSearchParams(q ?? '').get('baud') ?? 9600) || 9600;
    const device = decodeURIComponent(dev || '');
    return device ? { protocol, host: device, guess: false, extra: { serial: { baud } } } : null;
  }
  if (protocol === 'rdp' && /=/.test(rest) && !/@|^\[/.test(rest.split(/[&?]/)[0] ?? '')) {
    // The documented form: rdp://full%20address=s:host:3389&username=s:user
    const fields: Record<string, string> = {};
    for (const part of rest.split('&')) {
      const [k, ...v] = decodeURIComponent(part).split('=');
      fields[k.trim().toLowerCase()] = v.join('=').replace(/^[sib]:/, '');
    }
    const hp = splitHostPort(fields['full address'] ?? '');
    if (!hp) return null;
    return { protocol, host: hp.host, port: hp.port, user: fields.username || undefined, guess: false };
  }
  // user@host:port/path?query
  rest = rest.replace(/[/?#].*$/, '');
  let user: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at >= 0) {
    user = decodeURIComponent(rest.slice(0, at)).split(';')[0];
    rest = rest.slice(at + 1);
  }
  if (protocol === 'vnc') {
    const v6 = /^\[([^\]]+)\](?::(:?\d+))?$/.exec(rest);
    const m2 = v6 ?? /^([^:]+)(?::(:?\d+))?$/.exec(rest);
    if (!m2 || !validHost(m2[1])) return null;
    return { protocol, host: m2[1], port: vncPort(m2[2]), user: user || undefined, guess: false };
  }
  const hp = splitHostPort(rest);
  if (!hp) return null;
  return { protocol, host: hp.host, port: hp.port, user: user || undefined, guess: false };
}

/** `ssh user@host -p 2222 -J jump`, `mosh user@host`, `telnet host 23`. */
function parseCommand(text: string): Target | null {
  const words = text.trim().split(/\s+/);
  const cmd = words[0].toLowerCase();
  if (!['ssh', 'mosh', 'telnet', 'vnc', 'rdp'].includes(cmd)) return null;
  let port: number | undefined;
  let user: string | undefined;
  let target: string | undefined;
  const jump: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === '-p' || w === '--port') port = Number(words[++i]);
    else if (w === '-l') user = words[++i];
    else if (w === '-J') jump.push(...(words[++i] ?? '').split(',').filter(Boolean));
    else if (w.startsWith('-')) continue;
    else if (!target) target = w;
    else if (cmd === 'telnet' && /^\d+$/.test(w)) port = Number(w);
  }
  if (!target) return null;
  const at = target.lastIndexOf('@');
  if (at >= 0) {
    user = target.slice(0, at);
    target = target.slice(at + 1);
  }
  const hp = splitHostPort(target);
  if (!hp) return null;
  const protocol = cmd as Protocol;
  return { protocol, host: hp.host, port: port ?? hp.port, user, guess: false, extra: jump.length ? { jump } : undefined };
}

/** Anything typed into the quick-connect bar. Null when it is not a host at all. */
export function parseTarget(input: string): Target | null {
  const text = input.trim();
  if (!text) return null;
  const uri = parseUri(text);
  if (uri) return uri;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  const cmd = parseCommand(text);
  if (cmd) return cmd;
  if (/\s/.test(text)) return null;
  // user@host[:port] means SSH; a bare host or host:port is guessed by probing.
  const at = text.lastIndexOf('@');
  if (at > 0) {
    const hp = splitHostPort(text.slice(at + 1));
    return hp ? { protocol: 'ssh', host: hp.host, port: hp.port, user: text.slice(0, at), guess: false } : null;
  }
  // A Windows serial port or a device path.
  if (/^COM\d+$/i.test(text) || /^\/dev\/(tty|cu)\S+$/.test(text)) return { protocol: 'serial', host: text, guess: false, extra: { serial: { baud: 9600 } } };
  const hp = splitHostPort(text);
  if (!hp) return null;
  // A known port names its protocol.
  const byPort: Record<number, Protocol> = { 3389: 'rdp', 22: 'ssh', 23: 'telnet', 5985: 'winrm', 5986: 'winrm', 443: 'web' };
  if (hp.port && byPort[hp.port]) return { protocol: byPort[hp.port], host: hp.host, port: hp.port, guess: false };
  if (hp.port && hp.port >= 5900 && hp.port <= 5999) return { protocol: 'vnc', host: hp.host, port: hp.port, guess: false };
  return { host: hp.host, port: hp.port, guess: true };
}

const hostPart = (h: string) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);

/** A connection as a link (no secrets, ever). */
export function toUri(c: Pick<Connection, 'protocol' | 'host' | 'port' | 'user' | 'web' | 'serial'>): string {
  if (c.protocol === 'web') return c.web?.url || `https://${hostPart(c.host)}${c.port && c.port !== 443 ? `:${c.port}` : ''}/`;
  if (c.protocol === 'serial') return `serial://${encodeURI(c.host)}?baud=${c.serial?.baud ?? 9600}`;
  const user = c.user ? `${encodeURIComponent(c.user)}@` : '';
  const port = c.port && c.port !== defaultPort(c.protocol) ? `:${c.port}` : '';
  return `${c.protocol}://${user}${hostPart(c.host)}${port}`;
}

/** Ports the quick-connect bar probes when the protocol is not named. */
export const GUESS_PORTS = [3389, 5900, 5901, 5902, 5903, 5904, 5905, 5906, 5907, 5908, 5909, 5910, 22, 5985];

/** The best protocol for the ports that answered (RDP, then VNC, then SSH, then PowerShell). */
export function guessFromPorts(open: number[]): { protocol: Protocol; port: number } | null {
  const has = (p: number) => open.includes(p);
  if (has(3389)) return { protocol: 'rdp', port: 3389 };
  const vnc = open.filter((p) => p >= 5900 && p <= 5910).sort((a, b) => a - b)[0];
  if (vnc) return { protocol: 'vnc', port: vnc };
  if (has(22)) return { protocol: 'ssh', port: 22 };
  if (has(5985)) return { protocol: 'winrm', port: 5985 };
  return null;
}
