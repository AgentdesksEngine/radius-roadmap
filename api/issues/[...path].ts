import { z } from 'zod';
import type { VercelRequest } from '@vercel/node';
import { HttpError, noStore, readJson, route } from '../_lib/http.js';
import { requireToken } from '../_lib/session.js';
import { GitHubClient } from '../_lib/github/gql.js';
import { addComment, getActivity, getComments, getItem, setIssueState, setSubIssue, syncStatusToState, updateIssue } from '../_lib/github/board.js';
import { cacheItems, invalidateBoard } from '../_lib/board-cache.js';

/**
 * Everything under /api/issues/:id/* in one function — a catch-all rather than three
 * separate files, to stay under the Hobby plan's per-deployment function cap.
 * (`/api/issues` itself, with no id, is the sibling `index.ts` — POST to create.)
 */
function pathSegments(req: VercelRequest): [string, string | undefined] {
  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const [id, sub] = segments;
  if (!id) throw new HttpError(404, 'Not found');
  return [id, sub];
}

const PatchBody = z.object({
  title: z.string().trim().min(1).max(256).optional(),
  body: z.string().max(60_000).optional(),
  state: z.enum(['OPEN', 'CLOSED']).optional(),
  stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).optional(),
  assigneeLogins: z.array(z.string()).optional(),
  /** Project item id; when given, the response includes the refreshed item and Status is kept in sync. */
  itemId: z.string().optional(),
});

const CommentBody = z.object({ body: z.string().trim().min(1).max(60_000) });
const SubIssueBody = z.object({ subIssueId: z.string().min(1), attach: z.boolean() });

export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const [id, sub] = pathSegments(req);
    const gh = new GitHubClient(accessToken);

    if (sub === 'activity') {
      const events = await getActivity(gh, id);
      noStore(res);
      res.status(200).json(events);
      return;
    }
    if (sub === 'comments') {
      const comments = await getComments(gh, id);
      noStore(res);
      res.status(200).json(comments);
      return;
    }
    throw new HttpError(404, 'Not found');
  },

  POST: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const [id, sub] = pathSegments(req);
    const gh = new GitHubClient(accessToken);

    if (sub === 'comments') {
      const parsed = CommentBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      const comment = await addComment(gh, id, parsed.data.body);
      invalidateBoard(); // the comment count on the card moved
      res.status(201).json(comment);
      return;
    }
    if (sub === 'sub-issue') {
      const parsed = SubIssueBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      await setSubIssue(gh, { issueId: id, ...parsed.data });
      // Both the parent and the child changed; let the next read pick them up.
      invalidateBoard();
      res.status(200).json({ ok: true });
      return;
    }
    throw new HttpError(404, 'Not found');
  },

  /** PATCH /api/issues/:id where :id is the issue node id (I_...). */
  PATCH: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const [id, sub] = pathSegments(req);
    if (sub) throw new HttpError(404, 'Not found');
    const parsed = PatchBody.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const { state, stateReason, itemId, ...patch } = parsed.data;
    const gh = new GitHubClient(accessToken);
    await updateIssue(gh, id, patch);
    if (state) await setIssueState(gh, id, state, stateReason);
    let item = null;
    if (itemId) item = state ? await syncStatusToState(gh, itemId) : await getItem(gh, itemId);
    if (item) cacheItems([item]);
    res.status(200).json({ ok: true, item });
  },
});
