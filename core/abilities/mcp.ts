// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The abilities as MCP tools, so Claude Code, Codex, Cursor or any MCP client
// gets the same abilities as Keeper's own Assistant, behind the same permissions.

import type { McpTool } from '../brain/mcp';
import type { AbilitiesSettings } from './config';
import { offeredAbilities } from './policy';
import { ABILITY_NAMES } from './registry';
import { runAbility, type AbilityContext } from './run';

export function abilityMcpTools(s: AbilitiesSettings): McpTool[] {
  return offeredAbilities(s).map((a) => ({
    name: a.name,
    description: a.description,
    inputSchema: a.parameters,
    annotations: { title: a.label, readOnlyHint: a.readOnly, destructiveHint: false, openWorldHint: a.network !== 'never' },
  }));
}

export function isAbility(name: string): boolean {
  return ABILITY_NAMES.has(name);
}

export async function callAbilityForMcp(name: string, args: Record<string, unknown>, ctx: AbilityContext): Promise<{ text: string; isError?: boolean; images?: { mime: string; data: string }[]; structured?: unknown }> {
  const r = await runAbility(name, args, ctx);
  return { text: r.content, isError: r.isError, images: r.images, structured: r.citations || r.files ? { citations: r.citations, files: r.files } : undefined };
}
