// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's optional browser extension reports, per site, which third parties a
// page loaded. Browsers talk to installed programs through "native messaging":
// 4-byte little-endian length + UTF-8 JSON, over the program's stdin/stdout.
// This is the framing and the host manifest each browser expects.

export const HOST_NAME = 'org.ashforde.keeper';
/** The unpacked extension's id (fixed by the public key in its manifest) and its Firefox add-on id. */
export const CHROMIUM_EXTENSION_ORIGIN = 'chrome-extension://lkgnaaiefeiflokcnjnpmocahliakgac/';
export const FIREFOX_EXTENSION_ID = 'privacy@keeper.ashforde.org';

export function encodeMessage(obj: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Splits a stream into messages; returns the messages and what is left over. Refuses oversized frames (1 MB, the browsers' own limit). */
export function decodeMessages(buf: Buffer): { messages: unknown[]; rest: Buffer } {
  const messages: unknown[] = [];
  let off = 0;
  while (buf.length - off >= 4) {
    const len = buf.readUInt32LE(off);
    if (len > 1024 * 1024) throw new Error('message too large');
    if (buf.length - off - 4 < len) break;
    messages.push(JSON.parse(buf.subarray(off + 4, off + 4 + len).toString('utf8')));
    off += 4 + len;
  }
  return { messages, rest: buf.subarray(off) };
}

export function hostManifest(binPath: string, engine: 'chromium' | 'firefox', extensionIds: string[]): Record<string, unknown> {
  return {
    name: HOST_NAME,
    description: 'Keeper by Ashforde® — privacy reports from the browser',
    path: binPath,
    type: 'stdio',
    ...(engine === 'chromium' ? { allowed_origins: extensionIds.length ? extensionIds : [CHROMIUM_EXTENSION_ORIGIN] } : { allowed_extensions: extensionIds.length ? extensionIds : [FIREFOX_EXTENSION_ID] }),
  };
}

/** Where each browser looks for the host manifest (macOS/Linux) or the registry key naming it (Windows). */
export function hostManifestLocations(platform: string, home: string): { browser: string; engine: 'chromium' | 'firefox'; dir?: string; regKey?: string }[] {
  const name = HOST_NAME;
  if (platform === 'win32') {
    return [
      { browser: 'Chrome', engine: 'chromium', regKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${name}` },
      { browser: 'Edge', engine: 'chromium', regKey: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${name}` },
      { browser: 'Brave', engine: 'chromium', regKey: `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${name}` },
      { browser: 'Firefox', engine: 'firefox', regKey: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${name}` },
    ];
  }
  if (platform === 'darwin') {
    const a = `${home}/Library/Application Support`;
    return [
      { browser: 'Chrome', engine: 'chromium', dir: `${a}/Google/Chrome/NativeMessagingHosts` },
      { browser: 'Chromium', engine: 'chromium', dir: `${a}/Chromium/NativeMessagingHosts` },
      { browser: 'Edge', engine: 'chromium', dir: `${a}/Microsoft Edge/NativeMessagingHosts` },
      { browser: 'Brave', engine: 'chromium', dir: `${a}/BraveSoftware/Brave-Browser/NativeMessagingHosts` },
      { browser: 'Vivaldi', engine: 'chromium', dir: `${a}/Vivaldi/NativeMessagingHosts` },
      { browser: 'Arc', engine: 'chromium', dir: `${a}/Arc/User Data/NativeMessagingHosts` },
      { browser: 'Firefox', engine: 'firefox', dir: `${a}/Mozilla/NativeMessagingHosts` },
    ];
  }
  return [
    { browser: 'Chrome', engine: 'chromium', dir: `${home}/.config/google-chrome/NativeMessagingHosts` },
    { browser: 'Chromium', engine: 'chromium', dir: `${home}/.config/chromium/NativeMessagingHosts` },
    { browser: 'Edge', engine: 'chromium', dir: `${home}/.config/microsoft-edge/NativeMessagingHosts` },
    { browser: 'Brave', engine: 'chromium', dir: `${home}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts` },
    { browser: 'Vivaldi', engine: 'chromium', dir: `${home}/.config/vivaldi/NativeMessagingHosts` },
    { browser: 'Firefox', engine: 'firefox', dir: `${home}/.mozilla/native-messaging-hosts` },
  ];
}
