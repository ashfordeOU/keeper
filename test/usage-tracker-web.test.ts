// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Web sign-in accounts of the usage tracker (claude.ai, chatgpt.com): the
// per-account partitions and their cleanup, what an answer means, the
// tolerant parsers (fixtures in test/fixtures/usage-tracker, shaped after
// public sources; not verified live), account letters when one service has
// several accounts, and the coding CLI's current session-file format.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeDataDirs, claudeReadText, claudeTokenLines, usageTokens } from '../core/island-tools/usage';
import { accountGlyph, PROVIDERS, providerInfo, type Account } from '../core/usage-tracker/model';
import { prioritize } from '../core/usage-tracker/priority';
import { ccLocalWindows } from '../core/usage-tracker/sources';
import {
  accountOfPartition, browserUserAgent, chatgptSession, chatgptUsage, claudeIdentity, claudeOrgs, claudePlan, claudeWebUsage, defaultWebName, hasSessionCookie, isWebProvider,
  jwtClaims, orphanPartitions, pickClaudeOrg, sameOrigin, usagePartition, webAnswer, WEB_PROVIDERS,
} from '../core/usage-tracker/web';
import { defaultTrackerSettings } from '../core/usage-tracker/model';

const FIX = path.join(__dirname, 'fixtures', 'usage-tracker');
const text = (f: string) => readFileSync(path.join(FIX, f), 'utf8');
const json = (f: string) => JSON.parse(text(f));
const NOW = Date.parse('2026-11-01T12:00:00Z');
const H = 3600_000;
const D = 24 * H;

describe('one partition per web account', () => {
  it('names the partition after the account, and only for safe ids', () => {
    expect(usagePartition('ulm2abc12')).toBe('persist:usage-ulm2abc12');
    expect(usagePartition('a_b-C9')).toBe('persist:usage-a_b-C9');
    for (const bad of ['', '../x', 'a b', 'x:y', 'a/b', 'x'.repeat(65)]) expect(() => usagePartition(bad)).toThrow();
    // Two accounts never share one.
    expect(usagePartition('u1')).not.toBe(usagePartition('u2'));
  });

  it('knows which partitions are its own', () => {
    expect(accountOfPartition('persist:usage-u1')).toBe('u1');
    expect(accountOfPartition('usage-u1')).toBe('u1');
    expect(accountOfPartition('rdc-web-u1')).toBeUndefined();
    expect(accountOfPartition('usage-../x')).toBeUndefined();
    expect(accountOfPartition('usage-')).toBeUndefined();
  });

  it('finds the partitions left by accounts that are gone, and nothing else', () => {
    expect(orphanPartitions(['usage-u1', 'usage-u2', 'rdc-web-c1', 'keeper-voice', 'usage-u3'], ['u2'])).toEqual(['usage-u1', 'usage-u3']);
    expect(orphanPartitions(['usage-u1'], ['u1'])).toEqual([]);
    expect(orphanPartitions([], [])).toEqual([]);
  });

  it('spots the signed-in session cookie', () => {
    expect(hasSessionCookie('claude-web', [{ name: 'cf_clearance', value: 'x' }, { name: 'sessionKey', value: 'sk-ant-sid01-x' }])).toBe(true);
    expect(hasSessionCookie('claude-web', [{ name: 'sessionKey', value: '' }, { name: 'lastActiveOrg', value: 'o' }])).toBe(false);
    expect(hasSessionCookie('chatgpt-web', [{ name: '__Secure-next-auth.session-token.0', value: 'a' }])).toBe(true);
    expect(hasSessionCookie('chatgpt-web', [{ name: 'next-auth.session-token', value: 'a' }])).toBe(true);
    expect(hasSessionCookie('chatgpt-web', [{ name: '__Host-next-auth.csrf-token', value: 'a' }])).toBe(false);
  });

  it('sends requests only to the provider’s own origin', () => {
    expect(sameOrigin('https://claude.ai/api/organizations', 'https://claude.ai')).toBe(true);
    expect(sameOrigin('https://claude.ai.evil.com/api', 'https://claude.ai')).toBe(false);
    expect(sameOrigin('https://chatgpt.com/backend-api/wham/usage', 'https://claude.ai')).toBe(false);
    // The test stub stands in for the site under a path of its own.
    expect(sameOrigin('http://127.0.0.1:9/claude.ai/api/x', 'http://127.0.0.1:9/claude.ai')).toBe(true);
    expect(sameOrigin('http://127.0.0.1:9/chatgpt.com/api/x', 'http://127.0.0.1:9/claude.ai')).toBe(false);
    expect(Object.values(WEB_PROVIDERS).every((w) => w.login.startsWith(w.origin))).toBe(true);
  });

  it('signs in with a plain browser user agent', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) keeper/0.1.0-beta.6 Chrome/140.0.7339.41 Electron/45.2.0 Safari/537.36';
    expect(browserUserAgent(ua)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.41 Safari/537.36');
  });

  it('web providers are their own kind, unofficial and opt-in, labelled honestly', () => {
    for (const id of ['claude-web', 'chatgpt-web'] as const) {
      const p = providerInfo(id);
      expect(isWebProvider(id)).toBe(true);
      expect(p).toMatchObject({ kind: 'web', unofficial: true });
      expect(p.fields).toEqual(expect.arrayContaining(['signIn', 'online']));
      expect(p.optIn?.explain).toMatch(new RegExp(`^Unofficial: uses ${WEB_PROVIDERS[id].site.replace('.', '\\.')}’s own pages; may stop working\\.`));
    }
    expect(isWebProvider('cc')).toBe(false);
    expect(PROVIDERS.filter((p) => p.kind === 'web').map((p) => p.id)).toEqual(['claude-web', 'chatgpt-web']);
  });

  it('names a new account after the signed-in email when left empty', () => {
    expect(defaultWebName('', 'Claude (claude.ai)', 'me@example.com')).toBe('me@example.com');
    expect(defaultWebName('Claude (claude.ai)', 'Claude (claude.ai)', 'me@example.com')).toBe('me@example.com');
    expect(defaultWebName('Claude — Work', 'Claude (claude.ai)', 'me@example.com')).toBe('Claude — Work');
    expect(defaultWebName('', 'Claude (claude.ai)')).toBe('Claude (claude.ai)');
  });
});

describe('what an answer means', () => {
  it('sorts out signed out, a browser check, slow down and the rest', () => {
    expect(webAnswer(200, 'application/json', '{}')).toBe('ok');
    expect(webAnswer(200, 'text/html', '<html>login</html>')).toBe('blocked');
    expect(webAnswer(401, 'application/json', '{"type":"error"}')).toBe('signed-out');
    expect(webAnswer(403, 'application/json', '{"type":"error","error":{"type":"permission_error"}}')).toBe('signed-out');
    expect(webAnswer(403, 'text/html', '<!DOCTYPE html><title>Just a moment...</title>')).toBe('blocked');
    expect(webAnswer(403, 'application/json', '{}', 'challenge')).toBe('blocked');
    expect(webAnswer(429, null, '')).toBe('busy');
    expect(webAnswer(500, null, '')).toBe('error');
  });
});

describe('Claude on claude.ai (unofficial, not verified live)', () => {
  it('reads the organizations, their plans, and picks the paid chat one', () => {
    const orgs = claudeOrgs(json('claude-web-organizations.json'));
    expect(orgs.map((o) => [o.id, o.plan, o.chat])).toEqual([['org-api-1', undefined, false], ['org-max-1', 'Max 20×', true], ['org-team-1', 'Team', true]]);
    expect(pickClaudeOrg(orgs)?.id).toBe('org-team-1');
    expect(pickClaudeOrg(orgs, 'org-max-1')?.id).toBe('org-max-1');
    expect(pickClaudeOrg(orgs, 'gone')?.id).toBe('org-team-1');
    expect(pickClaudeOrg(orgs.filter((o) => !o.chat))?.id).toBe('org-api-1');
    expect(pickClaudeOrg([])).toBeUndefined();
    expect(claudeOrgs({ nope: 1 })).toEqual([]);
    expect(claudeOrgs(null)).toEqual([]);
  });

  it('plans from the rate-limit tier and capabilities', () => {
    expect(claudePlan({ rate_limit_tier: 'default_claude_max_5x' })).toBe('Max 5×');
    expect(claudePlan({ capabilities: ['chat', 'claude_pro'], rate_limit_tier: 'default_claude_ai' })).toBe('Pro');
    expect(claudePlan({ capabilities: ['chat'] })).toBe('Free');
    expect(claudePlan({ capabilities: ['chat', 'claude_max'] })).toBe('Max');
    expect(claudePlan({})).toBeUndefined();
  });

  it('who is signed in, and the memberships in the account answer', () => {
    const acct = json('claude-web-account.json');
    expect(claudeIdentity(acct)).toEqual({ email: 'me@example.com', name: 'Me' });
    expect(claudeOrgs(acct).map((o) => [o.id, o.plan])).toEqual([['org-max-1', 'Max 5×']]);
    expect(claudeIdentity('nonsense')).toEqual({ email: undefined, name: undefined });
  });

  it('maps the usage answer to the tracker’s limits', () => {
    const limits = claudeWebUsage(json('claude-web-usage.json'), NOW);
    expect(limits.map((l) => [l.key, l.label, l.usedPercent])).toEqual([
      ['5h', '5-hour session', 42], ['weekly', 'Weekly (all models)', 81], ['weekly-opus', 'Weekly (Opus)', 12.5], ['weekly-haiku-preview', 'Weekly (Haiku preview)', 3], ['extra', 'Extra usage', 25],
    ]);
    const five = limits[0];
    expect(five.resetsAt).toBe(Date.parse('2026-11-01T14:00:00.512Z'));
    expect(five.windowMs).toBe(5 * H);
    expect(limits[1].windowMs).toBe(7 * D);
    expect(limits.find((l) => l.key === 'extra')).toMatchObject({ used: 12.5, limit: 50, unit: 'usd', resetsAt: Date.UTC(2026, 11, 1) });
    // Null windows (Sonnet, apps) are skipped.
    expect(limits.some((l) => l.key === 'weekly-sonnet' || l.key === 'weekly-apps')).toBe(false);
  });

  it('reads a newer `limits` list too, skipping what it cannot read', () => {
    const limits = claudeWebUsage(json('claude-web-usage-limits.json'), NOW);
    expect(limits.map((l) => [l.key, l.label, l.usedPercent])).toEqual([['5h', '5-hour session', 55], ['weekly', 'Seven day', 20], ['weekly-opus', 'Weekly (Opus)', 64]]);
    expect(limits[0].windowMs).toBe(5 * H);
  });

  it('never throws on odd answers', () => {
    for (const odd of [null, undefined, 'x', 3, [], { five_hour: 'full' }, { five_hour: { utilization: true } }, { limits: 'many' }]) expect(claudeWebUsage(odd, NOW)).toEqual([]);
    expect(claudeWebUsage({ five_hour: { utilization: 140 } }, NOW)[0].usedPercent).toBe(100);
  });
});

describe('ChatGPT on chatgpt.com, with Codex limits (unofficial, not verified live)', () => {
  it('reads the session: token, email, plan and account from the token', () => {
    const s = chatgptSession(json('chatgpt-session.json'));
    expect(s).toMatchObject({ email: 'me@example.com', name: 'Me Example', plan: 'Pro', accountId: 'acc-123', expires: Date.parse('2027-01-30T12:00:00Z') });
    expect(s.accessToken).toMatch(/^ey/);
    expect(jwtClaims('not.a-jwt')).toBeUndefined();
    // Signed out: an empty session.
    expect(chatgptSession({})).toEqual({ accessToken: undefined, email: undefined, name: undefined, plan: undefined, accountId: undefined, expires: undefined });
    expect(chatgptSession(null)).toEqual({});
  });

  it('maps the Codex usage answer to 5-hour, weekly, extras and credits', () => {
    const u = chatgptUsage(json('chatgpt-wham-usage.json'), NOW);
    expect(u.plan).toBe('Pro');
    expect(u.limits.map((l) => [l.key, l.label, l.usedPercent])).toEqual([
      ['5h', '5-hour', 37], ['weekly', 'Weekly', 92], ['review:weekly', 'Code review Weekly', 5], ['codex-spark:5h', 'Codex spark 5-hour', 10], ['credits', 'Credits', undefined],
    ]);
    expect(u.limits[0]).toMatchObject({ resetsAt: 1793556000 * 1000, windowMs: 5 * H });
    expect(u.limits[1].windowMs).toBe(7 * D);
    expect(u.limits.find((l) => l.key === 'credits')).toMatchObject({ used: 12.5, unit: 'credits' });
    // Only the seconds until the reset: counted from now.
    expect(chatgptUsage({ rate_limit: { primary_window: { used_percent: 1, limit_window_seconds: 18000, reset_after_seconds: 60 } } }, NOW).limits[0].resetsAt).toBe(NOW + 60_000);
  });

  it('has no limits (but a plan) when the web gives none', () => {
    expect(chatgptUsage({ plan_type: 'plus', rate_limit: null }, NOW)).toEqual({ plan: 'Plus', limits: [] });
    expect(chatgptUsage('x', NOW)).toEqual({ limits: [] });
  });
});

describe('several accounts of one service', () => {
  const acct = (id: string, provider: Account['provider'], name: string, extra: Partial<Account> = {}): Account => ({ id, provider, name, createdAt: 0, ...extra });

  it('gives each its own letters, from what tells it apart', () => {
    const all = [acct('a', 'claude-web', 'Claude — Work'), acct('b', 'claude-web', 'Claude — Personal'), acct('c', 'codex', 'Codex'), acct('d', 'claude-web', 'Side', { icon: 'S' })];
    expect(all.map((a) => accountGlyph(a, all))).toEqual(['CW', 'CP', 'CX', 'S']);
    const clash = [acct('a', 'claude-web', 'Work one'), acct('b', 'claude-web', 'Work two')];
    expect(clash.map((a) => accountGlyph(a, clash))).toEqual(['C1', 'C2']);
    expect(accountGlyph(acct('e', 'claude-web', 'me@example.com'), [acct('e', 'claude-web', 'me@example.com'), acct('f', 'claude-web', 'you@example.com')])).toBe('CM');
  });

  it('the priority list (and so the glance, the Island and the warnings) carries the account’s name and letters', () => {
    const accounts = [acct('a', 'claude-web', 'Claude — Work'), acct('b', 'claude-web', 'Claude — Personal')];
    const st = (id: string, used: number) => ({ accountId: id, at: NOW, state: 'ok' as const, accuracy: 'exact' as const, source: '', limits: [{ key: '5h', label: '5-hour session', usedPercent: used, resetsAt: NOW + H, windowMs: 5 * H }] });
    const items = prioritize(accounts, { a: st('a', 90), b: st('b', 10) }, {}, defaultTrackerSettings().thresholds, NOW);
    expect(items.map((i) => [i.accountName, i.glyph, i.urgency])).toEqual([['Claude — Work', 'CW', 'running-out'], ['Claude — Personal', 'CP', 'ok']]);
  });
});

describe('the coding CLI’s session files today', () => {
  const lines = claudeTokenLines(text('cc-session-current.jsonl'));

  it('counts each reply once with its largest reading, cache tokens included, and skips notices with no tokens', () => {
    // One reply written per content block; one streamed with growing output; one limit notice.
    expect(lines.map((l) => l.tokens)).toEqual([2 + 200 + 15_000 + 50_000, 5 + 900 + 1000]);
    const [five, week] = ccLocalWindows(lines, NOW);
    expect(five.used).toBe(67_107);
    expect(week.used).toBe(67_107);
  });

  it('adds the nested cache-write tokens only when the total is missing', () => {
    expect(usageTokens({ input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 30, cache_read_input_tokens: 4, cache_creation: { ephemeral_1h_input_tokens: 30 } })).toBe(37);
    expect(usageTokens({ input_tokens: '5', output_tokens: null, cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: 3 } })).toBe(15);
  });

  it('reads a top-level usage and a numeric timestamp too', () => {
    const l = claudeTokenLines(JSON.stringify({ type: 'assistant', timestamp: NOW / 1000, usage: { input_tokens: 10, output_tokens: 5 } }));
    expect(l).toEqual([{ at: NOW, tokens: 15, model: undefined }]);
  });

  it('looks in the newer XDG folder and ~/.claude, or where the tool was pointed', () => {
    expect(claudeDataDirs('/home/me', {})).toEqual(['/home/me/.config/claude', '/home/me/.claude']);
    expect(claudeDataDirs('/home/me', { xdgConfig: '/x' })).toEqual(['/x/claude', '/home/me/.claude']);
    expect(claudeDataDirs('/home/me', { configDir: '/a, /b' })).toEqual(['/a', '/b']);
  });

  it('says what it actually read', () => {
    expect(claudeReadText({ files: 0, replies: 0, weekReplies: 0, where: '~/.claude' })).toBe('No session files from the last week in ~/.claude');
    expect(claudeReadText({ files: 1, replies: 0, weekReplies: 0, where: '~/.claude' })).toBe('Read 1 session file in ~/.claude; none has replies with token counts');
    expect(claudeReadText({ files: 2, replies: 3, weekReplies: 0, where: '~/.claude' })).toBe('Read 2 session files in ~/.claude; no replies in the last 7 days');
    expect(claudeReadText({ files: 2, replies: 3, weekReplies: 3, where: '~/.config/claude and ~/.claude' })).toBe('Counted 3 replies from 2 session files in ~/.config/claude and ~/.claude');
  });
});

describe('account letters across services', () => {
  it('two services whose letters would read the same get the first two letters instead', () => {
    const acct = (id: string, provider: Account['provider'], name: string): Account => ({ id, provider, name, createdAt: 0 });
    const all = [acct('a', 'cc', 'Work'), acct('b', 'cc', 'Personal'), acct('c', 'codex', 'Codex Plus'), acct('d', 'codex', 'Codex Team')];
    expect(all.map((a) => accountGlyph(a, all))).toEqual(['CW', 'Pe', 'Pl', 'CT']);
  });
});
