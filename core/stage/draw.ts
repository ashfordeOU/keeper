// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Draw on screen: while presenting, a shortcut lays a see-through sheet over
// every screen to draw on with a pen, a highlighter, arrows and boxes, or to
// spotlight one spot. Ink can fade by itself; Undo, Clear and Esc are a key
// away. This file has the settings, the pure drawing helpers and the sheet's
// page (no framework, a few kilobytes); electron/services/stage/draw.ts shows it.

export type DrawTool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'spotlight';
export type DrawBoard = 'none' | 'white' | 'black';

export interface DrawSettings {
  /** starts and ends drawing, from any app */
  shortcut: string;
  /** the pen colours, in order (keys 1 to 6) */
  colors: string[];
  /** the colour it starts with */
  color: string;
  tool: DrawTool;
  /** line width in points */
  width: number;
  /** ink fades away by itself */
  fade: boolean;
  /** how long ink stays before it fades (seconds) */
  fadeSeconds: number;
}

export const DRAW_SHORTCUT = 'CommandOrControl+Alt+Shift+D';
export const DRAW_COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#111111'];
export const DRAW_TOOLS: { id: DrawTool; label: string; key: string }[] = [
  { id: 'pen', label: 'Pen', key: 'p' },
  { id: 'highlighter', label: 'Highlighter', key: 'h' },
  { id: 'arrow', label: 'Arrow', key: 'a' },
  { id: 'rect', label: 'Box', key: 'b' },
  { id: 'spotlight', label: 'Spotlight', key: 's' },
];
export const WIDTHS = [3, 6, 12];

export function defaultDrawSettings(): DrawSettings {
  return { shortcut: DRAW_SHORTCUT, colors: [...DRAW_COLORS], color: DRAW_COLORS[0], tool: 'pen', width: 6, fade: false, fadeSeconds: 3 };
}

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeDrawSettings(raw: unknown): DrawSettings {
  const d = defaultDrawSettings();
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DrawSettings>;
  const colors = Array.isArray(r.colors) ? r.colors.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 6) : [];
  const all = colors.length === 6 ? colors : d.colors;
  return {
    shortcut: typeof r.shortcut === 'string' ? r.shortcut : d.shortcut,
    colors: all,
    color: typeof r.color === 'string' && HEX.test(r.color) ? r.color : all[0],
    tool: DRAW_TOOLS.some((t) => t.id === r.tool) ? (r.tool as DrawTool) : d.tool,
    width: WIDTHS.includes(r.width as number) ? (r.width as number) : d.width,
    fade: typeof r.fade === 'boolean' ? r.fade : d.fade,
    fadeSeconds: typeof r.fadeSeconds === 'number' && Number.isFinite(r.fadeSeconds) ? Math.max(1, Math.min(30, Math.round(r.fadeSeconds))) : d.fadeSeconds,
  };
}

// ---------------------------------------------------------------- drawing helpers (also used by the page)

export interface Point { x: number; y: number }

/** How visible a stroke is at `now`: whole until it has stayed `holdMs`, then gone over `fadeMs`. */
export function inkAlpha(endedAt: number, now: number, holdMs: number, fadeMs = 700): number {
  if (!endedAt) return 1;
  const t = now - endedAt - holdMs;
  if (t <= 0) return 1;
  return Math.max(0, 1 - t / fadeMs);
}

/** The two short lines of an arrow's head at `to`. */
export function arrowHead(from: Point, to: Point, width: number): [Point, Point] {
  const len = Math.max(12, width * 4);
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x - len * Math.cos(a - spread), y: to.y - len * Math.sin(a - spread) },
    { x: to.x - len * Math.cos(a + spread), y: to.y - len * Math.sin(a + spread) },
  ];
}

/** Drops points closer than `min` to the last kept one (a steady hand draws fewer points). */
export function thinPoints(pts: Point[], min = 1.5): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.y - l.y) >= min) out.push(p);
  }
  if (pts.length && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/** The rectangle between two corners, whichever way it was dragged. */
export function boxFrom(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** What the sheet starts with on one screen. */
export interface DrawConfig {
  colors: string[];
  color: string;
  tool: DrawTool;
  width: number;
  fade: boolean;
  fadeSeconds: number;
  /** this screen shows the tool bar (the one with the pointer) */
  toolbar: boolean;
  mac: boolean;
  /** the shortcut, as the person sees it ("⌃⌥⇧D") */
  shortcutLabel: string;
}

/** The sheet: a canvas, the tool bar and the keys. Talks to Keeper only through `keeperFloat.act`. */
export function drawHtml(): string {
  const tools = JSON.stringify(DRAW_TOOLS);
  const widths = JSON.stringify(WIDTHS);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Draw on screen</title>
<style>
html{background:transparent}
body{background:rgba(0,0,0,.01)}
html,body{margin:0;width:100%;height:100%;overflow:hidden;user-select:none;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
body.board-white{background:#fafafa}body.board-black{background:#111214}
/* almost clear, not clear: systems let clicks through fully see-through pixels */
canvas{position:fixed;inset:0;width:100%;height:100%;cursor:crosshair}
body.tool-spotlight canvas{cursor:none}
#bar{position:fixed;top:14px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:6px 8px;border-radius:14px;background:rgba(24,24,28,.92);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:5}
#bar[hidden]{display:none}
#bar button{all:unset;box-sizing:border-box;min-width:32px;height:32px;padding:0 9px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;color:#fff;font-weight:600}
#bar button:hover{background:rgba(255,255,255,.12)}
#bar button[aria-pressed=true]{background:rgba(255,255,255,.22)}
#bar button:focus-visible{outline:2px solid #8ab4ff;outline-offset:1px}
#bar .sw{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.65);min-width:0;padding:0;margin:0 3px}
#bar .sw[aria-pressed=true]{outline:2px solid #fff;outline-offset:2px;background-clip:padding-box}
#bar i{width:1px;height:20px;background:rgba(255,255,255,.2);margin:0 4px}
#bar .dot{display:inline-block;border-radius:50%;background:#fff}
#hint{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:9px;background:rgba(24,24,28,.8);color:#fff;font-size:12px;transition:opacity .6s}
</style></head><body class="tool-pen"><canvas id="c"></canvas>
<div id="bar" role="toolbar" aria-label="Drawing tools" hidden></div>
<div id="hint" role="status"></div>
<script>
(function(){
var TOOLS=${tools},WIDTHS=${widths};
var cfg={colors:[],color:'#ff3b30',tool:'pen',width:6,fade:false,fadeSeconds:3,toolbar:false,mac:false,shortcutLabel:''};
var strokes=[],cur=null,board='none',spot=null,raf=0;
var c=document.getElementById('c'),ctx=c.getContext('2d'),bar=document.getElementById('bar'),hint=document.getElementById('hint');
function act(a,v){try{window.keeperFloat&&window.keeperFloat.act(a,v)}catch(e){}}
function size(){var r=devicePixelRatio||1;c.width=innerWidth*r;c.height=innerHeight*r;ctx.setTransform(r,0,0,r,0,0);paint()}
addEventListener('resize',size);
function alpha(s,now){if(!cfg.fade||!s.end)return 1;var t=now-s.end-cfg.fadeSeconds*1000;return t<=0?1:Math.max(0,1-t/700)}
function head(f,t,w){var len=Math.max(12,w*4),a=Math.atan2(t.y-f.y,t.x-f.x),sp=Math.PI/7;return[{x:t.x-len*Math.cos(a-sp),y:t.y-len*Math.sin(a-sp)},{x:t.x-len*Math.cos(a+sp),y:t.y-len*Math.sin(a+sp)}]}
function drawStroke(s,a){if(a<=0)return;ctx.save();ctx.globalAlpha=a*(s.tool==='highlighter'?.35:1);ctx.strokeStyle=s.color;ctx.lineWidth=s.tool==='highlighter'?s.width*3.2:s.width;ctx.lineCap=s.tool==='highlighter'?'butt':'round';ctx.lineJoin='round';
var p=s.pts;if(!p.length){ctx.restore();return}
if(s.tool==='rect'){var b=p[p.length-1];ctx.strokeRect(Math.min(p[0].x,b.x),Math.min(p[0].y,b.y),Math.abs(b.x-p[0].x),Math.abs(b.y-p[0].y))}
else if(s.tool==='arrow'){var e=p[p.length-1];ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);ctx.lineTo(e.x,e.y);var h=head(p[0],e,s.width);ctx.moveTo(h[0].x,h[0].y);ctx.lineTo(e.x,e.y);ctx.lineTo(h[1].x,h[1].y);ctx.stroke()}
else{ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);if(p.length===1)ctx.lineTo(p[0].x+.01,p[0].y);for(var i=1;i<p.length-1;i++){var mx=(p[i].x+p[i+1].x)/2,my=(p[i].y+p[i+1].y)/2;ctx.quadraticCurveTo(p[i].x,p[i].y,mx,my)}if(p.length>1)ctx.lineTo(p[p.length-1].x,p[p.length-1].y);ctx.stroke()}
ctx.restore()}
function paint(){var now=Date.now();ctx.clearRect(0,0,innerWidth,innerHeight);var live=false;
strokes=strokes.filter(function(s){var a=alpha(s,now);if(a>0&&a<1)live=true;if(cfg.fade&&s.end&&a<1)live=true;return a>0});
strokes.forEach(function(s){drawStroke(s,alpha(s,now))});if(cur)drawStroke(cur,1);
if(cfg.tool==='spotlight'&&spot){ctx.save();ctx.fillStyle='rgba(0,0,0,.6)';ctx.beginPath();ctx.rect(0,0,innerWidth,innerHeight);ctx.arc(spot.x,spot.y,Math.round(innerHeight*.12),0,Math.PI*2,true);ctx.fill('evenodd');ctx.restore()}
if(cfg.fade&&strokes.length)live=true;
cancelAnimationFrame(raf);if(live)raf=requestAnimationFrame(paint)}
function pt(e){return{x:e.clientX,y:e.clientY}}
c.addEventListener('pointerdown',function(e){if(e.button!==0)return;if(cfg.tool==='spotlight')return;c.setPointerCapture(e.pointerId);cur={tool:cfg.tool,color:cfg.color,width:cfg.width,pts:[pt(e)],end:0};paint()});
c.addEventListener('pointermove',function(e){if(cfg.tool==='spotlight'){spot=pt(e);paint();return}if(!cur)return;var p=pt(e),l=cur.pts[cur.pts.length-1];
if(cur.tool==='rect'||cur.tool==='arrow'){cur.pts=[cur.pts[0],p]}else if(Math.hypot(p.x-l.x,p.y-l.y)>=1.5)cur.pts.push(p);paint()});
function finish(){if(!cur)return;cur.end=Date.now();strokes.push(cur);cur=null;paint();act('changed',strokes.length)}
c.addEventListener('pointerup',finish);c.addEventListener('pointercancel',finish);
c.addEventListener('pointerleave',function(){if(cfg.tool==='spotlight'){spot=null;paint()}});
function undo(){if(cur){cur=null}else strokes.pop();paint();act('changed',strokes.length)}
function clear(){strokes=[];cur=null;paint();act('changed',0)}
function setTool(t){cfg.tool=t;document.body.className='tool-'+t+(board!=='none'?' board-'+board:'');spot=null;render();paint();act('tool',t)}
function setColor(col){cfg.color=col;if(cfg.tool==='spotlight')cfg.tool='pen';setTool(cfg.tool);act('color',col)}
function setBoard(b){board=b;document.body.className='tool-'+cfg.tool+(b!=='none'?' board-'+b:'');render()}
function btn(label,content,pressed,fn,cls){var b=document.createElement('button');b.type='button';b.setAttribute('aria-label',label);b.title=label;if(pressed!==null)b.setAttribute('aria-pressed',String(pressed));if(cls)b.className=cls;if(typeof content==='string')b.textContent=content;else b.append(content);b.onclick=function(e){e.stopPropagation();fn()};return b}
function sep(){return document.createElement('i')}
function render(){if(!cfg.toolbar){bar.hidden=true;return}bar.hidden=false;var f=document.activeElement&&document.activeElement.getAttribute('aria-label');bar.textContent='';
TOOLS.forEach(function(t){bar.append(btn(t.label+' ('+t.key.toUpperCase()+')',t.label,cfg.tool===t.id,function(){setTool(t.id)}))});bar.append(sep());
cfg.colors.forEach(function(col,i){var b=btn('Colour '+(i+1),'',cfg.color===col,function(){setColor(col)},'sw');b.style.background=col;bar.append(b)});bar.append(sep());
WIDTHS.forEach(function(w,i){var d=document.createElement('span');d.className='dot';d.style.width=d.style.height=(4+i*4)+'px';bar.append(btn(['Thin','Medium','Thick'][i]+' line',d,cfg.width===w,function(){cfg.width=w;render();act('width',w)}))});bar.append(sep());
bar.append(btn('Ink fades away (F)','Fade',cfg.fade,function(){cfg.fade=!cfg.fade;render();paint();act('fade',cfg.fade)}));
bar.append(btn('Board: '+(board==='none'?'see-through':board)+' (W)','Board',board!=='none',function(){setBoard(board==='none'?'white':board==='white'?'black':'none')}));
bar.append(btn('Undo ('+(cfg.mac?'⌘':'Ctrl+')+'Z)','Undo',null,undo));bar.append(btn('Clear (C)','Clear',null,clear));bar.append(btn('Done (Esc)','Done',null,function(){act('exit')}));
if(f){var again=bar.querySelector('[aria-label="'+f.replace(/"/g,'')+'"]');if(again)again.focus()}}
addEventListener('keydown',function(e){var k=e.key.toLowerCase(),mod=e.metaKey||e.ctrlKey;
if(k==='escape'){e.preventDefault();act('exit');return}
if(mod&&k==='z'){e.preventDefault();undo();return}
if(mod)return;
if(k==='c'||k==='backspace'||k==='delete'){clear();return}
if(k==='f'){cfg.fade=!cfg.fade;render();paint();act('fade',cfg.fade);return}
if(k==='w'){setBoard(board==='none'?'white':board==='white'?'black':'none');return}
if(/^[1-6]$/.test(k)&&cfg.colors[+k-1]){setColor(cfg.colors[+k-1]);return}
TOOLS.forEach(function(t){if(t.key===k)setTool(t.id)})});
function showHint(){if(!cfg.toolbar){hint.style.display='none';return}hint.textContent='Draw anywhere · Esc or '+cfg.shortcutLabel+' to finish';hint.style.opacity='1';setTimeout(function(){hint.style.opacity='0'},3500)}
window.draw={
  config:function(c2){for(var k in c2)cfg[k]=c2[k];setTool(cfg.tool);showHint();size()},
  focusBar:function(){var b=bar.querySelector('button');b&&b.focus()},
  undo:undo,clear:clear,tool:setTool,color:setColor,board:setBoard,
  stroke:function(tool,pts){strokes.push({tool:tool||cfg.tool,color:cfg.color,width:cfg.width,pts:pts,end:Date.now()});paint();act('changed',strokes.length)},
  state:function(){return{strokes:strokes.length,tool:cfg.tool,color:cfg.color,width:cfg.width,fade:cfg.fade,board:board,toolbar:!bar.hidden}}
};
size();
})();
</script></body></html>`;
}
