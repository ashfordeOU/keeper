// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// For agents that cannot call the hub themselves (no MCP, or a tool that only
// reads its prompt): Keeper types the message in at the agent's prompt when it
// is idle, waits for it to finish answering, and posts the answer back as a
// reply. Messages queue until the agent is idle; Keeper never interrupts an
// agent mid-work unless the person says so. Agents that do speak MCP just get
// a one-line nudge to read their inbox.
//
// Telling "idle at its prompt" apart from "thinking" is a guess per program:
// quiet output for a while, plus how that program's prompt looks.

import { cleanOutput } from './clean';
import type { MailItem } from './bus';
import type { AgentHub, HubAgent } from './hub';
import type { AgentTerminals } from './manager';

/** How each program's input prompt looks at the bottom of the screen when it waits for you (best guesses). */
const IDLE: Record<string, RegExp[]> = {
  claude: [/(?:^|\n)\s*[│|]?\s*>\s*(?:[│|]\s*)?$/, /\? for shortcuts/, /Try "[^"]*"/],
  codex: [/(?:^|\n)\s*[▌›>]\s*$/, /send\s+⏎|⏎ send/i, /Ctrl\+J newline/i],
  gemini: [/Type your message/i, /(?:^|\n)\s*>\s*$/],
  grok: [/(?:^|\n)\s*[>❯]\s*$/, /Ask Grok/i],
  'cursor-agent': [/(?:^|\n)\s*[→>]\s*$/, /Add a follow-up/i],
  aider: [/(?:^|\n)(?:[\w./-]+\s)?>\s*$/],
  opencode: [/(?:^|\n)\s*>\s*$/],
  openclaw: [/(?:^|\n)\s*[>❯]\s*$/],
  hermes: [/(?:^|\n)\s*[>❯]\s*$/],
};
const SHELL = /(?:[$#%>❯]|\]\$)\s*$/;

/**
 * True when the end of the screen looks like this program is waiting at its prompt.
 * `strict` (used before typing anything in) accepts only the program's own prompt,
 * never a plain shell prompt: if the agent has quit and left a shell behind, a
 * message typed there would run as a command ("$(…)", ";" and the like).
 */
export function looksIdle(harness: string, screenTail: string, strict = false): boolean {
  const tail = screenTail.replace(/\s+$/, '').split('\n').slice(-8).join('\n');
  const pats = IDLE[harness] ?? [];
  return pats.some((re) => re.test(tail)) || (!strict && SHELL.test(tail.split('\n').pop() ?? ''));
}

/** The text typed in for a message (one paragraph; programs treat newlines as "send"). */
export function deliveryText(m: MailItem, from: HubAgent | undefined, hasMcp: boolean): string {
  const who = from ? `${from.name} (${from.harness}${from.account ? `, ${from.account}` : ''})` : m.from;
  if (hasMcp) return `[Keeper hub] You have a message from ${who}. Read it with the hub_inbox tool and reply with hub_send.`;
  const body = m.text.replace(/\s*\n\s*/g, ' ').slice(0, 3000);
  return `[Keeper hub] Message from ${who}: ${body} — Answer in your next reply; Keeper will pass your answer back to ${from?.name ?? 'them'}.`;
}

export interface BridgeOptions {
  /** quiet this long before counting as idle */
  idleMs: number;
  /** longest wait for an answer */
  answerMs: number;
  /** pause between typing the text and pressing Enter (programs treat fast text+Enter as a paste) */
  enterDelayMs: number;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export const BRIDGE_DEFAULTS = { idleMs: 2500, answerMs: 10 * 60_000, enterDelayMs: 400 };

/** Delivers queued messages to one agent through its terminal, and returns what was passed back. */
export async function deliverQueued(hub: AgentHub, terms: AgentTerminals, agent: HubAgent, o: BridgeOptions): Promise<{ delivered: number; answered: number }> {
  if (!agent.session || !terms.get(agent.session)) return { delivered: 0, answered: 0 };
  const owner = `bridge:${agent.id}`;
  const t = terms.get(agent.session)!;
  if (t.controller === 'human') return { delivered: 0, answered: 0 };
  const quiet = o.now() - t.lastOutput;
  if (t.status === 'exited' || quiet < o.idleMs || !looksIdle(agent.harness, terms.snapshot(agent.session, owner, 12), true)) return { delivered: 0, answered: 0 };
  const mcp = agent.via === 'mcp';
  // Agents with tools read their own inbox: only peek, and nudge them once.
  const mail = hub.inbox(agent.id, mcp);
  if (!mail.length) return { delivered: 0, answered: 0 };
  let answered = 0;
  for (const [i, m] of (mcp ? mail.slice(0, 1) : mail).entries()) {
    // Before each later message, the program must still be the one at its own prompt.
    if (i > 0) {
      const cur = terms.get(agent.session);
      if (!cur || cur.status === 'exited' || !looksIdle(agent.harness, terms.snapshot(agent.session, owner, 12), true)) break;
    }
    const before = terms.read(agent.session, owner, { cursor: Number.MAX_SAFE_INTEGER }).cursor;
    const text = deliveryText(m, hub.get(m.from), mcp);
    terms.write(agent.session, owner, text);
    await o.sleep(o.enterDelayMs);
    terms.write(agent.session, owner, '\r');
    hub.seen(agent.id, 'working');
    if (mcp) return { delivered: mail.length, answered: 0 };
    // Wait for it to start answering, then to go quiet at its prompt again.
    const end = o.now() + o.answerMs;
    await o.sleep(Math.min(1500, o.idleMs));
    for (;;) {
      const cur = terms.get(agent.session);
      if (!cur || cur.status === 'exited') break;
      const idle = o.now() - cur.lastOutput >= o.idleMs && looksIdle(agent.harness, terms.snapshot(agent.session, owner, 12));
      if (idle || o.now() > end) break;
      await o.sleep(500);
    }
    const out = terms.read(agent.session, owner, { cursor: before, maxChars: 8000 }).text;
    const reply = extractReply(out, text);
    if (reply && hub.get(m.from)) {
      hub.bus.send(m.from, agent.id, reply, { inReplyTo: m.id, viaBridge: true });
      answered++;
    }
    hub.seen(agent.id, 'idle');
  }
  return { delivered: mail.length, answered };
}

/** The agent's answer: what it printed after the message, without the echo, prompt lines and frame borders. */
export function extractReply(output: string, typed: string): string {
  let s = cleanOutput(output);
  const at = s.indexOf(typed.slice(0, 60));
  if (at >= 0) s = s.slice(at + typed.length);
  const lines = s.split('\n')
    .map((l) => l.replace(/^[\s│|┃╭╮╰╯─━┌┐└┘]+|[\s│|┃╭╮╰╯─━┌┐└┘]+$/g, ''))
    .filter((l) => l && !/^[>❯›▌→$#%]\s*$/.test(l) && !/\? for shortcuts|Type your message|esc to interrupt|tokens? used|ctrl\+[a-z]/i.test(l));
  return lines.join('\n').trim().slice(0, 20_000);
}
