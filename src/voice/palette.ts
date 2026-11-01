// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Command palette entries for dictation and meetings (ids start with
// "dictation" or "meeting", so switching those features off hides them).

import { useEffect, useState } from 'react';
import type { VoiceStatus } from '../../core/voice/types';
import { api } from '../api';

export interface VoiceCommand { id: string; label: string; group: 'Go to' | 'Actions'; icon: string; keywords?: string; route?: string; run: () => unknown }

export function useVoiceCommands(toast: (t: string) => void, go: (r: { name: 'dictation' | 'meetings'; arg?: string }) => void): VoiceCommand[] {
  const [st, setSt] = useState<VoiceStatus | null>(null);
  const [palette, setPalette] = useState(true);
  useEffect(() => {
    void api.voice?.status().then(setSt).catch(() => undefined);
    void api.voice?.settings().then((s) => setPalette(s.surfaces.palette)).catch(() => undefined);
  }, []);
  const err = (e: unknown) => toast(e instanceof Error ? e.message : String(e));
  const out: VoiceCommand[] = [
    { id: 'dictation-page', label: 'Dictation', group: 'Go to', icon: 'mic', route: 'dictation', keywords: 'dictate speech voice typing history dictionary snippets', run: () => go({ name: 'dictation' }) },
    { id: 'dictation-history', label: 'Dictation History', group: 'Go to', icon: 'history', route: 'dictation', keywords: 'dictate what did i say', run: () => go({ name: 'dictation', arg: 'history' }) },
    { id: 'meeting-page', label: 'Meetings', group: 'Go to', icon: 'calendar', route: 'meetings', keywords: 'meeting recorder transcript notes call zoom teams meet', run: () => go({ name: 'meetings' }) },
  ];
  if (!palette) return out;
  const dictating = st && st.dictation.phase !== 'idle';
  out.push(
    { id: 'dictation-toggle', label: dictating ? 'Stop Dictating' : 'Start Dictating', group: 'Actions', icon: 'mic', keywords: 'dictate speak voice typing talk', run: () => void (dictating ? api.voice.stop() : api.voice.start('toggle')).catch(err) },
    { id: 'dictation-edit', label: 'Edit Selected Text by Voice', group: 'Actions', icon: 'sparkle', keywords: 'rewrite voice ai selection', run: () => void api.voice.start('edit').catch(err) },
  );
  if (st?.meeting) {
    out.push(
      { id: 'meeting-stop', label: 'Stop Recording the Meeting', group: 'Actions', icon: 'check', keywords: 'meeting save transcript', run: () => void api.voice.stopMeeting().then(() => toast('Meeting saved')).catch(err) },
      { id: 'meeting-pause', label: st.meeting.paused ? 'Resume Meeting Recording' : 'Pause Meeting Recording', group: 'Actions', icon: st.meeting.paused ? 'play' : 'pause', keywords: 'meeting', run: () => void api.voice.pauseMeeting(!st.meeting!.paused).catch(err) },
    );
  } else out.push({ id: 'meeting-record', label: 'Record a Meeting', group: 'Actions', icon: 'mic', keywords: 'meeting call recorder transcript zoom teams meet', run: () => void api.voice.startMeeting().then(() => toast('Recording — remember to tell everyone')).catch(err) });
  return out;
}
