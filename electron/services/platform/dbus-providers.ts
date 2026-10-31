// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeper's results in the Linux desktop's own search: GNOME Shell's
// Activities overview (org.gnome.Shell.SearchProvider2) and KDE's KRunner
// (org.kde.krunner1), over the session D-Bus. No Electron imports: tests run
// these against a real dbus-daemon.

import * as dbus from 'dbus-next';
import type { BrainHit } from '../../../core/brain-contract';
import {
  GNOME_BUS_NAME, GNOME_OBJECT_PATH, gnomeMetas, KRUNNER_BUS_NAME, KRUNNER_OBJECT_PATH, krunnerMatches, pathFromResultId, resultId, termsToQuery,
} from '../../../core/platform-integrations';

const { Interface } = dbus.interface;
const { Variant } = dbus;

export interface ProviderDeps {
  search(query: string, limit: number): Promise<BrainHit[]>;
  /** opens a result (the file itself) */
  open(path: string): void;
  /** opens Keeper with the search, e.g. when the person presses Enter on "more results" */
  searchInKeeper(query: string): void;
  reveal?(path: string): void;
  home?: string;
}

/** Remembers recent hits by id so GetResultMetas and ActivateResult can answer without searching again. */
class HitCache {
  private map = new Map<string, BrainHit>();
  put(hits: BrainHit[]) {
    for (const h of hits) this.map.set(resultId(h), h);
    // Keep it small: only the latest few hundred results matter.
    if (this.map.size > 500) {
      const extra = this.map.size - 500;
      let i = 0;
      for (const k of this.map.keys()) {
        if (i++ >= extra) break;
        this.map.delete(k);
      }
    }
  }
  get all() {
    return this.map;
  }
}

class GnomeProvider extends Interface {
  private cache = new HitCache();
  constructor(private d: ProviderDeps) {
    super('org.gnome.Shell.SearchProvider2');
  }
  private async find(terms: string[]): Promise<string[]> {
    const q = termsToQuery(terms);
    // Single letters flood the overview with noise; GNOME asks again as the person types.
    if (q.length < 2) return [];
    const hits = await this.d.search(q, 10).catch(() => [] as BrainHit[]);
    this.cache.put(hits);
    return hits.map(resultId);
  }
  GetInitialResultSet(terms: string[]) {
    return this.find(terms);
  }
  GetSubsearchResultSet(_previous: string[], terms: string[]) {
    return this.find(terms);
  }
  GetResultMetas(ids: string[]) {
    return gnomeMetas(ids, this.cache.all, this.d.home).map((m) => {
      const o: Record<string, InstanceType<typeof Variant>> = {
        id: new Variant('s', m.id),
        name: new Variant('s', m.name),
        description: new Variant('s', m.description),
      };
      if (m.gicon) o.gicon = new Variant('s', m.gicon);
      return o;
    });
  }
  ActivateResult(id: string) {
    const p = pathFromResultId(id);
    if (p) this.d.open(p);
  }
  LaunchSearch(terms: string[]) {
    this.d.searchInKeeper(termsToQuery(terms));
  }
}

GnomeProvider.configureMembers({
  methods: {
    GetInitialResultSet: { inSignature: 'as', outSignature: 'as' },
    GetSubsearchResultSet: { inSignature: 'asas', outSignature: 'as' },
    GetResultMetas: { inSignature: 'as', outSignature: 'aa{sv}' },
    ActivateResult: { inSignature: 'sasu', outSignature: '' },
    LaunchSearch: { inSignature: 'asu', outSignature: '' },
  },
});

class KRunner extends Interface {
  constructor(private d: ProviderDeps) {
    super('org.kde.krunner1');
  }
  Actions() {
    return [['reveal', 'Show in folder', 'folder-open']];
  }
  async Match(query: string) {
    const q = query.trim();
    if (q.length < 2) return [];
    const hits = await this.d.search(q, 12).catch(() => [] as BrainHit[]);
    return krunnerMatches(hits, this.d.home).map(([id, text, icon, type, relevance, props]) => [
      id, text, icon, type, relevance,
      { subtext: new Variant('s', String(props.subtext ?? '')), urls: new Variant('as', (props.urls as string[]) ?? []) },
    ]);
  }
  Run(id: string, action: string) {
    const p = pathFromResultId(id);
    if (!p) return;
    if (action === 'reveal' && this.d.reveal) this.d.reveal(p);
    else this.d.open(p);
  }
}

KRunner.configureMembers({
  methods: {
    Actions: { inSignature: '', outSignature: 'a(sss)' },
    Match: { inSignature: 's', outSignature: 'a(sssida{sv})' },
    Run: { inSignature: 'ss', outSignature: '' },
  },
});

export interface Exported {
  stop(): void;
}

/**
 * Claims the bus name and serves results. Fails (rejects) when there is no
 * session bus or another Keeper already serves the name.
 */
export async function exportProvider(kind: 'gnome' | 'krunner', deps: ProviderDeps, bus: dbus.MessageBus = dbus.sessionBus()): Promise<Exported> {
  const name = kind === 'gnome' ? GNOME_BUS_NAME : KRUNNER_BUS_NAME;
  const objectPath = kind === 'gnome' ? GNOME_OBJECT_PATH : KRUNNER_OBJECT_PATH;
  const iface = kind === 'gnome' ? new GnomeProvider(deps) : new KRunner(deps);
  // Errors from the connection itself (no bus) must not crash the app.
  bus.on('error', () => undefined);
  const reply = await bus.requestName(name, dbus.NameFlag.DO_NOT_QUEUE);
  if (reply !== dbus.RequestNameReply.PRIMARY_OWNER && reply !== dbus.RequestNameReply.ALREADY_OWNER) {
    bus.disconnect();
    throw new Error(`Another program already provides ${name}`);
  }
  bus.export(objectPath, iface);
  return {
    stop() {
      try {
        bus.unexport(objectPath, iface);
        void bus.releaseName(name).catch(() => undefined);
      } finally {
        bus.disconnect();
      }
    },
  };
}
