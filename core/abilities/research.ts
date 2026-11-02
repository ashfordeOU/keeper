// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Research in several steps with any AI, even one without tools: plan the
// searches, read the most useful pages, note what each says, look for what is
// still missing, then write a report with numbered sources. Bounded by steps,
// pages and minutes so it always ends.

import type { ChatProvider } from '../brain/providers';
import { untrusted, UNTRUSTED_NOTE } from './policy';
import type { SearchResult } from './search';

export interface ResearchDeps {
  model: ChatProvider;
  search(query: string): Promise<SearchResult[]>;
  read(url: string): Promise<{ title: string; text: string }>;
  onProgress?(p: { phase: 'plan' | 'search' | 'read' | 'think' | 'write'; detail: string; sources: number }): void;
  signal?: AbortSignal;
  now?: () => number;
}

export interface ResearchLimits {
  maxSteps: number;
  maxPages: number;
  maxMinutes: number;
}

export interface ResearchReport {
  question: string;
  report: string;
  sources: { n: number; title: string; url: string }[];
  queries: string[];
  stoppedBecause?: 'time' | 'pages' | 'steps';
}

export const DEPTH: Record<'quick' | 'normal' | 'thorough', Partial<ResearchLimits>> = {
  quick: { maxSteps: 2, maxPages: 4, maxMinutes: 2 },
  normal: {},
  thorough: { maxSteps: 10, maxPages: 16, maxMinutes: 12 },
};

/** The first JSON array of strings in a model's reply (models wrap JSON in prose and fences). */
export function parseQueries(text: string, max = 5): string[] {
  const m = text.match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try {
    const v = JSON.parse(m[0]) as unknown[];
    return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 1).map((x) => x.trim()).slice(0, max);
  } catch {
    return [];
  }
}

async function say(d: ResearchDeps, system: string, user: string, maxTokens = 1200): Promise<string> {
  const r = await d.model.chat([{ role: 'system', content: system }, { role: 'user', content: user }], [], { signal: d.signal, maxTokens });
  return r.text.trim();
}

export async function deepResearch(question: string, d: ResearchDeps, limits: ResearchLimits): Promise<ResearchReport> {
  const now = d.now ?? Date.now;
  const deadline = now() + limits.maxMinutes * 60_000;
  const today = new Date(now()).toISOString().slice(0, 10);
  const sources: { n: number; title: string; url: string }[] = [];
  const notes: { n: number; note: string }[] = [];
  const seen = new Set<string>();
  const queries: string[] = [];
  let stoppedBecause: ResearchReport['stoppedBecause'];

  d.onProgress?.({ phase: 'plan', detail: 'Planning searches', sources: 0 });
  let plan = parseQueries(await say(d, `You plan web research. Today is ${today}. Reply only with a JSON array of 3 to 5 short search queries that together answer the question.`, question, 300));
  if (!plan.length) plan = [question];

  for (let step = 0; step < limits.maxSteps && plan.length; step++) {
    const q = plan.shift()!;
    if (queries.includes(q)) continue;
    queries.push(q);
    if (now() > deadline) { stoppedBecause = 'time'; break; }
    d.onProgress?.({ phase: 'search', detail: q, sources: sources.length });
    let results: SearchResult[] = [];
    try {
      results = await d.search(q);
    } catch {
      continue;
    }
    for (const r of results.slice(0, 3)) {
      if (seen.has(r.url)) continue;
      if (sources.length >= limits.maxPages) { stoppedBecause = 'pages'; break; }
      if (now() > deadline) { stoppedBecause = 'time'; break; }
      seen.add(r.url);
      d.onProgress?.({ phase: 'read', detail: r.title || r.url, sources: sources.length });
      let page: { title: string; text: string };
      try {
        page = await d.read(r.url);
      } catch {
        page = { title: r.title, text: r.snippet };
      }
      const n = sources.length + 1;
      sources.push({ n, title: page.title || r.title || r.url, url: r.url });
      const note = await say(
        d,
        `You take research notes. ${UNTRUSTED_NOTE} Write up to 8 short bullet points of facts from the page that help answer the question, with numbers and dates where given. If nothing helps, reply NONE.`,
        `Question: ${question}\n\nPage [${n}] ${r.url}\n${untrusted(page.text.slice(0, 6000), r.url)}`,
        600,
      );
      if (!/^none\.?$/i.test(note)) notes.push({ n, note });
    }
    if (stoppedBecause) break;
    if (!plan.length && step + 1 < limits.maxSteps && now() < deadline) {
      d.onProgress?.({ phase: 'think', detail: 'Looking for what is still missing', sources: sources.length });
      plan = parseQueries(await say(d, 'You review research notes. Reply only with a JSON array of up to 2 new search queries for what is still missing, or [] if the notes answer the question.', `Question: ${question}\n\nNotes so far:\n${notes.map((x) => `[${x.n}] ${x.note}`).join('\n')}\n\nAlready searched: ${queries.join('; ')}`, 200), 2).filter((x) => !queries.includes(x));
    }
  }
  if (!stoppedBecause && queries.length >= limits.maxSteps && plan.length) stoppedBecause = 'steps';

  d.onProgress?.({ phase: 'write', detail: 'Writing the report', sources: sources.length });
  const report = notes.length
    ? await say(
      d,
      `You write research reports. Today is ${today}. Use only the notes. Cite sources inline as [n] using their numbers. Start with a short answer, then sections with headings, then "Open questions" if the notes disagree or leave gaps. Use the language of the question. Do not list the sources at the end; Keeper adds them.`,
      `Question: ${question}\n\nNotes:\n${notes.map((x) => `[${x.n}] ${x.note}`).join('\n\n')}`,
      3000,
    )
    : 'No useful sources were found for this question. Try other words, or choose a different search service in Agents → Abilities.';
  return { question, report, sources, queries, stoppedBecause };
}

/** The report as a Markdown file, with its sources listed. */
export function reportMarkdown(r: ResearchReport, at: Date): string {
  return `# ${r.question}\n\n_Researched by Keeper on ${at.toISOString().slice(0, 10)}${r.stoppedBecause ? ` (stopped early: ${r.stoppedBecause} limit)` : ''}_\n\n${r.report}\n\n## Sources\n\n${r.sources.map((s) => `${s.n}. [${s.title.replace(/[[\]]/g, '')}](${s.url})`).join('\n')}\n\n<details><summary>Searches</summary>\n\n${r.queries.map((q) => `- ${q}`).join('\n')}\n\n</details>\n`;
}
