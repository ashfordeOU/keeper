// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Remote Desktops in the interface ↔ main-process contract (window.keeper.rdc).

import type { EngineInfo } from './engines';
import type { Format } from './formats';
import type { HostId, HostStatus } from './hosting';
import type { RdcPlaces, TrayEntry } from './places';
import type { FrameOp } from './rfb';
import type { ConnectResult, Connection, Online, ProbeResult, RdcSession } from './types';

export interface RdcState {
  connections: Connection[];
  sessions: RdcSession[];
  /** the system keychain works here (otherwise passwords are asked every time) */
  keychain: boolean;
  platform: 'win32' | 'darwin' | 'linux';
}

export interface QuickResult {
  /** a connection ready to open (not saved) */
  conn?: Connection;
  /** what answered when the protocol had to be guessed */
  probed?: ProbeResult[];
  message?: string;
}

/** A VNC picture update for one viewer. */
export interface VncFrame {
  sid: string;
  seq: number;
  ops: FrameOp[];
}

export interface VncInput {
  t: 'key' | 'pointer';
  keysym?: number;
  down?: boolean;
  x?: number;
  y?: number;
  buttons?: number;
}

/** What a Remote Desktop tab needs to start its engine (main → tab only). */
export interface RdpAttach {
  sid: string;
  name: string;
  /** the local relay (ws://127.0.0.1:port/rdp/token) */
  url: string;
  /** this session's random token, checked by the relay */
  token: string;
  /** host:port as the relay expects the engine to name it */
  destination: string;
  /** 'missing' while the engine downloads (the tab shows the progress) */
  engine: 'ready' | 'missing' | 'unavailable';
  engineUrl: string;
  user: string;
  domain: string;
  password: string;
  via?: string;
  options: { width?: number; height?: number; fullscreen?: boolean; dynamicResolution?: boolean; clipboard: boolean; nla: boolean; keyboard: 'keys' | 'letters'; audio?: 'local' | 'remote' | 'off' };
}

export interface RdcApi {
  state(): Promise<RdcState>;
  save(c: Partial<Connection> & { name: string; protocol: Connection['protocol']; host: string }): Promise<Connection>;
  remove(ids: string[]): Promise<void>;
  duplicate(id: string): Promise<Connection>;
  /** stores (or with null forgets) a connection's password in the system keychain; false when there is no keychain */
  setPassword(id: string, password: string | null): Promise<boolean>;
  /** what the quick-connect bar's text means (probing ports when it has to guess) */
  quick(text: string): Promise<QuickResult>;
  probe(host: string, ports?: number[]): Promise<ProbeResult[]>;
  /** opens a saved connection (id) or one made on the spot */
  connect(target: string | Connection, opts?: { password?: string; user?: string; external?: boolean; trustKey?: string; trustCert?: string }): Promise<ConnectResult>;
  disconnect(sid: string): Promise<void>;
  /** the exact program and arguments a connection would use (passwords never appear) */
  command(target: string | Connection): Promise<{ file: string; args: string[]; engine: string; note?: string; stdin: boolean; files: string[] } | { error: string }>;
  // ---- VNC in a tab
  /** a viewer starts showing a session: picture size, then frames through 'rdc-frame' */
  vncAttach(sid: string): Promise<{ width: number; height: number; desktop: string; viewOnly: boolean } | null>;
  vncDetach(sid: string): void;
  vncInput(sid: string, events: VncInput[]): void;
  /** the viewer drew frame `seq`; the next one may come */
  vncAck(sid: string, seq: number): void;
  vncClipboard(sid: string, text: string): Promise<void>;
  vncKeys(sid: string, combo: string): Promise<void>;
  vncSetViewOnly(sid: string, on: boolean): Promise<void>;
  // ---- Remote Desktop in a tab
  /** the relay, token and sign-in for the tab's engine (null when the session has gone) */
  rdpAttach(sid: string): Promise<RdpAttach | null>;
  /** the engine's session ended; with a reason when it failed */
  rdpEnded(sid: string, why?: string): Promise<void>;
  /** a password typed in the tab after a failed sign-in */
  rdpSignIn(sid: string, password: string, remember: boolean): Promise<boolean>;
  /** the engine cannot run here: open the same connection in the outside app */
  rdpFallback(sid: string, why: string): Promise<ConnectResult>;
  // ---- web consoles in a tab
  /** places (or, with null, hides) the console page over the tab's area, in CSS pixels */
  webShow(sid: string, rect: { x: number; y: number; width: number; height: number } | null): Promise<{ url: string; title: string; cert?: { fingerprint: string; trusted: boolean } } | null>;
  webAction(sid: string, action: 'back' | 'forward' | 'reload' | 'home' | 'external'): Promise<void>;
  // ---- status, wake, files
  /** status dots: Keeper knocks on each connection's port while the page is open */
  watch(on: boolean): Promise<Record<string, Online>>;
  wake(id: string): Promise<{ sent: number }>;
  importFile(path?: string): Promise<{ added: Connection[]; secrets: number; skipped: number } | null>;
  importText(text: string, format?: Format, fileName?: string): Promise<{ added: Connection[]; secrets: number; skipped: number }>;
  exportTo(ids: string[], format: Format): Promise<string | null>;
  exportText(ids: string[], format: Format): Promise<string>;
  engines(refresh?: boolean): Promise<EngineInfo[]>;
  // ---- this computer
  hostStatus(): Promise<HostStatus>;
  hostSet(id: HostId, on: boolean, opts?: { password?: string; localOnly?: boolean }): Promise<{ ok: boolean; message: string; manual?: string[] }>;
  hostFix(check: 'nla' | 'lockout'): Promise<{ ok: boolean; message: string }>;
  /** lets a paired device reach this computer's remote desktop ports through Keeper Link (or stops it) */
  hostViaLink(device: string, on: boolean): Promise<{ ok: boolean; message: string }>;
  // ---- where Remote Desktops appear (shortcut, palette, tray, file manager, tabs or windows)
  places(): Promise<RdcPlaces>;
  setPlaces(p: Partial<RdcPlaces>): Promise<RdcPlaces>;
  /** the tray menu's Remote Desktops part as it is now */
  trayPreview(): Promise<TrayEntry[]>;
  /** the quick-connect window (also behind the global shortcut) */
  showQuick(): Promise<void>;
  closeQuick(): Promise<void>;
  /** opens a session's page where the person chose: a tab of the main window or a window of its own */
  openRoute(route: { name: string; arg?: string; q?: string }): Promise<void>;
  /** opens a .rdp or .vnc file (what a double-click in the file manager does) */
  openFile(path: string): Promise<ConnectResult | null>;
}

export interface RdcEvents {
  'rdc-changed': () => void;
  'rdc-status': (s: Record<string, Online>) => void;
  'rdc-frame': (f: VncFrame) => void;
  'rdc-vnc': (sid: string, e: { t: 'resize'; width: number; height: number } | { t: 'cursor'; hotX: number; hotY: number; w: number; h: number; rgba: Uint8Array } | { t: 'clipboard'; text: string } | { t: 'bell' } | { t: 'closed'; error?: string }) => void;
  'rdc-web': (sid: string, e: { t: 'title'; title: string; url: string } | { t: 'cert'; fingerprint: string; host: string }) => void;
}
