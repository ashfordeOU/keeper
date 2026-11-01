// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// `keeper browser-host`: the native messaging host for Keeper's browser
// extension. The browser starts it and writes length-prefixed JSON messages to
// its stdin. Page reports are passed to the running Keeper app over its
// private local socket; when the extension says hello, the host also links the
// browser to the app both ways: open tabs go to Keeper, and Keeper's commands
// (mute, sleep, site permissions, blocking rules) come back to the browser.
// Nothing goes anywhere else.

import { randomUUID } from 'node:crypto';
import { connectToApp, type AppConnection } from '../core/brain/client';
import { parseExtensionMessage, type ExtensionMessage } from '../core/browser-tabs';
import { decodeMessages, encodeMessage } from '../core/security/nativemsg';

export interface HostIo {
  write(o: unknown): void;
  connect(): Promise<AppConnection | null>;
}

/** The host's logic, separate from stdin/stdout so it can be tested with a fake extension and a fake app. */
export function hostSession(io: HostIo) {
  const session = randomUUID();
  let appConn: AppConnection | null | undefined;
  let hello: Extract<ExtensionMessage, { kind: 'hello' }> | undefined;
  let attached = false;
  let ping: NodeJS.Timeout | undefined;

  const conn = async () => (appConn ??= await io.connect().catch(() => null));

  const attach = async () => {
    const c = await conn();
    if (!c || !hello || attached) return;
    attached = true;
    // A long call: it stays open while the browser is linked, and Keeper's commands arrive as notifications on it.
    c.call('keeper/browser.attach', { session, browser: hello.browser, version: hello.version, caps: hello.caps }, (method, params) => {
      const p = params as { session?: string; reqId?: string; command?: unknown };
      if (method === 'keeper/browser.command' && p?.session === session) io.write({ kind: 'cmd', reqId: p.reqId, command: p.command });
    }).catch(() => undefined).finally(() => {
      attached = false;
    });
    clearInterval(ping);
    ping = setInterval(() => {
      void c.call('keeper/browser.ping', { session }).catch(() => {
        // Keeper restarted: link again on the next message.
        appConn = undefined;
        attached = false;
        clearInterval(ping);
      });
    }, 30_000);
    ping.unref?.();
  };

  return {
    session,
    async handle(raw: unknown) {
      const m = parseExtensionMessage(raw);
      if (!m) return;
      const c = await conn();
      if (!c) {
        if (m.kind === 'report') io.write({ ok: false, error: 'Keeper is not running' });
        return;
      }
      try {
        if (m.kind === 'report') {
          await c.call('keeper/security.siteReport', m as unknown as Record<string, unknown>);
          io.write({ ok: true });
        } else if (m.kind === 'hello') {
          hello = m;
          await attach();
        } else if (m.kind === 'tabs') {
          if (!attached) await attach();
          await c.call('keeper/browser.tabs', { session, tabs: m.tabs });
        } else if (m.kind === 'active') {
          await c.call('keeper/cues.active', { url: m.url, title: m.title });
        } else if (m.kind === 'cue') {
          await c.call('keeper/cues.capture', { url: m.url, title: m.title, site: m.site, text: m.text });
        } else if (m.kind === 'reply') {
          await c.call('keeper/browser.reply', { session, reqId: m.reqId, ok: m.ok, result: m.result, error: m.error });
        }
      } catch (e) {
        if (m.kind === 'report') io.write({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    },
    close() {
      clearInterval(ping);
      if (appConn) void appConn.call('keeper/browser.detach', { session }).catch(() => undefined).finally(() => appConn?.close());
    },
  };
}

export async function browserHost(): Promise<void> {
  let buf: Buffer = Buffer.alloc(0);
  const s = hostSession({ write: (o) => process.stdout.write(encodeMessage(o)), connect: () => connectToApp() });
  // Messages are handled one at a time, in order.
  let chain = Promise.resolve();
  process.stdin.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    let messages: unknown[];
    try {
      ({ messages, rest: buf } = decodeMessages(buf));
    } catch {
      process.exit(1);
    }
    for (const m of messages) chain = chain.then(() => s.handle(m));
  });
  await new Promise<void>((resolve) => process.stdin.on('end', () => resolve()));
  await chain;
  s.close();
  // let the detach go out
  await new Promise((r) => setTimeout(r, 200));
}
