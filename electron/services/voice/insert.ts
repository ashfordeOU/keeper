// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Putting finished text where the cursor is, in any app:
//   paste  the clipboard, then the paste keystroke; the clipboard is put back after
//   type   keystrokes one character at a time (terminals and fields that block pasting)
//   copy   only copied: needs no accessibility permission at all
// Never into a password field: macOS (secure text field) and Windows (UI
// Automation's IsPassword) are asked first; when it is one, the take is kept
// in history instead.

import { powershell, run } from '../../../core/platform';
import { readText, writeText } from '../clip';

export type InsertHow = 'paste' | 'type' | 'copy';

/** Told about every clipboard write dictation makes (the clipboard history leaves them out). */
let onWrite: (text: string) => void = () => {};
export function setClipboardWriteHook(fn: (text: string) => void) { onWrite = fn; }
const put = (t: string) => { onWrite(t); return writeText(t); };

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** Presses a key combination in the app in front ("v" with the command/control key). */
async function keystroke(key: 'v' | 'c') {
  if (isMac) await run('/usr/bin/osascript', ['-e', `tell application "System Events" to keystroke "${key}" using command down`]);
  else if (isWin) await powershell(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^${key}')`);
  else if (!(await run('xdotool', ['key', '--clearmodifiers', `ctrl+${key}`])).ok) await run('wtype', ['-M', 'ctrl', key, '-m', 'ctrl']);
}

/** Types text as keystrokes. */
async function typeOut(text: string): Promise<boolean> {
  if (isMac) {
    const { macHelperCall } = await import('../platform/mac');
    try { await macHelperCall('input.text', { text }, 30_000); return true; } catch { /* fall back to System Events */ }
    const r = await run('/usr/bin/osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(text)}`]);
    return r.ok;
  }
  if (isWin) {
    // SendInput with Unicode characters: no escaping rules, any language.
    const b64 = Buffer.from(text, 'utf16le').toString('base64');
    const r = await powershell(`Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class KeeperType {
  [StructLayout(LayoutKind.Sequential)] struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] struct IN { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KI ki; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, IN[] i, int size);
  public static void Type(string s) { foreach (char c in s) { var a = new IN[2]; a[0].type = 1; a[0].ki.scan = c; a[0].ki.flags = 4; a[1].type = 1; a[1].ki.scan = c; a[1].ki.flags = 6; SendInput(2, a, Marshal.SizeOf(typeof(IN))); } }
}
'@
[KeeperType]::Type([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${b64}')))`, 30_000);
    return r.ok;
  }
  if ((await run('xdotool', ['type', '--clearmodifiers', '--delay', '4', '--', text], 60_000)).ok) return true;
  return (await run('wtype', ['--', text], 60_000)).ok;
}

/**
 * Is the focused field a password field? `null` when the system can't say
 * (Linux, or no permission): then the app exclusion list is the guard.
 */
export async function focusedIsSecure(): Promise<boolean | null> {
  try {
    if (isMac) {
      const { macHelperCall } = await import('../platform/mac');
      const r = await macHelperCall<{ secure: boolean | null }>('voice.focus', {}, 3000);
      return r.secure;
    }
    if (isWin) {
      const r = await powershell(`Add-Type -AssemblyName UIAutomationClient; $e = [System.Windows.Automation.AutomationElement]::FocusedElement; if ($e) { $e.Current.IsPassword } else { 'none' }`, 6000);
      const s = r.stdout.trim().toLowerCase();
      return s === 'true' ? true : s === 'false' ? false : null;
    }
  } catch {
    /* unknown */
  }
  return null;
}

/** Puts text at the cursor. Returns how it went in. */
export async function insertText(text: string, how: InsertHow): Promise<'typed' | 'copied'> {
  if (!text) return 'typed';
  if (how === 'copy') { await put(text); return 'copied'; }
  if (how === 'type' && (await typeOut(text))) return 'typed';
  const before = await readText();
  await put(text);
  await keystroke('v');
  // put the person's clipboard back once the app has read it
  setTimeout(() => { void readText().then((now) => { if (now === text) void put(before); }); }, 900);
  return 'typed';
}

/** The text selected in the app in front, read by copying it (the clipboard is put back). */
export async function readSelection(): Promise<string> {
  const before = await readText();
  const marker = `⁣keeper-${Date.now()}`;
  await put(marker);
  await keystroke('c');
  let got = '';
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 60));
    got = await readText();
    if (got !== marker) break;
  }
  onWrite(got);
  await put(before);
  return got === marker ? '' : got;
}
