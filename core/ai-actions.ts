// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// File actions powered by the assistant: suggest a name, summarize, turn
// receipts into a spreadsheet, describe an image, translate subtitles.
// Unlike the assistant's chat, these send the file's text (or the image) to the
// chosen provider — so the interface asks first, every time, and a local model
// keeps everything on the computer.

// The SDK is large: it loads the first time this provider is used.
import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MODELS, type AskOptions } from './ai';

export interface ImageInput {
  /** base64 without the data: prefix */
  data: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
}

/** One request, one answer. Images are passed to providers that can see them. */
export async function complete(system: string, prompt: string, opts: AskOptions, image?: ImageInput): Promise<string> {
  const model = opts.model || (image && opts.provider === 'ollama' ? 'llava' : DEFAULT_MODELS[opts.provider]);
  if (opts.provider === 'anthropic') {
    if (!opts.apiKey) throw new Error('Add your Anthropic API key in Settings → AI & Brain.');
    const client = new (await import('@anthropic-ai/sdk')).default({ apiKey: opts.apiKey });
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } });
    content.push({ type: 'text', text: prompt });
    const response = await client.beta.messages.create(
      { model, max_tokens: 16000, system, messages: [{ role: 'user', content }], output_config: { effort: 'low' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
      { signal: opts.signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('The assistant declined this request.');
    return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  }
  if (opts.provider === 'openai') {
    if (!opts.apiKey) throw new Error('Add your OpenAI API key in Settings → AI & Brain.');
    const user = image ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } }] : prompt;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: opts.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`OpenAI returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim() ?? '';
  }
  const base = (opts.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt, ...(image ? { images: [image.data] } : {}) }] }),
  }).catch(() => {
    throw new Error(`Could not reach the local model at ${base}. Is it running?`);
  });
  if (!res.ok) throw new Error(`Local model returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { message?: { content?: string } }).message?.content?.trim() ?? '';
}

// ---------------------------------------------------------------- prompts

const MAX_TEXT = 12_000;
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n[…cut]' : s);

export function namePrompt(file: { name: string; ext: string; mtime: number; text: string }): { system: string; prompt: string } {
  return {
    system: 'You name files. Reply with one file name only, without the extension, no quotes, no explanation. Use plain words a person would search for, 3 to 8 words, the most specific facts first (who/what, then date if it matters). Keep the language of the content.',
    prompt: `Current name: ${file.name}\nModified: ${new Date(file.mtime).toISOString().slice(0, 10)}\nContent:\n${clip(file.text) || '(no readable text)'}`,
  };
}

/** Cleans a suggested name: no extension, no illegal characters, sensible length. */
export function cleanSuggestedName(raw: string, ext: string): string {
  let n = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  n = n.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').replace(/^(file ?name|name)\s*:\s*/i, '');
  if (ext && n.toLowerCase().endsWith('.' + ext.toLowerCase())) n = n.slice(0, -(ext.length + 1));
  n = n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 120);
  return n ? (ext ? `${n}.${ext}` : n) : '';
}

export function summaryPrompt(name: string, text: string): { system: string; prompt: string } {
  return {
    system: 'Summarize documents for a busy person. Start with one sentence saying what this is. Then up to five short bullet points with the facts that matter (dates, amounts, names, deadlines, decisions). Plain text, no headings. Keep the language of the document.',
    prompt: `File: ${name}\n\n${clip(text)}`,
  };
}

export const RECEIPT_FIELDS = ['date', 'merchant', 'total', 'currency', 'tax', 'category', 'payment'] as const;

export function receiptPrompt(name: string, text: string): { system: string; prompt: string } {
  return {
    system: `You read receipts and invoices. Reply with one JSON object only, with these keys: ${RECEIPT_FIELDS.join(', ')}. date as YYYY-MM-DD; total and tax as numbers; currency as an ISO code like EUR or USD; category as one or two words (food, travel, software…); payment as card, cash or unknown. Use null for anything you cannot find. No prose.`,
    prompt: `File: ${name}\n\n${clip(text)}`,
  };
}

export function parseReceipt(raw: string, file: string): Record<string, string | number | null> {
  const m = raw.match(/\{[\s\S]*\}/);
  let d: Record<string, unknown> = {};
  try {
    d = m ? JSON.parse(m[0]) : {};
  } catch {
    d = {};
  }
  const out: Record<string, string | number | null> = { file };
  for (const k of RECEIPT_FIELDS) {
    const v = d[k];
    if (k === 'total' || k === 'tax') {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/[^\d.,-]/g, '').replace(/,(\d{2})$/, '.$1').replace(/,/g, '')) : NaN;
      out[k] = Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    } else if (k === 'date') {
      out[k] = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
    } else out[k] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null;
  }
  return out;
}

export const ALT_TEXT_PROMPT = {
  system: 'Write alt text for an image: one or two plain sentences describing what matters in it for someone who cannot see it. Include any important visible text. No “image of”.',
  prompt: 'Describe this image.',
};

// ---------------------------------------------------------------- subtitles

export interface Cue {
  index: number;
  timing: string;
  text: string;
}

/** Parses .srt or .vtt into cues, keeping the timing lines exactly as written. */
export function parseSubtitles(src: string): { header: string; cues: Cue[] } {
  const text = src.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const blocks = text.split(/\n{2,}/);
  let header = '';
  const cues: Cue[] = [];
  for (const b of blocks) {
    const lines = b.split('\n');
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) {
      if (!cues.length) header += (header ? '\n\n' : '') + b;
      continue;
    }
    cues.push({ index: cues.length + 1, timing: lines[ti], text: lines.slice(ti + 1).join('\n') });
  }
  return { header: header.trim(), cues };
}

export function buildSubtitles(header: string, cues: Cue[], vtt: boolean): string {
  const body = cues.map((c) => (vtt ? `${c.timing}\n${c.text}` : `${c.index}\n${c.timing}\n${c.text}`)).join('\n\n');
  return (vtt ? (header || 'WEBVTT') + '\n\n' : '') + body + '\n';
}

export function subtitlePrompt(language: string, cues: Cue[]): { system: string; prompt: string } {
  return {
    system: `Translate subtitle lines into ${language}. You get numbered lines "N: text". Reply with exactly the same numbers, one per line, as "N: translation". Keep line breaks inside a cue as " / ". Keep names, numbers and tags like <i> unchanged. No other text.`,
    prompt: cues.map((c) => `${c.index}: ${c.text.replace(/\n/g, ' / ')}`).join('\n'),
  };
}

/** Puts translated lines back onto the original cues; anything missing stays untranslated. */
export function applyTranslation(cues: Cue[], reply: string): Cue[] {
  const map = new Map<number, string>();
  for (const line of reply.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*[:.)]\s*(.*)$/);
    if (m) map.set(Number(m[1]), m[2].replace(/\s+\/\s+/g, '\n').trim());
  }
  return cues.map((c) => ({ ...c, text: map.get(c.index) || c.text }));
}
