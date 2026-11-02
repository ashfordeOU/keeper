// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the computer-use tools need from each system beyond the pointer and
// keyboard (those come from the remote-desktop injector): which app and window
// are in front, the list of windows, bringing one forward, opening apps, and
// the controls in the front window (accessibility), so an AI can press a
// button by name instead of guessing pixels.
//
//   macOS    JavaScript for Automation through System Events (needs the
//            Accessibility permission, the same one control needs)
//   Windows  PowerShell: user32 for windows, UI Automation for controls
//   Linux    xdotool / wmctrl on X11; AT-SPI through python3-gi when present
//
// Controls are read and pressed with agent-desktop first (agent-desktop.ts,
// shipped with Keeper): faster and steadier than the scripts above, which stay
// as the fallback when it is missing, fails or is too slow, and when the person
// picks the built-in engine (Use this computer → Accessibility engine).

import { spawn } from 'node:child_process';
import { existsSync, promises as fsp, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UiNode } from '../../core/computer';
import { run } from '../../core/platform';
import { AgentDesktop, AgentDesktopError, findAgentDesktop, MaybeDelivered, type MappedTree } from './agent-desktop';

export interface FrontWindow {
  app?: string;
  title?: string;
  pid?: number;
}

export interface WindowInfo {
  id: string;
  app: string;
  title: string;
  pid?: number;
}

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

async function jxa(script: string, timeout = 8000): Promise<unknown> {
  const r = await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], timeout);
  if (!r.ok && /not allowed|1002|-1719|assistive/i.test(r.stderr ?? '')) permissionNeeded('accessibility', 'aiAgents');
  if (!r.ok) throw new Error(/not allowed|1002|-1719|assistive/i.test(r.stderr ?? '') ? 'Allow Keeper in System Settings → Privacy & Security → Accessibility.' : (r.stderr || 'System Events did not answer').split('\n')[0]);
  return JSON.parse(r.stdout.trim() || 'null');
}

async function ps(script: string, timeout = 10_000): Promise<unknown> {
  const { psRun } = await import('./ps-host');
  const r = await psRun(script, timeout);
  if (!r.ok) throw new Error('PowerShell did not answer');
  const t = r.stdout.trim();
  return t ? JSON.parse(t) : null;
}

const PS_WIN32 = `
if (-not ('KeeperCu' -as [type])) { Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class KeeperCu {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@ }`;

// ---------------------------------------------------------------- front window

export async function frontWindow(): Promise<FrontWindow> {
  try {
    if (isMac) {
      return (await jxa(`const se=Application('System Events');const p=se.processes.whose({frontmost:true})[0];let t='';try{t=p.windows[0].name()||''}catch(e){}JSON.stringify({app:p.name(),title:t,pid:p.unixId()})`, 5000)) as FrontWindow;
    }
    if (isWin) {
      return (await ps(`${PS_WIN32}
$h=[KeeperCu]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 512; [void][KeeperCu]::GetWindowText($h,$sb,512); $p=0; [void][KeeperCu]::GetWindowThreadProcessId($h,[ref]$p)
$n=''; try { $n=(Get-Process -Id $p).ProcessName } catch {}
@{ app=$n; title=$sb.ToString(); pid=[int]$p } | ConvertTo-Json -Compress`)) as FrontWindow;
    }
    const r = await run('xdotool', ['getactivewindow', 'getwindowname', 'getwindowpid'], 3000);
    if (!r.ok) return {};
    const [title, pidS] = r.stdout.split('\n');
    const pid = Number(pidS) || undefined;
    let app: string | undefined;
    if (pid) app = (await fsp.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim() || undefined;
    return { app, title: title?.trim(), pid };
  } catch {
    return {};
  }
}

/** Where the front window is, in screen points (to read only its text); undefined when the system will not say. */
export async function frontBounds(): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
  try {
    if (isMac) {
      const r = (await jxa(`const se=Application('System Events');const p=se.processes.whose({frontmost:true})[0];const w=p.windows[0];const a=w.position(),b=w.size();JSON.stringify({x:a[0],y:a[1],width:b[0],height:b[1]})`, 5000)) as { x: number; y: number; width: number; height: number };
      return r && r.width > 0 ? r : undefined;
    }
    if (isWin) return undefined;
    const r = await run('xdotool', ['getactivewindow', 'getwindowgeometry', '--shell'], 3000);
    if (!r.ok) return undefined;
    const v = (k: string) => Number((new RegExp(`^${k}=(-?\\d+)`, 'm').exec(r.stdout) || [])[1]);
    const b = { x: v('X'), y: v('Y'), width: v('WIDTH'), height: v('HEIGHT') };
    return Number.isFinite(b.width) && b.width > 0 && b.height > 0 ? b : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- windows

export async function listWindows(): Promise<WindowInfo[]> {
  if (isMac) {
    return (await jxa(`const se=Application('System Events');const out=[];for(const p of se.processes.whose({backgroundOnly:false})()){let ws=[];try{ws=p.windows()}catch(e){}for(let i=0;i<ws.length&&i<10;i++){let t='';try{t=ws[i].name()||''}catch(e){}out.push({id:p.unixId()+':'+i,app:p.name(),title:t,pid:p.unixId()})}}JSON.stringify(out)`)) as WindowInfo[];
  }
  if (isWin) {
    const r = (await ps(`Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { @{ id=[string]$_.MainWindowHandle; app=$_.ProcessName; title=$_.MainWindowTitle; pid=$_.Id } } | ConvertTo-Json -Compress`)) as WindowInfo[] | WindowInfo | null;
    return Array.isArray(r) ? r : r ? [r] : [];
  }
  const w = await run('wmctrl', ['-lp'], 3000);
  if (w.ok) {
    const out: WindowInfo[] = [];
    for (const line of w.stdout.split('\n')) {
      const m = line.match(/^(0x[0-9a-f]+)\s+-?\d+\s+(\d+)\s+\S+\s+(.*)$/i);
      if (!m) continue;
      const pid = Number(m[2]) || undefined;
      const app = pid ? (await fsp.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim() : '';
      out.push({ id: m[1], app, title: m[3], pid });
    }
    return out;
  }
  const ids = await run('xdotool', ['search', '--onlyvisible', '--name', '.'], 3000);
  if (!ids.ok) throw new Error('Listing windows needs wmctrl or xdotool on X11.');
  const out: WindowInfo[] = [];
  for (const id of ids.stdout.split('\n').filter(Boolean).slice(0, 40)) {
    const r = await run('xdotool', ['getwindowname', id, 'getwindowpid', id], 2000);
    const [title, pidS] = r.stdout.split('\n');
    const pid = Number(pidS) || undefined;
    const app = pid ? (await fsp.readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '')).trim() : '';
    if (title?.trim()) out.push({ id, app, title: title.trim(), pid });
  }
  return out;
}

export async function focusWindow(id: string): Promise<void> {
  if (isMac) {
    const [pid, idx] = id.split(':').map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(idx)) throw new Error('Unknown window id');
    await jxa(`const se=Application('System Events');const p=se.processes.whose({unixId:${pid}})[0];p.frontmost=true;try{p.windows[${idx}].actions['AXRaise'].perform()}catch(e){}JSON.stringify(true)`);
    return;
  }
  if (isWin) {
    if (!/^\d+$/.test(id)) throw new Error('Unknown window id');
    await ps(`${PS_WIN32}
$h=[IntPtr]${id}; if ([KeeperCu]::IsIconic($h)) { [void][KeeperCu]::ShowWindow($h,9) }; [void][KeeperCu]::SetForegroundWindow($h); 'true'`);
    return;
  }
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(id)) throw new Error('Unknown window id');
  const r = await run('xdotool', ['windowactivate', '--sync', String(Number(id))], 4000);
  if (!r.ok) {
    const w = await run('wmctrl', ['-ia', id], 3000);
    if (!w.ok) throw new Error('Could not bring that window forward');
  }
}

// ---------------------------------------------------------------- opening apps

/** App names the person could mean, for "open Safari" / "open Files" on Linux (from .desktop entries). */
function desktopEntries(): { id: string; name: string; file: string }[] {
  const dirs = [path.join(os.homedir(), '.local/share/applications'), '/usr/share/applications', '/usr/local/share/applications', '/var/lib/flatpak/exports/share/applications', path.join(os.homedir(), '.local/share/flatpak/exports/share/applications')];
  const out: { id: string; name: string; file: string }[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith('.desktop')) out.push({ id: f.replace(/\.desktop$/, ''), name: '', file: path.join(d, f) });
  }
  return out;
}

export async function openApp(name: string): Promise<string> {
  if (!/^[\p{L}\p{N} ._+&()'-]{1,80}$/u.test(name)) throw new Error('That does not look like an app name');
  if (isMac) {
    const r = await run('/usr/bin/open', ['-a', name], 8000);
    if (!r.ok) throw new Error(`No app called “${name}” was found`);
    return `Opened ${name}`;
  }
  if (isWin) {
    // Start-Process finds apps registered under App Paths (msedge, winword, notepad…).
    const safe = name.replace(/['‘’‚‛]/g, '$&$&');
    await ps(`try { Start-Process -FilePath '${safe}'; 'true' } catch { throw }`, 8000).catch(() => { throw new Error(`No app called “${name}” was found`); });
    return `Opened ${name}`;
  }
  const want = name.toLowerCase();
  let best: string | undefined;
  for (const e of desktopEntries()) {
    if (e.id.toLowerCase() === want || e.id.toLowerCase().endsWith('.' + want)) { best = e.file; break; }
    const text = await fsp.readFile(e.file, 'utf8').catch(() => '');
    const n = text.match(/^Name=(.*)$/m)?.[1]?.trim().toLowerCase();
    if (n === want) { best = e.file; break; }
  }
  if (!best) throw new Error(`No app called “${name}” was found`);
  const id = path.basename(best, '.desktop');
  const viaGtk = await run('gtk-launch', [id], 6000);
  if (viaGtk.ok) return `Opened ${name}`;
  const viaGio = await run('gio', ['launch', best], 6000);
  if (viaGio.ok) return `Opened ${name}`;
  throw new Error(`Could not start ${name} (gtk-launch or gio is needed)`);
}

// ---------------------------------------------------------------- controls in the front window

const MAC_TREE = (depth: number) => `
const se=Application('System Events');const p=se.processes.whose({frontmost:true})[0];
let count=0;
function node(el,id,d){
  if(count++>350) return null;
  const n={id:id,role:''};
  try{n.role=el.role()}catch(e){}
  try{const t=el.name()||el.title()||el.description();if(t)n.name=String(t)}catch(e){}
  try{const v=el.value();if(v!==null&&v!==undefined&&typeof v!=='object')n.value=String(v)}catch(e){}
  try{const pos=el.position(),sz=el.size();n.x=pos[0];n.y=pos[1];n.width=sz[0];n.height=sz[1]}catch(e){}
  try{n.enabled=el.enabled()}catch(e){}
  if(d<${depth}){let kids=[];try{kids=el.uiElements()}catch(e){}n.children=[];for(let i=0;i<kids.length;i++){const c=node(kids[i],id+'/'+i,d+1);if(c)n.children.push(c)}}
  return n;
}
let w=null;try{w=p.windows[0]}catch(e){}
JSON.stringify(w?node(w,'w0',0):null)`;

const MAC_PRESS = (idPath: string[]) => `
const se=Application('System Events');const p=se.processes.whose({frontmost:true})[0];
let el=p.windows[0];
for(const i of ${JSON.stringify(idPath.map(Number))}) el=el.uiElements[i];
let done=false;
try{el.actions['AXPress'].perform();done=true}catch(e){}
if(!done){try{el.click();done=true}catch(e){}}
JSON.stringify(done)`;

const MAC_SET = (idPath: string[], text: string) => `
const se=Application('System Events');const p=se.processes.whose({frontmost:true})[0];
let el=p.windows[0];
for(const i of ${JSON.stringify(idPath.map(Number))}) el=el.uiElements[i];
let done=false;
try{el.focused=true}catch(e){}
try{el.value=${JSON.stringify(text)};done=true}catch(e){}
JSON.stringify(done)`;

const WIN_TREE = (depth: number) => `${PS_WIN32}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$h=[KeeperCu]::GetForegroundWindow()
$root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
$script:count=0
function Node($el,$id,$d){
  if($script:count -gt 350){ return $null }; $script:count++
  $c=$el.Current; $r=$c.BoundingRectangle
  $n=[ordered]@{ id=$id; role=$c.ControlType.ProgrammaticName -replace '^ControlType\\.',''; name=$c.Name; enabled=$c.IsEnabled }
  if(-not $r.IsEmpty){ $n.x=[int]$r.X; $n.y=[int]$r.Y; $n.width=[int]$r.Width; $n.height=[int]$r.Height }
  try { $vp=$el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); if($vp){ $n.value=$vp.Current.Value } } catch {}
  if($d -lt ${depth}){ $kids=@(); $k=$walker.GetFirstChild($el); $i=0; while($k -ne $null -and $i -lt 80){ $x=Node $k "$id/$i" ($d+1); if($x){ $kids+=$x }; $k=$walker.GetNextSibling($k); $i++ }; $n.children=$kids }
  return $n
}
Node $root 'w0' 0 | ConvertTo-Json -Depth 40 -Compress`;

const WIN_PRESS = (idPath: string[]) => `${PS_WIN32}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$h=[KeeperCu]::GetForegroundWindow()
$el=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
foreach($i in @(${idPath.map(Number).join(',')})){ $k=$walker.GetFirstChild($el); for($j=0;$j -lt $i;$j++){ $k=$walker.GetNextSibling($k) }; $el=$k }
$done=$false
foreach($pat in @([System.Windows.Automation.InvokePattern]::Pattern,[System.Windows.Automation.TogglePattern]::Pattern,[System.Windows.Automation.SelectionItemPattern]::Pattern,[System.Windows.Automation.ExpandCollapsePattern]::Pattern)){
  if(-not $done){ try { $p=$el.GetCurrentPattern($pat); if($p -is [System.Windows.Automation.InvokePattern]){$p.Invoke()} elseif($p -is [System.Windows.Automation.TogglePattern]){$p.Toggle()} elseif($p -is [System.Windows.Automation.SelectionItemPattern]){$p.Select()} else {$p.Expand()}; $done=$true } catch {} }
}
$done | ConvertTo-Json -Compress`;

const WIN_SET = (idPath: string[], text: string) => `${PS_WIN32}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$h=[KeeperCu]::GetForegroundWindow()
$el=[System.Windows.Automation.AutomationElement]::FromHandle($h)
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
foreach($i in @(${idPath.map(Number).join(',')})){ $k=$walker.GetFirstChild($el); for($j=0;$j -lt $i;$j++){ $k=$walker.GetNextSibling($k) }; $el=$k }
$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text, 'utf8').toString('base64')}'))
$done=$false
try { $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($t); $done=$true } catch {}
$done | ConvertTo-Json -Compress`;

const ATSPI = `
import json, sys
try:
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
except Exception:
    print('null'); sys.exit(0)
mode, depth, path = sys.argv[1], int(sys.argv[2]), [int(x) for x in sys.argv[3].split('/') if x != ''] if len(sys.argv) > 3 else []
desk = Atspi.get_desktop(0)
win = None
for i in range(desk.get_child_count()):
    app = desk.get_child_at_index(i)
    if app is None: continue
    for j in range(app.get_child_count()):
        w = app.get_child_at_index(j)
        if w is not None and w.get_state_set().contains(Atspi.StateType.ACTIVE):
            win = w; break
    if win: break
if win is None:
    print('null'); sys.exit(0)
count = [0]
def node(o, nid, d):
    if count[0] > 350: return None
    count[0] += 1
    n = {'id': nid, 'role': o.get_role_name() or ''}
    nm = o.get_name()
    if nm: n['name'] = nm
    try:
        e = o.get_extents(Atspi.CoordType.SCREEN)
        n.update(x=e.x, y=e.y, width=e.width, height=e.height)
    except Exception: pass
    n['enabled'] = o.get_state_set().contains(Atspi.StateType.ENABLED)
    if d < depth:
        kids = []
        for k in range(min(o.get_child_count(), 80)):
            c = o.get_child_at_index(k)
            if c is not None:
                x = node(c, nid + '/' + str(k), d + 1)
                if x: kids.append(x)
        n['children'] = kids
    return n
if mode == 'tree':
    print(json.dumps(node(win, 'w0', 0)))
else:
    o = win
    for k in path: o = o.get_child_at_index(k)
    done = False
    if mode == 'set':
        text = sys.argv[4] if len(sys.argv) > 4 else ''
        try: done = Atspi.EditableText.set_text_contents(o, text)
        except Exception: pass
    else:
        try:
            if o.get_n_actions() > 0: done = o.do_action(0)
        except Exception: pass
    print(json.dumps(bool(done)))
`;
import { permissionNeeded } from './permission-nudge';

async function atspi(args: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', ATSPI, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const t = setTimeout(() => p.kill(), 10_000);
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => { clearTimeout(t); resolve(null); });
    p.on('close', () => { clearTimeout(t); try { resolve(JSON.parse(out.trim() || 'null')); } catch { resolve(null); } });
  });
}

const idPath = (id: string) => {
  if (!/^w0(\/\d{1,3}){0,20}$/.test(id)) throw new Error('Unknown control id (use one from ui_tree)');
  return id.split('/').slice(1);
};

// ---------------------------------------------------------------- the engine: agent-desktop first

export type AccessibilityEngine = 'auto' | 'builtin';

let engine: AccessibilityEngine = 'auto';
/** auto: agent-desktop when it is there and working; builtin: only the system scripts above. */
export function setAccessibilityEngine(e: AccessibilityEngine) {
  engine = e === 'builtin' ? 'builtin' : 'auto';
}

let ad: AgentDesktop | null | undefined;
let adPausedUntil = 0;
const adWarned = new Set<string>();
/** The tree the AI's ids refer to: agent-desktop's (with refs) or the built-in one's. */
let last: { source: 'agent-desktop'; tree: MappedTree } | { source: 'builtin' } = { source: 'builtin' };

/** For tests: start over with this program (or none) and forget the last tree. */
export function resetAgentDesktop(a?: AgentDesktop | null) {
  ad = a;
  adPausedUntil = 0;
  adWarned.clear();
  last = { source: 'builtin' };
}

async function agentDesktop(): Promise<AgentDesktop | null> {
  if (engine === 'builtin' || Date.now() < adPausedUntil) return null;
  if (ad === undefined) {
    let appPath: string | undefined;
    let userData: string | undefined;
    try {
      const { app } = await import('electron');
      appPath = app.getAppPath();
      userData = app.getPath('userData');
    } catch {
      /* not in Electron */
    }
    const bin = findAgentDesktop({ resourcesPath: process.resourcesPath, appPath });
    ad = bin ? new AgentDesktop({ bin, home: userData ? path.join(userData, 'agent-desktop') : undefined }) : null;
  }
  return ad;
}

/** It failed: use the built-in scripts for this call, and for a few minutes when the failure will not pass by itself. */
function adFailed(e: unknown) {
  const code = e instanceof AgentDesktopError ? e.code : 'ERROR';
  if (['NOT_STARTED', 'NO_ENVELOPE', 'PERM_DENIED', 'PLATFORM_NOT_SUPPORTED', 'TIMEOUT', 'INTERNAL', 'ERROR'].includes(code)) adPausedUntil = Date.now() + 5 * 60_000;
  if (!adWarned.has(code)) {
    adWarned.add(code);
    console.warn(`[computer] agent-desktop: ${code} (${e instanceof Error ? e.message : String(e)}); using the built-in accessibility scripts`);
  }
}

async function builtinTree(d: number): Promise<UiNode | undefined> {
  const r = isMac ? await jxa(MAC_TREE(d), 20_000) : isWin ? await ps(WIN_TREE(d), 20_000) : await atspi(['tree', String(d)]);
  return (r ?? undefined) as UiNode | undefined;
}

/** The controls in the front window, or undefined when the system or app does not say. */
export async function uiTree(depth = 6): Promise<UiNode | undefined> {
  const d = Math.max(1, Math.min(12, depth));
  const a = await agentDesktop();
  if (a) {
    try {
      // agent-desktop skips empty wrappers, so its depth goes further than the scripts' for the same number.
      const tree = await a.snapshot({ maxDepth: Math.max(10, d + 4), timeoutMs: 4000 });
      last = { source: 'agent-desktop', tree };
      return tree.root;
    } catch (e) {
      adFailed(e);
    }
  }
  last = { source: 'builtin' };
  return builtinTree(d);
}

function findIn(root: UiNode, id: string): UiNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findIn(c, id);
    if (f) return f;
  }
  return undefined;
}

/**
 * A press or write through agent-desktop, for an id from its tree. undefined: it has no ref, or
 * agent-desktop could not do it and nothing was sent (the caller then goes on as before).
 * Throws MaybeDelivered when it may have reached the app: doing it again could do it twice.
 */
async function adAct(kind: 'click' | 'set-value', id: string, text?: string): Promise<boolean | undefined> {
  if (last.source !== 'agent-desktop') return undefined;
  const ref = last.tree.refs.get(id);
  const a = await agentDesktop();
  if (!ref || !a) return false;
  try {
    await a.act(kind, ref, findIn(last.tree.root, id), { text });
    return true;
  } catch (e) {
    if (e instanceof AgentDesktopError && e.safe) {
      if (e.code === 'STALE_REF' || e.code === 'AMBIGUOUS_TARGET' || e.code === 'SNAPSHOT_NOT_FOUND') throw new Error('That control changed or is gone. Call ui_tree again and use a fresh id.');
      adFailed(e);
      return false;
    }
    adFailed(e);
    throw new MaybeDelivered(`It may or may not have worked (${e instanceof Error ? e.message : String(e)}). Take a screenshot to check before trying again.`);
  }
}

/** Presses a control through accessibility; false when it has no action (the caller then clicks its centre). */
export async function pressElement(id: string): Promise<boolean> {
  const p = idPath(id);
  const viaAd = await adAct('click', id);
  // An id from agent-desktop's tree means nothing to the scripts: the caller clicks its centre instead.
  if (viaAd !== undefined) return viaAd;
  const r = isMac ? await jxa(MAC_PRESS(p)) : isWin ? await ps(WIN_PRESS(p)) : await atspi(['press', '0', p.join('/')]);
  return r === true;
}

/** Puts text into a field (or a value into a slider) through accessibility; false when the control takes no value. */
export async function setElementValue(id: string, text: string): Promise<boolean> {
  const p = idPath(id);
  const viaAd = await adAct('set-value', id, text);
  if (viaAd !== undefined) return viaAd;
  const r = isMac ? await jxa(MAC_SET(p, text)) : isWin ? await ps(WIN_SET(p, text)) : await atspi(['set', '0', p.join('/'), text]);
  return r === true;
}
