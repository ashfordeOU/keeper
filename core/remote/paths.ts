// SPDX-License-Identifier: AGPL-3.0-or-later
// Paths inside a connection: always "/"-separated, always starting with "/",
// never able to climb above the top of the connection.

/** "/a/./b/../c/" → "/a/c"; anything that would climb above "/" stops at "/". */
export function normalizeRemote(p: string): string {
  const out: string[] = [];
  for (const part of (p ?? '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export function joinRemote(dir: string, name: string): string {
  if (/[\\/]/.test(name) || name === '..' || name === '.') throw new Error(`Not a valid name: ${name}`);
  return normalizeRemote(`${dir}/${name}`);
}

export function parentRemote(p: string): string | null {
  const n = normalizeRemote(p);
  if (n === '/') return null;
  return normalizeRemote(n.slice(0, n.lastIndexOf('/')) || '/');
}

export function baseRemote(p: string): string {
  const n = normalizeRemote(p);
  return n === '/' ? '' : n.slice(n.lastIndexOf('/') + 1);
}

/** The connection's own top folder plus a path inside it, as the server sees it. */
export function onServer(root: string | undefined, p: string): string {
  const r = (root ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  const inner = normalizeRemote(p);
  if (!r) return inner;
  return inner === '/' ? r || '/' : `${r}${inner}`;
}

/** Browse route argument: "<connection id>:<path>". */
export function remoteRoute(id: string, p = '/'): string {
  return `${id}:${normalizeRemote(p)}`;
}

export function parseRemoteRoute(arg: string | undefined): { id: string; path: string } | null {
  if (!arg) return null;
  const i = arg.indexOf(':');
  if (i <= 0) return null;
  return { id: arg.slice(0, i), path: normalizeRemote(arg.slice(i + 1)) };
}

/** Breadcrumbs for a path: [{label: 'Photos', path: '/Photos'}, …], starting with the connection itself. */
export function remoteCrumbs(name: string, p: string): { label: string; path: string }[] {
  const parts = normalizeRemote(p).split('/').filter(Boolean);
  const out = [{ label: name, path: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += '/' + part;
    out.push({ label: part, path: acc });
  }
  return out;
}

/** A file name that is safe on this computer, for downloads into the cache. */
export function localSafeName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean) ? `_${clean}` : clean || '_';
}
