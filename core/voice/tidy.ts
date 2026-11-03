// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// What the recognizer heard → finished text. Removes fillers and false starts,
// honours "scratch that" and "no wait, …", carries out spoken commands
// ("new line", "comma", "all caps"), writes numbers, times, money, emails and
// links the usual way, closes brackets and quotes, applies the personal
// dictionary and snippets, adds paragraph breaks and sets the tone the app
// calls for. Pure and rule-based: the same words always give the same text.

import { formatAddresses, formatDates, formatNumbers, MONTHS, tidyTimes, WEEKDAYS } from './numbers';
import type { AppRule, DictEntry, Snippet, TextMode, Tone } from './types';

export interface TidyOptions {
  tone: Exclude<Tone, 'auto'>;
  mode: Exclude<TextMode, 'auto'>;
  commands: boolean;
  fillers: boolean;
  formatting: boolean;
  dictionary?: DictEntry[];
  snippets?: Snippet[];
  language?: string;
  /** pauses in the take (seconds from the start of each recognized piece), for paragraph breaks */
  pieces?: { start: number; end: number; text: string }[];
}

export interface TidyResult {
  text: string;
  /** what the rules did, for the review panel and tests */
  applied: string[];
  /** a snippet replaced the whole take */
  snippet?: string;
}

// ---------------------------------------------------------------- spoken commands

/** Marks put in place of commands so later steps don't touch them. */
const NL = '\u0001N\u0001';
const PARA = '\u0001P\u0001';
const TAB = '\u0001T\u0001';
const NOSPACE = '\u0001S\u0001';
const LIT_OPEN = '\u0002';
const LIT_CLOSE = '\u0003';

type Attach = 'left' | 'right' | 'both' | 'none';
interface Command { say: string[]; out: string; attach: Attach; group: 'punctuation' | 'symbols' | 'pairs' | 'structure' }

const C = (group: Command['group'], attach: Attach, out: string, ...say: string[]): Command => ({ say, out, attach, group });

/** Every spoken command, longest phrases first when matched. */
export const COMMANDS: Command[] = [
  // punctuation
  C('punctuation', 'left', '.', 'period', 'full stop', 'dot'),
  C('punctuation', 'left', ',', 'comma'),
  C('punctuation', 'left', '?', 'question mark'),
  C('punctuation', 'left', '!', 'exclamation mark', 'exclamation point', 'bang'),
  C('punctuation', 'left', ':', 'colon'),
  C('punctuation', 'left', ';', 'semicolon', 'semi colon'),
  C('punctuation', 'left', '…', 'ellipsis', 'dot dot dot'),
  C('punctuation', 'none', ' — ', 'em dash', 'long dash'),
  C('punctuation', 'both', '-', 'hyphen'),
  C('punctuation', 'right', '-', 'dash'),
  C('punctuation', 'both', "'", 'apostrophe'),
  C('punctuation', 'left', '’s', 'apostrophe s'),
  C('punctuation', 'both', '/', 'slash', 'forward slash'),
  C('punctuation', 'both', '\\', 'backslash', 'back slash'),
  C('punctuation', 'both', '.', 'point'),
  // symbols
  C('symbols', 'both', '@', 'at sign'),
  C('symbols', 'right', '#', 'hash sign', 'hashtag', 'pound sign', 'number sign'),
  C('symbols', 'right', '$', 'dollar sign'),
  C('symbols', 'left', '%', 'percent sign'),
  C('symbols', 'none', '&', 'ampersand', 'and sign'),
  C('symbols', 'none', '*', 'asterisk', 'star sign'),
  C('symbols', 'none', '+', 'plus sign'),
  C('symbols', 'none', '=', 'equals sign', 'equal sign'),
  C('symbols', 'both', '_', 'underscore'),
  C('symbols', 'none', '|', 'pipe', 'vertical bar'),
  C('symbols', 'right', '~', 'tilde'),
  C('symbols', 'both', '^', 'caret'),
  C('symbols', 'both', '`', 'backtick', 'back tick'),
  C('symbols', 'none', '<', 'less than sign'),
  C('symbols', 'none', '>', 'greater than sign'),
  C('symbols', 'left', '°', 'degree sign', 'degrees sign'),
  C('symbols', 'none', '→', 'right arrow'),
  C('symbols', 'none', '←', 'left arrow'),
  C('symbols', 'left', '©', 'copyright sign'),
  C('symbols', 'left', '™', 'trademark sign'),
  // pairs and quotes
  C('pairs', 'right', '(', 'open paren', 'open parenthesis', 'left paren', 'open bracket round'),
  C('pairs', 'left', ')', 'close paren', 'close parenthesis', 'right paren'),
  C('pairs', 'right', '[', 'open bracket', 'open square bracket', 'left bracket'),
  C('pairs', 'left', ']', 'close bracket', 'close square bracket', 'right bracket'),
  C('pairs', 'right', '{', 'open brace', 'open curly brace', 'left brace'),
  C('pairs', 'left', '}', 'close brace', 'close curly brace', 'right brace'),
  C('pairs', 'right', '<', 'open angle bracket'),
  C('pairs', 'left', '>', 'close angle bracket'),
  C('pairs', 'right', '“', 'open quote', 'quote', 'begin quote', 'open quotes'),
  C('pairs', 'left', '”', 'close quote', 'end quote', 'unquote', 'close quotes'),
  C('pairs', 'right', '‘', 'open single quote'),
  C('pairs', 'left', '’', 'close single quote'),
  // structure
  C('structure', 'none', PARA, 'new paragraph', 'next paragraph'),
  C('structure', 'none', NL, 'new line', 'newline', 'next line', 'line break'),
  C('structure', 'none', TAB, 'tab key', 'press tab'),
  C('structure', 'none', NOSPACE, 'no space'),
  C('structure', 'none', ' ', 'space bar'),
];

/** Shown in the Dictation page's command list. */
export const COMMAND_TABLE = COMMANDS.map((c) => ({ say: c.say, out: c.out === NL ? '↵ new line' : c.out === PARA ? '¶ new paragraph' : c.out === TAB ? '⇥ tab' : c.out === NOSPACE ? '(joins words)' : c.out === ' ' ? '(space)' : c.out.trim(), group: c.group }));
export const CASE_COMMANDS = ['all caps … (until a pause or "end caps")', 'all caps on / all caps off', 'cap … (capitalise the next word)', 'no caps … (lowercase the next word)', 'camel case …', 'pascal case …', 'snake case …', 'kebab case …', 'literally … (the next word as said)', '… emoji (e.g. "thumbs up emoji")', 'scratch that / delete that', 'no wait / I mean / make that / or rather / correction'];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which commands apply in exact mode (shells and code): "dot" and "slash" join words there. */
function commandSet(mode: 'prose' | 'exact'): Command[] {
  return COMMANDS.filter((c) => mode === 'exact' || !['point'].includes(c.say[0]))
    .map((c) => (mode === 'exact' && c.say[0] === 'period' ? { ...c, say: ['period', 'full stop'] } : c))
    .concat(mode === 'exact' ? [C('punctuation', 'both', '.', 'dot')] : []);
}

function applyCommands(text: string, mode: 'prose' | 'exact', applied: string[]): string {
  const all = commandSet(mode).flatMap((c) => c.say.map((say) => ({ say, c }))).sort((a, b) => b.say.length - a.say.length);
  let t = text;
  for (const { say, c } of all) {
    // In prose, "dot" is only a command between words that look like a name ("index dot html"),
    // never on its own in a sentence; "dash" only before a letter (a flag).
    if (mode === 'prose' && (say === 'dot' || say === 'dash' || say === 'quote' || say === 'pipe' || say === 'bang')) continue;
    const re = new RegExp(`[,.]?\\s*(?<![\\p{L}\\p{N}${LIT_OPEN}])${escapeRe(say).replace(/ /g, '[\\s-]+')}(?![\\p{L}\\p{N}${LIT_CLOSE}])[,.]?`, 'giu');
    if (!re.test(t)) continue;
    re.lastIndex = 0;
    applied.push(`command:${say}`);
    const mark = c.attach === 'left' ? `\u0004L${c.out}` : c.attach === 'right' ? `${c.out}\u0004R` : c.attach === 'both' ? `\u0004L${c.out}\u0004R` : ` ${c.out} `;
    t = t.replace(re, ` ${mark} `);
  }
  return t;
}

function joinAttached(t: string): string {
  return t
    .replace(/\s*\u0004L/g, '')
    .replace(/\u0004R\s*/g, '')
    .replace(new RegExp(`\\s*${escapeRe(NOSPACE)}\\s*`, 'g'), '');
}

// ---------------------------------------------------------------- fillers, false starts, corrections

const FILLERS = /(^|[\s,])(?:u+m+|u+h+|e+r+m*|a+h+|h+m+|mm+|uh-huh)(?=[\s,.!?]|$)[,]?/gi;

export function removeFillers(text: string): string {
  let t = text.replace(FILLERS, '$1');
  // "you know," and "I mean," as fillers only when set off by commas
  t = t.replace(/,\s*(?:you know|i mean|like|sort of|kind of),\s*/gi, ', ').replace(/^(?:so,|well,|okay so,|like,)\s*/i, '');
  // stutters and repeated words: "I I think", "the the", "w- what"
  t = t.replace(/\b(\p{L}+)(?:[\s,]+\1\b)+/giu, (m, w: string) => (/^(very|really|no|bye|ha|that|had)$/i.test(w) ? m : w));
  t = t.replace(/\b\p{L}{1,3}-\s+(?=\p{L})/gu, (m, off: number, all: string) => (all.slice(off + m.length).toLowerCase().startsWith(m.slice(0, -2).trim().toLowerCase().replace(/-$/, '')) ? '' : m));
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/^[,\s]+/, '');
}

const SCRATCH = /[,.]?\s*\b(?:scratch that|delete that|strike that|forget that)\b[,.!]?/i;

/** "scratch that" throws away what came before it in the sentence (or the whole last sentence). */
export function applyScratch(text: string): string {
  let t = text;
  for (let guard = 0; guard < 20; guard++) {
    const m = SCRATCH.exec(t);
    if (!m) break;
    const before = t.slice(0, m.index).replace(/\s+$/, '');
    const after = t.slice(m.index + m[0].length).replace(/^\s+/, '');
    // the sentence or line being thrown away starts after the last end mark
    const cut = Math.max(before.search(/[.!?…\n\u0001][^.!?…\n\u0001]*$/), -1);
    const keep = cut >= 0 ? before.slice(0, cut + 1) : '';
    const trailing = cut >= 0 && /^[^.!?…\n\u0001]*$/.test(before.slice(cut + 1)) && !before.slice(cut + 1).trim() ? keep.replace(/[^.!?…\n\u0001]*[.!?…]$/, '') : keep;
    t = `${trailing}${trailing && after ? ' ' : ''}${after}`;
  }
  return t.trim();
}

const VALUE = new RegExp(`^(?:[$€£]?\\d[\\d,.:]*(?:%|st|nd|rd|th)?(?: (?:AM|PM))?|${[...WEEKDAYS, ...MONTHS].join('|')})$`, 'i');
const kindOf = (v: string) => (/^(?:\d{1,2}(?::\d{2})?(?: (?:AM|PM))|\d{1,2}:\d{2})$/i.test(v) ? 'time' : WEEKDAYS.some((d) => d.toLowerCase() === v.toLowerCase()) ? 'day' : MONTHS.some((d) => d.toLowerCase() === v.toLowerCase()) ? 'month' : /^[$€£]/.test(v) ? 'money' : /%$/.test(v) ? 'percent' : /\d(st|nd|rd|th)$/i.test(v) ? 'ordinal' : 'number');

/**
 * "at 3 PM, no wait, 4 PM" → "at 4 PM"; "on Tuesday I mean Wednesday" → "on Wednesday".
 * Only when the thing before and after the cue are the same kind of value.
 */
export function applyCorrections(text: string): string {
  const cue = '(?:no wait|no,? wait|wait no|i mean|make that|or rather|correction|sorry|actually)';
  const val = `((?:[$€£]?\\d[\\d,.:]*(?:%|st|nd|rd|th)?(?: (?:AM|PM))?)|${[...WEEKDAYS, ...MONTHS].join('|')})`;
  const re = new RegExp(`${val}[,.]?\\s+${cue}[,.]?\\s+${val}`, 'gi');
  return text.replace(re, (m, a: string, b: string) => (VALUE.test(a) && VALUE.test(b) && (kindOf(a) === kindOf(b) || (kindOf(a) === 'number' && kindOf(b) !== 'day' && kindOf(b) !== 'month')) ? b : m));
}

// ---------------------------------------------------------------- case commands, literal words, emoji

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''));

export function applyCaseCommands(text: string, applied: string[]): string {
  let t = text;
  const span = '((?:[\\p{L}\\p{N}\']+[ ]?){1,8}?)(?=[,.;:!?\\n\\u0001]|\\s*\\bend (?:case|caps)\\b|$)';
  const caseRe = (name: string) => new RegExp(`\\b${name}\\s+${span}(?:\\s*\\bend (?:case|caps)\\b)?`, 'giu');
  const conv: [string, (ws: string[]) => string][] = [
    ['camel case', (ws) => ws.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('')],
    ['pascal case', (ws) => ws.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')],
    ['snake case', (ws) => ws.map((w) => w.toLowerCase()).join('_')],
    ['kebab case', (ws) => ws.map((w) => w.toLowerCase()).join('-')],
    ['(?:screaming snake case|constant case)', (ws) => ws.map((w) => w.toUpperCase()).join('_')],
  ];
  for (const [name, fn] of conv) {
    t = t.replace(caseRe(name), (_m, span: string) => { applied.push(`case:${name}`); const ws = words(span).filter(Boolean); return ws.length ? fn(ws) : ''; });
  }
  // all caps on … all caps off
  t = t.replace(/\ball caps on\b[,.]?\s*([\s\S]*?)(?:\s*[,.]?\s*\ball caps off\b[,.]?|$)/gi, (_m, s: string) => { applied.push('case:all caps'); return s.toUpperCase(); });
  t = t.replace(caseRe('all caps'), (_m, s: string) => { applied.push('case:all caps'); return s.trim().toUpperCase(); });
  t = t.replace(/\b(?:cap|capital)\s+(\p{L})/giu, (_m, c: string) => c.toUpperCase());
  t = t.replace(/\bno caps\s+(\p{L}+)/giu, (_m, w: string) => w.toLowerCase());
  return t;
}

/** "literally comma" types the word "comma": protected from every later rule. */
function protectLiteral(text: string): string {
  return text.replace(/\bliterally\s+([\p{L}\p{N}'’-]+(?:\s+(?:mark|sign|line|paragraph|quote|caps|case|that|point))?)/giu, (_m, w: string) => `${LIT_OPEN}${w}${LIT_CLOSE}`);
}

/** Emoji by name: "thumbs up emoji" → 👍. */
export const EMOJI: Record<string, string> = {
  'smiley face': '😊', smile: '😊', smiley: '😃', grin: '😁', 'grinning face': '😀', laugh: '😂', laughing: '😂', 'crying laughing': '😂', 'rolling on the floor': '🤣', wink: '😉', 'winking face': '😉',
  blush: '😊', 'heart eyes': '😍', 'kissing face': '😘', kiss: '😘', 'thinking face': '🤔', thinking: '🤔', 'shrug': '🤷', facepalm: '🤦', 'face palm': '🤦', 'eye roll': '🙄', 'rolling eyes': '🙄',
  'sad face': '😢', sad: '😢', crying: '😭', cry: '😭', angry: '😠', 'angry face': '😠', rage: '😡', 'mind blown': '🤯', 'exploding head': '🤯', shocked: '😮', 'surprised face': '😮', scream: '😱',
  cool: '😎', sunglasses: '😎', 'nerd face': '🤓', 'upside down face': '🙃', 'slightly smiling': '🙂', 'neutral face': '😐', 'zipper mouth': '🤐', sleepy: '😴', sleeping: '😴', 'sick': '🤒', 'party face': '🥳', partying: '🥳',
  'pleading face': '🥺', 'hugging face': '🤗', hug: '🤗', 'sweat smile': '😅', 'grimacing': '😬', 'grimace': '😬', 'relieved': '😌', 'yum': '😋', 'skull': '💀', 'ghost': '👻', 'clown': '🤡', 'robot': '🤖', 'alien': '👽', 'poop': '💩',
  'thumbs up': '👍', 'thumbs down': '👎', 'ok hand': '👌', 'clap': '👏', clapping: '👏', 'wave': '👋', waving: '👋', 'raised hands': '🙌', 'pray': '🙏', 'praying hands': '🙏', 'folded hands': '🙏', 'muscle': '💪', flex: '💪',
  'fingers crossed': '🤞', 'victory': '✌️', 'peace sign': '✌️', 'point up': '☝️', 'point right': '👉', 'point left': '👈', 'point down': '👇', 'eyes': '👀', 'brain': '🧠', 'handshake': '🤝', 'writing hand': '✍️', 'salute': '🫡',
  heart: '❤️', 'red heart': '❤️', 'broken heart': '💔', 'blue heart': '💙', 'green heart': '💚', 'yellow heart': '💛', 'purple heart': '💜', 'black heart': '🖤', 'sparkling heart': '💖', 'two hearts': '💕',
  fire: '🔥', 'hundred': '💯', '100': '💯', 'sparkles': '✨', star: '⭐', 'glowing star': '🌟', 'party popper': '🎉', tada: '🎉', party: '🎉', confetti: '🎊', 'balloon': '🎈', gift: '🎁', 'trophy': '🏆', 'medal': '🏅', 'crown': '👑',
  rocket: '🚀', 'light bulb': '💡', lightbulb: '💡', bulb: '💡', 'check mark': '✅', checkmark: '✅', 'green check': '✅', 'cross mark': '❌', 'red x': '❌', warning: '⚠️', 'stop sign': '🛑', 'no entry': '⛔', question: '❓', exclamation: '❗',
  'sun': '☀️', 'sunny': '☀️', 'cloud': '☁️', 'rain': '🌧️', 'umbrella': '☔', 'snowflake': '❄️', 'lightning': '⚡', 'zap': '⚡', 'rainbow': '🌈', 'moon': '🌙', 'earth': '🌍', 'globe': '🌍', 'tree': '🌳', 'flower': '🌸', 'rose': '🌹', 'four leaf clover': '🍀',
  coffee: '☕', tea: '🍵', beer: '🍺', cheers: '🍻', wine: '🍷', 'champagne': '🍾', pizza: '🍕', burger: '🍔', taco: '🌮', cake: '🍰', 'birthday cake': '🎂', cookie: '🍪', 'apple': '🍎', avocado: '🥑', popcorn: '🍿',
  dog: '🐶', cat: '🐱', 'unicorn': '🦄', 'monkey': '🐵', 'see no evil': '🙈', 'snake': '🐍', 'bug': '🐛', 'turtle': '🐢', 'penguin': '🐧', 'fox': '🦊', 'panda': '🐼', 'bee': '🐝', 'butterfly': '🦋', 'whale': '🐳', 'octopus': '🐙',
  laptop: '💻', computer: '💻', phone: '📱', 'calendar': '📅', 'memo': '📝', 'note': '📝', 'pin': '📌', 'pushpin': '📌', 'paperclip': '📎', 'lock': '🔒', 'key': '🔑', 'hammer': '🔨', 'wrench': '🔧', 'gear': '⚙️', 'package': '📦', 'mailbox': '📫', 'email': '📧', 'bell': '🔔', 'money': '💰', 'money bag': '💰', 'chart': '📈', 'chart up': '📈', 'chart down': '📉', 'hourglass': '⏳', 'alarm clock': '⏰', 'stopwatch': '⏱️', 'magnifying glass': '🔍', 'link': '🔗', 'books': '📚', 'book': '📖', 'graduation cap': '🎓', 'music': '🎵', 'headphones': '🎧', 'microphone': '🎤', 'camera': '📷', 'movie': '🎬', 'video game': '🎮', 'soccer ball': '⚽', 'basketball': '🏀', 'car': '🚗', 'airplane': '✈️', 'plane': '✈️', 'house': '🏠', 'bomb': '💣', 'boom': '💥', 'zzz': '💤', 'sweat drops': '💦', 'dash away': '💨', 'speech bubble': '💬', 'thought bubble': '💭', 'wave hand': '👋', 'flag': '🚩', 'red flag': '🚩', 'white flag': '🏳️', 'infinity': '♾️', 'recycle': '♻️', 'peace': '☮️',
};

export function applyEmoji(text: string, applied: string[]): string {
  const names = Object.keys(EMOJI).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  return text.replace(new RegExp(`[,.]?\\s*\\b(${names})\\s+emoji\\b[,.]?`, 'gi'), (_m, n: string) => { applied.push(`emoji:${n.toLowerCase()}`); return ` ${EMOJI[n.toLowerCase()]}`; });
}

// ---------------------------------------------------------------- dictionary and snippets

/** Fixes words the recognizer writes wrongly, and spells listed words the person's way. */
export function applyDictionary(text: string, dict: DictEntry[], lang?: string, applied: string[] = []): string {
  let t = text;
  for (const e of dict) {
    if (e.suggested) continue;
    if (e.lang && lang && e.lang !== lang.split('-')[0]) continue;
    const forms = [...(e.heard ?? [])];
    // a word with capitals, digits or symbols in it is also put right when written in plain lowercase
    if (/[A-Z0-9.+#_-]/.test(e.word.slice(1)) || /^[A-Z]/.test(e.word)) forms.push(e.word);
    for (const f of forms) {
      if (!f.trim()) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(f.trim()).replace(/\s+/g, '[\\s-]+')}(?![\\p{L}\\p{N}])`, 'giu');
      t = t.replace(re, (m) => { if (m !== e.word) applied.push(`dictionary:${e.word}`); return e.word; });
    }
  }
  return t;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/** Edit distance, for loose snippet matching. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** The snippet a take asks for: the whole take is its trigger (said a little differently is fine), or "snippet <trigger>". */
export function matchSnippet(text: string, snippets: Snippet[]): Snippet | undefined {
  const said = norm(text).replace(/^(?:insert |paste )?(?:snippet |the snippet )/, '');
  let best: { s: Snippet; d: number } | undefined;
  for (const s of snippets) {
    const trig = norm(s.trigger);
    if (!trig) continue;
    const d = distance(said, trig);
    if (d <= Math.max(1, Math.floor(trig.length * 0.2)) && (!best || d < best.d)) best = { s, d };
  }
  return best?.s;
}

/** Snippets said inside a sentence: "… and my address is snippet home address". */
function inlineSnippets(text: string, snippets: Snippet[], applied: string[]): string {
  let t = text;
  for (const s of snippets) {
    // Typed-only snippets have nothing to say.
    if (!norm(s.trigger)) continue;
    const re = new RegExp(`\\b(?:insert )?snippet\\s+${escapeRe(norm(s.trigger)).replace(/ /g, '[\\s,.-]+')}\\b[.,]?`, 'gi');
    t = t.replace(re, () => { applied.push(`snippet:${s.trigger}`); return `${LIT_OPEN}${s.text}${LIT_CLOSE}`; });
  }
  return t;
}

// ---------------------------------------------------------------- tone, spacing, paragraphs

const PRO: [RegExp, string][] = [
  [/\bgonna\b/gi, 'going to'], [/\bwanna\b/gi, 'want to'], [/\bgotta\b/gi, 'have to'], [/\bkinda\b/gi, 'kind of'], [/\bsorta\b/gi, 'sort of'],
  [/\byeah\b/gi, 'yes'], [/\byep\b/gi, 'yes'], [/\bnope\b/gi, 'no'], [/\bok\b/gi, 'OK'], [/\bokay\b/gi, 'OK'], [/\bthx\b/gi, 'thanks'], [/\bu\b/g, 'you'],
];

function sentenceCase(t: string): string {
  return t
    .replace(/^(\s*["“‘(]?)(\p{Ll})/u, (_m, a: string, c: string) => a + c.toUpperCase())
    .replace(/([.!?…]\s+["“‘(]?|\n\s*)(\p{Ll})/gu, (_m, a: string, c: string) => a + c.toUpperCase())
    .replace(/\bi\b(?=[\s,.'’!?]|$)/g, 'I');
}

/** Opens a bracket or quote and never closes it? Close it at the end. */
export function closePairs(t: string): string {
  const pairs: [string, string][] = [['(', ')'], ['[', ']'], ['{', '}'], ['“', '”']];
  let out = t;
  for (const [o, c] of pairs) {
    const opens = out.split(o).length - 1;
    const closes = out.split(c).length - 1;
    if (opens > closes) out = out.replace(/([.!?…]?)\s*$/, (_m, p: string) => c.repeat(opens - closes) + p);
  }
  return out;
}

const TRANSITIONS = /^(?:also|anyway|anyhow|next|secondly|second|thirdly|third|finally|lastly|another thing|on another note|moving on|separately|in other news|meanwhile|besides|by the way|oh and|one more thing)\b/i;

/** Long takes get paragraph breaks at long pauses and at topic changes. */
export function paragraphs(text: string, pieces?: TidyOptions['pieces']): string {
  if (text.includes('\n\n')) return text;
  const sentences = text.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const wordCount = text.split(/\s+/).length;
  if (sentences.length < 4 || wordCount < 40) return text;
  // where long pauses fell, by the words before them
  const breaksAfter = new Set<string>();
  if (pieces) for (let i = 1; i < pieces.length; i++) if (pieces[i].start - pieces[i - 1].end >= 1.6) breaksAfter.add(norm(pieces[i - 1].text).split(' ').slice(-3).join(' '));
  const out: string[] = [];
  let sinceBreak = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const prevEnd = i ? norm(sentences[i - 1]).split(' ').slice(-3).join(' ') : '';
    const topic = i > 0 && sinceBreak >= 2 && (TRANSITIONS.test(s) || breaksAfter.has(prevEnd));
    if (topic || sinceBreak >= 6) { out.push('\n\n'); sinceBreak = 0; } else if (i) out.push(' ');
    out.push(s);
    sinceBreak++;
  }
  return out.join('');
}

function spacing(t: string): string {
  return t
    .replace(/[ \t]+([.,;:!?…%)\]}”’])/g, '$1')
    .replace(/([(\[{“‘])[ \t]+/g, '$1')
    .replace(/([,;:])(?=[\p{L}\p{N}])/gu, '$1 ')
    .replace(/([.!?])(?=[\p{Lu}])/gu, '$1 ')
    .replace(/([,;:.])[,;:.]+/g, (m, first: string) => (m.includes('.') && first !== '.' ? '.' : first))
    .replace(/\.\s*([?!])/g, '$1')
    .replace(/([?!])\s*\1+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n');
}

/** The tone and rules for the app in front. Rules are matched by app name, the most specific first. */
export function ruleFor(app: string | undefined, rules: AppRule[]): AppRule | undefined {
  if (!app) return undefined;
  const a = app.toLowerCase().replace(/\.(app|exe)$/, '');
  return [...rules].sort((x, y) => y.app.length - x.app.length).find((r) => a === r.app.toLowerCase() || a.includes(r.app.toLowerCase()));
}

const TERMINALISH = /terminal|iterm|konsole|alacritty|kitty|wezterm|warp|tilix|xterm|hyper|ghostty|powershell|cmd\.exe|windowsterminal|conhost|tabby/i;
const EDITORISH = /^code$|vscodium|cursor|zed|sublime|xcode|intellij|pycharm|webstorm|goland|clion|rider|android studio|neovim|vim|emacs|nova|fleet|windsurf|textmate|bbedit|notepad\+\+|gedit|kate/i;

export function appKind(app?: string): 'terminal' | 'editor' | 'other' {
  if (!app) return 'other';
  if (TERMINALISH.test(app)) return 'terminal';
  if (EDITORISH.test(app)) return 'editor';
  return 'other';
}

/** The settings that apply in an app, with "auto" worked out. */
export function resolveRules(app: string | undefined, rules: AppRule[], base: { tone: Tone; commands: 'everywhere' | 'editors' | 'off' }): { tone: Exclude<Tone, 'auto'>; mode: 'prose' | 'exact'; commands: boolean; rule?: AppRule } {
  const rule = ruleFor(app, rules);
  const kind = appKind(app);
  const tone = (rule?.tone && rule.tone !== 'auto' ? rule.tone : base.tone !== 'auto' ? base.tone : kind === 'terminal' ? 'verbatim' : 'neutral') as Exclude<Tone, 'auto'>;
  const mode = rule?.mode && rule.mode !== 'auto' ? rule.mode : kind === 'terminal' ? 'exact' : 'prose';
  const commands = rule?.commands ?? (base.commands === 'everywhere' || (base.commands === 'editors' && kind !== 'other'));
  return { tone, mode, commands, rule };
}

/** Whisper's notes about the sound, not words: "[BLANK_AUDIO]", "(music)", "♪". */
export function stripArtifacts(t: string): string {
  return t.replace(/\[(?:BLANK_AUDIO|MUSIC|NOISE|SOUND|silence|inaudible)[^\]]*\]|\((?:music|applause|laughs?|laughter|silence|inaudible|noise|coughs?|sighs?)[^)]*\)|[♪♫]+/gi, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** The whole tidy-up. */
export function tidy(raw: string, o: TidyOptions): TidyResult {
  const applied: string[] = [];
  let t = stripArtifacts(raw);
  if (!t) return { text: '', applied };
  if (o.snippets?.length) {
    const s = matchSnippet(t, o.snippets);
    if (s) return { text: s.text, applied: [`snippet:${s.trigger}`], snippet: s.id };
    t = inlineSnippets(t, o.snippets, applied);
  }
  t = protectLiteral(t);
  if (o.commands) t = applyCommands(t, o.mode, applied);
  t = applyScratch(t);
  if (o.fillers && o.tone !== 'verbatim') t = removeFillers(t);
  if (o.formatting && o.mode === 'prose') {
    t = formatNumbers(t);
    t = tidyTimes(t);
    t = formatDates(t);
  }
  if (o.formatting) t = formatAddresses(t);
  t = applyCorrections(t);
  if (o.commands) t = applyCaseCommands(t, applied);
  t = applyEmoji(t, applied);
  if (o.dictionary?.length) t = applyDictionary(t, o.dictionary, o.language, applied);
  t = joinAttached(t);
  t = t.replace(new RegExp(`\\s*${escapeRe(PARA)}\\s*`, 'g'), '\n\n').replace(new RegExp(`\\s*${escapeRe(NL)}\\s*`, 'g'), '\n').replace(new RegExp(`\\s*${escapeRe(TAB)}\\s*`, 'g'), '\t');
  t = t.replace(new RegExp(`[${LIT_OPEN}${LIT_CLOSE}]`, 'g'), '');
  t = spacing(t).trim();
  if (o.mode === 'exact') {
    // shells and code: no capitals added, no closing full stop, exactly the words
    t = t.replace(/[.]$/, '');
    if (/^[A-Z][a-z]/.test(t) && !/^[A-Z][a-z]+[A-Z]/.test(t) && !/^\p{Lu}[\p{Ll}]* \p{Lu}/u.test(t)) t = t[0].toLowerCase() + t.slice(1);
    return { text: t, applied };
  }
  if (o.tone === 'professional') for (const [re, s] of PRO) t = t.replace(re, s);
  if (o.tone !== 'verbatim') {
    t = sentenceCase(t);
    t = closePairs(t);
    if (o.tone === 'casual') {
      // one short message: no full stop at the end, the way people text
      if (!/[.!?…][^.!?…]+[.!?…]?$/.test(t.replace(/[.]$/, '')) && t.length < 120) t = t.replace(/\.$/, '');
    } else if (/[\p{L}\p{N})”]$/u.test(t) && t.split(/\s+/).length > 3 && !t.includes('\n')) t += '.';
    t = paragraphs(t, o.pieces);
  }
  return { text: t, applied };
}

// ---------------------------------------------------------------- learning from corrections

/**
 * Compares what was typed with what the person corrected it to. A word
 * swapped for another becomes a suggestion; seen twice, it is offered for the
 * dictionary (never added without a yes).
 */
export function learnFromCorrection(dict: DictEntry[], before: string, after: string, newId: () => string): DictEntry[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  if (!a.length || !b.length || Math.abs(a.length - b.length) > 3) return dict;
  // longest common subsequence alignment, then 1-to-1 swaps between matches
  const n = a.length;
  const m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const eq = (x: string, y: string) => x.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() === y.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase() && x.replace(/[^\p{L}\p{N}]/gu, '') === y.replace(/[^\p{L}\p{N}]/gu, '');
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = eq(a[i], b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const swaps: [string, string][] = [];
  let i = 0;
  let j = 0;
  let ga: string[] = [];
  let gb: string[] = [];
  const flush = () => {
    if (ga.length && gb.length && ga.length <= 3 && gb.length <= 2) swaps.push([ga.join(' '), gb.join(' ')]);
    ga = [];
    gb = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && eq(a[i], b[j])) { flush(); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) gb.push(b[j++]);
    else ga.push(a[i++]);
  }
  flush();
  const clean = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, '');
  let out = dict.map((e) => ({ ...e }));
  for (const [hRaw, wRaw] of swaps) {
    const heard = clean(hRaw);
    const word = clean(wRaw);
    if (!heard || !word || heard.toLowerCase() === word.toLowerCase() && heard === word) continue;
    const found = out.find((e) => e.word === word);
    if (found) {
      if (!(found.heard ?? []).some((h) => h.toLowerCase() === heard.toLowerCase())) found.heard = [...(found.heard ?? []), heard];
      found.uses = (found.uses ?? 0) + 1;
    } else out = [...out, { id: newId(), word, heard: [heard], uses: 1, suggested: true }];
  }
  return out;
}

/** Suggestions seen at least twice are offered; the rest wait. */
export const readySuggestions = (dict: DictEntry[]) => dict.filter((e) => e.suggested && (e.uses ?? 0) >= 2);

/** The words handed to the recognizer before it listens (spelling hints), most used first. */
export function dictionaryPrompt(dict: DictEntry[], lang?: string, max = 60): string {
  return dict
    .filter((e) => !e.suggested && (!e.lang || !lang || e.lang === lang.split('-')[0]))
    .sort((x, y) => (y.uses ?? 0) - (x.uses ?? 0))
    .slice(0, max)
    .map((e) => e.word)
    .join(', ');
}

export const wordCount = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
