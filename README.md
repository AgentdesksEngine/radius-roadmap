# Radius Roadmap · Bugtracker

A Linear-style frontend for Radius's bug and feature-request tracker.
**Supabase Postgres is the source of truth** (see `supabase/migrations/0001_init.sql`); every
card is a row in `issues`, every column a `field_defs`/`field_options` pair. The app previously
ran on GitHub Projects v2 — see `docs/` history / git log for that era, and
`scripts/migrate-github-to-supabase.ts` for the one-off migration between the two.

- App: https://bugtracker.radiusagents.com (internal, Google/@radiusagent.com sign-in)

## Views

| View            | What it is for                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intake**      | Triage queue: every open issue still missing a Team, Priority or Work type. Accept moves it to Todo, Decline cancels it, Archive hides it.                                          |
| **Board**       | Kanban, grouped by any single-select field or by assignee. Drag between columns to set the field; in **Manual** order, drag inside a column to set the item's own position. |
| **List**        | Sortable table. Click to open, ⌘-click to select, shift-click to select a range.                                                                                                    |
| **Spreadsheet** | Every field of every issue in one editable grid, windowed so a thousand rows stay fast.                                                                                             |
| **Analytics**   | Opened vs closed by week, open counts by status/team/work type/module, backlog age, and time-to-close — all computed in the browser from the same board data.                       |

Cross-cutting:

- **Selection & bulk edits** — ⌘-click cards or rows, then set Status / Team / Priority / Work type on the
  whole selection in one request. Partial failures are reported, not rolled back.
- **Saved views** — the filter, grouping and layout live in the URL, so any view is a shareable link.
  Saving one pins it to the sidebar (stored per browser).
- **Archived** — hides an item from every view without deleting the issue. The sidebar's
  Archived toggle is the only place they show up.
- **Sub-issues** — parent/child links (`issues.parent_issue_id`), with progress on the card and
  in the panel, kept up to date by a database trigger.
- **LogRocket** — paste a session URL onto a bug and it renders as a replay link, on the issue
  and on its triage card. With none attached, the panel links straight to the LogRocket
  projects that match the issue's Platform or Team (`src/model/logrocket.ts` holds the map).
- **Activity** — comments and timeline events (status moves, labels, assignments, renames) in
  one chronological feed, with reactions on the issue and on each comment.

## How it works

```
Browser (Vite + React SPA)  →  /api/* (Vercel functions)  →  Supabase Postgres
                                 │ Supabase Auth session cookie
                                 │ browser also holds a Realtime subscription for live updates
```

- **Auth**: Supabase Auth — Google OAuth (primary) or email magic link, both restricted to
  `@radiusagent.com` (`profiles.allowed`, checked server-side on every request via the
  service-role client, not just at sign-in). `api/_lib/session.ts`'s `requireUser()` is the one
  place every protected route calls.
- **Reads/writes**: every route under `api/` talks to Postgres directly via a pooled connection
  (`api/_lib/db/pool.ts`, `postgres.js` over Supabase's transaction-mode pooler). There is no
  server-side board cache — a full read of the board is a single cheap SQL query against your
  own database, not a rate-limited external API.
- **Live updates**: `src/api/realtime.ts` subscribes to Supabase Realtime `postgres_changes` on
  the `issues` table; any insert/update refetches that one item
  (`GET /api/items/:itemId`) and folds it into the React Query cache.
- **Status ↔ issue state**: a `BEFORE UPDATE` trigger (`issues_sync_state_and_status` in the
  migration) keeps `issues.state`/`state_reason` consistent with the Status field's
  `field_options.closes_as` in the same statement — no application-level round trip.
- **Activity log**: `AFTER UPDATE`/`AFTER INSERT`/`AFTER DELETE` triggers on `issues`,
  `issue_labels` and `issue_assignees` write to `activity_events`; `getActivity()` in
  `api/_lib/db/board.ts` reads the `activity_feed` view, which unions that table with
  `comments`.
- **Schema as code**: `supabase/migrations/*.sql` is the schema. `fields.config.ts` is the
  declarative source for `field_defs`/`field_options` (seeded by
  `scripts/migrate-github-to-supabase.ts`; there's no live "provisioning" step anymore since
  the schema isn't hosted on a third party).

## Local development

```bash
pnpm install
cp .env.example .env         # fill in the Supabase section (see below)
pnpm dev                     # web on :5173, api on :3001 (proxied under /api)
```

You'll need a Supabase project (free tier is enough — see `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` in Project Settings → API /
Database) with `supabase/migrations/0001_init.sql` applied, and either:

- Google OAuth enabled in Supabase Auth (Authentication → Providers), with a Google Cloud OAuth
  client whose redirect URI is `<your Supabase project>.supabase.co/auth/v1/callback`, or
- `DEV_LOGIN_EMAIL` / `DEV_LOGIN_PASSWORD` set to one Supabase account with the email/password
  provider enabled, for local sign-in without email delivery — click "Developer sign-in".

Scripts:

| Command                                                | What it does                                          |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm migrate:supabase -- [--dry-run] [--limit N]`     | One-off GitHub → Supabase migration (see its header)  |
| `pnpm schema:dump`                                     | Print the *GitHub* field/option list (migration-era)  |
| `pnpm schema:provision [--dry-run]`                    | Sync `fields.config.ts` to the *GitHub* project (migration-era) |
| `pnpm typecheck && pnpm test`                           | CI checks                                              |

## Deploy

Vercel, framework preset _Vite_. `vercel.json` rewrites non-API routes to the SPA.
Required env in Vercel: everything in `.env.example` except the `DEV_*` and `GITHUB_*` entries
(those are migration/local-dev only — see `.env.example`'s comments).
Custom domain: add `bugtracker.radiusagents.com` in Vercel and create the CNAME it shows; also
register that domain's `/auth/callback` path in both the Google Cloud OAuth client's redirect
URIs and Supabase Auth's redirect allowlist.
