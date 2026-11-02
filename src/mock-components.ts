// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The browser demo's downloadable parts: ffmpeg and rclone "inside the app", ONNX Runtime downloadable.

import type { ComponentsApi } from '../core/api-components';
import { approxSize, COMPONENTS, componentsFor, type ComponentInfo } from '../core/components';

export function mockComponents(emit: (channel: string) => void): { components: ComponentsApi } {
  const state: Record<string, ComponentInfo['state']> = { ffmpeg: 'bundled', onnxruntime: 'missing', rclone: 'bundled' };
  const list = async (): Promise<ComponentInfo[]> => COMPONENTS.map((c) => {
    const s = approxSize(c.id, 'darwin', 'arm64');
    return { id: c.id, name: c.name, description: c.description, state: state[c.id], downloadSize: s.download, estimate: true, sizeOnDisk: state[c.id] === 'installed' ? s.disk : 0, neededBy: [] };
  });
  const download = async (id: string) => { state[id] = 'installed'; emit('components-changed'); return list(); };
  const remove = async (id: string) => { if (state[id] === 'installed') state[id] = 'missing'; emit('components-changed'); return list(); };
  return {
    components: {
      list, sizes: list, download, remove, cancel: list,
      removeAll: async () => { for (const k of Object.keys(state)) if (state[k] === 'installed') state[k] = 'missing'; return list(); },
      downloadAll: async () => { for (const k of Object.keys(state)) if (state[k] === 'missing') state[k] = 'installed'; return list(); },
      ensureFor: async (ids) => { for (const id of componentsFor(ids)) if (state[id] === 'missing') state[id] = 'installed'; return list(); },
      switchedOn: async () => list(),
      check: async () => ({ ok: true, output: 'demo' }),
      addons: async () => [],
      addonAction: async () => [],
    },
  };
}
