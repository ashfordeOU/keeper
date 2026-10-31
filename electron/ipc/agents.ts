// SPDX-License-Identifier: AGPL-3.0-or-later
// IPC for AI agents: services and costs, permissions and approvals, the model
// gateway, agent apps, skills, learning and the knowledge graph.

import { dialog, ipcMain } from 'electron';
import type { Permission } from '../../core/brain/actions';
import * as ag from '../services/agents';

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
}
