// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Voice everywhere: IPC for the pages and the listening pill, the talk key
// and shortcuts, menu-bar items, keeper:// links, the command line, and the
// abilities AIs use (live meeting transcript, meetings, dictation history).

import { ipcMain, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { registerAbility } from '../../core/abilities/registry';
import { clock, liveText } from '../../core/voice/meeting';
import { holdKeyLabel } from '../../core/voice/settings';
import type { ExportFormat } from '../../core/voice/types';
import type { WhisperSize } from '../../core/whisper';
import { registerKeeperMethod } from '../services/brain';
import { featureOn, onFeature } from '../services/features';
import type { IslandService } from '../services/island';
import { VoiceService } from '../services/voice';
import { setClipboardWriteHook } from '../services/voice/insert';
import { onVoiceSettings, saveVoiceSettings, voiceSettings } from '../services/voice/store';
import { onSettings } from '../store';

let svc: VoiceService | null = null;
let ctx: { updateTray(): void; show(route?: string): void } | null = null;

export function voice(): VoiceService | null { return svc; }

function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, async (_e, ...args) => fn(...(args as never[])));
}

const str = (v: unknown, n = 80) => { const s = String(v ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function registerVoiceIpc(c: {
  islandSvc: IslandService;
  broadcast(channel: string, ...args: unknown[]): void;
  updateTray(): void;
  show(route?: string): void;
  preload: string;
  lockDown(w: BrowserWindow): void;
  /** main's shortcut registration (it clears and re-adds every shortcut) */
  reregister(): void;
}) {
  ctx = c;
  setClipboardWriteHook((t) => c.islandSvc.ignoreClip(t));
  // The shortcut can still be changed with the Island's settings: keep Voice in step.
  onSettings((n, p) => { if (n.island?.dictationShortcut && n.island.dictationShortcut !== p.island?.dictationShortcut) void saveVoiceSettings({ dictation: { shortcut: n.island.dictationShortcut } }); });
  onVoiceSettings((n, p) => {
    if (n.dictation.shortcut !== p.dictation.shortcut || n.dictation.editShortcut !== p.dictation.editShortcut || n.dictation.voiceEdit !== p.dictation.voiceEdit) c.reregister();
  });
  svc = new VoiceService({
    broadcast: c.broadcast,
    alert: (title, detail) => c.islandSvc.alert({ kind: 'info', title, detail }),
    show: c.show,
    updateTray: c.updateTray,
    preload: c.preload,
    lockDown: c.lockDown,
    micApps: () => (process.platform !== 'darwin' && featureOn('micIndicator') && featureOn('island') ? c.islandSvc.mic : undefined),
    events: async (from, to) => {
      const out: { id: string; title: string; start: number; end: number; allDay?: boolean; url?: string; location?: string; attendees?: string[] }[] = [];
      if (featureOn('calendars')) {
        try {
          const { pim } = await import('../services/pim');
          for (const o of await pim.occurrences(from, to)) out.push({ id: `${o.event.id}@${o.start}`, title: o.event.title, start: o.start, end: o.end, allDay: o.event.allDay, url: o.event.url, location: o.event.location, attendees: (o.event.attendees ?? []).map((a) => a.name || a.email).filter(Boolean) });
        } catch { /* calendars not ready */ }
      }
      for (const e of c.islandSvc.events) if (e.end >= from && e.start <= to && !out.some((x) => x.title === e.title && x.start === e.start)) out.push({ id: `ics:${e.uid}@${e.start}`, title: e.title, start: e.start, end: e.end, allDay: e.allDay, url: e.url, location: e.location });
      return out;
    },
  });
  const v = svc;

  handle('voice.status', () => v.status());
  handle('voice.settings', () => v.settings());
  handle('voice.setSettings', (patch) => v.setSettings(patch));
  handle('voice.start', (how?: 'toggle' | 'hold' | 'edit') => v.start(how === 'edit' ? 'edit' : how === 'hold' ? 'hold' : 'toggle'));
  handle('voice.stop', () => v.stop());
  handle('voice.toggle', () => { v.toggleFromShortcut(); return v.state; });
  handle('voice.cancel', () => v.cancel());
  handle('voice.confirm', (text?: string) => v.confirm(text));
  handle('voice.history', (q?: { query?: string; app?: string; limit?: number }) => v.history(q));
  handle('voice.removeTake', (id: string) => v.removeTake(String(id)));
  handle('voice.clearHistory', () => v.clearHistory());
  handle('voice.stats', () => v.stats());
  handle('voice.reuseTake', (id: string, how: 'type' | 'copy') => v.reuseTake(String(id), how));
  handle('voice.correct', (id: string, fixed: string) => v.correct(String(id), String(fixed ?? '')));
  handle('voice.preview', (text: string, app?: string) => v.preview(String(text ?? ''), app));
  handle('voice.downloadModel', (size: WhisperSize) => v.downloadModel(size));
  handle('voice.removeModel', (size: WhisperSize) => v.removeModel(size));
  handle('voice.testKey', () => v.testKey());
  handle('voice.meetings', () => v.meetings());
  handle('voice.meeting', (id: string) => v.meeting(String(id)));
  handle('voice.startMeeting', (o?: { title?: string; app?: string; offerId?: string }) => v.startMeeting(o ?? {}));
  handle('voice.pauseMeeting', (p: boolean) => v.pauseMeeting(!!p));
  handle('voice.stopMeeting', () => v.stopMeeting());
  handle('voice.dismissOffer', (id: string, forApp?: boolean) => v.dismissOffer(String(id), !!forApp));
  handle('voice.renameSpeaker', (m: string, s: string, label: string) => v.renameSpeaker(String(m), String(s), String(label ?? '')));
  handle('voice.renameMeeting', (id: string, title: string) => v.renameMeeting(String(id), String(title ?? '')));
  handle('voice.writeNotes', (id: string) => v.writeNotes(String(id)));
  handle('voice.exportMeeting', (id: string, f: ExportFormat) => v.exportMeeting(String(id), f));
  handle('voice.removeMeeting', (id: string) => v.removeMeeting(String(id)));
  handle('voice.linkEvent', (id: string, ev: string | null) => v.linkEvent(String(id), ev));
  handle('voice.eventsNear', (id: string) => v.eventsNear(String(id)));
  handle('voice.voices', () => v.voices());
  handle('voice.forgetVoices', (name?: string) => v.forgetVoices(name ? String(name) : undefined));
  handle('voice.saveStatsPng', async (b64: string) => {
    const { app } = await import('electron');
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const f = path.join(app.getPath('downloads'), `Keeper dictation ${new Date().toISOString().slice(0, 10)}.png`);
    await fs.writeFile(f, Buffer.from(String(b64).replace(/^data:image\/png;base64,/, ''), 'base64'));
    return f;
  });
  // the menu-bar items as text (what the tray shows; also for checks)
  handle('voice.tray', () => voiceTrayItems().flatMap((i) => [String(i.label ?? ''), ...((i.submenu as MenuItemConstructorOptions[] | undefined) ?? []).filter((x) => x.type !== 'separator' && x.visible !== false).map((x) => `  ${x.label ?? ''}`)]));
  // the listening pill
  handle('voice.hud.ready', () => ({ settings: v.settings(), state: v.state, meeting: v.live(), offer: v.currentOffer, capture: v.capture }));
  ipcMain.on('voice.audio', (_e, track: 'mic' | 'system', samples: Float32Array) => v.onAudio(track === 'system' ? 'system' : 'mic', samples));
  ipcMain.on('voice.key', (_e, k: 'enter' | 'escape' | 'always') => (k === 'escape' ? v.confirmReview(null) : k === 'always' ? v.confirmReview('always') : void v.confirm()));

  // The talk key follows its switches; nothing listens while they are off.
  onFeature('dictationHold', (on) => (on && featureOn('dictation') ? void v.restartHook() : v.stopHook()), { now: true });
  onFeature('dictation', (on) => { if (!on) { v.stopHook(); void v.cancel(); } else if (featureOn('dictationHold')) void v.restartHook(); });
  onFeature('meetingDetect', () => v.startDetection(), { now: true });
  onFeature('meetings', (on) => { if (!on) void v.stopMeeting(); v.startDetection(); });

  // The command line: keeper dictation …, keeper meeting …
  registerKeeperMethod('keeper/voice', async (p) => {
    const cmd = String(p.cmd ?? 'status');
    switch (cmd) {
      case 'status': return v.status();
      case 'start': return v.start('toggle');
      case 'stop': return v.stop();
      case 'toggle': v.toggleFromShortcut(); return v.state;
      case 'cancel': return v.cancel();
      case 'history': return v.history({ query: p.query ? String(p.query) : undefined, limit: Number(p.limit) || 20 });
      case 'stats': return v.stats();
      case 'meetings': return v.meetings();
      case 'meeting-start': return v.startMeeting({ title: p.title ? String(p.title) : undefined });
      case 'meeting-stop': return v.stopMeeting();
      case 'meeting-pause': return v.pauseMeeting(true);
      case 'meeting-resume': return v.pauseMeeting(false);
      case 'meeting-live': return v.live() ?? null;
      case 'meeting-export': return v.exportText(String(p.id ?? 'live'), (String(p.format ?? 'md') as ExportFormat));
      case 'meeting-notes': return v.writeNotes(String(p.id));
      default: throw new Error(`Unknown voice command “${cmd}”`);
    }
  });

  // The Island's older recorder calls (kept for anything still using them) go through Voice now.
  handle('island.transcribe', (audio: ArrayBuffer, mime: string) => v.transcribeBlob(audio, String(mime ?? 'audio/webm')));
  handle('island.typeText', async (t: string) => { await (await import('../services/voice/insert')).insertText(String(t ?? ''), 'paste'); });

  registerVoiceAbilities(v);
  return v;
}

function registerVoiceAbilities(v: VoiceService) {
  const off = (what: string) => ({ content: `${what} is switched off in Keeper.`, summary: 'off', isError: true });
  registerAbility({
    name: 'meeting_live_transcript', label: 'Read the live meeting transcript', group: 'See and hear', defaultPermission: 'ask', network: 'never', readOnly: true,
    description: 'Returns the transcript of the meeting Keeper is recording right now (on this computer), as "[m:ss] Speaker: text" lines. Optional since_seconds returns only the lines after that point. Fails when nothing is being recorded or the person has not allowed AIs to read live meetings.',
    parameters: { type: 'object', properties: { since_seconds: { type: 'number' } } },
    describe: (a) => `Read the live meeting transcript${a.since_seconds ? ` since ${clock(Number(a.since_seconds))}` : ''}`,
  }, async (a) => {
    if (!featureOn('meetings')) return off('Meeting recording');
    if (!voiceSettings().meetings.liveForAI) return { content: 'The person has not allowed AIs to read live meetings (Meetings → Let AIs read the live transcript).', summary: 'not allowed', isError: true };
    const m = v.liveRecord();
    if (!m) return { content: 'No meeting is being recorded right now.', summary: 'none', isError: true };
    const text = liveText(m, Number(a.since_seconds) || 0);
    return { content: `Meeting: ${m.title} (recording for ${clock((Date.now() - m.startedAt) / 1000)})\n${text || '(nothing said yet)'}`, summary: `${m.utterances.length} lines` };
  });
  registerAbility({
    name: 'meeting_list', label: 'List recorded meetings', group: 'See and hear', defaultPermission: 'ask', network: 'never', readOnly: true,
    description: 'Lists meetings Keeper recorded on this computer: id, title, date, length, speakers, and whether notes exist.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    describe: () => 'List recorded meetings',
  }, async (a) => {
    if (!featureOn('meetings')) return off('Meeting recording');
    const list = (await v.meetings()).slice(0, Number(a.limit) || 20);
    return { content: JSON.stringify(list.map((m) => ({ id: m.id, title: m.title, date: new Date(m.startedAt).toISOString(), minutes: Math.round(m.durationMs / 60_000), speakers: m.speakers.map((s) => s.label), notes: !!m.notes, event: m.event?.title }))), summary: `${list.length} meetings` };
  });
  registerAbility({
    name: 'meeting_get', label: 'Read a recorded meeting', group: 'See and hear', defaultPermission: 'ask', network: 'never', readOnly: true,
    description: 'Returns one recorded meeting (id from meeting_list) as Markdown: summary, decisions, action items and the full transcript with speakers.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    describe: (a) => `Read meeting ${str(a.id)}`,
  }, async (a) => {
    if (!featureOn('meetings')) return off('Meeting recording');
    const t = await v.exportText(String(a.id), 'md');
    return t ? { content: t, summary: 'meeting' } : { content: 'No meeting with that id.', summary: 'not found', isError: true };
  });
  registerAbility({
    name: 'meeting_record', label: 'Start or stop recording a meeting', group: 'See and hear', defaultPermission: 'ask', network: 'never', readOnly: false,
    description: 'Starts, pauses, resumes or stops Keeper\'s meeting recording on this computer (microphone and the computer\'s sound, transcribed locally). Everyone in the call should be told it is recorded.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'pause', 'resume', 'stop'] }, title: { type: 'string' } }, required: ['action'] },
    describe: (a) => `${String(a.action ?? 'start').replace(/^./, (c) => c.toUpperCase())} recording the meeting${a.title ? ` “${str(a.title, 40)}”` : ''}`,
  }, async (a) => {
    if (!featureOn('meetings')) return off('Meeting recording');
    const act = String(a.action);
    if (act === 'start') { const l = await v.startMeeting({ title: a.title ? String(a.title) : undefined }); return { content: `Recording “${l.title}”. Remind everyone it is recorded.`, summary: 'recording' }; }
    if (act === 'pause' || act === 'resume') { await v.pauseMeeting(act === 'pause'); return { content: act === 'pause' ? 'Paused.' : 'Recording again.', summary: act }; }
    const m = await v.stopMeeting();
    return { content: m ? `Saved “${m.title}” (${m.utterances.length} lines, id ${m.id}).` : 'Nothing was being recorded.', summary: 'stopped' };
  });
  registerAbility({
    name: 'dictation_history', label: 'Search dictation history', group: 'See and hear', defaultPermission: 'ask', network: 'never', readOnly: true,
    description: 'Searches what the person dictated with Keeper (newest first): time, app and text.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } } },
    describe: (a) => (a.query ? `Search dictation history for “${str(a.query)}”` : 'Read recent dictation history'),
  }, async (a) => {
    if (!featureOn('dictation')) return off('Dictation');
    const r = await v.history({ query: a.query ? String(a.query) : undefined, limit: Math.min(50, Number(a.limit) || 15) });
    return { content: JSON.stringify(r.map((t) => ({ at: new Date(t.at).toISOString(), app: t.app, text: t.text }))), summary: `${r.length} takes` };
  });
}

// ---------------------------------------------------------------- shortcuts, menu bar, links

/** Called from main's shortcut registration (it clears every shortcut first). */
export function registerVoiceShortcuts(reg: (acc: string, fn: () => void) => void) {
  if (!svc || !featureOn('dictation')) return;
  const s = voiceSettings().dictation;
  reg(s.shortcut, () => svc?.toggleFromShortcut());
  if (s.voiceEdit !== 'off') reg(s.editShortcut, () => { const v = svc; if (v) void (v.state.phase === 'editing' ? v.stop() : v.start('edit')).catch(() => undefined); });
}

export function voiceTrayItems(): MenuItemConstructorOptions[] {
  if (!svc || !voiceSettings().surfaces.tray) return [];
  const s = voiceSettings();
  const items: MenuItemConstructorOptions[] = [];
  if (featureOn('dictation')) {
    const active = svc.state.phase !== 'idle';
    items.push({
      label: 'Dictation',
      submenu: [
        active ? { label: 'Stop Dictating', click: () => void svc?.stop() } : { label: 'Start Dictating', accelerator: s.dictation.shortcut, click: () => void svc?.start('toggle') },
        { label: `Hold ${holdKeyLabel(s.dictation.key, process.platform)} to talk`, enabled: false, visible: featureOn('dictationHold') },
        { label: 'Edit Selection by Voice', accelerator: s.dictation.editShortcut, visible: s.dictation.voiceEdit !== 'off', click: () => void svc?.start('edit') },
        { type: 'separator' },
        { label: 'Dictation History…', click: () => ctx?.show('dictation') },
      ],
    });
  }
  if (featureOn('meetings')) {
    const live = svc.live();
    const offer = svc.currentOffer;
    if (live) {
      items.push({
        label: `Recording “${live.title.slice(0, 30)}” · ${clock(live.elapsedMs / 1000)}`,
        submenu: [
          { label: live.paused ? 'Resume Recording' : 'Pause Recording', click: () => void svc?.pauseMeeting(!live.paused) },
          { label: 'Stop and Save', click: () => void svc?.stopMeeting() },
          { type: 'separator' },
          { label: 'Show Live Transcript…', click: () => ctx?.show('meetings') },
        ],
      });
    } else {
      items.push({
        label: offer ? `Record ${offer.app} Call` : 'Record Meeting',
        submenu: [
          { label: offer ? `Record ${offer.app} Call` : 'Start Recording', click: () => void svc?.startMeeting({ app: offer?.app, offerId: offer?.id }) },
          { label: 'Tell everyone before you record.', enabled: false },
          { type: 'separator' },
          { label: 'Meetings…', click: () => ctx?.show('meetings') },
        ],
      });
    }
  }
  return items;
}

/** keeper://dictation/toggle|start|stop|cancel and keeper://meeting/start|stop|pause|resume */
export function handleVoiceLink(u: URL) {
  if (!svc) return;
  const kind = u.hostname || u.pathname.replace(/^\/+/, '').split('/')[0];
  const act = u.searchParams.get('do') ?? u.pathname.replace(/^\/+/, '').split('/').filter((x) => x !== kind)[0] ?? 'toggle';
  if (kind === 'dictation') {
    if (act === 'start') void svc.start('toggle');
    else if (act === 'stop') void svc.stop();
    else if (act === 'cancel') void svc.cancel();
    else if (act === 'edit') void svc.start('edit');
    else svc.toggleFromShortcut();
  } else if (kind === 'meeting') {
    if (act === 'stop') void svc.stopMeeting();
    else if (act === 'pause') void svc.pauseMeeting(true);
    else if (act === 'resume') void svc.pauseMeeting(false);
    else void svc.startMeeting({ title: u.searchParams.get('title') ?? undefined });
  }
}

export function shutdownVoice() { svc?.shutdown(); }
