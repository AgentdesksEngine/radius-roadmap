import { HttpError, noStore, param, route } from '../_lib/http.js';
import { requireToken } from '../_lib/session.js';
import { readClient } from '../_lib/github/app.js';
import { getSchema } from '../_lib/github/board.js';
import { readBoard } from '../_lib/board-cache.js';

/**
 * /api/project/items and /api/project/schema in one function — a single dynamic :action
 * segment rather than two files, to stay under the Hobby plan's per-deployment function cap.
 */
export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const action = param(req, 'action');
    const gh = await readClient(accessToken);

    if (action === 'items') {
      // The board. Answered from the shared cache in `board-cache.ts`; `?refresh=1` forces
      // a full re-read. The session is still required — the cache is shared between org
      // members, not with the world.
      const board = await readBoard(gh, { force: req.query.refresh === '1' });
      noStore(res);
      res.status(200).json(board);
      return;
    }
    if (action === 'schema') {
      const schema = await getSchema(gh, { force: req.query.refresh === '1' });
      noStore(res);
      res.status(200).json(schema);
      return;
    }
    throw new HttpError(404, 'Not found');
  },
});
