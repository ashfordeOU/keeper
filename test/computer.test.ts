// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  anthropicToolset, blockedBy, changes, defaultComputerPolicy, describeComputer, findNode, fromAnthropic, fromOpenAi, fromToolInput, genericComputerTool,
  isAnthropicMember, normalizeComputerPolicy, openAiCallOutput, parseCombo, RateLimit, secretIn, sessionExpired, shotSize, toNormalized, toShot, uiTreeText,
  ANTHROPIC_MEMBERS, ANTHROPIC_TOOLSET, type UiNode,
} from '../core/computer';
import { toGemini, toResponsesInput } from '../core/brain/adapters';
import { supportsAnthropicToolset, type ChatMessage } from '../core/brain/providers';
import { normalizeAgentSettings } from '../core/agents-config';

describe('computer actions from tool input', () => {
  it('clicks of every kind, with modifiers', () => {
    expect(fromToolInput('left_click', { coordinate: [10, 20] })).toEqual({ type: 'click', button: 'left', count: 1, x: 10, y: 20 });
    expect(fromToolInput('right_click', { coordinate: [1, 2] })).toMatchObject({ button: 'right' });
    expect(fromToolInput('triple_click', { coordinate: [1, 2], text: 'shift+ctrl' })).toMatchObject({ count: 3, mods: ['shift', 'ctrl'] });
    // No coordinate: click where the pointer is.
    expect(fromToolInput('double_click', {})).toEqual({ type: 'click', button: 'left', count: 2 });
  });
  it('drag, scroll, keys, type and the app actions', () => {
    expect(fromToolInput('left_click_drag', { start_coordinate: [0, 0], coordinate: [50, 60] })).toEqual({ type: 'drag', path: [[0, 0], [50, 60]] });
    expect(fromToolInput('scroll', { scroll_direction: 'up', scroll_amount: 4, coordinate: [5, 5] })).toEqual({ type: 'scroll', dx: 0, dy: -4, x: 5, y: 5 });
    expect(fromToolInput('key', { text: 'ctrl+s', repeat: 3 })).toEqual({ type: 'key', keys: 'ctrl+s', repeat: 3 });
    expect(fromToolInput('type', { text: 'hello' })).toEqual({ type: 'type', text: 'hello' });
    expect(fromToolInput('open', { target: 'https://example.com' })).toEqual({ type: 'open', target: 'https://example.com' });
    expect(fromToolInput('ui_tree', {})).toEqual({ type: 'ui_tree', depth: 6 });
    expect(fromToolInput('wait', { duration: 99 })).toEqual({ type: 'wait', seconds: 30 });
  });
  it('explains what is missing so the AI can fix its call', () => {
    expect(() => fromToolInput('mouse_move', {})).toThrow(/coordinate/);
    expect(() => fromToolInput('left_click_drag', { coordinate: [1, 1] })).toThrow(/start_coordinate/);
    expect(() => fromToolInput('type', {})).toThrow(/text/);
    expect(() => fromToolInput('fly', {})).toThrow(/Unknown/);
  });
  it('knows which actions change the screen, and says what each did', () => {
    expect(changes({ type: 'screenshot' })).toBe(false);
    expect(changes({ type: 'type', text: 'x' })).toBe(true);
    expect(describeComputer({ type: 'click', button: 'left', count: 2, x: 4.4, y: 5.6 })).toBe('double-clicked at 4,6');
    expect(describeComputer({ type: 'type', text: 'abc' })).toBe('typed 3 characters');
  });
});

describe('the three ways to describe the tool', () => {
  it('Anthropic: the 2026-08-01 toolset entry has no display size, and members map back', () => {
    expect(anthropicToolset()).toEqual({ type: ANTHROPIC_TOOLSET });
    expect(ANTHROPIC_MEMBERS).toHaveLength(17);
    const block = { name: 'left_click', toolset_name: 'computer', input: { coordinate: [100, 200], text: 'cmd' } };
    expect(isAnthropicMember(block)).toBe(true);
    expect(fromAnthropic(block)).toEqual({ type: 'click', button: 'left', count: 1, x: 100, y: 200, mods: ['cmd'] });
    expect(isAnthropicMember({ name: 'left_click' })).toBe(false);
  });
  it('Anthropic: the toolset is used only with models that take it', () => {
    expect(supportsAnthropicToolset('claude-opus-5-5')).toBe(true);
    expect(supportsAnthropicToolset('claude-haiku-5-5')).toBe(true);
    expect(supportsAnthropicToolset('claude-sonnet-6')).toBe(true);
    expect(supportsAnthropicToolset('claude-opus-4-7')).toBe(false);
    expect(supportsAnthropicToolset('claude-sonnet-5')).toBe(false);
    expect(supportsAnthropicToolset('gpt-5')).toBe(false);
  });
  it('OpenAI: a batch of computer_call actions, with pixel scrolls turned into notches', () => {
    const acts = fromOpenAi([
      { type: 'click', button: 'left', x: 10, y: 20 },
      { type: 'double_click', x: 3, y: 4 },
      { type: 'scroll', x: 1, y: 1, scroll_x: 0, scroll_y: 300 },
      { type: 'keypress', keys: ['CTRL', 'L'] },
      { type: 'type', text: 'penguin' },
      { type: 'drag', path: [{ x: 0, y: 0 }, { x: 9, y: 9 }] },
      { type: 'screenshot' },
    ]);
    expect(acts[0]).toEqual({ type: 'click', button: 'left', count: 1, x: 10, y: 20 });
    expect(acts[1]).toMatchObject({ count: 2 });
    expect(acts[2]).toEqual({ type: 'scroll', x: 1, y: 1, dx: 0, dy: 3 });
    expect(acts[3]).toEqual({ type: 'key', keys: 'ctrl+l' });
    expect(acts[4]).toEqual({ type: 'type', text: 'penguin' });
    expect(acts[5]).toEqual({ type: 'drag', path: [[0, 0], [9, 9]] });
    expect(acts[6]).toEqual({ type: 'screenshot' });
    expect(openAiCallOutput('call_1', 'AAA')).toEqual({ type: 'computer_call_output', call_id: 'call_1', output: { type: 'computer_screenshot', image_url: 'data:image/png;base64,AAA', detail: 'original' } });
  });
  it('any other AI: one function with an action field', () => {
    const t = genericComputerTool(1280, 800);
    expect(t.name).toBe('computer');
    expect(t.description).toContain('1280×800');
    const props = (t.parameters as { properties: { action: { enum: string[] } } }).properties;
    expect(props.action.enum).toContain('left_click');
    expect(props.action.enum).toContain('ui_tree');
  });
});

describe('screenshots and coordinates', () => {
  const retina = { id: '1', x: 0, y: 0, width: 1512, height: 982, scale: 2 };
  it('screenshots fit the AI limits and never exceed the screen', () => {
    const s = shotSize(retina);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(1366);
    expect(s.width * s.height).toBeLessThanOrEqual(1_150_000);
    expect(shotSize({ ...retina, width: 800, height: 600 })).toEqual({ width: 800, height: 600, factor: 1 });
  });
  it('maps screenshot pixels to the display and back, on any display', () => {
    const shot = shotSize(retina);
    const n = toNormalized(shot, shot.width / 2, shot.height / 2);
    expect(n.x).toBeCloseTo(0.5, 3);
    // An external display to the left (negative x), 1.25 scale.
    const ext = { id: '2', x: -1920, y: 0, width: 1920, height: 1080, scale: 1.25 };
    const es = shotSize(ext);
    expect(toShot(es, ext, -960, 540)).toEqual({ x: Math.round(es.width / 2), y: Math.round(es.height / 2) });
    // Clicks just outside the picture stay on its edge.
    expect(toNormalized(shot, -50, 99999).x).toBe(0);
    expect(toNormalized(shot, -50, 99999).y).toBeLessThan(1);
  });
});

describe('keys', () => {
  it('reads combinations the way AIs write them', () => {
    expect(parseCombo('Return')).toMatchObject({ code: 'Enter', mods: {} });
    expect(parseCombo('ctrl+shift+t')).toMatchObject({ code: 'KeyT', mods: { ctrl: true, shift: true } });
    expect(parseCombo('cmd+space')).toMatchObject({ code: 'Space', mods: { meta: true } });
    expect(parseCombo('Page_Down').code).toBe('PageDown');
    expect(parseCombo('F12').code).toBe('F12');
    expect(parseCombo('super').code).toBe('MetaLeft');
    expect(parseCombo('A').mods.shift).toBe(true);
    expect(() => parseCombo('ctrl+banana')).toThrow(/Unknown key/);
  });
});

describe('safety', () => {
  const p = defaultComputerPolicy();
  it('is off unless the person turns it on, and settings are checked', () => {
    expect(p.permission).toBe('off');
    expect(normalizeAgentSettings({}).computer.permission).toBe('off');
    expect(normalizeComputerPolicy({ permission: 'sure', maxActionsPerMinute: 1e9, blockedApps: [3, ' X '] })).toMatchObject({ permission: 'off', maxActionsPerMinute: 600, blockedApps: ['X'] });
  });
  it('refuses password managers, keychains, terminals and private-looking windows', () => {
    expect(blockedBy(p, { app: '1Password' })).toMatch(/1Password/);
    expect(blockedBy(p, { app: 'Keychain Access' })).toBeTruthy();
    expect(blockedBy(p, { app: 'gnome-terminal-server' })).toBeTruthy();
    expect(blockedBy(p, { app: 'Terminal' })).toBeTruthy();
    expect(blockedBy(p, { app: 'pwsh.exe' })).toBeTruthy();
    expect(blockedBy(p, { app: 'firefox', title: 'Online Banking – My Bank' })).toMatch(/private/);
    expect(blockedBy(p, { app: 'firefox', title: 'Weather' })).toBeUndefined();
    // A short blocked name only matches whole names, not parts of others.
    expect(blockedBy({ ...p, blockedApps: ['cmd'] }, { app: 'cmdline-helper' })).toBeUndefined();
  });
  it('never types secrets', () => {
    expect(secretIn('sk-ant-api03-' + 'a'.repeat(90))).toBeTruthy();
    expect(secretIn('password: hunter22')).toBeTruthy();
    expect(secretIn('4111 1111 1111 1111')).toBeTruthy();
    expect(secretIn('Lunch at noon')).toBeUndefined();
  });
  it('limits actions per minute', () => {
    const r = new RateLimit(3);
    expect([r.take(0), r.take(1), r.take(2), r.take(3)]).toEqual([true, true, true, false]);
    expect(r.take(61_000)).toBe(true);
  });
  it('ends sessions after idle time and after the time limit', () => {
    const s = { id: 's', client: 'c', started: 0, last: 0, actions: 0 };
    expect(sessionExpired(s, p, 60_000)).toBeUndefined();
    expect(sessionExpired(s, p, p.idleMinutes * 60_000 + 1)).toMatch(/no action/);
    expect(sessionExpired({ ...s, last: p.maxMinutes * 60_000 }, p, p.maxMinutes * 60_000 + 1)).toMatch(/limit/);
  });
});

describe('the front window\'s controls', () => {
  const tree: UiNode = {
    id: 'w0', role: 'window', name: 'Settings', x: 0, y: 0, width: 1000, height: 800,
    children: [{ id: 'w0/0', role: 'group', children: [{ id: 'w0/0/0', role: 'push button', name: 'Save', x: 100, y: 100, width: 80, height: 20 }, { id: 'w0/0/1', role: 'text field', name: 'Name', value: 'Ana', x: 100, y: 140, width: 200, height: 20, enabled: false }] }],
  };
  it('lists controls with ids and their centres in screenshot pixels', () => {
    const text = uiTreeText(tree, (x, y) => ({ x: x / 2, y: y / 2 }));
    expect(text).toContain('[w0/0/0] push button Save @70,55');
    expect(text).toContain('[w0/0/1] text field Name = “Ana”');
    expect(text).toContain('(disabled)');
    // The empty group is skipped; its children are not.
    expect(text).not.toContain('[w0/0] group');
    expect(findNode(tree, 'w0/0/1')?.name).toBe('Name');
    expect(uiTreeText(undefined, (x, y) => ({ x, y }))).toMatch(/does not expose/);
  });
});

describe('pictures in tool results, for each kind of AI', () => {
  const msgs: ChatMessage[] = [
    { role: 'user', content: 'Open the menu' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'computer', args: { action: 'screenshot' } }] },
    { role: 'tool', content: 'Screenshot 10×10', toolCallId: 'c1', images: [{ mime: 'image/png', data: 'AAAA' }] },
  ];
  it('OpenAI Responses: the result, then the picture as the user\'s input_image', () => {
    const items = toResponsesInput(msgs) as Record<string, unknown>[];
    const out = items.findIndex((i) => i.type === 'function_call_output');
    expect(items[out + 1]).toMatchObject({ role: 'user', content: [{ type: 'input_text' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] });
  });
  it('Gemini: inline data next to the function response', () => {
    const body = toGemini(msgs, []) as { contents: { role: string; parts: Record<string, unknown>[] }[] };
    const last = body.contents[body.contents.length - 1];
    expect(last.parts.some((p) => 'functionResponse' in p)).toBe(true);
    expect(last.parts.some((p) => (p.inlineData as { data?: string } | undefined)?.data === 'AAAA')).toBe(true);
  });
});

describe('the Assistant using the computer (any AI, through the harness)', () => {
  it('offers the tool, passes screenshots to the AI, keeps only the latest three, and follows the instructions line', async () => {
    const { Harness } = await import('../core/brain/harness');
    const seen: ChatMessage[][] = [];
    let round = 0;
    const provider = {
      id: 'fake', label: 'Fake', model: 'm', local: false, supportsTools: true, contextTokens: 200_000,
      async chat(m: ChatMessage[], tools: { name: string }[]) {
        seen.push(m.map((x) => ({ ...x })));
        expect(tools.some((t) => t.name === 'computer')).toBe(true);
        round++;
        if (round <= 5) return { text: '', toolCalls: [{ id: `c${round}`, name: 'computer', args: { action: 'screenshot' } }], stop: 'tool' as const };
        return { text: 'Done', toolCalls: [], stop: 'end' as const };
      },
    };
    const calls: string[] = [];
    const env = {
      visibility: 'snippets' as const, allowed: () => true, search: async () => [], read: async () => ({ text: '', total: 0, truncated: false }),
      extraTools: {
        specs: [genericComputerTool(100, 50)],
        instructions: 'You can use this computer.',
        run: async (call: { args: Record<string, unknown> }) => {
          calls.push(String(call.args.action));
          return { content: 'Screenshot 100×50', summary: 'looked at the screen', images: [{ mime: 'image/png', data: `IMG${calls.length}` }] };
        },
      },
    };
    const r = await new Harness(provider, env, { maxRounds: 10 }).ask('Click Save');
    expect(r.answer).toBe('Done');
    expect(calls).toHaveLength(5);
    expect(seen[0][0].content).toContain('You can use this computer.');
    const last = seen[seen.length - 1];
    const withPics = last.filter((m) => m.images?.length);
    expect(withPics.map((m) => m.images![0].data)).toEqual(['IMG3', 'IMG4', 'IMG5']);
    expect(last.filter((m) => /older screenshot removed/.test(m.content))).toHaveLength(2);
  });
});
