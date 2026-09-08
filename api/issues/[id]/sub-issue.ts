import { z } from 'zod';
import { setSubIssue } from '../../_lib/db/board';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireUser } from '../../_lib/session';

const Body = z.object({ subIssueId: z.string().min(1), attach: z.boolean() });

/** POST /api/issues/:id/sub-issue — attach or detach a child issue. :id is the parent. */
export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    await setSubIssue(profileId, { issueId: param(req, 'id'), ...parsed.data });
    res.status(200).json({ ok: true });
  },
});
