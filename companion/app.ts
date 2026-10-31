// SPDX-License-Identifier: AGPL-3.0-or-later
// The phone companion: a small page Keeper serves to phones and tablets so they
// can send files to the computer, open its shared folders and use its
// clipboard without installing anything. Talks to the computer over an
// end-to-end encrypted channel (see core/link/companion-proto.ts).

import { COMPANION_CHUNK, companionKeys, fromB64u, inviteId, Opener, Sealer, toB64u, type CHeader } from '../core/link/companion-proto';

interface Creds {
  cid: string;
  key: string;
  device: string;
  name: string;
}

type Reply = { header: CHeader; body: Uint8Array };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STORE = 'keeper-companion';

function loadCreds(): Record<string, Creds> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

function saveCreds(c: Creds) {
  const all = loadCreds();
  all[c.device] = c;
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* private mode: works until the page closes */
  }
}

function forgetCreds(device: string) {
  const all = loadCreds();
  delete all[device];
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function phoneName(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  return 'Browser';
}

function status(text: string, on = false) {
  $('status').innerHTML = `<span class="dot ${on ? 'on' : ''}"></span>`;
  $('status').append(text);
}

function message(text: string, error = false) {
  const m = $('msg');
  m.classList.toggle('hidden', !text);
  m.classList.toggle('err', error);
  m.textContent = text;
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

class Channel {
  private ws!: WebSocket;
  private sealer!: Sealer;
  private opener!: Opener;
  private seq = 0;
  private waiting = new Map<number, (r: Reply) => void>();
  onclose?: () => void;

  async open(hello: { inv?: string; cid?: string }, secret: Uint8Array): Promise<{ id: string; name: string }> {
    const nP = crypto.getRandomValues(new Uint8Array(16));
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}${location.pathname.replace(/\/[^/]*$/, '')}/ws`);
    this.ws.binaryType = 'arraybuffer';
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'hello', v: 1, n: toB64u(nP), ...hello }));
      this.ws.onerror = () => reject(new Error('Could not reach the computer. Is Keeper open, and are you on the same network?'));
      this.ws.onclose = () => {
        reject(new Error('The computer closed the connection'));
        for (const w of this.waiting.values()) w({ header: { ok: false, e: 'Connection closed' }, body: new Uint8Array(0) });
        this.waiting.clear();
        this.onclose?.();
      };
      this.ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          const m = JSON.parse(e.data) as { t: string; n?: string; id?: string; name?: string; e?: string };
          if (m.t === 'err') return reject(new Error(m.e ?? 'Refused'));
          if (m.t === 'hi' && m.n) {
            const k = companionKeys(secret, nP, fromB64u(m.n));
            this.sealer = new Sealer(k.phoneToApp);
            this.opener = new Opener(k.appToPhone);
            resolve({ id: m.id ?? '', name: m.name ?? 'Computer' });
          }
          return;
        }
        const msg = this.opener?.open(new Uint8Array(e.data as ArrayBuffer));
        if (!msg) {
          this.ws.close();
          return;
        }
        const id = msg.header.id;
        if (typeof id === 'number') {
          this.waiting.get(id)?.(msg);
          this.waiting.delete(id);
        }
      };
    });
  }

  req(op: string, args: Record<string, unknown> = {}, body?: Uint8Array): Promise<Reply> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (r) => (r.header.ok ? resolve(r) : reject(new Error(String(r.header.e ?? 'Refused')))));
      this.ws.send(this.sealer.seal({ id, op, ...args }, body));
    });
  }
}

let ch: Channel | null = null;

async function connect() {
  const frag = new URLSearchParams(location.hash.slice(1));
  const k = frag.get('k');
  const d = frag.get('d') ?? '';
  // The secret must not stay in the address bar or history.
  if (k) history.replaceState(null, '', location.pathname);
  const all = loadCreds();
  const saved = d ? all[d] : Object.values(all)[0];
  ch = new Channel();
  ch.onclose = () => {
    status('Disconnected — reload to reconnect');
    ch = null;
  };
  try {
    if (k) {
      const secret = fromB64u(k);
      const hi = await ch.open({ inv: inviteId(secret) }, secret);
      status('Waiting for the computer to allow this phone…');
      message(`Check ${hi.name}: it asks whether to allow this ${phoneName()}.`);
      const r = await ch.req('register', { name: phoneName() });
      const c = r.header.r as Creds;
      saveCreds({ ...c, device: hi.id || c.device });
      ready(hi.name);
    } else if (saved) {
      const hi = await ch.open({ cid: saved.cid }, fromB64u(saved.key));
      ready(hi.name);
    } else {
      status('Not paired');
      message('Open Keeper on your computer → Devices → Phone, and scan the QR code with this phone’s camera.');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no longer paired/.test(msg) && saved) forgetCreds(saved.device);
    status('Not connected');
    message(msg, true);
  }
}

function ready(name: string) {
  message('');
  $('title').textContent = name;
  status('Connected · encrypted', true);
  $('app').classList.remove('hidden');
  void loadShares();
}

// ---------------------------------------------------------------- tabs

for (const b of document.querySelectorAll<HTMLButtonElement>('nav button')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('nav button')) x.classList.toggle('on', x === b);
    for (const t of ['send', 'files', 'clip', 'screen']) $(`tab-${t}`).classList.toggle('hidden', t !== b.dataset.tab);
  };
}

// ---------------------------------------------------------------- send

$<HTMLInputElement>('pick').onchange = async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  (e.target as HTMLInputElement).value = '';
  for (const f of files) await upload(f);
};

async function upload(f: File) {
  if (!ch) return;
  const row = document.createElement('div');
  row.className = 'card';
  row.innerHTML = '<div class="grow"></div><div class="bar"><i style="width:0%"></i></div><div class="muted"></div>';
  (row.firstChild as HTMLElement).textContent = f.name;
  $('uploads').prepend(row);
  const bar = row.querySelector('i') as HTMLElement;
  const note = row.querySelector('.muted') as HTMLElement;
  const xid = toB64u(crypto.getRandomValues(new Uint8Array(12)));
  try {
    let off = 0;
    if (f.size === 0) await ch.req('put', { xid, name: f.name, total: 0, offset: 0 });
    while (off < f.size) {
      const chunk = new Uint8Array(await f.slice(off, off + COMPANION_CHUNK).arrayBuffer());
      const r = await ch.req('put', { xid, name: f.name, total: f.size, offset: off }, chunk);
      off += chunk.length;
      bar.style.width = `${Math.round((off / f.size) * 100)}%`;
      note.textContent = `${size(off)} of ${size(f.size)}`;
      const res = r.header.r as { done?: boolean; savedAs?: string };
      if (res?.done) note.textContent = `Sent · saved as ${res.savedAs}`;
    }
    if (f.size === 0) note.textContent = 'Sent';
  } catch (err) {
    note.textContent = err instanceof Error ? err.message : String(err);
    note.classList.add('err');
  }
}

// ---------------------------------------------------------------- files

let shareId = '';
let dir = '';

async function loadShares() {
  if (!ch) return;
  const box = $('files');
  try {
    const shares = (await ch.req('shares')).header.r as { id: string; name: string }[];
    if (!shares.length) {
      box.innerHTML = '<div class="muted">The computer does not share any folders. Choose Devices → Share a Folder on it.</div>';
      return;
    }
    shareId = shareId || shares[0].id;
    await list(shares);
  } catch (e) {
    box.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function list(shares: { id: string; name: string }[]) {
  if (!ch) return;
  const box = $('files');
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'row';
  for (const s of shares) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = s.name;
    if (s.id === shareId) b.style.fontWeight = '700';
    b.onclick = () => { shareId = s.id; dir = ''; void list(shares); };
    head.append(b);
  }
  box.append(head);
  if (dir) {
    const up = document.createElement('div');
    up.className = 'row';
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = '‹ Back';
    b.onclick = () => { dir = dir.split('/').slice(0, -1).join('/'); void list(shares); };
    up.append(b, Object.assign(document.createElement('span'), { className: 'muted grow', textContent: dir }));
    box.append(up);
  }
  const entries = (await ch.req('list', { share: shareId, dir })).header.r as { name: string; isDir: boolean; size: number }[];
  for (const e of entries) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = Object.assign(document.createElement('span'), { className: 'grow', textContent: (e.isDir ? '📁 ' : '') + e.name });
    row.append(name);
    if (e.isDir) row.onclick = () => { dir = dir ? `${dir}/${e.name}` : e.name; void list(shares); };
    else {
      const meta = Object.assign(document.createElement('span'), { className: 'muted', textContent: size(e.size) });
      const get = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Get' });
      get.onclick = () => void download(e.name, get);
      row.append(meta, get);
    }
    box.append(row);
  }
  if (!entries.length) box.append(Object.assign(document.createElement('div'), { className: 'muted', textContent: 'Empty folder' }));
}

async function download(name: string, btn: HTMLButtonElement) {
  if (!ch) return;
  const path = dir ? `${dir}/${name}` : name;
  const parts: Uint8Array[] = [];
  let off = 0;
  let total = 1;
  try {
    while (off < total) {
      const r = await ch.req('read', { share: shareId, path, offset: off, len: COMPANION_CHUNK });
      total = (r.header.r as { size: number }).size;
      parts.push(r.body);
      off += r.body.length;
      btn.textContent = total ? `${Math.round((off / total) * 100)}%` : '…';
      if (!r.body.length) break;
    }
    const url = URL.createObjectURL(new Blob(parts as BlobPart[]));
    const a = Object.assign(document.createElement('a'), { href: url, download: name, className: 'dl', textContent: 'Save' });
    btn.replaceWith(a);
    a.click();
  } catch (e) {
    btn.textContent = 'Failed';
    btn.title = e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------- clipboard

$('clip-get').onclick = async () => {
  if (!ch) return;
  const r = await ch.req('clip.get');
  $<HTMLTextAreaElement>('clip').value = (r.header.r as { text: string }).text;
  $('clip-note').textContent = 'From the computer’s clipboard';
};
$('clip-set').onclick = async () => {
  if (!ch) return;
  await ch.req('clip.set', { text: $<HTMLTextAreaElement>('clip').value });
  $('clip-note').textContent = 'Now on the computer’s clipboard';
};
$('clip-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($<HTMLTextAreaElement>('clip').value);
    $('clip-note').textContent = 'Copied on this phone';
  } catch {
    $<HTMLTextAreaElement>('clip').select();
    $('clip-note').textContent = 'Selected: use Copy';
  }
};

// ---------------------------------------------------------------- screen (view, touch, touchpad, keys)

type Ev = Record<string, unknown>;
let scr: { sid: string; control: boolean; seq: number; on: boolean; mode: 'touch' | 'pad'; queue: Ev[]; pos: { x: number; y: number } } | null = null;

async function screenStart(control: boolean) {
  if (!ch) return;
  $('scr-note').textContent = '';
  message('The computer asks whether to allow this. Check its screen.');
  try {
    const r = await ch.req('screen.start', { control });
    const info = r.header.r as { sid: string; control: boolean; note?: string };
    message(info.note && control ? `Viewing only: ${info.note}` : '');
    scr = { sid: info.sid, control: info.control, seq: 0, on: true, mode: 'touch', queue: [], pos: { x: 0.5, y: 0.5 } };
    $('screen-start').classList.add('hidden');
    $('screen-live').classList.remove('hidden');
    $('scr-controls').classList.toggle('hidden', !info.control);
    $('scr-typing').classList.toggle('hidden', !info.control);
    setMode('touch');
    void pullFrames();
  } catch (e) {
    message(e instanceof Error ? e.message : String(e), true);
  }
}

async function pullFrames() {
  let shown = 0;
  let t0 = Date.now();
  while (scr?.on && ch) {
    try {
      const r = await ch.req('screen.frame', { sid: scr.sid, after: scr.seq });
      const h = r.header.r as { seq?: number; ended?: boolean; reason?: string; none?: boolean };
      if (h.ended) {
        screenEnded(h.reason ?? 'Ended');
        return;
      }
      if (h.seq && r.body.length) {
        scr.seq = h.seq;
        const img = $<HTMLImageElement>('scr');
        const old = img.src;
        img.src = URL.createObjectURL(new Blob([r.body as BlobPart], { type: 'image/jpeg' }));
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
        shown++;
        if (Date.now() - t0 > 2000) {
          $('scr-note').textContent = `${Math.round((shown * 1000) / (Date.now() - t0))} fps`;
          shown = 0;
          t0 = Date.now();
        }
      } else await new Promise((res) => setTimeout(res, 80));
    } catch (e) {
      screenEnded(e instanceof Error ? e.message : String(e));
      return;
    }
  }
}

function screenEnded(reason: string) {
  if (scr) scr.on = false;
  scr = null;
  $('screen-live').classList.add('hidden');
  $('screen-start').classList.remove('hidden');
  message(`Screen sharing ended: ${reason}`);
}

function setMode(m: 'touch' | 'pad') {
  if (!scr) return;
  scr.mode = m;
  $('mode-touch').classList.toggle('on', m === 'touch');
  $('mode-pad').classList.toggle('on', m === 'pad');
}

function queue(e: Ev) {
  if (!scr?.control) return;
  scr.queue.push(e);
}

setInterval(() => {
  if (!scr?.queue.length || !ch) return;
  const events = scr.queue.splice(0);
  void ch.req('screen.input', { sid: scr.sid, events }).catch(() => undefined);
}, 50);

// Touch: tap where you touch, drag to drag. Touchpad: move the pointer by sliding, tap to click, two fingers to scroll.
{
  const img = $<HTMLImageElement>('scr');
  let start: { x: number; y: number; t: number; px: number; py: number } | null = null;
  let moved = false;
  let twoY: number | null = null;
  const rel = (cx: number, cy: number) => {
    const r = img.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (cx - r.left) / r.width)), y: Math.min(1, Math.max(0, (cy - r.top) / r.height)) };
  };
  img.addEventListener('touchstart', (e) => {
    if (!scr) return;
    e.preventDefault();
    if (e.touches.length === 2) {
      twoY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      return;
    }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, t: Date.now(), px: scr.pos.x, py: scr.pos.y };
    moved = false;
    if (scr.mode === 'touch') {
      const p = rel(t.clientX, t.clientY);
      scr.pos = p;
      queue({ t: 'move', ...p });
    }
  }, { passive: false });
  img.addEventListener('touchmove', (e) => {
    if (!scr || !start) return;
    e.preventDefault();
    if (e.touches.length === 2 && twoY !== null) {
      const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dy = (twoY - y) / 20;
      if (Math.abs(dy) >= 1) {
        queue({ t: 'wheel', ...scr.pos, dx: 0, dy: Math.round(dy) });
        twoY = y;
      }
      return;
    }
    const t = e.touches[0];
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 6 && !moved) {
      moved = true;
      if (scr.mode === 'touch') queue({ t: 'down', ...scr.pos, button: 0 });
    }
    if (scr.mode === 'touch') scr.pos = rel(t.clientX, t.clientY);
    else {
      const r = img.getBoundingClientRect();
      scr.pos = { x: Math.min(1, Math.max(0, start.px + ((t.clientX - start.x) / r.width) * 1.5)), y: Math.min(1, Math.max(0, start.py + ((t.clientY - start.y) / r.height) * 1.5)) };
    }
    queue({ t: 'move', ...scr.pos });
  }, { passive: false });
  img.addEventListener('touchend', (e) => {
    if (!scr || !start) return;
    e.preventDefault();
    twoY = null;
    if (moved) {
      if (scr.mode === 'touch') queue({ t: 'up', ...scr.pos, button: 0 });
    } else {
      // A tap is a click; a long press is a right click.
      const button = Date.now() - start.t > 550 ? 2 : 0;
      queue({ t: 'down', ...scr.pos, button });
      queue({ t: 'up', ...scr.pos, button });
    }
    start = null;
  }, { passive: false });
  // Mouse, for tablets with a pointer or a desktop browser.
  img.addEventListener('click', (e) => {
    if (!scr || 'ontouchstart' in window) return;
    const p = rel(e.clientX, e.clientY);
    queue({ t: 'down', ...p, button: 0 });
    queue({ t: 'up', ...p, button: 0 });
  });
}

$('screen-view').onclick = () => void screenStart(false);
$('screen-control').onclick = () => void screenStart(true);
$('screen-stop').onclick = () => {
  if (scr && ch) void ch.req('screen.stop', { sid: scr.sid }).catch(() => undefined);
  screenEnded('You stopped watching');
};
$('mode-touch').onclick = () => setMode('touch');
$('mode-pad').onclick = () => setMode('pad');
for (const b of document.querySelectorAll<HTMLButtonElement>('#scr-controls [data-key]')) {
  b.onclick = () => {
    queue({ t: 'key', code: b.dataset.key, down: true });
    queue({ t: 'key', code: b.dataset.key, down: false });
  };
}
const sendText = () => {
  const i = $<HTMLInputElement>('scr-text');
  if (i.value) queue({ t: 'text', text: i.value });
  i.value = '';
};
$('scr-send').onclick = sendText;
$('scr-text').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') {
    sendText();
    queue({ t: 'key', code: 'Enter', down: true });
    queue({ t: 'key', code: 'Enter', down: false });
  }
});

void connect();
