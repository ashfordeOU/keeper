// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The AI services' own computer-use tools, mapped onto Keeper's one action
// vocabulary (core/computer.ts), so every model drives the screen under the
// same rules, the same Stop and the same log:
//
//   - OpenAI's computer tool in the Responses API: `{ type: "computer" }`
//     (GPT-5.4 and later), or `computer_use_preview` with a display size for
//     the older computer-use-preview model. The model answers with
//     `computer_call` items holding a batch of `actions` (or one `action` in
//     the preview); Keeper answers each with a `computer_call_output` holding
//     a screenshot, and acknowledges `pending_safety_checks` only after the
//     person said yes.
//   - Google Gemini's computer-use tool in generateContent:
//     `{ computer_use: { environment: "ENVIRONMENT_DESKTOP" } }` (Gemini 3.5
//     and later; Gemini 3 Flash and the 2.5 preview use the older names such
//     as click_at). Coordinates come on a 0–999 grid; a call whose
//     `safety_decision` says require_confirmation waits for the person, and
//     the answer then carries `safety_acknowledgement: "true"`.
//
// Sources: developers.openai.com/api/docs/guides/tools-computer-use,
// ai.google.dev/gemini-api/docs/computer-use (checked October 2026).

import { fromOpenAi, type ComputerAction } from '../computer';

// ---------------------------------------------------------------- OpenAI

/** 'ga' takes { type: "computer" }; 'preview' takes computer_use_preview with a display size; null: no built-in computer tool. */
export function openAiComputerKind(model: string): 'ga' | 'preview' | null {
  const m = model.toLowerCase();
  if (/computer-use-preview/.test(m)) return 'preview';
  const g = m.match(/gpt-(\d+)(?:\.(\d+))?/);
  if (!g) return null;
  const major = Number(g[1]);
  const minor = Number(g[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 4) ? 'ga' : null;
}

export function openAiComputerToolFor(model: string, size: { width: number; height: number }, environment = 'linux'): Record<string, unknown> | null {
  const k = openAiComputerKind(model);
  if (k === 'ga') return { type: 'computer' };
  if (k === 'preview') return { type: 'computer_use_preview', display_width: size.width, display_height: size.height, environment };
  return null;
}

export interface OpenAiSafetyCheck {
  id: string;
  code?: string;
  message?: string;
}

/** What a computer_call carries, as the arguments of a call to Keeper's computer tool. */
export interface OpenAiNativeArgs {
  openai_actions: Record<string, unknown>[];
  pending_safety_checks?: OpenAiSafetyCheck[];
}

/** A `computer_call` output item → arguments for Keeper's computer tool. */
export function openAiCallArgs(item: { action?: Record<string, unknown>; actions?: Record<string, unknown>[]; pending_safety_checks?: OpenAiSafetyCheck[] }): OpenAiNativeArgs {
  const actions = item.actions ?? (item.action ? [item.action] : []);
  return { openai_actions: actions, ...(item.pending_safety_checks?.length ? { pending_safety_checks: item.pending_safety_checks } : {}) };
}

/** The answer to a computer_call: the screen after its actions, with the checks the person approved. */
export function openAiCallOutputItem(callId: string, image: { mime: string; data: string } | undefined, acknowledged?: OpenAiSafetyCheck[]): Record<string, unknown> {
  return {
    type: 'computer_call_output',
    call_id: callId,
    output: { type: 'computer_screenshot', image_url: `data:${image?.mime ?? 'image/png'};base64,${image?.data ?? BLANK_PNG}`, detail: 'original' },
    ...(acknowledged?.length ? { acknowledged_safety_checks: acknowledged } : {}),
  };
}

/** The OpenAI actions in Keeper's vocabulary. */
export function openAiActions(args: OpenAiNativeArgs): ComputerAction[] {
  return fromOpenAi(args.openai_actions as unknown as Parameters<typeof fromOpenAi>[0]);
}

// ---------------------------------------------------------------- Gemini

/** Gemini models with the computer-use tool: 3.5 and later, Gemini 4, and the named computer-use previews. */
export function geminiComputerKind(model: string): 'current' | 'legacy' | null {
  const m = model.toLowerCase();
  if (/computer-use/.test(m)) return 'legacy';
  const g = m.match(/gemini-(\d+)(?:\.(\d+))?/);
  if (!g) return /gemini-.*-latest/.test(m) ? 'current' : null;
  const major = Number(g[1]);
  const minor = Number(g[2] ?? 0);
  if (major > 3 || (major === 3 && minor >= 5)) return 'current';
  if (major === 3 && /flash/.test(m)) return 'legacy';
  return null;
}

/** Functions that only make sense in a browser, and key down/up (Keeper presses keys whole): left out on the desktop. */
export const GEMINI_DESKTOP_EXCLUDED = ['key_down', 'key_up'];

export function geminiComputerTool(environment: 'desktop' | 'browser' = 'desktop'): Record<string, unknown> {
  return {
    computer_use: {
      environment: environment === 'desktop' ? 'ENVIRONMENT_DESKTOP' : 'ENVIRONMENT_BROWSER',
      enable_prompt_injection_detection: true,
      ...(environment === 'desktop' ? { excluded_predefined_functions: GEMINI_DESKTOP_EXCLUDED } : {}),
    },
  };
}

/** Every predefined function name, new and older. */
export const GEMINI_FUNCTIONS = new Set([
  'click', 'double_click', 'triple_click', 'middle_click', 'right_click', 'mouse_down', 'mouse_up', 'move', 'type', 'drag_and_drop', 'wait',
  'press_key', 'key_down', 'key_up', 'hotkey', 'take_screenshot', 'scroll', 'open_web_browser', 'navigate', 'go_back', 'go_forward', 'open_app', 'list_apps', 'long_press',
  // Gemini 3 Flash and the 2.5 computer-use preview
  'wait_5_seconds', 'search', 'click_at', 'hover_at', 'type_text_at', 'key_combination', 'scroll_document', 'scroll_at',
]);

/** Is this one of the computer-use tool's functions? */
export function fromGeminiCallName(name: string): boolean {
  return GEMINI_FUNCTIONS.has(name);
}

export interface GeminiSafety {
  decision?: string;
  explanation?: string;
}

/** Does this call wait for the person? */
export function geminiNeedsConfirmation(args: Record<string, unknown>): GeminiSafety | undefined {
  const s = args.safety_decision as GeminiSafety | undefined;
  return s && /require_confirmation/i.test(String(s.decision ?? '')) ? s : undefined;
}

/** Blocked by the model's own safety service: never run. */
export function geminiBlocked(args: Record<string, unknown>): GeminiSafety | undefined {
  const s = args.safety_decision as GeminiSafety | undefined;
  return s && /block/i.test(String(s.decision ?? '')) ? s : undefined;
}

const GKEY: Record<string, string> = {
  enter: 'Return', return: 'Return', escape: 'Escape', esc: 'Escape', space: 'space', backspace: 'BackSpace', delete: 'Delete', tab: 'Tab',
  control: 'ctrl', ctrl: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift', meta: 'cmd', command: 'cmd', cmd: 'cmd', super: 'super', win: 'super', windows: 'super',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  pageup: 'Page_Up', pagedown: 'Page_Down', home: 'Home', end: 'End',
};
const gkey = (k: string) => GKEY[k.trim().toLowerCase()] ?? (k.trim().length === 1 ? k.trim().toLowerCase() : k.trim());

/**
 * One Gemini function call → Keeper's actions. `size` is the screenshot the
 * model is looking at; its 0–999 grid is scaled onto it.
 */
export function fromGeminiCall(name: string, args: Record<string, unknown>, size: { width: number; height: number }): ComputerAction[] {
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v));
  const px = (v: unknown) => Math.round((Math.max(0, Math.min(999, n(v))) / 1000) * size.width);
  const py = (v: unknown) => Math.round((Math.max(0, Math.min(999, n(v))) / 1000) * size.height);
  const has = (k: string) => args[k] !== undefined && args[k] !== null && Number.isFinite(n(args[k]));
  const at = has('x') && has('y') ? { x: px(args.x), y: py(args.y) } : {};
  const scroll = (dir: string, magnitude: number, xy: { x?: number; y?: number }): ComputerAction => {
    const notches = Math.max(1, Math.round(magnitude / 100));
    const d = dir.toLowerCase();
    return { type: 'scroll', ...xy, dx: d === 'left' ? -notches : d === 'right' ? notches : 0, dy: d === 'up' ? -notches : d === 'down' ? notches : 0 };
  };
  switch (name) {
    case 'click': case 'click_at': return [{ type: 'click', button: 'left', count: 1, ...at }];
    case 'double_click': return [{ type: 'click', button: 'left', count: 2, ...at }];
    case 'triple_click': return [{ type: 'click', button: 'left', count: 3, ...at }];
    case 'middle_click': return [{ type: 'click', button: 'middle', count: 1, ...at }];
    case 'right_click': return [{ type: 'click', button: 'right', count: 1, ...at }];
    case 'long_press': return [...(has('x') ? [{ type: 'move', x: px(args.x), y: py(args.y) } as ComputerAction] : []), { type: 'mouse_down', button: 'left' }, { type: 'wait', seconds: Math.min(10, n(args.seconds ?? 2)) }, { type: 'mouse_up', button: 'left' }];
    case 'move': case 'hover_at': return [{ type: 'move', x: px(args.x), y: py(args.y) }];
    case 'mouse_down': case 'mouse_up': return [...(has('x') ? [{ type: 'move', x: px(args.x), y: py(args.y) } as ComputerAction] : []), { type: name, button: 'left' }];
    case 'type': case 'type_text_at': {
      const out: ComputerAction[] = [];
      if (has('x') && has('y')) out.push({ type: 'click', button: 'left', count: 1, x: px(args.x), y: py(args.y) });
      if (args.clear_before_typing === true) out.push({ type: 'key', keys: 'ctrl+a' }, { type: 'key', keys: 'Delete' });
      out.push({ type: 'type', text: String(args.text ?? '') });
      if (args.press_enter === true) out.push({ type: 'key', keys: 'Return' });
      return out;
    }
    case 'drag_and_drop': {
      const sx = args.start_x ?? args.x, sy = args.start_y ?? args.y, ex = args.end_x ?? args.destination_x, ey = args.end_y ?? args.destination_y;
      return [{ type: 'drag', path: [[px(sx), py(sy)], [px(ex), py(ey)]] }];
    }
    case 'wait': return [{ type: 'wait', seconds: Math.max(0.2, Math.min(30, n(args.seconds ?? 1))) }];
    case 'wait_5_seconds': return [{ type: 'wait', seconds: 5 }];
    case 'press_key': return [{ type: 'key', keys: gkey(String(args.key ?? 'Enter')) }];
    case 'hotkey': {
      const keys = Array.isArray(args.keys) ? args.keys.map(String) : String(args.keys ?? '').split('+');
      return [{ type: 'key', keys: keys.map(gkey).join('+') }];
    }
    case 'key_combination': return [{ type: 'key', keys: String(args.keys ?? '').split('+').map(gkey).join('+') }];
    case 'take_screenshot': return [{ type: 'screenshot' }];
    case 'scroll': return [scroll(String(args.direction ?? 'down'), n(args.magnitude_in_pixels ?? args.magnitude ?? 300), at)];
    case 'scroll_document': return [scroll(String(args.direction ?? 'down'), 500, {})];
    case 'scroll_at': return [scroll(String(args.direction ?? 'down'), n(args.magnitude ?? 300) * (size.height / 1000), at)];
    case 'navigate': return [{ type: 'open', target: String(args.url ?? '') }];
    case 'search': return [{ type: 'open', target: 'https://duckduckgo.com/' }];
    case 'open_web_browser': return [{ type: 'open', target: 'https://duckduckgo.com/' }];
    case 'go_back': return [{ type: 'key', keys: 'alt+Left' }];
    case 'go_forward': return [{ type: 'key', keys: 'alt+Right' }];
    case 'open_app': return [{ type: 'open', target: String(args.app_name ?? '') }];
    case 'list_apps': return [{ type: 'list_windows' }];
    default: throw new Error(`Unknown computer action "${name}"`);
  }
}

/** The answer to one Gemini computer-use call. Pictures go inside the functionResponse, as the API asks. */
export function geminiResponsePart(name: string, text: string, images: { mime: string; data: string }[], o: { acknowledged?: boolean; error?: boolean; url?: string } = {}): Record<string, unknown> {
  return {
    functionResponse: {
      name,
      response: { ...(o.url ? { url: o.url } : {}), output: text, ...(o.error ? { error: text } : {}), ...(o.acknowledged ? { safety_acknowledgement: 'true' } : {}) },
      ...(images.length ? { parts: images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } })) } : {}),
    },
  };
}

// A 1×1 transparent PNG, for the rare answer with no picture (the screen could not be captured).
const BLANK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
