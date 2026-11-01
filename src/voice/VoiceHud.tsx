// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The listening pill: floats over whatever app you're dictating into without
// taking its focus. Shows the live text as you speak, a review step, the
// "record this call?" offer with its consent reminder, and a small meeting bar.

import { useEffect, useRef, useState } from 'react';
import type { DictationState, MeetingLive, MeetingOffer, VoiceSettings } from '../../core/voice/types';
import { holdKeyLabel } from '../../core/voice/settings';
import { clock } from '../../core/voice/meeting';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Capture, playSound } from './capture';
import './voice.css';

const isMac = navigator.platform.includes('Mac');

export function VoiceHud() {
  const [st, setSt] = useState<DictationState>({ phase: 'idle', stable: '', pending: '' });
  const [meeting, setMeetingRaw] = useState<MeetingLive | undefined>();
  const meetingAt = useRef(Date.now());
  const setMeeting = (m: MeetingLive | undefined) => { meetingAt.current = Date.now(); setMeetingRaw(m); };
  const [offer, setOffer] = useState<MeetingOffer | undefined>();
  const [cfg, setCfg] = useState<VoiceSettings | null>(null);
  const [level, setLevel] = useState(0);
  const [capErr, setCapErr] = useState('');
  const [, tick] = useState(0);
  const cap = useRef(new Capture());
  const textEl = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offs = [
      api.on('voice-state', (s, m, o) => { setSt(s); setMeeting(m); setOffer(o); }),
      api.on('voice-meeting', (m) => setMeeting(m ?? undefined)),
      api.on('voice-level', (n) => setLevel(n)),
      api.on('voice-settings', (s) => setCfg(s)),
      api.on('voice-sound', (k) => playSound(k)),
      api.on('voice-capture', (c) => void cap.current.set(c).then(() => setCapErr(cap.current.error))),
    ];
    // Subscribed first, then ask: a recording that started while this window loaded is picked up.
    void api.voice.hud.ready().then((r) => {
      setCfg(r.settings); setSt(r.state); setMeeting(r.meeting); setOffer(r.offer);
      if (r.capture?.mic || r.capture?.system) void cap.current.set(r.capture).then(() => setCapErr(cap.current.error));
    });
    return () => { offs.forEach((f) => f()); cap.current.stop(); };
  }, []);

  // the meeting clock
  useEffect(() => {
    if (!meeting || meeting.paused) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [meeting]);

  useEffect(() => { textEl.current?.scrollTo({ left: 1e6 }); }, [st.stable, st.pending]);

  const keyName = cfg ? holdKeyLabel(cfg.dictation.key, isMac ? 'darwin' : 'other') : '';
  const bars = Array.from({ length: 9 }, (_, i) => 4 + Math.max(0, level - Math.abs(i - 4) * 0.09) * 26);

  if (st.phase === 'review') {
    return (
      <div className="vhud vhud-card" data-testid="voice-review">
        <div className="vhud-head"><Icon name={st.ask ? 'sparkle' : 'mic'} size={14} /> {st.ask ? 'Edit by voice' : 'Ready to type'}{st.app ? <span className="vhud-app">{st.app}</span> : null}</div>
        {st.ask ? <div className="vhud-ask">{st.ask}</div> : <div className="vhud-review-text">{st.review}</div>}
        <div className="vhud-actions">
          {st.ask ? (
            <>
              <button className="btn sm" onClick={() => api.voice.hud.key('escape')}>Cancel</button>
              <button className="btn sm" onClick={() => api.voice.hud.key('always')}>Always allow</button>
              <button className="btn sm primary" onClick={() => api.voice.hud.key('enter')}>Allow once</button>
            </>
          ) : (
            <>
              <button className="btn sm" onClick={() => api.voice.hud.key('escape')}>Keep in history <kbd>Esc</kbd></button>
              <button className="btn sm primary" data-testid="voice-review-type" onClick={() => api.voice.hud.key('enter')}>Type it <kbd>↩</kbd></button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (st.phase !== 'idle') {
    const listening = st.phase === 'listening' || st.phase === 'locked' || st.phase === 'editing';
    return (
      <div className={`vhud vhud-pill ${st.phase}`} data-testid="voice-pill">
        <div className={`vhud-mic${listening ? ' live' : ''}`}><Icon name={st.phase === 'editing' ? 'sparkle' : 'mic'} size={16} /></div>
        <div className="vhud-body">
          <div className="vhud-text" ref={textEl}>
            {capErr ? <span className="vhud-err">{capErr}</span>
              : st.stable || st.pending ? <><span>{st.stable}</span> <span className="vhud-pending">{st.pending}</span></>
              : <span className="vhud-hint">{st.phase === 'working' ? 'Writing it down…' : st.phase === 'editing' ? 'Say how to change the selected text…' : 'Listening…'}</span>}
          </div>
          <div className="vhud-sub">
            {st.phase === 'working' ? 'Tidying up' : st.how === 'locked' || st.how === 'toggle' ? `Locked on · ${st.how === 'locked' ? `press ${keyName}` : 'press the shortcut'} to finish · Esc cancels` : st.how === 'hands-free' ? 'Hands-free · stops after a pause · Esc cancels' : st.how === 'hold' ? `Release ${keyName} to finish · Esc cancels` : 'Esc cancels'}
            {st.app ? <> · <b>{st.app}</b>{st.tone ? ` (${st.tone})` : ''}</> : null}
          </div>
        </div>
        {listening ? <div className="vhud-bars" aria-hidden>{bars.map((h, i) => <i key={i} style={{ height: h }} />)}</div> : <div className="vhud-spin" aria-hidden />}
      </div>
    );
  }

  if (offer && !meeting) {
    return (
      <div className="vhud vhud-card" data-testid="voice-offer">
        <div className="vhud-head"><span className="vhud-rec" /> Record this {offer.app} call?</div>
        <div className="vhud-ask">{offer.reason}{offer.event ? ` · “${offer.event.title}”` : ''}.</div>
        <div className="vhud-consent"><Icon name="info" size={12} /> Tell everyone it’s being recorded first — in many places their consent is required.</div>
        <div className="vhud-actions">
          <button className="btn sm ghost" onClick={() => void api.voice.dismissOffer(offer.id, true)}>Never for {offer.app}</button>
          <button className="btn sm" onClick={() => void api.voice.dismissOffer(offer.id)}>Not now</button>
          <button className="btn sm primary" data-testid="voice-offer-record" onClick={() => void api.voice.startMeeting({ app: offer.app, offerId: offer.id })}><span className="vhud-rec" /> Record</button>
        </div>
      </div>
    );
  }

  if (meeting) {
    const last = meeting.utterances[meeting.utterances.length - 1];
    const elapsed = meeting.paused ? meeting.elapsedMs : meeting.elapsedMs + (Date.now() - meetingAt.current);
    return (
      <div className="vhud vhud-pill meeting" data-testid="voice-meeting-bar">
        <div className={`vhud-mic rec${meeting.paused ? '' : ' live'}`}><span className="vhud-rec" /></div>
        <div className="vhud-body">
          <div className="vhud-text"><b>{meeting.paused ? 'Paused' : 'Recording'}</b> · {clock(elapsed / 1000)} · {meeting.title}</div>
          <div className="vhud-sub">{last ? `${last.track === 'mic' ? 'You' : 'Others'}: ${last.text}` : meeting.systemNote ?? 'Microphone and the computer’s sound'}</div>
        </div>
        <button className="btn icon sm ghost" title={meeting.paused ? 'Resume' : 'Pause'} onClick={() => void api.voice.pauseMeeting(!meeting.paused)}><Icon name={meeting.paused ? 'play' : 'pause'} size={13} /></button>
        <button className="btn icon sm ghost" title="Stop and save" onClick={() => void api.voice.stopMeeting()}><Icon name="check" size={13} /></button>
      </div>
    );
  }

  return st.error ? <div className="vhud vhud-pill"><div className="vhud-mic"><Icon name="warning" size={15} /></div><div className="vhud-body"><div className="vhud-text vhud-err">{st.error}</div></div></div> : <div className="vhud" />;
}
