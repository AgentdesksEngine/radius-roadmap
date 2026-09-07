import { z } from 'zod';
import { HttpError, param, readJson, route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { GitHubClient } from '../_lib/github/gql';
import { getItem, setIssueState, syncStatusToState, updateIssue } from '../_lib/github/board';

const Body = z.object({
  title: z.string().trim().min(1).max(256).optional(),
  body: z.string().max(60_000).optional(),
  state: z.enum(['OPEN', 'CLOSED']).optional(),
  stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).optional(),
  assigneeLogins: z.array(z.string()).optional(),
  /** Project item id; when given, the response includes the refreshed item and Status is kept in sync. */
  itemId: z.string().optional(),
});

/** PATCH /api/issues/:id where :id is the issue node id (I_...). */
export default route({
  PATCH: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const issueId = param(req, 'id');
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const { state, stateReason, itemId, ...patch } = parsed.data;
    const gh = new GitHubClient(accessToken);
    await updateIssue(gh, issueId, patch);
    if (state) await setIssueState(gh, issueId, state, stateReason);
    let item = null;
    if (itemId) item = state ? await syncStatusToState(gh, itemId) : await getItem(gh, itemId);
    res.status(200).json({ ok: true, item });
  },
});
