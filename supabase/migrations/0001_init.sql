-- Radius Bugtracker — initial schema for the Supabase cutover.
-- Field values on `issues.fields` are stored per field_defs.id as:
--   singleSelect -> {"optionId": "<field_options.id>"}
--   multiSelect  -> {"optionIds": ["<field_options.id>", ...]}
--   date         -> {"date": "2026-01-01"}
--   text         -> {"text": "..."}
--   number       -> {"number": 3}
-- Unset fields are simply absent from the object.
--
-- Every write path (API routes) must run `select set_config('app.current_profile_id', $1, true)`
-- at the start of the request/transaction so activity-log triggers can attribute the change to
-- the acting user. See api/_lib/db/board.ts.

create extension if not exists pgcrypto;

-- ============================================================================
-- Identity
-- ============================================================================

create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  display_name text,
  avatar_url text,
  github_login text unique,        -- shadow column, populated only by the one-off migration
  allowed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_email_key unique (email)
);

create or replace function current_profile_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.current_profile_id', true), '')::uuid
$$;

-- Claims a pre-seeded placeholder profile (created by the migration script) on first real
-- sign-in instead of creating a duplicate identity. Domain check is intentionally baked in
-- here rather than read from an env var; changing the allowed domain needs a new migration.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (auth_user_id, email, display_name, avatar_url, allowed)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    lower(new.email) like '%@radiusagent.com'
  )
  on conflict (email) do update set
    auth_user_id = excluded.auth_user_id,
    avatar_url = coalesce(profiles.avatar_url, excluded.avatar_url),
    display_name = coalesce(profiles.display_name, excluded.display_name),
    allowed = profiles.allowed or excluded.allowed;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- Field schema (seeded 1:1 from fields.config.ts by the migration/provision script)
-- ============================================================================

create table field_defs (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  data_type text not null check (data_type in ('SINGLE_SELECT','MULTI_SELECT','DATE','TEXT','NUMBER')),
  sort_order int not null
);

create table field_options (
  id uuid primary key default gen_random_uuid(),
  field_def_id uuid not null references field_defs(id) on delete cascade,
  name text not null,
  color text not null check (color in ('GRAY','BLUE','GREEN','YELLOW','ORANGE','RED','PINK','PURPLE')),
  description text not null default '',
  sort_order int not null,          -- meaningful: board-column / priority-rank order
  closes_as text check (closes_as in ('COMPLETED','NOT_PLANNED','DUPLICATE')),
  unique (field_def_id, name)
);
create index on field_options (field_def_id, sort_order);

create table labels (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  color text not null
);

-- ============================================================================
-- Issues
-- ============================================================================

create sequence issues_number_seq;

create table issues (
  id uuid primary key default gen_random_uuid(),
  number int not null default nextval('issues_number_seq') unique,
  github_issue_id text unique,      -- traceability shadow column, set only by the migration
  title text not null,
  body text not null default '',
  state text not null default 'OPEN' check (state in ('OPEN','CLOSED')),
  state_reason text check (state_reason in ('COMPLETED','NOT_PLANNED','REOPENED','DUPLICATE')),
  author_id uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  is_archived boolean not null default false,
  parent_issue_id uuid references issues(id) on delete set null,
  position double precision not null,
  fields jsonb not null default '{}'::jsonb,
  sub_issues_total int not null default 0,
  sub_issues_completed int not null default 0
);
create index on issues (state);
create index on issues (is_archived);
create index on issues (parent_issue_id);
create index on issues (position);
create index on issues (updated_at desc);
create index on issues using gin (fields);

-- Postgres doesn't allow a subquery in a column DEFAULT, so initial position (append to the
-- end of the board) is assigned by a trigger instead; explicit inserts (the migration script)
-- pass their own position and are left untouched.
create or replace function issues_set_initial_position()
returns trigger language plpgsql as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1000 into new.position from issues;
  end if;
  return new;
end;
$$;

create trigger trg_issues_set_initial_position
  before insert on issues
  for each row execute function issues_set_initial_position();

create table issue_labels (
  issue_id uuid not null references issues(id) on delete cascade,
  label_id uuid not null references labels(id) on delete cascade,
  primary key (issue_id, label_id)
);

create table issue_assignees (
  issue_id uuid not null references issues(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (issue_id, profile_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  author_id uuid references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index on comments (issue_id, created_at);

create table reactions (
  subject_type text not null check (subject_type in ('issue','comment')),
  subject_id uuid not null,
  content text not null check (content in
    ('THUMBS_UP','THUMBS_DOWN','LAUGH','HOORAY','CONFUSED','HEART','ROCKET','EYES')),
  profile_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  primary key (subject_type, subject_id, content, profile_id)
);
create index on reactions (subject_type, subject_id);

-- The 14 non-comment ActivityKind values; comments are unioned in via activity_feed below.
create table activity_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  kind text not null check (kind in
    ('closed','reopened','assigned','unassigned','labeled','unlabeled','renamed',
     'status','sub-issue-added','sub-issue-removed','parent-added','parent-removed','duplicate')),
  actor_id uuid references profiles(id),
  detail text,
  from_value text,
  to_value text,
  url text,
  created_at timestamptz not null default now()
);
create index on activity_events (issue_id, created_at);

create view activity_feed as
  select id, issue_id, 'comment'::text as kind, author_id as actor_id, body,
         null::text as detail, null::text as from_value, null::text as to_value,
         null::text as url, created_at
  from comments
  union all
  select id, issue_id, kind, actor_id, null, detail, from_value, to_value, url, created_at
  from activity_events;

-- ============================================================================
-- Triggers: status <-> state sync (replaces CLOSING_STATUSES name-matching)
-- ============================================================================

create or replace function issues_sync_state_and_status()
returns trigger language plpgsql as $$
declare
  status_field_id uuid;
  old_status_option_id uuid;
  new_status_option_id uuid;
  closes text;
  target_option_id uuid;
begin
  select id into status_field_id from field_defs where name = 'Status';
  if status_field_id is null then
    return new;
  end if;

  old_status_option_id := (old.fields -> status_field_id::text ->> 'optionId')::uuid;
  new_status_option_id := (new.fields -> status_field_id::text ->> 'optionId')::uuid;

  if new_status_option_id is distinct from old_status_option_id and new_status_option_id is not null then
    select closes_as into closes from field_options where id = new_status_option_id;
    if closes is not null then
      new.state := 'CLOSED';
      new.state_reason := closes;
      new.closed_at := coalesce(new.closed_at, now());
    else
      new.state := 'OPEN';
      new.state_reason := null;
      new.closed_at := null;
    end if;
  elsif new.state is distinct from old.state or new.state_reason is distinct from old.state_reason then
    if new.state = 'CLOSED' then
      select fo.id into target_option_id from field_options fo
        where fo.field_def_id = status_field_id
          and (
            (new.state_reason = 'COMPLETED' and lower(fo.name) = 'done')
            or (new.state_reason in ('NOT_PLANNED','DUPLICATE') and lower(fo.name) in ('canceled', 'cancelled'))
          )
        order by fo.sort_order limit 1;
    else
      select fo.id into target_option_id from field_options fo
        where fo.field_def_id = status_field_id and lower(fo.name) = 'todo'
        order by fo.sort_order limit 1;
    end if;
    if target_option_id is not null then
      new.fields := jsonb_set(new.fields, array[status_field_id::text], jsonb_build_object('optionId', target_option_id));
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_issues_sync_state_and_status
  before update on issues
  for each row execute function issues_sync_state_and_status();

-- ============================================================================
-- Triggers: activity log
-- ============================================================================

create or replace function issues_activity()
returns trigger language plpgsql as $$
declare
  status_field_id uuid;
  old_status_opt uuid;
  new_status_opt uuid;
  old_status_name text;
  new_status_name text;
  actor uuid := current_profile_id();
begin
  if new.title is distinct from old.title then
    insert into activity_events (issue_id, kind, actor_id, from_value, to_value)
    values (new.id, 'renamed', actor, old.title, new.title);
  end if;

  if new.state = 'CLOSED' and old.state = 'OPEN' then
    insert into activity_events (issue_id, kind, actor_id)
    values (new.id, case when new.state_reason = 'DUPLICATE' then 'duplicate' else 'closed' end, actor);
  elsif new.state = 'OPEN' and old.state = 'CLOSED' then
    insert into activity_events (issue_id, kind, actor_id) values (new.id, 'reopened', actor);
  end if;

  select id into status_field_id from field_defs where name = 'Status';
  if status_field_id is not null then
    old_status_opt := (old.fields -> status_field_id::text ->> 'optionId')::uuid;
    new_status_opt := (new.fields -> status_field_id::text ->> 'optionId')::uuid;
    if new_status_opt is distinct from old_status_opt then
      select name into old_status_name from field_options where id = old_status_opt;
      select name into new_status_name from field_options where id = new_status_opt;
      insert into activity_events (issue_id, kind, actor_id, from_value, to_value)
      values (new.id, 'status', actor, old_status_name, new_status_name);
    end if;
  end if;

  if new.parent_issue_id is distinct from old.parent_issue_id then
    if old.parent_issue_id is not null then
      insert into activity_events (issue_id, kind, actor_id, to_value) values (new.id, 'parent-removed', actor, old.parent_issue_id::text);
      insert into activity_events (issue_id, kind, actor_id, to_value) values (old.parent_issue_id, 'sub-issue-removed', actor, new.id::text);
    end if;
    if new.parent_issue_id is not null then
      insert into activity_events (issue_id, kind, actor_id, to_value) values (new.id, 'parent-added', actor, new.parent_issue_id::text);
      insert into activity_events (issue_id, kind, actor_id, to_value) values (new.parent_issue_id, 'sub-issue-added', actor, new.id::text);
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_issues_activity
  after update on issues
  for each row execute function issues_activity();

create or replace function issue_labels_activity()
returns trigger language plpgsql as $$
declare
  label_name text;
begin
  if tg_op = 'INSERT' then
    select name into label_name from labels where id = new.label_id;
    insert into activity_events (issue_id, kind, actor_id, detail) values (new.issue_id, 'labeled', current_profile_id(), label_name);
    update issues set updated_at = now() where id = new.issue_id;
    return new;
  else
    select name into label_name from labels where id = old.label_id;
    insert into activity_events (issue_id, kind, actor_id, detail) values (old.issue_id, 'unlabeled', current_profile_id(), label_name);
    update issues set updated_at = now() where id = old.issue_id;
    return old;
  end if;
end;
$$;

create trigger trg_issue_labels_activity
  after insert or delete on issue_labels
  for each row execute function issue_labels_activity();

create or replace function issue_assignees_activity()
returns trigger language plpgsql as $$
declare
  assignee_name text;
begin
  if tg_op = 'INSERT' then
    select coalesce(display_name, email) into assignee_name from profiles where id = new.profile_id;
    insert into activity_events (issue_id, kind, actor_id, detail) values (new.issue_id, 'assigned', current_profile_id(), assignee_name);
    update issues set updated_at = now() where id = new.issue_id;
    return new;
  else
    select coalesce(display_name, email) into assignee_name from profiles where id = old.profile_id;
    insert into activity_events (issue_id, kind, actor_id, detail) values (old.issue_id, 'unassigned', current_profile_id(), assignee_name);
    update issues set updated_at = now() where id = old.issue_id;
    return old;
  end if;
end;
$$;

create trigger trg_issue_assignees_activity
  after insert or delete on issue_assignees
  for each row execute function issue_assignees_activity();

create or replace function comments_touch_issue()
returns trigger language plpgsql as $$
begin
  update issues set updated_at = now() where id = new.issue_id;
  return new;
end;
$$;

create trigger trg_comments_touch_issue
  after insert on comments
  for each row execute function comments_touch_issue();

-- ============================================================================
-- Triggers: parent-cycle guard + sub-issue progress counters
-- ============================================================================

create or replace function prevent_parent_cycle()
returns trigger language plpgsql as $$
declare
  cursor_id uuid;
begin
  if new.parent_issue_id is null then
    return new;
  end if;
  if new.parent_issue_id = new.id then
    raise exception 'An issue cannot be its own parent';
  end if;
  cursor_id := new.parent_issue_id;
  loop
    select parent_issue_id into cursor_id from issues where id = cursor_id;
    exit when cursor_id is null;
    if cursor_id = new.id then
      raise exception 'Parent assignment would create a cycle';
    end if;
  end loop;
  return new;
end;
$$;

create trigger trg_prevent_parent_cycle
  before update of parent_issue_id on issues
  for each row execute function prevent_parent_cycle();

create or replace function recompute_sub_issue_counters(p_parent_id uuid)
returns void language sql as $$
  update issues set
    sub_issues_total = (select count(*) from issues where parent_issue_id = p_parent_id),
    sub_issues_completed = (select count(*) from issues where parent_issue_id = p_parent_id and state = 'CLOSED')
  where id = p_parent_id;
$$;

create or replace function sub_issue_counters()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.parent_issue_id is not null then perform recompute_sub_issue_counters(old.parent_issue_id); end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.parent_issue_id is not null then perform recompute_sub_issue_counters(new.parent_issue_id); end if;
    return new;
  end if;

  if new.parent_issue_id is distinct from old.parent_issue_id then
    if old.parent_issue_id is not null then perform recompute_sub_issue_counters(old.parent_issue_id); end if;
    if new.parent_issue_id is not null then perform recompute_sub_issue_counters(new.parent_issue_id); end if;
  elsif new.state is distinct from old.state and new.parent_issue_id is not null then
    perform recompute_sub_issue_counters(new.parent_issue_id);
  end if;
  return new;
end;
$$;

create trigger trg_sub_issue_counters
  after insert or update or delete on issues
  for each row execute function sub_issue_counters();

-- ============================================================================
-- Manual ordering
-- ============================================================================

create or replace function move_item(p_id uuid, p_after_id uuid default null)
returns void language plpgsql as $$
declare
  before_pos double precision;
  after_pos double precision;
  new_pos double precision;
  gap double precision;
begin
  if p_after_id is null then
    select min(position) into before_pos from issues where id != p_id;
    new_pos := coalesce(before_pos, 1000) - 1000;
  else
    select position into after_pos from issues where id = p_after_id;
    select min(position) into before_pos from issues where position > after_pos and id != p_id;

    if before_pos is null then
      new_pos := after_pos + 1000;
    else
      gap := before_pos - after_pos;
      if gap < 0.0001 then
        with ranked as (
          select id, row_number() over (order by position) as rn from issues
        )
        update issues set position = ranked.rn * 1000
        from ranked where issues.id = ranked.id;

        select position into after_pos from issues where id = p_after_id;
        select min(position) into before_pos from issues where position > after_pos and id != p_id;
        new_pos := coalesce((after_pos + before_pos) / 2, after_pos + 1000);
      else
        new_pos := (after_pos + before_pos) / 2;
      end if;
    end if;
  end if;

  update issues set position = new_pos where id = p_id;
end;
$$;

-- ============================================================================
-- Row Level Security
--
-- All application reads/writes go through the Vercel API using a service-role /
-- direct DB connection that bypasses RLS (see api/_lib/db/pool.ts). RLS only
-- matters for the one thing the browser talks to Supabase directly for: the
-- Realtime subscription on `issues` (see src/api/realtime.ts). Every other
-- table is RLS-enabled with no policies, i.e. denied to anon/authenticated,
-- so a stray client-side supabase-js call can't read or write anything.
-- ============================================================================

alter table profiles enable row level security;
alter table field_defs enable row level security;
alter table field_options enable row level security;
alter table labels enable row level security;
alter table issues enable row level security;
alter table issue_labels enable row level security;
alter table issue_assignees enable row level security;
alter table comments enable row level security;
alter table reactions enable row level security;
alter table activity_events enable row level security;

create policy "allowed profiles can read issues via realtime"
  on issues for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where profiles.auth_user_id = auth.uid()
        and profiles.allowed = true
    )
  );
