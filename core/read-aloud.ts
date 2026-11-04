// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Read aloud with the computer's own voice: `say` on a Mac, the Windows speech
// voices through PowerShell, speech-dispatcher (spd-say) or eSpeak on Linux.
// Text is cleaned of Markdown and links first and handed over on standard
// input or as one argument, never through a shell.

export interface SpeakCommand { cmd: string; args: string[]; stdin?: string }

/** Plain words to speak: no Markdown marks, link targets, code fences or long runs of space. */
export function speakable(text: string, max = 20_000): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Words per minute for a speed of 0.5 to 2 (1 = normal). */
export const wordsPerMinute = (speed = 1) => Math.round(180 * Math.min(2, Math.max(0.5, speed)));

/** The program that speaks on this system, or null when there is none to try. `has` says which programs exist. */
export function speakCommand(platform: string, text: string, speed = 1, has: (cmd: string) => boolean = () => true): SpeakCommand | null {
  const t = speakable(text);
  if (!t) return null;
  const wpm = wordsPerMinute(speed);
  if (platform === 'darwin') return { cmd: 'say', args: ['-r', String(wpm), '-f', '-'], stdin: t };
  if (platform === 'win32') {
    // The words arrive on standard input; the script itself has nothing from the text in it.
    const rate = Math.round((Math.min(2, Math.max(0.5, speed)) - 1) * 10);
    const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${rate}; $s.Speak([Console]::In.ReadToEnd())`;
    return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], stdin: t };
  }
  if (has('spd-say')) return { cmd: 'spd-say', args: ['-w', '-r', String(Math.round((Math.min(2, Math.max(0.5, speed)) - 1) * 100)), '--', t] };
  if (has('espeak-ng')) return { cmd: 'espeak-ng', args: ['-s', String(wpm), '--stdin'], stdin: t };
  if (has('espeak')) return { cmd: 'espeak', args: ['-s', String(wpm), '--stdin'], stdin: t };
  return null;
}

/** What to say when nothing can speak here. */
export function noVoiceHint(platform: string): string {
  return platform === 'linux' ? 'Install speech-dispatcher or eSpeak NG to hear text read aloud.' : 'This computer has no voice for reading aloud.';
}
