// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Saved sign-ins the AI can use without ever seeing them. The AI asks to type
// {{secret:work-email-password}}; Keeper puts the real value straight into the
// field, only on the sites the person allowed for it, and the value never
// appears in the conversation, the log or a screenshot description.

export interface SavedSecret {
  /** what the AI writes between the braces */
  name: string;
  /** the sites it may be filled on (example.com also covers sub.example.com) */
  sites: string[];
  /** keychain: stored by Keeper in the system keychain; op / bw: read from the person's password manager CLI */
  source: 'keychain' | 'op' | 'bw';
  /** for op/bw: the item reference, e.g. op://Private/Shop/password */
  ref?: string;
  /** shown in the list; never the value */
  note?: string;
}

const RE = /\{\{\s*secret\s*:\s*([a-z0-9._-]+)\s*\}\}/gi;

export function secretNames(text: string): string[] {
  return [...text.matchAll(RE)].map((m) => m[1].toLowerCase());
}

export function hasSecret(text: string): boolean {
  RE.lastIndex = 0;
  const r = RE.test(text);
  RE.lastIndex = 0;
  return r;
}

export function siteAllowed(s: SavedSecret, host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return s.sites.some((site) => {
    const x = site.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    return h === x || h.endsWith('.' + x);
  });
}

/**
 * Replaces placeholders with values for typing. Throws (without the value) when
 * a secret is unknown or not allowed on this site.
 */
export async function fillSecrets(text: string, host: string, saved: SavedSecret[], read: (s: SavedSecret) => Promise<string | undefined>): Promise<string> {
  let out = '';
  let last = 0;
  RE.lastIndex = 0;
  for (const m of text.matchAll(RE)) {
    const name = m[1].toLowerCase();
    const s = saved.find((x) => x.name.toLowerCase() === name);
    if (!s) throw new Error(`There is no saved secret called "${name}". Ask the person to add it in Agents → Saved sign-ins.`);
    if (!siteAllowed(s, host)) throw new Error(`The saved secret "${name}" may not be used on ${host || 'this page'}.`);
    const v = await read(s);
    if (v === undefined || v === '') throw new Error(`Keeper could not read the saved secret "${name}".`);
    out += text.slice(last, m.index) + v;
    last = (m.index ?? 0) + m[0].length;
  }
  return out + text.slice(last);
}

/** What is written to logs and shown to the AI: placeholders stay placeholders. */
export function describeTyping(text: string): string {
  return hasSecret(text) ? text.replace(RE, (_m, n: string) => `‹${n}›`) : text;
}

/** Last line of defence: never let a known secret value reach the model or a log. */
export function scrub(text: string, values: string[]): string {
  let t = text;
  for (const v of values) if (v && v.length >= 4) t = t.split(v).join('‹secret›');
  return t;
}

/** Arguments for the password-manager CLIs (values come back on stdout, never via the shell). */
export function cliRead(s: SavedSecret): { cmd: string; args: string[] } | undefined {
  if (s.source === 'op' && s.ref) return { cmd: 'op', args: ['read', '--no-newline', s.ref] };
  if (s.source === 'bw' && s.ref) {
    const [id, field = 'password'] = s.ref.split('#');
    return { cmd: 'bw', args: ['get', field === 'totp' ? 'totp' : field === 'username' ? 'username' : 'password', id] };
  }
  return undefined;
}
