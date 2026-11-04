// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// POP3 accounts: a small client (SSL/TLS, or STLS upgraded, plain only on
// this computer) and a mailbox that downloads new mail into a store on this
// computer (local-mail.ts), keeping a copy on the server unless the person
// chose otherwise. Each check connects, downloads what is new and leaves.

import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { multiLineEnd, parseUidl, pop3Plan, statusLine, unstuff } from '../../../core/pim/pop3';
import { assertSecure, explainTls } from '../../../core/pim/security';
import type { Account, MessageSummary, ServerSettings } from '../../../core/pim/types';
import { LocalMailbox } from './local-mail';
import type { Auth } from './mail';
import { hash, pimDir, readJson, writeJson } from './store';

export class Pop3Client {
  private sock!: net.Socket;
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private closed = false;
  private onClose = () => { this.closed = true; for (const w of this.waiters.splice(0)) w(); };

  constructor(private s: ServerSettings, private insecure?: boolean) {}

  private onData = (d: Buffer) => {
    this.buf = Buffer.concat([this.buf, d]);
    for (const w of this.waiters.splice(0)) w();
  };

  private async more(): Promise<void> {
    if (this.closed) throw new Error('The mail server closed the connection');
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The mail server stopped answering')), 30_000);
      this.waiters.push(() => { clearTimeout(t); if (this.closed) reject(new Error('The mail server closed the connection')); else resolve(); });
    });
  }

  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i >= 0) {
        const l = this.buf.subarray(0, i).toString('utf8');
        this.buf = this.buf.subarray(i + 2);
        return l;
      }
      await this.more();
    }
  }

  private async block(): Promise<Buffer> {
    for (;;) {
      const end = multiLineEnd(this.buf);
      if (end >= 0) {
        const body = this.buf.subarray(0, end);
        this.buf = this.buf.subarray(end + 3);
        return unstuff(body);
      }
      await this.more();
    }
  }

  private async cmd(c: string, multi = false): Promise<{ text: string; body?: Buffer }> {
    this.sock.write(`${c}\r\n`);
    const r = statusLine(await this.line());
    if (!r.ok) throw new Error(/^(PASS|USER)/.test(c) ? `The server did not accept the user name or password${r.text ? ` (${r.text})` : ''}` : r.text || 'The server said no');
    return multi ? { text: r.text, body: await this.block() } : { text: r.text };
  }

  async connect(auth: Auth) {
    assertSecure(this.s, 'Incoming mail');
    const opts = { host: this.s.host, port: this.s.port, servername: net.isIP(this.s.host) ? undefined : this.s.host, rejectUnauthorized: !this.insecure };
    try {
      this.sock = await new Promise<net.Socket>((resolve, reject) => {
        const s = this.s.security === 'tls' ? tls.connect(opts, () => resolve(s)) : net.connect(this.s.port, this.s.host, () => resolve(s));
        s.once('error', reject);
        s.setTimeout(60_000, () => s.destroy(new Error('The mail server stopped answering')));
      });
      this.sock.on('data', this.onData);
      this.sock.on('error', () => undefined);
      this.sock.on('close', this.onClose);
      const hello = statusLine(await this.line());
      if (!hello.ok) throw new Error(hello.text || 'The server is not ready');
      if (this.s.security === 'starttls') {
        await this.cmd('STLS');
        this.sock.removeListener('data', this.onData);
        this.sock.removeListener('close', this.onClose);
        const plain = this.sock;
        this.sock = await new Promise<net.Socket>((resolve, reject) => {
          const s = tls.connect({ ...opts, socket: plain }, () => resolve(s));
          s.once('error', reject);
        });
        this.sock.on('data', this.onData);
        this.sock.on('error', () => undefined);
        this.sock.on('close', this.onClose);
      }
    } catch (e) {
      this.sock?.destroy();
      throw explainTls(e, this.s.host);
    }
    try {
      if ('accessToken' in auth) throw new Error('This POP3 server is not set up for signing in with a token');
      await this.cmd(`USER ${auth.user}`);
      await this.cmd(`PASS ${auth.pass}`);
    } catch (e) {
      // Signing in failed: the connection is not left open.
      this.sock.destroy();
      throw e;
    }
  }

  async uidl() {
    return parseUidl((await this.cmd('UIDL', true)).body!.toString('latin1'));
  }
  async retr(n: number): Promise<Buffer> {
    return (await this.cmd(`RETR ${n}`, true)).body!;
  }
  async dele(n: number) {
    await this.cmd(`DELE ${n}`);
  }
  async quit() {
    await this.cmd('QUIT').catch(() => undefined);
    this.sock.end();
  }
}

/** What a POP3 account downloaded before (unique id → when), so nothing comes twice. */
const seenFile = (account: string) => path.join(pimDir(), 'local-mail', hash(account), 'pop3-seen.json');

export class Pop3Mailbox extends LocalMailbox {
  constructor(account: Account, private auth: () => Promise<Auth>) {
    super(account);
  }

  private server(): ServerSettings {
    if (!this.account.pop3) throw new Error('This account has no incoming server');
    return this.account.pop3;
  }

  async test() {
    const c = new Pop3Client(this.server(), this.account.insecureTls);
    await c.connect(await this.auth());
    await c.quit();
  }

  /** The inbox: what is new on the server is downloaded first. */
  async sync(folder: string): Promise<{ messages: MessageSummary[]; added: MessageSummary[] }> {
    if (folder !== 'INBOX') return super.sync(folder);
    const added = await this.download();
    const r = await super.sync(folder);
    return { messages: r.messages, added };
  }

  async download(): Promise<MessageSummary[]> {
    const c = new Pop3Client(this.server(), this.account.insecureTls);
    await c.connect(await this.auth());
    const seen = await readJson<Record<string, number>>(seenFile(this.account.id), {});
    const keep = this.account.keepOnServer !== false;
    const added: MessageSummary[] = [];
    try {
      const list = await c.uidl();
      const plan = pop3Plan(list, seen, { keep, now: Date.now() });
      for (const x of plan.fetch) {
        const raw = await c.retr(x.n);
        const uid = await this.append('INBOX', raw, []);
        seen[x.uid] = Date.now();
        if (uid !== undefined) added.push(...(await this.summaries('INBOX', [uid])));
        if (!keep) await c.dele(x.n);
      }
      for (const n of plan.remove) await c.dele(n);
      // Ids no longer on the server are forgotten (the list stays small).
      for (const k of Object.keys(seen)) if (!list.some((x) => x.uid === k)) delete seen[k];
      await writeJson(seenFile(this.account.id), seen);
      await this.flush();
    } finally {
      await c.quit();
    }
    return added;
  }
}
