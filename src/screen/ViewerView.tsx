// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Watching (and, when allowed, controlling) another Keeper device's screen.
// The picture comes over a direct WebRTC connection when one can be made, or
// as frames through Keeper Link. Pointer and keys go back over Link.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fromViewer } from '../../core/screen/input';
import { DEFAULT_PASSTHROUGH, passes, type CodecPref, type DisplayMode, type Passthrough } from '../../core/screen/extras';
import { checkBinding, soleFingerprint, stripCandidates } from '../../core/screen/sdp';
import { SPECIAL_COMBOS, type ControlMessage, type HostDisplay, type HostExtras, type InputEvent, type Quality, type ScreenPath, type SpecialCombo } from '../../core/screen/types';
import type { RemoteEntry } from '../../core/api-link';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { certificateOk, connected, gathered, pathLabel, rtcConfig } from './rtc';
import '../styles/screen.css';

const urlSid = new URLSearchParams(location.search).get('sid') ?? '';

const PT_KEY = 'keeper.viewer.passthrough';
const loadPt = (): Passthrough => {
  try {
    return { ...DEFAULT_PASSTHROUGH, ...JSON.parse(localStorage.getItem(PT_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PASSTHROUGH;
  }
};

interface Info {
  peer: string;
  peerName: string;
  control: boolean;
  controlNote?: string;
  displays: HostDisplay[];
  display?: string;
  os?: string;
  extras?: HostExtras;
}

export function ViewerView({ sid: sidProp, embedded }: { sid?: string; embedded?: boolean } = {}) {
  const sid = sidProp ?? urlSid;
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState('Asking the other computer…');
  const [path, setPath] = useState<ScreenPath | null>(null);
  const [pathText, setPathText] = useState('');
  const [ended, setEnded] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [fit, setFit] = useState(true);
  const [quality, setQuality] = useState<Quality>('auto');
  const [stats, setStats] = useState<{ fps: number; kbps: number; rtt?: number }>({ fps: 0, kbps: 0 });
  const [chat, setChat] = useState<{ from: 'me' | 'them'; text: string }[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState('');
  const [keysOpen, setKeysOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState<DisplayMode>('one');
  const [codec, setCodec] = useState<CodecPref>('auto');
  const [lossless, setLossless] = useState(false);
  const [audio, setAudio] = useState(false);
  const [blank, setBlank] = useState(false);
  const [block, setBlock] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [voice, setVoice] = useState<'off' | 'asked' | 'on'>('off');
  const [filesOpen, setFilesOpen] = useState(false);
  const [pt, setPt] = useState<Passthrough>(loadPt);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [inviting, setInviting] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stroke = useRef<[number, number][] | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const voiceRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const queue = useRef<InputEvent[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const frameCount = useRef(0);
  const bytes = useRef(0);
  const controlOn = !!info?.control && !viewOnly;

  const say = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 3000);
  };

  // ---- signals from the host
  useEffect(() => {
    document.title = 'Keeper — remote screen';
    void api.screen.session(sid).then((s) => {
      if (!s) return;
      setInfo((i) => i ?? { peer: s.peer, peerName: s.peerName, control: s.control, displays: s.displays, display: s.display });
      if (s.state === 'ended') setEnded(s.ended?.reason ?? 'Ended');
    });
    const off = api.on('screen-signal', (async (id: string, m: ControlMessage | { t: 'clip-done' }) => {
      if (id !== sid) return;
      if (m.t === 'hello') {
        setInfo((i) => ({ ...(i ?? { peer: '', peerName: '' }), control: m.control, controlNote: m.controlNote, displays: m.displays, display: m.display, os: m.os, extras: m.extras }));
        setStatus('Connecting…');
      } else if (m.t === 'sdp' && m.type === 'offer') {
        try {
          checkBinding(m.sdp, m.fingerprint);
          const { config, scope } = await rtcConfig();
          // A new offer (sound or voice switched on) replaces the connection.
          pcRef.current?.close();
          const pc = new RTCPeerConnection(config);
          pcRef.current = pc;
          if (voiceRef.current && /m=audio/.test(m.sdp)) {
            micRef.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
            micRef.current?.getAudioTracks().forEach((t) => pc.addTrack(t, micRef.current!));
          }
          pc.ontrack = (e) => {
            if (e.track.kind === 'audio') {
              if (audioRef.current) {
                const ms = (audioRef.current.srcObject as MediaStream | null) ?? new MediaStream();
                ms.addTrack(e.track);
                audioRef.current.srcObject = ms;
                void audioRef.current.play().catch(() => undefined);
              }
              return;
            }
            if (videoRef.current) {
              videoRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
              void videoRef.current.play().catch(() => undefined);
            }
          };
          await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
          await pc.setLocalDescription(await pc.createAnswer());
          await gathered(pc);
          const sdp = stripCandidates(pc.localDescription!.sdp, scope);
          await api.screen.signal(sid, { t: 'sdp', type: 'answer', sdp, fingerprint: soleFingerprint(sdp) });
          if (await connected(pc, 9000)) {
            if (!(await certificateOk(pc, m.fingerprint))) {
              pc.close();
              setStatus('The direct connection used an unexpected certificate; waiting for the Link picture');
              return;
            }
            setPathText(await pathLabel(pc));
          }
        } catch (e) {
          setStatus(e instanceof Error ? e.message : String(e));
        }
      } else if (m.t === 'path') {
        setPath(m.path);
        setStatus('');
        if (m.path === 'frames') setPathText('Through Keeper Link');
      } else if (m.t === 'chat') {
        setChat((c) => [...c, { from: 'them', text: m.text }]);
        setChatOpen(true);
      } else if (m.t === 'clip') {
        say('Copied the other computer’s clipboard here');
      } else if (m.t === 'clip-done') {
        say('Clipboard sent');
      } else if (m.t === 'grant') {
        setInfo((i) => (i ? { ...i, control: m.control, controlNote: m.control ? undefined : i.controlNote } : i));
        say(m.control ? 'You can now use the mouse and keyboard' : 'Control was taken back: view only');
      } else if (m.t === 'cursor') {
        setCursor({ x: m.x, y: m.y });
      } else if (m.t === 'display') {
        setInfo((i) => (i ? { ...i, display: m.id } : i));
      } else if (m.t === 'voice') {
        if (m.on) say('Voice chat is on');
      } else if (m.t === 'printed') {
        say(m.ok ? `Printed ${m.name}` : `Not printed: ${m.error ?? ''}`);
      } else if (m.t === 'bye') {
        setEnded(m.reason);
      }
    }) as never);
    const offEnd = api.on('screen-ended', ((id: string, reason: string) => id === sid && setEnded(reason)) as never);
    // ---- the fallback picture: JPEG frames
    api.screen.ready(sid);
    const offFrame = api.on('screen-frame', (async (id: string, f: { header: { seq: number; w: number; h: number }; jpeg: Uint8Array }) => {
      if (id !== sid) return;
      api.screen.ack(sid, f.header.seq);
      frameCount.current++;
      bytes.current += f.jpeg.length;
      const bmp = await createImageBitmap(new Blob([f.jpeg as BlobPart], { type: 'image/jpeg' }));
      const c = canvasRef.current;
      if (!c) return;
      if (c.width !== bmp.width || c.height !== bmp.height) {
        c.width = bmp.width;
        c.height = bmp.height;
      }
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      bmp.close();
      setPath((p) => p ?? 'frames');
      setStatus('');
    }) as never);
    return () => {
      off();
      offEnd();
      offFrame();
      pcRef.current?.close();
      micRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [sid]);

  // ---- once a second: frames per second and data rate
  useEffect(() => {
    let prevFrames = 0;
    let prevBytes = 0;
    const t = window.setInterval(async () => {
      const pc = pcRef.current;
      if (path === 'p2p' && pc) {
        const s = [...(await pc.getStats()).values()] as Array<Record<string, number & string>>;
        const inb = s.find((x) => x.type === 'inbound-rtp' && x.kind === 'video');
        const pair = s.find((x) => x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded');
        const fr = Number(inb?.framesDecoded ?? 0);
        const by = Number(inb?.bytesReceived ?? 0);
        setStats({ fps: Math.max(0, fr - prevFrames), kbps: Math.max(0, Math.round(((by - prevBytes) * 8) / 1000)), rtt: pair?.currentRoundTripTime ? Math.round(Number(pair.currentRoundTripTime) * 1000) : undefined });
        prevFrames = fr;
        prevBytes = by;
      } else {
        setStats({ fps: frameCount.current, kbps: Math.round((bytes.current * 8) / 1000) });
        frameCount.current = 0;
        bytes.current = 0;
      }
    }, 1000);
    return () => clearInterval(t);
  }, [path]);

  // ---- input: batched every 16 ms
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!queue.current.length) return;
      api.screen.input(sid, queue.current.splice(0));
    }, 16);
    return () => clearInterval(t);
  }, []);

  const picture = () => {
    const v = videoRef.current;
    if (path === 'p2p' && v?.videoWidth) return { w: v.videoWidth, h: v.videoHeight, el: v as HTMLElement };
    const c = canvasRef.current;
    return c ? { w: c.width, h: c.height, el: c as HTMLElement } : null;
  };

  const at = (e: { clientX: number; clientY: number }) => {
    const p = picture();
    if (!p) return null;
    const r = p.el.getBoundingClientRect();
    return fromViewer(e.clientX, e.clientY, { left: r.left, top: r.top, width: r.width, height: r.height }, p.w, p.h);
  };

  const push = useCallback((e: InputEvent) => {
    if (!controlOn) return;
    queue.current.push(e);
  }, [controlOn]);

  useEffect(() => {
    if (!controlOn) return;
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      // Embedded in a tab: only while the picture has focus. Shortcut passthrough: some keys stay here.
      if (embedded && !surface.current?.contains(document.activeElement)) return;
      if (!passes(e, pt)) return;
      e.preventDefault();
      push({ t: 'key', code: e.code, down, mods: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey } });
    };
    const kd = key(true);
    const ku = key(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [controlOn, push, pt, embedded]);

  const pointer = (t: 'move' | 'down' | 'up') => (e: React.PointerEvent) => {
    const p = at(e);
    if (!p) return;
    if (drawing) {
      // Drawing on the other screen for teaching: strokes, not clicks.
      if (t === 'down') stroke.current = [[p.x, p.y]];
      else if (t === 'move' && stroke.current) stroke.current.push([p.x, p.y]);
      else if (t === 'up' && stroke.current) {
        void api.screen.signal(sid, { t: 'draw', stroke: { id: String(Date.now()), points: stroke.current, color: '#ff3b30', width: 4 } });
        stroke.current = null;
      }
      return;
    }
    if (t === 'move') push({ t, ...p });
    // No pointer capture: on X11 it grabs the whole pointer, which would swallow clicks meant for the other screen.
    else push({ t, ...p, button: (e.button === 2 ? 2 : e.button === 1 ? 1 : 0) as 0 | 1 | 2 });
  };

  const wheel = (e: React.WheelEvent) => {
    const p = at(e);
    if (!p) return;
    const k = e.deltaMode === 1 ? 1 : 1 / 100;
    push({ t: 'wheel', ...p, dx: e.deltaX * k, dy: e.deltaY * k });
  };

  // ---- toolbar actions
  const setDisplay = (id: string) => {
    setInfo((i) => (i ? { ...i, display: id } : i));
    void api.screen.signal(sid, { t: 'display', id });
  };
  const setQ = (q: Quality) => {
    setQuality(q);
    void api.screen.signal(sid, { t: 'quality', q });
  };
  const combo = (c: SpecialCombo) => {
    setKeysOpen(false);
    if (info?.control) api.screen.input(sid, [{ t: 'combo', combo: c }]);
  };
  const sendChat = () => {
    const text = draft.trim();
    if (!text) return;
    void api.screen.signal(sid, { t: 'chat', text, at: Date.now() });
    setChat((c) => [...c, { from: 'me', text }]);
    setDraft('');
  };
  const sendClipboard = async () => {
    const text = await navigator.clipboard.readText().catch(() => '');
    if (text) void api.screen.signal(sid, { t: 'clip', text });
  };
  const record = () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    const src = path === 'p2p' ? (videoRef.current?.srcObject as MediaStream | null) : canvasRef.current?.captureStream(15);
    if (!src) return;
    const r = new MediaRecorder(src, { mimeType: 'video/webm' });
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = async () => {
      setRecording(false);
      const buf = new Uint8Array(await new Blob(chunks.current, { type: 'video/webm' }).arrayBuffer());
      const file = await api.screen.saveRecording(buf, `${info?.peerName ?? 'Remote screen'} recording`);
      say(`Saved ${file.split(/[\\/]/).pop()}`);
    };
    r.start(1000);
    recorder.current = r;
    setRecording(true);
  };
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (!info) return;
    const paths = [...e.dataTransfer.files].map((f) => api.files.pathOf?.(f) ?? '').filter(Boolean);
    if (paths.length) {
      say(`Sending ${paths.length} file${paths.length === 1 ? '' : 's'}…`);
      await api.link.sendFiles(info.peer, paths).catch((err: Error) => say(err.message));
    }
  };

  const combos = SPECIAL_COMBOS.filter((c) => !c.os || !info?.os || c.os.includes(info.os));
  const ex = info?.extras;
  const sig = (m: ControlMessage) => void api.screen.signal(sid, m);
  const setPass = (p: Passthrough) => {
    setPt(p);
    try {
      localStorage.setItem(PT_KEY, JSON.stringify(p));
    } catch {
      /* not kept */
    }
  };
  const toggleVoice = async () => {
    if (voice !== 'off') {
      voiceRef.current = false;
      micRef.current?.getTracks().forEach((t) => t.stop());
      micRef.current = null;
      setVoice('off');
      sig({ t: 'voice', on: false });
      return;
    }
    voiceRef.current = true;
    setVoice('asked');
    sig({ t: 'voice', on: true });
    say('Asked the other side to talk; they turn it on from their banner');
  };
  const cursorStyle = (() => {
    const p = picture();
    if (!cursor || !p || !surface.current || controlOn) return null;
    const r = p.el.getBoundingClientRect();
    const sr = surface.current.getBoundingClientRect();
    return { left: r.left - sr.left + surface.current.scrollLeft + cursor.x * r.width, top: r.top - sr.top + surface.current.scrollTop + cursor.y * r.height };
  })();

  return (
    <div className={`viewer ${embedded ? 'embedded' : ''} ${drawing ? 'drawing' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void drop(e)}>
      <div className="viewer-bar">
        <span className={`viewer-dot ${ended ? 'off' : path ? 'on' : ''}`} />
        <b className="ellipsis">{info?.peerName ?? 'Remote screen'}</b>
        <span className="viewer-meta">{pathText}{path ? ` · ${stats.fps} fps · ${stats.kbps >= 1000 ? `${(stats.kbps / 1000).toFixed(1)} Mb/s` : `${stats.kbps} kb/s`}${stats.rtt !== undefined ? ` · ${stats.rtt} ms` : ''}` : ''}</span>
        <span className="grow" />
        {info && info.displays.length > 1 ? (
          <select className="viewer-select" value={mode === 'one' ? info.display : `mode:${mode}`} onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('mode:')) { const m = v.slice(5) as DisplayMode; setMode(m); sig({ t: 'mode', mode: m }); }
            else { setMode('one'); sig({ t: 'mode', mode: 'one' }); setDisplay(v); }
          }} title="Which screen" data-testid="viewer-display">
            {info.displays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            <option value="mode:all">All screens</option>
            <option value="mode:follow">Follow the pointer</option>
          </select>
        ) : null}
        {ex?.windows.length ? (
          <select className="viewer-select" defaultValue="" onChange={(e) => sig({ t: 'window', id: e.target.value })} title="Show one window only">
            <option value="">Whole screen</option>
            {ex.windows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        ) : null}
        <select className="viewer-select" value={quality} onChange={(e) => setQ(e.target.value as Quality)} title="Picture quality">
          <option value="auto">Auto quality</option>
          <option value="speed">Fastest</option>
          <option value="balanced">Balanced</option>
          <option value="sharp">Sharpest</option>
        </select>
        <button className={`viewer-btn ${fit ? '' : 'on'}`} onClick={() => setFit(!fit)} title={fit ? 'Show at actual size' : 'Fit to window'}>{fit ? 'Fit' : '1:1'}</button>
        {info?.control ? (
          <button className={`viewer-btn ${viewOnly ? 'on' : ''}`} onClick={() => setViewOnly(!viewOnly)} title="Watch without sending mouse and keys">
            <Icon name="eye" size={14} /> {viewOnly ? 'View only' : 'Control'}
          </button>
        ) : null}
        {info?.control ? (
          <div className="viewer-menu-wrap">
            <button className="viewer-btn" onClick={() => setKeysOpen(!keysOpen)} title="Keys your own computer would catch">Keys <Icon name="chevronDown" size={12} /></button>
            {keysOpen ? <div className="viewer-menu">{combos.map((c) => <button key={c.id} onClick={() => combo(c.id)}>{c.label}</button>)}</div> : null}
          </div>
        ) : null}
        {info?.control ? <button className="viewer-btn" onClick={() => void sendClipboard()} title="Send this computer’s clipboard"><Icon name="clipboard" size={14} /></button> : null}
        {info?.control ? <button className="viewer-btn" onClick={() => void api.screen.signal(sid, { t: 'clipget' })} title="Copy the other computer’s clipboard here"><Icon name="down" size={14} /></button> : null}
        <button className="viewer-btn" onClick={() => info && void api.link.sendFiles(info.peer)} title="Send files (or drop them on the picture)"><Icon name="send" size={14} /></button>
        <button className={`viewer-btn ${chatOpen ? 'on' : ''}`} onClick={() => setChatOpen(!chatOpen)} title="Chat"><Icon name="mail" size={14} /></button>
        <button className={`viewer-btn ${voice !== 'off' ? 'on' : ''}`} onClick={() => void toggleVoice()} title="Voice chat (both sides turn it on)" data-testid="viewer-voice"><Icon name="mic" size={14} /></button>
        {!ex?.help ? <button className={`viewer-btn ${filesOpen ? 'on' : ''}`} onClick={() => setFilesOpen(!filesOpen)} title="Files on both sides" data-testid="viewer-files"><Icon name="folder" size={14} /></button> : null}
        <div className="viewer-menu-wrap">
          <button className={`viewer-btn ${moreOpen ? 'on' : ''}`} onClick={() => setMoreOpen(!moreOpen)} data-testid="viewer-more">More <Icon name="chevronDown" size={12} /></button>
          {moreOpen ? (
            <div className="viewer-menu wide" onClick={(e) => e.stopPropagation()}>
              <div className="viewer-menu-h">Picture</div>
              <label>Codec <select value={codec} onChange={(e) => { const c = e.target.value as CodecPref; setCodec(c); sig({ t: 'tune', codec: c }); }}><option value="auto">Automatic</option><option value="h264">H.264</option><option value="vp9">VP9</option><option value="av1">AV1</option></select></label>
              <label><input type="checkbox" checked={lossless} onChange={(e) => { setLossless(e.target.checked); sig({ t: 'tune', lossless: e.target.checked }); }} /> Sharp text (lossless look)</label>
              <label title={ex?.audioNote}><input type="checkbox" disabled={!ex?.audio} checked={audio} onChange={(e) => { setAudio(e.target.checked); sig({ t: 'tune', audio: e.target.checked }); }} /> Sound from {info?.peerName ?? 'there'}</label>
              {!ex?.audio && ex?.audioNote ? <div className="viewer-menu-note">{ex.audioNote}</div> : null}
              <button onClick={() => { setDrawing(!drawing); setMoreOpen(false); }}>{drawing ? 'Stop drawing' : 'Draw on their screen'}</button>
              {drawing ? <button onClick={() => sig({ t: 'draw', clear: true })}>Clear drawings</button> : null}
              {info?.control ? (
                <>
                  <div className="viewer-menu-h">Privacy there</div>
                  <label title={ex?.blankNote}><input type="checkbox" disabled={!ex?.blank} checked={blank} onChange={(e) => { setBlank(e.target.checked); sig({ t: 'privacy', blank: e.target.checked }); }} /> Darken their screen</label>
                  {!ex?.blank && ex?.blankNote ? <div className="viewer-menu-note">{ex.blankNote}</div> : null}
                  <label title={ex?.blockNote}><input type="checkbox" disabled={!ex?.block} checked={block} onChange={(e) => { setBlock(e.target.checked); sig({ t: 'privacy', block: e.target.checked }); }} /> Block their keyboard and mouse</label>
                  {!ex?.block && ex?.blockNote ? <div className="viewer-menu-note">{ex.blockNote}</div> : null}
                </>
              ) : null}
              <div className="viewer-menu-h">Keys that go there</div>
              <label><input type="checkbox" checked={pt.appSwitch} onChange={(e) => setPass({ ...pt, appSwitch: e.target.checked })} /> Switching apps (Alt+Tab, ⌘Tab)</label>
              <label><input type="checkbox" checked={pt.meta} onChange={(e) => setPass({ ...pt, meta: e.target.checked })} /> Windows / Command key</label>
              <label><input type="checkbox" checked={pt.fkeys} onChange={(e) => setPass({ ...pt, fkeys: e.target.checked })} /> F1–F12</label>
              {!ex?.help ? (
                <>
                  <div className="viewer-menu-h">Session</div>
                  {info?.control ? <button onClick={() => { setMoreOpen(false); void api.access.print(info.peer).catch((err: Error) => say(err.message)); }}>Print a file there…</button> : null}
                  <button onClick={() => { setInviting(true); setMoreOpen(false); }} data-testid="viewer-invite">Invite another viewer…</button>
                  <button onClick={() => sig({ t: 'switch' })}>Switch sides</button>
                  {info?.control ? <button onClick={() => { setMoreOpen(false); void api.screen.reboot(sid).then(() => say(`Restarting ${info.peerName}; this reconnects when it is back${ex?.unattended ? ' (even before login)' : ' (after someone logs in there)'}`), (err: Error) => say(err.message)); }}>Restart and reconnect</button> : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <button className={`viewer-btn ${recording ? 'rec' : ''}`} onClick={record} title={recording ? 'Stop recording' : 'Record this session (saved on this computer)'}><span className="viewer-rec" /></button>
        <button className="viewer-btn" onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen())} title="Full screen"><Icon name="grid" size={14} /></button>
        <button className="viewer-btn danger" onClick={() => void api.screen.stop(sid)}>End</button>
      </div>
      {ex?.help ? <div className="viewer-note">{info?.control ? `You are helping ${info.peerName} and may use their mouse and keyboard. They can take it back at any time.` : `You are helping ${info?.peerName ?? 'them'}. View only until they let you control.`}</div> : null}
      {drawing ? <div className="viewer-note">Drawing: your strokes appear on their screen. Choose More → Stop drawing to click again.</div> : null}
      {info?.controlNote && info.control === false ? <div className="viewer-note">{info.controlNote}</div> : null}
      <div
        ref={surface}
        className={`viewer-surface ${fit ? 'fit' : 'actual'} ${controlOn ? 'control' : ''}`}
        onPointerMove={pointer('move')}
        onPointerDown={pointer('down')}
        onPointerUp={pointer('up')}
        onWheel={wheel}
        onContextMenu={(e) => controlOn && e.preventDefault()}
      >
        <video ref={videoRef} className="viewer-video" muted playsInline style={{ display: path === 'p2p' ? undefined : 'none' }} data-testid="viewer-video" />
        <canvas ref={canvasRef} className="viewer-video" style={{ display: path === 'frames' ? undefined : 'none' }} data-testid="viewer-canvas" />
        {status && !ended ? <div className="viewer-status">{status}</div> : null}
        {cursorStyle && path ? <div className="viewer-cursor" style={cursorStyle} /> : null}
        {ended ? <div className="viewer-status ended" data-testid="viewer-ended"><b>Session ended</b><span>{ended}</span>{embedded ? null : <button className="viewer-btn" onClick={() => window.close()}>Close</button>}</div> : null}
      </div>
      <audio ref={audioRef} autoPlay />
      {filesOpen && info ? <FilesPanel device={info.peer} name={info.peerName} say={say} /> : null}
      {inviting && info ? <InvitePicker host={info.peer} onPick={(d) => { setInviting(false); if (d) { sig({ t: 'invite', device: d }); say('Invitation sent'); } }} /> : null}
      {chatOpen ? (
        <div className="viewer-chat">
          <div className="viewer-chat-list">{chat.map((c, i) => <div key={i} className={`viewer-msg ${c.from}`}>{c.text}</div>)}</div>
          <input className="viewer-chat-input" value={draft} placeholder="Message…" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} />
        </div>
      ) : null}
      {toast ? <div className="viewer-toast">{toast}</div> : null}
    </div>
  );
}

/** Two panes: their shared folders on the left, sending from here on the right (Keeper Link shared folders). */
function FilesPanel({ device, name, say }: { device: string; name: string; say: (t: string) => void }) {
  const [shares, setShares] = useState<{ id: string; name: string }[] | null>(null);
  const [share, setShare] = useState('');
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => void api.link.shares(device).then((x) => { setShares(x); if (x[0]) setShare(x[0].id); }, (e: Error) => setErr(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))), [device]);
  useEffect(() => {
    if (!share) return;
    setEntries(null);
    void api.link.list(device, share, dir).then(setEntries, (e: Error) => setErr(e.message));
  }, [device, share, dir]);
  return (
    <div className="viewer-files" data-testid="viewer-files-panel">
      <div className="viewer-files-pane">
        <div className="viewer-menu-h">On {name}</div>
        {err ? <div className="viewer-menu-note">{err}</div> : null}
        {shares && !shares.length ? <div className="viewer-menu-note">{name} shares no folders.</div> : null}
        {shares?.length ? <select className="viewer-select" value={share} onChange={(e) => { setShare(e.target.value); setDir(''); }}>{shares.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> : null}
        {dir ? <button className="viewer-btn" onClick={() => setDir(dir.split('/').slice(0, -1).join('/'))}>↑ {dir}</button> : null}
        <div className="viewer-files-list">
          {(entries ?? []).map((e) => (
            <div key={e.name} className="viewer-files-row">
              <span className="grow" onDoubleClick={() => e.isDir && setDir(dir ? `${dir}/${e.name}` : e.name)}>{e.isDir ? '📁 ' : ''}{e.name}</span>
              {!e.isDir ? <button className="viewer-btn" onClick={() => void api.link.download(device, share, dir ? `${dir}/${e.name}` : e.name).then((p) => say(`Copied to ${p.split(/[\\/]/).pop()}`), (x: Error) => say(x.message))}>Copy here</button> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="viewer-files-pane">
        <div className="viewer-menu-h">From this computer</div>
        <div className="viewer-menu-note">Drop files on the picture, or pick them. {name} saves them in Downloads/Keeper.</div>
        <button className="viewer-btn" onClick={() => void api.link.sendFiles(device).then(() => say('Sent'), (x: Error) => say(x.message))}>Send Files…</button>
      </div>
    </div>
  );
}

function InvitePicker({ host, onPick }: { host: string; onPick: (device: string | null) => void }) {
  const [devs, setDevs] = useState<{ id: string; name: string; online: boolean }[]>([]);
  useEffect(() => void api.link.state().then((s) => setDevs(s.devices.filter((d) => d.id !== host))).catch(() => undefined), [host]);
  return (
    <div className="viewer-chat" style={{ right: 10, top: 50 }}>
      <div className="viewer-menu-h">Invite to watch (view only)</div>
      {devs.length ? devs.map((d) => <button key={d.id} className="viewer-btn" onClick={() => onPick(d.id)} data-testid="invite-device">{d.name}{d.online ? '' : ' (offline)'}</button>) : <div className="viewer-menu-note">Pair another device with both computers first.</div>}
      <button className="viewer-btn" onClick={() => onPick(null)}>Cancel</button>
    </div>
  );
}
