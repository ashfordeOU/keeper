// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Turning terminal output into text an AI (or a log) can read: escape codes
// removed, carriage-return progress bars collapsed to their last state,
// backspaces applied, and long output cut to its head and tail.

/** Removes escape sequences (colours, cursor moves, titles, shell-integration marks) and applies \r and \b. */
export function cleanOutput(raw: string): string {
  let s = raw
    // OSC … BEL / ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // DCS, SOS, PM, APC … ST
    .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '')
    // CSI
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // two-character escapes (charset selection, keypad modes, save/restore cursor)
    .replace(/\x1b[()*+][0-9A-Za-z]/g, '')
    .replace(/\x1b[=>78DEHMNOZc]/g, '')
    .replace(/\x1b/g, '')
    // other C0 controls except \n \r \t \b
    .replace(/[\x00-\x07\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '');
  s = s.replace(/\r\n/g, '\n');
  const lines = s.split('\n').map(renderLine);
  return lines.join('\n');
}

/** One line as it would look after \r overwrites and \b erasures. */
function renderLine(line: string): string {
  if (!line.includes('\r') && !line.includes('\b')) return line;
  let out: string[] = [];
  let col = 0;
  for (const ch of line) {
    if (ch === '\r') col = 0;
    else if (ch === '\b') col = Math.max(0, col - 1);
    else {
      out[col] = ch;
      col++;
    }
  }
  // A shorter redraw leaves the old tail; terminals do the same unless the program clears it.
  out = out.map((c) => c ?? ' ');
  return out.join('').replace(/\s+$/, '');
}

export interface Capped {
  text: string;
  truncated: boolean;
  /** characters left out of the middle */
  omitted: number;
}

/** Keeps the first and last parts of long output (errors are usually at the end). */
export function capOutput(text: string, maxChars: number, headShare = 0.25): Capped {
  if (text.length <= maxChars) return { text, truncated: false, omitted: 0 };
  const head = Math.max(0, Math.floor(maxChars * headShare));
  const tail = Math.max(0, maxChars - head);
  const omitted = text.length - head - tail;
  const cutHead = text.slice(0, head).replace(/[^\n]*$/, '');
  const cutTail = text.slice(text.length - tail).replace(/^[^\n]*\n/, '');
  return { text: `${cutHead}\n… ${omitted.toLocaleString('en-US')} characters left out …\n${cutTail}`, truncated: true, omitted };
}

const ASKS = [
  /\[y\/n\]\s*$/i, /\(y\/n\)\s*$/i, /\[yes\/no\]\s*$/i, /\(yes\/no(?:\/\[fingerprint\])?\)\??\s*$/i, /\[Y\/n\]\s*$/, /\[y\/N\]\s*$/,
  /password[^\n]*:\s*$/i, /passphrase[^\n]*:\s*$/i, /\bpin[^\n]*:\s*$/i, /\botp[^\n]*:\s*$/i,
  /continue\?\s*$/i, /proceed\?\s*$/i, /are you sure[^\n]*\?\s*$/i, /press (?:enter|any key|return)[^\n]*$/i,
  /\(END\)\s*$/, /^:\s*$/m, /--More--/,
  /\?\s*›?\s*$/, /:\s*$/,
];

/** True when the last line looks like a program waiting for an answer (a question, a password, a pager). */
export function looksLikeInputPrompt(cleanTail: string): { waiting: boolean; prompt: string } {
  const lines = cleanTail.replace(/\s+$/, '').split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (!last.trim()) return { waiting: false, prompt: '' };
  // A shell prompt is not a question.
  if (/^[^\s]*[@:][^\s]*[$#%>]\s*$/.test(last) || /^PS [^>]*>\s*$/.test(last) || /^[A-Z]:\\[^>]*>\s*$/.test(last)) return { waiting: false, prompt: '' };
  const strong = ASKS.slice(0, ASKS.length - 2).some((re) => re.test(last));
  const weak = !strong && ASKS.slice(-2).some((re) => re.test(last)) && last.length < 160;
  return { waiting: strong || weak, prompt: last.trim().slice(-200) };
}
