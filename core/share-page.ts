// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Share links for videos and pictures: the small page uploaded next to a
// Studio video (the player, chapters, captions, the transcript and a download
// button), and the choices for how long a link works. The page is one static
// file with nothing from elsewhere: it lives in the person's own storage, next
// to the video, and never talks to Keeper or Ashforde.

import type { Caption, Chapter } from './studio/types';

export type ShareKind = 'none' | 'webdav' | 's3';

export interface ViewerInput {
  title: string;
  /** where the page finds the video: "./name.mp4" next to it, or a signed address */
  videoUrl: string;
  /** the same file, asking the browser to save it */
  downloadUrl: string;
  /** "video/mp4", "video/webm", "image/gif" */
  type: string;
  /** the file's name, for the download button */
  fileName: string;
  /** bytes, for the download button */
  size?: number;
  captions: Caption[];
  chapters: Chapter[];
  /** when the page was made (epoch ms) */
  madeAt: number;
  /** after this the page shows that the link has ended (epoch ms) */
  expiresAt?: number;
  /** the page's language */
  lang?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** JSON safe inside a <script> element (no "</script>", no HTML comment openers, no line separators). */
export function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function vttTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
}

/** Captions as WebVTT, the format browsers' video players read. */
export function toVtt(caps: Caption[]): string {
  const cues = [...caps].filter((c) => c.end > c.start && c.text.trim()).sort((a, b) => a.start - b.start);
  return `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text.replace(/-->/g, '→').replace(/\n{2,}/g, '\n').trim()}\n`).join('\n')}`;
}

/** "1:05" or "1:02:05". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** The transcript as paragraphs: captions joined until a pause of two seconds or a long run. */
export function transcriptParagraphs(caps: Caption[], gapMs = 2000, maxLen = 600): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let lastEnd = -Infinity;
  for (const c of [...caps].sort((a, b) => a.start - b.start)) {
    const text = c.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const cur = out[out.length - 1];
    if (cur && c.start - lastEnd < gapMs && cur.text.length + text.length < maxLen) cur.text += ` ${text}`;
    else out.push({ start: c.start, text });
    lastEnd = c.end;
  }
  return out;
}

/** How long a link can work with this kind of storage. S3 signs links for at most 7 days. */
export function expiryChoices(kind: ShareKind): { hours: number; label: string }[] {
  if (kind === 's3') return [{ hours: 24, label: '1 day' }, { hours: 72, label: '3 days' }, { hours: 168, label: '7 days' }];
  return [{ hours: 0, label: 'No end' }, { hours: 24, label: '1 day' }, { hours: 168, label: '7 days' }, { hours: 720, label: '30 days' }];
}

/** The choice to start with: the storage's own setting where it fits, else the nearest. */
export function defaultExpiry(kind: ShareKind, configuredHours: number): number {
  const choices = expiryChoices(kind);
  if (kind !== 's3') return 0;
  const want = Math.max(1, Math.min(168, configuredHours || 72));
  return choices.reduce((best, c) => (Math.abs(c.hours - want) < Math.abs(best - want) ? c.hours : best), choices[0].hours);
}

/** Hours to the signed links' lifetime in seconds (S3: 1 hour to 7 days). */
export function signedSeconds(hours: number): number {
  return Math.max(3600, Math.min(604_800, Math.round((hours || 72) * 3600)));
}

/** When the page should say the link has ended, or undefined for no end. */
export function expiresAt(kind: ShareKind, hours: number, now: number): number | undefined {
  if (kind === 's3') return now + signedSeconds(hours) * 1000;
  return hours > 0 ? now + hours * 3_600_000 : undefined;
}

/** A file name for an upload: letters, digits, spaces and a few marks; never a path. */
export function safeUploadName(name: string, fallback = 'video'): string {
  const base = name.replace(/[\\/]/g, ' ').replace(/[^\p{L}\p{N} ._()-]/gu, '').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  return base.slice(0, 120) || fallback;
}

/** The viewer page: a player with chapters, captions, a transcript that follows along, and a download button. */
export function viewerHtml(i: ViewerInput): string {
  const data = {
    captions: [...i.captions].sort((a, b) => a.start - b.start).map((c) => ({ s: c.start, e: c.end, t: c.text })),
    chapters: [...i.chapters].sort((a, b) => a.t - b.t).map((c) => ({ t: c.t, title: c.title })),
    paragraphs: transcriptParagraphs(i.captions),
    vtt: i.captions.length ? toVtt(i.captions) : '',
    expiresAt: i.expiresAt ?? 0,
  };
  const isGif = i.type === 'image/gif';
  const made = new Date(i.madeAt).toISOString().slice(0, 10);
  const media = isGif
    ? `<img id="v" src="${esc(i.videoUrl)}" alt="${esc(i.title)}">`
    : `<video id="v" controls playsinline preload="metadata" src="${esc(i.videoUrl)}"></video>`;
  return `<!doctype html>
<html lang="${esc(i.lang || 'en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src * blob: data:; img-src * data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${esc(i.title)}</title>
<style>
:root{--bg:#f6f6f8;--card:#fff;--text:#18181b;--muted:#5f5f6b;--line:#e3e3e8;--accent:#4f46e5;--accent-text:#fff;--hl:#eef0ff;--r:14px}
@media (prefers-color-scheme:dark){:root{--bg:#111114;--card:#1b1b20;--text:#f2f2f5;--muted:#a3a3ad;--line:#2c2c33;--accent:#8b8bff;--accent-text:#111114;--hl:#262640}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:1080px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;line-height:1.3;margin:0 0 4px}
.sub{color:var(--muted);font-size:13px;margin:0 0 16px}
.stage{background:#000;border-radius:var(--r);overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.18)}
#v{display:block;width:100%;max-height:72vh;background:#000;object-fit:contain}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 22px}
.btn{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:10px;padding:8px 14px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
.btn:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.grow{flex:1}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:18px}
@media (max-width:760px){.grid{grid-template-columns:1fr}}
section{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px}
section h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 8px}
ol{list-style:none;margin:0;padding:0}
li button{all:unset;display:flex;gap:10px;width:100%;padding:6px 8px;border-radius:8px;cursor:pointer;box-sizing:border-box}
li button:hover{background:var(--hl)}
li button.on{background:var(--hl);font-weight:600}
.t{color:var(--muted);font-variant-numeric:tabular-nums;min-width:52px}
#transcript{max-height:420px;overflow:auto}
#transcript p{margin:0 0 10px}
.ended{padding:60px 24px;text-align:center;background:var(--card);border:1px solid var(--line);border-radius:var(--r)}
footer{margin-top:28px;color:var(--muted);font-size:12px;text-align:center}
[hidden]{display:none!important}
</style></head>
<body><main>
<h1>${esc(i.title)}</h1>
<p class="sub">${made}${i.size ? ` · ${sizeText(i.size)}` : ''}<span id="until"></span></p>
<div id="player"><div class="stage">${media}</div>
<div class="bar">
<a class="btn primary" id="download" href="${esc(i.downloadUrl)}" download="${esc(i.fileName)}">Download${i.size ? ` (${sizeText(i.size)})` : ''}</a>
${!isGif && data.captions.length ? '<button class="btn" id="cc" type="button" aria-pressed="true">Captions on</button>' : ''}
<span class="grow"></span>
</div>
<div class="grid">
<section id="chapters-box"${data.chapters.length ? '' : ' hidden'} aria-labelledby="ch-h"><h2 id="ch-h">Chapters</h2><ol id="chapters"></ol></section>
<section id="transcript-box"${data.paragraphs.length ? '' : ' hidden'} aria-labelledby="tr-h"><h2 id="tr-h">Transcript</h2><div id="transcript"></div></section>
</div></div>
<div class="ended" id="ended" hidden><h2>This link has ended</h2><p class="sub">Ask the person who shared it for a new one.</p></div>
<footer>Shared from the sender’s own storage.</footer>
</main>
<script>
(function(){
var D=${scriptJson(data)};
var v=document.getElementById('v');
function clock(ms){var s=Math.max(0,Math.floor(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+x:m+':'+x}
if(D.expiresAt){
  if(Date.now()>D.expiresAt){document.getElementById('player').hidden=true;document.getElementById('ended').hidden=false;if(v&&v.pause)v.pause();return}
  document.getElementById('until').textContent=' · works until '+new Date(D.expiresAt).toLocaleString();
}
function seek(ms){if(!v||v.tagName!=='VIDEO')return;v.currentTime=ms/1000;v.play&&v.play().catch(function(){})}
var ch=document.getElementById('chapters');
D.chapters.forEach(function(c){var li=document.createElement('li'),b=document.createElement('button');b.type='button';b.dataset.t=c.t;
  var t=document.createElement('span');t.className='t';t.textContent=clock(c.t);var n=document.createElement('span');n.textContent=c.title;b.append(t,n);b.onclick=function(){seek(c.t)};li.append(b);ch.append(li)});
var tr=document.getElementById('transcript');
D.paragraphs.forEach(function(p){var el=document.createElement('p'),b=document.createElement('button');b.type='button';b.className='btn';b.style.padding='0 6px';b.style.marginRight='6px';b.textContent=clock(p.start);b.setAttribute('aria-label','Play from '+clock(p.start));b.onclick=function(){seek(p.start)};el.dataset.s=p.start;el.append(b,document.createTextNode(p.text));tr.append(el)});
if(v&&v.tagName==='VIDEO'&&D.vtt){
  var track=document.createElement('track');track.kind='captions';track.label='Captions';track.srclang=document.documentElement.lang||'en';track.default=true;
  track.src=URL.createObjectURL(new Blob([D.vtt],{type:'text/vtt'}));v.append(track);
  var cc=document.getElementById('cc');
  if(cc)cc.onclick=function(){var tt=v.textTracks[0];if(!tt)return;var on=tt.mode!=='showing';tt.mode=on?'showing':'hidden';cc.setAttribute('aria-pressed',String(on));cc.textContent=on?'Captions on':'Captions off'};
}
if(v&&v.tagName==='VIDEO')v.addEventListener('timeupdate',function(){var ms=v.currentTime*1000,cur=null;
  ch.querySelectorAll('button').forEach(function(b){if(+b.dataset.t<=ms)cur=b});ch.querySelectorAll('button').forEach(function(b){b.classList.toggle('on',b===cur)})});
var h=location.hash.match(/t=(\\d+)/);if(h)v&&v.addEventListener('loadedmetadata',function(){v.currentTime=+h[1]},{once:true});
})();
</script>
</body></html>`;
}
