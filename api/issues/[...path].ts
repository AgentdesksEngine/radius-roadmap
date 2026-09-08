import { z } from 'zod';
import type { VercelRequest } from '@vercel/node';
import { addComment, getActivity, getComments, getItem, setIssueState, setSubIssue, updateIssue } from '../_lib/db/board.js';
import { HttpError, noStore, readJson, route } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

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
  assigneeIds: z.array(z.string()).optional(),
  /** Same value as :id today (issueId === itemId post-cutover); when given, the response includes the refreshed item. */
  itemId: z.string().optional(),
});

const CommentBody = z.object({ body: z.string().trim().min(1).max(60_000) });
const SubIssueBody = z.object({ subIssueId: z.string().min(1), attach: z.boolean() });

export default route({
  GET: async (req, res) => {
    await requireUser(req, res);
    const [id, sub] = pathSegments(req);

    if (sub === 'activity') {
      const events = await getActivity(id);
      noStore(res);
      res.status(200).json(events);
      return;
    }
    if (sub === 'comments') {
      const comments = await getComments(id);
      noStore(res);
      res.status(200).json(comments);
      return;
    }
    throw new HttpError(404, 'Not found');
  },

  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const [id, sub] = pathSegments(req);

    if (sub === 'comments') {
      const parsed = CommentBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      const comment = await addComment(profileId, id, parsed.data.body);
      res.status(201).json(comment);
      return;
    }
    if (sub === 'sub-issue') {
      const parsed = SubIssueBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      await setSubIssue(profileId, { issueId: id, ...parsed.data });
      res.status(200).json({ ok: true });
      return;
    }
    throw new HttpError(404, 'Not found');
  },

  /** PATCH /api/issues/:id */
  PATCH: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const [id, sub] = pathSegments(req);
    if (sub) throw new HttpError(404, 'Not found');
    const parsed = PatchBody.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const { state, stateReason, itemId, ...patch } = parsed.data;
    await updateIssue(profileId, id, patch);
    if (state) await setIssueState(profileId, id, state, stateReason);
    const item = itemId ? await getItem(itemId, profileId) : null;
    res.status(200).json({ ok: true, item });
  },
});
