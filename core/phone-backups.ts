// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// iPhone and iPad backups made by Finder or iTunes / Apple Devices: where they
// live on each OS and what each one is (from its Info.plist).

export interface PhoneBackup {
  path: string;
  id: string;
  deviceName: string;
  model: string;
  productType?: string;
  iosVersion?: string;
  lastBackup?: number;
  size: number;
  encrypted?: boolean;
}

/** The folders backups are kept in, for this OS. */
export function backupFolders(platform: string, home: string, env: Record<string, string | undefined>): string[] {
  const sep = platform === 'win32' ? '\\' : '/';
  const j = (...p: string[]) => p.join(sep);
  if (platform === 'darwin') return [j(home, 'Library', 'Application Support', 'MobileSync', 'Backup')];
  if (platform === 'win32') {
    const appData = env.APPDATA ?? j(home, 'AppData', 'Roaming');
    return [j(appData, 'Apple Computer', 'MobileSync', 'Backup'), j(appData, 'Apple', 'MobileSync', 'Backup'), j(env.USERPROFILE ?? home, 'Apple', 'MobileSync', 'Backup')];
  }
  // libimobiledevice's idevicebackup2 writes wherever it is told; these are the usual places.
  return [j(home, '.local', 'share', 'MobileSync', 'Backup'), j(home, 'MobileSync', 'Backup')];
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The simple top-level values of an XML property list (strings, dates, numbers, booleans). */
export function plistValues(xml: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const body = xml.replace(/<array>[\s\S]*?<\/array>|<data>[\s\S]*?<\/data>/g, '<x/>');
  const re = /<key>([^<]*)<\/key>\s*(?:<(string|date|integer|real)>([\s\S]*?)<\/\2>|<(true|false)\s*\/>|<(string)\s*\/>)/g;
  for (const m of body.matchAll(re)) {
    const key = unescape(m[1]);
    if (m[4]) out[key] = m[4] === 'true';
    else if (m[5]) out[key] = '';
    else if (m[2] === 'integer' || m[2] === 'real') out[key] = Number(m[3]);
    else out[key] = unescape(m[3]);
  }
  return out;
}

/** "iPhone15,2" → "iPhone"; "iPad13,4" → "iPad". */
export function deviceFamily(productType?: string): string {
  const m = productType?.match(/^(iPhone|iPad|iPod|Watch|AppleTV)/);
  return m ? (m[1] === 'iPod' ? 'iPod touch' : m[1]) : 'Apple device';
}

/** A backup's details from its Info.plist (and Manifest.plist when it is XML). */
export function describeBackup(id: string, path: string, info: string, size: number, manifest?: string): PhoneBackup {
  const v = plistValues(info);
  const productType = typeof v['Product Type'] === 'string' ? (v['Product Type'] as string) : undefined;
  const date = typeof v['Last Backup Date'] === 'string' ? Date.parse(v['Last Backup Date'] as string) : NaN;
  const enc = manifest && /<key>IsEncrypted<\/key>\s*<(true|false)\s*\/>/.exec(manifest)?.[1];
  return {
    id,
    path,
    deviceName: String(v['Device Name'] || v['Display Name'] || 'Unnamed device'),
    model: String(v['Product Name'] || deviceFamily(productType)),
    productType,
    iosVersion: typeof v['Product Version'] === 'string' ? (v['Product Version'] as string) : undefined,
    lastBackup: Number.isFinite(date) ? date : undefined,
    size,
    encrypted: enc ? enc === 'true' : undefined,
  };
}
