// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Brightness, contrast and volume of external displays over DDC/CI, on every OS:
// Windows through the Monitor Configuration API (dxva2), macOS through
// keeper-helper (IOAVService on Apple silicon) or m1ddc/ddcctl when installed,
// Linux through ddcutil. Nothing runs until the tool is opened.

import { existsSync } from 'node:fs';
import { powershell, run } from '../../core/platform';
import { ddcctlFlag, fromPercent, m1ddcName, parseDdcutilBrief, parseDdcutilDetect, toPercent, VCP, type DisplayControl, type DisplayInfo } from '../../core/display-control';
import { macHelperCall } from './platform/mac';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const CONTROLS: DisplayControl[] = ['brightness', 'contrast', 'volume'];

const WIN = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class KeeperVcp {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct PM { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string d; }
  delegate bool MonEnum(IntPtr m, IntPtr dc, IntPtr r, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonEnum cb, IntPtr p);
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr m, out uint n);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr m, uint n, [Out] PM[] a);
  [DllImport("dxva2.dll")] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte code, IntPtr t, out uint cur, out uint max);
  [DllImport("dxva2.dll")] static extern bool SetVCPFeature(IntPtr h, byte code, uint v);
  static List<PM> All() {
    var list = new List<PM>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (m, dc, r, p) => { uint n; if (GetNumberOfPhysicalMonitorsFromHMONITOR(m, out n) && n > 0) { var a = new PM[n]; if (GetPhysicalMonitorsFromHMONITOR(m, n, a)) list.AddRange(a); } return true; }, IntPtr.Zero);
    return list;
  }
  static string One(IntPtr h, byte c) { uint cur, max; return GetVCPFeatureAndVCPFeatureReply(h, c, IntPtr.Zero, out cur, out max) ? cur + "/" + max : ""; }
  public static string List() { var s = ""; int i = 0; foreach (var m in All()) { s += i + "\\t" + m.d + "\\t" + One(m.h, 0x10) + "\\t" + One(m.h, 0x12) + "\\t" + One(m.h, 0x62) + "\\n"; i++; } return s; }
  public static string Set(int i, byte code, uint pct) { var a = All(); if (i >= a.Count) return "no display"; uint cur, max; if (!GetVCPFeatureAndVCPFeatureReply(a[i].h, code, IntPtr.Zero, out cur, out max)) max = 100; return SetVCPFeature(a[i].h, code, (uint)Math.Round(pct * max / 100.0)) ? "ok" : "refused"; }
}
'@
`;

function frac(s: string | undefined): number | undefined {
  const m = s?.match(/^(\d+)\/(\d+)$/);
  return m ? toPercent(+m[1], +m[2]) : undefined;
}

let m1: string | null | undefined;
function macTool(): string | null {
  if (m1 !== undefined) return m1;
  for (const p of ['/opt/homebrew/bin/m1ddc', '/usr/local/bin/m1ddc', '/opt/homebrew/bin/ddcctl', '/usr/local/bin/ddcctl']) if (existsSync(p)) return (m1 = p);
  return (m1 = null);
}

/** External displays and their brightness, contrast and volume (where they answer). */
export async function listDisplays(): Promise<{ displays: DisplayInfo[]; note?: string }> {
  const displays: DisplayInfo[] = [];
  if (isWin) {
    const r = await powershell(`${WIN}; [KeeperVcp]::List()`, 25_000);
    for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
      const [i, name, b, c, v] = line.split('\t');
      displays.push({ id: `win:${i}`, name: name || `Display ${+i + 1}`, external: true, brightness: frac(b), contrast: frac(c), volume: frac(v) });
    }
    return { displays, note: displays.length ? undefined : 'No display answered over DDC/CI. Turn on DDC/CI in the monitor’s own menu.' };
  }
  if (isMac) {
    // keeper-helper talks to displays directly on Apple silicon.
    const kh = await macHelperCall<{ displays: number }>('ddc.list', {}, 8000).catch(() => null);
    if (kh?.displays) {
      for (let i = 0; i < kh.displays; i++) {
        const d: DisplayInfo = { id: `kh:${i}`, name: `External display ${i + 1}`, external: true };
        for (const c of CONTROLS) {
          const v = await macHelperCall<{ value: number; max: number }>('ddc.get', { display: i, control: c }, 5000).catch(() => null);
          if (v) d[c] = toPercent(v.value, v.max);
        }
        displays.push(d);
      }
      return { displays };
    }
    const tool = macTool();
    if (tool?.endsWith('m1ddc')) {
      const r = await run(tool, ['display', 'list'], 5000);
      for (const m of r.stdout.matchAll(/\[(\d+)\]\s*([^\n(]+)/g)) {
        const d: DisplayInfo = { id: `m1ddc:${m[1]}`, name: m[2].trim(), external: true };
        for (const c of CONTROLS) {
          const v = await run(tool, ['display', m[1], 'get', m1ddcName(c)], 5000);
          if (v.ok && Number.isFinite(+v.stdout.trim())) d[c] = +v.stdout.trim();
        }
        displays.push(d);
      }
      return { displays };
    }
    if (tool) return { displays: [{ id: 'ddcctl:1', name: 'External display', external: true }] };
    return { displays, note: 'No external display that accepts DDC was found. Intel Macs need ddcctl.' };
  }
  const det = await run('ddcutil', ['detect', '--brief'], 15_000);
  if (!det.ok) return { displays, note: 'Install ddcutil (and allow access to /dev/i2c-*) to control external displays.' };
  for (const { n, name } of parseDdcutilDetect(det.stdout)) {
    const d: DisplayInfo = { id: `ddcutil:${n}`, name, external: true };
    for (const c of CONTROLS) {
      const v = parseDdcutilBrief((await run('ddcutil', ['--display', n, 'getvcp', VCP[c].toString(16), '--brief'], 8000)).stdout);
      if (v) d[c] = toPercent(v.cur, v.max);
    }
    displays.push(d);
  }
  return { displays };
}

/** Sets one control of one display, 0–100. */
export async function setDisplay(id: string, control: DisplayControl, pct: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const [kind, n] = id.split(':');
  if (!(control in VCP)) throw new Error('Unknown control');
  if (kind === 'win') {
    const r = await powershell(`${WIN}; [KeeperVcp]::Set(${+n}, ${VCP[control]}, ${v})`, 25_000);
    if (!/ok/.test(r.stdout)) throw new Error('The display did not accept the change');
  } else if (kind === 'kh') {
    const cur = await macHelperCall<{ value: number; max: number }>('ddc.get', { display: +n, control }, 5000).catch(() => ({ max: 100 }));
    await macHelperCall('ddc.set', { display: +n, control, value: fromPercent(v, cur.max) }, 8000);
  } else if (kind === 'm1ddc') {
    const r = await run(macTool()!, ['display', n, 'set', m1ddcName(control), String(v)], 8000);
    if (!r.ok) throw new Error('The display did not accept the change');
  } else if (kind === 'ddcctl') {
    await run(macTool()!, ['-d', n, ddcctlFlag(control), String(v)], 8000);
  } else if (kind === 'ddcutil') {
    const cur = parseDdcutilBrief((await run('ddcutil', ['--display', n, 'getvcp', VCP[control].toString(16), '--brief'], 8000)).stdout);
    const r = await run('ddcutil', ['--display', n, 'setvcp', VCP[control].toString(16), String(fromPercent(v, cur?.max ?? 100))], 15_000);
    if (!r.ok) throw new Error('The display did not accept the change');
  } else throw new Error('Unknown display');
}
