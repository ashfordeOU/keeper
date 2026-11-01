// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turns rclone's own description of its storage providers into the list and
// the sign-in forms Keeper shows, so every provider rclone knows works
// without Keeper having to describe each one by hand.

export interface RcloneOptionExample {
  Value: string;
  Help?: string;
  Provider?: string;
}

export interface RcloneOption {
  Name: string;
  Help?: string;
  Provider?: string;
  Default?: unknown;
  DefaultStr?: string;
  Required?: boolean;
  IsPassword?: boolean;
  Advanced?: boolean;
  Exclusive?: boolean;
  Sensitive?: boolean;
  Hide?: number;
  Type?: string;
  Examples?: RcloneOptionExample[] | null;
}

export interface RcloneProvider {
  Name: string;
  Description?: string;
  Prefix: string;
  Options?: RcloneOption[] | null;
  Hide?: boolean;
}

export type ProviderCategory = 'drive' | 'photos' | 'object' | 'server' | 'other';

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  category: ProviderCategory;
  /** signs in through the browser */
  oauth: boolean;
  /** shown first in "Add a connection" */
  popular: number;
  beta?: boolean;
}

export interface FormField {
  name: string;
  label: string;
  help: string;
  type: 'text' | 'password' | 'select' | 'bool' | 'number';
  required: boolean;
  advanced: boolean;
  /** goes to the keychain, never to disk in plain text */
  secret: boolean;
  default?: string;
  choices?: { value: string; label: string }[];
  /** suggestions that are not the only allowed values */
  suggestions?: { value: string; label: string }[];
}

// Friendlier names and an order for the providers people use most.
const POPULAR: Record<string, { name?: string; rank: number; beta?: boolean }> = {
  drive: { name: 'Google Drive', rank: 1 },
  onedrive: { name: 'OneDrive', rank: 2 },
  dropbox: { name: 'Dropbox', rank: 3 },
  iclouddrive: { name: 'iCloud Drive', rank: 4, beta: true },
  webdav: { name: 'Nextcloud, ownCloud or WebDAV', rank: 5 },
  box: { name: 'Box', rank: 6 },
  pcloud: { name: 'pCloud', rank: 7 },
  mega: { name: 'MEGA', rank: 8 },
  protondrive: { name: 'Proton Drive', rank: 9, beta: true },
  s3: { name: 'Amazon S3 and compatible', rank: 10 },
  b2: { name: 'Backblaze B2', rank: 11 },
  googlephotos: { name: 'Google Photos', rank: 12 },
  azureblob: { name: 'Azure Blob Storage', rank: 13 },
  gcs: { name: 'Google Cloud Storage', rank: 14 },
};

const CATEGORY: Record<string, ProviderCategory> = {
  googlephotos: 'photos',
  s3: 'object', b2: 'object', azureblob: 'object', azurefiles: 'object', gcs: 'object', swift: 'object', oracleobjectstorage: 'object',
  qingstor: 'object', storj: 'object', sia: 'object', netstorage: 'object', cloudinary: 'object',
  sftp: 'server', ftp: 'server', smb: 'server', webdav: 'server', http: 'server', hdfs: 'server',
};

/** Building blocks that only make sense on top of another connection, or that are this computer. */
const NOT_A_PLACE = new Set(['local', 'memory', 'alias', 'cache', 'chunker', 'combine', 'compress', 'hasher', 'union', 'tardigrade', 'crypt']);

/** Accepts both `rclone config providers` (an array) and the rc `config/providers` answer ({providers: […]}). */
export function readProviders(json: unknown): RcloneProvider[] {
  const list = Array.isArray(json) ? json : (json as { providers?: unknown })?.providers;
  return Array.isArray(list) ? (list as RcloneProvider[]).filter((p) => p && typeof p.Prefix === 'string') : [];
}

export function providerCatalog(json: unknown): ProviderInfo[] {
  return readProviders(json)
    .filter((p) => !p.Hide && !NOT_A_PLACE.has(p.Prefix))
    .map((p) => {
      const pop = POPULAR[p.Prefix];
      const opts = p.Options ?? [];
      return {
        id: p.Prefix,
        name: pop?.name ?? p.Description?.replace(/\s*\(.*\)\s*$/, '') ?? p.Name,
        description: p.Description ?? p.Name,
        category: CATEGORY[p.Prefix] ?? 'drive',
        oauth: opts.some((o) => o.Name === 'token') && opts.some((o) => o.Name === 'client_id'),
        popular: pop?.rank ?? 999,
        beta: pop?.beta,
      } satisfies ProviderInfo;
    })
    .sort((a, b) => a.popular - b.popular || a.name.localeCompare(b.name));
}

/** Does an option apply to the chosen sub-provider ("AWS", "Minio"…)? rclone writes "AWS,Ceph" or "!AWS,Minio". */
export function appliesTo(rule: string | undefined, sub: string | undefined): boolean {
  if (!rule) return true;
  // Until a sub-provider is chosen, show only what applies to (nearly) all of them.
  if (!sub) return rule.startsWith('!');
  const neg = rule.startsWith('!');
  const names = (neg ? rule.slice(1) : rule).split(',').map((s) => s.trim().toLowerCase());
  const hit = names.includes(sub.toLowerCase());
  return neg ? !hit : hit;
}

function label(name: string): string {
  const words = name.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1)
    .replace(/\bid\b/gi, 'ID').replace(/\burl\b/gi, 'URL').replace(/\bapi\b/gi, 'API').replace(/\bacl\b/gi, 'ACL');
}

function firstLine(help = ''): string {
  return help.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
}

const INTERNAL = new Set(['token', 'auth_url', 'token_url', 'config_token', 'description', 'encoding']);

/**
 * The form for one provider. `sub` is the chosen sub-provider for providers
 * that have one (S3: AWS, Cloudflare, Minio…), which decides the fields shown.
 */
export function formFor(json: unknown, prefix: string, sub?: string): FormField[] {
  const p = readProviders(json).find((x) => x.Prefix === prefix);
  if (!p) return [];
  const fields: FormField[] = [];
  for (const o of p.Options ?? []) {
    if (INTERNAL.has(o.Name) || (o.Hide ?? 0) > 0) continue;
    if (!appliesTo(o.Provider, sub)) continue;
    const examples = (o.Examples ?? []).filter((e) => appliesTo(e.Provider, sub));
    const opts = examples.map((e) => ({ value: e.Value, label: e.Help ? firstLine(e.Help) : e.Value || '(default)' }));
    const t = (o.Type ?? 'string').toLowerCase();
    const def = o.DefaultStr ?? (o.Default === undefined || o.Default === null || o.Default === '' ? undefined : String(o.Default));
    const type: FormField['type'] = o.IsPassword ? 'password'
      : t === 'bool' ? 'bool'
      : o.Exclusive && opts.length ? 'select'
      : t === 'int' || t === 'float' ? 'number'
      : 'text';
    fields.push({
      name: o.Name,
      label: label(o.Name),
      help: firstLine(o.Help),
      type,
      required: !!o.Required,
      advanced: !!o.Advanced,
      secret: !!(o.IsPassword || o.Sensitive),
      default: def === '' ? undefined : def,
      choices: type === 'select' ? opts : undefined,
      suggestions: type === 'text' && opts.length ? opts : undefined,
    });
  }
  // Required and basic fields first, the rest behind "Advanced".
  return fields.sort((a, b) => Number(a.advanced) - Number(b.advanced) || Number(b.required) - Number(a.required));
}

/** The values to send to rclone: blanks dropped, defaults left out, booleans as "true"/"false". */
export function formValues(fields: FormField[], values: Record<string, string | boolean | undefined>): { plain: Record<string, string>; secret: Record<string, string> } {
  const plain: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (v === undefined || v === '') continue;
    const s = typeof v === 'boolean' ? String(v) : v.trim();
    if (s === '' || s === f.default) continue;
    (f.secret ? secret : plain)[f.name] = s;
  }
  return { plain, secret };
}

/** What a failed rclone call means for the person: sign in again, or something else. */
export function needsSignIn(message: string): boolean {
  return /invalid_grant|token (has )?expired|unauthori[sz]ed|\b401\b|oauth2|re-?authori[sz]e|couldn't fetch token|empty token|refresh token|AADSTS/i.test(message);
}
