// SPDX-License-Identifier: AGPL-3.0-or-later
// Watching (and, when allowed, controlling) another Keeper device's screen.
// The picture comes over a direct WebRTC connection when one can be made, or
// as frames through Keeper Link. Pointer and keys go back over Link.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fromViewer } from '../../core/screen/input';
import { checkBinding, soleFingerprint, stripCandidates } from '../../core/screen/sdp';
import { SPECIAL_COMBOS, type ControlMessage, type HostDisplay, type InputEvent, type Quality, type ScreenPath, type SpecialCombo } from '../../core/screen/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { certificateOk, connected, gathered, pathLabel, rtcConfig } from './rtc';
import '../styles/screen.css';

const sid = new URLSearchParams(location.search).get('sid') ?? '';

interface Info {
  peer: string;
  peerName: string;
  control: boolean;
  controlNote?: string;
  displays: HostDisplay[];
  display?: string;
  os?: string;
}

export function ViewerView() {
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
        setInfo((i) => ({ ...(i ?? { peer: '', peerName: '' }), control: m.control, controlNote: m.controlNote, displays: m.displays, display: m.display, os: m.os }));
        setStatus('Connecting…');
      } else if (m.t === 'sdp' && m.type === 'offer') {
        try {
          checkBinding(m.sdp, m.fingerprint);
          const { config, scope } = await rtcConfig();
          const pc = new RTCPeerConnection(config);
          pcRef.current = pc;
          pc.ontrack = (e) => {
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
    };
  }, []);

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
  }, [controlOn, push]);

  const pointer = (t: 'move' | 'down' | 'up') => (e: React.PointerEvent) => {
    const p = at(e);
    if (!p) return;
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

  return (
    <div className="viewer" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void drop(e)}>
      <div className="viewer-bar">
        <span className={`viewer-dot ${ended ? 'off' : path ? 'on' : ''}`} />
        <b className="ellipsis">{info?.peerName ?? 'Remote screen'}</b>
        <span className="viewer-meta">{pathText}{path ? ` · ${stats.fps} fps · ${stats.kbps >= 1000 ? `${(stats.kbps / 1000).toFixed(1)} Mb/s` : `${stats.kbps} kb/s`}${stats.rtt !== undefined ? ` · ${stats.rtt} ms` : ''}` : ''}</span>
        <span className="grow" />
        {info && info.displays.length > 1 ? (
          <select className="viewer-select" value={info.display} onChange={(e) => setDisplay(e.target.value)} title="Which screen">
            {info.displays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
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
        <button className={`viewer-btn ${recording ? 'rec' : ''}`} onClick={record} title={recording ? 'Stop recording' : 'Record this session (saved on this computer)'}><span className="viewer-rec" /></button>
        <button className="viewer-btn" onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen())} title="Full screen"><Icon name="grid" size={14} /></button>
        <button className="viewer-btn danger" onClick={() => void api.screen.stop(sid)}>End</button>
      </div>
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
        {ended ? <div className="viewer-status ended" data-testid="viewer-ended"><b>Session ended</b><span>{ended}</span><button className="viewer-btn" onClick={() => window.close()}>Close</button></div> : null}
      </div>
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
