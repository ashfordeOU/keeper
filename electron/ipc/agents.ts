// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for AI agents: services and costs, permissions and approvals, the model
// gateway, agent apps, skills, learning and the knowledge graph.

import { dialog, ipcMain } from 'electron';
import type { Permission } from '../../core/brain/actions';
import * as ag from '../services/agents';
import * as ga from '../services/graph-all';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(`agents.${name}`, async (_e, ...args) => fn(...(args as never[])));
}

export function registerAgentsIpc() {
  handle('catalog', () => ag.catalog());
  handle('addConnection', (id: string, o: Parameters<typeof ag.addConnection>[1]) => ag.addConnection(id, o));
  handle('listModels', (id: string) => ag.listModels(id));
  handle('usage', (days?: number) => ag.usageReport(days));
  handle('actions', () => ag.actionsList());
  handle('setPermission', (name: string, p: Permission) => ag.setPermission(name, p));
  handle('pending', () => ag.pendingApprovals());
  handle('decide', (id: string, d: 'once' | 'always' | 'deny') => ag.decide(id, d));
  handle('audit', () => ag.auditLog());
  handle('computerState', async () => (await import('../services/computer')).computerState());
  handle('computerStop', async () => (await import('../services/computer')).stopAll());
  handle('computerShot', async (file: string) => {
    // Only pictures from Keeper's own activity folder, as data URLs for the log.
    const path = await import('node:path');
    const { app } = await import('electron');
    const dir = path.join(app.getPath('userData'), 'agents', 'computer');
    const p = path.resolve(file);
    if (!p.startsWith(dir + path.sep)) return null;
    const { promises: fsp } = await import('node:fs');
    return fsp.readFile(p).then((b) => `data:image/jpeg;base64,${b.toString('base64')}`).catch(() => null);
  });
  handle('gateway', () => ag.gatewayInfo());
  handle('rotateToken', () => ag.rotateGatewayToken());
  handle('clis', (refresh?: boolean) => ag.agentClis(refresh));
  handle('saveProfile', (p: Parameters<typeof ag.saveProfile>[0]) => ag.saveProfile(p));
  handle('removeProfile', (id: string) => ag.removeProfile(id));
  handle('launch', (id: string, o?: { profileId?: string; cwd?: string }) => ag.launchAgent(id, o));
  handle('skills', () => ag.skillsList());
  handle('saveSkill', (text: string, prev?: string) => ag.saveSkill(text, prev));
  handle('removeSkill', (name: string) => ag.removeSkill(name));
  handle('setSkillEnabled', (name: string, on: boolean) => ag.setSkillEnabled(name, on));
  handle('importSkill', (folder: string) => ag.importSkill(folder));
  handle('otherSkills', () => ag.otherSkillFolders());
  handle('exportSkill', async (name: string) => {
    const r = await dialog.showOpenDialog({ title: 'Export the skill into…', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : ag.exportSkill(name, r.filePaths[0]);
  });
  handle('draftSkill', (input: Parameters<typeof ag.draftSkillFrom>[0]) => ag.draftSkillFrom(input));
  handle('learning', () => ag.learningStatus());
  handle('suggestions', () => ag.suggestions());
  handle('applySuggestion', (id: string) => ag.applySuggestion(id));
  handle('dismissSuggestion', (id: string) => ag.dismissSuggestion(id));
  handle('forget', () => ag.forgetLearning());
  handle('record', (e: Parameters<typeof ag.record>[0]) => ag.record(e));
  handle('graph', (o?: Parameters<typeof ag.graph>[0]) => ag.graph(o));
  // The knowledge graph of everything and search over every kind (electron/services/graph-all.ts).
  handle('graphStatus', () => ga.status());
  handle('graphView', (o?: Parameters<typeof ga.view>[0]) => ga.view(o ?? {}));
  handle('graphFind', (q: string, kinds?: Parameters<typeof ga.find>[1]) => ga.find(String(q ?? ''), kinds));
  handle('graphRelated', (ref: Parameters<typeof ga.relatedTo>[0], o?: Parameters<typeof ga.relatedTo>[1]) => ga.relatedTo(ref, o));
  handle('graphExplain', (a: string, b: string) => ga.explainLink(String(a), String(b)));
  handle('graphAddToNote', (id: string) => ga.addToNote(String(id)));
  handle('searchEverything', (q: string, o?: Parameters<typeof ga.searchEverything>[1]) => ga.searchEverything(String(q ?? ''), o));
}
