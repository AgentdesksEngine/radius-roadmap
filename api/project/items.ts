import { noStore, route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { readClient } from '../_lib/github/app';
import { readBoard } from '../_lib/board-cache';

/**
 * The board. Answered from the shared cache in `board-cache.ts`; `?refresh=1` forces a
 * full re-read. The session is still required — the cache is shared between org members,
 * not with the world.
 */
export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const gh = await readClient(accessToken);
    const board = await readBoard(gh, { force: req.query.refresh === '1' });
    noStore(res);
    res.status(200).json(board);
  },
});
