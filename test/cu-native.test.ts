// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The AI services' own computer-use tools (OpenAI's Responses computer tool,
// Gemini's computer use) against stand-in servers, desktop marks from
// accessibility and from text read off the screen, and workflows that run by
// themselves.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../core/brain/adapters';
import { createProvider, type ChatMessage, type ToolSpec } from '../core/brain/providers';
import { fromToolInput, genericComputerTool } from '../core/computer';
import { axInShot, desktopMarksText, marksFromAx, marksFromOcr } from '../core/cu/marks';
import { fromGeminiCall, geminiComputerKind, geminiNeedsConfirmation, openAiComputerKind } from '../core/cu/native';
import { describeSchedule, dueSchedules, triggeredBy, wakeIn, type WorkflowSchedule } from '../core/cu/schedule';

// ---------------------------------------------------------------- a stand-in AI service

const seen: { path: string; body: Record<string, unknown> }[] = [];
let reply: (path: string, body: Record<string, unknown>) => unknown = () => ({});
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      seen.push({ path: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply(req.url ?? '', body)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const PNG = { mime: 'image/png', data: 'iVBORw0KGgo=' };

function computerSpec(): ToolSpec {
  return { ...genericComputerTool(1280, 800), native: { openai: { width: 1280, height: 800 }, gemini: 'desktop' } };
}
const other: ToolSpec = { name: 'browser', description: 'Keeper browser', parameters: { type: 'object', properties: {} } };

// ---------------------------------------------------------------- OpenAI

describe('OpenAI computer tool (Responses API)', () => {
  it('knows which models have it', () => {
    expect(openAiComputerKind('gpt-6.1-sol')).toBe('ga');
    expect(openAiComputerKind('gpt-5.4')).toBe('ga');
    expect(openAiComputerKind('computer-use-preview')).toBe('preview');
    expect(openAiComputerKind('gpt-4.1')).toBeNull();
  });

  it('sends the built-in tool, runs its batch through Keeper and answers with the screen and the approved checks', async () => {
    seen.length = 0;
    reply = () => ({
      status: 'completed',
      output: [
        { type: 'reasoning', id: 'rs_1', encrypted_content: 'sealed', summary: [] },
        { type: 'computer_call', id: 'cu_1', call_id: 'call_1', status: 'completed', actions: [{ type: 'click', button: 'left', x: 10, y: 20 }, { type: 'type', text: 'hello' }], pending_safety_checks: [{ id: 'sc_1', code: 'malicious_instructions', message: 'The page asks for something unusual' }] },
      ],
    });
    const p = createProvider({ kind: 'openai-responses', baseUrl: `${base}/v1`, apiKey: 'k', model: 'gpt-6.1-sol' });
    const msgs: ChatMessage[] = [{ role: 'system', content: 'be careful' }, { role: 'user', content: 'Order the book' }];
    const r1 = await p.chat(msgs, [computerSpec(), other]);
    const sent = seen[0].body;
    expect(seen[0].path).toBe('/v1/responses');
    expect(sent.tools).toEqual([{ type: 'computer' }, { type: 'function', name: 'browser', description: 'Keeper browser', parameters: { type: 'object', properties: {} } }]);
    expect(sent.include).toEqual(['reasoning.encrypted_content']);
    expect(sent.store).toBe(false);
    expect(r1.stop).toBe('tool');
    expect(r1.toolCalls[0]).toMatchObject({ id: 'call_1', name: 'computer', args: { openai_actions: [{ type: 'click' }, { type: 'type' }], pending_safety_checks: [{ id: 'sc_1' }] } });

    // The next turn: the model's own items go back, then the screen after the batch, acknowledging what the person approved.
    reply = () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done' }] }] });
    const r2 = await p.chat([...msgs, { role: 'assistant', content: '', toolCalls: r1.toolCalls, raw: r1.raw, rawProvider: 'openai-responses' }, { role: 'tool', toolCallId: 'call_1', content: 'clicked at 10,20\ntyped 5 characters', images: [PNG] }], [computerSpec(), other]);
    expect(r2.text).toBe('Done');
    const input = seen[1].body.input as Record<string, unknown>[];
    expect(input.find((i) => i.type === 'reasoning')).toMatchObject({ encrypted_content: 'sealed' });
    expect(input.find((i) => i.type === 'computer_call')).toMatchObject({ call_id: 'call_1' });
    const out = input.find((i) => i.type === 'computer_call_output') as Record<string, unknown>;
    expect(out).toMatchObject({ call_id: 'call_1', output: { type: 'computer_screenshot', image_url: `data:image/png;base64,${PNG.data}`, detail: 'original' }, acknowledged_safety_checks: [{ id: 'sc_1' }] });
    expect(input.some((i) => i.type === 'function_call')).toBe(false);
  });

  it('does not acknowledge a check the person declined', async () => {
    seen.length = 0;
    reply = () => ({ status: 'completed', output: [] });
    const p = createProvider({ kind: 'openai-responses', baseUrl: `${base}/v1`, apiKey: 'k', model: 'gpt-6.1-sol' });
    const call = { id: 'call_9', name: 'computer', args: { openai_actions: [{ type: 'click', x: 1, y: 1 }], pending_safety_checks: [{ id: 'sc_9' }] } };
    await p.chat([{ role: 'user', content: 'x' }, { role: 'assistant', content: '', toolCalls: [call], raw: [{ type: 'computer_call', call_id: 'call_9', actions: [] }], rawProvider: 'openai-responses' }, { role: 'tool', toolCallId: 'call_9', content: 'The person declined this step.', isError: true }], [computerSpec()]);
    const out = (seen[0].body.input as Record<string, unknown>[]).find((i) => i.type === 'computer_call_output')!;
    expect(out.acknowledged_safety_checks).toBeUndefined();
  });

  it('turns a trimmed older computer turn into plain text (no orphan outputs)', async () => {
    seen.length = 0;
    const p = createProvider({ kind: 'openai-responses', baseUrl: `${base}/v1`, apiKey: 'k', model: 'gpt-6.1-sol' });
    const call = { id: 'call_old', name: 'computer', args: { openai_actions: [{ type: 'screenshot' }] } };
    await p.chat([{ role: 'user', content: 'x' }, { role: 'assistant', content: '', toolCalls: [call] }, { role: 'tool', toolCallId: 'call_old', content: '[older result removed]' }], [computerSpec()]);
    const input = seen[0].body.input as Record<string, unknown>[];
    expect(input.some((i) => i.type === 'computer_call_output' || i.type === 'function_call')).toBe(false);
  });

  it('OpenAI over the chat format uses the Responses API only for computer turns', async () => {
    seen.length = 0;
    reply = (path) => (path.endsWith('/responses') ? { status: 'completed', output: [] } : { choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
    const p = createProvider({ kind: 'openai', baseUrl: `${base}/v1`, apiKey: 'k', model: 'gpt-6.1-sol' });
    await p.chat([{ role: 'user', content: 'x' }], [computerSpec()]);
    await p.chat([{ role: 'user', content: 'x' }], [other]);
    expect(seen.map((s) => s.path)).toEqual(['/v1/responses', '/v1/chat/completions']);
  });

  it('the preview model gets its display size', async () => {
    seen.length = 0;
    reply = () => ({ status: 'completed', output: [{ type: 'computer_call', call_id: 'c', action: { type: 'screenshot' } }] });
    const p = createProvider({ kind: 'openai-responses', baseUrl: `${base}/v1`, apiKey: 'k', model: 'computer-use-preview' });
    const r = await p.chat([{ role: 'user', content: 'x' }], [computerSpec()]);
    expect((seen[0].body.tools as unknown[])[0]).toEqual({ type: 'computer_use_preview', display_width: 1280, display_height: 800, environment: 'linux' });
    expect(seen[0].body.truncation).toBe('auto');
    expect(r.toolCalls[0].args.openai_actions).toEqual([{ type: 'screenshot' }]);
  });
});

// ---------------------------------------------------------------- Gemini

describe('Gemini computer use', () => {
  it('knows which models have it', () => {
    expect(geminiComputerKind('gemini-3.8-flash')).toBe('current');
    expect(geminiComputerKind('gemini-4-argon')).toBe('current');
    expect(geminiComputerKind('gemini-2.5-computer-use-preview-10-2025')).toBe('legacy');
    expect(geminiComputerKind('gemini-2.5-flash')).toBeNull();
  });

  it('maps its 0–999 grid onto the screenshot and its functions onto Keeper’s actions', () => {
    const size = { width: 1280, height: 800 };
    expect(fromGeminiCall('click', { x: 500, y: 250, intent: 'open' }, size)).toEqual([{ type: 'click', button: 'left', count: 1, x: 640, y: 200 }]);
    expect(fromGeminiCall('type_text_at', { x: 100, y: 100, text: 'hi', press_enter: true }, size)).toEqual([{ type: 'click', button: 'left', count: 1, x: 128, y: 80 }, { type: 'type', text: 'hi' }, { type: 'key', keys: 'Return' }]);
    expect(fromGeminiCall('hotkey', { keys: ['Control', 'S'] }, size)).toEqual([{ type: 'key', keys: 'ctrl+s' }]);
    expect(fromGeminiCall('scroll', { direction: 'down', magnitude_in_pixels: 300 }, size)).toEqual([{ type: 'scroll', dx: 0, dy: 3 }]);
    expect(fromGeminiCall('drag_and_drop', { start_x: 0, start_y: 0, end_x: 999, end_y: 999 }, size)).toEqual([{ type: 'drag', path: [[0, 0], [1279, 799]] }]);
    expect(() => fromGeminiCall('fly', {}, size)).toThrow(/Unknown/);
  });

  it('sends the computer-use tool, keeps thought signatures and answers with the screen inside the function response', async () => {
    seen.length = 0;
    const part = { functionCall: { name: 'click', args: { x: 500, y: 500, intent: 'Press Buy', safety_decision: { decision: 'require_confirmation', explanation: 'This buys something' } } }, thoughtSignature: 'sig-1' };
    reply = () => ({ candidates: [{ content: { role: 'model', parts: [part] }, finishReason: 'STOP' }] });
    const p = createProvider({ kind: 'gemini', baseUrl: `${base}/v1beta`, apiKey: 'k', model: 'gemini-3.8-flash' });
    const msgs: ChatMessage[] = [{ role: 'user', content: 'Buy it' }];
    const r1 = await p.chat(msgs, [computerSpec(), other]);
    const tools = seen[0].body.tools as Record<string, unknown>[];
    expect(tools).toEqual([{ functionDeclarations: [{ name: 'browser', description: 'Keeper browser', parameters: { type: 'object', properties: {} } }] }, { computer_use: { environment: 'ENVIRONMENT_DESKTOP', enable_prompt_injection_detection: true, excluded_predefined_functions: ['key_down', 'key_up'] } }]);
    expect(r1.toolCalls[0]).toMatchObject({ name: 'computer', args: { gemini_action: 'click', x: 500, y: 500 } });
    expect(geminiNeedsConfirmation(r1.toolCalls[0].args)?.explanation).toBe('This buys something');

    reply = () => ({ candidates: [{ content: { parts: [{ text: 'Bought' }] }, finishReason: 'STOP' }] });
    await p.chat([...msgs, { role: 'assistant', content: '', toolCalls: r1.toolCalls, raw: r1.raw, rawProvider: 'gemini' }, { role: 'tool', toolCallId: r1.toolCalls[0].id, content: 'clicked at 640,400', images: [PNG] }], [computerSpec(), other]);
    const contents = seen[1].body.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents[1]).toEqual({ role: 'model', parts: [part] });
    expect(contents[2].parts[0]).toEqual({ functionResponse: { name: 'click', response: { output: 'clicked at 640,400', safety_acknowledgement: 'true' }, parts: [{ inlineData: { mimeType: 'image/png', data: PNG.data } }] } });
  });

  it('older Gemini models keep plain function calling', async () => {
    seen.length = 0;
    reply = () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'computer', args: { action: 'screenshot' } } }] }, finishReason: 'STOP' }] });
    const p = createProvider({ kind: 'gemini', baseUrl: `${base}/v1beta`, apiKey: 'k', model: 'gemini-2.5-flash' });
    const r = await p.chat([{ role: 'user', content: 'x' }], [computerSpec()]);
    expect(JSON.stringify(seen[0].body.tools)).not.toContain('computer_use');
    expect(r.toolCalls[0]).toMatchObject({ name: 'computer', args: { action: 'screenshot' } });
  });
});

// ---------------------------------------------------------------- desktop marks

describe('numbered marks on the desktop', () => {
  it('the computer tool takes marks and click_mark', () => {
    expect(fromToolInput('marks', {})).toEqual({ type: 'marks' });
    expect(fromToolInput('click_mark', { ref: 3 })).toEqual({ type: 'click_mark', ref: 3 });
    expect(() => fromToolInput('click_mark', {})).toThrow(/ref/);
  });

  it('accessibility boxes in screen points become marks in screenshot pixels', () => {
    const tree = { id: 'w0', role: 'window', name: 'Notes', x: 0, y: 0, width: 2560, height: 1600, children: [
      { id: 'w0/0', role: 'button', name: 'Save', x: 200, y: 100, width: 100, height: 40 },
      { id: 'w0/1', role: 'text field', name: 'Title', value: 'Groceries', x: 200, y: 200, width: 600, height: 40 },
    ] };
    const half = (x: number, y: number) => ({ x: Math.round(x / 2), y: Math.round(y / 2) });
    const { marks, ids } = marksFromAx(axInShot(tree, half), { width: 1280, height: 800 });
    expect(marks.map((m) => [m.ref, m.role, m.name, m.box])).toEqual([[1, 'button', 'Save', { x: 100, y: 50, width: 50, height: 20 }], [2, 'text field', 'Title', { x: 100, y: 100, width: 300, height: 20 }]]);
    expect(ids.get(1)).toBe('w0/0');
    expect(desktopMarksText(marks)).toContain('[1] button "Save" @125,60');
  });

  it('with no accessibility information, readable lines on screen become marks', () => {
    const marks = marksFromOcr([
      { text: 'File  Edit  View', x0: 10, y0: 5, x1: 200, y1: 25, confidence: 91 },
      { text: '~~', x0: 0, y0: 0, x1: 4, y1: 4, confidence: 20 },
      { text: 'Start game', x0: 600, y0: 400, x1: 720, y1: 430, confidence: 88 },
    ], { width: 1280, height: 800 });
    expect(marks.map((m) => [m.ref, m.role, m.name])).toEqual([[1, 'text', 'File Edit View'], [2, 'text', 'Start game']]);
  });
});

// ---------------------------------------------------------------- workflows that run by themselves

describe('scheduled and triggered workflows', () => {
  const day = (h: number, d = 2) => new Date(2026, 10, d, h, 0, 0).getTime(); // Mon 2 Nov 2026
  const base = (x: Partial<WorkflowSchedule>): WorkflowSchedule => ({ id: 's', workflowId: 'w', trigger: 'schedule', values: {}, visible: false, enabled: true, created: day(8, 1), ...x });

  it('reads plain words and cron lines, and says what it will do', () => {
    expect(describeSchedule({ trigger: 'schedule', when: 'every monday at 9' })).toBe('every Mon at 09:00');
    expect(describeSchedule({ trigger: 'schedule', when: '0 9 1 * *' })).toBe('cron 0 9 1 * *');
    expect(describeSchedule({ trigger: 'wake' })).toBe('When the computer wakes');
    expect(() => describeSchedule({ trigger: 'schedule', when: 'whenever' })).toThrow(/does not understand/);
  });

  it('is due once its time has come, and a missed run runs once', () => {
    const s = base({ when: 'every monday at 9' });
    expect(dueSchedules([s], day(8))).toEqual([]);
    expect(dueSchedules([s], day(10))).toEqual([s]);
    expect(dueSchedules([{ ...s, lastRun: day(9) }], day(10))).toEqual([]);
    expect(dueSchedules([{ ...s, enabled: false }], day(10))).toEqual([]);
    expect(wakeIn([s], day(8))).toBe(3_600_000);
  });

  it('launch and wake triggers', () => {
    const a = base({ id: 'a', trigger: 'launch' });
    const b = base({ id: 'b', trigger: 'wake' });
    expect(triggeredBy([a, b], 'wake')).toEqual([b]);
    expect(dueSchedules([a, b], day(23))).toEqual([]);
  });
});
