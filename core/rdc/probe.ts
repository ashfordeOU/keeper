// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A light TCP knock: does anything answer on these ports? Used to guess the
// protocol of a bare host and for the status dots. Connects, then closes at
// once; nothing is sent. Node only (main process and the keeper command).

import net from 'node:net';
import type { ProbeResult } from './types';

export type Dial = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

export const tcpDial: Dial = (host, port, timeoutMs) => new Promise((resolve) => {
  const s = net.connect({ host, port });
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(t);
    s.destroy();
    resolve(ok);
  };
  const t = setTimeout(() => finish(false), timeoutMs);
  s.once('connect', () => finish(true));
  s.once('error', () => finish(false));
});

/** Knocks on every port at once (bounded), each with its own short time limit. */
export async function probePorts(host: string, ports: number[], opts: { timeoutMs?: number; dial?: Dial; parallel?: number } = {}): Promise<ProbeResult[]> {
  const timeout = opts.timeoutMs ?? 700;
  const dial = opts.dial ?? tcpDial;
  const parallel = Math.max(1, opts.parallel ?? 8);
  const out: ProbeResult[] = [];
  let i = 0;
  const worker = async () => {
    while (i < ports.length) {
      const port = ports[i++];
      const t0 = Date.now();
      const open = await dial(host, port, timeout).catch(() => false);
      out.push({ port, open, ms: open ? Date.now() - t0 : undefined });
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, ports.length) }, worker));
  return ports.map((p) => out.find((r) => r.port === p)!);
}
