// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The phone companion: a small page Keeper serves to phones and tablets so they
// can send files to the computer, open its shared folders and use its
// clipboard without installing anything. Talks to the computer over an
// end-to-end encrypted channel (see core/link/companion-proto.ts).

import { helpSecretWeb, helpTagWeb, normalizeCode, normalizePassword } from '../core/link/help-web';
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

  async open(hello: { inv?: string; cid?: string; help?: string; name?: string }, secret: Uint8Array): Promise<{ id: string; name: string }> {
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
  // Opened from a helper's link (…/c/#help): join a help session, no pairing.
  if (location.hash === '#help' || (!k && !saved && location.hash.startsWith('#help'))) {
    history.replaceState(null, '', location.pathname);
    status('Help someone');
    $('help-join').classList.remove('hidden');
    return;
  }
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
      message('Open Keeper on your computer → Devices → Phone, and scan the QR code with this phone’s camera. To help someone instead, tap Help someone below.');
      $('help-join').classList.remove('hidden');
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
  void loadToday();
}

// ---------------------------------------------------------------- tabs

const TABS = ['today', 'send', 'files', 'clip', 'screen', 'ai', 'term'];
for (const b of document.querySelectorAll<HTMLButtonElement>('nav button[data-tab]')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('nav button[data-tab]')) x.classList.toggle('on', x === b);
    for (const t of TABS) $(`tab-${t}`).classList.toggle('hidden', t !== b.dataset.tab);
    $('nav-more-btn').classList.toggle('on', b.parentElement?.id === 'nav-more');
    if (b.dataset.tab === 'today') void loadToday();
  };
}
// AI and Terminal sit under More, so the row stays short.
$('nav-more-btn').onclick = () => {
  const open = $('nav-more').classList.toggle('hidden') === false;
  $('nav-more-btn').setAttribute('aria-expanded', String(open));
};

// ---------------------------------------------------------------- today (read when opened: no push, no server)

interface TodayView { day: string; events: { id: string; title: string; when: string; now?: boolean; location?: string }[]; tasks: { id: string; title: string; note?: string; overdue?: boolean }[]; moreTasks: number; inbox: number; parts: { tasks: boolean; inbox: boolean } }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function loadToday() {
  if (!ch) return;
  try {
    const t = (await ch.req('today.get')).header.r as TodayView;
    $('today-day').textContent = t.day;
    $('today-events').innerHTML = t.events.length ? t.events.map((e) => `<div class="ev${e.now ? ' now' : ''}"><b>${esc(e.now ? 'Now' : e.when)}</b><span class="grow">${esc(e.title)}${e.location ? ` <span class="muted">· ${esc(e.location)}</span>` : ''}</span></div>`).join('') : '<span class="muted">Nothing on the calendar today.</span>';
    $('today-tasks-card').classList.toggle('hidden', !t.parts.tasks);
    $('catch').classList.toggle('hidden', !t.parts.inbox);
    $('today-tasks').innerHTML = t.tasks.length
      ? t.tasks.map((x) => `<label class="task" data-id="${esc(x.id)}"><input type="checkbox" aria-label="Done: ${esc(x.title)}"><span class="grow">${esc(x.title)}</span>${x.note ? `<span class="muted${x.overdue ? ' over' : ''}">${esc(x.note)}</span>` : ''}</label>`).join('') + (t.moreTasks ? `<div class="muted">and ${t.moreTasks} more on the computer</div>` : '')
      : '<span class="muted">Nothing due today.</span>';
    for (const row of $('today-tasks').querySelectorAll<HTMLLabelElement>('.task')) {
      const box = row.querySelector('input')!;
      box.onchange = async () => {
        row.classList.toggle('done', box.checked);
        try { await ch?.req('tasks.done', { id: row.dataset.id, done: box.checked }); } catch (err) { box.checked = !box.checked; row.classList.toggle('done', box.checked); message(err instanceof Error ? err.message : String(err), true); }
      };
    }
    $('catch-note').textContent = t.inbox ? `${t.inbox} waiting in the Inbox on the computer.` : 'It waits in the Inbox on the computer.';
  } catch (err) {
    $('today-events').textContent = err instanceof Error ? err.message : String(err);
  }
}

async function keep(args: Record<string, unknown>, said: string) {
  try {
    await ch?.req('inbox.add', args);
    $('catch-note').textContent = said;
    void loadToday();
  } catch (err) {
    $('catch-note').textContent = err instanceof Error ? err.message : String(err);
  }
}

$<HTMLFormElement>('catch').onsubmit = (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('catch-text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  void keep({ text }, 'Kept. It waits in the Inbox.');
};
$<HTMLInputElement>('catch-photo').onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!f) return;
  $('catch-note').textContent = 'Sending the photo…';
  const saved = await upload(f);
  if (saved) void keep({ name: saved, kind: 'shot' }, 'Photo kept in the Inbox.');
};
let rec: MediaRecorder | null = null;
$('catch-voice').onclick = async () => {
  if (rec) { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const parts: Blob[] = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = (ev) => parts.push(ev.data);
    rec.onstop = async () => {
      for (const t of stream.getTracks()) t.stop();
      rec = null;
      $('catch-voice').textContent = 'Voice note';
      const type = parts[0]?.type || 'audio/webm';
      const f = new File(parts, `Voice note ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type });
      const saved = await upload(f);
      if (saved) void keep({ name: saved, kind: 'voice' }, 'Voice note kept in the Inbox.');
    };
    rec.start();
    $('catch-voice').textContent = 'Stop';
    $('catch-note').textContent = 'Recording… tap Stop when done.';
  } catch {
    $('catch-note').textContent = 'This browser cannot record here. Over the local network, phones only record on secure pages.';
  }
};

$<HTMLFormElement>('find').onsubmit = async (e) => {
  e.preventDefault();
  const q = $<HTMLInputElement>('find-q').value.trim();
  const out = $('find-out');
  if (!q || !ch) return;
  out.innerHTML = '<div class="muted">Looking…</div>';
  try {
    const hits = (await ch.req('find', { q })).header.r as { id: string; name: string; where: string; size: number; kind: string }[];
    out.innerHTML = hits.length ? hits.map((h) => `<div class="row"><span class="grow"><b>${esc(h.name)}</b><br><span class="muted">${esc(h.where)} · ${size(h.size)}</span></span><button class="btn" data-id="${esc(h.id)}">Show on computer</button></div>`).join('') : '<div class="muted">Nothing found. Try other words.</div>';
    for (const b of out.querySelectorAll<HTMLButtonElement>('button[data-id]')) b.onclick = () => void ch?.req('find.show', { id: b.dataset.id }).then(() => { b.textContent = 'Shown'; }, (err: unknown) => message(err instanceof Error ? err.message : String(err), true));
  } catch (err) {
    out.innerHTML = '';
    message(err instanceof Error ? err.message : String(err), true);
  }
};

// Installable: on a secure page (through the tunnel), the page shell also opens without a connection.
if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('sw.js').catch(() => undefined);

// ---------------------------------------------------------------- send

$<HTMLInputElement>('pick').onchange = async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  (e.target as HTMLInputElement).value = '';
  for (const f of files) await upload(f);
};

async function upload(f: File): Promise<string | undefined> {
  if (!ch) return undefined;
  let saved: string | undefined;
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
      if (res?.done) { note.textContent = `Sent · saved as ${res.savedAs}`; saved = res.savedAs; }
    }
    if (f.size === 0) note.textContent = 'Sent';
  } catch (err) {
    note.textContent = err instanceof Error ? err.message : String(err);
    note.classList.add('err');
  }
  return saved;
}

// ---------------------------------------------------------------- scan a document

const scanPages: string[] = [];

function showScanPages() {
  $('scan-pages').textContent = scanPages.length ? `${scanPages.length} page${scanPages.length === 1 ? '' : 's'} ready` : 'No pages yet';
  $<HTMLButtonElement>('scan-make').disabled = !scanPages.length;
}

$<HTMLInputElement>('scan-shot').onchange = async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  (e.target as HTMLInputElement).value = '';
  for (const f of files) {
    const ext = (f.name.match(/\.(jpe?g|png|heic|heif|webp)$/i)?.[1] ?? 'jpg').toLowerCase();
    const saved = await upload(new File([f], `scan-${Date.now()}-${scanPages.length + 1}.${ext}`, { type: f.type }));
    if (saved) scanPages.push(saved);
    showScanPages();
  }
};

$<HTMLButtonElement>('scan-make').onclick = async () => {
  if (!ch || !scanPages.length) return;
  const btn = $<HTMLButtonElement>('scan-make');
  btn.disabled = true;
  btn.textContent = 'Making the PDF…';
  try {
    const r = await ch.req('scan.make', { files: scanPages, mode: $<HTMLSelectElement>('scan-mode').value });
    const res = r.header.r as { savedAs?: string; message?: string };
    message(`Saved ${res.savedAs ?? 'the scan'} on the computer${res.message ? ` · ${res.message}` : ''}`);
    scanPages.length = 0;
  } catch (err) {
    message(err instanceof Error ? err.message : String(err), true);
  } finally {
    btn.textContent = 'Make PDF';
    showScanPages();
  }
};

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
      const h = r.header.r as { seq?: number; ended?: boolean; reason?: string; none?: boolean; control?: boolean };
      // The person being helped (or the computer's owner) gave or took back control.
      if (typeof h.control === 'boolean' && scr && h.control !== scr.control) {
        scr.control = h.control;
        $('scr-controls').classList.toggle('hidden', !h.control);
        $('scr-typing').classList.toggle('hidden', !h.control);
        message(h.control ? 'You may now use their mouse and keyboard.' : 'Control was taken back: view only.');
      }
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

// ---------------------------------------------------------------- the AI: what it is doing, and its questions

interface AiState {
  off: boolean;
  pending?: { id: string; client: string; description: string; at: number }[];
  thumb?: { mime: string; data: string; caption: string } | null;
  tasks?: { client: string; goal: string; steps: number; plan: string }[];
}

let aiTimer: number | undefined;
async function aiPoll() {
  clearTimeout(aiTimer);
  if (ch) {
    try {
      showAi((await ch.req('cu.state')).header.r as AiState);
    } catch {
      /* an older Keeper on the computer: no AI tab there */
    }
  }
  // Quicker while the tab is open; otherwise only the badge needs keeping up to date.
  aiTimer = window.setTimeout(() => void aiPoll(), $('tab-ai').classList.contains('hidden') ? 6000 : 1500);
}

function showAi(st: AiState) {
  const pending = st.pending ?? [];
  $('ai-badge').textContent = String(pending.length);
  $('ai-badge').classList.toggle('hidden', !pending.length);
  // AI sits under More: the badge shows there too.
  $('more-badge').textContent = String(pending.length);
  $('more-badge').classList.toggle('hidden', !pending.length);
  const box = $('ai-pending');
  box.textContent = '';
  if (st.off) {
    const c = document.createElement('div');
    c.className = 'card muted';
    c.textContent = 'Answering from the phone is off on the computer (Agents → Keeper’s browser).';
    box.append(c);
  }
  for (const p of pending) {
    const c = document.createElement('div');
    c.className = 'card ai-q';
    const t = document.createElement('div');
    t.innerHTML = '<b></b> wants to:';
    (t.firstChild as HTMLElement).textContent = p.client;
    const d = document.createElement('div');
    d.style.marginTop = '4px';
    d.textContent = p.description;
    const btns = document.createElement('div');
    btns.className = 'btns';
    const no = document.createElement('button');
    no.className = 'btn';
    no.textContent = 'Don’t allow';
    const yes = document.createElement('button');
    yes.className = 'btn yes';
    yes.textContent = 'Allow once';
    const answer = (ok: boolean) => async () => {
      yes.disabled = no.disabled = true;
      try {
        await ch?.req('cu.decide', { id: p.id, ok });
        c.remove();
      } catch (e) {
        d.textContent = e instanceof Error ? e.message : String(e);
      }
      void aiPoll();
    };
    no.onclick = answer(false);
    yes.onclick = answer(true);
    btns.append(no, yes);
    c.append(t, d, btns);
    box.append(c);
  }
  const img = $<HTMLImageElement>('ai-thumb');
  if (st.thumb) {
    img.src = `data:${st.thumb.mime};base64,${st.thumb.data}`;
    img.classList.remove('hidden');
    $('ai-caption').textContent = st.thumb.caption;
  } else {
    img.classList.add('hidden');
    $('ai-caption').textContent = st.off ? '' : 'No AI is using Keeper’s browser or a private desktop right now.';
  }
  const tasks = $('ai-tasks');
  tasks.textContent = '';
  for (const t of st.tasks ?? []) {
    const pre = document.createElement('pre');
    pre.className = 'plan';
    pre.textContent = t.plan || `${t.client}: ${t.goal || 'working'} (${t.steps} steps)`;
    tasks.append(pre);
  }
}

void connect().then(() => void aiPoll());

// ---------------------------------------------------------------- help mode (a browser helping someone)

$<HTMLFormElement>('help-join').onsubmit = async (e) => {
  e.preventDefault();
  const code = normalizeCode($<HTMLInputElement>('help-code').value);
  const pw = normalizePassword($<HTMLInputElement>('help-pw').value);
  const name = $<HTMLInputElement>('help-name').value.trim().slice(0, 40) || 'Helper';
  if (!code) return message('The session code has 9 digits', true);
  message('Connecting…');
  ch = new Channel();
  ch.onclose = () => {
    status('Help session ended');
    ch = null;
  };
  try {
    const hi = await ch.open({ help: helpTagWeb(code), name }, helpSecretWeb(code, pw));
    $('help-join').classList.add('hidden');
    $('loc-card').classList.add('hidden');
    $('title').textContent = `Helping ${hi.name}`;
    status('Connected · encrypted · view only until they allow control', true);
    $('app').classList.remove('hidden');
    // Help: only the screen.
    for (const t of ['today', 'send', 'files', 'clip', 'ai', 'term']) document.querySelector<HTMLButtonElement>(`nav button[data-tab="${t}"]`)?.classList.add('hidden');
    $('nav-more-btn').classList.add('hidden');
    document.querySelector<HTMLButtonElement>('nav button[data-tab="screen"]')?.click();
    $('screen-control').classList.add('hidden');
    $('screen-view').textContent = 'View their screen';
    await screenStart(false);
  } catch (err) {
    message(err instanceof Error && /closed|integrity/.test(err.message) ? 'The code or password is not right, or the code has expired.' : err instanceof Error ? err.message : String(err), true);
  }
};

// ---------------------------------------------------------------- terminal (when the computer allows this phone)

let term: { id: string; next: number; on: boolean } | null = null;

async function termPoll() {
  while (term?.on && ch) {
    try {
      const r = await ch.req('term.read', { id: term.id, after: term.next });
      const h = r.header.r as { text: string; next: number; exit?: string };
      if (h.text) {
        const out = $('term-out');
        // Colours and cursor moves are dropped: this is a simple line terminal.
        out.textContent = (out.textContent + h.text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')).slice(-60_000);
        out.scrollTop = out.scrollHeight;
      }
      term.next = h.next;
      if (h.exit) {
        $('term-note').textContent = h.exit;
        term = null;
        return;
      }
      await new Promise((res) => setTimeout(res, h.text ? 60 : 400));
    } catch (e) {
      $('term-note').textContent = e instanceof Error ? e.message : String(e);
      term = null;
      return;
    }
  }
}

$('term-open').onclick = async () => {
  if (!ch || term) return;
  try {
    const r = await ch.req('term.open', { cols: 48, rows: 30 });
    term = { id: (r.header.r as { id: string }).id, next: 0, on: true };
    $('term-note').textContent = 'Connected';
    void termPoll();
  } catch (e) {
    $('term-note').textContent = e instanceof Error ? e.message : String(e);
  }
};
const termSend = (data: string) => term && ch && void ch.req('term.write', { id: term.id, data }).catch(() => undefined);
$('term-send').onclick = () => {
  const i = $<HTMLInputElement>('term-in');
  termSend(i.value + '\n');
  i.value = '';
};
$<HTMLInputElement>('term-in').onkeydown = (e) => {
  if (e.key === 'Enter') $('term-send').click();
};
$('term-ctrlc').onclick = () => termSend('\x03');
$('term-close').onclick = () => {
  if (term && ch) void ch.req('term.close', { id: term.id }).catch(() => undefined);
  term = null;
  $('term-note').textContent = 'Closed';
};

// ---------------------------------------------------------------- location (off until switched on; only while this page is open)

let locWatch: number | null = null;
let locLast = 0;
const locNote = (t: string) => ($('loc-note').textContent = t);

async function sendPosition(p: GeolocationPosition) {
  if (!ch || Date.now() - locLast < 15_000) return;
  locLast = Date.now();
  let battery: number | undefined;
  try {
    const b = await (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.();
    if (b) battery = Math.round(b.level * 100);
  } catch {
    /* not offered by this browser */
  }
  try {
    await ch.req('tracks.position', { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: p.timestamp || Date.now(), battery });
    locNote(`Shared at ${new Date().toLocaleTimeString()} (±${Math.round(p.coords.accuracy)} m)`);
  } catch (e) {
    locNote(e instanceof Error ? e.message : String(e));
  }
}

$<HTMLInputElement>('loc-share').onchange = (e) => {
  const on = (e.target as HTMLInputElement).checked;
  if (locWatch !== null) navigator.geolocation.clearWatch(locWatch);
  locWatch = null;
  if (!on) return locNote('Off. Your computer sees where this phone is, only while this page stays open.');
  if (!('geolocation' in navigator) || !window.isSecureContext) {
    (e.target as HTMLInputElement).checked = false;
    return locNote('This browser gives the location only to https pages: open the page through the tunnel address.');
  }
  locNote('Asking this phone for its location…');
  locLast = 0;
  locWatch = navigator.geolocation.watchPosition((p) => void sendPosition(p), (err) => {
    locNote(err.code === err.PERMISSION_DENIED ? 'Location was not allowed in this browser.' : 'The location is not available right now.');
  }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
};
