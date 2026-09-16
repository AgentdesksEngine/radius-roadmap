import { z } from 'zod';
import type { VercelRequest } from '@vercel/node';
import {
  addComment,
  createIssue,
  getActivity,
  getComments,
  getItem,
  setIssueState,
  setStarred,
  setSubIssue,
  updateIssue,
} from '../_lib/db/board.js';
import { HttpError, noStore, readJson, route } from '../_lib/http.js';
import { setWatching } from '../_lib/notify.js';
import { requireUser } from '../_lib/session.js';

/**
 * Everything under /api/issues/* in one function — a catch-all rather than a file per route,
 * to stay under the Hobby plan's per-deployment function cap.
 *
 * Creation is POST /api/issues/create rather than POST /api/issues because a catch-all only
 * matches one segment or more; the sibling index.ts it used to live in was worth more as a
 * free function slot.
 */
/**
 * Vercel's zero-config `api/` routing does NOT treat `[...path]` as a catch-all: it generates
 * `^/api/issues/([^/]+)$`, which matches exactly one segment and binds it to a query key
 * literally named `...path`. So `/api/issues/:id/comments` never reached this function at all —
 * it 404'd at the router, silently, for as long as the route has existed.
 *
 * The rewrite in vercel.json folds the second segment into `?sub=`, which does match. Reading
 * every shape below keeps this working under the rewrite, under Vercel's own param name, and
 * under scripts/dev-api.ts (which binds a real catch-all array).
 */
function pathSegments(req: VercelRequest): [string, string | undefined] {
  const q = req.query as Record<string, string | string[] | undefined>;
  const raw = q.path ?? q['...path'];
  const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('/') : [];
  const id = segments[0];
  const sub = segments[1] ?? (typeof q.sub === 'string' ? q.sub : undefined);
  if (!id) throw new HttpError(404, 'Not found');
  return [id, sub];
}

const PatchBody = z.object({
  title: z.string().trim().min(1).max(256).optional(),
  body: z.string().max(60_000).optional(),
  state: z.enum(['OPEN', 'CLOSED']).optional(),
  stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).optional(),
  assigneeIds: z.array(z.string()).optional(),
  collaboratorIds: z.array(z.string()).optional(),
  /** Same value as :id today (issueId === itemId post-cutover); when given, the response includes the refreshed item. */
  itemId: z.string().optional(),
});

const CommentBody = z.object({ body: z.string().trim().min(1).max(60_000) });
const SubIssueBody = z.object({ subIssueId: z.string().min(1), attach: z.boolean() });
const WatchBody = z.object({ watching: z.boolean() });
const StarBody = z.object({ starred: z.boolean() });

const CreateBody = z.object({
  title: z.string().trim().min(1).max(256),
  body: z.string().max(60_000).optional(),
  fields: z
    .record(
      z.string(),
      z.union([
        z.object({ singleSelectOptionId: z.string() }),
        z.object({ multiSelectOptionIds: z.array(z.string()) }),
        z.object({ date: z.string() }),
        z.object({ text: z.string() }),
        z.object({ number: z.number() }),
        z.null(),
      ]),
    )
    .optional(),
  assigneeIds: z.array(z.string()).optional(),
  collaboratorIds: z.array(z.string()).optional(),
  labelNames: z.array(z.string()).optional(),
});

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

    if (id === 'create' && !sub) {
      const parsed = CreateBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      const item = await createIssue(profileId, parsed.data);
      res.status(201).json(item);
      return;
    }
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
    if (sub === 'watch') {
      const parsed = WatchBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      const watcherCount = await setWatching(profileId, id, parsed.data.watching);
      res.status(200).json({ ok: true, watching: parsed.data.watching, watcherCount });
      return;
    }
    if (sub === 'star') {
      const parsed = StarBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      await setStarred(profileId, id, parsed.data.starred);
      res.status(200).json({ ok: true, starred: parsed.data.starred });
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
