// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Takes the owner's identity out of everything that goes into the bundle:
// the home folder becomes "~", and the user name, full name, computer names,
// serial numbers, hardware ids, MAC addresses and email addresses are replaced
// with placeholders. Pictures and video cannot be scrubbed; the summary before
// packing says so and lets the owner leave them out.

export interface Identity {
  user?: string;
  fullName?: string;
  home?: string;
  /** ComputerName, LocalHostName, HostName, `hostname` */
  hostnames?: string[];
  /** serial numbers (Mac, battery, displays) */
  serials?: string[];
  /** hardware UUID, provisioning UDID and other per-machine ids */
  ids?: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keys whose values identify the machine, in JSON ("k": "v"), ioreg ("k" = "v") and plist (<key>k</key><string>v</string>) forms. */
const ID_KEYS = 'serial_number|serialNumber|SerialNumber|IOPlatformSerialNumber|kIOPlatformSerialNumberKey|platform_UUID|provisioning_UDID|IOPlatformUUID|crashReporterKey|sleepWakeUUID|deviceIdentifier|BatterySerialNumber|spdisplays_display-serial-number|_spdisplays_display-serial-number|hardware_uuid|device_serial|machine_id';

const MAC_RE = /(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export interface Scrubber {
  text(s: string): string;
  /** a file name inside the bundle */
  name(s: string): string;
}

export function makeScrubber(id: Identity): Scrubber {
  const literal: [RegExp, string][] = [];
  const add = (v: string | undefined, to: string, opts: { min?: number; word?: boolean; ci?: boolean } = {}) => {
    const s = (v ?? '').trim();
    if (s.length < (opts.min ?? 3)) return;
    const body = esc(s);
    literal.push([new RegExp(opts.word ? `(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])` : body, opts.ci ? 'gi' : 'g'), to]);
  };
  // Longest first, so "Sam's MacBook Pro" goes before "Sam".
  const hosts = [...new Set((id.hostnames ?? []).flatMap((h) => [h, h.replace(/\.local\.?$/i, '')]).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const h of hosts) add(h, '<host>', { ci: true, min: 2 });
  for (const s of [...new Set(id.serials ?? [])].sort((a, b) => b.length - a.length)) add(s, '<serial>', { min: 4 });
  for (const s of [...new Set(id.ids ?? [])].sort((a, b) => b.length - a.length)) add(s, '<id>', { min: 6, ci: true });
  const home = (id.home ?? '').replace(/\/+$/, '');
  const user = id.user ?? (home ? home.split('/').pop() : undefined);

  const text = (input: string): string => {
    let s = input;
    if (home) {
      // the real path behind /Users, and the plain one
      s = s.replace(new RegExp(`(/private)?${esc(home)}(?=/|\\b|$)`, 'g'), '~');
    }
    if (user && user.length >= 1) s = s.replace(new RegExp(`/Users/${esc(user)}(?=/|\\b|$)`, 'g'), '~');
    for (const [re, to] of literal) s = s.replace(re, to);
    s = s.replace(new RegExp(`("(?:${ID_KEYS})"\\s*[:=]\\s*)"[^"]*"`, 'g'), '$1"<redacted>"');
    s = s.replace(new RegExp(`(<key>(?:${ID_KEYS})</key>\\s*<string>)[^<]*(</string>)`, 'g'), '$1<redacted>$2');
    s = s.replace(new RegExp(`((?:^|\\s)(?:Serial Number(?: \\(system\\))?|Hardware UUID|Provisioning UDID|Serial)\\s*:\\s*)\\S+`, 'gm'), '$1<redacted>');
    s = s.replace(MAC_RE, '<mac>');
    s = s.replace(EMAIL_RE, (m) => (/^(noreply|contact)@(anthropic|ashforde)\./i.test(m) ? m : '<email>'));
    // the user name and full name last: they may be part of what was replaced above
    const full = (id.fullName ?? '').trim();
    if (full.length >= 3) s = s.replace(new RegExp(esc(full), 'g'), '<name>');
    if (user && user.length >= 3) s = s.replace(new RegExp(`(?<![A-Za-z0-9_])${esc(user)}(?![A-Za-z0-9_])`, 'g'), '<user>');
    return s;
  };
  return {
    text,
    name: (n: string) => text(n).replace(/[<>]/g, '').replace(/~/g, 'home'),
  };
}

/** Files whose contents are text and get scrubbed. */
export const TEXT_EXT = /\.(json|md|log|txt|ips|crash|diag|plist|csv|html|sh|out|err|ndjson|spin|hang|xml|yml|yaml)$/i;
