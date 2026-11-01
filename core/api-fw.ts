// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's firewall as the interface and the command line see it.

import type { ListInfo } from './fw/blocklist';
import type { Upstream } from './fw/dns';
import type { Capabilities } from './fw/enforce';
import type { AlertScope, Conn, FwRule, FwState, Mode, Profile, RuleGroup, TidyNote } from './fw/rules';

export interface FwSettings {
  /** enforce rules through the system (needs the administrator once per change) */
  enforce: boolean;
  /** block outbound connections that no rule allows (Windows and Linux) */
  defaultBlock: boolean;
  /** ask about new connections (alerts) */
  alerts: boolean;
  /** DNS filter: blocklists, host rules and encrypted DNS */
  dnsFilter: boolean;
  /** port the filter listens on; 53 needs the helper */
  dnsPort: number;
  upstream: string;
  customUpstreams: Upstream[];
  lists: ListInfo[];
  /** keep a traffic history (up to a year, on this computer) */
  history: boolean;
  /** tell me when an app sends far more than usual */
  unusual: boolean;
  /** a sound when a rule with a sound decides a connection */
  sounds: Record<string, 'tick' | 'chime' | 'buzz' | 'data'>;
  /** sounds follow the amount of data (higher pitch for more) */
  soundByData: boolean;
}

export interface FwAlert {
  id: string;
  t: number;
  conn: Conn;
  /** what Keeper could find out about the other end */
  reverse?: string;
  service?: string;
  country?: string;
  asn?: string;
  /** "would have been blocked": seen by the monitor, not held by the system */
  monitorOnly: boolean;
  /** how many times this app tried this since the alert came up */
  attempts: number;
}

export interface FwEvent {
  t: number;
  kind: 'allowed' | 'denied' | 'would-deny' | 'asked' | 'unusual' | 'applied' | 'error';
  app?: string;
  host?: string;
  ip?: string;
  port?: number;
  ruleId?: string;
  message: string;
  bytes?: number;
}

export interface FwConnection {
  key: string;
  app: string;
  appPath?: string;
  signer?: string;
  host?: string;
  ip?: string;
  port?: number;
  proto?: string;
  country?: string;
  asn?: string;
  service?: string;
  rateIn: number;
  rateOut: number;
  bytesIn?: number;
  bytesOut?: number;
  decision: 'allow' | 'deny' | 'ask';
  ruleId?: string;
  reason: string;
  path?: string;
}

export interface FwStatus {
  platform: string;
  caps: Capabilities;
  state: FwState;
  settings: FwSettings;
  /** where enforcement stands */
  enforcement: { active: boolean; backend: string; message?: string; appliedAt?: number };
  dns: { running: boolean; port?: number; upstream: string; queries: number; blocked: number; listsEntries: number; error?: string; doqAvailable: boolean };
  pending: FwAlert[];
  recent: FwEvent[];
  upstreams: Upstream[];
}

export interface FwApi {
  status(): Promise<FwStatus>;
  setSettings(patch: Partial<FwSettings>): Promise<FwStatus>;
  setMode(mode: Mode): Promise<FwStatus>;
  setProfile(id: string): Promise<FwStatus>;
  saveProfile(p: Profile): Promise<FwStatus>;
  removeProfile(id: string): Promise<FwStatus>;
  setAutoSwitch(on: boolean): Promise<FwStatus>;
  saveRule(groupId: string, rule: FwRule): Promise<FwStatus>;
  removeRule(groupId: string, ruleId: string): Promise<FwStatus>;
  saveGroup(g: Omit<RuleGroup, 'rules'> & { rules?: FwRule[] }): Promise<FwStatus>;
  removeGroup(id: string): Promise<FwStatus>;
  subscribe(url: string, name?: string): Promise<FwStatus>;
  refreshSubscriptions(): Promise<FwStatus>;
  tidy(): Promise<TidyNote[]>;
  exportRules(groupIds?: string[]): Promise<string | null>;
  importRules(): Promise<{ imported: number; problems: string[] } | null>;
  answer(alertId: string, verdict: 'allow' | 'deny', scope: AlertScope, opts?: { anyPort?: boolean; wholeDomain?: boolean; anyHost?: boolean }): Promise<FwStatus>;
  connections(): Promise<FwConnection[]>;
  history(from: number, to: number, app?: string): Promise<{ points: { t: number; inB: number; outB: number }[]; apps: { app: string; inB: number; outB: number }[] }>;
  queryLog(limit?: number): Promise<import('./fw/dns').QueryLogEntry[]>;
  setDomain(domain: string, verdict: 'allow' | 'deny' | null): Promise<FwStatus>;
  refreshLists(): Promise<FwStatus>;
  addList(url: string, name?: string): Promise<FwStatus>;
  apply(): Promise<FwStatus>;
  uninstall(): Promise<FwStatus>;
  /** test hook (only with KEEPER_FW_FAKE): pretend the system blocked or saw a connection */
  testInject?(c: Partial<Conn> & { host?: string; ip: string; port: number }): Promise<void>;
}
