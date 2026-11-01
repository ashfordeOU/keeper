// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Where remote access shows up around the system, not only in Keeper's window:
// the tray menu, the Island, the command palette and the right-click menu.
// The Devices page stays the home for settings and details. People choose
// the places in Devices → Remote Access → "Where it shows up". Pure.

export type Surface = 'tray' | 'island' | 'palette' | 'contextMenu';

export type SurfaceItem = 'help' | 'devices' | 'sessions' | 'sendTo';

export const SURFACE_ITEMS: { id: SurfaceItem; label: string; detail: string; places: Surface[] }[] = [
  { id: 'help', label: 'Get help and Help someone', detail: 'Start a help session, or help someone with their code.', places: ['tray', 'island', 'palette'] },
  { id: 'devices', label: 'Your devices', detail: 'Each device with Send Files, View Screen and Control.', places: ['tray', 'palette'] },
  { id: 'sessions', label: 'Remote sessions in progress', detail: 'Who is watching or controlling, with Stop.', places: ['tray', 'island'] },
  { id: 'sendTo', label: 'Send to a device', detail: 'Send a file to one of your devices from its right-click menu.', places: ['contextMenu', 'palette'] },
];

export const SURFACE_LABELS: Record<Surface, string> = { tray: 'Menu bar / tray', island: 'Island', palette: 'Command palette', contextMenu: 'Right-click menu' };

/** Everything everywhere it can go, unless the person said otherwise. */
export const DEFAULT_SURFACES: Record<SurfaceItem, Surface[]> = Object.fromEntries(SURFACE_ITEMS.map((i) => [i.id, [...i.places]])) as Record<SurfaceItem, Surface[]>;

export function surfaceOn(chosen: Partial<Record<string, string[]>> | undefined, item: SurfaceItem, place: Surface): boolean {
  const def = SURFACE_ITEMS.find((i) => i.id === item);
  if (!def?.places.includes(place)) return false;
  const list = chosen?.[item];
  return list ? list.includes(place) : true;
}

/** The setting after switching one place for one item. */
export function toggleSurface(chosen: Partial<Record<string, string[]>> | undefined, item: SurfaceItem, place: Surface, on: boolean): Record<string, string[]> {
  const cur = chosen?.[item] ?? DEFAULT_SURFACES[item];
  const next = on ? [...new Set([...cur, place])] : cur.filter((p) => p !== place);
  return { ...(chosen as Record<string, string[]> | undefined), [item]: next };
}

export interface TrayDevice {
  id: string;
  name: string;
  online: boolean;
  via?: string;
  canView: boolean;
}

export interface TraySession {
  id: string;
  peerName: string;
  role: 'host' | 'viewer';
  control: boolean;
  help?: boolean;
}

export type TrayEntry = { label: string; action?: string; arg?: string; enabled?: boolean; submenu?: TrayEntry[] } | { separator: true };

/**
 * The tray's remote-access entries: sessions first (they need a Stop at
 * hand), then devices, then help. `action` names what the click does.
 */
export function trayEntries(o: { surfaces?: Partial<Record<string, string[]>>; devices: TrayDevice[]; sessions: TraySession[]; helpOn: boolean; helpWaiting?: string; screenOn: boolean }): TrayEntry[] {
  const out: TrayEntry[] = [];
  if (surfaceOn(o.surfaces, 'sessions', 'tray')) {
    for (const s of o.sessions) {
      const what = s.role === 'host' ? `${s.peerName} is ${s.control ? 'controlling' : 'viewing'} this screen` : `Watching ${s.peerName}`;
      out.push({ label: `Stop: ${what}`, action: 'stopSession', arg: s.id });
    }
  }
  if (surfaceOn(o.surfaces, 'devices', 'tray') && o.devices.length) {
    out.push({
      label: 'Devices',
      submenu: o.devices.slice(0, 20).map((d) => ({
        label: `${d.online ? '● ' : '○ '}${d.name}${d.online && d.via ? ` (${d.via})` : ''}`,
        submenu: [
          { label: 'Send Files…', action: 'sendFiles', arg: d.id, enabled: d.online },
          ...(o.screenOn && d.canView ? [{ label: 'View Screen', action: 'view', arg: d.id, enabled: d.online }, { label: 'Control', action: 'control', arg: d.id, enabled: d.online }] : []),
          { separator: true as const },
          { label: 'Details…', action: 'details', arg: d.id },
        ],
      })),
    });
  }
  if (o.helpOn && surfaceOn(o.surfaces, 'help', 'tray')) {
    out.push(o.helpWaiting ? { label: `Help code ${o.helpWaiting} · Stop`, action: 'helpStop' } : { label: 'Get Help…', action: 'helpStart' });
    out.push({ label: 'Help Someone…', action: 'helpSomeone' });
  }
  return out.length ? [{ separator: true }, ...out] : [];
}
