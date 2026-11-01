// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The banner shown at the top of the screen while another device watches it.
// It is also the part that captures the screen: it sends a WebRTC video track
// when a direct connection works, and JPEG frames through Keeper Link when it
// does not (or to a phone). One click on Stop ends everything.

import { useEffect, useRef, useState } from 'react';
import { frameSettings, QualityController } from '../../core/screen/abr';
import { checkBinding, soleFingerprint, stripCandidates } from '../../core/screen/sdp';
import { allLayout, encodingPlan, orderCodecs, pickMonitorDevice, type CodecPref, type DisplayMode } from '../../core/screen/extras';
import type { ControlMessage, Quality, ScreenSession } from '../../core/screen/types';
import { api } from '../api';
import { certificateOk, connected, gathered, rtcConfig } from './rtc';
import '../styles/screen.css';

const sid = new URLSearchParams(location.search).get('sid') ?? '';

const desktop = (id: string, w = 3840, h = 2160) => navigator.mediaDevices.getUserMedia({
  audio: false,
  video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: w, maxHeight: h, maxFrameRate: 30 } } as unknown as MediaTrackConstraints,
});

let composeStop: (() => void) | null = null;

/** The picture: one display, one window, or every display drawn side by side as they are arranged. */
async function capture(o: { mode?: DisplayMode; windowId?: string } = {}): Promise<MediaStream> {
  composeStop?.();
  composeStop = null;
  if (o.windowId) return desktop(o.windowId);
  if (o.mode === 'all') {
    const srcs = await api.screen.sources(sid);
    if (srcs.length > 1) {
      const streams = await Promise.all(srcs.map((x) => desktop(x.id, x.width, x.height)));
      const videos = streams.map((st) => {
        const v = document.createElement('video');
        v.muted = true;
        v.srcObject = st;
        void v.play();
        return v;
      });
      const layout = allLayout(srcs.map((x) => x.display), 2560);
      const c = document.createElement('canvas');
      c.width = Math.max(...layout.map((l) => l.x + l.w));
      c.height = Math.max(...layout.map((l) => l.y + l.h));
      const g = c.getContext('2d')!;
      let alive = true;
      const draw = () => {
        if (!alive) return;
        g.fillStyle = '#000';
        g.fillRect(0, 0, c.width, c.height);
        layout.forEach((l, i) => videos[i].videoWidth && g.drawImage(videos[i], l.x, l.y, l.w, l.h));
        window.setTimeout(draw, 33);
      };
      draw();
      composeStop = () => {
        alive = false;
        streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
      };
      return c.captureStream(30);
    }
  }
  const src = await api.screen.source(sid);
  if (!src) throw new Error('No screen to share');
  // Electron's desktop capture: the chosen display, at its own size.
  return desktop(src.id, src.width, src.height);
}

/** System sound where the system allows it: Windows loopback, a Linux monitor source, macOS 13+ through screen capture. */
async function systemAudio(): Promise<MediaStreamTrack | null> {
  try {
    if (navigator.userAgent.includes('Linux')) {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => undefined);
      const id = pickMonitorDevice(await navigator.mediaDevices.enumerateDevices());
      if (!id) return null;
      return (await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })).getAudioTracks()[0] ?? null;
    }
    const s = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 2, maxHeight: 2 } } } as unknown as MediaStreamConstraints);
    s.getVideoTracks().forEach((t) => t.stop());
    return s.getAudioTracks()[0] ?? null;
  } catch {
    return null;
  }
}

export function HostView() {
  const [s, setS] = useState<ScreenSession | null>(null);
  const [note, setNote] = useState('');
  const [chat, setChat] = useState('');
  const [talkAsk, setTalkAsk] = useState(false);
  const [talking, setTalking] = useState(false);
  const restartRef = useRef<(() => void) | null>(null);
  const voiceRef = useRef(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    document.title = 'Keeper — sharing this screen';
    let stream: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    let sender: RTCRtpSender | null = null;
    let framesOn = false;
    let stopped = false;
    let stated = '';
    const ctl = new QualityController('auto');
    const timers: number[] = [];

    const sig = (m: ControlMessage) => api.screen.signal(sid, m);

    const startFrames = () => {
      if (framesOn) return;
      framesOn = true;
      setNote('Sending pictures through Keeper Link');
      void sig({ t: 'path', path: 'frames' });
      let canvas: OffscreenCanvas | null = null;
      const tick = async () => {
        if (stopped) return;
        const v = video.current;
        let wait = 60;
        if (v && v.videoWidth) {
          const fs = frameSettings(ctl.current);
          const w = Math.max(2, Math.round(v.videoWidth * fs.scale));
          const h = Math.max(2, Math.round(v.videoHeight * fs.scale));
          if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h);
          const c = canvas.getContext('2d')!;
          c.drawImage(v, 0, 0, w, h);
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: fs.quality });
          const ok = await api.screen.frame(sid, new Uint8Array(await blob.arrayBuffer()), w, h).catch(() => false);
          wait = ok ? Math.round(1000 / fs.fps) : 40;
        }
        timers.push(window.setTimeout(tick, wait));
      };
      void tick();
    };

    const tune: { codec: CodecPref; lossless: boolean; hardware: boolean; audio: boolean } = { codec: 'auto', lossless: false, hardware: true, audio: false };
    let mode: DisplayMode = 'one';
    let windowId = '';
    let extraTracks: MediaStreamTrack[] = [];

    const startP2P = async (track: MediaStreamTrack) => {
      const { config, scope } = await rtcConfig();
      pc = new RTCPeerConnection(config);
      const plan = encodingPlan({ lossless: tune.lossless, bitrate: 4_000_000, fps: 30, scale: 1, hardware: tune.hardware });
      track.contentHint = plan.contentHint;
      sender = pc.addTrack(track, stream!);
      // Codec preference (H.264 is the one graphics cards encode most often).
      try {
        const tr = pc.getTransceivers().find((t) => t.sender === sender);
        const caps = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
        if (tr && caps.length && tune.codec !== 'auto') tr.setCodecPreferences(orderCodecs(caps, tune.codec));
      } catch {
        /* this build cannot choose */
      }
      if (tune.lossless) {
        const p = sender.getParameters();
        if (!p.encodings?.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = plan.maxBitrate;
        p.encodings[0].maxFramerate = plan.maxFramerate;
        (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = plan.degradationPreference;
        await sender.setParameters(p).catch(() => undefined);
      }
      // Sound and voice ride on the same connection.
      extraTracks.forEach((t) => t.stop());
      extraTracks = [];
      if (tune.audio) {
        const a = await systemAudio();
        if (a) {
          extraTracks.push(a);
          pc.addTrack(a, new MediaStream([a]));
        } else void sig({ t: 'chat', text: 'Sound from this computer could not be captured here.', at: Date.now() });
      }
      if (voiceRef.current) {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
        mic?.getAudioTracks().forEach((t) => {
          extraTracks.push(t);
          pc!.addTrack(t, mic);
        });
        if (!mic) pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.ontrack = (e) => {
          if (e.track.kind !== 'audio') return;
          const el = document.getElementById('voice-out') as HTMLAudioElement | null;
          if (el) {
            el.srcObject = new MediaStream([e.track]);
            void el.play().catch(() => undefined);
          }
        };
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gathered(pc);
      const sdp = stripCandidates(pc.localDescription!.sdp, scope);
      stated = soleFingerprint(sdp);
      await sig({ t: 'sdp', type: 'offer', sdp, fingerprint: stated });
      const ok = await connected(pc, 9000);
      if (stopped) return;
      if (!ok) {
        pc.close();
        pc = null;
        return startFrames();
      }
      setNote('Direct connection');
      void sig({ t: 'path', path: 'p2p' });
      // Adaptive quality, once a second, from what WebRTC reports.
      let lostBefore = 0;
      let sentBefore = 0;
      timers.push(window.setInterval(async () => {
        if (!pc || !sender) return;
        const stats = [...(await pc.getStats()).values()] as Array<Record<string, number & string>>;
        const out = stats.find((x) => x.type === 'outbound-rtp' && x.kind === 'video');
        const remote = stats.find((x) => x.type === 'remote-inbound-rtp' && x.kind === 'video');
        const pair = stats.find((x) => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
        const lost = Number(remote?.packetsLost ?? 0);
        const sent = Number(out?.packetsSent ?? 0);
        const loss = sent > sentBefore ? Math.max(0, lost - lostBefore) / (sent - sentBefore) : 0;
        lostBefore = lost;
        sentBefore = sent;
        const t = ctl.update({ loss, rtt: pair?.currentRoundTripTime ? Number(pair.currentRoundTripTime) * 1000 : undefined, available: pair?.availableOutgoingBitrate ? Number(pair.availableOutgoingBitrate) : undefined, cpuLimited: out?.qualityLimitationReason === 'cpu' });
        const p = sender.getParameters();
        if (!p.encodings?.length) p.encodings = [{}];
        if (tune.lossless) return;
        p.encodings[0].maxBitrate = t.bitrate;
        p.encodings[0].maxFramerate = t.fps;
        p.encodings[0].scaleResolutionDownBy = 1 / t.scale;
        await sender.setParameters(p).catch(() => undefined);
      }, 1000));
    };

    const onSignal = async (id: string, m: Record<string, unknown>) => {
      if (id !== sid) return;
      const msg = m as ControlMessage | { t: 'clip-done' };
      if (msg.t === 'sdp' && msg.type === 'answer' && pc) {
        try {
          checkBinding(msg.sdp, msg.fingerprint);
          await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
          if (await connected(pc, 9000)) {
            if (!(await certificateOk(pc, msg.fingerprint))) throw new Error('The direct connection used a different certificate');
          }
        } catch (e) {
          setNote(e instanceof Error ? e.message : String(e));
          pc?.close();
          pc = null;
          startFrames();
        }
      } else if (msg.t === 'display' || msg.t === 'mode' || msg.t === 'window') {
        if (msg.t === 'mode') mode = msg.mode;
        if (msg.t === 'window') windowId = msg.id;
        if (msg.t === 'display' && mode === 'all') return;
        const next = await capture({ mode, windowId: windowId || undefined });
        stream?.getTracks().forEach((t) => t.stop());
        stream = next;
        if (video.current) video.current.srcObject = next;
        await sender?.replaceTrack(next.getVideoTracks()[0]);
      } else if (msg.t === 'tune') {
        Object.assign(tune, Object.fromEntries(Object.entries(msg).filter(([k, v]) => k !== 't' && v !== undefined)));
        restartRef.current?.();
      } else if (msg.t === 'voice') {
        if (msg.on && !voiceRef.current) setTalkAsk(true);
        if (!msg.on && voiceRef.current) {
          voiceRef.current = false;
          setTalking(false);
          restartRef.current?.();
        }
      } else if (msg.t === 'grant') {
        setS((x) => (x ? { ...x, control: msg.control } : x));
      } else if (msg.t === 'quality') {
        ctl.setMode(msg.q as Quality);
      } else if (msg.t === 'chat') {
        setChat(msg.text);
        timers.push(window.setTimeout(() => setChat(''), 8000));
      }
    };
    // Sound, voice or codec changed: offer the connection again (the viewer answers the new offer).
    restartRef.current = () => {
      if (framesOn || !stream || stopped) return;
      pc?.close();
      pc = null;
      timers.forEach((t) => clearInterval(t));
      void startP2P(stream.getVideoTracks()[0]);
    };
    const off = api.on('screen-signal', onSignal as never);
    api.screen.ready(sid);

    void (async () => {
      const info = await api.screen.session(sid);
      setS(info);
      try {
        stream = await capture();
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play().catch(() => undefined);
        }
        if (info?.path === 'frames' || info?.peer.startsWith('phone:')) startFrames();
        else await startP2P(stream.getVideoTracks()[0]);
      } catch (e) {
        setNote(`Could not capture the screen: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    void stated;

    return () => {
      stopped = true;
      off();
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      pc?.close();
      stream?.getTracks().forEach((t) => t.stop());
      extraTracks.forEach((t) => t.stop());
      composeStop?.();
    };
  }, []);

  const helping = !!s?.help;
  const canGrant = !!s && !s.joined;

  return (
    <div className="screen-banner" role="status">
      <span className="screen-banner-dot" />
      <span className="screen-banner-text" title={note}>
        {s ? helping ? <><b>{s.peerName}</b> is helping you · {s.control ? 'can use the mouse and keyboard' : 'view only'}</> : <><b>{s.peerName}</b> is {s.control ? 'controlling' : 'viewing'} this screen</> : 'Sharing this screen'}
        {chat ? <span className="screen-banner-chat">“{chat}”</span> : null}
      </span>
      {talkAsk && !talking ? <button className="screen-banner-btn" onClick={() => { voiceRef.current = true; setTalking(true); setTalkAsk(false); void api.screen.signal(sid, { t: 'voice', on: true }); restartRef.current?.(); }}>Talk</button> : null}
      {canGrant ? (s!.control
        ? <button className="screen-banner-btn" onClick={() => void api.screen.setControl(sid, false)} data-testid="banner-revoke">Take Back Control</button>
        : helping || s!.peer.startsWith('phone:') ? <button className="screen-banner-btn" onClick={() => void api.screen.setControl(sid, true)} data-testid="banner-grant">Allow Control</button> : null) : null}
      <button className="screen-banner-stop" onClick={() => void api.screen.stop(sid)}>{helping ? 'Stop' : 'Stop sharing'}</button>
      <audio id="voice-out" autoPlay />
      <video ref={video} muted playsInline className="screen-banner-video" />
    </div>
  );
}
