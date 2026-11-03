// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Saved links and your own commands in Quick Search.
//
//   Saved link    a keyword and an address, with {query} where the typed words go:
//                 "map {query}" → https://www.openstreetmap.org/search?query={query}
//                 Typing "map berlin" opens it with "berlin" filled in.
//   Your command  a name, an optional keyword and a command line run by the
//                 system's shell; {query} is replaced by the typed words,
//                 quoted so they are only ever one argument. Keeper asks
//                 before running it unless you said not to for that one.

export interface QuickLink {
  id: string;
  /** what you type first ("map", "w") */
  keyword: string;
  /** its name in the list ("Map", "Encyclopedia") */
  name: string;
  /** http(s), mailto or keeper:// address; {query} is where the typed words go */
  url: string;
}

export interface UserCommand {
  id: string;
  name: string;
  /** what you type first; optional (the name is searched too) */
  keyword?: string;
  /** a command line for the system's shell; {query} is the typed words, quoted */
  command: string;
  /** ask before each run (on unless you turned it off for this command) */
  confirm: boolean;
  /** what happens with what it prints */
  output: 'none' | 'copy' | 'show';
}

export interface LauncherSettings {
  /** answers to sums as you type */
  calc: boolean;
  /** convert currencies with daily reference rates (downloads them; off until turned on) */
  currency: boolean;
  links: QuickLink[];
  commands: UserCommand[];
}

/** Starting links: ones that work without accounts and are easy to change. */
export function defaultLinks(): QuickLink[] {
  return [
    { id: 'map', keyword: 'map', name: 'Map', url: 'https://www.openstreetmap.org/search?query={query}' },
    { id: 'wiki', keyword: 'wiki', name: 'Encyclopedia', url: 'https://en.wikipedia.org/w/index.php?search={query}' },
    { id: 'web', keyword: 'web', name: 'Search the web', url: 'https://duckduckgo.com/?q={query}' },
  ];
}

export function defaultLauncher(): LauncherSettings {
  return { calc: true, currency: false, links: defaultLinks(), commands: [] };
}

const SAFE_SCHEME = /^(https?:|mailto:|keeper:)/i;

/** Is this an address a saved link may open? (web, mail and Keeper's own links only) */
export function linkAllowed(url: string): boolean {
  return SAFE_SCHEME.test(url.trim());
}

/** The address with the typed words in it (encoded); undefined when it is not allowed. */
export function buildLink(link: QuickLink, query: string): string | undefined {
  const url = link.url.trim();
  if (!linkAllowed(url)) return undefined;
  return url.replace(/\{query\}/g, encodeURIComponent(query.trim()));
}

/** "map berlin" → the link and "berlin"; also "map" alone. Keywords are matched whole, ignoring case. */
export function matchLinks(text: string, links: QuickLink[]): { link: QuickLink; query: string }[] {
  const t = text.trim();
  if (!t) return [];
  const [first, ...rest] = t.split(/\s+/);
  const out: { link: QuickLink; query: string }[] = [];
  for (const l of links) {
    if (!l.keyword?.trim() || !linkAllowed(l.url)) continue;
    if (l.keyword.trim().toLowerCase() === first.toLowerCase()) out.push({ link: l, query: rest.join(' ') });
  }
  return out;
}

/** Quotes one argument for the shell this system uses (sh or cmd/PowerShell on Windows). */
export function shellQuote(arg: string, platform: string): string {
  if (platform === 'win32') {
    // cmd.exe: double quotes, inner quotes doubled; % and ! can't be quoted, so they are dropped.
    return `"${arg.replace(/[%!]/g, '').replace(/"/g, '""')}"`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The command line to run, with {query} filled in safely. */
export function commandLine(cmd: UserCommand, query: string, platform: string): string {
  return cmd.command.replace(/\{query\}/g, shellQuote(query.trim(), platform));
}

/** Commands whose keyword is the first word typed ("tz berlin"), with the rest as the query. */
export function matchCommandKeywords(text: string, cmds: UserCommand[]): { cmd: UserCommand; query: string }[] {
  const [first, ...rest] = text.trim().split(/\s+/);
  if (!first) return [];
  return cmds.filter((c) => c.keyword?.trim() && c.keyword.trim().toLowerCase() === first.toLowerCase()).map((cmd) => ({ cmd, query: rest.join(' ') }));
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** Saved settings with anything malformed dropped and defaults filled in. */
export function normalizeLauncher(raw: unknown): LauncherSettings {
  const d = defaultLauncher();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<LauncherSettings>;
  const links = Array.isArray(r.links)
    ? r.links.filter((l) => l && typeof l.keyword === 'string' && typeof l.url === 'string' && l.keyword.trim() && l.url.trim()).map((l) => ({ id: typeof l.id === 'string' && l.id ? l.id : newId(), keyword: l.keyword.trim().slice(0, 40), name: (typeof l.name === 'string' && l.name.trim() ? l.name : l.keyword).trim().slice(0, 80), url: l.url.trim().slice(0, 2000) }))
    : d.links;
  const commands = Array.isArray(r.commands)
    ? r.commands.filter((c) => c && typeof c.name === 'string' && typeof c.command === 'string' && c.name.trim() && c.command.trim()).map((c) => ({
      id: typeof c.id === 'string' && c.id ? c.id : newId(),
      name: c.name.trim().slice(0, 80),
      keyword: typeof c.keyword === 'string' && c.keyword.trim() ? c.keyword.trim().slice(0, 40) : undefined,
      command: c.command.slice(0, 4000),
      confirm: c.confirm !== false,
      output: c.output === 'copy' || c.output === 'show' ? c.output : 'none',
    }) as UserCommand)
    : [];
  return { calc: r.calc !== false, currency: r.currency === true, links, commands };
}

const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
const CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CN: 'CNY', IN: 'INR', KR: 'KRW', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', TR: 'TRY', IL: 'ILS', ZA: 'ZAR', BR: 'BRL', MX: 'MXN', SG: 'SGD', HK: 'HKD', TH: 'THB',
  ID: 'IDR', MY: 'MYR', PH: 'PHP', IS: 'ISK',
};

/** The currency of the person's region (en-GB → GBP, de-DE → EUR); USD when unknown. */
export function homeCurrency(locale: string): string {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  if (!region) return 'USD';
  if (EURO.includes(region)) return 'EUR';
  return CURRENCY[region] ?? 'USD';
}
