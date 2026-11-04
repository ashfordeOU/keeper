// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// AI agents in the browser demo: the service catalogue, permissions, a pending
// approval, a few skills, learned suggestions and a real knowledge graph built
// from the demo files (plus a small set of linked notes).

import type { AgentsApi, ApprovalRequest, AuditItem, SkillInfo } from '../core/api-agents';
import { ACTIONS, permissionFor, type Permission } from '../core/brain/actions';
import { AGENT_CLIS, type AgentProfile } from '../core/brain/agents';
import { CATALOG } from '../core/brain/catalog';
import { gatewayModels } from '../core/brain/gateway';
import { draftSkill, parseSkill, serializeSkill, validateSkill } from '../core/brain/skills';
import { buildGraph, neighbourhood, type GraphFile } from '../core/graph/build';
import type { Suggestion } from '../core/learn';
import type { FileEntry } from '../core/types';
import { mockGraph } from './mock-graph';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOTES: { name: string; text: string }[] = [
  { name: 'Home.md', text: '# Home\nStart here. Projects: [[Apartment move]], [[Tax 2025]], [[Garden plan]]. People: Lena Fischer, Marco Rossi. #index' },
  { name: 'Apartment move.md', text: 'Moving on 1 March. Lease from Acme Property GmbH, see [[Lease summary]]. Ask Lena Fischer about the van. #home #todo' },
  { name: 'Lease summary.md', text: 'Lease with Acme Property GmbH ends 28 February. Deposit 2,400 EUR. Contact: lena.fischer@example.com. Back to [[Apartment move]]. #home' },
  { name: 'Tax 2025.md', text: 'Receipts in [[Receipts]]. Accountant: Marco Rossi. Deadline 31 July. #tax #todo' },
  { name: 'Receipts.md', text: 'Café Sol, City Taxi, Acme Property GmbH deposit. See [[Tax 2025]]. #tax' },
  { name: 'Garden plan.md', text: 'Tomatoes, basil and beans. Seeds from Green Thumb Ltd. Marco Rossi lends the tiller. #garden' },
  { name: 'Reading list.md', text: 'Books Lena Fischer recommended. #books' },
];

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

export function mockAgents(files: FileEntry[], emit: (channel: string, v: unknown) => void, home: string): { agents: AgentsApi } {
  const perms: Record<string, Permission> = {};
  let learnOn = true;
  const gatewayOn = true;
  const a2aOn = false;
  let profiles: AgentProfile[] = [
    { id: 'p1', agent: 'claude', label: 'Work account', configDir: `${home}/Library/Application Support/Keeper/agent-profiles/claude/work-account` },
    { id: 'p2', agent: 'claude', label: 'Personal', configDir: `${home}/Library/Application Support/Keeper/agent-profiles/claude/personal` },
  ];
  let skills: SkillInfo[] = [
    { name: 'monthly-invoices', description: 'Use when the person asks to file this month\'s invoices: finds PDF invoices in Downloads and suggests moving them to Documents/Invoices/<year>.', enabled: true, meta: {}, body: '# Monthly invoices\n\n1. search_files for "invoice pdf downloaded this month".\n2. Read each to confirm it is an invoice.\n3. propose_actions: move to ~/Documents/Invoices/<year>.' },
    { name: 'tax-pack', description: 'Use when preparing the yearly tax pack: gathers receipts, statements and payslips for a year and summarises totals.', enabled: true, meta: {}, body: '# Tax pack\n\nSearch receipts, bank statements and payslips for the year; list totals by category; cite every file.', files: ['categories.md'] },
    { name: 'tidy-screenshots', description: 'Use when the Desktop is full of screenshots: groups them by month and suggests moving them to Pictures/Screenshots.', enabled: false, meta: {}, body: '# Tidy screenshots\n\nList screenshots on the Desktop older than a week and suggest moves into Pictures/Screenshots/<yyyy-MM>.' },
  ];
  const audit: AuditItem[] = [
    { at: Date.now() - 3_600_000, client: 'Claude Code', action: 'move_files', description: 'move 3 items (Q3 Invoice - Acme.pdf, …) to ~/Documents/Invoices/2026', status: 'done', journalId: 'demo' },
    { at: Date.now() - 7_200_000, client: 'Cursor', action: 'why_slow', description: 'why slow', status: 'done', detail: '[warn] Browser is using 62% of a processor core.' },
    { at: Date.now() - 86_400_000, client: 'Codex CLI', action: 'trash_files', description: 'send “old-build.zip” to the Trash', status: 'denied' },
  ];
  const pending: ApprovalRequest[] = [];
  let dismissed: string[] = [];
  const suggestions = (): Suggestion[] => [
    { id: 's1', kind: 'rule', title: 'Move “invoice” .pdf files from Downloads to Invoices automatically?', detail: 'You did this 6 times on 4 different days.', count: 6, make: { type: 'rule', name: 'Move invoices', ext: 'pdf', nameContains: 'invoice', scope: `${home}/Downloads`, to: `${home}/Documents/Invoices` } },
    { id: 's2', kind: 'pin', title: 'Pin Projects to the sidebar?', detail: 'You opened files there on 9 days, mostly in the morning.', count: 9, make: { type: 'pin', folder: `${home}/Projects` } },
    { id: 's3', kind: 'saved-search', title: 'Save the search “pdfs from gmail”?', detail: 'You searched for it 4 times.', count: 4, make: { type: 'saved-search', name: 'Pdfs from gmail', text: 'pdfs from gmail' } },
  ].filter((s) => !dismissed.includes(s.id)) as Suggestion[];

  const notes: GraphFile[] = NOTES.map((n, i) => ({ path: `${home}/Notes/${n.name}`, name: n.name, kind: 'document', mtime: Date.now() - i * 86_400_000, text: n.text }));
  const graphFiles: GraphFile[] = [...notes, ...files.slice(0, 160).map((f) => ({ path: f.path, name: f.name, kind: f.kind, mtime: f.mtime, tags: f.tags, source: f.source?.name, text: f.text }))];
  const conns = [{ id: 'anthropic', label: 'Claude' }, { id: 'openai', label: 'OpenAI' }, { id: 'ollama', label: 'Ollama (this computer)' }, { id: 'xai', label: 'xAI (Grok)' }];

  // A demo agent asks for something a few seconds after the Agents page is first opened
  // (not on every page of the demo, where it would cover what is being shown).
  let demoAsked = false;
  const demoApproval = () => {
    if (demoAsked) return;
    demoAsked = true;
    setTimeout(() => {
      const a: ApprovalRequest = { id: 'demo-approval', client: 'Claude Code', action: 'move_files', description: 'move 4 items (Invoice 4471.pdf, Invoice 4502.pdf, …) to ~/Documents/Invoices/2026', destructive: false, at: Date.now() };
      pending.push(a);
      emit('agent-approval', a);
    }, 2500);
  };

  const agents: AgentsApi = {
    catalog: async () => (demoApproval(), CATALOG),
    addConnection: async (id) => ({ ok: true, id }),
    listModels: async (id) => { await wait(400); return { ok: true, models: id === 'ollama' ? ['llama3.2', 'qwen3:8b', 'gemma3:12b'] : id === 'xai' ? ['grok-4', 'grok-code-fast-1'] : ['model-a', 'model-b'] }; },
    usage: async () => [
      { id: 'anthropic', calls: 182, input: 1_240_000, output: 210_000, errors: 1, cost: 6.87 },
      { id: 'ollama', calls: 96, input: 410_000, output: 88_000, errors: 0, cost: 0 },
      { id: 'xai', calls: 14, input: 92_000, output: 15_000, errors: 2 },
    ],
    actions: async () => (demoApproval(), ACTIONS).map((x) => ({ name: x.name, label: x.label, group: x.group, readOnly: x.readOnly, destructive: !!x.destructive, permission: permissionFor(x.name, perms, true), default: x.default })),
    setPermission: async (name, p) => { perms[name] = p; },
    pending: async () => pending.slice(),
    computerState: async () => ({ sessions: params.has('computer') ? [{ id: 'demo', client: 'Claude in Keeper’s Assistant', since: Date.now() - 95_000, actions: 14 }] : [], stopShortcut: '⌃⌥⌘.' }),
    computerStop: async () => emit('computer-stopped', 'stopped by the person'),
    computerShot: async () => null,
    decide: async (id, d) => {
      const i = pending.findIndex((p) => p.id === id);
      if (i < 0) return;
      const [a] = pending.splice(i, 1);
      emit('agent-approval-done', id);
      const e: AuditItem = { at: Date.now(), client: a.client, action: a.action, description: a.description, status: d === 'deny' ? 'denied' : 'done' };
      audit.unshift(e);
      emit('agent-audit', e);
      if (d === 'always') perms[a.action] = 'allow';
    },
    audit: async () => audit.slice(),
    gateway: async () => ({
      on: gatewayOn, port: gatewayOn ? 47821 : 0, token: gatewayOn ? 'kpr_demo_7f3a9c2e1b' : '', base: gatewayOn ? 'http://127.0.0.1:47821' : '', a2a: a2aOn, remoteHosts: [],
      models: gatewayModels(conns, 'anthropic'),
      snippets: gatewayOn ? [
        { id: 'openai', label: 'OpenAI-compatible tools', text: 'OPENAI_BASE_URL=http://127.0.0.1:47821/v1\nOPENAI_API_KEY=kpr_demo_7f3a9c2e1b' },
        { id: 'anthropic', label: 'Anthropic-compatible tools', text: 'ANTHROPIC_BASE_URL=http://127.0.0.1:47821\nANTHROPIC_API_KEY=kpr_demo_7f3a9c2e1b' },
      ] : [],
    }),
    rotateToken: async () => agents.gateway(),
    clis: async () => (demoApproval(), { agents: AGENT_CLIS.map((a) => ({ ...a, installed: ['claude', 'codex', 'gemini', 'cursor-agent', 'ollama'].includes(a.command), path: `/usr/local/bin/${a.command}` })), profiles }),
    saveProfile: async (p) => { profiles = [...profiles.filter((x) => x.id !== p.id), { id: p.id ?? String(Date.now()), agent: p.agent, label: p.label, cwd: p.cwd }]; return profiles; },
    removeProfile: async (id) => { profiles = profiles.filter((p) => p.id !== id); },
    launch: async (id) => ({ ok: true, message: `Started ${AGENT_CLIS.find((a) => a.id === id)?.label ?? id} in Keeper's Terminal (demo).` }),
    skills: async () => skills.slice(),
    saveSkill: async (text, prev) => {
      try {
        const s = parseSkill(text);
        const errors = validateSkill(s);
        if (errors.length) return { ok: false, errors };
        skills = [...skills.filter((x) => x.name !== s.name && x.name !== prev), { ...s, enabled: true, meta: s.meta }].sort((a, b) => a.name.localeCompare(b.name));
        return { ok: true, errors: [], name: s.name };
      } catch (e) {
        return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
      }
    },
    removeSkill: async (name) => { skills = skills.filter((s) => s.name !== name); },
    setSkillEnabled: async (name, on) => { skills = skills.map((s) => (s.name === name ? { ...s, enabled: on } : s)); },
    importSkill: async () => ({ ok: true, errors: [], name: 'imported' }),
    otherSkills: async () => [{ path: `${home}/.claude/skills/pdf-forms`, name: 'pdf-forms', from: 'Claude Code' }],
    exportSkill: async (name) => `${home}/Desktop/${name}`,
    draftSkill: async (input) => serializeSkill(draftSkill(input)),
    learning: async () => ({ on: learnOn, events: learnOn ? 1284 : 0, since: Date.now() - 41 * 86_400_000, summary: 'Last 30 days: 412 files opened, 96 searches, 38 moves, 71 items trashed, 12 automation runs. Busiest hour: 10:00.' }),
    suggestions: async () => (learnOn ? suggestions() : []),
    applySuggestion: async (id) => { dismissed = [...dismissed, id]; return { ok: true, message: 'Added as an automation (switched off): preview it in Automations, then turn it on.' }; },
    dismissSuggestion: async (id) => { dismissed = [...dismissed, id]; },
    forget: async () => { learnOn = false; },
    record: async () => undefined,
    graph: async (o) => {
      await wait(200);
      const g = buildGraph(graphFiles, { maxFiles: o?.maxFiles ?? 400, kinds: o?.kinds, within: o?.within });
      if (o?.focus) return neighbourhood(g, g.nodes.some((n) => n.id === o.focus) ? o.focus : `f:${o.focus}`, o.depth ?? 2);
      return g;
    },
    ...mockGraph(notes, graphFiles.slice(notes.length, notes.length + 60)),
  };
  return { agents };
}
