// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs cloudflared so this device can be reached from anywhere at a stable
// https address, and keeps it running: it restarts after a crash (waiting a
// little longer each time), after sleep or a network change, and when its
// metrics say it has lost every connection. Plain Node, no Electron.

import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream, promises as fsp } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { TunnelStatus } from '../../../core/api-link';
import { backoff, CLOUDFLARED_VERSION, cloudflaredAsset, parseLogLine, parseQuickUrl, readyConnections, tunnelArgs, type TunnelConfig, type TunnelMode } from '../../../core/link/cloudflared';

export interface SupervisorOptions {
  /** where the downloaded binary lives */
  binDir: string;
  /** use this binary instead of downloading (tests, or one the person installed) */
  binPath?: string;
  /** the local port the tunnel points at */
  port: () => number;
  token: () => Promise<string | undefined>;
  onStatus: (s: TunnelStatus) => void;
  onUrl: (url: string | undefined) => void;
  platform?: string;
  arch?: string;
  fetchFn?: typeof fetch;
  /** for tests: seconds before restart n */
  backoff?: (n: number) => number;
  /** how often to look at the metrics while running (ms) */
  healthEveryMs?: number;
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

export class TunnelSupervisor {
  status: TunnelStatus = { mode: 'off', state: 'off', connections: 0, restarts: 0, service: false, hasToken: false };
  private child: ChildProcess | null = null;
  private config: TunnelConfig = { mode: 'off' };
  private stopping = false;
  private restartTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private failures = 0;
  private metricsPort = 0;
  private zeroSince = 0;

  constructor(private o: SupervisorOptions) {}

  private set(p: Partial<TunnelStatus>) {
    this.status = { ...this.status, ...p };
    this.o.onStatus({ ...this.status });
  }

  private binName() {
    return (this.o.platform ?? process.platform) === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  }

  /** Downloads the pinned cloudflared once and checks its SHA-256 before it may run. */
  async ensureBinary(): Promise<string> {
    if (this.o.binPath) return this.o.binPath;
    const dir = path.join(this.o.binDir, CLOUDFLARED_VERSION);
    const bin = path.join(dir, this.binName());
    if (await fsp.access(bin).then(() => true, () => false)) return bin;
    const asset = cloudflaredAsset(this.o.platform ?? process.platform, this.o.arch ?? process.arch);
    if (!asset) throw new Error('Cloudflare does not make cloudflared for this computer');
    await fsp.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, asset.file + '.download');
    this.set({ state: 'downloading', download: 0 });
    const res = await (this.o.fetchFn ?? fetch)(asset.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`Could not download cloudflared (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    let got = 0;
    let last = 0;
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    body.on('data', (c: Buffer) => {
      hash.update(c);
      got += c.length;
      if (total && Date.now() - last > 300) {
        last = Date.now();
        this.set({ download: Math.round((got / total) * 100) });
      }
    });
    await pipeline(body, createWriteStream(tmp));
    const sum = hash.digest('hex');
    if (sum !== asset.sha256) {
      await fsp.rm(tmp, { force: true });
      throw new Error('The downloaded cloudflared did not match its published checksum, so it was not used');
    }
    if (asset.archive === 'tgz') {
      await new Promise<void>((resolve, reject) => {
        const t = spawn('tar', ['-xzf', tmp, '-C', dir], { stdio: 'ignore' });
        t.on('error', reject);
        t.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('Could not unpack cloudflared'))));
      });
      await fsp.rm(tmp, { force: true });
    } else await fsp.rename(tmp, bin);
    await fsp.chmod(bin, 0o755).catch(() => undefined);
    return bin;
  }

  async start(config: TunnelConfig): Promise<TunnelStatus> {
    await this.stop();
    this.stopping = false;
    this.config = config;
    this.failures = 0;
    if (config.mode === 'off') return this.set({ mode: 'off', state: 'off', url: undefined, connections: 0 }), this.status;
    const hasToken = !!(await this.o.token());
    if (config.mode === 'named' && !hasToken) {
      this.set({ mode: 'named', state: 'error', lastError: 'Paste the tunnel token from your Cloudflare dashboard first', hasToken });
      return this.status;
    }
    this.set({ mode: config.mode, state: 'starting', restarts: 0, lastError: undefined, url: config.mode === 'named' && config.hostname ? `https://${config.hostname.replace(/^https?:\/\//, '')}` : undefined, hasToken });
    try {
      await this.spawn();
    } catch (e) {
      this.set({ state: 'error', lastError: e instanceof Error ? e.message : String(e) });
    }
    return this.status;
  }

  private async spawn() {
    const bin = await this.ensureBinary();
    this.metricsPort = await freePort();
    const env: NodeJS.ProcessEnv = { ...process.env, NO_AUTOUPDATE: 'true' };
    if (this.config.mode === 'named') env.TUNNEL_TOKEN = (await this.o.token()) ?? '';
    const child = spawn(bin, tunnelArgs(this.config, this.o.port(), this.metricsPort), { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.zeroSince = Date.now();
    this.set({ state: this.status.state === 'reconnecting' ? 'reconnecting' : 'starting', connections: 0 });
    const onLine = (line: string) => {
      const url = parseQuickUrl(line);
      if (url && this.config.mode === 'quick') {
        this.set({ url });
        this.o.onUrl(url);
      }
      const ev = parseLogLine(line);
      if (ev.connected) {
        this.failures = 0;
        this.set({ state: 'connected', since: this.status.since && this.status.state === 'connected' ? this.status.since : Date.now(), connections: Math.max(1, this.status.connections) });
        if (this.config.mode === 'named') this.o.onUrl(this.status.url);
      } else if (ev.error) this.set({ lastError: ev.error });
    };
    let buf = '';
    const read = (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) onLine(l);
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.on('error', (e) => this.set({ state: 'error', lastError: e.message }));
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.healthTimer);
      if (this.stopping) return;
      this.failures++;
      const wait = (this.o.backoff ?? backoff)(this.failures);
      this.set({ state: 'reconnecting', connections: 0, restarts: this.status.restarts + 1, lastError: this.status.lastError ?? `cloudflared stopped (exit ${code})` });
      if (this.config.mode === 'quick') this.o.onUrl(undefined);
      this.restartTimer = setTimeout(() => void this.spawn().catch((e) => this.set({ state: 'error', lastError: String(e) })), wait * 1000);
      this.restartTimer.unref?.();
    });
    this.scheduleHealth();
  }

  /** Looks at cloudflared's own metrics; restarts it if it has had no connection for two minutes. */
  private scheduleHealth() {
    clearTimeout(this.healthTimer);
    this.healthTimer = setTimeout(async () => {
      if (!this.child) return;
      try {
        const r = await (this.o.fetchFn ?? fetch)(`http://127.0.0.1:${this.metricsPort}/metrics`, { signal: AbortSignal.timeout(4000) });
        const n = readyConnections(await r.text());
        if (n > 0) {
          this.zeroSince = 0;
          if (this.status.connections !== n || this.status.state !== 'connected') this.set({ connections: n, state: 'connected', since: this.status.since ?? Date.now() });
        } else {
          if (!this.zeroSince) this.zeroSince = Date.now();
          if (this.status.state === 'connected') this.set({ state: 'reconnecting', connections: 0 });
          if (Date.now() - this.zeroSince > 120_000) this.child?.kill();
        }
      } catch {
        /* metrics not up yet */
      }
      this.scheduleHealth();
    }, this.o.healthEveryMs ?? 30_000);
    this.healthTimer.unref?.();
  }

  /** After sleep or a network change: if it is not connected, start it again now. */
  kick() {
    if (this.config.mode === 'off' || this.stopping) return;
    if (this.status.state === 'connected') return;
    clearTimeout(this.restartTimer);
    if (this.child) this.child.kill();
    else void this.spawn().catch(() => undefined);
  }

  async stop(): Promise<TunnelStatus> {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.healthTimer);
    const c = this.child;
    this.child = null;
    if (c) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          c.kill('SIGKILL');
          resolve();
        }, 3000);
        c.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
        c.kill();
      });
    }
    this.o.onUrl(undefined);
    this.set({ state: this.config.mode === 'off' ? 'off' : 'stopped', connections: 0, url: this.config.mode === 'quick' ? undefined : this.status.url });
    return this.status;
  }

  get mode(): TunnelMode {
    return this.config.mode;
  }
}
