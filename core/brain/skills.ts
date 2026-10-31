// SPDX-License-Identifier: AGPL-3.0-or-later
// Skills: instructions an AI loads only when it needs them. Each skill is a
// folder with a SKILL.md (YAML front matter with a name and a description, then
// Markdown) and optional files beside it — the open Agent Skills format, so
// the same skills work in Keeper's assistant and in other agents. Only names
// and descriptions go into the AI's context up front; the body is read when
// the AI decides to use the skill.

export interface Skill {
  name: string;
  description: string;
  body: string;
  /** other front-matter fields, kept as they were */
  meta: Record<string, string | string[] | Record<string, string>>;
  /** files in the skill's folder besides SKILL.md (relative paths) */
  files?: string[];
}

export const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    if (t.startsWith('"')) {
      try {
        return JSON.parse(t);
      } catch {
        return t.slice(1, -1);
      }
    }
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/**
 * The small part of YAML that skill front matter uses: `key: value`, quoted
 * strings, block scalars (| and >), simple lists and one level of nested maps.
 */
export function parseFrontMatter(yaml: string): Record<string, string | string[] | Record<string, string>> {
  const out: Record<string, string | string[] | Record<string, string>> = {};
  const lines = yaml.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rest = m[2];
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].replace(/^\s{1,4}/, ''));
      out[key] = rest.startsWith('|') ? block.join('\n').trimEnd() : block.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ').trim();
      continue;
    }
    if (rest === '') {
      // A list or a nested map.
      const items: string[] = [];
      const map: Record<string, string> = {};
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        const l = lines[++i].trim();
        if (l.startsWith('- ')) items.push(unquote(l.slice(2)));
        else {
          const mm = l.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
          if (mm) map[mm[1]] = unquote(mm[2]);
        }
      }
      out[key] = items.length ? items : map;
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      out[key] = rest.slice(1, -1).split(',').map((x) => unquote(x)).filter(Boolean);
      continue;
    }
    out[key] = unquote(rest);
  }
  return out;
}

export function parseSkill(text: string): Skill {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('SKILL.md must start with front matter between --- lines');
  const meta = parseFrontMatter(m[1]);
  const name = typeof meta.name === 'string' ? meta.name : '';
  const description = typeof meta.description === 'string' ? meta.description : '';
  delete meta.name;
  delete meta.description;
  return { name, description, body: m[2].trim(), meta };
}

/** Problems that make a skill invalid (empty when it is fine). `folder` is the folder's name, which must match. */
export function validateSkill(s: Pick<Skill, 'name' | 'description' | 'meta'>, folder?: string): string[] {
  const errs: string[] = [];
  if (!s.name) errs.push('name is missing');
  else {
    if (s.name.length > 64) errs.push('name is longer than 64 characters');
    if (!NAME_RE.test(s.name)) errs.push('name may only use lowercase letters, numbers and single hyphens, not at the start or end');
    if (folder !== undefined && folder !== s.name) errs.push(`name must match the folder name (“${folder}”)`);
  }
  if (!s.description.trim()) errs.push('description is missing');
  else if (s.description.length > 1024) errs.push('description is longer than 1024 characters');
  const compat = s.meta.compatibility;
  if (typeof compat === 'string' && compat.length > 500) errs.push('compatibility is longer than 500 characters');
  return errs;
}

function yamlValue(v: string): string {
  return /^[\w .,/()&+-]*$/.test(v) && !/^\s|\s$|: /.test(v) && v !== '' ? v : JSON.stringify(v);
}

export function serializeSkill(s: Skill): string {
  const lines = ['---', `name: ${s.name}`, `description: ${yamlValue(s.description)}`];
  for (const [k, v] of Object.entries(s.meta)) {
    if (Array.isArray(v)) lines.push(`${k}:`, ...v.map((x) => `  - ${yamlValue(x)}`));
    else if (typeof v === 'object') lines.push(`${k}:`, ...Object.entries(v).map(([kk, vv]) => `  ${kk}: ${yamlValue(vv)}`));
    else lines.push(`${k}: ${yamlValue(v)}`);
  }
  lines.push('---', '', s.body.trim(), '');
  return lines.join('\n');
}

/** A name that fits the rules, from any title. */
export function slugify(title: string): string {
  const s = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return s || 'skill';
}

/** The short list that goes into the AI's context: names and descriptions only. */
export function skillsIndex(skills: Pick<Skill, 'name' | 'description'>[]): string {
  if (!skills.length) return '';
  return `Skills you can use (call use_skill with the name to read one before following it):\n${skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`;
}

/** What use_skill returns: the body, and the files it can read next. */
export function skillForModel(s: Skill): string {
  const files = s.files?.length ? `\n\nFiles in this skill (read with read_skill_file): ${s.files.join(', ')}` : '';
  return `# Skill: ${s.name}\n\n${s.body}${files}`;
}

/**
 * A first draft of a skill from something that worked: the question, the
 * steps the AI took and its answer. The person edits it before saving.
 */
export function draftSkill(input: { title: string; question: string; answer: string; steps: { tool: string; summary: string; args?: Record<string, unknown> }[] }): Skill {
  const name = slugify(input.title);
  const steps = input.steps.filter((s) => s.tool !== 'propose_actions');
  const how = steps.length
    ? steps.map((s, i) => `${i + 1}. \`${s.tool}\`${s.args && Object.keys(s.args).length ? ` with ${JSON.stringify(s.args)}` : ''} — ${s.summary}`).join('\n')
    : '1. Search the files for what the request is about, then read the most relevant ones.';
  return {
    name,
    description: `Use when the person asks something like “${input.question.slice(0, 160).replace(/\s+/g, ' ')}”. ${input.title}.`.slice(0, 1024),
    meta: { metadata: { source: 'learned in Keeper', created: new Date().toISOString().slice(0, 10) } },
    body: [
      `# ${input.title}`,
      '',
      '## When to use',
      `Requests like: “${input.question.trim()}”`,
      '',
      '## Steps that worked',
      how,
      '',
      '## What a good answer looked like',
      input.answer.trim().slice(0, 1500),
      '',
      '## Notes',
      '- Cite the files you used.',
      '- Suggest changes for the person to approve; do not claim to have made them.',
    ].join('\n'),
  };
}
