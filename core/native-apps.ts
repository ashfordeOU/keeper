// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Handing things off to the apps the person already has: a place opens in
// Apple Maps on a Mac (or Google Maps when they use it), a forecast in
// Weather, a device in Find My, an event in Calendar, an address in Mail.
//
// This file is pure: for each kind it lists the candidate apps on each
// system in preference order, how to tell whether one is there, and how to
// build the link or command that opens it. The main process does the
// looking (electron/services/native-apps.ts) and passes what it found back
// in, so every rule here can be tested on any computer.
//
// Only schemes and bundle ids that are documented or long established are
// used. Where one is less certain it says so, and every kind that can ends
// with a web page that always works, which is what Keeper falls back to when
// an app does not answer.

export type NativeOs = 'darwin' | 'win32' | 'linux';

export const NATIVE_KINDS = ['maps', 'weather', 'findMy', 'calendar', 'mail', 'contacts', 'messages', 'call', 'notes', 'reminders', 'music', 'photos', 'settings', 'clock'] as const;
export type NativeKind = (typeof NATIVE_KINDS)[number];

export const KIND_LABEL: Record<NativeKind, string> = {
  maps: 'Maps', weather: 'Weather', findMy: 'Find My', calendar: 'Calendar', mail: 'Email', contacts: 'Contacts', messages: 'Messages',
  call: 'Calls', notes: 'Notes', reminders: 'Reminders', music: 'Music', photos: 'Photos', settings: 'System settings', clock: 'Clock',
};

export type TravelMode = 'driving' | 'walking' | 'transit' | 'cycling';

/** What to show. Each kind reads only the fields it understands. */
export interface NativeParams {
  /** maps, weather */
  lat?: number;
  lon?: number;
  /** a name for the pin ("Home", "Lisbon") */
  label?: string;
  /** a street address, when there are no coordinates */
  address?: string;
  /** maps: directions to the place instead of showing it */
  directions?: boolean;
  travel?: TravelMode;
  /** calendar: the day to show (ms) */
  date?: number;
  /** calendar: the event's own link, when it came from the system calendar (ical://…, outlookcal:) or a web calendar */
  eventUrl?: string;
  /** mail, messages, call: an email address or phone number */
  to?: string;
  subject?: string;
  body?: string;
  /** call: a video call rather than audio */
  video?: boolean;
  /** music: something to search for */
  query?: string;
  /** settings: the page on each system (x-apple.systempreferences:…, ms-settings:…, a gnome-control-center panel) */
  page?: Partial<Record<NativeOs, string>>;
}

/** How to tell an app is on this computer. */
export type Detect =
  /** always there (the web, or an app every supported version of the system ships) */
  | { always: true }
  /** any of these exists; `~`, `%APPDATA%` and `%PROGRAMDATA%` are expanded by the caller */
  | { paths: string[] }
  /** something answers links of this scheme ("bingmaps", "geo") */
  | { scheme: string }
  /** a Linux app by its .desktop id, launched with gtk-launch */
  | { desktop: string }
  /** a Linux web app a browser installed, found by the Name= in its .desktop file */
  | { desktopName: string }
  /** a program on the PATH */
  | { bin: string };

/** How to open it: a link for the system to hand to its app, or a short-lived launcher command. */
export type Launch =
  | { how: 'url'; url: string }
  /** a launcher that exits once the app is open (open, gtk-launch); success is exit code 0 */
  | { how: 'exec'; file: string; args: string[] }
  /** a program that keeps running (gnome-control-center); success is that it started */
  | { how: 'spawn'; file: string; args: string[] };

export interface NativeCandidate {
  id: string;
  name: string;
  /** a web page rather than an app; always available */
  web?: boolean;
  detect: Detect;
  /** null when this app cannot show what was asked (e.g. directions in an app that only shows places) */
  build(p: NativeParams, found: string): Launch | null;
}

/** What detection found, by candidate id: the matching path, desktop id or app name. */
export type Installed = Record<string, string>;

// ------------------------------------------------------------------ helpers

const enc = encodeURIComponent;
const url = (u: string): Launch => ({ how: 'url', url: u });
const openBundle = (bundle: string): Launch => ({ how: 'exec', file: 'open', args: ['-b', bundle] });
const gtkLaunch = (id: string): Launch => ({ how: 'exec', file: 'gtk-launch', args: [id] });
const coords = (p: NativeParams) => (p.lat !== undefined && p.lon !== undefined ? `${round(p.lat)},${round(p.lon)}` : '');
const round = (n: number) => String(Math.round(n * 1e6) / 1e6);
/** where a place is: coordinates when known, else the address or name */
const where = (p: NativeParams) => coords(p) || p.address || p.label || '';
const mailAddr = (s: string) => enc(s).replace(/%40/g, '@').replace(/%2C/gi, ',');
const isEmail = (s: string) => /@/.test(s);
const phone = (s: string) => s.replace(/[^\d+*#,;]/g, '');
const ymd = (t: number) => { const d = new Date(t); return [d.getFullYear(), d.getMonth() + 1, d.getDate()] as const; };

/** A built-in app on a Mac, opened by bundle id. */
const macApp = (id: string, name: string, app: string, bundle: string): NativeCandidate => ({
  id, name, detect: { paths: [`/System/Applications/${app}.app`, `/Applications/${app}.app`] }, build: () => openBundle(bundle),
});
/** A Linux app by .desktop id. */
const linuxApp = (id: string, name: string, desktop: string): NativeCandidate => ({ id, name, detect: { desktop }, build: () => gtkLaunch(desktop) });
const web = (name: string, build: (p: NativeParams) => string | null, id = 'web'): NativeCandidate => ({
  id, name, web: true, detect: { always: true }, build: (p) => { const u = build(p); return u ? url(u) : null; },
});

// ------------------------------------------------------------------ maps

const googleMapsUrl = (p: NativeParams): string | null => {
  const w = where(p);
  if (!w) return null;
  if (p.directions) {
    const mode = p.travel === 'cycling' ? 'bicycling' : p.travel;
    return `https://www.google.com/maps/dir/?api=1&destination=${enc(w)}${mode ? `&travelmode=${mode}` : ''}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${enc(w)}`;
};

/** Apple Maps links (https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/MapLinks/MapLinks.html). */
export function appleMapsUrl(p: NativeParams, base = 'maps://'): string | null {
  const w = where(p);
  if (!w) return null;
  if (p.directions) {
    // dirflg: d driving, w walking, r transit. Apple documents no cycling flag, so cycling asks for the default.
    const flag = p.travel === 'driving' ? 'd' : p.travel === 'walking' ? 'w' : p.travel === 'transit' ? 'r' : '';
    return `${base}?daddr=${enc(w)}${flag ? `&dirflg=${flag}` : ''}`;
  }
  const c = coords(p);
  if (c) return `${base}?q=${enc(p.label || p.address || c)}&ll=${c}`;
  return `${base}?q=${enc(w)}`;
}

/** Windows Maps links (https://learn.microsoft.com/windows/apps/develop/launch/launch-maps-app). Windows Maps is being retired; when nothing answers bingmaps: Keeper uses the web. */
export function bingMapsUrl(p: NativeParams): string | null {
  const name = (p.label || p.address || '').replace(/[_~]/g, ' ');
  if (p.lat !== undefined && p.lon !== undefined) {
    const lat = round(p.lat), lon = round(p.lon);
    if (p.directions) return `bingmaps:?rtp=~pos.${lat}_${lon}${name ? `_${enc(name)}` : ''}${p.travel === 'walking' ? '&mode=w' : p.travel === 'transit' ? '&mode=t' : '&mode=d'}`;
    return `bingmaps:?cp=${lat}~${lon}&lvl=16&collection=point.${lat}_${lon}${name ? `_${enc(name)}` : ''}`;
  }
  if (!p.address) return null;
  return p.directions ? `bingmaps:?rtp=~adr.${enc(p.address)}` : `bingmaps:?where=${enc(p.address)}`;
}

/** geo: links (RFC 5870) for whatever map app Linux has; GNOME Maps and KDE Marble answer them. They have no directions. */
export function geoUrl(p: NativeParams): string | null {
  if (p.directions || p.lat === undefined || p.lon === undefined) return null;
  const c = coords(p);
  const label = (p.label || p.address || '').replace(/[()]/g, '');
  return `geo:${c}${label ? `?q=${c}(${enc(label)})` : ''}`;
}

const osmUrl = (p: NativeParams): string | null => {
  if (p.directions) return null;
  if (p.lat !== undefined && p.lon !== undefined) return `https://www.openstreetmap.org/?mlat=${round(p.lat)}&mlon=${round(p.lon)}#map=16/${round(p.lat)}/${round(p.lon)}`;
  return p.address || p.label ? `https://www.openstreetmap.org/search?query=${enc(p.address || p.label!)}` : null;
};

/**
 * Google Maps installed as an app: a Chrome, Edge or Safari web app on a Mac,
 * a Start menu shortcut on Windows, a browser web app on Linux. On a Mac the
 * place is handed to the app itself; elsewhere the link goes to the default
 * browser, which opens it in the installed app when it captures links.
 */
const googleMapsApp: NativeCandidate = {
  id: 'googleMaps', name: 'Google Maps',
  // Detection depends on the system, so this placeholder is replaced per system below.
  detect: { always: true },
  build(p, found) {
    const u = googleMapsUrl(p);
    if (!u) return null;
    return found.endsWith('.app') ? { how: 'exec', file: 'open', args: ['-a', found, u] } : url(u);
  },
};

const MAC_PWA = (name: string) => [
  `~/Applications/Chrome Apps.localized/${name}.app`, `~/Applications/Chrome Apps/${name}.app`,
  `~/Applications/Edge Apps.localized/${name}.app`, `~/Applications/Edge Apps/${name}.app`,
  // Safari's "Add to Dock" web apps, and apps dragged to Applications.
  `~/Applications/${name}.app`, `/Applications/${name}.app`,
];
const WIN_PWA = (name: string) => [
  `%APPDATA%/Microsoft/Windows/Start Menu/Programs/Chrome Apps/${name}.lnk`,
  `%APPDATA%/Microsoft/Windows/Start Menu/Programs/${name}.lnk`,
  `%PROGRAMDATA%/Microsoft/Windows/Start Menu/Programs/${name}.lnk`,
];
const pwa = (c: NativeCandidate, os: NativeOs, name: string): NativeCandidate => ({
  ...c, detect: os === 'darwin' ? { paths: MAC_PWA(name) } : os === 'win32' ? { paths: WIN_PWA(name) } : { desktopName: name },
});

// ------------------------------------------------------------------ the registry

const webMaps = web('Google Maps on the web', googleMapsUrl);
const osm = web('OpenStreetMap', osmUrl, 'osm');

const weatherWeb = web('Weather.com', (p) => (coords(p) ? `https://weather.com/weather/today/l/${coords(p)}` : 'https://weather.com/'));

const calendarWeb = web('Google Calendar', (p) => {
  if (p.eventUrl && /^https:\/\/calendar\.google\.com\//.test(p.eventUrl)) return p.eventUrl;
  if (p.date === undefined) return 'https://calendar.google.com/';
  const [y, m, d] = ymd(p.date);
  return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}`;
});

const mailto = (p: NativeParams) => {
  const q = [p.subject ? `subject=${enc(p.subject)}` : '', p.body ? `body=${enc(p.body)}` : ''].filter(Boolean).join('&');
  return `mailto:${p.to ? mailAddr(p.to) : ''}${q ? `?${q}` : ''}`;
};
const systemMail = (detect: Detect): NativeCandidate => ({ id: 'system', name: 'Your email app', detect, build: (p) => url(mailto(p)) });
const gmail = web('Gmail', (p) => `https://mail.google.com/mail/?view=cm&fs=1${p.to ? `&to=${enc(p.to)}` : ''}${p.subject ? `&su=${enc(p.subject)}` : ''}${p.body ? `&body=${enc(p.body)}` : ''}`, 'gmail');
const outlookWeb = web('Outlook on the web', (p) => `https://outlook.live.com/mail/0/deeplink/compose?${[p.to ? `to=${enc(p.to)}` : '', p.subject ? `subject=${enc(p.subject)}` : '', p.body ? `body=${enc(p.body)}` : ''].filter(Boolean).join('&')}`, 'outlook');

/** A scheme the system hands to whatever app registered it (sms:, tel:). */
const schemeApp = (id: string, name: string, scheme: string, build: (p: NativeParams) => string | null): NativeCandidate => ({
  id, name, detect: { scheme }, build: (p) => { const u = build(p); return u ? url(u) : null; },
});

const spotify = schemeApp('spotify', 'Spotify', 'spotify', (p) => (p.query ? `spotify:search:${enc(p.query)}` : 'spotify:'));

type Registry = Record<NativeKind, NativeCandidate[]>;

const MAC: Registry = {
  maps: [pwa(googleMapsApp, 'darwin', 'Google Maps'), { id: 'appleMaps', name: 'Apple Maps', detect: { paths: ['/System/Applications/Maps.app', '/Applications/Maps.app'] }, build: (p) => { const u = appleMapsUrl(p); return u ? url(u) : null; } }, webMaps, osm],
  weather: [macApp('appleWeather', 'Weather', 'Weather', 'com.apple.weather'), weatherWeb],
  findMy: [macApp('findMy', 'Find My', 'FindMy', 'com.apple.findmy'), web('iCloud Find My', () => 'https://www.icloud.com/find')],
  calendar: [
    // ical://ekevent/… opens one event (see core/pim/syscal.ts); for a day, Calendar opens on today since it takes no date in a link.
    { id: 'appleCalendar', name: 'Calendar', detect: { paths: ['/System/Applications/Calendar.app', '/Applications/Calendar.app'] }, build: (p) => (p.eventUrl?.startsWith('ical://') ? url(p.eventUrl) : openBundle('com.apple.iCal')) },
    calendarWeb,
  ],
  mail: [systemMail({ always: true }), gmail, outlookWeb],
  contacts: [macApp('appleContacts', 'Contacts', 'Contacts', 'com.apple.AddressBook'), web('iCloud Contacts', () => 'https://www.icloud.com/contacts')],
  messages: [
    { id: 'appleMessages', name: 'Messages', detect: { paths: ['/System/Applications/Messages.app'] }, build: (p) => (p.to ? url(isEmail(p.to) ? `imessage:${mailAddr(p.to)}` : `sms:${phone(p.to)}`) : openBundle('com.apple.MobileSMS')) },
  ],
  call: [
    // FaceTime answers facetime:, facetime-audio: and tel: (calls go through a nearby iPhone).
    { id: 'faceTime', name: 'FaceTime', detect: { paths: ['/System/Applications/FaceTime.app'] }, build: (p) => (p.to ? url(`${p.video ? 'facetime' : isEmail(p.to) ? 'facetime-audio' : 'tel'}:${isEmail(p.to) ? mailAddr(p.to) : phone(p.to)}`) : openBundle('com.apple.FaceTime')) },
  ],
  notes: [macApp('appleNotes', 'Notes', 'Notes', 'com.apple.Notes'), web('iCloud Notes', () => 'https://www.icloud.com/notes')],
  reminders: [macApp('appleReminders', 'Reminders', 'Reminders', 'com.apple.reminders'), web('iCloud Reminders', () => 'https://www.icloud.com/reminders')],
  music: [macApp('appleMusic', 'Music', 'Music', 'com.apple.Music'), spotify, web('Apple Music on the web', (p) => (p.query ? `https://music.apple.com/search?term=${enc(p.query)}` : 'https://music.apple.com/'))],
  photos: [macApp('applePhotos', 'Photos', 'Photos', 'com.apple.Photos'), web('iCloud Photos', () => 'https://www.icloud.com/photos')],
  settings: [{ id: 'system', name: 'System Settings', detect: { always: true }, build: (p) => (p.page?.darwin?.startsWith('x-apple.systempreferences:') ? url(p.page.darwin) : url('x-apple.systempreferences:')) }],
  // Clock came to the Mac with macOS 13; on older systems nothing is found and the web page is used.
  clock: [macApp('appleClock', 'Clock', 'Clock', 'com.apple.clock'), web('Time.is', () => 'https://time.is/')],
};

const WIN: Registry = {
  maps: [pwa(googleMapsApp, 'win32', 'Google Maps'), { id: 'windowsMaps', name: 'Windows Maps', detect: { scheme: 'bingmaps' }, build: (p) => { const u = bingMapsUrl(p); return u ? url(u) : null; } }, webMaps, osm],
  // msnweather:// is documented for the MSN Weather app (https://learn.microsoft.com/windows/apps/develop/launch/launch-default-app).
  weather: [schemeApp('msnWeather', 'MSN Weather', 'msnweather', (p) => (coords(p) ? `msnweather://forecast?la=${round(p.lat!)}&lo=${round(p.lon!)}` : 'msnweather://')), weatherWeb],
  findMy: [web('iCloud Find My', () => 'https://www.icloud.com/find')],
  calendar: [
    // outlookcal: opens the calendar of the new Outlook (Windows' Calendar app was retired in 2024).
    schemeApp('outlook', 'Outlook', 'outlookcal', () => 'outlookcal:'),
    calendarWeb,
  ],
  mail: [systemMail({ always: true }), gmail, outlookWeb],
  contacts: [schemeApp('people', 'People', 'ms-people', () => 'ms-people:'), web('Google Contacts', () => 'https://contacts.google.com/')],
  messages: [
    // Phone Link answers sms: when it is set up with a phone; otherwise the web.
    schemeApp('system', 'Phone Link', 'sms', (p) => (p.to && !isEmail(p.to) ? `sms:${phone(p.to)}` : null)),
    web('Google Messages', () => 'https://messages.google.com/web/'),
  ],
  call: [schemeApp('system', 'Phone Link', 'tel', (p) => (p.to && !isEmail(p.to) ? `tel:${phone(p.to)}` : null))],
  notes: [web('OneNote on the web', () => 'https://www.onenote.com/notebooks')],
  reminders: [web('Microsoft To Do', () => 'https://to-do.office.com/tasks/')],
  music: [spotify, web('Spotify on the web', (p) => (p.query ? `https://open.spotify.com/search/${enc(p.query)}` : 'https://open.spotify.com/'))],
  photos: [schemeApp('windowsPhotos', 'Photos', 'ms-photos', () => 'ms-photos:'), web('Google Photos', () => 'https://photos.google.com/')],
  settings: [{ id: 'system', name: 'Settings', detect: { always: true }, build: (p) => url(p.page?.win32?.startsWith('ms-settings:') ? p.page.win32 : 'ms-settings:') }],
  clock: [schemeApp('windowsClock', 'Clock', 'ms-clock', () => 'ms-clock:'), web('Time.is', () => 'https://time.is/')],
};

const LINUX: Registry = {
  maps: [pwa(googleMapsApp, 'linux', 'Google Maps'), { id: 'geo', name: 'Your maps app', detect: { scheme: 'geo' }, build: (p) => { const u = geoUrl(p); return u ? url(u) : null; } }, webMaps, osm],
  // GNOME Weather takes no place in a link; it opens on the places it knows.
  weather: [linuxApp('gnomeWeather', 'GNOME Weather', 'org.gnome.Weather'), weatherWeb],
  findMy: [web('iCloud Find My', () => 'https://www.icloud.com/find')],
  calendar: [linuxApp('gnomeCalendar', 'GNOME Calendar', 'org.gnome.Calendar'), linuxApp('korganizer', 'KOrganizer', 'org.kde.korganizer'), calendarWeb],
  mail: [systemMail({ scheme: 'mailto' }), gmail, outlookWeb],
  contacts: [linuxApp('gnomeContacts', 'GNOME Contacts', 'org.gnome.Contacts'), web('Google Contacts', () => 'https://contacts.google.com/')],
  messages: [schemeApp('system', 'Your messaging app', 'sms', (p) => (p.to && !isEmail(p.to) ? `sms:${phone(p.to)}` : null)), web('Google Messages', () => 'https://messages.google.com/web/')],
  call: [schemeApp('system', 'Your phone app', 'tel', (p) => (p.to && !isEmail(p.to) ? `tel:${phone(p.to)}` : null))],
  notes: [web('Google Keep', () => 'https://keep.google.com/')],
  reminders: [web('Microsoft To Do', () => 'https://to-do.office.com/tasks/')],
  music: [spotify, web('Spotify on the web', (p) => (p.query ? `https://open.spotify.com/search/${enc(p.query)}` : 'https://open.spotify.com/'))],
  photos: [web('Google Photos', () => 'https://photos.google.com/')],
  settings: [{ id: 'system', name: 'Settings', detect: { bin: 'gnome-control-center' }, build: (p) => ({ how: 'spawn', file: 'gnome-control-center', args: p.page?.linux && /^[\w-]+$/.test(p.page.linux) ? [p.page.linux] : [] }) }],
  clock: [linuxApp('gnomeClocks', 'GNOME Clocks', 'org.gnome.clocks'), web('Time.is', () => 'https://time.is/')],
};

const REGISTRY: Record<NativeOs, Registry> = { darwin: MAC, win32: WIN, linux: LINUX };

/** The candidates for a kind on a system, most preferred first. */
export function nativeCandidates(kind: NativeKind, os: NativeOs): NativeCandidate[] {
  return REGISTRY[os]?.[kind] ?? [];
}

const available = (c: NativeCandidate, installed: Installed) => c.web || 'always' in c.detect || installed[c.id] !== undefined;

export interface NativePlan {
  /** what to try, in order: the chosen app first, then the others that can show it */
  tries: { id: string; name: string; launch: Launch }[];
}

/**
 * What opens `params` for `kind`: the person's choice when it is there and can
 * show it, otherwise the first available candidate in preference order. The
 * rest follow, so the main process can fall through when an app does not
 * answer. Automatic prefers a third-party app over the system one only where
 * the registry lists it first (Google Maps, when it is installed).
 */
export function planNative(kind: NativeKind, os: NativeOs, installed: Installed, pref: string | undefined, params: NativeParams): NativePlan {
  const list = nativeCandidates(kind, os).filter((c) => available(c, installed));
  const chosen = pref && pref !== 'auto' ? list.find((c) => c.id === pref) : undefined;
  const order = chosen ? [chosen, ...list.filter((c) => c !== chosen)] : list;
  const tries: NativePlan['tries'] = [];
  for (const c of order) {
    const launch = c.build(params, installed[c.id] ?? '');
    if (launch) tries.push({ id: c.id, name: displayName(c, installed), launch });
  }
  return { tries };
}

export interface NativeChoice { id: string; name: string; web?: boolean }

/** The choices Settings offers for a kind: each app found and each web page. "Automatic" is added by the interface. */
export function nativeChoices(kind: NativeKind, os: NativeOs, installed: Installed): NativeChoice[] {
  return nativeCandidates(kind, os).filter((c) => available(c, installed)).map((c) => ({ id: c.id, name: displayName(c, installed), ...(c.web ? { web: true } : {}) }));
}

/** The name of what Automatic opens for a kind. */
export function autoChoice(kind: NativeKind, os: NativeOs, installed: Installed): string | undefined {
  const c = nativeCandidates(kind, os).find((x) => available(x, installed));
  return c && displayName(c, installed);
}

/** "Your phone app" becomes the app's own name when the system told us which one answers the scheme. */
function displayName(c: NativeCandidate, installed: Installed): string {
  const found = installed[c.id];
  return c.id === 'system' && 'scheme' in c.detect && found && !/[\\/]/.test(found) ? found : c.name;
}

// ------------------------------------------------------------------ input from the interface

const text = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : undefined);
const inRange = (v: unknown, lim: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? v : undefined);

/** Keeps only well-formed fields, so nothing the interface sends can turn into a different link or command. */
export function cleanParams(raw: unknown): NativeParams {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p: NativeParams = {};
  const lat = inRange(r.lat, 90), lon = inRange(r.lon, 180);
  if (lat !== undefined && lon !== undefined) { p.lat = lat; p.lon = lon; }
  const label = text(r.label, 200), address = text(r.address), to = text(r.to, 320), subject = text(r.subject, 500), query = text(r.query, 200);
  if (label) p.label = label;
  if (address) p.address = address;
  if (to) p.to = to;
  if (subject) p.subject = subject;
  if (typeof r.body === 'string' && r.body) p.body = r.body.slice(0, 4000);
  if (query) p.query = query;
  if (r.directions === true) p.directions = true;
  if (r.video === true) p.video = true;
  if (r.travel === 'driving' || r.travel === 'walking' || r.travel === 'transit' || r.travel === 'cycling') p.travel = r.travel;
  if (typeof r.date === 'number' && Number.isFinite(r.date)) p.date = r.date;
  // Only links that open a calendar: the Mac's own event links, Outlook's, and web calendars.
  if (typeof r.eventUrl === 'string' && /^(ical:\/\/|outlookcal:|https:\/\/)/.test(r.eventUrl) && r.eventUrl.length < 2000 && !/\s/.test(r.eventUrl)) p.eventUrl = r.eventUrl;
  if (r.page && typeof r.page === 'object') {
    const pg = r.page as Record<string, unknown>;
    const page: NativeParams['page'] = {};
    if (typeof pg.darwin === 'string' && /^x-apple\.systempreferences:[\w.\-?=&%]*$/.test(pg.darwin)) page.darwin = pg.darwin;
    if (typeof pg.win32 === 'string' && /^ms-settings:[\w.\-?=&%]*$/.test(pg.win32)) page.win32 = pg.win32;
    if (typeof pg.linux === 'string' && /^[\w-]+$/.test(pg.linux)) page.linux = pg.linux;
    p.page = page;
  }
  return p;
}

export const isNativeKind = (k: unknown): k is NativeKind => typeof k === 'string' && (NATIVE_KINDS as readonly string[]).includes(k);

/** The settings value: Automatic unless a choice was made. */
export type NativeAppPrefs = Partial<Record<NativeKind, string>>;

export interface NativeKindInfo {
  kind: NativeKind;
  label: string;
  choices: NativeChoice[];
  /** what Automatic opens */
  auto?: string;
  /** the saved choice ('auto' when none) */
  pick: string;
}

export interface NativeAppsApi {
  /** opens `params` in the app chosen for `kind`; `copy` is set when nothing could (a phone number with no phone app) */
  open(kind: NativeKind, params: NativeParams): Promise<{ ok: boolean; app?: string; copy?: string }>;
  /** what each kind can open with on this computer; `refresh` looks for apps again */
  apps(refresh?: boolean): Promise<NativeKindInfo[]>;
}
