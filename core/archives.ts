// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Archives: which kind of archive a file is, which engine on this computer can
// open, take out of or make it (Keeper itself, the system's tar, or 7-Zip when
// it is installed), browsing inside by folder, choosing what to take out, the
// commands for the outside tools, and plain words on what works here. Pure.

import type { ArchiveEntry } from './archive';

export type ArchiveFormat = 'zip' | '7z' | 'rar' | 'tar' | 'tar.gz' | 'tar.xz' | 'tar.zst' | 'tar.bz2' | 'gz' | 'xz' | 'zst' | 'bz2' | 'iso' | 'cab';

const BY_EXT: [RegExp, ArchiveFormat][] = [
  [/\.(tar\.gz|tgz)$/i, 'tar.gz'],
  [/\.(tar\.xz|txz)$/i, 'tar.xz'],
  [/\.(tar\.zst|tzst|tar\.zstd)$/i, 'tar.zst'],
  [/\.(tar\.bz2|tbz2?|tb2)$/i, 'tar.bz2'],
  [/\.tar$/i, 'tar'],
  [/\.(zip|zipx|jar|apk|ipa|epub|cbz)$/i, 'zip'],
  [/\.(7z|cb7)$/i, '7z'],
  [/\.(rar|cbr)$/i, 'rar'],
  [/\.(part0*1\.rar|r00)$/i, 'rar'],
  [/\.gz$/i, 'gz'],
  [/\.xz$/i, 'xz'],
  [/\.(zst|zstd)$/i, 'zst'],
  [/\.bz2$/i, 'bz2'],
  [/\.iso$/i, 'iso'],
  [/\.cab$/i, 'cab'],
];

/** The kind of archive, from the file's first bytes when given (a renamed file still opens), else its name. */
export function formatOf(name: string, head?: Uint8Array): ArchiveFormat | undefined {
  const byName = BY_EXT.find(([re]) => re.test(name))?.[1];
  if (head && head.length >= 6) {
    const h = head;
    if (h[0] === 0x50 && h[1] === 0x4b && (h[2] === 3 || h[2] === 5 || h[2] === 7)) return 'zip';
    if (h[0] === 0x37 && h[1] === 0x7a && h[2] === 0xbc && h[3] === 0xaf) return '7z';
    if (h[0] === 0x52 && h[1] === 0x61 && h[2] === 0x72 && h[3] === 0x21) return 'rar';
    if (h[0] === 0x1f && h[1] === 0x8b) return byName === 'tar.gz' ? 'tar.gz' : byName === 'gz' ? 'gz' : 'tar.gz';
    if (h[0] === 0xfd && h[1] === 0x37 && h[2] === 0x7a && h[3] === 0x58) return byName === 'xz' ? 'xz' : 'tar.xz';
    if (h[0] === 0x28 && h[1] === 0xb5 && h[2] === 0x2f && h[3] === 0xfd) return byName === 'zst' ? 'zst' : 'tar.zst';
    if (h[0] === 0x42 && h[1] === 0x5a && h[2] === 0x68) return byName === 'bz2' ? 'bz2' : 'tar.bz2';
    if (h[0] === 0x4d && h[1] === 0x53 && h[2] === 0x43 && h[3] === 0x46) return 'cab';
    if (h.length >= 262 && String.fromCharCode(...h.subarray(257, 262)) === 'ustar') return 'tar';
  }
  return byName;
}

export const FORMAT_LABEL: Record<ArchiveFormat, string> = {
  zip: 'ZIP', '7z': '7z', rar: 'RAR', tar: 'TAR', 'tar.gz': 'TAR.GZ', 'tar.xz': 'TAR.XZ', 'tar.zst': 'TAR.ZST', 'tar.bz2': 'TAR.BZ2', gz: 'GZ', xz: 'XZ', zst: 'ZST', bz2: 'BZ2', iso: 'Disc image (ISO)', cab: 'CAB',
};

/** The outside programs found on this computer. */
export interface ArchiveTools {
  /** a tar that is libarchive's (macOS and Windows 10+ ship one; Linux has it as bsdtar when installed) */
  bsdtar?: string;
  /** GNU tar (most Linux systems): tar files with gzip, xz, zstd and bzip2 when those programs are installed */
  gnutar?: string;
  /** 7-Zip's command-line program (7zz, 7z or 7za) */
  sevenZip?: string;
  /** 7za is 7-Zip's small edition: no RAR */
  sevenZipLite?: boolean;
  unrar?: string;
}

export type Engine = 'keeper' | 'bsdtar' | 'gnutar' | '7zip' | 'unrar';
export type Op = 'list' | 'extract';

export interface EngineChoice { engine?: Engine; bin?: string; /** what is missing, in plain words */ missing?: string }

/** Kinds Keeper reads itself, with no outside program. */
const OWN: ArchiveFormat[] = ['zip', 'tar', 'tar.gz', 'gz'];
const LIBARCHIVE: ArchiveFormat[] = ['zip', '7z', 'rar', 'tar', 'tar.gz', 'tar.xz', 'tar.zst', 'tar.bz2', 'gz', 'xz', 'zst', 'bz2', 'iso', 'cab'];
const GNUTAR: ArchiveFormat[] = ['tar', 'tar.gz', 'tar.xz', 'tar.zst', 'tar.bz2'];

/**
 * The engine that opens or unpacks this kind on this computer. Keeper's own
 * reader comes first for ZIP and TAR (it also opens AES-256 ZIPs); password
 * protected 7z and RAR need 7-Zip, which libarchive cannot decrypt.
 */
export function engineFor(format: ArchiveFormat, tools: ArchiveTools, o: { encrypted?: boolean; big?: boolean } = {}): EngineChoice {
  if (OWN.includes(format) && !o.big) return { engine: 'keeper' };
  const seven = tools.sevenZip && !(format === 'rar' && tools.sevenZipLite) ? { engine: '7zip' as const, bin: tools.sevenZip } : undefined;
  if (o.encrypted && (format === '7z' || format === 'rar')) {
    if (seven) return seven;
    if (format === 'rar' && tools.unrar) return { engine: 'unrar', bin: tools.unrar };
    return { missing: `Password-protected ${FORMAT_LABEL[format]} archives need the free 7-Zip program` };
  }
  if (tools.bsdtar && LIBARCHIVE.includes(format)) return { engine: 'bsdtar', bin: tools.bsdtar };
  if (seven) return seven;
  if (tools.gnutar && GNUTAR.includes(format)) return { engine: 'gnutar', bin: tools.gnutar };
  if (format === 'rar' && tools.unrar) return { engine: 'unrar', bin: tools.unrar };
  if (OWN.includes(format)) return { engine: 'keeper' };
  return { missing: `${FORMAT_LABEL[format]} archives need the free 7-Zip program on this computer` };
}

export type CreateFormat = 'zip' | '7z';

/** How an archive is made: ZIP always by Keeper (AES-256 with a password); 7z by 7-Zip, or without a password by the system's tar. */
export function createEngine(format: CreateFormat, tools: ArchiveTools, password?: string): EngineChoice {
  if (format === 'zip') return { engine: 'keeper' };
  if (tools.sevenZip) return { engine: '7zip', bin: tools.sevenZip };
  if (!password && tools.bsdtar) return { engine: 'bsdtar', bin: tools.bsdtar };
  return { missing: password ? '7z with a password needs the free 7-Zip program; ZIP with a password works without it' : '7z archives need the free 7-Zip program on this computer' };
}

// ---------------------------------------------------------------- commands

/** 7-Zip's arguments. The password goes in -p (never shown); `--` ends the options so names are only names. */
export function sevenZipArgs(op: 'list' | 'extract' | 'create', archive: string, o: { names?: string[]; dest?: string; password?: string; format?: CreateFormat; level?: number } = {}): string[] {
  const pw = o.password ? [`-p${o.password}`] : ['-p'];
  if (op === 'list') return ['l', '-slt', '-ba', ...pw, '--', archive];
  if (op === 'extract') return ['x', '-y', '-aou', `-o${o.dest}`, ...pw, '--', archive, ...(o.names ?? [])];
  return ['a', `-t${o.format ?? '7z'}`, `-mx=${o.level ?? 5}`, ...(o.password ? [`-p${o.password}`, ...(o.format === 'zip' ? ['-mem=AES256'] : ['-mhe=on'])] : []), '-y', '--', archive, ...(o.names ?? [])];
}

/** The system tar's arguments; names after `--` are only ever names. */
export function tarArgs(op: 'list' | 'extract' | 'create7z', archive: string, o: { names?: string[]; dest?: string; cwd?: string; password?: string; gnu?: boolean } = {}): string[] {
  if (op === 'list') return ['-tvf', archive];
  if (op === 'extract') return ['-xf', archive, ...(o.password && !o.gnu ? ['--passphrase', o.password] : []), '-C', o.dest!, '--', ...(o.names ?? [])];
  return ['--format', '7zip', '-cf', archive, '-C', o.cwd!, '--', ...(o.names ?? [])];
}

// ---------------------------------------------------------------- browsing

export interface FolderView {
  /** the folder being shown ('' is the top) */
  dir: string;
  folders: { name: string; path: string; files: number; size: number }[];
  files: (ArchiveEntry & { base: string })[];
}

const clean = (n: string) => n.replace(/\\/g, '/').replace(/^\.?\//, '');

/** What is directly inside one folder of the archive, with each subfolder's file count and size. */
export function folderView(entries: ArchiveEntry[], dir: string): FolderView {
  const pre = dir ? `${dir.replace(/\/$/, '')}/` : '';
  const folders = new Map<string, { name: string; path: string; files: number; size: number }>();
  const files: (ArchiveEntry & { base: string })[] = [];
  for (const e of entries) {
    const n = clean(e.name);
    if (!n.startsWith(pre) || n === pre) continue;
    const rest = n.slice(pre.length).replace(/\/$/, '');
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash >= 0 || e.dir) {
      const name = slash >= 0 ? rest.slice(0, slash) : rest;
      const f = folders.get(name) ?? { name, path: pre + name, files: 0, size: 0 };
      if (!e.dir) { f.files++; f.size += e.size; }
      folders.set(name, f);
    } else files.push({ ...e, base: rest });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return { dir: pre.replace(/\/$/, ''), folders: [...folders.values()].sort(byName), files: files.sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' })) };
}

/** The steps of a folder path, for the breadcrumb. */
export function crumbs(dir: string): { name: string; path: string }[] {
  const parts = dir.split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

/** Every entry a selection covers: chosen files, and everything under chosen folders. */
export function expandSelection(entries: ArchiveEntry[], picked: string[]): string[] {
  const want = picked.map(clean);
  const out = new Set<string>();
  for (const e of entries) {
    const n = clean(e.name);
    if (want.some((w) => n === w || n === `${w}/` || n.startsWith(`${w.replace(/\/$/, '')}/`))) out.add(e.name);
  }
  return [...out];
}

/** Names that would land outside the destination folder: never unpacked. */
export function unsafeEntry(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  return n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').some((p) => p === '..');
}

/** The folder an archive unpacks into: its name without the archive endings ("Photos.tar.gz" → "Photos"). */
export function extractFolderName(archiveName: string): string {
  const base = archiveName.replace(/\.(tar\.(gz|xz|zst|zstd|bz2)|tgz|txz|tzst|tbz2?|zipx?|7z|rar|tar|gz|xz|zst|bz2|iso|cab|jar|cbz|cbr|cb7)$/i, '').replace(/\.part0*1$/i, '');
  return base.trim() || 'Archive';
}

/** A name for a new archive: the one item's name, or "Archive" for several. */
export function newArchiveName(paths: string[], format: CreateFormat): string {
  const one = paths.length === 1 ? paths[0].split(/[\\/]/).filter(Boolean).pop() ?? 'Archive' : 'Archive';
  return `${one.replace(/\.[^.]+$/, '') || one}.${format}`;
}

// ---------------------------------------------------------------- what works here

export interface SupportRow { format: string; open: string; create: string; ok: boolean }

/** What this computer can do with each kind, in plain words, for the "What works here" panel. */
export function supportRows(tools: ArchiveTools, platform: string): SupportRow[] {
  const how = (f: ArchiveFormat, encrypted = false) => {
    const e = engineFor(f, tools, { encrypted });
    return e.engine === 'keeper' ? 'Keeper' : e.engine === 'bsdtar' ? (platform === 'linux' ? 'bsdtar' : 'the system’s tar') : e.engine === 'gnutar' ? 'the system’s tar' : e.engine === '7zip' ? '7-Zip' : e.engine === 'unrar' ? 'unrar' : '';
  };
  const row = (label: string, f: ArchiveFormat, create: string): SupportRow => {
    const by = how(f);
    const enc = f === '7z' || f === 'rar' ? how(f, true) : by;
    const open = by ? `Opens with ${by}${(f === '7z' || f === 'rar') && !enc ? '; with a password needs 7-Zip' : ''}` : 'Needs 7-Zip';
    return { format: label, open, create, ok: !!by };
  };
  const seven = createEngine('7z', tools, 'x');
  const sevenPlain = createEngine('7z', tools);
  return [
    row('ZIP', 'zip', 'Keeper makes it, with an AES-256 password if you like'),
    row('7z', '7z', seven.engine ? 'Made with 7-Zip, password and hidden names included' : sevenPlain.engine ? 'Made without a password by the system’s tar; a password needs 7-Zip' : 'Needs 7-Zip'),
    row('RAR', 'rar', 'Never made: RAR is a closed format; Keeper only opens it'),
    row('TAR and TAR.GZ', 'tar.gz', '—'),
    row('TAR.XZ, TAR.ZST, TAR.BZ2', 'tar.xz', '—'),
    row('Disc images (ISO)', 'iso', '—'),
  ];
}

/** Where to get 7-Zip on this system, in plain words. */
export function sevenZipHint(platform: string): string {
  return platform === 'darwin' ? 'Install the free 7-Zip program (for example with Homebrew: brew install sevenzip), then open the archive again.'
    : platform === 'win32' ? 'Install the free 7-Zip program from 7-zip.org, then open the archive again.'
      : 'Install the free 7-Zip program (sudo apt install 7zip, or your system’s package for 7-Zip), then open the archive again.';
}

// ---------------------------------------------------------------- the interface's calls

export interface OpenedArchive {
  path: string;
  name: string;
  format: ArchiveFormat;
  size: number;
  entries: ArchiveEntry[];
  /** some entries (or the names) are protected with a password */
  encrypted: boolean;
  /** a password is needed even to see what is inside */
  needsPassword?: boolean;
  engine?: string;
  /** why it cannot be opened here, and what to install */
  note?: string;
}

export interface ExtractResult { dest: string; files: number; skipped: string[] }

export interface ArchivesApi {
  open(path: string, password?: string): Promise<OpenedArchive>;
  /** chosen entries (or all, with null) out to a folder; null when a folder was asked for and none chosen */
  extract(path: string, picked: string[] | null, o?: { dest?: string; password?: string; ask?: boolean }): Promise<ExtractResult | null>;
  /** one entry into the preview folder, for Quick Look */
  peek(path: string, entry: string, password?: string): Promise<string>;
  create(paths: string[], o: { format: CreateFormat; password?: string; name?: string; dest?: string }): Promise<string>;
  support(): Promise<{ rows: SupportRow[]; sevenZip: boolean; hint: string; platform: string }>;
  pick(): Promise<string | null>;
  pickItems(): Promise<string[]>;
}
