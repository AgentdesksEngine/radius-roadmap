import { z } from 'zod';
import { setItemArchived } from '../../_lib/db/board';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireUser } from '../../_lib/session';

const Body = z.object({ archived: z.boolean() });

/** POST /api/items/:itemId/archive — hide an item from every view without deleting the issue. */
export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const item = await setItemArchived(profileId, param(req, 'itemId'), parsed.data.archived);
    res.status(200).json(item);
  },
});
