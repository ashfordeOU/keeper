// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Extensions in the window: Settings → General → Extensions (install from a
// folder after reading what it may do, Off / Ask / Allow for each permission,
// remove), their commands in the command palette, and the host that runs each
// one in a worker of its own and checks every message it sends.

import { useEffect, useState } from 'react';
import type { InstalledExtension } from '../../core/api-extensions';
import { CALLS, PERMISSION_WORDS, type ExtManifest, type ExtPermission, type PermState } from '../../core/extensions';
import { api } from '../api';
import { useFeature } from '../features';
import { useStore } from '../state';
import { Icon } from './Icon';
import { Modal, Toggle } from './ui';
import '../styles/extensions.css';

const RUN = 'keeper-ext-run';
const STATES: { id: PermState; label: string }[] = [{ id: 'off', label: 'Off' }, { id: 'ask', label: 'Ask' }, { id: 'allow', label: 'Allow' }];
const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/** Installed extensions, kept fresh. */
export function useExtensions(): InstalledExtension[] {
  const on = useFeature('extensions');
  const [list, setList] = useState<InstalledExtension[]>([]);
  useEffect(() => {
    if (!on) { setList([]); return; }
    const load = () => void api.extensions.list().then(setList, () => setList([]));
    load();
    return api.on('extensions-changed', load);
  }, [on]);
  return list;
}

/** Palette commands from extensions: "Hello: Say hello". */
export function useExtensionCommands() {
  const list = useExtensions();
  return list.filter((e) => e.enabled).flatMap((e) => e.commands.map((c) => ({
    id: `ext-${e.id}-${c.id}`, label: `${e.name}: ${c.title}`, group: 'Actions' as const, icon: 'grid', keywords: `extension ${e.name} ${e.description ?? ''}`,
    run: () => window.dispatchEvent(new CustomEvent(RUN, { detail: { id: e.id, command: c.id } })),
  })));
}

interface Ask { ext: InstalledExtension; perm: ExtPermission; resolve: (v: 'once' | 'always' | 'no') => void }

/** Runs extensions' commands; mounted once in the window. */
export function ExtensionHost() {
  const store = useStore();
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    const workers = new Map<string, Worker>();
    const askFor = (ext: InstalledExtension, perm: ExtPermission) => new Promise<'once' | 'always' | 'no'>((resolve) => setAsk({ ext, perm, resolve: (v) => { setAsk(null); resolve(v); } }));
    const allowed = async (ext: InstalledExtension, perm: ExtPermission): Promise<boolean> => {
      const s = ext.permissions.includes(perm) ? ext.perms[perm] ?? 'ask' : 'off';
      if (s === 'allow') return true;
      if (s === 'off') return false;
      const v = await askFor(ext, perm);
      if (v === 'always') { await api.extensions.setPermission(ext.id, perm, 'allow'); ext.perms[perm] = 'allow'; }
      return v !== 'no';
    };
    const handle = async (ext: InstalledExtension, method: string, args: Record<string, unknown>): Promise<unknown> => {
      const perm = CALLS[method];
      if (!perm) throw new Error(`Keeper has no "${method}"`);
      if (!(await allowed(ext, perm))) throw new Error(`${ext.name} may not ${PERMISSION_WORDS[perm].toLowerCase()}`);
      const text = String(args.text ?? '').slice(0, 10_000);
      switch (method) {
        case 'notify': store.toast(`${ext.name}: ${text.slice(0, 200)}`); return true;
        case 'search': return api.extensions.search(ext.id, String(args.query ?? ''));
        case 'clipboard.write': await api.files.copyText(text); return true;
        case 'inbox.add': { const it = await api.inbox.add({ text, source: `extension:${ext.id}` }); return !!it; }
        case 'fetch': return api.extensions.fetch(ext.id, String(args.url ?? ''));
      }
      return null;
    };
    const run = async (e: Event) => {
      const { id, command } = (e as CustomEvent<{ id: string; command: string }>).detail;
      try {
        const ext = (await api.extensions.list()).find((x) => x.id === id);
        if (!ext?.enabled) throw new Error('That extension is not on');
        let w = workers.get(id);
        if (!w) {
          w = new Worker(await api.extensions.worker(id), { name: `extension ${id}` });
          workers.set(id, w);
          w.onmessage = (m) => {
            const d = (m.data ?? {}) as { keeperExt?: string; id?: number; method?: string; args?: Record<string, unknown>; done?: string; error?: string };
            if (d.keeperExt !== id) return;
            if (d.done !== undefined) { if (d.error) store.toast(`${ext.name}: ${d.error}`); return; }
            if (typeof d.id !== 'number' || !d.method) return;
            void handle(ext, d.method, d.args ?? {}).then((result) => w!.postMessage({ reply: d.id, result }), (err: unknown) => w!.postMessage({ reply: d.id, error: errorText(err) }));
          };
          w.onerror = (err) => { store.toast(`${ext.name} stopped: ${err.message || 'an error'}`); workers.delete(id); };
        }
        w.postMessage({ command });
      } catch (err) {
        store.toast(errorText(err));
      }
    };
    window.addEventListener(RUN, run);
    // A change to the list (removed, switched off, new permissions): start each again when next used.
    const off = api.on('extensions-changed', () => { for (const w of workers.values()) w.terminate(); workers.clear(); });
    return () => { window.removeEventListener(RUN, run); off(); for (const w of workers.values()) w.terminate(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ask) return null;
  return (
    <Modal title={`${ask.ext.name} asks`} onClose={() => ask.resolve('no')} width={420} testId="ext-ask">
      <p>{ask.ext.name} wants to <b>{PERMISSION_WORDS[ask.perm].toLowerCase()}</b>{ask.perm === 'network' ? ` (${ask.ext.hosts.join(', ')})` : ''}.</p>
      <div className="btn-row modal-actions">
        <button className="btn" data-testid="ext-ask-no" onClick={() => ask.resolve('no')}>Don’t allow</button>
        <span className="grow" />
        <button className="btn" data-testid="ext-ask-always" onClick={() => ask.resolve('always')}>Always allow</button>
        <button className="btn primary" autoFocus data-testid="ext-ask-once" onClick={() => ask.resolve('once')}>Allow once</button>
      </div>
    </Modal>
  );
}

/** Settings → General → Extensions. */
export function ExtensionsPanel() {
  const { toast } = useStore();
  const on = useFeature('extensions');
  const list = useExtensions();
  const [preview, setPreview] = useState<(ExtManifest & { dir: string; checksum: string; lines: { id: ExtPermission; text: string }[]; replaces: boolean }) | null>(null);
  const choose = async () => {
    try {
      const dir = await api.extensions.pick();
      if (dir) setPreview({ ...(await api.extensions.preview(dir)), dir });
    } catch (e) { toast(errorText(e)); }
  };
  if (!on) {
    return (
      <div className="ext-panel" data-testid="extensions">
        <p className="small muted">Small add-ons that bring their own commands. Each runs on its own, and may only do what you allow.</p>
        <button className="btn" data-testid="ext-turn-on" onClick={() => void api.features.set('extensions', true)}>Turn on extensions</button>
      </div>
    );
  }
  return (
    <div className="ext-panel" data-testid="extensions">
      <div className="ext-head">
        <p className="small muted grow">Each runs on its own · No access to your files · Only what you allow</p>
        <button className="btn primary" data-testid="ext-install" onClick={() => void choose()}><Icon name="plus" size={13} /> Install from a folder…</button>
      </div>
      {list.length ? list.map((e) => (
        <div key={e.id} className="ext-card" data-testid="ext-card">
          <div className="ext-title">
            <div className="grow">
              <b>{e.name}</b> <span className="muted small">{e.version}{e.author ? ` · ${e.author}` : ''}</span>
              {e.description ? <div className="small muted">{e.description}</div> : null}
              <div className="small muted">{e.commands.length} command{e.commands.length === 1 ? '' : 's'} in the command palette</div>
            </div>
            <Toggle label={`${e.name} on`} on={e.enabled} onChange={(v) => void api.extensions.setEnabled(e.id, v)} />
          </div>
          {e.lines.map((l) => (
            <div key={l.id} className="ext-perm">
              <span className="grow small">{l.text}</span>
              <div className="seg" role="radiogroup" aria-label={l.text} data-testid={`ext-perm-${l.id}`}>
                {STATES.map((s) => <button key={s.id} role="radio" aria-checked={(e.perms[l.id] ?? 'ask') === s.id} className={(e.perms[l.id] ?? 'ask') === s.id ? 'on' : ''} onClick={() => void api.extensions.setPermission(e.id, l.id, s.id)}>{s.label}</button>)}
              </div>
            </div>
          ))}
          {!e.lines.length ? <div className="small muted">Asks for nothing.</div> : null}
          <div className="btn-row ext-foot"><span className="small muted grow" title={e.checksum}>Fingerprint {e.checksum.slice(0, 12)}…</span><button className="btn sm ghost" onClick={() => void api.extensions.remove(e.id).then(() => toast(`${e.name} removed`))}>Remove</button></div>
        </div>
      )) : <div className="small muted ext-empty">No extensions yet. An extension is a folder with a manifest.json and one script; docs/EXTENSIONS.md shows how to make one.</div>}
      {preview ? (
        <Modal title={`Install ${preview.name}?`} onClose={() => setPreview(null)} width={460} testId="ext-preview">
          <p className="small muted">{preview.description ?? ''} {preview.replaces ? 'It replaces the copy you have.' : ''}</p>
          <div className="ext-kicker">It may</div>
          {preview.lines.length ? <ul className="ext-lines">{preview.lines.map((l) => <li key={l.id}>{l.text}</li>)}</ul> : <p className="small">Nothing beyond its own commands.</p>}
          <p className="small muted">Each one asks you first until you choose Allow. Fingerprint {preview.checksum.slice(0, 16)}…</p>
          <div className="btn-row modal-actions">
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
            <button className="btn primary" data-testid="ext-install-go" onClick={() => void api.extensions.install(preview.dir).then((x) => { setPreview(null); toast(`${x.name} installed`); }, (err) => toast(errorText(err)))}>Install</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
