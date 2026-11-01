// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A local stand-in for a Standard Notes sync server, for tests. It answers the
// endpoints Keeper uses, the way the real server does (see the notes in
// core/notes-sync/connectors/standardnotes.ts), from a recorded account
// (sn-account.json: key params, the hash of the derived server password, and
// 004 ciphertext items). It cannot read any note: it only stores what it gets,
// and it records every request body so a test can check that no plain text
// was ever sent.
//
//   const s = await startStandin({ account, mfaCode: '123456', pageSize: 2 });
//   s.url, s.items(), s.requests, s.expireAccess(), s.revoke(), s.put(item), s.close()

const http = require('node:http');
const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = () => crypto.randomBytes(24).toString('hex');

async function startStandin({ account, mfaCode, pageSize = 150 }) {
  const items = new Map(account.items.map((i) => [i.uuid, { ...i }]));
  const pkce = new Map(); // challenge → email
  const sessions = new Map(); // access → { refresh, expired }
  const requests = [];
  let clock = Math.max(...account.items.map((i) => i.updated_at_timestamp || 0));
  const tick = () => (clock = Math.max(clock + 1, Date.now() * 1000));
  const cursors = new Map();

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const err = (res, status, tag, message, payload) => send(res, status, { error: { tag, message, ...(payload ? { payload } : {}) } });
  const mfaOk = (b) => !mfaCode || b.mfa_code === mfaCode || b[`mfa_${account.email}`] === mfaCode;
  const newSession = () => {
    const s = { access: token(), refresh: token(), expired: false };
    sessions.set(s.access, s);
    return { access_token: s.access, refresh_token: s.refresh, access_expiration: Date.now() + 3600_000, refresh_expiration: Date.now() + 86400_000, readonly_access: false };
  };
  const meta = (it) => ({ uuid: it.uuid, content_type: it.content_type, created_at: it.created_at, created_at_timestamp: it.created_at_timestamp, updated_at: it.updated_at, updated_at_timestamp: it.updated_at_timestamp, deleted: it.deleted, items_key_id: it.items_key_id });

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      let b = {};
      try { b = raw ? JSON.parse(raw) : {}; } catch { return err(res, 400, 'invalid-parameters', 'Bad JSON'); }
      const url = new URL(req.url, 'http://x');
      requests.push({ path: url.pathname, body: raw, auth: req.headers.authorization });
      if (req.method !== 'POST') return err(res, 404, 'not-found', 'Not found');

      if (url.pathname === '/v2/login-params') {
        if (b.email !== account.email) return err(res, 401, 'invalid-auth', 'Invalid email or password');
        if (mfaCode && !b.mfa_code && !b[`mfa_${account.email}`]) return err(res, 401, 'mfa-required', 'Please enter your two-factor authentication code.', { mfa_key: `mfa_${account.email}` });
        if (!mfaOk(b)) return err(res, 401, 'mfa-invalid', 'The two-factor authentication code you entered is incorrect.');
        if (!/^[A-Za-z0-9_-]{86}$/.test(b.code_challenge || '')) return err(res, 400, 'invalid-parameters', 'Missing code challenge');
        pkce.set(b.code_challenge, b.email);
        return send(res, 200, { data: { ...account.keyParams } });
      }
      if (url.pathname === '/v2/login') {
        const challenge = Buffer.from(sha256(String(b.code_verifier || ''))).toString('base64url');
        if (pkce.get(challenge) !== b.email) return err(res, 401, 'invalid-auth', 'Invalid login credentials.');
        pkce.delete(challenge);
        if (sha256(String(b.password || '')) !== account.serverPasswordSha256) return err(res, 401, 'invalid-auth', 'Invalid email or password');
        return send(res, 200, { data: { session: newSession(), key_params: account.keyParams, user: { uuid: 'u-1', email: account.email } } });
      }
      if (url.pathname === '/v1/sessions/refresh') {
        const s = sessions.get(b.access_token);
        if (!s || s.refresh !== b.refresh_token) return err(res, 400, 'invalid-refresh-token', 'Invalid refresh token');
        sessions.delete(b.access_token);
        return send(res, 200, { data: { session: newSession() } });
      }
      const auth = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      const s = auth && sessions.get(auth[1]);
      if (!s) return err(res, 401, 'invalid-auth', 'Invalid login credentials.');
      if (s.expired) return err(res, 498, 'expired-access-token', 'The provided access token has expired.');

      if (url.pathname === '/v1/items') {
        const saved = [];
        const conflicts = [];
        for (const it of b.items || []) {
          const have = items.get(it.uuid);
          if (have && have.updated_at_timestamp !== it.updated_at_timestamp) {
            conflicts.push({ type: 'sync_conflict', server_item: have, unsaved_item: it });
            continue;
          }
          const t = tick();
          const stored = { ...it, updated_at_timestamp: t, updated_at: new Date(t / 1000).toISOString(), created_at_timestamp: have?.created_at_timestamp ?? it.created_at_timestamp ?? t, created_at: have?.created_at ?? it.created_at };
          items.set(it.uuid, stored);
          saved.push(meta(stored));
        }
        const savedIds = new Set(saved.map((x) => x.uuid));
        let list;
        let start = 0;
        if (b.cursor_token && cursors.has(b.cursor_token)) ({ list, start } = cursors.get(b.cursor_token));
        else {
          const since = b.sync_token ? Number(Buffer.from(b.sync_token, 'base64').toString()) : -1;
          list = [...items.values()].filter((i) => i.updated_at_timestamp > since && !savedIds.has(i.uuid)).sort((x, y) => x.updated_at_timestamp - y.updated_at_timestamp);
        }
        const page = list.slice(start, start + Math.min(pageSize, b.limit || 150));
        let cursor;
        if (start + page.length < list.length) {
          cursor = token();
          cursors.set(cursor, { list, start: start + page.length });
        }
        return send(res, 200, { data: { retrieved_items: page, saved_items: saved, conflicts, sync_token: Buffer.from(String(clock)).toString('base64'), cursor_token: cursor } });
      }
      if (url.pathname === '/v1/logout') {
        sessions.delete(auth[1]);
        return send(res, 204, {});
      }
      return err(res, 404, 'not-found', 'Not found');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    requests,
    items: () => [...items.values()],
    /** a change made on another device (already sealed) */
    put(it) {
      const t = tick();
      items.set(it.uuid, { ...it, updated_at_timestamp: t, updated_at: new Date(t / 1000).toISOString() });
    },
    expireAccess() { for (const s of sessions.values()) s.expired = true; },
    revoke() { sessions.clear(); },
    sessions: () => sessions.size,
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { startStandin };
