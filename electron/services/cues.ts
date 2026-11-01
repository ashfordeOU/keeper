// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Cues: notes, checklists, links and files tied to an app, a site, a page, a
// project (window title) or a file, and/or a time. Each cue is a Markdown
// file in one folder (Documents/Keeper Cues by default), so Keeper Sync can
// carry it to other devices, any editor can open it, and search finds it.
//
// What is in front comes from fg-watch (app and window title; held only while
// a cue is tied to a place) and from the browser extension (the page). Timed
// cues use one timer set to the next due time; nothing polls.

import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp, watch, type FSWatcher } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defaultCueSettings, normalizeCueSettings, type CueInput, type CueSettings, type CueState } from '../../core/cues/api';
import { buildPhraseModel, filterCues, suggest as suggestPhrase, type CueFilter, type CueSort, type PhraseModel } from '../../core/cues/dashboard';
import { cueFileName, cueFromMarkdown, cueToMarkdown, exportMarkdown, idFromFileName, templateFromMarkdown, templateToMarkdown } from '../../core/cues/markdown';
import {
  anchorsFor, complete, cueFromDraft, cuesFor, dedupeAnchors, dueNow, leftPlace, nextWake, newId, parseCueInput, placeKey, purgeOld, reopen, restore, shouldHint, skipItem,
  snooze, softDelete, startRun, toggleItem, type Cue, type CueAnchor, type CueTemplate, type FrontContext, type SnoozeChoice,
} from '../../core/cues/model';
import { isBrowser } from '../../core/island-calls';
import { allTabs } from './browser-tabs';
import { frontWatchAvailable, frontWindow, holdFrontWatch, onFrontWindow, type FrontWindow } from './fg-watch';

export interface CueHooks {
  /** show these cues beside the window in front (or the composer when `compose` is set) */
  popup(cues: Cue[], front: FrontWindow | undefined, compose?: { text?: string; attach?: CueAnchor['kind'][] }): void;
  closePopup(): void;
  /** a system notification for a due cue */
  notify(cue: Cue): void;
  /** a quiet Island alert */
  island(kind: 'due' | 'here' | 'hint', title: string, detail: string, ref?: string): void;
  /** tell windows that cues changed */
  changed(): void;
}

const TEMPLATES_DIR = 'Checklists';

export class CuesService {
  cues: Cue[] = [];
  templates: CueTemplate[] = [];
  settings: CueSettings = defaultCueSettings();
  folder = '';
  front?: FrontContext;
  showing: string[] = [];
  private files = new Map<string, string>();
  private tplFiles = new Map<string, string>();
  private written = new Map<string, string>();
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private wakeTimer?: NodeJS.Timeout;
  private hintTimer?: NodeJS.Timeout;
  private releaseFront?: () => void;
  private offFront?: () => void;
  private lastPlace = '';
  private browserCtx?: { url: string; title: string; at: number };
  private lastHintAt?: number;
  private model?: PhraseModel;
  private evalTimer?: NodeJS.Timeout;
  private running = false;
  private settingsFile = path.join(app.getPath('userData'), 'cues-settings.json');

  constructor(public hooks: CueHooks) {}

  // ---------------------------------------------------------------- start, stop, files

  async start() {
    if (this.running) return;
    this.running = true;
    try {
      this.settings = normalizeCueSettings(JSON.parse(await fsp.readFile(this.settingsFile, 'utf8')));
    } catch {
      this.settings = defaultCueSettings();
    }
    await this.openFolder();
    this.offFront = onFrontWindow((w) => this.onFront(w));
    this.housekeep();
  }

  stop() {
    this.running = false;
    this.watcher?.close();
    this.watcher = undefined;
    clearTimeout(this.reloadTimer);
    clearTimeout(this.wakeTimer);
    clearTimeout(this.hintTimer);
    clearTimeout(this.evalTimer);
    this.releaseFront?.();
    this.releaseFront = undefined;
    this.offFront?.();
    this.hooks.closePopup();
  }

  private folderPath(): string {
    if (this.settings.folder.trim()) return this.settings.folder.trim();
    // Linux without XDG folders reports the home folder itself as Documents.
    let docs = '';
    try { docs = app.getPath('documents'); } catch { /* no such folder */ }
    if (!docs || path.resolve(docs) === path.resolve(os.homedir())) docs = path.join(os.homedir(), 'Documents');
    return path.join(docs, 'Keeper Cues');
  }

  private async openFolder() {
    this.watcher?.close();
    this.folder = this.folderPath();
    await fsp.mkdir(path.join(this.folder, TEMPLATES_DIR), { recursive: true });
    await this.reload();
    try {
      // Changes from Keeper Sync or another editor are read again shortly after.
      this.watcher = watch(this.folder, { recursive: process.platform !== 'linux' }, () => {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => void this.reload().then(() => this.hooks.changed()), 400);
      });
    } catch {
      /* not watchable: changes from elsewhere show after a restart */
    }
  }

  private async reload() {
    const cues: Cue[] = [];
    const files = new Map<string, string>();
    for (const name of await fsp.readdir(this.folder).catch(() => [] as string[])) {
      if (!name.endsWith('.md')) continue;
      const text = await fsp.readFile(path.join(this.folder, name), 'utf8').catch(() => '');
      const c = cueFromMarkdown(text, idFromFileName(name));
      if (!c) continue;
      // Two copies of one cue (a sync conflict): the newer wins.
      const prev = cues.findIndex((x) => x.id === c.id);
      if (prev >= 0) { if (cues[prev].updatedAt >= c.updatedAt) continue; cues.splice(prev, 1); }
      cues.push(c);
      files.set(c.id, name);
    }
    const templates: CueTemplate[] = [];
    const tplFiles = new Map<string, string>();
    const tdir = path.join(this.folder, TEMPLATES_DIR);
    for (const name of await fsp.readdir(tdir).catch(() => [] as string[])) {
      if (!name.endsWith('.md')) continue;
      const t = templateFromMarkdown(await fsp.readFile(path.join(tdir, name), 'utf8').catch(() => ''), idFromFileName(name));
      if (t && t.id) { templates.push(t); tplFiles.set(t.id, name); }
    }
    this.cues = cues;
    this.files = files;
    this.templates = templates.sort((a, b) => (b.usedAt ?? b.createdAt) - (a.usedAt ?? a.createdAt));
    this.tplFiles = tplFiles;
    this.model = undefined;
    this.housekeep();
  }

  private async write(c: Cue) {
    const name = cueFileName(c);
    const old = this.files.get(c.id);
    const text = cueToMarkdown(c);
    this.written.set(name, createHash('sha1').update(text).digest('hex'));
    await fsp.writeFile(path.join(this.folder, name), text);
    if (old && old !== name) await fsp.rm(path.join(this.folder, old), { force: true });
    this.files.set(c.id, name);
  }

  private async put(c: Cue): Promise<Cue> {
    const i = this.cues.findIndex((x) => x.id === c.id);
    if (i >= 0) this.cues[i] = c; else this.cues.unshift(c);
    this.model = undefined;
    await this.write(c);
    this.housekeep();
    this.hooks.changed();
    return c;
  }

  get(id: string): Cue {
    const c = this.cues.find((x) => x.id === id);
    if (!c) throw new Error('That cue is gone');
    return c;
  }

  // ---------------------------------------------------------------- the API

  state(): CueState {
    return {
      cues: this.cues, templates: this.templates, settings: this.settings, folder: this.folder, front: this.front, offered: this.front ? anchorsFor(this.front) : [],
      showing: this.showing, watcher: this.watcherText(), browserLinked: !!this.browserCtx || this.browserTabs().length > 0,
    };
  }

  private watcherText(): string {
    if (!frontWatchAvailable()) return process.platform === 'linux' ? 'This desktop (Wayland) does not tell apps which window is in front, so app and window cues show only in the Island; page and site cues work with the browser extension.' : 'The window watcher could not start; app cues show only in the Island.';
    return process.platform === 'darwin' ? 'Keeper asks macOS which app is in front every 2 seconds while a cue is tied to a place.'
      : process.platform === 'win32' ? 'One small helper reports the window in front every 2 seconds while a cue is tied to a place.'
        : 'The X server tells Keeper when the window in front changes.';
  }

  list(o: { filter?: CueFilter; q?: string; sort?: CueSort } = {}): Cue[] {
    return filterCues(this.cues, o);
  }

  private resolveAnchors(input: CueInput, fromText: CueAnchor[]): CueAnchor[] {
    const offered = this.front ? anchorsFor(this.front) : [];
    const attached = (input.attach ?? []).map((k) => offered.find((a) => a.kind === k)).filter((a): a is CueAnchor => !!a);
    return dedupeAnchors([...(input.anchors ?? []), ...fromText, ...attached]);
  }

  async create(input: CueInput): Promise<Cue> {
    const now = Date.now();
    const draft = parseCueInput(input.text ?? input.title ?? '', now);
    const c = cueFromDraft({
      ...draft,
      title: input.title && input.text ? input.title : draft.title,
      body: input.body ?? draft.body,
      type: input.type ?? (input.files?.length ? 'file' : draft.type),
      items: input.items ?? draft.items,
      url: input.url ?? draft.url,
      due: input.due === null ? undefined : input.due ?? draft.due,
      repeat: input.repeat === null ? undefined : input.repeat ?? draft.repeat,
      anchors: this.resolveAnchors(input, draft.anchors),
    }, now, { files: input.files, show: input.show ?? 'every', tags: input.tags, pinned: input.pinned });
    // Made right here: it is already "shown" for this visit.
    if (c.anchors.some((a) => this.front && anchorsFor(this.front).some((o) => o.kind === a.kind && o.value === a.value))) c.shownAt = now;
    return this.put(c);
  }

  async update(id: string, patch: CueInput & { items?: string[] }): Promise<Cue> {
    const c = this.get(id);
    const now = Date.now();
    const items = patch.items ? patch.items.map((text, i) => c.items?.find((x) => x.text === text) ?? { id: `i${i}${newId(now).slice(-4)}`, text, done: false }) : c.items;
    const next: Cue = {
      ...c, title: patch.title ?? c.title, body: patch.body ?? c.body, type: patch.type ?? c.type, items, url: patch.url ?? c.url, files: patch.files ?? c.files,
      due: patch.due === null ? undefined : patch.due ?? c.due, repeat: patch.repeat === null ? undefined : patch.repeat ?? c.repeat,
      anchors: patch.anchors ? dedupeAnchors(patch.anchors) : patch.attach ? this.resolveAnchors({ ...patch, anchors: c.anchors }, []) : c.anchors,
      show: patch.show ?? c.show, tags: patch.tags ?? c.tags, pinned: patch.pinned ?? c.pinned, rangFor: patch.due !== undefined ? undefined : c.rangFor, updatedAt: now,
    };
    return this.put(next);
  }

  toggleItem(id: string, itemId: string) { return this.put(toggleItem(this.get(id), itemId)); }
  skipItem(id: string, itemId: string) { return this.put(skipItem(this.get(id), itemId)); }
  complete(id: string) { return this.put(complete(this.get(id))); }
  reopen(id: string) { return this.put(reopen(this.get(id))); }
  snooze(id: string, choice: SnoozeChoice | number) { this.showing = this.showing.filter((x) => x !== id); return this.put(snooze(this.get(id), choice)); }
  restore(id: string) { return this.put(restore(this.get(id))); }

  async remove(id: string) {
    this.showing = this.showing.filter((x) => x !== id);
    await this.put(softDelete(this.get(id)));
  }

  async purge(id: string) {
    const name = this.files.get(id);
    this.cues = this.cues.filter((c) => c.id !== id);
    this.files.delete(id);
    if (name) await fsp.rm(path.join(this.folder, name), { force: true });
    this.hooks.changed();
  }

  /** Closed in the popup: quiet for this visit (it comes back next time, after the cool-down). */
  async dismiss(id: string) {
    this.showing = this.showing.filter((x) => x !== id);
    const c = this.cues.find((x) => x.id === id);
    if (c) await this.put({ ...c, shownAt: Date.now() });
    if (!this.showing.length) this.hooks.closePopup();
  }

  async saveTemplate(t: Partial<CueTemplate> & { name: string; items: string[] }): Promise<CueTemplate> {
    const now = Date.now();
    const tpl: CueTemplate = { id: t.id ?? newId(now), name: t.name.trim() || 'Checklist', items: t.items.map((s) => s.trim()).filter(Boolean), anchors: t.anchors, createdAt: t.createdAt ?? now, usedAt: t.usedAt };
    const name = `${tpl.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').trim().slice(0, 60)} (${tpl.id}).md`;
    const old = this.tplFiles.get(tpl.id);
    await fsp.writeFile(path.join(this.folder, TEMPLATES_DIR, name), templateToMarkdown(tpl));
    if (old && old !== name) await fsp.rm(path.join(this.folder, TEMPLATES_DIR, old), { force: true });
    this.tplFiles.set(tpl.id, name);
    this.templates = [tpl, ...this.templates.filter((x) => x.id !== tpl.id)];
    this.hooks.changed();
    return tpl;
  }

  async removeTemplate(id: string) {
    const name = this.tplFiles.get(id);
    if (name) await fsp.rm(path.join(this.folder, TEMPLATES_DIR, name), { force: true });
    this.templates = this.templates.filter((t) => t.id !== id);
    this.tplFiles.delete(id);
    this.hooks.changed();
  }

  async startTemplate(id: string, o: { skip?: number[]; attach?: CueAnchor['kind'][] } = {}): Promise<Cue> {
    const t = this.templates.find((x) => x.id === id);
    if (!t) throw new Error('That checklist is gone');
    const anchors = o.attach ? this.resolveAnchors({ attach: o.attach }, []) : undefined;
    const run = startRun(t, Date.now(), { skip: o.skip, anchors });
    await this.saveTemplate({ ...t, usedAt: Date.now() });
    return this.put(run);
  }

  parse(text: string) {
    return parseCueInput(text);
  }

  suggest(typed: string): string {
    if (!this.settings.suggestions) return '';
    this.model ??= buildPhraseModel(this.cues);
    return suggestPhrase(this.model, typed);
  }

  async setSettings(patch: Partial<CueSettings>): Promise<CueSettings> {
    const folderBefore = this.folderPath();
    this.settings = normalizeCueSettings({ ...this.settings, ...patch });
    await fsp.writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2));
    if (this.folderPath() !== folderBefore) await this.openFolder();
    this.housekeep();
    this.hooks.changed();
    return this.settings;
  }

  exportAll(): string {
    return exportMarkdown(this.cues);
  }

  // ---------------------------------------------------------------- what is in front

  /** The browser extension says which page is in front (focus or tab change). */
  browserActive(url: string, title: string) {
    this.browserCtx = { url, title, at: Date.now() };
    this.scheduleEval();
  }

  private browserTabs(): { url: string; title: string; active?: boolean; focused?: boolean }[] {
    try {
      return allTabs() as never;
    } catch {
      return [];
    }
  }

  /** The page in front, when a browser is in front: the extension's report, or its active tab whose title the window shows. */
  private urlFor(w: FrontWindow | undefined): { url?: string; title?: string } {
    // No window watcher here (Wayland, or no window manager): the extension's report is all there is.
    if (!w) return this.browserCtx && Date.now() - this.browserCtx.at < 10 * 60_000 ? this.browserCtx : {};
    if (!isBrowser(`${w.app} ${w.appId ?? ''}`)) return {};
    if (this.browserCtx && Date.now() - this.browserCtx.at < 10 * 60_000 && (!w.title || w.title.includes(this.browserCtx.title.slice(0, 30)))) return this.browserCtx;
    const tabs = this.browserTabs().filter((t) => t.active);
    const t = tabs.find((x) => x.focused) ?? tabs.find((x) => x.title && w.title.startsWith(x.title.slice(0, 40))) ?? (tabs.length === 1 ? tabs[0] : undefined);
    return t ? { url: t.url, title: t.title } : this.browserCtx ?? {};
  }

  private onFront(_w: FrontWindow) {
    this.scheduleEval();
  }

  private scheduleEval() {
    clearTimeout(this.evalTimer);
    this.evalTimer = setTimeout(() => this.evaluate(), 250);
  }

  /** What is in front changed: cues for the new place pop up, "next visit" snoozes of the old place wake. */
  evaluate(now = Date.now()) {
    if (!this.running) return;
    const w = frontWindow();
    // Keeper's own windows (the popup, the Island) do not count as a place.
    if (w && /^(keeper|electron)$/i.test(w.app)) return;
    const page = this.urlFor(w);
    const ctx: FrontContext = { app: w?.app, appId: w?.appId, title: w?.title ?? page.title, url: page.url };
    if (!w && page.url) ctx.app = 'Browser';
    const key = placeKey(ctx);
    if (key === this.lastPlace) return;
    const prev = this.front;
    this.lastPlace = key;
    this.front = ctx;
    if (prev) {
      const before = this.cues;
      this.cues = leftPlace(this.cues, prev);
      for (const c of this.cues) if (before.find((b) => b.id === c.id) !== c) void this.write(c);
    }
    this.armHint(ctx, now);
    const list = cuesFor(this.cues, ctx, now, this.settings.cooldownMin * 60_000);
    this.showing = list.map((c) => c.id);
    if (list.length) {
      for (const c of list) { c.shownAt = now; void this.write(c); }
      if (this.settings.popup) this.hooks.popup(list, w);
      if (this.settings.island) this.hooks.island('here', list.length === 1 ? list[0].title : `${list.length} cues here`, list.length === 1 ? (list[0].body.split('\n')[0] || 'A cue for this place') : list.map((c) => c.title).join(' · '), list[0].id);
    }
    this.hooks.changed();
  }

  private armHint(ctx: FrontContext, now: number) {
    clearTimeout(this.hintTimer);
    if (!this.settings.captureHint || !ctx.url) return;
    const url = ctx.url;
    const ms = this.settings.hintAfterMin * 60_000;
    this.hintTimer = setTimeout(() => {
      if (this.front?.url !== url) return;
      const hasCue = this.cues.some((c) => !c.deletedAt && !c.done && c.anchors.some((a) => (a.kind === 'page' || a.kind === 'site') && (url.includes(a.value) || a.value.includes(new URL(url).hostname))));
      if (!shouldHint({ dwellMs: Date.now() - now, minDwellMs: ms, lastHintAt: this.lastHintAt, minGapMs: this.settings.hintEveryMin * 60_000, hasCue, url })) return;
      this.lastHintAt = Date.now();
      this.hooks.island('hint', 'Leave a cue for this page?', `You spent ${this.settings.hintAfterMin} min on ${new URL(url).hostname}. It comes back when you do.`);
    }, ms + 500);
    this.hintTimer.unref?.();
  }

  // ---------------------------------------------------------------- time and housekeeping

  /** Rings due cues, purges old deleted ones, holds the front watch only while a cue needs it, and sets one timer. */
  private housekeep() {
    if (!this.running) return;
    const now = Date.now();
    const { gone } = purgeOld(this.cues, now);
    for (const g of gone) void this.purge(g.id);
    for (const c of dueNow(this.cues, now)) {
      const rung = { ...c, rangFor: c.due };
      const i = this.cues.findIndex((x) => x.id === c.id);
      if (i >= 0) this.cues[i] = rung;
      void this.write(rung);
      if (this.settings.notify) this.hooks.notify(rung);
      if (this.settings.island) this.hooks.island('due', rung.title, rung.body.split('\n')[0] || 'Due now', rung.id);
      if (this.settings.popup) { this.showing = [...new Set([rung.id, ...this.showing])]; this.hooks.popup(this.cues.filter((x) => this.showing.includes(x.id)), frontWindow()); }
    }
    const anchored = this.cues.some((c) => !c.deletedAt && !c.done && c.anchors.length) || this.settings.captureHint;
    if (anchored && !this.releaseFront) { this.releaseFront = holdFrontWatch(); this.scheduleEval(); }
    else if (!anchored && this.releaseFront) { this.releaseFront(); this.releaseFront = undefined; }
    clearTimeout(this.wakeTimer);
    const next = nextWake(this.cues, now);
    // One timer to the next due time (at most 6 hours ahead; the clock can jump while asleep).
    const wait = Math.min(6 * 3600_000, next !== undefined ? next - now + 50 : 6 * 3600_000);
    this.wakeTimer = setTimeout(() => this.housekeep(), Math.max(1000, wait));
    this.wakeTimer.unref?.();
  }

  /** After sleep the timer may be late: look again now. */
  wake() {
    this.housekeep();
  }

  async folderExists(): Promise<boolean> {
    return existsSync(this.folder);
  }
}
