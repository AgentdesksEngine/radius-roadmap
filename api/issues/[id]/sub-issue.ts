import { z } from 'zod';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireToken } from '../../_lib/session';
import { GitHubClient } from '../../_lib/github/gql';
import { setSubIssue } from '../../_lib/github/board';
import { invalidateBoard } from '../../_lib/board-cache';

const Body = z.object({ subIssueId: z.string().min(1), attach: z.boolean() });

/** POST /api/issues/:id/sub-issue — attach or detach a child issue. :id is the parent. */
export default route({
  POST: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    await setSubIssue(new GitHubClient(accessToken), { issueId: param(req, 'id'), ...parsed.data });
    // Both the parent and the child changed; let the next read pick them up.
    invalidateBoard();
    res.status(200).json({ ok: true });
  },
});
