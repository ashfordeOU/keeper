// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's extensions: one installed example.

import type { ExtensionsApi, InstalledExtension } from '../core/api-extensions';
import { permissionLines } from '../core/extensions';

export function mockExtensions(): { extensions: ExtensionsApi } {
  const m = { id: 'example.hello', name: 'Hello', version: '1.0.0', description: 'Says hello and catches a dated note.', surfaces: ['commands' as const], main: 'main.js', commands: [{ id: 'hello', title: 'Say hello' }], permissions: ['notify' as const, 'inbox' as const], hosts: [] };
  const ext: InstalledExtension = { ...m, checksum: 'f'.repeat(64), enabled: true, perms: { notify: 'allow', inbox: 'ask' }, lines: permissionLines(m), installed: Date.now() };
  return {
    extensions: {
      list: async () => [ext], pick: async () => null, preview: async () => ({ ...m, checksum: ext.checksum, lines: ext.lines, replaces: true }), install: async () => ext,
      remove: async () => undefined, setEnabled: async () => undefined, setPermission: async () => undefined, worker: async () => 'data:text/javascript,', search: async () => [], fetch: async () => ({ status: 200, text: '' }),
    },
  };
}
