// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Stage mode's overlays: the pointer spotlight or highlight, click ripples,
// keystrokes, the countdown and a small level HUD (for the display keys). One
// transparent, click-through window per screen draws them; this file has the
// pure parts and the page itself (no framework, a few kilobytes).

import type { StageSwitches } from './types';

export type Mod = 'cmd' | 'ctrl' | 'alt' | 'shift';

export interface KeyEvent { key: string; mods: Mod[] }

const MAC_MOD: Record<Mod, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', cmd: '⌘' };
const PC_MOD: Record<Mod, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', cmd: 'Win' };
const ORDER: Mod[] = ['ctrl', 'alt', 'shift', 'cmd'];

const KEY_NAMES: Record<string, [string, string]> = {
  return: ['↩', 'Enter'], enter: ['↩', 'Enter'], escape: ['⎋', 'Esc'], tab: ['⇥', 'Tab'], space: ['Space', 'Space'], backspace: ['⌫', 'Backspace'], delete: ['⌦', 'Delete'],
  left: ['←', '←'], right: ['→', '→'], up: ['↑', '↑'], down: ['↓', '↓'], home: ['↖', 'Home'], end: ['↘', 'End'], pageup: ['⇞', 'PgUp'], pagedown: ['⇟', 'PgDn'],
};

/** "⌘⇧4" on a Mac, "Ctrl+Shift+4" elsewhere. */
export function keyLabel(e: KeyEvent, mac: boolean): string {
  const k = e.key.toLowerCase();
  const name = KEY_NAMES[k]?.[mac ? 0 : 1] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key.replace(/^Key/, ''));
  const mods = ORDER.filter((m) => e.mods.includes(m));
  if (mac) return mods.map((m) => MAC_MOD[m]).join('') + name;
  return [...mods.map((m) => PC_MOD[m]), name].join('+');
}

const MODIFIER_KEYS = /^(shift|control|ctrl|alt|option|meta|super|command|cmd|win|caps.?lock|fn|(l|r)?(shift|ctrl|alt|super|meta)(_[lr])?)$/i;

/**
 * Whether a key shows. "shortcuts" shows only keys pressed with ⌘/Ctrl/Alt
 * (and a few named keys), so ordinary typing — passwords included — never
 * appears on screen.
 */
export function showKey(mode: StageSwitches['keystrokes'], e: KeyEvent): boolean {
  if (mode === 'off' || MODIFIER_KEYS.test(e.key)) return false;
  if (mode === 'all') return true;
  return e.mods.some((m) => m !== 'shift') || /^(escape|tab|return|enter|f\d{1,2})$/i.test(e.key);
}

/** Spotlight radius in pixels for a screen. */
export function spotRadius(size: 's' | 'm' | 'l', screenHeight: number): number {
  return Math.round(screenHeight * ({ s: 0.08, m: 0.13, l: 0.2 }[size]));
}

/** What one overlay window is told to draw. */
export interface OverlayConfig {
  spotlight: StageSwitches['spotlight'];
  radius: number;
  clicks: boolean;
  keys: boolean;
  /** the screen with the keystroke bar (the main one) */
  keysHere: boolean;
}

/** The page of an overlay window. All drawing is CSS; updates come in through `window.stage`. */
export function overlayHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:600 22px system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none;cursor:none}
#dim{position:fixed;inset:0;display:none;pointer-events:none}
#ring{position:fixed;display:none;border-radius:50%;pointer-events:none;border:4px solid rgba(255,214,10,.95);background:rgba(255,214,10,.18);box-shadow:0 0 0 2px rgba(0,0,0,.25);transform:translate(-50%,-50%)}
.rip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid rgba(10,132,255,.95);pointer-events:none;animation:rip .55s ease-out forwards}
.rip.r{border-color:rgba(255,69,58,.95)}
@keyframes rip{to{transform:scale(4.2);opacity:0}}
#keys{position:fixed;left:50%;bottom:9%;transform:translateX(-50%);display:flex;gap:10px;pointer-events:none}
.k{padding:10px 18px;border-radius:14px;background:rgba(20,20,24,.82);color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.35);animation:kin .12s ease-out;transition:opacity .4s}
@keyframes kin{from{transform:translateY(6px);opacity:0}}
#count{position:fixed;inset:0;display:none;place-items:center;pointer-events:none}
#count b{width:180px;height:180px;border-radius:50%;display:grid;place-items:center;background:rgba(20,20,24,.78);color:#fff;font-size:96px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
#hud{position:fixed;left:50%;bottom:14%;transform:translateX(-50%);display:none;min-width:240px;padding:14px 18px;border-radius:16px;background:rgba(20,20,24,.85);color:#fff;font-size:15px;pointer-events:none}
#hud i{display:block;height:6px;margin-top:10px;border-radius:3px;background:rgba(255,255,255,.2);overflow:hidden}
#hud i s{display:block;height:100%;background:#fff;border-radius:3px}
</style></head><body><div id="dim"></div><div id="ring"></div><div id="keys"></div><div id="count"><b></b></div><div id="hud"><span></span><i><s></s></i></div>
<script>
(function(){
var cfg={spotlight:{mode:'off',dim:55},radius:120,clicks:false,keys:false,keysHere:false};
var dim=document.getElementById('dim'),ring=document.getElementById('ring'),keys=document.getElementById('keys'),count=document.getElementById('count'),hud=document.getElementById('hud');
var last={x:-9999,y:-9999},ht=0,state={spot:false,keys:0,clicks:0,count:0,hud:''};
function draw(){
  var m=cfg.spotlight.mode,r=cfg.radius,on=last.x>-9000;
  dim.style.display=m==='spotlight'&&on?'block':'none';
  ring.style.display=m==='highlight'&&on?'block':'none';
  state.spot=(m!=='off')&&on;
  if(m==='spotlight') dim.style.background='radial-gradient(circle at '+last.x+'px '+last.y+'px, transparent '+(r-2)+'px, rgba(0,0,0,'+(cfg.spotlight.dim/100)+') '+r+'px)';
  if(m==='highlight'){var d=Math.round(r*0.55);ring.style.width=ring.style.height=d+'px';ring.style.left=last.x+'px';ring.style.top=last.y+'px';}
}
window.stage={
  config:function(c){cfg=c;draw();},
  pointer:function(x,y){last={x:x,y:y};draw();},
  away:function(){last={x:-9999,y:-9999};draw();},
  click:function(x,y,right){if(!cfg.clicks)return;var e=document.createElement('div');e.className='rip'+(right?' r':'');e.style.left=x+'px';e.style.top=y+'px';document.body.appendChild(e);state.clicks++;setTimeout(function(){e.remove()},700);},
  key:function(label){if(!cfg.keys||!cfg.keysHere)return;var e=document.createElement('div');e.className='k';e.textContent=label;keys.appendChild(e);state.keys++;while(keys.children.length>5)keys.firstChild.remove();setTimeout(function(){e.style.opacity='0';setTimeout(function(){e.remove()},400)},1600);},
  countdown:function(n){count.style.display=n>0?'grid':'none';count.firstChild.textContent=n>0?String(n):'';state.count=n;},
  hud:function(text,pct){hud.style.display='block';hud.firstChild.textContent=text;hud.querySelector('s').style.width=Math.max(0,Math.min(100,pct))+'%';state.hud=text;clearTimeout(ht);ht=setTimeout(function(){hud.style.display='none';state.hud='';},1400);},
  state:function(){return {spot:state.spot,mode:cfg.spotlight.mode,keys:keys.textContent,keyCount:state.keys,clicks:state.clicks,count:state.count,hud:state.hud};}
};
})();
</script></body></html>`;
}

/** The page of the backdrop window: a colour, a gradient, or the wallpaper blurred. */
export function backdropHtml(b: StageSwitches['backdrop'], wallpaper?: string): string {
  const safe = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#1d2230');
  const bg = b.kind === 'solid' ? safe(b.color)
    : b.kind === 'gradient' ? `linear-gradient(135deg, ${safe(b.color)}, ${safe(b.color2)})`
      : wallpaper && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(wallpaper) ? `center / cover no-repeat url("${wallpaper}")` : `linear-gradient(135deg, ${safe(b.color)}, ${safe(b.color2)})`;
  const blur = b.kind === 'blur' && wallpaper ? 'filter:blur(48px) saturate(1.15);transform:scale(1.15);' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}#b{position:fixed;inset:0;background:${bg};${blur}}</style></head><body data-kind="${b.kind}"><div id="b"></div></body></html>`;
}
