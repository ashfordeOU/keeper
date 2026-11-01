// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Reaching a connection's computer: directly, at a mesh address, through a
// paired Keeper device (a Keeper Link port forward), through an SSH server (a
// tunnel made with ssh2, checked against known_hosts) or through an HTTP or
// SOCKS5 proxy. Every way ends in a host and port to dial; the indirect ones
// are a listener on 127.0.0.1 that lives as long as the session.

import { promises as fsp, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { checkKnownHost, fingerprint, keyType, knownHostsLine } from '../../../core/rdc/knownhosts';
import { dialViaProxy } from '../../../core/rdc/proxy';
import type { Connection } from '../../../core/rdc/types';
import { portOf } from '../../../core/rdc/clients';

export interface Endpoint {
  host: string;
  port: number;
  /** in words, for the session list */
  via?: string;
  /** the real host when this is a local forward */
  aliasOf?: string;
  close(): void;
}

export class HostKeyQuestion extends Error {
  constructor(public key: { host: string; port: number; type: string; fingerprint: string; changed?: boolean }) {
    super(key.changed ? `The SSH key of ${key.host} changed` : `First connection to ${key.host}`);
  }
}

export interface GatewayDeps {
  secret(name: string): Promise<string | undefined>;
  /** a Keeper Link port forward to host:port on a paired device; returns the local port and how to remove it */
  linkForward(device: string, host: string, port: number): Promise<{ localPort: number; remove: () => void; name: string }>;
  /** a host key the person trusted just now */
  trustedKey?: string;
}

/** A free port on 127.0.0.1 (for a Link forward that needs one chosen up front). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/** A listener on 127.0.0.1 that hands each connection to `dial`. */
function localListener(dial: () => Promise<net.Socket | NodeJS.ReadWriteStream>): Promise<{ port: number; close: () => void }> {
  const socks = new Set<net.Socket>();
  const srv = net.createServer((client) => {
    socks.add(client);
    client.once('close', () => socks.delete(client));
    client.pause();
    dial().then((remote) => {
      const r = remote as net.Socket;
      client.pipe(r);
      r.pipe(client);
      r.on('error', () => client.destroy());
      r.on('close', () => client.destroy());
      client.on('error', () => r.destroy?.());
      client.on('close', () => r.destroy?.());
      client.resume();
    }).catch(() => client.destroy());
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({
      port: (srv.address() as net.AddressInfo).port,
      close: () => { srv.close(); for (const s of socks) s.destroy(); },
    }));
  });
}

export function knownHostsFile(): string {
  return path.join(os.homedir(), '.ssh', 'known_hosts');
}

function knownHostsText(): string {
  try { return readFileSync(knownHostsFile(), 'utf8'); } catch { return ''; }
}

/** Asks an SSH server for its key without signing in. */
export async function fetchHostKey(host: string, port: number, timeoutMs = 6000): Promise<{ type: string; b64: string; fingerprint: string } | null> {
  const { Client } = await import('ssh2');
  return new Promise((resolve) => {
    const c = new Client();
    let got: { type: string; b64: string; fingerprint: string } | null = null;
    const done = () => { try { c.end(); } catch { /* closed */ } resolve(got); };
    const t = setTimeout(done, timeoutMs);
    c.on('error', () => { clearTimeout(t); done(); });
    c.on('close', () => { clearTimeout(t); done(); });
    try {
      c.connect({
        host, port, username: 'keeper-host-key-check', readyTimeout: timeoutMs,
        hostVerifier: (key: Buffer) => {
          got = { type: keyType(key), b64: Buffer.from(key).toString('base64'), fingerprint: fingerprint(key) };
          clearTimeout(t);
          setImmediate(done);
          return false;
        },
      });
    } catch {
      clearTimeout(t);
      done();
    }
  });
}

/** Checks (and with the person's yes, records) an SSH server's key in ~/.ssh/known_hosts. `recordAs` is the
 * name ssh looks it up by when the address is a local forward (HostKeyAlias). */
export async function verifyHostKey(host: string, port: number, trusted?: string, recordAs?: { host: string; port: number }): Promise<void> {
  const k = await fetchHostKey(host, port);
  if (!k) return; // not reachable directly (a jump host in between): ssh checks it itself
  const name = recordAs ?? { host, port };
  const state = checkKnownHost(knownHostsText(), name.host, name.port, k.type, k.b64);
  if (state === 'known') return;
  if (state === 'changed') throw new HostKeyQuestion({ host: name.host, port: name.port, type: k.type, fingerprint: k.fingerprint, changed: true });
  if (trusted !== k.fingerprint) throw new HostKeyQuestion({ host: name.host, port: name.port, type: k.type, fingerprint: k.fingerprint });
  await fsp.mkdir(path.dirname(knownHostsFile()), { recursive: true, mode: 0o700 });
  const cur = knownHostsText();
  await fsp.appendFile(knownHostsFile(), `${cur && !cur.endsWith('\n') ? '\n' : ''}${knownHostsLine(name.host, name.port, k.type, k.b64)}\n`, { mode: 0o600 });
}

async function sshTunnel(c: Connection, g: Extract<NonNullable<Connection['gateway']>, { kind: 'ssh' }>, port: number, deps: GatewayDeps): Promise<Endpoint> {
  const gport = g.port ?? 22;
  await verifyHostKey(g.host, gport, deps.trustedKey);
  const { Client } = await import('ssh2');
  const client = new Client();
  const password = await deps.secret(`rdc:${c.id}:gateway`);
  const keyFile = g.keyFile ?? c.keyFile;
  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', (e) => reject(new Error(`SSH gateway ${g.host}: ${e.message}`)));
    client.connect({
      host: g.host, port: gport, username: g.user ?? os.userInfo().username, readyTimeout: 15_000, keepaliveInterval: 30_000,
      password,
      privateKey: keyFile ? readFileSync(keyFile.replace(/^~(?=$|[\\/])/, os.homedir())) : undefined,
      agent: process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK,
      // Checked above against known_hosts (and recorded with the person's yes).
      hostVerifier: (key: Buffer) => checkKnownHost(knownHostsText(), g.host, gport, keyType(key), Buffer.from(key).toString('base64')) === 'known',
    });
  });
  const l = await localListener(() => new Promise((resolve, reject) => client.forwardOut('127.0.0.1', 0, c.host, port, (e, stream) => (e ? reject(e) : resolve(stream as unknown as net.Socket)))));
  return { host: '127.0.0.1', port: l.port, aliasOf: c.host, via: `through SSH (${g.host})`, close: () => { l.close(); client.end(); } };
}

/** Where to dial for a connection, opening a tunnel or forward when it needs one. */
export async function openEndpoint(c: Connection, deps: GatewayDeps): Promise<Endpoint> {
  const port = portOf(c);
  const g = c.gateway ?? { kind: 'none' as const };
  switch (g.kind) {
    case 'mesh':
      return { host: g.address, port, via: 'over the mesh', aliasOf: c.host, close: () => undefined };
    case 'link': {
      const f = await deps.linkForward(g.device, c.host, port);
      return { host: '127.0.0.1', port: f.localPort, aliasOf: c.host, via: `through Keeper Link (${f.name})`, close: f.remove };
    }
    case 'ssh':
      // For SSH itself the gateway is a jump host (ssh -J); everything else gets a tunnel.
      if (c.protocol === 'ssh' || c.protocol === 'mosh' || c.protocol === 'x2go') return { host: c.host, port, close: () => undefined };
      return sshTunnel(c, g, port, deps);
    case 'proxy': {
      const password = g.user ? await deps.secret(`rdc:${c.id}:gateway`) : undefined;
      const l = await localListener(() => dialViaProxy({ type: g.type, host: g.host, port: g.port, user: g.user, password }, c.host, port));
      return { host: '127.0.0.1', port: l.port, aliasOf: c.host, via: `through a ${g.type === 'http' ? 'HTTP' : 'SOCKS'} proxy`, close: l.close };
    }
    default:
      return { host: c.host, port, close: () => undefined };
  }
}
