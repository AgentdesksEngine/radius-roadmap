import { z } from 'zod';
import { getItem, setIssueState, updateIssue } from '../_lib/db/board';
import { HttpError, param, readJson, route } from '../_lib/http';
import { requireUser } from '../_lib/session';

const Body = z.object({
  title: z.string().trim().min(1).max(256).optional(),
  body: z.string().max(60_000).optional(),
  state: z.enum(['OPEN', 'CLOSED']).optional(),
  stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).optional(),
  assigneeIds: z.array(z.string()).optional(),
  /** Same value as :id today (issueId === itemId post-cutover); when given, the response includes the refreshed item. */
  itemId: z.string().optional(),
});

/** PATCH /api/issues/:id */
export default route({
  PATCH: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const issueId = param(req, 'id');
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const { state, stateReason, itemId, ...patch } = parsed.data;
    await updateIssue(profileId, issueId, patch);
    if (state) await setIssueState(profileId, issueId, state, stateReason);
    const item = itemId ? await getItem(itemId, profileId) : null;
    res.status(200).json({ ok: true, item });
  },
});
