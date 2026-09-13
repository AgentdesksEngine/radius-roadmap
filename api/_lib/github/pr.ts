/**
 * Linking GitHub pull requests to issues, and the auto-status rules that follow.
 *
 * The board is NOT on GitHub — issues here are Postgres rows. A PR is only ever an
 * attachment, found by a RAD-key written in its branch name, title or body. One PR can name
 * several issues and each is handled independently.
 *
 * The status rules are deliberately one-directional and narrow. A PR opening means "someone
 * started reviewing this", which is only news if the issue is still ahead of review; a merge
 * means "it is waiting for a release", which is only news if it was in review or QA. Anything
 * further along — Done, Canceled, Can't reproduce, already Ready to release — is a human's
 * judgement and a webhook must not overwrite it.
 */
import type { FieldOption, ProjectSchema } from '../../../shared/types.js';
import { getSchema, setItemField } from '../db/board.js';
import { db } from '../db/pool.js';
import { enqueue, notifySoon } from '../notify.js';

export interface PullRequestPayload {
  action: string;
  number: number;
  repo: string;
  url: string;
  title: string;
  body: string;
  branch: string;
  merged: boolean;
  draft: boolean;
}

/** Target status → the only statuses it may replace. */
const STATUS_RULES: Record<string, string[]> = {
  'In review': ['Todo', 'In progress'],
  'Ready to release': ['In review', 'In QA'],
};

/** Every RAD number a PR names, in branch / title / body, deduped and in first-seen order. */
export function extractIssueNumbers(pr: Pick<PullRequestPayload, 'branch' | 'title' | 'body'>, keyPrefix: string): number[] {
  const re = new RegExp(`\\b${keyPrefix}-(\\d+)\\b`, 'gi');
  const out = new Set<number>();
  for (const text of [pr.branch, pr.title, pr.body]) {
    for (const m of (text ?? '').matchAll(re)) out.add(Number(m[1]));
  }
  return [...out];
}

export function prState(pr: Pick<PullRequestPayload, 'action' | 'merged'>): 'open' | 'merged' | 'closed' {
  if (pr.action === 'closed') return pr.merged ? 'merged' : 'closed';
  return 'open';
}

/** The status this event wants, before checking what the issue is currently set to. */
export function statusTargetFor(pr: Pick<PullRequestPayload, 'action' | 'merged' | 'draft'>): string | null {
  if (pr.action === 'closed') return pr.merged ? 'Ready to release' : null;
  if (pr.action === 'ready_for_review') return 'In review';
  if ((pr.action === 'opened' || pr.action === 'reopened') && !pr.draft) return 'In review';
  return null;
}

/** The status to write, or null to leave the issue alone. */
export function nextStatusFor(target: string | null, current: string | null): string | null {
  if (!target) return null;
  const allowedFrom = STATUS_RULES[target];
  if (!allowedFrom || !current) return null;
  return allowedFrom.includes(current) ? target : null;
}

function statusField(schema: ProjectSchema) {
  return schema.fields.find((f) => f.name.toLowerCase() === 'status');
}

function optionByName(options: FieldOption[] | undefined, name: string) {
  return options?.find((o) => o.name.toLowerCase() === name.toLowerCase());
}

export interface AppliedPullRequest {
  issueId: string;
  number: number;
  movedTo: string | null;
}

/**
 * Records the PR against every issue it names and applies the status rules. Returns what it
 * touched, so the route can log a useful line for an event that matched nothing.
 */
export async function applyPullRequestEvent(pr: PullRequestPayload): Promise<AppliedPullRequest[]> {
  const schema = await getSchema();
  const numbers = extractIssueNumbers(pr, schema.keyPrefix);
  if (!numbers.length) return [];

  const sql = db();
  const state = prState(pr);
  const field = statusField(schema);
  const target = statusTargetFor(pr);
  const applied: AppliedPullRequest[] = [];

  for (const number of numbers) {
    const [issue] = await sql<{ id: string; fields: Record<string, { optionId?: string }> }[]>`
      select id, fields from issues where number = ${number}
    `;
    if (!issue) continue;

    await sql`
      insert into issue_pull_requests (issue_id, repo, number, url, title, state, draft, updated_at)
      values (${issue.id}, ${pr.repo}, ${pr.number}, ${pr.url}, ${pr.title}, ${state}, ${pr.draft}, now())
      on conflict (repo, number, issue_id) do update set
        url = excluded.url, title = excluded.title, state = excluded.state,
        draft = excluded.draft, updated_at = now()
    `;

    const currentOptionId = field ? issue.fields?.[field.id]?.optionId : undefined;
    const current = field?.options?.find((o) => o.id === currentOptionId)?.name ?? null;
    const next = nextStatusFor(target, current);
    const option = next && field ? optionByName(field.options, next) : undefined;

    if (option && field) {
      await setItemField(null, { itemId: issue.id, fieldId: field.id, value: { singleSelectOptionId: option.id } });
    }

    await enqueue({
      issueId: issue.id,
      actorId: null,
      kind: 'pr',
      detail: `${pr.repo}#${pr.number} ${prEventPhrase(state, pr.action)}${option ? ` — moved to ${option.name}` : ''}`,
    });
    applied.push({ issueId: issue.id, number, movedTo: option?.name ?? null });
  }

  if (applied.length) notifySoon();
  return applied;
}

function prEventPhrase(state: 'open' | 'merged' | 'closed', action: string): string {
  if (state === 'merged') return 'was merged';
  if (state === 'closed') return 'was closed';
  if (action === 'ready_for_review') return 'is ready for review';
  if (action === 'reopened') return 'was reopened';
  if (action === 'converted_to_draft') return 'went back to draft';
  if (action === 'edited') return 'was updated';
  return 'was opened';
}
