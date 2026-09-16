-- Collaborators: a second, independent multi-person field on an issue, alongside assignees.
-- Same shape as issue_assignees (profiles join table, full-replace writes) but tracked
-- separately since "who owns this" and "who else is involved" are different questions.

create table issue_collaborators (
  issue_id uuid not null references issues(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (issue_id, profile_id)
);

alter table issue_collaborators enable row level security;
