// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Talking to the Assistant with any AI: press the microphone (or hold Space in
// hands-free mode), speak, and the answer is read out with this computer's
// voices. Interrupt any time by pressing again.

import { useEffect, useRef, useState } from 'react';
import type { Persona, Project } from '../../core/abilities/config';
import { permissionForError } from '../../core/permission-errors';
import { api } from '../api';
import { openPermissions } from './PermissionsPanel';
import { Icon } from './Icon';
import '../styles/abilities.css';

/** Strips citations and paths so the spoken answer sounds natural. */
export function speakable(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]/g, '').replace(/\[\d+\]/g, '').replace(/https?:\/\/\S+/g, '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

export function speak(text: string, voice?: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') { void api.abilities.speak(text).then(resolve, resolve); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    const v = voice ? speechSynthesis.getVoices().find((x) => x.name === voice) : undefined;
    if (v) u.voice = v;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function VoiceButton({ onText, busy, lastAnswer, handsFree }: { onText: (t: string) => void; busy: boolean; lastAnswer?: string; handsFree?: boolean }) {
  const [state, setState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [err, setErr] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const talkMode = useRef(false);
  const spoken = useRef<string | undefined>(lastAnswer);
  const [perm, setPerm] = useState<string | undefined>();

  const start = async () => {
    setErr('');
    setPerm(undefined);
    speechSynthesis?.cancel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState('thinking');
        try {
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          const text = await api.abilities.transcribe(await blob.arrayBuffer(), blob.type);
          if (text) onText(text);
          else setState('idle');
        } catch (e) {
          setErr((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
          setState('idle');
          talkMode.current = false;
        }
      };
      rec.current = mr;
      mr.start();
      talkMode.current = true;
      setState('listening');
    } catch (e) {
      setErr('Keeper could not use the microphone.');
      setPerm(permissionForError(e, 'microphone') ?? 'microphone');
    }
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  // When an answer arrives in talk mode, read it out; hands-free listens again afterwards.
  useEffect(() => {
    if (!talkMode.current || busy || !lastAnswer || lastAnswer === spoken.current) return;
    spoken.current = lastAnswer;
    setState('speaking');
    void speak(lastAnswer).then(() => {
      setState('idle');
      if (handsFree && talkMode.current) void start();
      else talkMode.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAnswer, busy]);

  const click = () => {
    if (state === 'listening') stop();
    else if (state === 'speaking') { speechSynthesis.cancel(); talkMode.current = false; setState('idle'); }
    else if (state === 'idle') void start();
  };
  const title = state === 'listening' ? 'Listening — press to send' : state === 'speaking' ? 'Speaking — press to stop' : state === 'thinking' ? 'Writing down what you said…' : 'Talk instead of typing';
  return (
    <>
      <button className={`btn voice-btn ${state !== 'idle' ? 'on' : ''}`} title={title} aria-label={title} onClick={click} disabled={state === 'thinking'} style={{ height: 42 }}>
        {state === 'thinking' ? <span className="spinner" /> : <Icon name={state === 'speaking' ? 'pause' : 'mic'} size={15} />}
      </button>
      {err ? <div className="small err" style={{ position: 'absolute', bottom: -18, right: 0 }}>{err}{perm ? <> <button className="link-like" onClick={() => openPermissions(perm)}>Open Permissions</button></> : null}</div> : null}
    </>
  );
}

export function PersonaPicker({ personas, projects, persona, project, onChange }: { personas: Persona[]; projects: Project[]; persona?: string; project?: string; onChange: (o: { persona?: string; project?: string }) => void }) {
  if (!personas.length && !projects.length) return null;
  return (
    <>
      {personas.length ? (
        <select className="input" aria-label="Persona" value={persona ?? ''} onChange={(e) => onChange({ persona: e.target.value || undefined, project })}>
          <option value="">No persona</option>
          {personas.map((p) => <option key={p.id} value={p.id}>{p.avatar ?? ''} {p.name}</option>)}
        </select>
      ) : null}
      {projects.length ? (
        <select className="input" aria-label="Project" value={project ?? ''} onChange={(e) => onChange({ persona, project: e.target.value || undefined })}>
          <option value="">All files</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : null}
    </>
  );
}
