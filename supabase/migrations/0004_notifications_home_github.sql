-- Watching, mentions, home/favorites, dashboards and GitHub PR links.
--
-- Five unrelated-looking features land in one migration because they share a spine: all of
-- them are per-profile state that used to live nowhere (watchers, stars, dashboards) or in
-- one browser's localStorage (saved views), and three of them feed the same Slack DM path.
--
-- The notification design worth knowing before touching notification_outbox: a DM is not sent
-- when an event happens. The event is appended to an open batch for that (issue, recipient)
-- pair and the batch is sent once, later, so "assigned you, moved it to In review, commented"
-- is one DM rather than three. The partial unique index below IS that batching rule -- there
-- can only ever be one unsent row per pair, so enqueue is an upsert that appends to `events`.

-- Slack identity, cached on the profile. Resolving an email to a Slack user costs an API call
-- (users.lookupByEmail) and the answer never changes, so the first lookup writes it back here
-- and every later DM skips straight to conversations.open -- or skips even that, once the DM
-- channel id is known too.
alter table profiles
  add column if not exists slack_user_id text unique,
  add column if not exists slack_dm_channel_id text;

comment on column profiles.slack_user_id is
  'Slack user id (U...), filled in lazily from users.lookupByEmail. NULL means "not looked up yet or no Slack account with this email" -- notifications for this profile are skipped silently.';
comment on column profiles.slack_dm_channel_id is
  'IM channel id (D...) from conversations.open, cached so repeat DMs are a single chat.postMessage.';

-- Who hears about an issue. `source` is provenance only -- a row is a row regardless of how
-- it got here -- but it lets the UI explain why someone is watching, and keeps an explicit
-- manual watch from looking identical to an incidental one.
create table issue_watchers (
  issue_id uuid not null references issues(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  source text not null default 'manual'
    check (source in ('manual', 'author', 'assignee', 'comment', 'mention')),
  created_at timestamptz not null default now(),
  primary key (issue_id, profile_id)
);
create index issue_watchers_profile_idx on issue_watchers (profile_id);

create table starred_issues (
  profile_id uuid not null references profiles(id) on delete cascade,
  issue_id uuid not null references issues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, issue_id)
);

-- Saved views were localStorage (src/model/views.ts), so they were per-browser and invisible
-- on a second device. Same shape, now per profile. `filters` is the same JSON that
-- encodeFilters() puts in the URL, so a row round-trips through viewHref() unchanged.
create table saved_views (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  path text not null,
  filters jsonb not null default '{}'::jsonb,
  group_by text not null default 'Status',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index saved_views_profile_idx on saved_views (profile_id, created_at);

-- `widgets` is [{id, measure, title?, stat?, groupBy?}] -- see Widget in shared/types.ts.
-- Deliberately schemaless: a widget is a tiny description of which src/model/analytics.ts
-- helper to run over the board the client already has, not a stored query.
create table dashboards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  widgets jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dashboards_profile_idx on dashboards (profile_id, created_at);

create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  events jsonb not null default '[]'::jsonb,
  flush_after timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- The coalescing key: at most one open batch per (issue, recipient). Partial so sent rows
-- accumulate as history without ever colliding.
create unique index notification_outbox_open_key
  on notification_outbox (issue_id, profile_id)
  where sent_at is null;
create index notification_outbox_due_idx
  on notification_outbox (flush_after)
  where sent_at is null;

comment on column notification_outbox.events is
  'Appended batch: [{kind, actor, detail, at}]. One DM summarises the whole array.';
comment on column notification_outbox.flush_after is
  'Earliest send time. Set on insert to now() + the coalescing window; later events join the batch without extending it, so a busy issue cannot delay its own DM indefinitely.';

-- A PR can reference several issues ("RAD-12 and RAD-14 fix login"), and an issue can have
-- several PRs, so the unique key includes issue_id -- one row per (PR, issue) edge.
create table issue_pull_requests (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  repo text not null,
  number int not null,
  url text not null,
  title text not null default '',
  state text not null check (state in ('open', 'merged', 'closed')),
  draft boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (repo, number, issue_id)
);
create index issue_pull_requests_issue_idx on issue_pull_requests (issue_id);

comment on column issue_pull_requests.repo is 'owner/name, from the webhook payload''s repository.full_name.';
comment on column issue_pull_requests.state is
  'open | merged | closed. GitHub reports a merge as action=closed with merged=true, which is flattened to ''merged'' here because the two mean opposite things for auto-status.';

-- RLS, following 0002: the API talks to Postgres directly (api/_lib/db/pool.ts) as a role
-- that bypasses RLS, and nothing here is read through PostgREST. Enabling RLS with zero
-- policies is therefore deny-all for anon/authenticated -- the public anon key gets nothing.
alter table issue_watchers enable row level security;
alter table starred_issues enable row level security;
alter table saved_views enable row level security;
alter table dashboards enable row level security;
alter table notification_outbox enable row level security;
alter table issue_pull_requests enable row level security;
