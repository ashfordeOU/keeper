// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Runs an ability for whoever asks (Keeper's Assistant, an MCP client, the
// gateway, another agent): checks the person's permission, asks them when the
// setting is Ask, runs it, records any cost, and returns text the AI can cite.

import type { ChatProvider, ToolCall, ToolSpec } from '../brain/providers';
import type { AbilitiesSettings, ScheduledTask } from './config';
import { generateImages, editImage, imageFileName, IMAGE_PROVIDERS } from './images';
import { addMemory, removeMemory, searchMemories, type Memory } from './memory';
import { abilityPermission, offeredAbilities, untrusted, UNTRUSTED_NOTE, type CostEntry } from './policy';
import { abilitySpec, EXTERNAL_RUNNERS } from './registry';
import { DEPTH, deepResearch, reportMarkdown } from './research';
import { runSandboxed, type Runtimes } from './sandbox';
import { parseSchedule } from './schedule';
import { formatResults, webSearch, type SearchResult } from './search';
import { availableSources, formatPosts, socialSearch, type SocialSource } from './social';
import { fetchReadable } from './fetch';

export interface AbilityContext {
  settings: AbilitiesSettings;
  fetch: typeof fetch;
  /** secrets by name: 'search:brave', 'xai', 'images:openai', 'bluesky', … */
  key(name: string): Promise<string | undefined>;
  /** who is asking: 'assistant', an MCP client's name, 'gateway', an agent */
  client: string;
  persona?: string;
  project?: string;
  /** the AI on the other end runs on this computer */
  localModel: boolean;
  /** asks the person (Ask setting); resolves false when they decline */
  approve(name: string, summary: string, args: Record<string, unknown>): Promise<boolean>;
  /** the AI to use for research and other multi-step abilities */
  model(): Promise<ChatProvider>;
  allowed(path: string): boolean;
  readFile(path: string): Promise<Buffer>;
  askDocument(path: string, question: string): Promise<string>;
  ocr(path: string): Promise<string>;
  saveFile(kind: 'images' | 'research', name: string, data: Buffer | string): Promise<string>;
  memories: { get(): Memory[]; set(list: Memory[]): Promise<void> };
  addTask(t: ScheduledTask): Promise<void>;
  speak(text: string): Promise<void>;
  runtimes(): Promise<Runtimes>;
  recordCost(e: CostEntry): void;
  progress?(text: string): void;
  signal?: AbortSignal;
  now?: () => number;
}

export interface AbilityResult {
  content: string;
  summary: string;
  isError?: boolean;
  images?: { mime: string; data: string }[];
  /** links the answer may cite */
  citations?: { n: number; title: string; url: string }[];
  /** files this made */
  files?: string[];
}

const fail = (content: string): AbilityResult => ({ content, summary: content, isError: true });

export async function runAbility(name: string, args: Record<string, unknown>, ctx: AbilityContext): Promise<AbilityResult> {
  const spec = abilitySpec(name);
  if (!spec) return fail(`Unknown ability ${name}`);
  const perm = abilityPermission(name, ctx.settings);
  if (perm === 'off') return fail(ctx.settings.localOnly && spec.network === 'always' ? `${spec.label} is off: Keeper is set to stay on this computer.` : `${spec.label} is switched off in Settings → Abilities.`);
  if (perm === 'ask' && !(await ctx.approve(name, spec.describe(args), args))) return fail(`The person did not allow: ${spec.describe(args)}`);
  try {
    return await dispatch(name, args, ctx);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

async function search(ctx: AbilityContext, query: string, limit: number, recent?: number): Promise<SearchResult[]> {
  const s = ctx.settings.search;
  const key = s.provider === 'xai' ? await ctx.key('xai') : await ctx.key(`search:${s.provider}`);
  const r = await webSearch(s.provider, query, limit, { fetch: ctx.fetch, key, searxngUrl: s.searxngUrl, googleCx: s.googleCx, region: s.region, safe: s.safe }, recent);
  ctx.recordCost({ at: (ctx.now ?? Date.now)(), ability: 'web_search', provider: s.provider, units: 1 });
  return r;
}

async function dispatch(name: string, a: Record<string, unknown>, ctx: AbilityContext): Promise<AbilityResult> {
  const num = (v: unknown, d: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : d));
  const now = (ctx.now ?? Date.now)();
  switch (name) {
    case 'web_search': {
      const q = String(a.query ?? '').trim();
      if (!q) return fail('Nothing to search for');
      const r = await search(ctx, q, num(a.limit, 6, 1, 10), a.recent_days ? num(a.recent_days, 7, 1, 3650) : undefined);
      return { content: `${UNTRUSTED_NOTE}\n\n${untrusted(formatResults(r), `search results for “${q}”`)}`, summary: `${r.length} result${r.length === 1 ? '' : 's'} for “${q}”`, citations: r.map((x, i) => ({ n: i + 1, title: x.title, url: x.url })) };
    }
    case 'fetch_page': {
      const p = await fetchReadable(String(a.url ?? ''), { fetch: ctx.fetch });
      const max = num(a.max_chars, 12_000, 500, 40_000);
      const body = p.text.length > max ? `${p.text.slice(0, max)}\n[… ${p.text.length - max} more characters]` : p.text;
      return { content: `${UNTRUSTED_NOTE}\n\n${untrusted(`# ${p.title}\n${p.date ? `Published: ${p.date}\n` : ''}\n${body}`, p.url)}`, summary: `read ${p.title || p.url}`, citations: [{ n: 1, title: p.title || p.url, url: p.url }] };
    }
    case 'deep_research': {
      const q = String(a.question ?? '').trim();
      if (!q) return fail('No question to research');
      const depth = (['quick', 'normal', 'thorough'] as const).includes(a.depth as never) ? (a.depth as 'quick' | 'normal' | 'thorough') : 'normal';
      const lim = { maxSteps: ctx.settings.research.maxSteps, maxPages: ctx.settings.research.maxPages, maxMinutes: ctx.settings.research.maxMinutes, ...DEPTH[depth] };
      const r = await deepResearch(q, {
        model: await ctx.model(),
        search: (x) => search(ctx, x, 6),
        read: (u) => fetchReadable(u, { fetch: ctx.fetch }),
        onProgress: (p) => ctx.progress?.(`${p.phase}: ${p.detail}`),
        signal: ctx.signal,
        now: ctx.now,
      }, lim);
      const file = await ctx.saveFile('research', `${new Date(now).toISOString().slice(0, 10)} ${q.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60).trim()}.md`, reportMarkdown(r, new Date(now)));
      return { content: `${r.report}\n\nSources:\n${r.sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join('\n')}\n\nSaved as [[${file}]]`, summary: `researched “${q}” (${r.sources.length} sources)`, citations: r.sources, files: [file] };
    }
    case 'social_search': {
      const q = String(a.query ?? '').trim();
      const so = ctx.settings.social;
      const pw = await ctx.key('bluesky');
      const dep = { xaiKey: await ctx.key('xai'), mastodonInstance: so.mastodonInstance, bluesky: so.blueskyHandle && pw ? { handle: so.blueskyHandle, appPassword: pw } : undefined, redditClientId: so.redditClientId || undefined };
      const avail = availableSources(dep);
      const want = Array.isArray(a.sources) && a.sources.length ? (a.sources as SocialSource[]).filter((x) => avail.includes(x)) : avail;
      if (!want.length) return fail(`None of those sources is set up. Available: ${avail.join(', ')}`);
      const r = await socialSearch(q, want, num(a.limit, 8, 1, 25), { fetch: ctx.fetch, ...dep });
      return { content: `${UNTRUSTED_NOTE}\n\n${untrusted(formatPosts(r.posts), `public posts about “${q}”`)}${r.errors.length ? `\n\nNot reached: ${r.errors.join('; ')}` : ''}`, summary: `${r.posts.length} posts about “${q}”`, citations: r.posts.map((p, i) => ({ n: i + 1, title: `${p.source} · ${p.author}`, url: p.url })) };
    }
    case 'image_generate':
    case 'image_edit': {
      const im = ctx.settings.images;
      const prov = IMAGE_PROVIDERS.find((p) => p.id === im.provider)!;
      if (ctx.settings.localOnly && !prov.local) return fail('Keeper is set to stay on this computer; choose a picture service that runs here (Stable Diffusion web UI or ComfyUI).');
      const deps = { fetch: ctx.fetch, key: prov.local ? undefined : await ctx.key(`images:${im.provider}`), model: im.model || undefined, localUrl: im.localUrl };
      if (!prov.local && !deps.key) return fail(`Add a ${prov.label} key in Settings → Abilities to make pictures.`);
      const prompt = String(a.prompt ?? '').trim();
      if (!prompt) return fail('Describe the picture');
      let made;
      if (name === 'image_generate') {
        made = await generateImages(im.provider, prompt, { size: String(a.size ?? im.size), count: num(a.count, 1, 1, 4) }, deps);
      } else {
        const p = String(a.path ?? '');
        if (!ctx.allowed(p)) return fail('That picture is outside the library');
        const bytes = await ctx.readFile(p);
        made = await editImage(im.provider, { bytes, mime: /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg', name: p.split(/[\\/]/).pop()! }, prompt, deps);
      }
      if (!made.length) return fail('The picture service sent nothing back');
      const files: string[] = [];
      for (let i = 0; i < made.length; i++) files.push(await ctx.saveFile('images', imageFileName(prompt, new Date(now), i, made[i].mime.split('/')[1] === 'jpeg' ? 'jpg' : made[i].mime.split('/')[1] || 'png'), made[i].bytes));
      ctx.recordCost({ at: now, ability: name, provider: im.provider, units: made.length });
      return { content: `Saved ${files.map((f) => `[[${f}]]`).join(', ')}${made[0].revised ? `\nThe service read the request as: ${made[0].revised}` : ''}`, summary: `${name === 'image_generate' ? 'made' : 'edited'} ${files.length} picture${files.length === 1 ? '' : 's'}`, files, images: made.slice(0, 1).map((m) => ({ mime: m.mime, data: m.bytes.toString('base64') })) };
    }
    case 'look_at_image': {
      const p = String(a.path ?? '');
      let bytes: Buffer;
      let label = p;
      if (/^https?:\/\//i.test(p)) {
        const res = await ctx.fetch(p);
        if (!res.ok) return fail(`That picture answered ${res.status}`);
        bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > 8_000_000) return fail('That picture is too large');
      } else {
        if (!ctx.allowed(p)) return fail('That picture is outside the library');
        bytes = await ctx.readFile(p);
        label = p.split(/[\\/]/).pop()!;
      }
      const mime = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : bytes.slice(0, 3).toString() === 'GIF' ? 'image/gif' : 'image/png';
      const text = /^https?:/i.test(p) ? '' : await ctx.ocr(p).catch(() => '');
      return { content: `The picture ${label} is attached.${text ? `\nText read from it on this computer:\n${text.slice(0, 4000)}` : ''}`, summary: `looked at ${label}`, images: [{ mime, data: bytes.toString('base64') }] };
    }
    case 'ask_document': {
      const p = String(a.path ?? '');
      if (!ctx.allowed(p)) return fail('That file is outside the library');
      const ans = await ctx.askDocument(p, String(a.question ?? ''));
      return { content: ans, summary: `looked in ${p.split(/[\\/]/).pop()}` };
    }
    case 'run_code': {
      const lang = a.language === 'python' ? 'python' : 'javascript';
      if (lang === 'python' && !ctx.settings.code.python) return fail('Running Python is switched off in Settings → Abilities.');
      const inputs: { name: string; data: Buffer }[] = [];
      for (const f of Array.isArray(a.files) ? a.files.map(String).slice(0, 10) : []) {
        if (!ctx.allowed(f)) return fail(`${f} is outside the library`);
        inputs.push({ name: f, data: await ctx.readFile(f) });
      }
      const r = await runSandboxed(lang, String(a.code ?? ''), ctx.settings.code, await ctx.runtimes(), inputs);
      const images = r.files.filter((f) => /\.(png|jpe?g|svg)$/i.test(f.name) && f.size < 4_000_000).slice(0, 2);
      const imgs = await Promise.all(images.map(async (f) => ({ mime: f.name.endsWith('.svg') ? 'image/svg+xml' : f.name.endsWith('.png') ? 'image/png' : 'image/jpeg', data: (await import('node:fs')).readFileSync(f.path).toString('base64') })));
      const status = r.timedOut ? `Stopped after ${ctx.settings.code.timeoutSec} s` : `Exit code ${r.exitCode}`;
      return {
        content: `${status} · ${r.ms} ms · ${r.isolation}\n${r.stdout ? `Output:\n${r.stdout}` : '(no output)'}${r.stderr ? `\nErrors:\n${r.stderr.slice(0, 4000)}` : ''}${r.files.length ? `\nFiles made: ${r.files.map((f) => `${f.name} (${f.size} bytes) at ${f.path}`).join(', ')}` : ''}`,
        summary: `ran ${lang} (${status.toLowerCase()})`, isError: r.timedOut || (r.exitCode ?? 1) !== 0, files: r.files.map((f) => f.path), images: imgs.filter((i) => i.mime !== 'image/svg+xml'),
      };
    }
    case 'remember': {
      if (!ctx.settings.memory.on) return fail('Memory is switched off in Settings → Abilities.');
      const scope = a.scope === 'persona' && ctx.persona ? 'persona' : a.scope === 'project' && ctx.project ? 'project' : 'shared';
      const r = addMemory(ctx.memories.get(), { text: String(a.text ?? ''), scope, owner: scope === 'persona' ? ctx.persona : scope === 'project' ? ctx.project : undefined, by: ctx.client, cloud: ctx.settings.memory.cloud }, now);
      await ctx.memories.set(r.list);
      return { content: `Remembered [${r.memory.id}]: ${r.memory.text}`, summary: 'remembered something' };
    }
    case 'recall': {
      if (!ctx.settings.memory.on) return fail('Memory is switched off in Settings → Abilities.');
      const { visibleMemories } = await import('./memory');
      const vis = visibleMemories(ctx.memories.get(), { persona: ctx.persona, project: ctx.project, localModel: ctx.localModel, cloudAllowed: ctx.settings.memory.cloud });
      const hits = searchMemories(vis, String(a.query ?? ''));
      return { content: hits.length ? hits.map((m) => `[${m.id}] ${m.text}`).join('\n') : 'Nothing remembered about that.', summary: `${hits.length} memories` };
    }
    case 'forget': {
      await ctx.memories.set(removeMemory(ctx.memories.get(), String(a.id ?? '')));
      return { content: `Forgot ${String(a.id)}`, summary: 'forgot a memory' };
    }
    case 'schedule_task': {
      const when = String(a.when ?? '');
      const sched = parseSchedule(when, now);
      const prompt = String(a.prompt ?? '').trim();
      if (!prompt) return fail('Nothing to do');
      const task: ScheduledTask = { id: `t${now.toString(36)}`, name: String(a.name ?? prompt).slice(0, 60), prompt, when, deliver: ['island', 'notification'], enabled: true, once: sched.once !== undefined, persona: ctx.persona, project: ctx.project };
      (task as ScheduledTask & { createdAt: number }).createdAt = now;
      await ctx.addTask(task);
      return { content: `Scheduled “${task.name}” — ${sched.label}. The person can change or stop it in Settings → Abilities → Schedules.`, summary: `scheduled “${task.name}”` };
    }
    case 'speak': {
      await ctx.speak(String(a.text ?? '').slice(0, 4000));
      return { content: 'Said it out loud.', summary: 'spoke' };
    }
  }
  const ext = EXTERNAL_RUNNERS.get(name);
  if (ext) return ext(a);
  return fail(`Unknown ability ${name}`);
}

/** The abilities as tools for Keeper's harness (the Assistant with any AI). */
export function abilityTools(ctxFor: () => AbilityContext): { specs: ToolSpec[]; run(call: ToolCall): Promise<{ content: string; summary: string; images?: { mime: string; data: string }[] }>; instructions: string } {
  const ctx0 = ctxFor();
  return {
    specs: offeredAbilities(ctx0.settings).map(({ name, description, parameters }) => ({ name, description, parameters })),
    run: async (c) => {
      const r = await runAbility(c.name, c.args, ctxFor());
      return { content: r.isError ? `Error: ${r.content}` : r.content, summary: r.summary, images: r.images };
    },
    instructions: `You can also search the web, read pages, research, search posts, make and edit pictures, look at pictures, run code in a sealed workspace, remember things the person asks you to, and schedule tasks. Cite web sources as [n] with their links. ${UNTRUSTED_NOTE}`,
  };
}
