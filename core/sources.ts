// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turns the URL a file was downloaded from into a named source ("Gmail", "Slack", ...).
//
// Operating systems record download origins in different places; the platform
// readers in electron/services/origin.ts and cli/ hand the raw URLs to `sourceFromUrls`.
//   macOS   extended attribute com.apple.metadata:kMDItemWhereFroms
//   Windows NTFS stream  <file>:Zone.Identifier  (HostUrl= / ReferrerUrl=)
//   Linux   extended attribute user.xdg.origin.url / user.xdg.referrer.url

import type { DownloadSource } from './types';
import { keeperSource } from './origin';

interface Known {
  id: string;
  name: string;
  /** host suffixes, matched against both the file URL and the page that linked to it */
  hosts: string[];
  /** optional path test for hosts shared by several services (google.com) */
  path?: RegExp;
}

// Order matters: more specific entries first.
export const KNOWN_SOURCES: Known[] = [
  { id: 'gmail', name: 'Gmail', hosts: ['mail.google.com', 'mail-attachment.googleusercontent.com'] },
  { id: 'gdrive', name: 'Google Drive', hosts: ['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com', 'doc-0s-docs.googleusercontent.com'] },
  { id: 'gphotos', name: 'Google Photos', hosts: ['photos.google.com', 'photos.fife.usercontent.google.com'] },
  { id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com', 'files.oaiusercontent.com', 'oaiusercontent.com'] },
  { id: 'claude', name: 'Claude', hosts: ['claude.ai', 'claudeusercontent.com'] },
  { id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'] },
  { id: 'canva', name: 'Canva', hosts: ['canva.com', 'canva-export.com', 'export-download.canva.com'] },
  { id: 'figma', name: 'Figma', hosts: ['figma.com', 'figmausercontent.com'] },
  { id: 'notion', name: 'Notion', hosts: ['notion.so', 'notion.site', 'notion-static.com', 'file.notion.so'] },
  { id: 'x', name: 'X', hosts: ['x.com', 'twitter.com', 'twimg.com'] },
  { id: 'slack', name: 'Slack', hosts: ['slack.com', 'slack-edge.com', 'slack-files.com'] },
  { id: 'whatsapp', name: 'WhatsApp', hosts: ['web.whatsapp.com', 'whatsapp.net', 'whatsapp.com'] },
  { id: 'telegram', name: 'Telegram', hosts: ['web.telegram.org', 'telegram.org', 't.me', 'telesco.pe'] },
  { id: 'discord', name: 'Discord', hosts: ['discord.com', 'discordapp.com', 'discordapp.net', 'cdn.discordapp.com'] },
  { id: 'teams', name: 'Microsoft Teams', hosts: ['teams.microsoft.com', 'teams.live.com'] },
  { id: 'outlook', name: 'Outlook', hosts: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'attachments.office.net'] },
  { id: 'onedrive', name: 'OneDrive', hosts: ['onedrive.live.com', '1drv.ms', 'sharepoint.com', 'onedrive.com'] },
  { id: 'dropbox', name: 'Dropbox', hosts: ['dropbox.com', 'dropboxusercontent.com', 'dl.dropboxusercontent.com'] },
  { id: 'wetransfer', name: 'WeTransfer', hosts: ['wetransfer.com', 'we.tl'] },
  { id: 'icloud', name: 'iCloud', hosts: ['icloud.com', 'icloud-content.com'] },
  { id: 'github', name: 'GitHub', hosts: ['github.com', 'githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'] },
  { id: 'gitlab', name: 'GitLab', hosts: ['gitlab.com'] },
  { id: 'youtube', name: 'YouTube', hosts: ['youtube.com', 'youtu.be', 'googlevideo.com'] },
  { id: 'reddit', name: 'Reddit', hosts: ['reddit.com', 'redd.it', 'redditmedia.com'] },
  { id: 'linkedin', name: 'LinkedIn', hosts: ['linkedin.com', 'licdn.com'] },
  { id: 'facebook', name: 'Facebook', hosts: ['facebook.com', 'fbcdn.net', 'messenger.com'] },
  { id: 'instagram', name: 'Instagram', hosts: ['instagram.com', 'cdninstagram.com'] },
  { id: 'zoom', name: 'Zoom', hosts: ['zoom.us', 'zoom.com'] },
  { id: 'amazon', name: 'Amazon', hosts: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.in', 'media-amazon.com'] },
  { id: 'apple', name: 'Apple', hosts: ['apple.com', 'mzstatic.com'] },
  { id: 'microsoft', name: 'Microsoft', hosts: ['microsoft.com', 'download.microsoft.com', 'live.com'] },
  { id: 'extension', name: 'Browser extension', hosts: [] },
];

const BY_ID = new Map(KNOWN_SOURCES.map((s) => [s.id, s]));

export function sourceName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

function hostOf(url: string): string | null {
  if (/^(chrome|moz|safari-web|ms-browser|edge)-extension:/i.test(url)) return 'extension';
  try {
    const u = new URL(url);
    if (u.protocol === 'blob:') return hostOf(u.pathname);
    if (u.protocol === 'data:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function match(host: string): Known | undefined {
  if (host === 'extension') return BY_ID.get('extension');
  return KNOWN_SOURCES.find((k) => k.hosts.some((h) => host === h || host.endsWith('.' + h)));
}

/** Pretty site name for unknown hosts: "files.example.co.uk" -> "example.co.uk". */
export function siteName(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const secondLevel = /^(co|com|net|org|gov|ac|edu)$/.test(parts[parts.length - 2]);
  return parts.slice(secondLevel ? -3 : -2).join('.');
}

/**
 * The referrer usually names the service better than the file URL (a Gmail
 * attachment is served from googleusercontent.com, but the page was mail.google.com),
 * so every URL is checked against the known list before falling back to a host name.
 */
export function sourceFromUrls(urls: (string | undefined | null)[]): DownloadSource | undefined {
  const clean = urls.filter((u): u is string => !!u && u.trim().length > 0).map((u) => u.trim());
  if (clean.length === 0) return undefined;
  const [url, referrer] = clean;
  // Saved by Keeper itself: Mail, Keeper Link (from a device), a cloud connection.
  for (const u of clean) {
    const k = keeperSource(u);
    if (k) return { ...k, url, referrer };
  }
  // Referrer first: it is the page the user was on.
  for (const u of [...clean.slice(1), clean[0]]) {
    const h = hostOf(u);
    if (!h) continue;
    const k = match(h);
    if (k) return { id: k.id, name: k.name, host: h, url, referrer };
  }
  const h = hostOf(url) ?? (referrer ? hostOf(referrer) : null);
  if (!h) return undefined;
  const site = siteName(h);
  return { id: 'web:' + site, name: site, host: h, url, referrer };
}

/** Parses the contents of a Windows Zone.Identifier stream. */
export function parseZoneIdentifier(text: string): DownloadSource | undefined {
  const get = (key: string) => text.match(new RegExp(`^${key}=(.*)$`, 'mi'))?.[1]?.trim();
  return sourceFromUrls([get('HostUrl'), get('ReferrerUrl')]);
}

/** Parses `mdls -raw -name kMDItemWhereFroms` output: ("url", "referrer") or (null). */
export function parseMdlsWhereFroms(text: string): DownloadSource | undefined {
  const urls = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));
  return sourceFromUrls(urls);
}

/** Undoes getfattr's escaping of file names: \\ and \ooo (octal bytes); UTF-8 text is left as it is. */
function unescapeGetfattr(s: string): string {
  if (!s.includes('\\')) return s;
  const bytes = Buffer.from(s, 'utf8');
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x5c && bytes[i + 1] === 0x5c) { out.push(0x5c); i++; continue; }
    if (bytes[i] === 0x5c && /^[0-7]{3}$/.test(bytes.subarray(i + 1, i + 4).toString('latin1'))) {
      out.push(parseInt(bytes.subarray(i + 1, i + 4).toString('latin1'), 8));
      i += 3;
      continue;
    }
    out.push(bytes[i]);
  }
  return Buffer.from(out).toString('utf8');
}

/**
 * Reads `getfattr --absolute-names -e hex -n <name> -- file…` output: one
 * attribute value per file that has it. Files without it only print to stderr.
 */
export function parseGetfattrHex(text: string, name: string): Map<string, string> {
  const res = new Map<string, string>();
  let file: string | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('# file: ')) file = unescapeGetfattr(line.slice(8));
    else if (file && line.startsWith(name + '=0x')) {
      res.set(file, Buffer.from(line.slice(name.length + 3).trim(), 'hex').toString('utf8'));
      file = undefined;
    }
  }
  return res;
}

/**
 * Splits `mdls -raw -name A -name B file…` output: values come in order, NUL
 * separated, `names` per file. Returns null when the count does not add up.
 */
export function splitMdlsRaw(text: string, files: number, names: number): string[][] | null {
  const parts = text.split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  if (parts.length !== files * names) return null;
  const out: string[][] = [];
  for (let i = 0; i < files; i++) out.push(parts.slice(i * names, i * names + names));
  return out;
}

/** Matches a typed word ("gmail", "drive", "chat gpt", "twitter") to a source id. */
export function sourceFromWord(word: string): string | undefined {
  const w = word.toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (!w) return undefined;
  const aliases: Record<string, string> = {
    gmail: 'gmail', googlemail: 'gmail', mail: 'gmail',
    drive: 'gdrive', googledrive: 'gdrive', gdrive: 'gdrive', gdocs: 'gdrive', googledocs: 'gdrive',
    chatgpt: 'chatgpt', openai: 'chatgpt', gpt: 'chatgpt',
    claude: 'claude', anthropic: 'claude',
    gemini: 'gemini', canva: 'canva', figma: 'figma', notion: 'notion',
    x: 'x', twitter: 'x', tweet: 'x', tweets: 'x',
    slack: 'slack', whatsapp: 'whatsapp', wa: 'whatsapp', telegram: 'telegram', discord: 'discord',
    teams: 'teams', outlook: 'outlook', hotmail: 'outlook', onedrive: 'onedrive', sharepoint: 'onedrive',
    dropbox: 'dropbox', wetransfer: 'wetransfer', icloud: 'icloud', github: 'github', gitlab: 'gitlab',
    youtube: 'youtube', reddit: 'reddit', linkedin: 'linkedin', facebook: 'facebook', messenger: 'facebook',
    instagram: 'instagram', insta: 'instagram', zoom: 'zoom', amazon: 'amazon',
    extension: 'extension', extensions: 'extension',
  };
  if (aliases[w]) return aliases[w];
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(w)) return sourceFromUrls(['https://' + w])?.id;
  return undefined;
}
