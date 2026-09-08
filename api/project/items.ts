import { getBoard } from '../_lib/db/board';
import { noStore, route } from '../_lib/http';
import { requireUser } from '../_lib/session';

/**
 * The board. Reads go straight to Postgres — no server-side cache layer, unlike the old
 * GitHub-backed version (there is no shared rate-limit budget to protect anymore; a full
 * `SELECT` over a few thousand rows is single-digit milliseconds). `?refresh=1` is accepted
 * for URL compatibility but there is nothing to force-refresh.
 */
export default route({
  GET: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const board = await getBoard(profileId);
    noStore(res);
    res.status(200).json(board);
  },
});
