// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Records in the listening pill's window and hands 16 kHz mono samples to the
// main process: the microphone, and on Windows the computer's sound (loopback).

import { api } from '../api';

interface Source { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; src: MediaStreamAudioSourceNode }

function pipe(stream: MediaStream, track: 'mic' | 'system', onLevel?: (n: number) => void): Source {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    api.voice.hud.audio(track, data);
    if (onLevel) {
      let s = 0;
      for (let i = 0; i < data.length; i += 8) s += data[i] * data[i];
      onLevel(Math.min(1, Math.max(0, (20 * Math.log10(Math.sqrt(s / (data.length / 8)) + 1e-6) + 60) / 50)));
    }
  };
  src.connect(node);
  node.connect(ctx.destination); // silent: the processor only runs when connected
  // no click started this window, so the context may begin suspended
  void ctx.resume().catch(() => undefined);
  return { stream, ctx, node, src };
}

function close(s?: Source) {
  if (!s) return;
  s.node.onaudioprocess = null;
  s.src.disconnect();
  s.node.disconnect();
  s.stream.getTracks().forEach((t) => t.stop());
  void s.ctx.close();
}

export class Capture {
  private mic?: Source;
  private sys?: Source;
  private micDevice = '';
  error = '';

  async set(o: { mic: boolean; deviceId?: string; system: boolean }, onLevel?: (n: number) => void) {
    this.error = '';
    if (o.mic && (!this.mic || this.micDevice !== (o.deviceId ?? ''))) {
      close(this.mic);
      this.mic = undefined;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: o.deviceId ? { exact: o.deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.mic = pipe(stream, 'mic', onLevel);
        this.micDevice = o.deviceId ?? '';
      } catch (e) {
        this.error = e instanceof Error && /denied|NotAllowed/i.test(e.name + e.message) ? 'Keeper may not use the microphone: allow it in the system’s privacy settings' : 'No microphone could be opened';
      }
    } else if (!o.mic) { close(this.mic); this.mic = undefined; }
    if (o.system && !this.sys) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 2, height: 2, frameRate: 1 } });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length) this.sys = pipe(new MediaStream(stream.getAudioTracks()), 'system');
      } catch {
        /* the main process explains */
      }
    } else if (!o.system) { close(this.sys); this.sys = undefined; }
  }

  stop() {
    close(this.mic);
    close(this.sys);
    this.mic = this.sys = undefined;
  }
}

/** Short tones for start, stop and cancel (no sound files). */
export function playSound(kind: 'start' | 'stop' | 'cancel') {
  try {
    const ctx = new AudioContext();
    const notes = kind === 'start' ? [660, 880] : kind === 'stop' ? [880, 660] : [440, 330];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.07;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.13);
    });
    setTimeout(() => void ctx.close(), 400);
  } catch {
    /* no sound device */
  }
}
