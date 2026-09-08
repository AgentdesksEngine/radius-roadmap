import { z } from 'zod';
import { moveItem } from '../../_lib/db/board';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireUser } from '../../_lib/session';

/** `afterId: null` puts the item first. */
const Body = z.object({ afterId: z.string().min(1).nullable() });

/** POST /api/items/:itemId/position — manual board ordering. */
export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    await moveItem(profileId, param(req, 'itemId'), parsed.data.afterId);
    res.status(200).json({ ok: true });
  },
});
