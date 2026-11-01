// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What sync and backup need from the outside world, and nothing more: a way to
// talk to another Keeper device, and a place to keep files. Keeper Link and the
// cloud connections plug in here; tests use the in-memory versions below.

import { EventEmitter } from 'node:events';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- devices

export interface PeerInfo {
  id: string;
  name: string;
  online: boolean;
  /** how it is reached: 'lan', 'direct', 'relay', 'tunnel', 'loopback' */
  via?: string;
}

/** A two-way, ordered, reliable message pipe to one device. */
export interface PeerChannel {
  send(frame: Uint8Array): void;
  onFrame(fn: (frame: Uint8Array) => void): () => void;
  onClose(fn: () => void): () => void;
  close(): void;
}

export interface PeerTransport {
  /** this device */
  readonly selfId: string;
  listPeers(): PeerInfo[];
  /** opens a channel to a device for one purpose ('sync', 'phone-upload' …) */
  open(peerId: string, purpose: string): Promise<PeerChannel>;
  /** channels other devices open to us */
  onIncoming(purpose: string, fn: (peerId: string, ch: PeerChannel) => void): () => void;
  /** a device came online or went away */
  onPeersChanged?(fn: () => void): () => void;
}

// ---------------------------------------------------------------- storage

export interface StoreEntry {
  /** forward slashes, relative to the store's root, no leading slash */
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

/** A place to keep files: a folder, a drive, a server or a cloud service. */
export interface RemoteStore {
  readonly label: string;
  list(dir: string): Promise<StoreEntry[]>;
  stat(p: string): Promise<StoreEntry | null>;
  /** bytes [start, end) when a range is given */
  get(p: string, range?: { start: number; end: number }): Promise<Buffer>;
  put(p: string, data: Buffer): Promise<void>;
  delete(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(p: string): Promise<void>;
  quota?(): Promise<{ used?: number; total?: number } | undefined>;
  /** streaming versions for big files, where the store can do it */
  putFile?(p: string, localFile: string): Promise<void>;
  getFile?(p: string, localFile: string): Promise<void>;
}

const clean = (p: string) => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

/** A store kept in memory; for tests and for the browser demo. */
export class MemoryStore implements RemoteStore {
  readonly label = 'memory';
  files = new Map<string, { data: Buffer; mtime: number }>();
  /** bytes written, to check that a repeat backup uploads almost nothing */
  written = 0;
  async list(dir: string) {
    const d = clean(dir);
    const out = new Map<string, StoreEntry>();
    for (const [p, f] of this.files) {
      if (d && !p.startsWith(d + '/')) continue;
      const rest = d ? p.slice(d.length + 1) : p;
      const i = rest.indexOf('/');
      if (i < 0) out.set(p, { path: p, isDir: false, size: f.data.length, mtime: f.mtime });
      else {
        const sub = (d ? d + '/' : '') + rest.slice(0, i);
        out.set(sub, { path: sub, isDir: true, size: 0, mtime: 0 });
      }
    }
    return [...out.values()];
  }
  async stat(p: string) {
    const f = this.files.get(clean(p));
    if (f) return { path: clean(p), isDir: false, size: f.data.length, mtime: f.mtime };
    const d = clean(p) + '/';
    for (const k of this.files.keys()) if (k.startsWith(d)) return { path: clean(p), isDir: true, size: 0, mtime: 0 };
    return null;
  }
  async get(p: string, range?: { start: number; end: number }) {
    const f = this.files.get(clean(p));
    if (!f) throw Object.assign(new Error(`not found: ${p}`), { code: 'ENOENT' });
    return range ? Buffer.from(f.data.subarray(range.start, range.end)) : Buffer.from(f.data);
  }
  async put(p: string, data: Buffer) {
    this.written += data.length;
    this.files.set(clean(p), { data: Buffer.from(data), mtime: Date.now() });
  }
  async delete(p: string) {
    const c = clean(p);
    this.files.delete(c);
    for (const k of [...this.files.keys()]) if (k.startsWith(c + '/')) this.files.delete(k);
  }
  async rename(from: string, to: string) {
    const f = this.files.get(clean(from));
    if (!f) throw Object.assign(new Error(`not found: ${from}`), { code: 'ENOENT' });
    this.files.delete(clean(from));
    this.files.set(clean(to), f);
  }
  async mkdir() {
    /* folders exist when something is in them */
  }
}

/** A store in a folder: a second drive, a NAS share mounted by the system, iCloud Drive on a Mac. */
export class FolderStore implements RemoteStore {
  written = 0;
  constructor(readonly root: string, readonly label = root) {}
  private abs(p: string) {
    const rel = clean(p);
    const full = path.resolve(this.root, rel);
    if (full !== path.resolve(this.root) && !full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('path escapes the store');
    return full;
  }
  async list(dir: string) {
    const d = clean(dir);
    const ents = await fsp.readdir(this.abs(d), { withFileTypes: true }).catch(() => []);
    const out: StoreEntry[] = [];
    for (const e of ents) {
      const p = d ? `${d}/${e.name}` : e.name;
      const st = await fsp.stat(this.abs(p)).catch(() => null);
      if (st) out.push({ path: p, isDir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs });
    }
    return out;
  }
  async stat(p: string) {
    const st = await fsp.stat(this.abs(p)).catch(() => null);
    return st ? { path: clean(p), isDir: st.isDirectory(), size: st.size, mtime: st.mtimeMs } : null;
  }
  async get(p: string, range?: { start: number; end: number }) {
    if (!range) return fsp.readFile(this.abs(p));
    const fh = await fsp.open(this.abs(p), 'r');
    try {
      const buf = Buffer.alloc(range.end - range.start);
      const { bytesRead } = await fh.read(buf, 0, buf.length, range.start);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }
  async put(p: string, data: Buffer) {
    const full = this.abs(p);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Date.now()}.part`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, full);
    this.written += data.length;
  }
  async delete(p: string) {
    await fsp.rm(this.abs(p), { recursive: true, force: true });
  }
  async rename(from: string, to: string) {
    await fsp.mkdir(path.dirname(this.abs(to)), { recursive: true });
    await fsp.rename(this.abs(from), this.abs(to));
  }
  async mkdir(p: string) {
    await fsp.mkdir(this.abs(p), { recursive: true });
  }
  async putFile(p: string, localFile: string) {
    const full = this.abs(p);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${process.pid}.${Date.now()}.part`;
    await fsp.copyFile(localFile, tmp);
    await fsp.rename(tmp, full);
    this.written += (await fsp.stat(full)).size;
  }
  async getFile(p: string, localFile: string) {
    await fsp.copyFile(this.abs(p), localFile);
  }
}

// ---------------------------------------------------------------- an in-memory network, for tests

/** Several devices in one process, joined by in-memory channels that can be cut. */
export class MemoryNetwork {
  private nodes = new Map<string, MemoryTransport>();
  private down = new Set<string>();
  join(id: string, name = id): MemoryTransport {
    const t = new MemoryTransport(this, id, name);
    this.nodes.set(id, t);
    return t;
  }
  /** take a device off the network (its open channels close) */
  setOnline(id: string, online: boolean) {
    if (online) this.down.delete(id);
    else this.down.add(id);
    for (const n of this.nodes.values()) n.changed();
    if (!online) this.nodes.get(id)?.closeAll();
  }
  isOnline(id: string) {
    return this.nodes.has(id) && !this.down.has(id);
  }
  peersOf(id: string) {
    return [...this.nodes.values()].filter((n) => n.selfId !== id).map((n) => ({ id: n.selfId, name: n.name, online: this.isOnline(n.selfId) && this.isOnline(id), via: 'memory' }));
  }
  connect(from: string, to: string, purpose: string): PeerChannel {
    const a = this.nodes.get(from)!;
    const b = this.nodes.get(to);
    if (!b || !this.isOnline(to) || !this.isOnline(from)) throw new Error(`${to} is not reachable`);
    const [x, y] = pipePair();
    a.track(x);
    b.track(y);
    b.accept(purpose, from, y);
    return x;
  }
}

class MemoryTransport implements PeerTransport {
  private handlers = new Map<string, (peerId: string, ch: PeerChannel) => void>();
  private open_ = new Set<PeerChannel>();
  private ev = new EventEmitter();
  constructor(private net: MemoryNetwork, readonly selfId: string, readonly name: string) {}
  listPeers() {
    return this.net.peersOf(this.selfId);
  }
  async open(peerId: string, purpose: string) {
    return this.net.connect(this.selfId, peerId, purpose);
  }
  onIncoming(purpose: string, fn: (peerId: string, ch: PeerChannel) => void) {
    this.handlers.set(purpose, fn);
    return () => void this.handlers.delete(purpose);
  }
  onPeersChanged(fn: () => void) {
    this.ev.on('changed', fn);
    return () => void this.ev.off('changed', fn);
  }
  accept(purpose: string, from: string, ch: PeerChannel) {
    const h = this.handlers.get(purpose);
    if (h) h(from, ch);
    else ch.close();
  }
  track(ch: PeerChannel) {
    this.open_.add(ch);
    ch.onClose(() => this.open_.delete(ch));
  }
  closeAll() {
    for (const c of [...this.open_]) c.close();
  }
  changed() {
    this.ev.emit('changed');
  }
}

/** Two connected channel ends. Frames are delivered asynchronously, in order. */
export function pipePair(): [PeerChannel, PeerChannel] {
  const mk = () => ({ frames: new Set<(f: Uint8Array) => void>(), closes: new Set<() => void>(), closed: false });
  const sa = mk();
  const sb = mk();
  const end = (self: ReturnType<typeof mk>, other: ReturnType<typeof mk>): PeerChannel => ({
    send(frame) {
      if (self.closed) throw new Error('channel closed');
      const copy = Uint8Array.from(frame);
      queueMicrotask(() => { if (!other.closed) for (const f of other.frames) f(copy); });
    },
    onFrame(fn) {
      self.frames.add(fn);
      return () => void self.frames.delete(fn);
    },
    onClose(fn) {
      self.closes.add(fn);
      return () => void self.closes.delete(fn);
    },
    close() {
      for (const s of [self, other]) {
        if (s.closed) continue;
        s.closed = true;
        queueMicrotask(() => { for (const f of s.closes) f(); });
      }
    },
  });
  return [end(sa, sb), end(sb, sa)];
}
