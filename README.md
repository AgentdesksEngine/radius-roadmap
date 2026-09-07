# Radius Roadmap · Bugtracker

A Linear-style frontend for the **Radius Roadmap** GitHub Project
(`AgentdesksEngine` project #6). GitHub is the source of truth: every card is a GitHub
issue in this repository, every column is a Projects v2 field. If this app is down, the
team keeps working in GitHub's own project UI.

- App: https://bugtracker.radiusagents.com (internal, GitHub sign-in, org members only)
- Board in GitHub: https://github.com/orgs/AgentdesksEngine/projects/6

## Views

| View            | What it is for                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Intake**      | Triage queue: every open issue still missing a Team, Priority or Work type. Accept moves it to Todo, Decline cancels it, Archive hides it.                                          |
| **Board**       | Kanban, grouped by any single-select field or by assignee. Drag between columns to set the field; in **Manual** order, drag inside a column to set the project's own item position. |
| **List**        | Sortable table. Click to open, ⌘-click to select, shift-click to select a range.                                                                                                    |
| **Spreadsheet** | Every field of every issue in one editable grid, windowed so a thousand rows stay fast.                                                                                             |
| **Analytics**   | Opened vs closed by week, open counts by status/team/work type/module, backlog age, and time-to-close — all computed in the browser from the same board data.                       |

Cross-cutting:

- **Selection & bulk edits** — ⌘-click cards or rows, then set Status / Team / Priority / Work type on the
  whole selection in one request. Partial failures are reported, not rolled back.
- **Saved views** — the filter, grouping and layout live in the URL, so any view is a shareable link.
  Saving one pins it to the sidebar (stored per browser).
- **Archived** — `archiveProjectV2Item` hides an item from every view without touching the issue.
  The sidebar's Archived toggle is the only place they show up.
- **Sub-issues** — GitHub's native parent/child links, with progress on the card and in the panel.
- **LogRocket** — paste a session URL onto a bug and it renders as a replay link, on the issue
  and on its triage card. With none attached, the panel links straight to the LogRocket
  projects that match the issue's Platform or Team (`src/model/logrocket.ts` holds the map).
- **Activity** — comments and timeline events (status moves, labels, assignments, renames, references)
  in one chronological feed, with reactions on the issue and on each comment.

## How it works

```
Browser (Vite + React SPA)  →  /api/* (Vercel functions)  →  GitHub GraphQL API
                                 │ session cookie (iron-session, httpOnly)
                                 │ attaches the signed-in user's GitHub token
```

- **Auth**: GitHub App OAuth (user-to-server tokens). After sign-in we check org
  membership; non-members are shown a "not part of this org" page. Tokens never reach the
  browser. Actions in GitHub are attributed to the acting user.
- **Reads vs writes**: _writes_ use the signed-in user's token, so GitHub attributes them
  to the person. _Reads_ use the App's installation token (`api/_lib/github/app.ts`), because
  the board is the same for everyone and re-reading ~1,000 issues costs about 40 rate-limit
  points — charged to each user's personal 5,000/hour budget that is roughly two open tabs
  before the app throttles itself. Without App credentials it falls back to the caller's token,
  which is the current state until an org owner creates the App.
- **Caching**: `api/_lib/board-cache.ts` keeps one copy of the board per server instance and
  refreshes it as cheaply as it can — served from memory, else a delta of issues changed since
  the last sync (2 points), else a full re-read (40). A failed refresh serves the previous copy
  rather than an error. Writes fold their own result back in, so nobody polls back the value
  they just changed.
- **Webhooks**: with `GITHUB_WEBHOOK_SECRET` set, `POST /api/webhooks/github` marks the cache
  stale on `issues` / `issue_comment` / `projects_v2_item` / `sub_issues` / `label`, and the
  poll drops to a 5-minute safety net. Without it, the poll is the only refresh (30s).
- **Data**: `api/_lib/github/board.ts` is the single module that reads and writes the
  project (schema, items, field updates, issue create/edit, comments, activity, reactions,
  sub-issues, archiving, ordering and bulk writes). Field and option ids are fetched and
  cached, never hardcoded.
- **Status ↔ issue state**: setting Status to Done / Canceled / Can't reproduce closes the
  GitHub issue (completed / not planned); any other status reopens it. Closing or reopening
  from the panel moves Status to Done / Canceled / Todo. GitHub's own project workflows do
  the same a few seconds later for changes made directly on github.com.
- **Schema as code**: `fields.config.ts` declares the custom fields. `pnpm schema:provision`
  makes the live project match it (create/extend only, never delete).
- **No database**: every feature maps onto a GitHub primitive — an issue, a Projects v2 field,
  a label, a sub-issue link, an archived item. Anything that cannot (saved views, column
  visibility, theme) is per-browser `localStorage` and is deliberately disposable.

## Local development

```bash
pnpm install
cp .env.example .env         # fill SESSION_SECRET; optionally DEV_GITHUB_TOKEN=$(gh auth token)
pnpm dev                     # web on :5173, api on :3001 (proxied under /api)
```

Without the GitHub App credentials you can still sign in locally: set `DEV_GITHUB_TOKEN`
to a personal token with `repo, project, read:org` scopes and click "Developer sign-in".

Scripts:

| Command                                           | What it does                           |
| ------------------------------------------------- | -------------------------------------- |
| `pnpm schema:dump`                                | Print live fields and option ids       |
| `pnpm schema:provision [--dry-run]`               | Sync `fields.config.ts` to the project |
| `pnpm import:slack -- --csv path.csv [--dry-run]` | One-off Slack List migration           |
| `pnpm typecheck && pnpm test`                     | CI checks                              |

## GitHub App (one-time, needs an org owner)

1. Org settings → Developer settings → GitHub Apps → **New GitHub App**.
2. Name `Radius Bugtracker`, homepage `https://bugtracker.radiusagents.com`.
3. Callback URLs (add all):
   - `https://bugtracker.radiusagents.com/api/auth/callback`
   - `https://<project>.vercel.app/api/auth/callback`
   - `http://localhost:5173/api/auth/callback`
4. Tick **Request user authorization (OAuth) during installation** and
   **Expire user authorization tokens**.
   Webhook: **Active**, URL `https://bugtracker.radiusagents.com/api/webhooks/github`,
   secret = a fresh random string (`openssl rand -hex 32`) — the same value goes in
   `GITHUB_WEBHOOK_SECRET`. Subscribe to **Issues**, **Issue comment**, **Label**,
   **Sub-issues** and **Projects v2 item**. Leaving the webhook off is supported; the app
   just falls back to polling.
5. Permissions: Repository → _Issues: Read and write_, _Metadata: Read-only_.
   Organization → _Projects: Read and write_, _Members: Read-only_.
   (Reactions, sub-issues and activity all fall under Issues; archiving and manual
   ordering fall under Projects. No extra scopes are needed.)
6. Create, then **Generate a new client secret** and a private key.
7. **Install App** on `AgentdesksEngine`, "Only select repositories" → `radius-roadmap`.
8. Put `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
   `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` into
   Vercel → Project → Environment variables. `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY`
   are what switch reads onto the installation token; until they are set, every signed-in
   user still reads on their own rate-limit budget.

## Deploy

Vercel, framework preset _Vite_. `vercel.json` rewrites non-API routes to the SPA.
Required env in Vercel: everything in `.env.example` except the `DEV_*` entries.
Custom domain: add `bugtracker.radiusagents.com` in Vercel and create the CNAME it shows.
