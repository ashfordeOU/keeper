// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Calls in the Island: which app is in a call (a call app or a browser call
// holding the microphone), for how long, and how to mute it — through the
// system (always works) or the app's own shortcut. Pure; the main process
// feeds it the apps using the microphone and the window titles.

export interface CallApp {
  id: string;
  name: string;
  /** lower-case pieces of process / app names that mean this app */
  match: string[];
  /** browser tab or window title patterns (web versions) */
  titles?: RegExp[];
  /** the app's own mute toggle, when it has one */
  muteKey?: { mac: string; other: string };
  video?: boolean;
}

export const CALL_APPS: CallApp[] = [
  { id: 'zoom', name: 'Zoom', match: ['zoom.us', 'zoom', 'cpthost', 'zoomwebviewhost'], titles: [/zoom meeting/i, /\| zoom$/i], muteKey: { mac: 'Command+Shift+A', other: 'Alt+A' }, video: true },
  { id: 'teams', name: 'Microsoft Teams', match: ['teams', 'ms-teams', 'msteams'], titles: [/\| microsoft teams/i, /meeting .*\| teams/i], muteKey: { mac: 'Command+Shift+M', other: 'Control+Shift+M' }, video: true },
  { id: 'meet', name: 'Google Meet', match: [], titles: [/^meet\s*[-–]\s*[a-z]{3}-[a-z]{4}-[a-z]{3}/i, /google meet/i, /meet\.google\.com/i], muteKey: { mac: 'Command+D', other: 'Control+D' }, video: true },
  { id: 'facetime', name: 'FaceTime', match: ['facetime', 'avconferenced'], video: true },
  { id: 'slack', name: 'Slack huddle', match: ['slack'], titles: [/huddle/i], muteKey: { mac: 'Command+Shift+Space', other: 'Control+Shift+Space' } },
  { id: 'discord', name: 'Discord', match: ['discord'], muteKey: { mac: 'Command+Shift+M', other: 'Control+Shift+M' } },
  { id: 'webex', name: 'Webex', match: ['webex', 'ciscowebex', 'atmgr'], titles: [/webex/i], muteKey: { mac: 'Control+M', other: 'Control+M' }, video: true },
  { id: 'skype', name: 'Skype', match: ['skype'], muteKey: { mac: 'Command+Shift+M', other: 'Control+M' }, video: true },
  { id: 'whatsapp', name: 'WhatsApp', match: ['whatsapp'], video: true },
  { id: 'signal', name: 'Signal', match: ['signal'], video: true },
  { id: 'telegram', name: 'Telegram', match: ['telegram'], video: true },
  { id: 'gotomeeting', name: 'GoTo Meeting', match: ['gotomeeting', 'g2mcomm', 'goto'], titles: [/goto meeting/i] },
  { id: 'jitsi', name: 'Jitsi Meet', match: ['jitsi'], titles: [/jitsi meet/i, /meet\.jit\.si/i], muteKey: { mac: 'M', other: 'M' }, video: true },
  { id: 'whereby', name: 'Whereby', match: ['whereby'], titles: [/whereby/i], video: true },
  { id: 'element', name: 'Element', match: ['element'], titles: [/element call/i] },
  { id: 'mumble', name: 'Mumble', match: ['mumble'] },
];

const BROWSERS = ['chrome', 'chromium', 'firefox', 'msedge', 'edge', 'safari', 'brave', 'vivaldi', 'opera', 'arc', 'webkit', 'com.apple.webkit', 'zen', 'librewolf'];

export function isBrowser(name: string): boolean {
  const n = name.toLowerCase();
  return BROWSERS.some((b) => n.includes(b));
}

export function callAppFor(name: string): CallApp | undefined {
  const n = name.toLowerCase().replace(/\.(app|exe)$/, '');
  return CALL_APPS.find((a) => a.match.some((m) => n === m || n.includes(m)));
}

export function callAppForTitle(title: string): CallApp | undefined {
  return CALL_APPS.find((a) => a.titles?.some((re) => re.test(title)));
}

export interface CallState {
  /** what is in the call ("Zoom", "Google Meet in Chrome") */
  app: string;
  id: string;
  since: number;
  /** the mic is muted (system or app) as far as Keeper knows */
  muted: boolean;
  video: boolean;
  /** how mute works for this call */
  mute: 'system' | 'app' | 'both';
  /** the microphone owner as the system reports it */
  owner: string;
}

/**
 * Is there a call? An app using the microphone that is a call app, or a
 * browser using it while a window or tab title says call. Keeps the start
 * time of a call that goes on.
 */
export function detectCall(o: { micApps: string[]; titles?: string[]; prev?: CallState; now?: number; camApps?: string[] }): CallState | undefined {
  const now = o.now ?? Date.now();
  const titles = o.titles ?? [];
  for (const owner of o.micApps) {
    let app = callAppFor(owner);
    let label = app?.name;
    if (!app && isBrowser(owner)) {
      for (const t of titles) {
        const w = callAppForTitle(t);
        if (w) { app = w; label = `${w.name} in ${prettyBrowser(owner)}`; break; }
      }
      // A browser on the microphone without a known title is still very likely a call.
      if (!app) { label = `A call in ${prettyBrowser(owner)}`; }
    }
    if (!label) continue;
    const id = app?.id ?? `browser:${owner.toLowerCase()}`;
    const same = o.prev && o.prev.id === id;
    return {
      app: label, id, owner, since: same ? o.prev!.since : now, muted: same ? o.prev!.muted : false,
      video: !!(o.camApps?.length) || (same ? o.prev!.video : false), mute: app?.muteKey ? 'both' : 'system',
    };
  }
  return undefined;
}

function prettyBrowser(owner: string): string {
  const n = owner.toLowerCase();
  if (n.includes('edge')) return 'Edge';
  if (n.includes('firefox')) return 'Firefox';
  if (n.includes('safari') || n.includes('webkit')) return 'Safari';
  if (n.includes('brave')) return 'Brave';
  if (n.includes('vivaldi')) return 'Vivaldi';
  if (n.includes('opera')) return 'Opera';
  if (n.includes('arc')) return 'Arc';
  return 'Chrome';
}

/** "12:04" or "1:02:03". */
export function callTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Windows: when each app started using the microphone, from `reg query … /s`
 * over CapabilityAccessManager\ConsentStore\microphone (LastUsedTimeStart is a
 * FILETIME; LastUsedTimeStop 0 means it is still open).
 */
export function parseRegMicStarts(text: string): { app: string; since: number }[] {
  const out: { app: string; since: number }[] = [];
  let key = '';
  let start: bigint | undefined;
  let stop: bigint | undefined;
  const flush = () => {
    if (key && start !== undefined && stop === 0n) {
      const leaf = key.split('\\').pop() ?? '';
      if (leaf && !/^(NonPackaged|microphone)$/i.test(leaf)) {
        const app = leaf.includes('#') ? leaf.split('#').pop()!.replace(/\.exe$/i, '') : leaf.replace(/_[a-z0-9]{13}$/i, '').split('.').pop()!;
        // FILETIME: 100 ns since 1601.
        const since = Number(start / 10_000n - 11_644_473_600_000n);
        if (app && Number.isFinite(since) && since > 0) out.push({ app, since });
      }
    }
    start = stop = undefined;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^HKEY_/i.test(line)) { flush(); key = line; continue; }
    const m = line.match(/^LastUsedTime(Start|Stop)\s+REG_QWORD\s+0x([0-9a-f]+)$/i);
    if (!m) continue;
    const v = BigInt('0x' + m[2]);
    if (m[1].toLowerCase() === 'start') start = v; else stop = v;
  }
  flush();
  return out;
}

/** Linux: PulseAudio/PipeWire source outputs with their app names and whether each is corked (paused). */
export function parsePactlSourceOutputs(text: string): { app: string; binary?: string; muted: boolean }[] {
  const out: { app: string; binary?: string; muted: boolean }[] = [];
  for (const block of text.split(/\n(?=Source Output #)/)) {
    const app = block.match(/application\.name = "([^"]+)"/)?.[1];
    if (!app) continue;
    // Recorders of the speakers (visualisers, "what you hear") are not microphones.
    if (/stream\.capture\.sink = "true"|target\.object = "[^"]*\.monitor"/.test(block)) continue;
    out.push({ app, binary: block.match(/application\.process\.binary = "([^"]+)"/)?.[1], muted: /Mute: yes/.test(block) });
  }
  return out;
}
