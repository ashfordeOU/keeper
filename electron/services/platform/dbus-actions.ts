// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's actions on the Linux session bus, for desktop assistants,
// launchers and scripts: org.ashfordeou.Keeper.Actions at
// /org/ashfordeou/Keeper/Actions.
//
//   ListActions() → a(sss)            id, title, what it does
//   Run(s id, a{sv} params) → s       e.g. Run("open-page", {"page": <"health">})
//   Ask(s question) → s               an answer from Keeper's Assistant
//   Search(s query, u limit) → as     file paths
//
// gdbus call --session --dest org.ashfordeou.Keeper.Actions \
//   --object-path /org/ashfordeou/Keeper/Actions \
//   --method org.ashfordeou.Keeper.Actions.Ask "when does my passport expire?"
//
// No Electron imports: tests run this against a real dbus-daemon.

import * as dbus from 'dbus-next';
import { ACTIONS } from '../../../core/automation';

const { Interface } = dbus.interface;

export const ACTIONS_BUS_NAME = 'org.ashfordeou.Keeper.Actions';
export const ACTIONS_OBJECT_PATH = '/org/ashfordeou/Keeper/Actions';

export interface ActionsDeps {
  /** opens a keeper:// link in the running app */
  openUrl(url: string): void;
  ask(question: string): Promise<string>;
  search(query: string, limit: number): Promise<string[]>;
}

/** Keeper's one list of actions (core/automation.ts), as the bus lists them. */
export const LINUX_ACTIONS: [id: string, title: string, description: string, link?: (p: Record<string, string>) => string][] = ACTIONS.map((a) => [
  a.id,
  a.title,
  a.args.length ? `${a.what} params: ${a.args.map((x) => x.name).join(', ')}` : a.what,
  (p: Record<string, string>) => a.link(p),
]);

/** D-Bus variants → plain strings (numbers and booleans included). */
export function plainParams(params: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    const val = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v;
    if (val === undefined || val === null || typeof val === 'object') continue;
    out[k] = String(val);
  }
  return out;
}

class KeeperActions extends Interface {
  constructor(private d: ActionsDeps) {
    super(ACTIONS_BUS_NAME);
  }
  ListActions() {
    return LINUX_ACTIONS.map(([id, title, desc]) => [id, title, desc]);
  }
  Run(id: string, params: Record<string, unknown>) {
    const a = LINUX_ACTIONS.find(([x]) => x === id);
    if (!a || !a[3]) throw new dbus.DBusError(`${ACTIONS_BUS_NAME}.UnknownAction`, `No action called ${id}`);
    this.d.openUrl(a[3](plainParams(params)));
    return 'ok';
  }
  async Ask(question: string) {
    if (!question.trim()) throw new dbus.DBusError(`${ACTIONS_BUS_NAME}.Empty`, 'Ask needs a question');
    return this.d.ask(question);
  }
  async Search(query: string, limit: number) {
    return this.d.search(query, Math.max(1, Math.min(100, limit || 10)));
  }
}

KeeperActions.configureMembers({
  methods: {
    ListActions: { inSignature: '', outSignature: 'a(sss)' },
    Run: { inSignature: 'sa{sv}', outSignature: 's' },
    Ask: { inSignature: 's', outSignature: 's' },
    Search: { inSignature: 'su', outSignature: 'as' },
  },
});

/** Claims the name and serves the actions; rejects when there is no session bus or the name is taken. */
export async function exportActions(deps: ActionsDeps, bus: dbus.MessageBus = dbus.sessionBus()): Promise<{ stop(): void }> {
  bus.on('error', () => undefined);
  const reply = await bus.requestName(ACTIONS_BUS_NAME, dbus.NameFlag.DO_NOT_QUEUE);
  if (reply !== dbus.RequestNameReply.PRIMARY_OWNER && reply !== dbus.RequestNameReply.ALREADY_OWNER) {
    bus.disconnect();
    throw new Error(`Another program already provides ${ACTIONS_BUS_NAME}`);
  }
  const iface = new KeeperActions(deps);
  bus.export(ACTIONS_OBJECT_PATH, iface);
  return {
    stop() {
      try {
        bus.unexport(ACTIONS_OBJECT_PATH, iface);
        void bus.releaseName(ACTIONS_BUS_NAME).catch(() => undefined);
      } finally {
        bus.disconnect();
      }
    },
  };
}
