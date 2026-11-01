// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Browser demo of the operating-system integrations: a Mac with Apple Intelligence.

import type { PlatformApi } from '../core/api-platform';
import { DEFAULT_PLATFORM, listIntegrations, type PlatformFacts, type PlatformSettings } from '../core/platform-integrations';

export function mockPlatform(): { platform: PlatformApi } {
  const facts: PlatformFacts = { platform: 'darwin', macVersion: 26, arm: true, helper: true, appleModel: 'available', mcpCommand: 'keeper mcp' };
  const s: PlatformSettings = { ...DEFAULT_PLATFORM, spotlight: true };
  const keys: Record<string, keyof PlatformSettings> = { spotlight: 'spotlight', 'mac-ocr': 'nativeOcr', 'gnome-search': 'gnomeSearch', krunner: 'krunner', 'explorer-menu': 'explorerMenu', 'win-ocr': 'nativeOcr' };
  return {
    platform: {
      async list() {
        return listIntegrations(facts, s);
      },
      async set(id, on) {
        const k = keys[id];
        if (k) (s as unknown as Record<string, boolean>)[k] = on;
        return { list: listIntegrations(facts, s) };
      },
      async action(id) {
        if (id === 'copy-mcp') return { ok: true, copy: JSON.stringify({ mcpServers: { keeper: { command: 'keeper', args: ['mcp'] } } }, null, 2), message: 'Copied. Paste it into your AI app’s MCP settings.' };
        return { ok: true, message: 'Done (demo)' };
      },
      async ask() {},
    },
  };
}
