// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Shell integration: shells that print standard escape codes tell the terminal
// where prompts start, which command ran, how it ended and which folder they
// are in. Sequences can be split across chunks of output, so this parser keeps
// a little state between calls.

import type { ShellEvent } from './types';

const MAX_PENDING = 4096;

export class ShellIntegration {
  private pending = '';

  /** Feeds output; returns the events found, in order. */
  feed(data: string): ShellEvent[] {
    const text = this.pending + data;
    this.pending = '';
    const out: ShellEvent[] = [];
    let i = 0;
    for (;;) {
      const start = text.indexOf('\x1b]', i);
      if (start < 0) break;
      const bel = text.indexOf('\x07', start + 2);
      const st = text.indexOf('\x1b\\', start + 2);
      let end = -1;
      let len = 0;
      if (bel >= 0 && (st < 0 || bel < st)) { end = bel; len = 1; } else if (st >= 0) { end = st; len = 2; }
      if (end < 0) {
        // Unfinished: keep it for the next chunk (unless it is suspiciously long).
        const rest = text.slice(start);
        if (rest.length < MAX_PENDING) this.pending = rest;
        break;
      }
      const ev = parseOsc(text.slice(start + 2, end));
      if (ev) out.push(ev);
      i = end + len;
    }
    return out;
  }
}

export function parseOsc(body: string): ShellEvent | null {
  const semi = body.indexOf(';');
  const code = semi < 0 ? body : body.slice(0, semi);
  const rest = semi < 0 ? '' : body.slice(semi + 1);
  switch (code) {
    case '0':
    case '2':
      return { kind: 'title', title: rest };
    case '7': {
      // file://host/path, percent-encoded
      const m = rest.match(/^file:\/\/([^/]*)(\/.*)$/);
      if (!m) return null;
      let p = m[2];
      try {
        p = decodeURIComponent(p);
      } catch {
        /* keep it as sent */
      }
      // Windows shells send /C:/Users/...
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
      return { kind: 'cwd', path: p, host: m[1] || undefined };
    }
    case '9': {
      // OSC 9;4;... is progress in some terminals; a plain OSC 9 is a notification.
      if (/^\d;/.test(rest)) return null;
      return rest ? { kind: 'notify', body: rest } : null;
    }
    case '777': {
      const [what, title, ...b] = rest.split(';');
      if (what !== 'notify') return null;
      return { kind: 'notify', title, body: b.join(';') };
    }
    case '133':
    case '633': {
      // 633 is a richer variant of 133 that also carries the command line.
      const [mark, ...args] = rest.split(';');
      if (mark === 'A') return { kind: 'prompt' };
      if (mark === 'B') return null;
      if (mark === 'C') return { kind: 'command-start' };
      if (mark === 'D') {
        const n = args[0] !== undefined && args[0] !== '' ? Number(args[0]) : undefined;
        return { kind: 'command-end', exit: Number.isFinite(n) ? n : undefined };
      }
      if (code === '633' && mark === 'E') return { kind: 'command-start', command: unescape633(args.join(';')) };
      if (code === '633' && mark === 'P') {
        const kv = args.join(';');
        if (kv.startsWith('Cwd=')) return { kind: 'cwd', path: unescape633(kv.slice(4)) };
      }
      return null;
    }
    default:
      return null;
  }
}

function unescape633(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\\\/g, '\\');
}

/**
 * Small scripts that make common shells report prompts, commands and folders.
 * Keeper types nothing into the shell; these are offered for the person to add
 * to their shell's start-up file, or sourced automatically when they turn on
 * "Shell integration" for a profile.
 */
export const INTEGRATION_SCRIPTS: Record<'bash' | 'zsh' | 'fish' | 'powershell', string> = {
  bash: `__keeper_prompt() { local e=$?; printf '\\e]133;D;%s\\a\\e]7;file://%s%s\\a\\e]133;A\\a' "$e" "$HOSTNAME" "$PWD"; }
__keeper_preexec() { [ -n "$COMP_LINE" ] && return; [ "$BASH_COMMAND" = "__keeper_prompt" ] && return; printf '\\e]133;C\\a'; }
PROMPT_COMMAND="__keeper_prompt\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
trap '__keeper_preexec' DEBUG
`,
  zsh: `__keeper_precmd() { local e=$?; print -Pn "\\e]133;D;$e\\a\\e]7;file://$HOST$PWD\\a\\e]133;A\\a"; }
__keeper_preexec() { print -Pn "\\e]133;C\\a"; }
autoload -Uz add-zsh-hook; add-zsh-hook precmd __keeper_precmd; add-zsh-hook preexec __keeper_preexec
`,
  fish: `function __keeper_prompt --on-event fish_prompt; printf '\\e]133;D;%s\\a\\e]7;file://%s%s\\a\\e]133;A\\a' $status (hostname) $PWD; end
function __keeper_preexec --on-event fish_preexec; printf '\\e]133;C\\a'; end
`,
  powershell: `$__keeperPrompt = $function:prompt
function prompt { $e = if ($?) { 0 } else { 1 }; $p = $executionContext.SessionState.Path.CurrentLocation.ProviderPath; "$([char]27)]133;D;$e$([char]7)$([char]27)]7;file://$env:COMPUTERNAME/$($p -replace '\\\\','/')$([char]7)$([char]27)]133;A$([char]7)" + (& $__keeperPrompt) }
`,
};
