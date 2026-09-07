# Radius Roadmap · Bugtracker

A Linear-style frontend for the **Radius Roadmap** GitHub Project
(`AgentdesksEngine` project #6). GitHub is the source of truth: every card is a GitHub
issue in this repository, every column is a Projects v2 field. If this app is down, the
team keeps working in GitHub's own project UI.

- App: https://bugtracker.radiusagents.com (internal, GitHub sign-in, org members only)
- Board in GitHub: https://github.com/orgs/AgentdesksEngine/projects/6

## How it works

```
Browser (Vite + React SPA)  →  /api/* (Vercel functions)  →  GitHub GraphQL API
                                 │ session cookie (iron-session, httpOnly)
                                 │ attaches the signed-in user's GitHub token
```

- **Auth**: GitHub App OAuth (user-to-server tokens). After sign-in we check org
  membership; non-members are shown a "not part of this org" page. Tokens never reach the
  browser. Actions in GitHub are attributed to the acting user.
- **Data**: `api/_lib/github/board.ts` is the single module that reads and writes the
  project (schema, items, field updates, issue create/edit, comments). Field and option
  ids are fetched and cached, never hardcoded.
- **Status ↔ issue state**: setting Status to Done / Canceled / Can't reproduce closes the
  GitHub issue (completed / not planned); any other status reopens it. Closing or reopening
  from the panel moves Status to Done / Canceled / Todo. GitHub's own project workflows do
  the same a few seconds later for changes made directly on github.com.
- **Schema as code**: `fields.config.ts` declares the custom fields. `pnpm schema:provision`
  makes the live project match it (create/extend only, never delete).

## Local development

```bash
pnpm install
cp .env.example .env         # fill SESSION_SECRET; optionally DEV_GITHUB_TOKEN=$(gh auth token)
pnpm dev                     # web on :5173, api on :3001 (proxied under /api)
```

Without the GitHub App credentials you can still sign in locally: set `DEV_GITHUB_TOKEN`
to a personal token with `repo, project, read:org` scopes and click "Developer sign-in".

Scripts:

| Command | What it does |
| --- | --- |
| `pnpm schema:dump` | Print live fields and option ids |
| `pnpm schema:provision [--dry-run]` | Sync `fields.config.ts` to the project |
| `pnpm import:slack -- --csv path.csv [--dry-run]` | One-off Slack List migration |
| `pnpm typecheck && pnpm test` | CI checks |

## GitHub App (one-time, needs an org owner)

1. Org settings → Developer settings → GitHub Apps → **New GitHub App**.
2. Name `Radius Bugtracker`, homepage `https://bugtracker.radiusagents.com`.
3. Callback URLs (add all):
   - `https://bugtracker.radiusagents.com/api/auth/callback`
   - `https://<project>.vercel.app/api/auth/callback`
   - `http://localhost:5173/api/auth/callback`
4. Tick **Request user authorization (OAuth) during installation** and
   **Expire user authorization tokens**. Webhook: inactive.
5. Permissions: Repository → *Issues: Read and write*, *Metadata: Read-only*.
   Organization → *Projects: Read and write*, *Members: Read-only*.
6. Create, then **Generate a new client secret** and a private key.
7. **Install App** on `AgentdesksEngine`, "Only select repositories" → `radius-roadmap`.
8. Put `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
   `GITHUB_APP_PRIVATE_KEY` into Vercel → Project → Environment variables.

## Deploy

Vercel, framework preset *Vite*. `vercel.json` rewrites non-API routes to the SPA.
Required env in Vercel: everything in `.env.example` except the `DEV_*` entries.
Custom domain: add `bugtracker.radiusagents.com` in Vercel and create the CNAME it shows.
