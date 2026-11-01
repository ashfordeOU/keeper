// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Saving videos (and their sound) from web pages with yt-dlp (Unlicense),
// downloaded once on first use, checked against its published SHA-256, and
// run with Keeper's own ffmpeg. Only the link the person pastes is contacted.

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { lowerPriority } from './governor';

export const YTDLP = {
  version: '2026.10.26',
  files: {
    'darwin': { name: 'yt-dlp_macos', sha256: '0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa' },
    'win32': { name: 'yt-dlp.exe', sha256: 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d' },
    'linux-x64': { name: 'yt-dlp_linux', sha256: '767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795' },
    'linux-arm64': { name: 'yt-dlp_linux_aarch64', sha256: 'e87e9533e89fe5889abaa21f5114dfe7756d6aa6219b83551add04d48b18e483' },
  } as Record<string, { name: string; sha256: string }>,
};

export type VideoQuality = 'best' | '1080' | '720' | 'audio';

export interface DownloadOptions {
  url: string;
  quality: VideoQuality;
  folder: string;
  /** a whole playlist or channel page, instead of just the one video */
  playlist?: boolean;
  /** sign-in from a browser, for videos only visible when logged in */
  cookiesFrom?: 'chrome' | 'firefox' | 'safari' | 'edge' | 'brave';
  subtitles?: boolean;
}

/** yt-dlp arguments for the chosen quality; pure, so it is tested. */
export function downloadArgs(o: DownloadOptions, ffmpeg: string | null): string[] {
  const fmt =
    o.quality === 'audio' ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
    : o.quality === 'best' ? ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4']
    : ['-f', `bv*[height<=${o.quality}]+ba/b[height<=${o.quality}]/b`, '--merge-output-format', 'mp4'];
  return [
    ...fmt,
    ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
    o.playlist ? '--yes-playlist' : '--no-playlist',
    ...(o.cookiesFrom ? ['--cookies-from-browser', o.cookiesFrom] : []),
    ...(o.subtitles ? ['--write-subs', '--write-auto-subs', '--sub-langs', 'en.*,-live_chat', '--embed-subs'] : []),
    '--embed-metadata', '--embed-thumbnail', '--no-mtime',
    '--newline', '--no-colors', '--restrict-filenames', '--windows-filenames',
    '-P', o.folder,
    '-o', o.playlist ? '%(playlist_title,uploader|Playlist)s/%(playlist_index)03d %(title).150B.%(ext)s' : '%(title).180B [%(id)s].%(ext)s',
    '--print', 'after_move:filepath',
    '--', o.url,
  ];
}

/** "[download]  42.3% of ~ 12.34MiB at 2.1MiB/s ETA 00:05" */
export function parseDownloadLine(line: string): { percent?: number; speed?: string; eta?: string; item?: string } | undefined {
  const p = line.match(/^\[download\]\s+(\d+(?:\.\d+)?)%(?:.*?\bat\s+(\S+))?(?:.*?ETA\s+(\S+))?/);
  if (p) return { percent: +p[1], speed: p[2], eta: p[3] };
  const item = line.match(/^\[download\] Downloading item (\d+) of (\d+)/);
  if (item) return { item: `${item[1]} of ${item[2]}` };
  return undefined;
}

export class VideoDownloader {
  private child: ChildProcess | null = null;
  constructor(private binDir: string, private ffmpeg: () => string | null) {}

  private key(): string {
    if (process.platform === 'linux') return `linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}`;
    return process.platform;
  }

  async binary(onProgress?: (msg: string) => void): Promise<string> {
    const pin = YTDLP.files[this.key()];
    if (!pin) throw new Error('Video downloads are not available on this system');
    const file = path.join(this.binDir, `yt-dlp-${YTDLP.version}${process.platform === 'win32' ? '.exe' : ''}`);
    if (existsSync(file)) return file;
    onProgress?.('Getting the downloader (once, about 20 MB)');
    await fsp.mkdir(this.binDir, { recursive: true });
    const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP.version}/${pin.name}`);
    if (!res.ok) throw new Error(`Could not get the downloader (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (createHash('sha256').update(buf).digest('hex') !== pin.sha256) throw new Error('The downloader did not match its published fingerprint, so Keeper did not use it');
    await fsp.writeFile(file + '.partial', buf);
    await fsp.rename(file + '.partial', file);
    if (process.platform !== 'win32') chmodSync(file, 0o755);
    if (process.platform === 'darwin') await new Promise((r) => spawn('/usr/bin/xattr', ['-d', 'com.apple.quarantine', file]).on('close', r).on('error', r));
    return file;
  }

  async download(o: DownloadOptions, onProgress: (p: { fraction: number; phase: string }) => void): Promise<string[]> {
    if (this.child) throw new Error('A download is already running');
    if (!/^https?:\/\//i.test(o.url.trim())) throw new Error('Paste a link starting with http:// or https://');
    const bin = await this.binary((m) => onProgress({ fraction: 0, phase: m }));
    await fsp.mkdir(o.folder, { recursive: true });
    const files: string[] = [];
    let lastErr = '';
    let item = '';
    const code = await new Promise<number>((resolve) => {
      const child = spawn(bin, downloadArgs(o, this.ffmpeg()), { windowsHide: true });
      this.child = child;
      lowerPriority(child);
      let buf = '';
      const onData = (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const l of lines) {
          const p = parseDownloadLine(l);
          if (p?.item) item = p.item;
          if (p?.percent !== undefined) onProgress({ fraction: p.percent / 100, phase: `Downloading${item ? ` ${item}` : ''}${p.speed ? ` · ${p.speed}` : ''}${p.eta ? ` · ${p.eta} left` : ''}` });
          else if (/^\[(Merger|ExtractAudio|EmbedThumbnail|Metadata)\]/.test(l)) onProgress({ fraction: 0.99, phase: 'Finishing' });
          else if (/^ERROR:/.test(l)) lastErr = l.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '');
          else if (l && path.isAbsolute(l.trim()) && existsSync(l.trim())) files.push(l.trim());
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', () => resolve(127));
      child.on('close', (c) => resolve(c ?? 1));
    });
    this.child = null;
    if (code !== 0 && !files.length) throw new Error(lastErr || 'The video could not be downloaded');
    return files;
  }

  cancel() {
    this.child?.kill();
    this.child = null;
  }
}
