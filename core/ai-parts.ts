// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every place Keeper uses AI, in one table (Settings → AI → Where AI is used):
// the Assistant, Ask in the Island, selected text, writing help, Mail,
// meetings, agents and search. A part that is only AI has its own switch here;
// one that does more (Mail, Meetings) opens its own AI settings instead, so
// switching AI off never switches off your mail. All of them use the AI chosen
// under Your AI, so people can see at a glance which AI does what.

import type { NavRoute } from './nav';

export interface AiPart {
  id: string;
  /** the part (core/features.ts) it belongs to */
  feature: string;
  name: string;
  /** what the AI does there, in a few words */
  what: string;
  /** true: the part is only AI, so this row switches it; false: the row opens its AI settings */
  switchable: boolean;
  /** where its own settings are */
  to: NavRoute;
}

export const AI_PARTS: AiPart[] = [
  { id: 'assistant', feature: 'assistant', name: 'Assistant', what: 'Answers questions about your files.', switchable: true, to: { name: 'assistant' } },
  { id: 'island', feature: 'islandAsk', name: 'Ask in the Island', what: 'Rewrites, sums up and brainstorms.', switchable: true, to: { name: 'island' } },
  { id: 'selection', feature: 'selectionBar', name: 'Selected text', what: 'Translates, rewrites and defines.', switchable: true, to: { name: 'settings', arg: 'ai#selectionBar' } },
  { id: 'writing', feature: 'writingHelp', name: 'Writing help', what: 'Proofreads and shortens in Keeper.', switchable: true, to: { name: 'settings', arg: 'ai' } },
  { id: 'mail', feature: 'mail', name: 'Mail', what: 'Reply ideas and summaries.', switchable: false, to: { name: 'settings', arg: 'pim#mailAi' } },
  { id: 'meetings', feature: 'meetings', name: 'Meetings', what: 'Tidies notes after a call.', switchable: false, to: { name: 'meetings', arg: 'settings' } },
  { id: 'agents', feature: 'aiAgents', name: 'Agents', what: 'Works on your files, asking first.', switchable: true, to: { name: 'agents' } },
  { id: 'search', feature: 'brain', name: 'Search with AI', what: 'Finds files by what they are about.', switchable: true, to: { name: 'settings', arg: 'ai#brain' } },
];

/** The rows to show: parts that exist on this system (a missing part is left out, never shown as broken). */
export function aiPartsShown(has: (feature: string) => boolean): AiPart[] {
  return AI_PARTS.filter((p) => has(p.feature));
}
