// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Keeper's abilities.

import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Persona, Project, ScheduledTask } from '../../core/abilities/config';
import { IMAGE_PROVIDERS } from '../../core/abilities/images';
import { addMemory, editMemory, removeMemory, type Memory } from '../../core/abilities/memory';
import { checkPersona } from '../../core/abilities/personas';
import { abilityPermission } from '../../core/abilities/policy';
import { ABILITIES } from '../../core/abilities/registry';
import { nextRun, parseSchedule } from '../../core/abilities/schedule';
import { SEARCH_PROVIDERS, webSearch } from '../../core/abilities/search';
import type { TeamSpec } from '../../core/abilities/teams';
import {
  abilitySettings, callAbility, cancelTeam, contextFor, costSummary, keyStatus, listMemories, runTask, runTeamById, saveAbilities, setKey, setMemories, teamMembers,
} from '../services/abilities';
import { getSecret } from '../store';

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

const upsert = <T extends { id: string }>(list: T[], item: Omit<T, 'id'> & { id?: string }): T[] => {
  const id = item.id ?? randomUUID().slice(0, 8);
  const next = { ...item, id } as T;
  return list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? next : x)) : [...list, next];
};

export function registerAbilitiesIpc() {
  handle('abilities.settings', () => abilitySettings());
  handle('abilities.save', (patch: Record<string, unknown>) => saveAbilities(patch));
  handle('abilities.list', () => {
    const s = abilitySettings();
    return ABILITIES.map((a) => ({ name: a.name, label: a.label, group: a.group, description: a.description, network: a.network, readOnly: a.readOnly, permission: abilityPermission(a.name, s) }));
  });
  handle('abilities.providers', async () => ({ search: SEARCH_PROVIDERS, images: IMAGE_PROVIDERS, keys: await keyStatus() }));
  handle('abilities.setKey', (name: string, value: string) => setKey(name, value));
  handle('abilities.testSearch', async (q?: string) => {
    const s = abilitySettings().search;
    try {
      const ctx = contextFor({ client: 'you' });
      const key = s.provider === 'xai' ? await ctx.key('xai') : await ctx.key(`search:${s.provider}`);
      const r = await webSearch(s.provider, q || 'owls', 3, { fetch, key, searxngUrl: s.searxngUrl, googleCx: s.googleCx, region: s.region, safe: s.safe });
      return { ok: r.length > 0, message: r.length ? `${r.length} results` : 'The service answered with no results', results: r.map((x) => ({ title: x.title, url: x.url })) };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });
  handle('abilities.call', async (name: string, args: Record<string, unknown>) => {
    const r = await callAbility(name, args, { client: 'you', localModel: true });
    return { content: r.content, summary: r.summary, isError: r.isError, files: r.files };
  });

  handle('abilities.memories', () => listMemories());
  handle('abilities.addMemory', async (text: string, scope?: Memory['scope'], owner?: string) => {
    await setMemories(addMemory(listMemories(), { text, scope, owner, by: 'you', cloud: abilitySettings().memory.cloud }).list);
    return listMemories();
  });
  handle('abilities.editMemory', async (id: string, patch: Partial<Memory>) => { await setMemories(editMemory(listMemories(), id, patch)); return listMemories(); });
  handle('abilities.removeMemory', async (id: string) => { await setMemories(removeMemory(listMemories(), id)); return listMemories(); });
  handle('abilities.clearMemories', async () => { await setMemories([]); return listMemories(); });
  handle('abilities.costs', (days?: number) => costSummary(days));

  handle('abilities.saveTask', async (t: Omit<ScheduledTask, 'id'> & { id?: string }) => {
    const sched = parseSchedule(t.when);
    const withMeta = { ...t, once: sched.once !== undefined, createdAt: (t as { createdAt?: number }).createdAt ?? Date.now() };
    return (await saveAbilities({ tasks: upsert(abilitySettings().tasks, withMeta) })).tasks;
  });
  handle('abilities.removeTask', async (id: string) => (await saveAbilities({ tasks: abilitySettings().tasks.filter((t) => t.id !== id) })).tasks);
  handle('abilities.runTask', (id: string) => runTask(id));
  handle('abilities.describeSchedule', (when: string) => {
    try {
      const s = parseSchedule(when);
      const next: number[] = [];
      let at = Date.now();
      for (let i = 0; i < 3; i++) {
        const n = nextRun(s, at, i ? at : undefined);
        if (n === undefined || (i && s.once !== undefined)) break;
        next.push(n);
        at = n;
      }
      return { ok: true, label: s.label, next };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle('abilities.savePersona', async (p: Omit<Persona, 'id'> & { id?: string }) => {
    const bad = checkPersona(p);
    if (bad) throw new Error(bad);
    return (await saveAbilities({ personas: upsert(abilitySettings().personas, p) })).personas;
  });
  handle('abilities.removePersona', async (id: string) => (await saveAbilities({ personas: abilitySettings().personas.filter((p) => p.id !== id) })).personas);
  handle('abilities.saveProject', async (p: Omit<Project, 'id'> & { id?: string }) => (await saveAbilities({ projects: upsert(abilitySettings().projects, p) })).projects);
  handle('abilities.removeProject', async (id: string) => (await saveAbilities({ projects: abilitySettings().projects.filter((p) => p.id !== id) })).projects);

  handle('abilities.members', async () => (await teamMembers()).map((m) => ({ id: m.id, label: m.label, local: m.local, strengths: m.strengths })));
  handle('abilities.saveTeam', async (t: Omit<TeamSpec, 'id'> & { id?: string }) => (await saveAbilities({ teams: upsert(abilitySettings().teams, t) })).teams);
  handle('abilities.removeTeam', async (id: string) => (await saveAbilities({ teams: abilitySettings().teams.filter((t) => t.id !== id) })).teams);
  handle('abilities.runTeam', (runId: string, team: string | TeamSpec, prompt: string) => runTeamById(runId, team, prompt));
  handle('abilities.cancelTeam', (runId: string) => cancelTeam(runId));

  handle('abilities.transcribe', async (audio: ArrayBuffer, mime: string) => {
    const v = abilitySettings().voice;
    if (v.stt === 'off') throw new Error('Speech to text is off in Agents → Abilities');
    const key = (await getSecret('ability:voice')) ?? (/api\.openai\.com/.test(v.sttUrl) ? await getSecret('openai') : undefined);
    if (!key && !/localhost|127\.0\.0\.1/.test(v.sttUrl)) throw new Error('Add a speech-to-text key in Agents → Abilities → Voice');
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mime }), `speech.${mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'}`);
    form.append('model', v.sttModel);
    const res = await fetch(v.sttUrl, { method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: form });
    if (!res.ok) throw new Error(`The speech service answered ${res.status}`);
    return String(((await res.json()) as { text?: string }).text ?? '').trim();
  });
  handle('abilities.speak', (text: string) => callAbility('speak', { text }, { client: 'you', localModel: true }).then(() => undefined));
}
