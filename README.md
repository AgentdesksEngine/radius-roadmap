# Radius Roadmap · Bugtracker

A Linear-style frontend for Radius's bug and feature-request tracker.
**Supabase Postgres is the source of truth** (see `supabase/migrations/0001_init.sql`); every
card is a row in `issues`, every column a `field_defs`/`field_options` pair. The app previously
ran on GitHub Projects v2 — see `docs/` history / git log for that era, and
`scripts/migrate-github-to-supabase.ts` for the one-off migration between the two.

- App: https://radius-roadmap.vercel.app (internal, @radiusagent.com sign-in)
  (`bugtracker.radiusagents.com` is referenced in older notes but does not resolve — the
  custom domain was never set up.)

## Views

| View            | What it is for                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home**        | The landing page: assigned to you, what you're watching, what you starred, your pinned views, and the triage count.                                                          |
| **Intake**      | Triage queue: every open issue still missing a Team, Priority or Work type. Accept moves it to Todo, Decline cancels it, Archive hides it.                                  |
| **Board**       | Kanban, grouped by any single-select field or by assignee. Drag between columns to set the field; in **Manual** order, drag inside a column to set the item's own position. |
| **List**        | Sortable table. Click to open, ⌘-click to select, shift-click to select a range.                                                                                            |
| **Spreadsheet** | Every field of every issue in one editable grid, windowed so a thousand rows stay fast.                                                                                     |
| **Analytics**   | Opened vs closed by week, open counts by status/team/work type/module, backlog age, and time-to-close — all computed in the browser from the same board data. Build your own dashboards from the same measures. |

Cross-cutting:

- **Selection & bulk edits** — ⌘-click cards or rows, then set Status / Team / Priority / Work type on the
  whole selection in one request. Partial failures are reported, not rolled back.
- **Saved views** — the filter, grouping and layout live in the URL, so any view is a shareable link.
  Saving one puts it in the sidebar; pinning one puts it on Home. Views are stored per profile in
  Postgres, so they follow you to another browser. (Anything you had saved before the move is
  migrated out of localStorage once, on your next sign-in.)
- **Watching & @mentions** — see "Notifications" below.
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

- **Auth**: Supabase Auth — a six-digit **email code** sent via `signInWithOtp`/`verifyOtp`.
  Restricted to `@radiusagent.com` by `profiles.allowed`, set by the `handle_new_user` trigger
  from the email domain and checked server-side on every request via the service-role client,
  not just at sign-in. `api/_lib/session.ts`'s `requireUser()` is the
  one place every protected route calls. Sessions last **a year** unless you sign out
  deliberately (`SESSION_MAX_AGE_SECONDS`, set on both the server and browser Supabase clients —
  without it the auth cookie dies when the browser closes).
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

## Slack ingest

Bugs are born in `#product-critical-bugs` as prose, and they stay there unless someone retypes
them. `api/slack/[action].ts` closes that gap: a triager points at a Slack message and it
becomes an issue, with a link back to the thread.

Three triggers, all landing in the same `ingestSlackMessage()`:

| Trigger  | How                                   | Hints                        |
| -------- | ------------------------------------- | ---------------------------- |
| Mention  | reply `@bugtracker add` in the thread | `@bugtracker add p1 cda ios` |
| Reaction | react :bug: on the message            | —                            |
| Shortcut | message ⋮ menu → _Add to bug tracker_ | —                            |

**The thread parent is the bug.** Mentioning the app on the 15th reply still captures the
report at the top of the thread; the replies come along as context. The app posts the issue
key back into the thread when it's done.

Hints after `add` are matched as whole words against the live field schema: `p0`/`p1`/`p2`/`p3`
or `urgent`/`high`/`medium`/`low` for Priority, `ios`/`android`/`web` for Platform (and Team
when there's exactly one), any Module option name, `sev:high` for Severity. Whatever isn't
given is left empty on purpose — that's what puts the issue in **Intake**, which is already the
triage queue. Module gets a keyword guess from the bug text (`MODULE_KEYWORDS` in
`api/_lib/slack/ingest.ts`); everything captured this way is `Work type: Bug`, `Source: Slack`.

Re-triggering on the same message is a no-op that replies with the existing issue — the partial
unique index on `(slack_channel_id, slack_message_ts)` in `0003_slack_ingest.sql` is what makes
that true, which also means Slack's retries are harmless.

### Setting it up

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) → _From scratch_, in the
   Radius workspace.
2. **OAuth & Permissions** → bot token scopes: `commands` (required by the message shortcut —
   Slack rejects the manifest without it, even though the app defines no slash command),
   `app_mentions:read`, `channels:history`, `groups:history` (`#product-critical-bugs` is
   private, so this one is required), `reactions:read`, `reactions:write`, `chat:write`,
   `im:write` (opens the DM channel for notifications — **added after the first release, so the
   app must be reinstalled** to pick it up), `users:read`, `users:read.email` (that last one is
   how a Slack account is matched to a `profiles` row, for both reporters and DM recipients).
   Install to the workspace and copy the `xoxb-` token.
3. **Event Subscriptions** → Request URL `https://radius-roadmap.vercel.app/api/slack/events`
   (it answers the `url_verification` handshake), then subscribe to bot events `app_mention`
   and `reaction_added`.
4. **Interactivity & Shortcuts** → Request URL `.../api/slack/interactivity`; add a shortcut of
   type _On messages_ named "Add to bug tracker".
5. Set `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `SLACK_BOT_USER_ID` and
   `SLACK_INGEST_CHANNELS` in Vercel (see `.env.example`).
6. **Invite the app to the channel** — `/invite @bugtracker` in `#product-critical-bugs`. A
   private channel is invisible to the app until you do, and nothing will fail loudly.

Apply the migrations before the first event arrives:
`supabase/migrations/0003_slack_ingest.sql` and `0004_notifications_home_github.sql`, plus the
`Source: Slack` option from
`fields.config.ts` (`seedFieldSchema()` in `scripts/_field-schema.ts` is idempotent, but it is
only wired into the one-off migration scripts — add the option with SQL, or run one).

Two things are load-bearing and easy to break:

- The signature HMAC is over the **raw** bytes, so the route sets `bodyParser: false` and uses
  `readRawBody()`. Re-serialising `req.body` produces a different string and every request 401s.
- Slack wants a 200 within **3 seconds** or it retries. The route acks first and finishes the
  work in `waitUntil`, so the Slack API calls aren't repeated three times over.

## Notifications

Watching an issue means **a Slack DM to you**, not a message in a channel. `api/_lib/notify.ts`
is the whole stack.

- **Who gets told**: everyone watching the issue, plus anyone `@mentioned` in the text that
  caused the event, minus whoever caused it. You are never notified about your own click.
- **Auto-watch**: you start watching an issue you report, are assigned to, comment on, or are
  `@mentioned` in. **Watch / Watching** in the issue panel adds or removes you by hand; removing
  yourself is a real delete, so commenting again re-subscribes you.
- **Batching**: at most one DM per (issue, recipient) per **two minutes**. Events that land
  inside the window join the open batch and arrive as one message — "3 updates on RAD-42" — with
  a deep link to the issue. The partial unique index on `notification_outbox` is that rule.
- **@mentions**: typing `@` in a comment opens a member picker. The stored markdown is
  `[@Jane Doe](mention:<profile id>)` — the id, not the name, so a rename cannot break the link
  — rendered as a chip, never as a raw link.
- **Silent failure is deliberate**: if nobody in Slack has that email, or the token is missing
  the scope, the notification is logged and dropped. It never fails the comment or the field
  write that produced it, and it never shows an error to the person writing.

One platform quirk worth knowing: a Vercel function can't be relied on to stay alive for the
full two-minute window, so the batch is drained two ways — a background worker that sleeps out
the window, **and** an opportunistic sweep on every board load (`/api/project/items`). Whichever
gets there first wins; the claim is a single atomic `UPDATE ... RETURNING`, so a batch cannot be
sent twice.

## GitHub pull requests

The board is not on GitHub and this does not put it back. A PR that names a `RAD-…` key in its
**branch, title or body** attaches itself to that issue and can nudge its status forward.

| PR event                             | Status becomes       | But only if it is currently |
| ------------------------------------ | -------------------- | --------------------------- |
| opened / ready for review / reopened  | **In review**        | Todo, In progress           |
| merged                               | **Ready to release** | In review, In QA            |
| closed without merging               | _unchanged_          | — (the PR is marked closed) |

A draft PR changes nothing until it is marked ready. Anything further along — Done, Canceled,
Can't reproduce, or already past the target — is left alone: a webhook must never overwrite a
human's decision. A PR naming several keys attaches to all of them and applies the rule to each
independently. Watchers get a DM (batched like everything else); PR chips show on the card and
in the panel.

### Setting it up

1. A GitHub App (or a plain org webhook) on the `AgentdesksEngine` org, with **Pull requests:
   Read-only** and **Metadata: Read-only**. No API token is needed — everything used comes in
   the webhook payload, so `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` stay migration-only.
2. Webhook URL `https://radius-roadmap.vercel.app/api/github/webhook`, content type
   **application/json**, with a secret.
3. Subscribe to the **Pull request** event only.
4. Set `GITHUB_WEBHOOK_SECRET` (the same secret) and `GITHUB_ORG` in Vercel.

Same two load-bearing details as Slack: `X-Hub-Signature-256` is an HMAC over the **raw** bytes
(`bodyParser: false` + `readRawBody()`), and the route acks before doing the work. Events from a
repo outside `GITHUB_ORG` are ignored even if the signature is valid.

## Local development

```bash
pnpm install
cp .env.example .env         # fill in the Supabase section (see below)
pnpm dev                     # web on :5173, api on :3001 (proxied under /api)
```

You'll need a Supabase project (free tier is enough — see `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` in Project Settings → API /
Database) with **every** migration in `supabase/migrations/` applied in order, and one of:

- **Email code** — the Email provider, with `{{ .Token }}` added to *both* the "Magic Link" and
  "Confirm signup" templates (Supabase uses the second one for a person's first-ever sign-in).
  Note Supabase's built-in sender is rate-limited to a handful of mails an hour across the whole
  project; real rollout needs custom SMTP.
- `DEV_LOGIN_EMAIL` / `DEV_LOGIN_PASSWORD` set to one Supabase account with the email/password
  provider enabled, for local sign-in without email delivery — click "Developer sign-in".

Scripts:

| Command                                            | What it does                                                    |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm migrate:supabase -- [--dry-run] [--limit N]` | One-off GitHub → Supabase migration (see its header)            |
| `pnpm schema:dump`                                 | Print the _GitHub_ field/option list (migration-era)            |
| `pnpm schema:provision [--dry-run]`                | Sync `fields.config.ts` to the _GitHub_ project (migration-era) |
| `pnpm typecheck && pnpm test`                      | CI checks                                                       |

## Deploy

Vercel, framework preset _Vite_. `vercel.json` rewrites non-API routes to the SPA.
Required env in Vercel: everything in `.env.example` except the `DEV_*` entries and the block
marked migration-only (see `.env.example`'s comments). `APP_URL` must be the real public origin —
every issue deep link, including the ones in Slack DMs, is built from it.

**The Hobby plan caps a deployment at 12 serverless functions**, and each file under `api/` is
one. There are 11. Exceeding the cap does not fail the build: it fails *after* it, as a generic
"Build Failed" whose real cause (`exceeded_serverless_functions_per_deployment`) is only visible
via `npx vercel inspect <url>`. Add routes as another branch of an existing `[action]` /
catch-all dispatcher rather than a new file.

**Relative imports under `api/` and `shared/` need an explicit `.js` extension** in the
TypeScript source. `@vercel/node` transpiles each function in place instead of bundling it, so
Node's real ESM loader resolves the specifier verbatim and an extensionless one 500s at runtime.
Nothing local catches it — not `pnpm typecheck`, not `pnpm build`. To check:

```bash
grep -rEn "from ['\"]\.[^'\"]*['\"]" api shared | grep -v '.test.ts' | grep -vE "\.(js|json)['\"]"
```

Custom domain: add `bugtracker.radiusagents.com` in Vercel and create the CNAME it shows (it does
not resolve today). If you do, add that origin's `/auth/callback` to Supabase Auth's redirect
allowlist, point `APP_URL` at it, and update the Slack and GitHub webhook URLs.
