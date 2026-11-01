// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Keeper Mesh (the Mesh page, the Island, the keeper command's twin).

import { ipcMain } from 'electron';
import { mesh, startMesh } from '../services/mesh';
import type { LinkNode } from '../services/link/node';

const METHODS = ['state', 'setOn', 'createNetwork', 'renameNetwork', 'removeNetwork', 'addMember', 'removeMember', 'answerInvite', 'setExit', 'offerExit', 'advertise', 'acceptRoutes', 'saveRule', 'removeRule', 'setDns', 'ping', 'pathTest', 'mtuProbe', 'setPlaces', 'trayPreview', 'config'] as const;

export async function registerMeshIpc(d: { node: () => LinkNode | null; broadcast: (channel: string, ...args: unknown[]) => void; show: (route?: string) => void; onChange?: () => void }) {
  for (const m of METHODS) ipcMain.handle(`mesh.${m}`, async (_e, ...args) => (mesh[m] as (...a: unknown[]) => unknown)(...args));
  await startMesh(d);
}

export { meshTrayItems, stopMesh } from '../services/mesh';
