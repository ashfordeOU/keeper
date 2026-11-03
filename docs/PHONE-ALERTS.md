# Alerts to your phone

Phone Alerts (Devices section, feature `phoneAlerts`, off until switched on) sends Keeper's own
alerts to the person's phone through ways they set up. Nothing is sent until a way is added and
an alert it is set up for happens.

## Ways to reach you

| Kind | What the person enters | What Keeper sends |
|---|---|---|
| **ntfy** | a topic; under More settings a server (default `https://ntfy.sh`) and an access token | `POST <server>/<topic>`, the text as the body, `Title`, `Priority` (`high` for problems) and `Tags` headers; `Authorization: Bearer` when a token is set |
| **Telegram** | the bot token (from @BotFather) and the chat (a number or `@channel`) | `POST https://api.telegram.org/bot<token>/sendMessage` with `chat_id` and `text`; problems ring, the rest arrive silently |
| **E-mail** | a Mail account to send from and the address to send to | a plain mail through Mail's own outbox (`pim.send`, no signature) |
| **Web address** | an `https://` address (plain `http://` only on this computer or the home network); a secret under More settings | `POST` JSON `{ app, title, text, urgent, alerts: [{ source, title, detail, urgent, at }] }`; the secret as `Authorization: Bearer` |

Each way has its own **Send me** choices: Site and server checks (Monitors), Backups,
Automations, Focus and time, Fix-it List. **Send a test** delivers a test message at once and the
card shows the last delivery ("Delivered 2 min ago" or what went wrong, in plain words).

## Where alerts come from

Other parts call `phoneAlert(source, title, detail, { urgent, good })` (electron/services/phone-alerts.ts).
It returns straight away and does nothing while the part is off or no way is set up for that source.

| Source | When |
|---|---|
| `monitors` | a monitor goes down, comes back, or a certificate is about to expire (docs/SITE-MONITORS.md) |
| `backups` | a backup fails (not for a missing password, which waits for the person), and when it works again |
| `automations` | an automation ran by itself and moved, trashed or tagged files (or some could not be) |
| `focus` | everything the Island says about focus: a session done, a break over, strict mode, blocking |
| `fixit` | a new critical or high item on the Fix-it List |

## Calm by design

- **Batched.** Alerts that come within 30 seconds of the first go out as one message per way
  ("3 alerts from Keeper", the problems first, at most 12 lines). Settings → General → Phone alerts →
  *Send alerts together* (More settings): right away, 30 s, 2 or 10 minutes. At most 50 wait.
- **Plain errors.** Telegram's 401 becomes "Telegram did not accept the bot token", 403 on ntfy
  "The ntfy server wants an access token for this topic"; a 429 asks Keeper to slow down.
- **Off means off.** Switching the part off drops whatever was waiting.

## Secrets

Bot tokens, ntfy access tokens and webhook secrets are saved with the system keychain
(`alerts.<channel id>` in Keeper's sealed secrets), never in `settings.json`. Where the computer has
no keychain (Linux without a keyring) they are kept in memory until Keeper quits, and the page says
so. They are never shown again (the field says "Saved. Type to replace it."), and `scrubSecret` keeps
them out of any error text. Removing a way deletes its token.

## Network

Requests carry `User-Agent: Keeper/<version>`, time out after 20 seconds, do not follow
redirects, and are checked against Keeper's firewall rules first (a blocked host is reported, not
contacted).

## Code

- `core/phone-alerts.ts`: channel kinds, checks, batching, the request for each kind, reply
  meanings, secret scrubbing (tests: `test/phone-alerts.test.ts`).
- `core/api-alerts.ts`, `electron/ipc/phone-alerts.ts`, `electron/services/phone-alerts.ts`.
- `src/screens/PhoneAlerts.tsx`, `src/styles/alerts.css`; end to end: `test/e2e/phone-alerts.cjs`.
