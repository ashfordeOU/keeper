// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for health history, the Weather page, Toolbox helpers, folder tidying,
// AI file actions, updates and launch-at-login.

import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALT_TEXT_PROMPT, applyTranslation, buildSubtitles, cleanSuggestedName, complete, namePrompt, parseReceipt, parseSubtitles, receiptPrompt, subtitlePrompt, summaryPrompt, type ImageInput } from '../core/ai-actions';
import type { AiProviderInfo } from '../core/api-x';
import { toCsv } from '../core/devtools';
import type { FileIndex } from '../core/indexer';
import type { CalendarEvent } from '../core/island';
import type { Journal } from '../core/journal';
import type { AlertRule } from '../core/monitor';
import { run } from '../core/platform';
import { uniqueName } from '../core/rules';
import type { TidyMode } from '../core/tidy';
import type { Place } from '../core/weather';
import { ForecastService } from './services/forecast';
import { dockerAction, dockerContainers, diskHealth, killTree, MonitorService, stopAgent, thermals } from './services/monitor';
import { writeFinderTags } from './services/tags';
import { clearQuarantine, networkInfo, pickApp, pickFiles, publicIp, resetPermissions, saveAs, setTweak, tidyFolder, tweaks } from './services/tools';
import { checkForUpdates, downloadUpdate, initUpdater, installUpdate, listVersionNotes, onUpdateStatus, openReleasesPage, scheduleUpdate, updateStatus, whatsNew } from './services/updater';
import { loadImage, ocrImage } from './services/vision';
import { getSecret, settings } from './store';
import { onFeature } from './services/features';

export interface IpcXDeps {
  index: FileIndex;
  journal: Journal;
  events: () => CalendarEvent[];
  window: () => BrowserWindow | null;
  changed: () => void;
  broadcast?: (channel: string, ...args: unknown[]) => void;
  /** a new version was found or finished downloading */
  onUpdate?: (s: import('../core/api-x').UpdateStatus) => void;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|yaml|yml|xml|html?|rtf|srt|vtt|ini|toml|tex)$/i;

export let monitor: MonitorService;

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

async function providerInfo(): Promise<AiProviderInfo> {
  const s = settings().ai;
  const label = s.provider === 'anthropic' ? 'Claude' : s.provider === 'openai' ? 'OpenAI' : 'your local model';
  return { provider: s.provider, local: s.provider === 'ollama', configured: s.provider === 'ollama' || !!(await getSecret(s.provider)), label };
}

async function aiOpts() {
  const s = settings().ai;
  return { provider: s.provider, model: s.model, apiKey: await getSecret(s.provider), ollamaUrl: s.ollamaUrl };
}

/** The readable text of a file: what the index knows, plain text, a PDF, or the text in an image. */
async function textOf(index: FileIndex, p: string): Promise<string> {
  const known = index.files.get(p)?.text ?? index.extras.get(p)?.text;
  if (known) return known;
  if (TEXT_EXT.test(p)) return (await fsp.readFile(p, 'utf8')).slice(0, 200_000);
  if (/\.pdf$/i.test(p)) {
    const r = await run('pdftotext', ['-layout', '-l', '20', p, '-'], 30_000);
    if (r.ok && r.stdout.trim()) return r.stdout;
    throw new Error('Keeper has not read this PDF yet. Try again after indexing finishes.');
  }
  const img = await loadImage(p);
  if (!img) throw new Error('This file has no text Keeper can read.');
  const text = await ocrImage(img, settings().ocrLanguages);
  index.setText(p, text);
  return text;
}

async function imageInput(p: string): Promise<ImageInput> {
  const img = await loadImage(p, 1568);
  if (!img) throw new Error('Keeper cannot open this image.');
  return { data: img.toJPEG(85).toString('base64'), mime: 'image/jpeg' };
}

// ---------------------------------------------------------------- launch at login

const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'autostart', 'keeper.desktop');

async function loginItem(): Promise<boolean> {
  if (process.platform === 'linux') return existsSync(autostartFile());
  return app.getLoginItemSettings().openAtLogin;
}

async function setLoginItem(on: boolean): Promise<boolean> {
  if (process.platform === 'linux') {
    if (!on) await fsp.rm(autostartFile(), { force: true });
    else {
      const exec = process.env.APPIMAGE ?? process.execPath;
      await fsp.mkdir(path.dirname(autostartFile()), { recursive: true });
      await fsp.writeFile(autostartFile(), `[Desktop Entry]\nType=Application\nName=Keeper\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n`);
    }
  } else {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
  }
  return loginItem();
}

// ---------------------------------------------------------------- register

export function registerIpcX(d: IpcXDeps) {
  monitor = new MonitorService();
  // Health history samples running apps once a minute; only while Health is switched on.
  onFeature('health', (on) => (on ? void monitor.start() : monitor.stop()), { now: true });
  const forecast = new ForecastService(d.events, () => settings().island.place);
  // New versions: tell every window, the Island and the tray.
  onUpdateStatus((s) => d.broadcast?.('update-status', s));
  void initUpdater((s) => d.onUpdate?.(s));

  handle('monitor.history', () => monitor.history);
  handle('monitor.topToday', () => monitor.topToday());
  handle('monitor.alerts', () => ({ rules: monitor.rules, active: monitor.active }));
  handle('monitor.setAlertRules', (rules: AlertRule[]) => monitor.setRules(rules));
  handle('monitor.docker', dockerContainers);
  handle('monitor.dockerAction', (id: string, action: 'stop' | 'start' | 'restart') => dockerAction(id, action));
  handle('monitor.killTree', (pid: number) => killTree(pid));
  handle('monitor.stopAgent', (cwd: string) => stopAgent(cwd));
  handle('monitor.thermals', thermals);
  handle('monitor.disks', diskHealth);
  handle('monitor.speedTest', () => monitor.speedTest());
  handle('monitor.speedHistory', () => monitor.speeds);

  handle('forecast.places', () => forecast.places());
  handle('forecast.savePlaces', (p: Place[]) => forecast.savePlaces(p));
  handle('forecast.get', (p: Place, units: 'metric' | 'imperial') => forecast.get(p, units));
  handle('forecast.alerts', (p: Place) => forecast.alerts(p));
  handle('forecast.radar', () => forecast.radar());
  handle('forecast.climate', (p: Place) => forecast.climate(p));
  handle('forecast.trips', (units: 'metric' | 'imperial') => forecast.trips(units));

  handle('tools.networkInfo', networkInfo);
  handle('tools.publicIp', publicIp);
  handle('tools.tweaks', tweaks);
  handle('tools.setTweak', (id: string, v?: boolean | number) => setTweak(id, v));
  handle('tools.clearQuarantine', (p: string) => clearQuarantine(p));
  handle('tools.resetPermissions', (id: string) => resetPermissions(id));
  handle('tools.pickApp', () => pickApp(d.window() ?? undefined));
  handle('tools.pickFiles', (filters?: { name: string; extensions: string[] }[]) => pickFiles(d.window() ?? undefined, filters));
  handle('tools.saveAs', (name: string, content: string) => saveAs(d.window() ?? undefined, name, content));

  handle('folders.tidy', async (dir: string, mode: TidyMode, apply: boolean) => {
    const r = await tidyFolder(dir, mode, apply, d.index, d.journal);
    if (apply) d.changed();
    return r;
  });

  handle('aiActions.provider', providerInfo);
  handle('aiActions.suggestName', async (p: string) => {
    const f = d.index.files.get(p);
    const name = path.basename(p);
    const ext = path.extname(name).slice(1);
    const text = await textOf(d.index, p).catch(() => '');
    const { system, prompt } = namePrompt({ name, ext, mtime: f?.mtime ?? Date.now(), text });
    const out = cleanSuggestedName(await complete(system, prompt, await aiOpts()), ext);
    if (!out) throw new Error('No name came back. Try again.');
    return out;
  });
  handle('aiActions.summarize', async (p: string) => {
    const text = await textOf(d.index, p);
    if (!text.trim()) throw new Error('This file has no text to summarize.');
    const { system, prompt } = summaryPrompt(path.basename(p), text);
    return complete(system, prompt, await aiOpts());
  });
  handle('aiActions.receipts', async (paths: string[]) => {
    const rows = [];
    for (const p of paths) {
      const text = await textOf(d.index, p).catch(() => '');
      if (!text.trim()) {
        rows.push(parseReceipt('', path.basename(p)));
        continue;
      }
      const { system, prompt } = receiptPrompt(path.basename(p), text);
      rows.push(parseReceipt(await complete(system, prompt, await aiOpts()), path.basename(p)));
    }
    const dir = path.dirname(paths[0]);
    const csvPath = uniqueName(path.join(dir, `Receipts ${new Date().toISOString().slice(0, 10)}.csv`), existsSync);
    await fsp.writeFile(csvPath, toCsv(rows));
    await d.index.refresh(csvPath);
    d.changed();
    return { csvPath, rows };
  });
  handle('aiActions.altText', async (p: string) => complete(ALT_TEXT_PROMPT.system, ALT_TEXT_PROMPT.prompt, await aiOpts(), await imageInput(p)));
  handle('aiActions.translateSubtitles', async (p: string, language: string) => {
    const src = await fsp.readFile(p, 'utf8');
    const vtt = /\.vtt$/i.test(p);
    const { header, cues } = parseSubtitles(src);
    if (!cues.length) throw new Error('No subtitles found in this file.');
    let out = cues;
    // Translate in batches so long films fit in one request each.
    for (let i = 0; i < cues.length; i += 150) {
      const batch = cues.slice(i, i + 150);
      const { system, prompt } = subtitlePrompt(language, batch);
      const translated = applyTranslation(batch, await complete(system, prompt, await aiOpts()));
      out = [...out.slice(0, i), ...translated, ...out.slice(i + translated.length)];
    }
    const code = language.toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 20);
    const target = uniqueName(p.replace(/\.(srt|vtt)$/i, `.${code}.$1`), existsSync);
    await fsp.writeFile(target, buildSubtitles(header, out, vtt));
    await d.index.refresh(target);
    d.changed();
    return target;
  });

  handle('appInfo.updateStatus', () => updateStatus());
  handle('appInfo.checkForUpdates', () => checkForUpdates(true));
  handle('appInfo.installUpdate', () => installUpdate());
  handle('appInfo.downloadUpdate', () => downloadUpdate());
  handle('appInfo.whatsNew', () => whatsNew());
  handle('appInfo.releasesPage', () => openReleasesPage());
  handle('appInfo.versionNotes', () => listVersionNotes());
  handle('appInfo.scheduleUpdate', (when: import('../core/update-schedule').UpdateWhen) => scheduleUpdate(when));
  handle('appInfo.loginItem', loginItem);
  handle('appInfo.setLoginItem', (on: boolean) => setLoginItem(on));
}

/** Writes tags back to Finder on macOS; a no-op elsewhere. */
export function syncFinderTags(p: string, tags: string[]) {
  if (process.platform === 'darwin') void writeFinderTags(p, tags);
}
