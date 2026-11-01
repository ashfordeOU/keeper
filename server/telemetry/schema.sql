-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
-- Keeper's usage stats (D1). Apply with:
--   npx wrangler d1 execute keeper-telemetry --remote --file=schema.sql
-- No column holds an address, a header or anything the app did not send.

-- One row per install per day. Raw rows are deleted after 13 months by the daily job.
CREATE TABLE IF NOT EXISTS pings (
  install_id   TEXT    NOT NULL,
  day          TEXT    NOT NULL,          -- YYYY-MM-DD (UTC)
  received_at  INTEGER NOT NULL,          -- ms since 1970
  version      TEXT    NOT NULL,
  channel      TEXT    NOT NULL,
  official     INTEGER NOT NULL,
  via          TEXT    NOT NULL,
  os           TEXT    NOT NULL,
  os_version   TEXT    NOT NULL,
  arch         TEXT    NOT NULL,
  cpu_vendor   TEXT    NOT NULL,
  cpu          TEXT    NOT NULL,
  cores        INTEGER NOT NULL,
  ram_gb       INTEGER NOT NULL,
  gpu          TEXT    NOT NULL,
  form         TEXT    NOT NULL,
  displays     INTEGER NOT NULL,
  notch        INTEGER NOT NULL,
  lang         TEXT    NOT NULL,
  region       TEXT    NOT NULL,
  active       INTEGER NOT NULL,
  days7        INTEGER NOT NULL,
  features     TEXT    NOT NULL,          -- JSON array of feature IDs
  pages        TEXT    NOT NULL,          -- JSON object: page -> count range
  ai_providers INTEGER NOT NULL,
  devices      INTEGER NOT NULL,
  crashes      INTEGER NOT NULL,
  restarts     INTEGER NOT NULL,
  memory       TEXT    NOT NULL,
  cpu_use      TEXT    NOT NULL,
  startup      TEXT    NOT NULL,
  PRIMARY KEY (install_id, day)
);
CREATE INDEX IF NOT EXISTS pings_day ON pings (day);

-- Rate limit per install ID (a fixed one-hour window). Rows older than two days are deleted daily.
CREATE TABLE IF NOT EXISTS rate (
  install_id   TEXT    PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);

-- Aggregates kept for good: counts and percentages only, no install IDs.
CREATE TABLE IF NOT EXISTS daily_summary (
  day     TEXT    PRIMARY KEY,
  daily   INTEGER NOT NULL,
  weekly  INTEGER NOT NULL,
  monthly INTEGER NOT NULL,
  data    TEXT    NOT NULL               -- JSON: the full aggregate for that day
);
