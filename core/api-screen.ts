// SPDX-License-Identifier: AGPL-3.0-or-later
// Remote screens in the interface: watch and control other Keeper devices,
// be watched (with consent), phones on this screen, Wake-on-LAN.

import type { ScreenPolicy } from './screen/consent';
import type { AirPlayPlan, AndroidDevice, MirrorOptions } from './screen/mirror';
import type { ControlMessage, HostDisplay, InputEvent, Quality, ScreenSession } from './screen/types';

export type { AndroidDevice, ControlMessage, HostDisplay, InputEvent, Quality, ScreenPolicy, ScreenSession };

export interface ScreenState {
  sessions: ScreenSession[];
  policy: ScreenPolicy;
  /** newest first: who viewed or controlled what, and for how long */
  log: { at: number; title: string }[];
  /** devices whose network card Keeper knows, so they can be woken */
  wake: Record<string, boolean>;
}

export interface ControlStatus {
  available: boolean;
  reason?: string;
  needs?: ('accessibility' | 'screenRecording')[];
}

export interface AndroidStatus {
  ready: boolean;
  version: string;
  downloading: boolean;
  progress: number;
  canDownload: boolean;
  hint?: string;
}

export interface ScreenApi {
  state(): Promise<ScreenState>;
  session(sid: string): Promise<(ScreenSession & { displays: HostDisplay[]; controlNote?: string }) | null>;
  /** start watching (and, if allowed, controlling) a paired device; opens a viewer window; returns the session id */
  view(device: string, opts?: { control?: boolean; quality?: Quality; prefer?: 'auto' | 'frames' }): Promise<string>;
  stop(sid: string): Promise<void>;
  /** answer "X wants to see this screen" */
  answer(id: string, ok: boolean, control: boolean): Promise<void>;
  setPolicy(p: Partial<ScreenPolicy>): Promise<ScreenPolicy>;
  displays(): Promise<HostDisplay[]>;
  /** for the host banner window: the capture source of the chosen display */
  source(sid: string): Promise<{ id: string; width: number; height: number } | null>;
  /** from a host or viewer window to the other side */
  signal(sid: string, m: ControlMessage): Promise<void>;
  /** a fallback JPEG frame from the host window; false = wait and try again */
  frame(sid: string, jpeg: Uint8Array, w: number, h: number): Promise<boolean>;
  input(sid: string, events: InputEvent[]): void;
  ack(sid: string, seq: number): void;
  /** a host or viewer window is listening for its session's messages */
  ready(sid: string): void;
  saveRecording(bytes: Uint8Array, name: string): Promise<string>;
  wake(device: string): Promise<{ sent: number; via: string[] }>;
  learn(device: string): Promise<boolean>;
  /** can this computer be controlled from another device, and what is missing */
  control(): Promise<ControlStatus>;
  requestPermissions(): Promise<void>;
  android(): Promise<AndroidStatus>;
  androidInstall(): Promise<string>;
  androidDevices(): Promise<AndroidDevice[]>;
  androidPair(hostPort: string, code: string): Promise<boolean>;
  androidConnect(hostPort: string): Promise<boolean>;
  androidMirror(o: MirrorOptions): Promise<boolean>;
  androidStop(serial: string): Promise<void>;
  androidDrop(serial: string, files: string[]): Promise<{ file: string; ok: boolean; error?: string }[]>;
  airplay(): Promise<AirPlayPlan & { running: boolean }>;
  airplayStart(name: string): Promise<AirPlayPlan & { running?: boolean }>;
  airplayStop(): Promise<void>;
}
