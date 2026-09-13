-- Slack ingest: provenance + idempotency for issues captured from Slack.
--
-- The partial unique index is the whole point. Ingest can be triggered more than once for the
-- same bug — a second 🐛 reaction, someone re-typing "@bugtracker add", or Slack replaying an
-- event after a slow ack (it retries up to 3x). Keying on (channel, message ts) makes every
-- one of those a no-op that resolves to the issue that already exists, so the handler never
-- has to reason about whether it is a first delivery or a retry.
--
-- Nullable + partial so issues created in the app are unaffected: many rows have NULL here and
-- NULLs would otherwise collide under a plain unique constraint.

alter table issues
  add column if not exists slack_channel_id text,
  add column if not exists slack_message_ts text;

create unique index if not exists issues_slack_message_key
  on issues (slack_channel_id, slack_message_ts)
  where slack_channel_id is not null and slack_message_ts is not null;

comment on column issues.slack_channel_id is
  'Slack channel the bug was captured from (e.g. C31A2FA3F = #product-critical-bugs). NULL for issues created in the app.';
comment on column issues.slack_message_ts is
  'ts of the Slack message that IS the bug report — the thread parent, not the triggering reply. With slack_channel_id, the ingest dedupe key.';
