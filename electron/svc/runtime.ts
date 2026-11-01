// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The other end of electron/svc/host.ts, inside a service process: answers
// calls from the main process with the service's own functions.

type Handler = (...args: never[]) => unknown;

interface ParentPort {
  on(event: 'message', fn: (e: { data: { id: number; method: string; args: unknown[] } }) => void): void;
  postMessage(m: unknown): void;
}

export function serve(handlers: Record<string, Handler>, init?: (config: never) => void) {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (!port) throw new Error('not started as a Keeper service process');
  port.on('message', async ({ data }) => {
    const { id, method, args } = data;
    if (method === '__init') {
      try { init?.(args[0] as never); } catch { /* the first call reports problems */ }
      return;
    }
    const fn = handlers[method];
    if (!fn) return port.postMessage({ id, ok: false, error: `unknown method ${method}` });
    try {
      port.postMessage({ id, ok: true, value: await fn(...(args as never[])) });
    } catch (e) {
      port.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  // Never outlive Keeper: if the main process is gone (even killed outright), leave too.
  process.on('disconnect', () => process.exit(0));
  const parent = process.ppid;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 3000).unref();
}
