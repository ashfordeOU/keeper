// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Island's tools as the interface sees them: Ask, AI usage, sales,
// stocks, notes, to-dos, teleprompter scripts, shortcuts and shelf copies.

import type { IslandToolsStore } from './island-tools/notes';
import type { Point, Quote } from './island-tools/stocks';
import type { SalesProvider, SalesSummary } from './island-tools/sales';
import type { UsageReport, UsageTool } from './island-tools/usage';
import type { Rates } from './island-tools/units';

export interface IslandShortcut {
  /** 'shortcut' = a macOS Shortcut; 'rule' = a Keeper automation; 'script' = a command from Island settings */
  kind: 'shortcut' | 'rule' | 'script';
  id: string;
  name: string;
  detail?: string;
}

export interface SalesConfigView {
  providers: { id: SalesProvider; label: string; keyHint: string; needsShop?: boolean; connected: boolean; shop?: string }[];
  currency: string;
  convert: boolean;
  ping: boolean;
}

export interface IslandToolsApi {
  store(): Promise<IslandToolsStore>;
  saveStore(patch: Partial<IslandToolsStore>): Promise<IslandToolsStore>;

  /** chat with any connected AI about some text; local-only is respected */
  ask(prompt: string, input?: string, connection?: string): Promise<{ text: string; provider: string; local: boolean }>;
  /** `os` marks the computer's own model, picked first when it is there */
  askConnections(): Promise<{ id: string; label: string; local: boolean; ready: boolean; os?: boolean }[]>;

  usage(): Promise<UsageReport[]>;
  /** allow (or stop) asking a provider for exact limits with the tool's own sign-in */
  setUsageOnline(tool: UsageTool, on: boolean): Promise<void>;
  usageOnline(): Promise<Partial<Record<UsageTool, boolean>>>;

  salesConfig(): Promise<SalesConfigView>;
  setSalesProvider(id: SalesProvider, key: string, shop?: string): Promise<SalesConfigView>;
  removeSalesProvider(id: SalesProvider): Promise<SalesConfigView>;
  setSalesPrefs(p: { currency?: string; convert?: boolean; ping?: boolean }): Promise<SalesConfigView>;
  sales(force?: boolean): Promise<SalesSummary & { errors: { provider: SalesProvider; message: string }[]; fetchedAt: number }>;

  rates(base: string): Promise<Rates | null>;

  quotes(symbols: string[]): Promise<{ quotes: Quote[]; errors: string[] }>;
  chart(symbol: string): Promise<Point[]>;
  stocksKey(): Promise<boolean>;
  setStocksKey(key: string): Promise<boolean>;

  shortcuts(): Promise<IslandShortcut[]>;
  runShortcut(kind: IslandShortcut['kind'], id: string): Promise<{ ok: boolean; message: string }>;

  /** a text, Markdown or Word file's text for the teleprompter */
  importScript(path?: string): Promise<{ title: string; text: string } | null>;

  /** macOS Calendar events in a range (ms); empty off a Mac or without access */
  macEvents(from: number, to: number): Promise<MacEvent[]>;
  /** open macOS Reminders; empty off a Mac or without access */
  macReminders(): Promise<MacReminder[]>;
  setMacReminder(id: string, done: boolean): Promise<boolean>;
}

export interface MacEvent { id: string; title: string; start: number; end: number; allDay: boolean; calendar: string; location?: string; url?: string; notes?: string }
export interface MacReminder { id: string; title: string; done: boolean; list: string; due?: number }
