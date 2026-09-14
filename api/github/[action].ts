/**
 * GitHub webhooks, in one Vercel function.
 *
 *   POST /api/github/webhook  → pull_request events
 *
 * This is the only live GitHub integration. The board is Postgres; nothing here reads the
 * GitHub API, because a pull_request payload already carries everything needed (repo, number,
 * url, title, body, head ref, merged, draft). No installation token, no App private key.
 *
 * Same two disciplines as the Slack route: the signature covers the raw request bytes, so the
 * body parser is off; and the work happens after the ack, because GitHub's delivery timeout is
 * short and a redelivery costs us nothing (every write below is an upsert).
 */
import type { VercelResponse } from '@vercel/node';
import { afterResponse } from '../_lib/after.js';
import { env, requireGithubEnv } from '../_lib/env.js';
import { HttpError, param, readRawBody, route } from '../_lib/http.js';
import { applyPullRequestEvent, type PullRequestPayload } from '../_lib/github/pr.js';
import { verifyGithubSignature } from '../_lib/github/verify.js';

/** Actions that can change what we know about a PR. Everything else is noise. */
const HANDLED = new Set(['opened', 'ready_for_review', 'closed', 'reopened', 'edited', 'converted_to_draft']);

interface WebhookBody {
  action?: string;
  repository?: { full_name?: string; owner?: { login?: string } };
  pull_request?: {
    number?: number;
    html_url?: string;
    title?: string;
    body?: string | null;
    merged?: boolean;
    draft?: boolean;
    head?: { ref?: string };
  };
}

function toPayload(body: WebhookBody): PullRequestPayload | null {
  const pr = body.pull_request;
  const repo = body.repository?.full_name;
  if (!pr || !repo || !body.action || pr.number == null || !pr.html_url) return null;
  return {
    action: body.action,
    number: pr.number,
    repo,
    url: pr.html_url,
    title: pr.title ?? '',
    body: pr.body ?? '',
    branch: pr.head?.ref ?? '',
    merged: pr.merged === true,
    draft: pr.draft === true,
  };
}

async function handleWebhook(res: VercelResponse, rawBody: string, event: string | undefined): Promise<void> {
  // Ack before doing anything: once this is sent, failures below can only be logged.
  res.status(200).json({ ok: true });

  try {
    if (event === 'ping') return;
    if (event !== 'pull_request') return;

    const body = JSON.parse(rawBody) as WebhookBody;
    if (!body.action || !HANDLED.has(body.action)) return;

    // The webhook secret proves the sender; the org check proves it is *our* code.
    const org = env().GITHUB_ORG.toLowerCase();
    if ((body.repository?.owner?.login ?? '').toLowerCase() !== org) {
      console.warn('[github] ignoring event from unexpected org:', body.repository?.owner?.login);
      return;
    }

    const payload = toPayload(body);
    if (!payload) return;

    await afterResponse(async () => {
      const applied = await applyPullRequestEvent(payload);
      if (!applied.length) console.log(`[github] ${payload.repo}#${payload.number} names no known issue`);
    }, 'github');
  } catch (err) {
    console.error('[github] webhook handling failed after ack:', err);
  }
}

export default route({
  POST: async (req, res) => {
    const e = requireGithubEnv();
    const rawBody = await readRawBody(req);
    verifyGithubSignature({
      secret: e.GITHUB_WEBHOOK_SECRET,
      signature: req.headers['x-hub-signature-256'] as string | undefined,
      rawBody,
    });

    const action = param(req, 'action');
    if (action !== 'webhook') throw new HttpError(404, `Unknown GitHub action "${action}"`);
    await handleWebhook(res, rawBody, req.headers['x-github-event'] as string | undefined);
  },
});

/** The signature is over the raw bytes — a parsed body cannot reproduce them. */
export const config = { api: { bodyParser: false } };
