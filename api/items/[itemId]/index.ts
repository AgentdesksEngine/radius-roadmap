import { getItem } from '../../_lib/db/board';
import { noStore, param, route } from '../../_lib/http';
import { requireUser } from '../../_lib/session';

/**
 * GET /api/items/:itemId — a single refreshed item, used by the Realtime subscription
 * (src/api/realtime.ts) to hydrate a `postgres_changes` event into a full BoardItem.
 */
export default route({
  GET: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const item = await getItem(param(req, 'itemId'), profileId);
    noStore(res);
    res.status(200).json(item);
  },
});
