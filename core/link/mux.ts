// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Many independent streams over one encrypted channel: requests, file
// transfers and forwarded ports share a connection without blocking each
// other. Each stream has its own flow-control window, so a fast sender cannot
// fill the other side's memory.
//
// Message: [type u8][stream id u32][payload]

export const enum T {
  Open = 1,
  Data = 2,
  End = 3,
  Reset = 4,
  Credit = 5,
  Ping = 6,
  Pong = 7,
}

export const WINDOW = 512 * 1024;
export const CHUNK = 64 * 1024;

export interface Carrier {
  send(plain: Uint8Array): void;
  onmessage?: (plain: Uint8Array) => void;
  onclose?: (reason?: string) => void;
  close(reason?: string): void;
}

function frame(type: T, id: number, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + (payload?.length ?? 0));
  out[0] = type;
  new DataView(out.buffer).setUint32(1, id);
  if (payload) out.set(payload, 5);
  return out;
}

const jsonBytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o ?? null));
const fromJson = (b: Uint8Array) => {
  try {
    return JSON.parse(new TextDecoder().decode(b));
  } catch {
    return null;
  }
};

export class Stream {
  private credit = WINDOW;
  private waiters: (() => void)[] = [];
  private buffered: Uint8Array[] = [];
  private ended = false;
  private trailer: unknown;
  private resetReason?: string;
  // Chunks are handed over one after another, and the end only after the last one.
  private chain: Promise<void> = Promise.resolve();
  closedLocal = false;
  done = false;
  ondata?: (chunk: Uint8Array) => void | Promise<void>;
  onend?: (trailer: unknown) => void;
  private resetFn?: (reason: string) => void;
  private resetSeen = false;

  /** Called when the stream fails; set late, it still hears about a failure that already happened. */
  get onreset() {
    return this.resetFn;
  }

  set onreset(fn: ((reason: string) => void) | undefined) {
    this.resetFn = fn;
    if (fn && this.done && this.resetReason !== undefined && !this.resetSeen) {
      this.resetSeen = true;
      const r = this.resetReason;
      queueMicrotask(() => fn(r));
    }
  }

  constructor(private mux: Mux, readonly id: number, readonly meta: Record<string, unknown>) {}

  /** Sends bytes, waiting while the other side's window is full. */
  async write(data: Uint8Array): Promise<void> {
    for (let off = 0; off < data.length; off += CHUNK) {
      const part = data.subarray(off, Math.min(data.length, off + CHUNK));
      while (this.credit < part.length) {
        if (this.done || this.mux.closed) throw new Error(this.resetReason ?? 'Connection closed');
        await new Promise<void>((r) => this.waiters.push(r));
      }
      if (this.done || this.mux.closed) throw new Error(this.resetReason ?? 'Connection closed');
      this.credit -= part.length;
      this.mux.raw(frame(T.Data, this.id, part));
    }
  }

  writeJson(o: unknown) {
    return this.write(jsonBytes(o));
  }

  end(trailer?: unknown) {
    if (this.closedLocal || this.done) return;
    this.closedLocal = true;
    this.mux.raw(frame(T.End, this.id, trailer === undefined ? undefined : jsonBytes(trailer)));
    this.maybeDone();
  }

  reset(reason = 'cancelled') {
    if (this.done) return;
    this.mux.raw(frame(T.Reset, this.id, new TextEncoder().encode(reason)));
    this.fail(reason, false);
  }

  /** Everything the other side sends, until it ends (small replies only). */
  readAll(limit = 64 * 1024 * 1024): Promise<{ data: Buffer; trailer: unknown }> {
    return new Promise((resolve, reject) => {
      const parts: Uint8Array[] = [];
      let n = 0;
      this.ondata = (c) => {
        n += c.length;
        if (n > limit) this.reset('too large');
        else parts.push(c);
      };
      this.onend = (trailer) => resolve({ data: Buffer.concat(parts), trailer });
      this.onreset = (r) => reject(new Error(r));
      void this.start();
    });
  }

  // ---- from the mux

  /** @internal */ _credit(n: number) {
    this.credit += n;
    for (const w of this.waiters.splice(0)) w();
  }

  /** @internal */ _data(chunk: Uint8Array) {
    if (!this.ondata) {
      this.buffered.push(chunk);
      return;
    }
    this.deliver(chunk);
  }

  private deliver(chunk: Uint8Array) {
    this.chain = this.chain
      .then(() => this.ondata?.(chunk))
      .then(() => this.mux.raw(frame(T.Credit, this.id, u32(chunk.length))))
      .catch((e) => {
        const m = e instanceof Error ? e.message : String(e);
        this.reset(m);
        this.onreset?.(m);
      });
  }

  /** @internal */ _end(trailer: unknown) {
    this.ended = true;
    this.trailer = trailer;
    if (this.ondata) this.chain = this.chain.then(() => this.onend?.(trailer));
    this.maybeDone();
  }

  /** Call after setting ondata/onend on an incoming stream, to deliver what came before. */
  start() {
    for (const c of this.buffered.splice(0)) this.deliver(c);
    if (this.ended) this.chain = this.chain.then(() => this.onend?.(this.trailer));
    return this.chain;
  }

  /** @internal */ fail(reason: string, notify = true) {
    if (this.done) return;
    this.done = true;
    this.resetReason = reason;
    for (const w of this.waiters.splice(0)) w();
    if (notify && this.resetFn) {
      this.resetSeen = true;
      this.resetFn(reason);
    }
    this.mux._forget(this.id);
  }

  private maybeDone() {
    if (this.ended && this.closedLocal && !this.done) {
      this.done = true;
      this.mux._forget(this.id);
    }
  }
}

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
};

export class Mux {
  private streams = new Map<number, Stream>();
  private next: number;
  private pings = new Map<number, () => void>();
  closed = false;
  closeReason?: string;
  onstream?: (s: Stream) => void;
  onclose?: (reason?: string) => void;
  /** the time the last message arrived */
  lastSeen = Date.now();

  constructor(private carrier: Carrier, initiator: boolean) {
    this.next = initiator ? 1 : 2;
    carrier.onclose = (r) => this.shut(r);
    // Start reading on the next tick, once the owner has set onstream; the carrier holds messages until then.
    queueMicrotask(() => {
      if (!this.closed) carrier.onmessage = (m) => void this.receive(m);
    });
  }

  open(meta: Record<string, unknown>): Stream {
    if (this.closed) throw new Error(this.closeReason ?? 'Connection closed');
    const id = this.next;
    this.next += 2;
    const st = new Stream(this, id, meta);
    this.streams.set(id, st);
    this.raw(frame(T.Open, id, jsonBytes(meta)));
    return st;
  }

  /** Round-trip time in ms; rejects when the other side has gone. */
  ping(timeoutMs = 5000): Promise<number> {
    const id = Math.floor(Math.random() * 0xffffffff);
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pings.delete(id);
        reject(new Error('No answer'));
      }, timeoutMs);
      this.pings.set(id, () => {
        clearTimeout(t);
        resolve(Date.now() - t0);
      });
      this.raw(frame(T.Ping, id));
    });
  }

  /** @internal */ raw(m: Uint8Array) {
    if (this.closed) return;
    try {
      this.carrier.send(m);
    } catch (e) {
      this.shut(e instanceof Error ? e.message : String(e));
    }
  }

  /** @internal */ _forget(id: number) {
    this.streams.delete(id);
  }

  get openStreams() {
    return this.streams.size;
  }

  private async receive(m: Uint8Array) {
    if (m.length < 5) return;
    this.lastSeen = Date.now();
    const type = m[0] as T;
    const id = new DataView(m.buffer, m.byteOffset, m.length).getUint32(1);
    const payload = m.subarray(5);
    const st = this.streams.get(id);
    switch (type) {
      case T.Open: {
        if (st || (id % 2) === (this.next % 2)) return this.raw(frame(T.Reset, id, new TextEncoder().encode('bad stream')));
        const meta = fromJson(payload) ?? {};
        const ns = new Stream(this, id, meta);
        this.streams.set(id, ns);
        if (this.onstream) this.onstream(ns);
        else ns.reset('nobody is listening');
        return;
      }
      case T.Data:
        return st?._data(payload);
      case T.End:
        return st?._end(payload.length ? fromJson(payload) : undefined);
      case T.Reset:
        return st?.fail(new TextDecoder().decode(payload) || 'reset');
      case T.Credit:
        return st?._credit(new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0));
      case T.Ping:
        return this.raw(frame(T.Pong, id));
      case T.Pong:
        this.pings.get(id)?.();
        this.pings.delete(id);
        return;
    }
  }

  close(reason?: string) {
    this.carrier.close(reason);
    this.shut(reason);
  }

  private shut(reason?: string) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const s of [...this.streams.values()]) s.fail(reason ?? 'Connection closed');
    this.onclose?.(reason);
  }
}

// ---------------------------------------------------------------- requests

export type Handler = (params: Record<string, unknown>, stream: Stream) => Promise<unknown> | unknown;

/** Asks the other side to run `method`; resolves with its answer. */
export async function call<T = unknown>(mux: Mux, method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
  const st = mux.open({ k: 'rpc', m: method, p: params });
  st.end();
  const reply = await Promise.race([
    st.readAll(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${method}: no answer`)), timeoutMs)),
  ]);
  const r = fromJson(reply.data) as { ok?: boolean; r?: T; e?: string } | null;
  if (!r?.ok) throw new Error(r?.e ?? 'The other device refused');
  return r.r as T;
}

/** Answers one incoming request stream with the handler for its method. */
export async function serve(st: Stream, handlers: Record<string, Handler>) {
  const method = String(st.meta.m ?? '');
  const h = handlers[method];
  st.ondata = () => undefined;
  st.onend = () => undefined;
  void st.start();
  try {
    if (!h) throw new Error(`Unknown request ${method}`);
    const r = await h((st.meta.p as Record<string, unknown>) ?? {}, st);
    await st.writeJson({ ok: true, r: r ?? null });
  } catch (e) {
    await st.writeJson({ ok: false, e: e instanceof Error ? e.message : String(e) }).catch(() => undefined);
  }
  st.end();
}
