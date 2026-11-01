// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The small "Software Update" window: what it says and offers for each update
// state, whether an automatic check should open it, and release notes turned
// from Markdown into plain formatted blocks (never HTML). Pure functions,
// shared by the window and its tests.

import type { UpdateStatus } from './api-x';
import { relativeTime } from './format';
import { wantsBeta } from './updates';

export type UpdateWindowKind = 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
export type UpdateWindowAction = 'install' | 'download' | 'copy' | 'relaunch' | 'retry' | 'later' | 'close';

export interface UpdateWindowView {
  kind: UpdateWindowKind;
  title: string;
  /** a second line: versions, channel, when it last looked */
  detail?: string;
  /** what the updater says about this copy (installed by a package manager, from source…) */
  note?: string;
  /** 0–100 while downloading */
  percent?: number;
  /** release notes (Markdown) */
  notes?: string;
  /** buttons, the default one first */
  actions: { id: UpdateWindowAction; label: string; primary?: boolean }[];
  /** "Skip this version" */
  skip: boolean;
  /** "Open the releases page" */
  releases: boolean;
}

export interface UpdateWindowContext {
  /** the version running now */
  current: string;
  /** follows betas (Settings → Updates → Include beta versions, or a beta copy) */
  beta: boolean;
  now?: number;
  /** what the person last asked for here: a check, or an install (decides how an error reads) */
  last?: 'check' | 'install';
}

/** "Beta" or "Stable": the line of releases this copy follows. */
export function updateChannel(current: string, beta: boolean | undefined, chosen?: boolean): 'Beta' | 'Stable' {
  return wantsBeta(current, beta, chosen) ? 'Beta' : 'Stable';
}

/** What the window shows for an update status. */
export function updateWindowView(s: UpdateStatus | null | undefined, o: UpdateWindowContext): UpdateWindowView {
  const current = (o.current || s?.current || '').replace(/\s.*$/, '');
  const now = o.now ?? Date.now();
  const channel = o.beta ? 'Beta' : 'Stable';
  const base = { skip: false, releases: false };
  if (!s || s.state === 'idle' || s.state === 'checking') {
    return { ...base, kind: 'checking', title: 'Checking for updates…', actions: [] };
  }
  if (s.state === 'none') {
    return {
      ...base, kind: 'current', title: `Keeper ${current} is the newest version`,
      detail: `${channel} channel · Last checked ${s.checkedAt ? relativeTime(s.checkedAt, now) : 'just now'}`,
      actions: [{ id: 'close', label: 'OK', primary: true }],
    };
  }
  if (s.state === 'available') {
    const actions: UpdateWindowView['actions'] =
      s.method === 'manager' ? (s.manager?.command ? [{ id: 'copy', label: 'Copy Update Command', primary: true }] : [])
      : s.canInstall ? [{ id: 'install', label: s.method === 'package' ? 'Download and Install' : 'Install and Relaunch', primary: true }]
      : [{ id: 'download', label: 'Download…', primary: true }];
    actions.push({ id: 'later', label: 'Later' });
    const when = s.publishedAt ? Date.parse(s.publishedAt) : NaN;
    return {
      ...base, kind: 'available', skip: true,
      title: `Keeper ${s.version} is available — you have ${current}`,
      detail: [`${channel} channel`, Number.isFinite(when) ? `released ${relativeTime(when, now)}` : '', s.size ? sizeText(s.size) : ''].filter(Boolean).join(' · '),
      note: s.method === 'manager' && s.manager?.command ? `Installed with ${s.manager.label}. Update with: ${s.manager.command}` : s.message,
      notes: s.notes ?? '', actions,
    };
  }
  if (s.state === 'downloading') {
    const percent = Math.max(0, Math.min(100, Math.round(s.percent ?? 0)));
    return { ...base, kind: 'downloading', title: `Downloading Keeper${s.version ? ` ${s.version}` : ''}…`, detail: `${percent}%`, percent, notes: s.notes ?? '', actions: [{ id: 'later', label: 'Hide' }] };
  }
  if (s.state === 'ready') {
    return {
      ...base, kind: 'ready', title: `Keeper ${s.version} is ready to install`,
      detail: s.method === 'package' ? 'Installing asks for your password. Keeper opens again on the same page.' : 'Keeper relaunches and opens on the page you were on.',
      note: s.waitingFor || s.countdown !== undefined ? s.message : undefined,
      notes: s.notes ?? '',
      actions: [{ id: 'relaunch', label: s.method === 'package' ? 'Install Now' : 'Relaunch Now', primary: true }, { id: 'later', label: 'Later' }],
    };
  }
  if (s.state === 'installing') {
    return { ...base, kind: 'installing', title: `Installing Keeper${s.version ? ` ${s.version}` : ''}…`, detail: 'Keeper closes and opens again in a moment.', actions: [] };
  }
  // error, unsupported
  return {
    ...base, kind: 'error', releases: true,
    title: o.last === 'install' ? 'Keeper couldn’t install the update' : 'Couldn’t check for updates',
    detail: s.message || (s.state === 'unsupported' ? 'This copy of Keeper cannot update itself.' : 'Check your internet connection and try again.'),
    actions: [{ id: 'retry', label: 'Try Again', primary: true }, { id: 'close', label: 'Close' }],
  };
}

function sizeText(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * After an automatic check: open the window? Only when the person chose "Ask
 * before installing" and has not skipped this version. Automatic mode downloads
 * quietly and "Only when I check" never looks on its own.
 */
export function shouldOfferUpdate(s: UpdateStatus, o: { updateMode?: 'auto' | 'ask' | 'off'; updateSkip?: string }): boolean {
  return s.state === 'available' && !!s.version && o.updateMode === 'ask' && !isSkipped(s, o.updateSkip);
}

/** The person pressed "Skip this version" for this one. */
export function isSkipped(s: Pick<UpdateStatus, 'version' | 'state'>, skip: string | undefined): boolean {
  return !!skip && !!s.version && s.state === 'available' && s.version.replace(/^v/i, '') === skip.replace(/^v/i, '');
}

/** The tray's update entry: what it says. Null = the plain "Check for Updates…". */
export function trayUpdateLabel(s: Pick<UpdateStatus, 'state' | 'version' | 'percent'>): string | null {
  if (s.state === 'ready' && s.version) return `Restart to Update to ${s.version}`;
  if (s.state === 'available' && s.version) return `Keeper ${s.version} Is Available…`;
  if (s.state === 'downloading') return `Downloading Keeper${s.version ? ` ${s.version}` : ''}… ${Math.round(s.percent ?? 0)}%`;
  return null;
}

// ---------------------------------------------------------------- release notes

export type NoteInline = { t: 'text' | 'strong' | 'em' | 'code'; s: string } | { t: 'link'; s: string; href: string };
export type NoteBlock =
  | { t: 'h'; level: number; c: NoteInline[] }
  | { t: 'p'; c: NoteInline[] }
  | { t: 'ul' | 'ol'; items: NoteInline[][] }
  | { t: 'pre'; s: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_m, e: string) => ENTITIES[e]);
}

/** Inline Markdown: **bold**, *italic*, `code`, [links](https://…) and bare https links; anything else is text. */
export function noteInline(src: string): NoteInline[] {
  const out: NoteInline[] = [];
  const push = (n: NoteInline) => {
    const last = out[out.length - 1];
    if (n.t === 'text' && last?.t === 'text') last.s += n.s;
    else if (n.s) out.push(n);
  };
  const re = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|!?\[([^\]]*)\]\(\s*<?([^()\s>]*(?:\([^()\s]*\)[^()\s>]*)*)>?(?:\s+"[^"]*")?\s*\)|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|(?<![\w/])_(?![\s_])(.+?)(?<![\s_])_(?!\w)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let at = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > at) push({ t: 'text', s: decode(src.slice(at, m.index)) });
    at = m.index + m[0].length;
    if (m[1] !== undefined) push({ t: 'code', s: m[1] });
    else if (m[2] !== undefined || m[3] !== undefined) push({ t: 'strong', s: decode(plain(m[2] ?? m[3])) });
    else if (m[5] !== undefined) {
      const text = decode(plain(m[4] ?? '')) || m[5];
      // Pictures would load from the network: only their words are kept.
      if (m[0].startsWith('!')) push({ t: 'text', s: m[4] ? decode(m[4]) : '' });
      else if (/^https?:\/\//i.test(m[5])) push({ t: 'link', s: text, href: m[5] });
      else push({ t: 'text', s: text });
    } else if (m[6] !== undefined || m[7] !== undefined) push({ t: 'em', s: decode(plain(m[6] ?? m[7])) });
    else if (m[8] !== undefined) push({ t: 'link', s: m[8], href: m[8] });
  }
  if (at < src.length) push({ t: 'text', s: decode(src.slice(at)) });
  return out;
}

/** Text without inline marks (inside bold, links…). */
function plain(s: string): string {
  return s.replace(/`([^`]+)`/g, '$1').replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * Release notes (GitHub Markdown) as blocks of plain formatted text: headings,
 * paragraphs, lists and code. HTML in the notes is dropped, never rendered.
 */
export function noteBlocks(md: string | undefined | null, max = 200): NoteBlock[] {
  const text = (md ?? '')
    .replace(/\r/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '');
  const blocks: NoteBlock[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: noteInline(para.join(' ').replace(/\s+/g, ' ').trim()) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map((i) => noteInline(i.trim())) });
    list = null;
  };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && blocks.length < max; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      blocks.push({ t: 'pre', s: body.join('\n') });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      // A blank line between items keeps the list going.
      if (list && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i + 1] ?? '')) flushList();
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ t: 'h', level: h[1].length, c: noteInline(h[2]) });
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      flushList();
      continue;
    }
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flushPara();
      const t = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (list && list.t !== t && !/^\s{2,}/.test(line)) flushList();
      if (!list) list = { t, items: [] };
      list.items.push(item[2].replace(/^\[[ xX]\]\s+/, ''));
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // The item's text runs on.
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    flushList();
    para.push(line.replace(/^\s*>\s?/, ''));
  }
  flushPara();
  flushList();
  return blocks.slice(0, max);
}
