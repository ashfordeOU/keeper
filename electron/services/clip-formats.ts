// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Which formats the clipboard holds right now, so copies that password
// managers mark as secret or short-lived are never remembered. Asked only when
// the clipboard's text has just changed, never on a timer of its own.

import { clipboard } from 'electron';
import { execFile } from 'node:child_process';
import { isConcealed } from '../../core/island-tools/clipfilter';

function run(cmd: string, args: string[], timeout = 2000): Promise<string> {
  return new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 1 << 16 }, (err, out) => resolve(err ? '' : String(out))));
}

const MAC = `ObjC.import('AppKit'); var t = $.NSPasteboard.generalPasteboard.types; var out = []; for (var i = 0; i < t.count; i++) out.push(ObjC.unwrap(t.objectAtIndex(i))); out.join('\\n');`;

// Windows: the formats on the clipboard, and the DWORD values of the two "history" flags when present.
const WIN = `Add-Type -AssemblyName System.Windows.Forms
$d = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($d) {
  foreach ($f in $d.GetFormats()) {
    $v = ''
    if ($f -eq 'CanIncludeInClipboardHistory' -or $f -eq 'CanUploadToCloudClipboard') {
      $s = $d.GetData($f)
      if ($s -is [System.IO.MemoryStream]) { $b = $s.ToArray(); if ($b.Length -ge 4) { $v = [BitConverter]::ToInt32($b, 0) } }
    }
    [Console]::Out.WriteLine("$f=$v")
  }
}`;

export async function clipboardFormats(): Promise<{ types: string[]; values: Record<string, string> }> {
  const types = new Set<string>();
  const values: Record<string, string> = {};
  try {
    for (const item of await clipboard.read()) for (const t of item.types) types.add(t);
  } catch {
    /* nothing readable through the web clipboard */
  }
  if (process.platform === 'darwin') {
    for (const t of (await run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC])).split('\n')) if (t.trim()) types.add(t.trim());
  } else if (process.platform === 'win32') {
    const { psRun } = await import('./ps-host');
    const r = await psRun(WIN, 3000).catch(() => ({ ok: false, stdout: '' }));
    for (const line of r.stdout.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i <= 0) continue;
      types.add(line.slice(0, i));
      if (line.slice(i + 1)) values[line.slice(0, i)] = line.slice(i + 1);
    }
  } else {
    const wayland = !!process.env.WAYLAND_DISPLAY;
    const list = wayland ? await run('wl-paste', ['--list-types']) : await run('xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']);
    for (const t of list.split('\n')) if (t.trim()) types.add(t.trim());
    if (types.has('x-kde-passwordManagerHint')) values['x-kde-passwordManagerHint'] = (wayland ? await run('wl-paste', ['--type', 'x-kde-passwordManagerHint']) : await run('xclip', ['-selection', 'clipboard', '-t', 'x-kde-passwordManagerHint', '-o'])).trim();
  }
  return { types: [...types], values };
}

/** True when the copy in the clipboard is marked secret or short-lived by the app that made it. */
export async function clipboardIsConcealed(): Promise<boolean> {
  const f = await clipboardFormats().catch(() => ({ types: [], values: {} }));
  return isConcealed(f.types, f.values);
}
