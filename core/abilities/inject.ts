// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Giving Keeper's abilities to any chat client through the gateway: the
// client's own tools stay theirs; Keeper adds its abilities, runs any the AI
// calls, and hands back only the calls meant for the client (or the answer).

import type { ChatMessage, ChatOptions, ChatProvider, ChatResult, ToolSpec } from '../brain/providers';

export interface InjectRunner {
  specs: ToolSpec[];
  run(call: { id: string; name: string; args: Record<string, unknown> }): Promise<{ content: string; images?: { mime: string; data: string }[] }>;
  instructions: string;
}

export async function chatWithAbilities(p: ChatProvider, messages: ChatMessage[], clientTools: ToolSpec[], abilities: InjectRunner, opts: ChatOptions & { maxRounds?: number } = {}): Promise<ChatResult & { abilityCalls: string[] }> {
  const own = new Set(abilities.specs.map((s) => s.name));
  const tools = [...clientTools, ...abilities.specs.filter((s) => !clientTools.some((c) => c.name === s.name))];
  const convo: ChatMessage[] = messages.some((m) => m.role === 'system')
    ? messages.map((m, i) => (m.role === 'system' && i === messages.findIndex((x) => x.role === 'system') ? { ...m, content: `${m.content}\n\n${abilities.instructions}` } : m))
    : [{ role: 'system', content: abilities.instructions }, ...messages];
  const calls: string[] = [];
  for (let round = 0; round < (opts.maxRounds ?? 8); round++) {
    const r = await p.chat(convo, tools, opts);
    const mine = r.toolCalls.filter((c) => own.has(c.name) && !clientTools.some((t) => t.name === c.name));
    const theirs = r.toolCalls.filter((c) => !mine.includes(c));
    if (!mine.length || theirs.length) return { ...r, toolCalls: theirs, abilityCalls: calls, stop: theirs.length ? 'tool' : r.stop };
    convo.push({ role: 'assistant', content: r.text, toolCalls: r.toolCalls, raw: r.raw, rawProvider: p.id });
    for (const c of mine) {
      calls.push(c.name);
      const out = await abilities.run(c);
      convo.push({ role: 'tool', toolCallId: c.id, content: out.content, images: out.images });
    }
  }
  return { text: 'Stopped after too many steps.', toolCalls: [], stop: 'length', abilityCalls: calls };
}
