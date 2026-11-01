// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The few things Keeper Mesh uses from a Link node. Mesh registers its own
// stream kind ("mesh.ctl") through Link's existing registerStream hook and
// otherwise only reads: no change to Link itself.

import type { LinkNode } from '../link/node';
import type { LinkPort } from './engine';

export function linkPort(node: LinkNode): LinkPort {
  return {
    get id() {
      return node.id;
    },
    get me() {
      return node.me;
    },
    name: () => node.data.name,
    devices: () => node.data.devices.map((d) => ({ id: d.id, name: d.name, pub: Buffer.from(d.pub, 'base64') })),
    online: (d) => node.state().devices.find((x) => x.id === d)?.online ?? false,
    connect: (d) => node.connect(d),
    // Permission is checked by Mesh itself: only devices in one of your mesh networks get an answer.
    registerStream: (kind, fn) => node.registerStream(kind, null, fn),
    settings: () => node.data.settings,
  };
}
