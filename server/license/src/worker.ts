// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's license server, a Cloudflare Worker with a KV namespace. Written and
// tested, not deployed: README.md says how, for when Keeper Pro is switched on.
//
//   POST /v1/webhook/lemonsqueezy | /v1/webhook/paddle   the provider's signed webhook
//   POST /v1/refresh     { token }          the newest token for a license
//   POST /v1/activate    { token, seat }    counts a computer against the seats
//   POST /v1/deactivate  { token, seat }    frees it (to move the license)
//   POST /v1/restore     { email }          e-mails that address its licenses again
//
// Like the usage stats server, it never reads or logs the client's address.

import { activate, deactivate, newId, refresh, restore, webhook, type Deps, type Mail, type Reply } from './logic';
import type { PaidPlan } from '../../../core/pro/license';

interface KV { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
export interface Env {
  LICENSES: KV;
  /** secrets (wrangler secret put …) */
  LICENSE_PRIVATE_KEY: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_API_KEY?: string;
  EMAIL_API_KEY?: string;
  /** plain settings (wrangler.toml [vars]) */
  LICENSE_PUBLIC_KEY: string;
  /** JSON: provider product/variant/price id → "pro" or "team" */
  PLANS: string;
  /** an e-mail service that takes { from, to, subject, text } with a bearer key */
  EMAIL_API_URL?: string;
  EMAIL_FROM?: string;
  PADDLE_API_URL?: string;
}

const MAX_BODY = 64 * 1024;
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const reply = (r: Reply) => new Response(JSON.stringify(r.body), { status: r.status, headers: HEADERS });

export function deps(env: Env, fetcher: typeof fetch = fetch): Deps {
  let plans: Record<string, PaidPlan> = {};
  try { plans = JSON.parse(env.PLANS || '{}'); } catch { /* no plans: every webhook is ignored */ }
  return {
    store: env.LICENSES,
    privateKey: env.LICENSE_PRIVATE_KEY,
    publicKey: env.LICENSE_PUBLIC_KEY,
    secrets: { lemonsqueezy: env.LEMONSQUEEZY_WEBHOOK_SECRET, paddle: env.PADDLE_WEBHOOK_SECRET },
    plans,
    async send(m: Mail) {
      if (!env.EMAIL_API_URL || !env.EMAIL_API_KEY) throw new Error('No e-mail service set up');
      const res = await fetcher(env.EMAIL_API_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.EMAIL_API_KEY}` }, body: JSON.stringify({ from: env.EMAIL_FROM ?? 'Keeper <keeper@ashforde.org>', to: m.to, subject: m.subject, text: m.text }) });
      if (!res.ok) throw new Error(`E-mail service said ${res.status}`);
    },
    async customerEmail(provider, customerId) {
      if (provider !== 'paddle' || !env.PADDLE_API_KEY) return null;
      const res = await fetcher(`${env.PADDLE_API_URL ?? 'https://api.paddle.com'}/customers/${encodeURIComponent(customerId)}`, { headers: { authorization: `Bearer ${env.PADDLE_API_KEY}` } });
      if (!res.ok) return null;
      const j = (await res.json()) as { data?: { email?: string } };
      return j.data?.email ?? null;
    },
    now: () => Date.now(),
    randomId: () => newId(crypto.getRandomValues(new Uint8Array(12))),
  };
}

async function body(req: Request): Promise<string | null> {
  const text = await req.text();
  return text.length > MAX_BODY ? null : text;
}

export async function handle(req: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method !== 'POST') return reply({ status: 405, body: { error: 'POST only' } });
  const raw = await body(req);
  if (raw === null) return reply({ status: 413, body: { error: 'Too large' } });
  const d = deps(env, fetcher);
  const hook = pathname.match(/^\/v1\/webhook\/([a-z]+)$/);
  if (hook) return reply(await webhook(d, hook[1], raw, (n) => req.headers.get(n)));
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw); } catch { return reply({ status: 400, body: { error: 'Not JSON' } }); }
  switch (pathname) {
    case '/v1/refresh': return reply(await refresh(d, j));
    case '/v1/activate': return reply(await activate(d, j));
    case '/v1/deactivate': return reply(await deactivate(d, j));
    case '/v1/restore': return reply(await restore(d, j));
  }
  return reply({ status: 404, body: { error: 'Not found' } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env).catch(() => reply({ status: 500, body: { error: 'Server error' } }));
  },
};
