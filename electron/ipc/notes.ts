// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for Notes, and `keeper/notes` for agents and the command line
// (search, read, today's note, capture; writing only when allowed).

import { ipcMain } from 'electron';
import * as svc from '../services/notes';
import { registerKeeperMethod } from '../services/brain';
import { featureOn } from '../services/features';
import { linkKeeperVaults } from '../services/notes-sync';

/** A vault added, made or removed: Notes Everywhere follows (when it is on). */
const vaultsChanged = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
  const r = await fn(...a);
  if (featureOn('notesHub')) void svc.vaults().then(linkKeeperVaults).catch(() => undefined);
  return r;
};

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

export function registerNotesIpc(d: { broadcast: (channel: string, ...args: unknown[]) => void; allowRoot?: (dir: string) => void }) {
  svc.initNotes(d);
  const m: Record<string, (...a: never[]) => unknown> = {
    vaults: svc.vaults, addVault: vaultsChanged(svc.addVault), createVault: vaultsChanged(svc.createVault), removeVault: vaultsChanged(svc.removeVault),
    open: svc.openVault, close: svc.close, vaultPath: svc.vaultPath,
    read: svc.read, write: (id: string, p: string, t: string) => svc.write(id, p, t), create: svc.create, createFolder: svc.createFolder, newNote: svc.newNote,
    remove: svc.remove, rename: svc.rename,
    saveAttachment: (id: string, note: string, name: string, data: Uint8Array) => svc.saveAttachment(id, note, name, Buffer.from(data)),
    fileUrl: svc.fileUrlFor, reveal: svc.reveal,
    backlinks: svc.backlinks, outgoing: svc.outgoing, unlinked: svc.unlinked, linkMention: svc.linkMention, tags: svc.tags,
    search: svc.search, suggest: svc.suggest, resolve: svc.resolve, unresolved: svc.unresolvedLinks, graph: svc.graph, random: svc.random,
    periodic: svc.periodic, templates: svc.templates, fillTemplate: svc.fillTemplateFor, base: svc.base, merge: svc.merge, extract: svc.extract, publish: svc.publish,
    snapshots: svc.snapshots, snapshot: svc.snapshot, bookmarks: svc.bookmarks, setBookmarks: svc.setBookmarks, capture: svc.capture,
    render: svc.render, preview: svc.preview, settings: svc.getSettings, setSettings: svc.setSettings, ask: svc.ask, assist: svc.assist,
    plugins: svc.plugins, pluginCode: svc.pluginCode, setPlugin: svc.setPlugin,
  };
  for (const [k, fn] of Object.entries(m)) handle(`notes.${k}`, fn);

  registerKeeperMethod('keeper/notes', async (p) => {
    const cmd = String(p.cmd ?? 'vaults');
    const vault = String(p.vault ?? (await svc.vaults())[0]?.id ?? '');
    if (cmd === 'vaults') return svc.vaults();
    if (!vault) throw new Error('No vault yet: open a folder in Notes first.');
    if (cmd === 'search') return svc.search(vault, String(p.query ?? ''), { limit: Number(p.limit ?? 20) });
    if (cmd === 'read') return svc.read(vault, String(p.path));
    if (cmd === 'today') return svc.periodic(vault, 'day');
    if (cmd === 'capture') return svc.capture(String(p.text ?? ''), vault);
    if (cmd === 'backlinks') return svc.backlinks(vault, String(p.path));
    if (cmd === 'write') return svc.agentWrite(vault, String(p.path), String(p.text ?? ''), String(p.agent ?? 'agent'));
    throw new Error(`Unknown notes command ${cmd}`);
  });
}
