import { z } from 'zod';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireToken } from '../../_lib/session';
import { GitHubClient } from '../../_lib/github/gql';
import { setItemArchived } from '../../_lib/github/board';
import { cacheItems } from '../../_lib/board-cache';

const Body = z.object({ archived: z.boolean() });

/** POST /api/items/:itemId/archive — hide an item from the project without deleting the issue. */
export default route({
  POST: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const item = await setItemArchived(
      new GitHubClient(accessToken),
      param(req, 'itemId'),
      parsed.data.archived,
    );
    cacheItems([item]);
    res.status(200).json(item);
  },
});
