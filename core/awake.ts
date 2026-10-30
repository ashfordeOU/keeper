// SPDX-License-Identifier: AGPL-3.0-or-later
// Automatic keep-awake: conditions that start a session on their own (an
// external display, mains power, an app, a USB device, a Wi-Fi network, a VPN,
// a busy CPU, a mounted drive) and the parsers for each OS's answers.

export type TriggerKind = 'display' | 'power' | 'app' | 'usb' | 'wifi' | 'vpn' | 'cpu' | 'drive';

export interface AwakeTrigger {
  id: string;
  kind: TriggerKind;
  enabled: boolean;
  /** app name, USB device name, network name or drive name (case-insensitive, partial match) */
  value?: string;
  /** CPU percent for 'cpu' */
  threshold?: number;
  /** keep the computer running but let the screen sleep */
  allowDisplaySleep?: boolean;
}

/** What the computer looks like right now; gathered by the platform layer. */
export interface SystemSnapshot {
  externalDisplays: number;
  onPower: boolean;
  apps: string[];
  usb: string[];
  ssid?: string;
  interfaces: string[];
  cpu: number;
  volumes: string[];
}

const has = (list: string[], v: string | undefined) => !!v && list.some((x) => x.toLowerCase().includes(v.trim().toLowerCase()));

/** Tunnel interfaces most VPN clients create. */
export function isVpnInterface(name: string): boolean {
  return /^(utun\d+|tun\d*|tap\d*|wg\d*|ppp\d*|ipsec\d*|gpd\d*|nordlynx|tailscale\d*|zt\w*|proton\d*|mullvad\w*|vpn\w*)$/i.test(name);
}

export function triggerActive(t: AwakeTrigger, s: SystemSnapshot): boolean {
  if (!t.enabled) return false;
  switch (t.kind) {
    case 'display': return s.externalDisplays > 0;
    case 'power': return s.onPower;
    case 'app': return has(s.apps, t.value);
    case 'usb': return has(s.usb, t.value);
    case 'wifi': return !!s.ssid && !!t.value && s.ssid.toLowerCase() === t.value.trim().toLowerCase();
    case 'vpn': return s.interfaces.some(isVpnInterface);
    case 'cpu': return s.cpu >= (t.threshold ?? 50);
    case 'drive': return has(s.volumes, t.value);
  }
}

export function activeTriggers(list: AwakeTrigger[], s: SystemSnapshot): AwakeTrigger[] {
  return list.filter((t) => triggerActive(t, s));
}

export function describeTrigger(t: AwakeTrigger): string {
  switch (t.kind) {
    case 'display': return 'An external display is connected';
    case 'power': return 'Plugged into power';
    case 'app': return `${t.value || 'An app'} is running`;
    case 'usb': return `${t.value || 'A USB device'} is connected`;
    case 'wifi': return `On the “${t.value ?? ''}” network`;
    case 'vpn': return 'A VPN is connected';
    case 'cpu': return `The processor is above ${t.threshold ?? 50}%`;
    case 'drive': return `${t.value || 'A drive'} is mounted`;
  }
}

// ---------------------------------------------------------------- parsers

/** `nmcli -t -f active,ssid dev wifi` → the connected network. */
export function parseNmcliSsid(out: string): string | undefined {
  const line = out.split('\n').find((l) => /^yes:/i.test(l));
  return line ? line.slice(4).replace(/\\:/g, ':').trim() || undefined : undefined;
}

/** `netsh wlan show interfaces` → SSID (not BSSID). */
export function parseNetshSsid(out: string): string | undefined {
  return out.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() || undefined;
}

/** `ipconfig getsummary en0` (or `networksetup -getairportnetwork en0`) → SSID. */
export function parseMacSsid(out: string): string | undefined {
  const m = out.match(/^\s*SSID\s*:\s*(.+)$/m) ?? out.match(/Current Wi-Fi Network:\s*(.+)$/m);
  const v = m?.[1]?.trim();
  return v && v !== '<redacted>' ? v : undefined;
}

/** `lsusb` → device names. */
export function parseLsusb(out: string): string[] {
  return out.split('\n').map((l) => l.match(/ID [0-9a-f]{4}:[0-9a-f]{4}\s+(.+)$/i)?.[1]?.trim()).filter((x): x is string => !!x);
}

/** `system_profiler SPUSBDataType -json` → device names (nested hubs included). */
export function parseMacUsb(json: string): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') {
      const o = n as Record<string, unknown>;
      if (typeof o._name === 'string' && !/^USB\d|Bus$/i.test(o._name)) out.push(o._name);
      for (const v of Object.values(o)) if (typeof v === 'object') walk(v);
    }
  };
  try {
    walk(JSON.parse(json));
  } catch {
    /* not JSON */
  }
  return out;
}
