import { z } from 'zod';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireToken } from '../../_lib/session';
import { GitHubClient } from '../../_lib/github/gql';
import { moveItem } from '../../_lib/github/board';
import { invalidateBoard } from '../../_lib/board-cache';

/** `afterId: null` puts the item first. */
const Body = z.object({ afterId: z.string().min(1).nullable() });

/** POST /api/items/:itemId/position — manual ordering, shared with GitHub's own board. */
export default route({
  POST: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    await moveItem(new GitHubClient(accessToken), param(req, 'itemId'), parsed.data.afterId);
    // Ordering is a property of the whole list, so there is no single item to fold in.
    invalidateBoard();
    res.status(200).json({ ok: true });
  },
});
